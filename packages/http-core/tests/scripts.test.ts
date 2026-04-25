import { describe, expect, it, vi } from 'vitest';
import { runScript } from '../src/scripts/sandbox.js';
import {
  buildBruObject,
  buildReqProxy,
  buildResProxy,
  type BruCallbacks,
  type MutableRequest,
} from '../src/scripts/bru-api.js';
import { serializeRequest } from '../src/format/serialize.js';
import { parseRequest } from '../src/format/parse.js';
import { FORMAT_VERSION, type ScrapemanRequest, type ExecutedResponse } from '@scrapeman/shared-types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCallbacks(overrides: Partial<BruCallbacks> = {}): BruCallbacks {
  return {
    getEnvVars: async () => ({}),
    setEnvVar: vi.fn(async () => {}),
    getCollectionVars: async () => ({}),
    setCollectionVar: vi.fn(async () => {}),
    getGlobalVars: async () => ({}),
    setGlobalVar: vi.fn(async () => {}),
    sendRequest: vi.fn(async () => ({ status: 200, headers: {}, body: '' })),
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ExecutedResponse> = {}): ExecutedResponse {
  return {
    status: 200,
    statusText: 'OK',
    httpVersion: 'http/1.1',
    headers: [['content-type', 'application/json']],
    bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
    bodyTruncated: false,
    sizeBytes: 11,
    timings: { totalMs: 42 },
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── sandbox ──────────────────────────────────────────────────────────────────

describe('sandbox', () => {
  it('runs a simple synchronous script', async () => {
    const result = await runScript('console.log("hello");', {});
    expect(result.consoleEntries).toHaveLength(1);
    expect(result.consoleEntries[0]!.level).toBe('log');
    expect(result.consoleEntries[0]!.args).toEqual(['hello']);
  });

  it('supports await at top level (async script)', async () => {
    const result = await runScript(
      `
      const x = await Promise.resolve(42);
      console.log(x);
      `,
      {},
    );
    expect(result.consoleEntries[0]!.args).toEqual([42]);
  });

  it('kills an infinite loop after the configured timeout', async () => {
    const start = Date.now();
    const result = await runScript('while(true){}', {}, { timeoutMs: 200 });
    const elapsed = Date.now() - start;
    // Should be well under 1s — the timeout fired.
    expect(elapsed).toBeLessThan(1000);
    // Error message should appear in console entries.
    const hasError = result.consoleEntries.some((e) => e.level === 'error');
    expect(hasError).toBe(true);
  });

  it('captures console.info, .warn, .error separately', async () => {
    const result = await runScript(
      `console.info("i"); console.warn("w"); console.error("e");`,
      {},
    );
    expect(result.consoleEntries.map((e) => e.level)).toEqual(['info', 'warn', 'error']);
  });

  it('denies access to process', async () => {
    const result = await runScript('console.log(typeof process);', {});
    expect(result.consoleEntries[0]!.args).toEqual(['undefined']);
  });

  it('denies access to require', async () => {
    const result = await runScript('console.log(typeof require);', {});
    expect(result.consoleEntries[0]!.args).toEqual(['undefined']);
  });

  it('runs test() and records a passing assertion', async () => {
    const result = await runScript(
      `test("two plus two", () => { expect(2 + 2).toBe(4); });`,
      {},
    );
    expect(result.failedAssertions).toHaveLength(0);
  });

  it('records a failed assertion with name and message', async () => {
    const result = await runScript(
      `test("bad math", () => { expect(1 + 1).toBe(3); });`,
      {},
    );
    expect(result.failedAssertions).toHaveLength(1);
    expect(result.failedAssertions[0]!.name).toBe('bad math');
    expect(result.failedAssertions[0]!.message).toContain('Expected');
  });

  it('records multiple failed assertions', async () => {
    const result = await runScript(
      `
      test("a", () => { expect(1).toBe(2); });
      test("b", () => { expect("x").toBe("y"); });
      `,
      {},
    );
    expect(result.failedAssertions).toHaveLength(2);
  });

  it('returns durationMs > 0', async () => {
    const result = await runScript('console.log("done");', {});
    expect(result.durationMs).toBeGreaterThan(0);
  });
});

// ─── bru API ──────────────────────────────────────────────────────────────────

describe('bru.getVar / setVar', () => {
  it('round-trips a request-scoped variable', async () => {
    const requestVars = new Map<string, string>();
    const bru = buildBruObject(requestVars, makeCallbacks());
    bru.setVar('token', 'abc123');
    const got = bru.getVar('token');
    expect(got).toBe('abc123');
  });

  it('returns undefined for an unset var', () => {
    const bru = buildBruObject(new Map(), makeCallbacks());
    expect(bru.getVar('missing')).toBeUndefined();
  });
});

describe('bru.setEnvVar', () => {
  it('calls the callback with the correct name and value', async () => {
    const setEnvVar = vi.fn(async () => {});
    const bru = buildBruObject(new Map(), makeCallbacks({ setEnvVar }));
    await bru.setEnvVar('apiKey', 'secret');
    expect(setEnvVar).toHaveBeenCalledWith('apiKey', 'secret');
  });
});

describe('bru.sendRequest', () => {
  it('delegates to the sendRequest callback and returns the result', async () => {
    const sendRequest = vi.fn(async () => ({
      status: 201,
      headers: { 'x-foo': 'bar' },
      body: { created: true },
    }));
    const bru = buildBruObject(new Map(), makeCallbacks({ sendRequest }));
    const res = await bru.sendRequest({ method: 'POST', url: 'https://example.com/items' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: true });
    expect(sendRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/items',
    });
  });
});

describe('bru helpers', () => {
  it('random() returns a non-empty string', () => {
    const bru = buildBruObject(new Map(), makeCallbacks());
    expect(typeof bru.random()).toBe('string');
    expect(bru.random().length).toBeGreaterThan(0);
  });

  it('timestamp() returns a number close to Date.now()', () => {
    const bru = buildBruObject(new Map(), makeCallbacks());
    const ts = bru.timestamp();
    expect(typeof ts).toBe('number');
    expect(Math.abs(ts - Date.now())).toBeLessThan(500);
  });
});

// ─── req proxy ────────────────────────────────────────────────────────────────

describe('req proxy', () => {
  it('exposes url and method', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'test' },
      method: 'POST',
      url: 'https://example.com',
    };
    const mutable: MutableRequest = { url: req.url, method: req.method };
    const proxy = buildReqProxy(req, mutable);
    expect(proxy.url).toBe('https://example.com');
    expect(proxy.method).toBe('POST');
  });

  it('setHeader mutates the mutable object', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'test' },
      method: 'GET',
      url: 'https://example.com',
    };
    const mutable: MutableRequest = { url: req.url, method: req.method };
    const proxy = buildReqProxy(req, mutable);
    proxy.setHeader('X-Token', 'abc');
    expect(mutable.headers?.['X-Token']).toBe('abc');
  });

  it('getHeader is case-insensitive', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'test' },
      method: 'GET',
      url: 'https://example.com',
      headers: { 'Content-Type': 'application/json' },
    };
    const mutable: MutableRequest = { url: req.url, method: req.method, headers: { ...req.headers } };
    const proxy = buildReqProxy(req, mutable);
    expect(proxy.getHeader('content-type')).toBe('application/json');
  });

  it('setBody mutates the body on the mutable object', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'test' },
      method: 'POST',
      url: 'https://example.com',
      body: { type: 'json', content: '{}' },
    };
    const mutable: MutableRequest = { url: req.url, method: req.method, body: req.body };
    const proxy = buildReqProxy(req, mutable);
    proxy.setBody('{"hello":"world"}');
    expect(
      mutable.body && mutable.body.type !== 'none' &&
      mutable.body.type !== 'formUrlEncoded' &&
      mutable.body.type !== 'multipart' &&
      mutable.body.type !== 'binary'
        ? mutable.body.content
        : null,
    ).toBe('{"hello":"world"}');
  });

  it('getBody returns current body content', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'test' },
      method: 'POST',
      url: 'https://example.com',
      body: { type: 'json', content: '{"key":"value"}' },
    };
    const mutable: MutableRequest = { url: req.url, method: req.method, body: req.body };
    const proxy = buildReqProxy(req, mutable);
    expect(proxy.getBody()).toBe('{"key":"value"}');
  });
});

