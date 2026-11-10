# backend — tax-packet-api (Cloudflare Worker)

线上：`https://tax-packet-api.szzxli711.workers.dev`（health：`/api/health` → `{"ok":true,"version":"tpo-api-3","subscription_open":false}`）

`version` 用来核对线上是不是这份代码：改 Worker 就递增，`subscription_open` 直接反映关闸开关。

这个目录是 Worker 的唯一源码与部署入口。**任何 Worker 改动先进这个目录，再从 `deploy.sh` 部署**，不再直接往 Cloudflare 推单文件。

```
backend/
  worker/index.js       Worker 源码（单文件，无 npm 依赖）
  worker/wrangler.toml  绑定声明（D1 + AI），密钥不在此文件
  deploy.sh             唯一部署入口（wrangler deploy + 密钥回读核对）
  test/schema.sql       完整 D1 表结构
  test/migrations/      生产迁移（可重复执行）
  test/test_webhook.py  订阅链路 14 项本地验收
  test/test_acceptance.py  收款 8 项验收
  test/test_subscriptions.py 订阅域 30 项验收（套餐/开通/续费/失败/取消/退款/非法迁移）
  test/check_mobile_gate.js 手机首屏 + 停购提示（Playwright + 本地 Worker）
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

- **关闸**：`SUBSCRIPTION_OPEN = false` 时，`POST /api/orders/checkout` 在鉴权与 Stripe 之前直接 503 `subscription_closed`。开闸需要同时改两处：这里的 `SUBSCRIPTION_OPEN` 与前端 `api.js` 的同名开关。`GET /api/health` 回 `subscription_open` 便于核对。
- **权益唯一出口**：`entitlementInfo()` 合并订阅、一次性订单与促销，其它地方不得自行判断。有订阅记录时以订阅为准（`orders` 只作收款记录，取消/退款后不能凭旧的 `entitlement_end` 继续放行）；没有订阅记录的存量账号仍按 `orders` 计算。
  `GET /api/me` 返回 `{ email, entitlement_end, entitlement: { end, active, source }, subscription }`；`entitlement_end` 为兼容字段，`active = end > now`，`source ∈ {"subscription","order","promo",null}`。过期权益一律按 0 处理。
- **套餐与订阅**：价格唯一来源是 `plans` 表（`GET /api/plans` 公开只读）；`POST /api/orders/checkout` 只认服务端价格，不接收前端传价。`subscriptions` 一个账号一行，状态只允许 `active / past_due / canceled / expired` 之间的白名单迁移，非法迁移写 `webhook_failures` 并拒绝。
- **取消续费**：`POST /api/subscriptions/cancel` 调 Stripe 设 `cancel_at_period_end=true`，当期权益保留，期末 `customer.subscription.deleted` 后失效；一次性季票返回 409 `not_recurring`。
- **退款**：`charge.refunded` 按 `orders.payment_intent_id` 找单，全额退款置 `status='refunded'`、`entitlement_end=0`，订阅转 `expired`。
- **webhook 幂等**：事件 id 记入 `stripe_events`，重复投递 200 + `duplicate:true`；事件落库与订单开通在同一个 D1 batch；写失败返回 500 让 Stripe 重试（Stripe 的重试就是重试队列，`webhook_failures` 是死信记录）。
- **拒付/隔离**：只有 `payment_status === "paid"`（缺省视为已付，卡支付即如此）且带 `metadata.account_id` 的 `checkout.session.completed` / `async_payment_succeeded` 才开通。缺账号、未付款这两种重投也不会变好的事件，写 `webhook_failures` + 告警邮件，回 200 让 Stripe 停止重试，绝不凭不完整事件开通权益。
- **连点**：同一账号 2 分钟内有 `pending` 订单时，checkout 直接 409 `checkout_pending`，不建 Stripe 会话。
- **放弃付款**：`checkout.session.expired` 把 pending 订单标 `expired`，`/api/orders` 不再长期挂待支付。
- **解析**：验签通过后才解析；body 不是 JSON 或事件缺 `id`/`type` → 400 `bad_event`，不写库、不回堆栈。
- **签名**：HMAC-SHA256，`t` 5 分钟容差（更旧的直接 400），多个 `v1` 任一匹配即通过，常量时间比较；验签失败 4xx，不写任何行。
- **告警**：`webhook_db_failed` 与 quarantine 事件会发一封 `[tax-packet 告警]` 邮件到 support@zhuanuc.com（Resend 未配置时静默跳过，记录仍在表里）。
- **促销**：`POST /api/promo/claim` 用 `promo_caps` 原子扣减（`UPDATE … WHERE claimed < cap`），重复领取 409。

## 本地验收

需要 `wrangler`、python3、node + `playwright-core`（手机项用），不碰线上：

```bash
mkdir -p /tmp/tpo-test && cd /tmp/tpo-test
cp <repo>/backend/worker/index.js .
cp <repo>/backend/test/{schema.sql,seed.sql,test_webhook.py,test_acceptance.py,check_mobile_gate.js} .
cat > wrangler.toml <<'TOML'
name = "tax-packet-api-test"
main = "index.js"
compatibility_date = "2026-11-04"
[vars]
STRIPE_WEBHOOK_SECRET = "whsec_local_test_secret"
PACKET_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
DEV_MODE = "1"
[[d1_databases]]
binding = "DB"
database_name = "tpo-test"
database_id = "00000000-0000-0000-0000-000000000000"
TOML
npx wrangler d1 execute DB --local --file=schema.sql
npx wrangler d1 execute DB --local --file=seed.sql     # 测试账号，token=localtest-token-abc
npx wrangler dev --local --port 8788 &
python3 test_webhook.py      # 期望 14 passed, 0 failed
python3 test_acceptance.py   # 期望 31 passed, 0 failed（退款已实现，warn 仅剩无匹配订单的历史事件）
python3 test_subscriptions.py # 期望 30 passed；需另起 STRIPE_API_BASE stub（见文件头）
```

手机项（第 8 条）另起一个静态服务，前端字节与线上一致，API 走本地 Worker：

```bash
cd <repo> && python3 -m http.server 8000 --bind 127.0.0.1 &
cd /tmp/tpo-test && npm i playwright-core && node check_mobile_gate.js
```

## 季票权益验收（前端）

`backend/test/check_entitlements.js`，同一个本地栈（8788 + 8000，`DEV_MODE=1`），25 项：

```bash
cd /tmp/tpo-test && node check_entitlements.js
```

覆盖：免费用户看到三项权益说明但拿不到结果（对比卡片有领取入口、按钮禁用、优先提交按钮不出现、批量核对弹领取闸门）；有权益后批量归档核对给出的红/黄/绿与「不可交」、空清单不报「可交」、费用行覆盖数；多包与多年对比的每格状态（齐 / 还缺 n / 本版无）与「今年新增 X 项 / 今年没这项 Y 项」；优先工具支持真的把请求发到 `/api/support`（带【季票优先】与账号），失败时给已填好的邮件兜底而不谎称成功。

## 已知边界 / 开闸前必须处理

1. **线上还是旧版本**：`/api/health` 现在回 `tpo-api-1`；订阅域（套餐、订阅状态机、取消、退款回滚）与本次硬化都还没部署。部署前先执行 `test/migrations/2026-11-08-subscriptions.sql`，再 `npx wrangler login` + `./backend/deploy.sh`，上线后应回 `tpo-api-3`。
2. **退款已实现**：全额退款按 `payment_intent` 回滚权益；部分退款不动权益。
3. **前端付款页不可达**：`formal.html` 里 `#payView{display:none!important}` 且全站没有任何入口调用 `showPage(3)`，所以 `#btnDemoPay` 与「季票暂未开放购买」文案都显示不出来。今天用户看到的是订阅卡片上的「内测期免费，1 月公布价格」，不会误付款；开闸时要一起改：去掉这条 CSS、加回支付入口、把前端 `SUBSCRIPTION_OPEN` 改 true。
4. 线上 `stripe_events` 至今 0 行——还没有真实 Stripe 事件到达。开闸后第一笔测试卡支付要确认：`stripe_events` 有行、`/api/me` 的 `entitlement.active = true`、`orders.status='paid'`。
