// /api/ai-checklist 的条目清洗验收：表清单与禁用词都来自 rules/graph.json（不硬编码）。
// 跑法：node tools/test_ai_items.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { AI_BANNED, aiFormAllowed, aiFormNode, sanitizeAiItems } from "../backend/worker/ai_items.js";

const graph = JSON.parse(fs.readFileSync(new URL("../rules/graph.json", import.meta.url), "utf8"));
const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}
const item = (form, prepare, why) => ({ form, prepare, why: why || "" });

check("白名单来自图：图里每条都能过，图外的都丢", () => {
  for (const e of graph.forms) assert.ok(aiFormAllowed(e.form), e.form + " 应通过");
  const out = sanitizeAiItems([item("CryptoTip", "随便写的")]);
  assert.deepEqual(out, [], "图外的表名不应通过");
});
check("form→node 精确匹配：图里的别名认，模糊/前缀不认", () => {
  assert.equal(aiFormNode("W-2"), "w2");
  assert.equal(aiFormNode("w2"), "w2");
  assert.equal(aiFormNode("Form 1099-NEC"), "1099nec");
  for (const bad of ["W-2X", "1099", "W2GX", "Schedule Z", "1099-NEC extra"]) {
    assert.equal(aiFormNode(bad), null, bad + " 不应被模糊匹配");
  }
});
check("禁用词来自图：命中整条丢弃", () => {
  assert.ok(AI_BANNED.includes("eligible") && AI_BANNED.includes("能拿"));
  const out = sanitizeAiItems([
    item("W-2", "You are eligible for this credit"),
    item("W-2", "你可能符合条件"),
    item("1099-INT", "这样能拿更多退税"),
    item("1098-T", "保证能退"),
    item("1099-DIV", "正常的一条"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].form, "1099-DIV");
});
check("清洗模块里没有写死的表清单", () => {
  const src = fs.readFileSync(new URL("../backend/worker/ai_items.js", import.meta.url), "utf8");
  assert.ok(src.includes("rules/graph.json"), "模块应 import 图");
  assert.ok(!/"W-2"\s*,/.test(src), "模块里不应有写死的表数组");
  assert.ok(!/AI_FORM_ALLOW\s*=/.test(src), "旧的写死白名单应已删除");
});
check("空值安全、最多 20 条、字段截断", () => {
  assert.deepEqual(sanitizeAiItems(null), []);
  assert.deepEqual(sanitizeAiItems([item("", "x"), item("W-2", "")]), []);
  const many = Array.from({ length: 30 }, () => item("W-2", "x".repeat(300)));
  const out = sanitizeAiItems(many);
  assert.equal(out.length, 20);
  assert.equal(out[0].prepare.length, 200);
});

let bad = 0;
for (const [tag, msg] of results) {
  if (tag !== "ok  ") bad++;
  console.log(tag, msg);
}
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);