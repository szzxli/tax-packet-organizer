#!/usr/bin/env node
// 验收：订阅页三张规划卡（补贴免费）+ 交接口径单，文案与 11-09 定稿一致。
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
const C2 = "报税要用 Form 8962 和你的保费补贴对账；收入或家庭人数一变，补贴就要重新核。";
const C2_UP = "收入比买保险时报的高了，预付款就领多了。2026 税年起，多领的补贴没有退还上限，全额退回来。";
const C2_SIZE = "家里人数和买保险时报的不一样。补贴是按人数算的，人数报得比实际多，多出来的那部分报税时要退。";
const C2_SAME = "两个都没变，也可能差一点：预付款是按当时的估计发的，报税按实际收入算，差多少补多少。";
const C3_401 = "401(k)：你录了 $10,000，2026 年上限 $24,500（50 岁以上含补缴 $32,500；60–63 岁 $35,750）。还差 $14,500 没缴满。";
const C3_IRA = "IRA：你录了 $3,000，上限 $7,500（50 岁以上 $8,600）。还差 $4,500 没缴满。";
const C3_CREDIT = "按你的收入和报税身份，你可能符合储户抵免。";
const C4_POLICY = "Saver's Match：2027 年起，往退休账户存钱，联邦最高按 50% 配比，每人每年最多 $1,000，钱直接进你的账户。";
const C4_WHO = "单身满额到 $20,500，$35,500 及以上就没有；夫妻合并申报满额到 $41,000，$71,000 及以上就没有。两者之间是部分配比。条件是年末满 18 岁、不是全日制在读学生、不是被抚养人、美国税务居民。";
const C4_TODO = "2027 年真的存进去才算，报 2027 年那张表时申请；不存就没有，不能补。";   // 不点表号：IRS 到 2026-11-10 未公布

const LABEL_C1 = "去年 1040 的 Taxable income（应税收入，第 15 行左右）";
const HELP_C1 = "这是去年的位置，用来定今年的方向。今年收入变动大，按你估的数填。";
const LABEL_401 = "今年 401(k) 缴了多少";
const LABEL_IRA = "今年 IRA 缴了多少";
const LABEL_AGI = "去年 1040 的 AGI（第 11 行左右）";
const HELP_AGI = "去年的数，用来判断抵免方向。";
const NOTE_C4 = "打印这一页给会计。你交了什么、还缺什么，纸上都写着——他替你出面的时候，手里有东西。";
const HANDOFF_IRS = "IRS 问起来的时候，这张纸就是当时的交接记录，不用各说各话。";
const BTN_PRINT = "生成交接口径单（打印 / 存 PDF）";

const empty = { status: "", income: "", marketplace: false, chgUp: false, chgSize: false, chgSame: false, chgUnsure: false, household: "", k401: "", ira: "", agi: "" };
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

check("卡 1：输入标签逐字为「去年 1040 的 Taxable income」，下方有常显辅助句", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  assert.ok(out.includes(LABEL_C1), "输入框标签不一致");
  assert.ok(out.includes(HELP_C1), "缺卡 1 辅助句");
  assert.ok(!out.includes('placeholder="' + HELP_C1), "辅助句不能放进 placeholder");
});

check("卡 2：未触发只出引导，不出现 8962", () => {
  const out = sandbox.plan2Result(state({}));
  assert.ok(!out.includes("8962"), out);
  assert.ok(out.includes("1095-A"), out);
});

check("卡 2：三个选项各点一次，各出对应一句", () => {
  const up = sandbox.plan2Result(state({ marketplace: true, chgUp: true }));
  const size = sandbox.plan2Result(state({ marketplace: true, chgSize: true }));
  const same = sandbox.plan2Result(state({ marketplace: true, chgSame: true }));
  assert.ok(up.includes(C2_UP), up);
  assert.ok(size.includes(C2_SIZE), size);
  assert.ok(same.includes(C2_SAME), same);
  assert.ok(!up.includes(C2_SIZE) && !up.includes(C2_SAME), up);
  assert.ok(!size.includes(C2_UP) && !size.includes(C2_SAME), size);
  assert.ok(!same.includes(C2_UP) && !same.includes(C2_SIZE), same);
});

check("卡 2：收入与人数同时选，两句并排都在，不合并", () => {
  const both = sandbox.plan2Result(state({ marketplace: true, chgUp: true, chgSize: true }));
  assert.ok(both.includes(C2_UP), both);
  assert.ok(both.includes(C2_SIZE), both);
  assert.equal((both.match(/class='notice warn'/g) || []).length, 2, both);
});

check("卡 2：不确定回到原通用句，不加重", () => {
  const out = sandbox.plan2Result(state({ marketplace: true, chgUnsure: true }));
  assert.ok(out.includes(C2), out);
  assert.ok(!out.includes("notice warn"), out);
  assert.ok(!out.includes(C2_UP) && !out.includes(C2_SIZE) && !out.includes(C2_SAME), out);
});

