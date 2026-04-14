import { useMemo, useState } from 'react';
import type { CollectionNode, GitFileChangeStatus } from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/ContextMenu.js';
import { ConfirmDialog, PromptDialog } from '../ui/Dialog.js';
import { HistoryPanel } from './HistoryPanel.js';
import { SourceControlPanel } from './SourceControlPanel.js';
import { SplitPane } from './SplitPane.js';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

const GIT_STATUS_BADGE: Record<GitFileChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  renamed: 'R',
};

const GIT_STATUS_COLOR: Record<GitFileChangeStatus, string> = {
  modified: 'text-method-put',
  added: 'text-method-post',
  deleted: 'text-method-delete',
  untracked: 'text-method-patch',
  renamed: 'text-method-options',
};

type SidebarView = 'files' | 'git';

type DialogState =
  | { kind: 'none' }
  | { kind: 'newRequest'; parent: string }
  | { kind: 'newFolder'; parent: string }
  | { kind: 'rename'; relPath: string; currentName: string }
  | { kind: 'delete'; relPath: string; name: string };

export function Sidebar(): JSX.Element {
  const workspace = useAppStore((s) => s.workspace);
  const root = useAppStore((s) => s.root);
  const pickAndOpenWorkspace = useAppStore((s) => s.pickAndOpenWorkspace);
  const createRequest = useAppStore((s) => s.createRequest);
  const createFolder = useAppStore((s) => s.createFolder);
  const renameNode = useAppStore((s) => s.renameNode);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const gitStatus = useAppStore((s) => s.gitStatus);

  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [view, setView] = useState<SidebarView>('files');

  const gitStatusByPath = useMemo(() => {
    const map = new Map<string, GitFileChangeStatus>();
    if (!gitStatus) return map;
    // Prefer the worktree status (unstaged) for badges, but fall back to
    // staged if the file is only staged — matches VS Code behaviour.
    for (const change of gitStatus.changes) {
      if (!map.has(change.path) || !change.staged) {
        map.set(change.path, change.status);
      }
    }
    return map;
  }, [gitStatus]);

  if (!workspace || !root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          📁
        </div>
        <div>
          <div className="text-sm font-semibold text-ink-1">No workspace open</div>
          <div className="mt-1 text-xs text-ink-3">
            Pick a folder to start organising requests.
          </div>
        </div>
        <button
          onClick={() => void pickAndOpenWorkspace()}
          className="btn-primary"
        >
          Open folder…
        </button>
      </div>
    );
  }

  const closeDialog = (): void => setDialog({ kind: 'none' });

  const dirtyCount = gitStatus?.changes.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-stretch border-b border-line">
        <button
          onClick={() => setView('files')}
          className={`flex-1 border-b-2 text-[11px] font-semibold uppercase tracking-wide ${
            view === 'files'
              ? 'border-accent text-ink-1'
              : 'border-transparent text-ink-3 hover:text-ink-1'
          }`}
        >
          Files
        </button>
        <button
          onClick={() => setView('git')}
          className={`relative flex-1 border-b-2 text-[11px] font-semibold uppercase tracking-wide ${
            view === 'git'
              ? 'border-accent text-ink-1'
              : 'border-transparent text-ink-3 hover:text-ink-1'
          }`}
          title="Source Control"
        >
          ⎇ Git
          {dirtyCount > 0 && (
            <span className="ml-1 text-[10px] text-accent">●{dirtyCount}</span>
          )}
        </button>
      </div>
      {view === 'git' ? (
        <div className="min-h-0 flex-1">
          <SourceControlPanel />
        </div>
      ) : (
        <FilesView
          workspaceName={workspace.name}
          onNewRequest={() => setDialog({ kind: 'newRequest', parent: '' })}
          onNewFolder={() => setDialog({ kind: 'newFolder', parent: '' })}
          onPick={() => void pickAndOpenWorkspace()}
          root={root}
          gitStatusByPath={gitStatusByPath}
          setDialog={setDialog}
        />
      )}

      <PromptDialog
        open={dialog.kind === 'newRequest'}
        title="New request"
        description="Name this request. You can rename it later."
        placeholder="Get user profile"
        confirmLabel="Create"
        onConfirm={(name) => {
          if (dialog.kind === 'newRequest') void createRequest(dialog.parent, name);
        }}
        onClose={closeDialog}
      />
      <PromptDialog
        open={dialog.kind === 'newFolder'}
        title="New folder"
        placeholder="Users"
        confirmLabel="Create"
        onConfirm={(name) => {
          if (dialog.kind === 'newFolder') void createFolder(dialog.parent, name);
        }}
        onClose={closeDialog}
      />
      <PromptDialog
        open={dialog.kind === 'rename'}
        title="Rename"
        initialValue={dialog.kind === 'rename' ? dialog.currentName : ''}
        confirmLabel="Rename"
        onConfirm={(name) => {
          if (dialog.kind === 'rename') void renameNode(dialog.relPath, name);
        }}
        onClose={closeDialog}
      />
      <ConfirmDialog
        open={dialog.kind === 'delete'}
        title="Delete item"
        description={
          dialog.kind === 'delete'
            ? `"${dialog.name}" will be removed from disk. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (dialog.kind === 'delete') void deleteNode(dialog.relPath);
        }}
        onClose={closeDialog}
      />
    </div>
  );
}

interface FilesViewProps {
  workspaceName: string;
  onNewRequest: () => void;
  onNewFolder: () => void;
  onPick: () => void;
  root: NonNullable<ReturnType<typeof useAppStore.getState>['root']>;
  gitStatusByPath: Map<string, GitFileChangeStatus>;
  setDialog: (dialog: DialogState) => void;
}

function FilesView({
  workspaceName,
  onNewRequest,
  onNewFolder,
  onPick,
  root,
  gitStatusByPath,
  setDialog,
}: FilesViewProps): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 items-center gap-1 border-b border-line px-2">
        <div className="flex-1 truncate px-1.5 text-xs font-semibold text-ink-1">
          {workspaceName}
        </div>
        <button title="New request" onClick={onNewRequest} className="icon-btn">
          +
        </button>
        <button title="New folder" onClick={onNewFolder} className="icon-btn">
          ⌸
        </button>
        <button title="Switch workspace" onClick={onPick} className="icon-btn">
          ⇄
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <SplitPane
          orientation="vertical"
          initialSize={65}
          minSize={20}
          maxSize={85}
          storageKey="sidebar/history"
          first={
            <div className="h-full overflow-auto py-1">
              {root.children.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                  <div className="text-xs text-ink-3">This workspace is empty.</div>
                  <button
                    onClick={() => setDialog({ kind: 'newRequest', parent: '' })}
                    className="btn-ghost text-accent hover:text-accent-hover"
                  >
                    Create your first request
                  </button>
                </div>
              ) : (
                root.children.map((child) => (
                  <TreeNode
                    key={child.id}
                    node={child}
                    depth={0}
                    gitStatusByPath={gitStatusByPath}
                    onNewRequest={(parent) => setDialog({ kind: 'newRequest', parent })}
                    onNewFolder={(parent) => setDialog({ kind: 'newFolder', parent })}
                    onRename={(relPath, currentName) =>
                      setDialog({ kind: 'rename', relPath, currentName })
                    }
                    onDelete={(relPath, name) =>
                      setDialog({ kind: 'delete', relPath, name })
                    }
                  />
                ))
              )}
            </div>
          }
          second={<HistoryPanel />}
        />
      </div>
    </div>
  );
}

interface TreeNodeProps {
  node: CollectionNode;
  depth: number;
  gitStatusByPath: Map<string, GitFileChangeStatus>;
  onNewRequest: (parent: string) => void;
  onNewFolder: (parent: string) => void;
  onRename: (relPath: string, currentName: string) => void;
  onDelete: (relPath: string, name: string) => void;
}

function TreeNode({
  node,
  depth,
  gitStatusByPath,
  onNewRequest,
  onNewFolder,
  onRename,
  onDelete,
}: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(depth < 1);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openRequest = useAppStore((s) => s.openRequest);

  const fileTab =
    node.kind === 'request'
      ? (tabs.find((t) => t.kind === 'file' && t.relPath === node.relPath) ?? null)
      : null;
  const dirty = fileTab?.dirty === true;
  const active = fileTab !== null && fileTab.id === activeTabId;
  const indent = 10 + depth * 14;

  if (node.kind === 'folder') {
    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              onClick={() => setExpanded(!expanded)}
              style={{ paddingLeft: `${indent}px` }}
              className="group relative flex h-7 w-full items-center gap-1.5 pr-3 text-left text-xs text-ink-2 hover:bg-bg-hover"
            >
              <span className="w-3 text-center text-[9px] text-ink-4">
                {expanded ? '▾' : '▸'}
              </span>
              <span className="truncate font-medium">{node.name}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onNewRequest(node.relPath)}>
              New request
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onNewFolder(node.relPath)}>
              New folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onRename(node.relPath, node.name)}>
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              destructive
              onSelect={() => onDelete(node.relPath, node.name)}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {expanded &&
          node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              gitStatusByPath={gitStatusByPath}
              onNewRequest={onNewRequest}
              onNewFolder={onNewFolder}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={() => void openRequest(node.relPath)}
          style={{ paddingLeft: `${indent + 16}px` }}
          className={`group relative flex h-7 w-full items-center gap-2 pr-3 text-left text-xs ${
            active
              ? 'bg-accent-soft text-ink-1'
              : 'text-ink-2 hover:bg-bg-hover'
          }`}
        >
          {active && (
            <span className="absolute left-0 top-1 h-5 w-0.5 rounded-r-sm bg-accent" />
          )}
          <span
            className={`w-11 font-mono text-[10px] font-semibold uppercase tracking-wide ${
              METHOD_COLOR[node.method] ?? 'text-method-custom'
            }`}
          >
            {node.method.slice(0, 6)}
          </span>
          <span className="flex-1 truncate">{node.name}</span>
          {(() => {
            const gitStatus =
              node.kind === 'request'
                ? gitStatusByPath.get(node.relPath)
                : undefined;
            if (!gitStatus) return null;
            return (
              <span
                title={`Git: ${gitStatus}`}
                className={`w-3 text-center font-mono text-[10px] font-semibold ${GIT_STATUS_COLOR[gitStatus]}`}
              >
                {GIT_STATUS_BADGE[gitStatus]}
              </span>
            );
          })()}
          {dirty && (
            <span
              title="Unsaved changes"
              className="h-1.5 w-1.5 rounded-full bg-accent"
            />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void openRequest(node.relPath)}>
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onRename(node.relPath, node.name)}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          destructive
          onSelect={() => onDelete(node.relPath, node.name)}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
