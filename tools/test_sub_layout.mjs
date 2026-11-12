#!/usr/bin/env node
// 订阅区真浏览器闸门：375×812 与 390×844 × 三语，量五件事：
//   1) 整页不横向滚动（scrollWidth ≤ clientWidth）
//   2) 免费态 #subShowcase 里，信任句在按钮上方、间距 ≤40px
//   3) 交付节律四个节点竖排、每个节点一行（节点内文字不换行）
//   4) 价格块在 visible:false 时不出现；页面上不出现 undefined / null 字面量
//   5) 三语切过去，订阅区不夹中文
// 跑法：node tools/test_sub_layout.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome：布局断言必须真跑，不接受只断言字符串");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.waiting = new Map(); }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error("调试口连不上：" + (e.message || "")));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.waiting.has(msg.id)) {
          const { resolve: r, reject: j } = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          msg.error ? j(new Error(msg.error.message)) : r(msg.result);
        }
      };
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sublayout-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 120 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
        target = list.find((t) => t.type === "page");
      } catch {}
      if (!target) await sleep(100);
    }
    assert.ok(target && target.webSocketDebuggerUrl, "拿不到页面调试地址");
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    try { return await fn(cdp); } finally { cdp.close(); }
  } finally {
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

const VIEWPORTS = [
  { w: 375, h: 812 },
  { w: 390, h: 844 },
];
const LANGS = ["zh", "en", "es"];

const SETUP = `(() => {
  // 免费态、已生成清单、停在第三步：这是 #subShowcase 唯一出现的状态
  packet = newPacket();
  packet.lastYear = [{ form: "W-2", payer: "Acme" }];
  packet.checklist = [
    { form: "W-2", title: "今年 W-2（按去年每个雇主）", payer: "Acme", status: "uploaded" },
    { form: "1099-INT", title: "今年 1099-INT（按去年每个付款方）", payer: "Bank", status: "pending" }
  ];
  savePacket();
  return true;
})()`;

const MEASURE_SHOWCASE = `(() => {
  const d = document.documentElement;
  const sc = document.getElementById("subShowcase");
  const trust = sc ? sc.querySelector(".sub-trust") : null;
  const btn = sc ? sc.querySelector(".sub-cta button") : null;
  const tr = trust ? trust.getBoundingClientRect() : null;
  const br = btn ? btn.getBoundingClientRect() : null;
  let trustLines = 0;
  if (trust) {
    const rg = document.createRange();
    rg.selectNodeContents(trust);
    trustLines = new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size;
  }
  return JSON.stringify({
    sw: d.scrollWidth, cw: d.clientWidth,
    showcaseHidden: sc ? getComputedStyle(sc).display === "none" : null,
    trustVisible: trust ? getComputedStyle(trust).display !== "none" && tr.height > 0 : false,
    trustToBtn: tr && br ? Math.round(br.top - tr.bottom) : null,
    trustLines,
    showcaseText: sc ? sc.innerText : "",
  });
})()`;

const MEASURE_CARD = `(() => {
  const d = document.documentElement;
  const lines = [];
  const lis = [...document.querySelectorAll(".sub-timeline li")];
  for (const li of lis) {
    const b = li.querySelector("b");
    const span = li.querySelector("span");
    const r = li.getBoundingClientRect();
    // 用 Range 数正文换了几行：同一 top 视为同一行
    let tops = [];
    if (span) {
      const rg = document.createRange();
      rg.selectNodeContents(span);
      tops = [...rg.getClientRects()].map((x) => Math.round(x.top));
    }
    lines.push({
      text: li.textContent.replace(/\\s+/g, " ").trim(),
      h: Math.round(r.height),
      bTop: b ? Math.round(b.getBoundingClientRect().top) : null,
      spanTop: tops.length ? tops[0] : null,
      spanLines: new Set(tops).size,
    });
  }
  const pricing = document.getElementById("pricingTiers");
  const sub = document.getElementById("subCard");
  const tl = document.querySelector(".sub-timeline");
  const cardTrust = sub ? sub.querySelector(".plan-guide .sub-trust") : null;
  return JSON.stringify({
    sw: d.scrollWidth, cw: d.clientWidth,
    lines,
    pricingHidden: pricing ? getComputedStyle(pricing).display === "none" : null,
    pricingLoaded: !!(window.PRICING && window.PRICING.tiers && window.PRICING.tiers.length),
    pricingText: pricing ? pricing.textContent.trim() : null,
    bad: /undefined|null|NaN/.test(document.body.innerText) ? document.body.innerText.match(/.{0,20}(undefined|null|NaN).{0,20}/)[0] : null,
    newText: [tl ? tl.innerText : "", cardTrust ? cardTrust.innerText : "", pricing ? pricing.innerText : ""].join(" | "),
    subText: sub ? sub.innerText : "",
  });
})()`;

const got = await withChrome(async (cdp) => {
  // 走 http 而不是 file://：价格块靠 fetch pricing.json，file:// 下会被浏览器拦掉，
  // 那样「价格块不出现」就分不清是 visible:false 还是没取到。
  const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "formal.html";
    const p = path.join(root, rel);
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  await cdp.send("Page.enable");
  const out = [];
  try {
    for (const vp of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: true });
      await cdp.send("Page.navigate", { url: base + "/formal.html?lang=zh" });
      await sleep(1100);
      await cdp.send("Runtime.evaluate", { expression: SETUP });
      // 第三步：清单卡与展示卡都在这一屏
      await cdp.send("Runtime.evaluate", { expression: "setOrganizeStep(3,false);renderAll();renderHero();" });
      await sleep(300);
      for (const lang of LANGS) {
        await cdp.send("Runtime.evaluate", { expression: "setLang(" + JSON.stringify(lang) + ");setOrganizeStep(3,false);renderHero();" });
        await sleep(350);
        const a = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: MEASURE_SHOWCASE });
        // 订阅页：交付节律与价格块在这一页
        await cdp.send("Runtime.evaluate", { expression: "showPage(2);" });
        await sleep(350);
        const b = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: MEASURE_CARD });
        await cdp.send("Runtime.evaluate", { expression: "showPage(1);" });
        out.push({ vp, lang, a: JSON.parse(a.result.value), m: JSON.parse(b.result.value) });
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  return out;
});

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}
const CJK = /[\u4e00-\u9fff]/;

