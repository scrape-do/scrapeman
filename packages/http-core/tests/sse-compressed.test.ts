import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { UndiciExecutor } from '../src/adapters/undici-executor.js';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';

// Regression coverage for the compressed-SSE bug: when the upstream
// sends Content-Encoding: gzip / br / deflate for a text/event-stream
// response, the executor used to feed the compressed bytes straight to
// the SSE parser. Raw view rendered as garbled bytes and event parsing
// failed silently. Fix: decompress like the non-SSE path before parsing.

const SSE_BODY = `event: ping\ndata: hello\n\nevent: ping\ndata: {"msg":"second"}\n\n`;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const encoding = url.searchParams.get('encoding') ?? 'identity';

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

    let payload = Buffer.from(SSE_BODY, 'utf-8');
    if (encoding === 'gzip') {
      payload = gzipSync(payload);
      headers['Content-Encoding'] = 'gzip';
    } else if (encoding === 'br') {
      payload = brotliCompressSync(payload);
      headers['Content-Encoding'] = 'br';
    } else if (encoding === 'deflate') {
      payload = deflateSync(payload);
      headers['Content-Encoding'] = 'deflate';
    }

    headers['Content-Length'] = String(payload.byteLength);
    res.writeHead(200, headers);
    res.end(payload);
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

function req(url: string): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'sse-compressed' },
    method: 'GET',
    url,
  };
}

describe('text/event-stream + Content-Encoding', () => {
  const executor = new UndiciExecutor();

  it('parses uncompressed event-stream (control)', async () => {
    const response = await executor.execute(req(`${baseUrl}/?encoding=identity`));
    expect(response.sseEvents).toBeDefined();
    expect(response.sseEvents).toHaveLength(2);
    expect(response.sseEvents![0]!.data).toBe('hello');
    expect(response.sseEvents![1]!.data).toBe('{"msg":"second"}');
  });

  it('parses gzip-encoded event-stream — was producing garbled bytes', async () => {
    const response = await executor.execute(req(`${baseUrl}/?encoding=gzip`));
    expect(response.sseEvents).toBeDefined();
    expect(response.sseEvents).toHaveLength(2);
    expect(response.sseEvents![0]!.data).toBe('hello');
    expect(response.sseEvents![1]!.data).toBe('{"msg":"second"}');
    // Raw body text (what the renderer's Raw mode shows) must decode
    // cleanly as UTF-8 with the SSE field structure intact.
    const rawText = Buffer.from(response.bodyBase64, 'base64').toString('utf-8');
    expect(rawText).toContain('data: hello');
    expect(rawText).toContain('event: ping');
  });

  it('parses brotli-encoded event-stream', async () => {
    const response = await executor.execute(req(`${baseUrl}/?encoding=br`));
    expect(response.sseEvents).toBeDefined();
    expect(response.sseEvents).toHaveLength(2);
    expect(response.sseEvents![0]!.data).toBe('hello');
  });

  it('parses deflate-encoded event-stream', async () => {
    const response = await executor.execute(req(`${baseUrl}/?encoding=deflate`));
    expect(response.sseEvents).toBeDefined();
    expect(response.sseEvents).toHaveLength(2);
    expect(response.sseEvents![0]!.data).toBe('hello');
  });
});
