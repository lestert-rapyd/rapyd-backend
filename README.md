# rapyd-backend

Signing proxy for the **PayBridge** sales-engineering demo. The static
frontend (`paybridge/`) never holds Rapyd secrets: it calls these endpoints,
which sign each request with the right merchant keys (HMAC, server-side) and
forward it to Rapyd. Deployed as Vercel serverless functions (`api/*.js`);
`server.js` mounts the same handlers on Express for local runs.

## Endpoints

| Method | Path | Rapyd call |
| --- | --- | --- |
| POST | `/api/create-direct-payment` | `POST /v1/payments` (own fields, express token, back-office MIT) |
| POST | `/api/create-checkout-session` | `POST /v1/checkout` (hosted / embedded toolkit) |
| POST | `/api/create-refund` | `POST /v1/refunds` |
| POST | `/api/create-customer` | `POST /v1/customers` |
| GET | `/api/retrieve-payment?id=payment_…` | `GET /v1/payments/{id}` |
| GET | `/api/retrieve-customer?id=cus_…` | `GET /v1/customers/{id}` |
| GET | `/api/list-customer-payment-methods?customer=cus_…` | `GET /v1/customers/{id}/payment_methods?category=card` |
| POST | `/api/add-customer-payment-method` | `POST /v1/customers/{id}/payment_methods` (add a card with external 3DS — sandbox only) |
| POST | `/api/create-card-token-page` | `POST /v1/hosted/collect/card` (Hosted Tokenisation Page — add a card, no card data at the merchant) |
| GET | `/api/get-fx-rate?buy_currency=…&sell_currency=…` | `GET /v1/fx_rates` |
| POST | `/api/create-payout` | `POST /v1/payouts` (merchant-site Withdraw — a card payout) |
| GET | `/api/retrieve-payout?id=payout_…` | `GET /v1/payouts/{id}` |
| GET | `/api/payout-required-fields?payout_method_type=…&sender_country=…&sender_currency=…&beneficiary_country=…&payout_currency=…&sender_entity_type=…&beneficiary_entity_type=…&payout_amount=…` | `GET /v1/payout_methods/{type}/required_fields` |
| GET | `/api/payout-method-types?category=card&beneficiary_country=…&payout_currency=…` | `GET /v1/payout_method_types` |
| POST | `/api/payout-card-eligibility` | `POST /v1/cards/eligibility` (Withdraw step 1 — issuer country + billing currency) |

The five payout routes are one Vercel function: `vercel.json` rewrites them onto
`api/payouts.js?op=…`, which dispatches to `handlers/payouts/*.js` (the Hobby
plan allows 12 functions per deployment, and every file under `api/` is one).
The five customer routes are one function the same way: `api/customers.js?op=…`
dispatches to `handlers/customers/*.js`.
`server.js` mounts the handlers directly, so local runs need no rewrite.
| POST | `/api/webhook` | Rapyd → us: verifies the signature, files the event in KV |
| GET | `/api/webhooks?ref=…` / `?refs=a,b` (≤ 20) / `?customer=cus_…` / `?card=card_…` | stored events; no parameter → `400 MISSING_REF` |
| GET | `/api/config?op=tags` | Tag Studio: the published engine-room tag config (public; `{version:0, slots:{}}` = code defaults) |
| PUT | `/api/config?op=tags` | admin · publish `{ baseVersion, slots, updatedBy, note }`; stale `baseVersion` → `409 VERSION_CONFLICT` |
| GET | `/api/config?op=tags-history` | admin · the last 20 versions (metadata) |
| POST | `/api/config?op=tags-rollback` | admin · `{ version, baseVersion }` republishes an old version as a new one |
| GET | `/api/config?op=whoami` | admin · `204` when `X-PayBridge-Admin-Token` is valid |

`api/config.js` is one function for all five (10 of the 12 Hobby functions).
The config lives in ONE Redis key, `cfg:tags:v1`, in the store staging and
production share — a publish from either shows on both. Admin calls need
`X-PayBridge-Admin-Token` = `PAYBRIDGE_ADMIN_TOKEN` (≥ 16 chars; unset →
`403 ADMIN_DISABLED`, wrong → `401 ADMIN_AUTH_REQUIRED`). The slot schema is
validated in `utils/tag-config.js`, a mirror of the frontend's
`js/tags/registry.js`.

Every proxy takes `env` (`sandbox` default, or `live`) and `profile`
(`SC1` default, `SC2`, `SC3`; anything else → `400 UNKNOWN_PROFILE`) in the
POST body or GET query. Both are stripped before the body is signed and sent.

Request headers: `Content-Type`, `Idempotency-Key` (8–100 of `A-Z a-z 0-9 _ . : -`;
forwarded as Rapyd's `idempotency` header so a retry can't double-charge —
otherwise a random key is generated), `X-PayBridge-Live-Token` (live only) and
`X-PayBridge-Admin-Token` (Tag Studio writes only).

Errors are `{ error, message, hint?, raw? }`: Rapyd 4xx pass through with
their status, Rapyd 5xx → 502, timeout (10 s) → 504, unreachable → 502,
missing keys → 500. Successes are Rapyd's JSON unchanged.

Events are filed under every id they carry: `merchant_reference_id`, the
`cus_***` (`data.customer`, or `data.customer_token` on payment events) and,
for the card's own events (`CUSTOMER_PAYMENT_METHOD_CREATED`,
`CARD_ADDED_SUCCESSFULLY` — no customer, no reference), the `card_***`.
A customer or card read also searches `wh:recent` — the rolling list the older
receiver (`main`) writes — for records about exactly that id, so the stitching
works whichever deployment Rapyd posts to. Nothing else from that list is returned.

