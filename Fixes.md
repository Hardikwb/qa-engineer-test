# Fixes

## Fix 1: Payment Amount Data Type (Bug A)

**Bug:** Amount returned as string instead of number

**Files Changed:**

- src/routes/payment.routes.js

**Code Changes:**

```diff
-      amount: p.amount.toString(), // BUG: Should be number, not string
+      amount: parseFloat(p.amount),
...
-        amount: payment.amount.toString(), // Same bug as above
+        amount: parseFloat(payment.amount),
```

**Why This Fix:**
Clients need a numeric type for calculations.
`parseFloat` keeps currency precision and makes read and create responses consistent.

**Testing:**
After the fix, `GET /api/payments` returns `"amount":25.5` and `"amount":100`.
Covered by two tests in payment.routes.test.js.

---

## Fix 2: Maximum Payment Amount (Bug B)

**Bug:** No upper limit on payment amount

**Files Changed:**

- src/routes/payment.routes.js

**Code Changes:**

```diff
+const MAX_PAYMENT_AMOUNT = 50000;
...
+    if (parseFloat(amount) > MAX_PAYMENT_AMOUNT) {
+      return res.status(400).json({ error: `Amount exceeds maximum of ${MAX_PAYMENT_AMOUNT}` });
+    }
```

**Why This Fix:**
A named constant makes the limit easy to change later.
The check uses `>` so exactly 50000 is still allowed, and the error message contains "maximum" as in the README example test.

**Testing:**
`POST /api/payments` with 999999999 now returns 400 `Amount exceeds maximum of 50000`.
Boundary 50000 returns 201.

---

## Fix 3: Email Validation (Bug C)

**Bug:** `user@domain` accepted

**Files Changed:**

- src/routes/auth.routes.js

**Code Changes:**

```diff
-  const emailRegex = /^[^\s@]+@[^\s@]+$/;
-  return emailRegex.test(email);
+  const emailRegex = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
+  return typeof email === 'string' && emailRegex.test(email);
```

**Why This Fix:**
The domain must now contain at least one dot and end in a TLD of 2 or more characters.
Empty labels such as `user@.com` and `user@domain.` are rejected too, and non-string input no longer reaches `regex.test`.

**Testing:**
`POST /api/auth/register` with `user@domain` now returns 400 `Invalid email format`.
`valid.user@example.co.uk` still registers.

---

## Fix 4: Webhook Signature Verification (Bug D)

**Bug:** Webhooks accepted without verifying the signature

**Files Changed:**

- src/routes/webhook.routes.js

**Code Changes:**

```diff
+function isValidSignature(provided, expected) {
+  if (typeof provided !== 'string') return false;
+  const a = Buffer.from(provided);
+  const b = Buffer.from(expected);
+  return a.length === b.length && crypto.timingSafeEqual(a, b);
+}
...
+    const expectedSignature = crypto
+      .createHmac('sha256', WEBHOOK_SECRET)
+      .update(JSON.stringify(req.body))
+      .digest('hex');
+
+    if (!isValidSignature(signature, expectedSignature)) {
+      return res.status(401).json({ error: 'Invalid signature' });
+    }
```

**Why This Fix:**
The check runs first, so unauthenticated callers learn nothing and change nothing.
`timingSafeEqual` avoids timing attacks, and the length check prevents it from throwing on different-sized inputs.

**Testing:**
A request with `x-webhook-signature: fake` now returns 401 `Invalid signature`.
Missing signature and wrong-secret signature also return 401, and a correctly signed request returns 200.

**Known limitation:**
The signature is computed over `JSON.stringify(req.body)`, which is what the README specifies.
A production setup should sign the raw request bytes to avoid re-serialization differences, and move the secret to an environment variable.

---

## Fix 5: Webhook Idempotency (Bug E)

**Bug:** Redelivered webhooks processed again

**Files Changed:**

- src/routes/webhook.routes.js

**Code Changes:**

```diff
+    if (!event_id || typeof event_id !== 'string') {
+      return res.status(400).json({ error: 'event_id required' });
+    }
+
+    if (db.processed_webhooks.includes(event_id)) {
+      return res.status(200).json({ success: true, message: 'Already processed', event_id });
+    }
...
-    // db.processed_webhooks.push(event_id);
+    db.processed_webhooks.push(event_id);
```

**Why This Fix:**
Returning 200 for a duplicate tells the provider to stop retrying.
The event is recorded only after the payment update succeeded, so a failed attempt can still be retried.

**Testing:**
Sending event `e2` twice returns `Webhook processed` then `Already processed`.
A replayed old event no longer rolls a payment back to a stale status.

**Known limitation:**
`processed_webhooks` is an in-memory array, so a real deployment needs a unique-indexed table or Redis `SET NX` to be safe across restarts and concurrent requests.

---

## Fix 6: Duplicate Table Orders (Bug F)

**Bug:** Several pending orders for one table

**Files Changed:**

- src/routes/table-order.routes.js

**Code Changes:**

```diff
+    const existingOrder = (db.table_orders || []).find(
+      o => o.merchant_id === merchant_id &&
+           o.table_number === table_number &&
+           o.status === 'pending'
+    );
+    if (existingOrder) {
+      return res.status(409).json({ error: 'Table already has a pending order' });
+    }
```

**Why This Fix:**
The check is scoped to the merchant and the table, so other merchants and other tables are unaffected.
Once an order moves out of `pending`, the table can be ordered again.

**Testing:**
The second identical `POST /api/table-orders` now returns 409.

---

## Fix 7: Duplicate E-Invoice Submission (Bug G)

**Bug:** Same invoice submitted twice

**Files Changed:**

- src/routes/einvoice.routes.js

**Code Changes:**

```diff
+    if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
+      return res.status(409).json({
+        error: 'Invoice already submitted to tax authority'
+      });
+    }
```

**Why This Fix:**
It sits after the ownership and SIRET checks so other merchants still get 403 and bad input still gets 400.
The original `submission_id` is preserved.

**Testing:**
The second `POST /api/einvoice/submit` for `inv1` now returns 409.

---

## Fix 8: Seed Merchant Password (extra defect)

**Files Changed:**

- src/db/database.js

**Code Changes:**

```diff
-    password: "$2a$10$8Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9",
+    password: "$2a$10$bcxZ6iYO04E5DcrIJx./zuXUlaqYjilfCv5UOQRcygA8djaPbAv1q",
```

**Why This Fix:**
It is a real bcrypt hash of `Test123!`, so the documented login works again.

**Testing:**
`POST /api/auth/login` with the README credentials now returns 200 and a token.

---

## Before and After Evidence

Output from the same reproduction script run against the live server.

| Check | Before | After |
| ----- | ------ | ----- |
| Login `merchant@test.com` | 401 Invalid credentials | 200 Login successful |
| C: register `user@domain` | 201 account created | 400 Invalid email format |
| A: `amount` type in list | string `"25.5"` | number `25.5` |
| B: create payment 999999999 | 201 created | 400 Amount exceeds maximum of 50000 |
| D: webhook with fake signature | 200 payment set to `failed` | 401 Invalid signature |
| E: same `event_id` twice | 200 Webhook processed (twice) | 200 Webhook processed, then 200 Already processed |
| F: same table twice | 201 and 201 | 201 then 409 |
| G: same invoice twice | 200 and 200 (new submission id) | 200 then 409 |
