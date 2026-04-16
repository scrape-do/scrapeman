import { useCallback, useRef } from 'react';
import type { ParamRow } from '../store.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';
import { CellContextMenu } from '../ui/CellContextMenu.js';

export function ParamsEditor({
  rows,
  onAdd,
  onInsertAfter,
  onUpdate,
  onRemove,
}: {
  rows: ParamRow[];
  onAdd: () => void;
  /** Insert a new empty row below the given row id. Returns the new row id. */
  onInsertAfter: (afterId: string) => string;
  onUpdate: (id: string, patch: Partial<ParamRow>) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  // Refs map: rowId -> HTMLInputElement for key cell focus after insert.
  const keyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const focusKeyCell = useCallback(
    (rowId: string) => {
      // Use requestAnimationFrame so the new row has been rendered first.
      requestAnimationFrame(() => {
        keyRefs.current[rowId]?.focus();
      });
    },
    [],
  );

  const handleKeyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, row: ParamRow) => {
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
    (e: React.KeyboardEvent<HTMLInputElement>, row: ParamRow) => {
      // T1301: Shift+Enter → insert row below, focus its Key cell.
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const newId = onInsertAfter(row.id);
        focusKeyCell(newId);
      }
    },
    [onInsertAfter, focusKeyCell],
  );

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[32px_1fr_1.5fr_32px] items-center border-b border-line bg-bg-subtle px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        <div />
        <div className="py-2">Key</div>
        <div className="py-2">Value</div>
        <div />
      </div>
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
            ref={(el) => { keyRefs.current[row.id] = el; }}
            type="text"
            value={row.key}
            placeholder="key"
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
                placeholder="value or {{var}}"
                variant="cell"
              />
            </div>
          </CellContextMenu>
          <button
            onClick={() => onRemove(row.id)}
            className="opacity-0 group-hover:opacity-100 icon-btn"
            aria-label="Remove parameter"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={onAdd}
        className="flex h-8 items-center px-3 text-xs text-ink-3 transition-colors hover:bg-bg-subtle hover:text-accent"
      >
        + Add parameter
      </button>
    </div>
  );
}
