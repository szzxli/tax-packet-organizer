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
, provider_event_id TEXT);
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
