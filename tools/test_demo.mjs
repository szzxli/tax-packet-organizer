#!/usr/bin/env node
// 首屏样品闸门：375 与 390 × 中英西，量六件事
//   1) 不横向溢出；五行都在；主按钮不被遮
//   2) 不用登录就能拖；拖完「医保补贴」那行真的变（出现线上/线下）
//   3) 五行数字与 rules/graph.json 逐一对上（测试自己按图算一遍再比对，不读页面里的常量）
//   4) 首屏可点入口 ≤5（不含语言切换与常驻底栏）
//   5) 0 处金额承诺与判断句（建议你／你应该／你符合／最好／保证／一定）
//   6) 五行标题是人话打头，AOTC / LLC / 400% 这些术语只出现在正文里
// 跑法：node tools/test_demo.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const graph = JSON.parse(fs.readFileSync(path.join(root, "rules", "graph.json"), "utf8"));

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome：这道闸门必须真跑布局");
  process.exit(2);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const LIVE = (() => { const i = process.argv.indexOf("--live"); return i > 0 ? process.argv[i + 1] : null; })();
const server = LIVE ? { listen(_p, _h, cb){ if (cb) cb(); }, address(){ return { port: 0 }; }, close(){} } : http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = LIVE || ("http://127.0.0.1:" + server.address().port);

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
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { returnByValue: true, expression: expr });
    const v = r.result.value;
    return typeof v === "string" ? JSON.parse(v) : v;
  }
  close() { try { this.ws.close(); } catch {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "demo-profile-"));
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 120 && !fs.existsSync(portFile); i++) await sleep(50);
    assert.ok(fs.existsSync(portFile), "Chrome 没起来");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try { target = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()).find((t) => t.type === "page"); } catch {}
      if (!target) await sleep(100);
    }
    assert.ok(target && target.webSocketDebuggerUrl, "拿不到页面目标");
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    try { return await fn(cdp); } finally { cdp.close(); }
  } finally {
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

// —— 按规则图自己算一遍，用来比对页面 ——
const money = (n) => "$" + Number(n).toLocaleString("en-US");
function bandOf(list, taxable) {
  for (let i = 0; i < list.length; i++) {
    const [cap, rate] = list[i];
    if (cap === null || taxable <= cap) return { cap, rate };
  }
  return null;
}
const SD = graph.standard_deduction.mfj;
const FOUR = (graph.poverty_lines.four_hundred_pct || []).find((x) => x.household_size === 4);
const SSA = graph.credits.ssa;
const NX = SSA.next;

function expectFor(inc) {
  const taxable = Math.max(0, inc - SD);
  const b = bandOf(graph.brackets.mfj, taxable);
  return {
    taxable, rate: b.rate, cap: b.cap,
    four: FOUR ? FOUR.limit : null,
    over: FOUR ? inc > FOUR.limit : null,
    aid: money(inc), sd: money(SD), taxableStr: money(taxable),
    capStr: b.cap === null ? null : money(b.cap),
    fourStr: FOUR ? money(FOUR.limit) : null,
    credit: money(SSA.per_credit_usd), next: money(NX.per_credit_usd),
    need: money(SSA.per_credit_usd * SSA.max_per_year),
  };
}

const LANGS = ["zh", "en", "es"];
const SIZES = [[375, 812], [390, 844]];
const results = [];
let bad = 0;
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { bad++; results.push(["FAIL", name + " — " + e.message]); }
}