check("卡 2：什么都不选时出通用句（不猜）", () => {
  const out = sandbox.plan2Result(state({ marketplace: true }));
  assert.ok(out.includes(C2), out);
});

check("卡 2：四句里没有金额、没有 400%、没有「不用对账」", () => {
  const all = [C2, C2_UP, C2_SIZE, C2_SAME].join("\n");
  assert.ok(!/\$|\d+\s*美元|金额/.test(all), "出现金额：" + all);
  assert.ok(!all.includes("400%"), "出现 400%");
  assert.ok(!all.includes("不用对账"), "出现「不用对账」");
  const outs = [
    sandbox.plan2Result(state({ marketplace: true, chgUp: true })),
    sandbox.plan2Result(state({ marketplace: true, chgSize: true })),
    sandbox.plan2Result(state({ marketplace: true, chgSame: true })),
    sandbox.plan2Result(state({ marketplace: true, chgUnsure: true })),
  ].join("\n");
  assert.ok(!outs.includes("400%"), "输出出现 400%");
  assert.ok(!outs.includes("不用对账"), "输出出现「不用对账」");
  assert.ok(!/\$\d/.test(outs), "输出出现金额");
});

check("卡 2：清单里的 1095-A 也能触发（两条互补）", () => {
  sandbox.packet = { checklist: [{ form: "1095-A", title: "今年 1095-A" }] };
  try {
    const out = sandbox.plan2Result(state({ chgUp: true }));
    assert.ok(out.includes(C2_UP), out);
    assert.ok(out.includes("你的清单里已有 1095-A"), out);
  } finally { sandbox.packet = null; }
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

check("卡 3：三个标签带年份，AGI 下方有常显辅助句", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  for (const s of [LABEL_401, LABEL_IRA, LABEL_AGI, HELP_AGI]) assert.ok(out.includes(s), "缺 " + s);
});

check("卡 4：三列文案与说明书逐字一致", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  assert.ok(out.includes(C4_POLICY), "缺 政策 一列");
  assert.ok(out.includes(C4_WHO), "缺 谁受影响 一列");
  assert.ok(out.includes(C4_TODO), "缺 现在要做什么 一列");
  assert.ok(out.includes("<th>政策</th>") && out.includes("<th>谁受影响</th>") && out.includes("<th>现在要做什么</th>"), "列名不对");
});

check("卡 4 下面有新的会计定位句与交接口径单按钮，旧的「少问你三次」已删", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  assert.ok(out.includes(NOTE_C4), out);
  assert.ok(!out.includes("少问你三次"), "旧句仍在：" + out);
  assert.ok(!html.includes("少问你三次"), "旧句仍在文件里");
  assert.ok(out.includes(BTN_PRINT), out);
  assert.ok(out.indexOf(NOTE_C4) > out.indexOf("卡 4 · 今年变了什么"), "提示句应在卡 4 之后");
});

check("未登录：卡 2 有输入与三个选项，卡 1/3/4 只出引导", () => {
  const out = sandbox.planCardsHtml(state({}), false);
  assert.ok(out.includes("id='planMarket'"), "卡 2 勾选应可用");
  assert.ok(out.includes("value='chgUp'") && out.includes("value='chgSize'") && out.includes("value='chgSame'") && out.includes("value='chgUnsure'"), "卡 2 三选项应可见");
  assert.ok(out.includes("id='planHousehold'"), "卡 2 家庭人数应可见");
  assert.ok(!out.includes("id='planStatus'"), "卡 1 保持季票");
  assert.ok(!out.includes("id='plan401'"), "卡 3 保持季票");
  assert.ok(out.includes("btnPlanClaim"), "缺领取按钮");
  assert.equal((out.match(/class='plan-tag'/g) || []).length, 4, "页面上仍是四张卡（补贴一张免费）");
  assert.equal((out.match(/class='plan-lock'/g) || []).length, 3, "应只锁三张");
});

check("未登录：卡 1 / 卡 3 锁定态给预告句（只说填什么，不给结论）", () => {
  const out = sandbox.planCardsHtml(state({}), false);
  assert.ok(out.includes("要一行数：去年 1040 上的应税收入（第 15 行左右）。领票后在这里填，当场出结论。"), "卡 1 预告句缺失");
  assert.ok(out.includes("要三行：今年的 401(k)、今年的 IRA、去年 1040 的 AGI（第 11 行左右）。领票后在这里填。"), "卡 3 预告句缺失");
  assert.ok(out.includes("领取后在这里填写。"), "卡 4 应保留通用锁句");
  for (const leak of ["% 档", "分界线是", "还差 $", "储户抵免", "多领的补贴"]) {
    assert.ok(!out.includes(leak), "锁定态泄露结论：" + leak);
  }
});

