import { useEffect } from 'react';
import { usePlatform } from './usePlatform.js';

export interface Shortcut {
  // 'mod' = ⌘ on macOS, Ctrl elsewhere
  combo: string;
  description: string;
  handler: (event: KeyboardEvent) => void;
}

export function useShortcuts(shortcuts: Shortcut[]): void {
  const platform = usePlatform();
  const isMac = platform === 'darwin';

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      for (const shortcut of shortcuts) {
        if (matches(shortcut.combo, e, isMac)) {
          e.preventDefault();
          shortcut.handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts, isMac]);
}

function matches(combo: string, event: KeyboardEvent, isMac: boolean): boolean {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  const key = parts[parts.length - 1];
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');

  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  if (wantMod !== modPressed) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;

  // Ignore the *other* mod key — on mac we don't want Ctrl to trigger a Cmd shortcut
  if (isMac && event.ctrlKey && !parts.includes('ctrl')) return false;
  if (!isMac && event.metaKey) return false;

  return event.key.toLowerCase() === key;
}

export function modLabel(): string {
  return isMacUserAgent() ? '⌘' : 'Ctrl';
}

export function shortcutLabel(combo: string): string {
  const isMac = isMacUserAgent();
  return combo
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (p === 'shift') return isMac ? '⇧' : 'Shift';
      if (p === 'alt') return isMac ? '⌥' : 'Alt';
      if (p === 'enter') return isMac ? '↵' : 'Enter';
      return part.toUpperCase();
    })
    .join(isMac ? '' : '+');
}

function isMacUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac/i.test(navigator.userAgent);
}
