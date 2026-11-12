#!/usr/bin/env node
// 验收：R3 价格结构只在 pricing.json，页面只渲染；改 JSON 就变，空值不出占位符。
// 直接抽取 formal.html 的 PRICING_LOGIC 块执行，测的就是上线的那份代码；
// pricing.json 按仓库里那份真文件校验，另用样例数据证明「改 JSON 就变」。
// 跑法：node tools/test_pricing.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");
const pricing = JSON.parse(fs.readFileSync(path.join(root, "pricing.json"), "utf8"));

const start = html.indexOf("// PRICING_LOGIC_START");
const end = html.indexOf("// PRICING_LOGIC_END");
assert.ok(start > 0 && end > start, "缺 PRICING_LOGIC 块");

const sandbox = {
  LANG: "zh",
  console,
  esc: (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end), sandbox, { filename: "pricing.js" });

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}
const CJK = /[\u4e00-\u9fff]/;

check("pricing.json 可解析，schema 与三条档位齐", () => {
  assert.equal(pricing.schema, 1, "schema 不是 1");
  assert.equal(pricing.currency, "USD", "currency 不是 USD");
  assert.equal(pricing.tiers.length, 3, "档位数不是 3");
  assert.deepEqual(pricing.tiers.map((t) => t.tier_id), ["free", "season", "cpa"]);
});

check("pricing.json 每条都有 tier_id / name / price / period / trigger / visible", () => {
  for (const t of pricing.tiers) {
    for (const k of ["tier_id", "name", "price", "period", "trigger", "visible"]) {
      assert.ok(k in t, t.tier_id + " 缺字段 " + k);
    }
    assert.equal(typeof t.visible, "boolean", t.tier_id + " 的 visible 不是布尔");
    assert.ok(t.price === null || typeof t.price === "number", t.tier_id + " 的 price 不是数字或空");
    for (const lang of ["zh", "en", "es"]) {
      if (t.name) assert.equal(typeof t.name[lang], "string", t.tier_id + " 的 name 缺 " + lang);
    }
  }
});

check("现在 1 月前：三条档位全部 visible:false，价格全空", () => {
  assert.ok(pricing.tiers.every((t) => t.visible === false), "还有档位是可见的");
  assert.ok(pricing.tiers.every((t) => t.price === null), "还有档位带了价格");
});

check("会计对接：供给没签下之前不写触发条件", () => {
  const cpa = pricing.tiers.find((t) => t.tier_id === "cpa");
  assert.equal(cpa.trigger, null, "会计档的 trigger 必须是空");
});

check("季票档不写账本（账本没上线）", () => {
  const season = pricing.tiers.find((t) => t.tier_id === "season");
  const all = JSON.stringify(season);
  for (const bad of ["账本", "ledger", "libro"]) assert.ok(!all.includes(bad), "季票档写了账本：" + bad);
});

check("页面只渲染：用仓库这份 pricing.json，价格块输出为空", () => {
  for (const lang of ["zh", "en", "es"]) {
    const out = sandbox.pricingHtml(pricing, lang);
    assert.equal(out, "", lang + " 渲染出了内容：" + out.slice(0, 120));
  }
});

check("改 JSON 就变：$199 → $249 只动数据", () => {
  const mk = (price) => ({
    schema: 1,
    currency: "USD",
    tiers: [{
      tier_id: "season",
      name: { zh: "季票", en: "Season pass", es: "Pase de temporada" },
      price,
      period: { zh: "每年", en: "per year", es: "por año" },
      trigger: { zh: "多州、K-1、房租、季度预缴", en: "Multi-state, K-1, rent, quarterly", es: "Varios estados, K-1, alquiler, trimestral" },
      visible: true,
    }],
  });
  assert.match(sandbox.pricingHtml(mk(199), "zh"), /\$199/, "199 没渲染出来");
  assert.match(sandbox.pricingHtml(mk(249), "zh"), /\$249/, "249 没渲染出来");
  assert.ok(!sandbox.pricingHtml(mk(249), "zh").includes("$199"), "改了价还留着旧价");
  assert.match(sandbox.pricingHtml(mk(199), "zh"), /每年/, "周期没出");
  assert.match(sandbox.pricingHtml(mk(199), "zh"), /多州、K-1/, "触发条件没出");
});

