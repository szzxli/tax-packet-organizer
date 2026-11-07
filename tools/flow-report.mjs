#!/usr/bin/env node
// Flow funnel reader for the session-scoped aggregate counters.
// Usage: node flow-report.mjs [namespace] [mobile|desktop|tablet]
// Example: node flow-report.mjs tpo-zhuanuc-test mobile
const NS = process.argv[2] || 'tpo-zhuanuc-test';
const DEV = process.argv[3] || 'mobile';
const BASE = 'https://abacus.jasoncameron.dev/get/' + NS + '/';

async function get(key) {
  await new Promise(res => setTimeout(res, 250));
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(BASE + encodeURIComponent(key), { headers: { accept: 'application/json' } });
    if (r.status === 404) return 0;
    if (r.status === 429) { await new Promise(res => setTimeout(res, 3500)); continue; }
    if (!r.ok) throw new Error(key + ' HTTP ' + r.status);
    const j = await r.json();
    return Number(j.value || 0);
  }
  throw new Error(key + ' rate-limited');
}

const steps = [1, 2, 3, 4, 5];
const counts = {};
for (const n of steps) counts['step' + n] = await get('flow-step' + n + '-' + DEV);
for (const n of [1, 2, 3, 4]) counts['drop' + n] = await get('flow-drop' + n + '-' + DEV);
for (const f of ['pdf', 'csv', 'json']) counts['export_' + f] = await get('flow-export-' + f + '-' + DEV);
for (const b of ['0-1m', '1-3m', '3-5m', '5-10m', '10-15m', '15mplus']) counts['dur_' + b] = await get('flow-dur-' + b + '-' + DEV);

const start = counts.step1 || 0;
const pct = n => start ? (100 * n / start).toFixed(1) + '%' : '—';
const rows = [
  ['打开', counts.step1, pct(counts.step1)],
  ['生成清单', counts.step2, pct(counts.step2)],
  ['进入补材料', counts.step3, pct(counts.step3)],
  ['看到导出区', counts.step4, pct(counts.step4)],
  ['触发导出', counts.step5, pct(counts.step5)]
];
const drops = [1, 2, 3, 4].map(n => ['第' + n + '步退出', counts['drop' + n], counts['step' + n] ? (100 * counts['drop' + n] / counts['step' + n]).toFixed(1) + '%' : '—']);
console.log('# Flow funnel — ' + NS + ' / ' + DEV);
console.log('| 阶段 | 会话数 | 占打开 |');
console.log('|---|---:|---:|');
for (const r of rows) console.log('| ' + r[0] + ' | ' + r[1] + ' | ' + r[2] + ' |');
console.log('\n| 退出步骤 | 退出会话 | 该步退出率 |');
console.log('|---|---:|---:|');
for (const r of drops) console.log('| ' + r[0] + ' | ' + r[1] + ' | ' + r[2] + ' |');
console.log('\n**导出格式**：PDF ' + counts.export_pdf + ' · CSV ' + counts.export_csv + ' · JSON ' + counts.export_json);
console.log('\n**会话总时长（桶）**：' + ['0-1m', '1-3m', '3-5m', '5-10m', '10-15m', '15mplus'].map(b => b + ' ' + counts['dur_' + b]).join(' · '));
console.log('\n> 计数为会话级聚合：每会话每步只记一次；不存 session ID、个人或税务数据。');
