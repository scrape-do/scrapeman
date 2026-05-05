// Pure transform helpers used by the cell context menu. Each function
// returns either the transformed string or null when the input cannot be
// transformed (e.g. malformed base64). Callers turn null into a toast.

export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

export function urlDecode(input: string): string | null {
  try {
    return decodeURIComponent(input.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

export function base64Encode(input: string): string {
  // UTF-8 safe: encode the string as percent-encoded bytes first, then
  // collapse percent-escapes back to raw bytes for btoa. The classic
  // `btoa(unescape(encodeURIComponent(...)))` trick.
  return btoa(unescape(encodeURIComponent(input)));
}

export function base64Decode(input: string): string | null {
  try {
    return decodeURIComponent(escape(atob(input.trim())));
  } catch {
    return null;
  }
}

/**
 * Escape the input as if it were the contents of a JSON string literal.
 * Example: `say "hi"\nthere` → `say \\"hi\\"\\nthere`. Used to inline a
 * snippet of text into a JSON value where the escaping has to round-trip
 * through `JSON.parse`.
 */
export function stringify(input: string): string {
  // JSON.stringify wraps the result in quotes; strip them so the result
  // can be pasted directly into an existing string literal.
  const wrapped = JSON.stringify(input);
  return wrapped.slice(1, -1);
}

/**
 * Inverse of `stringify`: collapses JSON-string escape sequences back
 * into raw characters. Returns null when the input is not a valid JSON
 * string body (e.g. unterminated escape).
 */
export function destringify(input: string): string | null {
  try {
    return JSON.parse(`"${input}"`);
  } catch {
    return null;
  }
}
