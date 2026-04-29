import type {
  LoadEvent,
  LoadFailedBodyEvent,
  ScrapemanRequest,
  WatchedHeaderStats,
  WatchedHeaderBucket,
  WatchedHeaderNumericStats,
} from '@scrapeman/shared-types';
import { UndiciExecutor } from '../adapters/undici-executor.js';
import { resolveRequest } from '../variables/resolve.js';
import { applyAuth } from '../auth/apply.js';
import { composeScrapeDoRequest } from '../scrapeDo/compose.js';
import { ExecutorError } from '../errors.js';

export interface LoadValidator {
  expectStatus?: number[];
  expectBodyContains?: string;
}

export interface LoadRunInput {
  request: ScrapemanRequest;
  variables: Record<string, string>;
  total: number;
  concurrency: number;
  perIterDelayMs?: number;
  validator: LoadValidator;
  /** When true the runner captures failed iteration bodies and passes them
   *  via the onFailedBody callback. Default false. */
  saveFailedBodies?: boolean;
  /** Maximum failed-body events to emit per run (default 50, max 1000). */
  failedBodyLimit?: number;
  /** Explicit list of header names to track. Case-insensitive. */
  watchedHeaders?: string[];
  /** When true (default), any response header starting with `scrape.do-` is
   *  automatically tracked regardless of `watchedHeaders`. */
  autoTrackScrapeDoHeaders?: boolean;
}

// 64 KB cap on captured failure bodies.
const FAILED_BODY_CAP_BYTES = 64 * 1024;

export interface LoadProgress {
  sent: number;
  succeeded: number;
  failed: number;
  validationFailures: number;
  inflight: number;
  currentRps: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyMin: number;
  latencyMax: number;
  statusHistogram: Record<string, number>;
  errorKinds: Record<string, number>;
  elapsedMs: number;
  totalTarget: number;
  lastEvent: LoadEvent | null;
  /** Only present when saveFailedBodies is enabled and the iteration failed. */
  lastFailedBodyEvent?: LoadFailedBodyEvent;
  done: boolean;
  watchedHeaderStats?: Record<string, WatchedHeaderStats>;
}

// ---------------------------------------------------------------------------
// Internal accumulator per watched header
// ---------------------------------------------------------------------------

interface HeaderAcc {
  /** Canonical name as first seen (preserves original casing of first occurrence). */
  name: string;
  seen: number;
  valueCounts: Map<string, number>;
  /** All numeric-parseable values collected so far. */
  numericValues: number[];
  /** Total values seen (including non-numeric). */
  totalValues: number;
  /** Per-status accumulator. */
  byStatus: Map<string, { valueCounts: Map<string, number>; numericValues: number[]; totalValues: number }>;
}

function numericStats(sorted: number[]): WatchedHeaderNumericStats {
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (q: number): number => {
    const idx = Math.min(n - 1, Math.floor(n * q));
    return sorted[idx]!;
  };
  return {
    min: sorted[0]!,
    max: sorted[n - 1]!,
    avg: sum / n,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
  };
}