const seen = [];
await withChrome(async (cdp) => {
  for (const [w, h] of SIZES) {
    for (const lang of LANGS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await cdp.send("Page.enable");
      await cdp.send("Page.navigate", { url: LIVE ? LIVE + "?lang=" + lang : base + "/formal.html?lang=" + lang });
      // 等规则图到齐再量：先出的是「规则图没读到」的占位行，量它会假红
      for (let i = 0; i < 80; i++) {
        await sleep(120);
        const r = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: 'document.readyState === "complete" && !!document.getElementById("demoRows") && document.getElementById("demoRows").children.length === 5' });
        if (r.result.value === true) break;
      }
      await sleep(300);
      const tag = lang + " " + w + "×" + h;

      const geo = await cdp.eval(`(() => {
        const d = document.documentElement;
        const card = document.getElementById("demoCard");
        const rows = Array.from(document.querySelectorAll("#demoRows li"));
        const cta = document.getElementById("demoCta");
        const cr = cta.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(cr.left + cr.width/2), Math.round(cr.top + cr.height/2));
        // 可点元素＝渲染后真正能点的：range / select / button / a[href]，只要在首屏视口内就计
        const clickable = (root) => Array.from(root.querySelectorAll('input[type=range],select,button,a[href]')).filter(el => {
          if (el.offsetParent === null) return false;
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight;
        });
        const entries = clickable(document);
        const cardEntries = Array.from(document.querySelectorAll("#demoCard button, #demoCard a[href]")).filter(el => el.offsetParent !== null);
        return JSON.stringify({
          sw: d.scrollWidth, cw: d.clientWidth,
          cardHidden: card ? card.classList.contains("hidden") : null,
          rows: rows.length,
          heights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
          texts: rows.map(r => r.innerText.replace(/\\s+/g, " ").trim()),
          ctaText: cta.textContent.trim(),
          passText: (document.getElementById("demoPass") || { textContent: "" }).textContent.trim(),
          passHidden: (() => { const el = document.getElementById("demoPass"); return !el || el.offsetParent === null; })(),
          pageNow: (typeof currentPage !== "undefined" ? currentPage : null),
          stepNow: (typeof currentOrganizeStep !== "undefined" ? currentOrganizeStep : null),
          overlay: Array.from(document.querySelectorAll('[role="dialog"], .modal, .overlay, .onboarding, .coach')).filter(el => el.offsetParent !== null).length,
          ctaInView: cr.top < innerHeight && cr.bottom > 0,
          ctaCovered: !(hit && (hit === cta || cta.contains(hit))),
          entries: entries.map(el => (el.id || el.tagName) + ":" + (el.textContent || "").trim().slice(0, 12)),
          cardEntries: cardEntries.map(el => el.id || el.tagName),
          sliderTop: (() => { const el = document.getElementById("demoIncome"); return el ? Math.round(el.getBoundingClientRect().top) : null; })(),
          sliderBottom: (() => { const el = document.getElementById("demoIncome"); return el ? Math.round(el.getBoundingClientRect().bottom) : null; })(),
          vh: innerHeight,
          cardText: card ? card.innerText : "",
          pageText: document.body.innerText
        });
      })()`);
      seen.push({ tag, geo });

      check("样品卡在首屏且没被隐藏：" + tag, () => {
        assert.equal(geo.cardHidden, false, "样品卡是 hidden");
        assert.ok(geo.rows === 5, "行数不是 5：" + geo.rows);
        assert.ok(geo.heights.every((x) => x > 24), "有行高度异常：" + geo.heights.join(","));
      });
      check("不横向溢出：" + tag, () => {
        assert.equal(geo.cw, w, "视口不是 " + w + "（实际 " + geo.cw + "）");
        assert.ok(geo.sw <= geo.cw, "被撑宽 " + geo.sw + " > " + geo.cw);
      });
      check("主按钮没被遮：" + tag, () => {
        assert.ok(geo.ctaText.length > 0, "主按钮没文案");
        if (geo.ctaInView) assert.ok(!geo.ctaCovered, "主按钮被别的元素盖住");
      });
      check("滑块在首屏（底边 ≤ 视口高）：" + tag, () => {
        assert.ok(geo.sliderBottom != null, "没量到滑块");
        assert.ok(geo.sliderBottom <= geo.vh, "滑块底边超出视口：bottom=" + geo.sliderBottom + "，视口 " + geo.vh);
      });
      check("首屏可点入口 ≤5：" + tag, () => {
        assert.ok(geo.entries.length <= 5, "入口 " + geo.entries.length + " 个：" + geo.entries.join(" / "));
      });
      check("卡片内只有两条路（整理我自己的 + 季票给什么）：" + tag, () => {
        assert.deepEqual(geo.cardEntries.slice().sort(), ["demoCta", "demoPass"], "卡片内入口：" + geo.cardEntries.join(","));
      });

      // 三组收入各拖一次，比对数字
      for (const inc of [60000, 120000, 200000]) {
        const got = await cdp.eval(`(() => {
          const sl = document.getElementById("demoIncome");
          sl.value = "${inc}";
          sl.dispatchEvent(new Event("input", { bubbles: true }));
          return JSON.stringify({ texts: Array.from(document.querySelectorAll("#demoRows li")).map(r => r.innerText.replace(/\\s+/g, " ").trim()) });
        })()`);
        const e = expectFor(inc);
        check("五行数字与规则图一致：" + tag + " @" + inc, () => {
          const all = got.texts.join(" | ");
          assert.ok(all.includes(e.aid), "没出现收入 " + e.aid);
          assert.ok(all.includes(e.sd), "没出现标准扣除 " + e.sd);
          assert.ok(all.includes(e.taxableStr), "没出现应税 " + e.taxableStr);
          assert.ok(all.includes(e.rate + "%"), "没出现税率 " + e.rate + "%");
          if (e.capStr) assert.ok(all.includes(e.capStr), "没出现档位上限 " + e.capStr);
          if (e.fourStr) {
            assert.ok(all.includes(e.fourStr), "没出现 400% 线 " + e.fourStr);
            assert.ok(all.includes(e.over ? "上面" : "下面") || all.includes(e.over ? "above" : "below") || all.includes(e.over ? "por encima" : "por debajo"), "没写清在线的哪一侧");
          }
          assert.ok(all.includes(e.credit) && all.includes(e.next), "社安两个年度的分值不全");
          assert.ok(all.includes(e.need), "没出现一年记满所需的工资 " + e.need);
        });
      }

      const after = await cdp.eval(`(() => {
        const sl = document.getElementById("demoIncome");
        const first = document.getElementById("demoRows").children[1].innerText;
        const page0 = typeof currentPage !== "undefined" ? currentPage : null;
        const step0 = typeof currentOrganizeStep !== "undefined" ? currentOrganizeStep : null;
        const y0 = Math.round(window.scrollY);
        sl.value = "40000"; sl.dispatchEvent(new Event("input", { bubbles: true }));
        const low = document.getElementById("demoRows").children[1].innerText;
        return JSON.stringify({ same: first === low, low,
          pageSame: page0 === (typeof currentPage !== "undefined" ? currentPage : null),
          stepSame: step0 === (typeof currentOrganizeStep !== "undefined" ? currentOrganizeStep : null),
          scrollSame: y0 === Math.round(window.scrollY),
          overlay: Array.from(document.querySelectorAll('[role="dialog"], .modal, .overlay, .onboarding, .coach')).filter(el => el.offsetParent !== null).length });
      })()`);
      check("拖动后那行真的变（医保补贴）：" + tag, () => {
        assert.equal(after.same, false, "把收入从 20 万拖到 4 万，这一行没变");
      });
      const ctaHit = await cdp.eval(`(() => {
        const sl = document.getElementById("demoIncome");
        sl.scrollIntoView({ block: "center", behavior: "auto" });
        sl.value = "140000";
        sl.dispatchEvent(new Event("input", { bubbles: true }));
        const cta = document.getElementById("demoCta");
        const r = cta.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
        return JSON.stringify({ top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, hit: !!(hit && (hit === cta || cta.contains(hit))) });
      })()`);
      check("拖完 CTA 在视口内且点得到：" + tag, () => {
        assert.ok(ctaHit.top >= 0 && ctaHit.bottom <= ctaHit.vh, "CTA 不在视口内：top=" + ctaHit.top + " bottom=" + ctaHit.bottom + " vh=" + ctaHit.vh);
        assert.equal(ctaHit.hit, true, "CTA 中心点被别的元素盖住");
      });
      check("拖完到点按钮之间 0 次跳页：" + tag, () => {
        assert.ok(after.pageSame, "拖动把页面切走了");
        assert.ok(after.stepSame, "拖动把步骤切走了");
        assert.ok(after.scrollSame, "拖动让页面滚动了");
        assert.equal(after.overlay, 0, "拖动弹出了引导层／弹窗");
      });
      check("两条路同级可见（整理我自己的 + 季票给什么）：" + tag, () => {
        assert.ok(geo.ctaText.length > 0, "主按钮没文案");
        assert.ok(geo.passText.length > 0, "次级入口没文案");
        assert.equal(geo.passHidden, false, "次级入口被藏起来了");
        assert.equal(geo.overlay, 0, "首屏就盖了弹窗／引导层");
      });
      check("没有「使用说明／教程」这类段落标题：" + tag, () => {
        const t = geo.pageText;
        for (const word of ["使用说明", "教程", "三步上手", "操作指南", "新手指引", "How to use", "Tutorial", "Cómo usar", "Tutorial de uso"]) {
          assert.ok(!t.includes(word), "出现段落标题：" + word);
        }
      });

      check("没有判断句与金额承诺：" + tag, () => {
        const t = geo.cardText;
        for (const bad2 of ["建议你", "你应该", "你符合", "适合你", "最好", "保证", "一定能", "抵税", "你能退", "可退"]) {
          assert.ok(!t.includes(bad2), "出现禁止表述：" + bad2);
        }
      });
      check("第五行给结果、没被藏起来：" + tag, () => {
        const fifth = geo.texts[4] || "";
        assert.ok(fifth.length > 40, "第五行几乎没有内容：" + fifth);
        assert.ok(fifth.includes(NX.per_credit_usd.toLocaleString("en-US")) || fifth.includes(money(NX.per_credit_usd)), "第五行没给 2027 的分值");
        assert.ok(/2027/.test(fifth), "第五行没写 2027 税年");
      });
      check("五行标题是人话打头：" + tag, () => {
        for (const t of geo.texts) {
          const head = t.split(/[:：]/)[0].slice(0, 12);
          assert.ok(!/^[A-Z0-9\-]+$/.test(head.trim()), "标题以术语/表号打头：" + head);
        }
      });
      check("样例家庭三语都写明不是你的数：" + tag, () => {
        const t = geo.cardText;
        assert.ok(/样例家庭/.test(t) || /sample household/i.test(t) || /hogar de ejemplo/i.test(t), "没写样例家庭");
      });
    }
  }
});

