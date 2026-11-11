#!/usr/bin/env node
// 验收：境外申报三行（FBAR / 8938 / 8621）。
// 直接抽 formal.html 里的定义执行，测的就是要上线的那份代码。
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

function sandbox(lang) {
  const sb = {
    LANG: lang,
    tr(zh, en, es) {
      return sb.LANG === "en" ? en : sb.LANG === "es" ? es : zh;
    },
    JSON,
  };
  vm.createContext(sb);
  vm.runInContext(slice("// EXPORT_I18N_START", "// EXPORT_I18N_END"), sb);
  vm.runInContext(ESC, sb);
  return sb;
}

const FORM_MAP = (() => {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(slice("var FORM_MAP=[", "];") + "]", sb);
  return sb.FORM_MAP;
})();

const FOREIGN_ROWS = (() => {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(slice("var FOREIGN_ROWS=[", "function foreignHas(form)"), sb);
  return sb.FOREIGN_ROWS;
})();

const PROBE_NOTES = (() => {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(slice("var PROBE_NOTES=[", "];") + "]", sb);
  return sb.PROBE_NOTES;
})();

const FORMS = ["FinCEN 114 (FBAR)", "Form 8938", "Form 8621"];

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

check("三条都在 FORM_MAP 里，且 request 文案与规格一致", () => {
  for (const f of FORMS) {
    const hit = FORM_MAP.find((x) => x[0] === f);
    assert.ok(hit, "FORM_MAP 缺 " + f);
    assert.ok(hit[1].startsWith("今年 "), f + " 的 request 应以「今年 」开头：" + hit[1]);
  }
});

check("FBAR 触发条件只写一次 $10,000；8938 / 8621 不出现任何金额", () => {
  const get = (f) => FORM_MAP.find((x) => x[0] === f)[1];
  const fbar = get("FinCEN 114 (FBAR)");
  assert.equal((fbar.match(/\$[\d,]+/g) || []).length, 1, "FBAR 文案里的金额个数不对：" + fbar);
  assert.ok(/\$10,000/.test(fbar), "FBAR 必须写明 $10,000 门槛");
  for (const f of ["Form 8938", "Form 8621"]) {
    assert.ok(!/\$[\d,]/.test(get(f)), f + " 不应出现任何门槛数字：" + get(f));
  }
});

check("导出对照表覆盖三条中文原文，英文/西语无汉字", () => {
  for (const f of FORMS) {
    const req = FORM_MAP.find((x) => x[0] === f)[1];
    for (const lang of ["en", "es"]) {
      const sb = sandbox(lang);
      assert.ok(sb.EX_I18N[req], lang + " 对照表没覆盖：" + req);
      const out = sb.requestLabel(req);
      assert.ok(!CJK.test(out), lang + " 输出仍是中文：" + out);
    }
  }
});

check("三个面板问句与说明：三语齐全、英文西语无汉字", () => {
  assert.equal(FOREIGN_ROWS.length, 3, "应有且只有三条");
  for (const r of FOREIGN_ROWS) {
    assert.equal(r[2].length, 3, r[0] + " 问句缺语种");
    assert.equal(r[3].length, 3, r[0] + " 说明缺语种");
    for (const t of [...r[2], ...r[3]]) assert.ok(t && t.trim().length > 4, r[0] + " 空文案");
    for (const t of [r[2][1], r[2][2], r[3][1], r[3][2]]) {
      assert.ok(!CJK.test(t), r[0] + " 英文/西语含汉字：" + t);
    }
  }
  assert.equal(FOREIGN_ROWS.map((r) => r[1]).join("|"), FORMS.join("|"), "面板三项与清单三条表单名要一致");
});

check("面板渲染函数已挂进 renderAll", () => {
  const all = html.match(/function renderAll\(\)\{var fns=\[([^\]]+)\]/);
  assert.ok(all, "找不到 renderAll 的 fns 列表");
  assert.ok(all[1].split(",").includes("renderForeign"), "renderAll 没带 renderForeign");
});

check("三问互不影响免费整理：面板只写清单、不调支付/权益接口", () => {
  const block = slice("// FOREIGN_ROWS_START · 境外申报三行", "// FOREIGN_ROWS_END");
  for (const bad of ["hasPass(", "TpoApi", "goSub(", "showPage(", "checkout"]) {
    assert.ok(!block.includes(bad), "面板里不应出现 " + bad);
  }
});

