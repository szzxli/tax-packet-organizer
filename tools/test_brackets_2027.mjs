// 2027 税档（rules/graph.json 的 brackets_2027）：逐条等于 IRS Rev. Proc. 2026-35 §3.01。
// 运行：node tools/test_brackets_2027.mjs
import { readFileSync } from "node:fs";

const graph = JSON.parse(readFileSync(new URL("../rules/graph.json", import.meta.url), "utf8"));
const html = readFileSync(new URL("../formal.html", import.meta.url), "utf8");

// 原文：irs.gov/pub/irs-drop/rp-26-35.pdf（2026-11-05 发布，2026-11-11 核对）
const OFFICIAL = {
  mfj: [[25600, 10], [104050, 12], [218250, 22], [416650, 24], [529100, 32], [793650, 35], [null, 37]],
  hoh: [[18250, 10], [69650, 12], [109100, 22], [208300, 24], [264550, 32], [661350, 35], [null, 37]],
  single: [[12800, 10], [52025, 12], [109125, 22], [208325, 24], [264550, 32], [661375, 35], [null, 37]],
  mfs: [[12800, 10], [52025, 12], [109125, 22], [208325, 24], [264550, 32], [396825, 35], [null, 37]],
};

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${String(detail).slice(0, 110)}]` : ""));
};

const b27 = graph.brackets_2027;
check("图里有 2027 档位块", !!b27, Object.keys(b27 || {}).length + " keys");
check("生效税年 2027", b27.effective_tax_year === 2027, String(b27.effective_tax_year));
check("出处是 Rev. Proc. 2026-35", b27.source === "Rev. Proc. 2026-35", b27.source);
check("带原文链接与核实日", /rp-26-35\.pdf$/.test(b27.source_url) && b27.checked === "2026-11-11", `${b27.source_url} · ${b27.checked}`);

for (const st of ["single", "mfj", "mfs", "hoh"]) {
  const want = OFFICIAL[st], got = b27[st] || [];
  const ok = got.length === want.length && want.every((r, i) => got[i][0] === r[0] && got[i][1] === r[1]);
  check(`2027 ${st} 七档阈值与税率`, ok, ok ? want.map((r) => r[0]).join("/") : JSON.stringify(got));
}

// 当年的 2026 表不能被顺手改掉
const b26 = graph.brackets;
check("2026 表仍在、生效税年 2026", b26 && b26.effective_tax_year === 2026);
check("2026 单身顶档起点 640,600", b26.single[5][0] === 640600, String(b26.single[5][0]));
check("2026 合并顶档起点 768,700", b26.mfj[5][0] === 768700, String(b26.mfj[5][0]));

// 页面不内置档位数字：只读图
check("页面里没有内置 2026 顶档数字", !html.includes("640600") && !html.includes("768700"));
check("planBrackets 从图读", /function planBrackets\(status\)\{[\s\S]{0,400}?\.brackets/.test(html));

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);