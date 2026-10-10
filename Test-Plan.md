# Test Plan: Webhook Payment Flow

## 1. Test Scope

In scope:

- `POST /api/webhooks/payment-status` end to end
- Signature verification (HMAC-SHA256)
- Idempotency and replay handling
- Payment status update and persistence in the in-memory database
- Input validation of the webhook payload

Out of scope:

- UI
- Performance and load testing
- The real payment provider (Powens) and real network retries

## 2. Test Environment

- API: `http://localhost:3000` (tests use ports 3101-3105)
- Webhook simulator: curl, Postman, or `fetch` in node:test with a computed HMAC
- Database: in-memory, resets on every restart
- Secret: `test-webhook-secret-key`
- Node.js 20+

## 3. Test Scenarios

| # | Scenario | Expected | Status |
| - | -------- | -------- | ------ |
| 1 | Valid webhook with correct signature | 200, payment status updated | Automated |
| 2 | Invalid signature | 401, no change | Automated |
| 3 | Missing signature header | 401, no change | Automated |
| 4 | Signature made with the wrong secret | 401 | Automated |
| 5 | Duplicate webhook (same `event_id` twice) | 2nd returns 200 `Already processed`, no second update | Automated |
| 6 | Webhook for non-existent payment | 404 | Automated |
| 7 | Webhook arrives before the payment is created | 404 and the event is NOT marked processed, so a retry after creation succeeds | Manual |
| 8 | Multiple webhooks, different statuses, same payment | Applied in arrival order, each distinct `event_id` processed once | Automated (partially) |
| 9 | Missing fields (`payment_id` or `status`) | 400 | Manual |
| 10 | Malformed JSON body | 400 from the body parser, no crash | Manual |
| 11 | Concurrent webhooks with the same `event_id` | Exactly one applied | Manual, see risks |
| 12 | SQL injection string in `payment_id` (`1' OR '1'='1`) | 404, no error leak (in-memory lookup, parameterized queries required with PostgreSQL) | Manual |
| 13 | Signature comparison timing | Constant-time comparison, no timing signal | Code review |
| 14 | Replay of an old `event_id` after later events | 200 `Already processed`, status not rolled back | Automated |
| 15 | Missing `event_id` | 400 | Automated |

## 4. Security Tests

- **Signature verification:** tamper with each field after signing, change the body whitespace, use uppercase hex, use empty string, array or very long header values.
- **Replay prevention:** replay a captured valid request after the original was processed, and after other events were processed.
- **SQL injection:** payloads in `payment_id`, `status` and `event_id`.
- **XSS:** `<script>alert(1)</script>` in `status`, then check that the value is not reflected unescaped by any endpoint (currently `GET /api/payments` returns it as JSON data).
- **Status allow-list:** the API currently accepts any string as `status`, so arbitrary values are persisted. Recommended hardening: restrict to `pending`, `completed`, `failed`, `refunded`.

## 5. Edge Cases

- Very large `payment_id` (10,000+ characters)
- Unicode and emoji in `status`
- `null`, empty string, numeric and very long `event_id`
- Future and very old timestamps if a timestamp field is added to the payload
- Body key order differences, since the signature depends on `JSON.stringify` output

## 6. Integration Tests

- Webhook, then payment status update, then `GET /api/payments/:id` shows the new status (automated)
- Webhook, then Socket.IO event emission (`io` is available via `app.set("io")` but emission is not implemented in the webhook route, so this is a gap to raise)
- Failed webhook, then provider retry: first attempt fails (404), the event must not be recorded, and the retry after the payment exists must succeed

## 7. Risk Assessment

| Risk | Detection | Mitigation |
| ---- | --------- | ---------- |
| Spoofed webhooks mark unpaid orders as paid | Alert on 401 spikes on the webhook endpoint, reconcile statuses with the provider | Signature verification (fixed), secret in env or secrets manager, key rotation, optional IP allow-list |
| Duplicate or out-of-order delivery regresses status | Reconciliation job, log duplicate counts | Idempotency by `event_id` (fixed), status state machine that forbids backward transitions |
| Race condition: concurrent identical webhooks both pass the check | Duplicate ledger entries in reconciliation | Atomic insert with a unique constraint (PostgreSQL) or Redis `SET NX` instead of check-then-push |
| In-memory processed list lost on restart | Replays succeed after deploy | Persist processed event ids with a TTL |
| Signature over re-serialized JSON breaks on valid provider payloads | Spike in 401 for legitimate events | Verify against the raw request body |
| Arbitrary status values stored | Unexpected values in data | Allow-list of statuses |
| Event recorded but update lost | Payment stuck in `pending` | Record the event and update the payment in one transaction |

---

## Appendix: Automated Test Summary

Run with `npm test`.
Result: **30 tests, 30 passed, 0 failed.**

Each test file starts the real server on its own port through `src/routes/__tests__/helpers.js`, so the tests are true end-to-end HTTP tests and do not interfere with each other.

| File | Tests | Covers |
| ---- | ----- | ------ |
| auth.routes.test.js | 5 | Bug C (no TLD, malformed variants, valid email), seeded login, wrong password |
| payment.routes.test.js | 7 | Bug A (list and single), Bug B (over limit, boundary 50000), valid create, zero and negative, no auth |
| webhook.routes.test.js | 7 | Bug D (bad, missing, wrong-secret, valid signature), Bug E (replay does not roll back, missing event_id), unknown payment 404 |
| table-order.routes.test.js | 6 | Bug F (duplicate 409, other table, other merchant, re-order after status change), total calculation, empty items |
| einvoice.routes.test.js | 5 | Bug G (duplicate 409 keeps original id, different invoices), first submission, bad SIRET, no auth |

Note on `npm run verify-bugs`:
That script checks that the bugs are still present in the source, so after the fixes it reports 0/7 found.
This is the expected result and confirms every bug location was changed.
