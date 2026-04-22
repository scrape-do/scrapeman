import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ExecutedResponse } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore } from '../store.js';
import { JsonTree } from './JsonTree.js';
import { HtmlEditor } from './HtmlEditor.js';

type Tab = 'body' | 'headers';

type ContentKind = 'json' | 'html' | 'xml' | 'image' | 'pdf' | 'text' | 'binary';
type BodyMode = 'raw' | 'pretty' | 'tree' | 'preview';

const MODE_LABEL: Record<BodyMode, string> = {
  raw: 'Raw',
  pretty: 'Pretty',
  tree: 'Tree',
  preview: 'Preview',
};

// 500 KB threshold for large-body warning in Pretty HTML mode.
const LARGE_BODY_BYTES = 500 * 1024;

function modesForKind(kind: ContentKind): BodyMode[] {
  switch (kind) {
    case 'json':
      return ['raw', 'pretty', 'tree'];
    case 'html':
      return ['raw', 'pretty', 'preview'];
    case 'xml':
      return ['raw', 'pretty'];
    case 'image':
      return ['raw', 'preview'];
    case 'pdf':
      return ['raw', 'preview'];
    case 'text':
    case 'binary':
    default:
      return ['raw'];
  }
}

export function ResponseViewer(): JSX.Element {
  const execution = useAppStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    return active?.execution ?? null;
  });
  const requestUrl = useAppStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    return active?.builder.url ?? '';
  });
  const validateBody = useAppStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    return active?.builder.settings.validateBody ?? '';
  });
  const [tab, setTab] = useState<Tab>('body');

  const focusSearchTick = useAppStore((s) => s.focusSearchTick);
  useEffect(() => {
    if (focusSearchTick === 0) return;
    setTab('body');
  }, [focusSearchTick]);

  if (!execution) {
    return (
      <EmptyState icon="↵" title="No tab" description="Open or create a request first." />
    );
  }

  if (execution.status === 'idle') {
    return (
      <EmptyState
        icon="↵"
        title="Ready"
        description="Hit Send (⌘↵) to execute the request."
      />
    );
  }

  if (execution.status === 'sending') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-muted text-accent">
          <span className="spinner" aria-hidden="true" />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-ink-1">Sending…</div>
          <div className="mt-1 text-xs text-ink-3">Awaiting response.</div>
        </div>
      </div>
    );
  }

  if (execution.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-method-delete/10 text-method-delete">
          !
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-method-delete">
          {execution.error?.kind ?? 'error'}
        </div>
        <div className="max-w-md break-words font-mono text-xs text-ink-2">
          {execution.error?.message ?? 'Unknown error'}
        </div>
      </div>
    );
  }

  const response = execution.response!;
  const durationMs =
    execution.finishedAt && execution.startedAt
      ? execution.finishedAt - execution.startedAt
      : response.timings.totalMs;

  const validateHit = validateBody.trim()
    ? decodeBodyText(response.bodyBase64).includes(validateBody)
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="relative z-10 flex h-10 items-center gap-4 border-b border-line bg-bg-canvas px-4">
        <StatusBadge status={response.status} />
        <Metric label="Time" value={`${Math.round(durationMs)} ms`} />
        {response.timings.ttfbMs !== undefined && (
          <Metric label="TTFB" value={`${Math.round(response.timings.ttfbMs)} ms`} />
        )}
        {response.timings.downloadMs !== undefined && (
          <Metric
            label="Download"
            value={`${Math.round(response.timings.downloadMs)} ms`}
          />
        )}
        <Metric label="Size" value={formatBytes(response.sizeBytes)} />
        <Metric label="Protocol" value={response.httpVersion} />
        {validateHit !== null && (
          <div
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${
              validateHit
                ? 'bg-status-ok/10 text-status-ok'
                : 'bg-method-delete/10 text-method-delete'
            }`}
            title={
              validateHit
                ? `Response body contains "${validateBody}"`
                : `Response body is missing "${validateBody}"`
            }
          >
            <span aria-hidden>{validateHit ? '✓' : '✗'}</span>
            <span className="font-mono">
              validate &quot;{truncateMiddle(validateBody, 24)}&quot;
            </span>
          </div>
        )}
        <button
          onClick={() => {
            const name = deriveFilename(response, requestUrl);
            void bridge.saveResponse(response.bodyBase64, name);
          }}
          className="ml-auto rounded px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-bg-hover hover:text-ink-1"
          title="Save response body to file"
        >
          Save
        </button>
        {response.bodyTruncated && (
          <span className="rounded bg-method-post/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-method-post">
            truncated
          </span>
        )}
      </div>

      <div className="relative z-10 flex h-9 items-center border-b border-line bg-bg-canvas px-4">
        <TabButton active={tab === 'body'} onClick={() => setTab('body')}>
          Body
        </TabButton>
        <TabButton active={tab === 'headers'} onClick={() => setTab('headers')}>
          Headers
          <span className="ml-1.5 rounded-full bg-bg-muted px-1.5 text-[10px] font-semibold text-ink-3">
            {response.headers.length}
          </span>
        </TabButton>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'body' && <BodyPanel response={response} />}
        {tab === 'headers' && <HeadersPanel response={response} />}
      </div>
    </div>
  );
}

// ─── Match type ─────────────────────────────────────────────────────────────

interface LineMatch {
  /** 0-based line index in the split lines array */
  lineIndex: number;
  /** start offset within the line string */
  start: number;
  /** end offset (exclusive) within the line string */
  end: number;
  /** global match index across all lines, used for active highlight */
  globalIndex: number;
}

// ─── Search match computation ────────────────────────────────────────────────

/**
 * Finds all matches of `needle` in `text` and maps them to per-line offsets.
 * Returns both a flat global list and a Map from lineIndex to its matches.
 * Runs in O(n) on text length — safe for 5 MB bodies.
 */
function computeMatches(
  lines: string[],
  needle: string,
): { all: LineMatch[]; byLine: Map<number, LineMatch[]> } {
  const all: LineMatch[] = [];
  const byLine = new Map<number, LineMatch[]>();
  if (!needle) return { all, byLine };

  const needleLower = needle.toLowerCase();
  let globalIndex = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const lineLower = line.toLowerCase();
    let from = 0;
    while (true) {
      const idx = lineLower.indexOf(needleLower, from);
      if (idx < 0) break;
      const m: LineMatch = {
        lineIndex: li,
        start: idx,
        end: idx + needle.length,
        globalIndex,
      };
      all.push(m);
      let bucket = byLine.get(li);
      if (!bucket) {
        bucket = [];
        byLine.set(li, bucket);
      }
      bucket.push(m);
      globalIndex++;
      from = idx + Math.max(1, needle.length);
    }
  }

  return { all, byLine };
}

// ─── BodyPanel ───────────────────────────────────────────────────────────────

function BodyPanel({ response }: { response: ExecutedResponse }): JSX.Element {
  const searchRaw = useAppStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    return active?.responseSearch ?? '';
  });
  const persistedMode = useAppStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    return active?.responseMode ?? null;
  });
  const setSearch = useAppStore((s) => s.setResponseSearch);
  const setPersistedMode = useAppStore((s) => s.setResponseMode);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // Debounced search value — 150 ms delay prevents per-keystroke full-text scan
  // on large bodies while keeping the input feel instant.
  const [debouncedSearch, setDebouncedSearch] = useState(searchRaw);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchRaw), 150);
    return () => clearTimeout(id);
  }, [searchRaw]);

  const bytes = useMemo<Uint8Array>(() => {
    try {
      return Uint8Array.from(atob(response.bodyBase64), (c) => c.charCodeAt(0));
    } catch {
      return new Uint8Array();
    }
  }, [response.bodyBase64]);

  const text = useMemo(
    () => new TextDecoder('utf-8', { fatal: false }).decode(bytes),
    [bytes],
  );

  const kind = useMemo<ContentKind>(
    () => detectKind(response.contentType, bytes, text),
    [response.contentType, bytes, text],
  );

  const availableModes = useMemo(() => modesForKind(kind), [kind]);

  // Effective mode: persisted choice if still valid, otherwise first available.
  const mode: BodyMode =
    persistedMode && availableModes.includes(persistedMode)
      ? persistedMode
      : (availableModes[0] ?? 'raw');

  const setMode = (next: BodyMode): void => {
    setPersistedMode(next);
  };

  // Lazy JSON parse — only needed for Tree/Pretty JSON.
  const parsed = useMemo<{ ok: boolean; value: unknown }>(() => {
    if (kind !== 'json') return { ok: false, value: null };
    if (mode !== 'tree' && mode !== 'pretty') return { ok: false, value: null };
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, value: null };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, value: null };
    }
  }, [kind, mode, text]);

  const pretty = useMemo(() => {
    if (mode !== 'pretty') return text;
    if (kind === 'json' && parsed.ok) {
      return JSON.stringify(parsed.value, null, 2);
    }
    // HTML pretty is handled by CodeMirror — return raw text here so it is
    // available for plain-text search when the editor is not shown.
    if (kind === 'html') return text;
    if (kind === 'xml') {
      return formatXml(text);
    }
    return text;
  }, [mode, kind, parsed, text]);

  const mimeType = useMemo(() => mimeFor(kind, response.contentType), [
    kind,
    response.contentType,
  ]);

  // The string we search over depends on mode.
  // HTML pretty is handled by CodeMirror (no DOM highlight), so we search raw text.
  const searchable =
    mode === 'raw' ? text :
    mode === 'pretty' ? pretty :
    null;

  // Split searchable text into lines once — reused by virtualizer and match logic.
  const lines = useMemo<string[]>(() => {
    if (!searchable) return [];
    return searchable.split('\n');
  }, [searchable]);

  // Compute all match positions across lines using the debounced needle.
  const { matchAll, matchByLine } = useMemo(() => {
    const { all, byLine } = computeMatches(lines, debouncedSearch);
    return { matchAll: all, matchByLine: byLine };
  }, [lines, debouncedSearch]);

  // Clamp active match when match count shrinks.
  useEffect(() => {
    if (matchAll.length === 0) {
      setActiveMatchIndex(0);
    } else if (activeMatchIndex >= matchAll.length) {
      setActiveMatchIndex(0);
    }
  }, [matchAll.length]);

  const searchable_supported = mode === 'raw' || mode === 'pretty';
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const focusSearchTick = useAppStore((s) => s.focusSearchTick);
  useEffect(() => {
    if (focusSearchTick === 0) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [focusSearchTick]);

  // Ref to virtualizer row scroller — used to jump to active match.
  const scrollToLineRef = useRef<((lineIndex: number) => void) | null>(null);

  useEffect(() => {
    if (matchAll.length === 0) return;
    const active = matchAll[activeMatchIndex];
    if (!active) return;
    scrollToLineRef.current?.(active.lineIndex);
  }, [activeMatchIndex, matchAll]);

  const isLargeHtmlBody = kind === 'html' && response.sizeBytes > LARGE_BODY_BYTES;

  return (
    <div className="flex h-full flex-col">
      <div className="relative z-10 flex items-center gap-1 border-b border-line bg-bg-canvas px-4 py-2">
        <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
          View
        </span>
        {availableModes.map((m) => (
          <ModeButton key={m} active={mode === m} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </ModeButton>
        ))}

        {searchable_supported && (
          <SearchBox
            inputRef={searchInputRef}
            value={searchRaw}
            onChange={setSearch}
            matchCount={matchAll.length}
            activeIndex={activeMatchIndex}
            onPrev={() =>
              setActiveMatchIndex((i) =>
                matchAll.length === 0
                  ? 0
                  : (i - 1 + matchAll.length) % matchAll.length,
              )
            }
            onNext={() =>
              setActiveMatchIndex((i) =>
                matchAll.length === 0 ? 0 : (i + 1) % matchAll.length,
              )
            }
          />
        )}

        <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-4">
          {kind}
        </span>
        <span className="text-[10px] text-ink-4">
          · {formatBytes(response.sizeBytes)}
        </span>
      </div>

      {/* Large HTML warning banner shown above CodeMirror pretty view */}
      {isLargeHtmlBody && mode === 'pretty' && (
        <div className="flex items-center gap-2 border-b border-line bg-method-post/10 px-4 py-1.5 text-[11px] text-method-post">
          <span className="font-semibold">Large body</span>
          <span className="text-method-post/80">
            {formatBytes(response.sizeBytes)} — syntax highlighting may be slow. Switch to Raw for best performance.
          </span>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {renderBody({
          kind,
          mode,
          text,
          pretty,
          parsed,
          bodyBase64: response.bodyBase64,
          mimeType,
          search: debouncedSearch,
          searchRaw,
          matchAll,
          matchByLine,
          activeMatchIndex,
          lines,
          scrollToLineRef,
        })}
      </div>
    </div>
  );
}

// ─── SearchBox ───────────────────────────────────────────────────────────────

function SearchBox({
  inputRef,
  value,
  onChange,
  matchCount,
  activeIndex,
  onPrev,
  onNext,
}: {
  inputRef?: React.Ref<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
}): JSX.Element {
  return (
    <div className="ml-3 flex items-center gap-1 rounded-md border border-line bg-bg-canvas pl-2 pr-1 focus-within:border-accent focus-within:shadow-focus">
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder="Find in body"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
          }
        }}
        className="h-6 w-44 bg-transparent font-mono text-xs text-ink-1 outline-none placeholder:text-ink-4"
      />
      {value && (
        <span className="font-mono text-[10px] text-ink-4">
          {matchCount === 0 ? '0/0' : `${activeIndex + 1}/${matchCount}`}
        </span>
      )}
      <button
        onClick={onPrev}
        disabled={matchCount === 0}
        className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-bg-hover hover:text-ink-1 disabled:opacity-40"
        title="Previous match (⇧Enter)"
      >
        ↑
      </button>
      <button
        onClick={onNext}
        disabled={matchCount === 0}
        className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-bg-hover hover:text-ink-1 disabled:opacity-40"
        title="Next match (Enter)"
      >
        ↓
      </button>
      {value && (
        <button
          onClick={() => onChange('')}
          className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-bg-hover hover:text-ink-1"
          title="Clear"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─── Virtual text body ───────────────────────────────────────────────────────

// Line height in px — must match the font-mono text-xs leading in the pre.
const LINE_HEIGHT_PX = 18;

/**
 * Virtualized pre block. Renders only the visible lines using @tanstack/react-virtual.
 * Highlights search matches within each visible line without touching invisible DOM.
 */
function VirtualTextBody({
  lines,
  matchByLine,
  activeMatchIndex,
  scrollToLineRef,
}: {
  lines: string[];
  matchByLine: Map<number, LineMatch[]>;
  activeMatchIndex: number;
  scrollToLineRef: React.MutableRefObject<((lineIndex: number) => void) | null>;
}): JSX.Element {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT_PX,
    overscan: 20,
  });

  // Expose a scroll-to callback so BodyPanel can jump to active match line.
  // virtualizer handles vertical scroll (instant — smooth left the DOM in an
  // intermediate position while we tried to measure). After the row is
  // mounted we compute the active mark's left offset manually and set
  // parent.scrollLeft directly, which works regardless of contain:strict or
  // the absolute-positioned slab we render inside.
  useEffect(() => {
    scrollToLineRef.current = (lineIndex: number) => {
      virtualizer.scrollToIndex(lineIndex, { align: 'center', behavior: 'auto' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const parent = parentRef.current;
          if (!parent) return;
          const el = parent.querySelector<HTMLElement>(
            '[data-active-match="true"]',
          );
          if (!el) return;
          const parentRect = parent.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const elCenterWithinContent =
            elRect.left + elRect.width / 2 - parentRect.left + parent.scrollLeft;
          const targetScrollLeft = Math.max(
            0,
            elCenterWithinContent - parent.clientWidth / 2,
          );
          parent.scrollLeft = targetScrollLeft;
        });
      });
    };
    return () => {
      scrollToLineRef.current = null;
    };
  }, [virtualizer, scrollToLineRef]);

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: 'strict' }}
    >
      {/* Total height placeholder so the scrollbar is correctly sized */}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
        }}
      >
        {/* Positioned slab shifted to the current render window */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            minWidth: '100%',
            width: 'max-content',
            transform: `translateY(${items[0]?.start ?? 0}px)`,
          }}
        >
          {items.map((vRow) => {
            const line = lines[vRow.index] ?? '';
            const lineMatches = matchByLine.get(vRow.index);
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                style={{
                  height: LINE_HEIGHT_PX,
                  lineHeight: `${LINE_HEIGHT_PX}px`,
                }}
                className="whitespace-pre px-4 font-mono text-xs text-ink-1"
              >
                {lineMatches
                  ? renderLineWithMatches(line, lineMatches, activeMatchIndex)
                  : line || ' '}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a single line string with match highlights applied only to the
 * segments that are visible — no work done on non-visible lines.
 */
function renderLineWithMatches(
  line: string,
  matches: LineMatch[],
  activeMatchIndex: number,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) {
      nodes.push(line.slice(cursor, m.start));
    }
    const isActive = m.globalIndex === activeMatchIndex;
    nodes.push(
      <mark
        key={`m-${m.globalIndex}`}
        data-active-match={isActive ? 'true' : undefined}
        className={
          isActive
            ? 'rounded-sm bg-accent px-0.5 text-white'
            : 'rounded-sm bg-accent-soft px-0.5 text-accent'
        }
      >
        {line.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  }
  if (cursor < line.length) {
    nodes.push(line.slice(cursor));
  }
  return nodes;
}

// ─── renderBody ──────────────────────────────────────────────────────────────

function renderBody({
  kind,
  mode,
  text,
  pretty,
  parsed,
  bodyBase64,
  mimeType,
  search,
  searchRaw,
  matchAll,
  matchByLine,
  activeMatchIndex,
  lines,
  scrollToLineRef,
}: {
  kind: ContentKind;
  mode: BodyMode;
  text: string;
  pretty: string;
  parsed: { ok: boolean; value: unknown };
  bodyBase64: string;
  mimeType: string;
  search: string;
  searchRaw: string;
  matchAll: LineMatch[];
  matchByLine: Map<number, LineMatch[]>;
  activeMatchIndex: number;
  lines: string[];
  scrollToLineRef: React.MutableRefObject<((lineIndex: number) => void) | null>;
}): JSX.Element {
  if (kind === 'json' && mode === 'tree' && parsed.ok) {
    return (
      <div className="h-full overflow-auto p-4">
        <JsonTree value={parsed.value} />
      </div>
    );
  }

  if (kind === 'image' && mode === 'preview') {
    return (
      <div className="flex h-full items-center justify-center bg-[repeating-conic-gradient(var(--bg-subtle)_0_25%,var(--bg-canvas)_0_50%)] bg-[length:20px_20px] p-4">
        <img
          src={`data:${mimeType};base64,${bodyBase64}`}
          alt="response"
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (kind === 'pdf' && mode === 'preview') {
    return (
      <embed
        type="application/pdf"
        src={`data:application/pdf;base64,${bodyBase64}`}
        className="h-full w-full"
      />
    );
  }

  if (kind === 'html' && mode === 'preview') {
    return (
      <iframe
        title="response"
        srcDoc={text}
        sandbox=""
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  // HTML pretty mode — use CodeMirror for syntax-highlighted rendering.
  // The outer SearchBox still computes matches against the raw text; when the
  // user navigates (Enter / Shift+Enter), we map the active match's line/char
  // into a CodeMirror range and let the editor scroll+select it.
  if (kind === 'html' && mode === 'pretty') {
    const active = matchAll[activeMatchIndex];
    return (
      <HtmlEditor
        content={text}
        activeMatch={
          active
            ? {
                lineIndex: active.lineIndex,
                start: active.start,
                end: active.end,
              }
            : null
        }
      />
    );
  }

  // Raw / pretty for all other kinds — virtualized text view.
  const content = mode === 'pretty' ? pretty : text;
  if (!content) {
    return (
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-ink-1">
        <span className="text-ink-4">(empty)</span>
      </pre>
    );
  }

  // For non-empty searchable content use the virtual renderer regardless of
  // whether there is an active search — it handles large bodies efficiently.
  return (
    <VirtualTextBody
      lines={lines}
      matchByLine={search && matchAll.length > 0 ? matchByLine : new Map()}
      activeMatchIndex={activeMatchIndex}
      scrollToLineRef={scrollToLineRef}
    />
  );
}

// ─── detectKind ──────────────────────────────────────────────────────────────

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const half = Math.max(1, Math.floor((max - 1) / 2));
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}

function decodeBodyText(bodyBase64: string): string {
  try {
    const bytes = Uint8Array.from(atob(bodyBase64), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function detectKind(
  contentType: string | undefined,
  bytes: Uint8Array,
  text: string,
): ContentKind {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  if (ct.startsWith('image/')) return 'image';
  if (ct.includes('pdf')) return 'pdf';

  // Magic byte sniff for missing/wrong Content-Type.
  if (bytes.length >= 4) {
    // PDF: %PDF
    if (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    )
      return 'pdf';
    // PNG
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
      return 'image';
    // JPEG
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
    // GIF
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image';
    // WebP: RIFF....WEBP
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
      return 'image';
  }

  const trimmed = text.trim();
  if (trimmed) {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        /* fall through */
      }
    }
    if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) return 'html';
    if (/^<\?xml/i.test(trimmed)) return 'xml';
    return 'text';
  }

  return 'binary';
}

function mimeFor(kind: ContentKind, contentType: string | undefined): string {
  if (contentType) {
    const semi = contentType.indexOf(';');
    return semi >= 0 ? contentType.slice(0, semi).trim() : contentType.trim();
  }
  switch (kind) {
    case 'image':
      return 'image/png';
    case 'pdf':
      return 'application/pdf';
    case 'html':
      return 'text/html';
    case 'xml':
      return 'application/xml';
    case 'json':
      return 'application/json';
    default:
      return 'text/plain';
  }
}

function formatXml(input: string): string {
  // Lightweight XML pretty-printer: insert newlines between adjacent tags and
  // indent. Not a full parser — handles typical responses well enough.
  if (!input.trim()) return input;
  let output = '';
  let indent = 0;
  const tokens = input.replace(/>\s+</g, '><').split(/(?=<)/);
  for (const token of tokens) {
    if (/^<\/[^>]+>/.test(token)) {
      indent = Math.max(0, indent - 1);
      output += '  '.repeat(indent) + token + '\n';
    } else if (/^<[^!?\/][^>]*[^/]>/.test(token) && !/<\/[^>]+>/.test(token)) {
      output += '  '.repeat(indent) + token + '\n';
      indent++;
    } else {
      output += '  '.repeat(indent) + token + '\n';
    }
  }
  return output.trim();
}

// ─── UI primitives ───────────────────────────────────────────────────────────

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
      }`}
    >
      {children}
    </button>
  );
}

