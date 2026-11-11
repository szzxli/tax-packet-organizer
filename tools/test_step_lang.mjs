#!/usr/bin/env node
// 验收：第 2、3 步的动态界面不再有硬写的中文。
// 只看“会不会渲染出中文”：直接写进 textContent / innerHTML / placeholder 的中文必须消失，
// 或者必须包在 tr(zh,en,es) / t(key) 里。数据比较用的中文（如 form==="州税"）不算。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const js = scripts[scripts.length - 1];
const CJK = /[\u4e00-\u9fff]/;

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

const lines = js.split("\n").map((l, i) => ({ n: i + 1, s: l }));

// 登录 / 验证码 / 支付 / 订阅状态不在第 2、3 步范围内（本轮不动），按 id 排除，
// 这样这份用例只对整理与导出界面负责。
const OUT_OF_SCOPE =
  /loginMsg|regMsg|verifyMsg|payMsg|btnResendCode|resendTimer|loginPass|regPass|renderSubStatus|displayOrders|paid0|list\.innerHTML|rec\.innerHTML|重新发送验证码|正在提交…|期末不再续费|当前状态：|it\.form==="不确定事项"/;

function stripTrCalls(text) {
  // 去掉 tr(…) / t("…")，用括号配平，避免嵌套括号误伤
  const out = [];
  let i = 0;
  while (i < text.length) {
    const m = /(^|[^a-zA-Z0-9_.$])(tr|t)\(/.exec(text.slice(i));
    if (!m) break;
    const start = i + m.index + m[1].length;
    const open = text.indexOf("(", start);
    let depth = 0;
    let quote = null;
    let j = open;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === "\\") { j++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) break; }
    }
    out.push(text.slice(i, start));
    i = j + 1;
  }
  out.push(text.slice(i));
  return out.join(" ");
}

function hits(re) {
  return lines.filter((l) => !OUT_OF_SCOPE.test(l.s) && re.test(l.s)).map((l) => l.n + ": " + l.s.trim().slice(0, 110));
}

