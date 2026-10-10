import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { startServer, request, login } from './helpers.js';

let server;
let token;
before(async () => {
  server = await startServer(3102);
  token = await login(server.baseUrl);
});
after(() => server.stop());

const createPayment = (amount, auth = token) => request(server.baseUrl, '/api/payments', {
  method: 'POST',
  token: auth,
  body: { amount, currency: 'EUR', customer_email: 'test@test.com' }
});

test('Bug A: GET /payments returns amount as number', async () => {
  const res = await request(server.baseUrl, '/api/payments', { token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(typeof res.body.data[0].amount, 'number');
  assert.strictEqual(res.body.data[0].amount, 25.5);
});

test('Bug A: GET /payments/:id returns amount as number', async () => {
  const res = await request(server.baseUrl, '/api/payments/2', { token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.amount, 100);
});

test('Bug B: POST /payments rejects amount over the maximum', async () => {
  for (const amount of [999999999, 50000.01]) {
    const res = await createPayment(amount);
    assert.strictEqual(res.status, 400, `${amount} should be rejected`);
    assert.ok(res.body.error.includes('maximum'));
  }
});

test('Bug B: POST /payments accepts the boundary amount of 50000', async () => {
  const res = await createPayment(50000);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.amount, 50000);
});

test('POST /payments with a valid amount succeeds', async () => {
  const res = await createPayment(49.99);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.status, 'pending');
});

test('POST /payments rejects zero and negative amounts', async () => {
  for (const amount of [0, -5]) {
    const res = await createPayment(amount);
    assert.strictEqual(res.status, 400, `${amount} should be rejected`);
  }
});

test('POST /payments without authentication returns 401', async () => {
  const res = await createPayment(10, null);
  assert.strictEqual(res.status, 401);
});
