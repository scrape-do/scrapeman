import {
  Agent,
  ProxyAgent,
  interceptors,
  request as undiciRequest,
  errors as undiciErrors,
  type Dispatcher,
} from 'undici';
import type {
  BodyConfig,
  ExecutedResponse,
  ScrapemanRequest,
} from '@scrapeman/shared-types';
import type { RequestExecutor } from '../executor.js';
import { ExecutorError } from '../errors.js';
import { buildAutoHeaders, mergeHeaders } from '../auto-headers.js';

const DEFAULT_MAX_REDIRECTS = 10;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
// Local-only client — generous cap so even large JSON dumps land in full.
// Caller can override with a stricter limit if needed.
const DEFAULT_MAX_RESPONSE_BYTES = 200 * 1024 * 1024; // 200 MB

export interface UndiciExecutorOptions {
  maxResponseBytes?: number;
  autoHeaderEnv?: { version: string; platform: string };
}

export class UndiciExecutor implements RequestExecutor {
  private readonly maxResponseBytes: number;
  private readonly autoHeaderEnv: { version: string; platform: string };

  constructor(options: UndiciExecutorOptions = {}) {
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
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

      const result = await undiciRequest(url, {
        method: request.method as never,
        headers,
        signal,
        dispatcher,
        ...(body !== undefined ? { body } : {}),
      });
      const headersReceivedNs = process.hrtime.bigint();

      const { bytes, truncated } = await readBodyCapped(
        result.body,
        this.maxResponseBytes,
      );
      const downloadCompleteNs = process.hrtime.bigint();
      const ttfbMs = Number(headersReceivedNs - startedNs) / 1_000_000;
      const downloadMs = Number(downloadCompleteNs - headersReceivedNs) / 1_000_000;
      const totalMs = Number(downloadCompleteNs - startedNs) / 1_000_000;

      const headerPairs = flattenHeaders(result.headers);
      const contentType = pickHeader(headerPairs, 'content-type');

      return {
        status: result.statusCode,
        statusText: '',
        httpVersion: 'http/1.1',
        headers: headerPairs,
        bodyBase64: Buffer.from(bytes).toString('base64'),
        bodyTruncated: truncated,
        sizeBytes: bytes.byteLength,
        ...(contentType !== undefined ? { contentType } : {}),
        timings: {
          ttfbMs: round2(ttfbMs),
          downloadMs: round2(downloadMs),
          totalMs: round2(totalMs),
        },
        sentAt,
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
  if (!request.params || Object.keys(request.params).length === 0) {
    return request.url;
  }
  const url = new URL(request.url);
  for (const [key, value] of Object.entries(request.params)) {
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
