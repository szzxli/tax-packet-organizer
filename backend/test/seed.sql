-- 本地验收用测试账号；token = localtest-token-abc
INSERT INTO accounts (id, email, pw_salt, pw_hash, verified, created_at)
VALUES ('acct-test-1', 'test@example.com', 's', 'h', 1, unixepoch() * 1000);
INSERT INTO sessions (token_hash, account_id, expires_at)
VALUES ('a4d1cce9bd41b1bbff00993c2895bf4482564dc12d87cedab7ada3c867b3a5fc', 'acct-test-1', (unixepoch() + 86400) * 1000);
INSERT INTO promo_caps (promo, cap, claimed) VALUES ('first50', 50, 0);

-- 套餐（价格唯一来源；页面与 checkout 都读这里）。
-- 当前在售的是「按季一次、不自动续费」，与 formal.html 已公布的条款一致；
-- 以后开自动续费只改 auto_renew=1，不改代码。
INSERT INTO plans (code, name, price_cents, currency, period, auto_renew, active, sort) VALUES
  ('season_1', '报税季票 · 1 个包', 4900, 'usd', 'season', 0, 1, 10),
  ('season_2', '报税季票 · 2 个包', 7400, 'usd', 'season', 0, 1, 20),
  ('annual_1', '年度订阅 · 1 个包', 4900, 'usd', 'year', 1, 0, 30);