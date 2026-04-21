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
    }
  });
});
