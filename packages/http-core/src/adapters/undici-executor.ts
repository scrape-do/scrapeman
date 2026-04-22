import {
  Agent,
  ProxyAgent,
  interceptors,
  request as undiciRequest,
  errors as undiciErrors,
  type Dispatcher,
} from 'undici';
import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
} from 'node:zlib';
import type {
  BodyConfig,
  ExecutedResponse,
  ScrapemanRequest,
} from '@scrapeman/shared-types';
import type { RequestExecutor } from '../executor.js';
import { ExecutorError } from '../errors.js';
import { buildAutoHeaders, mergeHeaders } from '../auto-headers.js';
import { readSseStream, type SseEvent } from '../sse-reader.js';
import { normalizeUrl } from '../url/normalize.js';

const DEFAULT_MAX_REDIRECTS = 10;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
// Local-only client — generous cap so even large JSON dumps land in full.
// Caller can override with a stricter limit if needed.
const DEFAULT_MAX_RESPONSE_BYTES = 200 * 1024 * 1024; // 200 MB
// T3W1: hard limit for bytes handed to the renderer as `bodyBase64`. Bodies
// larger than this are cut here (the UI only ever sees the first slice) but
// the full decoded bytes are retained in `fullBodyBytes` so main-process
// consumers (script sandbox, save-to-file) still have everything.
export const BODY_UI_LIMIT = 2 * 1024 * 1024; // 2 MB

export interface UndiciExecutorOptions {
  maxResponseBytes?: number;
  // Override the UI body cut-off. Primarily used by tests; production code
  // should leave this at the default.
  uiBodyLimit?: number;
  autoHeaderEnv?: { version: string; platform: string };
}

export class UndiciExecutor implements RequestExecutor {
  private readonly maxResponseBytes: number;
  private readonly uiBodyLimit: number;
  private readonly autoHeaderEnv: { version: string; platform: string };

  constructor(options: UndiciExecutorOptions = {}) {
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.uiBodyLimit = options.uiBodyLimit ?? BODY_UI_LIMIT;
    this.autoHeaderEnv = options.autoHeaderEnv ?? {
      version: '0.0.0',
      platform: `${process.platform} ${process.arch}`,
    };
  }

