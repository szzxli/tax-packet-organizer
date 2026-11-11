// 交通与通勤四条规则：必须列出「不能抵」的那一半，且三语都不回落、不写里程费率数字。
// 运行：node tools/test_commute_rules.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../formal.html", import.meta.url), "utf8");
const start = html.indexOf("// 交通与通勤：员工与自雇两套规则");
const end = html.indexOf("function renderWarnings(");
assert.ok(start > 0 && end > start, "找不到 renderCommuteRules");

function render(lang) {
  let box = { innerHTML: "" };
  const sandbox = {
    LANG: lang,
    esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    tr: (zh, en, es) => (lang === "en" ? en : lang === "es" ? es : zh),
    $: () => box,
  };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end), sandbox);
  sandbox.renderCommuteRules();
  return box.innerHTML.replace(/<[^>]+>/g, " ");
}

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${String(detail).slice(0, 100)}]` : ""));
};

const zh = render("zh");
check("四条规则都在", (zh.match(/[✓✕]/g) || []).length === 4, (zh.match(/[✓✕]/g) || []).join(""));
check("明确写通勤不能抵", zh.includes("不能抵") && zh.includes("固定工作地点"));
check("一天两处工作地点可抵", zh.includes("两处工作地点") && zh.includes("能抵"));
check("自雇用车可抵但要里程记录", zh.includes("自雇业务用车") && zh.includes("里程记录"));
check("W-2 未报销费用 2026 仍不能抵", zh.includes("2026 税年") && zh.includes("§67(h)"));
check("带官方出处与核实日期", zh.includes("Pub. 463") && zh.includes("2026-11-11"));
check("不写里程费率数字", !/[¢$]\s?\d/.test(zh), zh.slice(0, 60));

const en = render("en");
const es = render("es");
check("英文无中文残留", !/[\u4e00-\u9fa5]/.test(en), en.slice(0, 60));
check("西语无中文残留", !/[\u4e00-\u9fa5]/.test(es), es.slice(0, 60));
check("英文含不可抵与可抵两侧", /not deductible/i.test(en) && /deductible/i.test(en));
check("西语含 no deducible 与 deducible", /no deducible/i.test(es) && /deducible/i.test(es));

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);