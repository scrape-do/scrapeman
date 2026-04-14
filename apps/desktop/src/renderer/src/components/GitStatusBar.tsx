import { useMemo } from 'react';
import { useAppStore } from '../store.js';

export function GitStatusBar(): JSX.Element | null {
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

  if (!gitStatus || !gitStatus.isRepo) {
    return (
      <div className="flex h-[22px] items-center border-t border-line bg-bg-subtle px-3 text-[11px] text-ink-3">
        <span className="truncate">{workspace.name}</span>
      </div>
    );
  }

  return (
    <div className="flex h-[22px] items-center gap-3 border-t border-line bg-bg-subtle px-3 text-[11px] text-ink-3">
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
    </div>
  );
}
