import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
import type { LoadEvent, LoadProgress } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore, type BuilderState } from '../store.js';

export function LoadTestDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const workspace = useAppStore((s) => s.workspace);

  const [total, setTotal] = useState(100);
  const [concurrency, setConcurrency] = useState(10);
  const [delay, setDelay] = useState(0);
  const [expectStatus, setExpectStatus] = useState('200');
  const [expectBody, setExpectBody] = useState('');

  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [events, setEvents] = useState<LoadEvent[]>([]);
  const [starting, setStarting] = useState(false);

  const consoleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setRunId(null);
      setProgress(null);
      setEvents([]);
      setStarting(false);
    }
  }, [open]);

  useEffect(() => {
    return bridge.onLoadProgress((p) => {
      if (!runId || p.runId !== runId) return;
      setProgress(p);
      if (p.lastEvent) {
        setEvents((prev) => {
          const next = [...prev, p.lastEvent!];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    });
  }, [runId]);

  // Auto-scroll console to bottom on new events.
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [events.length]);

  const start = async (): Promise<void> => {
    if (!activeTab) return;
    setStarting(true);
    setEvents([]);
    setProgress(null);
    try {
      const request = buildRequestFromBuilder(activeTab.builder, activeTab.name);
      const id = await bridge.loadStart({
        request,
        ...(workspace?.path ? { workspacePath: workspace.path } : {}),
        total,
        concurrency,
        ...(delay > 0 ? { perIterDelayMs: delay } : {}),
        validator: {
          ...(expectStatus.trim()
            ? {
                expectStatus: expectStatus
                  .split(',')
                  .map((s) => parseInt(s.trim(), 10))
                  .filter((n) => !Number.isNaN(n)),
              }
            : {}),
          ...(expectBody.trim() ? { expectBodyContains: expectBody } : {}),
        },
      });
      setRunId(id);
    } finally {
      setStarting(false);
    }
  };

  const stop = async (): Promise<void> => {
    if (runId) await bridge.loadStop(runId);
  };

  const reset = (): void => {
    setRunId(null);
    setProgress(null);
    setEvents([]);
  };

  const running = runId !== null && progress !== null && !progress.done;
  const finished = progress !== null && progress.done;

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

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[900px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="text-sm font-semibold text-ink-1">
                Load test · {activeTab?.name ?? 'current request'}
              </RadixDialog.Title>
              <RadixDialog.Description className="mt-0.5 text-xs text-ink-3">
                Fires the current request N times with bounded concurrency.
                Validates each response locally and tracks the success rate.
              </RadixDialog.Description>
            </div>
            <div className="flex items-center gap-2">
              {!running && !finished && (
                <button
                  onClick={() => void start()}
                  disabled={starting || !activeTab}
                  className="btn-primary"
                  title="Start load test"
                >
                  {starting ? 'Starting…' : 'Start'}
                </button>
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
              <button onClick={onClose} className="btn-ghost" title="Close dialog">
                Close
              </button>
            </div>
          </div>

          {/* Config form — hidden once run is in flight */}
          {!running && !finished && (
            <div className="grid grid-cols-2 gap-4 border-b border-line px-5 py-4">
              <Field label="Total requests" hint="Total number of iterations">
                <input
                  type="number"
                  min={1}
                  value={total}
                  onChange={(e) =>
                    setTotal(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  className="field w-full"
                />
              </Field>
              <Field label="Concurrency" hint="Max parallel in-flight">
                <input
                  type="number"
                  min={1}
                  value={concurrency}
                  onChange={(e) =>
                    setConcurrency(
                      Math.max(1, parseInt(e.target.value, 10) || 1),
                    )
                  }
                  className="field w-full"
                />
              </Field>
              <Field label="Per-iteration delay (ms)" hint="Optional, 0 = no delay">
                <input
                  type="number"
                  min={0}
                  value={delay}
                  onChange={(e) =>
                    setDelay(Math.max(0, parseInt(e.target.value, 10) || 0))
                  }
                  className="field w-full"
                />
              </Field>
              <Field label="Expected status codes" hint="Comma-separated, e.g. 200,201">
                <input
                  type="text"
                  value={expectStatus}
                  onChange={(e) => setExpectStatus(e.target.value)}
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
                    value={expectBody}
                    onChange={(e) => setExpectBody(e.target.value)}
                    placeholder='{"success":true}'
                    className="field w-full font-mono"
                  />
                </Field>
              </div>
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
                />
                <Metric label="RPS" value={progress.currentRps.toFixed(1)} />
                <Metric label="Inflight" value={String(progress.inflight)} />
                <Metric label="Failed" value={String(progress.failed)} tone="err" />
                <Metric
                  label="Validation fail"
                  value={String(progress.validationFailures)}
                  tone="warn"
                />
                <Metric label="p50" value={`${progress.latencyP50.toFixed(0)}ms`} />
                <Metric label="p95" value={`${progress.latencyP95.toFixed(0)}ms`} />
                <Metric label="p99" value={`${progress.latencyP99.toFixed(0)}ms`} />
                <Metric label="min" value={`${progress.latencyMin.toFixed(0)}ms`} />
                <Metric label="max" value={`${progress.latencyMax.toFixed(0)}ms`} />
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

          {/* Console */}
          <div
            ref={consoleRef}
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
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

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
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'err';
}): JSX.Element {
  const color =
    tone === 'ok'
      ? 'text-status-ok'
      : tone === 'warn'
        ? 'text-status-clientError'
        : tone === 'err'
          ? 'text-method-delete'
          : 'text-ink-1';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-4">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
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
