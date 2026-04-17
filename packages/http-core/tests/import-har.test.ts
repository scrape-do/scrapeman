import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@scrapeman/shared-types';
import { importHar, exportHar } from '../src/import/har.js';

const SAMPLE_HAR = JSON.stringify({
  log: {
    version: '1.2',
    entries: [
      {
        startedDateTime: '2026-04-17T10:00:00.000Z',
        time: 142,
        request: {
          method: 'GET',
          url: 'https://api.example.com/users?page=1',
          headers: [
            { name: 'Accept', value: 'application/json' },
            { name: 'Authorization', value: 'Bearer tok123' },
          ],
          queryString: [{ name: 'page', value: '1' }],
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          content: {
            size: 42,
            mimeType: 'application/json',
            text: '{"users":[]}',
          },
        },
      },
      {
        startedDateTime: '2026-04-17T10:01:00.000Z',
        time: 85,
        request: {
          method: 'POST',
          url: 'https://api.example.com/users',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          postData: {
            mimeType: 'application/json',
            text: '{"name":"Ada"}',
          },
        },
        response: {
          status: 201,
          statusText: 'Created',
          headers: [],
          content: { size: 0, mimeType: 'application/json' },
        },
      },
    ],
  },
});

describe('importHar', () => {
  it('parses a HAR with 2 entries into ScrapemanRequests', () => {
    const result = importHar(SAMPLE_HAR);
    expect('requests' in result).toBe(true);
    if (!('requests' in result)) return;

    expect(result.requests).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);

    const [get, post] = result.requests;

    expect(get!.method).toBe('GET');
    expect(get!.url).toBe('https://api.example.com/users?page=1');
    expect(get!.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer tok123',
    });
    expect(get!.body).toBeUndefined();

    expect(post!.method).toBe('POST');
    expect(post!.url).toBe('https://api.example.com/users');
    expect(post!.body).toEqual({ type: 'json', content: '{"name":"Ada"}' });
  });

  it('returns error for invalid JSON', () => {
    const result = importHar('not json');
    expect(result).toEqual({ ok: false, message: 'Invalid JSON' });
  });

  it('returns error for missing log.entries', () => {
    const result = importHar('{"log":{}}');
    expect(result).toEqual({ ok: false, message: 'Missing log.entries array' });
  });

  it('skips entries without a URL and produces a warning', () => {
    const har = JSON.stringify({
      log: {
        version: '1.2',
        entries: [{ request: { method: 'GET', headers: [] } }],
      },
    });
    const result = importHar(har);
    expect('requests' in result).toBe(true);
    if (!('requests' in result)) return;
    expect(result.requests).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing request.url');
  });

  it('maps form-urlencoded postData to formUrlEncoded body', () => {
    const har = JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          {
            request: {
              method: 'POST',
              url: 'https://example.com/login',
              headers: [],
              postData: {
                mimeType: 'application/x-www-form-urlencoded',
                text: 'user=ada&pass=secret',
              },
            },
          },
        ],
      },
    });
    const result = importHar(har);
    if (!('requests' in result)) throw new Error('expected success');
    expect(result.requests[0]!.body).toEqual({
      type: 'formUrlEncoded',
      fields: { user: 'ada', pass: 'secret' },
    });
  });

  it('skips HTTP/2 pseudo-headers', () => {
    const har = JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          {
            request: {
              method: 'GET',
              url: 'https://example.com',
              headers: [
                { name: ':authority', value: 'example.com' },
                { name: ':method', value: 'GET' },
                { name: 'Accept', value: '*/*' },
              ],
            },
          },
        ],
      },
    });
    const result = importHar(har);
    if (!('requests' in result)) throw new Error('expected success');
    expect(result.requests[0]!.headers).toEqual({ Accept: '*/*' });
  });
});

describe('exportHar', () => {
  const historyEntry: HistoryEntry = {
    id: 'h1',
    sentAt: '2026-04-17T10:00:00.000Z',
    workspacePath: '/tmp/ws',
    environmentName: null,
    method: 'POST',
    url: 'https://api.example.com/users',
    headers: { 'Content-Type': 'application/json' },
    bodyPreview: '{"name":"Ada"}',
    bodyTruncated: false,
    status: 201,
    statusOk: true,
    responseHeaders: [['Content-Type', 'application/json']],
    responseBodyPreview: '{"id":1}',
    responseBodyTruncated: false,
    responseSizeBytes: 8,
    durationMs: 85,
    protocol: 'http/1.1',
  };

  it('produces valid HAR 1.2 structure', () => {
    const json = exportHar([historyEntry]);
    const har = JSON.parse(json);

    expect(har.log.version).toBe('1.2');
    expect(har.log.entries).toHaveLength(1);

    const entry = har.log.entries[0];
    expect(entry.startedDateTime).toBe('2026-04-17T10:00:00.000Z');
    expect(entry.time).toBe(85);

    expect(entry.request.method).toBe('POST');
    expect(entry.request.url).toBe('https://api.example.com/users');
    expect(entry.request.postData.text).toBe('{"name":"Ada"}');
    expect(entry.request.postData.mimeType).toBe('application/json');

    expect(entry.response.status).toBe(201);
    expect(entry.response.statusText).toBe('Created');
    expect(entry.response.content.size).toBe(8);
    expect(entry.response.content.text).toBe('{"id":1}');
  });

  it('includes queryString parsed from URL', () => {
    const entry: HistoryEntry = {
      ...historyEntry,
      method: 'GET',
      url: 'https://example.com/search?q=test&page=2',
      bodyPreview: '',
    };
    const har = JSON.parse(exportHar([entry]));
    expect(har.log.entries[0].request.queryString).toEqual([
      { name: 'q', value: 'test' },
      { name: 'page', value: '2' },
    ]);
  });
});

describe('round-trip', () => {
  it('import -> export -> re-import produces matching requests', () => {
    const result1 = importHar(SAMPLE_HAR);
    if (!('requests' in result1)) throw new Error('expected success');

    // Build fake history entries from the imported requests so we can export
    const historyEntries: HistoryEntry[] = result1.requests.map((req, i) => ({
      id: `h${i}`,
      sentAt: '2026-04-17T10:00:00.000Z',
      workspacePath: '/tmp',
      environmentName: null,
      method: req.method,
      url: req.url,
      headers: req.headers ?? {},
      bodyPreview:
        req.body && 'content' in req.body ? (req.body.content ?? '') : '',
      bodyTruncated: false,
      status: 200,
      statusOk: true,
      responseHeaders: [],
      responseBodyPreview: '',
      responseBodyTruncated: false,
      responseSizeBytes: 0,
      durationMs: 0,
      protocol: 'http/1.1',
    }));

    const exported = exportHar(historyEntries);
    const result2 = importHar(exported);
    if (!('requests' in result2)) throw new Error('expected success');

    expect(result2.requests).toHaveLength(result1.requests.length);

    for (let i = 0; i < result1.requests.length; i++) {
      expect(result2.requests[i]!.method).toBe(result1.requests[i]!.method);
      expect(result2.requests[i]!.url).toBe(result1.requests[i]!.url);
    }
  });
});
