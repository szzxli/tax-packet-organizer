// 生态地图：结论 / 三个数 / 关键路径 / 时间卡都在；数字只来自 rules/graph.json 与用户输入。
// 运行：node tools/test_eco_map.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../formal.html", import.meta.url), "utf8");
const graph = JSON.parse(readFileSync(new URL("../rules/graph.json", import.meta.url), "utf8"));

const start = html.indexOf("// PLAN_CARDS_LOGIC_START");
const end = html.indexOf("function updatePlanResults(");
assert.ok(start > 0 && end > start, "找不到规划卡与地图的逻辑块");

const sandbox = {
  Infinity, Math, Date,
  RULES: graph,
  mapRules: () => graph,
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  tr: (zh, en, es) => zh,
  LANG: "zh",
  $: () => null,
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end), sandbox);

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${String(detail).slice(0, 110)}]` : ""));
};

const BR = graph.brackets, RET = graph.retirement;

const empty = sandbox.ecoMapHtml({ status: "", income: "" });
check("空输入：先要两个数", empty.includes("先填两个数"), empty.slice(0, 60));
check("空输入：三个数都是破折号", (empty.match(/<b>—<\/b>/g) || []).length === 3);

const b12 = sandbox.planBracket("single", 12000);
const h12 = sandbox.ecoMapHtml({ status: "single", income: "12000" });
check("12,000 单身：落第一档", h12.includes(">" + b12.rate + "%<"), b12.rate + "%");
check("12,000 单身：到下一档的距离与图一致",
  h12.includes(sandbox.planMoney(b12.hi - 12000)), sandbox.planMoney(b12.hi - 12000));
check("贴线（≤2,000）：徽章「就在线边上」", h12.includes("就在线边上"));

const b60 = sandbox.planBracket("single", 60000);
const h60 = sandbox.ecoMapHtml({ status: "single", income: "60000" });
check("60,000 单身：22% 档", b60.rate === 22 && h60.includes("22%"), String(b60.rate));
check("60,000 单身：余量充足徽章", h60.includes("余量清楚"));

const top = sandbox.ecoMapHtml({ status: "mfj", income: "1000000" });
check("1,000,000 合并：最高档且无下一条线", top.includes("37%") && top.includes("没有下一条线"));

const ret = sandbox.ecoMapHtml({ status: "single", income: "60000", k401: "10000" });
check("401(k) 缺口按图里的上限算",
  ret.includes("401(k) " + sandbox.planMoney(RET.k401_limit - 10000)), sandbox.planMoney(RET.k401_limit - 10000));

check("有时间卡：现在 / 4 月 / 10 月 / 退休后",
  h12.includes(">现在<") && h12.includes("明年 4 月 15 日") && h12.includes("10 月 15 日") && h12.includes("退休后"));
check("有关键路径一行", h12.includes("应税收入 → 你所在的这一档"));
check("出处行带两个税年的出处与核实日",
  h12.includes(BR.source) && h12.includes(String(BR.effective_tax_year)) && h12.includes(String(RET.checked)), String(BR.source));

// 图没到就不出这一屏（不留半句）
const noGraph = { ...sandbox, mapRules: () => ({}) };
vm.createContext(noGraph);
vm.runInContext(html.slice(start, end), noGraph);
check("图缺失时地图为空，不内置数字", noGraph.ecoMapHtml({ status: "single", income: "60000" }) === "");

// 免费态闸门：renderEcoMap 必须先判权益
const renderSrc = html.slice(html.indexOf("function renderEcoMap(){"), html.indexOf("function updatePlanResults("));
check("renderEcoMap 先判 hasPass 再出数字",
  renderSrc.indexOf("if(!hasPass())") > 0 && renderSrc.indexOf("if(!hasPass())") < renderSrc.indexOf("ecoMapHtml("));

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);