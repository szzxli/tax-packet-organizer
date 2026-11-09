// 报税包整理器后端 · Cloudflare Worker（单文件，无 npm 依赖）
// 设计要点：
// - 账号：邮箱＋密码，PBKDF2-SHA256（10 万次）存盐与哈希；会话令牌只存 SHA-256 哈希。
// - 包数据：D1 存 AES-GCM 密文（PACKET_KEY，32 字节 base64），文件内容本身不上后端，
//   只同步清单、数字、文件名与状态（与现有隐私口径一致：不存社保号）。
// - 邮箱验证码：6 位，存哈希，15 分钟有效，最多 5 次尝试，60 秒重发冷却。
// - 订阅：Stripe Checkout 一次性付款（按季、无自动续）；Webhook 验签后开通至当年 10 月 15 日。
// - 前 50 名免费季：promo_caps 行原子扣减（UPDATE … WHERE claimed < cap），防超发。
// - 生产必须设置：PACKET_KEY、STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET、RESEND_API_KEY、
//   FRONTEND_ORIGIN；未设置时对应功能返回明确错误，不回落为明文/假成功（DEV_MODE 除外）。

function b64enc(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64dec(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(d);
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}
// 站点主域固定在这里：付款回流地址不跟 FRONTEND_ORIGIN 走，避免旧密钥把用户送回老域。
const SITE = "https://tax.ucplan.org";
// 老域过渡期仍收：GitHub Pages 对老路径是 301，浏览器发来的 Origin 可能还是它。
const LEGACY_SITE = "https://szzxli.github.io";
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = [SITE, LEGACY_SITE, "http://localhost:8787"];
  if (env.FRONTEND_ORIGIN && !allowed.includes(env.FRONTEND_ORIGIN)) allowed.push(env.FRONTEND_ORIGIN);
  if (allowed.includes(origin)) return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };
  return {};
}
async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}
async function hashPassword(password, saltB64) {
  const salt = saltB64 ? b64dec(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return { salt: b64enc(salt), hash: b64enc(new Uint8Array(bits)) };
}
async function getAesKey(env) {
  if (!env.PACKET_KEY) return null;
  return crypto.subtle.importKey("raw", b64dec(env.PACKET_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptPacket(env, obj) {
  const key = await getAesKey(env);
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  if (!key) return { enc: 0, data: new TextDecoder().decode(plain) };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { enc: 1, data: b64enc(iv) + "." + b64enc(new Uint8Array(ct)) };
}
async function decryptPacket(env, row) {
  if (row.enc === 0) return JSON.parse(row.data);
  const key = await getAesKey(env);
  if (!key) throw new Error("packet_key_missing");
  const [ivB64, ctB64] = row.data.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64dec(ivB64) }, key, b64dec(ctB64));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function sendCodeEmail(env, to, code) {
  const key = (env.RESEND_API_KEY || "").trim();
  if (env.EMAIL_PROVIDER === "resend" && key) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: (env.EMAIL_FROM || "报税包整理器 <noreply@ucplan.org>").trim(),
          to: [to],
          subject: "你的邮箱验证码",
          text: "你的验证码是 " + code + "，15 分钟内有效。请勿转发给他人。",
        }),
      });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: "send_failed" };
    }
  }
  return { ok: false, error: "email_not_configured" };
}
async function sendSupportEmail(env, fromEmail, message) {
  const key = (env.RESEND_API_KEY || "").trim();
  if (env.EMAIL_PROVIDER === "resend" && key) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: (env.EMAIL_FROM || "报税包整理器 <noreply@zhuanuc.com>").trim(),
          to: ["support@zhuanuc.com"],
          reply_to: [fromEmail],
          subject: "技术支持请求",
          text: "来自 " + fromEmail + " 的技术支持请求：\n\n" + message,
        }),
      });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: "send_failed" };
    }
  }
  return { ok: false, error: "email_not_configured" };
}
// 运维告警：付款链路出问题必须有人知道。邮件服务未配置时静默失败，
// 原始记录仍在 webhook_failures 表里，不因为告警发不出去而影响主流程。
async function sendOpsAlert(env, subject, lines) {
  const key = (env.RESEND_API_KEY || "").trim();
  if (env.EMAIL_PROVIDER !== "resend" || !key) return { ok: false, error: "email_not_configured" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: (env.EMAIL_FROM || "报税包整理器 <noreply@ucplan.org>").trim(),
        to: ["support@zhuanuc.com"],
        subject: "[tax-packet 告警] " + subject,
        text: [subject].concat(lines || []).join("\n") + "\n\n时间：" + new Date().toISOString(),
      }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: "send_failed" };
  }
}
// AI 清单生成：优先走 AI Gateway（AI_GATEWAY_URL + AI_PROVIDER_KEY + AI_MODEL），
// 未配置时回落到 Workers AI 绑定（env.AI，Llama 3.1 8B）。描述不存服务器。
function aiSystemPrompt(lang) {
  if (lang === "es") return "Eres un asistente que organiza documentos fiscales de EE. UU. El usuario describió sus ingresos, su situación familiar y los cambios de este año. Enumera los documentos que debe preparar para la declaración de este año. Devuelve SOLO un objeto JSON con una única clave items cuyo valor es una matriz de objetos, sin ningún otro texto. Cada elemento es un objeto con: form (tipo de formulario del IRS, p. ej. W-2, 1099-INT, Schedule C, 1098, o una descripción como “recibo de impuesto sobre la propiedad”), payer (pagador/empleador/institución, o cadena vacía si se desconoce), prepare (qué documento o evidencia preparar, una frase), why (por qué se necesita este elemento, una frase). Incluye solo elementos relacionados con la descripción. No inventes montos, nombres ni SSN. No des conclusiones fiscales, no decidas si algo es deducible o exento, no hables de reembolsos. Máximo 20 elementos.";
  if (lang === "en") return "You are a US tax-document organizing assistant. The user described their income, family situation, and this year's changes. List the documents they need to prepare for this year's tax return. Return ONLY a JSON object with a single key items whose value is an array of objects, no other text. Each element is an object with: form (IRS form type, e.g. W-2, 1099-INT, Schedule C, 1098, or a description like “property tax bill”), payer (payer/employer/institution, or an empty string if unknown), prepare (what document or evidence to prepare, one sentence), why (why this item is needed, one sentence). Include only items related to the description. Do not invent amounts, names, or SSNs. Do not give tax conclusions, do not decide whether anything is deductible or exempt, do not talk about refunds. At most 20 items.";
  return "你是一位美国报税材料整理助手。用户描述了自己的收入、家庭情况和今年的变化。请根据描述，列出今年报税需要准备的材料清单。只输出一个 JSON 对象，只含一个键 items，其值是一个对象数组，不要输出其他文字。数组每一项是一个对象，包含以下字段：form（IRS 表类型，如 W-2、1099-INT、Schedule C、1098，或文件描述如“房产税单”）、payer（付款方/雇主/机构，没有就填空字符串）、prepare（要准备什么文件或证据，一句话）、why（为什么需要这一项，一句话）。只列与描述相关的项，不要编造具体金额、姓名、社保号。不要给税务结论，不要判断能不能抵扣或免税，不要说能不能退税。最多 20 项。";
}
function parseAiJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/,"");
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(t.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch { return null; }
}
function normalizeAiItems(v) {
  if (!v) return null;
  if (typeof v === "string") return parseAiJson(v);
  if (Array.isArray(v)) return v;
  if (typeof v === "object") {
    if (Array.isArray(v.items)) return v.items;
    if (Array.isArray(v.checklist)) return v.checklist;
    if (typeof v.form === "string" && typeof v.prepare === "string") return [v];
  }
  return null;
}
async function callModel(env, lang, desc) {
  const sys = aiSystemPrompt(lang);
  const gw = (env.AI_GATEWAY_URL || "").trim();
  const key = (env.AI_PROVIDER_KEY || "").trim();
  const model = (env.AI_MODEL || "").trim();
  if (gw && key) {
    try {
      const r = await fetch(gw, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || "gpt-4o-mini", messages: [{ role: "system", content: sys }, { role: "user", content: desc }], temperature: 0.2, max_tokens: 2048, response_format: { type: "json_object" } }),
      });
      if (!r.ok) return { ok: false, error: "ai_upstream_" + r.status };
      const d = await r.json();
      const text = d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : "";
      return { ok: true, text };
    } catch (e) { return { ok: false, error: "ai_failed" }; }
  }
  if (env.AI) {
    try {
      const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [{ role: "system", content: sys }, { role: "user", content: desc }], temperature: 0.2, max_tokens: 2048, response_format: { type: "json_object" } });
      return { ok: true, text: (out && out.response) || "" };
    } catch (e) { return { ok: false, error: "ai_failed" }; }
  }
  return { ok: false, error: "ai_not_configured" };
}
async function auth(req, env) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  const tokenHash = await sha256hex(m[1]);
  const s = await env.DB.prepare("SELECT account_id, expires_at FROM sessions WHERE token_hash=?").bind(tokenHash).first();
  if (!s || Date.now() > s.expires_at) return null;
  const a = await env.DB.prepare("SELECT id, email, verified FROM accounts WHERE id=?").bind(s.account_id).first();
  return a || null;
}
function seasonEnd() {
  const now = new Date();
  const y = now.getUTCFullYear();
  // 当年 10 月 15 日（UTC）；已过则顺延至下一年 10 月 15 日。
  const endThis = Date.UTC(y, 9, 15);
  const end = now.getTime() > endThis ? Date.UTC(y + 1, 9, 15) : endThis;
  return end;
}
// 权益唯一出口（#77 3.2）：订阅、一次性订单、促销只在这里合并，其它地方不得自行判断。
// 返回 { end, active, source }；end=0 表示从未开通。source 取到期时间最长的那一路。
async function entitlementInfo(env, accountId) {
  const now = Date.now();
  const s = await currentSubscription(env, accountId);
  // 有订阅记录时以订阅为准：orders 只是收款记录，取消/退款后不能凭旧的 entitlement_end 继续放行。
  // 没有订阅记录的存量账号仍按一次性订单计算（迁移不补历史行）。
  const subEnd = s && ["active", "trialing", "past_due"].includes(s.status) && s.current_period_end > now ? s.current_period_end : 0;
  const o = s ? { m: 0 } : await env.DB.prepare("SELECT MAX(entitlement_end) m FROM orders WHERE account_id=? AND status='paid' AND entitlement_end>=?").bind(accountId, now).first();
  const p = await env.DB.prepare("SELECT MAX(entitlement_end) m FROM promo_claims WHERE account_id=? AND entitlement_end>=?").bind(accountId, now).first();
  const orderEnd = o?.m || 0, promoEnd = p?.m || 0;
  const end = Math.max(subEnd, orderEnd, promoEnd);
  const source = end === 0 ? null : end === subEnd ? "subscription" : end === orderEnd ? "order" : "promo";
  return { end, active: end > now, source };
}
// 套餐与订阅（payments-spec v0.1 §1-§2）。价格唯一来源是 plans 表。
async function getPlan(env, code) {
  if (!code) return null;
  return env.DB.prepare("SELECT code, name, price_cents, currency, period, auto_renew FROM plans WHERE code=? AND active=1").bind(code).first();
}
function planPeriodEnd(plan, fromMs) {
  const from = fromMs || Date.now();
  if (plan.period === "year") {
    const d = new Date(from);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.getTime();
  }
  return seasonEnd();
}
// 只允许 spec §2 的迁移；其余拒绝并留审计，不静默改写。
const SUB_TRANSITIONS = {
  none: ["active"],
  active: ["active", "past_due", "canceled", "expired"],
  past_due: ["active", "past_due", "expired", "canceled"],
  canceled: ["active"],
  expired: ["active"],
};
function subTransitionAllowed(from, to) {
  return (SUB_TRANSITIONS[from || "none"] || []).includes(to);
}
async function currentSubscription(env, accountId) {
  return env.DB.prepare("SELECT * FROM subscriptions WHERE account_id=?").bind(accountId).first();
}
async function subscriptionView(env, accountId) {
  const s = await currentSubscription(env, accountId);
  if (!s) return null;
  const plan = await env.DB.prepare("SELECT auto_renew FROM plans WHERE code=?").bind(s.plan_code).first();
  return { plan: s.plan_code, status: s.status, period_end: s.current_period_end, cancel_at_period_end: !!s.cancel_at_period_end, auto_renew: !!plan?.auto_renew };
}
function subEventStmt(env, sub, from, to, reason, at) {
  return env.DB.prepare("INSERT INTO subscription_events (subscription_id, account_id, from_status, to_status, reason, created_at) VALUES (?,?,?,?,?,?)")
    .bind(sub?.id || null, sub?.account_id || null, from || null, to, reason.slice(0, 120), at);
}
function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const bad = (msg, status = 400) => json({ ok: false, error: msg }, status, cors);
    const ok = (data) => json({ ok: true, ...data }, 200, cors);

    // 订阅停购闸门（checkout-503-spec，#77 3.1）：定价公布 + 实体注册完成前，
    // POST /api/orders/checkout 一律 503 subscription_closed，不发 Stripe、不写 D1。
    // 放在鉴权之前：未登录不返回 401，登录后也到不了 Stripe。开闸时改 SUBSCRIPTION_OPEN 为 true。
    const SUBSCRIPTION_OPEN = false;
    if (!SUBSCRIPTION_OPEN && path === "/api/orders/checkout" && req.method === "POST") {
      return bad("subscription_closed", 503);
    }

    if (path === "/api/health" && req.method === "GET") return ok({ version: "tpo-api-4", subscription_open: SUBSCRIPTION_OPEN });

    // 套餐公开可读：价格、周期、是否自动续费只有这一个来源。
    if (path === "/api/plans" && req.method === "GET") {
      const rows = await env.DB.prepare("SELECT code, name, price_cents, currency, period, auto_renew FROM plans WHERE active=1 ORDER BY sort").all();
      return ok({ plans: (rows.results || []).map((p) => ({ ...p, auto_renew: !!p.auto_renew })) });
    }

    if (path === "/api/register" && req.method === "POST") {
      const b = await readJson(req);
      const email = (b?.email || "").trim().toLowerCase();
      const password = b?.password || "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("bad_email");
      if (password.length < 8) return bad("password_too_short");
      const exists = await env.DB.prepare("SELECT id FROM accounts WHERE email=?").bind(email).first();
      if (exists) return bad("already_registered", 409);
      const pw = await hashPassword(password);
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO accounts (id, email, pw_salt, pw_hash, verified, created_at) VALUES (?,?,?,?,0,?)").bind(id, email, pw.salt, pw.hash, Date.now()).run();
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await sha256hex(code);
      await env.DB.prepare("DELETE FROM email_codes WHERE account_id=?").bind(id).run();
      await env.DB.prepare("INSERT INTO email_codes (account_id, code_hash, expires_at, attempts, last_sent_at) VALUES (?,?,?,?,?)").bind(id, codeHash, Date.now() + 15 * 60 * 1000, 0, Date.now()).run();
      const sent = await sendCodeEmail(env, email, code);
      if (!sent.ok && env.DEV_MODE === "1") return ok({ dev_code: code, email_not_configured: true });
      if (!sent.ok) return bad(sent.error || ("resend_status_" + (sent.status || "?")), 500);
      return ok({});
    }

    if (path === "/api/verify" && req.method === "POST") {
      const b = await readJson(req);
      const email = (b?.email || "").trim().toLowerCase();
      const code = (b?.code || "").trim();
      const a = await env.DB.prepare("SELECT id FROM accounts WHERE email=?").bind(email).first();
      if (!a) return bad("not_registered", 404);
      const c = await env.DB.prepare("SELECT * FROM email_codes WHERE account_id=?").bind(a.id).first();
      if (!c) return bad("no_code", 400);
      if (Date.now() > c.expires_at) return bad("code_expired", 400);
      if (c.attempts >= 5) return bad("too_many_attempts", 429);
      if ((await sha256hex(code)) !== c.code_hash) {
        await env.DB.prepare("UPDATE email_codes SET attempts=attempts+1 WHERE account_id=?").bind(a.id).run();
        return bad("bad_code", 400);
      }
      await env.DB.prepare("UPDATE accounts SET verified=1 WHERE id=?").bind(a.id).run();
      await env.DB.prepare("DELETE FROM email_codes WHERE account_id=?").bind(a.id).run();
      return ok({});
    }

    if (path === "/api/resend-code" && req.method === "POST") {
      const b = await readJson(req);
      const email = (b?.email || "").trim().toLowerCase();
      const a = await env.DB.prepare("SELECT id, verified FROM accounts WHERE email=?").bind(email).first();
      if (!a || a.verified) return bad("not_pending", 400);
      const c = await env.DB.prepare("SELECT * FROM email_codes WHERE account_id=?").bind(a.id).first();
      if (c && Date.now() - c.last_sent_at < 60 * 1000) return bad("cooldown", 429);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.DB.prepare("INSERT OR REPLACE INTO email_codes (account_id, code_hash, expires_at, attempts, last_sent_at) VALUES (?,?,?,?,?)").bind(a.id, await sha256hex(code), Date.now() + 15 * 60 * 1000, 0, Date.now()).run();
      const sent = await sendCodeEmail(env, email, code);
      if (!sent.ok && env.DEV_MODE === "1") return ok({ dev_code: code, email_not_configured: true });
      if (!sent.ok) return bad(sent.error || ("resend_status_" + (sent.status || "?")), 500);
      return ok({});
    }

    if (path === "/api/login" && req.method === "POST") {
      const b = await readJson(req);
      const email = (b?.email || "").trim().toLowerCase();
      const password = b?.password || "";
      const a = await env.DB.prepare("SELECT * FROM accounts WHERE email=?").bind(email).first();
      if (!a) return bad("bad_credentials", 401);
      if (!a.verified) return bad("not_verified", 403);
      const pw = await hashPassword(password, a.pw_salt);
      if (pw.hash !== a.pw_hash) return bad("bad_credentials", 401);
      const token = b64enc(crypto.getRandomValues(new Uint8Array(32)));
      await env.DB.prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?,?,?)").bind(await sha256hex(token), a.id, Date.now() + 30 * 24 * 3600 * 1000).run();
      return ok({ token });
    }

    if (path === "/api/logout" && req.method === "POST") {
      const m = (req.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
      if (m) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256hex(m[1])).run();
      return ok({});
    }

    if (path === "/api/support" && req.method === "POST") {
      const b = await readJson(req);
      const email = (b?.email || "").trim().toLowerCase();
      const message = (b?.message || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("bad_email");
      if (!message || message.length > 2000) return bad("bad_message");
      const ip = req.headers.get("CF-Connecting-IP") || "";
      const ipHash = await sha256hex(ip || "unknown");
      const hourAgo = Date.now() - 3600 * 1000;
      await env.DB.prepare("DELETE FROM support_rate WHERE created_at<?").bind(hourAgo).run();
      const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM support_rate WHERE ip_hash=? AND created_at>?").bind(ipHash, hourAgo).first();
      if (cnt && cnt.n >= 5) return bad("too_many", 429);
      await env.DB.prepare("INSERT INTO support_rate (ip_hash, created_at) VALUES (?,?)").bind(ipHash, Date.now()).run();
      const sent = await sendSupportEmail(env, email, message);
      if (!sent.ok) return bad(sent.error || "send_failed", 502);
      return ok({ sent: true });
    }

    if (path === "/api/ai-checklist" && req.method === "POST") {
      const b = await readJson(req);
      const desc = (b?.description || "").trim();
      const lang = (b?.lang === "en" || b?.lang === "es") ? b.lang : "zh";
      if (!desc || desc.length > 2000) return bad("bad_description");
      const ip = req.headers.get("CF-Connecting-IP") || "";
      const ipHash = await sha256hex(ip || "unknown");
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      await env.DB.prepare("DELETE FROM ai_rate WHERE created_at<?").bind(dayAgo).run();
      const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_rate WHERE ip_hash=? AND created_at>?").bind(ipHash, dayAgo).first();
      if (cnt && cnt.n >= 5) return bad("too_many", 429);
      const res = await callModel(env, lang, desc);
      if (!res.ok) return bad(res.error || "ai_failed", 502);
      const items = normalizeAiItems(res.text);
      if (!items) return bad("ai_bad_response", 502);
      const clean = items.slice(0, 20).map((it) => ({
        form: String((it && it.form) || "").trim().slice(0, 60),
        payer: String((it && it.payer) || "").trim().slice(0, 80),
        prepare: String((it && it.prepare) || "").trim().slice(0, 200),
        why: String((it && it.why) || "").trim().slice(0, 200),
      })).filter((it) => it.form && it.prepare);
      if (!clean.length) return bad("ai_bad_response", 502);
      await env.DB.prepare("INSERT INTO ai_rate (ip_hash, created_at) VALUES (?,?)").bind(ipHash, Date.now()).run();
      return ok({ items: clean });
    }

    // 以下接口需要登录（Stripe 回调除外：它用 HMAC 签名验签，不带登录令牌）。
    const me = await auth(req, env);
    if (!me && path.startsWith("/api/") && path !== "/api/stripe/webhook") return bad("unauthorized", 401);

    if (path === "/api/me" && req.method === "GET") {
      const e = await entitlementInfo(env, me.id);
      // entitlement_end 保留给现有前端；entitlement 是新增的结构化口径；
      // subscription 只在有订阅记录时出现，页面据此显示有效期与是否续费。
      return ok({ email: me.email, entitlement_end: e.end, entitlement: e, subscription: await subscriptionView(env, me.id) });
    }
    if (path === "/api/subscriptions/cancel" && req.method === "POST") {
      // 取消 = 期末不再续费（spec §3 C），不立即收回当期权益。
      const s = await currentSubscription(env, me.id);
      if (!s) return bad("no_subscription", 404);
      if (!s.provider_subscription_id || s.provider_subscription_id.startsWith("pass:")) return bad("not_recurring", 409);
      if (!["active", "trialing", "past_due"].includes(s.status)) return bad("not_cancelable", 409);
      if (!env.STRIPE_SECRET_KEY) return bad("stripe_not_configured", 500);
      const r = await fetch((env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "") + "/v1/subscriptions/" + encodeURIComponent(s.provider_subscription_id), {
        method: "POST",
        headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
        body: "cancel_at_period_end=true",
      });
      if (!r.ok) return bad("stripe_error", 502);
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare("UPDATE subscriptions SET cancel_at_period_end=1, updated_at=? WHERE id=?").bind(now, s.id),
        subEventStmt(env, s, s.status, s.status, "cancel_at_period_end", now),
      ]);
      return ok({ subscription: await subscriptionView(env, me.id), entitlement: await entitlementInfo(env, me.id) });
    }
    if (path === "/api/orders" && req.method === "GET") {
      const rows = await env.DB.prepare("SELECT stripe_session_id AS id, packs, amount_cents, status, entitlement_end, created_at FROM orders WHERE account_id=? ORDER BY created_at DESC LIMIT 20").bind(me.id).all();
      return ok({ orders: (rows.results || []).map((r) => ({ id: r.id, packs: r.packs, amount_cents: r.amount_cents, status: r.status, entitlement_end: r.entitlement_end, created_at: r.created_at })) });
    }
    if (path === "/api/packet" && req.method === "GET") {
      const row = await env.DB.prepare("SELECT enc, data FROM packets WHERE account_id=?").bind(me.id).first();
      if (!row) return ok({ packet: null });
      try { return ok({ packet: await decryptPacket(env, row) }); }
      catch { return bad("packet_key_missing", 500); }
    }
    if (path === "/api/packet" && req.method === "PUT") {
      const b = await readJson(req);
      if (!b || typeof b.packet !== "object") return bad("bad_packet");
      const raw = JSON.stringify(b.packet);
      if (raw.length > 1024 * 1024) return bad("packet_too_large", 413);
      const e = await encryptPacket(env, b.packet);
      await env.DB.prepare("INSERT INTO packets (account_id, enc, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET enc=excluded.enc, data=excluded.data, updated_at=excluded.updated_at").bind(me.id, e.enc, e.data, Date.now()).run();
      return ok({});
    }
    if (path === "/api/packet" && req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM packets WHERE account_id=?").bind(me.id).run();
      return ok({});
    }

    if (path === "/api/promo/claim" && req.method === "POST") {
      const b = await readJson(req);
      const promo = b?.promo || "first50";
      const already = await env.DB.prepare("SELECT 1 FROM promo_claims WHERE account_id=? AND promo=?").bind(me.id, promo).first();
      if (already) return bad("already_claimed", 409);
      const r = await env.DB.prepare("UPDATE promo_caps SET claimed = claimed + 1 WHERE promo=? AND claimed < cap").bind(promo).run();
      if (!r.meta || r.meta.changes === 0) return bad("promo_full", 409);
      await env.DB.prepare("INSERT INTO promo_claims (account_id, promo, entitlement_end, claimed_at) VALUES (?,?,?,?)").bind(me.id, promo, seasonEnd(), Date.now()).run();
      return ok({ entitlement_end: seasonEnd() });
    }

    if (path === "/api/orders/checkout" && req.method === "POST") {
      if (!env.STRIPE_SECRET_KEY) return bad("stripe_not_configured", 500);
      // 连点保护：2 分钟内同一账号已有未完成订单就直接拒绝，避免重复建 Stripe 会话、
      // 重复扣款与多条 pending 订单。2 分钟足够挡住双击/回车连按，也不至于把
      // 关掉支付页想重来的人关在门外。
      const pending = await env.DB.prepare("SELECT 1 FROM orders WHERE account_id=? AND status='pending' AND created_at>?").bind(me.id, Date.now() - 2 * 60 * 1000).first();
      if (pending) return bad("checkout_pending", 409);
      const b = await readJson(req);
      const packs = b?.packs === 2 ? 2 : 1;
      const planCode = (typeof b?.plan_code === "string" && b.plan_code) ? b.plan_code : (packs === 2 ? "season_2" : "season_1");
      const plan = await getPlan(env, planCode);
      if (!plan) return bad("bad_plan", 400);
      // 金额只认 plans 表，不接受前端传价（spec §3 A）。
      const params = new URLSearchParams({
        mode: plan.auto_renew ? "subscription" : "payment",
        "line_items[0][price_data][currency]": plan.currency,
        "line_items[0][price_data][product_data][name]": plan.name,
        "line_items[0][price_data][unit_amount]": String(plan.price_cents),
        "line_items[0][quantity]": "1",
        success_url: SITE + "/formal.html?paid=1",
        cancel_url: SITE + "/formal.html?canceled=1",
        "metadata[account_id]": me.id,
        "metadata[plan_code]": plan.code,
        "metadata[packs]": String(packs),
      });
      if (plan.auto_renew) params.set("line_items[0][price_data][recurring][interval]", plan.period === "year" ? "year" : "month");
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const s = await r.json();
      if (!r.ok) return bad("stripe_error", 502);
      await env.DB.prepare("INSERT INTO orders (id, account_id, packs, amount_cents, status, stripe_session_id, created_at) VALUES (?,?,?,?, 'pending', ?, ?)").bind(s.id, me.id, packs, plan.price_cents, s.id, Date.now()).run();
      return ok({ url: s.url });
    }

    if (path === "/api/stripe/webhook" && req.method === "POST") {
      if (!env.STRIPE_WEBHOOK_SECRET) return bad("stripe_not_configured", 500);
      const raw = await req.text();
      const sig = req.headers.get("stripe-signature") || "";
      // 签名校验：解析 t 与所有 v1；时间戳 5 分钟容差（防重放），签名用常量时间比较。
      let ts = 0; const v1 = [];
      for (const part of sig.split(",")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
        if (k === "t") ts = parseInt(v, 10) || 0;
        else if (k === "v1") v1.push(v);
      }
      if (!ts || !v1.length) return bad("bad_signature", 400);
      if (Math.abs(Date.now() / 1000 - ts) > 300) return bad("bad_signature", 400);
      const signed = ts + "." + raw;
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)));
      if (!v1.some((s) => safeEqualHex(mac, s))) return bad("bad_signature", 400);
      // 验签通过之后才解析/落库；解析失败按 400 退回，不写任何行、不吐堆栈。
      let ev;
      try { ev = JSON.parse(raw); } catch { return bad("bad_event", 400); }
      if (!ev || typeof ev.id !== "string" || typeof ev.type !== "string") return bad("bad_event", 400);
      // 幂等（#77 3.3）：事件 id 先查 stripe_events，已处理过直接 200。
      // 事件落库 + 订单开通放同一个 D1 batch（原子），不允许先写订单再算权益分两次成功。
      // D1 写失败返回 5xx，Stripe 会自动重试；不返回 200，避免「扣了钱、/api/me 还是 0」的终态。
      const seen = await env.DB.prepare("SELECT 1 FROM stripe_events WHERE id=?").bind(ev.id).first();
      if (seen) return ok({ received: true, duplicate: true });
      const stmts = [env.DB.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES (?,?,?)").bind(ev.id, ev.type, Date.now())];
      // 拒付/隔离口径：缺账号、未真正付款这类事件重投也不会变好，所以落一条
      // webhook_failures 给人看 + 发告警，然后回 200 让 Stripe 停止重试，
      // 绝不凭一条不完整的事件开通权益。
      let quarantine = null;
      const now = Date.now();
      const packOf = (code, packs) => code === "season_2" ? 2 : code === "annual_2" ? 2 : packs;
      if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
        const sess = ev.data && ev.data.object;
        if (!sess || typeof sess.id !== "string") return bad("bad_event", 400);
        const accountId = (sess.metadata && sess.metadata.account_id) || "";
        if (!accountId) quarantine = "missing_account_id";
        else if (sess.payment_status && sess.payment_status !== "paid") quarantine = "unpaid_session:" + sess.payment_status;
        else {
          const packs = parseInt((sess.metadata && sess.metadata.packs) || "1", 10) || 1;
          const planCode = (sess.metadata && sess.metadata.plan_code) || (packs === 2 ? "season_2" : "season_1");
          const plan = await getPlan(env, planCode);
          if (!plan) quarantine = "bad_plan:" + planCode;
          else {
            const sub = await currentSubscription(env, accountId);
            const from = sub ? sub.status : "none";
            if (!subTransitionAllowed(from, "active")) quarantine = "illegal_transition:" + from + "->active";
            else {
              const end = planPeriodEnd(plan, now);
              stmts.push(env.DB.prepare("INSERT INTO orders (id, account_id, packs, amount_cents, status, stripe_session_id, provider_event_id, entitlement_end, payment_intent_id, created_at) VALUES (?,?,?,?, 'paid', ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status='paid', provider_event_id=excluded.provider_event_id, entitlement_end=excluded.entitlement_end, payment_intent_id=excluded.payment_intent_id")
                .bind(sess.id, accountId, packOf(plan.code, packs), sess.amount_total || plan.price_cents, sess.id, ev.id, end, sess.payment_intent || null, now));
              // 订阅记录：一个账号一行；一次性季票也落一行，页面据此显示有效期。
              const providerId = sess.subscription || ("pass:" + sess.id);
              stmts.push(env.DB.prepare("INSERT INTO subscriptions (id, account_id, plan_code, status, current_period_start, current_period_end, cancel_at_period_end, provider_subscription_id, created_at, updated_at) VALUES (?,?,?, 'active', ?, ?, 0, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET plan_code=excluded.plan_code, status='active', current_period_start=excluded.current_period_start, current_period_end=MAX(subscriptions.current_period_end, excluded.current_period_end), cancel_at_period_end=0, provider_subscription_id=CASE WHEN excluded.provider_subscription_id LIKE 'pass:%' THEN COALESCE(subscriptions.provider_subscription_id, excluded.provider_subscription_id) ELSE COALESCE(excluded.provider_subscription_id, subscriptions.provider_subscription_id) END, updated_at=excluded.updated_at")
                .bind("sub_" + accountId, accountId, plan.code, now, end, providerId, now, now));
              stmts.push(subEventStmt(env, { id: "sub_" + accountId, account_id: accountId }, from, "active", "checkout_completed:" + plan.code, now));
            }
          }
        }
      } else if (ev.type === "checkout.session.expired") {
        // 用户放弃付款：pending 订单标记 expired，避免 /api/orders 长期挂一笔待支付。
        const sess = ev.data && ev.data.object;
        if (sess && typeof sess.id === "string") stmts.push(env.DB.prepare("UPDATE orders SET status='expired' WHERE id=? AND status='pending'").bind(sess.id));
      } else if (ev.type === "invoice.paid") {
        // 续费（spec §3 B）：同一订阅只延期，不产生第二条订阅记录。
        const inv = ev.data && ev.data.object;
        const providerId = (inv && (inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription))) || "";
        let sub = providerId ? await env.DB.prepare("SELECT * FROM subscriptions WHERE provider_subscription_id=?").bind(providerId).first() : null;
        if (!sub) {
          const accountId = (inv && inv.metadata && inv.metadata.account_id) || "";
          if (accountId) sub = await currentSubscription(env, accountId);
        }
        if (!sub) quarantine = "unknown_subscription";
        else if (!subTransitionAllowed(sub.status, "active")) quarantine = "illegal_transition:" + sub.status + "->active";
        else {
          const plan = await getPlan(env, sub.plan_code);
          if (!plan) quarantine = "bad_plan:" + sub.plan_code;
          else {
            const newEnd = planPeriodEnd(plan, Math.max(sub.current_period_end || 0, now));
            stmts.push(env.DB.prepare("UPDATE subscriptions SET status='active', current_period_start=?, current_period_end=?, cancel_at_period_end=0, updated_at=? WHERE id=?")
              .bind(sub.current_period_end || now, Math.max(newEnd, sub.current_period_end || 0), now, sub.id));
            stmts.push(subEventStmt(env, sub, sub.status, "active", "invoice_paid:" + ((inv && inv.id) || ""), now));
            if (inv && inv.id) {
              stmts.push(env.DB.prepare("INSERT INTO orders (id, account_id, packs, amount_cents, status, stripe_session_id, provider_event_id, entitlement_end, payment_intent_id, created_at) VALUES (?,?,?,?, 'paid', NULL, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
                .bind("in_" + inv.id, sub.account_id, plan.code.endsWith("_2") ? 2 : 1, inv.amount_paid || plan.price_cents, ev.id, Math.max(newEnd, sub.current_period_end || 0), (inv.payment_intent || inv.charge || null), now));
            }
          }
        }
      } else if (ev.type === "invoice.payment_failed") {
        const inv = ev.data && ev.data.object;
        const providerId = (inv && (inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription))) || "";
        const sub = providerId ? await env.DB.prepare("SELECT * FROM subscriptions WHERE provider_subscription_id=?").bind(providerId).first() : null;
        if (!sub) quarantine = "unknown_subscription";
        else if (!subTransitionAllowed(sub.status, "past_due")) quarantine = "illegal_transition:" + sub.status + "->past_due";
        else {
          stmts.push(env.DB.prepare("UPDATE subscriptions SET status='past_due', updated_at=? WHERE id=?").bind(now, sub.id));
          stmts.push(subEventStmt(env, sub, sub.status, "past_due", "invoice_payment_failed:" + ((inv && inv.id) || ""), now));
        }
      } else if (ev.type === "customer.subscription.deleted") {
        // 期末取消（spec §3 C）：立即删除的按现在失效，期末删除的按期末失效。
        const obj = ev.data && ev.data.object;
        const providerId = (obj && obj.id) || "";
        const sub = providerId ? await env.DB.prepare("SELECT * FROM subscriptions WHERE provider_subscription_id=?").bind(providerId).first() : null;
        if (!sub) quarantine = "unknown_subscription";
        else if (!subTransitionAllowed(sub.status, "canceled")) quarantine = "illegal_transition:" + sub.status + "->canceled";
        else {
          const end = Math.min(sub.current_period_end || now, now);
          stmts.push(env.DB.prepare("UPDATE subscriptions SET status='canceled', current_period_end=?, cancel_at_period_end=0, updated_at=? WHERE id=?").bind(end, now, sub.id));
          stmts.push(subEventStmt(env, sub, sub.status, "canceled", "subscription_deleted", now));
        }
      } else if (ev.type === "charge.refunded") {
        // 退款回滚（spec §4.7）：按 payment_intent 找到订单，全额退款才撤权益。
        const ch = ev.data && ev.data.object;
        const pi = (ch && ch.payment_intent) || "";
        const o = pi ? await env.DB.prepare("SELECT id, account_id, amount_cents, status FROM orders WHERE payment_intent_id=? ORDER BY created_at DESC LIMIT 1").bind(pi).first() : null;
        if (o) {
          const full = ch.amount_refunded == null || ch.amount_refunded >= (o.amount_cents || 0);
          if (full) {
            stmts.push(env.DB.prepare("UPDATE orders SET status='refunded', entitlement_end=0 WHERE id=?").bind(o.id));
            const sub = await currentSubscription(env, o.account_id);
            if (sub && ["active", "past_due"].includes(sub.status)) {
              if (subTransitionAllowed(sub.status, "expired")) {
                stmts.push(env.DB.prepare("UPDATE subscriptions SET status='expired', current_period_end=0, updated_at=? WHERE id=?").bind(now, sub.id));
                stmts.push(subEventStmt(env, sub, sub.status, "expired", "charge_refunded", now));
              } else quarantine = "illegal_transition:" + sub.status + "->expired";
            }
          }
        }
      }
      if (quarantine) stmts.push(env.DB.prepare("INSERT INTO webhook_failures (event_id, error, created_at) VALUES (?,?,?)").bind(ev.id, quarantine.slice(0, 200), Date.now()));
      try {
        await env.DB.batch(stmts);
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 200);
        try { await env.DB.prepare("INSERT INTO webhook_failures (event_id, error, created_at) VALUES (?,?,?)").bind(ev.id, msg, Date.now()).run(); } catch {}
        await sendOpsAlert(env, "webhook_db_failed " + ev.type, [ev.id, msg]);
        return bad("webhook_db_failed", 500);
      }
      if (quarantine) {
        await sendOpsAlert(env, "webhook_quarantined " + ev.type, [ev.id, quarantine]);
        return ok({ received: true, quarantined: true });
      }
      return ok({ received: true });
    }

    return bad("not_found", 404);
  },
};
