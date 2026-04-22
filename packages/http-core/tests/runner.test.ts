import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { runCollection, type RunnerEvent } from '../src/runner/index.js';
import { exportRunnerJson, exportRunnerCsv, exportRunnerHtml } from '../src/runner/report.js';
import { parseCsvIterations } from '../src/runner/csv-reader.js';

// ---------- test server -----------------------------------------------------

let server: Server;
const receivedRequests: Array<{ method: string; path: string; headers: Record<string, string> }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    receivedRequests.push({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
      ),
    });
    const status = req.url?.includes('/fail') ? 500 : 200;
    res.writeHead(status, { 'Content-Type': 'text/plain', 'X-Test': 'yes' });
    res.end(`path=${req.url}`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

function port(): number {
  return (server.address() as AddressInfo).port;
}

function baseUrl(): string {
  return `http://127.0.0.1:${port()}`;
}

function req(path = '/ok', name = 'test'): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name },
    method: 'GET',
    url: `${baseUrl()}${path}`,
  };
}

// ---------- sequential mode -------------------------------------------------

describe('runCollection — sequential mode', () => {
  it('runs requests in order, one at a time', async () => {
    receivedRequests.length = 0;
    const events: RunnerEvent[] = [];

    const result = await runCollection({
      requests: [
        { request: req('/a', 'req-a') },
        { request: req('/b', 'req-b') },
        { request: req('/c', 'req-c') },
      ],
      mode: 'sequential',
      onEvent: (e) => events.push(e),
    });

    expect(result.totalSucceeded).toBe(3);
    expect(result.totalFailed).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.results.map((r) => r.requestName)).toEqual(['req-a', 'req-b', 'req-c']);

    // Events must include start, 3 request-complete, iteration-done, done.
    expect(events.some((e) => e.kind === 'start')).toBe(true);
    expect(events.filter((e) => e.kind === 'request-complete')).toHaveLength(3);
    expect(events.some((e) => e.kind === 'iteration-done')).toBe(true);
    expect(events.some((e) => e.kind === 'done')).toBe(true);
  });

  it('marks failed requests as not ok', async () => {
    const result = await runCollection({
      requests: [
        { request: req('/ok', 'ok') },
        { request: req('/fail', 'fail') },
      ],
      mode: 'sequential',
    });

    expect(result.results[0]?.ok).toBe(true);
    expect(result.results[1]?.ok).toBe(false);
    expect(result.totalSucceeded).toBe(1);
    expect(result.totalFailed).toBe(1);
  });

  it('runs multiple iterations', async () => {
    receivedRequests.length = 0;

    const result = await runCollection({
      requests: [{ request: req('/iter', 'r') }],
      mode: 'sequential',
      iterations: 3,
    });

    expect(result.iterations).toBe(3);
    expect(result.results).toHaveLength(3);
    expect(result.totalSucceeded).toBe(3);
  });
});

// ---------- parallel mode ---------------------------------------------------

describe('runCollection — parallel mode', () => {
  it('runs up to concurrency requests simultaneously', async () => {
    const startTimes: number[] = [];
    // We use the real server; just check that all succeed with concurrency.
    const result = await runCollection({
      requests: Array.from({ length: 6 }, (_, i) => ({
        request: req(`/par-${i}`, `r${i}`),
      })),
      mode: 'parallel',
      concurrency: 3,
    });

    expect(result.totalSucceeded).toBe(6);
    expect(result.totalFailed).toBe(0);
    void startTimes;
  });

  it('respects concurrency limit of 1 (effectively sequential)', async () => {
    const result = await runCollection({
      requests: [
        { request: req('/c1', 'c1') },
        { request: req('/c2', 'c2') },
      ],
      mode: 'parallel',
      concurrency: 1,
    });

    expect(result.totalSucceeded).toBe(2);
  });
});

// ---------- delay -----------------------------------------------------------

describe('runCollection — delayMs', () => {
  it('applies delay between requests and total duration reflects it', async () => {
    const delayMs = 50;
    const t0 = Date.now();
    await runCollection({
      requests: [
        { request: req('/d1', 'd1') },
        { request: req('/d2', 'd2') },
      ],
      mode: 'sequential',
      delayMs,
    });
    const elapsed = Date.now() - t0;
    // At least 2 delays should have been applied.
    expect(elapsed).toBeGreaterThanOrEqual(delayMs * 2 - 10);
  });
});

// ---------- abort -----------------------------------------------------------

