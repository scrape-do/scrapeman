import {
  FORMAT_VERSION,
  type BodyConfig,
  type HistoryEntry,
  type ImportResult,
  type KeyValue,
  type ScrapemanRequest,
} from '@scrapeman/shared-types';

// ---- HAR 1.2 types (only what we need) ----

interface HarNameValue {
  name: string;
  value: string;
}

interface HarPostData {
  mimeType: string;
  text?: string;
  params?: HarNameValue[];
}

interface HarRequest {
  method: string;
  url: string;
  headers: HarNameValue[];
  queryString?: HarNameValue[];
  postData?: HarPostData;
}

interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
}

interface HarResponse {
  status: number;
  statusText: string;
  headers: HarNameValue[];
  content: HarContent;
}

interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request: HarRequest;
  response?: HarResponse;
}

interface HarLog {
  version: string;
  entries: HarEntry[];
}

interface HarRoot {
  log: HarLog;
}

// ---- Import ----

export interface HarImportError {
  ok: false;
  message: string;
}

/**
 * Parse a HAR 1.2 JSON string and convert each entry to a ScrapemanRequest.
 * Response data in the HAR is ignored (Scrapeman requests have no response).
 */
export function importHar(json: string): ImportResult | HarImportError {
  let root: HarRoot;
  try {
    root = JSON.parse(json) as HarRoot;
  } catch {
    return { ok: false, message: 'Invalid JSON' };
  }

  if (!root?.log?.entries || !Array.isArray(root.log.entries)) {
    return { ok: false, message: 'Missing log.entries array' };
  }

  const warnings: string[] = [];
  const requests: ScrapemanRequest[] = [];

  for (let i = 0; i < root.log.entries.length; i++) {
    const entry = root.log.entries[i]!;
    if (!entry.request?.url) {
      warnings.push(`Entry ${i}: missing request.url, skipped`);
      continue;
    }

    const harReq = entry.request;

    const headers: KeyValue = {};
    for (const h of harReq.headers ?? []) {
      // Skip pseudo-headers (HTTP/2 :authority etc.)
      if (h.name.startsWith(':')) continue;
      headers[h.name] = h.value;
    }

    const body = mapPostData(harReq.postData);

    const request: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: deriveName(harReq.url) },
      method: harReq.method.toUpperCase(),
      url: harReq.url,
    };

    if (Object.keys(headers).length > 0) request.headers = headers;
    if (body) request.body = body;

    requests.push(request);
  }

  return { requests, folders: [], environments: [], warnings };
}

// ---- Export ----

/**
 * Convert Scrapeman HistoryEntry objects to a HAR 1.2 JSON string.
 */
export function exportHar(entries: HistoryEntry[]): string {
  const harEntries: HarEntry[] = entries.map((e) => {
    const reqHeaders: HarNameValue[] = Object.entries(e.headers).map(
      ([name, value]) => ({ name, value }),
    );

    const harReq: HarRequest = {
      method: e.method,
      url: e.url,
      headers: reqHeaders,
      queryString: extractQueryString(e.url),
    };

    if (e.bodyPreview) {
      harReq.postData = {
        mimeType: guessRequestMimeType(e.headers),
        text: e.bodyPreview,
      };
    }

    const respHeaders: HarNameValue[] = (e.responseHeaders ?? []).map(
      ([name, value]) => ({ name, value }),
    );

    const respContentType =
      e.responseHeaders?.find(
        ([n]) => n.toLowerCase() === 'content-type',
      )?.[1] ?? 'application/octet-stream';

    const harResp: HarResponse = {
      status: e.status,
      statusText: statusTextFromCode(e.status),
      headers: respHeaders,
      content: {
        size: e.responseSizeBytes,
        mimeType: respContentType,
        ...(e.responseBodyPreview ? { text: e.responseBodyPreview } : {}),
      },
    };

    return {
      startedDateTime: e.sentAt,
      time: e.durationMs,
      request: harReq,
      response: harResp,
    };
  });

  const har: HarRoot = {
    log: {
      version: '1.2',
      entries: harEntries,
    },
  };

  return JSON.stringify(har, null, 2);
}

// ---- Helpers ----

function mapPostData(pd: HarPostData | undefined): BodyConfig | undefined {
  if (!pd?.text && !pd?.params?.length) return undefined;

  const mime = (pd.mimeType ?? '').toLowerCase();

  if (mime.includes('json')) {
    return { type: 'json', content: pd.text ?? '' };
  }
  if (mime.includes('xml')) {
    return { type: 'xml', content: pd.text ?? '' };
  }
  if (mime.includes('x-www-form-urlencoded')) {
    const fields: KeyValue = {};
    if (pd.params?.length) {
      for (const p of pd.params) fields[p.name] = p.value;
    } else if (pd.text) {
      for (const pair of pd.text.split('&')) {
        const eq = pair.indexOf('=');
        if (eq > 0) {
          fields[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(
            pair.slice(eq + 1),
          );
        }
      }
    }
    return { type: 'formUrlEncoded', fields };
  }
  if (mime.includes('html')) {
    return { type: 'html', content: pd.text ?? '' };
  }

  return { type: 'text', content: pd.text ?? '' };
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

function extractQueryString(url: string): HarNameValue[] {
  try {
    const parsed = new URL(url);
    const result: HarNameValue[] = [];
    parsed.searchParams.forEach((value, name) => {
      result.push({ name, value });
    });
    return result;
  } catch {
    return [];
  }
}

function guessRequestMimeType(headers: KeyValue): string {
  const ct =
    headers['Content-Type'] ??
    headers['content-type'] ??
    headers['Content-type'];
  return ct ?? 'application/octet-stream';
}

function statusTextFromCode(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return map[code] ?? '';
}
