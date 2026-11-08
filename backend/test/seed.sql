-- 本地验收用测试账号；token = localtest-token-abc
INSERT INTO accounts (id, email, pw_salt, pw_hash, verified, created_at)
VALUES ('acct-test-1', 'test@example.com', 's', 'h', 1, unixepoch() * 1000);
INSERT INTO sessions (token_hash, account_id, expires_at)
VALUES ('a4d1cce9bd41b1bbff00993c2895bf4482564dc12d87cedab7ada3c867b3a5fc', 'acct-test-1', (unixepoch() + 86400) * 1000);
INSERT INTO promo_caps (promo, cap, claimed) VALUES ('first50', 50, 0);