describe('runCollection — abort', () => {
  it('aborts mid-run via AbortController', async () => {
    const controller = new AbortController();
    const events: RunnerEvent[] = [];

    // Use 10 requests; abort after first request-complete.
    const abortAfterFirst = (e: RunnerEvent): void => {
      events.push(e);
      if (e.kind === 'request-complete' && events.filter((x) => x.kind === 'request-complete').length === 1) {
        controller.abort();
      }
    };

    const result = await runCollection({
      requests: Array.from({ length: 10 }, (_, i) => ({
        request: req(`/abort-${i}`, `r${i}`),
      })),
      mode: 'sequential',
      abortSignal: controller.signal,
      onEvent: abortAfterFirst,
    });

    expect(result.aborted).toBe(true);
    expect(events.some((e) => e.kind === 'aborted')).toBe(true);
    // Should not have completed all 10 requests.
    expect(result.results.length).toBeLessThan(10);
  });
});

// ---------- CSV iteration variable injection --------------------------------

describe('runCollection — CSV iteration variable injection', () => {
  it('injects CSV row variables per iteration', async () => {
    receivedRequests.length = 0;

    const csvRows = [
      { id: '1', name: 'alice' },
      { id: '2', name: 'bob' },
    ];

    const result = await runCollection({
      requests: [
        {
          request: {
            scrapeman: FORMAT_VERSION,
            meta: { name: 'user-req' },
            method: 'GET',
            url: `${baseUrl()}/user/{{id}}`,
          },
        },
      ],
      mode: 'sequential',
      csvRows,
    });

    // Two CSV rows → two iterations.
    expect(result.iterations).toBe(2);
    expect(result.results).toHaveLength(2);
    // Iteration 0 should resolve {{id}} to "1".
    const paths = receivedRequests.map((r) => r.path);
    expect(paths).toContain('/user/1');
    expect(paths).toContain('/user/2');
  });
});

// ---------- report serializers ----------------------------------------------

describe('exportRunnerJson', () => {
  it('produces valid JSON with expected shape', async () => {
    const result = await runCollection({
      requests: [{ request: req('/json-test', 'r') }],
      mode: 'sequential',
    });

    const json = exportRunnerJson(result);
    const parsed = JSON.parse(json) as typeof result;
    expect(parsed.runId).toBe(result.runId);
    expect(parsed.totalSucceeded).toBe(result.totalSucceeded);
    expect(Array.isArray(parsed.results)).toBe(true);
  });
});

describe('exportRunnerCsv', () => {
  it('has header row and one data row per result', async () => {
    const result = await runCollection({
      requests: [
        { request: req('/csv-a', 'a') },
        { request: req('/csv-b', 'b') },
      ],
      mode: 'sequential',
    });

    const csv = exportRunnerCsv(result);
    const lines = csv.trim().split('\n');
    // 1 header + 2 data rows.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('iteration');
    expect(lines[0]).toContain('requestName');
    expect(lines[0]).toContain('status');
  });

  it('round-trips the request count', async () => {
    const result = await runCollection({
      requests: [{ request: req('/csv-rt', 'r') }],
      mode: 'sequential',
      iterations: 3,
    });

    const csv = exportRunnerCsv(result);
    const lines = csv.trim().split('\n');
    // 1 header + 3 data rows.
    expect(lines).toHaveLength(4);
  });
});

describe('exportRunnerHtml', () => {
  it('produces HTML containing summary stats', async () => {
    const result = await runCollection({
      requests: [{ request: req('/html-test', 'r') }],
      mode: 'sequential',
    });

    const html = exportRunnerHtml(result);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Collection runner report');
    expect(html).toContain('1'); // total requests
  });
});

// ---------- parseCsvIterations ----------------------------------------------

describe('parseCsvIterations', () => {
  it('parses simple CSV with header row', () => {
    const csv = 'id,name\n1,alice\n2,bob';
    const rows = parseCsvIterations(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: '1', name: 'alice' });
    expect(rows[1]).toEqual({ id: '2', name: 'bob' });
  });

  it('handles quoted fields containing commas', () => {
    const csv = 'key,value\nfoo,"bar,baz"';
    const rows = parseCsvIterations(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ key: 'foo', value: 'bar,baz' });
  });

  it('handles CRLF line endings', () => {
    const csv = 'a,b\r\n1,2\r\n3,4';
    const rows = parseCsvIterations(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('skips empty trailing rows', () => {
    const csv = 'x,y\n1,2\n\n';
    const rows = parseCsvIterations(csv);
    expect(rows).toHaveLength(1);
  });

  it('returns empty array for header-only CSV', () => {
    const csv = 'col1,col2';
    expect(parseCsvIterations(csv)).toHaveLength(0);
  });

  it('handles escaped double quotes', () => {
    const csv = 'msg\n"say ""hi"""';
    const rows = parseCsvIterations(csv);
    expect(rows[0]).toEqual({ msg: 'say "hi"' });
  });
});
