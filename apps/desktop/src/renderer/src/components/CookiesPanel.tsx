import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import type { CookieEntry } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore } from '../store.js';
import { ConfirmDialog } from '../ui/Dialog.js';

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

  const reload = async (): Promise<void> => {
    if (!workspace) return;
    setLoading(true);
    const list = await bridge.cookieList(workspace.path);
    setCookies(list);
    setLoading(false);
  };

  useEffect(() => {
    if (open) void reload();
  }, [open, workspace?.path]);

  const grouped = useMemo(() => {
    const map = new Map<string, CookieEntry[]>();
    for (const cookie of cookies) {
      const arr = map.get(cookie.domain) ?? [];
      arr.push(cookie);
      map.set(cookie.domain, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [cookies]);

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

  return (
    <>
      <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
          <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[820px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade">
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
              >
                Clear all
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="px-5 py-8 text-center text-xs text-ink-4">
                  Loading…
                </div>
              )}
              {!loading && grouped.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <div className="text-sm font-semibold text-ink-1">No cookies</div>
                  <div className="mt-1 text-xs text-ink-3">
                    Cookies will appear here as you send requests.
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
                      >
                        clear domain
                      </button>
                    </div>
                    <div>
                      {entries.map((cookie) => (
                        <div
                          key={`${cookie.domain}-${cookie.path}-${cookie.name}`}
                          className="group grid grid-cols-[1fr_2fr_auto] items-center gap-3 border-t border-line-subtle px-5 py-2 hover:bg-bg-subtle"
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
                          <div className="truncate font-mono text-xs text-ink-2">
                            {cookie.value}
                          </div>
                          <button
                            onClick={() => void deleteCookie(cookie)}
                            className="opacity-0 group-hover:opacity-100 icon-btn"
                            aria-label="Delete cookie"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3">
              <button onClick={onClose} className="btn-secondary">
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
