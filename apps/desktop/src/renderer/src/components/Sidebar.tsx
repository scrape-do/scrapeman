import { useState } from 'react';
import type { CollectionNode } from '@scrapeman/shared-types';
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

  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-1 border-b border-line px-2">
        <div className="flex-1 truncate px-1.5 text-xs font-semibold text-ink-1">
          {workspace.name}
        </div>
        <button
          title="New request"
          onClick={() => setDialog({ kind: 'newRequest', parent: '' })}
          className="icon-btn"
        >
          +
        </button>
        <button
          title="New folder"
          onClick={() => setDialog({ kind: 'newFolder', parent: '' })}
          className="icon-btn"
        >
          ⌸
        </button>
        <button
          title="Switch workspace"
          onClick={() => void pickAndOpenWorkspace()}
          className="icon-btn"
        >
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

interface TreeNodeProps {
  node: CollectionNode;
  depth: number;
  onNewRequest: (parent: string) => void;
  onNewFolder: (parent: string) => void;
  onRename: (relPath: string, currentName: string) => void;
  onDelete: (relPath: string, name: string) => void;
}

function TreeNode({
  node,
  depth,
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
