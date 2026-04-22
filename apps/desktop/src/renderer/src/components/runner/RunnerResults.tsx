import { useState } from 'react';
import type { RunnerRequestResult } from '@scrapeman/shared-types';
import { useAppStore } from '../../store.js';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

function statusColor(status: number): string {
  if (status === 0) return 'text-red-400';
  if (status < 300) return 'text-method-get';
  if (status < 400) return 'text-method-patch';
  return 'text-red-400';
}

interface ResultRowProps {
  result: RunnerRequestResult;
}

function ResultRow({ result }: ResultRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-line last:border-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover"
      >
        {result.ok ? (
          <span className="flex-shrink-0 text-sm leading-none text-green-400" aria-hidden>✓</span>
        ) : (
          <span className="flex-shrink-0 text-sm leading-none text-red-400" aria-hidden>✗</span>
        )}
        <span className="w-5 text-[10px] text-ink-4">{result.iteration + 1}</span>
        <span
          className={`w-12 font-mono text-xs font-semibold uppercase ${
            METHOD_COLOR[result.method] ?? 'text-method-custom'
          }`}
        >
          {result.method || '—'}
        </span>
        <span className="flex-1 truncate text-xs text-ink-1">{result.requestName}</span>
        <span className={`w-10 text-right font-mono text-xs font-semibold ${statusColor(result.status)}`}>
          {result.status === 0 ? 'ERR' : result.status}
        </span>
        <span className="w-16 text-right text-xs text-ink-3">{result.durationMs} ms</span>
        <span className="flex-shrink-0 text-[10px] text-ink-4" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-line bg-bg-subtle px-3 py-2">
          {/* URL */}
          {result.url && (
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-4">
                URL
              </div>
              <div className="mt-0.5 break-all font-mono text-xs text-ink-2">{result.url}</div>
            </div>
          )}

          {/* Error */}
          {result.errorMessage && (
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-red-400">
                Error
              </div>
              <div className="mt-0.5 text-xs text-red-300">{result.errorMessage}</div>
            </div>
          )}

          {/* Response headers */}
          {result.responseHeaders.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-4">
                Response headers
              </div>
              <div className="mt-0.5 space-y-0.5">
                {result.responseHeaders.map(([name, value], i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="w-36 flex-shrink-0 font-medium text-ink-3">{name}</span>
                    <span className="flex-1 break-all text-ink-2">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Body preview */}
          {result.bodyPreview && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-4">
                Body preview
              </div>
              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-ink-2">
                {result.bodyPreview.slice(0, 2000)}
                {result.bodyPreview.length > 2000 ? '\n…(truncated)' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RunnerResults(): JSX.Element {
  const runner = useAppStore((s) => s.runner);
  const exportReport = useAppStore((s) => s.exportRunnerReport);

  const activeRun = runner.activeRunId ? runner.runs.get(runner.activeRunId) : null;

  if (!activeRun) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-4">
        No run yet. Configure and click &ldquo;Run collection&rdquo;.
      </div>
    );
  }

  const total = activeRun.totalRequests * Math.max(1, activeRun.totalIterations);
  const progress = total > 0 ? (activeRun.completedRequests / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3">
        {activeRun.running && (
          <span className="flex-shrink-0 animate-spin text-base leading-none text-accent" aria-hidden>
            ⟳
          </span>
        )}
        <div className="flex flex-1 items-center gap-4 text-xs">
          <span className="font-semibold text-ink-1">
            {activeRun.completedRequests} / {total}
          </span>
          <span className="text-green-400">{activeRun.succeeded} passed</span>
          <span className="text-red-400">{activeRun.failed} failed</span>
          {activeRun.aborted && (
            <span className="text-orange-400">aborted</span>
          )}
          {!activeRun.running && !activeRun.aborted && (
            <span className="text-ink-3">done</span>
          )}
        </div>

        {/* Export buttons — only after run completes */}
        {!activeRun.running && (
          <div className="flex gap-1">
            {(['json', 'csv', 'html'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => void exportReport(fmt)}
                className="rounded border border-line px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-3 hover:border-accent hover:text-accent"
              >
                {fmt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-bg-hover">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>

      {/* Results list */}
      <div className="overflow-auto rounded border border-line">
        {activeRun.results.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-ink-4">
            Waiting for first result…
          </div>
        ) : (
          activeRun.results.map((r, i) => (
            <ResultRow
              key={`${r.iteration}-${r.requestIndex}-${i}`}
              result={r}
            />
          ))
        )}
      </div>
    </div>
  );
}
