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
// 身份表来自页面本身，和卡 1 用同一份；税档表已搬进 rules/graph.json，页面只读图
const statusSrc = html.match(/var PLAN_STATUS_LABEL=\{[\s\S]*?\n\};/);
const orderSrc = html.match(/var PLAN_STATUS_ORDER=\[[^\]]*\];/);
const bracketsFnSrc = html.match(/function planBrackets\(status\)\{[\s\S]*?\n\}/);
assert.ok(statusSrc && orderSrc && bracketsFnSrc, "缺身份表 / 档位读取函数");
vm.runInContext(statusSrc[0] + orderSrc[0] + bracketsFnSrc[0], sandbox);
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
  for (const k of ["收入 / 税档", "医保补贴（1095-A / 8962）", "教育（AOTC / LLC）", "退休账户今年放了多少", "今年记了几分（40 分 ≈ 10 年）"]) assert.ok(out.includes(k), "缺这一行：" + k);
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
  // FAFSA 只写「两年」，不点名没发布的学年
  assert.ok(/两年/.test(out), "教育线未来格缺「两年」口径");
  assert.ok(!/2028|2029/.test(out), "教育线出现了没发布的学年");
  // 不给当年分数：只讲规则（分只按工资/自雇记、一年最多 N 分、攒到 40）
  assert.ok(out.includes("分只按工资／自雇那部分记"), "40 分行没写只按工资／自雇记");
  assert.ok(!/今年能拿 [0-9]+ 分|最多到 [0-9]+|从 [0-9]+ 走到/.test(out), "仍在按总收入估年度分数");
  assert.ok(out.includes("studentaid.gov"), "来源行缺 FAFSA 出处");
  // 400% 线按家庭人数折算：2 人 = 4 × ($15,650 + $5,500) = $84,600；
  // AGI = 85,000 − 5,000 = 80,000，离这条线还有约 $4,600
  assert.ok(out.includes("$84,600") && out.includes("离这条线还有约 $4,600"), "缺按人数折算的 400% 线或 AGI 距离");
  assert.ok(!/NaN|undefined/.test(out), "400% 行出现 NaN/undefined");
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

