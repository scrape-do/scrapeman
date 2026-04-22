import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParamRow } from '../store.js';

function GripIcon(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="3" cy="2" r="0.9" />
      <circle cx="7" cy="2" r="0.9" />
      <circle cx="3" cy="5" r="0.9" />
      <circle cx="7" cy="5" r="0.9" />
      <circle cx="3" cy="8" r="0.9" />
      <circle cx="7" cy="8" r="0.9" />
    </svg>
  );
}
import { HighlightedInput } from '../ui/HighlightedInput.js';
import { CellContextMenu } from '../ui/CellContextMenu.js';

export function ParamsEditor({
  rows,
  onAdd,
  onInsertAfter,
  onUpdate,
  onRemove,
  onReorder,
  focusFirstKeyTick = 0,
}: {
  rows: ParamRow[];
  onAdd: () => void;
  /** Insert a new empty row below the given row id. Returns the new row id. */
  onInsertAfter: (afterId: string) => string;
  onUpdate: (id: string, patch: Partial<ParamRow>) => void;
  onRemove: (id: string) => void;
  onReorder: (
    fromId: string,
    toId: string,
    position: 'before' | 'after',
  ) => void;
  /**
   * Bumped by the command palette "Add URL parameter" action. When it
   * changes (and is non-zero), the component focuses the first Key cell,
   * creating a new row first when every existing row is already filled.
   */
  focusFirstKeyTick?: number;
}): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { id: string; pos: 'before' | 'after' } | null
  >(null);
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

  // Stable ref so the effect below doesn't re-run when rows array changes.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;

  // Track the tick that was active when this component instance mounted.
  // Any higher value means a new command-palette trigger fired.
  const mountTickRef = useRef(focusFirstKeyTick);
  const focusFirstKeyTickRef = useRef(focusFirstKeyTick);
  useEffect(() => {
    // Fire on the first mount when the tick is already non-zero (component was
    // just shown because the command palette switched to the Params pane), AND
    // on any subsequent bump while the component stays mounted.
    const isFreshMount = focusFirstKeyTick > 0 && focusFirstKeyTick === mountTickRef.current;
    const isBump = focusFirstKeyTick > focusFirstKeyTickRef.current;
    if (!isFreshMount && !isBump) return;
    focusFirstKeyTickRef.current = focusFirstKeyTick;
    const rows = rowsRef.current;
    // Find the first row whose Key cell is empty; if none, append a new one.
    const emptyRow = rows.find((r) => r.key.trim() === '');
    if (emptyRow) {
      focusKeyCell(emptyRow.id);
    } else {
      // All rows have content — add a fresh one and focus it.
      onAddRef.current();
      requestAnimationFrame(() => {
        // After onAdd the new row is the last one; rows ref will be stale
        // here but keyRefs will have the new entry by next frame.
        const lastRow = rowsRef.current[rowsRef.current.length - 1];
        if (lastRow) focusKeyCell(lastRow.id);
      });
    }
  }, [focusFirstKeyTick, focusKeyCell]);

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
      <div className="grid grid-cols-[16px_32px_1fr_1.5fr_32px] items-center border-b border-line bg-bg-subtle px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        <div />
        <div />
        <div className="py-2">Key</div>
        <div className="py-2">Value</div>
        <div />
      </div>
      {rows.length === 0 && (
        // Sentinel: receives Tab focus when the table is empty and immediately
        // creates the first row, landing the cursor in its Key cell.
        <div
          tabIndex={0}
          aria-label="Add first URL parameter"
          className="sr-only"
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              onAdd();
              // onAdd is synchronous in the store but React needs a frame to
              // render the new row before keyRefs is populated.
              requestAnimationFrame(() => {
                const firstRow = rowsRef.current[0];
                if (firstRow) focusKeyCell(firstRow.id);
              });
            }
          }}
        />
      )}
      {rows.map((row) => {
        const isDropBefore =
          dropTarget?.id === row.id && dropTarget.pos === 'before';
        const isDropAfter =
          dropTarget?.id === row.id && dropTarget.pos === 'after';
        return (
        <div
          key={row.id}
          className={`group relative grid grid-cols-[16px_32px_1fr_1.5fr_32px] items-center border-b border-line-subtle px-3 hover:bg-bg-subtle ${
            dragId === row.id ? 'opacity-40' : ''
          }`}
          onDragOver={(e) => {
            if (!dragId || dragId === row.id) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const pos: 'before' | 'after' =
              e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            if (dropTarget?.id !== row.id || dropTarget.pos !== pos) {
              setDropTarget({ id: row.id, pos });
            }
          }}
          onDragLeave={() => {
            if (dropTarget?.id === row.id) setDropTarget(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== row.id && dropTarget?.id === row.id) {
              onReorder(dragId, row.id, dropTarget.pos);
            }
            setDragId(null);
            setDropTarget(null);
          }}
        >
          {isDropBefore && (
            <div className="pointer-events-none absolute inset-x-0 -top-px h-0.5 bg-accent" />
          )}
          {isDropAfter && (
            <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
          )}
          <div
            draggable
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => setDragId(null)}
            className="flex h-8 cursor-grab items-center justify-center text-ink-4 opacity-0 group-hover:opacity-100 active:cursor-grabbing"
            title="Drag to reorder"
          >
            <GripIcon />
          </div>
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
            title="Remove parameter"
          >
            ×
          </button>
        </div>
        );
      })}
      <button
        onClick={onAdd}
        className="flex h-8 items-center px-3 text-xs text-ink-3 transition-colors hover:bg-bg-subtle hover:text-accent"
        title="Add parameter"
      >
        + Add parameter
      </button>
    </div>
  );
}