check("探针能按清单里的三条表名带出提醒", () => {
  // 与 renderProbe 里的匹配表达式同构：note.match 命中清单 form/title 即出提醒
  const probe = html.slice(html.indexOf("function renderProbe()"));
  assert.ok(
    probe.includes("n.match.some(function(m){return toks.some(function(t){return t&&t.indexOf(m)>=0;});})"),
    "renderProbe 的匹配逻辑变了，请同步更新本测试"
  );
  const hitsFor = (form) => {
    const toks = [form];
    return PROBE_NOTES.filter((n) => n.match.some((m) => toks.some((t) => t && t.indexOf(m) >= 0))).map((n) => n.text);
  };
  for (const [form, want] of [
    ["FinCEN 114 (FBAR)", "FinCEN 114"],
    ["Form 8938", "8938"],
    ["Form 8621", "8621"],
  ]) {
    const texts = hitsFor(form);
    assert.equal(texts.length, 1, form + " 应命中且只命中一条，实际 " + texts.length);
    assert.ok(texts[0].includes(want), form + " 命中的不是自己的那条：" + texts[0]);
  }
  assert.ok(hitsFor("W-2").every((t) => !/FBAR|8938|8621/.test(t)), "W-2 不该带出境外提醒");
});

check("核对判定：无金额项有文件即绿、没文件即红，且不卡「未填数字」", () => {
  for (const lang of ["en", "es"]) {
    const sb = sandbox(lang);
    vm.runInContext(slice("function whereToGet(it)", "function checkStats()"), sb);
    const withFile = sb.checkRow({ form: "FinCEN 114 (FBAR)", title: "FinCEN 114 (FBAR)", status: "uploaded", fileName: "fbar.pdf", noFigure: true });
    assert.equal(withFile.level, "green", lang + " 有文件应为绿：" + withFile.why);
    const noFile = sb.checkRow({ form: "Form 8938", title: "Form 8938", status: "not-started", noFigure: true });
    assert.equal(noFile.level, "red", lang + " 没文件应为红：" + noFile.why);
    for (const v of [withFile.why, noFile.why, noFile.where]) assert.ok(!CJK.test(v), lang + " 结论含中文：" + v);
  }
  const zh = sandbox("zh");
  vm.runInContext(slice("function whereToGet(it)", "function checkStats()"), zh);
  assert.match(zh.checkRow({ form: "FinCEN 114 (FBAR)", status: "uploaded", fileName: "a.pdf", noFigure: true }).why, /无需填数字/);
});

check("行内不给数字入口：figureMainArea 对 noFigure 提前返回", () => {
  const fn = html.slice(html.indexOf("function figureMainArea(it){"));
  const body = fn.slice(0, fn.indexOf("var info=document.createElement"));
  assert.ok(body.includes("it.noFigure"), "figureMainArea 没拦 noFigure 行");
  assert.ok(!body.includes("pendingCandidates"), "拦截段落不应继续走提数逻辑");
});

check("新行标记为 noFigure，且不进预估合计", () => {
  const block = slice("function foreignRow(form){", "function renderForeign(){");
  assert.ok(block.includes("noFigure:true"), "foreignRow 没标 noFigure");
  assert.ok(block.includes("costs:[]"), "境外三行不该带成本行");
  assert.ok(block.includes("status:\"not-started\""), "境外三行默认应为缺项");
  const draft = html.slice(html.indexOf("function draftLines("));
  assert.ok(!/foreign/i.test(draft.slice(0, 400)), "预估数字取数不该按 foreign 特判（应只认 figure）");
});

check("可单独回滚：两处标记齐全且成对", () => {
  assert.equal(html.split("// FOREIGN_ROWS_START").length - 1, 2, "FOREIGN_ROWS_START 应有两处（对照表 + 面板）");
  assert.equal(html.split("// FOREIGN_ROWS_END").length - 1, 2, "FOREIGN_ROWS_END 应有两处");
  assert.equal(html.split("FOREIGN_ROWS_START · 境外申报三行（单独回滚").length - 1, 1, "回滚说明只写在对照表处");
});

