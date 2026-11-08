# Worker baseline — muse (2026-11-07)

This is the Worker baseline as deployed by muse on 2026-11-07 22:46:58Z
(deployment `7ab32c42`), before the R&D expert's version superseded it.
Kept here for review and comparison, per the single-source-of-truth rule
(all code in the repo, deploy only from the repo). Do not deploy from this
directory; the live Worker comes from `backend/worker/`.

## Files

- `worker.js` (420 lines) — single-file Worker, no dependencies.
- `schema.sql` — D1 schema including the tables added for #77 3.3.

## What this baseline contains

- 3.1 — 503 subscription gate: `POST /api/orders/checkout` returns
  `503 subscription_closed` before any auth / Stripe / D1 work
  (`SUBSCRIPTION_OPEN = false`).
- 3.2 — Single entitlement exit: `GET /api/me` returns `entitlement_end`
  (ms timestamp, 0 = none).
- 3.3 — Webhook idempotency: `stripe_events` table, atomic D1 batch
  (event insert + order upsert), 500 on DB failure so Stripe retries,
  `webhook_failures` audit log. HMAC signature verification kept.
- Auth: `Authorization: Bearer` token (30-day sessions). No cookies.

## Differences from `backend/worker/index.js` (R&D expert, live)

- No `entitlementInfo()` structured object (`{end, active, source}`);
  `/api/me` returns only `{email, entitlement_end}` here.
- No constant-time signature comparison / replay tolerance in the
  webhook handler (plain HMAC compare here).
- Login/register at `/api/login` and `/api/register` in both versions.
