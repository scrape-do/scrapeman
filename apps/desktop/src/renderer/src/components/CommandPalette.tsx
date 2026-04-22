import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScrapemanRequest } from '@scrapeman/shared-types';
import type { Command } from '../commands.js';
import type { FolderChild, SearchHit } from '../hooks/useRequestSearch.js';
import { DORK_HINTS, parseSearchQuery, useRequestSearch } from '../hooks/useRequestSearch.js';
import { shortcutLabel } from '../hooks/useShortcuts.js';
import { useAppStore } from '../store.js';
import type { Tab } from '../store.js';
import { bridge } from '../bridge.js';
import { score } from '../utils/search.js';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

function FolderIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h2.086a1 1 0 0 1 .707.293L6 2h3.5A1.5 1.5 0 0 1 11 3.5v6A1.5 1.5 0 0 1 9.5 11h-7A1.5 1.5 0 0 1 1 9.5v-7Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Preview panel
// ---------------------------------------------------------------------------

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'request'; req: ScrapemanRequest }
  | { kind: 'folder'; name: string; children: FolderChild[] }
  | { kind: 'help' }
  | { kind: 'error' };

function MethodBadge({ method }: { method: string }): JSX.Element {
  return (
    <span className={`font-mono text-xs font-semibold ${METHOD_COLOR[method] ?? 'text-ink-4'}`}>
      {method}
    </span>
  );
}

function ParamRows({ pairs }: { pairs: [string, string][] }): JSX.Element {
  return (
    <div className="mt-1 space-y-0.5">
      {pairs.slice(0, 5).map(([k, v]) => (
        <div key={k} className="flex gap-2 font-mono text-[11px]">
          <span className="w-24 shrink-0 truncate text-ink-3">{k}</span>
          <span className="truncate text-ink-2">{v}</span>
        </div>
      ))}
      {pairs.length > 5 && (
        <div className="text-[10px] text-ink-5">+{pairs.length - 5} more</div>
      )}
    </div>
  );
}

function PreviewSection({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4">{label}</div>
      {children}
    </div>
  );
}

function HelpContent({ commands }: { commands: Command[] }): JSX.Element {
  const withShortcut = commands.filter((c) => c.shortcut);
  const dorks: [string, string][] = [
    ['focus:', 'open tabs only'],
    ['folder: / dir:', 'collection folders'],
    ['request:', 'saved requests'],
    ['header:', 'by header (open tabs)'],
    ['body:', 'by body (open tabs)'],
  ];
  const nav: [string, string][] = [
    ['↑ / ↓', 'move through results'],
    ['→', 'open preview panel'],
    ['← (in preview)', 'back to results'],
    ['Enter', 'open selected'],
    ['Esc', 'close'],
  ];
  return (
    <div className="max-h-[calc(50vh+49px)] space-y-4 overflow-y-auto p-4">
      {withShortcut.length > 0 && (
        <PreviewSection label="Shortcuts">
          <div className="space-y-1">
            {withShortcut.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-[11px]">
                <span className="text-ink-2">{c.title}</span>
                <kbd className="font-mono text-[10px] text-ink-4">{shortcutLabel(c.shortcut!)}</kbd>
              </div>
            ))}
          </div>
        </PreviewSection>
      )}
      <PreviewSection label="Search dorks">
        <div className="space-y-1">
          {dorks.map(([dork, desc]) => (
            <div key={dork} className="flex items-start gap-2 text-[11px]">
              <code className="w-28 shrink-0 font-mono text-accent">{dork}</code>
              <span className="text-ink-3">{desc}</span>
            </div>
          ))}
        </div>
      </PreviewSection>
      <PreviewSection label="Navigation">
        <div className="space-y-1">
          {nav.map(([key, desc]) => (
            <div key={key} className="flex items-start gap-2 text-[11px]">
              <kbd className="w-28 shrink-0 font-mono text-[10px] text-ink-3">{key}</kbd>
              <span className="text-ink-3">{desc}</span>
            </div>
          ))}
        </div>
      </PreviewSection>
    </div>
  );
}

