import { useCallback, useEffect, useState } from 'react';
import type { AutoHeaderPreviewRow } from '@scrapeman/shared-types';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import type { BuilderState } from '../store.js';

// Convert the minimal builder fields needed by previewHeaders into a
// ScrapemanRequest. We only populate what buildAutoHeaders inspects
// (body type and user headers) so the IPC payload is small.
function builderToRequest(builder: BuilderState) {
  const headers: Record<string, string> = {};
  for (const row of builder.headers) {
    if (row.enabled && row.key.trim()) headers[row.key.trim()] = row.value;
  }
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: '' },
    method: builder.method,
    url: builder.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(builder.bodyType !== 'none' && builder.body.trim()
      ? { body: { type: builder.bodyType, content: builder.body } as const }
      : {}),
    ...(builder.disabledAutoHeaders.length > 0
      ? { disabledAutoHeaders: [...builder.disabledAutoHeaders] }
      : {}),
  };
}

// Auto badge shown on rows sourced from Scrapeman's automatic header logic.
function AutoBadge(): JSX.Element {
  return (
    <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-4">
      auto
    </span>
  );
}

// Shown when a user header key matches an auto header — the user value wins.
function OverrideBadge(): JSX.Element {
  return (
    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
      overridden
    </span>
  );
}

interface RowProps {
  row: AutoHeaderPreviewRow;
  isDisabled: boolean;
  isOverridden: boolean;
  onToggle: () => void;
}

function HeaderRow({ row, isDisabled, isOverridden, onToggle }: RowProps): JSX.Element {
  const dimmed = isDisabled || isOverridden;
  const isUserSource = row.source === 'user';

  return (
    <div className="grid grid-cols-[32px_1fr_1.5fr_auto] items-center border-b border-line-subtle px-3 py-1">
      {/* Toggle checkbox — only auto headers are toggleable */}
      <div className="flex items-center justify-center">
        {isUserSource ? (
          <span className="text-ink-4" aria-hidden="true">—</span>
        ) : (
          <input
            type="checkbox"
            checked={!isDisabled && !isOverridden}
            disabled={isOverridden}
            onChange={onToggle}
            aria-label={`Toggle ${row.key}`}
            className="h-3.5 w-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed"
          />
        )}
      </div>

      {/* Header name */}
      <div
        className={`py-1 font-mono text-xs ${
          dimmed ? 'text-ink-4 line-through' : 'text-ink-2'
        }`}
      >
        {row.key}
      </div>

      {/* Header value */}
      <div className="truncate py-1 font-mono text-xs text-ink-3">
        {row.value}
      </div>

      {/* Badge */}
      <div className="pl-2">
        {isOverridden && <OverrideBadge />}
        {!isOverridden && row.source === 'auto' && <AutoBadge />}
      </div>
    </div>
  );
}

export function AutoHeadersPanel({
  builder,
  onChange,
}: {
  builder: BuilderState;
  onChange: (disabled: string[]) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AutoHeaderPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Lowercase set of user header keys — used to detect which auto headers
  // are overridden without changing the source field from the IPC response.
  const userKeys = new Set(
    builder.headers
      .filter((h) => h.enabled && h.key.trim())
      .map((h) => h.key.trim().toLowerCase()),
  );

  const disabledSet = new Set(
    builder.disabledAutoHeaders.map((k) => k.toLowerCase()),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await bridge.previewHeaders(builderToRequest(builder));
      setRows(result.rows);
    } catch (err) {
      console.error('[AutoHeadersPanel] previewHeaders failed:', err);
    } finally {
      setLoading(false);
    }
  }, [builder]);

  // Refresh automatically when the panel opens, and whenever the builder
  // changes while the panel is open.
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const toggle = (key: string): void => {
    const lower = key.toLowerCase();
    const next = disabledSet.has(lower)
      ? builder.disabledAutoHeaders.filter((k) => k.toLowerCase() !== lower)
      : [...builder.disabledAutoHeaders, key];
    onChange(next);
  };

  const autoCount = rows.filter((r) => r.source === 'auto').length;

  return (
    <div className="border-b border-line bg-bg-subtle/40">
      {/* Collapsible header bar */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-4 hover:text-ink-2"
        aria-expanded={open}
        title="Toggle auto headers"
      >
        <span>
          Auto Headers{autoCount > 0 ? ` (${autoCount})` : ''}
          {builder.disabledAutoHeaders.length > 0 && (
            <span className="ml-1.5 font-normal normal-case text-ink-5">
              · {builder.disabledAutoHeaders.length} disabled
            </span>
          )}
        </span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="flex flex-col border-t border-line-subtle">
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-line-subtle px-3 py-1.5">
            <span className="text-[10px] text-ink-4">
              Scrapeman-generated headers sent with every request.
            </span>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh preview"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink-3 hover:bg-bg-hover hover:text-ink-1 disabled:opacity-40"
            >
              <span className={loading ? 'inline-block animate-spin' : 'inline-block'} aria-hidden="true">
                ↻
              </span>
              Refresh
            </button>
          </div>

          {/* Column labels */}
          {rows.length > 0 && (
            <div className="grid grid-cols-[32px_1fr_1.5fr_auto] border-b border-line-subtle bg-bg-subtle px-3 text-[9px] font-semibold uppercase tracking-wider text-ink-4">
              <div />
              <div className="py-1.5">Name</div>
              <div className="py-1.5">Value</div>
              <div className="py-1.5 pl-2">Source</div>
            </div>
          )}

          {/* Rows */}
          {rows.length === 0 && !loading && (
            <div className="px-3 py-3 text-xs text-ink-4">
              Click Refresh to preview headers.
            </div>
          )}

          {rows.map((row) => {
            const lower = row.key.toLowerCase();
            const isOverridden = row.source === 'auto' && userKeys.has(lower);
            const isDisabled = row.source === 'auto' && disabledSet.has(lower);
            return (
              <HeaderRow
                key={row.key}
                row={row}
                isDisabled={isDisabled}
                isOverridden={isOverridden}
                onToggle={() => toggle(row.key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