  async execute(
    request: ScrapemanRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExecutedResponse> {
    const url = buildUrl(request);
    const auto = buildAutoHeaders(request, this.autoHeaderEnv);
    const disabled = new Set(request.disabledAutoHeaders ?? []);
    const headers = mergeHeaders(auto, request.headers, disabled);
    const body = buildBody(request.body);
    const totalTimeout = request.options?.timeout?.total ?? DEFAULT_TOTAL_TIMEOUT_MS;
    const followRedirects = request.options?.redirect?.follow ?? true;
    const maxRedirects = request.options?.redirect?.maxCount ?? DEFAULT_MAX_REDIRECTS;
    const requestedHttpVersion = request.options?.httpVersion ?? 'auto';

    const timeoutController = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new Error('total timeout exceeded'));
    }, totalTimeout);
    const signal = mergeSignals(options.signal, timeoutController.signal);

    const sentAt = new Date().toISOString();
    const startedNs = process.hrtime.bigint();

    try {
      const baseDispatcher = buildBaseDispatcher(request, totalTimeout);
      const dispatcher = baseDispatcher.compose(
        interceptors.redirect({
          maxRedirections: followRedirects ? maxRedirects : 0,
        }),
      );

      // NOTE: undici.request has no `decompress: true` switch — we advertise
      // `Accept-Encoding` via buildAutoHeaders and then decode manually in
      // decodeBody() (see commit 1a024fb).
      const result = await undiciRequest(url, {
        method: request.method as never,
        headers,
        signal,
        dispatcher,
        ...(body !== undefined ? { body } : {}),
      });
      const headersReceivedNs = process.hrtime.bigint();

      const headerPairs = flattenHeaders(result.headers);
      const contentType = pickHeader(headerPairs, 'content-type');
      const isSse =
        contentType !== undefined &&
        contentType.toLowerCase().trimStart().startsWith('text/event-stream');

      let bytes: Uint8Array;
      let truncated = false;
      let sseEvents: SseEvent[] | undefined;

      if (isSse) {
        // SSE path: consume the body exactly once through the SSE reader.
        // The resulting event array is shared between UI and script sandbox.
        const sse = await readSseStream(result.body);
        sseEvents = sse.events;
        // Reconstruct a text body from rawLines so downstream consumers
        // (history, UI preview) still see the stream content.
        const text = sse.rawLines.join('\n');
        bytes = new TextEncoder().encode(text);
      } else {
        const read = await readBodyCapped(result.body, this.maxResponseBytes);
        truncated = read.truncated;
        const encoding = pickHeader(headerPairs, 'content-encoding');
        bytes = decodeBody(read.bytes, encoding);
      }

      const downloadCompleteNs = process.hrtime.bigint();
      const ttfbMs = Number(headersReceivedNs - startedNs) / 1_000_000;
      const downloadMs = Number(downloadCompleteNs - headersReceivedNs) / 1_000_000;
      const totalMs = Number(downloadCompleteNs - startedNs) / 1_000_000;

      // T3W1: apply the UI body cap *after* decode so the renderer sees
      // decoded bytes (HTML/JSON) and not a random gzip slice. The full
      // decoded buffer is attached as `fullBodyBytes` so main-process
      // consumers (script sandbox, save-to-file) can still read it all.
      let uiBytes = bytes;
      let uiTruncated = truncated;
      if (bytes.byteLength > this.uiBodyLimit) {
        uiBytes = bytes.subarray(0, this.uiBodyLimit);
        uiTruncated = true;
      }

      return {
        status: result.statusCode,
        statusText: '',
        httpVersion: requestedHttpVersion === 'http2' ? 'h2' : 'http/1.1',
        headers: headerPairs,
        bodyBase64: Buffer.from(uiBytes).toString('base64'),
        bodyTruncated: uiTruncated,
        sizeBytes: bytes.byteLength,
        fullBodyBytes: bytes,
        ...(contentType !== undefined ? { contentType } : {}),
        timings: {
          ttfbMs: round2(ttfbMs),
          downloadMs: round2(downloadMs),
          totalMs: round2(totalMs),
        },
        sentAt,
        ...(sseEvents !== undefined ? { sseEvents } : {}),
      };
    } catch (err) {
      if (timedOut) {
        throw new ExecutorError('timeout', 'Total timeout exceeded', err);
      }
      throw toExecutorError(err);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function buildUrl(request: ScrapemanRequest): string {
  // Normalize first so that scheme-less / port-only inputs are valid for `new URL()`.
  const normalized = normalizeUrl(request.url);
  if (!request.params || Object.keys(request.params).length === 0) {
    return normalized;
  }
  const disabled = new Set(request.disabledParams ?? []);
  const url = new URL(normalized);
  const inUrlKeys = new Set(url.searchParams.keys());
  for (const [key, value] of Object.entries(request.params)) {
    if (disabled.has(key)) continue;
    // Skip keys already present in the URL query string — this avoids
    // duplicating enabled params that the UI also surfaces in the URL bar,
    // which previously broke {{var}} resolution.
    if (inUrlKeys.has(key)) continue;
    url.searchParams.append(key, value);
  }
  return url.toString();
}

function buildBaseDispatcher(
  request: ScrapemanRequest,
  totalTimeout: number,
): Dispatcher {
  const bodyTimeout = request.options?.timeout?.read ?? totalTimeout;
  const headersTimeout = request.options?.timeout?.connect ?? totalTimeout;
  const httpVersion = request.options?.httpVersion ?? 'auto';
  const allowH2 = httpVersion === 'http2';

  if (request.proxy?.enabled && request.proxy.url.trim()) {
    const scheme = parseProxyScheme(request.proxy.url);
    if (scheme === 'http' || scheme === 'https') {
      const proxyOpts: ProxyAgent.Options = {
        uri: request.proxy.url,
        bodyTimeout,
        headersTimeout,
        ...(allowH2 ? { allowH2: true } : {}),
      };
      if (request.proxy.auth) {
        const token = Buffer.from(
          `${request.proxy.auth.username}:${request.proxy.auth.password}`,
          'utf8',
        ).toString('base64');
        proxyOpts.token = `Basic ${token}`;
      }
      return new ProxyAgent(proxyOpts);
    }
    // SOCKS proxies require a separate adapter — not bundled in v1.
    throw new ExecutorError(
      'invalid-request',
      `proxy scheme '${scheme}' is not supported yet (only http/https)`,
    );
  }

  return new Agent({
    bodyTimeout,
    headersTimeout,
    ...(allowH2 ? { allowH2: true } : {}),
  });
}

function parseProxyScheme(url: string): string {
  const match = /^(\w+):\/\//.exec(url);
  return match?.[1]?.toLowerCase() ?? 'http';
}

function buildBody(body: BodyConfig | undefined): string | Uint8Array | undefined {
  if (!body || body.type === 'none') return undefined;
  if (
    body.type === 'json' ||
    body.type === 'xml' ||
    body.type === 'text' ||
    body.type === 'html' ||
    body.type === 'javascript'
  ) {
    return body.content ?? undefined;
  }
  if (body.type === 'formUrlEncoded') {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body.fields)) {
      params.append(key, value);
    }
    return params.toString();
  }
  // multipart and binary are handled in later milestones (M2+).
  return undefined;
}

