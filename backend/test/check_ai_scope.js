#!/usr/bin/env node
// 验收：AI 清单的两道闸门——白名单（图里没有的表）＋语义绑定（表 ↔ 理由对不上就丢）。
// 跑法：node backend/test/check_ai_scope.js
import assert from "node:assert/strict";
import graph from "../../rules/graph.json" with { type: "json" };
import { sanitizeAiItems } from "../worker/ai_items.js";

const it = (form, payer, prepare) => ({ form, payer: payer || "", prepare: prepare || ("准备" + form), why: "" });
const forms = (list) => list.map((x) => x.form);

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     " + e.message); }
}

// 线上实测过的三句（模型当时给的原始输出，含编造与错配）
const MARRIED = "我今年刚结婚，老婆没工作";
const COLLEGE = "我今年换了工作，孩子上大学";
const UBER = "我做 Uber 兼职，还买了股票";

check("结婚：图外编造的表（结婚证/身份证/社保卡）全被挡掉", () => {
  const out = forms(sanitizeAiItems([
    it("W-2"), it("1099-INT"), it("1098", "", "准备房贷利息证明"),
    it("结婚证"), it("身份证"), it("社保卡"),
  ], MARRIED));
  for (const bad of ["结婚证", "身份证", "社保卡"]) assert.ok(!out.includes(bad), "还留着：" + bad);
  assert.ok(out.includes("W-2"), "W-2 不该被丢");
});

check("结婚：没提房子就不出 1098 / 房产税单", () => {
  const out = forms(sanitizeAiItems([
    it("1098", "", "准备房贷利息证明"), it("房产税单", "地方政府", "准备房产税单复印件"),
  ], MARRIED));
  assert.deepEqual(out, [], "还出了：" + out.join(","));
});

check("孩子上大学：1098 不再冒充学费表，1098-T 保留", () => {
  const out = forms(sanitizeAiItems([
    it("W-2"), it("1098", "大学", "收集大学的1098表格"),
    it("1098-T", "大学", "收集大学的1098-T表格"),
  ], COLLEGE));
  assert.ok(!out.includes("1098"), "1098（房贷表）不该出现在学费场景");
  assert.ok(out.includes("1098-T"), "1098-T 被误丢");
});

check("孩子上大学：没提自雇就不出 Schedule C", () => {
  const out = forms(sanitizeAiItems([it("Schedule C"), it("W-2")], COLLEGE));
  assert.ok(!out.includes("Schedule C"), "Schedule C 不该出现");
  assert.ok(out.includes("W-2"), "W-2 被误丢");
});

check("Uber：1099-MISC 不再挂 Uber，能挂的是 1099-NEC / 1099-K", () => {
  const out = forms(sanitizeAiItems([
    it("1099-MISC", "Uber", "准备 Uber 发放的 1099-MISC 表格"),
    it("1099-B"), it("1099-NEC", "Uber", "准备 Uber 的 1099-NEC"),
  ], UBER));
  assert.ok(!out.includes("1099-MISC"), "1099-MISC 不该挂 Uber");
  assert.ok(out.includes("1099-NEC"), "1099-NEC 应保留");
  assert.ok(out.includes("1099-B"), "1099-B 应保留");
});

check("真有房贷时，1098 照常放行（闸门不是一刀切）", () => {
  const desc = "我今年有房贷，利息大概两万";
  const out = forms(sanitizeAiItems([it("1098", "银行", "准备房贷利息证明")], desc));
  assert.deepEqual(out, ["1098"], "房贷场景把 1098 误丢了");
});

check("真有房租时，Schedule E 照常放行", () => {
  const out = forms(sanitizeAiItems([it("Schedule E", "", "准备房租收入记录")], "我今年开始收房租"));
  assert.deepEqual(out, ["Schedule E"]);
});

check("图里每张有 ai_scope 的表都存在 forms 里（防写错表名）", () => {
  const names = new Set((graph.forms || []).map((f) => f.form));
  for (const k of Object.keys(graph.ai_scope || {})) {
    if (k === "note") continue;
    assert.ok(names.has(k), "ai_scope 里有图里不存在的表：" + k);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);