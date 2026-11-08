#!/usr/bin/env python3
"""订阅域验收：套餐、开通、续费、失败、取消、退款、非法迁移（本地 wrangler dev + 本地 D1）。

不触碰真实 Stripe 与真实付款：Stripe 侧由本地 stub（STRIPE_API_BASE）回应，
webhook 用测试密钥签名。运行方式见 backend/README.md。

退出码：任何 FAIL 为 1。
"""
import calendar, hashlib, hmac, json, os, subprocess, time, urllib.error, urllib.request

BASE = os.environ.get("TPO_BASE", "http://127.0.0.1:8789")
SECRET = b"whsec_local_test_secret"
PASS = FAIL = 0


def call(method, path, body=None, headers=None, raw=None, timeout=10):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def signed(ev, secret=SECRET, t=None):
    body = json.dumps(ev, separators=(",", ":"))
    t = int(t or time.time())
    sig = hmac.new(secret, f"{t}.{body}".encode(), hashlib.sha256).hexdigest()
    return body.encode(), {"Stripe-Signature": f"t={t},v1={sig}"}


def webhook(ev):
    raw, h = signed(ev)
    return call("POST", "/api/stripe/webhook", raw=raw, headers=h)


def d1(sql):
    out = subprocess.run(
        ["npx", "--yes", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout)[-400:])
    txt = out.stdout
    return json.loads(txt[txt.find("["):])[0].get("results", [])


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS  {name}" + (f"  [{detail}]" if detail else ""))
    else:
        FAIL += 1
        print(f"FAIL  {name}  {detail}")


def mkaccount(acct, token):
    d1("INSERT OR IGNORE INTO accounts (id, email, pw_salt, pw_hash, verified, created_at) "
       f"VALUES ('{acct}','{acct}@example.com','s','h',1,{int(time.time()*1000)})")
    d1("INSERT OR REPLACE INTO sessions (token_hash, account_id, expires_at) "
       f"VALUES ('{hashlib.sha256(token.encode()).hexdigest()}','{acct}',{int((time.time()+86400)*1000)})")


def me(token):
    return call("GET", "/api/me", headers={"Authorization": "Bearer " + token})


def season_end_ms():
    now = time.time() * 1000
    y = time.gmtime().tm_year
    end = calendar.timegm(time.strptime(f"{y}-10-15", "%Y-%m-%d")) * 1000
    return end if now < end else calendar.timegm(time.strptime(f"{y+1}-10-15", "%Y-%m-%d")) * 1000


def completed(eid, sid, acct, plan, amount=4900, pi=None, sub=None):
    sess = {"id": sid, "amount_total": amount, "payment_status": "paid",
            "metadata": {"account_id": acct, "plan_code": plan, "packs": "1"}}
    if pi: sess["payment_intent"] = pi
    if sub: sess["subscription"] = sub
    return {"id": eid, "type": "checkout.session.completed", "data": {"object": sess}}


def invoice_paid(eid, inv_id, sub_id, amount=4900, pi=None):
    return {"id": eid, "type": "invoice.paid",
            "data": {"object": {"id": inv_id, "subscription": sub_id, "amount_paid": amount,
                                "payment_intent": pi}}}


print("\n== 0 套餐唯一来源 ==")
s, b = call("GET", "/api/plans")
plans = {p["code"]: p for p in (json.loads(b).get("plans") or [])}
check("套餐公开可读，未启用套餐不返回", s == 200 and "season_1" in plans and "annual_1" not in plans, b[:160])
check("价格来自 plans 表（49/74 美元）", plans["season_1"]["price_cents"] == 4900 and plans["season_2"]["price_cents"] == 7400, str(plans))

print("\n== 1 购买开通（webhook 驱动，不经过支付页） ==")
mkaccount("acct-sub-a", "token-sub-a")
s, b = call("POST", "/api/orders/checkout", {"packs": 1}, {"Authorization": "Bearer token-sub-a"})
check("闸门仍关：checkout 503", s == 503 and "subscription_closed" in b, f"{s} {b[:80]}")
s, b = webhook(completed("evt_sub_a", "cs_sub_a", "acct-sub-a", "season_1", 4900, "pi_sub_a"))
check("checkout.session.completed 200", s == 200 and "quarantined" not in b, f"{s} {b[:120]}")
rows = d1("SELECT status, payment_intent_id, entitlement_end FROM orders WHERE id='cs_sub_a'")
check("订单落库：paid + payment_intent + 到期日", bool(rows) and rows[0]["status"] == "paid"
      and rows[0]["payment_intent_id"] == "pi_sub_a" and rows[0]["entitlement_end"] == season_end_ms(), str(rows))
