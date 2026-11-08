#!/usr/bin/env python3
"""本地 D1 + wrangler dev 上的订阅链路验证：checkout 闸门、webhook 开通、重放幂等、促销权益。"""
import hashlib, hmac, json, time, urllib.request

BASE = "http://127.0.0.1:8788"
SECRET = b"whsec_local_test_secret"
TOKEN = "localtest-token-abc"
PASS = FAIL = 0


def call(method, path, body=None, headers=None):
    data = body.encode() if isinstance(body, str) else (json.dumps(body).encode() if body else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        r = urllib.request.urlopen(req, timeout=10)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def signed_event(ev, secret=SECRET, t=None):
    body = json.dumps(ev, separators=(",", ":"))
    t = int(t or time.time())
    sig = hmac.new(secret, f"{t}.{body}".encode(), hashlib.sha256).hexdigest()
    return body, {"Stripe-Signature": f"t={t},v1={sig}"}


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS  {name}" + (f"  [{detail}]" if detail else ""))
    else:
        FAIL += 1
        print(f"FAIL  {name}  {detail}")


def me():
    return call("GET", "/api/me", headers={"Authorization": "Bearer " + TOKEN})


def event(eid, sid="cs_test_local_1", packs=1, amount=4900, acct="acct-test-1", typ="checkout.session.completed"):
    return {
        "id": eid,
        "type": typ,
        "data": {"object": {"id": sid, "amount_total": amount, "metadata": {"account_id": acct, "packs": str(packs)}}},
    }


season_end = None

# 1. 闸门：未登录 / 带 token 都 503
s, b = call("POST", "/api/orders/checkout", {"packs": 1})
check("checkout 匿名 503", s == 503 and "subscription_closed" in b, f"{s} {b}")
s, b = call("POST", "/api/orders/checkout", {"packs": 2}, {"Authorization": "Bearer " + TOKEN})
check("checkout 登录 503（闸门在鉴权后/Stripe 前）", s == 503 and "subscription_closed" in b, f"{s} {b}")

# 2. 初始权益为 0
s, b = me()
check("me 初始 entitlement_end=0", s == 200 and json.loads(b)["entitlement_end"] == 0, b)

# 3. webhook 开通
body, h = signed_event(event("evt_local_1"))
s, b = call("POST", "/api/stripe/webhook", body, h)
check("webhook 首次 200", s == 200, f"{s} {b}")
s, b = me()
season_end = json.loads(b)["entitlement_end"]
check("me 已开通（entitlement_end>now）", season_end > time.time() * 1000, f"end={season_end}")

# 4. 同 event id 重放
s, b = call("POST", "/api/stripe/webhook", body, h)
check("同 event 重放 200 duplicate", s == 200 and "duplicate" in b, f"{s} {b}")
s2, b2 = me()
check("重放后权益不变", json.loads(b2)["entitlement_end"] == season_end, b2)

# 5. 同 session、不同 event id 重放（Stripe 换投递 id）
body2, h2 = signed_event(event("evt_local_1_retry"))
s, b = call("POST", "/api/stripe/webhook", body2, h2)
check("同 session 新 event id 仍 200", s == 200, f"{s} {b}")
s3, b3 = me()
check("新 event id 权益不变", json.loads(b3)["entitlement_end"] == season_end, b3)

# 6. 签名错误
body3, h3 = signed_event(event("evt_local_bad"), secret=b"whsec_wrong")
s, b = call("POST", "/api/stripe/webhook", body3, h3)
check("错误签名 400", s == 400 and "bad_signature" in b, f"{s} {b}")

# 7. 时间戳过期（5 分钟外）应拒绝（当前实现未做，记录现状）
body4, h4 = signed_event(event("evt_local_old"), t=int(time.time()) - 3600)
s, b = call("POST", "/api/stripe/webhook", body4, h4)
check("1 小时前的签名被拒", s == 400, f"{s} {b}")

# 8. 促销权益
s, b = call("POST", "/api/promo/claim", {"promo": "first50"}, {"Authorization": "Bearer " + TOKEN})
check("promo 领取 200", s == 200, f"{s} {b}")
s, b = call("POST", "/api/promo/claim", {"promo": "first50"}, {"Authorization": "Bearer " + TOKEN})
check("promo 重复领取 409", s == 409, f"{s} {b}")

# 9. 其它接口不受影响
s, b = call("GET", "/api/orders", headers={"Authorization": "Bearer " + TOKEN})
check("orders 列表 200", s == 200 and json.loads(b)["orders"], b[:200])

print(f"\n{PASS} passed, {FAIL} failed")
