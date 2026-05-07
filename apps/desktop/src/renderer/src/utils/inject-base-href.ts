/**
 * Insert a `<base href="...">` tag into the given HTML so a sandboxed
 * preview iframe can resolve relative URLs against the originating
 * server. Skipped when the source already has its own `<base>` tag —
 * the upstream page's choice wins.
 *
 * Best-effort string surgery: prefer to inject inside `<head>`, fall
 * back to wrapping in a fresh `<head>` if no head is present (rare).
 * Doesn't try to be a full HTML parser — the page is going through
 * the browser's own parser anyway, so anything we miss the parser
 * forgives.
 */
export function injectBaseHref(html: string, url: string): string {
  if (!url) return html;
  // Source HTML already has <base>? Don't override it.
  if (/<base\b[^>]*>/i.test(html)) return html;
  const baseTag = `<base href="${url.replace(/"/g, '&quot;')}">`;
  // Inject right after <head ...> when present.
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen) {
    const at = headOpen.index! + headOpen[0].length;
    return html.slice(0, at) + baseTag + html.slice(at);
  }
  // No <head>: try right after <html>; otherwise prepend a synthetic head.
  const htmlOpen = html.match(/<html\b[^>]*>/i);
  if (htmlOpen) {
    const at = htmlOpen.index! + htmlOpen[0].length;
    return html.slice(0, at) + `<head>${baseTag}</head>` + html.slice(at);
  }
  return `<head>${baseTag}</head>${html}`;
}
