import { describe, expect, it } from 'vitest';
import { parseHeaderBulk, serializeHeaderBulk } from './header-bulk';

describe('parseHeaderBulk', () => {
  it('returns empty array for empty string', () => {
    expect(parseHeaderBulk('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseHeaderBulk('   \n  \n')).toEqual([]);
  });

  it('parses a single enabled header', () => {
    expect(parseHeaderBulk('Content-Type: application/json')).toEqual([
      { key: 'Content-Type', value: 'application/json', enabled: true },
    ]);
  });

  it('parses a disabled header prefixed with //', () => {
    expect(parseHeaderBulk('// Authorization: Bearer token')).toEqual([
      { key: 'Authorization', value: 'Bearer token', enabled: false },
    ]);
  });

  it('handles disabled-only input', () => {
    const result = parseHeaderBulk('// X-Foo: bar\n// X-Baz: qux');
    expect(result).toEqual([
      { key: 'X-Foo', value: 'bar', enabled: false },
      { key: 'X-Baz', value: 'qux', enabled: false },
    ]);
  });

  it('ignores blank lines between headers', () => {
    const result = parseHeaderBulk('A: 1\n\nB: 2\n\n');
    expect(result).toHaveLength(2);
    expect(result[0]!).toEqual({ key: 'A', value: '1', enabled: true });
    expect(result[1]!).toEqual({ key: 'B', value: '2', enabled: true });
  });

  it('last occurrence wins for duplicate keys', () => {
    const result = parseHeaderBulk('X-Dupe: first\nX-Dupe: second');
    expect(result).toHaveLength(1);
    expect(result[0]!).toEqual({ key: 'X-Dupe', value: 'second', enabled: true });
  });

  it('preserves value that contains colons', () => {
    const result = parseHeaderBulk('Authorization: Bearer tok:en:extra');
    expect(result[0]!.value).toBe('Bearer tok:en:extra');
  });

  it('trims whitespace from key and value', () => {
    const result = parseHeaderBulk('  X-Padded  :   padded value   ');
    expect(result[0]!).toEqual({ key: 'X-Padded', value: 'padded value', enabled: true });
  });

  it('supports {{var}} placeholders in values unchanged', () => {
    const result = parseHeaderBulk('Authorization: Bearer {{token}}');
    expect(result[0]!.value).toBe('Bearer {{token}}');
  });

  it('line with no colon becomes a key with empty value', () => {
    const result = parseHeaderBulk('NoColon');
    expect(result[0]!).toEqual({ key: 'NoColon', value: '', enabled: true });
  });
});

describe('serializeHeaderBulk', () => {
  it('serializes enabled headers as "Key: Value"', () => {
    expect(serializeHeaderBulk([{ key: 'X-Foo', value: 'bar', enabled: true }])).toBe('X-Foo: bar');
  });

  it('prefixes disabled headers with "// "', () => {
    expect(serializeHeaderBulk([{ key: 'X-Foo', value: 'bar', enabled: false }])).toBe(
      '// X-Foo: bar',
    );
  });

  it('produces empty string for empty input', () => {
    expect(serializeHeaderBulk([])).toBe('');
  });
});

describe('round-trip (serialize → parse)', () => {
  it('is lossless for mixed enabled/disabled rows', () => {
    const rows = [
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'Authorization', value: 'Bearer {{token}}', enabled: false },
      { key: 'X-Custom', value: 'value:with:colons', enabled: true },
    ];
    const parsed = parseHeaderBulk(serializeHeaderBulk(rows));
    expect(parsed).toEqual(rows);
  });
});
