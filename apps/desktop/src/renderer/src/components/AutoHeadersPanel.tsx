import { useMemo, useState } from 'react';
import type { BuilderState } from '../store.js';

interface PreviewRow {
  key: string;
  value: string;
  readonly?: boolean;
}

function contentTypeForBuilder(builder: BuilderState): string | null {
  if (builder.bodyType === 'none' || !builder.body.trim()) return null;
  if (builder.bodyType === 'json') return 'application/json';
  if (builder.bodyType === 'text') return 'text/plain';
  return null;
}

function previewAutoHeaders(builder: BuilderState): PreviewRow[] {
  const rows: PreviewRow[] = [
    { key: 'User-Agent', value: 'Scrapeman/<version> (<platform>)' },
    { key: 'Accept', value: '*/*' },
    { key: 'Accept-Encoding', value: 'gzip, deflate, br' },
    { key: 'Cache-Control', value: 'no-cache' },
    { key: 'Connection', value: 'keep-alive' },
    { key: 'X-Scrapeman-Token', value: '<uuid per request>' },
  ];
  const ct = contentTypeForBuilder(builder);
  if (ct) rows.push({ key: 'Content-Type', value: ct });
  rows.push({ key: 'Host', value: '<from URL>', readonly: true });
  rows.push({ key: 'Content-Length', value: '<computed>', readonly: true });
  return rows;
}

export function AutoHeadersPanel({
  builder,
  onChange,
}: {
  builder: BuilderState;
  onChange: (disabled: string[]) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => previewAutoHeaders(builder), [builder]);
  const disabled = useMemo(
    () => new Set(builder.disabledAutoHeaders.map((k) => k.toLowerCase())),
    [builder.disabledAutoHeaders],
  );
  const userKeys = useMemo(
    () =>
      new Set(
        builder.headers
          .filter((h) => h.enabled && h.key.trim())
          .map((h) => h.key.trim().toLowerCase()),
      ),
    [builder.headers],
  );

  const toggle = (key: string): void => {
    const lower = key.toLowerCase();
    const next = disabled.has(lower)
      ? builder.disabledAutoHeaders.filter((k) => k.toLowerCase() !== lower)
      : [...builder.disabledAutoHeaders, key];
    onChange(next);
  };

  return (
    <div className="border-b border-line bg-bg-subtle/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-4 hover:text-ink-2"
      >
        <span>Auto Headers ({rows.length})</span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="flex flex-col border-t border-line-subtle">
          {rows.map((row) => {
            const lower = row.key.toLowerCase();
            const isDisabled = disabled.has(lower);
            const overridden = userKeys.has(lower);
            const isReadonly = row.readonly === true;
            return (
              <div
                key={row.key}
                className="grid grid-cols-[32px_1fr_1.5fr_auto] items-center border-b border-line-subtle px-3 py-1"
              >
                <div className="flex items-center justify-center">
                  {isReadonly ? (
                    <span className="text-ink-4">--</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={!isDisabled && !overridden}
                      disabled={overridden}
                      onChange={() => toggle(row.key)}
                      className="h-3.5 w-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed"
                    />
                  )}
                </div>
                <div
                  className={`py-1 font-mono text-xs ${
                    isDisabled || overridden ? 'text-ink-4 line-through' : 'text-ink-2'
                  }`}
                >
                  {row.key}
                </div>
                <div className="truncate py-1 font-mono text-xs text-ink-3">
                  {row.value}
                </div>
                <div className="pl-2">
                  {overridden && (
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
                      overridden
                    </span>
                  )}
                  {!overridden && isReadonly && (
                    <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-4">
                      readonly
                    </span>
                  )}
                  {!overridden && !isReadonly && isDisabled && (
                    <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-4">
                      disabled
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
