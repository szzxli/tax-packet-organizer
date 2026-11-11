// 钱那一屏的守卫测试：口径、区间四件同行、免费态边界、禁词扫描（中英西）。
// 跑法：node tools/test_money_guard.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../formal.html", import.meta.url), "utf8");

// ---- 取出逻辑块 ----
const start = html.indexOf("// OUTLOOK_LOGIC_START");
const end = html.indexOf("// OUTLOOK_LOGIC_END");
assert.ok(start > 0 && end > start, "缺 OUTLOOK_LOGIC 块");

const store = {};
const sandbox = {
  console,
  Math,
  Number,
  String,
  parseFloat,
  isFinite,
  JSON,
  Date,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  tr: (zh, en, es) => (sandbox.LANG === "en" ? en : sandbox.LANG === "es" ? es : zh),
  LANG: "zh",
};
vm.createContext(sandbox);
// 档位表与身份表来自页面本身，和卡 1 用同一份
const bracketsSrc = html.match(/var PLAN_BRACKETS_2026=\{[\s\S]*?\n\};/);
const brackets27Src = html.match(/var PLAN_BRACKETS_2027=\{[\s\S]*?\n\};/);
const yearSrc = html.match(/var PLAN_TAX_YEAR=[^\n]*\nvar PLAN_BRACKETS=[^\n]*/);
const statusSrc = html.match(/var PLAN_STATUS_LABEL=\{[\s\S]*?\n\};/);
const orderSrc = html.match(/var PLAN_STATUS_ORDER=\[[^\]]*\];/);
assert.ok(bracketsSrc && brackets27Src && yearSrc && statusSrc && orderSrc, "缺档位/身份表或年度选择");
vm.runInContext(bracketsSrc[0] + brackets27Src[0] + yearSrc[0] + statusSrc[0] + orderSrc[0], sandbox);
vm.runInContext(html.slice(start, end), sandbox);

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}

function state(over) {
  return Object.assign(
    { status: "single", dep: "", income: "85000", withheld: "9000", tuition: "", retire: "", mkt: "", premium: "", mortgage: "" },
    over || {}
  );
}

// ---- 方向 ----
check("方向：预扣少于应缴 → 补税", () => {
  assert.equal(sandbox.outlookEstimate(state()).dir, "owe");
});
check("方向：预扣多于应缴 → 退税", () => {
  const e = sandbox.outlookEstimate(state({ withheld: "20000" }));
  assert.equal(e.dir, "refund");
  assert.ok(e.gap < 0);
});
check("方向：两边差在 250 以内 → 持平（不把噪声说成结论）", () => {
  const tax = sandbox.outlookEstimate(state({ withheld: "0" })).tax;
  assert.equal(sandbox.outlookEstimate(state({ withheld: String(tax + 100) })).dir, "even");
  assert.equal(sandbox.outlookEstimate(state({ withheld: String(tax - 100) })).dir, "even");
});

// ---- 区间四件同行 ----
check("季票态：区间 + 成立条件 + 依据 + 核实日期 同一屏", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const out = sandbox.outlookHtml(true);
  assert.match(out, /大概范围：.*?(退|补) \$[\d,]+ 到 \$[\d,]+/, "缺区间");
  assert.ok(out.includes("还没算"), "缺成立条件");
  assert.ok(out.includes("2026 年联邦档位表"), "缺依据");
  assert.ok(out.includes("2026-11-03"), "缺核实日期");
  assert.ok(out.includes("2027-04-15"), "缺最晚日期");
});
check("截止日按税年查表，不写死在可见句子里", () => {
  assert.equal(sandbox.OUTLOOK_DEADLINE, sandbox.OUTLOOK_DEADLINE_BY_YEAR[sandbox.OUTLOOK_TAX_YEAR], "截止日没走税年表");
  assert.equal(sandbox.OUTLOOK_DEADLINE, "2027-04-15");
});
check("季票态：三条推手只写命中的", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const only = sandbox.outlookHtml(true);
  assert.equal((only.match(/<li>/g) || []).length, 1, "只填了预扣时应只有一条推手");
  const s = state({ tuition: "12000", mkt: "12" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(s));
  const out3 = sandbox.outlookHtml(true);
  assert.equal((out3.match(/<li>/g) || []).length, 3, "命中三项时应有三条推手");
  assert.ok(out3.includes("学费单") && out3.includes("1095-A"));
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
});
check("缺项加宽：多填一项就宽 250，并写明缺什么", () => {
  const a = sandbox.outlookEstimate(state());
  const b = sandbox.outlookEstimate(state({ tuition: "12000" }));
  assert.equal((b.high - b.low) - (a.high - a.low), 500, "一项应加宽 500 总宽（±250）");
  assert.deepEqual([...b.whys], ["tuition"]);
});

