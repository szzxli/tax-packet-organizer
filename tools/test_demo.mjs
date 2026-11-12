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
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("页面内报错：" + JSON.stringify({ text: d.text, desc: d.exception && d.exception.description, line: d.lineNumber, col: d.columnNumber }));
    }
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
      await cdp.send("Page.navigate", { url: LIVE ? LIVE + "?lang=" + lang + "&probe=1" : base + "/formal.html?lang=" + lang + "&probe=1" });
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
        const why = Array.from(document.querySelectorAll("#demoWhy li"));
        const cta = document.getElementById("demoSub");
        const pr = cta.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(pr.left + pr.width/2), Math.round(pr.top + pr.height/2));
        const lum = (c) => { const nums = (String(c).match(/[\\d.]+/g) || ["255","255","255"]).map(Number).slice(0,3); while (nums.length < 3) nums.push(255); const m = nums.map(v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2]; };
        const cs = getComputedStyle(cta);
        const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const b = getComputedStyle(n).backgroundColor; if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") return b; n = n.parentElement; } return "rgb(255,255,255)"; };
        const L1 = lum(cs.color), L2 = lum(bgOf(cta));
        const contrast = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
        const rowsBottom = rows.length ? Math.round(rows[rows.length-1].getBoundingClientRect().bottom) : 0;
        const whyEl = card.querySelector("details");
        const whySummary = whyEl ? whyEl.querySelector("summary") : null;
        const whyR = whySummary ? whySummary.getBoundingClientRect() : null;
        // 首屏可点元素＝首屏区域（页面顶部到样品卡底边）里真正能点的：range / select / button / a[href] / summary
        const cardBottom = card.getBoundingClientRect().bottom + window.scrollY;
        const clickable = (root) => Array.from(root.querySelectorAll('input[type=range],select,button,a[href],summary')).filter(el => {
          if (el.offsetParent === null) return false;
          const r = el.getBoundingClientRect();
          return (r.top + window.scrollY) < cardBottom && r.bottom > 0;
        });
        const entries = clickable(document);
        const cardEntries = Array.from(document.querySelectorAll("#demoCard button, #demoCard a[href], #demoCard summary")).filter(el => el.offsetParent !== null);
        const bar = document.getElementById("stickyProgress");
        const barShown = bar && !bar.classList.contains("hidden") && bar.offsetParent !== null;
        const primaryBtns = Array.from(document.querySelectorAll("button"))
          .filter(b => b.offsetParent !== null)
          .filter(b => !b.classList.contains("secondary"))
          .map(b => ({ id: b.id || "-", rc: b.getBoundingClientRect() }))
          .filter(x => x.rc.bottom > 0 && x.rc.top < innerHeight && Math.round(x.rc.height) >= 44)
          .map(x => x.id);
        return JSON.stringify({
          sw: d.scrollWidth, cw: d.clientWidth,
          cardHidden: card ? card.classList.contains("hidden") : null,
          rows: rows.length,
          heights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
          texts: why.map(r => r.textContent.replace(/\\s+/g, " ").trim()),
          rowTexts: rows.map(r => r.innerText.replace(/\\s+/g, " ").trim()),
          ctaText: cta.textContent.trim(),
          primaryBtns: primaryBtns,
          barShown: barShown,
          ctaColor: cs.color, ctaBg: bgOf(cta),
          ctaTop: Math.round(pr.top), ctaH: Math.round(pr.height), contrast: Math.round(contrast*100)/100, rowsBottom,
          whyText: whySummary ? whySummary.textContent.trim() : "",
          whyTop: whyR ? Math.round(whyR.top) : null,
          whyContrast: (() => { const c2 = whySummary ? getComputedStyle(whySummary) : null; return c2 ? Math.round(((Math.max(lum(c2.color), lum(bgOf(whySummary)))+0.05)/(Math.min(lum(c2.color), lum(bgOf(whySummary)))+0.05))*100)/100 : 0; })(),
          ctaInView: pr.top >= 0 && pr.bottom <= innerHeight,
          ctaHit: !!(hit && (hit === cta || cta.contains(hit))),
          entries: entries.map(el => (el.id || el.tagName) + ":" + (el.textContent || "").trim().slice(0, 12)),
          cardEntries: cardEntries.map(el => el.id || el.tagName),
          sliderTop: (() => { const el = document.getElementById("demoIncome"); return el ? Math.round(el.getBoundingClientRect().top) : null; })(),
          sliderBottom: (() => { const el = document.getElementById("demoIncome"); return el ? Math.round(el.getBoundingClientRect().bottom) : null; })(),
          vh: innerHeight,
          cardText: card ? card.textContent : "",
          pageText: document.body.innerText
        });
      })()`);
      seen.push({ tag, geo });

      check("样品卡在首屏且没被隐藏：" + tag, () => {
        assert.equal(geo.cardHidden, false, "样品卡是 hidden");
        assert.ok(geo.rows === 5, "行数不是 5：" + geo.rows);
        assert.ok(geo.heights.every((x) => x >= 28 && x <= 64), "行太高，一屏放不下：" + geo.heights.join(","));
      });
      check("不横向溢出：" + tag, () => {
        assert.equal(geo.cw, w, "视口不是 " + w + "（实际 " + geo.cw + "）");
        assert.ok(geo.sw <= geo.cw, "被撑宽 " + geo.sw + " > " + geo.cw);
      });
      check("订阅按钮：≥44px、对比度 ≥4.5、在五行与三步之后、首屏看得见：" + tag, () => {
        assert.ok(geo.ctaText.length > 0, "订阅按钮没文案");
        assert.ok(geo.ctaH >= 44, "主按钮高度不足 44px：" + geo.ctaH);
        assert.ok(geo.contrast >= 4.5, "主按钮对比度只有 " + geo.contrast + ":1（字 " + geo.ctaColor + "，底 " + geo.ctaBg + "）");
        assert.ok(geo.ctaTop > geo.rowsBottom, "主按钮没在五行之后：cta=" + geo.ctaTop + " rowsBottom=" + geo.rowsBottom);
        assert.ok(geo.ctaInView, "首屏看不见整颗主按钮：ctaBottom=" + (geo.ctaTop + geo.ctaH) + " 视口 " + geo.vh);
        assert.ok(geo.ctaHit, "主按钮被别的元素盖住");
      });
      check("滑块在首屏（底边 ≤ 视口高）：" + tag, () => {
        assert.ok(geo.sliderBottom != null, "没量到滑块");
        assert.ok(geo.sliderBottom <= geo.vh, "滑块底边超出视口：bottom=" + geo.sliderBottom + "，视口 " + geo.vh);
      });
      check("首屏可点入口 = 4（滑块、订阅按钮、免费文字链接、出处折叠）：" + tag, () => {
        assert.ok(geo.entries.length === 4, "入口 " + geo.entries.length + " 个：" + geo.entries.join(" / "));
      });
      check("卡片内一颗醒目按钮（订阅）+ 免费文字链接 + 出处折叠：" + tag, () => {
        assert.deepEqual(geo.cardEntries.slice().sort(), ["demoFree", "demoSub", "SUMMARY"].sort(), "卡片内入口：" + geo.cardEntries.join(","));
        assert.ok(geo.whyText.length > 0, "出处折叠没有标题");
        assert.ok(geo.whyTop >= geo.rowsBottom, "出处折叠没在五行之后");
      });
      check("第 1 步无清单时底栏不出现，不并排第二颗：" + tag, () => {
        assert.equal(geo.barShown, false, "底栏又出来了（首屏应只剩卡内那一颗）");
        assert.deepEqual(geo.primaryBtns, ["demoSub"], "醒目按钮不止一颗：" + geo.primaryBtns.join(","));
      });

      // 三组收入各拖一次，比对数字（整句在卡底「这五行怎么算的」折叠里，读 textContent）
      for (const inc of [70000, 120000, 200000]) {
        const got = await cdp.eval(`(() => {
          const sl = document.getElementById("demoIncome");
          sl.value = "${inc}";
          sl.dispatchEvent(new Event("input", { bubbles: true }));
          return JSON.stringify({
            texts: Array.from(document.querySelectorAll("#demoWhy li")).map(r => r.textContent.replace(/\\s+/g, " ").trim()),
            rows: Array.from(document.querySelectorAll("#demoRows li")).map(r => r.innerText.replace(/\\s+/g, " ").trim())
          });
        })()`);
        const e = expectFor(inc);
        check("教育行给出淘汰区间并报位置：@" + inc + " " + tag, () => {
          const edu = got.texts[2] || "";
          for (const n of ["80,000", "90,000", "160,000", "180,000"]) {
            assert.ok(edu.includes(n), "教育行缺淘汰区间 " + n + "：" + edu.slice(0, 160));
          }
          const po = (graph.credits.aotc.phaseout || graph.credits.llc.phaseout).mfj;
          const side = inc > po[1]
            ? /都是 0|both are 0|ambos son 0/
            : inc < po[0]
              ? /都不打折|neither credit is reduced|ningún crédito se reduce/
              : /淘汰区间里|inside the joint phase-out range|rango de reducción conjunto/;
          assert.ok(side.test(edu), "教育行没报样例收入在哪一侧（收入 " + inc + "）：" + edu.slice(0, 200));
        });
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
        check("医保行给出 2027 保障年那条线并标出与上面这年的差额：" + tag + " @" + inc, () => {
          const row = got.texts[1] || "";
          const nx = graph.poverty_lines.next;
          const nf = nx.four_hundred_pct.find((x) => x.household_size === 4);
          const cur = graph.poverty_lines.four_hundred_pct.find((x) => x.household_size === 4);
          assert.ok(nf && cur, "规则图缺四口之家那行");
          assert.ok(row.includes(money(nf.limit)), "缺 2027 保障年的线 " + money(nf.limit) + "：" + row);
          assert.ok(row.includes(money(nf.limit - cur.limit)), "缺差额 " + money(nf.limit - cur.limit) + "：" + row);
          assert.ok(row.includes(String(nx.coverage_year)), "没写 2027 保障年：" + row);
          assert.ok(row.includes(nx.checked), "缺核实日 " + nx.checked + "：" + row);
          for (const bad3 of ["建议你", "你应该", "你符合", "符合条件", "eligible", "entitled"]) {
            assert.ok(!row.includes(bad3), "出现判断句：" + bad3);
          }
        });
      }

      // 两个保障年各说各的位置：128,000 / 130,000 / 133,000 卡在两条线之间
      const curLim = graph.poverty_lines.four_hundred_pct.find((x) => x.household_size === 4).limit;
      const nxtYr = graph.poverty_lines.next.coverage_year;
      const nxtLim = graph.poverty_lines.next.four_hundred_pct.find((x) => x.household_size === 4).limit;
      const curStr = money(curLim), nxtStr = money(nxtLim);
      const esc$ = (s) => s.replace("$", "\\$");
      for (const inc of [128000, 130000, 133000]) {
        const row = await cdp.eval(`(() => {
          const sl = document.getElementById("demoIncome");
          sl.value = "${inc}"; sl.dispatchEvent(new Event("input", { bubbles: true }));
          return JSON.stringify(document.querySelectorAll("#demoWhy li")[1].textContent.replace(/\\s+/g, " ").trim());
        })()`);
        const posRe = (over) => (over ? "(上面|above it|por encima)" : "(下面|below it|por debajo)");
        check("医保行两个保障年各给一次位置：@" + inc + " " + tag, () => {
          assert.ok(row.includes(curStr), "2026 那条线没出现 " + curStr + "：" + row);
          assert.ok(row.includes(nxtStr), nxtYr + " 那条线没出现 " + nxtStr + "：" + row);
          assert.match(row, new RegExp("2026[\\s\\S]{0,90}" + esc$(curStr) + "[\\s\\S]{0,150}" + posRe(inc > curLim)),
            "2026 那条线的位置没写对（收入 " + inc + "）：" + row);
          assert.match(row, new RegExp(nxtYr + "[\\s\\S]{0,260}" + esc$(nxtStr) + "[\\s\\S]{0,200}" + posRe(inc > nxtLim)),
            nxtYr + " 那条线的位置没写对（收入 " + inc + "）：" + row);
          // 每一处「就没有了」都必须落在带年份的那一句里，不许留一句没有年号的总判
          const gone = /(就没有了|no premium subsidy|no hay subsidio)/g;
          let m;
          while ((m = gone.exec(row))) {
            const before = row.slice(Math.max(0, m.index - 220), m.index);
            assert.ok(/20\d\d/.test(before), "有一句「就没有了」没带年号：" + row.slice(Math.max(0, m.index - 80), m.index + 20));
          }
          if (inc === 130000) {
            assert.ok(inc > curLim && inc < nxtLim, "130,000 应正好卡在两条线之间（cur " + curLim + " / next " + nxtLim + "）");
          }
        });
      }

      const after = await cdp.eval(`(() => {
        const sl = document.getElementById("demoIncome");
        sl.value = "70000"; sl.dispatchEvent(new Event("input", { bubbles: true }));
        const first = document.querySelectorAll("#demoRows li")[1].innerText;
        const page0 = typeof currentPage !== "undefined" ? currentPage : null;
        const step0 = typeof currentOrganizeStep !== "undefined" ? currentOrganizeStep : null;
        const y0 = Math.round(window.scrollY);
        sl.value = "200000"; sl.dispatchEvent(new Event("input", { bubbles: true }));
        sl.dispatchEvent(new Event("change", { bubbles: true }));
        const low = document.querySelectorAll("#demoRows li")[1].innerText;
        return JSON.stringify({ same: first === low, low,
          pageSame: page0 === (typeof currentPage !== "undefined" ? currentPage : null),
          stepSame: step0 === (typeof currentOrganizeStep !== "undefined" ? currentOrganizeStep : null),
          scrollSame: y0 === Math.round(window.scrollY),
          urlHasIncome: /income=200000/.test(location.search),
          overlay: Array.from(document.querySelectorAll('[role="dialog"], .modal, .overlay, .onboarding, .coach')).filter(el => el.offsetParent !== null).length });
      })()`);
      check("拖动后那行真的变（医保补贴 7 万 → 20 万）：" + tag, () => {
        assert.equal(after.same, false, "把收入从 7 万拖到 20 万，这一行没变");
      });
      check("拖完到点按钮之间 0 次跳页：" + tag, () => {
        assert.ok(after.pageSame, "拖动把页面切走了");
        assert.ok(after.stepSame, "拖动把步骤切走了");
        assert.ok(after.scrollSame, "拖动让页面滚动了");
        assert.equal(after.overlay, 0, "拖动弹出了引导层／弹窗");
      });
      check("松开后收入写进地址栏：" + tag, () => {
        assert.ok(after.urlHasIncome, "地址栏没有 income=200000：" + "（回访 / 分享要对得上同一个数）");
      });
      check("没有「使用说明／教程」这类段落标题：" + tag, () => {
        const t = geo.pageText;
        for (const word of ["使用说明", "教程", "三步上手", "操作指南", "新手指引", "How to use", "Tutorial", "Cómo usar", "Tutorial de uso"]) {
          assert.ok(!t.includes(word), "出现段落标题：" + word);
        }
      });

      check("出处行括号成对（三语）：" + tag, () => {
        const t = geo.cardText;
        const open = (t.match(/[（(]/g) || []).length;
        const close = (t.match(/[）)]/g) || []).length;
        assert.equal(open, close, "括号不成对：左 " + open + " 右 " + close);
      });
      check("第五行写清「每记 1 分要多赚」，并给 40 分合计 $3,200：" + tag, () => {
        const t = geo.texts[4] || "";
        assert.ok(t.includes("3,200"), "缺 40 分合计 3,200：" + t);
        if (tag.startsWith("zh")) {
          assert.ok(/每记 1 分要多赚/.test(t), "zh 没写清「每记 1 分要多赚」：" + t);
          assert.ok(!/每分多 \$80/.test(t), "zh 还留着「每分多 $80」这种无主语句");
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
check("教育行不许再说「跟收入无关」，四个门槛数只在规则图里", () => {
  const src = fs.readFileSync(path.join(root, "formal.html"), "utf8");
  assert.equal((src.match(/跟收入无关|does not depend on income|no depende de los ingresos/g) || []).length, 0, "页面里还有「跟收入无关」这类话");
  assert.equal((src.match(/五件事|five things|cinco cosas/g) || []).length, 0, "标题里还有「五件事」这类绝对说法");
  const h2 = (src.match(/<h2>[^<]*下面几行跟着变[^<]*<\/h2>/) || [""])[0];
  assert.equal(h2, "", "样品卡里又长回标题了（定位句只有一句，在样品卡上面）：" + h2);
  for (const re of [/80,000/, /90,000/, /160,000/, /180,000/, /\$\s?80000\b/, /\$\s?90000\b/, /\$\s?160000\b/, /\$\s?180000\b/]) {
    assert.ok(!re.test(src), "页面源码里写死了门槛数：" + re);
  }
});

check("埋点：只留 demo_drag 与 demo_cta_pass，页面/EV_NAMES/Worker 三处一致", () => {
  const src = fs.readFileSync(path.join(root, "formal.html"), "utf8");
  for (const name of ["demo_drag", "demo_cta_pass"]) {
    assert.ok(src.includes('"' + name + '"'), "页面里找不到事件名：" + name);
  }
  assert.equal((src.match(/demo_cta_free/g) || []).length, 0, "页面里还有 demo_cta_free");
  const m = src.match(/var EV_NAMES=\{([^}]*)\}/);
  assert.ok(m, "找不到 EV_NAMES 定义");
  for (const name of ["demo_drag", "demo_cta_pass"]) {
    assert.ok(m[1].includes('"' + name + '"'), "EV_NAMES 里没有：" + name);
  }
  assert.equal(m[1].includes("demo_cta_free"), false, "EV_NAMES 里还有 demo_cta_free");
  const w = fs.readFileSync(path.join(root, "backend", "worker", "index.js"), "utf8");
  const wm = w.match(/const NAMES = \[([^\]]*)\]/);
  assert.ok(wm, "找不到 Worker 的 NAMES");
  for (const name of ["demo_drag", "demo_cta_pass"]) {
    assert.ok(wm[1].includes('"' + name + '"'), "Worker 白名单里没有：" + name);
  }
  assert.equal(wm[1].includes("demo_cta_free"), false, "Worker 白名单里还有 demo_cta_free");
  assert.ok(/probe=1/.test(src), "页面没有 ?probe=1 的探针开关");
});

// 探针开关：?probe=1 下 track() 直接返回，localStorage 里不留事件；正常访问要留一条
const probeRes = await withChrome(async (cdp) => {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.enable");
  const paths = LIVE ? [LIVE.split("?")[0]] : [base + "/formal.html"];
  const out = {};
  for (const [key, q] of [["probe", "?lang=zh&probe=1"], ["plain", "?lang=zh"]]) {
    await cdp.send("Page.navigate", { url: paths[0] + q });
    for (let i = 0; i < 80; i++) {
      await sleep(120);
      const r = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: 'document.readyState==="complete" && document.getElementById("demoRows") && document.getElementById("demoRows").children.length===5' });
      if (r.result.value === true) break;
    }
    const n = await cdp.eval(`(() => {
      localStorage.removeItem("tpo_events"); sessionStorage.removeItem("tpo_demo_drag");
      const s = document.getElementById("demoIncome"); s.value = "150000"; s.dispatchEvent(new Event("input", { bubbles: true }));
      return JSON.stringify({ n: (JSON.parse(localStorage.getItem("tpo_events") || "[]") || []).length });
    })()`);
    out[key] = n.n;
  }
  return out;
});

check("探针开关：?probe=1 拖完不记账，正常访问记一条", () => {
  assert.equal(probeRes.probe, 0, "带 probe=1 仍写了 " + probeRes.probe + " 条事件");
  assert.ok(probeRes.plain >= 1, "正常访问没记账：" + probeRes.plain);
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
      const titles = Array.from(document.querySelectorAll("#demoRows li .lbl")).map(b => b.textContent.trim());
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
    assert.ok(/以后几年|[Cc]oming years|[Pp]róximos años/.test(c.titles[4]), "第五行的名字不是「以后几年」这一类：" + c.titles[4]);
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