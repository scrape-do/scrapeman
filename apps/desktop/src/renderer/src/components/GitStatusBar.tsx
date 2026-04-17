import { useMemo } from 'react';
import { useAppStore } from '../store.js';
import type { SplitOrientation } from './SplitPane.js';

declare const __APP_VERSION__: string;

export function GitStatusBar({
  sidebarVisible,
  onToggleSidebar,
  splitOrientation,
  onToggleSplit,
}: {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  splitOrientation: SplitOrientation;
  onToggleSplit: () => void;
}): JSX.Element | null {
  const workspace = useAppStore((s) => s.workspace);
  const gitStatus = useAppStore((s) => s.gitStatus);
  const setSidebarView = useAppStore((s) => s.setSidebarView);

  const counts = useMemo(() => {
    if (!gitStatus) return { modified: 0, untracked: 0, staged: 0 };
    let modified = 0;
    let untracked = 0;
    let staged = 0;
    for (const c of gitStatus.changes) {
      if (c.staged) staged++;
      else if (c.status === 'untracked') untracked++;
      else modified++;
    }
    return { modified, untracked, staged };
  }, [gitStatus]);

  if (!workspace) return null;

  return (
    <div className="flex h-[22px] items-center border-t border-line bg-bg-subtle px-2 text-[11px] text-ink-3">
      {/* Left: git info */}
      <div className="flex flex-1 items-center gap-3 truncate">
        {gitStatus?.isRepo ? (
          <>
            <button
              onClick={() => setSidebarView('git')}
              title="Open Source Control"
              className="flex items-center hover:text-ink-1"
            >
              ⎇ {gitStatus.branch ?? '(detached)'}
            </button>
            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="flex items-center gap-1">
                <span>↑{gitStatus.ahead}</span>
                <span>↓{gitStatus.behind}</span>
              </span>
            )}
            {counts.modified > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-method-put" />
                <span>M {counts.modified}</span>
              </span>
            )}
            {counts.untracked > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-method-patch" />
                <span>U {counts.untracked}</span>
              </span>
            )}
            {counts.staged > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-method-post" />
                <span>S {counts.staged}</span>
              </span>
            )}
          </>
        ) : (
          <span className="truncate">{workspace.name}</span>
        )}
      </div>

      {/* Right: layout controls + version */}
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleSidebar}
          title={`${sidebarVisible ? 'Hide' : 'Show'} sidebar (⌘B)`}
          className="flex h-5 w-5 items-center justify-center rounded text-ink-4 hover:bg-bg-hover hover:text-ink-1"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
          </svg>
        </button>
        <button
          onClick={onToggleSplit}
          title={`Switch to ${splitOrientation === 'horizontal' ? 'top/bottom' : 'side-by-side'} layout`}
          className="flex h-5 w-5 items-center justify-center rounded text-ink-4 hover:bg-bg-hover hover:text-ink-1"
        >
          {splitOrientation === 'horizontal' ? (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
              <line x1="8" y1="2.5" x2="8" y2="13.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
              <line x1="1.5" y1="8" x2="14.5" y2="8" />
            </svg>
          )}
        </button>
        <span className="ml-1 text-ink-4">v{__APP_VERSION__}</span>
      </div>
    </div>
  );
}
