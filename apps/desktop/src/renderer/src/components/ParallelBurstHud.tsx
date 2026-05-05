import { useEffect, useMemo } from 'react';
import { useAppStore, type ParallelBurstEntry } from '../store.js';

const AUTO_HIDE_DELAY_MS = 2200;
// Stable empty-array reference. Used as the fallback so the Zustand
// selector returns the same value when no bursts are pending — without
// it we'd return a fresh `[]` literal on every store mutation, which
// re-renders this component for every unrelated store change.
const EMPTY: ParallelBurstEntry[] = [];

/**
 * Floating HUD that appears in the bottom-right while Cmd+R parallel
 * sends are in flight. Lists each fired request with a status dot
 * (pending → success / error) and the response time. Auto-hides a
 * couple of seconds after every entry has settled. Mirrors Insomnia's
 * transient burst panel.
 */
export function ParallelBurstHud(): JSX.Element | null {
  const bursts = useAppStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.parallelBursts ?? EMPTY,
  );
  const clear = useAppStore((s) => s.clearParallelBursts);

  const allDone = useMemo(
    () => bursts.length > 0 && bursts.every((b) => b.status !== 'pending'),
    [bursts],
  );

  // Auto-clear once everything has settled and the user has had a moment
  // to read the result. The × button uses the same `clear` action.
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => clear(), AUTO_HIDE_DELAY_MS);
    return () => clearTimeout(t);
  }, [allDone, clear]);

  if (bursts.length === 0) return null;

  const pendingCount = bursts.filter((b) => b.status === 'pending').length;
  const successCount = bursts.filter((b) => b.status === 'success').length;
  const errorCount = bursts.filter((b) => b.status === 'error').length;

  return (
    <div
      className="pointer-events-auto fixed bottom-9 right-3 z-40 flex w-[280px] flex-col overflow-hidden rounded-md border border-line bg-bg-canvas text-xs shadow-popover animate-slide-down-fade"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-bg-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink-1">Parallel sends</span>
          <span className="font-mono text-[10px] text-ink-4">
            {bursts.length} total
          </span>
        </div>
        <div className="flex items-center gap-1">
          {pendingCount > 0 && (
            <span className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
              {pendingCount} in flight
            </span>
          )}
          {successCount > 0 && (
            <span className="rounded bg-status-ok/15 px-1.5 py-0.5 font-mono text-[10px] text-status-ok">
              {successCount} ok
            </span>
          )}
          {errorCount > 0 && (
            <span className="rounded bg-method-delete/15 px-1.5 py-0.5 font-mono text-[10px] text-method-delete">
              {errorCount} err
            </span>
          )}
          <button
            type="button"
            onClick={clear}
            title="Dismiss"
            className="ml-1 flex h-5 w-5 items-center justify-center rounded text-ink-4 hover:bg-bg-hover hover:text-ink-1"
            aria-label="Dismiss parallel send HUD"
          >
            ×
          </button>
        </div>
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {[...bursts].reverse().map((entry, idx) => (
          <BurstRow key={entry.id} entry={entry} index={bursts.length - idx} />
        ))}
      </div>
    </div>
  );
}

function BurstRow({
  entry,
  index,
}: {
  entry: ParallelBurstEntry;
  index: number;
}): JSX.Element {
  const dotClass =
    entry.status === 'pending'
      ? 'bg-ink-4 animate-pulse'
      : entry.status === 'success'
        ? entry.httpStatus !== undefined && entry.httpStatus >= 400
          ? 'bg-status-clientError'
          : 'bg-status-ok'
        : 'bg-method-delete';

  return (
    <div className="grid grid-cols-[20px_28px_1fr_auto] items-center gap-2 border-b border-line-subtle px-3 py-1.5 last:border-0">
      <span className="font-mono text-[10px] text-ink-4">#{index}</span>
      <span className="flex h-2 w-2 items-center justify-self-center">
        <span className={`block h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
      </span>
      <span className="font-mono text-[11px] text-ink-2">
        {entry.status === 'pending'
          ? 'sending…'
          : entry.status === 'success'
            ? entry.httpStatus !== undefined
              ? entry.httpStatus
              : 'done'
            : entry.errorMessage ?? 'error'}
      </span>
      <span className="font-mono text-[10px] text-ink-4">
        {entry.durationMs !== undefined ? `${entry.durationMs}ms` : ''}
      </span>
    </div>
  );
}
