import type { ScrapemanRequest } from '@scrapeman/shared-types';
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
}

export interface LoadEvent {
  iteration: number;
  status: number;
  durationMs: number;
  valid: boolean;
  errorKind?: string;
  errorMessage?: string;
}

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
  done: boolean;
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

  const concurrency = Math.max(1, Math.min(input.concurrency, input.total));

  const percentile = (sortedArr: number[], q: number): number => {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * q));
    return sortedArr[idx]!;
  };

  const snapshot = (lastEvent: LoadEvent | null, done: boolean): LoadProgress => {
    const sorted = [...latencies].sort((a, b) => a - b);
    const elapsedMs = Date.now() - started;
    const currentRps = elapsedMs > 0 ? (sent * 1000) / elapsedMs : 0;
    return {
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
      done,
    };
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

  const runOne = async (iteration: number): Promise<LoadEvent> => {
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

      // T3W1: use the full body (not the UI-capped bodyBase64) for
      // validation so `expectBodyContains` matches against everything the
      // server returned.
      const body = response.fullBodyBytes
        ? Buffer.from(response.fullBodyBytes).toString('utf8')
        : Buffer.from(response.bodyBase64, 'base64').toString('utf8');
      const valid = validate(response.status, body);
      if (valid) succeeded++;
      else validationFailures++;

      return {
        iteration,
        status: response.status,
        durationMs: Math.round(durationMs),
        valid,
      };
    } catch (err) {
      const durationMs = performance.now() - t0;
      latencies.push(durationMs);
      failed++;
      const kind = err instanceof ExecutorError ? err.kind : 'unknown';
      errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
      return {
        iteration,
        status: 0,
        durationMs: Math.round(durationMs),
        valid: false,
        errorKind: kind,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      if (signal.aborted) return;
      const iteration = nextIteration++;
      if (iteration >= input.total) return;
      inflight++;
      const event = await runOne(iteration);
      sent++;
      inflight--;
      onProgress(snapshot(event, false));

      if (input.perIterDelayMs && input.perIterDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, input.perIterDelayMs));
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const final = snapshot(null, true);
  onProgress(final);
  return final;
}
