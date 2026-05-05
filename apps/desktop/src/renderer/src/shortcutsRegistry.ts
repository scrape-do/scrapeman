// Static, documentation-only registry of every keyboard shortcut Scrapeman
// binds. The actual handlers live in App.tsx; this list exists so the
// Settings dialog can render a discoverable cheat-sheet.
//
// IMPORTANT: keep this in sync with the `useShortcuts` registration in
// App.tsx. There is no compile-time link between the two — drift will
// silently mislead users.

export interface ShortcutEntry {
  combo: string;
  description: string;
}

export interface ShortcutGroup {
  group: string;
  shortcuts: ShortcutEntry[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Request',
    shortcuts: [
      { combo: 'mod+enter', description: 'Send request, or cancel if one is in flight' },
      {
        combo: 'mod+r',
        description:
          'Send request in parallel — does not cancel the in-flight one. Response panel reflects whichever finishes last.',
      },
      { combo: 'mod+s', description: 'Save request' },
      { combo: 'mod+l', description: 'Focus the URL bar' },
      { combo: 'mod+f', description: 'Find in response (when a response is loaded)' },
    ],
  },
  {
    group: 'Tabs',
    shortcuts: [
      { combo: 'mod+t', description: 'New tab' },
      { combo: 'mod+n', description: 'New tab (alternative)' },
      { combo: 'mod+w', description: 'Close active tab' },
      { combo: 'mod+shift+w', description: 'Close all tabs' },
      { combo: 'mod+shift+t', description: 'Reopen the last closed tab' },
      { combo: 'mod+d', description: 'Duplicate active tab' },
      { combo: 'mod+1', description: 'Switch to tab 1 (1–9 supported)' },
    ],
  },
  {
    group: 'Navigation',
    shortcuts: [
      { combo: 'mod+k', description: 'Open / close the command palette' },
      { combo: 'mod+b', description: 'Toggle the sidebar' },
      { combo: 'mod+shift+f', description: 'Focus the collection search' },
    ],
  },
  {
    group: 'Git (when the workspace is a repo)',
    shortcuts: [
      { combo: 'mod+shift+h', description: 'Toggle "sync with git" for the active request' },
    ],
  },
];
