import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UndiciExecutor,
  BODY_UI_LIMIT,
} from '../src/adapters/undici-executor.js';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';

// Single pre-allocated 8MB buffer — the /size handler slices from it.
const PAYLOAD = Buffer.alloc(8 * 1024 * 1024, 0x42);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/size') {
      const n = Number(url.searchParams.get('n') ?? '0');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(n),
      });
      res.end(PAYLOAD.subarray(0, n));
      return;
    }
    res.writeHead(404);
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

function req(url: string): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'large-response' },
    method: 'GET',
    url,
  };
}

describe('T3W1 large response handling', () => {
  const executor = new UndiciExecutor();

  it('leaves small responses untruncated', async () => {
    const n = 100 * 1024; // 100KB
    const response = await executor.execute(req(`${baseUrl}/size?n=${n}`));
    expect(response.bodyTruncated).toBe(false);
    expect(response.sizeBytes).toBe(n);
    // bodyBase64 decodes back to the full 100KB.
    const decoded = Buffer.from(response.bodyBase64, 'base64');
    expect(decoded.byteLength).toBe(n);
    expect(response.fullBodyBytes?.byteLength).toBe(n);
  });

  it('does not truncate a body exactly at the UI limit', async () => {
    const response = await executor.execute(
      req(`${baseUrl}/size?n=${BODY_UI_LIMIT}`),
    );
    expect(response.bodyTruncated).toBe(false);
    expect(response.sizeBytes).toBe(BODY_UI_LIMIT);
    const decoded = Buffer.from(response.bodyBase64, 'base64');
    expect(decoded.byteLength).toBe(BODY_UI_LIMIT);
  });

  it('truncates the UI body when it exceeds the limit', async () => {
    const n = 3 * 1024 * 1024; // 3MB
    const response = await executor.execute(req(`${baseUrl}/size?n=${n}`));
    expect(response.bodyTruncated).toBe(true);
    // sizeBytes reflects the FULL body, bodyBase64 is clipped.
    expect(response.sizeBytes).toBe(n);
    const decoded = Buffer.from(response.bodyBase64, 'base64');
    expect(decoded.byteLength).toBe(BODY_UI_LIMIT);
    expect(response.fullBodyBytes?.byteLength).toBe(n);
  });

  it('saves the full body to disk without going through the UI slice', async () => {
    const n = 5 * 1024 * 1024; // 5MB
    const response = await executor.execute(req(`${baseUrl}/size?n=${n}`));
    expect(response.bodyTruncated).toBe(true);
    expect(response.fullBodyBytes?.byteLength).toBe(n);

    const dir = await mkdtemp(join(tmpdir(), 'scrapeman-t3w1-'));
    const outPath = join(dir, 'body.bin');
    try {
      // Simulate what the `response:saveToFile` IPC handler does in main.
      await writeFile(outPath, response.fullBodyBytes!);
      const written = await readFile(outPath);
      expect(written.byteLength).toBe(n);
      // Spot-check first/last bytes match the server payload.
      expect(written[0]).toBe(0x42);
      expect(written[n - 1]).toBe(0x42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
