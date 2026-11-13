-- 2026-11-13 · 报名落库（公开表单，不建账号）
-- 与 formsubmit 双写；ref 原样存，不做映射。
CREATE TABLE IF NOT EXISTS signup_leads (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  state TEXT,
  kind TEXT,
  slot TEXT,
  ref TEXT,
  source TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_leads_created ON signup_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_signup_leads_ref ON signup_leads(ref);
CREATE TABLE IF NOT EXISTS signup_rate (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_rate ON signup_rate(ip_hash, created_at);