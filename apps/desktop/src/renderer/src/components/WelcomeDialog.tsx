import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge.js';
import { useAppStore } from '../store.js';
import { shortcutLabel } from '../hooks/useShortcuts.js';

const WELCOME_SEEN_KEY = 'app:welcomeSeen';

/**
 * First-launch welcome dialog. Shown exactly once per machine — on
 * any subsequent launch the `app:welcomeSeen` localStorage flag
 * suppresses it. Skipped entirely when a workspace is already open
 * (the user got there via an installer that pre-seeded one, or
 * they previously hit the post-update changelog dialog which counts
 * as having seen the app).
 *
 * The post-update changelog dialog has its own flag so a fresh
 * install on a workspace-less machine sees only this welcome, never
 * a changelog they didn't author.
 */
export function WelcomeDialog(): JSX.Element | null {
  const workspace = useAppStore((s) => s.workspace);
  const recents = useAppStore((s) => s.recents);
  const openWorkspace = useAppStore((s) => s.openWorkspace);
  const newTab = useAppStore((s) => s.newTab);
  const focusUrl = useAppStore((s) => s.focusUrl);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(WELCOME_SEEN_KEY) === 'true';
    } catch {
      return;
    }
    if (seen) return;
    setOpen(true);
  }, []);

  const dismiss = (): void => {
    setOpen(false);
    try {
      window.localStorage.setItem(WELCOME_SEEN_KEY, 'true');
    } catch {
      /* ignore */
    }
  };

  const handleNewTab = (): void => {
    newTab();
    focusUrl();
    dismiss();
  };

  const handleOpenWorkspace = async (): Promise<void> => {
    const picked = await bridge.workspacePickDir();
    if (picked) {
      await openWorkspace(picked);
      dismiss();
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && dismiss()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-fade-in">
          <div className="px-6 pt-6">
            <RadixDialog.Title className="text-base font-semibold text-ink-1">
              Welcome to Scrapeman
            </RadixDialog.Title>
            <RadixDialog.Description className="mt-1 text-xs text-ink-3">
              A local-first API client built for scraping engineers. Three quick paths in.
            </RadixDialog.Description>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-2">
              <QuickStartCard
                title="Start a request"
                description="Open a draft tab with an empty URL bar. Type or paste a curl command to import."
                action="Open URL bar"
                onClick={handleNewTab}
                shortcut={shortcutLabel('mod+t')}
              />
              <QuickStartCard
                title="Open a workspace"
                description="Point at a folder full of .sman files — your collection becomes the sidebar tree. Git-friendly out of the box."
                action="Pick folder…"
                onClick={() => void handleOpenWorkspace()}
              />
              {recents.length > 0 && (
                <div className="rounded-md border border-line bg-bg-subtle px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                    Recent workspaces
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {recents.slice(0, 5).map((r) => (
                      <li key={r.path}>
                        <button
                          type="button"
                          onClick={() => {
                            void openWorkspace(r.path);
                            dismiss();
                          }}
                          className="block w-full truncate rounded px-2 py-1 text-left text-xs text-ink-2 hover:bg-bg-hover hover:text-ink-1"
                          title={r.path}
                        >
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-2 text-ink-4">{r.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                Top shortcuts
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                <ShortcutHint combo="mod+enter" label="Send request" />
                <ShortcutHint combo="mod+k" label="Command palette" />
                <ShortcutHint combo="mod+t" label="New tab" />
                <ShortcutHint combo="mod+l" label="Focus URL bar" />
                <ShortcutHint combo="mod+s" label="Save" />
                <ShortcutHint combo="mod+b" label="Toggle sidebar" />
              </div>
              <div className="mt-2 text-[11px] text-ink-4">
                See the full list in Settings → Keyboard shortcuts.
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line bg-bg-subtle px-6 py-3">
            <a
              href="https://scrapeman.app/docs"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-ink-3 hover:text-ink-1"
            >
              Read the docs ↗
            </a>
            <button type="button" onClick={dismiss} className="btn-secondary">
              Get started
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function QuickStartCard({
  title,
  description,
  action,
  onClick,
  shortcut,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  shortcut?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-1 rounded-md border border-line bg-bg-canvas px-3 py-2.5 text-left text-xs transition-colors hover:border-line-strong hover:bg-bg-hover"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-ink-1">{title}</span>
        <span className="font-mono text-[10px] text-accent group-hover:underline">
          {action}
        </span>
      </div>
      <span className="text-[11px] leading-relaxed text-ink-3">{description}</span>
      {shortcut && (
        <span className="mt-0.5 font-mono text-[10px] text-ink-4">{shortcut}</span>
      )}
    </button>
  );
}

function ShortcutHint({
  combo,
  label,
}: {
  combo: string;
  label: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <kbd className="shrink-0 rounded border border-line bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
        {shortcutLabel(combo)}
      </kbd>
      <span className="text-ink-3">{label}</span>
    </div>
  );
}
