import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { tokenize } from './tokenize.js';

export class CurlParseError extends Error {
  constructor(message: string) {
    super(`Invalid curl command: ${message}`);
    this.name = 'CurlParseError';
  }
}

export function parseCurlCommand(input: string): ScrapemanRequest {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) {
    throw new CurlParseError('empty input');
  }

  let start = 0;
  if (tokens[0] === 'curl') start = 1;
  else if (tokens[0]?.endsWith('/curl') || tokens[0] === 'curl.exe') start = 1;

  const headers: Record<string, string> = {};
  let method: string | null = null;
  let url: string | null = null;
  let body: string | null = null;
  let bodyType: 'raw' | 'formUrlEncoded' | null = null;
  let basicUser: string | null = null;
  let followRedirects = false;
  let ignoreInvalidCerts = false;

  const formFields: Record<string, string> = {};
  const dataParts: string[] = [];
  let proxyUrl: string | null = null;
  let proxyUser: string | null = null;

  const advance = (i: number, flag: string): { value: string; next: number } => {
    const next = tokens[i + 1];
    if (next === undefined) {
      throw new CurlParseError(`flag ${flag} requires a value`);
    }
    return { value: next, next: i + 2 };
  };

  for (let i = start; i < tokens.length; ) {
    const token = tokens[i]!;

    // --flag=value form
    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      const flag = token.slice(0, eq);
      const value = token.slice(eq + 1);
      i = handleFlag(flag, value, i + 1);
      continue;
    }

    if (token === '-X' || token === '--request') {
      const { value, next } = advance(i, token);
      method = value.toUpperCase();
      i = next;
      continue;
    }

    if (token === '-H' || token === '--header') {
      const { value, next } = advance(i, token);
      applyHeader(value);
      i = next;
      continue;
    }

    if (token === '-A' || token === '--user-agent') {
      const { value, next } = advance(i, token);
      headers['User-Agent'] = value;
      i = next;
      continue;
    }

    if (token === '-e' || token === '--referer') {
      const { value, next } = advance(i, token);
      headers['Referer'] = value;
      i = next;
      continue;
    }

    if (token === '-b' || token === '--cookie') {
      const { value, next } = advance(i, token);
      headers['Cookie'] = value;
      i = next;
      continue;
    }

    if (token === '-u' || token === '--user') {
      const { value, next } = advance(i, token);
      basicUser = value;
      i = next;
      continue;
    }

    if (
      token === '-d' ||
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-ascii' ||
      token === '--data-binary'
    ) {
      const { value, next } = advance(i, token);
      dataParts.push(value);
      bodyType = bodyType ?? 'raw';
      i = next;
      continue;
    }

    if (token === '--data-urlencode') {
      const { value, next } = advance(i, token);
      dataParts.push(value);
      bodyType = 'formUrlEncoded';
      i = next;
      continue;
    }

    if (token === '-F' || token === '--form') {
      const { value, next } = advance(i, token);
      const eq = value.indexOf('=');
      if (eq > 0) {
        formFields[value.slice(0, eq)] = value.slice(eq + 1);
      }
      i = next;
      continue;
    }

    if (token === '--url') {
      const { value, next } = advance(i, token);
      url = value;
      i = next;
      continue;
    }

    if (token === '-L' || token === '--location') {
      followRedirects = true;
      i++;
      continue;
    }

    if (token === '-k' || token === '--insecure') {
      ignoreInvalidCerts = true;
      i++;
      continue;
    }

    if (token === '-x' || token === '--proxy') {
      const { value, next } = advance(i, token);
      proxyUrl = value;
      i = next;
      continue;
    }

    if (token === '-U' || token === '--proxy-user') {
      const { value, next } = advance(i, token);
      proxyUser = value;
      i = next;
      continue;
    }

    // Flags with a value we discard
    if (
      token === '-o' ||
      token === '--output' ||
      token === '--max-time' ||
      token === '--connect-timeout' ||
      token === '-w' ||
      token === '--write-out' ||
      token === '--resolve' ||
      token === '--cacert' ||
      token === '--cert' ||
      token === '--key'
    ) {
      i += 2;
      continue;
    }

    // Boolean flags we silently ignore
    if (
      token === '-s' ||
      token === '--silent' ||
      token === '-S' ||
      token === '--show-error' ||
      token === '-v' ||
      token === '--verbose' ||
      token === '-i' ||
      token === '--include' ||
      token === '-I' ||
      token === '--head' ||
      token === '--compressed' ||
      token === '-g' ||
      token === '--globoff' ||
      token === '-f' ||
      token === '--fail' ||
      token === '--http1.1' ||
      token === '--http2'
    ) {
      i++;
      continue;
    }

    if (token.startsWith('-') && token !== '-') {
      // Unknown flag — skip it to be forgiving.
      i++;
      continue;
    }

    // Bare argument = URL (first one wins, rest ignored).
    if (url === null) {
      url = token;
    }
    i++;
  }

  function handleFlag(flag: string, value: string, next: number): number {
    switch (flag) {
      case '--request':
        method = value.toUpperCase();
        return next;
      case '--header':
        applyHeader(value);
        return next;
      case '--user-agent':
        headers['User-Agent'] = value;
        return next;
      case '--referer':
        headers['Referer'] = value;
        return next;
      case '--cookie':
        headers['Cookie'] = value;
        return next;
      case '--user':
        basicUser = value;
        return next;
      case '--data':
      case '--data-raw':
      case '--data-ascii':
      case '--data-binary':
        dataParts.push(value);
        bodyType = bodyType ?? 'raw';
        return next;
      case '--data-urlencode':
        dataParts.push(value);
        bodyType = 'formUrlEncoded';
        return next;
      case '--form':
        {
          const eq = value.indexOf('=');
          if (eq > 0) formFields[value.slice(0, eq)] = value.slice(eq + 1);
        }
        return next;
      case '--url':
        url = value;
        return next;
      case '--proxy':
        proxyUrl = value;
        return next;
      case '--proxy-user':
        proxyUser = value;
        return next;
      default:
        return next;
    }
  }

  function applyHeader(raw: string): void {
    const idx = raw.indexOf(':');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }

  if (!url) {
    throw new CurlParseError('no URL found');
  }

  if (!method) {
    method =
      dataParts.length > 0 || Object.keys(formFields).length > 0 ? 'POST' : 'GET';
  }

  if (dataParts.length > 0) {
    body = dataParts.join('&');
  }

  const request: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name: deriveName(url) },
    method,
    url,
  };

  if (Object.keys(headers).length > 0) request.headers = headers;

  if (basicUser !== null) {
    const colon = basicUser.indexOf(':');
    if (colon >= 0) {
      request.auth = {
        type: 'basic',
        username: basicUser.slice(0, colon),
        password: basicUser.slice(colon + 1),
      };
    } else {
      request.auth = { type: 'basic', username: basicUser, password: '' };
    }
  }

  if (body !== null) {
    const bodyKind = detectBodyType(body, headers);
    request.body = { type: bodyKind, content: body };
  } else if (Object.keys(formFields).length > 0) {
    request.body = { type: 'multipart', parts: [] };
    for (const [name, value] of Object.entries(formFields)) {
      if (value.startsWith('@')) {
        request.body.parts.push({
          name,
          type: 'file',
          file: value.slice(1),
        });
      } else {
        request.body.parts.push({ name, type: 'text', value });
      }
    }
  }

  if (followRedirects || ignoreInvalidCerts) {
    request.options = {
      ...(followRedirects ? { redirect: { follow: true, maxCount: 10 } } : {}),
      ...(ignoreInvalidCerts ? { tls: { ignoreInvalidCerts: true } } : {}),
    };
  }

  if (proxyUrl) {
    request.proxy = {
      enabled: true,
      url: proxyUrl,
      ...(proxyUser
        ? (() => {
            const colon = proxyUser.indexOf(':');
            if (colon >= 0) {
              return {
                auth: {
                  username: proxyUser.slice(0, colon),
                  password: proxyUser.slice(colon + 1),
                },
              };
            }
            return { auth: { username: proxyUser, password: '' } };
          })()
        : {}),
    };
  }

  return request;
}

function detectBodyType(
  body: string,
  headers: Record<string, string>,
): 'json' | 'text' {
  const ct =
    headers['Content-Type'] ??
    headers['content-type'] ??
    headers['Content-type'] ??
    '';
  if (/json/i.test(ct)) return 'json';
  const trimmed = body.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* fall through */
    }
  }
  return 'text';
}

function deriveName(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    const last = path.split('/').filter(Boolean).pop();
    if (last) return `${parsed.host} — ${last}`;
    return parsed.host;
  } catch {
    return 'Imported request';
  }
}
