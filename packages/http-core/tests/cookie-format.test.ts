import { describe, expect, it } from 'vitest';
import {
  exportNetscape,
  parseNetscape,
  parseDocumentCookie,
} from '../src/cookies/format.js';
import type { CookieEntry } from '@scrapeman/shared-types';

const base: CookieEntry = {
  domain: 'example.com',
  path: '/',
  name: 'sid',
  value: 'abc123',
  expires: null,
  httpOnly: false,
  secure: false,
  sameSite: null,
};

describe('exportNetscape', () => {
  it('writes header comment lines', () => {
    const out = exportNetscape([base]);
    expect(out).toContain('# Netscape HTTP Cookie File');
  });

  it('adds a leading dot to the domain', () => {
    const out = exportNetscape([base]);
    const dataLine = out.split('\n').find((l) => l.includes('example.com') && !l.startsWith('#'));
    expect(dataLine).toBeDefined();
    expect(dataLine!.startsWith('.example.com')).toBe(true);
  });

  it('does not double-add a dot when domain already starts with one', () => {
    const out = exportNetscape([{ ...base, domain: '.example.com' }]);
    expect(out).toContain('.example.com\t');
    expect(out).not.toContain('..example.com');
  });

  it('emits 0 for session cookies (no expires)', () => {
    const out = exportNetscape([base]);
    const parts = out.split('\n').find((l) => l.includes('sid'))!.split('\t');
    expect(parts[4]).toBe('0');
  });

  it('emits unix timestamp for cookies with expiry', () => {
    const expires = new Date('2030-01-01T00:00:00.000Z').toISOString();
    const out = exportNetscape([{ ...base, expires }]);
    const ts = Math.floor(new Date(expires).getTime() / 1000).toString();
    expect(out).toContain(ts);
  });

  it('marks secure cookies TRUE', () => {
    const out = exportNetscape([{ ...base, secure: true }]);
    const parts = out.split('\n').find((l) => l.includes('sid'))!.split('\t');
    expect(parts[3]).toBe('TRUE');
  });

  it('marks non-secure cookies FALSE', () => {
    const out = exportNetscape([base]);
    const parts = out.split('\n').find((l) => l.includes('sid'))!.split('\t');
    expect(parts[3]).toBe('FALSE');
  });
});

describe('parseNetscape', () => {
  it('parses a minimal valid line', () => {
    const text = '.example.com\tTRUE\t/\tFALSE\t0\tsid\tabc123';
    const [cookie] = parseNetscape(text);
    expect(cookie).toBeDefined();
    expect(cookie!.domain).toBe('example.com');
    expect(cookie!.name).toBe('sid');
    expect(cookie!.value).toBe('abc123');
    expect(cookie!.secure).toBe(false);
    expect(cookie!.expires).toBeNull();
  });

  it('strips the leading dot from the domain', () => {
    const [c] = parseNetscape('.example.com\tTRUE\t/\tFALSE\t0\tx\t1');
    expect(c!.domain).toBe('example.com');
  });

  it('keeps domain unchanged when no leading dot', () => {
    const [c] = parseNetscape('example.com\tTRUE\t/\tFALSE\t0\tx\t1');
    expect(c!.domain).toBe('example.com');
  });

  it('skips comment lines', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      '# another comment',
      '.example.com\tTRUE\t/\tFALSE\t0\tsid\tabc123',
    ].join('\n');
    const result = parseNetscape(text);
    expect(result).toHaveLength(1);
  });

  it('skips blank lines', () => {
    const text = '\n\n.example.com\tTRUE\t/\tFALSE\t0\tsid\tabc123\n\n';
    expect(parseNetscape(text)).toHaveLength(1);
  });

  it('skips lines with fewer than 7 fields', () => {
    const text = '.example.com\tTRUE\t/\tFALSE\t0\tsid';
    expect(parseNetscape(text)).toHaveLength(0);
  });

  it('parses expires timestamp correctly', () => {
    const d = new Date('2030-06-15T12:00:00.000Z');
    const ts = Math.floor(d.getTime() / 1000).toString();
    const [c] = parseNetscape(`.example.com\tTRUE\t/\tFALSE\t${ts}\tsid\tv`);
    expect(c!.expires).toBe(d.toISOString());
  });

  it('round-trips through export → parse', () => {
    const original: CookieEntry = {
      ...base,
      expires: new Date('2035-01-01T00:00:00.000Z').toISOString(),
      secure: true,
    };
    const text = exportNetscape([original]);
    const [restored] = parseNetscape(text);
    expect(restored!.domain).toBe(original.domain);
    expect(restored!.name).toBe(original.name);
    expect(restored!.value).toBe(original.value);
    expect(restored!.secure).toBe(original.secure);
    // Timestamps may differ by less than 1 second due to truncation.
    const origMs = new Date(original.expires!).getTime();
    const restMs = new Date(restored!.expires!).getTime();
    expect(Math.abs(origMs - restMs)).toBeLessThan(1000);
  });

  it('returns empty array on empty input', () => {
    expect(parseNetscape('')).toEqual([]);
    expect(parseNetscape('   ')).toEqual([]);
  });
});

describe('parseDocumentCookie', () => {
  it('parses a simple name=value pair', () => {
    const [c] = parseDocumentCookie('sid=abc123', 'example.com');
    expect(c!.name).toBe('sid');
    expect(c!.value).toBe('abc123');
    expect(c!.domain).toBe('example.com');
  });

  it('parses multiple pairs separated by semicolons', () => {
    const result = parseDocumentCookie('a=1; b=2; c=3', 'example.com');
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace around name and value', () => {
    const [c] = parseDocumentCookie('  sid = abc ', 'example.com');
    expect(c!.name).toBe('sid');
    expect(c!.value).toBe('abc');
  });

  it('handles values containing = signs', () => {
    const [c] = parseDocumentCookie('token=abc=def==', 'example.com');
    expect(c!.name).toBe('token');
    expect(c!.value).toBe('abc=def==');
  });

  it('skips pairs without an = sign', () => {
    const result = parseDocumentCookie('noequals; sid=abc', 'example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('sid');
  });

  it('skips empty pairs', () => {
    const result = parseDocumentCookie(';;sid=abc;;', 'example.com');
    expect(result).toHaveLength(1);
  });

  it('skips pairs with empty name', () => {
    const result = parseDocumentCookie('=val; sid=abc', 'example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('sid');
  });

  it('sets path to / and expires to null', () => {
    const [c] = parseDocumentCookie('x=1', 'example.com');
    expect(c!.path).toBe('/');
    expect(c!.expires).toBeNull();
  });

  it('returns empty array on empty input', () => {
    expect(parseDocumentCookie('', 'example.com')).toEqual([]);
    expect(parseDocumentCookie(';;;', 'example.com')).toEqual([]);
  });
});
