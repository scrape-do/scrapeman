import { useEffect, useMemo, useState } from 'react';
import { CommandPalette } from './components/CommandPalette.js';
import { useCommands } from './commands.js';
import { Sidebar } from './components/Sidebar.js';
import { RequestBuilder } from './components/RequestBuilder.js';
import { ResponseViewer } from './components/ResponseViewer.js';
import { TabBar } from './components/TabBar.js';
import { EnvironmentMenu } from './components/EnvironmentMenu.js';
import { CookiesPanel } from './components/CookiesPanel.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { SplitPane, type SplitOrientation } from './components/SplitPane.js';
import { GitStatusBar } from './components/GitStatusBar.js';
import { useAppStore } from './store.js';
import { bridge } from './bridge.js';
import { usePlatform } from './hooks/usePlatform.js';
import { useShortcuts, type Shortcut } from './hooks/useShortcuts.js';
import { useTheme } from './hooks/useTheme.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { useDirtyTabGuard } from './hooks/useDirtyTabGuard.js';
import { RunnerPanel } from './components/runner/RunnerPanel.js';

export function App(): JSX.Element {
  const workspace = useAppStore((s) => s.workspace);
  const loadRecents = useAppStore((s) => s.loadRecents);
  const refreshTree = useAppStore((s) => s.refreshTree);
  const openWorkspace = useAppStore((s) => s.openWorkspace);
  const bootRestoreWorkspaces = useAppStore((s) => s.bootRestoreWorkspaces);
  const loadEnvironments = useAppStore((s) => s.loadEnvironments);
  const recents = useAppStore((s) => s.recents);
  const openWorkspaces = useAppStore((s) => s.openWorkspaces);
  const newTab = useAppStore((s) => s.newTab);
  const duplicateTab = useAppStore((s) => s.duplicateTab);
  const activateTabByIndex = useAppStore((s) => s.activateTabByIndex);
  const reopenClosedTab = useAppStore((s) => s.reopenClosedTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo);
  const saveOrPrompt = useAppStore((s) => s.saveOrPrompt);
  const focusUrl = useAppStore((s) => s.focusUrl);
  const focusSearch = useAppStore((s) => s.focusSearch);
  const focusSidebarSearch = useAppStore((s) => s.focusSidebarSearch);
  const toggleHiddenRequest = useAppStore((s) => s.toggleHiddenRequest);
  const tabs = useAppStore((s) => s.tabs);
  const isRepo = useAppStore((s) => s.gitStatus?.isRepo === true);
  const hideResponsePanel = useAppStore((s) => {
    const pane = s.tabs.find((t) => t.id === s.activeTabId)?.activePane;
    return pane === 'load' || pane === 'websocket';
  });
  const screenshotMode = useAppStore((s) => s.screenshotMode);

  const guard = useDirtyTabGuard();

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  // Boot: rehydrate the open-workspaces list from localStorage and reopen
  // the last-active workspace. Fall back to recents[0] only if there is no
  // persisted multi-workspace state (covers first-run after the upgrade).
  useEffect(() => {
    if (workspace) return;
    if (openWorkspaces.length > 0) return;
    void (async () => {
      await bootRestoreWorkspaces();
      const after = useAppStore.getState();
      if (!after.workspace && after.openWorkspaces.length === 0 && recents.length > 0) {
        await openWorkspace(recents[0]!.path);
      }
    })();
  }, [workspace, openWorkspaces.length, recents, bootRestoreWorkspaces, openWorkspace]);

  useEffect(() => {
    const unsubscribe = bridge.onWorkspaceEvent((event) => {
      if (!workspace || event.workspacePath !== workspace.path) return;
      if (event.type === 'tree-changed') {
        void refreshTree();
        void useAppStore.getState().loadHiddenRequests();
      }
      if (event.type === 'environments-changed') void loadEnvironments();
      if (event.type === 'globals-changed') {
        void useAppStore.getState().loadGlobals();
      }
      if (event.type === 'collection-settings-changed') {
        void useAppStore.getState().loadCollectionSettings();
      }
      if (event.type === 'folder-settings-changed') {
        // Evict the cached folder settings so the next read is fresh.
        const { folderRelPath } = event;
        useAppStore.setState((state) => {
          const next = { ...state.folderSettingsCache };
          delete next[folderRelPath];
          return { folderSettingsCache: next };
        });
      }
    });
    return unsubscribe;
  }, [workspace, refreshTree, loadEnvironments]);

  useEffect(() => {
    return bridge.onUpdateAvailable((info) => setUpdateInfo(info));
  }, [setUpdateInfo]);

  // Global load-progress listener — registered once so it survives tab
  // switches. Routes each progress event to the correct tab by runId.
  useEffect(() => {
    return bridge.onLoadProgress((p) => {
      useAppStore.getState().handleLoadProgress(p);
    });
  }, []);

  // Global WebSocket event listener — routes events to the tab that owns the connectionId.
  useEffect(() => {
    return bridge.onWsEvent((event) => {
      useAppStore.getState().handleWsEvent(event);
    });
  }, []);

  // Global collection runner event listener.
  useEffect(() => {
    return bridge.onRunnerEvent((event) => {
      useAppStore.getState().handleRunnerEvent(event);
    });
  }, []);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('sidebar:visible') !== 'false';
  });
  useEffect(() => {
    localStorage.setItem('sidebar:visible', String(sidebarVisible));
  }, [sidebarVisible]);

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        combo: 'mod+k',
        description: 'Command palette',
        handler: () => setPaletteOpen((v) => !v),
      },
      ...(paletteOpen
        ? []
        : [
            { combo: 'mod+t', description: 'New tab', handler: () => newTab() },
            { combo: 'mod+n', description: 'New tab', handler: () => newTab() },
            {
              combo: 'mod+w',
              description: 'Close tab',
              handler: () => guard.requestCloseActive(),
            },
            {
              combo: 'mod+shift+w',
              description: 'Close all tabs',
              handler: () => guard.requestCloseAll(),
            },
            {
              combo: 'mod+d',
              description: 'Duplicate tab',
              handler: () => activeTabId && duplicateTab(activeTabId),
            },
            { combo: 'mod+l', description: 'Focus URL bar', handler: () => focusUrl() },
            {
              combo: 'mod+b',
              description: 'Toggle sidebar',
              handler: () => setSidebarVisible((v) => !v),
            },
            {
              combo: 'mod+shift+f',
              description: 'Focus collection search',
              handler: () => focusSidebarSearch(),
            },
            {
              combo: 'mod+f',
              description: 'Find in response',
              handler: () => {
                const state = useAppStore.getState();
                const tab = state.tabs.find((t) => t.id === state.activeTabId);
                if (tab?.execution.status === 'success') {
                  focusSearch();
                }
              },
            },
            {
              combo: 'mod+enter',
              description: 'Send / cancel request',
              handler: () => {
                const state = useAppStore.getState();
                const tab = state.tabs.find((t) => t.id === state.activeTabId);
                if (tab?.execution.status === 'sending') {
                  state.cancelSend();
                } else {
                  void state.send();
                }
              },
            },
            { combo: 'mod+s', description: 'Save request', handler: () => void saveOrPrompt() },
            {
              combo: 'mod+shift+t',
              description: 'Reopen closed tab',
              handler: () => reopenClosedTab(),
            },
            ...(isRepo
              ? [
                  {
                    combo: 'mod+shift+h',
                    description: 'Toggle sync with git',
                    handler: (): void => {
                      const active = tabs.find((t) => t.id === activeTabId);
                      if (active?.kind === 'file' && active.relPath) {
                        void toggleHiddenRequest(active.relPath);
                      }
                    },
                  },
                ]
              : []),
            ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({
              combo: `mod+${n}` as const,
              description: `Switch to tab ${n}`,
              handler: () => activateTabByIndex(n),
            })),
          ]),
    ],
    [
      newTab,
      guard,
      duplicateTab,
      activateTabByIndex,
      reopenClosedTab,
      activeTabId,
      saveOrPrompt,
      focusUrl,
      focusSearch,
      focusSidebarSearch,
      toggleHiddenRequest,
      tabs,
      isRepo,
      paletteOpen,
      sidebarVisible,
    ],
  );
  useShortcuts(shortcuts);

  const platform = usePlatform();
  const isMac = platform === 'darwin';

  const [cookiesOpen, setCookiesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>(
    () => {
      const stored =
        typeof window !== 'undefined'
          ? localStorage.getItem('split:orientation')
          : null;
      return stored === 'vertical' ? 'vertical' : 'horizontal';
    },
  );

  useEffect(() => {
    localStorage.setItem('split:orientation', splitOrientation);
  }, [splitOrientation]);

  const commandExtras = useMemo(
    () => ({
      toggleTheme,
      toggleSplit: () =>
        setSplitOrientation((o) => (o === 'horizontal' ? 'vertical' : 'horizontal')),
      requestCloseActive: () => guard.requestCloseActive(),
      requestCloseAll: () => guard.requestCloseAll(),
    }),
    [toggleTheme, guard],
  );
  const commands = useCommands(commandExtras);

  return (
    <div className="flex h-screen flex-col bg-bg-canvas text-ink-1">
      <header
        className="app-drag flex h-11 items-center border-b border-line bg-bg-subtle"
        style={{ paddingLeft: isMac ? 84 : 14, paddingRight: 14 }}
      >
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 64 64"
            className="h-6 w-6 text-accent"
            aria-hidden="true"
          >
            <path
              d="M8 20 L40 20 Q52 20 52 34 Q52 46 40 46 Q30 46 30 36 L36 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="text-[13px] font-semibold text-ink-1">Scrapeman</div>
        </div>
        <div className="mx-4 h-3 w-px bg-line-strong" />
        <div
          className={`truncate text-xs ${
            workspace && openWorkspaces.length > 1
              ? 'font-semibold text-ink-1'
              : 'text-ink-3'
          }`}
        >
          {workspace ? workspace.name : 'No workspace'}
          {workspace && openWorkspaces.length > 1 && (
            <span className="ml-1.5 text-[10px] font-normal text-ink-4">
              ({openWorkspaces.length} open)
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="app-no-drag flex h-8 w-8 items-center justify-center rounded-md border border-line bg-bg-canvas text-base text-ink-2 hover:bg-bg-hover hover:text-ink-1"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {workspace && (
            <button
              onClick={() => setCookiesOpen(true)}
              title="Cookies"
              className="app-no-drag flex h-8 items-center gap-1.5 rounded-md border border-line bg-bg-canvas px-3 text-xs font-medium text-ink-2 hover:bg-bg-hover hover:text-ink-1"
            >
              <span className="text-base leading-none">🍪</span> Cookies
            </button>
          )}
          {workspace && <EnvironmentMenu />}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="app-no-drag flex h-8 w-8 items-center justify-center rounded-md border border-line bg-bg-canvas text-ink-2 hover:bg-bg-hover hover:text-ink-1"
          >
            <span className="text-xl leading-none">⚙</span>
          </button>
        </div>
      </header>
      <CookiesPanel open={cookiesOpen} onClose={() => setCookiesOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <SplitPane
          orientation="horizontal"
          initialSize={20}
          minSize={12}
          maxSize={45}
          storageKey="app/sidebar"
          firstCollapsed={!sidebarVisible || screenshotMode}
          first={
            <aside className="h-full border-r border-line bg-bg-subtle">
              <Sidebar />
            </aside>
          }
          second={
            <div
              id="screenshot-target"
              className="relative flex h-full flex-col overflow-hidden"
            >
              {!screenshotMode && <UpdateBanner />}
              {!screenshotMode && <TabBar guard={guard} />}
              <div className="flex-1 overflow-hidden">
                <SplitPane
                  orientation={splitOrientation}
                  storageKey="builder/response"
                  secondCollapsed={hideResponsePanel}
                  first={<RequestBuilder />}
                  second={<ResponseViewer />}
                />
              </div>
              {screenshotMode && (
                <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-line bg-bg-canvas/95 px-4 py-2 text-sm font-medium text-ink-2 shadow-md backdrop-blur">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-accent"
                    aria-hidden
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <span>
                    Tested with{' '}
                    <span className="text-base font-semibold text-ink-1">
                      Scrapeman
                    </span>
                  </span>
                </div>
              )}
            </div>
          }
        />
      </div>
      <GitStatusBar
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        splitOrientation={splitOrientation}
        onToggleSplit={() =>
          setSplitOrientation((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))
        }
      />
      <RunnerPanel />
    </div>
  );
}
