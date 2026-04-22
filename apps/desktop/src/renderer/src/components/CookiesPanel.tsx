import * as RadixDialog from '@radix-ui/react-dialog';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CookieEntry } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore } from '../store.js';
import { ConfirmDialog } from '../ui/Dialog.js';

// ---------------------------------------------------------------------------
// Cookie format utilities (pure, no Node deps — inlined to avoid bundling
// @scrapeman/http-core in the renderer).
// ---------------------------------------------------------------------------

function exportNetscape(cookies: CookieEntry[]): string {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/docs/http-cookies.html',
    '# Exported by Scrapeman',
    '',
  ];
  for (const c of cookies) {
    const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expires =
      c.expires && c.expires !== 'Session'
        ? String(Math.floor(new Date(c.expires).getTime() / 1000))
        : '0';
    lines.push([domain, 'TRUE', c.path || '/', secure, expires, c.name, c.value].join('\t'));
  }
  return lines.join('\n');
}

function parseNetscape(text: string): CookieEntry[] {
  const result: CookieEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [domainRaw, , path, secureStr, expiresStr, name, value] = parts as [
      string, string, string, string, string, string, string,
    ];
    const domain = domainRaw.startsWith('.') ? domainRaw.slice(1) : domainRaw;
    const secure = secureStr === 'TRUE';
    const expiresUnix = parseInt(expiresStr, 10);
    const expires = expiresUnix > 0 ? new Date(expiresUnix * 1000).toISOString() : null;
    result.push({ domain, path: path || '/', name, value: value ?? '', expires, httpOnly: false, secure, sameSite: null });
  }
  return result;
}

function parseDocumentCookie(text: string, domain: string): CookieEntry[] {
  const result: CookieEntry[] = [];
  for (const pair of text.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!name) continue;
    result.push({ domain, path: '/', name, value, expires: null, httpOnly: false, secure: false, sameSite: null });
  }
  return result;
}

function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Cookie form (add / edit)
// ---------------------------------------------------------------------------

const EMPTY_FORM: CookieEntry = {
  domain: '',
  path: '/',
  name: '',
  value: '',
  expires: null,
  httpOnly: false,
  secure: false,
  sameSite: null,
};

function CookieForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: CookieEntry;
  onSave: (c: CookieEntry) => void;
  onCancel: () => void;
}): JSX.Element {
  const [form, setForm] = useState<CookieEntry>(initial);

  const set = <K extends keyof CookieEntry>(key: K, value: CookieEntry[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const valid = form.name.trim() !== '' && form.domain.trim() !== '';

  return (
    <div className="border-t border-line bg-bg-subtle px-5 py-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide">Name *</span>
          <input
            className="input w-full font-mono text-xs"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="cookie-name"
            autoFocus
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide">Value</span>
          <input
            className="input w-full font-mono text-xs"
            value={form.value}
            onChange={(e) => set('value', e.target.value)}
            placeholder="cookie-value"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide">Domain *</span>
          <input
            className="input w-full font-mono text-xs"
            value={form.domain}
            onChange={(e) => set('domain', e.target.value)}
            placeholder="example.com"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide">Path</span>
          <input
            className="input w-full font-mono text-xs"
            value={form.path}
            onChange={(e) => set('path', e.target.value)}
            placeholder="/"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide">Expires</span>
          <input
            className="input w-full font-mono text-xs"
            value={form.expires ?? ''}
            onChange={(e) => set('expires', e.target.value || null)}
            placeholder="Session or ISO date"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide">SameSite</span>
          <select
            className="input w-full text-xs"
            value={form.sameSite ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              set('sameSite', (v === '' ? null : v) as CookieEntry['sameSite']);
            }}
          >
            <option value="">—</option>
            <option value="strict">Strict</option>
            <option value="lax">Lax</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.httpOnly}
            onChange={(e) => set('httpOnly', e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-ink-2">HttpOnly</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.secure}
            onChange={(e) => set('secure', e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-ink-2">Secure</span>
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary text-xs">
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!valid}
          className="btn-primary text-xs disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import dialog
// ---------------------------------------------------------------------------

function ImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (cookies: CookieEntry[]) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');

  const handleImport = (): void => {
    setError('');
    let parsed: CookieEntry[] = [];
    // Detect format: Netscape lines have tabs; document.cookie uses semicolons.
    const firstDataLine = text
      .split('\n')
      .find((l) => l.trim() && !l.trim().startsWith('#'));
    if (firstDataLine && firstDataLine.includes('\t')) {
      parsed = parseNetscape(text);
    } else {
      if (!domain.trim()) {
        setError('Enter the domain for these cookies (e.g. example.com).');
        return;
      }
      parsed = parseDocumentCookie(text, domain.trim());
    }
    if (parsed.length === 0) {
      setError('No cookies found in the input.');
      return;
    }
    onImport(parsed);
    setText('');
    setDomain('');
    onClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[560px] -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <RadixDialog.Title className="text-sm font-semibold text-ink-1">
              Import cookies
            </RadixDialog.Title>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-ink-3">
              Paste a <span className="font-mono text-ink-2">document.cookie</span> string or a Netscape cookies.txt body.
              The format is detected automatically.
            </p>
            <textarea
              className="input w-full font-mono text-xs h-36 resize-none"
              placeholder={'name=value; name2=value2\n— or —\n# Netscape HTTP Cookie File\nexample.com\tTRUE\t/\tFALSE\t0\tname\tvalue'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <label className="space-y-1 block">
              <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide">
                Domain (required for document.cookie format)
              </span>
              <input
                className="input w-full font-mono text-xs"
                placeholder="example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </label>
            {error && <p className="text-xs text-method-delete">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3">
            <button onClick={onClose} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!text.trim()}
              className="btn-primary text-xs disabled:opacity-40"
            >
              Import
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function CookiesPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const workspace = useAppStore((s) => s.workspace);
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [confirmDomain, setConfirmDomain] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  // addForm: null = hidden, 'new' = blank add, CookieEntry = edit mode
  const [addForm, setAddForm] = useState<CookieEntry | 'new' | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);

  const reload = async (): Promise<void> => {
    if (!workspace) return;
    setLoading(true);
    const list = await bridge.cookieList(workspace.path);
    setCookies(list);
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      void reload();
      setFilter('');
      setAddForm(null);
      setRevealedKeys(new Set());
    }
  }, [open, workspace?.path]);

  const grouped = useMemo(() => {
    const q = filter.toLowerCase();
    const map = new Map<string, CookieEntry[]>();
    for (const cookie of cookies) {
      if (q && !cookie.domain.toLowerCase().includes(q)) continue;
      const arr = map.get(cookie.domain) ?? [];
      arr.push(cookie);
      map.set(cookie.domain, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [cookies, filter]);

  // All cookies after filter (for export).
  const filteredCookies = useMemo(
    () => grouped.flatMap(([, entries]) => entries),
    [grouped],
  );

  const totalCount = cookies.length;

  const deleteCookie = async (cookie: CookieEntry): Promise<void> => {
    if (!workspace) return;
    await bridge.cookieDelete(workspace.path, cookie.domain, cookie.path, cookie.name);
    await reload();
  };

  const clearDomain = async (domain: string): Promise<void> => {
    if (!workspace) return;
    await bridge.cookieClearDomain(workspace.path, domain);
    await reload();
  };

  const clearAll = async (): Promise<void> => {
    if (!workspace) return;
    await bridge.cookieClearAll(workspace.path);
    await reload();
  };

  const saveCookie = async (entry: CookieEntry): Promise<void> => {
    if (!workspace) return;
    await bridge.cookieSet(workspace.path, entry);
    setAddForm(null);
    await reload();
  };

  const handleImport = async (imported: CookieEntry[]): Promise<void> => {
    if (!workspace) return;
    for (const c of imported) {
      await bridge.cookieSet(workspace.path, c);
    }
    await reload();
  };

  const toggleReveal = (key: string): void => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const cookieKey = (c: CookieEntry): string =>
    `${c.domain}__${c.path}__${c.name}`;

  return (
    <>
      <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
          <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[820px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <RadixDialog.Title className="text-sm font-semibold text-ink-1">
                  Cookies
                </RadixDialog.Title>
                <RadixDialog.Description className="mt-0.5 text-xs text-ink-3">
                  {totalCount} cookies across {grouped.length} domains. Cookies
                  scoped to{' '}
                  <span className="font-mono text-ink-2">
                    {useAppStore.getState().activeEnvironment ?? 'no environment'}
                  </span>
                  .
                </RadixDialog.Description>
              </div>
              <button
                onClick={() => setConfirmAll(true)}
                disabled={totalCount === 0}
                className="btn-ghost text-method-delete hover:text-method-delete disabled:text-ink-5"
                title="Clear all cookies"
              >
                Clear all
              </button>
            </div>

            {/* Filter + actions toolbar */}
            <div className="flex items-center gap-2 border-b border-line px-5 py-2">
              <input
                className="input flex-1 text-xs font-mono"
                placeholder="Filter by domain…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button
                onClick={() => setAddForm(EMPTY_FORM)}
                className="btn-secondary text-xs whitespace-nowrap"
                title="Add a cookie manually"
              >
                + Add
              </button>
              <button
                onClick={() => setImportOpen(true)}
                className="btn-secondary text-xs whitespace-nowrap"
                title="Import cookies"
              >
                Import
              </button>
              <button
                onClick={() =>
                  triggerDownload(
                    'cookies.json',
                    JSON.stringify(filteredCookies, null, 2),
                    'application/json',
                  )
                }
                disabled={filteredCookies.length === 0}
                className="btn-secondary text-xs whitespace-nowrap disabled:opacity-40"
                title="Export as JSON"
              >
                JSON
              </button>
              <button
                onClick={() =>
                  triggerDownload(
                    'cookies.txt',
                    exportNetscape(filteredCookies),
                    'text/plain',
                  )
                }
                disabled={filteredCookies.length === 0}
                className="btn-secondary text-xs whitespace-nowrap disabled:opacity-40"
                title="Export Netscape cookies.txt"
              >
                Netscape
              </button>
            </div>

            {/* Add / edit form (shown inline below toolbar) */}
            {addForm !== null && (
              <CookieForm
                initial={addForm === 'new' ? EMPTY_FORM : addForm}
                onSave={(entry) => void saveCookie(entry)}
                onCancel={() => setAddForm(null)}
              />
            )}

            {/* Cookie list */}
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="px-5 py-8 text-center text-xs text-ink-4">
                  Loading…
                </div>
              )}
              {!loading && grouped.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <div className="text-sm font-semibold text-ink-1">
                    {filter ? 'No matching cookies' : 'No cookies'}
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {filter
                      ? 'Clear the filter to see all cookies.'
                      : 'Cookies will appear here as you send requests.'}
                  </div>
                </div>
              )}
              {!loading &&
                grouped.map(([domain, entries]) => (
                  <div key={domain} className="border-b border-line-subtle">
                    <div className="flex items-center gap-2 bg-bg-subtle px-5 py-2">
                      <div className="flex-1 font-mono text-xs font-semibold text-ink-2">
                        {domain}
                      </div>
                      <span className="text-[10px] text-ink-4">
                        {entries.length}
                      </span>
                      <button
                        onClick={() => setConfirmDomain(domain)}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-4 hover:bg-bg-active hover:text-method-delete"
                        title="Clear domain cookies"
                      >
                        clear domain
                      </button>
                    </div>
                    <div>
                      {entries.map((cookie) => {
                        const key = cookieKey(cookie);
                        const revealed = revealedKeys.has(key);
                        const displayValue = cookie.httpOnly && !revealed
                          ? '••••••••'
                          : cookie.value;
                        return (
                          <div
                            key={key}
                            className="group grid grid-cols-[1fr_2fr_auto] items-center gap-3 border-t border-line-subtle px-5 py-2 hover:bg-bg-subtle cursor-pointer"
                            onClick={() => setAddForm(cookie)}
                            title="Click to edit"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-mono text-xs text-ink-1">
                                {cookie.name}
                              </div>
                              <div className="truncate text-[10px] text-ink-4">
                                {cookie.path}
                                {cookie.httpOnly && ' · HttpOnly'}
                                {cookie.secure && ' · Secure'}
                                {cookie.sameSite && ` · SameSite=${cookie.sameSite}`}
                                {cookie.expires && ` · expires ${formatExpires(cookie.expires)}`}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate font-mono text-xs text-ink-2">
                                {displayValue}
                              </span>
                              {cookie.httpOnly && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleReveal(key);
                                  }}
                                  className="shrink-0 icon-btn opacity-0 group-hover:opacity-100"
                                  aria-label={revealed ? 'Hide value' : 'Reveal value'}
                                  title={revealed ? 'Hide value' : 'Reveal value'}
                                >
                                  {revealed ? (
                                    <EyeOff size={12} />
                                  ) : (
                                    <Eye size={12} />
                                  )}
                                </button>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteCookie(cookie);
                              }}
                              className="opacity-0 group-hover:opacity-100 icon-btn"
                              aria-label="Delete cookie"
                              title="Delete cookie"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3">
              <button onClick={onClose} className="btn-secondary" title="Close cookies panel">
                Close
              </button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <ConfirmDialog
        open={confirmDomain !== null}
        title={`Clear cookies for ${confirmDomain}?`}
        description="All cookies for this domain in the current environment will be removed."
        confirmLabel="Clear domain"
        destructive
        onConfirm={() => {
          if (confirmDomain) void clearDomain(confirmDomain);
        }}
        onClose={() => setConfirmDomain(null)}
      />
      <ConfirmDialog
        open={confirmAll}
        title="Clear all cookies?"
        description="Every cookie for the current environment will be deleted."
        confirmLabel="Clear all"
        destructive
        onConfirm={() => void clearAll()}
        onClose={() => setConfirmAll(false)}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={(c) => void handleImport(c)}
      />
    </>
  );
}

function formatExpires(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
