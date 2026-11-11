#!/usr/bin/env node
// 业务流闸门：真 Chrome 打开真页面（本地 http），验五件：
//   1) 全文件没有 #stepPager（不留永远不显示的控件）
//   2) 第 1 步还没清单时，底部条可见、写「第 1 步 / 共 3 步 · 先生成今年清单」、按钮「生成清单」
//   3) 有清单后按钮是「继续补齐材料」，全部备齐后是「导出给会计师」
//   4) 选「没有变化」与「先跳过」，三语都拿到 ≥3 项，新增项人话打头、表号在括号里
//   5) 375×812 与 390×844：不横向滚，底部条不遮住最后一个可见输入
// 跑法：node tools/test_flow.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlSrc = fs.readFileSync(path.join(root, "formal.html"), "utf8");
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
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
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
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || ""));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(cdp) {
  for (let i = 0; i < 100; i++) {
    const ok = await cdp.eval("!!(window.packet && document.getElementById('btnMake') && document.getElementById('stickyProgress'))").catch(() => false);
    if (ok) return true;
    await sleep(100);
  }
  return false;
}
async function freshLoad(cdp, lang) {
  await cdp.send("Page.navigate", { url: baseUrl });
  await waitReady(cdp);
  await cdp.eval("localStorage.clear()");
  await cdp.send("Page.navigate", { url: baseUrl + "?lang=" + lang });
  assert.ok(await waitReady(cdp), "页面没初始化出来");
  await sleep(250);
}

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "flow-profile-"));
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: ["ignore", "ignore", "ignore"] });
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

check("#stepPager 全文件 0 处（不留永远不显示的控件）", () => {
  assert.equal(htmlSrc.indexOf("stepPager"), -1, "还能搜到 stepPager");
});

const VIEWPORTS = [[390, 844], [375, 812]];
const LANGS = ["zh", "en", "es"];
const geoRows = [];

await withChrome(async (cdp) => {
  for (const lang of LANGS) {
    for (const [w, h] of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      const tag = lang + " " + w + "×" + h;
      await freshLoad(cdp, lang);

      // 2) 第 1 步无清单：底部条可见 + 文案 + 按钮
      const empty = await cdp.eval(`(() => {
        const bar = document.getElementById('stickyProgress');
        return {
          display: getComputedStyle(bar).display,
          title: document.getElementById('stickyProgressTitle').textContent.trim(),
          text: document.getElementById('stickyProgressText').textContent.trim(),
          action: document.getElementById('stickyProgressAction').textContent.trim(),
          len: (window.packet.checklist||[]).length
        };
      })()`);
      check("第 1 步无清单时底部条可见：" + tag, () => {
        assert.notEqual(empty.display, "none", "底部条被藏了");
        assert.equal(empty.len, 0, "起点不该有清单");
        assert.ok(/1/.test(empty.title), "标题没写第几步：" + empty.title);
      });
      check("无清单时按钮是「生成清单」：" + tag, () => {
        assert.ok(/生成清单|generate checklist|generar lista/i.test(empty.action), "按钮文案不对：" + empty.action);
        assert.ok(/先生成今年清单|checklist first|lista de este año/i.test(empty.text), "说明文案不对：" + empty.text);
      });

      // 4a) 选「没有变化」→ ≥3 项
      await freshLoad(cdp, lang);
      const none = await cdp.eval(`(() => {
        const t = document.querySelector('#tagGrid .tag-btn[data-phrase="我今年没有变化。"]');
        t.click(); document.getElementById('btnMake').click();
        return {len:(window.packet.checklist||[]).length, titles:(window.packet.checklist||[]).map(x=>x.title||x.form||"")};
      })()`);
      check("选「没有变化」拿到 ≥3 项：" + tag, () => {
        assert.ok(none.len >= 3, "只有 " + none.len + " 项");
        for (const t of none.titles.slice(0, 3)) {
          assert.ok(t.indexOf("（") > 0 || t.indexOf("(") > 0, "标题里没有括号里的表号：" + t);
          assert.ok(!/^(W-2|1099|Schedule)/.test(t), "标题以表号打头：" + t);
        }
      });

      // 4b) 选「先跳过」→ ≥3 项
      await freshLoad(cdp, lang);
      const skip = await cdp.eval(`(() => {
        document.getElementById('btnHqSkip').click();
        return {len:(window.packet.checklist||[]).length};
      })()`);
      check("选「先跳过」拿到 ≥3 项：" + tag, () => {
        assert.ok(skip.len >= 3, "只有 " + skip.len + " 项");
      });

      // 3) 有清单时按钮说下一步
      const withRows = await cdp.eval(`(() => ({
        action: document.getElementById('stickyProgressAction').textContent.trim(),
        display: getComputedStyle(document.getElementById('stickyProgress')).display
      }))()`);
      check("有清单时按钮说下一步做什么：" + tag, () => {
        assert.notEqual(withRows.display, "none", "有清单时底部条不见了");
        assert.ok(/继续补齐材料|keep gathering|seguir reuniendo/i.test(withRows.action), "按钮文案不对：" + withRows.action);
      });

      // 3b) 全部备齐 → 导出
      const allDone = await cdp.eval(`(() => {
        (window.packet.checklist||[]).forEach(it => { it.status='uploaded'; });
        renderStickyProgress();
        return { action: document.getElementById('stickyProgressAction').textContent.trim() };
      })()`);
      check("全部备齐后按钮变成导出：" + tag, () => {
        assert.ok(/导出给会计师|export to your accountant|exportar a su contador/i.test(allDone.action), "按钮文案不对：" + allDone.action);
      });

      // 5) 布局
      const geo = await cdp.eval(`(() => {
        window.scrollTo(0, document.body.scrollHeight);
        const d = document.documentElement;
        const bar = document.getElementById('stickyProgress').getBoundingClientRect();
        const vis = Array.from(document.querySelectorAll('input,textarea,select,button')).filter(el => el.offsetParent !== null && !el.closest('#stickyProgress'));
        const last = vis[vis.length-1];
        const r = last ? last.getBoundingClientRect() : null;
        return { sw:d.scrollWidth, cw:d.clientWidth, barTop:Math.round(bar.top), barH:Math.round(bar.height), lastBottom:r?Math.round(r.bottom):null };
      })()`);
      geoRows.push({ tag, ...geo });
      check("不横向滚：" + tag, () => {
        assert.equal(geo.cw, w, "视口不是 " + w + "（实际 " + geo.cw + "）");
        assert.ok(geo.sw <= geo.cw, "横向溢出 " + geo.sw + " > " + geo.cw);
      });
      check("底部条不遮住最后一个输入：" + tag, () => {
        assert.ok(geo.lastBottom != null, "没找到可见输入");
        assert.ok(geo.lastBottom <= geo.barTop + 1, "被遮了：" + geo.lastBottom + " > " + geo.barTop);
      });
    }
  }
});

server.close();

let bad = 0;
for (const [tag, msg] of results) { if (tag !== "ok  ") bad++; console.log(tag, msg); }
console.log("\n底部条实测：");
for (const g of geoRows) console.log("  " + g.tag.padEnd(16) + " barH=" + g.barH + "px  barTop=" + g.barTop + "  最后输入 bottom=" + g.lastBottom + "  " + g.sw + "/" + g.cw);
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);