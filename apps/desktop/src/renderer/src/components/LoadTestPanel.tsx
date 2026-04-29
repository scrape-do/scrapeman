import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FORMAT_VERSION, type LoadFailedBodyEvent } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore, type BuilderState } from '../store.js';
import { Tooltip } from '../ui/Tooltip.js';

/**
 * Inline load test panel rendered inside the Request Builder tab bar.
 * State lives in the Zustand store (per-tab) so tab switches do not reset
 * config or running test progress. The global onLoadProgress listener is
 * registered in App.tsx and routes events here via handleLoadProgress().
 */
export function LoadTestPanel(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const workspace = useAppStore((s) => s.workspace);
  const updateLoadTestConfig = useAppStore((s) => s.updateLoadTestConfig);
  const setLoadTestRun = useAppStore((s) => s.setLoadTestRun);
  const clearLoadTest = useAppStore((s) => s.clearLoadTest);
  const clearFailedBodies = useAppStore((s) => s.clearFailedBodies);
  const resetLoadTestForStart = useAppStore((s) => s.resetLoadTestForStart);

  // Read load test state directly from the active tab.
  const loadTest = activeTab?.loadTest ?? null;
  const config = loadTest?.config;
  const { runId, progress, events, failedBodies, starting, startError } = loadTest ?? {
    runId: null,
    progress: null,
    events: [],
    failedBodies: [],
    starting: false,
    startError: null,
  };

  // --- Task 2: Raw string state for number inputs ---
  // Track the raw text in component state to allow clearing the leading digit.
  // Synced down from store when the active tab changes (via activeTab.id key).
  const [rawTotal, setRawTotal] = useState<string>(() => String(config?.total ?? 100));
  const [rawConcurrency, setRawConcurrency] = useState<string>(() =>
    String(config?.concurrency ?? 10),
  );
  const [rawDelay, setRawDelay] = useState<string>(() => String(config?.delay ?? 0));
  const [rawFailedBodyLimit, setRawFailedBodyLimit] = useState<string>(() =>
    String(config?.failedBodyLimit ?? 50),
  );

  // When the active tab changes, sync raw inputs from the store.
  const tabId = activeTab?.id ?? null;
  useEffect(() => {
    if (!config) return;
    setRawTotal(String(config.total));
    setRawConcurrency(String(config.concurrency));
    setRawDelay(String(config.delay));
    setRawFailedBodyLimit(String(config.failedBodyLimit));
  // Intentionally only re-run when the tab identity changes, not on every config change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Clamp helper: parse raw string, fall back to min, apply Math.max.
  const commitTotal = useCallback((): void => {
    if (!activeTab) return;
    const v = Math.max(1, parseInt(rawTotal, 10) || 1);
    setRawTotal(String(v));
    updateLoadTestConfig(activeTab.id, { total: v });
  }, [activeTab, rawTotal, updateLoadTestConfig]);

  const commitConcurrency = useCallback((): void => {
    if (!activeTab) return;
    const v = Math.max(1, parseInt(rawConcurrency, 10) || 1);
    setRawConcurrency(String(v));
    updateLoadTestConfig(activeTab.id, { concurrency: v });
  }, [activeTab, rawConcurrency, updateLoadTestConfig]);

  const commitDelay = useCallback((): void => {
    if (!activeTab) return;
    const v = Math.max(0, parseInt(rawDelay, 10) || 0);
    setRawDelay(String(v));
    updateLoadTestConfig(activeTab.id, { delay: v });
  }, [activeTab, rawDelay, updateLoadTestConfig]);

  const commitFailedBodyLimit = useCallback((): void => {
    if (!activeTab) return;
    const v = Math.min(1000, Math.max(1, parseInt(rawFailedBodyLimit, 10) || 50));
    setRawFailedBodyLimit(String(v));
    updateLoadTestConfig(activeTab.id, { failedBodyLimit: v });
  }, [activeTab, rawFailedBodyLimit, updateLoadTestConfig]);

  // --- Task 1: Auto-scroll ---
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, autoScroll]);

  const handleScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  // Reset auto-scroll to ON when a new run starts.
  useEffect(() => {
    if (starting) setAutoScroll(true);
  }, [starting]);

  const start = async (): Promise<void> => {
    if (!activeTab) return;
    const tabId = activeTab.id;
    const cfg = activeTab.loadTest.config;

    // Commit any pending raw-input edits before starting.
    const total = Math.max(1, parseInt(rawTotal, 10) || cfg.total);
    const concurrency = Math.max(1, parseInt(rawConcurrency, 10) || cfg.concurrency);
    const delay = Math.max(0, parseInt(rawDelay, 10) || 0);
    const failedBodyLimit = Math.min(
      1000,
      Math.max(1, parseInt(rawFailedBodyLimit, 10) || cfg.failedBodyLimit),
    );

    // Generate runId client-side so load:progress events that arrive before the
    // IPC call resolves are still routable in the store.
    const newRunId = crypto.randomUUID();
    // Atomic reset: clears events/progress, sets starting:true, stores runId.
    resetLoadTestForStart(tabId, newRunId);
    try {
      const request = buildRequestFromBuilder(activeTab.builder, activeTab.name);
      await bridge.loadStart({
        request,
        ...(workspace?.path ? { workspacePath: workspace.path } : {}),
        total,
        concurrency,
        ...(delay > 0 ? { perIterDelayMs: delay } : {}),
        runId: newRunId,
        validator: {
          ...(cfg.expectStatus.trim()
            ? {
                expectStatus: cfg.expectStatus
                  .split(',')
                  .map((s) => parseInt(s.trim(), 10))
                  .filter((n) => !Number.isNaN(n)),
              }
            : {}),
          ...(cfg.expectBody.trim() ? { expectBodyContains: cfg.expectBody } : {}),
        },
        ...(cfg.saveFailedBodies ? { saveFailedBodies: true, failedBodyLimit } : {}),
      });
      setLoadTestRun(tabId, { starting: false });
    } catch (err) {
      setLoadTestRun(tabId, {
        runId: null,
        starting: false,
        startError: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const stop = async (): Promise<void> => {
    if (runId) await bridge.loadStop(runId);
  };

  const reset = (): void => {
    if (!activeTab) return;
    clearLoadTest(activeTab.id);
  };

  const running = runId !== null && (progress === null || !progress.done);
  const finished = runId !== null && progress !== null && progress.done;

  const successRate =
    progress && progress.sent > 0
      ? ((progress.succeeded / progress.sent) * 100).toFixed(1)
      : '0.0';

  const progressPct = progress
    ? Math.min(100, (progress.sent / progress.totalTarget) * 100)
    : 0;

  const statusEntries = useMemo(
    () =>
      progress
        ? Object.entries(progress.statusHistogram).sort((a, b) =>
            a[0].localeCompare(b[0]),
          )
        : [],
    [progress],
  );

  const errorEntries = useMemo(
    () => (progress ? Object.entries(progress.errorKinds) : []),
    [progress],
  );

  // Export failures as JSON.
  const exportFailures = useCallback((): void => {
    if (!activeTab || failedBodies.length === 0) return;
    const payload = {
      runId,
      generatedAt: new Date().toISOString(),
      failures: failedBodies,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `load-failures-${runId ?? 'run'}.json`;
    a.click();
    URL.revokeObjectURL(href);
  }, [activeTab, failedBodies, runId]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-ink-1">
            Load test · {activeTab?.name ?? 'current request'}
          </div>
          <div className="mt-0.5 text-xs text-ink-3">
            Fires the current request N times with bounded concurrency.
            Validates each response locally and tracks the success rate.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!running && !finished && (
            <>
              <button
                onClick={() => void start()}
                disabled={starting || !activeTab}
                className="btn-primary gap-1.5"
                title="Start load test"
              >
                {starting && <span className="spinner" aria-hidden="true" />}
                {starting ? 'Preparing…' : 'Start'}
              </button>
              {startError && (
                <span className="text-xs text-method-delete">{startError}</span>
              )}
            </>
          )}
          {running && (
            <button
              onClick={() => void stop()}
              className="inline-flex h-8 items-center justify-center rounded-md bg-method-delete px-3.5 text-xs font-semibold text-white hover:bg-[#B6383D]"
              title="Stop load test"
            >
              Stop
            </button>
          )}
          {finished && (
            <button onClick={reset} className="btn-secondary" title="Reset load test">
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Config form — hidden once run is in flight */}
      {!running && !finished && config && (
        <div className="grid grid-cols-2 gap-4 border-b border-line px-5 py-4">
          {/* Task 2: raw string inputs with blur-commit */}
          <Field label="Total requests" hint="Total number of iterations">
            <input
              type="number"
              min={1}
              value={rawTotal}
              onChange={(e) => setRawTotal(e.target.value)}
              onBlur={commitTotal}
              className="field w-full"
            />
          </Field>
          <Field label="Concurrency" hint="Max parallel in-flight">
            <input
              type="number"
              min={1}
              value={rawConcurrency}
              onChange={(e) => setRawConcurrency(e.target.value)}
              onBlur={commitConcurrency}
              className="field w-full"
            />
          </Field>
          <Field label="Per-iteration delay (ms)" hint="Optional, 0 = no delay">
            <input
              type="number"
              min={0}
              value={rawDelay}
              onChange={(e) => setRawDelay(e.target.value)}
              onBlur={commitDelay}
              className="field w-full"
            />
          </Field>
          <Field label="Expected status codes" hint="Comma-separated, e.g. 200,201">
            <input
              type="text"
              value={config.expectStatus}
              onChange={(e) =>
                activeTab &&
                updateLoadTestConfig(activeTab.id, { expectStatus: e.target.value })
              }
              placeholder="200"
              className="field w-full font-mono"
            />
          </Field>
          <div className="col-span-2">
            <Field
              label="Response body must contain"
              hint="Optional substring that every response must include"
            >
              <input
                type="text"
                value={config.expectBody}
                onChange={(e) =>
                  activeTab &&
                  updateLoadTestConfig(activeTab.id, { expectBody: e.target.value })
                }
                placeholder='{"success":true}'
                className="field w-full font-mono"
              />
            </Field>
          </div>
          {/* Task 3: save failed bodies config */}
          <div className="col-span-2 flex items-start gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={config.saveFailedBodies}
                onChange={(e) =>
                  activeTab &&
                  updateLoadTestConfig(activeTab.id, {
                    saveFailedBodies: e.target.checked,
                  })
                }
                className="h-3.5 w-3.5 accent-accent"
              />
              Save failed responses
            </label>
            {config.saveFailedBodies && (
              <Field label="Limit" hint="Max failed bodies (1–1000)">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={rawFailedBodyLimit}
                  onChange={(e) => setRawFailedBodyLimit(e.target.value)}
                  onBlur={commitFailedBodyLimit}
                  className="field w-24"
                />
              </Field>
            )}
          </div>
        </div>
      )}

      {/* Waiting for first response */}
      {running && !progress && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="spinner h-5 w-5" aria-hidden="true" />
          <div className="text-sm font-medium text-ink-2">Sending requests…</div>
          <div className="text-xs text-ink-3">Waiting for the first response.</div>
          {(config?.expectStatus.trim() || config?.expectBody.trim()) && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-ink-4">
                Validating
              </span>
              {config?.expectStatus.trim() && (
                <span className="rounded bg-bg-muted px-2 py-0.5 font-mono text-ink-2">
                  status&nbsp;=&nbsp;{config.expectStatus}
                </span>
              )}
              {config?.expectBody.trim() && (
                <span
                  className="max-w-[240px] truncate rounded bg-bg-muted px-2 py-0.5 font-mono text-ink-2"
                  title={`Response body must contain: ${config.expectBody}`}
                >
                  body ⊃ &quot;{config.expectBody}&quot;
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metrics — sticky above the events log */}
      {progress && (
        <div className="border-b border-line px-5 py-4">
          {(config?.expectStatus.trim() || config?.expectBody.trim()) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-ink-4">
                Validating
              </span>
              {config?.expectStatus.trim() && (
                <span
                  className="rounded bg-bg-muted px-2 py-0.5 font-mono text-ink-2"
                  title="Expected status code(s)"
                >
                  status&nbsp;=&nbsp;{config.expectStatus}
                </span>
              )}
              {config?.expectBody.trim() && (
                <span
                  className="max-w-[240px] truncate rounded bg-bg-muted px-2 py-0.5 font-mono text-ink-2"
                  title={`Response body must contain: ${config.expectBody}`}
                >
                  body ⊃ &quot;{config.expectBody}&quot;
                </span>
              )}
            </div>
          )}
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-muted">
            <div
              className="h-full bg-accent transition-[width] duration-100"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="grid grid-cols-6 gap-3">
            <Metric label="Sent" value={`${progress.sent}/${progress.totalTarget}`} />
            <Metric
              label="Success rate"
              value={`${successRate}%`}
              tone={
                parseFloat(successRate) >= 95
                  ? 'ok'
                  : parseFloat(successRate) >= 80
                    ? 'warn'
                    : 'err'
              }
              description="Percentage of requests that passed validation"
            />
            <Metric
              label="RPS"
              value={progress.currentRps.toFixed(1)}
              description="Requests completed per second (current rate)"
            />
            <Metric
              label="Inflight"
              value={String(progress.inflight)}
              description="Number of requests currently in-flight"
            />
            <Metric
              label="Failed"
              value={String(progress.failed)}
              tone="err"
              description="Requests that received no response (network error / timeout)"
            />
            <Metric
              label="Validation fail"
              value={String(progress.validationFailures)}
              tone="warn"
              description="Requests that got a response but failed status/body validation"
            />
            <Metric
              label="p50"
              value={`${progress.latencyP50.toFixed(0)}ms`}
              description="50% of completed requests finished at or below this latency"
            />
            <Metric
              label="p95"
              value={`${progress.latencyP95.toFixed(0)}ms`}
              description="95% of completed requests finished at or below this latency"
            />
            <Metric
              label="p99"
              value={`${progress.latencyP99.toFixed(0)}ms`}
              description="99% of completed requests finished at or below this latency"
            />
            <Metric
              label="min"
              value={`${progress.latencyMin.toFixed(0)}ms`}
              description="Minimum observed latency"
            />
            <Metric
              label="max"
              value={`${progress.latencyMax.toFixed(0)}ms`}
              description="Maximum observed latency"
            />
            <Metric
              label="Elapsed"
              value={`${(progress.elapsedMs / 1000).toFixed(1)}s`}
            />
          </div>

          {(statusEntries.length > 0 || errorEntries.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {statusEntries.map(([status, count]) => (
                <span
                  key={status}
                  className="rounded bg-bg-muted px-2 py-0.5 font-mono text-[10px] text-ink-2"
                >
                  {status} · {count}
                </span>
              ))}
              {errorEntries.map(([kind, count]) => (
                <span
                  key={kind}
                  className="rounded bg-method-delete/10 px-2 py-0.5 font-mono text-[10px] text-method-delete"
                >
                  {kind} · {count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Events log — fixed-height scroll area (Task 1) */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Log header with auto-scroll toggle */}
        {(events.length > 0 || progress) && (
          <div className="flex items-center justify-between border-b border-line px-4 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
              Events
              {events.length > 0 && (
                <span className="ml-1.5 rounded-full bg-bg-muted px-1.5 text-[10px] font-semibold text-ink-3">
                  {events.length}
                </span>
              )}
            </span>
            <button
              onClick={() => setAutoScroll((v) => !v)}
              title="Toggle auto-scroll"
              className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                autoScroll
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
              }`}
            >
              Auto-scroll
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-[40vh] overflow-y-auto bg-bg-subtle p-4 font-mono text-[11px] leading-[18px]"
        >
          {events.length === 0 && !progress && (
            <div className="text-ink-4">
              Configure the run above and press <span className="text-ink-2">Start</span>.
            </div>
          )}
          {events.map((ev) => (
            <EventLine key={ev.iteration} event={ev} />
          ))}
          {finished && (
            <div className="mt-2 text-ink-3">
              — Done in {(progress!.elapsedMs / 1000).toFixed(2)}s ·{' '}
              {progress!.succeeded} ok / {progress!.sent} sent ·{' '}
              {successRate}% success
            </div>
          )}
        </div>

        {/* Task 3: Failures sub-panel */}
        {failedBodies.length > 0 && (
          <FailuresPanel
            failures={failedBodies}
            onExport={exportFailures}
            onClear={() => activeTab && clearFailedBodies(activeTab.id)}
          />
        )}
      </div>
    </div>
  );
}

import type { LoadEvent } from '@scrapeman/shared-types';

function EventLine({ event }: { event: LoadEvent }): JSX.Element {
  const prefix = event.valid
    ? '✓'
    : event.errorKind
      ? '✗'
      : '!';
  const color = event.valid
    ? 'text-status-ok'
    : event.errorKind
      ? 'text-method-delete'
      : 'text-status-clientError';
  return (
    <div className={color}>
      <span className="mr-1">{prefix}</span>
      <span className="text-ink-4">#{String(event.iteration).padStart(5, '0')} </span>
      <span className="text-ink-2">
        {event.status === 0 ? '---' : event.status}
      </span>{' '}
      <span className="text-ink-4">{event.durationMs}ms</span>
      {event.errorMessage && (
        <span className="ml-2 text-method-delete">{event.errorMessage}</span>
      )}
      {!event.valid && !event.errorKind && (
        <span className="ml-2 text-status-clientError">validation failed</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Failures sub-panel (Task 3)
// ---------------------------------------------------------------------------

function FailuresPanel({
  failures,
  onExport,
  onClear,
}: {
  failures: LoadFailedBodyEvent[];
  onExport: () => void;
  onClear: () => void;
}): JSX.Element {
  const [expandedIteration, setExpandedIteration] = useState<number | null>(null);

  return (
    <div className="border-t border-line">
      {/* Sub-panel header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
          Failures
          <span className="ml-1.5 rounded-full bg-method-delete/10 px-1.5 text-[10px] font-semibold text-method-delete">
            {failures.length}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            className="text-[10px] text-ink-3 hover:text-ink-1"
            title="Export failures as JSON"
          >
            Export JSON
          </button>
          <button
            onClick={onClear}
            className="text-[10px] text-ink-3 hover:text-ink-1"
            title="Clear captured failures"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Failure rows */}
      <div className="max-h-[30vh] overflow-y-auto">
        {failures.map((f) => (
          <FailureRow
            key={f.iteration}
            failure={f}
            expanded={expandedIteration === f.iteration}
            onToggle={() =>
              setExpandedIteration((prev) =>
                prev === f.iteration ? null : f.iteration,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function FailureRow({
  failure,
  expanded,
  onToggle,
}: {
  failure: LoadFailedBodyEvent;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  // Decode body for display.
  const bodyText = useMemo(() => {
    if (!failure.bodyBase64) return '';
    try {
      return atob(failure.bodyBase64);
    } catch {
      return failure.bodyBase64;
    }
  }, [failure.bodyBase64]);

  // Pretty-print if JSON.
  const displayBody = useMemo(() => {
    if (!bodyText) return '';
    try {
      return JSON.stringify(JSON.parse(bodyText), null, 2);
    } catch {
      return bodyText;
    }
  }, [bodyText]);

  const reason =
    failure.validationFailureReason ?? (failure.errorKind ? `error: ${failure.errorKind}` : '');

  return (
    <div className="border-b border-line last:border-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-bg-hover"
      >
        {/* Chevron */}
        <span className="text-ink-4" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="font-mono text-[10px] text-ink-4">
          #{String(failure.iteration).padStart(5, '0')}
        </span>
        <span
          className={`font-mono text-[11px] font-semibold ${
            failure.status === 0
              ? 'text-method-delete'
              : failure.status >= 500
                ? 'text-method-delete'
                : failure.status >= 400
                  ? 'text-status-clientError'
                  : 'text-ink-2'
          }`}
        >
          {failure.status === 0 ? '---' : failure.status}
        </span>
        <span className="font-mono text-[10px] text-ink-4">{failure.durationMs}ms</span>
        {reason && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-ink-3" title={reason}>
            {reason}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-line bg-bg-subtle px-4 py-3">
          {displayBody ? (
            <pre className="max-h-[20vh] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-ink-2">
              {displayBody}
            </pre>
          ) : (
            <div className="font-mono text-[11px] text-ink-4">
              {failure.errorKind ? `No body captured (${failure.errorKind})` : 'Empty response body'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </label>
      {children}
      {hint && <div className="text-[10px] text-ink-4">{hint}</div>}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  description,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'err';
  description?: string;
}): JSX.Element {
  const color =
    tone === 'ok'
      ? 'text-status-ok'
      : tone === 'warn'
        ? 'text-status-clientError'
        : tone === 'err'
          ? 'text-method-delete'
          : 'text-ink-1';

  const inner = (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-4">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );

  if (!description) return inner;

  return (
    <Tooltip label={description} side="top">
      {inner}
    </Tooltip>
  );
}

function buildRequestFromBuilder(builder: BuilderState, name: string) {
  const headers: Record<string, string> = {};
  for (const row of builder.headers) {
    if (row.enabled && row.key.trim()) headers[row.key.trim()] = row.value;
  }
  const request = {
    scrapeman: FORMAT_VERSION,
    meta: { name },
    method: builder.method,
    url: builder.url,
  } as const;
  const out: Record<string, unknown> = { ...request };
  if (Object.keys(headers).length > 0) out['headers'] = headers;
  if (builder.bodyType !== 'none' && builder.body.trim().length > 0) {
    out['body'] = { type: builder.bodyType, content: builder.body };
  }
  if (builder.auth.type !== 'none') out['auth'] = builder.auth;
  if (builder.settings.proxy.enabled && builder.settings.proxy.url.trim()) {
    out['proxy'] = builder.settings.proxy;
  }
  if (builder.settings.scrapeDo.enabled && builder.settings.scrapeDo.token.trim()) {
    out['scrapeDo'] = builder.settings.scrapeDo;
  }
  return out as never;
}