check("未登录：卡 1 / 卡 3 预告句有英文与西语", () => {
  const en = (() => { sandbox.LANG = "en"; const v = sandbox.planCardsHtml(state({}), false); sandbox.LANG = "zh"; return v; })();
  assert.ok(en.includes("One number: last year's taxable income on Form 1040"), en.slice(0, 0));
  assert.ok(en.includes("Three lines: this year's 401(k)"), "卡 3 英文缺失");
  assert.ok(!/[\u4e00-\u9fa5]/.test(en.replace(/卡 [1-4] · |你的位置|补贴会不会变|退休账户|今年变了什么/g, "")), "英文态仍夹中文");
});

check("未登录：卡 2 直接出结论（不拦结论）", () => {
  const out = sandbox.plan2Result(state({ marketplace: true, chgUp: true }));
  assert.ok(out.includes(C2_UP), out);
});

check("已领季票：全部输入可用，且写明数据只存本机", () => {
  const out = sandbox.planCardsHtml(state({}), true);
  for (const id of ["planStatus", "planIncome", "planMarket", "planHousehold", "plan401", "planIra", "planAgi"]) {
    assert.ok(out.includes("id='" + id + "'"), "缺输入 " + id);
  }
  assert.ok(out.includes("只存在这台电脑的浏览器里"), "缺本地存储说明");
});

check("交接口径单：第一行是标题「交接口径单」", () => {
  const out = sandbox.planHandoffHtml(state({}));
  assert.ok(out.startsWith("<h1>交接口径单</h1>"), out.slice(0, 80));
});

check("交接口径单：去年/今年两栏分列，家庭人数在今年的数", () => {
  const out = sandbox.planHandoffHtml(state({ income: "150000", agi: "120000", k401: "10000", ira: "3000", household: "3", status: "mfj", marketplace: true, chgSame: true }));
  assert.ok(out.includes("去年的数") && out.includes("今年的数"), out);
  assert.ok(out.includes("$150,000") && out.includes("$120,000"), out);
  assert.ok(out.includes("$10,000") && out.includes("$3,000"), out);
  assert.ok(out.includes("家庭人数：3"), out);
});

check("交接口径单：每张卡一行结论", () => {
  const out = sandbox.planHandoffHtml(state({ income: "150000", status: "mfj", k401: "10000", marketplace: true, chgUp: true }));
  for (const s of ["卡 1 · 位置（税档）", "卡 2 · 补贴要不要重新核", "卡 3 · 退休还差多少", "卡 4 · 今年新规"]) {
    assert.ok(out.includes(s), "缺 " + s);
  }
  assert.ok(out.includes("落在 22% 档"), out);
  assert.ok(out.includes("全额退"), out);
  assert.ok(out.includes("还差 $14,500"), out);
  assert.ok(out.includes("Saver's Match"), out);
});

check("交接口径单：空输入写「未填」，不编数", () => {
  const out = sandbox.planHandoffHtml(state({}));
  assert.ok(out.includes("未填"), out);
  const figures = out.slice(out.indexOf("我填的数"), out.indexOf("每张卡一行结论"));
  assert.ok(!/\$\d/.test(figures), "空输入不应出现金额：" + figures);
});

check("交接口径单：三行横线 + 「下面留给会计写」+ IRS 交接记录句", () => {
  const out = sandbox.planHandoffHtml(state({}));
  assert.ok(out.includes("下面留给会计写"), out);
  assert.ok(out.includes(HANDOFF_IRS), "缺 IRS 交接记录句");
  assert.ok(out.indexOf(HANDOFF_IRS) < out.indexOf("下面留给会计写"), "该句应在线之上");
  for (const bad of ["免责", "我们担责", "审核通过", "保证", "不承担"]) {
    assert.ok(!out.includes(bad), "出现不该有的表述：" + bad);
  }
  assert.equal((out.match(/class='handoff-line'/g) || []).length, 3, "应有三行横线");
});

check("交接口径单：页脚只留前两句（删「不构成建议」）+ 新域落款，无老域", () => {
  const out = sandbox.planHandoffHtml(state({}));
  assert.ok(out.includes("按 2026 税年口径 · 只标结构，不算税、不判资格"), out);
  assert.ok(!out.includes("不构成建议"), "打印页不应再出现「不构成建议」：" + out);
  for (const banned of ["免责", "我们担责", "审核通过"]) {
    assert.ok(!out.includes(banned), "打印页出现不该有的表述：" + banned);
  }
  assert.ok(out.includes("https://tax.ucplan.org/"), out);
  assert.ok(!out.includes("szzxli.github.io"), out);
  assert.ok(!html.includes("szzxli.github.io"), "formal.html 不应出现老域 szzxli.github.io");
});

