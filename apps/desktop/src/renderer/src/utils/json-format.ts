/** Regex that matches any {{variable}} placeholder in a string. */
const VARIABLE_RE = /\{\{[^}]+\}\}/;

export type FormatJsonResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Formats a JSON string with the given indent level.
 *
 * Returns `{ ok: false, error: "unresolved-variables" }` when the text
 * contains `{{...}}` placeholders — JSON.parse would choke on them and
 * the user almost certainly does not want them replaced first.
 *
 * Returns `{ ok: false, error: <message> }` for any other parse failure.
 */
export function formatJson(text: string, indent = 2): FormatJsonResult {
  if (VARIABLE_RE.test(text)) {
    return { ok: false, error: 'unresolved-variables' };
  }

  try {
    const parsed = JSON.parse(text);
    return { ok: true, text: JSON.stringify(parsed, null, indent) };
  } catch (e) {
    const message = e instanceof SyntaxError ? e.message : String(e);
    return { ok: false, error: message };
  }
}
