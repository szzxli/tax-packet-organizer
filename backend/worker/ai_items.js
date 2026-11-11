// /api/ai-checklist 的条目清洗：表清单与禁用词都从 rules/graph.json 读（唯一来源）。
// 只收图里列出的表；模型编出来的表名、以及带「符合/能拿/保证」类措辞的条目一律丢掉，
// 宁可少几条，也不把承诺性说法带进用户清单。form→node 只做精确匹配（含图里声明的别名），不做模糊匹配。
import graph from "../../rules/graph.json" with { type: "json" };

const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/FORM/g, "").replace(/[^A-Z0-9\u4e00-\u9fff]/g, "");

const NODES = new Map();
for (const entry of graph.forms || []) {
  for (const name of [entry.form].concat(entry.aliases || [])) NODES.set(norm(name), entry.node);
}

export const AI_BANNED = (graph.banned || []).slice();

export function aiFormNode(form) {
  return NODES.get(norm(form)) || null;
}

export function aiFormAllowed(form) {
  return !!aiFormNode(form);
}

function hitsBanned(text) {
  const s = String(text || "").toLowerCase();
  return AI_BANNED.some((w) => s.indexOf(String(w).toLowerCase()) >= 0);
}

export function sanitizeAiItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items.slice(0, 20)) {
    if (!it || typeof it !== "object") continue;
    const form = String(it.form || "").trim().slice(0, 60);
    const payer = String(it.payer || "").trim().slice(0, 80);
    const prepare = String(it.prepare || "").trim().slice(0, 200);
    const why = String(it.why || "").trim().slice(0, 200);
    if (!form || !prepare) continue;
    if (!aiFormAllowed(form)) continue;
    if (hitsBanned(prepare) || hitsBanned(why)) continue;
    out.push({ form, payer, prepare, why });
  }
  return out;
}