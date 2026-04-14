import * as RadixDialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../bridge.js';
import { useAppStore } from '../store.js';
import { usePlatform } from '../hooks/usePlatform.js';
import { ConfirmDialog } from '../ui/Dialog.js';

interface HistoryStats {
  count: number;
  diskBytes: number;
  path: string;
}

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const workspace = useAppStore((s) => s.workspace);
  const loadHistory = useAppStore((s) => s.loadHistory);
  const platform = usePlatform();
  const revealLabel = platform === 'darwin' ? 'Reveal in Finder' : 'Show in Explorer';

  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmClearOne, setConfirmClearOne] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!workspace) {
      setStats(null);
      return;
    }
    setLoading(true);
    try {
      const next = await bridge.historyStats(workspace.path);
      setStats(next);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const copyPath = async (): Promise<void> => {
    if (!stats?.path) return;
    try {
      await navigator.clipboard.writeText(stats.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const clearCurrent = async (): Promise<void> => {
    if (!workspace) return;
    await bridge.historyClear(workspace.path);
    await loadHistory();
    await refresh();
  };

  const clearAll = async (): Promise<void> => {
    await bridge.historyClearAll();
    await loadHistory();
    await refresh();
  };

  return (
    <>
      <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
          <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg-canvas p-5 shadow-popover animate-slide-down-fade">
            <RadixDialog.Title className="text-sm font-semibold text-ink-1">
              Settings
            </RadixDialog.Title>
            <RadixDialog.Description className="mt-1 text-xs text-ink-3">
              Manage where Scrapeman keeps request history on disk.
            </RadixDialog.Description>

            <section className="mt-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Storage
              </div>

              {!workspace && (
                <div className="mt-3 rounded-md border border-line bg-bg-subtle px-3 py-2 text-xs text-ink-3">
                  Open a workspace to see storage details.
                </div>
              )}

              {workspace && (
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="text-[11px] text-ink-3">History file</div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md border border-line bg-bg-subtle px-2 py-1.5 font-mono text-[11px] text-ink-2">
                        {stats?.path ?? '…'}
                      </code>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void copyPath()}
                        disabled={!stats?.path}
                        title="Copy path"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => stats?.path && void bridge.openInShell(stats.path)}
                        disabled={!stats?.path}
                      >
                        {revealLabel}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Metric
                      label="Entries"
                      value={loading && !stats ? '…' : String(stats?.count ?? 0)}
                    />
                    <Metric
                      label="Disk usage"
                      value={
                        loading && !stats
                          ? '…'
                          : formatBytes(stats?.diskBytes ?? 0)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setConfirmClearOne(true)}
                      className="inline-flex h-8 items-center justify-center rounded-md bg-method-delete px-3.5 text-xs font-semibold text-white hover:bg-[#B6383D] active:bg-[#9D3034]"
                      disabled={!stats || stats.count === 0}
                    >
                      Clear this workspace
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="mt-6 border-t border-line pt-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                All workspaces
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-ink-3">
                  Wipe history files for every workspace stored on this machine.
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-method-delete px-3.5 text-xs font-semibold text-white hover:bg-[#B6383D] active:bg-[#9D3034]"
                >
                  Clear all history
                </button>
              </div>
            </section>

            <div className="mt-6 flex items-center justify-end">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <ConfirmDialog
        open={confirmClearOne}
        title="Clear this workspace history?"
        description="All recorded requests for the current workspace will be removed. This cannot be undone."
        confirmLabel="Clear"
        destructive
        onConfirm={() => void clearCurrent()}
        onClose={() => setConfirmClearOne(false)}
      />
      <ConfirmDialog
        open={confirmClearAll}
        title="Clear history for all workspaces?"
        description="Every workspace history file on this machine will be emptied. This cannot be undone."
        confirmLabel="Clear all"
        destructive
        onConfirm={() => void clearAll()}
        onClose={() => setConfirmClearAll(false)}
      />
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-line bg-bg-subtle px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-ink-1">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
