#!/usr/bin/env node
// 验收：R2 信任句贴着订阅 CTA（三语、≤40px、不许承诺）、R4 四节点交付节律替代功能清单。
// 直接读上线的 formal.html 与 i18n 表，测的就是页面上那份文案。
// 跑法：node tools/test_sub_pricing.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}
const CJK = /[\u4e00-\u9fff]/;
const TRUST = "交付前总核对：可交／不可交逐项列出，签字与判断在会计。";
const i18n = (() => {
  const s = html.indexOf("var I18N=");
  const e = html.indexOf("Object.assign(I18N", s);
  const src = html.slice(s + "var I18N=".length, e).trim().replace(/;$/, "");
  return vm.runInNewContext("(" + src + ")", {});
})();
// 页面把词条分散在 var I18N 与多个 Object.assign 块里；首块找不到时按同一份表继续找
const lookup = (k) => {
  if (i18n[k]) return i18n[k];
  const re = new RegExp(
    JSON.stringify(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      ':\\{"en":"((?:[^"\\\\]|\\\\.)+)","es":"((?:[^"\\\\]|\\\\.)+)"\\}'
  );
  const m = html.match(re);
  return m ? { en: m[1], es: m[2] } : null;
};

// ---------- R2：信任句 ----------
check("R2：信任句在展示卡的订阅按钮上方，同一个 <p> 序列里紧挨着", () => {
  const i = html.indexOf('id="subShowcase"');
  const blk = html.slice(i, html.indexOf("</div>", html.indexOf("去看季票")));
  assert.ok(blk.includes(TRUST), "#subShowcase 缺信任句");
  const ti = blk.indexOf(TRUST), bi = blk.indexOf("去看季票");
  assert.ok(ti > 0 && bi > ti, "信任句不在按钮上方");
  assert.ok(blk.indexOf("sub-trust") > 0 && blk.indexOf("sub-cta") > 0, "缺定位用的类名");
});

check("R2：订阅页领取按钮上方也有同一句", () => {
  const i = html.indexOf("btnPlanClaim");
  const around = html.slice(Math.max(0, i - 1200), i);
  assert.ok(around.includes("sub-trust"), "领取按钮上方没有信任句");
});

check("R2：≤40px 的间距写进样式（8px），不是靠默认段落间距", () => {
  assert.match(html, /\.sub-trust\{margin:0 0 8px/, "信任句下边距没锁到 8px");
  assert.match(html, /\.sub-cta\{margin:0/, "按钮容器没归零");
});

check("R2：不出现保证 / 100% / 包退这类承诺", () => {
  for (const bad of ["保证", "100% 准确", "包退", "100% accurate", "guaranteed"]) {
    assert.ok(!TRUST.includes(bad), "信任句里出现：" + bad);
  }
  const seg = html.slice(html.indexOf('id="subShowcase"'), html.indexOf("</div>", html.indexOf("去看季票")));
  for (const bad of ["保证", "包退"]) assert.ok(!seg.includes(bad), "展示卡里出现：" + bad);
});

check("R2：三语都在（静态 i18n + 动态 planLang）", () => {
  assert.ok(i18n[TRUST] && i18n[TRUST].en && i18n[TRUST].es, "静态信任句缺翻译");
  assert.ok(!CJK.test(i18n[TRUST].en) && !CJK.test(i18n[TRUST].es), "信任句翻译夹中文");
  assert.ok(html.includes("Pre-delivery check: ready / not-ready"), "领取按钮那句缺英文");
  assert.ok(html.includes("Verificación previa: listo / no listo"), "领取按钮那句缺西语");
});

// ---------- R4：交付节律 ----------
check("R4：四个节点、一行一个，第 4 节点是内测态", () => {
  const i = html.indexOf('<ol class="sub-timeline">');
  const j = html.indexOf("</ol>", i);
  const blk = html.slice(i, j);
  const items = blk.split("<li").slice(1);
  assert.equal(items.length, 4, "不是四个节点");
  for (const it of items) {
    assert.ok(it.includes("<b>") && it.includes("<span"), "节点缺标签或正文：" + it.slice(0, 60));
  }
  assert.match(items[3], /tl-beta/, "第 4 节点没标内测态");
  assert.match(items[3], /tl-badge[^>]*>内测/, "第 4 节点缺「内测」徽章");
});

check("R4：旧功能清单（免费版 vs 季票对比表）已从订阅页撤下", () => {
  const i = html.indexOf('id="subCard"');
  const blk = html.slice(i, html.indexOf('id="subShowcase"'));
  assert.ok(!blk.includes("免费版 vs 季票"), "旧对比表还在订阅卡里");
  assert.ok(!blk.includes("<th>功能</th>"), "旧表头还在订阅卡里");
});

check("R4：时间线不写次年数字，不出现 2027", () => {
  const i = html.indexOf('<ol class="sub-timeline">');
  const blk = html.slice(i, html.indexOf("</ol>", i));
  assert.ok(!/2027|2028/.test(blk), "时间线出现次年数字");
});

check("R4：时间线四段文案三语齐全（i18n）", () => {
  const keys = ["交付节律：什么时候给你什么", "整理完", "今年大概退还是补、差多少。", "交付前", "总核对，缺什么逐条列。", "报税季", "可交 / 不可交。", "次年打开", "去年的 8 个数还在", "内测"];
  for (const k of keys) {
    const t = lookup(k);
    assert.ok(t && t.en && t.es, "缺翻译：" + k);
    assert.ok(!CJK.test(t.en) && !CJK.test(t.es), "翻译夹中文：" + k);
  }
});

check("手机：时间线是竖排、每个节点一行，不靠 table", () => {
  assert.match(html, /\.sub-timeline li\{display:flex;flex-wrap:wrap/, "节点不是 flex 一行");
  assert.match(html, /\.sub-timeline\{list-style:none/, "还带着列表符号");
});

let bad = 0;
for (const [tag, msg] of results) { if (tag !== "ok  ") bad++; console.log(tag, msg); }
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);