function PreviewPanel({
  state,
  commands,
  activeFolderChildIdx,
  listRef,
}: {
  state: PreviewState;
  commands: Command[];
  activeFolderChildIdx: number;
  listRef: React.Ref<HTMLDivElement>;
}): JSX.Element {
  if (state.kind === 'help') return <HelpContent commands={commands} />;

  if (state.kind === 'idle') {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-5">
        Select a result to preview
      </div>
    );
  }

  if (state.kind === 'loading') {
    return <div className="flex h-full items-center justify-center text-xs text-ink-4">Loading...</div>;
  }

  if (state.kind === 'error') {
    return <div className="flex h-full items-center justify-center text-xs text-ink-4">Could not load</div>;
  }

  if (state.kind === 'folder') {
    return (
      <div className="flex flex-col">
        <div className="border-b border-line px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
          {state.name}
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {state.children.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-ink-4">Empty folder</div>
          ) : (
            state.children.map((c, idx) => {
              const active = idx === activeFolderChildIdx;
              return (
                <div
                  key={c.relPath}
                  data-preview-idx={idx}
                  className={`flex cursor-default items-center gap-2.5 px-4 py-2 text-[11px] ${
                    active ? 'bg-bg-hover text-ink-1' : 'text-ink-2'
                  }`}
                >
                  {c.kind === 'folder' ? (
                    <span className="text-ink-4"><FolderIcon /></span>
                  ) : (
                    <MethodBadge method={c.method ?? ''} />
                  )}
                  <span className="truncate">{c.name}</span>
                </div>
              );
            })
          )}
        </div>
        {state.children.length > 0 && (
          <div className="border-t border-line px-4 py-1.5 text-[10px] text-ink-5">
            ↑↓ navigate · Enter open · folder fills search · ← back
          </div>
        )}
      </div>
    );
  }

  // Tab or loaded request
  const method = state.kind === 'tab' ? state.tab.method : state.req.method;
  const url = state.kind === 'tab' ? state.tab.builder.url : state.req.url;
  const params: [string, string][] =
    state.kind === 'tab'
      ? state.tab.builder.params.filter((p) => p.enabled && p.key).map((p) => [p.key, p.value])
      : Object.entries(state.req.params ?? {});
  const headers: [string, string][] =
    state.kind === 'tab'
      ? state.tab.builder.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, h.value])
      : Object.entries(state.req.headers ?? {});
  const body =
    state.kind === 'tab'
      ? state.tab.builder.body
      : state.req.body && 'content' in state.req.body && state.req.body.content
      ? state.req.body.content
      : null;

  return (
    <div className="max-h-[calc(50vh+49px)] space-y-3 overflow-y-auto p-4">
      <PreviewSection label="Request">
        <div className="flex items-start gap-2">
          <MethodBadge method={method} />
          <span className="line-clamp-3 break-all text-xs text-ink-2">{url || '(no URL)'}</span>
        </div>
      </PreviewSection>
      {params.length > 0 && (
        <PreviewSection label={`Params (${params.length})`}>
          <ParamRows pairs={params} />
        </PreviewSection>
      )}
      {headers.length > 0 && (
        <PreviewSection label={`Headers (${headers.length})`}>
          <ParamRows pairs={headers} />
        </PreviewSection>
      )}
      {body && (
        <PreviewSection label="Body">
          <pre className="max-h-28 overflow-hidden whitespace-pre-wrap break-all font-mono text-[10px] text-ink-3">
            {body.slice(0, 300)}{body.length > 300 ? '…' : ''}
          </pre>
        </PreviewSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main palette
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

interface Scored {
  command: Command;
  score: number;
}

export function CommandPalette({ open, onClose, commands }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [focusPane, setFocusPane] = useState<'list' | 'preview'>('list');
  const [previewCursor, setPreviewCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previewListRef = useRef<HTMLDivElement | null>(null);

  // Store
  const tabs = useAppStore((s) => s.tabs);
  const workspace = useAppStore((s) => s.workspace);
  const openRequest = useAppStore((s) => s.openRequest);
  const setSidebarView = useAppStore((s) => s.setSidebarView);
  const revealInSidebar = useAppStore((s) => s.revealInSidebar);

  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setFocusPane('list');
      setPreviewCursor(0);
      setPreview({ kind: 'idle' });
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

  const searchEnabled = open && query.trim().length > 0 && filtered.length === 0;
  const hits = useRequestSearch(query, searchEnabled);

  const showHits = searchEnabled;
  const itemCount = showHits ? hits.length : filtered.length;

  const { mode: dorkMode } = parseSearchQuery(query);

  // Reset list cursor when query changes
  useEffect(() => { setCursor(0); }, [query]);

  // Scroll active list item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Scroll active preview child into view
  useEffect(() => {
    if (focusPane !== 'preview') return;
    const el = previewListRef.current?.querySelector<HTMLElement>(`[data-preview-idx="${previewCursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [previewCursor, focusPane]);

  // Build preview for the active hit
  const activeHit: SearchHit | null = showHits ? (hits[cursor] ?? null) : null;

  useEffect(() => {
    setFocusPane('list');
    setPreviewCursor(0);
  }, [activeHit]);

  // Single effect that manages preview for both command mode and hit mode.
  useEffect(() => {
    // Command mode: Help command shows its preview; everything else is idle.
    if (!showHits) {
      const cmd = filtered[cursor]?.command;
      setPreview(cmd?.id === 'view.help' ? { kind: 'help' } : { kind: 'idle' });
      return;
    }

    // Hit mode
    if (!activeHit) { setPreview({ kind: 'idle' }); return; }

    if (activeHit.kind === 'tab' && activeHit.tabId) {
      const tab = tabs.find((t) => t.id === activeHit.tabId);
      if (tab) setPreview({ kind: 'tab', tab });
      return;
    }
    if (activeHit.kind === 'folder') {
      setPreview({ kind: 'folder', name: activeHit.label, children: activeHit.children ?? [] });
      return;
    }
    if (activeHit.kind === 'request' && activeHit.relPath) {
      setPreview({ kind: 'loading' });
      const relPath = activeHit.relPath;
      const timer = setTimeout(() => {
        if (!workspace) { setPreview({ kind: 'error' }); return; }
        void bridge.workspaceReadRequest(workspace.path, relPath).then(
          (req) => setPreview({ kind: 'request', req }),
          () => setPreview({ kind: 'error' }),
        );
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [cursor, showHits, filtered, activeHit, hits, tabs, workspace]);

  const folderChildren = preview.kind === 'folder' ? preview.children : [];

  const runAt = (idx: number): void => {
    if (showHits) {
      const hit = hits[idx];
      if (!hit) return;
      if (hit.kind === 'folder') {
        // Auto-fill so the user can refine within this folder.
        setQuery(`folder:${hit.label}`);
        setCursor(0);
        setFocusPane('list');
        return;
      }
      hit.run();
    } else {
      void filtered[idx]?.command.run();
    }
    onClose();
  };

  const runPreviewChild = (idx: number): void => {
    const child = folderChildren[idx];
    if (!child) { runAt(cursor); return; }
    if (child.kind === 'folder') {
      // Drill into the subfolder by auto-filling.
      setQuery(`folder:${child.name}`);
      setCursor(0);
      setFocusPane('list');
      return;
    }
    void openRequest(child.relPath);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (focusPane === 'list') {
      if (e.key === 'ArrowDown' || e.key === 'Tab') {
        e.preventDefault();
        setCursor((c) => (itemCount === 0 ? 0 : (c + 1) % itemCount));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => (itemCount === 0 ? 0 : (c - 1 + itemCount) % itemCount));
      } else if (e.key === 'ArrowRight' && preview.kind !== 'idle') {
        e.preventDefault();
        setFocusPane('preview');
        setPreviewCursor(0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runAt(cursor);
      }
    } else {
      // focusPane === 'preview'
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusPane('list');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPreviewCursor((c) => folderChildren.length === 0 ? 0 : (c + 1) % folderChildren.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPreviewCursor((c) => folderChildren.length === 0 ? 0 : (c - 1 + folderChildren.length) % folderChildren.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (folderChildren.length > 0) runPreviewChild(previewCursor);
        else runAt(cursor);
      }
    }
  };

  const showPreview = preview.kind !== 'idle';

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const input = (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('input');
            input?.focus();
          }}
          className="fixed left-1/2 top-[20%] z-50 flex w-[860px] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade"
        >
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>

          {/* ── Main palette — fills the box, shrinks when preview opens ── */}
          <div className={`flex min-w-0 flex-1 flex-col ${showPreview ? 'w-[560px]' : 'w-full'}`}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                dorkMode !== 'all' ? `${DORK_HINTS[dorkMode]}...` : 'Type a command or search...'
              }
              className="w-full border-0 border-b border-line bg-transparent px-4 py-3 text-sm text-ink-1 outline-none placeholder:text-ink-4"
            />
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
              {showHits ? (
                hits.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-ink-4">No results</div>
                ) : (
                  hits.map((hit, idx) => {
                    const active = idx === cursor;
                    return (
                      <div
                        key={hit.id}
                        data-idx={idx}
                        role="option"
                        aria-selected={active}
                        onMouseMove={() => { setCursor(idx); setFocusPane('list'); }}
                        onClick={() => runAt(idx)}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2 ${
                          active ? 'bg-bg-hover text-ink-1' : 'text-ink-2'
                        }`}
                      >
                        {hit.kind === 'folder' ? (
                          <span className="flex w-8 shrink-0 items-center justify-center text-ink-4">
                            <FolderIcon />
                          </span>
                        ) : (
                          <span className={`w-8 shrink-0 text-center font-mono text-[10px] font-semibold ${METHOD_COLOR[hit.method ?? ''] ?? 'text-ink-4'}`}>
                            {hit.method ?? ''}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{hit.label}</div>
                          <div className="truncate text-[11px] text-ink-4">{hit.sub}</div>
                        </div>
                        {hit.kind === 'tab' && (
                          <span className="shrink-0 rounded bg-bg-muted px-1.5 py-0.5 text-[10px] text-ink-4">open</span>
                        )}
                        {hit.kind === 'folder' && (
                          <span className="shrink-0 text-[10px] text-ink-5">→</span>
                        )}
                      </div>
                    );
                  })
                )
              ) : filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-ink-4">No commands found</div>
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
                          <span className="text-[10px] uppercase tracking-wide text-ink-4">{command.section}</span>
                        )}
                        <span>{command.title}</span>
                      </div>
                      {command.shortcut && (
                        <span className="font-mono text-[11px] text-ink-4">{shortcutLabel(command.shortcut)}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Preview panel — appears inside the box when a hit is selected ── */}
          {showPreview && (
            <div className={`flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-line ${focusPane === 'preview' ? 'bg-bg-canvas' : 'bg-bg-subtle'}`}>
              <PreviewPanel
                state={preview}
                commands={commands}
                activeFolderChildIdx={focusPane === 'preview' ? previewCursor : -1}
                listRef={previewListRef}
              />
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
