import type { CookieEntry } from '@scrapeman/shared-types';

// ---------------------------------------------------------------------------
// Netscape cookies.txt format
//   domain  flag  path  secure  expires(unix)  name  value
// tab-separated; lines starting with # are comments.
// ---------------------------------------------------------------------------

/**
 * Serialize a list of cookies to Netscape cookies.txt format.
 * Used by the cookie panel "Export Netscape" button.
 */
export function exportNetscape(cookies: CookieEntry[]): string {
  const lines: string[] = [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/docs/http-cookies.html',
    '# Exported by Scrapeman',
    '',
  ];
  for (const c of cookies) {
    const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
    const flag = 'TRUE'; // domain flag — whether the domain is a suffix match
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    // expiry: seconds since epoch; 0 means session
    const expires =
      c.expires && c.expires !== 'Session'
        ? String(Math.floor(new Date(c.expires).getTime() / 1000))
        : '0';
    lines.push(
      [domain, flag, path, secure, expires, c.name, c.value].join('\t'),
    );
  }
  return lines.join('\n');
}

/**
 * Parse a Netscape cookies.txt body into CookieEntry list.
 * Returns an empty array on empty input.
 */
export function parseNetscape(text: string): CookieEntry[] {
  const result: CookieEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [domainRaw, , path, secureStr, expiresStr, name, value] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    // Normalise the domain: strip the leading dot used by the format spec.
    const domain = domainRaw.startsWith('.')
      ? domainRaw.slice(1)
      : domainRaw;
    const secure = secureStr === 'TRUE';
    const expiresUnix = parseInt(expiresStr, 10);
    const expires =
      expiresUnix > 0
        ? new Date(expiresUnix * 1000).toISOString()
        : null;
    result.push({
      domain,
      path: path || '/',
      name,
      value: value ?? '',
      expires,
      httpOnly: false,
      secure,
      sameSite: null,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// document.cookie format
//   name1=val1; name2=val2
// ---------------------------------------------------------------------------

/**
 * Parse `document.cookie` output into CookieEntry list.
 * Caller supplies the domain these cookies belong to.
 */
export function parseDocumentCookie(
  text: string,
  domain: string,
): CookieEntry[] {
  const result: CookieEntry[] = [];
  for (const pair of text.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!name) continue;
    result.push({
      domain,
      path: '/',
      name,
      value,
      expires: null,
      httpOnly: false,
      secure: false,
      sameSite: null,
    });
  }
  return result;
}
