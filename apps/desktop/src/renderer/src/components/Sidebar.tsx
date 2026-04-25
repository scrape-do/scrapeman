import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
import { EyeOffIcon } from '../ui/EyeOffIcon.js';
import { HistoryPanel } from './HistoryPanel.js';
import { SourceControlPanel } from './SourceControlPanel.js';
import { SplitPane } from './SplitPane.js';
import { FolderSettingsDialog } from './FolderSettingsDialog.js';
import { CollectionSettingsDialog } from './CollectionSettingsDialog.js';
import { GlobalsDialog } from './GlobalsDialog.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';

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

type DialogState =
  | { kind: 'none' }
  | { kind: 'newRequest'; parent: string }
  | { kind: 'newFolder'; parent: string }
  | { kind: 'rename'; relPath: string; currentName: string }
  | { kind: 'delete'; relPath: string; name: string }
  | { kind: 'folderSettings'; folderRelPath: string }
  | { kind: 'collectionSettings' }
  | { kind: 'globals' };

export function Sidebar(): JSX.Element {
  const workspace = useAppStore((s) => s.workspace);
  const root = useAppStore((s) => s.root);
  const pickAndOpenWorkspace = useAppStore((s) => s.pickAndOpenWorkspace);
  const createRequest = useAppStore((s) => s.createRequest);
  const createFolder = useAppStore((s) => s.createFolder);
  const renameNode = useAppStore((s) => s.renameNode);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const moveNode = useAppStore((s) => s.moveNode);
  const gitStatus = useAppStore((s) => s.gitStatus);
  const hiddenRequests = useAppStore((s) => s.hiddenRequests);
  const toggleHiddenRequest = useAppStore((s) => s.toggleHiddenRequest);
  const view = useAppStore((s) => s.sidebarView);
  const setView = useAppStore((s) => s.setSidebarView);
  const revealTick = useAppStore((s) => s.revealInSidebarTick);
  const revealPath = useAppStore((s) => s.revealInSidebarPath);
  const focusSidebarSearchTick = useAppStore((s) => s.focusSidebarSearchTick);
  const openRunnerPanel = useAppStore((s) => s.openRunnerPanel);

  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [selectedFolder, setSelectedFolder] = useState<string>('');

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
          title="Open workspace folder"
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
      <WorkspaceSwitcher />
      <div className="flex h-8 items-stretch border-b border-line">
        <button
          onClick={() => setView('files')}
          className={`flex-1 border-b-2 text-[11px] font-semibold uppercase tracking-wide ${
            view === 'files'
              ? 'border-accent text-ink-1'
              : 'border-transparent text-ink-3 hover:text-ink-1'
          }`}
          title="File explorer"
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
          onNewRequest={() =>
            setDialog({ kind: 'newRequest', parent: selectedFolder })
          }
          onNewFolder={() =>
            setDialog({ kind: 'newFolder', parent: selectedFolder })
          }
          onPick={() => void pickAndOpenWorkspace()}
          root={root}
          gitStatusByPath={gitStatusByPath}
          hiddenRequests={hiddenRequests}
          onToggleHidden={(relPath) => void toggleHiddenRequest(relPath)}
          setDialog={setDialog}
          selectedFolder={selectedFolder}
          onSelectFolder={setSelectedFolder}
          onMoveRequest={(relPath, parent) =>
            void moveNode(relPath, parent)
          }
          revealTick={revealTick}
          revealPath={revealPath}
          focusSidebarSearchTick={focusSidebarSearchTick}
          onRunFolder={openRunnerPanel}
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
      <FolderSettingsDialog
        open={dialog.kind === 'folderSettings'}
        folderRelPath={
          dialog.kind === 'folderSettings' ? dialog.folderRelPath : ''
        }
        onClose={closeDialog}
      />
      <CollectionSettingsDialog
        open={dialog.kind === 'collectionSettings'}
        onClose={closeDialog}
      />
      <GlobalsDialog
        open={dialog.kind === 'globals'}
        onClose={closeDialog}
      />
    </div>
  );
}

/**
 * Parse a "METHOD query" prefix from the search string. If the first token
 * is an HTTP method keyword, split it off; otherwise treat the full string
 * as the text query.
 */
const HTTP_METHODS = new Set([
  'GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','TRACE','CONNECT',
]);

function parseQuery(raw: string): { method: string | null; text: string } {
  const trimmed = raw.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { method: null, text: trimmed };
  const first = trimmed.slice(0, spaceIdx).toUpperCase();
  if (HTTP_METHODS.has(first)) {
    return { method: first, text: trimmed.slice(spaceIdx + 1).trim() };
  }
  return { method: null, text: trimmed };
}

