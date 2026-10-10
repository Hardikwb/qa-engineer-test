import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { startServer, request, registerMerchant } from './helpers.js';

let server;
let merchant;
before(async () => {
  server = await startServer(3105);
  merchant = await registerMerchant(server.baseUrl, 'invoice@example.com');
});
after(() => server.stop());

const submit = (invoice_id, customer_siret = '12345678901234', token = merchant.token) =>
  request(server.baseUrl, '/api/einvoice/submit', {
    method: 'POST',
    token,
    body: { invoice_id, customer_siret }
  });

test('first submission succeeds and status becomes submitted', async () => {
  const res = await submit('inv-ok');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.submission_id.startsWith('SUB-'));

  const status = await request(server.baseUrl, '/api/einvoice/status/inv-ok', { token: merchant.token });
  assert.strictEqual(status.body.data.einvoice_status, 'submitted');
});

test('Bug G: submitting the same invoice twice returns 409 and keeps the original submission', async () => {
  const first = await submit('inv-dup');
  assert.strictEqual(first.status, 200);

  const second = await submit('inv-dup');
  assert.strictEqual(second.status, 409);
  assert.ok(second.body.error.includes('already submitted'));

  const status = await request(server.baseUrl, '/api/einvoice/status/inv-dup', { token: merchant.token });
  assert.strictEqual(status.body.data.submission_id, first.body.data.submission_id);
});

test('Bug G: different invoices can each be submitted once', async () => {
  assert.strictEqual((await submit('inv-a')).status, 200);
  assert.strictEqual((await submit('inv-b')).status, 200);
});

test('submission with an invalid SIRET is rejected', async () => {
  const res = await submit('inv-bad-siret', '123');
  assert.strictEqual(res.status, 400);
});

test('submission without authentication returns 401', async () => {
  const res = await submit('inv-noauth', '12345678901234', null);
  assert.strictEqual(res.status, 401);
});
