#!/usr/bin/env node
// 验收：订阅页四张规划卡的文案与需求说明书第四节逐字一致，且空输入不出数、未领季票只出引导。
// 直接抽取 formal.html 里的 PLAN_CARDS_LOGIC 块执行，测的就是上线的那份代码。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");

const start = html.indexOf("// PLAN_CARDS_LOGIC_START");
const end = html.indexOf("// PLAN_CARDS_LOGIC_END");
assert.ok(start > 0 && end > start, "PLAN_CARDS_LOGIC 块存在");

const sandbox = {
  LANG: "zh",
  packet: null,
  esc: (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  console,
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end), sandbox, { filename: "plan-cards.js" });

const C1_MFJ_22 = "你的应税收入落在 22% 档（2026 年 · 已婚合并申报，$100,800–$211,400）。退到 12% 档的分界线是 $100,800，跨进 24% 档的分界线是 $211,400。这里只标档位和分界线，不是建议你调整缴款，也不算税额。";
const C2 = "报税要用 Form 8962 和你的保费补贴对账；收入或家庭人数一变，补贴就要重新核。具体补多少、退多少，请用官方估算器或让会计师确认——本页不估算补贴。";
const C3_401 = "401(k)：你录了 $10,000，2026 年上限 $24,500（50 岁以上含补缴 $32,500；60–63 岁 $35,750）。还差 $14,500 没缴满。";
const C3_IRA = "IRA：你录了 $3,000，上限 $7,500（50 岁以上 $8,600）。还差 $4,500 没缴满。";
const C3_CREDIT = "按你的收入和报税身份，你可能符合储户抵免。";
const C4_POLICY = "Saver's Match：2027 年起，往退休账户存钱，联邦最高按 50% 配比，每人每年最多 $1,000，钱直接进你的账户。";
const C4_WHO = "单身满额到 $20,500，$35,500 及以上就没有；夫妻合并申报满额到 $41,000，$71,000 及以上就没有。两者之间是部分配比。条件是年末满 18 岁、不是全日制在读学生、不是被抚养人、美国税务居民。";
const C4_TODO = "2027 年真的存进去才算，2028 年报税用 Form 8880-A 申请；不存就没有，不能补。";
const C1_LABEL = "应税收入（1040 上 “Taxable income” 那一行，通常在 15 行左右）";

const empty = { status: "", income: "", marketplace: false, changed: "", k401: "", ira: "", agi: "" };
const state = (o) => Object.assign({}, empty, o);

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     " + e.message); }
}

check("卡 1：已婚合并申报 $150,000 与说明书逐字一致", () => {
  assert.equal(sandbox.planTierText("mfj", 150000), C1_MFJ_22);
});

check("卡 1：单身 $60,000 落在 22% 档，上下分界线正确", () => {
  const s = sandbox.planTierText("single", 60000);
  assert.ok(s.includes("落在 22% 档（2026 年 · 单身，$50,400–$105,700）"), s);
  assert.ok(s.includes("退到 12% 档的分界线是 $50,400"), s);
  assert.ok(s.includes("跨进 24% 档的分界线是 $105,700"), s);
});

check("卡 1：最高档不编造上界", () => {
  const s = sandbox.planTierText("mfj", 800000);
  assert.ok(s.includes("37% 档"), s);
  assert.ok(s.includes("以上是最高档"), s);
  assert.ok(!s.includes("跨进 37%"), s);
});

check("卡 1：最低档不编造下界", () => {
  const s = sandbox.planTierText("single", 5000);
  assert.ok(s.includes("10% 档"), s);
  assert.ok(s.includes("这是最低档"), s);
  assert.ok(!s.includes("退到"), s);
});

check("卡 1：空收入不出档位、不出数字", () => {
  const out = sandbox.plan1Result(state({ status: "mfj" }));
  const text = out.replace(/<[^>]+>/g, "");
  assert.ok(!/\d/.test(text), out);
  assert.ok(!out.includes("$") && !out.includes("%") && !out.includes("落在"), out);
  assert.ok(out.includes("空着不猜"), out);
});