// ─── res proxy ────────────────────────────────────────────────────────────────

describe('res proxy', () => {
  it('getStatus returns the response status', () => {
    const proxy = buildResProxy(makeResponse({ status: 404 }));
    expect(proxy.getStatus()).toBe(404);
  });

  it('getHeader is case-insensitive', () => {
    const response = makeResponse({
      headers: [['X-Custom', 'value123']],
    });
    const proxy = buildResProxy(response);
    expect(proxy.getHeader('x-custom')).toBe('value123');
  });

  it('getBody auto-parses JSON when content-type is json', () => {
    const response = makeResponse({
      headers: [['content-type', 'application/json']],
      bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
    });
    const proxy = buildResProxy(response);
    expect(proxy.getBody()).toEqual({ ok: true });
  });

  it('getBody returns raw string for non-JSON responses', () => {
    const response = makeResponse({
      headers: [['content-type', 'text/plain']],
      bodyBase64: Buffer.from('hello').toString('base64'),
    });
    const proxy = buildResProxy(response);
    expect(proxy.getBody()).toBe('hello');
  });

  it('getHeaders returns a flat key→value object', () => {
    const response = makeResponse({
      headers: [['x-foo', 'bar'], ['content-type', 'text/plain']],
    });
    const proxy = buildResProxy(response);
    const headers = proxy.getHeaders();
    expect(headers['x-foo']).toBe('bar');
    expect(headers['content-type']).toBe('text/plain');
  });
});

