#!/usr/bin/env node
// 验收：过程管理（画像预填 5 项 + 6 类随手记 + 待归类 + 两条年轮），与 9 项输入同屏。
// 跑法：node tools/test_process_mgmt.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");

const start = html.indexOf("// PROCESS_LOGIC_START");
const end = html.indexOf("// PROCESS_LOGIC_END");
assert.ok(start > 0 && end > start, "PROCESS_LOGIC 块存在");

const store = {};
const sandbox = {
  console,
  Math,
  Number,
  String,
  Object,
  Array,
  JSON,
  parseInt,
  parseFloat,
  isFinite,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  esc: (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  tr: (zh, en, es) => (sandbox.LANG === "en" ? en : sandbox.LANG === "es" ? es : zh),
  LANG: "zh",
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// 页面里的身份表与 9 项字段，从正式页面取，避免测试自带一份会漂移的定义。
const labelSrc = html.match(/var PLAN_STATUS_LABEL=\{[\s\S]*?\n\};/);
const orderSrc = html.match(/var PLAN_STATUS_ORDER=\[[^\]]*\];/);
const fieldsSrc = html.match(/var OUTLOOK_FIELDS = \[[^\]]*\];/);
assert.ok(labelSrc && orderSrc && fieldsSrc, "缺身份表 / 9 项字段定义");
vm.runInContext(labelSrc[0] + orderSrc[0] + fieldsSrc[0], sandbox);

// 与页面同形的 outlook 存取（PROC 的预填要写回这 9 项）。
const OUTLOOK_DEFAULT = { status: "single", dep: "", income: "", withheld: "", tuition: "", retire: "", mkt: "", premium: "", mortgage: "" };
sandbox.outlookLoad = () => {
  const d = Object.assign({}, OUTLOOK_DEFAULT);
  try {
    const o = JSON.parse(store["tpo_outlook"] || "{}") || {};
    for (const k of sandbox.OUTLOOK_FIELDS) if (o[k] != null) d[k] = String(o[k]);
  } catch (e) {}
  return d;
};
sandbox.outlookSave = (s) => { store["tpo_outlook"] = JSON.stringify(s); };

vm.runInContext(html.slice(start, end), sandbox, { filename: "process-mgmt.js" });

const p = { status: "mfj", income: "75,000", college: "yes", ins1095a: "yes", mortgage: "no", eduUsed: "3", ssPoints: "34" };
const BANNED = ["抵税", "合格", "能领", "符合条件", "最多可退", "保证", "一定", "eligible", "entitled"];
const CJK = /[\u4e00-\u9fff]/;
const TYPES = ["edu", "job", "gain", "se", "ins", "k401"];
const DEADLINES = ["12/31", "1/31", "4/15"];

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}

function resetProfile(over) {
  store["tpo_profile_v1"] = JSON.stringify(Object.assign({}, p, over || {}));
}
function resetFrags(list) {
  store["tpo_frags_v1"] = JSON.stringify(list || []);
}

// ---- 9 项不许减项 ----
check("9 项输入一个不少，且画像只预填其中 5 项", () => {
  assert.deepEqual(
    Array.from(sandbox.OUTLOOK_FIELDS),
    ["status", "dep", "income", "withheld", "tuition", "retire", "mkt", "premium", "mortgage"]
  );
  const add = sandbox.procPrefill(p);
  assert.equal(add.status, "mfj", "报法");
  assert.equal(add.income, "75000", "收入（去掉逗号）");
  assert.equal(add.dep, "1", "被抚养人");
  assert.equal(add.mkt, "12", "1095-A");
  assert.equal(add.mortgage, "0", "无房贷/自雇");
  assert.equal(Object.keys(add).length, 5, "只预填 5 项");
});

check("房贷/自雇选「有」时不编金额，只留提示，金额由用户填", () => {
  const add = sandbox.procPrefill(Object.assign({}, p, { mortgage: "yes" }));
  assert.equal("mortgage" in add, false, "不该填一个假的金额");
  resetProfile({ mortgage: "yes" });
  assert.ok(sandbox.procHtml(false).includes("金额请填在下面"), "缺金额提示");
});