// 阶段 A：三个 demo_ 名字在页面里、EV_NAMES 里 0 个（服务端一条都不发）
check("埋点：三个 demo_ 名字在页面里，EV_NAMES 里 0 个", () => {
  const src = fs.readFileSync(path.join(root, "formal.html"), "utf8");
  for (const name of ["demo_drag", "demo_cta_free", "demo_cta_pass"]) {
    assert.ok(src.includes('"' + name + '"'), "页面里找不到事件名：" + name);
  }
  assert.equal((src.match(/"demo_cta"/g) || []).length, 0, "页面里还有旧单名 \"demo_cta\"");
  const m = src.match(/var EV_NAMES=\{([^}]*)\}/);
  assert.ok(m, "找不到 EV_NAMES 定义");
  for (const name of ["demo_drag", "demo_cta_free", "demo_cta_pass"]) {
    assert.ok(m[1].includes('"' + name + '"'), "EV_NAMES 里没有：" + name);
  }
  assert.ok(!m[1].includes("demo_cta\""), "EV_NAMES 里还有旧单名 demo_cta");
  // Worker 白名单同批：三个名字都在，旧单名 0
  const w = fs.readFileSync(path.join(root, "backend", "worker", "index.js"), "utf8");
  const wm = w.match(/const NAMES = \[([^\]]*)\]/);
  assert.ok(wm, "找不到 Worker 的 NAMES");
  for (const name of ["demo_drag", "demo_cta_free", "demo_cta_pass"]) {
    assert.ok(wm[1].includes('"' + name + '"'), "Worker 白名单里没有：" + name);
  }
  assert.ok(!wm[1].includes('"demo_cta"'), "Worker 白名单里还有 demo_cta");
});

