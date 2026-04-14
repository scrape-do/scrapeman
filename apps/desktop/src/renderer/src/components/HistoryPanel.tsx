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
        <div className="flex-1 overflow-y-auto pb-1">
          {history.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-ink-4">
              No requests sent yet. Hit Send to start populating history.
            </div>
          ) : (
            history.map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onRestore={() => restore(entry)}
                onDelete={() => void deleteEntry(entry.id)}
              />
            ))
          )}
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