check("卡 1：没选身份也不出数", () => {
  const out = sandbox.plan1Result(state({ income: "150000" }));
  assert.ok(!out.includes("$"), out);
  assert.ok(!out.includes("%"), out);
  assert.ok(!out.includes("落在"), out);
});

check("卡 2：未触发只出引导，不出现 8962", () => {
  const out = sandbox.plan2Result(state({}));
  assert.ok(!out.includes("8962"), out);
  assert.ok(out.includes("1095-A"), out);
});

check("卡 2：勾选 Marketplace 后与说明书逐字一致", () => {
  const out = sandbox.plan2Result(state({ marketplace: true }));
  assert.ok(out.includes(C2), out);
});

check("卡 2：清单里的 1095-A 也能触发（两条互补）", () => {
  sandbox.packet = { checklist: [{ form: "1095-A", title: "今年 1095-A" }] };
  try {
    const out = sandbox.plan2Result(state({}));
    assert.ok(out.includes(C2), out);
    assert.ok(out.includes("你的清单里已有 1095-A"), out);
  } finally { sandbox.packet = null; }
});

check("卡 2：选“变了”加重，选“不确定”不加重", () => {
  const bold = sandbox.plan2Result(state({ marketplace: true, changed: "changed" }));
  const unsure = sandbox.plan2Result(state({ marketplace: true, changed: "unsure" }));
  assert.ok(bold.includes("notice warn") && bold.includes("<b>" + C2 + "</b>"), bold);
  assert.ok(!unsure.includes("notice warn"), unsure);
  assert.ok(unsure.includes(C2), unsure);
});

check("卡 3：401(k) 与 IRA 缺口分开写，与说明书逐字一致", () => {
  const out = sandbox.plan3Result(state({ k401: "10000", ira: "3000" }));
  assert.ok(out.includes(C3_401), out);
  assert.ok(out.includes(C3_IRA), out);
});

check("卡 3：只填 401(k) 时只出 401(k)，不替 IRA 编数", () => {
  const out = sandbox.plan3Result(state({ k401: "10000" }));
  assert.ok(out.includes(C3_401), out);
  assert.ok(!out.includes("IRA"), out);
});

check("卡 3：缴满写“已缴满”，不出现负数缺口", () => {
  const out = sandbox.plan3Result(state({ k401: "24500", ira: "8000" }));
  assert.ok(!out.includes("-"), out);
  assert.ok(out.includes("已缴满，没有缺口。"), out);
});

check("卡 3：抵免句只在填了 AGI 且选了报税身份时出现", () => {
  const noAgi = sandbox.plan3Result(state({ k401: "10000", status: "mfj" }));
  const agiNoStatus = sandbox.plan3Result(state({ k401: "10000", agi: "120000" }));
  const both = sandbox.plan3Result(state({ k401: "10000", agi: "120000", status: "mfj" }));
  assert.ok(!noAgi.includes("储户抵免"), noAgi);
  assert.ok(!agiNoStatus.includes("储户抵免"), agiNoStatus);
  assert.ok(both.includes(C3_CREDIT), both);
});

check("卡 3：应税收入绝不被当成 AGI 用（硬约束）", () => {
  const out = sandbox.plan3Result(state({ income: "120000", k401: "10000", status: "mfj" }));
  assert.ok(!out.includes("储户抵免"), out);
});

check("卡 3：空输入不出数", () => {
  const out = sandbox.plan3Result(state({}));
  assert.ok(!out.includes("$"), out);
  assert.ok(out.includes("先填 401(k) 或 IRA"), out);
});

