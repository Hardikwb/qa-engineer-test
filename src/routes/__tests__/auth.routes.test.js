import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { startServer, request } from './helpers.js';

let server;
before(async () => { server = await startServer(3101); });
after(() => server.stop());

const register = email => request(server.baseUrl, '/api/auth/register', {
  method: 'POST',
  body: { email, password: 'SecurePass123!', business_name: 'Test Co' }
});

test('Bug C: register rejects email without TLD (user@domain)', async () => {
  const res = await register('user@domain');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Invalid email format');
});

test('Bug C: register rejects malformed emails', async () => {
  for (const email of ['user@', '@domain.com', 'user@domain.', 'user@.com', 'a b@domain.com']) {
    const res = await register(email);
    assert.strictEqual(res.status, 400, `${email} should be rejected`);
  }
});

test('Bug C: register accepts a valid email', async () => {
  const res = await register('valid.user@example.co.uk');
  assert.strictEqual(res.status, 201);
  assert.ok(res.body.token);
});

test('login works for the seeded merchant', async () => {
  const res = await request(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { email: 'merchant@test.com', password: 'Test123!' }
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.token);
});

test('login rejects a wrong password', async () => {
  const res = await request(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { email: 'merchant@test.com', password: 'wrong-password' }
  });
  assert.strictEqual(res.status, 401);
});
