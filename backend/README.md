# backend — tax-packet-api (Cloudflare Worker)

线上：`https://tax-packet-api.szzxli711.workers.dev`（health：`/api/health` → `{"ok":true,"version":"tpo-api-1"}`）

这个目录是 Worker 的唯一源码与部署入口。**任何 Worker 改动先进这个目录，再从 `deploy.sh` 部署**，不再直接往 Cloudflare 推单文件。

```
backend/
  worker/index.js       Worker 源码（单文件，无 npm 依赖）  sha256 b038cd6c…4f090c
  worker/wrangler.toml  绑定声明（D1 + AI），密钥不在此文件
  deploy.sh             唯一部署入口（wrangler deploy + 密钥回读核对）
  test/schema.sql       完整 D1 表结构（11 表 2 索引，从线上 dump）
  test/test_webhook.py  订阅链路 14 项本地验收
```

## 绑定与密钥

| 类型 | 名称 |
| --- | --- |
| D1 | `DB` → `284751a8-9dc3-486f-a539-0436e6f8551b` |
| Workers AI | `AI` |
| secret | `PACKET_KEY`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`RESEND_API_KEY`、`FRONTEND_ORIGIN`、`EMAIL_PROVIDER`、`EMAIL_FROM` |

密钥值只存在于 Cloudflare，不进仓库；`deploy.sh` 部署完会 `wrangler secret list` 回读，应为 7 条。
compatibility_date 固定 `2026-11-04`。

## 部署

```bash
npx wrangler login          # OAuth；登出 Cloudflare 会使其失效
./backend/deploy.sh
```

回滚两条路：Cloudflare 控制台把版本回滚到上一个 deployment；或 `git revert` 后重新部署。

## 订阅相关行为（当前线上）

- **关闸**：`SUBSCRIPTION_OPEN = false` 时，`POST /api/orders/checkout` 在鉴权与 Stripe 之前直接 503 `subscription_closed`。开闸需要同时改两处：这里的 `SUBSCRIPTION_OPEN` 与前端 `api.js` 的同名开关。
- **权益唯一出口**：`entitlementInfo()` 合并 `orders`（`status='paid'`）与 `promo_claims` 取较大到期时间，其它地方不得自行判断。
  `GET /api/me` 返回 `{ email, entitlement_end, entitlement: { end, active, source } }`；`entitlement_end` 为兼容字段，`active = end > now`，`source ∈ {"order","promo",null}`。
- **webhook 幂等**：事件 id 记入 `stripe_events`，重复投递 200 + `duplicate:true`；事件落库与订单开通在同一个 D1 batch；写失败返回 500 让 Stripe 重试。
- **签名**：HMAC-SHA256，`t` 5 分钟容差（更旧的直接 400），多个 `v1` 任一匹配即通过，常量时间比较。
- **促销**：`POST /api/promo/claim` 用 `promo_caps` 原子扣减（`UPDATE … WHERE claimed < cap`），重复领取 409。

## 本地验收（14 项）

需要 `wrangler` 与 python3，不碰线上：

```bash
cd backend/test
cp ../worker/index.js .
cat > wrangler.toml <<'TOML'
name = "tax-packet-api-test"
main = "index.js"
compatibility_date = "2026-11-04"
[vars]
STRIPE_WEBHOOK_SECRET = "whsec_local_test_secret"
PACKET_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
[[d1_databases]]
binding = "DB"
database_name = "tpo-test"
database_id = "00000000-0000-0000-0000-000000000000"
TOML
npx wrangler d1 execute DB --local --file=schema.sql
npx wrangler d1 execute DB --local --file=seed.sql     # 测试账号，token=localtest-token-abc
npx wrangler dev --local --port 8788 &
python3 test_webhook.py      # 期望 14 passed, 0 failed
```

覆盖：关闸 503（匿名/登录）、`/api/me` 初始与开通后、webhook 首次 200、同 event 重放 duplicate、同 session 换 event id 不重复开通、错误签名 400、1 小时前旧签名 400、促销领取与重复 409、订单列表。

## 已知边界

线上 `stripe_events` 目前 0 行——还没有真实 Stripe 事件到达，webhook 的 200 通路只在本地同一份代码上验证过。开闸后第一笔测试卡支付要确认：`stripe_events` 有行、`/api/me` 的 `entitlement.active = true`。
