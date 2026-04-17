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
import { EyeOffIcon } from '../ui/EyeOffIcon.js';
import type { DirtyTabGuard } from '../hooks/useDirtyTabGuard.js';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

interface TabBarProps {
  guard: DirtyTabGuard;
}

export function TabBar({ guard }: TabBarProps): JSX.Element {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const hiddenRequests = useAppStore((s) => s.hiddenRequests);
  const newTab = useAppStore((s) => s.newTab);
  const duplicateTab = useAppStore((s) => s.duplicateTab);
  const revealInSidebar = useAppStore((s) => s.revealInSidebar);
  const setSidebarView = useAppStore((s) => s.setSidebarView);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const reorderTab = useAppStore((s) => s.reorderTab);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const savedCount = tabs.filter((t) => !t.dirty).length;

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
                  hidden={
                    tab.kind === 'file' &&
                    tab.relPath !== null &&
                    hiddenRequests.has(tab.relPath)
                  }
                  dragging={dragId === tab.id}
                  dropTarget={
                    dropTargetId === tab.id && dragId !== null && dragId !== tab.id
                  }
                  onSelect={() => setActiveTab(tab.id)}
                  onClose={() => guard.requestClose(tab)}
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
                <ContextMenuItem onSelect={() => guard.requestClose(tab)}>
                  Close
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!canCloseOthers}
                  onSelect={() => guard.requestCloseOthers(tab)}
                >
                  Close Others
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!canCloseRight}
                  onSelect={() => guard.requestCloseRight(tab)}
                >
                  Close to the Right
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!canCloseSaved}
                  onSelect={guard.requestCloseSaved}
                >
                  Close Saved
                </ContextMenuItem>
                <ContextMenuItem onSelect={guard.requestCloseAll}>
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
      {guard.GuardDialog}
    </div>
  );
}

interface TabItemOwnProps {
  tab: Tab;
  active: boolean;
  hidden: boolean;
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
      hidden,
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
      <span className={`flex-1 truncate ${hidden ? 'italic opacity-70' : ''}`}>
        {tab.name}
      </span>
      {hidden && (
        <EyeOffIcon
          className="h-3.5 w-3.5 text-ink-3"
          title="Sync: off (local only, not pushed to git)"
        />
      )}
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
          title="Close tab"
        >
          ×
        </button>
      )}
    </div>
  );
  },
);
