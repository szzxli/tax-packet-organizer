// /api/ai-checklist 的条目清洗验收：表清单白名单 + 禁用词。
// 跑法：node tools/test_ai_items.mjs
import assert from "node:assert/strict";
import { AI_FORM_ALLOW, AI_BANNED, aiFormAllowed, sanitizeAiItems } from "../backend/worker/ai_items.js";

const results = [];
function check(name, fn) {
  try { fn(); results.push(["ok  ", name]); }
  catch (e) { results.push(["FAIL", name + " — " + e.message]); }
}
const item = (form, prepare, why) => ({ form, prepare, why: why || "" });

check("白名单内保留，编出来的表名丢掉", () => {
  const out = sanitizeAiItems([item("W-2", "雇主寄的 W-2"), item("CryptoTip", "随便写的")]);
  assert.equal(out.length, 1, "应只留 W-2");
  assert.equal(out[0].form, "W-2");
});
check("同义写法都认：w2 / Form 1099-NEC / 1099NEC / FBAR", () => {
  for (const f of ["w2", "Form 1099-NEC", "1099NEC", "FBAR", "fincen 114", "8938"]) {
    assert.ok(aiFormAllowed(f), f + " 应被认作清单里的表");
  }
  assert.ok(!aiFormAllowed("Schedule Z"), "Schedule Z 不在清单里");
});
check("禁用词命中整条丢弃（eligible / 符合条件 / 能拿 / 保证）", () => {
  const out = sanitizeAiItems([
    item("W-2", "You are eligible for this credit"),
    item("W-2", "你可能符合条件"),
    item("1099-INT", "这样能拿更多退税"),
    item("1098-T", "保证能退"),
    item("1099-DIV", "正常的一条"),
  ]);
  assert.equal(out.length, 1, "只应留下没有禁用词的那条");
  assert.equal(out[0].form, "1099-DIV");
  assert.ok(AI_BANNED.includes("eligible") && AI_BANNED.includes("能拿"), "禁用词表应含 eligible / 能拿");
});
check("空表单 / 空 prepare / 空数组都不炸", () => {
  assert.deepEqual(sanitizeAiItems(null), []);
  assert.deepEqual(sanitizeAiItems([]), []);
  assert.deepEqual(sanitizeAiItems([item("", "x"), item("W-2", "")]), []);
});
check("最多 20 条，字段按长度截断", () => {
  const many = Array.from({ length: 30 }, () => item("W-2", "x".repeat(300)));
  const out = sanitizeAiItems(many);
  assert.equal(out.length, 20);
  assert.equal(out[0].prepare.length, 200);
});
check("白名单本身覆盖页面清单里的常用表", () => {
  for (const f of ["W-2", "1099-K", "Schedule C", "Schedule E", "1095-A", "1099-NEC", "1098-T", "SSA-1099"]) {
    assert.ok(AI_FORM_ALLOW.includes(f), "白名单缺 " + f);
  }
});

let bad = 0;
for (const [tag, msg] of results) {
  if (tag !== "ok  ") bad++;
  console.log(tag, msg);
}
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);