check("卡 4：三列文案与说明书逐字一致", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  assert.ok(out.includes(C4_POLICY), "缺 政策 一列");
  assert.ok(out.includes(C4_WHO), "缺 谁受影响 一列");
  assert.ok(out.includes(C4_TODO), "缺 现在要做什么 一列");
  assert.ok(out.includes("<th>政策</th>") && out.includes("<th>谁受影响</th>") && out.includes("<th>现在要做什么</th>"), "列名不对");
});

check("卡 1：输入框标签与说明书逐字一致", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  assert.ok(out.includes(C1_LABEL), "输入框标签不一致");
});

check("未领季票：四张卡只出引导，没有任何输入框", () => {
  const out = sandbox.planCardsHtml(state({}), false);
  assert.ok(!out.includes("<input"), "引导态不应有输入框");
  assert.ok(out.includes("btnPlanClaim"), "缺领取按钮");
  assert.ok(out.includes("领取免费季票，解锁四张卡"), "缺领取文案");
  assert.equal((out.match(/class='plan-tag'/g) || []).length, 4, "应仍是四张卡");
});

check("未领季票：引导里明确免费整理与导出不受影响", () => {
  const out = sandbox.planCardsHtml(state({}), false);
  assert.ok(out.includes("免费整理与导出不受影响"), out);
});

check("已领季票：输入可用，且写明数据只存本机", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  for (const id of ["planStatus", "planIncome", "planMarket", "plan401", "planIra", "planAgi"]) {
    assert.ok(out.includes("id='" + id + "'"), "缺输入 " + id);
  }
  assert.ok(out.includes("只存在这台电脑的浏览器里"), "缺本地存储说明");
});

check("不出现算税额、退税额、调缴款建议", () => {
  const all = [
    sandbox.planCardsHtml(state({}), true),
    sandbox.plan1Result(state({ status: "mfj", income: "150000" })),
    sandbox.plan2Result(state({ marketplace: true })),
    sandbox.plan3Result(state({ k401: "10000", ira: "3000", agi: "120000", status: "mfj" })),
  ].join("\n");
  for (const bad of ["你的税率是", "税额约", "退税金额", "多缴", "建议你调整缴款到"]) {
    assert.ok(!all.includes(bad), "出现禁止表述：" + bad);
  }
});

check("页面级：单列“免费整理与导出永久免费”", () => {
  assert.ok(html.includes("<p class=\"notice ok\"><b>免费整理与导出永久免费</b></p>"), "缺单列一行");
});

check("页面级：季票口径改为“四张卡 + 总核对”，旧的“只做两件事”已删", () => {
  assert.ok(html.includes("<h3>季票给你四张卡，加上交付前总核对</h3>"), "缺新口径");
  assert.ok(!html.includes("<h3>季票只做两件事</h3>"), "旧口径仍在页面上");
});

check("页面级：总核对标注“现在就能出结果”", () => {
  assert.ok(html.includes("<b>交付前总核对 · 现在就能出结果</b>"), "缺“现在就能出结果”");
});

check("i18n：新增静态文案均有英文与西语", () => {
  const i18nStart = html.indexOf("var I18N=");
  const i18nEnd = html.indexOf("Object.assign(I18N", i18nStart);
  const src = html.slice(i18nStart + "var I18N=".length, i18nEnd).trim().replace(/;$/, "");
  const i18n = vm.runInNewContext("(" + src + ")", {});
  const keys = [
    "免费整理与导出永久免费",
    "季票给你四张卡，加上交付前总核对",
    "交付前总核对 · 现在就能出结果",
    "四张规划卡（税档 / 补贴 / 退休 / 政策）",
    "基础整理和导出永久免费；季票先给你四张卡看清位置，再在交付前核一遍，并全年盯住变化。",
    "四张规划卡",
    "税档、补贴、退休、政策；只标结构，不算税。",
    "可交 / 不可交 + 缺项表，可重跑，现在就能出结果。",
  ];
  for (const k of keys) {
    assert.ok(i18n[k] && i18n[k].en && i18n[k].es, "缺翻译：" + k);
  }
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);