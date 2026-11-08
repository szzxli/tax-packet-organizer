#!/usr/bin/env node
// 验收：formal.html 的语言解析与文档元信息（lang / title / description / og:locale）。
// 直接抽取 LANG_BOOT 块执行，测的是上线的那份代码。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");

const start = html.indexOf("// LANG_BOOT_START");
const end = html.indexOf("// LANG_BOOT_END");
assert.ok(start > 0 && end > start, "LANG_BOOT 块存在");
const boot = html.slice(start, end);
assert.ok(!/hreflang/i.test(html), "单 URL 页不写 hreflang");

const CJK = /[\u4e00-\u9fff]/;

function run({ search = "", stored = null, nav = "en-US" }) {
  const meta = {};
  const doc = {
    _title: "",
    documentElement: { lang: "" },
    querySelector(sel) {
      const el = {
        setAttribute(k, v) {
          meta[sel + "|" + k] = v;
        },
      };
      meta[sel] = el;
      return el;
    },
    set title(v) {
      this._title = v;
    },
    get title() {
      return this._title;
    },
  };
  const sandbox = {
    location: { search },
    navigator: { language: nav, languages: [nav] },
    localStorage: { getItem: () => stored, setItem: () => {} },
    document: doc,
    URLSearchParams,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(boot, sandbox, { filename: "lang-boot.js" });
  const read = () => ({
    lang: doc.documentElement.lang,
    title: doc.title,
    desc: meta['meta[name="description"]|content'],
    ogTitle: meta['meta[property="og:title"]|content'],
    ogLocale: meta['meta[property="og:locale"]|content'],
  });
  const now = read();
  return {
    lang: sandbox.__TPO_LANG,
    attr: now.lang,
    title: now.title,
    desc: now.desc,
    ogTitle: now.ogTitle,
    ogLocale: now.ogLocale,
    read,
    applyMeta: sandbox.__tpoApplyMeta,
  };
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

check("?lang=en → html lang=en, 英文 title/description", () => {
  const r = run({ search: "?lang=en" });
  assert.equal(r.lang, "en");
  assert.equal(r.attr, "en");
  assert.ok(!CJK.test(r.title), "title 不含中文：" + r.title);
  assert.ok(!CJK.test(r.desc), "description 不含中文");
  assert.equal(r.ogLocale, "en_US");
});

check("?lang=es → 西语 title/description", () => {
  const r = run({ search: "?lang=es" });
  assert.equal(r.attr, "es");
  assert.match(r.title, /Organizador/);
  assert.equal(r.ogLocale, "es_US");
});

check("?lang=zh → zh-CN", () => {
  const r = run({ search: "?lang=zh" });
  assert.equal(r.attr, "zh-CN");
  assert.match(r.title, /可交/);
  assert.equal(r.ogLocale, "zh_CN");
});

check("参数大小写与地区码：?lang=EN-us", () => {
  assert.equal(run({ search: "?lang=EN-us" }).lang, "en");
});

check("无参数 + 英文浏览器 → 英文首屏", () => {
  const r = run({ nav: "en-US" });
  assert.equal(r.lang, "en");
  assert.ok(!CJK.test(r.title));
});

check("无参数 + 西语浏览器 → es", () => {
  assert.equal(run({ nav: "es-MX" }).lang, "es");
});

check("无参数 + 中文浏览器 → 中文", () => {
  assert.equal(run({ nav: "zh-CN" }).lang, "zh");
});

check("无参数 + 其他语言（fr）→ 回落中文", () => {
  assert.equal(run({ nav: "fr-FR" }).lang, "zh");
});

check("?lang 优先于本地记忆", () => {
  assert.equal(run({ search: "?lang=en", stored: "zh", nav: "zh-CN" }).lang, "en");
});

check("本地记忆优先于浏览器语言", () => {
  assert.equal(run({ stored: "es", nav: "en-US" }).lang, "es");
});

check("非法 lang 参数被忽略，不改变页面语言", () => {
  const r = run({ search: "?lang=de", stored: "zh", nav: "zh-CN" });
  assert.equal(r.lang, "zh");
  assert.match(r.title, /可交/);
});

check("切换语言时 meta 同步更新（applyLang 路径）", () => {
  const r = run({ search: "?lang=zh" });
  assert.match(r.title, /可交/);
  r.applyMeta("en");
  const now = r.read();
  assert.equal(now.lang, "en");
  assert.ok(!CJK.test(now.title), "title 换成英文：" + now.title);
  assert.ok(!CJK.test(now.desc), "description 换成英文");
  assert.equal(now.ogLocale, "en_US");
});

check("再切到西语：title 与 description 一起换，不残留中文", () => {
  const r = run({ search: "?lang=zh" });
  r.applyMeta("es");
  const now = r.read();
  assert.match(now.title, /Organizador/);
  assert.ok(!CJK.test(now.desc), "西语 description 不含中文");
  assert.equal(now.lang, "es");
});

check("applyLang 走 __tpoApplyMeta，placeholder 与 title 不再各写一份", () => {
  const body = html.slice(html.indexOf("function applyLang"));
  const fn = body.slice(0, body.indexOf("function setLang"));
  assert.match(fn, /__tpoApplyMeta/);
});

check("setLang 把 ?lang 写进地址栏，便于分享与渠道链接", () => {
  const body = html.slice(html.indexOf("function setLang("), html.indexOf("\nvar FORM_MAP"));
  assert.match(body, /searchParams\.set\("lang"/);
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);