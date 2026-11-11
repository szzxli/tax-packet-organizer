// 2027 税档表断言：值必须逐条等于 IRS Rev. Proc. 2026-35 §3.01 原文。
// 运行：node tools/test_brackets_2027.mjs
// 期望：全部 PASS。任何一条与原文不符即退出码 1。
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../formal.html", import.meta.url), "utf8");

// 原文（irs.gov/pub/irs-drop/rp-26-35.pdf，2026-11-05 发布，2026-11-11 核对）
// 每行 [该档上限, 税率%]；最后一档上限为 Infinity。
const OFFICIAL_2027 = {
  mfj: [[25600, 10], [104050, 12], [218250, 22], [416650, 24], [529100, 32], [793650, 35], [Infinity, 37]],
  hoh: [[18250, 10], [69650, 12], [109100, 22], [208300, 24], [264550, 32], [661350, 35], [Infinity, 37]],
  single: [[12800, 10], [52025, 12], [109125, 22], [208325, 24], [264550, 32], [661375, 35], [Infinity, 37]],
  mfs: [[12800, 10], [52025, 12], [109125, 22], [208325, 24], [264550, 32], [396825, 35], [Infinity, 37]],
};

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${detail}]` : ""));
};

function extract(name) {
  const m = html.match(new RegExp(`var ${name}=\\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`找不到 ${name}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return {${m[1]}};`)();
}

const t2027 = extract("PLAN_BRACKETS_2027");
const t2026 = extract("PLAN_BRACKETS_2026");

for (const status of ["single", "mfj", "mfs", "hoh"]) {
  const want = OFFICIAL_2027[status];
  const got = t2027[status];
  const ok = Array.isArray(got) && got.length === want.length &&
    want.every((row, i) => got[i][0] === row[0] && got[i][1] === row[1]);
  check(`2027 ${status} 七档阈值与税率`, ok, ok ? `${want.map(r => r[0]).join("/")}` : JSON.stringify(got));
}

// 2026 仍须等于 Rev. Proc. 2025-32 的值（单身高档位应以 640,600 结束）
check("2026 single 顶档起点 640,600", t2026.single[5][0] === 640600, String(t2026.single[5][0]));
check("2026 mfj 顶档起点 768,700", t2026.mfj[5][0] === 768700, String(t2026.mfj[5][0]));

// 年份来自单一变量，文案里不再写死
check("PLAN_TAX_YEAR 由日历年决定且有 2026/2027 兜底",
  /var PLAN_TAX_YEAR=Math\.max\(2026,Math\.min\(2027,new Date\(\)\.getFullYear\(\)\)\);/.test(html));
check("按年切换只用一张表", /var PLAN_BRACKETS=PLAN_TAX_YEAR>=2027\?PLAN_BRACKETS_2027:PLAN_BRACKETS_2026;/.test(html));
const c1 = html.match(/var PLAN_C1[^\n]*/g) || [];
check("卡 1 文案里没有写死 2026", c1.every(l => !/2026/.test(l)), `${c1.length} 行`);
check("卡 1 文案用 {y} 占位", c1.filter(l => /\{y\}/.test(l)).length === 9, `${c1.filter(l => /\{y\}/.test(l)).length}/9`);
check("两处计算都读当年表", (html.match(/PLAN_BRACKETS\[status\]/g) || []).length === 2 &&
  (html.match(/PLAN_BRACKETS\.single/g) || []).length === 1);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);