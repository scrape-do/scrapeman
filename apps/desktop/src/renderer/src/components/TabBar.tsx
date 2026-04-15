import { forwardRef, useState, type HTMLAttributes } from 'react';
import { useAppStore, type Tab } from '../store.js';
import { shortcutLabel } from '../hooks/useShortcuts.js';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/ContextMenu.js';
import { ConfirmDialog } from '../ui/Dialog.js';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

type GuardKind =
  | 'close'
  | 'closeOthers'
  | 'closeRight'
  | 'closeSaved'
  | 'closeAll';

interface GuardState {
  kind: GuardKind;
  tabId?: string;
  tabName?: string;
  dirtyCount: number;
}

export function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const newTab = useAppStore((s) => s.newTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const closeSavedTabs = useAppStore((s) => s.closeSavedTabs);
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);
  const duplicateTab = useAppStore((s) => s.duplicateTab);
  const revealInSidebar = useAppStore((s) => s.revealInSidebar);
  const setSidebarView = useAppStore((s) => s.setSidebarView);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const reorderTab = useAppStore((s) => s.reorderTab);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [guard, setGuard] = useState<GuardState | null>(null);

  const savedCount = tabs.filter((t) => !t.dirty).length;

  const requestClose = (tab: Tab): void => {
    if (tab.dirty) {
      setGuard({ kind: 'close', tabId: tab.id, tabName: tab.name, dirtyCount: 1 });
      return;
    }
    closeTab(tab.id);
  };

  const requestCloseOthers = (tab: Tab): void => {
    const dirtyCount = tabs.filter((t) => t.id !== tab.id && t.dirty).length;
    if (dirtyCount > 0) {
      setGuard({ kind: 'closeOthers', tabId: tab.id, dirtyCount });
      return;
    }
    closeOtherTabs(tab.id);
  };

  const requestCloseRight = (tab: Tab): void => {
    const idx = tabs.findIndex((t) => t.id === tab.id);
    const dirtyCount = tabs.slice(idx + 1).filter((t) => t.dirty).length;
    if (dirtyCount > 0) {
      setGuard({ kind: 'closeRight', tabId: tab.id, dirtyCount });
      return;
    }
    closeTabsToRight(tab.id);
  };

  const requestCloseSaved = (): void => {
    // Close Saved never touches dirty tabs — no guard needed.
    closeSavedTabs();
  };

  const requestCloseAll = (): void => {
    const dirtyCount = tabs.filter((t) => t.dirty).length;
    if (dirtyCount > 0) {
      setGuard({ kind: 'closeAll', dirtyCount });
      return;
    }
    closeAllTabs();
  };

  const confirmGuard = (): void => {
    if (!guard) return;
    switch (guard.kind) {
      case 'close':
        if (guard.tabId) closeTab(guard.tabId);
        break;
      case 'closeOthers':
        if (guard.tabId) closeOtherTabs(guard.tabId);
        break;
      case 'closeRight':
        if (guard.tabId) closeTabsToRight(guard.tabId);
        break;
      case 'closeSaved':
        closeSavedTabs();
        break;
      case 'closeAll':
        closeAllTabs();
        break;
    }
  };

  const guardTitle = ((): string => {
    if (!guard) return '';
    if (guard.kind === 'close') {
      return `'${guard.tabName ?? 'Untitled'}' has unsaved changes`;
    }
    return `You have ${guard.dirtyCount} unsaved tab${guard.dirtyCount === 1 ? '' : 's'}`;
  })();

  const guardDescription = ((): string => {
    if (!guard) return '';
    if (guard.kind === 'close') return 'Close without saving?';
    return 'Close anyway?';
  })();

  const guardConfirmLabel = ((): string => {
    if (!guard) return 'Close';
    if (guard.kind === 'close') return 'Close';
    return `Close ${guard.dirtyCount}`;
  })();

  return (
    <div className="flex h-10 items-center border-b border-line bg-bg-subtle">
      <div className="flex h-full flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab, index) => {
          const isLast = index === tabs.length - 1;
          const canCloseOthers = tabs.length > 1;
          const canCloseRight = !isLast;
          const canCloseSaved = savedCount > 0;
          const canCopyUrl = tab.builder.url.trim().length > 0;
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <TabItem
                  tab={tab}
                  active={tab.id === activeTabId}
                  dragging={dragId === tab.id}
                  dropTarget={
                    dropTargetId === tab.id && dragId !== null && dragId !== tab.id
                  }
                  onSelect={() => setActiveTab(tab.id)}
                  onClose={() => requestClose(tab)}
                  onDragStart={() => setDragId(tab.id)}
                  onDragEnter={() => {
                    if (dragId && dragId !== tab.id) setDropTargetId(tab.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropTargetId(null);
                  }}
                  onDrop={() => {
                    if (dragId && dragId !== tab.id) reorderTab(dragId, tab.id);
                    setDragId(null);
                    setDropTargetId(null);
                  }}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => requestClose(tab)}>
                  Close
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!canCloseOthers}
                  onSelect={() => requestCloseOthers(tab)}
                >
                  Close Others
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!canCloseRight}
                  onSelect={() => requestCloseRight(tab)}
                >
                  Close to the Right
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!canCloseSaved}
                  onSelect={requestCloseSaved}
                >
                  Close Saved
                </ContextMenuItem>
                <ContextMenuItem onSelect={requestCloseAll}>
                  Close All
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => duplicateTab(tab.id)}>
                  Duplicate
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={!canCopyUrl}
                  onSelect={() => {
                    void navigator.clipboard.writeText(tab.builder.url);
                  }}
                >
                  Copy URL
                </ContextMenuItem>
                {tab.kind === 'file' && tab.relPath !== null && (
                  <ContextMenuItem
                    onSelect={() => {
                      setSidebarView('files');
                      if (tab.relPath) revealInSidebar(tab.relPath);
                    }}
                  >
                    Reveal in sidebar
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <button
        onClick={newTab}
        title={`New tab (${shortcutLabel('mod+t')})`}
        className="flex h-full w-10 items-center justify-center border-l border-line text-ink-3 transition-colors hover:bg-bg-hover hover:text-ink-1"
      >
        +
      </button>
      <ConfirmDialog
        open={guard !== null}
        title={guardTitle}
        description={guardDescription}
        confirmLabel={guardConfirmLabel}
        destructive
        onConfirm={confirmGuard}
        onClose={() => setGuard(null)}
      />
    </div>
  );
}