// ---- 免费态边界 ----
check("免费态：只有方向，没有金额/区间/推手/时点", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  for (const lang of ["zh", "en", "es"]) {
    sandbox.LANG = lang;
    const out = sandbox.outlookHtml(false);
    assert.ok(!/\$[\d]/.test(out), lang + " 免费态出现了金额：" + out);
    assert.ok(!out.includes("2027-04-15"), lang + " 免费态出现了最晚日期");
    assert.ok(!out.includes("是哪几项在推这个结果"), lang + " 免费态出现了推手标题");
    assert.equal((out.match(/<li>/g) || []).length, 0, lang + " 免费态出现了推手清单");
    assert.ok(/退税|补税|持平|refund|owed|devolución|parejo|impuesto por pagar/.test(out), lang + " 免费态缺方向");
  }
  sandbox.LANG = "zh";
});

// ---- 免责在可见正文（不在 details 里）----
check("免责句在折叠之外", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const out = sandbox.outlookHtml(true);
  const i = out.indexOf("这是估算，不是申报");
  const detailsEnd = out.lastIndexOf("</details>");
  assert.ok(i > detailsEnd, "免责句落在折叠块里了");
});

// ---- 卡 4：Saver's Match 不点不存在的表号 ----
check("全页没有编造的表号：8880 = 0、2028 = 0", () => {
  assert.equal(html.indexOf("8880"), -1, "页面仍写 8880-A（IRS 未公布该表号）");
  assert.equal(html.indexOf("2028"), -1, "页面仍写 2028 年那张表");
  assert.ok(html.includes("SECURE 2.0 §103"), "缺 Saver's Match 的法条依据");
  assert.ok(html.includes("尚未公布表单号"), "没写明表号未公布");
});

// ---- 禁词 ----
const BANNED = ["抵税", "合格", "能领", "符合条件", "最多可退", "保证", "一定", "eligible", "entitled"];
check("新模块三语 0 禁词", () => {
  for (const lang of ["zh", "en", "es"]) {
    sandbox.LANG = lang;
    const out = sandbox.outlookHtml(true) + sandbox.outlookHtml(false);
    for (const w of BANNED) assert.ok(!out.toLowerCase().includes(w.toLowerCase()), lang + " 命中禁词：" + w);
    assert.ok(!/省\s*\$[\d]/.test(out), lang + " 出现「省$X」");
  }
  sandbox.LANG = "zh";
});

// ---- 全文扫描（带已知良性短语白名单）----
// 良性片段：①「持有是否超过一定年限」是访谈问题，不是对用户的判定；
// ②「合格外国税」整段讲的是外国税能否抵免，且原文写明「由税务师判断」，与我们对用户下结论无关。
const benign = ["持有是否超过一定年限", "在中国已缴的所得税是否合格、能否抵免、限额多少", "是否合格由税务师判断", "一般不算合格外国税", "在中国已缴税是否合格外国税收抵免"];
check("全文禁词 0 命中（含 en/es，良性短语已白名单）", () => {
  let body = html;
  for (const b of benign) body = body.split(b).join("__BENIGN__");
  const hits = BANNED.filter((w) => body.toLowerCase().includes(w.toLowerCase()));
  assert.deepEqual(hits, [], "全文仍有禁词：" + hits.join(","));
  assert.ok(!/省\s*\$[\d]/.test(body), "全文出现「省$X」");
});

// ---- 输出 ----
let bad = 0;
for (const [tag, msg] of results) {
  if (tag !== "ok  ") bad++;
  console.log(tag, msg);
}
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);