#!/usr/bin/env node
// 闸门：I18N 词典里不许有死条目、不许跨块重复。
// 词典只在 applyLang 里按「DOM 文本 / placeholder / data-i18n-* 的原文」精确查表，
// 所以一条词条如果在整篇 HTML（实体解码后）里根本找不到那个中文字符串，
// 它就是永远查不到的死条目——只占字节，占了全站首页的 8%。
// 跑法：node tools/test_i18n_keys.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");

const BLOCKS = [
  /^var I18N=(\{.*?\});[ \t]*$/gms,
  /^Object\.assign\(I18N,(\{.*?\})\);[ \t]*$/gms,
];

const spans = [];
for (const re of BLOCKS) for (const m of html.matchAll(re)) spans.push({ index: m.index, body: m[1], raw: m[0] });
spans.sort((a, b) => a.index - b.index);
assert.ok(spans.length > 0, "没找到词典块");

const keys = [];
for (const s of spans) {
  for (const m of s.body.matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*\{\s*"en"/g)) keys.push(m[1]);
}

// 去掉词典块之后剩下的源码，并把 HTML 实体解码（正文里写 &amp;，DOM 里是 &）
let rest = html;
for (const s of [...spans].sort((a, b) => b.index - a.index)) rest = rest.slice(0, s.index) + rest.slice(s.index + s.raw.length);
rest = rest
  .replace(/&nbsp;/g, "\u00a0")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&");

const seen = new Map();
const dups = [];
for (const k of keys) {
  if (seen.has(k)) dups.push(k);
  seen.set(k, true);
}
// 这几条是运行时拼出来再查表的（导出 PDF 的标题、规划卡标题、季票那行），
// 源码里没有整串，但 en/es 页面要用它们，删了会露出中文。测试会点名它们。
const RUNTIME_ONLY = new Set([
  "报税材料包 · 交得出去",
  "规划卡：补贴（1095-A / 8962）",
  "规划卡：税档 / 退休 / 政策",
  "1 个包 · 内测期免费",
]);
const dead = [...seen.keys()].filter((k) => !rest.includes(k) && !RUNTIME_ONLY.has(k));

let pass = 0,
  fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
    pass++;
  } catch (e) {
    console.log("FAIL " + name + " — " + (e && e.message ? e.message : e));
    fail++;
  }
}

check("词典无跨块重复键（Object.assign 后写覆盖，重复只是死字节）", () => {
  assert.deepEqual(dups.slice(0, 10), [], "重复键：" + dups.slice(0, 10).join(" / "));
});
check("词典无死条目（页面里查不到的中文串不留在词典里）", () => {
  assert.deepEqual(dead.slice(0, 10), [], "死条目：" + dead.slice(0, 10).join(" / "));
});

console.log(
  "\n词条 " + seen.size + " 条（原始 " + keys.length + " 处）、重复 " + dups.length + " 条、死条目 " + dead.length + " 条"
);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);