interface TabItemOwnProps {
  tab: Tab;
  active: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}

type TabItemProps = TabItemOwnProps &
  Omit<
    HTMLAttributes<HTMLDivElement>,
    keyof TabItemOwnProps | 'onMouseDown' | 'onClick'
  >;

// forwardRef so Radix ContextMenuTrigger (asChild) can attach its ref and
// injected event handlers to the underlying DOM node.
const TabItem = forwardRef<HTMLDivElement, TabItemProps>(
  function TabItem(
    {
      tab,
      active,
      dragging,
      dropTarget,
      onSelect,
      onClose,
      onDragStart,
      onDragEnter,
      onDragEnd,
      onDrop,
      ...rest
    },
    ref,
  ) {
  const color = METHOD_COLOR[tab.method] ?? 'text-method-custom';
  const sending = tab.execution.status === 'sending';

  return (
    <div
      ref={ref}
      {...rest}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires setData to actually start a drag.
        e.dataTransfer.setData('text/plain', tab.id);
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onClick={onSelect}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`group relative flex h-full min-w-[160px] max-w-[240px] cursor-default items-center gap-2 border-r border-line px-3 text-xs transition-colors ${
        active
          ? 'bg-bg-canvas text-ink-1'
          : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
      } ${dragging ? 'opacity-40' : ''} ${
        dropTarget ? 'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent' : ''
      }`}
    >
      {active && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
      )}
      <span className={`font-mono text-[10px] font-semibold ${color}`}>
        {tab.method.slice(0, 6)}
      </span>
      <span className="flex-1 truncate">{tab.name}</span>
      {sending && (
        <span
          title="Request in flight"
          className="pulse-dot h-1.5 w-1.5 rounded-sm bg-accent"
        />
      )}
      {tab.dirty ? (
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-ink-4 opacity-0 transition-opacity hover:bg-bg-active hover:text-ink-1 group-hover:opacity-100"
          aria-label="Close tab"
        >
          ×
        </button>
      )}
    </div>
  );
  },
);
