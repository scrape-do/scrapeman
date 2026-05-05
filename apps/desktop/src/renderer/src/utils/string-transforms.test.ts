import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  destringify,
  stringify,
  urlDecode,
  urlEncode,
} from './string-transforms.js';

describe('urlEncode / urlDecode', () => {
  it('round-trips ASCII with reserved characters', () => {
    const original = 'foo bar?baz=qux&qux=2';
    const encoded = urlEncode(original);
    expect(encoded).toBe('foo%20bar%3Fbaz%3Dqux%26qux%3D2');
    expect(urlDecode(encoded)).toBe(original);
  });

  it('round-trips multi-byte unicode', () => {
    const original = 'çğı ü Ş';
    expect(urlDecode(urlEncode(original))).toBe(original);
  });

  it('treats + as space (matches the form-urlencoded convention)', () => {
    expect(urlDecode('a+b')).toBe('a b');
  });

  it('returns null on malformed percent-escapes', () => {
    expect(urlDecode('%E0%A4%A')).toBeNull();
  });
});

describe('base64Encode / base64Decode', () => {
  it('round-trips ASCII', () => {
    const encoded = base64Encode('hello world');
    expect(encoded).toBe('aGVsbG8gd29ybGQ=');
    expect(base64Decode(encoded)).toBe('hello world');
  });

  it('round-trips multi-byte unicode', () => {
    const original = 'JWT içeriği: çğı{}';
    const encoded = base64Encode(original);
    expect(base64Decode(encoded)).toBe(original);
  });

  it('round-trips characters that pure btoa would reject', () => {
    // btoa('é') throws because of the high byte; our encoder routes
    // through encodeURIComponent first to keep the wrapper safe.
    expect(() => base64Encode('é')).not.toThrow();
    expect(base64Decode(base64Encode('é'))).toBe('é');
  });

  it('returns null on malformed input', () => {
    expect(base64Decode('!!!not-base64!!!')).toBeNull();
  });
});

describe('stringify / destringify', () => {
  it('escapes embedded double-quotes', () => {
    const original = 'say "hi"';
    const escaped = stringify(original);
    expect(escaped).toBe('say \\"hi\\"');
    expect(destringify(escaped)).toBe(original);
  });

  it('escapes newlines, tabs, backslashes', () => {
    const original = 'line1\nline2\tcol3\\end';
    const escaped = stringify(original);
    expect(destringify(escaped)).toBe(original);
  });

  it('round-trips JSON object payload', () => {
    const original = '{"name":"Ada"}';
    expect(destringify(stringify(original))).toBe(original);
  });

  it('returns null when destringify input is not a valid JSON string body', () => {
    // Trailing backslash without an escape target.
    expect(destringify('foo\\')).toBeNull();
  });
});
