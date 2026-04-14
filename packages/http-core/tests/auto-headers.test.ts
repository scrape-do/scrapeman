import { describe, expect, it } from 'vitest';
import {
  buildAutoHeaders,
  contentTypeForBody,
  mergeHeaders,
} from '../src/auto-headers.js';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';

const ENV = { version: '1.2.3', platform: 'darwin arm64' };

function req(overrides: Partial<ScrapemanRequest> = {}): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'test' },
    method: 'GET',
    url: 'http://x/',
    ...overrides,
  };
}

describe('buildAutoHeaders', () => {
  it('includes all canonical auto headers for a bodyless GET', () => {
    const h = buildAutoHeaders(req(), ENV);
    const keys = h.map((x) => x.key);
    expect(keys).toContain('User-Agent');
    expect(keys).toContain('Accept');
    expect(keys).toContain('Accept-Encoding');
    expect(keys).toContain('Cache-Control');
    expect(keys).toContain('Connection');
    expect(keys).toContain('X-Scrapeman-Token');
    expect(keys).not.toContain('Content-Type');
  });

  it('formats User-Agent as Scrapeman/<version> (<platform>)', () => {
    const h = buildAutoHeaders(req(), ENV);
    const ua = h.find((x) => x.key === 'User-Agent');
    expect(ua?.value).toBe('Scrapeman/1.2.3 (darwin arm64)');
  });

  it('generates a unique X-Scrapeman-Token per call', () => {
    const a = buildAutoHeaders(req(), ENV).find((x) => x.key === 'X-Scrapeman-Token');
    const b = buildAutoHeaders(req(), ENV).find((x) => x.key === 'X-Scrapeman-Token');
    expect(a?.value).not.toBe(b?.value);
    expect(a?.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('adds Content-Type for json body', () => {
    const h = buildAutoHeaders(
      req({ body: { type: 'json', content: '{}' } }),
      ENV,
    );
    expect(h.find((x) => x.key === 'Content-Type')?.value).toBe('application/json');
  });

  it('skips Content-Type for multipart bodies', () => {
    const h = buildAutoHeaders(
      req({ body: { type: 'multipart', parts: [] } }),
      ENV,
    );
    expect(h.find((x) => x.key === 'Content-Type')).toBeUndefined();
  });
});

describe('contentTypeForBody', () => {
  it('returns null for none/undefined/multipart', () => {
    expect(contentTypeForBody(undefined)).toBeNull();
    expect(contentTypeForBody({ type: 'none' })).toBeNull();
    expect(contentTypeForBody({ type: 'multipart', parts: [] })).toBeNull();
  });

  it('maps each body type to its expected Content-Type', () => {
    expect(contentTypeForBody({ type: 'json', content: '' })).toBe('application/json');
    expect(contentTypeForBody({ type: 'xml', content: '' })).toBe('application/xml');
    expect(contentTypeForBody({ type: 'html', content: '' })).toBe('text/html');
    expect(contentTypeForBody({ type: 'javascript', content: '' })).toBe(
      'application/javascript',
    );
    expect(contentTypeForBody({ type: 'text', content: '' })).toBe('text/plain');
    expect(contentTypeForBody({ type: 'formUrlEncoded', fields: {} })).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(contentTypeForBody({ type: 'binary', file: '/tmp/x' })).toBe(
      'application/octet-stream',
    );
  });
});

describe('mergeHeaders', () => {
  it('emits all auto headers when user provides none', () => {
    const auto = buildAutoHeaders(req(), ENV);
    const merged = mergeHeaders(auto, undefined, new Set());
    expect(merged['User-Agent']).toBe('Scrapeman/1.2.3 (darwin arm64)');
    expect(merged['Accept']).toBe('*/*');
  });

  it('user header overrides auto header case-insensitively', () => {
    const auto = buildAutoHeaders(req(), ENV);
    const merged = mergeHeaders(auto, { 'user-agent': 'curl/8.0' }, new Set());
    expect(merged['user-agent']).toBe('curl/8.0');
    expect(merged['User-Agent']).toBeUndefined();
    // Only one UA is emitted.
    const uaCount = Object.keys(merged).filter(
      (k) => k.toLowerCase() === 'user-agent',
    ).length;
    expect(uaCount).toBe(1);
  });

  it('disabled set skips matching auto headers (case-insensitive)', () => {
    const auto = buildAutoHeaders(req(), ENV);
    const merged = mergeHeaders(auto, undefined, new Set(['user-agent', 'Accept']));
    expect(merged['User-Agent']).toBeUndefined();
    expect(merged['Accept']).toBeUndefined();
    expect(merged['Cache-Control']).toBe('no-cache');
  });

  it('user-supplied headers still pass through when their name is disabled', () => {
    const auto = buildAutoHeaders(req(), ENV);
    const merged = mergeHeaders(
      auto,
      { 'X-Custom': 'yes' },
      new Set(['user-agent']),
    );
    expect(merged['X-Custom']).toBe('yes');
    expect(merged['User-Agent']).toBeUndefined();
  });

  it('multipart body: auto Content-Type absent, user can still set one', () => {
    const auto = buildAutoHeaders(
      req({ body: { type: 'multipart', parts: [] } }),
      ENV,
    );
    const merged = mergeHeaders(auto, undefined, new Set());
    expect(
      Object.keys(merged).find((k) => k.toLowerCase() === 'content-type'),
    ).toBeUndefined();
  });
});
