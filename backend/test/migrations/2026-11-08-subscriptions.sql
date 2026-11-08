-- 生产迁移：订阅域（payments-spec v0.1 §1）
-- 执行：npx wrangler d1 execute DB --remote --file=test/migrations/2026-11-08-subscriptions.sql
-- 幂等：可重复执行；不改动任何已有行。
ALTER TABLE orders ADD COLUMN payment_intent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_payment_intent ON orders(payment_intent_id);

CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  period TEXT NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  provider_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT,
  account_id TEXT,
  from_status TEXT,
  to_status TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_events_account ON subscription_events(account_id);

INSERT OR IGNORE INTO plans (code, name, price_cents, currency, period, auto_renew, active, sort) VALUES
  ('season_1', '报税季票 · 1 个包', 4900, 'usd', 'season', 0, 1, 10),
  ('season_2', '报税季票 · 2 个包', 7400, 'usd', 'season', 0, 1, 20),
  ('annual_1', '年度订阅 · 1 个包', 4900, 'usd', 'year', 1, 0, 30);