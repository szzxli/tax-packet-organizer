#!/usr/bin/env node
// 验收：导出与打印跟界面语言走。
// 直接抽 formal.html 里的导出文案表与三个生成函数执行，测的就是上线那份代码。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");
const CJK = /[\u4e00-\u9fff]/;

function slice(startMark, endMark) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark, a + startMark.length);
  assert.ok(a >= 0 && b > a, `抽不到 ${startMark} … ${endMark}`);
  return html.slice(a, b);
}

const ESC = `function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}`;

// 包里存的是中文原文，导出时按 LANG 取词
const exportBlock = slice("// EXPORT_I18N_START", "// EXPORT_I18N_END");
const statusFn = html.match(/function statusText\(s\)\{[^\n]*\}/)[0];
const missingBlock = slice("function exRowTitle(it)", "function coverHtml()");
const checkBlock = slice("function whereToGet(it)", "function checkStats()");

const STATES_STUB = `var STATES=[["加州","有州个人所得税","California","California"],["得州","无州个人所得税","Texas","Texas"]];`;

function sandbox(lang) {
  const sb = {
    LANG: lang,
    tr(zh, en, es) {
      return sb.LANG === "en" ? en : sb.LANG === "es" ? es : zh;
    },
    JSON,
  };
  vm.createContext(sb);
  vm.runInContext(STATES_STUB, sb);
  vm.runInContext(exportBlock, sb);
  vm.runInContext(statusFn, sb);
  vm.runInContext(ESC, sb);
  return sb;
}

const FORM_MAP = (() => {
  const block = slice("var FORM_MAP=[", "];") + "]";
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(block, sb);
  return sb.FORM_MAP;
})();

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

const extra = [
  "今年加州州所得税表与缴款确认",
  "购房合同与付款凭证",
  "售房合同与收款凭证",
  "中国完税 / 税费缴纳证明",
  "产权证 / 不动产权证书",
  "持有年限证明（购房日期凭证）",
  "常住证明（居住记录等，按税务师要求提供）",
  "买卖汇率换算记录（银行结汇 / 换汇凭证）",
  "中介费、评估费等费用单据",
  "相关合同 / 凭证",
  "收付款记录",
  "税费缴纳证明（如有）",
  "时间 / 身份证明材料",
  "新增抚养人证明（出生/收养记录等）",
  "抚养人减少相关证明（如适用）",
];

check("对照表覆盖 FORM_MAP 的每一条中文原文", () => {
  const sb = sandbox("en");
  const missing = FORM_MAP.map((f) => f[1]).filter((zh) => !sb.EX_I18N[zh]);
  assert.equal(missing.length, 0, "没覆盖：" + missing.join(" / "));
});

for (const lang of ["en", "es"]) {
  check(`${lang}：清单项文案全部有译文，无汉字`, () => {
    const sb = sandbox(lang);
    const all = [...FORM_MAP.map((f) => f[1]), ...extra];
    for (const zh of all) {
      const out = sb.requestLabel(zh);
      assert.ok(!CJK.test(out), `${lang} 输出仍是中文：${zh} → ${out}`);
    }
  });

  check(`${lang}：状态、核对结论、去哪拿 均无汉字`, () => {
    const sb = sandbox(lang);
    for (const s of ["uploaded", "na", "pending", "not-started"]) {
      assert.ok(!CJK.test(sb.statusText(s)), "statusText 仍是中文：" + s);
    }
    vm.runInContext(checkBlock, sb);
    for (const it of [
      { form: "W-2", status: "not-started" },
      { form: "1095-A", status: "not-started" },
      { form: "州税", title: "州税", status: "not-started" },
      { form: "Schedule C", status: "uploaded", fileName: "a.pdf", figure: null },
    ]) {
      const c = sb.checkRow(it);
      for (const v of [c.label, c.why, c.where]) assert.ok(!CJK.test(v), "核对结论含中文：" + v);
    }
  });
}

const warnBlock = slice("function computeWarnings(){", "function renderWarnings(");

for (const lang of ["en", "es", "zh"]) {
  check(`${lang}：对照提醒每条都有文案（英文/西语无汉字）`, () => {
    const sb = sandbox(lang);
    sb.fmtMoney = (c) => "$" + (c / 100).toFixed(2);
    sb.rowTitle = (it) => it.title || it.form;
    sb.exRowTitle = (it) => sb.exText(sb.rowTitle(it)) || sb.rowTitle(it);
    sb.exPayer = (p) => {
      const v = String(p == null ? "" : p);
      if (sb.LANG === "zh") return v;
      const hit = sb.exText(v);
      if (hit) return hit;
      return v === "加州" ? "California" : v;
    };
    sb.packet = {
      checklist: [
        { form: "W-2", payer: "Acme", status: "not-started" },
        { form: "1095-A", title: "1095-A", payer: "", status: "pending" },
        { form: "州税", title: "州税", payer: "加州", status: "not-started" },
        { form: "1099-K", title: "1099-K", payer: "", status: "not-started", fileName: "a.pdf" },
        { form: "W-2G", title: "W-2G", payer: "", status: "uploaded", fileName: "b.pdf", figure: { cat: "Gross", cents: 1234 } },
        { form: "1099-INT", title: "1099-INT", payer: "", status: "uploaded", figure: { cat: "Interest", cents: 100 }, voucherChecked: true, formAmountCents: 200 },
      ],
      lastYear: [{ form: "W-2", payer: "Acme" }],
    };
    vm.runInContext(warnBlock, sb);
    const w = sb.computeWarnings();
    assert.ok(w.length >= 3, "提醒条数不对：" + w.length);
    for (const x of w) {
      assert.equal(typeof x.text, "string", "text 不是字符串：" + JSON.stringify(x));
      assert.equal(typeof x.action, "string", "action 不是字符串：" + JSON.stringify(x));
      assert.ok(x.text.length > 3 && x.action.length > 3, "文案为空：JSON " + JSON.stringify(x));
      if (lang !== "zh") {
        assert.ok(!CJK.test(x.text), "英文/西语提醒含中文：" + x.text);
        assert.ok(!CJK.test(x.action), "英文/西语动作含中文：" + x.action);
      }
    }
  });
}

