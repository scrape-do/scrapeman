import { parse as upstreamParse, type CurlCommand } from '@scrape-do/curl-parser';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { tokenize } from './tokenize.js';

export class CurlParseError extends Error {
  constructor(message: string) {
    super(`Invalid curl command: ${message}`);
    this.name = 'CurlParseError';
  }
}

interface ExtractedExtras {
  proxyUrl: string | null;
  proxyUser: string | null;
  refererHeader: string | null;
  // -d / --data / --data-raw / --data-ascii / --data-binary / --data-urlencode
  // values, in order. Joined with `&` to mirror curl's behaviour for repeated
  // flags.
  dataParts: string[];
  // -F / --form fields. Captured here so values containing quotes/backslashes
  // round-trip cleanly through our own tokenizer instead of upstream's.
  formFields: Array<{ key: string; value: string }>;
  // -H / --header values. Captured for the same reason: header values can
  // legitimately contain `"`, `\`, `$`, `` ` `` (e.g. JWTs are fine, but
  // GraphQL bodies copied as headers, signed signatures, etc. break upstream).
  headers: Array<{ key: string; value: string }>;
}

// Double-quote a token for re-stringification before upstream parses it.
// Single quotes would be cleaner, but @scrape-do/curl-parser strips
// backslashes inside single quotes (it should preserve them per bash rules);
// double quotes round-trip correctly when we escape \ " $ `.
function shellEscape(value: string): string {
  return `"${value.replace(/[\\"$`]/g, (c) => '\\' + c)}"`;
}

// Long flags upstream knows AND takes a value (so we pass them through but
// know to skip the next token if we strip them).
const UPSTREAM_VALUE_LONG_FLAGS = new Set([
  '--request',
  '--user-agent',
  '--cookie',
  '--user',
  '--url',
]);

// Long flags curl knows but upstream does not. Drop them along with their
// value so the value isn't mis-parsed as the URL.
const UNSUPPORTED_VALUE_LONG_FLAGS = new Set([
  '--max-time',
  '--connect-timeout',
  '--write-out',
  '--output',
  '--resolve',
  '--cacert',
  '--cert',
  '--key',
  '--key-type',
  '--cert-type',
  '--ciphers',
  '--limit-rate',
  '--engine',
  '--retry',
  '--retry-delay',
  '--retry-max-time',
  '--connect-to',
  '--interface',
  '--dns-servers',
  '--range',
]);

// Short flags upstream knows AND takes a value.
const UPSTREAM_VALUE_SHORT_FLAGS = new Set([
  '-X',
  '-A',
  '-b',
  '-u',
]);

// Short flags curl knows but upstream does not. Drop with their value.
const UNSUPPORTED_VALUE_SHORT_FLAGS = new Set([
  '-o',
  '-w',
  '-T',
  '-r',
  '-Y',
  '-y',
  '-z',
]);

// Flags upstream rejects with "Unrecognized argument" / "Unrecognized
// option" but that we want to silently ignore (curl-isms that don't affect
// the request shape).
const UNSUPPORTED_BOOL_FLAGS = new Set([
  '-v',
  '--verbose',
  '-i',
  '--include',
  '-#',
  '--progress-bar',
  '--http1.1',
  '--http1.0',
  '--http2',
  '--http2-prior-knowledge',
  '--no-buffer',
  '--no-keepalive',
  '--no-progress-meter',
  '--tlsv1',
  '--tlsv1.0',
  '--tlsv1.1',
  '--tlsv1.2',
  '--tlsv1.3',
  '--ipv4',
  '--ipv6',
  '-4',
  '-6',
  '-N',
  '-O',
  '--remote-name',
  '--remote-header-name',
  '-J',
]);

