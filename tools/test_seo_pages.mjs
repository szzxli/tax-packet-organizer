#!/usr/bin/env node
// 验收：根路径下的四篇英文搜索页（单语页面，不写 hreflang）。
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

check("四篇在根路径，样式、sitemap、robots 都在", () => {
  for (const s of SLUGS) assert.ok(fs.existsSync(path.join(root, `${s}.html`)), `缺 ${s}.html`);
  for (const f of ["seo.css", "sitemap.xml", "robots.txt"]) {
    assert.ok(fs.existsSync(path.join(root, f)), `缺 ${f}`);
  }
});

check("不再有语言目录与 hreflang", () => {
  assert.ok(!fs.existsSync(path.join(root, "en")), "en/ 目录应已删除");
  assert.ok(!fs.existsSync(path.join(root, "es")), "es/ 目录不该存在");
  for (const s of SLUGS) assert.ok(!/hreflang/i.test(read(`${s}.html`)), `${s} 里还有 hreflang`);
});

for (const slug of SLUGS) {
  const html = read(`${slug}.html`);
  const url = `${BASE}/${slug}.html`;
  const body = visibleText(html);

  check(`${slug}: lang=en、单一 canonical 指向自己`, () => {
    assert.match(html, /<html lang="en">/);
    const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(canon.length, 1, "canonical 只能有一条");
    assert.equal(canon[0], url);
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
    const html = read(`${slug}.html`);
    assert.ok(!/nationwide/i.test(visibleText(html)), `${slug} 出现 nationwide`);
    assert.ok(!/\$\d/.test(visibleText(html)), `${slug} 出现金额`);
  }
  assert.match(read("tax-document-checklist.html"), /state items for your state aren't covered in this version/);
});

check("sitemap 只列中文入口与四篇英文页，URL 都有对应文件", () => {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 5, `应有 5 条，实际 ${locs.length}`);
  assert.ok(locs.includes(`${BASE}/formal.html`));
  for (const s of SLUGS) assert.ok(locs.includes(`${BASE}/${s}.html`), `sitemap 缺 ${s}`);
  for (const u of locs) {
    const file = u.replace(BASE + "/", "");
    assert.ok(fs.existsSync(path.join(root, file)), `sitemap 里的 ${u} 没有对应文件`);
  }
  assert.ok(!/hreflang|xhtml:link/.test(xml), "sitemap 不该有多语言交替标记");
});

check("robots.txt 指向 sitemap", () => {
  assert.match(read("robots.txt"), new RegExp(`Sitemap: ${BASE}/sitemap.xml`));
});

check("四篇互相链接，能走到整理器与中文页", () => {
  for (const slug of SLUGS) {
    const html = read(`${slug}.html`);
    for (const other of SLUGS) {
      if (other === slug) continue;
      assert.ok(html.includes(`href="./${other}.html"`), `${slug} 没链到 ${other}`);
    }
    assert.ok(html.includes(`${BASE}/formal.html?lang=en`), `${slug} 缺整理器入口`);
    assert.ok(html.includes("./formal.html?lang=zh"), `${slug} 缺中文入口`);
  }
});

check("中文根路径与已发链接未被改动", () => {
  const index = read("index.html");
  assert.match(index, /location\.replace\("\.\/formal\.html"/);
  assert.match(index, /<link rel="canonical" href="\.\/formal.html">/);
  assert.ok(!fs.existsSync(path.join(root, "en/formal.html")), "不应复制一份英文 formal.html");
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);