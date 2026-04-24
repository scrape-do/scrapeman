import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { UndiciExecutor } from '../src/adapters/undici-executor.js';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/echo') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': '15',
      });
      res.end('{"ok":true}    ');
      return;
    }

    // Two-hop redirect: /hop1 → /hop2 → /echo
    if (url.pathname === '/hop1') {
      res.writeHead(301, { Location: '/hop2' });
      res.end();
      return;
    }

    if (url.pathname === '/hop2') {
      res.writeHead(302, { Location: '/echo' });
      res.end();
      return;
    }

    if (url.pathname === '/gzip') {
      // Serve content with a Content-Length header to test compressedSize.
      const body = Buffer.from('hello world');
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': String(body.byteLength),
      });
      res.end(body);
      return;
    }

    if (url.pathname === '/no-content-length') {
      // Chunked — no Content-Length.
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Transfer-Encoding': 'chunked' });
      res.write('chunk1');
      res.end('chunk2');
      return;
    }

    res.writeHead(418);
    res.end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

function req(
  overrides: Partial<ScrapemanRequest> & Pick<ScrapemanRequest, 'method' | 'url'>,
): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'test' },
    ...overrides,
  };
}

const executor = new UndiciExecutor();

describe('Dev Tools — executor fields', () => {
  it('populates sentUrl and sentHeaders', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/echo` }));
    expect(response.sentUrl).toBe(`${baseUrl}/echo`);
    expect(Array.isArray(response.sentHeaders)).toBe(true);
    expect(response.sentHeaders!.length).toBeGreaterThan(0);
    // Verify sentHeaders are [name, value] pairs.
    for (const [name, value] of response.sentHeaders!) {
      expect(typeof name).toBe('string');
      expect(typeof value).toBe('string');
    }
  });

  it('populates remoteAddress and remotePort', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/echo` }));
    // The local test server runs on 127.0.0.1.
    expect(response.remoteAddress).toBe('127.0.0.1');
    expect(typeof response.remotePort).toBe('number');
    expect(response.remotePort).toBeGreaterThan(0);
  });

  it('populates compressedSize from Content-Length', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/gzip` }));
    // Our test server sends Content-Length: 11 for the 'hello world' body.
    expect(response.compressedSize).toBe(11);
    expect(response.sizeBytes).toBe(11);
  });

  it('omits compressedSize when Content-Length is absent', async () => {
    const response = await executor.execute(
      req({ method: 'GET', url: `${baseUrl}/no-content-length` }),
    );
    expect(response.compressedSize).toBeUndefined();
  });

  it('captures redirect chain for a two-hop redirect', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/hop1` }));
    expect(response.status).toBe(200);
    expect(Array.isArray(response.redirectChain)).toBe(true);
    const chain = response.redirectChain!;
    expect(chain.length).toBe(2);

    // First hop: /hop1 → 301 → /hop2
    expect(chain[0]!.status).toBe(301);
    expect(chain[0]!.location).toBe('/hop2');
    // URL includes the origin + path.
    expect(chain[0]!.url).toContain('/hop1');

    // Second hop: /hop2 → 302 → /echo
    expect(chain[1]!.status).toBe(302);
    expect(chain[1]!.location).toBe('/echo');
    expect(chain[1]!.url).toContain('/hop2');
  });

  it('omits redirectChain when there are no redirects', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/echo` }));
    expect(response.redirectChain).toBeUndefined();
  });

  it('tlsCert is absent for plain HTTP', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/echo` }));
    expect(response.tlsCert).toBeUndefined();
  });
});