// 四行名字必须与第 3 步地图逐字一致：生成清单 → 进第 3 步 → 读地图行头与列头
const demoTitleCmp = [];
await withChrome(async (cdp) => {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.enable");
  for (const lang of LANGS) {
    await cdp.send("Page.navigate", { url: LIVE ? LIVE + "?lang=" + lang : base + "/formal.html?lang=" + lang });
    for (let i = 0; i < 80; i++) {
      await sleep(120);
      const r = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: 'document.readyState === "complete" && document.getElementById("demoRows") && document.getElementById("demoRows").children.length === 5' });
      if (r.result.value === true) break;
    }
    const got = await cdp.eval(`(() => {
      const titles = Array.from(document.querySelectorAll("#demoRows li b")).map(b => b.textContent.trim());
      const chips = document.querySelectorAll("#tagGrid .tag-btn");
      for (let i = 0; i < Math.min(3, chips.length); i++) chips[i].click();
      const mk = document.getElementById("btnMake"); if (mk) mk.click();
      return JSON.stringify({ titles });
    })()`);
    await sleep(700);
    const map = await cdp.eval(`(() => {
      const vals = { ol_dep: "1", ol_income: "120000", ol_withheld: "9000", ol_tuition: "20000", ol_retire: "6000", ol_mkt: "12", ol_premium: "8400", ol_mortgage: "14000" };
      Object.keys(vals).forEach(k => { const e = document.getElementById(k); if (e) { e.value = vals[k]; e.dispatchEvent(new Event("input", { bubbles: true })); } });
      if (typeof renderOutlook === "function") renderOutlook();
      setOrganizeStep(3, false); renderAll();
      const rows = Array.from(document.querySelectorAll("#outlookMap tbody th")).map(th => th.textContent.trim());
      const head = Array.from(document.querySelectorAll("#outlookMap thead th")).map(th => th.textContent.trim());
      return JSON.stringify({ rows, head });
    })()`);
    demoTitleCmp.push({ lang, titles: got.titles, mapRows: map.rows, mapHead: map.head });
  }
});