function filterTreeWithMethod(
  node: CollectionNode,
  method: string | null,
  text: string,
): CollectionNode | null {
  if (node.kind === 'request') {
    // Method filter: must match exactly if a method prefix was given.
    if (method && node.method.toUpperCase() !== method) return null;
    // Text filter: match name or relPath.
    if (text) {
      const q = text.toLowerCase();
      if (
        !node.name.toLowerCase().includes(q) &&
        !node.relPath.toLowerCase().includes(q)
      ) {
        return null;
      }
    }
    return node;
  }
  // folder — recurse
  const filteredChildren = node.children
    .map((child) => filterTreeWithMethod(child, method, text))
    .filter((c): c is CollectionNode => c !== null);
  if (filteredChildren.length === 0) return null;
  return { ...node, children: filteredChildren };
}

interface FilesViewProps {
  workspaceName: string;
  onNewRequest: () => void;
  onNewFolder: () => void;
  onPick: () => void;
  root: NonNullable<ReturnType<typeof useAppStore.getState>['root']>;
  gitStatusByPath: Map<string, GitFileChangeStatus>;
  hiddenRequests: Set<string>;
  onToggleHidden: (relPath: string) => void;
  setDialog: (dialog: DialogState) => void;
  selectedFolder: string;
  onSelectFolder: (relPath: string) => void;
  onRunFolder: (folderRelPath: string) => void;
  onMoveRequest: (relPath: string, newParent: string) => void;
  revealTick: number;
  revealPath: string | null;
  focusSidebarSearchTick: number;
}

