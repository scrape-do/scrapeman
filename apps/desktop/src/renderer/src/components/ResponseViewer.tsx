import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExecutedResponse } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore } from '../store.js';
import { JsonTree } from './JsonTree.js';

type Tab = 'body' | 'headers';

type ContentKind = 'json' | 'html' | 'xml' | 'image' | 'pdf' | 'text' | 'binary';
type BodyMode = 'raw' | 'pretty' | 'tree' | 'preview';

const MODE_LABEL: Record<BodyMode, string> = {
  raw: 'Raw',
  pretty: 'Pretty',
  tree: 'Tree',
  preview: 'Preview',
};

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
  const [tab, setTab] = useState<Tab>('body');

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-4 border-b border-line px-4">
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

      <div className="flex h-9 items-center border-b border-line px-4">
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

      <div className="flex-1 overflow-auto">
        {tab === 'body' && <BodyPanel response={response} />}
        {tab === 'headers' && <HeadersPanel response={response} />}
      </div>
    </div>
  );
}

function BodyPanel({ response }: { response: ExecutedResponse }): JSX.Element {
  const search = useAppStore((s) => {
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

  // Effective mode: persisted choice if it is still valid for the new
  // content kind, otherwise the default for the kind. Persisting in tab
  // state means new sends keep the user's last choice (Tree, Pretty,
  // etc.) instead of snapping back to Raw on every response.
  const mode: BodyMode =
    persistedMode && availableModes.includes(persistedMode)
      ? persistedMode
      : (availableModes[0] ?? 'raw');

  const setMode = (next: BodyMode): void => {
    setPersistedMode(next);
  };

  // Lazy JSON parse — only when Tree or Pretty for json kind.
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
    if (kind === 'html' || kind === 'xml') {
      return formatXmlOrHtml(text);
    }
    return text;
  }, [mode, kind, parsed, text]);

  const mimeType = useMemo(() => mimeFor(kind, response.contentType), [
    kind,
    response.contentType,
  ]);

  // Which string are we searching over — depends on mode.
  const searchable =
    mode === 'pretty' ? pretty : mode === 'raw' ? text : null;

  const matches = useMemo<number[]>(() => {
    if (!search || !searchable) return [];
    const needle = search.toLowerCase();
    const haystack = searchable.toLowerCase();
    const out: number[] = [];
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      out.push(idx);
      from = idx + Math.max(1, needle.length);
    }
    return out;
  }, [search, searchable]);

  // Clamp active match when match count shrinks (new response, fewer hits).
  useEffect(() => {
    if (matches.length === 0) {
      setActiveMatchIndex(0);
    } else if (activeMatchIndex >= matches.length) {
      setActiveMatchIndex(0);
    }
  }, [matches.length]);

  const searchable_supported = mode === 'raw' || mode === 'pretty';
  const activeMatchRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (activeMatchRef.current) {
      activeMatchRef.current.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }
  }, [activeMatchIndex, matches.length, response.bodyBase64]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-4 py-2">
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
            value={search}
            onChange={setSearch}
            matchCount={matches.length}
            activeIndex={activeMatchIndex}
            onPrev={() =>
              setActiveMatchIndex((i) =>
                matches.length === 0
                  ? 0
                  : (i - 1 + matches.length) % matches.length,
              )
            }
            onNext={() =>
              setActiveMatchIndex((i) =>
                matches.length === 0 ? 0 : (i + 1) % matches.length,
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
      <div className="flex-1 overflow-auto">
        {renderBody({
          kind,
          mode,
          text,
          pretty,
          parsed,
          bodyBase64: response.bodyBase64,
          mimeType,
          search,
          matches,
          activeMatchIndex,
          activeMatchRef,
        })}
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  matchCount,
  activeIndex,
  onPrev,
  onNext,
}: {
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

function renderBody({
  kind,
  mode,
  text,
  pretty,
  parsed,
  bodyBase64,
  mimeType,
  search,
  matches,
  activeMatchIndex,
  activeMatchRef,
}: {
  kind: ContentKind;
  mode: BodyMode;
  text: string;
  pretty: string;
  parsed: { ok: boolean; value: unknown };
  bodyBase64: string;
  mimeType: string;
  search: string;
  matches: number[];
  activeMatchIndex: number;
  activeMatchRef: React.MutableRefObject<HTMLElement | null>;
}): JSX.Element {
  if (kind === 'json' && mode === 'tree' && parsed.ok) {
    return (
      <div className="p-4">
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

  const content = mode === 'pretty' ? pretty : text;
  if (!content) {
    return (
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-ink-1">
        <span className="text-ink-4">(empty)</span>
      </pre>
    );
  }

  if (search && matches.length > 0) {
    return (
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-ink-1">
        {renderHighlightedText(
          content,
          search.length,
          matches,
          activeMatchIndex,
          activeMatchRef,
        )}
      </pre>
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-ink-1">
      {content}
    </pre>
  );
}

function renderHighlightedText(
  text: string,
  needleLen: number,
  matches: number[],
  activeIndex: number,
  activeMatchRef: React.MutableRefObject<HTMLElement | null>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!;
    const end = start + needleLen;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const isActive = i === activeIndex;
    nodes.push(
      <mark
        key={`m-${i}`}
        ref={
          isActive
            ? (el: HTMLElement | null) => {
                activeMatchRef.current = el;
              }
            : undefined
        }
        className={
          isActive
            ? 'rounded-sm bg-accent px-0.5 text-white'
            : 'rounded-sm bg-accent-soft px-0.5 text-accent'
        }
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
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

function formatXmlOrHtml(input: string): string {
  // Lightweight pretty-printer: insert newlines between adjacent tags and
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
    <div className="flex flex-col">
      <div className="grid grid-cols-[240px_1fr] border-b border-line bg-bg-subtle px-4 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
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
