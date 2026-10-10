import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { startServer, request, login, sign } from './helpers.js';

let server;
let token;
before(async () => {
  server = await startServer(3103);
  token = await login(server.baseUrl);
});
after(() => server.stop());

const sendWebhook = (body, signature = sign(body)) => request(server.baseUrl, '/api/webhooks/payment-status', {
  method: 'POST',
  headers: signature ? { 'x-webhook-signature': signature } : {},
  body
});

const paymentStatus = async id => (await request(server.baseUrl, `/api/payments/${id}`, { token })).body.data.status;

test('Bug D: webhook with invalid signature is rejected and changes nothing', async () => {
  const res = await sendWebhook({ payment_id: '1', status: 'failed', event_id: 'evt_bad_sig' }, 'fake-signature');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(await paymentStatus('1'), 'completed');
});

test('Bug D: webhook with missing signature is rejected', async () => {
  const res = await sendWebhook({ payment_id: '1', status: 'failed', event_id: 'evt_no_sig' }, null);
  assert.strictEqual(res.status, 401);
});

test('Bug D: webhook signed with the wrong secret is rejected', async () => {
  const body = { payment_id: '1', status: 'failed', event_id: 'evt_wrong_secret' };
  const res = await sendWebhook(body, sign(body, 'another-secret'));
  assert.strictEqual(res.status, 401);
});

test('Bug D: webhook with a valid signature updates the payment', async () => {
  const res = await sendWebhook({ payment_id: '2', status: 'completed', event_id: 'evt_valid' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await paymentStatus('2'), 'completed');
});

test('Bug E: duplicate event_id is processed only once', async () => {
  const first = await sendWebhook({ payment_id: '1', status: 'refunded', event_id: 'evt_dup' });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.message, 'Webhook processed');

  // A later, different event moves the payment on
  await sendWebhook({ payment_id: '1', status: 'completed', event_id: 'evt_dup_next' });

  // Replay of the first event must NOT roll the status back to "refunded"
  const replay = await sendWebhook({ payment_id: '1', status: 'refunded', event_id: 'evt_dup' });
  assert.strictEqual(replay.status, 200);
  assert.strictEqual(replay.body.message, 'Already processed');
  assert.strictEqual(await paymentStatus('1'), 'completed');
});

test('Bug E: webhook without event_id is rejected', async () => {
  const res = await sendWebhook({ payment_id: '1', status: 'completed' });
  assert.strictEqual(res.status, 400);
});

test('webhook for a non-existent payment returns 404', async () => {
  const res = await sendWebhook({ payment_id: '9999', status: 'completed', event_id: 'evt_missing_payment' });
  assert.strictEqual(res.status, 404);
});