// ---- 6 类 + 待归类 ----
check("6 个可点类型 + 1 个待归类，共 7 个按钮", () => {
  resetProfile();
  resetFrags();
  const out = sandbox.procHtml(true);
  for (const id of TYPES) assert.ok(out.includes("data-proc='" + id + "'"), "缺按钮：" + id);
  assert.ok(out.includes("data-proc='unknown'"), "缺待归类");
  assert.equal((out.match(/data-proc='/g) || []).length, 7);
});

check("每笔季票态四行齐全：我记成 / 动了哪条线 / 最晚哪天 / 明年表上", () => {
  for (const id of TYPES) {
    const card = sandbox.procCardHtml({ k: id }, 0, true, p);
    assert.ok(card.includes("我记成"), id + " 缺「我记成」");
    assert.ok(card.includes("动了哪条线"), id + " 缺「动了哪条线」");
    assert.ok(card.includes("最晚哪天"), id + " 缺「最晚哪天」");
    assert.ok(card.includes("明年表上"), id + " 缺「明年表上」");
    assert.equal((card.match(/class='kv'/g) || []).length, 3, id + " 应有三行解读");
    assert.ok(!/\$/.test(card), id + " 卡片里出现了金额");
  }
});

check("免费态只有「我记成」，没有线 / 截止日 / 明年表 / 预警", () => {
  for (const id of TYPES) {
    const card = sandbox.procCardHtml({ k: id }, 0, false, p);
    assert.ok(card.includes("我记成"), id + " 免费态连记录都看不到");
    assert.ok(!/class='kv'/.test(card), id + " 免费态出现了三行解读");
    assert.ok(!card.includes("proc-warn"), id + " 免费态出现了预警");
    for (const d of DEADLINES) assert.ok(!card.includes(d), id + " 免费态出现了截止日 " + d);
  }
  resetProfile(); resetFrags([{ k: "edu" }]);
  const free = sandbox.procHtml(false);
  for (const d of DEADLINES) assert.ok(!free.includes(d), "免费整块出现了截止日 " + d);
  assert.ok(!free.includes("最后一次"), "免费整块出现了不可逆预警");
});

check("待归类：不产生任何线，也不进预警（免费与季票都一样）", () => {
  for (const unlocked of [false, true]) {
    const card = sandbox.procCardHtml({ k: "unknown" }, 0, unlocked, p);
    assert.ok(!/class='kv'/.test(card), "待归类出现了线");
    assert.ok(!card.includes("proc-warn"), "待归类出现了预警");
    assert.equal(sandbox.procWarn("unknown", p), null);
  }
});

// ---- 画像写回 9 项 ----
check("保存画像后，只覆盖那 5 项，其余 4 项原样保留", () => {
  store["tpo_outlook"] = JSON.stringify(Object.assign({}, OUTLOOK_DEFAULT, { withheld: "9000", tuition: "12000" }));
  const add = sandbox.procApplyPrefill(p);
  const s = JSON.parse(store["tpo_outlook"]);
  assert.deepEqual(
    { status: s.status, dep: s.dep, income: s.income, mkt: s.mkt, mortgage: s.mortgage },
    { status: "mfj", dep: "1", income: "75000", mkt: "12", mortgage: "0" }
  );
  assert.equal(s.withheld, "9000", "预扣被画像覆盖了");
  assert.equal(s.tuition, "12000", "学费被画像覆盖了");
  assert.equal(Object.keys(add).length, 5);
});

// ---- 两条年轮 ----
check("学费抵免年轮：第 4 年是最后一年，4 年用完不可逆", () => {
  assert.ok(sandbox.procEduCap(2).includes("今年第 3 年"));
  assert.ok(sandbox.procEduCap(3).includes("今年第 4 年"));
  assert.ok(sandbox.procEduCap(4).includes("不可逆"));
  assert.equal(sandbox.procWarn("edu", Object.assign({}, p, { eduUsed: "4" }))[0], 3);
  assert.ok(sandbox.procWarn("edu", Object.assign({}, p, { eduUsed: "3" }))[1].includes("最后一次"));
  assert.ok(!sandbox.procWarn("edu", Object.assign({}, p, { eduUsed: "0" }))[1].includes("最后一次"));
  assert.ok(sandbox.procEduCells(3).includes("now"), "第 4 格应标为今年");
});

check("退休分年轮：40 分上限、一年最多 4 分", () => {
  assert.ok(sandbox.procSsCap(34).includes("还能拿 4 分"));
  assert.ok(sandbox.procSsCap(38).includes("还能拿 2 分"));
  assert.ok(sandbox.procSsCap(40).includes("已满"));
  resetProfile({ ssPoints: "99" });
  assert.ok(sandbox.procHtml(false).includes("40 分已满"), "超过 40 分应被夹到上限");
});

// ---- 文案断言：8962 退回不是一比一，年轮按单个学生 / 按本人 ----
check("ins 预警：说「退回有上限」，不出现上限金额、也不说一比一", () => {
  resetProfile();
  for (const lang of ["zh", "en", "es"]) {
    sandbox.LANG = lang;
    const w = sandbox.procCardHtml({ k: "ins" }, 0, true, p);
    assert.ok(/上限|up to a cap|con un tope/.test(w), lang + " 缺「有上限」");
    assert.ok(!/\$\s?\d/.test(w), lang + " 出现了金额");
    assert.ok(!/一分|one for one|uno por uno/i.test(w), lang + " 仍是一比一说法");
  }
  sandbox.LANG = "zh";
});
check("年轮标签写明按单个学生 / 按本人，并给出两个孩子的填法", () => {
  const out = sandbox.procHtml(true);
  assert.ok(out.includes("AOTC 前四年（按单个学生算）"), "年轮标签没写 AOTC 前四年");
  assert.ok(out.includes("年数各算各的"), "缺两个孩子的填法提示");
  assert.ok(out.includes("退休分（按你本人算）"), "退休分标签没写按本人");
  assert.ok(out.includes("LLC（终生学习抵免）没有年数上限"), "来源行没写 LLC 无年限");
  assert.ok(!/教育抵免：Pub 970 \/ Form 8863，每个学生最多 4 个税年/.test(out), "来源行仍像所有教育抵免都只有 4 年");
  sandbox.LANG = "en";
  const en = sandbox.procHtml(true);
  assert.ok(en.includes("AOTC's first four years (per student)") && en.includes("Retirement credits (yours)"), "en 标签不对");
  assert.ok(en.includes("the LLC (lifetime learning credit) has no year limit"), "en 来源行没写 LLC 无年限");
  sandbox.LANG = "es";
  const es = sandbox.procHtml(true);
  assert.ok(es.includes("Los primeros cuatro años del AOTC (por estudiante)") && es.includes("Créditos de retiro (los suyos)"), "es 标签不对");
  assert.ok(es.includes("el LLC (crédito de aprendizaje permanente) no tiene límite de años"), "es 来源行没写 LLC 无年限");
  sandbox.LANG = "zh";
});

// ---- 三语无兜底 ----
check("三语：en/es 新模块 0 中文兜底", () => {
  resetProfile();
  resetFrags(TYPES.map((k) => ({ k })).concat([{ k: "unknown" }]));
  for (const lang of ["en", "es"]) {
    sandbox.LANG = lang;
    const outs = [sandbox.procHtml(true), sandbox.procHtml(false)];
    for (const id of TYPES.concat(["unknown"])) {
      outs.push(sandbox.procCardHtml({ k: id }, 0, true, p));
      outs.push(sandbox.procCardHtml({ k: id }, 0, false, p));
    }
    for (const [i, out] of outs.entries()) {
      assert.ok(!CJK.test(out), lang + " 第 " + i + " 块仍有中文：" + out.slice(0, 60));
    }
  }
  sandbox.LANG = "zh";
});

// ---- 禁词 ----
check("三语禁词 0 命中，且不出现「省$X」", () => {
  resetProfile();
  resetFrags(TYPES.map((k) => ({ k })));
  for (const lang of ["zh", "en", "es"]) {
    sandbox.LANG = lang;
    const out = sandbox.procHtml(true) + sandbox.procHtml(false);
    for (const w of BANNED) assert.ok(!out.toLowerCase().includes(w.toLowerCase()), lang + " 命中禁词：" + w);
    assert.ok(!/省\s*\$[\d]/.test(out), lang + " 出现「省$X」");
  }
  sandbox.LANG = "zh";
});

// ---- 同屏挂载 ----
check("与 9 项输入同屏：9 项下面有 procBlock，renderOutlook 会渲染过程管理", () => {
  assert.ok(html.includes('h += outlookInputsHtml(s);\n  h += "<div id=\\"procBlock\\"></div>";'));
  assert.ok(/el\.innerHTML = outlookHtml\(hasPass\(\)\);\s*\n\s*renderProcess\(\);/.test(html));
});

// ---- 语法：所有内联脚本都能解析 ----
check("页面内联脚本无语法错误", () => {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(html))) {
    new Function(m[1]);
    n++;
  }
  assert.ok(n > 0, "没找到内联脚本");
});

let bad = 0;
for (const [tag, msg] of results) {
  if (tag !== "ok  ") bad++;
  console.log(tag, msg);
}
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);