Webhook events carry `verified: 'verified' | 'unverified' | 'skipped'` and
`verified_env: 'sandbox' | 'live' | null` (which environment's key pair
signed it). Only `verified` is trustworthy — the frontend confirms anything
else with Retrieve Payment before acting on it, and also requires
`verified_env` to match the payment's environment and the event's payment id
to match the payment it is watching (anyone can make a sandbox MID sign an
event for a reference of their choosing). Unverified events are stored
reduced (no raw body, clipped fields) for 10 minutes in a separate list, so
forged POSTs can't evict verified ones; webhook bodies are capped at 64 KB.

## Configuration

All environment variables are documented in [`.env.example`](.env.example):
per-profile sandbox keys and wallets, live keys, `PAYBRIDGE_LIVE_TOKEN`,
`PAYBRIDGE_ADMIN_TOKEN`,
`LIVE_MAX_AMOUNT`, `ALLOWED_ORIGINS`, `WEBHOOK_REQUIRE_SIGNATURE`,
`WEBHOOK_PUBLIC_URL`, the KV store and `PORT`. `./set-vercel-env.sh` pushes
the ones present in `.env` to Vercel without printing values.

## Live mode

Live requests use real merchant keys, so the server enforces:

- **Off by default.** Unless `PAYBRIDGE_LIVE_TOKEN` (≥ 16 chars) is set,
  every live request returns `403 LIVE_DISABLED`.
- **Token required.** Each live request (POST and GET) must send
  `X-PayBridge-Live-Token`; missing/wrong → `401 LIVE_AUTH_REQUIRED`
  (constant-time compare).
- **Amount cap.** Payments, checkout sessions and refunds must have
  `0 < amount ≤ LIVE_MAX_AMOUNT` (default `1`); a live refund must state its
  amount → otherwise `400 LIVE_LIMIT`.
- **No raw card data.** PAN/CVV (`payment_method.fields.number`, any
  `number`+`cvv` object) → `400 LIVE_RAW_CARD_FORBIDDEN`. This function is
  not PCI-scoped; live uses `card_***` tokens or the hosted toolkit.
- **Field allowlist.** Top-level fields outside the per-endpoint list in
  `utils/live-guards.js` → `400 LIVE_FIELD_NOT_ALLOWED` (with `fields`).
- **Payouts off unless opted in.** Payouts send money OUT of the merchant's
  wallet, so every payout endpoint (create, retrieve, required fields, method
  types, card eligibility) answers live requests with `403 LIVE_PAYOUTS_DISABLED` unless
  `LIVE_PAYOUTS_ENABLED=true` is set — **default off**. With it on, the gate,
  allowlist and cap above still apply: `payout_amount ≤ LIVE_MAX_AMOUNT`,
  no `sender_amount` / `ewallet` (the source wallet is injected from
  `RAPYD_LIVE_EWALLETS`), and no raw card (`beneficiary.card_number` →
  `LIVE_RAW_CARD_FORBIDDEN`) — a live payout can only target a saved
  `card_***`. A live card-eligibility check likewise takes only `card_id` +
  `transaction_type` (`card_number` → `LIVE_RAW_CARD_FORBIDDEN`).

## Payouts (sandbox)

`/api/create-payout` validates the body's shape (`utils/payouts.js
payoutBodyProblem`: positive `payout_amount`, `<cc>_…` method type whose prefix
matches `beneficiary_country`, ISO codes, `individual`/`company`,
`merchant_reference_id` ≤ 45 chars — Rapyd's payout limit) and injects the
profile's wallet as `ewallet` when the caller sent none; no wallet configured →
`400 MISSING_EWALLET`. The source wallet must hold funds in the payout currency:
top a sandbox wallet up with Rapyd's sandbox-only *Add Funds to Wallet Account*
(`POST /v1/account/deposit` — docs.rapyd.net/en/add-funds-to-wallet-account.html)
or from the Client Portal. Card payouts must also be enabled for the MID.
`/api/payout-card-eligibility` proxies Rapyd's *Retrieve Card Eligibility
Details* (`POST /v1/cards/eligibility` —
docs.rapyd.net/en/retrieve-card-eligibility-details.html). Body: exactly one of
`card_id` (`card_***`) or `card_number` (16–19 digits, sandbox only) plus
`transaction_type` (`oct` | `aft` | `all`); anything else → `400`
(`utils/payouts.js eligibilityBodyProblem`). The frontend's Withdraw calls it
first with `transaction_type: "oct"` and uses the answer's
`data.issuer_country` as the payout's `beneficiary_country` and
`data.billing_currency` as its `payout_currency` (Rapyd converts from the
wallet's currency when they differ); `data.oct.*` = `not_supported` stops the
withdrawal before any payout call.
Payout webhooks (`PAYOUT_COMPLETED`, `PAYOUT_FAILED`) are filed by
`merchant_reference_id` like payment ones (register them for the MID).

## Deploying

**Deploy this backend before (or together with) the `paybridge` frontend.**
The frontend sends `Idempotency-Key` on every POST (and
`X-PayBridge-Live-Token` in live); a backend whose preflight only allows
`Content-Type` makes the browser block those requests, and every payment,
checkout session, refund and customer call fails as a network error. Check
after deploying:

```sh
curl -si -X OPTIONS https://<your-backend>/api/create-direct-payment | grep -i access-control-allow-headers
# → Content-Type, X-PayBridge-Live-Token, Idempotency-Key
```

## Local run

```sh
cp .env.example .env   # fill in the sandbox keys you use; leave the rest empty
npm i
npm start              # http://localhost:3000
```

## Tests

```sh
npm test               # node --test — no extra dependencies, no network
```

Tests strip every `RAPYD_*` variable, so proxy handlers stop at
`MISSING_KEYS` and never contact Rapyd.
