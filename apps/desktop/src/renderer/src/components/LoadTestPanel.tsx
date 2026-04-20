import { useMemo, useRef } from 'react';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
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

  // Read load test state directly from the active tab.
  const loadTest = activeTab?.loadTest ?? null;
  const config = loadTest?.config;
  const { runId, progress, events, starting, startError } = loadTest ?? {
    runId: null,
    progress: null,
    events: [],
    starting: false,
    startError: null,
  };

  const consoleRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll console to bottom on new events.
  const eventsLen = events.length;
  // We cannot call useEffect here conditionally, but eventsLen is stable enough
  // to drive a ref-based scroll without a useEffect. We use a callback ref
  // pattern instead so it runs synchronously after render.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = (el: HTMLDivElement | null): void => {
    scrollRef.current = el;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const start = async (): Promise<void> => {
    if (!activeTab) return;
    const tabId = activeTab.id;
    const cfg = activeTab.loadTest.config;
    setLoadTestRun(tabId, { runId: null, starting: true, startError: null });
    // Clear previous events and progress for a fresh run.
    clearLoadTest(tabId);
    setLoadTestRun(tabId, { runId: null, starting: true, startError: null });
    try {
      const request = buildRequestFromBuilder(activeTab.builder, activeTab.name);
      const id = await bridge.loadStart({
        request,
        ...(workspace?.path ? { workspacePath: workspace.path } : {}),
        total: cfg.total,
        concurrency: cfg.concurrency,
        ...(cfg.delay > 0 ? { perIterDelayMs: cfg.delay } : {}),
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
      });
      setLoadTestRun(tabId, { runId: id, starting: false, startError: null });
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

  // Suppress unused warning for eventsLen — it drives the key on the scroll container.
  void eventsLen;

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
          <Field label="Total requests" hint="Total number of iterations">
            <input
              type="number"
              min={1}
              value={config.total}
              onChange={(e) =>
                activeTab &&
                updateLoadTestConfig(activeTab.id, {
                  total: Math.max(1, parseInt(e.target.value, 10) || 1),
                })
              }
              className="field w-full"
            />
          </Field>
          <Field label="Concurrency" hint="Max parallel in-flight">
            <input
              type="number"
              min={1}
              value={config.concurrency}
              onChange={(e) =>
                activeTab &&
                updateLoadTestConfig(activeTab.id, {
                  concurrency: Math.max(1, parseInt(e.target.value, 10) || 1),
                })
              }
              className="field w-full"
            />
          </Field>
          <Field label="Per-iteration delay (ms)" hint="Optional, 0 = no delay">
            <input
              type="number"
              min={0}
              value={config.delay}
              onChange={(e) =>
                activeTab &&
                updateLoadTestConfig(activeTab.id, {
                  delay: Math.max(0, parseInt(e.target.value, 10) || 0),
                })
              }
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
        </div>
      )}

      {/* Waiting for first response */}
      {running && !progress && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="spinner h-5 w-5" aria-hidden="true" />
          <div className="text-sm font-medium text-ink-2">Sending requests…</div>
          <div className="text-xs text-ink-3">Waiting for the first response.</div>
        </div>
      )}

      {/* Metrics */}
      {progress && (
        <div className="border-b border-line px-5 py-4">
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

      {/* Console — key on eventsLen so the ref callback fires on every new event */}
      <div
        key={eventsLen}
        ref={setScrollRef}
        className="flex-1 overflow-y-auto bg-bg-subtle p-4 font-mono text-[11px] leading-[18px]"
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