function bucketFromAcc(
  valueCounts: Map<string, number>,
  numericValues: number[],
  totalValues: number,
): WatchedHeaderBucket {
  const unique: Array<[string, number]> = [...valueCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const isNumeric =
    totalValues >= 5 && numericValues.length / totalValues >= 0.95;
  if (isNumeric) {
    const sorted = [...numericValues].sort((a, b) => a - b);
    return { unique, numeric: numericStats(sorted) };
  }
  return { unique };
}

function finalizeStats(
  accMap: Map<string, HeaderAcc>,
): Record<string, WatchedHeaderStats> {
  const out: Record<string, WatchedHeaderStats> = {};
  // Sort by seen descending, then by name ascending for ties.
  const sorted = [...accMap.values()].sort(
    (a, b) => b.seen - a.seen || a.name.localeCompare(b.name),
  );
  for (const acc of sorted) {
    const bucket = bucketFromAcc(acc.valueCounts, acc.numericValues, acc.totalValues);
    const byStatus: Record<string, WatchedHeaderBucket> = {};
    for (const [status, statusAcc] of acc.byStatus.entries()) {
      byStatus[status] = bucketFromAcc(
        statusAcc.valueCounts,
        statusAcc.numericValues,
        statusAcc.totalValues,
      );
    }
    out[acc.name] = {
      name: acc.name,
      seen: acc.seen,
      unique: bucket.unique,
      ...(bucket.numeric !== undefined ? { numeric: bucket.numeric } : {}),
      byStatus,
    };
  }
  return out;
}

function shouldTrack(
  headerName: string,
  watchedSet: Set<string>,
  autoTrack: boolean,
): boolean {
  if (watchedSet.has(headerName.toLowerCase())) return true;
  if (autoTrack && headerName.toLowerCase().startsWith('scrape.do-')) return true;
  return false;
}

function accumulateHeader(
  acc: Map<string, HeaderAcc>,
  name: string,
  value: string,
  status: string,
): void {
  const key = name.toLowerCase();
  let entry = acc.get(key);
  if (!entry) {
    entry = {
      name,
      seen: 0,
      valueCounts: new Map(),
      numericValues: [],
      totalValues: 0,
      byStatus: new Map(),
    };
    acc.set(key, entry);
  }
  entry.seen++;

  const numVal = parseFloat(value);
  const isNumeric = Number.isFinite(numVal);

  // Global bucket
  entry.valueCounts.set(value, (entry.valueCounts.get(value) ?? 0) + 1);
  if (isNumeric) entry.numericValues.push(numVal);
  entry.totalValues++;

  // Per-status bucket
  let statusAcc = entry.byStatus.get(status);
  if (!statusAcc) {
    statusAcc = { valueCounts: new Map(), numericValues: [], totalValues: 0 };
    entry.byStatus.set(status, statusAcc);
  }
  statusAcc.valueCounts.set(value, (statusAcc.valueCounts.get(value) ?? 0) + 1);
  if (isNumeric) statusAcc.numericValues.push(numVal);
  statusAcc.totalValues++;
}

/**
 * Runs N copies of a single request with bounded concurrency. Per-iteration
 * variable resolution means built-ins like {{random}} and {{timestamp}} get
 * fresh values on every iteration even though env vars stay static.
 *
 * Validator runs locally after each response arrives — network failures and
 * validation failures are tracked separately so the UI can distinguish "the
 * server threw an error" from "the server responded but didn't match".
 */
export async function runLoad(
  input: LoadRunInput,
  onProgress: (progress: LoadProgress) => void,
  signal: AbortSignal,
): Promise<LoadProgress> {
  const executor = new UndiciExecutor();
  const latencies: number[] = [];
  const statusHistogram: Record<string, number> = {};
  const errorKinds: Record<string, number> = {};
  let sent = 0;
  let succeeded = 0;
  let failed = 0;
  let validationFailures = 0;
  let inflight = 0;
  const started = Date.now();
  let nextIteration = 0;

  // Ring buffer: track how many failed-body events we've emitted so we
  // stop once we reach the configured limit.
  const saveFailedBodies = input.saveFailedBodies === true;
  const failedBodyLimit = Math.min(1000, Math.max(1, input.failedBodyLimit ?? 50));
  let failedBodyCount = 0;

  const concurrency = Math.max(1, Math.min(input.concurrency, input.total));

  // Watched headers setup
  const watchedSet = new Set(
    (input.watchedHeaders ?? []).map((h) => h.toLowerCase()),
  );
  const autoTrack = input.autoTrackScrapeDoHeaders ?? true;
  const trackingEnabled = watchedSet.size > 0 || autoTrack;
  const headerAcc = new Map<string, HeaderAcc>();

  const percentile = (sortedArr: number[], q: number): number => {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * q));
    return sortedArr[idx]!;
  };

  const snapshot = (
    lastEvent: LoadEvent | null,
    done: boolean,
    lastFailedBodyEvent?: LoadFailedBodyEvent,
  ): LoadProgress => {
    const sorted = [...latencies].sort((a, b) => a - b);
    const elapsedMs = Date.now() - started;
    const currentRps = elapsedMs > 0 ? (sent * 1000) / elapsedMs : 0;
    const base: LoadProgress = {
      sent,
      succeeded,
      failed,
      validationFailures,
      inflight,
      currentRps,
      latencyP50: percentile(sorted, 0.5),
      latencyP95: percentile(sorted, 0.95),
      latencyP99: percentile(sorted, 0.99),
      latencyMin: sorted[0] ?? 0,
      latencyMax: sorted[sorted.length - 1] ?? 0,
      statusHistogram: { ...statusHistogram },
      errorKinds: { ...errorKinds },
      elapsedMs,
      totalTarget: input.total,
      lastEvent,
      ...(lastFailedBodyEvent !== undefined ? { lastFailedBodyEvent } : {}),
      done,
    };
    if (trackingEnabled && headerAcc.size > 0) {
      base.watchedHeaderStats = finalizeStats(headerAcc);
    }
    return base;
  };

  const validate = (status: number, body: string): boolean => {
    if (input.validator.expectStatus && input.validator.expectStatus.length > 0) {
      if (!input.validator.expectStatus.includes(status)) return false;
    }
    if (input.validator.expectBodyContains) {
      if (!body.includes(input.validator.expectBodyContains)) return false;
    }
    return true;
  };

  /**
   * Truncate a buffer to at most FAILED_BODY_CAP_BYTES and encode as base64.
   * Avoids encoding multi-MB responses before transmission.
   */
  const encodeBodyCapped = (raw: Uint8Array | null): string => {
    if (!raw) return '';
    const slice = raw.length > FAILED_BODY_CAP_BYTES ? raw.slice(0, FAILED_BODY_CAP_BYTES) : raw;
    return Buffer.from(slice).toString('base64');
  };

  const runOne = async (
    iteration: number,
  ): Promise<{ event: LoadEvent; failedBodyEvent?: LoadFailedBodyEvent }> => {
    // Per-iteration resolve → {{random}} / {{timestamp}} produce fresh values.
    let prepared = resolveRequest(input.request, {
      variables: input.variables,
    }).request;
    prepared = composeScrapeDoRequest(prepared);
    prepared = await applyAuth(prepared);

    const t0 = performance.now();
    try {
      const response = await executor.execute(prepared, { signal });
      const durationMs = performance.now() - t0;
      latencies.push(durationMs);
      const bucket = String(response.status);
      statusHistogram[bucket] = (statusHistogram[bucket] ?? 0) + 1;

      // Accumulate watched headers
      if (trackingEnabled) {
        for (const [name, value] of response.headers) {
          if (shouldTrack(name, watchedSet, autoTrack)) {
            accumulateHeader(headerAcc, name, value, bucket);
          }
        }
      }

      // T3W1: use the full body (not the UI-capped bodyBase64) for
      // validation so `expectBodyContains` matches against everything the
      // server returned.
      const body = response.fullBodyBytes
        ? Buffer.from(response.fullBodyBytes).toString('utf8')
        : Buffer.from(response.bodyBase64, 'base64').toString('utf8');
      const valid = validate(response.status, body);
      if (valid) {
        succeeded++;
      } else {
        validationFailures++;
      }

      const event: LoadEvent = {
        kind: 'iteration',
        iteration,
        status: response.status,
        durationMs: Math.round(durationMs),
        valid,
      };

      // Emit a failed-body event when the iteration failed validation and the
      // feature is enabled and we haven't hit the per-run cap yet.
      let failedBodyEvent: LoadFailedBodyEvent | undefined;
      if (!valid && saveFailedBodies && failedBodyCount < failedBodyLimit) {
        failedBodyCount++;
        const rawBytes = response.fullBodyBytes ?? null;
        failedBodyEvent = {
          kind: 'failed-body',
          iteration,
          status: response.status,
          durationMs: Math.round(durationMs),
          bodyBase64: encodeBodyCapped(rawBytes),
          validationFailureReason: buildValidationFailureReason(
            response.status,
            body,
            input.validator,
          ),
        };
      }

      return { event, ...(failedBodyEvent !== undefined ? { failedBodyEvent } : {}) };
    } catch (err) {
      const durationMs = performance.now() - t0;
      latencies.push(durationMs);
      failed++;
      const kind = err instanceof ExecutorError ? err.kind : 'unknown';
      errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;

      const event: LoadEvent = {
        kind: 'iteration',
        iteration,
        status: 0,
        durationMs: Math.round(durationMs),
        valid: false,
        errorKind: kind,
        errorMessage: err instanceof Error ? err.message : String(err),
      };

      // Network/TLS errors also count as failures when saveFailedBodies is on.
      // Body will be empty because we never received a response.
      let failedBodyEvent: LoadFailedBodyEvent | undefined;
      if (saveFailedBodies && failedBodyCount < failedBodyLimit) {
        failedBodyCount++;
        failedBodyEvent = {
          kind: 'failed-body',
          iteration,
          status: 0,
          durationMs: Math.round(durationMs),
          bodyBase64: '',
          errorKind: kind,
        };
      }

      return { event, ...(failedBodyEvent !== undefined ? { failedBodyEvent } : {}) };
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      if (signal.aborted) return;
      const iteration = nextIteration++;
      if (iteration >= input.total) return;
      inflight++;
      const { event, failedBodyEvent } = await runOne(iteration);
      sent++;
      inflight--;
      onProgress(snapshot(event, false, failedBodyEvent));

      // Per-run delay (from the UI load-test config) + per-request rate-limit.
      // They stack: run-level delay is the baseline, request rate-limit adds
      // on top only when the run-level delay is 0.
      const runDelay = input.perIterDelayMs ?? 0;
      const rl = input.request.rateLimit;
      let rlDelay = 0;
      if (rl?.enabled && runDelay === 0) {
        const jitterMin = rl.jitterMinMs ?? 0;
        const jitterMax = rl.jitterMaxMs ?? 0;
        const jitter =
          jitterMax > jitterMin
            ? Math.floor(Math.random() * (jitterMax - jitterMin)) + jitterMin
            : 0;
        rlDelay = rl.fixedDelayMs + jitter;
      }
      const totalDelay = runDelay + rlDelay;
      if (totalDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, totalDelay));
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const final = snapshot(null, true);
  onProgress(final);
  return final;
}

/** Build a human-readable string explaining why validation failed. */
function buildValidationFailureReason(
  status: number,
  body: string,
  validator: LoadValidator,
): string {
  const reasons: string[] = [];
  if (validator.expectStatus && validator.expectStatus.length > 0) {
    if (!validator.expectStatus.includes(status)) {
      reasons.push(`status ${status} not in [${validator.expectStatus.join(', ')}]`);
    }
  }
  if (validator.expectBodyContains) {
    if (!body.includes(validator.expectBodyContains)) {
      reasons.push(`body missing "${validator.expectBodyContains}"`);
    }
  }
  return reasons.join('; ');
}
