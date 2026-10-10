import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { startServer, request, registerMerchant } from './helpers.js';

let server;
let merchant;
before(async () => {
  server = await startServer(3104);
  merchant = await registerMerchant(server.baseUrl, 'tables@example.com');
});
after(() => server.stop());

const createOrder = (table_number, merchant_id = merchant.id) => request(server.baseUrl, '/api/table-orders', {
  method: 'POST',
  body: { merchant_id, table_number, items: [{ name: 'Pizza', price: 10, quantity: 2 }] }
});

test('creating an order succeeds and calculates the total', async () => {
  const res = await createOrder(1);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.total, 20);
  assert.strictEqual(res.body.data.status, 'pending');
});

test('Bug F: second pending order for the same table is rejected', async () => {
  assert.strictEqual((await createOrder(2)).status, 201);
  const dup = await createOrder(2);
  assert.strictEqual(dup.status, 409);
  assert.ok(dup.body.error.includes('pending'));
});

test('Bug F: a different table can still be ordered', async () => {
  assert.strictEqual((await createOrder(3)).status, 201);
  assert.strictEqual((await createOrder(4)).status, 201);
});

test('Bug F: same table number for another merchant is allowed', async () => {
  const other = await registerMerchant(server.baseUrl, 'tables-other@example.com');
  assert.strictEqual((await createOrder(5)).status, 201);
  assert.strictEqual((await createOrder(5, other.id)).status, 201);
});

test('Bug F: table can be ordered again once the previous order is no longer pending', async () => {
  const first = await createOrder(6);
  const patch = await request(server.baseUrl, `/api/table-orders/${first.body.data.id}/status`, {
    method: 'PATCH',
    token: merchant.token,
    body: { status: 'served' }
  });
  assert.strictEqual(patch.status, 200);
  assert.strictEqual((await createOrder(6)).status, 201);
});

test('order without items is rejected', async () => {
  const res = await request(server.baseUrl, '/api/table-orders', {
    method: 'POST',
    body: { merchant_id: merchant.id, table_number: 7, items: [] }
  });
  assert.strictEqual(res.status, 400);
});