// 这条钉住作用域：宽松判定（有文件即绿）只准落在 noFigure 行，普通行必须还是「缺数字就黄/红」。
check("宽松判定不外溢：普通行缺数字仍按黄/红算，缺项表仍写「缺文件、缺数字」", () => {
  for (const lang of ["zh", "en"]) {
    const sb = sandbox(lang);
    vm.runInContext('var STATES=[["加州","有州个人所得税","California","California"]];', sb);
    vm.runInContext(html.match(/function statusText\(s\)\{[^\n]*\}/)[0], sb);
    vm.runInContext(slice("function whereToGet(it)", "function checkStats()"), sb);

    const plainFileOnly = sb.checkRow({ form: "W-2", title: "W-2", status: "uploaded", fileName: "w2.pdf" });
    assert.equal(plainFileOnly.level, "yellow", lang + " 普通行只有文件、没数字，应仍为黄：" + plainFileOnly.level);
    const plainNothing = sb.checkRow({ form: "W-2", title: "W-2", status: "not-started" });
    assert.equal(plainNothing.level, "red", lang + " 普通行什么都没有，应为红：" + plainNothing.level);

    vm.runInContext(slice("function exRowTitle(it)", "function coverHtml(){"), sb);
    sb.rowTitle = (it) => it.title || it.form;
    sb.unresolvedRows = () => [
      { form: "W-2", title: "W-2", payer: "", status: "not-started" },
      { form: "Form 8938", title: "Form 8938", payer: "", status: "not-started", noFigure: true },
    ];
    const out = sb.missingTableHtml();
    const wantZh = /缺文件、缺数字/;
    const wantEn = /Missing file and figure/;
    assert.ok(lang === "zh" ? wantZh.test(out) : wantEn.test(out), lang + " 普通行缺项表应仍写「缺文件、缺数字」");
    // 同一张表里：普通行报两个缺，境外行只报缺文件
    const cells = [...out.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]);
    assert.ok(cells.some((c) => /^(缺文件|Missing file)$/.test(c)), lang + " 境外行应只报缺文件");
  }
});

// —— 下面三条跑的是页面里真实函数，用来拿「页面上到底出什么字」的原文 ——
function panelSb(lang, checklist, ans) {
  const sb = sandbox(lang);
  const box = { innerHTML: "" };
  sb.$ = (id) => (id === "foreignBox" ? box : null);
  sb.packet = { checklist: checklist || [], foreignAns: ans || {} };
  vm.runInContext(FOREIGN_ROWS_DECL, sb);
  vm.runInContext(slice("function foreignHas(form)", '$("foreignBox").onclick'), sb);
  vm.runInContext(slice("function renderForeign(){", '$("foreignBox").onclick'), sb);
  sb.renderForeign();
  return box.innerHTML;
}

const FOREIGN_ROWS_DECL = slice("var FOREIGN_ROWS=[", "function foreignHas(form)");

check("面板实跑：三条问句 + 三选一按钮，$10,000 只出现一次", () => {
  const out = panelSb("zh");
  for (const r of FOREIGN_ROWS) {
    assert.ok(out.includes(r[1]), "面板缺表单名：" + r[1]);
    assert.ok(out.includes(r[2][0]), "面板缺问句：" + r[2][0]);
  }
  assert.equal((out.match(/\$10,000/g) || []).length, 1, "面板里 $10,000 应只出现一次");
  assert.equal((out.match(/data-ans='yes'/g) || []).length, 3, "每条应有「有」按钮");
  assert.equal((out.match(/data-ans='no'/g) || []).length, 3, "每条应有「没有」按钮");
  assert.equal((out.match(/data-ans='unsure'/g) || []).length, 3, "每条应有「不确定」按钮");
  assert.ok(!/\$[\d,]{4,}/.test(out.replace(/\$10,000/g, "")), "面板不该出现别的金额");
});

