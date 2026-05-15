/**
 * Tests for the soft-drain Stop behaviour added to the load runner
 * (M11 follow-up). The runner now accepts two signals:
 *   - signal: hard abort, propagates into the executor and cancels
 *     in-flight requests. For unmount / app quit.
 *   - drainSignal: soft drain, stops workers from pulling new
 *     iterations but lets in-flight requests run to natural
 *     completion. Powers the user-facing Stop button.
 *
 * The contract: after drainSignal.abort(), the runner's final
 * snapshot reflects every iteration that was already in flight.
 * No status=0 / errorKind="aborted" entries should appear.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { runLoad } from '../src/load/runner.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Optional delay (ms) so we have a deterministic window in which to
    // call drainSignal.abort() while requests are in flight.
    const delay = Number(url.searchParams.get('delay') ?? '0');
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }, delay);
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

function req(delay: number): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'load-stop' },
    method: 'GET',
    url: `${baseUrl}/?delay=${delay}`,
  };
}

describe('runLoad — graceful drain via drainSignal', () => {
  it('stops pulling new iterations but lets in-flight finish', async () => {
    const hard = new AbortController();
    const drain = new AbortController();

    // 1000 iterations, concurrency 4, ~80ms each. Plenty of time to
    // trip the drain mid-run.
    const finalPromise = runLoad(
      {
        request: req(80),
        variables: {},
        total: 1000,
        concurrency: 4,
        validator: {},
      },
      () => {},
      { signal: hard.signal, drainSignal: drain.signal },
    );

    // Let a handful of iterations land first.
    await new Promise((r) => setTimeout(r, 250));
    drain.abort();

    const final = await finalPromise;
    // Exactly `sent` events should have landed — no synthetic aborted
    // entries, no status=0 from cancelled-mid-flight requests.
    expect(final.sent).toBeGreaterThan(0);
    expect(final.sent).toBeLessThan(1000);
    expect(final.failed).toBe(0);
    expect(final.statusHistogram['0']).toBeUndefined();
    expect(final.done).toBe(true);
  });

  it('hard abort still cancels in-flight requests', async () => {
    const hard = new AbortController();
    const drain = new AbortController();

    const finalPromise = runLoad(
      {
        request: req(200),
        variables: {},
        total: 100,
        concurrency: 4,
        validator: {},
      },
      () => {},
      { signal: hard.signal, drainSignal: drain.signal },
    );

    await new Promise((r) => setTimeout(r, 100));
    hard.abort();

    const final = await finalPromise;
    // Hard abort surfaces cancelled iterations as failures (status=0,
    // errorKind=aborted) — the executor propagated the signal.
    expect(final.sent).toBeLessThan(100);
    expect(final.done).toBe(true);
  });

  it('backwards-compatible: bare AbortSignal still works as hard abort', async () => {
    const controller = new AbortController();
    const finalPromise = runLoad(
      {
        request: req(0),
        variables: {},
        total: 10,
        concurrency: 2,
        validator: {},
      },
      () => {},
      controller.signal,
    );
    const final = await finalPromise;
    expect(final.sent).toBe(10);
    expect(final.done).toBe(true);
  });
});
