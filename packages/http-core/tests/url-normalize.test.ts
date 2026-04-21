import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../src/url/normalize.js';

describe('normalizeUrl', () => {
  // --- Already-valid absolute URLs (idempotent) ---

  it('returns http URLs unchanged', () => {
    expect(normalizeUrl('http://example.com/path')).toBe('http://example.com/path');
  });

  it('returns https URLs unchanged', () => {
    expect(normalizeUrl('https://x.com/y')).toBe('https://x.com/y');
  });

  it('returns ws URLs unchanged', () => {
    expect(normalizeUrl('ws://localhost:3000/socket')).toBe('ws://localhost:3000/socket');
  });

  it('returns wss URLs unchanged', () => {
    expect(normalizeUrl('wss://echo.websocket.org/')).toBe('wss://echo.websocket.org/');
  });

  it('returns URL with query string unchanged when scheme present', () => {
    expect(normalizeUrl('https://x.com/search?q=1&page=2')).toBe('https://x.com/search?q=1&page=2');
  });

  it('returns URL with userinfo unchanged', () => {
    expect(normalizeUrl('http://user:pass@host.com/path')).toBe('http://user:pass@host.com/path');
  });

  it('returns IPv6 URL unchanged', () => {
    expect(normalizeUrl('http://[::1]:8080/path')).toBe('http://[::1]:8080/path');
  });

  // --- Scheme-less inputs ---

  it('prepends http:// to bare localhost', () => {
    expect(normalizeUrl('localhost')).toBe('http://localhost');
  });

  it('prepends http:// to localhost with path', () => {
    expect(normalizeUrl('localhost/api/v1')).toBe('http://localhost/api/v1');
  });

  it('prepends http:// to localhost with query string', () => {
    expect(normalizeUrl('localhost/?q=1')).toBe('http://localhost/?q=1');
  });

  it('prepends http:// to domain with path', () => {
    expect(normalizeUrl('example.com/foo')).toBe('http://example.com/foo');
  });

  it('prepends http:// to localhost with explicit port', () => {
    expect(normalizeUrl('localhost:3000/api')).toBe('http://localhost:3000/api');
  });

  // --- Port-only inputs (no host, just :port) ---

  it('uses 0.0.0.0 for port-only with port number', () => {
    expect(normalizeUrl(':80/path')).toBe('http://0.0.0.0:80/path');
  });

  it('uses 0.0.0.0 for port-only with query string', () => {
    expect(normalizeUrl(':80/?q=1')).toBe('http://0.0.0.0:80/?q=1');
  });

  it('uses 0.0.0.0 for port-only with no trailing path', () => {
    expect(normalizeUrl(':8080')).toBe('http://0.0.0.0:8080');
  });

  // --- Empty-host inputs ---

  it('uses 0.0.0.0 for colon-slash-path (:/path)', () => {
    expect(normalizeUrl(':/path')).toBe('http://0.0.0.0/path');
  });

  it('uses 0.0.0.0 for colon-slash-slash-path (://path)', () => {
    expect(normalizeUrl('://path')).toBe('http://0.0.0.0/path');
  });

  it('uses 0.0.0.0 for just colon-slash-slash with query string', () => {
    expect(normalizeUrl(':/?q=1')).toBe('http://0.0.0.0/?q=1');
  });

  // --- Result is parseable by new URL() ---

  it('produces a URL parseable by the URL constructor after normalization', () => {
    const cases = [
      'localhost/?q=1',
      ':80/path',
      ':/?q=1',
      'example.com/foo?bar=baz',
    ];
    for (const raw of cases) {
      expect(() => new URL(normalizeUrl(raw))).not.toThrow();
    }
  });
});
