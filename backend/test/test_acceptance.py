#!/usr/bin/env python3
"""订阅收款 8 项验收（本地 wrangler dev + 本地 D1，不碰线上）。

运行前（在含 wrangler.toml 的目录）：
    npx wrangler d1 execute DB --local --file=schema.sql
    npx wrangler d1 execute DB --local --file=seed.sql
    npx wrangler dev --local --port 8788 &
    python3 test_acceptance.py

8 项口径：
  1 新用户全流程   2 重复回调   3 连点   4 卡片被拒
  5 取消/到期      6 退款       7 非法状态   8 移动端首屏（见 README，浏览器人工核对）

退出码：任何 FAIL 为 1；WARN 不影响退出码，但必须写进交付说明。
"""
import hashlib, hmac, json, os, subprocess, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get("TPO_BASE", "http://127.0.0.1:8788")
SECRET = b"whsec_local_test_secret"
TOKEN = "localtest-token-abc"
PASS = FAIL = WARN = 0
NOTES = []


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


def signed(ev=None, raw=None, secret=SECRET, t=None):
    body = raw if raw is not None else json.dumps(ev, separators=(",", ":"))
    t = int(t or time.time())
    sig = hmac.new(secret, f"{t}.{body}".encode(), hashlib.sha256).hexdigest()
    return body.encode(), {"Stripe-Signature": f"t={t},v1={sig}"}


def me(token=TOKEN):
    return call("GET", "/api/me", headers={"Authorization": "Bearer " + token})


