#!/usr/bin/env node
// 引导卡语言切换：它独立于主 applyLang 自行取词，必须监听 <html lang> 并重画。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../formal.html',import.meta.url),'utf8');
let pass=0;
function ok(name,fn){fn();pass++;console.log('ok   '+name)}
ok('guide has zh/en/es lines and buttons',()=>{
  for(const s of ['先说一句今年变了什么','Say one thing that changed this year','Diga una cosa que cambió este año','下一步","Next","Siguiente','订阅季票 · 内测免费','Subscribe · free in beta','Suscribirse · gratis en beta']) assert.ok(html.includes(s),s);
});
ok('guide reads the current html lang',()=>assert.ok(html.includes('function w(){var l=(document.documentElement.lang||"zh").slice(0,2);return l==="en"?1:(l==="es"?2:0);}')));
ok('guide redraws on html lang mutation',()=>assert.ok(html.includes('new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]})')));
ok('guide keeps initial draw binding',()=>assert.ok(html.includes('document.addEventListener("DOMContentLoaded",bind);setTimeout(bind,1200);')));
console.log(`guide_lang: ${pass} pass, 0 fail`);
