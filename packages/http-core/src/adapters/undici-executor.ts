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
import diagnosticsChannel from 'node:diagnostics_channel';
import type { TLSSocket } from 'node:tls';
import type {
  BodyConfig,
  ExecutedResponse,
<<<<<<< HEAD
  RedirectHop,
  TlsCertInfo,
=======
  ScrapemanRequest,
  ScriptConsoleEntry,
  ScriptResult,
>>>>>>> 0541c7f (feat(scripts): pre-request and post-response script sandbox)
} from '@scrapeman/shared-types';
import type { ScrapemanRequest } from '@scrapeman/shared-types';
import type { RequestExecutor } from '../executor.js';
import { ExecutorError } from '../errors.js';
import { buildAutoHeaders, mergeHeaders } from '../auto-headers.js';
import { readSseStream, type SseEvent } from '../sse-reader.js';
import { normalizeUrl } from '../url/normalize.js';
<<<<<<< HEAD
import { detectAntiBot } from '../anti-bot.js';
=======
import { runScript } from '../scripts/sandbox.js';
import { buildReqProxy, buildResProxy, buildBruObject, type BruCallbacks, type MutableRequest } from '../scripts/bru-api.js';
>>>>>>> 0541c7f (feat(scripts): pre-request and post-response script sandbox)

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
  // Shared mutable counter for round-robin proxy rotation. Pass the same
  // object instance across requests in a single run so the index advances
  // correctly across concurrent slots.
  rotateCounter?: { value: number };
}

export class UndiciExecutor implements RequestExecutor {
  private readonly maxResponseBytes: number;
  private readonly uiBodyLimit: number;
  private readonly autoHeaderEnv: { version: string; platform: string };
  private readonly rotateCounter: { value: number };

  constructor(options: UndiciExecutorOptions = {}) {
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.uiBodyLimit = options.uiBodyLimit ?? BODY_UI_LIMIT;
    this.autoHeaderEnv = options.autoHeaderEnv ?? {
      version: '0.0.0',
      platform: `${process.platform} ${process.arch}`,
    };
    this.rotateCounter = options.rotateCounter ?? { value: 0 };
  }