check("英文缺项表：五列逐字用市场定稿，且整表无汉字", () => {
  const sb = sandbox("en");
  sb.rowTitle = (it) => it.title || it.form;
  sb.esc = (s) => String(s == null ? "" : s);
  vm.runInContext(missingBlock, sb);
  sb.unresolvedRows = () => [
    { form: "W-2", payer: "Acme Inc", status: "not-started" },
    { form: "1095-A", title: "1095-A", payer: "", status: "pending" },
    { form: "州税", title: "州税", payer: "加州", status: "not-started" },
  ];
  const out = sb.missingTableHtml();
  const heads = [...out.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ["Form", "Payer", "Status", "What's missing", "Where to get it"]);
  const cells = [...out.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]);
  for (const c of cells) assert.ok(!CJK.test(c), "表格单元格含中文：" + c);
});

check("西语缺项表：同结构，无汉字", () => {
  const sb = sandbox("es");
  sb.rowTitle = (it) => it.title || it.form;
  sb.esc = (s) => String(s == null ? "" : s);
  vm.runInContext(missingBlock, sb);
  sb.unresolvedRows = () => [{ form: "W-2", payer: "Acme", status: "not-started" }];
  const out = sb.missingTableHtml();
  const heads = [...out.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.equal(heads.length, 5);
  for (const c of [...out.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1])) {
    assert.ok(!CJK.test(c), "西语单元格含中文：" + c);
  }
});

check("中文缺项表保持不变（三列：表 / 付款方 / 缺什么）", () => {
  const sb = sandbox("zh");
  sb.rowTitle = (it) => it.title || it.form;
  sb.esc = (s) => String(s == null ? "" : s);
  vm.runInContext(missingBlock, sb);
  sb.unresolvedRows = () => [
    { form: "W-2", payer: "Acme", status: "not-started" },
    { form: "1099-K", title: "1099-K", payer: "", status: "pending" },
  ];
  const out = sb.missingTableHtml();
  const heads = [...out.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ["表", "付款方", "缺什么"]);
  assert.match(out, /<td>缺文件、缺数字<\/td>/);
  assert.match(out, /<td>等 transcript<\/td>/);
});

check("CSV：中/英/西三套表头都是 15 列，英文与西语无汉字，中文逐字不变", () => {
  const csvBlock = html.slice(html.indexOf('$("btnExportCsv").onclick'), html.indexOf("var lines=[head.map"));
  assert.ok(csvBlock.length > 100, "找不到 CSV 导出块");

  const zhMatch = csvBlock.match(/\?\[([^\]]+)\]/);
  const esMatch = csvBlock.match(/:LANG==="es"\s*\n?\s*\?\[([^\]]+)\]/);
  const enMatch = csvBlock.match(/:\s*\[([^\]]+)\];/);
  assert.ok(zhMatch && esMatch && enMatch, "三套表头应都在");

  const cols = (m) => m[1].split(",").map((x) => x.trim().replace(/^"|"$/g, ""));

  const zh = cols(zhMatch);
  assert.equal(zh.length, 15);
  assert.equal(
    zh.join(","),
    "序号,表类型,付款方,今年需备文件,状态,不适用原因,文件名,是否今年新增,备注,确认数字类别,确认数字金额,证据来源,凭证核对,表格数,核对结果"
  );

  for (const [name, arr] of [["英文", cols(enMatch)], ["西语", cols(esMatch)]]) {
    assert.equal(arr.length, 15, `${name}表头应 15 列，实际 ${arr.length}`);
    for (const c of arr) assert.ok(!CJK.test(c), `${name}列名含中文：${c}`);
  }
  assert.equal(cols(esMatch)[4], "Estado", "西语状态列应与页面用词一致");
  assert.equal(cols(esMatch)[12], "Verificación del comprobante", "西语凭证列应与页面一致");
});

check("CSV 文件名带语言且为英文名", () => {
  assert.match(html, /a\.download="checklist_"\+\(LANG==="zh"\?"zh":LANG\)\+"\.csv"/);
});

check("PDF / 报告打印前把文件名设成英文，打印完还原", () => {
  assert.match(html, /var printTitle=tr\("checklist_zh","checklist_en","checklist_es"\)/);
  assert.match(html, /document\.title=printTitle/);
  assert.match(html, /document\.title=tr\("report_zh","report_en","report_es"\)/);
  assert.match(html, /setTimeout\(function\(\)\{document\.title=oldTitle;\},0\)/);
});

check("PDF 正文的标题/表头/免责句都走 tr()，中文原样保留", () => {
  for (const zh of ["报税包整理清单 · 明细", "报税材料包 · 交得出去", "今年预估报税表草稿", "IRS 对照提醒（基础版）", "复核签字（会计师或本人）：", "本包只整理材料，不算税、不报税、不给税务结论"]) {
    assert.ok(html.includes(zh), "中文原文丢了：" + zh);
  }
  assert.match(html, /tr\("报税包整理清单 · 明细","Tax packet checklist · details"/);
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);