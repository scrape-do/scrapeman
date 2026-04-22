import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { UndiciExecutor } from '../src/adapters/undici-executor.js';
import { ExecutorError } from '../src/errors.js';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/echo') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Echo-Method': req.method ?? '',
        });
        res.end(
          JSON.stringify({
            method: req.method,
            path: url.pathname + url.search,
            headers: req.headers,
            body,
          }),
        );
      });
      return;
    }

    if (url.pathname === '/status/404') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/echo' });
      res.end();
      return;
    }

    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 500);
      return;
    }

    if (url.pathname === '/big') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.alloc(1_000_000, 0x41));
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

function req(overrides: Partial<ScrapemanRequest> & Pick<ScrapemanRequest, 'method' | 'url'>): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'test' },
    ...overrides,
  };
}

describe('UndiciExecutor', () => {
  const executor = new UndiciExecutor();

  it('executes a GET and returns the response envelope', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/echo` }));

    expect(response.status).toBe(200);
    expect(response.bodyTruncated).toBe(false);
    expect(response.sizeBytes).toBeGreaterThan(0);
    expect(response.contentType).toMatch(/application\/json/);
    expect(response.timings.totalMs).toBeGreaterThanOrEqual(0);

    const body = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));
    expect(body.method).toBe('GET');
  });

  it('executes a POST with a JSON body', async () => {
    const response = await executor.execute(
      req({
        method: 'POST',
        url: `${baseUrl}/echo`,
        headers: { 'Content-Type': 'application/json' },
        body: { type: 'json', content: '{"hello":"world"}' },
      }),
    );

    const body = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));
    expect(body.method).toBe('POST');
    expect(body.body).toBe('{"hello":"world"}');
    expect(body.headers['content-type']).toBe('application/json');
  });

  it('accepts custom HTTP methods (PROPFIND)', async () => {
    const response = await executor.execute(req({ method: 'PROPFIND', url: `${baseUrl}/echo` }));
    const body = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));
    expect(body.method).toBe('PROPFIND');
  });

  it('surfaces non-2xx statuses without throwing', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/status/404` }));
    expect(response.status).toBe(404);
  });

  it('follows redirects by default', async () => {
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/redirect` }));
    expect(response.status).toBe(200);
    const body = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));
    expect(body.path).toBe('/echo');
  });

  it('times out with an ExecutorError(timeout) when total exceeded', async () => {
    await expect(
      executor.execute(
        req({
          method: 'GET',
          url: `${baseUrl}/slow`,
          options: { timeout: { total: 100 } },
        }),
      ),
    ).rejects.toSatisfy((err: unknown) => err instanceof ExecutorError && (err as ExecutorError).kind === 'timeout');
  });

  it('aborts via external AbortSignal', async () => {
    const controller = new AbortController();
    const promise = executor.execute(
      req({ method: 'GET', url: `${baseUrl}/slow` }),
      { signal: controller.signal },
    );
    controller.abort();
    await expect(promise).rejects.toSatisfy(
      (err: unknown) => err instanceof ExecutorError && (err as ExecutorError).kind === 'aborted',
    );
  });

  it('caps large response bodies and marks them truncated', async () => {
    const executor = new UndiciExecutor({ maxResponseBytes: 4096 });
    const response = await executor.execute(req({ method: 'GET', url: `${baseUrl}/big` }));
    expect(response.bodyTruncated).toBe(true);
    expect(response.sizeBytes).toBe(4096);
  });

  it('raises network error for unresolved host', async () => {
    await expect(
      executor.execute(req({ method: 'GET', url: 'http://does-not-exist.scrapeman.invalid' })),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutorError && ['network', 'unknown'].includes((err as ExecutorError).kind),
    );
  });

  it('sends request.url verbatim without re-appending request.params', async () => {
    // request.params exists only for file-format round-trip (preserving disabled
    // rows). The URL bar is canonical — the UI bakes enabled params into url
    // before send, and the executor must not double-append or sneak in rows the
    // user removed from the URL bar.
    const response = await executor.execute(
      req({
        method: 'GET',
        url: `${baseUrl}/echo?a=1&b=two`,
        params: { a: '1', b: 'two', removed: 'should-not-appear' },
      }),
    );
    const body = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));
    expect(body.path).toBe('/echo?a=1&b=two');
  });
});
