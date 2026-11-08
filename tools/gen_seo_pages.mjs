#!/usr/bin/env node
// 生成 /en/ 搜索页、sitemap.xml、robots.txt。
// 文案集中在本文件的 PAGES 里：市场改稿只改这里，跑一次 `node tools/gen_seo_pages.mjs` 即可。
// 加西语/中文版本时给 PAGES 补 es / zh 字段，hreflang 会自动带上。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://szzxli.github.io/tax-packet-organizer";
const TODAY = new Date().toISOString().slice(0, 10);

const DISCLAIMER = `"Ready to hand over" means the documents are complete enough to give your preparer for review. It does not mean the return is correct or ready to file. We check structure only: is the form there, are the numbers filled in, do the counts match, is there a receipt. We do not verify the numbers, compute tax, or judge eligibility.`;

const COVERAGE = "Federal checklist works everywhere; state items for your state aren't covered in this version.";

const ORGANIZER = `${BASE}/formal.html?lang=en`;

const PAGES = [
  {
    slug: "tax-document-checklist",
    title: "Tax Document Checklist: What You Need Before You File",
    desc: "The documents most people need before filing, in one checklist: last year's return, this year's income forms, what changed, and the proof behind each number.",
    h1: "Tax Document Checklist: What You Need Before You File",
    lede: "Filing starts as a gathering job. Before anyone looks at a number, you need the paper that carries it. This is the checklist we build in, in the order that keeps you from making a second trip through your files.",
    blocks: [
      {
        h2: "1. Start from last year's return",
        p: "Last year's return is the shortest path to this year's list. Every form that carried a figure last year probably exists again this year. Read the return line by line and write down the form number and the payer next to each line: W-2 from each employer, 1099-INT from each bank, 1099-DIV from each brokerage, 1099-R from each plan, SSA-1099, K-1 from each entity.",
        list: [
          "Each employer that issued a W-2",
          "Each bank or credit union that paid interest",
          "Each brokerage that paid dividends or sold securities",
          "Each retirement plan or annuity that paid out",
          "Each partnership, S corp or trust that issued a K-1",
        ],
      },
      {
        h2: "2. Add the forms that came from work, not from an employer",
        p: "If you worked for yourself, drove for a platform, rented out a property, or sold online, the forms arrive in a different rhythm and often later. Collect the 1099-NEC and 1099-MISC by client, the 1099-K by platform, and the 1099-S from a closing. Gather the monthly statements too: the form gives a total, but the fee, refund and cost lines you need usually sit in the statements.",
      },
      {
        h2: "3. Add what changed this year",
        p: "Changes create documents that last year's return does not predict. A child, a marriage, a move to another state, a home sale, a first year of tuition or childcare each brings its own paper. List the change first, then the document it produces. This is the step people skip, and it is where missing items come from.",
        list: [
          "New dependent: birth record, care provider statement, school record",
          "Home sold: closing statement and the 1099-S",
          "Tuition: Form 1098-T from each school",
          "Childcare: provider statement with the provider's tax ID",
          "Moved states: dates, both addresses, and each state's withholding",
        ],
      },
      {
        h2: "4. Put proof behind every number",
        p: "A form states a total. A receipt, statement or closing document shows what the total is made of. Keep one proof item per figure you plan to report, and mark the ones you cannot find yet — an item you know is missing is easier to handle in December than in April.",
      },
      {
        h2: "5. What this checklist does not do",
        p: "It does not decide whether you qualify for anything, it does not compute tax, and it does not tell you what to file. It lists what to gather and shows what is still missing, so the person who does review it starts from a complete packet instead of a shoebox.",
      },
    ],
    scope: COVERAGE,
    cta: { label: "Build the checklist", note: "Free, no login needed. The list is generated on your device and exports as a printable one-pager." },
  },
  {
    slug: "form-1095-a-and-8962",
    title: "Form 1095-A and Form 8962: How They Pair Up",
    desc: "Form 1095-A comes from the health insurance Marketplace; Form 8962 reconciles the premium tax credit. Why they travel together, and what to do when one is missing.",
    h1: "Form 1095-A and Form 8962: How They Pair Up",
    lede: "These two forms do different jobs and only make sense together. One reports what your Marketplace plan cost and what was paid toward it during the year. The other reconciles that with what you were entitled to. If you had Marketplace coverage, both belong in the packet.",
    blocks: [
      {
        h2: "What Form 1095-A actually reports",
        p: "The 1095-A is the Health Insurance Marketplace Statement. It comes from the Marketplace, not from the insurer, and it is issued for the coverage year. It lists who was covered, the months of coverage, the monthly premium, the benchmark plan premium for your area, and any advance payment of the premium tax credit that went straight to the insurer.",
        list: [
          "Recipient and covered individuals, with the months each was covered",
          "Monthly enrollment premiums",
          "Monthly second lowest cost silver plan (SLCSP) premium",
          "Monthly advance payment of the premium tax credit",
        ],
      },
      {
        h2: "What Form 8962 does with it",
        p: "Form 8962 is the reconciliation. It compares the advance credit that was paid on your behalf with the credit your actual household income and family size support. If too much was paid, the difference is repaid; if too little, the difference is claimed. The arithmetic needs the monthly figures from the 1095-A, which is why the pair is filed together.",
      },
      {
        h2: "The three things to check before you hand both over",
        p: "Most problems with this pair are clerical, and they are cheap to catch early.",
        list: [
          "The year on the 1095-A matches the return you are filing",
          "Every month of coverage is listed, including months with a zero premium",
          "The people listed match the people on the return, including a child who turned 26 mid-year or a spouse added after a life event",
        ],
      },
      {
        h2: "If the 1095-A is missing",
        p: "It is not mailed to everyone who had Marketplace coverage. Sign in to your Marketplace account, open the tax forms section, and download the 1095-A for the coverage year. If you switched plans or moved mid-year, you may have more than one. If your coverage came through an employer, a 1095-B or 1095-C is the document you have instead, and it plays a different role.",
      },
      {
        h2: "If the numbers do not line up",
        p: "Do not adjust a figure to make it fit. A mismatch between the advance credit and the 8962 is a question for a preparer, not a rounding problem. Flag it, keep the 1095-A, and let the person reviewing the packet decide. Structure first, numbers second.",
      },
    ],
    cta: { label: "Check a 1095-A / 8962 pair", note: "The subsidy card is free: enter the three monthly figures and see whether the pair lines up before you hand it over." },
  },
  {
    slug: "1099-k-venmo-paypal-ebay",
    title: "1099-K From Venmo, PayPal or eBay: What to Do With It",
    desc: "A 1099-K reports gross payment volume, not profit. What the form includes, what it leaves out, and which records to keep so the total makes sense to your preparer.",
    h1: "1099-K From Venmo, PayPal or eBay: What to Do With It",
    lede: "A 1099-K is the least intuitive form in a gig packet. It reports money that moved through a payment platform, and the number on it is usually larger than what you actually earned. That is not an error — it is what the form measures.",
    blocks: [
      {
        h2: "What the form measures",
        p: "A 1099-K reports the gross amount of payments you received through a payment card or a third-party network, by calendar year. Gross means before fees, before refunds, before shipping, and before the cost of whatever you sold. Nothing on the form subtracts anything, which is why the total can look alarming next to your bank balance.",
      },
      {
        h2: "Which threshold applies to you",
        p: "The reporting threshold has changed more than once in recent years, and it can differ by state. Check the current threshold on irs.gov before you assume a platform should or should not have issued a form. A platform that issues one below the federal threshold may be following its own state rule.",
      },
      {
        h2: "Personal payments should not be on it",
        p: "Money sent between friends and family is not reportable income. Platforms have been tightening how they separate personal from business payments, but misclassification still happens — a roommate's share of rent, a split dinner, a family transfer. If a personal payment shows up in the total, keep the note that identifies it, and raise it with the person reviewing your return rather than netting it out yourself.",
      },
      {
        h2: "The records that make the total usable",
        p: "The 1099-K gives one number. Your records turn it into an explanation.",
        list: [
          "Monthly statements per platform, so a partial-year figure does not look like a full-year one",
          "Fees the platform deducted, listed separately",
          "Refunds and cancelled orders",
          "Cost of goods or supplies bought for resale",
          "Mileage or delivery records if the work involved driving",
          "A list of the personal transfers included in the total, with dates",
        ],
      },
      {
        h2: "If the total is clearly wrong",
        p: "Ask the platform for a corrected form rather than editing the figure. Keep the request. If the corrected form arrives after your packet is assembled, add it to the same item instead of starting a new one, so the packet keeps one thread per issue.",
      },
    ],
    cta: { label: "Check each platform one by one", note: "Add a 1099-K per platform and the missing-item list shows what still has no record behind it." },
  },
  {
    slug: "what-to-bring-to-your-cpa",
    title: "What to Bring to Your CPA: A One-Page Intake Sheet",
    desc: "The one-page intake sheet a preparer can read in two minutes: identity, last year's return, income by source, what changed this year, and the questions you want answered.",
    h1: "What to Bring to Your CPA: A One-Page Intake Sheet",
    lede: "A preparer's first question is not about your income. It is about how much of the packet is already in order. One page beats a folder, because a folder makes them ask the same six questions they ask every client.",
    blocks: [
      {
        h2: "The page, in five sections",
        p: "Keep it to one side of a page. Anything longer stops being read and becomes another document to sort.",
        list: [
          "Who: filing status, dependents, states you lived in and the dates",
          "Last year: a copy of last year's return, or the form numbers and payers if you do not have the copy",
          "This year's income: one line per source, with the form number and the payer, and a mark for what is still missing",
          "What changed: one line per change, and the document each change produces",
          "Questions: the three things you actually want answered, written before the meeting",
        ],
      },
      {
        h2: "What belongs in the packet, not on the sheet",
        p: "The sheet is an index. The forms, statements and receipts go behind it, in the same order as the lines on the sheet. If the preparer has to hunt for the support behind line four, the sheet has failed.",
      },
      {
        h2: "Send the index first, the documents second",
        p: "Email the one-page sheet before the meeting and bring the documents with you, or upload them to whatever secure portal the firm uses. Do not email a full return, a Social Security number or account numbers. A preparer who sees the index in advance arrives with the right questions instead of a blank form.",
      },
      {
        h2: "Mark what is missing before you hand it over",
        p: "A line you know is incomplete is worth more than a line you guessed at. Mark it, name what is missing, and say when you expect it. Preparers price work by how much has to be chased; a packet that declares its own gaps is faster and cheaper to review.",
      },
      {
        h2: "Why a structure list instead of a shoebox",
        p: "Nothing here decides whether a document is correct, and nothing here computes anything. The index only answers one question: is the paper for each line present, filled in, counted and supported. That is the question a preparer asks first, and it is the one you can answer before the meeting.",
      },
    ],
    scope: COVERAGE,
    cta: { label: "Print the intake sheet", note: "The handoff sheet exports with the checklist, one page, ready to sign and give to your preparer." },
  },
];