rows = d1("SELECT status, plan_code, current_period_end, provider_subscription_id FROM subscriptions WHERE account_id='acct-sub-a'")
check("订阅记录：active / season_1 / 季末", bool(rows) and rows[0]["status"] == "active"
      and rows[0]["plan_code"] == "season_1" and rows[0]["current_period_end"] == season_end_ms(), str(rows))
s, b = me("token-sub-a")
d = json.loads(b)
check("权益：active，source=subscription", d["entitlement"]["active"] is True and d["entitlement"]["source"] == "subscription", b[:200])
check("/api/me 带订阅状态", d.get("subscription", {}).get("status") == "active" and d["subscription"]["plan"] == "season_1", b[:200])

print("\n== 2 幂等 ==")
s, b = webhook(completed("evt_sub_a", "cs_sub_a", "acct-sub-a", "season_1", 4900, "pi_sub_a"))
check("同一事件重放 → duplicate", s == 200 and "duplicate" in b, f"{s} {b[:100]}")
check("订阅仍只有一行", d1("SELECT COUNT(*) n FROM subscriptions WHERE account_id='acct-sub-a'")[0]["n"] == 1)
check("审计只有一条开通记录", d1("SELECT COUNT(*) n FROM subscription_events WHERE account_id='acct-sub-a'")[0]["n"] == 1)

print("\n== 3 续费（同一订阅延期，不新增订阅） ==")
d1("INSERT OR REPLACE INTO plans (code, name, price_cents, currency, period, auto_renew, active, sort) "
   "VALUES ('annual_test','年度订阅（测试）',4900,'usd','year',1,1,99)")
mkaccount("acct-sub-b", "token-sub-b")
s, b = webhook(completed("evt_sub_b", "cs_sub_b", "acct-sub-b", "annual_test", 4900, "pi_sub_b", "sub_stripe_b"))
check("自动续费套餐开通", s == 200 and "quarantined" not in b, f"{s} {b[:120]}")
row0 = d1("SELECT current_period_end FROM subscriptions WHERE account_id='acct-sub-b'")[0]
s, b = webhook(invoice_paid("evt_inv_b1", "in_b1", "sub_stripe_b", 4900, "pi_inv_b1"))
row1 = d1("SELECT current_period_end, status FROM subscriptions WHERE account_id='acct-sub-b'")[0]
check("invoice.paid → 期末后移一期", s == 200 and row1["current_period_end"] > row0["current_period_end"], f"{row0} -> {row1}")
check("续费不产生第二条订阅", d1("SELECT COUNT(*) n FROM subscriptions WHERE account_id='acct-sub-b'")[0]["n"] == 1)
check("续费账单落一条订单", d1("SELECT COUNT(*) n FROM orders WHERE id='in_in_b1'")[0]["n"] == 1)
s, b = webhook(invoice_paid("evt_inv_b1", "in_b1", "sub_stripe_b", 4900, "pi_inv_b1"))
check("同一账单重放不重复延期", s == 200 and "duplicate" in b
      and d1("SELECT current_period_end FROM subscriptions WHERE account_id='acct-sub-b'")[0]["current_period_end"] == row1["current_period_end"], f"{s} {b[:80]}")

print("\n== 4 扣款失败 → past_due → 恢复 ==")
s, b = webhook({"id": "evt_inv_b2", "type": "invoice.payment_failed",
                "data": {"object": {"id": "in_b2", "subscription": "sub_stripe_b"}}})
check("扣款失败 → past_due", s == 200 and d1("SELECT status FROM subscriptions WHERE account_id='acct-sub-b'")[0]["status"] == "past_due", f"{s} {b[:100]}")
d = json.loads(me("token-sub-b")[1])
check("past_due 期间权益不中断", d["entitlement"]["active"] is True, d["entitlement"].__str__())
s, b = webhook(invoice_paid("evt_inv_b3", "in_b3", "sub_stripe_b", 4900, "pi_inv_b3"))
check("补款成功 → active", s == 200 and d1("SELECT status FROM subscriptions WHERE account_id='acct-sub-b'")[0]["status"] == "active", f"{s} {b[:100]}")

