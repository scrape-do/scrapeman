import { describe, expect, it } from 'vitest';
import { formatJson } from './json-format.js';

describe('formatJson', () => {
  it('formats a flat object with 2-space indent', () => {
    const result = formatJson('{"a":1,"b":"hello"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('{\n  "a": 1,\n  "b": "hello"\n}');
    }
  });

  it('formats a nested object', () => {
    const result = formatJson('{"x":{"y":42}}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('{\n  "x": {\n    "y": 42\n  }\n}');
    }
  });

  it('formats an array', () => {
    const result = formatJson('[1,2,3]');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('[\n  1,\n  2,\n  3\n]');
    }
  });

  it('respects a custom indent argument', () => {
    const result = formatJson('{"a":1}', 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('{\n    "a": 1\n}');
    }
  });

  it('returns ok=false with unresolved-variables for {{var}} in body', () => {
    const result = formatJson('{"token":"{{apiToken}}"}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('unresolved-variables');
    }
  });

  it('returns ok=false with unresolved-variables for any {{}} shape', () => {
    const result = formatJson('{"url":"{{baseUrl}}/path"}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('unresolved-variables');
    }
  });

  it('returns ok=false with a parse error message for invalid JSON', () => {
    const result = formatJson('{bad json}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The error message should come from the native JSON.parse SyntaxError
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.error).not.toBe('unresolved-variables');
    }
  });

  it('returns ok=false for empty string', () => {
    const result = formatJson('');
    expect(result.ok).toBe(false);
  });

  it('handles already-formatted JSON (idempotent)', () => {
    const pretty = '{\n  "a": 1\n}';
    const result = formatJson(pretty);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(pretty);
      expect(result.fixed).toBeUndefined();
    }
  });

  it('lenient: strips trailing commas in objects and arrays', () => {
    const result = formatJson('{"a": 1, "b": [1, 2,],}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixed).toBe(true);
      const reparsed = JSON.parse(result.text);
      expect(reparsed).toEqual({ a: 1, b: [1, 2] });
    }
  });

  it('lenient: converts single-quoted strings to double-quoted', () => {
    const result = formatJson("{'name': 'Ada', 'roles': ['admin']}");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixed).toBe(true);
      const reparsed = JSON.parse(result.text);
      expect(reparsed).toEqual({ name: 'Ada', roles: ['admin'] });
    }
  });

  it('lenient: quotes unquoted keys', () => {
    const result = formatJson('{a: 1, b: "two"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixed).toBe(true);
      const reparsed = JSON.parse(result.text);
      expect(reparsed).toEqual({ a: 1, b: 'two' });
    }
  });

  it('lenient: returns the strict error when even JSON5 fails', () => {
    const result = formatJson('{garbage <not parseable>');
    expect(result.ok).toBe(false);
  });

  it('lenient: inserts a missing comma between two object members', () => {
    const result = formatJson(`{
  "mert": "awdadwada"
  "adawda": "qdawdad"
}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixed).toBe(true);
      expect(JSON.parse(result.text)).toEqual({
        mert: 'awdadwada',
        adawda: 'qdawdad',
      });
    }
  });

  it('lenient: repairs multiple missing commas in one pass', () => {
    const result = formatJson(`{
  "a": 1
  "b": 2
  "c": [1, 2 3]
}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixed).toBe(true);
      expect(JSON.parse(result.text)).toEqual({
        a: 1,
        b: 2,
        c: [1, 2, 3],
      });
    }
  });

  it('lenient: gives up gracefully when the input is structurally broken', () => {
    // Unbalanced braces — neither JSON nor missing-comma repair can save it.
    const result = formatJson('{"a": [1, 2');
    expect(result.ok).toBe(false);
  });
});