const INDEX = {
  title: "Tax document guides for US filers | ClearToFile",
  desc: "Short, practical guides on tax documents: the pre-filing checklist, Form 1095-A and 8962, 1099-K from payment platforms, and the one-page sheet to bring to your CPA.",
  h1: "Tax documents, in plain order",
  lede: "Four guides, each answering one question about the paper you need before you file. No tax calculations, no eligibility calls — just what to gather and what is usually missing.",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `*{box-sizing:border-box}
body{margin:0;background:#f6f8fa;color:#1b2733;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:#14507e}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header.site{background:#16324f;color:#fff;padding:14px 0}
header.site .wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brand{font-weight:700;font-size:18px;color:#fff;text-decoration:none;letter-spacing:.2px}
header.site nav{display:flex;gap:14px;flex-wrap:wrap;font-size:14px;margin-left:auto}
header.site nav a{color:#cfe0f0;text-decoration:none}
header.site nav a:hover{color:#fff;text-decoration:underline}
main{padding:32px 0 8px}
h1{font-size:32px;line-height:1.25;margin:0 0 14px;color:#16324f;letter-spacing:-.2px}
.lede{font-size:17px;color:#39485a;margin:0 0 26px}
h2{font-size:20px;margin:30px 0 8px;color:#16324f}
p{margin:0 0 12px}
ul{margin:8px 0 14px;padding-left:20px}
li{margin:5px 0}
.note{background:#fff;border:1px solid #dde5ec;border-left:4px solid #2a6db0;border-radius:8px;padding:12px 14px;margin:18px 0;font-size:14px;color:#39485a}
.cta{background:#16324f;color:#fff;border-radius:12px;padding:20px;margin:30px 0}
.cta p{margin:0 0 12px;color:#d7e4f0;font-size:14px}
.cta a.btn{display:inline-block;background:#fff;color:#16324f;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:9px}
footer.site{border-top:1px solid #dde5ec;margin-top:26px;padding:22px 0 40px;font-size:13px;color:#5a6b7d}
footer.site p{margin:0 0 10px}
footer.site a{color:#14507e}
.cards{display:grid;gap:14px;margin:22px 0}
.card{display:block;background:#fff;border:1px solid #dde5ec;border-radius:12px;padding:16px 18px;text-decoration:none}
.card strong{display:block;color:#16324f;font-size:17px;margin-bottom:4px}
.card span{color:#4a5a6b;font-size:14px}
.card:hover{border-color:#2a6db0}
@media(max-width:600px){h1{font-size:25px}main{padding:22px 0 0}}`;

function head({ title, desc, canonical, alternates, cssPath }) {
  const alts = alternates
    .map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${a.href}">`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
${alts}
<meta property="og:type" content="article">
<meta property="og:site_name" content="ClearToFile">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="${cssPath}">
</head>
<body>
<header class="site"><div class="wrap">
<a class="brand" href="./">ClearToFile</a>
<nav>
<a href="./">All guides</a>
<a href="${ORGANIZER}">Open the organizer</a>
<a href="../formal.html?lang=zh" hreflang="zh-CN" lang="zh-CN">中文</a>
</nav>
</div></header>
<main class="wrap">`;
}

function foot() {
  return `</main>
<footer class="site"><div class="wrap">
<p>${DISCLAIMER}</p>
<p>ClearToFile organizes documents into a checklist. It does not calculate tax, file a return, or give tax advice. <a href="${ORGANIZER}">Open the organizer</a> · <a href="./">All guides</a></p>
</div></footer>
</body>
</html>
`;
}

function renderPage(p) {
  const canonical = `${BASE}/en/${p.slug}.html`;
  const alternates = [
    { lang: "en", href: canonical },
    { lang: "x-default", href: canonical },
  ];
  const body = p.blocks
    .map((b) => {
      const list = b.list ? `\n<ul>\n${b.list.map((li) => `<li>${esc(li)}</li>`).join("\n")}\n</ul>` : "";
      const para = b.p ? `\n<p>${esc(b.p)}</p>` : "";
      return `<h2>${esc(b.h2)}</h2>${para}${list}`;
    })
    .join("\n\n");
  const scope = p.scope ? `\n<p class="note">${esc(p.scope)}</p>\n` : "";
  const ref = `seo-${p.slug}`;
  return `${head({ title: p.title, desc: p.desc, canonical, alternates, cssPath: "./seo.css" })}
<h1>${esc(p.h1)}</h1>
<p class="lede">${esc(p.lede)}</p>

${body}
${scope}
<div class="cta">
<p>${esc(p.cta.note)}</p>
<a class="btn" href="${ORGANIZER}&amp;ref=${ref}">${esc(p.cta.label)}</a>
</div>
${foot()}`;
}

function renderIndex() {
  const canonical = `${BASE}/en/`;
  const alternates = [
    { lang: "en", href: canonical },
    { lang: "x-default", href: canonical },
  ];
  const cards = PAGES.map(
    (p) => `<a class="card" href="./${p.slug}.html"><strong>${esc(p.title)}</strong><span>${esc(p.desc)}</span></a>`
  ).join("\n");
  return `${head({ title: INDEX.title, desc: INDEX.desc, canonical, alternates, cssPath: "./seo.css" })}
<h1>${esc(INDEX.h1)}</h1>
<p class="lede">${esc(INDEX.lede)}</p>
<div class="cards">
${cards}
</div>
<div class="cta">
<p>Build this year's document checklist on your device, free, no login. Export it as a printable one-pager for your preparer.</p>
<a class="btn" href="${ORGANIZER}&amp;ref=seo-index">Open the organizer</a>
</div>
${foot()}`;
}

function write(file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log("wrote " + file);
}

write("en/seo.css", CSS);
write("en/index.html", renderIndex());
for (const p of PAGES) write(`en/${p.slug}.html`, renderPage(p));

const urls = [`${BASE}/formal.html`, `${BASE}/en/`, ...PAGES.map((p) => `${BASE}/en/${p.slug}.html`)];
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`
);

write(
  "robots.txt",
  `User-agent: *
Allow: /
Sitemap: ${BASE}/sitemap.xml
`
);

console.log(`\n${PAGES.length} guides + index, ${urls.length} sitemap URLs`);