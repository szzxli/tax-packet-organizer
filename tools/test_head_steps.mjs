#!/usr/bin/env node
// 验收：页头「现在第几步」三步条（#headSteps / hsStep1..3）
// 1) 容器与三颗按钮存在；2) 三步文案与 aria 已有 en/es 词条；3) updateStepTabs 同步 active/done/点击；
// 4) 首屏(entry, tpo-first)与非整理页不显示；5) CSS 与窄屏规则；6) sw 壳版本已升。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "formal.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + " :: " + e.message); }
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

check("headSteps 容器存在且默认隐藏", () => {
  assert.ok(/<div class="head-steps hidden no-print" id="headSteps"/.test(html), "markup");
});
check("三颗页头步按钮 hsStep1..3", () => {
  for (const id of ["hsStep1", "hsStep2", "hsStep3"]) assert.ok(html.includes('id="' + id + '"'), id);
});
check("三步文案与 aria 已有 en/es 词条", () => {
  for (const k of ["① 今年哪里变了", "② 把材料放进来", "③ 交出去之前核一遍", "整理步骤"]) {
    const re = new RegExp(escRe(JSON.stringify(k)) + ':\\s*\\{[^}]*"en":\\s*"[^"]+",\\s*"es":\\s*"[^"]+"');
    assert.ok(re.test(html), k);
  }
});
check("updateStepTabs 同步页头步（容器/按钮/点击切换）", () => {
  assert.ok(html.includes('$("headSteps")'), "headSteps ref");
  assert.ok(html.includes('$("hsStep"+step)'), "hsStep ref");
  assert.ok(html.includes("hb.onclick=function(){setOrganizeStep(step,true);}"), "onclick");
});
check("可见性：非整理页隐藏、首屏 entry 隐藏", () => {
  assert.ok(html.includes("currentPage===1"), "page check");
  assert.ok(html.includes('!document.body.classList.contains("tpo-first")'), "tpo-first check");
  assert.ok(html.includes('!app.classList.contains("hidden")'), "appView check");
});
check("renderHero 会触发同步", () => {
  assert.ok(/document\.body\.setAttribute\("data-step", String\(currentOrganizeStep\)\);\s*\n\s*try\{updateStepTabs\(\);\}catch\(e\)\{\}/.test(html), "hook");
});
check("CSS：head-steps 布局/高亮/窄屏", () => {
  assert.ok(html.includes(".head-steps{display:flex"), "base");
  assert.ok(html.includes(".head-steps .hs-tab.active"), "active");
  assert.ok(/@media\(max-width:600px\)\{\.head-steps/.test(html), "narrow");
});
check("全局 .hidden 规则存在", () => {
  assert.ok(/\.hidden\{display:none!important\}/.test(html), ".hidden");
});
check("sw.js 壳版本已升到 v83 以上", () => {
  const m = sw.match(/CACHE_NAME\s*=\s*"tax-packet-shell-(v\d+)"/);
  assert.ok(m, "CACHE_NAME missing");
  assert.ok(Number(m[1].slice(1)) >= 83, "got " + m[1]);
});

console.log(`head_steps: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
