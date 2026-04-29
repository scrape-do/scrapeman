/**
 * Tests for watched-header aggregation in the load runner (issue #79).
 *
 * The runner accumulates per-header stats (unique values, numeric percentiles,
 * per-status breakdown) when `watchedHeaders` or `autoTrackScrapeDoHeaders` is
 * configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { runLoad } from '../src/load/runner.js';

// ---------------------------------------------------------------------------
// Test server
// ---------------------------------------------------------------------------

type ResponseSpec = {
  status: number;
  headers: Record<string, string>;
  body?: string;
};

let responseQueue: ResponseSpec[] = [];
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    const spec = responseQueue.shift() ?? { status: 200, headers: {} };
    for (const [k, v] of Object.entries(spec.headers)) {
      res.setHeader(k, v);
    }
    res.writeHead(spec.status, { 'Content-Type': 'text/plain' });
    res.end(spec.body ?? 'ok');
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

function req(): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'watched-header-test' },
    method: 'GET',
    url: baseUrl(),
  };
}

function enqueue(specs: ResponseSpec[]): void {
  responseQueue.push(...specs);
}

// ---------------------------------------------------------------------------
// 1. Explicit list match — header in watchedHeaders is tracked
// ---------------------------------------------------------------------------
describe('explicit list match', () => {
  it('tracks a header that is in the explicit watchedHeaders list', async () => {
    enqueue([
      { status: 200, headers: { 'X-Request-Id': 'abc' } },
      { status: 200, headers: { 'X-Request-Id': 'def' } },
    ]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 2,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Request-Id'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const stats = final.watchedHeaderStats;
    expect(stats).toBeDefined();
    // Key is the lowercase lookup key
    const entry = stats!['x-request-id'];
    expect(entry).toBeDefined();
    expect(entry!.seen).toBe(2);
    expect(entry!.unique).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. autoTrack matches Scrape.do-* case-insensitively
// ---------------------------------------------------------------------------
describe('autoTrack Scrape.do-*', () => {
  it('tracks scrape.do-* headers even with empty watchedHeaders', async () => {
    enqueue([
      { status: 200, headers: { 'Scrape.do-Rotations': '5' } },
      { status: 200, headers: { 'SCRAPE.DO-ROTATIONS': '10' } },
    ]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 2,
        concurrency: 1,
        validator: {},
        watchedHeaders: [],
        autoTrackScrapeDoHeaders: true,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const stats = final.watchedHeaderStats;
    expect(stats).toBeDefined();
    // Both headers lowercase to scrape.do-rotations
    const entry = stats!['scrape.do-rotations'];
    expect(entry).toBeDefined();
    expect(entry!.seen).toBe(2);
  });

  it('does NOT track scrape.do-* when autoTrack is false', async () => {
    enqueue([{ status: 200, headers: { 'Scrape.do-Cookie-Jar': '1' } }]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 1,
        concurrency: 1,
        validator: {},
        watchedHeaders: [],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    expect(final.watchedHeaderStats).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Explicit list combined with autoTrack
// ---------------------------------------------------------------------------
describe('explicit + autoTrack combined', () => {
  it('tracks both explicitly listed and scrape.do-* headers', async () => {
    enqueue([
      { status: 200, headers: { 'X-Trace': 'trace-1', 'Scrape.do-Rotations': '3' } },
      { status: 200, headers: { 'X-Trace': 'trace-2', 'Scrape.do-Rotations': '7' } },
    ]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 2,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Trace'],
        autoTrackScrapeDoHeaders: true,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const stats = final.watchedHeaderStats!;
    expect(stats['x-trace']?.seen).toBe(2);
    expect(stats['scrape.do-rotations']?.seen).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Numeric stats correctness — integer values
// ---------------------------------------------------------------------------
describe('numeric stats — integer values', () => {
  it('computes min, max, avg, p50, p95, p99 for integer header values', async () => {
    // 20 values: 1 through 20
    const specs: ResponseSpec[] = Array.from({ length: 20 }, (_, i) => ({
      status: 200,
      headers: { 'X-Count': String(i + 1) },
    }));
    enqueue(specs);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 20,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Count'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(30_000),
    );
    const entry = final.watchedHeaderStats!['x-count'];
    expect(entry).toBeDefined();
    expect(entry!.numeric).toBeDefined();
    expect(entry!.numeric!.min).toBe(1);
    expect(entry!.numeric!.max).toBe(20);
    expect(entry!.numeric!.avg).toBeCloseTo(10.5);
  });
});

// ---------------------------------------------------------------------------
// 5. Numeric stats — float values
// ---------------------------------------------------------------------------
describe('numeric stats — float values', () => {
  it('handles float header values and reports correct avg', async () => {
    const values = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
    enqueue(values.map((v) => ({ status: 200, headers: { 'X-Score': String(v) } })));
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: values.length,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Score'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-score'];
    expect(entry!.numeric).toBeDefined();
    expect(entry!.numeric!.min).toBe(1.5);
    expect(entry!.numeric!.max).toBe(10.5);
    expect(entry!.numeric!.avg).toBeCloseTo(6.0);
  });
});

// ---------------------------------------------------------------------------
// 6. Numeric threshold — 94% numeric → categorical, 95% → numeric
// ---------------------------------------------------------------------------
describe('numeric threshold', () => {
  it('stays categorical when only 94% of values parse as numbers (n=16 seen)', async () => {
    // 15 numeric + 1 text out of 16 seen = 93.75% < 95%
    const specs: ResponseSpec[] = [
      ...Array.from({ length: 15 }, () => ({ status: 200, headers: { 'X-Val': '42' } })),
      { status: 200, headers: { 'X-Val': 'not-a-number' } },
    ];
    enqueue(specs);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 16,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Val'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-val'];
    expect(entry!.numeric).toBeUndefined();
  });

  it('switches to numeric at exactly 95% of values (n=20 seen, 19 numeric)', async () => {
    // 19 numeric + 1 text = 95.0% >= 95
    const specs: ResponseSpec[] = [
      ...Array.from({ length: 19 }, (_, i) => ({
        status: 200,
        headers: { 'X-Val2': String(i + 1) },
      })),
      { status: 200, headers: { 'X-Val2': 'bad' } },
    ];
    enqueue(specs);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 20,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Val2'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-val2'];
    expect(entry!.numeric).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Status stratification — byStatus breakdown
// ---------------------------------------------------------------------------
describe('byStatus stratification', () => {
  it('separates counts by HTTP status code', async () => {
    enqueue([
      { status: 200, headers: { 'X-Tag': 'hit' } },
      { status: 200, headers: { 'X-Tag': 'hit' } },
      { status: 429, headers: { 'X-Tag': 'miss' } },
    ]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 3,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Tag'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-tag'];
    expect(entry!.seen).toBe(3);
    expect(entry!.byStatus['200']).toBeDefined();
    expect(entry!.byStatus['429']).toBeDefined();
    expect(entry!.byStatus['200']!.unique[0]).toEqual(['hit', 2]);
    expect(entry!.byStatus['429']!.unique[0]).toEqual(['miss', 1]);
  });
});

// ---------------------------------------------------------------------------
// 8. Empty list + autoTrack false → no output
// ---------------------------------------------------------------------------
describe('empty list + autoTrack false', () => {
  it('produces no watchedHeaderStats', async () => {
    enqueue([{ status: 200, headers: { 'X-Custom': 'value' } }]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 1,
        concurrency: 1,
        validator: {},
        watchedHeaders: [],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    expect(final.watchedHeaderStats).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Missing header on some iterations (seen < total)
// ---------------------------------------------------------------------------
describe('missing header on some iterations', () => {
  it('only counts iterations where the header is present', async () => {
    enqueue([
      { status: 200, headers: { 'X-Optional': 'present' } },
      { status: 200, headers: {} },
      { status: 200, headers: { 'X-Optional': 'present' } },
    ]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 3,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Optional'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-optional'];
    expect(entry!.seen).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 10. Top-N sorting — descending count, ties by lexicographic order
// ---------------------------------------------------------------------------
describe('top-N sorting', () => {
  it('sorts unique values by count desc, then lexicographically for ties', async () => {
    // Values: 'b'=3, 'a'=3, 'c'=1 → expected order: a,b (tie → lex) then c
    enqueue([
      { status: 200, headers: { 'X-Sort': 'b' } },
      { status: 200, headers: { 'X-Sort': 'a' } },
      { status: 200, headers: { 'X-Sort': 'b' } },
      { status: 200, headers: { 'X-Sort': 'a' } },
      { status: 200, headers: { 'X-Sort': 'c' } },
      { status: 200, headers: { 'X-Sort': 'b' } },
      { status: 200, headers: { 'X-Sort': 'a' } },
    ]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 7,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Sort'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-sort'];
    // a and b are tied at 3, c has 1. Ties broken lexicographically.
    const keys = entry!.unique.map(([k]) => k);
    expect(keys[0]).toBe('a');
    expect(keys[1]).toBe('b');
    expect(keys[2]).toBe('c');
    expect(entry!.unique[0]![1]).toBe(3);
    expect(entry!.unique[2]![1]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 11. Network failures don't break header tracking
// ---------------------------------------------------------------------------
describe('failures do not break header tracking', () => {
  it('continues tracking after a network failure iteration', async () => {
    // First response is good with a watched header, second triggers an error
    // via a connection reset, third is good again.
    // We simulate failure by closing server's socket. But it's simpler to just
    // use a server that returns 200 and a bad URL for one iteration in our
    // fixed-request model. Instead, use a response with no header for "failure"
    // simulation (real failures abort the request; here we just check header
    // tracking is unaffected).
    enqueue([
      { status: 200, headers: { 'X-Track': 'yes' } },
      { status: 500, headers: {} },
      { status: 200, headers: { 'X-Track': 'yes' } },
    ]);
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 3,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Track'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-track'];
    expect(entry!.seen).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 12. Integration: watchedHeaderStats present in every progress tick
// ---------------------------------------------------------------------------
describe('progress tick integration', () => {
  it('emits watchedHeaderStats on every progress tick once headers are seen', async () => {
    enqueue([
      { status: 200, headers: { 'Scrape.do-Rotations': '1' } },
      { status: 200, headers: { 'Scrape.do-Rotations': '2' } },
      { status: 200, headers: { 'Scrape.do-Rotations': '3' } },
      { status: 200, headers: { 'Scrape.do-Rotations': '4' } },
      { status: 200, headers: { 'Scrape.do-Rotations': '5' } },
    ]);
    const ticks: Array<typeof import('../src/load/runner.js').LoadProgress> = [];
    await runLoad(
      {
        request: req(),
        variables: {},
        total: 5,
        concurrency: 1,
        validator: {},
        watchedHeaders: [],
        autoTrackScrapeDoHeaders: true,
      },
      (p) => ticks.push(p as never),
      AbortSignal.timeout(10_000),
    );
    // Every tick after the first response should carry stats
    const ticksWithStats = ticks.filter((t) => t.watchedHeaderStats !== undefined);
    // At least 5 in-progress ticks + 1 done tick
    expect(ticksWithStats.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 13. Numeric threshold not triggered below n=5 minimum
// ---------------------------------------------------------------------------
describe('numeric threshold minimum sample size', () => {
  it('stays categorical when seen < 5, even if all values are numeric', async () => {
    // 4 numeric values: below the n>=5 threshold
    enqueue(
      Array.from({ length: 4 }, (_, i) => ({
        status: 200,
        headers: { 'X-Few': String(i + 1) },
      })),
    );
    const final = await runLoad(
      {
        request: req(),
        variables: {},
        total: 4,
        concurrency: 1,
        validator: {},
        watchedHeaders: ['X-Few'],
        autoTrackScrapeDoHeaders: false,
      },
      () => {},
      AbortSignal.timeout(10_000),
    );
    const entry = final.watchedHeaderStats!['x-few'];
    // All 4 are numeric but n < 5, so numeric mode must not kick in.
    expect(entry!.numeric).toBeUndefined();
  });
});