print("\n== 5 取消 ==")
s, b = call("POST", "/api/subscriptions/cancel", {}, {"Authorization": "Bearer token-sub-a"})
check("一次性季票不能取消续费 → 409 not_recurring", s == 409 and "not_recurring" in b, f"{s} {b[:100]}")
s, b = call("POST", "/api/subscriptions/cancel", {}, {"Authorization": "Bearer token-sub-b"})
if os.environ.get("STRIPE_STUB") == "1":
    check("自动续费订阅取消 → 期末不续费", s == 200
          and json.loads(b).get("subscription", {}).get("cancel_at_period_end") is True, f"{s} {b[:160]}")
    check("取消后当期权益保留", json.loads(me("token-sub-b")[1])["entitlement"]["active"] is True)
else:
    check("未配置 Stripe 时取消明确报错（不假装成功）", s == 500 and "stripe_not_configured" in b, f"{s} {b[:100]}")

print("\n== 6 期末取消 ==")
s, b = webhook({"id": "evt_sub_deleted_b", "type": "customer.subscription.deleted",
                "data": {"object": {"id": "sub_stripe_b"}}})
d = json.loads(me("token-sub-b")[1])
check("删除事件 → canceled 且权益到期", s == 200 and d["subscription"]["status"] == "canceled"
      and d["entitlement"]["active"] is False, f"{s} {b[:100]} {d['entitlement']}")

print("\n== 7 退款回滚 ==")
mkaccount("acct-sub-c", "token-sub-c")
webhook(completed("evt_sub_c", "cs_sub_c", "acct-sub-c", "season_1", 4900, "pi_sub_c"))
check("退款前权益有效", json.loads(me("token-sub-c")[1])["entitlement"]["active"] is True)
s, b = webhook({"id": "evt_refund_c", "type": "charge.refunded",
                "data": {"object": {"id": "ch_c", "payment_intent": "pi_sub_c", "amount_refunded": 4900}}})
d = json.loads(me("token-sub-c")[1])
check("全额退款 → 订单 refunded / 权益回免费档", s == 200
      and d1("SELECT status FROM orders WHERE id='cs_sub_c'")[0]["status"] == "refunded"
      and d["entitlement"]["active"] is False and d["entitlement_end"] == 0, f"{s} {b[:100]} {d['entitlement']}")
check("退款后订阅转 expired", d1("SELECT status FROM subscriptions WHERE account_id='acct-sub-c'")[0]["status"] == "expired")

print("\n== 8 非法迁移与边界 ==")
s, b = webhook(invoice_paid("evt_inv_unknown", "in_unknown", "sub_does_not_exist"))
check("未知订阅的 invoice.paid → quarantine，不建订阅", s == 200 and "quarantined" in b
      and d1("SELECT COUNT(*) n FROM subscriptions WHERE provider_subscription_id='sub_does_not_exist'")[0]["n"] == 0, f"{s} {b[:100]}")
rows = d1("SELECT error FROM webhook_failures WHERE event_id='evt_inv_unknown'")
check("非法事件留日志", bool(rows) and rows[0]["error"] == "unknown_subscription", str(rows)[:120])
s, b = webhook(completed("evt_badplan", "cs_badplan", "acct-sub-d", "nope_plan"))
check("未知套餐 → quarantine，不开通", s == 200 and "quarantined" in b
      and d1("SELECT COUNT(*) n FROM orders WHERE id='cs_badplan'")[0]["n"] == 0, f"{s} {b[:100]}")
raw, h = signed({"id": "evt_old_sig", "type": "charge.refunded"}, t=int(time.time()) - 3600)
s, b = call("POST", "/api/stripe/webhook", raw=raw, headers=h)
check("1 小时前的签名被拒（5 分钟容差）", s == 400 and "bad_signature" in b
      and d1("SELECT COUNT(*) n FROM stripe_events WHERE id='evt_old_sig'")[0]["n"] == 0, f"{s} {b[:80]}")

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)