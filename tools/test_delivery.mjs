#!/usr/bin/env node
// 验收三件交付增强：标准材料清单、导出文件语义化命名、极简入口。
// 直接抽 formal.html 里的真实代码执行（渲染部分用真 Chrome 另测），不重写一份逻辑。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");
const CJK = /[\u4e00-\u9fff]/;

function slice(startMark, endMark) {
  const a0 = html.indexOf(startMark);
  const b = html.indexOf(endMark, a0 + startMark.length);
  assert.ok(a0 >= 0 && b > a0, `抽不到 ${startMark} … ${endMark}`);
  const a = html.indexOf("\n", a0) + 1;
  return html.slice(a, b);
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log("ok   " + name);
  } catch (e) {
    fail++;
    console.log("FAIL " + name + "\n     " + e.message);
  }
}

// ---------- 语义化文件名 ----------
const semBlock = slice("// SEMANTIC_NAME_START", "// SEMANTIC_NAME_END");

function semSandbox(lang, rows) {
  const sb = {
    LANG: lang,
    OUTLOOK_TAX_YEAR: 2026,
    packet: { checklist: rows || [] },
    tr: (zh, en, es) => (lang === "en" ? en : lang === "es" ? es : zh),
    esc: (s) => String(s == null ? "" : s),
    rowTitle: (it) => it.title || it.form,
  };
  vm.createContext(sb);
  vm.runInContext(semBlock, sb);
  return sb;
}

check("W-2 + Employer A + 123.pdf → 2026_W2_EmployerA.pdf", () => {
  const sb = semSandbox("zh");
  assert.equal(sb.semanticFileName({ form: "W-2", payer: "Employer A", fileName: "123.pdf" }), "2026_W2_EmployerA.pdf");
});

check("1099-INT + Bank B + scan_01.jpg → 2026_1099INT_BankB.jpg", () => {
  const sb = semSandbox("zh");
  assert.equal(sb.semanticFileName({ form: "1099-INT", payer: "Bank B", fileName: "scan_01.jpg" }), "2026_1099INT_BankB.jpg");
});

check("Schedule C / Schedule K-1 / 1095-A 的表号写法固定", () => {
  const sb = semSandbox("zh");
  const code = (f) => sb.semanticFileName({ form: f, payer: "Acme", fileName: "x.pdf" });
  assert.equal(code("Schedule C"), "2026_ScheduleC_Acme.pdf");
  assert.equal(code("Schedule K-1"), "2026_ScheduleK1_Acme.pdf");
  assert.equal(code("1095-A"), "2026_1095A_Acme.pdf");
  assert.equal(code("FinCEN 114 (FBAR)"), "2026_FBAR_Acme.pdf");
});

check("中文表名与中文付款方各自有确定写法", () => {
  const sb = semSandbox("zh");
  assert.equal(sb.semanticFileName({ form: "州税", payer: "加州", fileName: "a.pdf" }), "2026_StateTax_加州.pdf");
  assert.equal(sb.semanticFileName({ form: "房产税单", payer: "", fileName: "b.pdf" }), "2026_PropertyTax_NoPayer.pdf");
});

check("拍照件没有扩展名时补 .jpg", () => {
  const sb = semSandbox("zh");
  assert.equal(sb.semanticFileName({ form: "W-2", payer: "Acme", fileName: "IMG_1.jpg（拍照）" }), "2026_W2_Acme.jpg");
});

check("同表同付款方第二份加 _2，名字不重复", () => {
  const rows = [
    { id: "a", form: "W-2", payer: "Employer A", fileName: "123.pdf" },
    { id: "b", form: "W-2", payer: "Employer A", fileName: "456.pdf" },
  ];
  const sb = semSandbox("zh", rows);
  const map = sb.semanticMap();
  assert.equal(JSON.stringify(map.map((r) => r.to)), JSON.stringify(["2026_W2_EmployerA.pdf", "2026_W2_EmployerA_2.pdf"]));
});

check("付款方里的路径符号被清掉，名字落不到别的目录", () => {
  const sb = semSandbox("zh");
  const n = sb.semanticFileName({ form: "W-2", payer: "../../etc/passwd", fileName: "a.pdf" });
  assert.ok(!n.includes("/"), "文件名里还有斜杠：" + n);
  assert.ok(!n.includes(".."), "文件名里还有 ..：" + n);
});

// ---------- 标准材料清单 ----------
const stdBlock = slice("// STD_CHECK_START", "// STD_CHECK_LOGIC_END");