function HeadersPanel({ response }: { response: ExecutedResponse }): JSX.Element {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="sticky top-0 z-10 grid grid-cols-[240px_1fr] border-b border-line bg-bg-subtle px-4 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        <div className="py-2">Name</div>
        <div className="py-2">Value</div>
      </div>
      {response.headers.map(([name, value], i) => (
        <div
          key={i}
          className="grid grid-cols-[240px_1fr] border-b border-line-subtle px-4 hover:bg-bg-subtle"
        >
          <div className="truncate py-2 font-mono text-xs text-ink-3">{name}</div>
          <div className="break-all py-2 font-mono text-xs text-ink-1">{value}</div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: number }): JSX.Element {
  const { bg, text, label } =
    status >= 200 && status < 300
      ? { bg: 'bg-status-ok/10', text: 'text-status-ok', label: 'OK' }
      : status >= 300 && status < 400
        ? { bg: 'bg-status-redirect/10', text: 'text-status-redirect', label: 'Redirect' }
        : status >= 400 && status < 500
          ? {
              bg: 'bg-status-clientError/10',
              text: 'text-status-clientError',
              label: 'Client',
            }
          : {
              bg: 'bg-status-serverError/10',
              text: 'text-status-serverError',
              label: 'Server',
            };
  return (
    <div className={`flex items-center gap-2 rounded px-2 py-1 ${bg}`}>
      <span className={`font-mono text-xs font-semibold ${text}`}>{status}</span>
      <span className={`text-[10px] font-medium uppercase tracking-wider ${text}`}>
        {label}
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        {label}
      </span>
      <span className="font-mono text-xs text-ink-2">{value}</span>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-muted text-ink-3">
        {icon}
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold text-ink-1">{title}</div>
        <div className="mt-1 text-xs text-ink-3">{description}</div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button onClick={onClick} className={`tab ${active ? 'tab-active' : ''}`}>
      {children}
    </button>
  );
}

const MIME_EXT: Record<string, string> = {
  'application/json': '.json',
  'text/html': '.html',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'application/octet-stream': '.bin',
};

function extForContentType(contentType: string | undefined): string {
  if (!contentType) return '.bin';
  const mime = contentType.split(';')[0]!.trim().toLowerCase();
  if (MIME_EXT[mime]) return MIME_EXT[mime]!;
  if (mime.includes('json')) return '.json';
  if (mime.includes('html')) return '.html';
  if (mime.includes('xml')) return '.xml';
  if (mime === 'text/plain') return '.txt';
  return '.bin';
}

function parseContentDispositionFilename(
  headers: Array<[string, string]>,
): string | null {
  const header = headers.find(([n]) => n.toLowerCase() === 'content-disposition');
  if (!header) return null;
  const value = header[1];
  // RFC 5987 filename*=UTF-8''encoded — prefer over filename=
  const starMatch = /filename\*\s*=\s*([^;]+)/i.exec(value);
  if (starMatch) {
    const raw = starMatch[1]!.trim();
    const parts = raw.split("''");
    const encoded = parts.length === 2 ? parts[1]! : raw;
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* fall through */
    }
  }
  const match = /filename\s*=\s*("([^"]+)"|([^;]+))/i.exec(value);
  if (match) {
    return (match[2] ?? match[3] ?? '').trim() || null;
  }
  return null;
}

function deriveFilename(
  response: ExecutedResponse,
  requestUrl: string,
): string {
  const fromCd = parseContentDispositionFilename(response.headers);
  if (fromCd) return fromCd;

  let base = 'response';
  try {
    const u = new URL(requestUrl);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) base = last;
  } catch {
    const noQuery = requestUrl.split('?')[0] ?? '';
    const last = noQuery.split('/').filter(Boolean).pop();
    if (last) base = last;
  }

  const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(base);
  if (hasExt) return base;
  return base + extForContentType(response.contentType);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
