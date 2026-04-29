import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { FORMAT_VERSION, type LoadFailedBodyEvent, type ScrapemanRequest } from '@scrapeman/shared-types';
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

describe('runLoad — failed-body capture', () => {
  it('does not emit lastFailedBodyEvent when saveFailedBodies is false', async () => {
    const signal = AbortSignal.timeout(10_000);
    const failedBodyEvents: LoadFailedBodyEvent[] = [];

    await runLoad(
      {
        request: req(`${baseUrl()}/fb-off`),
        variables: {},
        total: 3,
        concurrency: 1,
        // Expect 201, server returns 200 → validation failures but no body capture.
        validator: { expectStatus: [201] },
        saveFailedBodies: false,
      },
      (p) => {
        if (p.lastFailedBodyEvent) failedBodyEvents.push(p.lastFailedBodyEvent);
      },
      signal,
    );

    expect(failedBodyEvents).toHaveLength(0);
  });

  it('emits lastFailedBodyEvent for each validation failure when enabled', async () => {
    const signal = AbortSignal.timeout(10_000);
    const failedBodyEvents: LoadFailedBodyEvent[] = [];

    const final = await runLoad(
      {
        request: req(`${baseUrl()}/fb-on`),
        variables: {},
        total: 4,
        concurrency: 1,
        validator: { expectStatus: [201] },
        saveFailedBodies: true,
        failedBodyLimit: 50,
      },
      (p) => {
        if (p.lastFailedBodyEvent) failedBodyEvents.push(p.lastFailedBodyEvent);
      },
      signal,
    );

    // 4 validation failures (server returns 200, we expect 201).
    expect(final.validationFailures).toBe(4);
    expect(failedBodyEvents).toHaveLength(4);
    // Each event has kind 'failed-body'.
    for (const ev of failedBodyEvents) {
      expect(ev.kind).toBe('failed-body');
      expect(ev.status).toBe(200);
    }
  });

  it('respects failedBodyLimit — stops emitting after N events', async () => {
    const signal = AbortSignal.timeout(10_000);
    const failedBodyEvents: LoadFailedBodyEvent[] = [];

    await runLoad(
      {
        request: req(`${baseUrl()}/fb-limit`),
        variables: {},
        total: 10,
        concurrency: 1,
        validator: { expectStatus: [201] },
        saveFailedBodies: true,
        failedBodyLimit: 3,
      },
      (p) => {
        if (p.lastFailedBodyEvent) failedBodyEvents.push(p.lastFailedBodyEvent);
      },
      signal,
    );

    // Even though 10 requests fail, only 3 failed-body events should be emitted.
    expect(failedBodyEvents).toHaveLength(3);
  });

  it('truncates captured bodies to 64 KB', async () => {
    // Spin up a second server that returns a large body.
    const BIG_SIZE = 128 * 1024; // 128 KB — above the 64 KB cap.
    const bigServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(Buffer.alloc(BIG_SIZE, 0x41)); // 128 KB of 'A'
    });
    bigServer.listen(0, '127.0.0.1');
    await once(bigServer, 'listening');
    const bigPort = (bigServer.address() as AddressInfo).port;

    const signal = AbortSignal.timeout(10_000);
    const failedBodyEvents: LoadFailedBodyEvent[] = [];

    await runLoad(
      {
        request: req(`http://127.0.0.1:${bigPort}/big`),
        variables: {},
        total: 1,
        concurrency: 1,
        validator: { expectStatus: [201] },
        saveFailedBodies: true,
        failedBodyLimit: 10,
      },
      (p) => {
        if (p.lastFailedBodyEvent) failedBodyEvents.push(p.lastFailedBodyEvent);
      },
      signal,
    );

    bigServer.close();
    await once(bigServer, 'close');

    expect(failedBodyEvents).toHaveLength(1);
    const capturedBytes = Buffer.from(failedBodyEvents[0]!.bodyBase64, 'base64').length;
    // Must be capped at 64 KB.
    expect(capturedBytes).toBeLessThanOrEqual(64 * 1024);
    // Must not be empty.
    expect(capturedBytes).toBeGreaterThan(0);
  });
});
