// 报税包整理器前端 API 客户端（正式版接后端用；未接入页面前不影响现有预览）
// 设计：后端部署后，在 formal.html 里先加载本文件（与 formal.html 同目录），
// 把 API_BASE 设为 Worker 地址，再按 INTEGRATION.md 把存储与登录逻辑切过来。
// API_BASE 为空时本模块不启用，页面保持现有 localStorage 行为。
(function (global) {
  var API_BASE = ""; // 部署后填 Worker 地址，如 https://tax-packet-api.<子域>.workers.dev
  var TOKEN_KEY = "tpo_token";
  // 正式收费开关。false = 前端不发起结账请求，直接提示"暂未开放"。
  // 只有 Worker 侧 /api/orders/checkout 已返回 503 subscription_closed 时才保持 false；
  // 定价公布、实体注册完成、由 li jun 明确同意后，前后端一起改为 true。
  var SUBSCRIPTION_OPEN = false;
  function closedError() {
    var err = new Error("subscription_closed");
    err.code = "subscription_closed";
    err.status = 503;
    return err;
  }
  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  async function req(path, opts) {
    opts = opts || {};
    var headers = { "content-type": "application/json" };
    var t = token();
    if (t) headers["authorization"] = "Bearer " + t;
    var r = await fetch(API_BASE + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) {
      var err = new Error((data && data.error) || ("http_" + r.status));
      err.code = (data && data.error) || ("http_" + r.status);
      err.status = r.status;
      if (r.status === 401) setToken(null);
      throw err;
    }
    return data;
  }
  var api = {
    get base() { return API_BASE; },
    setBase: function (u) { API_BASE = u; },
    enabled: function () { return !!API_BASE; },
    register: function (email, password) { return req("/api/register", { method: "POST", body: { email: email, password: password } }); },
    verify: function (email, code) { return req("/api/verify", { method: "POST", body: { email: email, code: code } }); },
    resendCode: function (email) { return req("/api/resend-code", { method: "POST", body: { email: email } }); },
    login: async function (email, password) {
      var d = await req("/api/login", { method: "POST", body: { email: email, password: password } });
      if (d.token) setToken(d.token);
      return d;
    },
    logout: async function () { try { await req("/api/logout", { method: "POST" }); } catch (e) {} setToken(null); },
    me: function () { return req("/api/me"); },
    getPacket: function () { return req("/api/packet"); },
    putPacket: function (packet) { return req("/api/packet", { method: "PUT", body: { packet: packet } }); },
    deletePacket: function () { return req("/api/packet", { method: "DELETE" }); },
    claimPromo: function (promo) { return req("/api/promo/claim", { method: "POST", body: { promo: promo || "first50" } }); },
    checkout: function (packs) {
      if (!SUBSCRIPTION_OPEN) return Promise.reject(closedError());
      return req("/api/orders/checkout", { method: "POST", body: { packs: packs } });
    },
    subscriptionOpen: function () { return SUBSCRIPTION_OPEN; },
    listOrders: function () { return req("/api/orders"); },
    support: function (email, message) { return req("/api/support", { method: "POST", body: { email: email, message: message } }); },
    aiChecklist: function (description, lang) { return req("/api/ai-checklist", { method: "POST", body: { description: description, lang: lang } }); },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.TpoApi = api;
})(typeof window !== "undefined" ? window : globalThis);
