import { useCallback, useRef, useState } from 'react';
import type { HeaderRow } from '../store.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';
import { CellContextMenu } from '../ui/CellContextMenu.js';
import { parseHeaderBulk, serializeHeaderBulk, type BulkHeaderRow } from '@scrapeman/http-core';

export function HeadersEditor({
  rows,
  onAdd,
  onInsertAfter,
  onUpdate,
  onRemove,
  onReplace,
}: {
  rows: HeaderRow[];
  onAdd: () => void;
  /** Insert a new empty row below the given row id. Returns the new row id. */
  onInsertAfter: (afterId: string) => string;
  onUpdate: (id: string, patch: Partial<HeaderRow>) => void;
  onRemove: (id: string) => void;
  /**
   * Replace the entire headers array. Used when leaving bulk-edit mode so
   * that all edits are committed atomically to the store.
   */
  onReplace: (next: HeaderRow[]) => void;
}): JSX.Element {
  const [bulkMode, setBulkMode] = useState(false);
  // Bulk textarea text — kept in local state while bulk mode is active.
  const [bulkText, setBulkText] = useState('');

  // Refs map: rowId -> key input element, used to focus after insert.
  const keyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const focusKeyCell = useCallback((rowId: string) => {
    // Use requestAnimationFrame so the new row has been rendered first.
    requestAnimationFrame(() => {
      keyRefs.current[rowId]?.focus();
    });
  }, []);

  const handleKeyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, row: HeaderRow) => {
      // T1301: Shift+Enter → insert row below, focus its Key cell.
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const newId = onInsertAfter(row.id);
        focusKeyCell(newId);
        return;
      }
      // T1302: Tab from Key cell of last row when key is non-empty →
      // append new row. Focus stays on the Value cell (natural Tab target).
      if (e.key === 'Tab' && !e.shiftKey) {
        const isLastRow = rows[rows.length - 1]?.id === row.id;
        if (isLastRow && row.key.trim().length > 0) {
          // Append without preventing default so Tab still moves focus
          // to the Value cell of this row.
          onAdd();
        }
      }
    },
    [rows, onAdd, onInsertAfter, focusKeyCell],
  );

  const handleValueKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, row: HeaderRow) => {
      // T1301: Shift+Enter → insert row below, focus its Key cell.
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const newId = onInsertAfter(row.id);
        focusKeyCell(newId);
      }
    },
    [onInsertAfter, focusKeyCell],
  );

  /** Enter bulk mode: serialize current rows to textarea text. */
  const enterBulk = useCallback(() => {
    setBulkText(serializeHeaderBulk(rows));
    setBulkMode(true);
  }, [rows]);

  /**
   * Leave bulk mode: parse textarea text and commit to store.
   *
   * Round-trip strategy: for each parsed row, reuse the existing HeaderRow id
   * if a row with that key still exists (preserving store identity), otherwise
   * create a fresh id.
   */
  const leaveBulk = useCallback(() => {
    const parsed = parseHeaderBulk(bulkText);

    // Build a map of existing ids by key for id reuse.
    const existingByKey = new Map<string, string>();
    for (const row of rows) {
      if (!existingByKey.has(row.key)) {
        existingByKey.set(row.key, row.id);
      }
    }

    const next: HeaderRow[] = parsed.map((p: BulkHeaderRow) => ({
      id: existingByKey.get(p.key) ?? crypto.randomUUID(),
      key: p.key,
      value: p.value,
      enabled: p.enabled,
    }));

    onReplace(next);
    setBulkMode(false);
  }, [bulkText, rows, onReplace]);

  return (
    <div className="flex flex-col">
      {/* Toolbar row: column labels + bulk toggle */}
      <div className="grid grid-cols-[32px_1fr_1.5fr_32px] items-center border-b border-line bg-bg-subtle px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        <div />
        <div className="py-2">Key</div>
        <div className="py-2">Value</div>
        {/* Bulk toggle sits in the last column of the header row */}
        <button
          onClick={bulkMode ? leaveBulk : enterBulk}
          className="flex h-full items-center justify-center text-ink-3 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          title={bulkMode ? 'Switch to key-value table' : 'Switch to bulk edit'}
          aria-label={bulkMode ? 'Switch to key-value table' : 'Switch to bulk edit'}
          aria-pressed={bulkMode}
        >
          {/* Simple icon: pencil-list for key-value, paragraph for bulk */}
          {bulkMode ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          )}
        </button>
      </div>

      {bulkMode ? (
        /* ── Bulk edit mode ── */
        <div className="flex flex-col gap-1 px-3 py-2">
          <p className="text-[10px] text-ink-4">
            One header per line: <code className="font-mono">Key: Value</code>. Prefix a line with{' '}
            <code className="font-mono">//</code> to disable it.
          </p>
          <textarea
            autoFocus
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            spellCheck={false}
            className="min-h-[120px] w-full resize-y rounded border border-line bg-bg-subtle p-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-4 focus-visible:ring-1 focus-visible:ring-accent"
            placeholder={"Content-Type: application/json\n// Authorization: Bearer {{token}}"}
          />
        </div>
      ) : (
        /* ── Key-value table mode ── */
        <>
          {rows.map((row) => (
            <div
              key={row.id}
              className="group grid grid-cols-[32px_1fr_1.5fr_32px] items-center border-b border-line-subtle px-3 hover:bg-bg-subtle"
            >
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => onUpdate(row.id, { enabled: e.target.checked })}
                  className="h-3.5 w-3.5 cursor-pointer accent-accent"
                />
              </div>
              <input
                ref={(el) => {
                  keyRefs.current[row.id] = el;
                }}
                type="text"
                value={row.key}
                placeholder="Header"
                onChange={(e) => onUpdate(row.id, { key: e.target.value })}
                onKeyDown={(e) => handleKeyKeyDown(e, row)}
                className="h-8 bg-transparent pr-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-4"
              />
              <CellContextMenu
                value={row.value}
                onChange={(next) => onUpdate(row.id, { value: next })}
              >
                <div>
                  <HighlightedInput
                    value={row.value}
                    onChange={(e) => onUpdate(row.id, { value: e.target.value })}
                    onKeyDown={(e) => handleValueKeyDown(e, row)}
                    placeholder="Bearer {{token}}"
                    variant="cell"
                  />
                </div>
              </CellContextMenu>
              <button
                onClick={() => onRemove(row.id)}
                className="opacity-0 group-hover:opacity-100 icon-btn"
                aria-label="Remove header"
                title="Remove header"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={onAdd}
            className="flex h-8 items-center px-3 text-xs text-ink-3 transition-colors hover:bg-bg-subtle hover:text-accent"
            title="Add header"
          >
            + Add header
          </button>
        </>
      )}
    </div>
  );
}