for (const r of got) {
  const label = r.vp.w + "×" + r.vp.h + " · " + r.lang;
  check("不横向溢出（整理页 + 订阅页）：" + label, () => {
    assert.equal(r.a.cw, r.vp.w, "视口不是 " + r.vp.w);
    assert.ok(r.a.sw <= r.a.cw, "整理页被撑宽：scrollWidth=" + r.a.sw);
    assert.ok(r.m.sw <= r.m.cw, "订阅页被撑宽：scrollWidth=" + r.m.sw);
  });
  check("免费态展示卡可见、信任句在按钮上方 ≤40px：" + label, () => {
    assert.equal(r.a.showcaseHidden, false, "展示卡在免费态没出来");
    assert.ok(r.a.trustVisible, "信任句没显示");
    assert.ok(r.a.trustToBtn != null, "量不到信任句与按钮的间距");
    assert.ok(r.a.trustToBtn >= 0 && r.a.trustToBtn <= 40, "间距 " + r.a.trustToBtn + "px 超出 0–40");
  });
  if (r.lang === "zh") {
    check("中文信任句在手机上是一行：" + label, () => {
      assert.equal(r.a.trustLines, 1, "信任句换成了 " + r.a.trustLines + " 行");
    });
  }
  check("交付节律四个节点、竖排、每个一行：" + label, () => {
    assert.equal(r.m.lines.length, 4, "节点数不是 4");
    for (const li of r.m.lines) {
      assert.equal(li.spanLines, 1, "节点正文换行了：" + li.text + "（" + li.spanLines + " 行）");
      // 基线对齐下标签与正文的盒子顶边会差 1–2px，量的是同一行
      assert.ok(Math.abs(li.bTop - li.spanTop) <= 6, "标签与正文不在同一行：" + li.text + "（" + li.bTop + " vs " + li.spanTop + "）");
      assert.ok(li.h <= 46, "节点高 " + li.h + "px，超过单行：" + li.text);
    }
  });
  check("价格块在 visible:false 时不出现（pricing.json 已取到）：" + label, () => {
    assert.equal(r.m.pricingLoaded, true, "pricing.json 没取到，这条不算数");
    assert.equal(r.m.pricingHidden, true, "价格块露出来了：" + r.m.pricingText);
  });
  check("页面没有 undefined / null 字面量：" + label, () => {
    assert.equal(r.m.bad, null, "出现字面量：" + r.m.bad);
  });
  if (r.lang !== "zh") {
    check("本轮新增的订阅文案不夹中文（两页）：" + label, () => {
      assert.ok(!CJK.test(r.a.showcaseText), "整理页展示卡夹中文：" + r.a.showcaseText.replace(/\n/g, " | ").slice(0, 200));
      assert.ok(!CJK.test(r.m.newText), "订阅页新增块夹中文：" + r.m.newText.replace(/\n/g, " | ").slice(0, 200));
    });
  }
}

let bad = 0;
for (const [tag, msg] of results) { if (tag !== "ok  ") bad++; console.log(tag, msg); }
console.log("\n实测：");
for (const r of got) {
  const heights = r.m.lines.map((x) => x.h).join("/");
  console.log("  " + (r.vp.w + "×" + r.vp.h + " " + r.lang).padEnd(14) +
    " 信任句→按钮 " + String(r.a.trustToBtn).padStart(3) + "px" +
    " · 节点高 " + heights.padEnd(12) + " · 整理页 " + r.a.sw + "/" + r.a.cw +
    " · 订阅页 " + r.m.sw + "/" + r.m.cw);
}
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);