function stdSandbox(lang, rows, ticks) {
  const sb = {
    LANG: lang,
    packet: { checklist: rows || [], stdTicks: ticks || {} },
    tr: (zh, en, es) => (lang === "en" ? en : lang === "es" ? es : zh),
    rowResolved: (it) => it.status === "uploaded" || it.status === "na" || !!it.figure,
  };
  vm.createContext(sb);
  vm.runInContext(stdBlock, sb);
  return sb;
}

check("标准清单覆盖常见需求，id 不重复", () => {
  const sb = stdSandbox("zh");
  assert.ok(sb.STD_ITEMS.length >= 12, "标准项太少：" + sb.STD_ITEMS.length);
  const ids = sb.STD_ITEMS.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, "id 有重复");
  for (const id of ["w2", "interest", "selfemp", "rental", "mortgage", "tuition", "state", "bank"]) {
    assert.ok(ids.includes(id), "少了常见项：" + id);
  }
});

for (const lang of ["en", "es"]) {
  check(`${lang}：标准清单每条标题与理由都没有中文`, () => {
    const sb = stdSandbox(lang);
    for (const item of sb.STD_ITEMS) {
      assert.ok(!CJK.test(sb.stdText(item.label)), `${lang} 标题含中文：${sb.stdText(item.label)}`);
      assert.ok(!CJK.test(sb.stdText(item.why)), `${lang} 理由含中文：${sb.stdText(item.why)}`);
    }
  });
}

check("清单里已传文件的项自动算已备", () => {
  const sb = stdSandbox("zh", [{ form: "W-2", status: "uploaded" }]);
  const w2 = sb.STD_ITEMS.find((x) => x.id === "w2");
  assert.equal(sb.stdDone(w2), true);
  const c = sb.stdCounts();
  assert.equal(c.done, 1);
  assert.equal(c.miss, c.total - 1);
});

check("清单里有这一项但没传文件，仍算缺", () => {
  const sb = stdSandbox("zh", [{ form: "W-2", status: "not-started" }]);
  const w2 = sb.STD_ITEMS.find((x) => x.id === "w2");
  assert.equal(sb.stdDone(w2), false);
});

check("勾选后记为已备，并随包保存（stdTicks）", () => {
  const sb = stdSandbox("zh", [], { id: true, bank: true });
  assert.equal(sb.stdDone(sb.STD_ITEMS.find((x) => x.id === "id")), true);
  assert.equal(sb.stdDone(sb.STD_ITEMS.find((x) => x.id === "bank")), true);
});

check("kind 也能匹配（自雇/房租按收入类型建的行）", () => {
  const sb = stdSandbox("zh", [{ form: "其他", kind: "selfemp", status: "uploaded" }]);
  assert.equal(sb.stdDone(sb.STD_ITEMS.find((x) => x.id === "selfemp")), true);
});

// ---------- 接线（静态） ----------
check("三块容器都在页面上：quickExport / stdBox / renameBox", () => {
  for (const id of ['id="quickExport"', 'id="stdBox"', 'id="renameBox"']) {
    assert.ok(html.includes(id), "缺容器：" + id);
  }
});

check("renderAll 里挂了 renderStd / renderQuick / renderRenameBox", () => {
  const line = html.match(/function renderAll\(\)\{var fns=\[[^\]]+\]/)[0];
  for (const fn of ["renderStd", "renderQuick", "renderRenameBox"]) assert.ok(line.includes(fn), "renderAll 没挂：" + fn);
});

check("「先导出」按钮一步到导出并出 PDF", () => {
  assert.match(html, /id='btnQuickExport'/, "先导出按钮不在渲染里");
  assert.match(html, /navigateToSection\("s6"\);var p=\$\("btnPrint"\);if\(p\)p\.click\(\)/, "按钮没有直达导出");
});

check("三份导出都用同一套名字：CSV 列、JSON 字段、打印对照表", () => {
  assert.match(html, /"建议文件名"\]/, "CSV 少了建议文件名列");
  assert.match(html, /file_name_semantic:semMap\[it\.id\]\|\|""/, "JSON 少了 file_name_semantic");
  assert.match(html, /rename_map:semanticMap\(\)/, "JSON 少了 rename_map");
  assert.match(html, /\+renameTableHtml\(\)/, "PDF 明细里没有命名对照表");
});

check("上传后每行显示「原件 → 导出名」", () => {
  assert.match(html, /原件：[\s\S]{0,160}导出名：/, "上传行还只显示原名");
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);