check("钱那屏：条件行写明只按标准扣除算（金额在条件行里）", () => {
  const s = state({ status: "mfj", dep: "1", income: "85000", withheld: "9000", retire: "5000" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(s));
  const out = sandbox.outlookOutHtml(true);
  assert.ok(out.includes("$32,200"), "条件行缺标准扣除金额");
  assert.ok(out.includes("分项扣除"), "条件行没说明分项会让实际不一样");
});
check("估算：先扣标准扣除，四个样例的方向与税额都对", () => {
  const cases = [
    [{ status: "single", income: "70000", withheld: "8000" }, "refund", 1430],
    [{ status: "single", income: "45000", withheld: "5000" }, "refund", 1780],
    [{ status: "mfj", income: "120000", withheld: "12000" }, "refund", 1960],
    [{ status: "single", income: "100000", withheld: "12000" }, "owe", 1170],
  ];
  for (const [over, dir, gap] of cases) {
    sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state(over)));
    const e = sandbox.outlookEstimate(state(over));
    assert.equal(e.dir, dir, over.status + " " + over.income + " 方向错了");
    assert.equal(Math.abs(Math.round(e.gap)), gap, over.status + " " + over.income + " 差额错了");
  }
});
check("400%：单身 70,000 用 AGI 比线，越过 7,400（不是拿应税收入比）", () => {
  const s = state({ status: "single", dep: "", income: "70000", withheld: "8000", mkt: "12", premium: "8400" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(s));
  const row1 = sandbox.RULES.poverty_lines.four_hundred_pct[0];
  assert.equal(sandbox.mapFpl400(1), row1.limit, "400% 线应按图算");
  assert.equal(row1.limit, row1.fpl * 4, "公式：400% = 贫困线 ×4");
  assert.equal(sandbox.outlookEstimate(s).agi, 70000);
  const out = sandbox.outlookMapHtml(true);
  assert.ok(out.includes("已越过约 $7,400"), "400% 距离没用 AGI 算");
});

check("单身 70,000/8,000 必须出「退」，不许说「补」", () => {
  const st = state({ status: "single", dep: "", income: "70000", withheld: "8000" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(st));
  const out = sandbox.outlookOutHtml(true);
  assert.ok(/退税/.test(out), "没判成退税");
  assert.ok(!/大概是补税/.test(out), "方向判成了补税");
});
check("70,000 + 退休 10,000 + 1 人：400% 判未越线", () => {
  const st = state({ status: "single", dep: "", income: "70000", withheld: "8000", retire: "10000", mkt: "12", premium: "8400" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(st));
  assert.equal(sandbox.outlookEstimate(st).agi, 60000, "AGI 应为 60,000（减去退休缴款、不扣标准扣除）");
  const out = sandbox.outlookMapHtml(true);
  assert.ok(!out.includes("已越过约"), "仍判成越过");
  assert.ok(out.includes("离这条线还有约 $2,600"), "没给出「离线 2,600」");
  assert.ok(!out.includes("越过约 $7,400"), "仍按毛收入算出越过 7,400");
  assert.ok(out.includes("就在线边上"), "近线没给出提示");
});
check("7 万全是 1099-INT：40 分不许写死 4 分，只给上限与「只有工资/自雇算」", () => {
  const st = state({ status: "single", dep: "", income: "70000", withheld: "8000" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(st));
  const out = sandbox.outlookMapHtml(true);
  assert.ok(!/今年能拿 [0-9]+ 分/.test(out), "仍把总收入当劳动收入算分");
  assert.ok(!/从 \d+ 走到/.test(out), "仍给精确推进");
  assert.ok(/最多 \d+ 分/.test(out), "缺「最多 N 分」上限口吻");
  assert.ok(out.includes("工资／自雇"), "没写明只有工资/自雇那份算");
});

check("100,000/12,000 的补税额落在区间内（center ± 宽度）", () => {
  const st = state({ status: "single", dep: "", income: "100000", withheld: "12000" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(st));
  const e = sandbox.outlookEstimate(st);
  assert.equal(e.dir, "owe");
  assert.ok(e.low <= 1170 && 1170 <= e.high, "1,170 不在区间 [" + e.low + "," + e.high + "] 内");
});
check("页面里没有直接吃毛收入的写法（e.income - line400 / e.income / ssPoint）", () => {
  assert.equal(html.split("e.income - line400").length - 1, 0, "还有 e.income - line400");
  assert.equal(html.split("e.income / ssPoint").length - 1, 0, "还有 e.income / ssPoint");
  assert.ok(html.includes("e.agi - line400"), "400% 应改用 e.agi");
});

check("7 万全 1099-INT：不出年度分数，只写规则", () => {
  const st = state({ status: "single", dep: "", income: "70000", withheld: "8000" });
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(st));
  const out = sandbox.outlookMapHtml(true);
  assert.ok(!/今年能拿 [0-9]+ 分|最多到 [0-9]+|从 [0-9]+ 走到/.test(out), "仍在按总收入估年度分数");
  assert.ok(out.includes("分只按工资／自雇那部分记"), "没写明只按工资／自雇记");
  assert.ok(out.includes("攒到 40 分"), "没写 40 分的目标");
});
check("页面不写字面门槛（标准扣除 / 贫困线 / SSA 每分）", () => {
  for (const lit of ["1890", "16100", "32200", "24150", "15650", "21150", "26650", "32150", "62600", "84600", "106600", "128600"]) {
    assert.equal(html.indexOf(lit), -1, "页面仍写死门槛：" + lit);
  }
});
check("全页没有不存在的 Form 8880-A", () => {
  assert.equal(html.indexOf("8880-A"), -1, "仍在写 Form 8880-A");
  assert.ok(html.includes("SECURE 2.0 §103"), "缺 Saver's Match 的法条依据");
  assert.ok(html.includes("尚未公布表单号"), "没注明表单号未公布");
});

// ---- 税档表：只在图里，页面只读图 ----
// 四个身份 × 七档的上限；页面里出现任何一个字面值都说明还有第二份表。
const BRACKET_LITERALS = ["12400", "50400", "105700", "201775", "256225", "640600", "24800", "100800", "211400", "403550", "512450", "768700", "384350", "17700", "67450", "256200"];
check("税档四个身份的七档只在 rules/graph.json，页面 0 字面值", () => {
  assert.equal(html.indexOf("PLAN_BRACKETS_2026"), -1, "页面仍有 PLAN_BRACKETS_2026");
  const hits = BRACKET_LITERALS.filter((n) => html.indexOf(n) !== -1);
  assert.deepEqual(hits, [], "页面仍写死档位数字：" + hits.join(","));
});
check("规则图 brackets：四身份 × 七档、单调递增、最高档无上限、带出处与核实日", () => {
  const b = graph.brackets;
  assert.ok(b, "图里没有 brackets");
  assert.deepEqual(b.filing_statuses, ["single", "mfj", "mfs", "hoh"], "身份清单不对");
  assert.equal(b.effective_tax_year, graph.tax_year, "有效税年与图不一致");
  assert.match(b.source_url, /^https:\/\//, "缺出处 URL");
  assert.match(b.checked, /^\d{4}-\d{2}-\d{2}$/, "缺核实日");
  for (const st of b.filing_statuses) {
    const rows = b[st];
    assert.ok(Array.isArray(rows) && rows.length === 7, st + " 不是七档");
    assert.equal(rows[rows.length - 1][0], null, st + " 最高档应无上限（null）");
    for (let i = 0; i < rows.length - 1; i++) {
      assert.ok(rows[i][0] > (i ? rows[i - 1][0] : 0), st + " 第 " + (i + 1) + " 档上限不是递增");
      assert.ok(rows[i][1] < rows[i + 1][1], st + " 第 " + (i + 1) + " 档税率没有递增");
    }
  }
});
check("删掉图里 brackets：地图与卡 1 都走空态，不回落内置数字、不抛错", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state({ status: "single", income: "85000", withheld: "9000" })));
  const full = graph.brackets;
  const without = JSON.parse(JSON.stringify(graph));
  delete without.brackets;
  try {
    sandbox.RULES = without;
    const map = sandbox.outlookMapHtml(true) + sandbox.outlookMapHtml(false);
    assert.ok(map.includes("规则表还没读到"), "地图没走空态：" + map.slice(0, 80));
    assert.ok(!/\d+% 档/.test(map), "地图仍在出档位");
    assert.ok(!/\$[\d,]{4,}/.test(map), "地图仍在出金额");
  } finally {
    sandbox.RULES = graph;
  }
  assert.equal(graph.brackets, full, "测试不该改动图本身");
  const back = sandbox.outlookMapHtml(true);
  assert.ok(/\d+% 档/.test(back), "恢复图后地图没回来");
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
  for (const r of rows) assert.equal(r.limit, r.fpl * 4, "400% = 贫困线 ×4");
});
check("sw：图进了 APP_SHELL，缓存版本随图改动升到 v7", () => {
  const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"./rules/graph.json"'), "APP_SHELL 缺规则图");
  // 图是缓存优先；改了图不升版本，老用户会一直读到旧图（这轮就少了 brackets）。
  assert.ok(sw.includes('"tax-packet-shell-v7"'), "改了规则图却没升 CACHE_NAME，旧图会被缓存盖住");
  assert.ok(!sw.includes('"tax-packet-shell-v3"'), "CACHE_NAME 还停在 v3");
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

// ---- 政策变化条：事件，不是常驻文案 ----
const DAY = 86400000;
const NOW_NEW = Date.UTC(2026, 10, 15);      // announced 2026-11-11 之后第 4 天
const NOW_OLD = Date.UTC(2026, 11, 1);       // 第 20 天
const barOf = (unlocked, now) => sandbox.policyBarHtml(unlocked, now);
const timelineOf = (unlocked, now) => sandbox.policyTimelineHtml(unlocked, now);

check("有新变化：首屏亮，带「新」与生效年；时间轴不出", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const bar = barOf(true, NOW_NEW);
  assert.ok(bar.includes('id="outlookOneThing"'), "新事件没亮：" + bar);
  assert.ok(bar.includes("新"), "缺「新」角标");
  assert.ok(bar.includes("2027"), "缺生效年");
  assert.ok(bar.includes("1,890") && bar.includes("1,970"), "没写清从几变成几：" + bar);
  assert.ok(bar.includes("核于 2026-10-26"), "缺核实日");
  assert.ok(bar.includes("https://www.federalregister.gov"), "缺原文链接");
  assert.equal(timelineOf(true, NOW_NEW), "", "还有新事件时就出时间轴了");
});
check("过了 14 天：首屏不亮，收进时间轴一行（日期 + 一句 + 链接）", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  assert.equal(barOf(true, NOW_OLD), "", "过期了首屏还亮着");
  const tl = timelineOf(true, NOW_OLD);
  assert.ok(tl.includes("2026-11-11"), "时间轴缺日期");
  assert.ok(tl.includes("1,970"), "时间轴缺那一句");
  assert.ok(tl.includes("https://www.federalregister.gov"), "时间轴缺出处链接");
  assert.equal((tl.match(/<li>/g) || []).length, 1, "条数不对：" + tl);
});
check("没有任何变化：首屏不出现空文案或占位条", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const keep = graph.events;
  try {
    graph.events = [];
    const whole = sandbox.outlookHtml(true);
    assert.equal(barOf(true, NOW_NEW), "", "没有事件还出了条");
    assert.equal(timelineOf(true, NOW_NEW), "", "没有事件还出了时间轴");
    assert.ok(!whole.includes("outlookOneThing"), "页面里还留着空壳");
    assert.ok(!/今日无|暂无变化|没有新变化/.test(whole), "出现了「暂无变化」这类占位文案");
  } finally {
    graph.events = keep;
  }
});
check("落不到他某一格就不上页面：没填记分的人既不见条也不见时间轴", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const keepProfile = sandbox.procProfileLoad;
  sandbox.procProfileLoad = () => ({});
  try {
    assert.equal(barOf(true, NOW_NEW), "", "这一格不在他身上，却亮了");
    assert.equal(timelineOf(true, NOW_NEW), "", "这一格不在他身上，却进了时间轴");
  } finally {
    sandbox.procProfileLoad = keepProfile;
  }
});
check("首屏最多两条，多出来的进时间轴；时间轴最多 5 条、更早的折叠", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const keep = graph.events;
  const mk = (id, day) => Object.assign({}, keep[0], { id, announced: "2026-11-" + String(day).padStart(2, "0") });
  try {
    graph.events = [mk("e1", 15), mk("e2", 14), mk("e3", 13), mk("e4", 12), mk("e5", 11), mk("e6", 10), mk("e7", 9), mk("e8", 8)];
    const bar = barOf(true, NOW_NEW);
    assert.equal((bar.match(/one-badge/g) || []).length, 2, "首屏不是两条：" + bar);
    const tl = timelineOf(true, NOW_NEW);
    assert.ok(tl.includes("政策变化时间轴（6 条）"), "时间轴条数不对：" + tl.slice(0, 160));
    const visible = tl.slice(0, tl.indexOf("更早的"));
    assert.equal((visible.match(/<li>/g) || []).length, 5, "可见的不是 5 条");
    assert.ok(tl.includes("更早的 1 条"), "更早的没折叠");
  } finally {
    graph.events = keep;
  }
});
check("只从规则图取值：改图里的新值，标题跟着变", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const before = barOf(true, NOW_NEW);
  const keep = graph.events[0].after;
  try {
    graph.events[0].after = 2050;
    const after = barOf(true, NOW_NEW);
    assert.notEqual(after, before, "改图后没变，说明没读图");
    assert.ok(after.includes("2,050"), "没显示改后的值：" + after);
  } finally {
    graph.events[0].after = keep;
  }
  assert.equal(barOf(true, NOW_NEW), before, "恢复图后没回来");
});
check("免费态不亮这条（不给金额），页面也没有 $ 金额", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  assert.equal(barOf(false, NOW_NEW), "", "免费态亮了政策条");
  assert.equal(timelineOf(false, NOW_NEW), "", "免费态出了时间轴");
});
check("事件条三语：无 undefined / null，en/es 无中文", () => {
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state()));
  const cjk = /[\u4e00-\u9fff]/;
  for (const lang of ["zh", "en", "es"]) {
    sandbox.LANG = lang;
    const bar = barOf(true, NOW_NEW) + timelineOf(true, NOW_OLD);
    assert.ok(bar.length > 0, lang + " 没出内容");
    assert.ok(!/undefined|null|NaN/.test(bar), lang + " 出现空值：" + bar);
    if (lang !== "zh") assert.ok(!cjk.test(bar), lang + " 出现中文：" + bar);
  }
  sandbox.LANG = "zh";
});

// ---- 输出 ----
let bad = 0;
for (const [tag, msg] of results) {
  if (tag !== "ok  ") bad++;
  console.log(tag, msg);
}
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);