  async execute(
    request: ScrapemanRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExecutedResponse> {
    // Resolve rotating proxy before anything else so buildBaseDispatcher sees
    // the selected URL in request.proxy.url.
    const requestWithProxy = resolveRotatingProxy(request, this.rotateCounter);

    const url = buildUrl(requestWithProxy);
    const auto = buildAutoHeaders(requestWithProxy, this.autoHeaderEnv);
    const disabled = new Set(requestWithProxy.disabledAutoHeaders ?? []);
    const headers = mergeHeaders(auto, requestWithProxy.headers, disabled);
    const body = buildBody(requestWithProxy.body);
    const totalTimeout = requestWithProxy.options?.timeout?.total ?? DEFAULT_TOTAL_TIMEOUT_MS;
    const followRedirects = requestWithProxy.options?.redirect?.follow ?? true;
    const maxRedirects = requestWithProxy.options?.redirect?.maxCount ?? DEFAULT_MAX_REDIRECTS;
    const requestedHttpVersion = requestWithProxy.options?.httpVersion ?? 'auto';

    // Flat list of headers actually sent on the wire, for Dev Tools.
    const sentHeaders: Array<[string, string]> = flattenHeaders(
      headers as Record<string, string | string[] | undefined>,
    );

    const timeoutController = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new Error('total timeout exceeded'));
    }, totalTimeout);
    const signal = mergeSignals(options.signal, timeoutController.signal);

    const sentAt = new Date().toISOString();
    const startedNs = process.hrtime.bigint();

    // Capture socket info via diagnostics_channel. The `undici:client:connected`
    // event fires when the TCP/TLS socket is ready. We subscribe once before
    // the request so we collect only the socket for this particular call.
    let remoteAddress: string | undefined;
    let remotePort: number | undefined;
    let tlsCert: TlsCertInfo | undefined;

    const socketListener = (evt: unknown): void => {
      // Guard against unexpected shapes — diagnostics_channel is untyped.
      if (
        evt === null ||
        typeof evt !== 'object' ||
        !('socket' in evt) ||
        evt.socket === null ||
        typeof evt.socket !== 'object'
      ) {
        return;
      }
      const sock = evt.socket as Record<string, unknown>;
      if (typeof sock.remoteAddress === 'string') {
        remoteAddress = sock.remoteAddress;
      }
      if (typeof sock.remotePort === 'number') {
        remotePort = sock.remotePort;
      }
      // Attempt to extract TLS peer certificate. `getPeerCertificate` is
      // present only on TLS sockets; on plain TCP sockets it is absent.
      if (typeof (sock as { getPeerCertificate?: unknown }).getPeerCertificate === 'function') {
        try {
          const cert = (sock as unknown as TLSSocket).getPeerCertificate(false);
          if (cert && cert.subject) {
            tlsCert = {
              subjectCN: (cert.subject as Record<string, string>).CN ?? '',
              issuerCN:
                cert.issuer !== undefined
                  ? ((cert.issuer as Record<string, string>).CN ?? '')
                  : '',
              validFrom: cert.valid_from ?? '',
              validTo: cert.valid_to ?? '',
              fingerprint256: cert.fingerprint256 ?? '',
            };
          }
        } catch {
          // getPeerCertificate can throw on resumed sessions — degrade silently.
        }
      }
    };

    // `diagnostics_channel.subscribe` exists in Node ≥18.
    const connectedChannel = diagnosticsChannel.channel('undici:client:connected');
    connectedChannel.subscribe(socketListener);

    // Redirect chain tracker. We wrap the redirect interceptor with our own
    // shim that records each hop before following it. The redirect interceptor
    // calls `onResponseStart` for every intermediate response; we intercept
    // that to extract the status and Location header.
    const redirectChain: RedirectHop[] = [];

    try {
      const baseDispatcher = buildBaseDispatcher(requestWithProxy, totalTimeout);
      const dispatcher = baseDispatcher.compose(
        // Our redirect tracker runs inside the redirect interceptor so that
        // each hop is captured before the redirect is followed.
        createRedirectTracker(redirectChain),
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

      // Wire size: Content-Length gives the compressed byte count on the wire.
      // Absent when chunked or when the header is missing entirely.
      const contentLengthStr = pickHeader(headerPairs, 'content-length');
      const compressedSize =
        contentLengthStr !== undefined ? parseInt(contentLengthStr, 10) : undefined;

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

      // Anti-bot detection uses a text preview of the body so we avoid
      // decoding the full buffer again. The body preview is the first 64 KB
      // of decoded bytes, which is enough for any challenge page.
      const bodyPreviewText = new TextDecoder('utf-8', { fatal: false }).decode(
        bytes.byteLength > 65536 ? bytes.subarray(0, 65536) : bytes,
      );
      const antiBotSignal = detectAntiBot({
        status: result.statusCode,
        headers: headerPairs,
        bodyText: bodyPreviewText,
      });

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
        ...(compressedSize !== undefined && !Number.isNaN(compressedSize)
          ? { compressedSize }
          : {}),
        timings: {
          ttfbMs: round2(ttfbMs),
          downloadMs: round2(downloadMs),
          totalMs: round2(totalMs),
        },
        sentAt,
        sentUrl: url,
        sentHeaders,
        ...(redirectChain.length > 0 ? { redirectChain } : {}),
        ...(remoteAddress !== undefined ? { remoteAddress } : {}),
        ...(remotePort !== undefined ? { remotePort } : {}),
        ...(tlsCert !== undefined ? { tlsCert } : {}),
        ...(sseEvents !== undefined ? { sseEvents } : {}),
        ...(antiBotSignal !== null ? { antiBotSignal } : {}),
      };
    } catch (err) {
      if (timedOut) {
        throw new ExecutorError('timeout', 'Total timeout exceeded', err);
      }
      throw toExecutorError(err);
    } finally {
      clearTimeout(timeoutId);
      connectedChannel.unsubscribe(socketListener);
    }
  }

  /**
   * Wraps `execute()` with pre-request and post-response script lifecycle.
   *
   * 1. Runs `scripts.preRequest` with a mutable `req` proxy. Mutations to
   *    url / method / headers / body are applied to the request before send.
   * 2. Calls `execute()` to send the (possibly mutated) request.
   * 3. Runs `scripts.postResponse` with a read-only `res` proxy.
   * 4. Attaches `scriptConsole` and `scriptResult` to the returned response.
   *
   * `callbacks` is provided by the main process so scripts can reach
   * environment and collection files without the sandbox needing direct FS
   * access.
   */
  async executeWithScripts(
    request: ScrapemanRequest,
    options: { signal?: AbortSignal; callbacks?: BruCallbacks } = {},
  ): Promise<ExecutedResponse> {
    const { signal, callbacks } = options;
    const consoleEntries: ScriptConsoleEntry[] = [];
    const failedAssertions: ScriptResult['failedAssertions'] = [];
    let totalScriptMs = 0;

    const requestVars = new Map<string, string>();
    const bru = buildBruObject(
      requestVars,
      callbacks ?? buildNoopCallbacks(),
    );

    let resolved: ScrapemanRequest = request;

    // ── Pre-request script ─────────────────────────────────────────────── //
    if (request.scripts?.preRequest) {
      const mutable: MutableRequest = {
        url: resolved.url,
        method: resolved.method,
        ...(resolved.headers ? { headers: { ...resolved.headers } } : {}),
        ...(resolved.body ? { body: resolved.body } : {}),
      };
      const reqProxy = buildReqProxy(resolved, mutable);
      const ctx = { bru, req: reqProxy };
      const preResult = await runScript(request.scripts.preRequest, ctx);
      consoleEntries.push(...preResult.consoleEntries);
      failedAssertions.push(...preResult.failedAssertions);
      totalScriptMs += preResult.durationMs;

      // Apply mutations back to the resolved request.
      resolved = {
        ...resolved,
        url: mutable.url,
        method: mutable.method,
        ...(mutable.headers !== undefined ? { headers: mutable.headers } : {}),
        ...(mutable.body !== undefined ? { body: mutable.body } : {}),
      };
    }

    // ── Execute ─────────────────────────────────────────────────────────── //
    const response = await this.execute(
      resolved,
      signal !== undefined ? { signal } : {},
    );

    // ── Post-response script ─────────────────────────────────────────────── //
    if (request.scripts?.postResponse) {
      const resProxy = buildResProxy(response);
      const ctx = { bru, res: resProxy };
      const postResult = await runScript(request.scripts.postResponse, ctx);
      consoleEntries.push(...postResult.consoleEntries);
      failedAssertions.push(...postResult.failedAssertions);
      totalScriptMs += postResult.durationMs;
    }

    return {
      ...response,
      scriptConsole: consoleEntries,
      scriptResult: { failedAssertions, durationMs: totalScriptMs },
    };
  }
}

