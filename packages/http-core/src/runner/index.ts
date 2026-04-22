import type { ScrapemanRequest } from '@scrapeman/shared-types';
import { UndiciExecutor } from '../adapters/undici-executor.js';
import { resolveRequest } from '../variables/resolve.js';
import { applyAuth } from '../auth/apply.js';
import { composeScrapeDoRequest } from '../scrapeDo/compose.js';
import { ExecutorError } from '../errors.js';

// ---------- types -----------------------------------------------------------

export type RunnerMode = 'sequential' | 'parallel';

export interface RunnerRequestInput {
  request: ScrapemanRequest;
  /** Logical name shown in results (defaults to request.meta.name). */
  name?: string;
}

export interface RunnerInput {
  requests: RunnerRequestInput[];
  mode: RunnerMode;
  /** Max simultaneous in-flight requests (parallel mode only). Default 5. */
  concurrency?: number;
  /** Milliseconds to wait after each request completes before starting the next. */
  delayMs?: number;
  /** Number of full-collection passes to run. Default 1. */
  iterations?: number;
  /** Merged on top of the active environment for every request/iteration. */
  variables?: Record<string, string>;
  abortSignal?: AbortSignal;
  onEvent?: (event: RunnerEvent) => void;
  /** One variable bag per iteration (from CSV upload). When present, overrides
   *  `iterations` — the run has exactly csvRows.length iterations. */
  csvRows?: Array<Record<string, string>>;
}

// Event union ----------------------------------------------------------------

export type RunnerEventKind =
  | 'start'
  | 'request-start'
  | 'request-complete'
  | 'request-failed'
  | 'iteration-done'
  | 'done'
  | 'aborted';

export interface RunnerEventBase {
  kind: RunnerEventKind;
  /** Monotonic elapsed ms since the run began. */
  elapsedMs: number;
}

export interface RunnerStartEvent extends RunnerEventBase {
  kind: 'start';
  totalRequests: number;
  totalIterations: number;
}

export interface RunnerRequestStartEvent extends RunnerEventBase {
  kind: 'request-start';
  iteration: number;
  requestIndex: number;
  requestName: string;
}

export interface RunnerRequestCompleteEvent extends RunnerEventBase {
  kind: 'request-complete';
  iteration: number;
  requestIndex: number;
  requestName: string;
  status: number;
  durationMs: number;
  /** Response body, capped at 512 KB for the event payload. */
  bodyPreview: string;
  responseHeaders: Array<[string, string]>;
}

export interface RunnerRequestFailedEvent extends RunnerEventBase {
  kind: 'request-failed';
  iteration: number;
  requestIndex: number;
  requestName: string;
  errorKind: string;
  errorMessage: string;
  durationMs: number;
}

export interface RunnerIterationDoneEvent extends RunnerEventBase {
  kind: 'iteration-done';
  iteration: number;
  succeeded: number;
  failed: number;
}

export interface RunnerDoneEvent extends RunnerEventBase {
  kind: 'done';
  totalSucceeded: number;
  totalFailed: number;
  totalDurationMs: number;
}

export interface RunnerAbortedEvent extends RunnerEventBase {
  kind: 'aborted';
}

export type RunnerEvent =
  | RunnerStartEvent
  | RunnerRequestStartEvent
  | RunnerRequestCompleteEvent
  | RunnerRequestFailedEvent
  | RunnerIterationDoneEvent
  | RunnerDoneEvent
  | RunnerAbortedEvent;

// Result types ---------------------------------------------------------------

export interface RunnerRequestResult {
  iteration: number;
  requestIndex: number;
  requestName: string;
  /** Resolved URL that was actually fetched. */
  url: string;
  method: string;
  /** HTTP status, or 0 on network failure. */
  status: number;
  durationMs: number;
  ok: boolean;
  bodyPreview: string;
  responseHeaders: Array<[string, string]>;
  errorKind?: string;
  errorMessage?: string;
  startedAt: string;
}

export interface RunnerResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  totalSucceeded: number;
  totalFailed: number;
  iterations: number;
  requestCount: number;
  results: RunnerRequestResult[];
  aborted: boolean;
}

// Constants ------------------------------------------------------------------

/** Max body bytes to include in per-request event payloads / results. */
const PREVIEW_LIMIT = 512 * 1024;

// Core runner ----------------------------------------------------------------

/**
 * Runs a collection (ordered list of requests) N times.
 *
 * Sequential mode: requests run one-at-a-time in order, across all iterations.
 * Parallel mode: requests within an iteration run up to `concurrency` at once,
 * but iterations are still sequential (one iteration completes before the next
 * starts) to keep the CSV-variable-bag-per-iteration guarantee.
 *
 * `delayMs` is applied after each request completes in both modes.
 */