// Walk the tokens and pull out the flags @scrape-do/curl-parser does not
// support: -x/--proxy, -U/--proxy-user, -e/--referer, and the --flag=value
// form (upstream only accepts --flag value). The remaining tokens are
// re-stringified into a clean curl command that upstream can parse.
function preprocess(input: string): {
  cleanedInput: string;
  extras: ExtractedExtras;
} {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) {
    throw new CurlParseError('empty input');
  }

  const remaining: string[] = ['curl'];
  // Skip the leading curl/curl.exe/path-to-curl token if present.
  let i = 0;
  if (
    tokens[0] === 'curl' ||
    tokens[0]?.endsWith('/curl') ||
    tokens[0] === 'curl.exe'
  ) {
    i = 1;
  }

  const extras: ExtractedExtras = {
    proxyUrl: null,
    proxyUser: null,
    refererHeader: null,
    dataParts: [],
    formFields: [],
    headers: [],
  };

  const captureHeader = (raw: string): void => {
    const idx = raw.indexOf(':');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) extras.headers.push({ key, value });
  };

  const captureForm = (raw: string): void => {
    const eq = raw.indexOf('=');
    if (eq <= 0) return;
    extras.formFields.push({
      key: raw.slice(0, eq),
      value: raw.slice(eq + 1),
    });
  };

  while (i < tokens.length) {
    const tok = tokens[i]!;

    // --flag=value form. Upstream rejects this. Split into two tokens, or
    // capture into extras if it's a flag we own.
    if (tok.startsWith('--') && tok.includes('=')) {
      const eq = tok.indexOf('=');
      const flag = tok.slice(0, eq);
      const value = tok.slice(eq + 1);

      if (flag === '--proxy') {
        extras.proxyUrl = value;
        i++;
        continue;
      }
      if (flag === '--proxy-user') {
        extras.proxyUser = value;
        i++;
        continue;
      }
      if (flag === '--referer') {
        extras.refererHeader = value;
        i++;
        continue;
      }
      if (flag === '--header') {
        captureHeader(value);
        i++;
        continue;
      }
      if (
        flag === '--data' ||
        flag === '--data-raw' ||
        flag === '--data-ascii' ||
        flag === '--data-binary'
      ) {
        extras.dataParts.push(value);
        i++;
        continue;
      }
      if (flag === '--data-urlencode') {
        extras.dataParts.push(value);
        i++;
        continue;
      }
      if (flag === '--form') {
        captureForm(value);
        i++;
        continue;
      }
      remaining.push(flag, value);
      i++;
      continue;
    }

    if (tok === '-x' || tok === '--proxy') {
      const value = tokens[i + 1];
      if (value === undefined) {
        throw new CurlParseError(`flag ${tok} requires a value`);
      }
      extras.proxyUrl = value;
      i += 2;
      continue;
    }

    if (tok === '-U' || tok === '--proxy-user') {
      const value = tokens[i + 1];
      if (value === undefined) {
        throw new CurlParseError(`flag ${tok} requires a value`);
      }
      extras.proxyUser = value;
      i += 2;
      continue;
    }

    if (tok === '-e' || tok === '--referer') {
      const value = tokens[i + 1];
      if (value === undefined) {
        throw new CurlParseError(`flag ${tok} requires a value`);
      }
      extras.refererHeader = value;
      i += 2;
      continue;
    }

    if (tok === '-H' || tok === '--header') {
      const value = tokens[i + 1];
      if (value === undefined) {
        throw new CurlParseError(`flag ${tok} requires a value`);
      }
      captureHeader(value);
      i += 2;
      continue;
    }

    if (
      tok === '-d' ||
      tok === '--data' ||
      tok === '--data-raw' ||
      tok === '--data-ascii' ||
      tok === '--data-binary'
    ) {
      const value = tokens[i + 1];
      if (value === undefined) {
        throw new CurlParseError(`flag ${tok} requires a value`);
      }
      extras.dataParts.push(value);
      i += 2;
      continue;
    }

    if (tok === '--data-urlencode') {
      const value = tokens[i + 1];
      if (value === undefined) {
        throw new CurlParseError(`flag ${tok} requires a value`);
      }
      extras.dataParts.push(value);
      i += 2;
      continue;
    }

    if (tok === '-F' || tok === '--form') {
      const value = tokens[i + 1];
      if (value === undefined) {
        throw new CurlParseError(`flag ${tok} requires a value`);
      }
      captureForm(value);
      i += 2;
      continue;
    }

    // Strip flags upstream doesn't know but curl accepts. Boolean flags get
    // dropped solo; value-taking flags drop the next token too.
    if (UNSUPPORTED_BOOL_FLAGS.has(tok)) {
      i++;
      continue;
    }
    if (
      UNSUPPORTED_VALUE_LONG_FLAGS.has(tok) ||
      UNSUPPORTED_VALUE_SHORT_FLAGS.has(tok)
    ) {
      i += 2;
      continue;
    }
    if (
      tok.startsWith('-') &&
      tok !== '-' &&
      !isKnownFlag(tok)
    ) {
      // Unknown flag — skip it and, if the next token is its value (does
      // not start with `-`), skip that too. Heuristic; matches curl's
      // most common shapes and our previous parser's leniency.
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    remaining.push(tok);
    i++;
  }

  const cleanedInput = remaining
    .map((t, idx) => (idx === 0 ? t : shellEscape(t)))
    .join(' ');
  return { cleanedInput, extras };
}