function FilesView({
  workspaceName,
  onNewRequest,
  onNewFolder,
  onPick,
  root,
  gitStatusByPath,
  hiddenRequests,
  onToggleHidden,
  setDialog,
  selectedFolder,
  onSelectFolder,
  onMoveRequest,
  revealTick,
  revealPath,
  focusSidebarSearchTick,
  onRunFolder,
}: FilesViewProps): JSX.Element {
  const [expandTick, setExpandTick] = useState<{ path: string; tick: number } | null>(
    null,
  );
  const expandFolder = (relPath: string): void =>
    setExpandTick({ path: relPath, tick: Date.now() });

  const revealSignal = useMemo<{ path: string; tick: number } | null>(
    () => (revealTick > 0 && revealPath ? { path: revealPath, tick: revealTick } : null),
    [revealTick, revealPath],
  );

  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  // Focus search input when the global tick fires.
  useEffect(() => {
    if (focusSidebarSearchTick === 0) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusSidebarSearchTick]);

  // Cmd+F focuses search when sidebar already has focus.
  const onSidebarKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMac = /Mac/i.test(navigator.userAgent);
    const modDown = isMac ? e.metaKey : e.ctrlKey;
    if (modDown && !e.shiftKey && e.key.toLowerCase() === 'f') {
      // Only intercept if the active element is inside this sidebar panel.
      if (sidebarRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
  }, []);

  // Compute filtered children. When the query is empty, show the full tree.
  const visibleChildren = useMemo<CollectionNode[]>(() => {
    if (!query.trim()) return root.children;
    const { method, text } = parseQuery(query);
    return root.children
      .map((child) => filterTreeWithMethod(child, method, text))
      .filter((c): c is CollectionNode => c !== null);
  }, [root.children, query]);

  const isFiltering = query.trim().length > 0;
  const noResults = isFiltering && visibleChildren.length === 0;

  return (
    <div
      ref={sidebarRef}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onSidebarKeyDown}
    >
      <div className="flex h-10 items-center gap-1 border-b border-line px-2">
        <div className="flex-1 truncate px-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
          {workspaceName}
        </div>
        <button title="New request" onClick={onNewRequest} className="icon-btn text-lg">
          +
        </button>
        <button title="New folder" onClick={onNewFolder} className="icon-btn text-lg">
          ⌸
        </button>
        {/* Workspace settings dropdown */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              title="Workspace settings"
              className="icon-btn text-base leading-none"
            >
              ⚙
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[200px] rounded-md border border-line bg-bg-canvas p-1 shadow-popover animate-slide-down-fade"
            >
              <DropdownMenu.Item
                onSelect={() => setDialog({ kind: 'collectionSettings' })}
                className="flex cursor-default items-center rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
              >
                Collection settings…
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setDialog({ kind: 'globals' })}
                className="flex cursor-default items-center rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
              >
                Global variables…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button title="Open another workspace" onClick={onPick} className="icon-btn text-lg">
          ⇄
        </button>
      </div>
      {/* Search input */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="text-ink-3 text-lg leading-none select-none" aria-hidden="true">
          ⌕
        </span>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              // Return focus to tree so keyboard navigation continues.
              treeRef.current?.focus();
            }
          }}
          placeholder="Filter requests… (⌘⇧F)"
          aria-label="Filter collection"
          className="min-w-0 flex-1 bg-transparent text-xs text-ink-1 placeholder:text-ink-3 outline-none focus:outline-none"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              treeRef.current?.focus();
            }}
            aria-label="Clear filter"
            title="Clear filter"
            className="text-ink-3 hover:text-ink-1 leading-none text-xs"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <SplitPane
          orientation="vertical"
          initialSize={65}
          minSize={20}
          maxSize={85}
          storageKey="sidebar/history"
          first={
            <div
              ref={treeRef}
              tabIndex={-1}
              className="h-full overflow-auto py-1 outline-none"
              onClick={(e) => {
                if (e.target === e.currentTarget) onSelectFolder('');
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-scrapeman-req')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                const relPath = e.dataTransfer.getData(
                  'application/x-scrapeman-req',
                );
                if (!relPath) return;
                e.preventDefault();
                onMoveRequest(relPath, '');
              }}
            >
              {root.children.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                  <div className="text-xs text-ink-3">This workspace is empty.</div>
                  <button
                    onClick={() => setDialog({ kind: 'newRequest', parent: '' })}
                    className="btn-ghost text-accent hover:text-accent-hover"
                    title="Create new request"
                  >
                    Create your first request
                  </button>
                </div>
              ) : noResults ? (
                <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                  <div className="text-xs text-ink-3">
                    No requests match &ldquo;{query}&rdquo;.
                  </div>
                  <button
                    onClick={() => setQuery('')}
                    className="btn-ghost text-accent hover:text-accent-hover text-xs"
                    title="Clear filter"
                  >
                    Clear filter
                  </button>
                </div>
              ) : (
                visibleChildren.map((child) => (
                  <TreeNode
                    key={child.id}
                    node={child}
                    depth={0}
                    gitStatusByPath={gitStatusByPath}
                    hiddenRequests={hiddenRequests}
                    onToggleHidden={onToggleHidden}
                    selectedFolder={selectedFolder}
                    onSelectFolder={onSelectFolder}
                    onMoveRequest={onMoveRequest}
                    expandSignal={isFiltering ? null : expandTick}
                    onRequestExpand={expandFolder}
                    revealSignal={isFiltering ? null : revealSignal}
                    onNewRequest={(parent) => setDialog({ kind: 'newRequest', parent })}
                    onNewFolder={(parent) => setDialog({ kind: 'newFolder', parent })}
                    onRename={(relPath, currentName) =>
                      setDialog({ kind: 'rename', relPath, currentName })
                    }
                    onDelete={(relPath, name) =>
                      setDialog({ kind: 'delete', relPath, name })
                    }
                    onRunFolder={onRunFolder}
                    onFolderSettings={(folderRelPath) =>
                      setDialog({ kind: 'folderSettings', folderRelPath })
                    }
                    forceExpand={isFiltering}
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
  hiddenRequests: Set<string>;
  onToggleHidden: (relPath: string) => void;
  selectedFolder: string;
  onSelectFolder: (relPath: string) => void;
  onMoveRequest: (relPath: string, newParent: string) => void;
  expandSignal: { path: string; tick: number } | null;
  onRequestExpand: (relPath: string) => void;
  revealSignal: { path: string; tick: number } | null;
  onNewRequest: (parent: string) => void;
  onNewFolder: (parent: string) => void;
  onRename: (relPath: string, currentName: string) => void;
  onDelete: (relPath: string, name: string) => void;
  onRunFolder: (folderRelPath: string) => void;
  onFolderSettings: (folderRelPath: string) => void;
  /** When true, folders are always rendered as expanded (used during filtering). */
  forceExpand?: boolean;
}

function TreeNode({
  node,
  depth,
  gitStatusByPath,
  hiddenRequests,
  onToggleHidden,
  selectedFolder,
  onSelectFolder,
  onMoveRequest,
  expandSignal,
  onRequestExpand,
  revealSignal,
  onNewRequest,
  onNewFolder,
  onRename,
  onDelete,
  onRunFolder,
  onFolderSettings,
  forceExpand = false,
}: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const fileRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (
      node.kind === 'folder' &&
      expandSignal &&
      expandSignal.path === node.relPath
    ) {
      setExpanded(true);
    }
  }, [expandSignal, node]);

  // Reveal-in-sidebar: expand this folder if it's an ancestor of the target,
  // or scroll this file row into view if it's the target. Depend on the tick
  // + this node's relPath rather than the whole node object so unrelated
  // parent re-renders don't retrigger the scroll.
  const revealTickValue = revealSignal?.tick ?? 0;
  const revealTargetPath = revealSignal?.path ?? null;
  useEffect(() => {
    if (!revealTargetPath) return;
    if (node.kind === 'folder') {
      if (
        node.relPath !== '' &&
        revealTargetPath.startsWith(`${node.relPath}/`)
      ) {
        setExpanded(true);
      }
    } else if (node.relPath === revealTargetPath) {
      fileRowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [revealTickValue, revealTargetPath, node.kind, node.relPath]);

  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openRequest = useAppStore((s) => s.openRequest);
  const isRepo = useAppStore((s) => s.gitStatus?.isRepo === true);

  const fileTab =
    node.kind === 'request'
      ? (tabs.find((t) => t.kind === 'file' && t.relPath === node.relPath) ?? null)
      : null;
  const dirty = fileTab?.dirty === true;
  const active = fileTab !== null && fileTab.id === activeTabId;
  const hidden = node.kind === 'request' && hiddenRequests.has(node.relPath);
  const indent = 10 + depth * 14;

  if (node.kind === 'folder') {
    const selected = selectedFolder === node.relPath;
    // forceExpand overrides the local expanded state (used while filtering).
    const isExpanded = forceExpand || expanded;
    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              onClick={() => {
                setExpanded(!expanded);
                onSelectFolder(node.relPath);
              }}
              onContextMenu={() => onSelectFolder(node.relPath)}
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes('application/x-scrapeman-req')
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (!dragOver) setDragOver(true);
                }
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                setDragOver(false);
                const relPath = e.dataTransfer.getData(
                  'application/x-scrapeman-req',
                );
                if (!relPath || relPath === node.relPath) return;
                e.preventDefault();
                e.stopPropagation();
                onMoveRequest(relPath, node.relPath);
                onRequestExpand(node.relPath);
              }}
              style={{ paddingLeft: `${indent}px` }}
              title={node.relPath || node.name}
              className={`group relative flex h-7 w-full items-center gap-1.5 pr-3 text-left text-xs text-ink-2 ${
                dragOver
                  ? 'bg-accent-soft ring-1 ring-inset ring-accent'
                  : selected
                    ? 'bg-bg-hover'
                    : 'hover:bg-bg-hover'
              }`}
            >
              <span className="w-4 text-center text-lg leading-none text-ink-3">
                {isExpanded ? '▾' : '▸'}
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
            <ContextMenuItem onSelect={() => onRunFolder(node.relPath)}>
              Run folder…
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                onFolderSettings(node.relPath)
              }
            >
              Folder settings…
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
        {isExpanded &&
          node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              gitStatusByPath={gitStatusByPath}
              hiddenRequests={hiddenRequests}
              onToggleHidden={onToggleHidden}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              onMoveRequest={onMoveRequest}
              expandSignal={expandSignal}
              onRequestExpand={onRequestExpand}
              revealSignal={revealSignal}
              onNewRequest={onNewRequest}
              onNewFolder={onNewFolder}
              onRename={onRename}
              onDelete={onDelete}
              onRunFolder={onRunFolder}
              onFolderSettings={onFolderSettings}
              forceExpand={forceExpand}
            />
          ))}
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={fileRowRef}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(
              'application/x-scrapeman-req',
              node.relPath,
            );
            // Some browsers require text/plain for a drag to start reliably.
            e.dataTransfer.setData('text/plain', node.relPath);
          }}
          onClick={() => void openRequest(node.relPath)}
          style={{ paddingLeft: `${indent + 16}px` }}
          title={node.relPath}
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
            className={`w-12 font-mono text-xs font-semibold uppercase tracking-tight ${
              METHOD_COLOR[node.method] ?? 'text-method-custom'
            }`}
          >
            {node.method.slice(0, 6)}
          </span>
          <span className={`flex-1 truncate ${hidden ? 'italic opacity-60' : ''}`}>
            {node.name}
          </span>
          {hidden && (
            <EyeOffIcon
              className="h-3.5 w-3.5 text-ink-3"
              title="Sync: off (local only, not pushed to git)"
            />
          )}
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
        {isRepo && (
          <>
            <ContextMenuItem onSelect={() => onToggleHidden(node.relPath)}>
              {hidden ? 'Start syncing to git' : 'Stop syncing to git'}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
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
