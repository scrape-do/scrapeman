import { useMemo, useState } from 'react';
import type { HistoryEntry } from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/ContextMenu.js';
import { ConfirmDialog } from '../ui/Dialog.js';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

export function HistoryPanel(): JSX.Element {
  const history = useAppStore((s) => s.history);
  const restore = useAppStore((s) => s.restoreHistoryEntry);
  const deleteEntry = useAppStore((s) => s.deleteHistoryEntry);
  const clearAll = useAppStore((s) => s.clearHistory);

  const [expanded, setExpanded] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((e) => {
      if (e.method.toLowerCase().includes(q)) return true;
      if (e.url.toLowerCase().includes(q)) return true;
      if (String(e.status).includes(q)) return true;
      return false;
    });
  }, [history, query]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <div className="flex h-full flex-col border-t border-line">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex h-9 flex-shrink-0 items-center gap-1.5 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-3 hover:bg-bg-hover hover:text-ink-1"
      >
        <span className="w-3 text-center text-[9px]">{expanded ? '▾' : '▸'}</span>
        <span className="flex-1">History</span>
        <span className="text-ink-4">{history.length}</span>
        {history.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmClear(true);
            }}
            className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-4 hover:bg-bg-active hover:text-method-delete"
            title="Clear history"
          >
            clear
          </button>
        )}
      </button>
      {expanded && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {history.length > 0 && (
            <div className="sticky top-0 z-10 flex-shrink-0 border-b border-line bg-bg-canvas px-2 py-1.5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search history…"
                className="h-6 w-full rounded border border-line bg-bg-sunken px-2 text-[11px] text-ink-1 placeholder:text-ink-4 focus:border-accent focus:outline-none"
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto pb-1">
            {history.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-ink-4">
                No requests sent yet. Hit Send to start populating history.
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-ink-4">
                No matches for “{query}”.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  <div className="sticky top-0 z-[5] flex items-center gap-1.5 bg-bg-canvas/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3 backdrop-blur">
                    <span className="flex-1">{group.label}</span>
                    <span className="text-ink-4">{group.entries.length}</span>
                  </div>
                  {group.entries.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onRestore={() => restore(entry)}
                      onDelete={() => void deleteEntry(entry.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear history?"
        description="Every saved request and response preview for this workspace will be deleted from disk."
        confirmLabel="Clear all"
        destructive
        onConfirm={() => void clearAll()}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}

function HistoryRow({
  entry,
  onRestore,
  onDelete,
}: {
  entry: HistoryEntry;
  onRestore: () => void;
  onDelete: () => void;
}): JSX.Element {
  const color = METHOD_COLOR[entry.method] ?? 'text-method-custom';
  const statusColor =
    entry.status === 0
      ? 'bg-method-delete/10 text-method-delete'
      : entry.status >= 200 && entry.status < 300
        ? 'bg-status-ok/10 text-status-ok'
        : entry.status >= 300 && entry.status < 400
          ? 'bg-status-redirect/10 text-status-redirect'
          : entry.status >= 400 && entry.status < 500
            ? 'bg-status-clientError/10 text-status-clientError'
            : 'bg-status-serverError/10 text-status-serverError';

  const label = useMemo(() => formatUrlLabel(entry.url), [entry.url]);
  const relative = useMemo(() => relativeTime(entry.sentAt), [entry.sentAt]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onRestore}
          className="group flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover"
        >
          <span className={`w-11 font-mono text-[10px] font-semibold uppercase ${color}`}>
            {entry.method.slice(0, 6)}
          </span>
          <span
            className={`rounded px-1.5 font-mono text-[10px] font-semibold ${statusColor}`}
          >
            {entry.status === 0 ? 'err' : entry.status}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-ink-1">{label}</div>
            <div className="truncate text-[10px] text-ink-4">
              {relative} · {entry.durationMs} ms
              {entry.environmentName ? ` · ${entry.environmentName}` : ''}
            </div>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRestore}>Restore in new tab</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={onDelete}>
          Delete entry
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function formatUrlLabel(url: string): string {
  // Raw string slicing so {{var}} templates survive untouched — the URL
  // constructor would normalize `{` and `}` to %7B / %7D.
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url);
  const start = schemeMatch ? schemeMatch[0].length : 0;
  return url.slice(start);
}

type HistoryGroup = { key: string; label: string; entries: HistoryEntry[] };

function groupByDate(entries: HistoryEntry[]): HistoryGroup[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
  );

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const currentYear = now.getFullYear();

  const buckets = new Map<string, HistoryGroup>();
  const order: string[] = [];
  const push = (key: string, label: string, entry: HistoryEntry): void => {
    let g = buckets.get(key);
    if (!g) {
      g = { key, label, entries: [] };
      buckets.set(key, g);
      order.push(key);
    }
    g.entries.push(entry);
  };

  for (const entry of sorted) {
    const t = new Date(entry.sentAt).getTime();
    if (t >= todayStart) {
      push('today', 'Today', entry);
    } else if (t >= yesterdayStart) {
      push('yesterday', 'Yesterday', entry);
    } else {
      const d = new Date(entry.sentAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
      const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const label =
        d.getFullYear() === currentYear
          ? `${weekday}, ${monthDay}`
          : `${monthDay}, ${d.getFullYear()}`;
      push(key, label, entry);
    }
  }

  return order.map((k) => buckets.get(k)!);
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
