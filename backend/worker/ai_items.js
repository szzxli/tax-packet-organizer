// /api/ai-checklist 的条目清洗：表清单与禁用词都从 rules/graph.json 读（唯一来源）。
// 只收图里列出的表；模型编出来的表名、以及带「符合/能拿/保证」类措辞的条目一律丢掉，
// 宁可少几条，也不把承诺性说法带进用户清单。form→node 只做精确匹配（含图里声明的别名），不做模糊匹配。
import graph from "../../rules/graph.json" with { type: "json" };

const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/FORM/g, "").replace(/[^A-Z0-9\u4e00-\u9fff]/g, "");

const NODES = new Map();
for (const entry of graph.forms || []) {
  for (const name of [entry.form].concat(entry.aliases || [])) NODES.set(norm(name), entry.node);
}

// 语义闸门：有些表只在特定情形下成立（1098 是房贷利息、不是大学；Uber 的收款走 1099-K/NEC，不是 MISC）。
// 图里的 ai_scope 给每张表两条：when（描述里出现才算数）与 reject（出现在描述或 payer/why/prepare 里就丢）。
const SCOPE = new Map();
for (const k of Object.keys(graph.ai_scope || {})) {
  if (k === "note") continue;
  SCOPE.set(norm(k), graph.ai_scope[k]);
}
const lower = (v) => String(v == null ? "" : v).toLowerCase();
const anyOf = (text, words) => {
  const s = lower(text);
  return (words || []).some((w) => s.indexOf(lower(w)) >= 0);
};

// 两档：结论级整条丢；词汇级只替换措辞（如「抵税」->「少交」），不丢条目。
export const AI_BANNED = (graph.banned_drop || []).slice();
export const AI_REPLACE = Object.assign({}, graph.banned_replace || {});

export function aiFormNode(form) {
  return NODES.get(norm(form)) || null;
}

export function aiFormAllowed(form) {
  return !!aiFormNode(form);
}

// 去空白后再比：模型会写「符 合 条 件」「el igible」这类插空格绕过。
const squash = (v) => String(v == null ? "" : v).toLowerCase().replace(/[\s\u3000]+/g, "");
function hitsBanned(text) {
  const s = squash(text);
  return AI_BANNED.some((w) => s.indexOf(squash(w)) >= 0);
}
// 金额承诺闸：出现具体金额（$3,240／¥1,200）或「退/拿回…数字」就整条丢。
// 宁可少几条，也不把没算过的钱带进用户清单。
const MONEY_CLAIM = /([$¥￥]\s*\d)|(退[^，。；,;]{0,6}\d)|(拿[回][^，。；,;]{0,6}\d)/;
function claimsMoney(text) {
  return MONEY_CLAIM.test(String(text || ""));
}
function soften(text) {
  let out = String(text || "");
  for (const k of Object.keys(AI_REPLACE)) out = out.split(k).join(AI_REPLACE[k]);
  return out;
}

export function sanitizeAiItems(items, description) {
  if (!Array.isArray(items)) return [];
  const desc = String(description || "");
  const out = [];
  for (const it of items.slice(0, 20)) {
    if (!it || typeof it !== "object") continue;
    const form = String(it.form || "").trim().slice(0, 60);
    const payer = String(it.payer || "").trim().slice(0, 80);
    const prepare = soften(String(it.prepare || "").trim().slice(0, 200));
    const why = soften(String(it.why || "").trim().slice(0, 200));
    if (!form || !prepare) continue;
    if (!aiFormAllowed(form)) continue;
    // 禁用词四个字段都查（此前漏了 payer），金额承诺同样四处都拦。
    if (hitsBanned(form) || hitsBanned(payer) || hitsBanned(prepare) || hitsBanned(why)) continue;
    if (claimsMoney(payer) || claimsMoney(prepare) || claimsMoney(why)) continue;
    const scope = SCOPE.get(norm(form));
    if (scope) {
      // 1) 描述里没提这件事，就不许出现这张表
      if ((scope.when || []).length && !anyOf(desc, scope.when)) continue;
      // 2) 表与理由对不上（1098 挂「大学」、1099-MISC 挂「Uber」）直接丢
      if ((scope.reject || []).length) {
        const blob = [desc, payer, prepare, why].join(" ");
        if (anyOf(blob, scope.reject)) continue;
      }
    }
    out.push({ form, payer, prepare, why });
  }
  return out;
}