check("探针实跑：清单里有这三条时带出对应提醒（原文）", () => {
  const probeFn = slice("function renderProbe(){", "function renderDeep(){");
  for (const form of FORMS) {
    const el = { innerHTML: "" };
    const sb = sandbox("zh");
    sb.hasPass = () => true;
    sb.isGuest = () => false;
    sb.gateNote = () => "";
    sb.passGateNote = () => "";
    sb.$ = (id) => (id === "probeBox" ? el : null);
    sb.packet = { lastYear: [], checklist: [{ form, title: form, status: "not-started" }] };
    vm.runInContext(slice("var PROBE_NOTES=[", "];") + "]", sb);
    vm.runInContext(probeFn, sb);
    sb.renderProbe();
    const note = PROBE_NOTES.filter((n) => n.match.some((m) => form.indexOf(m) >= 0))[0];
    assert.ok(el.innerHTML.includes(note.text), form + " 探针没带出本行提醒");
    if (process.env.SHOW_PROBE) console.log("     探针原文[" + form + "]：" + note.text);
  }
});

check("缺项表实跑：三行都能进表并标缺项，英西无汉字", () => {
  const missingBlock = slice("function exRowTitle(it)", "function coverHtml()");
  for (const lang of ["zh", "en", "es"]) {
    const sb = sandbox(lang);
    sb.rowTitle = (it) => it.title || it.form;
    vm.runInContext('var STATES=[["加州","有州个人所得税","California","California"]];', sb);
    vm.runInContext(html.match(/function statusText\(s\)\{[^\n]*\}/)[0], sb);
    vm.runInContext(missingBlock, sb);
    sb.unresolvedRows = () => FORMS.map((f) => ({ form: f, title: f, payer: "", status: "not-started", noFigure: true }));
    const out = sb.missingTableHtml();
    for (const f of FORMS) assert.ok(out.includes(f), lang + " 缺项表缺 " + f);
    // 这三行不填数字，缺项只能说“缺文件”，不能引导用户去填余额
    assert.ok(!/缺数字|Missing figure|Falta cifra/.test(out), lang + " 缺项表不该出现“缺数字”");
    assert.ok(lang === "zh" ? out.includes("缺文件") : /Missing file|Falta archivo/.test(out), lang + " 缺项表应报缺文件");
    if (lang !== "zh") {
      const cells = [...out.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]);
      for (const c of cells) assert.ok(!CJK.test(c), lang + " 缺项表含中文：" + c);
    }
  }
});

check("英文/西语缺项表的「去哪拿」三行都有专门文案", () => {
  const whereBlock = slice("var WHERE_MAP={", "function whereFrom(it)");
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(whereBlock.replace(/^var WHERE_MAP=/, "var WHERE_MAP="), sb);
  for (const f of FORMS) {
    const hit = sb.WHERE_MAP[f];
    assert.ok(hit && hit.length === 2, f + " 缺 WHERE_MAP 条目");
    for (const t of hit) assert.ok(t && t.trim() && !CJK.test(t), f + " 的去哪拿不是英文/西语：" + t);
  }
});

check("对外文案只留「要备什么 / 是否需报找会计师」：无罚则数字、无第二个金额、无门槛数字", () => {
  // 三条清单文案 + 三条探针文案，是这功能所有对外的字
  const notes = PROBE_NOTES.filter((n) => /FinCEN 114|8938|8621/.test(n.match.join(" "))).map((n) => n.text);
  assert.equal(notes.length, 3, "应正好三条探针文案");
  const rowTexts = FORMS.map((f) => FORM_MAP.find((x) => x[0] === f)[1]);
  // 清单文案一处、探针文案一处：同一句触发条件各写一次，其它任何金额都不许有
  const rowHits = rowTexts.join(" ").match(/\$[\d,]+/g) || [];
  const noteHits = notes.join(" ").match(/\$[\d,]+/g) || [];
  assert.deepEqual([...rowHits], ["$10,000"], "清单文案只允许 FBAR 的 $10,000，实际：" + rowHits.join(","));
  assert.deepEqual([...noteHits], ["$10,000"], "探针文案只允许 FBAR 的 $10,000，实际：" + noteHits.join(","));
  const all = [...rowTexts, ...notes];
  for (const t of all) {
    assert.ok(!/\d+%/.test(t), "不许出现百分比例：" + t);
    assert.ok(!/罚[款金].*\$|罚款.*\d/.test(t), "不许出现罚则金额：" + t);
  }
  // 8938 / 8621 的文案绝对不能带门槛数字
  for (const f of ["Form 8938", "Form 8621"]) {
    const t = FORM_MAP.find((x) => x[0] === f)[1];
    assert.ok(!/\$|\d{4,}/.test(t.replace(f, "")), f + " 带了金额或门槛数字：" + t);
  }
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);