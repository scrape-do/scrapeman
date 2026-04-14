import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../commands.js';
import { shortcutLabel } from '../hooks/useShortcuts.js';

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

interface Scored {
  command: Command;
  score: number;
}

// All query characters must appear in order inside the title (case-insensitive).
// Higher score = better match. Exact prefix > word prefix > earlier position.
function score(title: string, query: string): number | null {
  if (!query) return 0;
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const wordStart = ` ${t}`.indexOf(` ${q}`);
  if (wordStart >= 0) return 800 - wordStart;

  let ti = 0;
  let firstIdx = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    if (firstIdx < 0) firstIdx = found;
    ti = found + 1;
  }
  if (t.includes(q)) return 500 - t.indexOf(q);
  return 200 - firstIdx;
}

export function CommandPalette({ open, onClose, commands }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  const filtered = useMemo<Scored[]>(() => {
    const out: Scored[] = [];
    for (const command of commands) {
      const s = score(command.title, query);
      if (s === null) continue;
      out.push({ command, score: s });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }, [commands, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${cursor}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const runAt = (idx: number): void => {
    const hit = filtered[idx];
    if (!hit) return;
    onClose();
    void hit.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'Tab') {
      e.preventDefault();
      setCursor((c) => (filtered.length === 0 ? 0 : (c + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) =>
        filtered.length === 0 ? 0 : (c - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(cursor);
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content
          onOpenAutoFocus={(e) => {
            // Focus the input, not the first list item.
            e.preventDefault();
            const input = (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(
              'input',
            );
            input?.focus();
          }}
          className="fixed left-1/2 top-[20%] z-50 w-[560px] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade"
        >
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command..."
            className="w-full border-0 border-b border-line bg-transparent px-4 py-3 text-sm text-ink-1 outline-none placeholder:text-ink-4"
          />
          <div
            ref={listRef}
            className="max-h-[50vh] overflow-y-auto py-1"
            role="listbox"
          >
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-ink-4">
                No commands found
              </div>
            ) : (
              filtered.map(({ command }, idx) => {
                const active = idx === cursor;
                return (
                  <div
                    key={command.id}
                    data-idx={idx}
                    role="option"
                    aria-selected={active}
                    onMouseMove={() => setCursor(idx)}
                    onClick={() => runAt(idx)}
                    className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm ${
                      active ? 'bg-bg-hover text-ink-1' : 'text-ink-2'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {command.section && (
                        <span className="text-[10px] uppercase tracking-wide text-ink-4">
                          {command.section}
                        </span>
                      )}
                      <span>{command.title}</span>
                    </div>
                    {command.shortcut && (
                      <span className="font-mono text-[11px] text-ink-4">
                        {shortcutLabel(command.shortcut)}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
