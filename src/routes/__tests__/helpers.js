import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../server.js');

// Starts the real API on the given port and resolves once it is listening.
export function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'inherit']
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Server exited early with code ${code}`)));
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('running on')) {
        child.removeAllListeners('exit');
        resolve({
          baseUrl: `http://localhost:${port}`,
          stop: () => child.kill()
        });
      }
    });
  });
}

// Minimal JSON request helper returning { status, body }
export async function request(baseUrl, route, { method = 'GET', token, headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

export async function login(baseUrl, email = 'merchant@test.com', password = 'Test123!') {
  const res = await request(baseUrl, '/api/auth/login', { method: 'POST', body: { email, password } });
  return res.body.token;
}

// Registers a fresh merchant so tests do not depend on each other's data
export async function registerMerchant(baseUrl, email) {
  const res = await request(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { email, password: 'SecurePass123!', business_name: 'Test Co' }
  });
  return { token: res.body.token, id: res.body.user?.id };
}

export function sign(body, secret = 'test-webhook-secret-key') {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}
