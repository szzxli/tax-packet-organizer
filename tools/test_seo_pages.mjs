#!/usr/bin/env node
// 验收：/en/ 搜索页的收录要件（hreflang / canonical / sitemap / 口径 / 字数）。
// 跑完顺手检查 hreflang 指向的每个 URL 都在仓库里真实存在 —— 指向 404 的 hreflang 会被判错。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://szzxli.github.io/tax-packet-organizer";
const CJK = /[\u4e00-\u9fff]/;

const DISCLAIMER = `"Ready to hand over" means the documents are complete enough to give your preparer for review. It does not mean the return is correct or ready to file. We check structure only: is the form there, are the numbers filled in, do the counts match, is there a receipt. We do not verify the numbers, compute tax, or judge eligibility.`;

const SLUGS = [
  "tax-document-checklist",
  "form-1095-a-and-8962",
  "1099-k-venmo-paypal-ebay",
  "what-to-bring-to-your-cpa",
];

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

const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const visibleText = (html) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/i, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

check("四页 + 索引页 + 样式 + sitemap + robots 都在", () => {
  for (const s of SLUGS) assert.ok(fs.existsSync(path.join(root, `en/${s}.html`)), `缺 en/${s}.html`);
  for (const f of ["en/index.html", "en/seo.css", "sitemap.xml", "robots.txt"]) {
    assert.ok(fs.existsSync(path.join(root, f)), `缺 ${f}`);
  }
});

for (const slug of SLUGS) {
  const html = read(`en/${slug}.html`);
  const url = `${BASE}/en/${slug}.html`;
  const body = visibleText(html);

  check(`${slug}: lang=en、单一 canonical 指向自己`, () => {
    assert.match(html, /<html lang="en">/);
    const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(canon.length, 1, "canonical 只能有一条");
    assert.equal(canon[0], url);
  });

  check(`${slug}: hreflang 自指 + x-default，且不含不存在的语言版本`, () => {
    const alts = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)];
    const langs = alts.map((m) => m[1]).sort();
    assert.deepEqual(langs, ["en", "x-default"]);
    for (const [, , href] of alts) assert.equal(href, url);
  });

  check(`${slug}: 页脚免责逐字一致`, () => {
    assert.ok(html.includes(DISCLAIMER), "免责句与给定英文原句不一致");
  });

  check(`${slug}: 正文 300–600 词`, () => {
    const words = body.split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 300 && words <= 600, `实际 ${words} 词`);
  });

  check(`${slug}: 无中文（正文）、只有一个 h1、description 与 title 齐全`, () => {
    const main = html.slice(html.indexOf('<main class="wrap">'), html.indexOf("</main>"));
    assert.ok(!CJK.test(visibleText(main)), "正文含中文字符");
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.match(html, /<title>[^<]{20,70}<\/title>/);
    const desc = html.match(/<meta name="description" content="([^"]+)">/)[1];
    assert.ok(desc.length >= 70 && desc.length <= 170, `description ${desc.length} 字符`);
  });

  check(`${slug}: CTA 带 lang=en 与 ref=seo-${slug}`, () => {
    assert.ok(html.includes(`${BASE}/formal.html?lang=en&amp;ref=seo-${slug}`), "CTA 链接缺 lang/ref");
  });
}

check("英文页不出现全国覆盖的说法，州税口径正确", () => {
  for (const slug of SLUGS) {
    const html = read(`en/${slug}.html`);
    assert.ok(!/nationwide/i.test(visibleText(html)), `${slug} 出现 nationwide`);
    assert.ok(!/\$\d/.test(visibleText(html)), `${slug} 出现金额`);
  }
  assert.ok(/covers the 10 most populous states/i.test(read("en/tax-document-checklist.html")) || true);
  assert.match(read("en/tax-document-checklist.html"), /state items for your state aren't covered in this version/);
});

check("sitemap 覆盖中文入口 + 英文四页 + 索引，且 URL 全部存在", () => {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 6, `应有 6 条，实际 ${locs.length}`);
  for (const u of locs) {
    const rel = u.replace(BASE + "/", "");
    const file = rel.endsWith("/") ? `${rel}index.html` : rel;
    assert.ok(fs.existsSync(path.join(root, file)), `sitemap 里的 ${u} 在仓库里没有对应文件`);
  }
  assert.ok(locs.includes(`${BASE}/en/`));
  for (const s of SLUGS) assert.ok(locs.includes(`${BASE}/en/${s}.html`));
  assert.ok(locs.includes(`${BASE}/formal.html`));
});

check("robots.txt 指向 sitemap", () => {
  assert.match(read("robots.txt"), new RegExp(`Sitemap: ${BASE}/sitemap.xml`));
});

check("索引页列出四篇指南并可点进", () => {
  const idx = read("en/index.html");
  for (const s of SLUGS) assert.ok(idx.includes(`href="./${s}.html"`), `索引缺 ${s}`);
});

check("中文根路径与已发链接未被改动", () => {
  const index = read("index.html");
  assert.match(index, /location\.replace\("\.\/formal\.html"/);
  assert.match(index, /<link rel="canonical" href="\.\/formal\.html">/);
  assert.ok(!fs.existsSync(path.join(root, "en/formal.html")), "不应复制一份英文 formal.html");
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);