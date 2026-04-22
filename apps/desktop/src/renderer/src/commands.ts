import { useMemo } from 'react';
import { useAppStore } from './store.js';

export interface Command {
  id: string;
  title: string;
  section?: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface CommandExtras {
  toggleTheme: () => void;
  toggleSplit: () => void;
  requestCloseActive: () => void;
  requestCloseAll: () => void;
}

export function useCommands(extras: CommandExtras): Command[] {
  const send = useAppStore((s) => s.send);
  const saveOrPrompt = useAppStore((s) => s.saveOrPrompt);
  const newTab = useAppStore((s) => s.newTab);
  const duplicateTab = useAppStore((s) => s.duplicateTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const focusUrl = useAppStore((s) => s.focusUrl);
  const focusParams = useAppStore((s) => s.focusParams);
  const openImportCurl = useAppStore((s) => s.openImportCurl);
  const openLoadTest = useAppStore((s) => s.openLoadTest);
  const toggleHiddenRequest = useAppStore((s) => s.toggleHiddenRequest);
  const tabs = useAppStore((s) => s.tabs);
  const isRepo = useAppStore((s) => s.gitStatus?.isRepo === true);

  return useMemo<Command[]>(
    () => [
      {
        id: 'request.send',
        title: 'Send request',
        section: 'Request',
        shortcut: 'mod+enter',
        run: () => void send(),
      },
      {
        id: 'request.save',
        title: 'Save / Save as',
        section: 'Request',
        shortcut: 'mod+s',
        run: () => void saveOrPrompt(),
      },
      {
        id: 'request.import-curl',
        title: 'Import curl',
        section: 'Request',
        run: () => openImportCurl(),
      },
      {
        id: 'request.load-test',
        title: 'Run load test',
        section: 'Request',
        run: () => openLoadTest(),
      },
      {
        id: 'tab.new',
        title: 'New tab',
        section: 'Tabs',
        shortcut: 'mod+t',
        run: () => newTab(),
      },
      {
        id: 'tab.close',
        title: 'Close tab',
        section: 'Tabs',
        shortcut: 'mod+w',
        run: () => extras.requestCloseActive(),
      },
      {
        id: 'tab.duplicate',
        title: 'Duplicate tab',
        section: 'Tabs',
        shortcut: 'mod+d',
        run: () => {
          if (activeTabId) duplicateTab(activeTabId);
        },
      },
      ...(isRepo
        ? [
            {
              id: 'request.toggle-hidden',
              title: 'Toggle sync with git (on/off)',
              section: 'Request',
              shortcut: 'mod+shift+h',
              run: () => {
                const active = tabs.find((t) => t.id === activeTabId);
                if (active?.kind === 'file' && active.relPath) {
                  void toggleHiddenRequest(active.relPath);
                }
              },
            },
          ]
        : []),
      {
        id: 'view.focus-url',
        title: 'Focus URL bar',
        section: 'View',
        shortcut: 'mod+l',
        run: () => focusUrl(),
      },
      {
        id: 'view.add-param',
        title: 'Add URL parameter',
        section: 'View',
        run: () => focusParams(),
      },
      {
        id: 'view.toggle-theme',
        title: 'Toggle theme (light / dark)',
        section: 'View',
        run: () => extras.toggleTheme(),
      },
      {
        id: 'view.toggle-split',
        title: 'Toggle split orientation',
        section: 'View',
        run: () => extras.toggleSplit(),
      },
    ],
    [
      send,
      saveOrPrompt,
      newTab,
      duplicateTab,
      activeTabId,
      focusUrl,
      focusParams,
      openImportCurl,
      openLoadTest,
      toggleHiddenRequest,
      tabs,
      isRepo,
      extras,
    ],
  );
}