check("空值不出占位符、不出 undefined（三语）", () => {
  const base = {
    schema: 1, currency: "USD",
    tiers: [
      { tier_id: "empty_price", name: { zh: "季票", en: "Season pass", es: "Pase de temporada" }, price: null, period: null, trigger: null, visible: true },
      { tier_id: "empty_name", name: null, price: 199, period: { zh: "每年", en: "per year", es: "por año" }, trigger: null, visible: true },
      { tier_id: "bad_price", name: { zh: "会计对接", en: "Accountant handoff", es: "Entrega al contador" }, price: null, period: { zh: "每年", en: "per year", es: "por año" }, trigger: null, visible: true },
    ],
  };
  for (const lang of ["zh", "en", "es"]) {
    const out = sandbox.pricingHtml(base, lang);
    assert.ok(!/undefined|null|NaN/.test(out), lang + " 出了空值字面量：" + out);
    assert.ok(!/\$\s*<\/div>/.test(out), lang + " 出了空价占位符");
    assert.ok(!out.includes("empty_name"), lang + " 没名字的档还渲染了");
    assert.ok(!out.includes("per year") && !out.includes("每年") && !out.includes("por año"), lang + " 没有价格却出了周期");
  }
});

check("visible:false 的档不渲染，visible:true 的才渲染", () => {
  const data = {
    schema: 1, currency: "USD",
    tiers: [
      { tier_id: "a", name: { zh: "免费", en: "Free", es: "Gratis" }, price: null, period: null, trigger: { zh: "只给方向", en: "Direction only", es: "Solo la dirección" }, visible: true },
      { tier_id: "b", name: { zh: "季票", en: "Season pass", es: "Pase de temporada" }, price: 199, period: { zh: "每年", en: "per year", es: "por año" }, trigger: null, visible: false },
    ],
  };
  const out = sandbox.pricingHtml(data, "zh");
  assert.ok(out.includes("data-tier='a'"), "可见档没渲染");
  assert.ok(!out.includes("data-tier='b'"), "隐藏档被渲染了");
  assert.ok(!out.includes("$199"), "隐藏档的价格漏出来了");
});

check("三语：同一条数据按语言出名字与触发条件，en/es 不夹中文", () => {
  const data = {
    schema: 1, currency: "USD",
    tiers: [{ tier_id: "season", name: { zh: "季票", en: "Season pass", es: "Pase de temporada" }, price: 199, period: { zh: "每年", en: "per year", es: "por año" }, trigger: { zh: "多州、K-1", en: "Multi-state, K-1", es: "Varios estados, K-1" }, visible: true }],
  };
  assert.match(sandbox.pricingHtml(data, "en"), /Season pass/);
  assert.match(sandbox.pricingHtml(data, "es"), /Pase de temporada/);
  assert.ok(!CJK.test(sandbox.pricingHtml(data, "en")), "英文态夹中文");
  assert.ok(!CJK.test(sandbox.pricingHtml(data, "es")), "西语态夹中文");
});

check("页面：pricing.json 是唯一来源，页面上没有写死的价格块", () => {
  assert.ok(html.includes('id="pricingTiers"'), "缺价格容器");
  assert.ok(html.includes('fetch("./pricing.json"'), "页面没取 pricing.json");
  assert.ok(/renderAll\(\)\{[^}]*renderPricing/.test(html), "换语言/重绘时没重画价格块");
  assert.ok(!/\$\d{3}/.test(html.slice(html.indexOf('id="subCard"'), html.indexOf('id="subShowcase"'))), "订阅卡里写死了价格数字");
});

let bad = 0;
for (const [tag, msg] of results) { if (tag !== "ok  ") bad++; console.log(tag, msg); }
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);