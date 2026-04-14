import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { UndiciExecutor } from '../src/executor';
import { applyAuth } from '../src/auth/apply';
import type { ScrapemanRequest } from '@scrapeman/shared-types';

// ---------------------------------------------------------------------------
// Local test server that mirrors the httpbin auth contracts
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, 'http://localhost');

    // GET /basic-auth/:user/:pass
    const basicMatch = url.pathname.match(/^\/basic-auth\/([^/]+)\/([^/]+)$/);
    if (basicMatch) {
      const [, user, pass] = basicMatch;
      const authHeader = req.headers['authorization'] ?? '';
      const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      if (authHeader === expected) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ authenticated: true, user }));
      } else {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="test"' });
        res.end(JSON.stringify({ authenticated: false }));
      }
      return;
    }

    // GET /bearer — returns 200 if Authorization: Bearer <any> present
    if (url.pathname === '/bearer') {
      const authHeader = req.headers['authorization'] ?? '';
      if (authHeader.startsWith('Bearer ')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ authenticated: true, token: authHeader.slice(7) }));
      } else {
        res.writeHead(401);
        res.end(JSON.stringify({ authenticated: false }));
      }
      return;
    }

    // GET /headers — echoes all request headers as JSON
    if (url.pathname === '/headers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ headers: req.headers }));
      return;
    }

    // GET /get — echoes query params
    if (url.pathname === '/get') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ args: Object.fromEntries(url.searchParams) }));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<ScrapemanRequest> = {}): ScrapemanRequest {
  return {
    method: 'GET',
    url: baseUrl,
    headers: {},
    params: [],
    body: { mode: 'none' },
    auth: { type: 'none' },
    ...overrides,
  } as ScrapemanRequest;
}

const executor = new UndiciExecutor();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Basic auth — integration', () => {
  it('sends correct Authorization header and gets 200', async () => {
    const req = makeRequest({
      url: `${baseUrl}/basic-auth/alice/secret`,
      auth: { type: 'basic', username: 'alice', password: 'secret' },
    });
    const resolved = applyAuth(req);
    const res = await executor.execute(resolved);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.authenticated).toBe(true);
    expect(body.user).toBe('alice');
  });

  it('returns 401 on wrong credentials', async () => {
    const req = makeRequest({
      url: `${baseUrl}/basic-auth/alice/secret`,
      auth: { type: 'basic', username: 'alice', password: 'wrong' },
    });
    const resolved = applyAuth(req);
    const res = await executor.execute(resolved);
    expect(res.status).toBe(401);
  });

  it('returns 401 when auth type is none', async () => {
    const req = makeRequest({
      url: `${baseUrl}/basic-auth/alice/secret`,
      auth: { type: 'none' },
    });
    const resolved = applyAuth(req);
    const res = await executor.execute(resolved);
    expect(res.status).toBe(401);
  });
});

describe('Bearer auth — integration', () => {
  it('sends Authorization: Bearer header and gets 200', async () => {
    const req = makeRequest({
      url: `${baseUrl}/bearer`,
      auth: { type: 'bearer', token: 'my-token-xyz' },
    });
    const resolved = applyAuth(req);
    const res = await executor.execute(resolved);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.token).toBe('my-token-xyz');
  });
});

describe('API Key auth — integration', () => {
  it('injects key as request header', async () => {
    const req = makeRequest({
      url: `${baseUrl}/headers`,
      auth: { type: 'apiKey', key: 'X-Api-Key', value: 'abc123', placement: 'header' },
    });
    const resolved = applyAuth(req);
    const res = await executor.execute(resolved);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.headers['x-api-key']).toBe('abc123');
  });

  it('injects key as query parameter', async () => {
    const req = makeRequest({
      url: `${baseUrl}/get`,
      auth: { type: 'apiKey', key: 'token', value: 'qp-secret', placement: 'query' },
    });
    const resolved = applyAuth(req);
    const res = await executor.execute(resolved);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.args['token']).toBe('qp-secret');
  });
});

// ---------------------------------------------------------------------------
// Optional: live httpbin (only runs when HTTPBIN_LIVE=1)
// ---------------------------------------------------------------------------

const HTTPBIN_LIVE = process.env['HTTPBIN_LIVE'] === '1';

describe.skipIf(!HTTPBIN_LIVE)('Live httpbin — basic auth', () => {
  it('authenticates against real httpbin', async () => {
    const req = makeRequest({
      url: 'https://httpbin.org/basic-auth/user/pass',
      auth: { type: 'basic', username: 'user', password: 'pass' },
    });
    const resolved = applyAuth(req);
    const res = await executor.execute(resolved);
    expect(res.status).toBe(200);
  });
});