for (const c of demoTitleCmp) {
  check("四行名字与第 3 步地图逐字一致：" + c.lang, () => {
    assert.ok(c.mapRows.length >= 4, "地图行头没取到：" + JSON.stringify(c.mapRows));
    const want = [c.mapRows[0], c.mapRows[1], c.mapRows[2], c.mapRows[c.mapRows.length - 1]];
    for (let i = 0; i < 4; i++) assert.equal(c.titles[i], want[i], "第 " + (i + 1) + " 行：「" + c.titles[i] + "」≠ 地图「" + want[i] + "」");
    for (const t of c.titles.slice(0, 4)) {
      assert.ok(!/1095-A|8962|AOTC|LLC/.test(t), "行名里还有表号缩写：" + t);
    }
    for (const t of c.titles) {
      assert.ok(!/以后会怎样|What it means later|Qué significa después/.test(t), "行名用了地图的列名：「" + t + "」");
    }
    assert.ok(/以后几年|coming years|próximos años/.test(c.titles[4]), "第五行没写成「以后几年会怎么变」：" + c.titles[4]);
  });
}

for (const [tag, msg] of results) console.log(tag, msg);
console.log("\n与地图的逐字对照：");
for (const c of demoTitleCmp) {
  console.log("  " + c.lang + " 样品：" + c.titles.join(" | "));
  console.log("  " + c.lang + " 地图：" + [c.mapRows[0], c.mapRows[1], c.mapRows[2], c.mapRows[c.mapRows.length - 1], c.mapHead.filter(Boolean).join(" / ")].join(" | "));
}
console.log("\n首屏入口清单（不含语言切换与常驻底栏）：");
for (const s of seen) console.log("  " + s.tag.padEnd(14) + s.geo.entries.length + " 个：" + s.geo.entries.join(" / "));
console.log("\n" + (results.length - bad) + " passed, " + bad + " failed");
server.close();
process.exit(bad ? 1 : 0);