// ─── sandbox integration with context ─────────────────────────────────────────

describe('sandbox integration (bru in script)', () => {
  it('bru.setVar and getVar visible within the same script run', async () => {
    const requestVars = new Map<string, string>();
    const bru = buildBruObject(requestVars, makeCallbacks());
    const result = await runScript(
      `
      bru.setVar("x", "42");
      const v = bru.getVar("x");
      console.log(v);
      `,
      { bru },
    );
    expect(result.consoleEntries[0]!.args).toEqual(['42']);
  });

  it('test() and expect().toBe() work in script context', async () => {
    const result = await runScript(
      `
      test("status check", () => {
        expect(res.getStatus()).toBe(200);
      });
      `,
      { res: buildResProxy(makeResponse({ status: 200 })) },
    );
    expect(result.failedAssertions).toHaveLength(0);
  });

  it('failing test is captured, not thrown', async () => {
    const result = await runScript(
      `
      test("wrong status", () => {
        expect(res.getStatus()).toBe(404);
      });
      `,
      { res: buildResProxy(makeResponse({ status: 200 })) },
    );
    expect(result.failedAssertions).toHaveLength(1);
    expect(result.failedAssertions[0]!.name).toBe('wrong status');
  });
});

// ─── format round-trip with scripts ───────────────────────────────────────────

describe('scripts format round-trip', () => {
  it('round-trips preRequest and postResponse scripts', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Scripted request' },
      method: 'GET',
      url: 'https://example.com',
      scripts: {
        preRequest: 'req.setHeader("X-Token", bru.getVar("token"));',
        postResponse: 'test("ok", () => { expect(res.getStatus()).toBe(200); });',
      },
    };
    const { yaml } = serializeRequest(original, 'scripted');
    const parsed = await parseRequest(yaml);
    expect(parsed.scripts?.preRequest).toBe(original.scripts!.preRequest);
    expect(parsed.scripts?.postResponse).toBe(original.scripts!.postResponse);
  });

  it('round-trips a multi-line script preserving whitespace', async () => {
    const multiline = `const x = 1;\nconst y = 2;\nconsole.log(x + y);`;
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Multiline' },
      method: 'GET',
      url: 'https://example.com',
      scripts: { preRequest: multiline },
    };
    const { yaml } = serializeRequest(original, 'multiline');
    const parsed = await parseRequest(yaml);
    expect(parsed.scripts?.preRequest).toBe(multiline);
  });

  it('omits scripts block when both scripts are empty', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'No scripts' },
      method: 'GET',
      url: 'https://example.com',
    };
    const { yaml } = serializeRequest(req, 'test');
    expect(yaml).not.toContain('scripts:');
  });
});
