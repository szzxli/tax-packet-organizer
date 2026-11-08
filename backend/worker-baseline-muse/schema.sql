-- 报税包整理器后端 · D1 schema（Cloudflare D1，SQLite）
-- 适用 wrangler d1 execute --file=schema.sql

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS email_codes (
  account_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS packets (
  account_id TEXT PRIMARY KEY,
  enc INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  packs INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  stripe_session_id TEXT,
  provider_event_id TEXT,
  entitlement_end INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id);
CREATE TABLE IF NOT EXISTS promo_caps (
  promo TEXT PRIMARY KEY,
  cap INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_rate (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS support_rate (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Stripe webhook 幂等：先记事件 id，UNIQUE 冲突 = 已处理过（#77 3.3）。
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
-- webhook 开通失败审计：D1 写失败时记一笔，Stripe 收到 5xx 会自动重试。
CREATE TABLE IF NOT EXISTS webhook_failures (
  event_id TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS promo_claims (
  account_id TEXT NOT NULL,
  promo TEXT NOT NULL,
  entitlement_end INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, promo)
);
-- 前 50 名免费一季活动名额（上限 50，原子扣减）。
INSERT OR IGNORE INTO promo_caps (promo, cap, claimed) VALUES ('first50', 50, 0);
