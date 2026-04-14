import { useEffect, useMemo, useState } from 'react';
import type { GitFileChange } from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';
import { bridge } from '../bridge.js';
import { ConfirmDialog } from '../ui/Dialog.js';

const STATUS_BADGE: Record<GitFileChange['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  renamed: 'R',
};

const STATUS_CLASS: Record<GitFileChange['status'], string> = {
  modified: 'text-method-put',
  added: 'text-method-post',
  deleted: 'text-method-delete',
  untracked: 'text-method-patch',
  renamed: 'text-method-options',
};

interface SelectedFile {
  relPath: string;
  staged: boolean;
}

export function SourceControlPanel(): JSX.Element {
  const workspace = useAppStore((s) => s.workspace);
  const gitStatus = useAppStore((s) => s.gitStatus);
  const gitLoaded = useAppStore((s) => s.gitLoaded);
  const gitError = useAppStore((s) => s.gitError);
  const gitBusy = useAppStore((s) => s.gitBusy);
  const loadGitStatus = useAppStore((s) => s.loadGitStatus);
  const stageFile = useAppStore((s) => s.stageFile);
  const unstageFile = useAppStore((s) => s.unstageFile);
  const discardFile = useAppStore((s) => s.discardFile);
  const commitChanges = useAppStore((s) => s.commitChanges);
  const gitPush = useAppStore((s) => s.gitPush);
  const gitPull = useAppStore((s) => s.gitPull);

  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  useEffect(() => {
    if (workspace) void loadGitStatus();
  }, [workspace, loadGitStatus]);

  useEffect(() => {
    if (!selected || !workspace) {
      setDiff('');
      return;
    }
    let cancelled = false;
    void bridge
      .gitDiff(workspace.path, selected.relPath, { staged: selected.staged })
      .then((out) => {
        if (!cancelled) setDiff(out);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setDiff(err instanceof Error ? `# ${err.message}` : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, workspace, gitStatus]);

  const staged = useMemo(
    () => gitStatus?.changes.filter((c) => c.staged) ?? [],
    [gitStatus],
  );
  const unstaged = useMemo(
    () => gitStatus?.changes.filter((c) => !c.staged) ?? [],
    [gitStatus],
  );

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-3">
        Open a workspace to use source control.
      </div>
    );
  }

  if (!gitLoaded) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-3">
        Loading git status…
      </div>
    );
  }

  if (!gitStatus) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-sm font-semibold text-ink-1">
          Git status unavailable
        </div>
        <div className="text-xs text-method-delete">
          {gitError ?? 'Unknown error'}
        </div>
        <button
          onClick={() => void loadGitStatus()}
          className="btn-ghost text-accent hover:text-accent-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!gitStatus.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-sm font-semibold text-ink-1">
          Not a git repository
        </div>
        <div className="text-xs text-ink-3">
          Run <span className="font-mono">git init</span> in your workspace
          folder to enable source control.
        </div>
        <button
          onClick={() => void loadGitStatus()}
          className="btn-ghost text-accent hover:text-accent-hover"
        >
          Refresh
        </button>
      </div>
    );
  }

  const canCommit = staged.length > 0 && message.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-1 border-b border-line px-2">
        <div className="flex-1 truncate px-1.5 text-xs font-semibold text-ink-1">
          ⎇ {gitStatus.branch ?? '(detached)'}
          {gitStatus.changes.length > 0 && (
            <span className="ml-1.5 text-ink-3">
              ●{gitStatus.changes.length}
            </span>
          )}
        </div>
        <button
          title="Pull"
          disabled={gitBusy}
          onClick={() => void gitPull()}
          className="icon-btn disabled:opacity-50"
        >
          ↓{gitStatus.behind > 0 ? gitStatus.behind : ''}
        </button>
        <button
          title="Push"
          disabled={gitBusy}
          onClick={() => void gitPush()}
          className="icon-btn disabled:opacity-50"
        >
          ↑{gitStatus.ahead > 0 ? gitStatus.ahead : ''}
        </button>
        <button
          title="Refresh"
          onClick={() => void loadGitStatus()}
          className="icon-btn"
        >
          ↻
        </button>
      </div>

      {gitError && (
        <div className="border-b border-line bg-bg-hover px-3 py-2 text-[11px] text-method-delete">
          {gitError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-line p-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message (⌘Enter to commit)"
            rows={2}
            className="w-full resize-none rounded-md border border-line bg-bg-canvas px-2 py-1.5 text-xs text-ink-1 outline-none focus:border-accent"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
                e.preventDefault();
                void commitChanges(message).then(() => setMessage(''));
              }
            }}
          />
          <button
            disabled={!canCommit}
            onClick={() => void commitChanges(message).then(() => setMessage(''))}
            className="btn-primary mt-2 w-full text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            Commit {staged.length > 0 ? `(${staged.length})` : ''}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {staged.length > 0 && (
            <Section label={`Staged Changes (${staged.length})`}>
              {staged.map((c) => (
                <FileRow
                  key={`s:${c.path}`}
                  change={c}
                  active={
                    selected?.relPath === c.path && selected.staged === true
                  }
                  onClick={() =>
                    setSelected({ relPath: c.path, staged: true })
                  }
                  actions={
                    <button
                      title="Unstage"
                      onClick={(e) => {
                        e.stopPropagation();
                        void unstageFile(c.path);
                      }}
                      className="icon-btn"
                    >
                      −
                    </button>
                  }
                />
              ))}
            </Section>
          )}

          {unstaged.length > 0 && (
            <Section label={`Changes (${unstaged.length})`}>
              {unstaged.map((c) => (
                <FileRow
                  key={`u:${c.path}`}
                  change={c}
                  active={
                    selected?.relPath === c.path && selected.staged === false
                  }
                  onClick={() =>
                    setSelected({ relPath: c.path, staged: false })
                  }
                  actions={
                    <>
                      <button
                        title="Discard"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDiscard(c.path);
                        }}
                        className="icon-btn"
                      >
                        ⟲
                      </button>
                      <button
                        title="Stage"
                        onClick={(e) => {
                          e.stopPropagation();
                          void stageFile(c.path);
                        }}
                        className="icon-btn"
                      >
                        +
                      </button>
                    </>
                  }
                />
              ))}
            </Section>
          )}

          {gitStatus.changes.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-ink-3">
              No changes.
            </div>
          )}
        </div>

        {selected && (
          <div className="max-h-[40%] min-h-[120px] overflow-auto border-t border-line bg-bg-canvas">
            <div className="sticky top-0 border-b border-line bg-bg-subtle px-3 py-1.5 text-[11px] font-semibold text-ink-2">
              {selected.staged ? 'Staged — ' : ''}
              {selected.relPath}
            </div>
            <DiffView diff={diff} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDiscard !== null}
        title="Discard changes"
        description={
          confirmDiscard
            ? `Discard all changes to "${confirmDiscard}"? This cannot be undone.`
            : ''
        }
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          if (confirmDiscard) void discardFile(confirmDiscard);
        }}
        onClose={() => setConfirmDiscard(null)}
      />
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-bg-subtle px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function FileRow({
  change,
  active,
  onClick,
  actions,
}: {
  change: GitFileChange;
  active: boolean;
  onClick: () => void;
  actions: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`group flex h-7 w-full items-center gap-2 pr-2 pl-3 text-left text-xs ${
        active ? 'bg-accent-soft text-ink-1' : 'text-ink-2 hover:bg-bg-hover'
      }`}
    >
      <span className="flex-1 truncate">{change.path}</span>
      <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        {actions}
      </span>
      <span
        className={`w-4 text-center font-mono text-[10px] font-semibold ${STATUS_CLASS[change.status]}`}
      >
        {STATUS_BADGE[change.status]}
      </span>
    </button>
  );
}

function DiffView({ diff }: { diff: string }): JSX.Element {
  if (!diff.trim()) {
    return (
      <div className="px-3 py-3 text-[11px] text-ink-3">No diff available.</div>
    );
  }
  const lines = diff.split('\n');
  return (
    <pre className="px-3 py-2 font-mono text-[11px] leading-[1.45]">
      {lines.map((line, i) => {
        let cls = 'text-ink-2';
        if (line.startsWith('+++') || line.startsWith('---')) {
          cls = 'text-ink-3';
        } else if (line.startsWith('+')) {
          cls = 'text-method-post';
        } else if (line.startsWith('-')) {
          cls = 'text-method-delete';
        } else if (line.startsWith('@@')) {
          cls = 'text-method-options';
        }
        return (
          <div key={i} className={cls}>
            {line || '\u00a0'}
          </div>
        );
      })}
    </pre>
  );
}