// Allowlist of long flags upstream + our extras understand, used to detect
// unknown flags that should be silently dropped (curl's leniency).
const KNOWN_LONG_FLAGS = new Set<string>([
  ...UPSTREAM_VALUE_LONG_FLAGS,
  // Value-taking long flags we extract ourselves before calling upstream.
  '--header',
  '--data',
  '--data-raw',
  '--data-ascii',
  '--data-binary',
  '--data-urlencode',
  '--form',
  '--anyauth',
  '--basic',
  '--compressed',
  '--no-compressed',
  '--crlf',
  '--no-crlf',
  '--compressed-ssh',
  '--no-compressed-ssh',
  '--fail',
  '--no-fail',
  '--get',
  '--no-get',
  '--globoff',
  '--no-globoff',
  '--head',
  '--no-head',
  '--insecure',
  '--no-insecure',
  '--digest',
  '--no-digest',
  '--ntlm',
  '--location',
  '--no-location',
  '--show-error',
  '--no-show-error',
  '--silent',
  '--no-silent',
  '--proxy',
  '--proxy-user',
  '--referer',
]);

const KNOWN_SHORT_BOOL_FLAGS = new Set([
  '-L',
  '-k',
  '-s',
  '-S',
  '-f',
  '-g',
  '-I',
  '-G',
  '-e',
  '-x',
  '-U',
]);

function isKnownFlag(tok: string): boolean {
  if (UPSTREAM_VALUE_SHORT_FLAGS.has(tok)) return true;
  if (tok === '-H' || tok === '-d' || tok === '-F') return true;
  if (KNOWN_SHORT_BOOL_FLAGS.has(tok)) return true;
  if (KNOWN_LONG_FLAGS.has(tok)) return true;
  return false;
}

export function parseCurlCommand(input: string): ScrapemanRequest {
  const { cleanedInput, extras } = preprocess(input);

  let cmd: CurlCommand;
  try {
    cmd = upstreamParse(cleanedInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CurlParseError(message);
  }

  if (!cmd.url) {
    throw new CurlParseError('no URL found');
  }

  // Headers and bodies come from our preprocessor (we extract them so values
  // containing `\` or `"` survive — upstream's tokenizer mishandles both).
  // Upstream still sees the URL, method, basic auth, cookies, user-agent,
  // and boolean flags.
  const headers: Record<string, string> = {};
  for (const { key, value } of extras.headers) {
    headers[key] = value;
  }
  if (cmd.userAgent !== undefined) headers['User-Agent'] = cmd.userAgent;
  if (cmd.cookies !== null && cmd.cookies !== undefined) {
    headers['Cookie'] = cmd.cookies;
  }
  if (extras.refererHeader !== null) headers['Referer'] = extras.refererHeader;

  // Default method to POST when a body/form was given without an explicit
  // -X (mirrors curl's own behaviour). Upstream returns lowercased.
  let method = cmd.method.toUpperCase();
  const hasBody = extras.dataParts.length > 0;
  const hasForm = extras.formFields.length > 0;
  if (method === 'GET' && (hasBody || hasForm)) {
    method = 'POST';
  }

  const request: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name: deriveName(cmd.url) },
    method,
    url: cmd.url,
  };

  if (Object.keys(headers).length > 0) request.headers = headers;

  if (cmd.user !== undefined) {
    const colon = cmd.user.indexOf(':');
    if (colon >= 0) {
      request.auth = {
        type: 'basic',
        username: cmd.user.slice(0, colon),
        password: cmd.user.slice(colon + 1),
      };
    } else {
      request.auth = { type: 'basic', username: cmd.user, password: '' };
    }
  }

  if (hasBody) {
    const body = extras.dataParts.join('&');
    const bodyKind = detectBodyType(body, headers);
    request.body = { type: bodyKind, content: body };
  } else if (hasForm) {
    request.body = { type: 'multipart', parts: [] };
    for (const { key, value } of extras.formFields) {
      if (value.startsWith('@')) {
        request.body.parts.push({ name: key, type: 'file', file: value.slice(1) });
      } else {
        request.body.parts.push({ name: key, type: 'text', value });
      }
    }
  }

  if (cmd.flags.location || cmd.flags.insecure) {
    request.options = {
      ...(cmd.flags.location ? { redirect: { follow: true, maxCount: 10 } } : {}),
      ...(cmd.flags.insecure ? { tls: { ignoreInvalidCerts: true } } : {}),
    };
  }

  if (extras.proxyUrl) {
    request.proxy = {
      enabled: true,
      url: extras.proxyUrl,
      ...(extras.proxyUser
        ? (() => {
            const user = extras.proxyUser as string;
            const colon = user.indexOf(':');
            if (colon >= 0) {
              return {
                auth: {
                  username: user.slice(0, colon),
                  password: user.slice(colon + 1),
                },
              };
            }
            return { auth: { username: user, password: '' } };
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
