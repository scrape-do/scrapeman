import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { UndiciExecutor } from '../src/adapters/undici-executor.js';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sizeKb = Number(url.searchParams.get('kb') ?? '32');
    const cookieValue = 'a'.repeat(sizeKb * 1024);
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      // Single oversized Set-Cookie that would have tripped the 16 KiB
      // default in undici. scrape.do + Cloudflare-style anti-bot tokens
      // routinely produce headers in this size range.
      'Set-Cookie': `bigcookie=${cookieValue}`,
    });
    res.end('ok');
  });
  // Node's HTTP server caps the request line/headers it'll accept. The
  // executor sends tiny requests, so the default is fine here — we only
  // need the response side to be huge.
  server.maxHeadersCount = 0;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

function req(url: string): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'large-headers' },
    method: 'GET',
    url,
  };
}

describe('large response headers', () => {
  const executor = new UndiciExecutor();

  it('accepts a single 32 KiB Set-Cookie header (default would reject)', async () => {
    const response = await executor.execute(req(`${baseUrl}/?kb=32`));
    expect(response.status).toBe(200);
    const setCookie = response.headers.find(
      ([k]) => k.toLowerCase() === 'set-cookie',
    );
    expect(setCookie).toBeDefined();
    expect(setCookie?.[1].length).toBeGreaterThanOrEqual(32 * 1024);
  });

  it('accepts a 128 KiB header (well above the 16 KiB undici default)', async () => {
    const response = await executor.execute(req(`${baseUrl}/?kb=128`));
    expect(response.status).toBe(200);
  });
});
