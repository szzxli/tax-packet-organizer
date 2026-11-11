// /api/ai-checklist 的条目清洗：表清单白名单 + 禁用词。
// 只收本项目清单里出现过的表号；模型编出来的表名、以及带「符合/能拿/保证」类措辞的条目一律丢掉，
// 宁可少几条，也不把承诺性说法带进用户清单。
export const AI_FORM_ALLOW = [
  "W-2", "W-2G", "1099-INT", "1099-DIV", "1099-R", "SSA-1099", "1099-B", "1099-G",
  "1099-MISC", "1099-K", "1099-S", "1099-C", "1099-NEC", "1099-DA", "1098", "1098-E", "1098-T",
  "Schedule C", "Schedule E", "Schedule F", "Schedule SE", "Schedule K-1", "Form 2441",
  "1095-A", "1095-B", "1095-C", "5498", "5498-SA", "1099-SA",
  "FinCEN 114", "Form 8938", "Form 8621",
  "房产税单", "医疗收据", "捐赠收据",
];

// 同义写法：模型常把 W-2 写成 w2、把 FinCEN 114 写成 FBAR
const ALIASES = { W2G: "W-2G", W2: "W-2", SSA1099: "SSA-1099", FINCEN114: "FinCEN 114", FBAR: "FinCEN 114", 8938: "Form 8938", 8621: "Form 8621", 2441: "Form 2441" };

const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/FORM/g, "").replace(/[^A-Z0-9\u4e00-\u9fff]/g, "");

const ALLOW = new Set(AI_FORM_ALLOW.map(norm));
for (const k of Object.keys(ALIASES)) ALLOW.add(norm(k));

export const AI_BANNED = ["eligible", "entitled", "符合条件", "能拿", "保证", "一定", "最多可退", "抵税", "合格"];

function hitsBanned(text) {
  const s = String(text || "").toLowerCase();
  return AI_BANNED.some((w) => s.indexOf(w.toLowerCase()) >= 0);
}

export function aiFormAllowed(form) {
  const key = norm(form);
  return ALLOW.has(key);
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