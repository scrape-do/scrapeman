import { useRef, useState } from 'react';
import { useAppStore, type Tab } from '../store.js';
import { ConfirmDialog } from '../ui/Dialog.js';

type GuardKind = 'close' | 'closeOthers' | 'closeRight' | 'closeSaved' | 'closeAll';

interface GuardState {
  kind: GuardKind;
  tabId?: string;
  tabName?: string;
  dirtyCount: number;
}

export interface DirtyTabGuard {
  /** Request to close a single tab (shows dialog if dirty and "don't ask" not set). */
  requestClose: (tab: Tab) => void;
  /** Request to close all tabs except keepId (shows dialog if any dirty). */
  requestCloseOthers: (tab: Tab) => void;
  /** Request to close tabs to the right of fromTab (shows dialog if any dirty). */
  requestCloseRight: (tab: Tab) => void;
  /** Request to close all saved tabs — never needs a guard. */
  requestCloseSaved: () => void;
  /** Request to close ALL tabs (shows dialog if any dirty). */
  requestCloseAll: () => void;
  /** Request to close the currently active tab (Cmd+W). */
  requestCloseActive: () => void;
  /** The dialog element — render this somewhere in the tree. */
  GuardDialog: JSX.Element;
}

/**
 * Manages dirty-tab close confirmation for all close triggers.
 * "Don't ask again" is session-scoped: stored in a ref, never persisted.
 */
export function useDirtyTabGuard(): DirtyTabGuard {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const closeSavedTabs = useAppStore((s) => s.closeSavedTabs);
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);

  const [guard, setGuard] = useState<GuardState | null>(null);
  // Session-scoped: resets when the app process restarts.
  const skipGuard = useRef(false);
  const [dontAskChecked, setDontAskChecked] = useState(false);

  const requestClose = (tab: Tab): void => {
    if (tab.dirty && !skipGuard.current) {
      setDontAskChecked(false);
      setGuard({ kind: 'close', tabId: tab.id, tabName: tab.name, dirtyCount: 1 });
      return;
    }
    closeTab(tab.id);
  };

  const requestCloseOthers = (tab: Tab): void => {
    const dirtyCount = tabs.filter((t) => t.id !== tab.id && t.dirty).length;
    if (dirtyCount > 0 && !skipGuard.current) {
      setDontAskChecked(false);
      setGuard({ kind: 'closeOthers', tabId: tab.id, dirtyCount });
      return;
    }
    closeOtherTabs(tab.id);
  };

  const requestCloseRight = (tab: Tab): void => {
    const idx = tabs.findIndex((t) => t.id === tab.id);
    const dirtyCount = tabs.slice(idx + 1).filter((t) => t.dirty).length;
    if (dirtyCount > 0 && !skipGuard.current) {
      setDontAskChecked(false);
      setGuard({ kind: 'closeRight', tabId: tab.id, dirtyCount });
      return;
    }
    closeTabsToRight(tab.id);
  };

  const requestCloseSaved = (): void => {
    // closeSaved never touches dirty tabs — no guard needed.
    closeSavedTabs();
  };

  const requestCloseAll = (): void => {
    const dirtyCount = tabs.filter((t) => t.dirty).length;
    if (dirtyCount > 0 && !skipGuard.current) {
      setDontAskChecked(false);
      setGuard({ kind: 'closeAll', dirtyCount });
      return;
    }
    closeAllTabs();
  };

  const requestCloseActive = (): void => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    requestClose(tab);
  };

  const confirmGuard = (): void => {
    if (!guard) return;
    // If the user checked "don't ask again", set the session flag before acting.
    if (dontAskChecked) {
      skipGuard.current = true;
    }
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
    setGuard(null);
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

  const GuardDialog = (
    <ConfirmDialog
      open={guard !== null}
      title={guardTitle}
      description={guardDescription}
      confirmLabel={guardConfirmLabel}
      destructive
      dontAskChecked={dontAskChecked}
      onDontAskChange={setDontAskChecked}
      onConfirm={confirmGuard}
      onClose={() => setGuard(null)}
    />
  );

  return {
    requestClose,
    requestCloseOthers,
    requestCloseRight,
    requestCloseSaved,
    requestCloseAll,
    requestCloseActive,
    GuardDialog,
  };
}
