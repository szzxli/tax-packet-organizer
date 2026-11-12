#!/usr/bin/env node
// 窄屏闸门：375×812 真浏览器（真 Chrome 调试口设视口），量四件事：
//   1) documentElement.scrollWidth <= clientWidth（整页不许横向滚动）
//   2) 首屏三块（开放期 + IRS 事件条 + 结论条）合计：付费态 ≤380px、免费态 ≤260px
//      2026-11-12 起首屏多了一块「医保开放期」，实测付费 321–363px、免费 238px，上限按实测 +20px 留余量
//   3) 空态不出现任何算出来的金额（0 个 $ 数字）
//   4) 长 token 兜底：.one-thing 里塞超长 URL 也不许撑宽
// 三种状态 × 三语：付费有输入 / 免费有输入 / 空态；另加长 token 一格。
// 跑法：node tools/test_narrow.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");
const graph = JSON.parse(fs.readFileSync(path.join(root, "rules", "graph.json"), "utf8"));

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome：窄屏断言必须真跑布局，不接受只断言字符串");
  process.exit(2);
}

const store = {};
const sandbox = {
  LANG: "zh", packet: null, console, Math, Number, String, Object, Array, JSON,
  parseInt, parseFloat, isFinite, Infinity, Date,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
  tr: (zh, en, es) => (sandbox.LANG === "en" ? en : sandbox.LANG === "es" ? es : zh),
  procProfileLoad: () => ({ ssPoints: "34", eduUsed: "1" }),
};
vm.createContext(sandbox);
sandbox.RULES = graph;
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
vm.runInContext(slice("// PLAN_CARDS_LOGIC_START", "// PLAN_CARDS_LOGIC_END"), sandbox);
vm.runInContext(slice("// OUTLOOK_LOGIC_START", "// OUTLOOK_LOGIC_END"), sandbox);

const STYLES = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
assert.ok(STYLES.includes(".one-thing"), "没抽到 .one-thing 的样式");

const FILLED = { status: "single", dep: "1", income: "85000", withheld: "9000", tuition: "20000", retire: "", mkt: "", premium: "", mortgage: "" };
const EMPTY = { status: "single", dep: "", income: "", withheld: "", tuition: "", retire: "", mkt: "", premium: "", mortgage: "" };

function cardHtml(lang, unlocked, profile, state) {
  sandbox.LANG = lang;
  sandbox.procProfileLoad = () => profile;
  sandbox.localStorage.setItem("tpo_outlook", JSON.stringify(state));
  return sandbox.outlookHtml(unlocked);
}
function longTokenHtml() {
  const url = "https://www.federalregister.gov/documents/2026/10/26/2026-21796/cost-of-living-increase-and-other-determinations-for-2027";
  return '<div id="policyBar" class="one-thing"><p class="small muted">' + url + "</p></div>";
}
function pageFor(inner) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${STYLES}</style>
<style>html,body{margin:0;padding:0}</style>
</head><body>
<div style="padding:0 12px"><div class="card" style="padding:12px;box-sizing:border-box">${inner}</div></div>
</body></html>`;
}

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "narrow-profile-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来（没有 DevToolsActivePort）");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
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

async function measure(cdp, inner) {
  const file = path.join(os.tmpdir(), "narrow-" + Math.random().toString(36).slice(2) + ".html");
  fs.writeFileSync(file, pageFor(inner), "utf8");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: "file://" + file });
  await sleep(400);
  const res = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const d = document.documentElement;
      const one = document.getElementById("outlookOneThing");
      const bar = document.getElementById("policyBar");
      const oe = document.getElementById("openEnrollBar");
      const main = document.getElementById("outlookMain");
      const h = (el) => el ? Math.round(el.getBoundingClientRect().height) : null;
      return JSON.stringify({
        sw: d.scrollWidth, cw: d.clientWidth,
        hBar: h(bar), hOne: h(one), hOE: h(oe),
        mainHidden: main ? main.classList.contains("hidden") : null
      });
    })()`,
  });
  fs.rmSync(file, { force: true });
  return JSON.parse(res.result.value);
}