/** No-op callbacks for when no workspace path is available. */
function buildNoopCallbacks(): BruCallbacks {
  return {
    getEnvVars: async () => ({}),
    setEnvVar: async () => { /* noop */ },
    getCollectionVars: async () => ({}),
    setCollectionVar: async () => { /* noop */ },
    getGlobalVars: async () => ({}),
    setGlobalVar: async () => { /* noop */ },
    sendRequest: async () => ({ status: 0, headers: {}, body: '' }),
  };
}

/**
 * When the proxy has a `rotate` config, pick the next URL from the list and
 * return a shallow-cloned request with proxy.url set to the chosen entry.
 * Mutates `counter.value` for round-robin so callers sharing the counter
 * across concurrent slots each get a different slot.
 */
function resolveRotatingProxy(
  request: ScrapemanRequest,
  counter: { value: number },
): ScrapemanRequest {
  const rotate = request.proxy?.rotate;
  if (!request.proxy?.enabled || !rotate || rotate.urls.length === 0) return request;

  let chosenUrl: string;
  if (rotate.strategy === 'random') {
    const idx = Math.floor(Math.random() * rotate.urls.length);
    chosenUrl = rotate.urls[idx]!;
  } else {
    // round-robin: advance counter atomically before reading so concurrent
    // callers get distinct indices.
    const idx = counter.value % rotate.urls.length;
    counter.value += 1;
    chosenUrl = rotate.urls[idx]!;
  }

  return {
    ...request,
    proxy: { ...request.proxy, url: chosenUrl },
  };
}

