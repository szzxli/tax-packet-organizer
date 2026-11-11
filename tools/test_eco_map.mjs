// 生态地图（季票页顶部）断言：结论/三个数/关键路径/时间卡都在，数字与档位表一致。
// 运行：node tools/test_eco_map.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../formal.html", import.meta.url), "utf8");
const start = html.indexOf("// PLAN_CARDS_LOGIC_START");
const end = html.indexOf("function planCardsHtml(");
assert.ok(start > 0 && end > start, "找不到规划卡逻辑块");

const sandbox = {
  Infinity,
  Math,
  Date,
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  LANG: "zh",
  $: () => null,
  load: () => ({}),
  save: () => {},
  currentUser: "test@example.com",
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end), sandbox);

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${String(detail).slice(0, 120)}]` : ""));
};

const html1 = sandbox.ecoMapHtml({ status: "", income: "" });
check("空输入：请先填两个数", html1.includes("先填两个数"), html1.slice(0, 80));
check("空输入：不出现任何金额", !/\$\d/.test(html1.replace(/<[^>]+>/g, "")), html1.replace(/<[^>]+>/g, "").slice(0, 80));

// 期望值跟着「当年那张表」走，不写死某一年：今天用 2026 表，2027-01-01 起自动用 2027 表。
const activeSingle = sandbox.PLAN_BRACKETS.single;
const firstHi = activeSingle[0][0];

const h2 = sandbox.ecoMapHtml({ status: "single", income: "12000" });
check("12,000 单身：落在第一档", h2.includes(">" + activeSingle[0][1] + "%<"), activeSingle[0][1] + "%");
check(`12,000 单身：离下一档 $${firstHi - 12000}`, h2.includes(sandbox.planMoney(firstHi - 12000)), sandbox.planMoney(firstHi - 12000));
check("贴线：徽章‘就在线边上’", h2.includes("就在线边上"));
check("有关键路径一行", h2.includes("应税收入 → 你所在的这一档"));
check("有时间卡：现在 / 4 月 / 10 月 / 退休后",
  h2.includes(">现在<") && h2.includes("明年 4 月 15 日") && h2.includes("10 月 15 日") && h2.includes("退休后"));
check("有出处与核实日期", h2.includes("Rev. Proc. 2026-35") && h2.includes("2026-11-11"));

const b60 = sandbox.planBracket("single", 60000);
const h3 = sandbox.ecoMapHtml({ status: "single", income: "60000" });
check("60,000 单身：落在 22% 档", b60.rate === 22 && h3.includes("22%"), String(b60.rate));
check(`60,000 单身：到下一档还差 $${b60.hi - 60000}`, h3.includes(sandbox.planMoney(b60.hi - 60000)), sandbox.planMoney(b60.hi - 60000));
check("余量充足：徽章‘余量清楚’", h3.includes("余量清楚"));

const h4 = sandbox.ecoMapHtml({ status: "mfj", income: "1000000" });
check("1,000,000 合并：37% 最高档且无下一条线", h4.includes("37%") && h4.includes("没有下一条线"));

const h5 = sandbox.ecoMapHtml({ status: "single", income: "60000", k401: "10000" });
check("401(k) 10,000：还差 $14,500", h5.includes("401(k) $14,500"), "401(k) $14,500");

// 免费态闸门：函数里必须先判 hasPass()，不能把数字直接端出去
const renderSrc = html.slice(html.indexOf("function renderEcoMap(){"), html.indexOf("function planCardsHtml("));
check("renderEcoMap 先判权益再出数字", renderSrc.indexOf("if(!hasPass())") > 0 && renderSrc.indexOf("if(!hasPass())") < renderSrc.indexOf("ecoMapHtml("));

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);