check("不出现算税额、退税额、调缴款建议", () => {
  const all = [
    sandbox.planCardsHtml(state({}), true),
    sandbox.planHandoffHtml(state({ income: "150000", status: "mfj", k401: "10000", agi: "120000", marketplace: true, chgUp: true })),
    sandbox.plan1Result(state({ status: "mfj", income: "150000" })),
    sandbox.plan2Result(state({ marketplace: true, chgUp: true })),
    sandbox.plan3Result(state({ k401: "10000", ira: "3000", agi: "120000", status: "mfj" })),
  ].join("\n");
  for (const bad of ["你的税率是", "税额约", "退税金额", "多缴", "建议你调整缴款到", "最低价", "全网最便宜"]) {
    assert.ok(!all.includes(bad), "出现禁止表述：" + bad);
  }
});

check("页面级：网页侧的边界句仍是完整三句，一个字没动", () => {
  assert.ok(html.includes("只标结构，不算税、不判资格、不构成建议。"), "网页侧边界句被改动");
  const webBoundary = "只标结构，不算税、不判资格、不构成建议。";
  assert.ok(html.split(webBoundary).length - 1 >= 1, "网页侧卡 1 边界句应保留完整三句");
});

check("页面级：单列“免费整理与导出永久免费”", () => {
  assert.ok(html.includes("<p class=\"notice ok\"><b>免费整理与导出永久免费</b></p>"), "缺单列一行");
});

check("页面级：季票口径统一为“三张规划卡 + 两件事”，旧口径已删", () => {
  assert.ok(html.includes("<h3>季票给三张规划卡，再做两件事</h3>"), "缺新口径");
  for (const old of ["<h3>季票只做两件事</h3>", "<h3>季票只做三件事</h3>", "四张", "全包核对", "自动提醒未接", "影响你的清单时通知你"]) {
    assert.ok(!html.includes(old), "旧口径仍在页面上：" + old);
  }
  assert.ok(html.split("三张规划卡").length - 1 >= 3, "“三张规划卡”出现次数不足");
  assert.ok(html.split("目前只在本页展示").length - 1 >= 6, "“目前只在本页展示”出现次数不足");
});

check("页面级：总核对标注“现在就能出结果”", () => {
  assert.ok(html.includes("<b>交付前总核对 · 现在就能出结果</b>"), "缺“现在就能出结果”");
});

check("页面级：对比表里补贴卡免费、其余三张仍在季票", () => {
  assert.ok(html.includes("<tr><td>规划卡：补贴（1095-A / 8962）</td><td>✓</td><td>✓</td></tr>"), "补贴行不对");
  assert.ok(html.includes("<tr><td>规划卡：税档 / 退休 / 政策</td><td>—</td><td>季票</td></tr>"), "其余三张行不对");
});

check("i18n：新增静态文案均有英文与西语", () => {
  const i18nStart = html.indexOf("var I18N=");
  const i18nEnd = html.indexOf("Object.assign(I18N", i18nStart);
  const src = html.slice(i18nStart + "var I18N=".length, i18nEnd).trim().replace(/;$/, "");
  const i18n = vm.runInNewContext("(" + src + ")", {});
  const keys = [
    "免费整理与导出永久免费",
    "季票给三张规划卡，再做两件事",
    "交付前总核对 · 现在就能出结果",
    "规划卡：补贴（1095-A / 8962）",
    "规划卡：税档 / 退休 / 政策",
    "基础整理和导出永久免费；季票多给三张规划卡看清位置，交付前把整包核一遍，全年把时点盯住。",
    "三张规划卡",
    "税档、退休、政策；只标结构，不算税。医保补贴那张卡所有人都能用，不用领季票。",
    "可交 / 不可交 + 缺项表，可重跑，现在就能出结果。",
  ];
  for (const k of keys) {
    assert.ok(i18n[k] && i18n[k].en && i18n[k].es, "缺翻译：" + k);
  }
});

check("三语：卡 2 三个选项与三个辅助句都有英文与西语", () => {
  for (const lang of ["en", "es"]) {
    sandbox.LANG = lang;
    const cards = sandbox.planCardsHtml(state({}), true);
    assert.ok(cards.includes("chgUp") && cards.includes("chgSize") && cards.includes("chgSame") && cards.includes("chgUnsure"), lang + " 缺选项");
    assert.ok(cards.includes("Income went up") || cards.includes("Los ingresos subieron"), lang + " 选项未翻译");
    const up = sandbox.plan2Result(state({ marketplace: true, chgUp: true }));
    assert.ok(!/[\u4e00-\u9fa5]/.test(up), lang + " 卡 2 结论夹中文：" + up);
    const sheet = sandbox.planHandoffHtml(state({}));
    assert.ok(sheet.includes("https://tax.ucplan.org/"), lang + " 落款丢网址");
  }
  sandbox.LANG = "zh";
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);