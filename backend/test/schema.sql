CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE ai_rate (ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE email_codes (
  account_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  packs INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  stripe_session_id TEXT,
  entitlement_end INTEGER,
  created_at INTEGER NOT NULL
, provider_event_id TEXT, payment_intent_id TEXT);
CREATE INDEX idx_orders_payment_intent ON orders(payment_intent_id);
CREATE TABLE packets (
  account_id TEXT PRIMARY KEY,
  enc INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE promo_caps (
  promo TEXT PRIMARY KEY,
  cap INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE promo_claims (
  account_id TEXT NOT NULL,
  promo TEXT NOT NULL,
  entitlement_end INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, promo)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE TABLE support_rate (ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE webhook_failures (
  event_id TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at INTEGER NOT NULL
);;
CREATE INDEX idx_orders_account ON orders(account_id);
CREATE INDEX idx_sessions_account ON sessions(account_id);

-- 订阅域（payments-spec v0.1 §1）：套餐、订阅、状态迁移审计。
CREATE TABLE plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  period TEXT NOT NULL,          -- season | year
  auto_renew INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL,          -- active | past_due | canceled | expired
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  provider_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT,
  account_id TEXT,
  from_status TEXT,
  to_status TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sub_events_account ON subscription_events(account_id);