check("没有把中文直接塞进 textContent / innerText", () => {
  const bad = hits(/textContent\s*=\s*["'`][^"'`]*[\u4e00-\u9fff]/);
  assert.deepEqual(bad, [], "还有硬写中文：\n" + bad.join("\n"));
});

check("没有把中文直接塞进 placeholder", () => {
  const bad = hits(/\.placeholder\s*=\s*["'`][^"'`]*[\u4e00-\u9fff]/);
  assert.deepEqual(bad, [], "还有硬写中文：\n" + bad.join("\n"));
});

check("innerHTML 里的中文只能出现在 tr() 调用里", () => {
  const bad = lines
    .filter((l) => !OUT_OF_SCOPE.test(l.s) && /innerHTML\s*=/.test(l.s) && CJK.test(l.s))
    .filter((l) => CJK.test(stripTrCalls(l.s)))
    .map((l) => l.n + ": " + l.s.trim().slice(0, 110));
  assert.deepEqual(bad, [], "innerHTML 里仍有裸中文");
});

check("下拉选项：表号保留，非表号项目代码走 exCode()", () => {
  assert.match(js, /o\.textContent=exCode\(f\[0\]\)\+" — "\+requestLabel\(f\[1\]\)/);
  for (const code of ["W-2", "1099-K", "Schedule C", "1095-A", "1099-NEC"]) {
    assert.ok(html.includes(`"${code}"`), `表号 ${code} 应保持原样`);
  }
});

check("切换语言时重建下拉，并保留已选值", () => {
  assert.match(js, /function refreshFormSelects\(\)/);
  assert.match(js, /if\(keep\)s\.value=keep/);
});

check("关键控件文案已走 tr()（抽查 12 处）", () => {
  const musts = [
    "标不适用",
    "删除本项",
    "保存数字",
    "今年总数（例如 1234.56）",
    "展开更多 ▼",
    "已上传文件：",
    "不适用原因（必填）",
    "继续补齐材料",
    " 项已解决",
    "先生成今年清单",
    "缺数字：",
    "可抵扣成本 · ",
  ];
  for (const s of musts) {
    assert.ok(
      js.includes('tr("' + s + '"') || js.includes('t("' + s + '"'),
      `${s} 没有包在 tr()/t() 里`
    );
  }
});

// tr(zh,en,es) 少一个参，西语用户看到的就是 undefined；按源码数参数太脆，直接渲染。
function fnSource(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到函数 " + name);
  let depth = 0, quote = null;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error("函数 " + name + " 没有闭合");
}

function trCallArity(src) {
  const bad = [];
  let i = 0;
  while ((i = src.indexOf("tr(", i)) >= 0) {
    const before = src.slice(Math.max(0, i - 12), i);
    if (/function\s*$/.test(before) || /[\w$.]/.test(src[i - 1] || "")) { i += 3; continue; }
    const line = src.slice(0, i).split("\n").length;
    let depth = 1, quote = null, commas = 0;
    for (let j = i + 3; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === "\\") { j++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { depth--; if (!depth) break; }
      else if (c === "," && depth === 1) commas++;
    }
    if (commas + 1 !== 3) bad.push("第 " + line + " 行有 " + (commas + 1) + " 个参数：" + src.slice(i, i + 90).split("\n")[0]);
    i += 3;
  }
  return bad;
}

function stickyText(lang, doneCount, total) {
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, textContent: "", onclick: null });
  const els = { stickyProgress: el(), stickyProgressTitle: el(), stickyProgressText: el(), stickyProgressFill: el(), stickyProgressAction: el() };
  const rows = Array.from({ length: total }, (_, k) => ({ ok: k < doneCount }));
  const sandbox = {
    Math,
    LANG: lang,
    $: (id) => els[id],
    packet: { checklist: rows },
    currentPage: 1,
    currentOrganizeStep: 2,
    rowResolved: (r) => !!r.ok,
    navigateToSection() {},
    tr: (zh, en, es) => (lang === "en" ? en : lang === "es" ? es : zh),
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource(js, "renderStickyProgress"), sandbox, { filename: "sticky.js" });
  sandbox.renderStickyProgress();
  return els.stickyProgressText.textContent;
}

check("所有 tr() 调用都是三参（少一个西语就会显示 undefined）", () => {
  const bad = trCallArity(js);
  assert.deepEqual(bad, [], "少参的 tr()：\n" + bad.join("\n"));
});

check("进度条三语渲染：不出现 undefined / null / 中文", () => {
  for (const lang of ["zh", "en", "es"]) {
    for (const [done, total] of [[0, 3], [1, 3], [3, 3]]) {
      const text = stickyText(lang, done, total);
      assert.ok(!/undefined|null/.test(text), lang + " " + done + "/" + total + " 渲染出空值：" + text);
      if (lang !== "zh") assert.ok(!CJK.test(text), lang + " " + done + "/" + total + " 渲染出中文：" + text);
      assert.ok(text.trim().length > 0, lang + " " + done + "/" + total + " 是空串");
    }
  }
  assert.equal(stickyText("es", 1, 3), "Hecho: 1 / 3 · 2 aún por resolver.");
  assert.match(stickyText("es", 3, 3), /^Los 3 elementos están marcados/);
  assert.equal(stickyText("zh", 1, 3), "已完成 1 / 3 项 · 还有 2 项待处理。");
  assert.equal(stickyText("en", 1, 3), "Done: 1 / 3 · 2 still to handle.");
});

check("州名与表名在行标题里按语言显示", () => {
  assert.match(js, /function exCode\(/);
  assert.match(js, /function exPayer\(/);
  const row = js.slice(js.indexOf("function renderMerged"), js.indexOf("function renderMerged") + 6000);
  assert.match(row, /esc\(exRowTitle\(it\)\)/, "行标题没用 exRowTitle");
  assert.match(row, /esc\(exPayer\(it\.payer\)\)/, "付款方没用 exPayer");
});

// 静态 HTML 的文案不经过 JS 生成，applyLang 只按词典整节点替换，漏一条就整句留中文。
const dictHas = (key) =>
  new RegExp('"' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s*:\\s*\\{\\s*"en"').test(html);

check("第 3 步保存那句与按钮都在词典里", () => {
  const line = html.match(/<p class="small hidden" id="saveToAccountLine">([\s\S]*?)<\/p>/)[1];
  const btn = line.match(/id="btnSaveToAccount"[^>]*>([^<]+)</)[1].trim();
  const sentence = line.replace(/<[^>]+>/g, "").split(btn)[0].trim();
  assert.ok(dictHas(sentence), `句子没有词典条目：${sentence}`);
  assert.ok(dictHas(btn), `按钮没有词典条目：${btn}`);
});

check("顶部与第 3 步的保存按钮逐字一致", () => {
  const top = html.match(/id="btnSaveProgress"[^>]*>([^<]+)</)[1].trim();
  const step3 = html.match(/id="btnSaveToAccount"[^>]*>([^<]+)</)[1].trim();
  assert.equal(step3, top);
});

check("步骤栏 aria-label 走词典并随语言切换", () => {
  assert.match(html, /class="journey-steps"[^>]*data-i18n-aria="整理步骤"/);
  assert.ok(dictHas("整理步骤"));
  assert.match(js, /querySelectorAll\("\[data-i18n-aria\]"\)/);
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);