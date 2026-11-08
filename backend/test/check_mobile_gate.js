// 第 8 项验收：手机首屏 + 停购提示（同一份 formal.html + 同一份 Worker 代码，本地跑）
//
// 需要：
//   1) 本地 Worker：wrangler dev --local --port 8788（含 DEV_MODE=1，注册可拿验证码）
//   2) 本地静态站：python3 -m http.server 8000（在仓库根目录）
//   3) npm i playwright-core；本机 Chrome
//
// 用法：node backend/test/check_mobile_gate.js
// 退出码 0 全过，1 有失败。
const { chromium } = require("playwright-core");

const CHROME = process.env.TPO_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SITE = process.env.TPO_SITE || "http://127.0.0.1:8000/formal.html";
const API = process.env.TPO_API || "http://127.0.0.1:8788";
const WORKER_ORIGIN = "https://tax-packet-api.szzxli711.workers.dev";
const SHOT_DIR = process.env.TPO_OUT || ".";

let fail = 0;
function check(name, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${detail}]` : ""));
}

async function apiCall(path, opts = {}) {
  const r = await fetch(API + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: "Bearer " + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  const email = `mobile${Date.now()}@example.com`;
  const reg = await apiCall("/api/register", { method: "POST", body: { email, password: "mobile-test-1" } });
  const code = reg.body.dev_code;
  if (!code) throw new Error("本地 Worker 需要 DEV_MODE=1 才能自动验收：" + JSON.stringify(reg));
  await apiCall("/api/verify", { method: "POST", body: { email, code } });
  const login = await apiCall("/api/login", { method: "POST", body: { email, password: "mobile-test-1" } });
  const token = login.body.token;
  if (!token) throw new Error("登录失败：" + JSON.stringify(login));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const sizes = [[390, 844], [320, 568]];

  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    // 把线上 Worker 地址劫持到本地：前端字节不变，后端是本仓库代码
    await page.route(WORKER_ORIGIN + "/**", async (route) => {
      const req = route.request();
      const resp = await fetch(API + new URL(req.url()).pathname, {
        method: req.method(),
        headers: req.headers(),
        body: req.postData() || undefined,
      });
      await route.fulfill({ status: resp.status, body: await resp.text(), headers: { "content-type": "application/json" } });
    });
    await page.addInitScript(([t, e]) => {
      try { localStorage.setItem("tpo_token", t); localStorage.setItem("tpo_session", e); } catch (err) {}
    }, [token, email]);
    await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1500);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      return { vw: de.clientWidth, sw: de.scrollWidth, txt: document.body.innerText };
    });
    check(`${w}px 无横向溢出`, m.sw <= m.vw + 1, `scrollWidth=${m.sw} clientWidth=${m.vw}`);
    const cta = await page.locator("text=把今年的材料放进来").first().isVisible().catch(() => false);
    check(`${w}px 首屏主 CTA 可见`, cta);
    check(`${w}px 无 JS 报错`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.screenshot({ path: `${SHOT_DIR}/mobile-first-${w}.png` });
    await page.close();
  }

  // 订阅页文案 + 付款按钮的停购提示
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  await page.route(WORKER_ORIGIN + "/**", async (route) => {
    const req = route.request();
    const resp = await fetch(API + new URL(req.url()).pathname, {
      method: req.method(),
      headers: req.headers(),
      body: req.postData() || undefined,
    });
    await route.fulfill({ status: resp.status, body: await resp.text(), headers: { "content-type": "application/json" } });
  });
  await page.addInitScript(([t, e]) => {
      try { localStorage.setItem("tpo_token", t); localStorage.setItem("tpo_session", e); } catch (err) {}
    }, [token, email]);
  await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
  // 等登录态恢复（/api/me）再切页，否则 showPage(2|3) 会先弹登录框
  await page.waitForFunction(() => typeof currentUser !== "undefined" && !!currentUser, null, { timeout: 20000 });

  await page.evaluate(() => showPage(2));
  await page.waitForTimeout(400);
  const subText = await page.locator("#subCard").innerText();
  check("订阅页写明「内测期免费，1 月公布价格」",
        subText.includes("内测期免费") && subText.includes("1 月公布价格"), subText.split("\n").slice(0, 2).join(" / ").slice(0, 120));
  await page.screenshot({ path: `${SHOT_DIR}/mobile-subscribe.png` });

  await page.evaluate(() => showPage(3));
  await page.waitForTimeout(400);
  await page.locator("#btnDemoPay").click();
  await page.waitForTimeout(800);
  const msg = await page.locator("#payMsg").innerText();
  check("点「确认支付」→ 前端停购提示", msg.includes("暂未开放购买"), msg);
  check("未跳转 Stripe 收银台", !/stripe\.com/.test(page.url()), page.url());
  await page.screenshot({ path: `${SHOT_DIR}/mobile-pay-gate.png` });

  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();