# Bug Reports

## Bug A: Payment amount returned as string

**Location:** src/routes/payment.routes.js (line 16 in the list handler, line 52 in the single handler)
**Severity:** Medium
**Component:** Payment API

**How to Reproduce:**

1. Start server: `npm start`
2. Login: `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}` (see Extra Defect below, this failed before the seed fix)
3. Send request: `GET /api/payments` with the JWT token
4. Inspect `data[0].amount`

**Expected Behavior:**
`amount` is a JSON number, for example `25.5`.

**Actual Behavior:**
`amount` is a JSON string, for example `"25.5"`.

**Impact:**
Frontend arithmetic and strict comparisons break (`"25.5" + "100"` gives `"25.5100"`).
Typed clients such as the Flutter app can fail to deserialize the field.
The create endpoint returns a number while the read endpoints return a string, so the contract is inconsistent.

**Root Cause:**
`amount: p.amount.toString()` in both `GET /` and `GET /:id`.

**Suggested Fix:**
Return `parseFloat(p.amount)` in both handlers.

---

## Bug B: No maximum payment amount

**Location:** src/routes/payment.routes.js (POST handler, around line 75)
**Severity:** High
**Component:** Payment API

**How to Reproduce:**

1. Login and obtain a token
2. `POST /api/payments` with `{"amount":999999999,"currency":"EUR","customer_email":"a@b.com"}`

**Expected Behavior:**
HTTP 400 with an error mentioning the maximum (limit is 50,000).

**Actual Behavior:**
HTTP 201, payment created with `amount: 999999999`.

**Impact:**
Unrealistic or fat-fingered amounts are accepted, which is a fraud, risk and compliance exposure, and can overflow downstream provider limits.

**Root Cause:**
The validation block only checks `amount > 0`, there is no upper bound.

**Suggested Fix:**
Add a `MAX_PAYMENT_AMOUNT = 50000` constant and return 400 when `parseFloat(amount)` exceeds it.

---

## Bug C: Email validation accepts addresses without a TLD

**Location:** src/routes/auth.routes.js (`validateEmail`, line 12)
**Severity:** Medium
**Component:** Auth API

**How to Reproduce:**

1. `POST /api/auth/register` with `{"email":"user@domain","password":"SecurePass123!","business_name":"Test Co"}`

**Expected Behavior:**
HTTP 400 `Invalid email format`.

**Actual Behavior:**
HTTP 201, account created and JWT issued for `user@domain`.

**Impact:**
Undeliverable addresses are registered, so verification, receipts and password resets cannot reach the user, and the user table fills with junk.

**Root Cause:**
Regex `/^[^\s@]+@[^\s@]+$/` does not require a dot or a TLD after the `@`.

**Suggested Fix:**
Require a dotted domain with a TLD of at least 2 characters, and reject non-string input.

---

## Bug D: Webhook signature is never verified

**Location:** src/routes/webhook.routes.js (`POST /payment-status`, around line 21)
**Severity:** Critical
**Component:** Webhooks

**How to Reproduce:**

1. `POST /api/webhooks/payment-status` with header `x-webhook-signature: fake` and body `{"payment_id":"1","status":"failed","event_id":"e1"}`

**Expected Behavior:**
HTTP 401 `Invalid signature` and no state change.

**Actual Behavior:**
HTTP 200 `Webhook processed`, payment 1 is now `failed`.

**Impact:**
Anyone on the internet can mark any payment as completed, failed or refunded without paying.
This is a direct financial-integrity and fraud hole.

**Root Cause:**
The signature header is read but never compared, and the HMAC code is commented out.

**Suggested Fix:**
Compute HMAC-SHA256 of the body with the shared secret and compare in constant time with `crypto.timingSafeEqual`, rejecting missing or mismatched signatures with 401 before touching any data.

---

## Bug E: Webhooks are not idempotent

**Location:** src/routes/webhook.routes.js (`POST /payment-status`, around line 38)
**Severity:** High
**Component:** Webhooks

**How to Reproduce:**

1. Send the same webhook twice with the same `event_id`
2. Between the two sends, deliver a newer event that changes the payment status
3. Replay the old event

**Expected Behavior:**
The replay returns 200 `Already processed` and the payment status is not changed.

**Actual Behavior:**
Both deliveries return `Webhook processed` and the stale event overwrites the newer status.

**Impact:**
Providers retry and deliver out of order, so statuses can regress (for example `completed` back to `pending`) and any side effects (receipts, ledger entries) would be duplicated.
This also enables replay attacks.

**Root Cause:**
`db.processed_webhooks` exists but is never read or written, and `event_id` is not validated.

**Suggested Fix:**
Require `event_id`, short-circuit when it is already in `db.processed_webhooks`, and record it only after the update has been applied.

---

## Bug F: Duplicate pending orders for the same table

**Location:** src/routes/table-order.routes.js (`POST /`, around line 44)
**Severity:** Medium
**Component:** Table Orders

**How to Reproduce:**

1. `POST /api/table-orders` with `{"merchant_id":"2","table_number":5,"items":[{"price":10,"quantity":1}]}`
2. Send the identical request again

**Expected Behavior:**
Second request returns 409 `Table already has a pending order`.

**Actual Behavior:**
Second request returns 201 and a second pending order exists for table 5.

**Impact:**
Double-tapped or retried requests create duplicate orders, so the kitchen prepares food twice and the bill is wrong.

**Root Cause:**
No check for an existing `pending` order with the same `merchant_id` and `table_number`.

**Suggested Fix:**
Look up an existing pending order for the merchant and table and return 409 if found.

---

## Bug G: Duplicate e-invoice submissions

**Location:** src/routes/einvoice.routes.js (`POST /submit`, around line 50)
**Severity:** Medium
**Component:** E-Invoice

**How to Reproduce:**

1. Login and obtain a token
2. `POST /api/einvoice/submit` with `{"invoice_id":"inv1","customer_siret":"12345678901234"}`
3. Send the same request again

**Expected Behavior:**
Second request returns 409 `Invoice already submitted to tax authority`.

**Actual Behavior:**
Second request returns 200 with a brand new `submission_id`, overwriting the first one.

**Impact:**
Submitting the same invoice twice to the tax authority creates duplicate filings and loses the original submission reference, which is a compliance problem.

**Root Cause:**
`einvoice_status` is never checked before a new submission is created.

**Suggested Fix:**
Return 409 when the status is `submitted` or `accepted`, after ownership and SIRET validation.

---

## Extra Defect: Seeded merchant cannot log in

**Location:** src/db/database.js (seed user `password`, line 19)
**Severity:** Medium
**Component:** Auth API / test data

**How to Reproduce:**

1. `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}`

**Expected Behavior:**
HTTP 200 with a JWT, as documented in the README.

**Actual Behavior:**
HTTP 401 `Invalid credentials`.

**Impact:**
The documented login flow and the seeded payments (owned by merchant `1`) are unreachable, which blocks testing of Bug A with the seed data.

**Root Cause:**
The stored hash is a placeholder string, not a valid bcrypt hash of `Test123!`.

**Suggested Fix:**
Replace it with a real bcrypt hash of `Test123!`.
