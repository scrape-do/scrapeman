/**
 * Normalizes a raw URL string typed by the user into a fully-qualified URL
 * that can be passed to `new URL()` or undici without throwing.
 *
 * Handled quirks:
 *   - No scheme  → prepend `http://`           e.g. `localhost/path`
 *   - Port-only  → prepend `http://0.0.0.0`    e.g. `:8080/path`
 *   - Empty-host → prepend `http://0.0.0.0`    e.g. `://path` or `:/path`
 *
 * Everything else (valid absolute URLs, IPv6, userinfo) is returned unchanged.
 *
 * IMPORTANT: call this AFTER variable resolution so that `{{base_url}}`
 * tokens are already expanded before we inspect the scheme.
 */
export function normalizeUrl(raw: string): string {
  // Already has a recognised scheme — return as-is.
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw)) {
    return raw;
  }

  // Starts with ":" — either empty-host (":/path", "://path") or port-only
  // (":8080/path"). In all cases the host is missing, so default to 0.0.0.0.
  if (raw.startsWith(':')) {
    // "://" → strip the leading "://" and keep the rest as a path.
    if (raw.startsWith('://')) {
      return 'http://0.0.0.0/' + raw.slice(3).replace(/^\/+/, '');
    }
    // ":/path" or ":/?query" — colon followed by "/" means no port, just a
    // path separator. Strip the lone colon.
    if (raw.startsWith(':/')) {
      return 'http://0.0.0.0' + raw.slice(1);
    }
    // ":8080/path" — colon followed by digits = port number. Keep it.
    return 'http://0.0.0.0' + raw;
  }

  // No scheme at all — prepend "http://".
  return 'http://' + raw;
}
