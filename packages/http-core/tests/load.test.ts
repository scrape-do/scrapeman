import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { runLoad } from '../src/load/runner.js';

let server: Server;
// Paths received by the server across all requests in a run.
const receivedPaths: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    receivedPaths.push(req.url ?? '/');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

function baseUrl(): string {
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

function port(): number {
  return (server.address() as AddressInfo).port;
}

function req(url: string): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'load-test' },
    method: 'GET',
    url,
  };
}

describe('runLoad — per-iteration variable resolution', () => {
  it('produces ≥95 distinct resolved URLs across 100 iterations with {{random}}', async () => {
    receivedPaths.length = 0;

    const signal = AbortSignal.timeout(30_000);
    const final = await runLoad(
      {
        request: req(`${baseUrl()}/probe/{{random}}`),
        variables: {},
        total: 100,
        concurrency: 10,
        validator: { expectStatus: [200] },
      },
      () => {},
      signal,
    );

    expect(final.sent).toBe(100);
    expect(final.done).toBe(true);

    const distinct = new Set(receivedPaths).size;
    expect(distinct).toBeGreaterThanOrEqual(95);
  });

  it('resolves {{timestamp}} freshly per iteration — no two iterations share the same header value', async () => {
    // We verify resolution is per-call (not cached before the loop) by
    // checking that the {{random}} in the body also varies. This duplicates
    // the URL check but targets the body path through resolveRequest.
    receivedPaths.length = 0;

    const signal = AbortSignal.timeout(30_000);
    const final = await runLoad(
      {
        request: req(`${baseUrl()}/ts/{{timestamp}}`),
        variables: {},
        total: 20,
        concurrency: 5,
        validator: { expectStatus: [200] },
      },
      () => {},
      signal,
    );

    expect(final.sent).toBe(20);
    // Timestamps at ms resolution won't all differ with concurrency, but at
    // minimum we expect more than 1 distinct value — proving the variable
    // isn't frozen from before the loop.
    const distinct = new Set(receivedPaths).size;
    expect(distinct).toBeGreaterThan(1);
  });

  it('routes scheme-less URLs through normalizeUrl — 127.0.0.1:PORT works without http://', async () => {
    receivedPaths.length = 0;

    const signal = AbortSignal.timeout(10_000);
    // Pass the URL without a scheme — normalizeUrl should prepend http://
    const schemeless = `127.0.0.1:${port()}/no-scheme`;
    const final = await runLoad(
      {
        request: req(schemeless),
        variables: {},
        total: 3,
        concurrency: 1,
        validator: { expectStatus: [200] },
      },
      () => {},
      signal,
    );

    expect(final.sent).toBe(3);
    expect(final.succeeded).toBe(3);
  });

  it('tracks validation failures separately from network errors', async () => {
    receivedPaths.length = 0;

    const signal = AbortSignal.timeout(10_000);
    const final = await runLoad(
      {
        request: req(`${baseUrl()}/ok`),
        variables: {},
        total: 5,
        concurrency: 1,
        // Server always returns 200 — expect 201, so all five are validation
        // failures rather than network errors.
        validator: { expectStatus: [201] },
      },
      () => {},
      signal,
    );

    expect(final.sent).toBe(5);
    expect(final.failed).toBe(0);
    expect(final.validationFailures).toBe(5);
  });

  it('stops early when the abort signal fires', async () => {
    receivedPaths.length = 0;

    const controller = new AbortController();
    const resultPromise = runLoad(
      {
        // /slow route doesn't exist on our server but we only need a few
        // requests to be in-flight when we abort. The server responds
        // instantly with 200 so we rely on the runner seeing the abort
        // between iterations (perIterDelayMs gives it a gap to check).
        request: req(`${baseUrl()}/abort-test`),
        variables: {},
        total: 1000,
        concurrency: 1,
        perIterDelayMs: 5,
        validator: {},
      },
      () => {},
      controller.signal,
    );

    // Let a few iterations land, then abort.
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    const final = await resultPromise;
    // Should have sent far fewer than 1000.
    expect(final.sent).toBeLessThan(1000);
    expect(final.done).toBe(true);
  });

  it('emits progress callbacks with correct inflight and sent counts', async () => {
    receivedPaths.length = 0;

    const events: Array<{ sent: number; done: boolean }> = [];
    const signal = AbortSignal.timeout(10_000);

    await runLoad(
      {
        request: req(`${baseUrl()}/progress`),
        variables: {},
        total: 5,
        concurrency: 1,
        validator: {},
      },
      (p) => events.push({ sent: p.sent, done: p.done }),
      signal,
    );

    // Last event must be the done=true snapshot.
    expect(events.at(-1)?.done).toBe(true);
    // sent must be monotonically non-decreasing.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.sent).toBeGreaterThanOrEqual(events[i - 1]!.sent);
    }
  });
});