export async function runCollection(input: RunnerInput): Promise<RunnerResult> {
  const executor = new UndiciExecutor();
  const started = Date.now();

  const {
    mode,
    concurrency = 5,
    delayMs = 0,
    variables = {},
    abortSignal,
    onEvent,
  } = input;

  // Determine iteration count. CSV rows take precedence.
  const csvRows = input.csvRows ?? null;
  const iterations = csvRows ? csvRows.length : Math.max(1, input.iterations ?? 1);

  const emit = (event: RunnerEvent): void => {
    if (onEvent) onEvent(event);
  };

  const elapsed = (): number => Date.now() - started;

  emit({
    kind: 'start',
    elapsedMs: elapsed(),
    totalRequests: input.requests.length,
    totalIterations: iterations,
  });

  const allResults: RunnerRequestResult[] = [];
  let totalSucceeded = 0;
  let totalFailed = 0;
  let aborted = false;

  /**
   * Build the per-request variable bag for the given iteration:
   * base vars < CSV row (if any) — caller-supplied `variables` always take
   * lower precedence than the CSV row so data-driven overrides work cleanly.
   */
  const varsForIteration = (iteration: number): Record<string, string> => {
    if (csvRows && csvRows[iteration]) {
      return { ...variables, ...csvRows[iteration] };
    }
    return variables;
  };

  /**
   * Execute a single request and return its result. Does NOT update the
   * allResults array — callers do that.
   */
  const runOne = async (
    iterationIdx: number,
    reqIdx: number,
    entry: RunnerRequestInput,
    iterVars: Record<string, string>,
  ): Promise<RunnerRequestResult> => {
    const requestName = entry.name ?? entry.request.meta.name;
    const startedAt = new Date().toISOString();
    const t0 = performance.now();

    emit({
      kind: 'request-start',
      elapsedMs: elapsed(),
      iteration: iterationIdx,
      requestIndex: reqIdx,
      requestName,
    });

    try {
      // Per-iteration variable resolution keeps {{random}}/{{timestamp}} fresh.
      let resolved = resolveRequest(entry.request, { variables: iterVars }).request;
      resolved = composeScrapeDoRequest(resolved);
      resolved = await applyAuth(resolved);

      const response = await executor.execute(resolved, {
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      const durationMs = Math.round(performance.now() - t0);

      // Decode body preview from base64, capped at PREVIEW_LIMIT bytes.
      const bodyPreview = (() => {
        const raw = Buffer.from(response.bodyBase64, 'base64');
        const slice = raw.slice(0, PREVIEW_LIMIT);
        return slice.toString('utf8');
      })();

      const result: RunnerRequestResult = {
        iteration: iterationIdx,
        requestIndex: reqIdx,
        requestName,
        url: resolved.url,
        method: resolved.method,
        status: response.status,
        durationMs,
        ok: response.status >= 200 && response.status < 400,
        bodyPreview,
        responseHeaders: response.headers,
        startedAt,
      };

      emit({
        kind: 'request-complete',
        elapsedMs: elapsed(),
        iteration: iterationIdx,
        requestIndex: reqIdx,
        requestName,
        status: response.status,
        durationMs,
        bodyPreview,
        responseHeaders: response.headers,
      });

      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const errorKind = err instanceof ExecutorError ? err.kind : 'unknown';
      const errorMessage = err instanceof Error ? err.message : String(err);

      const result: RunnerRequestResult = {
        iteration: iterationIdx,
        requestIndex: reqIdx,
        requestName,
        url: entry.request.url,
        method: entry.request.method,
        status: 0,
        durationMs,
        ok: false,
        bodyPreview: '',
        responseHeaders: [],
        errorKind,
        errorMessage,
        startedAt,
      };

      emit({
        kind: 'request-failed',
        elapsedMs: elapsed(),
        iteration: iterationIdx,
        requestIndex: reqIdx,
        requestName,
        errorKind,
        errorMessage,
        durationMs,
      });

      return result;
    }
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  for (let iter = 0; iter < iterations; iter++) {
    if (abortSignal?.aborted) {
      aborted = true;
      break;
    }

    const iterVars = varsForIteration(iter);
    const iterResults: RunnerRequestResult[] = [];

    if (mode === 'sequential') {
      for (let reqIdx = 0; reqIdx < input.requests.length; reqIdx++) {
        if (abortSignal?.aborted) {
          aborted = true;
          break;
        }
        const entry = input.requests[reqIdx]!;
        const result = await runOne(iter, reqIdx, entry, iterVars);
        iterResults.push(result);
        if (result.ok) totalSucceeded++;
        else totalFailed++;
        if (delayMs > 0) await sleep(delayMs);
      }
    } else {
      // Parallel mode: process requests in the iteration with concurrency limit.
      const clampedConcurrency = Math.max(1, Math.min(concurrency, input.requests.length));
      let nextIdx = 0;

      const worker = async (): Promise<void> => {
        while (true) {
          if (abortSignal?.aborted) return;
          const reqIdx = nextIdx++;
          if (reqIdx >= input.requests.length) return;
          const entry = input.requests[reqIdx]!;
          const result = await runOne(iter, reqIdx, entry, iterVars);
          iterResults[reqIdx] = result;
          if (result.ok) totalSucceeded++;
          else totalFailed++;
          if (delayMs > 0) await sleep(delayMs);
        }
      };

      const workers = Array.from({ length: clampedConcurrency }, () => worker());
      await Promise.all(workers);
    }

    if (aborted) break;

    const iterSucceeded = iterResults.filter((r) => r.ok).length;
    const iterFailed = iterResults.filter((r) => !r.ok).length;

    allResults.push(...iterResults);

    emit({
      kind: 'iteration-done',
      elapsedMs: elapsed(),
      iteration: iter,
      succeeded: iterSucceeded,
      failed: iterFailed,
    });
  }

  const finishedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - started;

  if (aborted) {
    emit({ kind: 'aborted', elapsedMs: elapsed() });
  } else {
    emit({
      kind: 'done',
      elapsedMs: elapsed(),
      totalSucceeded,
      totalFailed,
      totalDurationMs,
    });
  }

  return {
    runId: crypto.randomUUID(),
    startedAt: new Date(started).toISOString(),
    finishedAt,
    totalDurationMs,
    totalSucceeded,
    totalFailed,
    iterations,
    requestCount: input.requests.length,
    results: allResults,
    aborted,
  };
}