const CASES = [
  { key: "paid", name: "付费有输入", unlocked: true, profile: { ssPoints: "34", eduUsed: "1" }, state: FILLED },
  { key: "free", name: "免费有输入", unlocked: false, profile: { ssPoints: "34", eduUsed: "1" }, state: FILLED },
  { key: "empty", name: "空态", unlocked: true, profile: { ssPoints: "", eduUsed: "" }, state: EMPTY },
];
const LANGS = ["zh", "en", "es"];

const got = await withChrome(async (cdp) => {
  const out = [];
  for (const lang of LANGS) {
    for (const c of CASES) {
      const inner = cardHtml(lang, c.unlocked, c.profile, c.state);
      out.push({ lang, case: c, inner, box: await measure(cdp, inner) });
    }
    out.push({ lang, case: { key: "long", name: "长 token 兜底" }, inner: longTokenHtml(), box: await measure(cdp, longTokenHtml()) });
  }
  return out;
});

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}

for (const r of got) {
  const label = r.lang + " · " + r.case.name;
  check("375 视口不横向溢出：" + label, () => {
    assert.equal(r.box.cw, 375, "视口不是 375（实际 " + r.box.cw + "）");
    assert.ok(r.box.sw <= r.box.cw, "整页被撑宽：scrollWidth=" + r.box.sw + " > clientWidth=" + r.box.cw);
  });
  if (r.case.key === "paid") {
    check("首屏三块合计 ≤380px：" + r.lang, () => {
      const sum = (r.box.hBar || 0) + (r.box.hOne || 0) + (r.box.hOE || 0);
      assert.ok(r.box.hBar != null && r.box.hOne != null, "没量到两块高度");
      assert.ok(sum <= 380, "实测 开放期 " + r.box.hOE + " + 事件条 " + r.box.hBar + " + 结论条 " + r.box.hOne + " = " + sum + "px > 380px");
    });
  }
  if (r.case.key === "free") {
    check("首屏三块合计 ≤260px（免费）：" + r.lang, () => {
      const sum = (r.box.hBar || 0) + (r.box.hOne || 0) + (r.box.hOE || 0);
      assert.ok(sum <= 380, "实测 开放期 " + r.box.hOE + " + 事件条 " + r.box.hBar + " + 结论条 " + r.box.hOne + " = " + sum + "px > 380px");
    });
  }
  if (r.case.key === "empty") {
    check("空态不出算出来的金额：" + r.lang, () => {
      assert.ok(!/\$[\d]/.test(r.inner), "空态出现金额：" + r.inner.slice(0, 200));
      assert.ok(!r.inner.includes('id="btnOutlookGo"'), "空态还渲染了多余的主按钮");
      assert.ok(r.inner.includes('id="outlookInputs"'), "空态没有输入区");
      assert.equal(r.box.mainHidden, null, "空态还把估算/地图那块渲染出来了");
      // 空态现在必须有事件条（政策变化不藏在填数之后）——见上面那条断言
      assert.equal(r.box.hOne, null, "空态还渲染了常驻结论条");
    });
  }
}

let bad = 0;
for (const [tag, msg] of results) { if (tag !== "ok  ") bad++; console.log(tag, msg); }
console.log("\n实测高度：");
for (const r of got) {
  const sum = (r.box.hBar || 0) + (r.box.hOne || 0) + (r.box.hOE || 0);
  console.log("  " + (r.lang + " · " + r.case.name).padEnd(20) + " 开放期=" + String(r.box.hOE).padStart(4) + "px  事件条=" + String(r.box.hBar).padStart(4) + "px  结论条=" + String(r.box.hOne).padStart(4) + "px  合计=" + String(sum).padStart(4) + "px  " + r.box.sw + "/" + r.box.cw);
}
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);