/**
 * Returns a dispatcher interceptor that appends one `RedirectHop` to `chain`
 * for every intermediate redirect response (3xx with Location).
 *
 * The interceptor sits *outside* the built-in redirect interceptor in the
 * compose chain so its `onResponseStart` fires for each 3xx before undici
 * internally re-dispatches to the next hop.
 */
function createRedirectTracker(chain: RedirectHop[]): Dispatcher.DispatcherComposeInterceptor {
  return (dispatch) =>
    (opts, handler): boolean => {
      // Build the handler with only the properties that are present on the
      // original handler. exactOptionalPropertyTypes requires we do not set
      // optional fields to `undefined`.
      const trackerHandler: Dispatcher.DispatchHandler = {
        onResponseStart: (
          controller: Dispatcher.DispatchController,
          statusCode: number,
          // IncomingHttpHeaders is a Record<string, string | string[] | undefined>
          headers: Record<string, string | string[] | undefined>,
          statusMessage?: string,
        ) => {
          if (statusCode >= 300 && statusCode < 400) {
            const raw = headers['location'];
            const location = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
            if (location) {
              chain.push({
                url: opts.origin
                  ? `${opts.origin.toString()}${opts.path ?? ''}`
                  : (opts.path ?? ''),
                status: statusCode,
                location,
              });
            }
          }
          handler.onResponseStart?.(controller, statusCode, headers, statusMessage);
        },
        // Forward all other hooks when the original handler has them.
        ...(handler.onRequestStart !== undefined
          ? { onRequestStart: handler.onRequestStart.bind(handler) }
          : {}),
        ...(handler.onRequestUpgrade !== undefined
          ? { onRequestUpgrade: handler.onRequestUpgrade.bind(handler) }
          : {}),
        ...(handler.onResponseData !== undefined
          ? { onResponseData: handler.onResponseData.bind(handler) }
          : {}),
        ...(handler.onResponseEnd !== undefined
          ? { onResponseEnd: handler.onResponseEnd.bind(handler) }
          : {}),
        ...(handler.onResponseError !== undefined
          ? { onResponseError: handler.onResponseError.bind(handler) }
          : {}),
        ...(handler.onConnect !== undefined
          ? { onConnect: handler.onConnect.bind(handler) }
          : {}),
        ...(handler.onError !== undefined
          ? { onError: handler.onError.bind(handler) }
          : {}),
        ...(handler.onUpgrade !== undefined
          ? { onUpgrade: handler.onUpgrade.bind(handler) }
          : {}),
        ...(handler.onHeaders !== undefined
          ? { onHeaders: handler.onHeaders.bind(handler) }
          : {}),
        ...(handler.onData !== undefined
          ? { onData: handler.onData.bind(handler) }
          : {}),
        ...(handler.onComplete !== undefined
          ? { onComplete: handler.onComplete.bind(handler) }
          : {}),
      };
      return dispatch(opts, trackerHandler);
    };
}

function buildUrl(request: ScrapemanRequest): string {
  // The URL bar is the single source of truth for what the user sends —
  // `request.url` already carries every enabled param the UI surfaced.
  // `request.params` exists only so the file format can round-trip all
  // rows (including disabled ones) without losing their values; it is
  // intentionally NOT appended here, otherwise rows that the user had
  // removed from the URL bar would silently come back on send.
  return normalizeUrl(request.url);
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