async function readBodyCapped(
  stream: AsyncIterable<Buffer | Uint8Array>,
  cap: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of stream) {
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (total + view.byteLength > cap) {
      const remaining = cap - total;
      if (remaining > 0) chunks.push(view.subarray(0, remaining));
      total = cap;
      truncated = true;
      break;
    }
    chunks.push(view);
    total += view.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: out, truncated };
}

function flattenHeaders(
  raw: Record<string, string | string[] | undefined>,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) pairs.push([key, v]);
    } else {
      pairs.push([key, value]);
    }
  }
  return pairs;
}

function pickHeader(
  headers: Array<[string, string]>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of headers) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function decodeBody(bytes: Uint8Array, encoding: string | undefined): Uint8Array {
  if (!encoding || bytes.byteLength === 0) return bytes;
  // Content-Encoding can chain multiple codings comma-separated; apply in
  // reverse order per RFC 7231 §3.1.2.2.
  const codings = encoding
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .reverse();
  let buf = Buffer.from(bytes);
  for (const coding of codings) {
    try {
      if (coding === 'gzip' || coding === 'x-gzip') {
        buf = gunzipSync(buf);
      } else if (coding === 'br') {
        buf = brotliDecompressSync(buf);
      } else if (coding === 'deflate') {
        // Some servers send raw deflate without zlib wrapper.
        try {
          buf = inflateSync(buf);
        } catch {
          buf = inflateRawSync(buf);
        }
      } else if (coding === 'identity') {
        // no-op
      } else {
        // Unknown coding — leave as-is so caller still sees something.
        return buf;
      }
    } catch {
      // Decompression failed — return whatever we had before this step.
      return buf;
    }
  }
  return buf;
}

function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const controller = new AbortController();
  const onAbort = (signal: AbortSignal) => () => controller.abort(signal.reason);
  if (a.aborted) controller.abort(a.reason);
  else a.addEventListener('abort', onAbort(a), { once: true });
  if (b.aborted) controller.abort(b.reason);
  else b.addEventListener('abort', onAbort(b), { once: true });
  return controller.signal;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toExecutorError(err: unknown): ExecutorError {
  if (err instanceof ExecutorError) return err;
  if (err instanceof undiciErrors.HeadersTimeoutError) {
    return new ExecutorError('timeout', 'Headers timeout', err);
  }
  if (err instanceof undiciErrors.BodyTimeoutError) {
    return new ExecutorError('timeout', 'Body timeout', err);
  }
  if (err instanceof undiciErrors.ConnectTimeoutError) {
    return new ExecutorError('timeout', 'Connect timeout', err);
  }
  if (err instanceof undiciErrors.RequestAbortedError) {
    return new ExecutorError('aborted', 'Request aborted', err);
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new ExecutorError('aborted', err.message, err);
  }
  if (err instanceof Error) {
    const message = err.message;
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET/.test(message)) {
      return new ExecutorError('network', message, err);
    }
    if (/CERT|TLS|SSL/i.test(message)) {
      return new ExecutorError('tls', message, err);
    }
    return new ExecutorError('unknown', message, err);
  }
  return new ExecutorError('unknown', String(err));
}