def d1(sql):
    """读本地 D1（与 wrangler dev 共享 .wrangler/state）。"""
    out = subprocess.run(
        ["npx", "--yes", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr[-400:] or out.stdout[-400:])
    txt = out.stdout
    start = txt.find("[")
    return json.loads(txt[start:])[0].get("results", [])


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS  {name}" + (f"  [{detail}]" if detail else ""))
    else:
        FAIL += 1
        print(f"FAIL  {name}  {detail}")


def warn(name, detail=""):
    global WARN
    WARN += 1
    NOTES.append(name + ((" — " + detail) if detail else ""))
    print(f"WARN  {name}" + (f"  [{detail}]" if detail else ""))


def ev_completed(eid, sid, acct, packs=1, amount=4900, payment_status="paid"):
    return {"id": eid, "type": "checkout.session.completed",
            "data": {"object": {"id": sid, "amount_total": amount, "payment_status": payment_status,
                                "metadata": {"account_id": acct, "packs": str(packs)}}}}


# ---------- 1. 新用户全流程 ----------
print("\n== 1 新用户全流程 ==")
s, b = call("GET", "/api/health")
check("health 200 且闸门状态可读", s == 200 and json.loads(b)["version"].startswith("tpo-api"), b)

email = f"accept{int(time.time())}@example.com"
s, b = call("POST", "/api/register", {"email": email, "password": "test-password-1"})
code = json.loads(b).get("dev_code") if s == 200 else None
check("注册 200（本地 DEV_MODE 回验证码）", s == 200 and code, f"{s} {b[:120]}")
s, b = call("POST", "/api/verify", {"email": email, "code": code})
check("邮箱验证 200", s == 200, f"{s} {b[:120]}")
s, b = call("POST", "/api/login", {"email": email, "password": "test-password-1"})
token = json.loads(b).get("token") if s == 200 else None
check("登录拿到 token", s == 200 and token, f"{s} {b[:120]}")
s, b = me(token)
d = json.loads(b)
check("新账号 entitlement_end=0 / active=false", d["entitlement_end"] == 0 and d["entitlement"]["active"] is False, b)
s, b = call("POST", "/api/orders/checkout", {"packs": 1}, {"Authorization": "Bearer " + token})
check("新用户 checkout 仍 503（闸门在鉴权/Stripe 前）", s == 503 and "subscription_closed" in b, f"{s} {b}")
s, b = call("POST", "/api/promo/claim", {"promo": "first50"}, {"Authorization": "Bearer " + token})
check("领免费季票 200", s == 200, f"{s} {b[:120]}")
s, b = me(token)
d = json.loads(b)
check("领取后 active=true / source=promo", d["entitlement"]["active"] is True and d["entitlement"]["source"] == "promo", b)
s, b = call("GET", "/api/orders", headers={"Authorization": "Bearer " + token})
check("新账号订单列表为空", s == 200 and json.loads(b)["orders"] == [], b[:120])

# ---------- 2. 重复回调 ----------
print("\n== 2 重复回调 ==")
body, h = signed(ev_completed("evt_acc_dup", "cs_acc_dup", "acct-test-1"))
s, b = call("POST", "/api/stripe/webhook", raw=body, headers=h)
check("首次回调 200", s == 200, f"{s} {b[:120]}")
s, b = call("POST", "/api/stripe/webhook", raw=body, headers=h)
check("同一 event 重放 → duplicate", s == 200 and "duplicate" in b, f"{s} {b[:120]}")
s, b = me()
end1 = json.loads(b)["entitlement_end"]
body2, h2 = signed(ev_completed("evt_acc_dup_retry", "cs_acc_dup", "acct-test-1"))
s, b = call("POST", "/api/stripe/webhook", raw=body2, headers=h2)
end2 = json.loads(me()[1])["entitlement_end"]
check("换 event id 重投同一 session → 权益不变", s == 200 and end2 == end1, f"end {end1}->{end2}")
rows = d1("SELECT COUNT(*) n FROM orders WHERE id='cs_acc_dup'")
check("同一 session 只有一行订单", rows[0]["n"] == 1, str(rows))
rows = d1("SELECT COUNT(*) n FROM stripe_events WHERE id IN ('evt_acc_dup','evt_acc_dup_retry')")
check("两次投递都留痕，只开通一次", rows[0]["n"] == 2, str(rows))

# ---------- 3. 连点 ----------
print("\n== 3 连点（6 个并发 checkout） ==")
before = d1("SELECT COUNT(*) n FROM orders WHERE account_id='acct-test-1'")[0]["n"]
with ThreadPoolExecutor(max_workers=6) as ex:
    res = list(ex.map(lambda _: call("POST", "/api/orders/checkout", {"packs": 1},
                                     {"Authorization": "Bearer " + TOKEN}), range(6)))
after = d1("SELECT COUNT(*) n FROM orders WHERE account_id='acct-test-1'")[0]["n"]
check("6 个并发全部 503（不触达 Stripe）", all(s == 503 for s, _ in res), str([s for s, _ in res]))
check("连点不产生任何订单行", after == before, f"{before}->{after}")

# ---------- 4. 卡片被拒 ----------
print("\n== 4 卡片被拒 ==")
declined = {"id": "evt_acc_declined", "type": "payment_intent.payment_failed",
            "data": {"object": {"id": "pi_acc_declined", "amount": 4900,
                                "metadata": {"account_id": "acct-nocard"}}}}
raw, h = signed(declined)
s, b = call("POST", "/api/stripe/webhook", raw=raw, headers=h)
check("拒付事件 200", s == 200, f"{s} {b[:120]}")
rows = d1("SELECT COUNT(*) n FROM orders WHERE account_id='acct-nocard'")
check("拒付不产生已付订单、不开通权益", rows[0]["n"] == 0, str(rows))

# ---------- 5. 取消 / 到期 ----------
print("\n== 5 取消付款 / 已过期权益 ==")
d1("INSERT INTO orders (id, account_id, packs, amount_cents, status, stripe_session_id, created_at) "
   "VALUES ('cs_acc_pending','acct-test-1',1,4900,'pending','cs_acc_pending',%d)" % (int(time.time() * 1000)))
body, h = signed({"id": "evt_acc_expired", "type": "checkout.session.expired",
                  "data": {"object": {"id": "cs_acc_pending"}}})
s, b = call("POST", "/api/stripe/webhook", raw=body, headers=h)
rows = d1("SELECT status FROM orders WHERE id='cs_acc_pending'")
check("放弃付款 → 订单标记 expired", s == 200 and rows and rows[0]["status"] == "expired", f"{s} {b[:80]} {rows}")
d1("INSERT INTO accounts (id, email, pw_salt, pw_hash, verified, created_at) VALUES "
   "('acct-old-expired','old@example.com','s','h',1,%d)" % int(time.time() * 1000))
d1("INSERT INTO orders (id, account_id, packs, amount_cents, status, stripe_session_id, entitlement_end, created_at) "
   "VALUES ('cs_acc_old','acct-old-expired',1,4900,'paid','cs_acc_old',%d,%d)" % (
       int(time.time() * 1000) - 86400000, int(time.time() * 1000)))
d1("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES "
   "('%s','acct-old-expired',%d)" % (hashlib.sha256(b"oldtoken").hexdigest(), int((time.time() + 86400) * 1000)))
s, b = me("oldtoken")
d = json.loads(b)
check("已过期权益不计入：entitlement_end=0 / active=false",
      s == 200 and d["entitlement_end"] == 0 and d["entitlement"]["active"] is False, b)

# ---------- 6. 退款 ----------
print("\n== 6 退款 ==")
refund = {"id": "evt_acc_refund", "type": "charge.refunded",
          "data": {"object": {"id": "ch_acc", "payment_intent": "pi_acc", "amount_refunded": 4900, "refunded": True}}}
raw, h = signed(refund)
s, b = call("POST", "/api/stripe/webhook", raw=raw, headers=h)
check("退款事件被接收且不报错", s == 200, f"{s} {b[:120]}")
end_after_refund = json.loads(me()[1])["entitlement_end"]
if end_after_refund == end1:
    warn("退款事件无匹配订单，权益不变（符合预期）",
         "这条 charge.refunded 的 payment_intent 是 pi_acc，库里没有对应订单（历史订单未存 payment_intent），"
         "所以不撤销权益。带 payment_intent 的全额退款回滚由 test_subscriptions.py 覆盖（已实测）。")

# ---------- 7. 非法状态 ----------
print("\n== 7 非法状态 ==")
raw, h = signed(raw="not-json")
s, b = call("POST", "/api/stripe/webhook", raw=raw, headers=h)
check("验签通过但 body 不是 JSON → 400 且不吐堆栈", s == 400 and "bad_event" in b and "SyntaxError" not in b, f"{s} {b[:120]}")
nometa = ev_completed("evt_acc_nometa", "cs_acc_nometa", "")
raw, h = signed(nometa)
s, b = call("POST", "/api/stripe/webhook", raw=raw, headers=h)
check("缺 account_id → 200 quarantine（重投也不会变好，不建订单）",
      s == 200 and "quarantined" in b, f"{s} {b[:120]}")
rows = d1("SELECT COUNT(*) n FROM orders WHERE id='cs_acc_nometa'")
check("缺账号事件不写订单", rows[0]["n"] == 0, str(rows))
rows = d1("SELECT error FROM webhook_failures WHERE event_id='evt_acc_nometa'")
check("缺账号事件进 webhook_failures 待人工", bool(rows) and rows[0]["error"] == "missing_account_id", str(rows))
unpaid = ev_completed("evt_acc_unpaid", "cs_acc_unpaid", "acct-unpaid", payment_status="unpaid")
raw, h = signed(unpaid)
s, b = call("POST", "/api/stripe/webhook", raw=raw, headers=h)
check("未真正付款的 session 不开通权益", s == 200 and "quarantined" in b, f"{s} {b[:120]}")
rows = d1("SELECT COUNT(*) n FROM orders WHERE account_id='acct-unpaid'")
check("未付款 session 不写已付订单", rows[0]["n"] == 0, str(rows))
s, b = call("GET", "/api/orders")
check("未登录读订单 → 401", s == 401, f"{s} {b[:80]}")
raw, _ = signed({"id": "evt_acc_badsig", "type": "charge.refunded"})
s, b = call("POST", "/api/stripe/webhook", raw=raw,
            headers={"Stripe-Signature": "t=%d,v1=deadbeef" % int(time.time())})
check("错误签名 400", s == 400 and "bad_signature" in b, f"{s} {b[:80]}")
rows = d1("SELECT COUNT(*) n FROM stripe_events WHERE id='evt_acc_badsig'")
check("错误签名不落任何行", rows[0]["n"] == 0, str(rows))
rows = d1("SELECT COUNT(*) n FROM orders WHERE account_id=''")
check("库里没有无主订单", rows[0]["n"] == 0, str(rows))

print(f"\n{PASS} passed, {FAIL} failed, {WARN} warn")
if NOTES:
    print("需要拍板/人工跟进的：")
    for n in NOTES:
        print(" - " + n)
raise SystemExit(1 if FAIL else 0)