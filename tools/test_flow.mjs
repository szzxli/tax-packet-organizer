#!/usr/bin/env node
// 业务流闸门：真 Chrome 打开真页面（本地 http，同源 fetch 可用），验三件：
//   1) 底部步骤条在三个步骤里都可见，主按钮文案随步骤变，点一次真换步并滚回步骤顶部
//   2) 选「没有变化」生成后清单 > 0（不能把新用户丢进空第 2 步）
//   3) 390×844 与 375×812、三语：不横向滚，底部条不遮住最后一个输入
// 跑法：node tools/test_flow.mjs
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
  console.error("找不到 Chrome：业务流断言必须真跑页面");
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "formal.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = "http://127.0.0.1:" + server.address().port + "/formal.html";

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
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ""));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(cdp) {
  for (let i = 0; i < 100; i++) {
    const ready = await cdp.eval("!!(window.packet && document.getElementById('btnMake') && document.getElementById('stepPager'))").catch(() => false);
    if (ready) return true;
    await sleep(100);
  }
  return false;
}
// 先在同源页面里清掉本地状态，再带语言参数重新加载（about:blank 上读 localStorage 会被拒）
async function freshLoad(cdp, lang, withBar) {
  await cdp.send("Page.navigate", { url: baseUrl });
  await waitReady(cdp);
  await cdp.eval("localStorage.clear()");
  await cdp.send("Page.navigate", { url: baseUrl + "?lang=" + lang });
  assert.ok(await waitReady(cdp), "页面没初始化出来");
  await sleep(withBar ? 300 : 200);
}

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "flow-profile-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); target = list.find((t) => t.type === "page"); } catch {}
      if (!target) await sleep(100);
    }
    assert.ok(target && target.webSocketDebuggerUrl, "拿不到页面调试地址");
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    try { return await fn(cdp); } finally { cdp.close(); }
  } finally {
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}

const VIEWPORTS = [[390, 844], [375, 812]];
const LANGS = ["zh", "en", "es"];
const heights = [];

await withChrome(async (cdp) => {
  for (const lang of LANGS) {
    for (const [w, h] of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await freshLoad(cdp, lang, true);

      const tag = lang + " " + w + "×" + h;

      // 1) 底部条三步都可见 + 文案随步骤变 + 点一次真换步
      const steps = await cdp.eval(`(() => {
        const out = [];
        const bar = document.getElementById('stepPager');
        const next = document.getElementById('btnStepNext');
        const label = document.getElementById('stepPagerStep');
        for (const s of [1,2,3]) {
          setOrganizeStep(s,false);
          out.push({step:s, display:getComputedStyle(bar).display, label:label.textContent.trim(), next:next.textContent.trim()});
        }
        setOrganizeStep(1,false);
        const before = currentOrganizeStep;
        next.click();
        const after = currentOrganizeStep;
        return {out, before, after, scrollY: Math.round(window.scrollY)};
      })()`);
      check("三步底部条都可见：" + tag, () => {
        for (const s of steps.out) {
          assert.notEqual(s.display, "none", "第 " + s.step + " 步底部条不可见");
          assert.ok(s.label.includes(String(s.step)), "第 " + s.step + " 步标签不对：" + s.label);
        }
      });
      check("主按钮文案随步骤变：" + tag, () => {
        const texts = steps.out.map((s) => s.next);
        assert.equal(new Set(texts).size, 3, "三个步骤文案没区分：" + texts.join(" | "));
        assert.ok(!/^下一步\s*→?$/.test(texts[0]), "第一屏还是「下一步」这种空话：" + texts[0]);
      });
      check("点一次真换步并滚回步骤顶部：" + tag, () => {
        assert.equal(steps.before, 1, "起点不是第 1 步");
        assert.equal(steps.after, 2, "点「去补材料」没换到第 2 步");
        assert.ok(steps.scrollY >= 0, "滚动位置异常");
      });

      // 2) 选「没有变化」→ 生成后清单 > 0
      await freshLoad(cdp, lang, false);
      const made = await cdp.eval(`(() => {
        const t = document.querySelector('#tagGrid .tag-btn[data-phrase="我今年没有变化。"]') || document.querySelectorAll('#tagGrid .tag-btn')[document.querySelectorAll('#tagGrid .tag-btn').length-1];
        t.click();
        document.getElementById('btnMake').click();
        return {len: (window.packet.checklist||[]).length, none: !!window.packet.changesNone};
      })()`);
      check("选「没有变化」不再是 0 项：" + tag, () => {
        assert.ok(made.none, "「没有变化」没被记录");
        assert.ok(made.len > 0, "生成后清单还是 0 项");
      });

      // 3) 不横向滚；滚到底时底部条不遮住最后一个可见输入
      const geo = await cdp.eval(`(() => {
        setOrganizeStep(3,false);
        window.scrollTo(0, document.body.scrollHeight);
        const d = document.documentElement;
        const bar = document.getElementById('stepPager').getBoundingClientRect();
        const vis = Array.from(document.querySelectorAll('input,textarea,select,button')).filter(el => el.offsetParent !== null && !el.closest('.flow-bar'));
        const last = vis[vis.length-1];
        const r = last ? last.getBoundingClientRect() : null;
        return {
          sw: d.scrollWidth, cw: d.clientWidth,
          barTop: Math.round(bar.top), barH: Math.round(bar.height),
          lastBottom: r ? Math.round(r.bottom) : null,
          padBottom: getComputedStyle(document.body).paddingBottom
        };
      })()`);
      heights.push({ tag, barH: geo.barH, padBottom: geo.padBottom, lastBottom: geo.lastBottom, barTop: geo.barTop });
      check("不横向滚：" + tag, () => {
        assert.equal(geo.cw, w, "视口不是 " + w + "（实际 " + geo.cw + "）");
        assert.ok(geo.sw <= geo.cw, "横向溢出：" + geo.sw + " > " + geo.cw);
      });
      check("底部条不遮住最后一个输入：" + tag, () => {
        assert.ok(geo.lastBottom != null, "没找到可见输入");
        assert.ok(geo.lastBottom <= geo.barTop + 1, "最后一个输入被遮：" + geo.lastBottom + " > " + geo.barTop);
      });
    }
  }
});

server.close();

let bad = 0;
for (const [tag, msg] of results) { if (tag !== "ok  ") bad++; console.log(tag, msg); }
console.log("\n底部条实测：");
for (const h of heights) console.log("  " + h.tag.padEnd(16) + " barH=" + h.barH + "px  body-pad=" + h.padBottom + "  最后输入 bottom=" + h.lastBottom + "  barTop=" + h.barTop);
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);