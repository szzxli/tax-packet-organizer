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
  // 页面里「去年那张表」的画像（用户已填）：40 分 34、学费抵免已用 1 年
  procProfileLoad: () => ({ ssPoints: "34", eduUsed: "1" }),
};
vm.createContext(sandbox);
// 规则图是唯一来源：页面 fetch 它，测试直接读同一个文件
const graph = JSON.parse(fs.readFileSync(new URL("../rules/graph.json", import.meta.url), "utf8"));
sandbox.RULES = graph;
// 档位表与身份表来自页面本身，和卡 1 用同一份
const bracketsSrc = html.match(/var PLAN_BRACKETS_2026=\{[\s\S]*?\n\};/);
const statusSrc = html.match(/var PLAN_STATUS_LABEL=\{[\s\S]*?\n\};/);
const orderSrc = html.match(/var PLAN_STATUS_ORDER=\[[^\]]*\];/);
assert.ok(bracketsSrc && statusSrc && orderSrc, "缺档位/身份表");
vm.runInContext(bracketsSrc[0] + statusSrc[0] + orderSrc[0], sandbox);
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

// ---- 今年这张地图（四条线 × 四格：位置 / 推得动哪一条 / 以后会怎样 / 最晚哪天）----
check("地图：季票态四条线 × 四格，位置/联动/未来/截止日都在", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state({ dep: "1", tuition: "12000", mkt: "12", premium: "8400", retire: "5000" })));
  const out = sandbox.outlookMapHtml(true);
  for (const k of ["收入 / 税档", "医保补贴（1095-A / 8962）", "教育（AOTC / LLC）", "退休账户今年放了多少", "40 分进度（按劳动收入）"]) assert.ok(out.includes(k), "缺这一行：" + k);
  assert.equal((out.match(/<tr>/g) || []).length, 6, "应为表头 1 + 五条线 5 行");
  assert.equal((out.match(/<td>/g) || []).length, 20, "五条线各应四格（共 20 个 td）");
  assert.ok(out.includes("以后会怎样"), "表头缺「以后会怎样」");
  assert.ok(out.includes("% 档"), "缺档位");
  assert.ok(out.includes("$12,000"), "缺学费位置");
  assert.ok(out.includes("12/31"), "缺 12/31 类截止日");
  assert.ok(out.includes("4/15"), "缺 4/15 类截止日");
  assert.ok(out.includes("400%"), "缺 400% 那条线");
  assert.ok(out.includes("LLC 没有年数上限"), "缺 LLC 无年限口径");
  assert.ok(out.includes("26 U.S.C. §36B(c)(1)(A)") && out.includes("2025 年贫困线") && out.includes("2026 保障年"), "来源行缺 400% 线的法源或两个年度字段");
  assert.ok(out.includes("核于 2026-11-10") && out.includes("核于 2026-11-03"), "来源行缺核实日期");
  // 未来格必须踩在真实年度上
  assert.ok(out.includes("2027 年的预扣"), "收入线未来格没落到 2027");
  assert.ok(out.includes("2027 计划年"), "医保线未来格没落到 2027 计划年");
  assert.ok(out.includes("还剩 2 年") && out.includes("2027 年这一项就没有了"), "教育线未来格缺剩余年数或落点年份");
  assert.ok(out.includes("2028–29 的 FAFSA"), "教育线未来格缺 FAFSA 年度");
  assert.ok(out.includes("40 分从 34 走到 38"), "退休线未来格缺 40 分走向");
  assert.ok(out.includes("studentaid.gov"), "来源行缺 FAFSA 出处");
  // 400% 线按家庭人数（1 + 被抚养人数）折算：2 人 = 4 × ($15,650 + $5,500) = $84,600；收入 85,000 越过约 $400
  assert.ok(out.includes("$84,600") && out.includes("已越过约 $400"), "缺按人数折算的 400% 线或距离");
  assert.ok(out.includes("HHS") || out.includes("2025 贫困线") || out.includes("FR 2025-01-17"), "来源行缺贫困线出处");
  // 40 分那行必须写明跟存钱无关，且不许出现「再存多少能多几分」
  assert.ok(out.includes("按劳动收入记，跟存钱无关") || out.includes("存进去的钱不加分"), "40 分行没写跟存钱无关");
  assert.ok(!/再存.{0,8}(就|能|可以).{0,6}分/.test(out), "出现了「再存多少能多几分」这类话");
});
check("地图：免费态只给方向，没有金额、没有截止日、没有年数", () => {
  for (const lang of ["zh", "en", "es"]) {
    sandbox.LANG = lang;
    const out = sandbox.outlookMapHtml(false);
    assert.ok(out.length > 0, lang + " 免费态地图是空的");
    assert.ok(!/\$[\d]/.test(out), lang + " 免费态出现金额：" + out.slice(0, 140));
    assert.ok(!/12\/31|4\/15|1\/31|2027-04-15/.test(out), lang + " 免费态出现截止日");
    assert.ok(!/2027|2028|2029/.test(out), lang + " 免费态未来格出现具体年份");
    assert.ok(!/还剩 \d+ 年|第 \d+ 年/.test(out), lang + " 免费态未来格出现年数");
    assert.ok(!/undefined|null/.test(out), lang + " 免费态出现空值");
    assert.ok(/偏低|中间|接近上限|最高档|low|middle|near the top|top bracket|bajo|medio|cerca del tope|tramo más alto/.test(out), lang + " 缺方向词");
  }
  sandbox.LANG = "zh";
});

// ---- 规则图与运行时扫描 ----
check("规则图：400% 每行都带两个年度字段、出处与核实日", () => {
  const rows = graph.poverty_lines.four_hundred_pct;
  assert.ok(rows.length >= 4, "至少 1–4 人四行");
  for (const row of rows) {
    assert.equal(row.effective_tax_year, 2025, "有效税年应为 2025 版指南");
    assert.equal(row.coverage_year, 2026, "适用保障年应为 2026");
    assert.match(row.source_url, /^https:\/\//, "缺出处 URL");
    assert.match(row.checked, /^\d{4}-\d{2}-\d{2}$/, "缺核实日");
    assert.equal(row.limit, row.fpl * 4, "400% 应为贫困线 ×4");
  }
  assert.equal(rows[0].limit, 62600);
  assert.equal(rows[3].limit, 128600);
});
check("sw：图进了 APP_SHELL，缓存版本不再是 v3", () => {
  const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"./rules/graph.json"'), "APP_SHELL 缺规则图");
  assert.ok(!sw.includes('"tax-packet-shell-v3"'), "CACHE_NAME 没升，图会被旧缓存盖住");
});
check("AI 文案进 DOM 前换成中性句，正常文案不动", () => {
  const bad = sandbox.aiSafeText("You are eligible for this credit");
  assert.ok(!/eligible/i.test(bad) && bad.length > 0, "命中禁用词后应换中性句");
  assert.equal(sandbox.aiSafeText("雇主寄来的 W-2"), "雇主寄来的 W-2");
});

// ---- 免责在可见正文（不在 details 里）----
check("免责句在折叠之外", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const out = sandbox.outlookHtml(true);
  const i = out.indexOf("这是估算，不是申报");
  const detailsEnd = out.lastIndexOf("</details>");
  assert.ok(i > detailsEnd, "免责句落在折叠块里了");
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