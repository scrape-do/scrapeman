import JSON5 from 'json5';

/** Regex that matches any {{variable}} placeholder in a string. */
const VARIABLE_RE = /\{\{[^}]+\}\}/;

export type FormatJsonResult =
  | { ok: true; text: string; fixed?: boolean }
  | { ok: false; error: string };

/**
 * Format a JSON string with the given indent level. Three-stage parse,
 * the way VSCode's JSON tooling behaves with its built-in fixer:
 *
 *   1. Strict `JSON.parse` first. Most well-formed bodies hit this.
 *   2. JSON5 — forgiving superset that accepts trailing commas, single
 *      quotes, unquoted keys, comments, hex numbers, and a few other
 *      near-miss shapes humans actually type.
 *   3. Missing-comma repair — V8's parser error includes the position
 *      where it bailed; if both prior stages failed but the error
 *      message looks like a missing-comma case, insert a comma at
 *      that position and retry, looping until either parse succeeds
 *      or no further progress is made. Caps at 30 fixes to keep us
 *      from grinding forever on genuinely broken input.
 *
 * The output is always strict JSON so the wire payload matches what
 * servers expect; `fixed: true` flags any path that touched bytes
 * beyond pure indentation.
 *
 * `{{variable}}` placeholders short-circuit before any parse — the
 * resolver hasn't run yet at format time, so JSON.parse would choke
 * on the braces and the user almost certainly doesn't want them
 * substituted client-side.
 */
export function formatJson(text: string, indent = 2): FormatJsonResult {
  if (VARIABLE_RE.test(text)) {
    return { ok: false, error: 'unresolved-variables' };
  }

  // Stage 1: strict.
  try {
    const parsed = JSON.parse(text);
    return { ok: true, text: JSON.stringify(parsed, null, indent) };
  } catch (strictErr) {
    // Stage 2: JSON5.
    try {
      const parsed = JSON5.parse(text);
      return {
        ok: true,
        text: JSON.stringify(parsed, null, indent),
        fixed: true,
      };
    } catch {
      // Stage 3: missing-comma repair. V8's error message looks like
      // "Expected ',' or '}' after property value in JSON at position 26".
      // Insert a comma at that offset, retry, repeat until parse succeeds
      // or the same error position recurs (no progress).
      const repaired = repairMissingCommas(text);
      if (repaired !== null) {
        try {
          const parsed = JSON.parse(repaired);
          return {
            ok: true,
            text: JSON.stringify(parsed, null, indent),
            fixed: true,
          };
        } catch {
          /* fall through */
        }
      }
      // Everything failed — surface the strict error since it tends to
      // point at the actual mistake (JSON5's error messages are noisier).
      const message =
        strictErr instanceof SyntaxError ? strictErr.message : String(strictErr);
      return { ok: false, error: message };
    }
  }
}

const MAX_REPAIR_ITERATIONS = 30;
const POSITION_RE = /at position (\d+)/;
// Recognise the messages V8 emits when a comma is missing. The braces
// in the message come quoted (`'}'`, `']'`) so the regex tolerates the
// optional single-quote wrappers. Other parse errors (unterminated
// strings, bad escapes, leading garbage) fall through and are reported
// as-is.
const MISSING_COMMA_MESSAGE =
  /Expected ',' or '?[}\]]'? after .* in JSON|Expected double-quoted property name/;

/**
 * Best-effort missing-comma repair. Inserts a comma at the offset V8
 * reports, then retries — looping until parse succeeds, the offset
 * doesn't advance (no progress), or 30 fixes have been made. Returns
 * the repaired source on success, null when no repair could be made.
 *
 * Inserting a comma at the V8-reported position works for the common
 * "two adjacent property values on different lines" pattern because the
 * parser bails on the first non-whitespace token AFTER the missing
 * comma — putting the comma right before that token always parses.
 */
function repairMissingCommas(input: string): string | null {
  let current = input;
  let lastPos = -1;
  for (let i = 0; i < MAX_REPAIR_ITERATIONS; i++) {
    try {
      JSON.parse(current);
      return current;
    } catch (e) {
      if (!(e instanceof SyntaxError)) return null;
      if (!MISSING_COMMA_MESSAGE.test(e.message)) return null;
      const match = POSITION_RE.exec(e.message);
      if (!match) return null;
      const pos = parseInt(match[1]!, 10);
      if (pos === lastPos) return null; // no progress, give up
      lastPos = pos;
      // Inject the comma BEFORE the offending token. The parser stopped
      // because it expected a separator; placing one there resumes parse.
      current = current.slice(0, pos) + ',' + current.slice(pos);
    }
  }
  return null;
}
