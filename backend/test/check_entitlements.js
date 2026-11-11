// 季票权益验收：优先工具支持 / 多包与多年对比 / 批量归档核对
//
// 前提（本地，不碰线上）：
//   1) wrangler dev --local --port 8788（DEV_MODE=1，注册可拿验证码）
//   2) 仓库根目录 python3 -m http.server 8000 --bind 127.0.0.1
//   3) npm i playwright-core；本机 Chrome
//
// 用法：node backend/test/check_entitlements.js
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${String(detail).slice(0, 160)}]` : ""));
}

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: "Bearer " + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const ROWS = [
  { id: "r1", form: "W-2", kind: "w2", title: "W-2", payer: "Acme", request: "今年 W-2（Acme）", status: "uploaded", fileName: "w2.pdf", figure: { cat: "W-2 工资", cents: 5000000 }, voucherChecked: true, formAmountCents: 5000000 },
  { id: "r2", form: "1099-INT", kind: "int", title: "1099-INT", payer: "Bank", request: "今年 1099-INT（Bank）", status: "uploaded", fileName: "int.pdf", figure: null },
  { id: "r3", form: "Schedule C", kind: "selfemp", title: "Schedule C", payer: "Clients", request: "今年 Schedule C", status: "uploaded", fileName: "c.pdf", figure: { cat: "Schedule C 业务收入", cents: 1200000 }, voucherChecked: false, costs: [{ label: "广告", cents: null }, { label: "其他", custom: true, customLabel: "", cents: null }] },
  { id: "r4", form: "1098-T", kind: "edu", title: "1098-T", payer: "School", request: "今年 1098-T", status: "na" },
  { id: "r5", form: "1099-DIV", kind: "div", title: "1099-DIV", payer: "Broker", request: "今年 1099-DIV", status: "not-started", fileName: "" },
];

const SNAP_2025 = [{
  id: "s1", name: "2025 定稿", year: "2025", at: "2026/1/20 10:00:00",
  total: 2, done: 1,
  forms: { "W-2": { done: 1, total: 1 }, "8888 测试表": { done: 0, total: 1 } },
}];

(async () => {
  const email = `ent${Date.now()}@example.com`;
  const reg = await api("/api/register", { method: "POST", body: { email, password: "ent-test-1" } });
  if (!reg.body.dev_code) throw new Error("local worker needs DEV_MODE=1: " + JSON.stringify(reg));
  await api("/api/verify", { method: "POST", body: { email, code: reg.body.dev_code } });
  const login = await api("/api/login", { method: "POST", body: { email, password: "ent-test-1" } });
  const token = login.body.token;
  if (!token) throw new Error("login failed: " + JSON.stringify(login));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let supportRequests = [];
  let supportMode = "ok";

  async function open({ pass, checklist = ROWS }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    await page.route(WORKER_ORIGIN + "/**", async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.pathname === "/api/support") {
        supportRequests.push(req.postData() || "");
        if (supportMode === "ok") return route.fulfill({ status: 200, body: JSON.stringify({ ok: true, sent: true }), headers: { "content-type": "application/json" } });
        return route.fulfill({ status: 502, body: JSON.stringify({ ok: false, error: "send_failed" }), headers: { "content-type": "application/json" } });
      }
      const resp = await fetch(API + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      await route.fulfill({ status: resp.status, body: await resp.text(), headers: { "content-type": "application/json" } });
    });
    await page.addInitScript(([t, e, rows, snaps]) => {
      localStorage.setItem("tpo_token", t);
      localStorage.setItem("tpo_session", e);
      localStorage.setItem("tpo_snaps_" + e, JSON.stringify(snaps));
      window.__SEED_ROWS = rows || [];
    }, [token, email, checklist, SNAP_2025]);
    await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => typeof currentUser !== "undefined" && !!currentUser && typeof packet !== "undefined" && !!packet, null, { timeout: 20000 });
    await page.evaluate(() => {
      packet.checklist = window.__SEED_ROWS || [];
      savePacket();
      renderAll();
    });
    if (pass) {
      await api("/api/promo/claim", { method: "POST", token, body: { promo: "first50" } });
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => typeof currentUser !== "undefined" && !!currentUser && typeof packet !== "undefined" && !!packet, null, { timeout: 20000 });
      await page.evaluate(() => {
        packet.checklist = window.__SEED_ROWS || [];
        savePacket();
        renderAll();
      });
    }
    return { page, errors };
  }

  // 页面把每张卡折进 sec-body；验收要按用户展开后的样子看。
  async function expandAll(page) {
    await page.evaluate(() => {
      document.querySelectorAll(".sec-body, #appViewSections .card").forEach((el) => el.classList.remove("hidden"));
      document.querySelectorAll("#snapCard, #priorityDetails, #supportCard").forEach((el) => el.classList.remove("hidden"));
      document.querySelectorAll("details").forEach((d) => (d.open = true));
    });
    await page.waitForTimeout(200);
  }

  // ---------- 免费用户：三项权益都应看见说明，但拿不到结果 ----------
  {
    const { page, errors } = await open({ pass: false });
    await page.evaluate(() => { setOrganizeStep(3, false); });
    await expandAll(page);
    await page.waitForTimeout(300);

    const snapVisible = await page.locator("#snapCard").isVisible();
    check("免费用户：多包与多年对比卡片可见（不再被 CSS 隐藏）", snapVisible);
    const snapGate = await page.locator("#snapList").innerText();
    check("免费用户：对比卡片给领取入口", snapGate.includes("季票功能"), snapGate.slice(0, 80));
    const snapBtnDisabled = await page.locator("#btnSnapSave").isDisabled();
    check("免费用户：存版本按钮不可用", snapBtnDisabled);

    const prioVisible = await page.locator("#priorityDetails").isVisible();
    check("免费用户：优先工具支持可见", prioVisible);
    const prioText = await page.locator("#priorityStatus").innerText();
    check("免费用户：优先支持写明是季票功能", prioText.includes("季票功能"), prioText.slice(0, 80));
    const sendHidden = await page.locator("#btnSupportSend").isHidden();
    check("免费用户：看不到可点的提交按钮（不做假交互）", sendHidden);

    // CPA 交接工作台在线上曾经整块被 CSS 隐藏，这里按免费用户看到的样子验
    const handoffVisible = await page.locator("#handoffSection").isVisible();
    check("免费用户：CPA 交接工作台可见（不再被 CSS 隐藏）", handoffVisible);
    const handoffGate = await page.locator("#handoffGate").innerText();
    check("免费用户：交接工作台写明是季票功能", handoffGate.includes("季票功能"), handoffGate.slice(0, 60));
    const cpaBtnHidden = await page.locator("#btnCpaReview").isHidden();
    check("免费用户：标记已发送按钮不出现", cpaBtnHidden);
    const priorVisible = await page.locator("#priorCpaCard").isVisible();
    const priorEditable = await page.locator("#priorCpaName").isEditable().catch(() => false);
    check("免费用户：去年会计师卡可见且可填", priorVisible && priorEditable);

    await page.locator("#btnCheck").click();
    await page.waitForTimeout(300);
    const claim = await page.locator("#checkReport").innerText().catch(() => "");
    check("免费用户：批量归档核对弹领取闸门", claim.includes("先领取季票") || claim.includes("领取免费季票"), claim.slice(0, 80));
    check("免费用户：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---------- 有权益：批量归档核对 ----------
  {
    const { page, errors } = await open({ pass: true });
    await page.evaluate(() => { setOrganizeStep(3, false); refreshEntitlement(); });
    await page.waitForTimeout(800);
    await expandAll(page);
    await page.locator("#btnCheck").click();
    await page.waitForTimeout(400);
    const txt = await page.locator("#checkReport").innerText();
    check("批量核对：有权益时有结果不再弹闸门", !txt.includes("先领取季票"), txt.split("\n")[0]);
    check("批量核对：判定为不可交", txt.includes("不可交"), txt.split("\n")[0]);
    check("批量核对：红 1 / 黄 2 / 绿 2 / 共 5", /红 1/.test(txt) && /黄 2/.test(txt) && /绿 2/.test(txt) && /共 5/.test(txt), txt.split("\n")[1]);
    check("批量核对：列出缺什么（缺文件缺数字 / 未填数字 / 未对照凭证）",
      txt.includes("缺文件、缺数字") && txt.includes("有文件，未填数字") && txt.includes("数字未对照凭证"));
    check("批量核对：费用行覆盖数显示 0/1", txt.includes("费用行") && txt.includes("0 / 共 1"), (txt.match(/费用行[^\n]*/) || [""])[0]);
    await page.screenshot({ path: `${SHOT_DIR}/ent-batch-check.png` });

    // 空清单不得报「可交」
    await page.evaluate(() => { packet.checklist = []; savePacket(); runCheckReport(); });
    await page.waitForTimeout(200);
    const empty = await page.locator("#checkReport").innerText();
    check("批量核对：空清单不报可交", empty.includes("还没有清单") && !/^\s*可交/.test(empty.split("\n")[0]), empty.split("\n")[0]);
    // 有权益：交接工作台可操作，标记后留记录
    const cpaVisible = await page.locator("#btnCpaReview").isVisible();
    check("有权益：标记已发送按钮可点", cpaVisible);
    await page.locator("#btnCpaReview").click();
    await page.waitForTimeout(300);
    const cpaText = await page.locator("#cpaReviewText").innerText();
    check("有权益：标记后显示已发送给会计师", cpaText.includes("已发送给会计师"), cpaText.slice(0, 60));
    check("批量核对：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---------- 有权益：多包与多年对比 ----------
  {
    const { page, errors } = await open({ pass: true });
    await page.evaluate(() => { setOrganizeStep(3, false); refreshEntitlement(); });
    await page.waitForTimeout(800);
    await expandAll(page);
    const snap = await page.locator("#snapList").innerText();
    check("多年对比：出现年份版本与当前包并排", snap.includes("2025 定稿") && snap.includes("当前包"), snap.split("\n")[0]);
    check("多年对比：每格给可判定状态（齐 / 还缺 / 本版无）",
      snap.includes("齐") && /还缺 1/.test(snap) && snap.includes("本版无"), snap.split("\n").slice(1, 3).join(" / "));
    check("多年对比：直接说出今年新增 4 项并点名 Schedule C", /今年新增 4 项（/.test(snap) && snap.includes("Schedule C"), (snap.match(/今年新增[^\n]*/) || [""])[0]);
    check("多年对比：直接说出今年缺席 1 项（8888 测试表）", /今年没这项 1 项（8888 测试表/.test(snap), (snap.match(/今年没这项[^\n]*/) || [""])[0]);
    await page.screenshot({ path: `${SHOT_DIR}/ent-snap-compare.png` });

    // 存一版后表格多一列
    await page.fill("#snapName", "2026 初稿");
    await page.fill("#snapYear", "2026");
    await page.locator("#btnSnapSave").click();
    await page.waitForTimeout(300);
    const after = await page.locator("#snapList").innerText();
    check("多年对比：保存后新版本进表", after.includes("2026 初稿"));
    check("多年对比：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---------- 有权益：优先工具支持真实提交 ----------
  {
    supportRequests = [];
    supportMode = "ok";
    const { page, errors } = await open({ pass: true });
    await page.evaluate(() => { setOrganizeStep(3, false); refreshEntitlement(); });
    await page.waitForTimeout(800);
    await expandAll(page);
    await page.evaluate(() => { const d = document.getElementById("priorityDetails"); if (!d.open) d.open = true; });
    await page.fill("#supportText", "清单里 Schedule E 的凭证核对卡住了，帮我看看。");
    await page.locator("#btnSupportSend").click();
    await page.waitForTimeout(800);
    const body = supportRequests.join("\n");
    check("优先支持：请求真的发到支持接口（不是只存本机）", supportRequests.length === 1, supportRequests.length + " request(s)");
    check("优先支持：请求带【季票优先】标记", body.includes("季票优先"), body.slice(0, 120));
    check("优先支持：请求带账号邮箱", body.includes(email), body.slice(-80));
    const sentText = await page.locator("#priorityStatus").innerText();
    check("优先支持：页面显示已提交", sentText.includes("已提交"), sentText.slice(0, 100));
    const list = await page.locator("#supportList").innerText();
    check("优先支持：请求列表标已提交", list.includes("已提交"), list.slice(0, 100));
    check("优先支持：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.screenshot({ path: `${SHOT_DIR}/ent-priority.png` });

    // 失败要诚实：给出可用的邮件兜底，不谎称成功
    supportRequests = [];
    supportMode = "fail";
    await page.fill("#supportText", "第二次提问：导出 PDF 少了一页。");
    await page.locator("#btnSupportSend").click();
    await page.waitForTimeout(800);
    const msg = await page.locator("#prioritySendMsg").innerText();
    const href = await page.locator("#prioritySendMsg a").getAttribute("href").catch(() => "");
    check("优先支持：提交失败不谎称成功", msg.includes("没成功") || msg.includes("失败"), msg.slice(0, 100));
    check("优先支持：失败时给已填好的邮件兜底", String(href).startsWith("mailto:support@zhuanuc.com"), String(href).slice(0, 80));
    await page.close();
  }

  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();