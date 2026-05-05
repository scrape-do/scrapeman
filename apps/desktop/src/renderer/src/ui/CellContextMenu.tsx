import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ContextMenu.js';
import {
  base64Decode,
  base64Encode,
  destringify,
  stringify,
  urlDecode,
  urlEncode,
} from '../utils/string-transforms.js';

export interface CellContextMenuProps {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
}

/**
 * Wraps any value-bound input element with a right-click menu offering
 * URL encode / decode, Base64 encode / decode, JSON-string stringify /
 * destringify, copy, paste, clear.
 *
 * When the focused element has a non-empty selection range (input or
 * textarea), transforms apply to that selection only; otherwise they
 * apply to the whole value. That mirrors VSCode's "Transform Selection"
 * UX so a user can encode a single query parameter in a long URL
 * without re-typing the rest.
 */
export function CellContextMenu({
  value,
  onChange,
  children,
}: CellContextMenuProps): JSX.Element {
  // Read the current selection from the focused input/textarea, if any.
  // Returns null when there is no usable selection so callers fall back
  // to whole-value mode.
  function getActiveSelection(): {
    el: HTMLInputElement | HTMLTextAreaElement;
    start: number;
    end: number;
  } | null {
    if (typeof document === 'undefined') return null;
    const el = document.activeElement;
    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLTextAreaElement)
    ) {
      return null;
    }
    const { selectionStart, selectionEnd } = el;
    if (
      selectionStart === null ||
      selectionEnd === null ||
      selectionStart === selectionEnd
    ) {
      return null;
    }
    // Only honour the selection when the focused element's value matches
    // the prop — guards against a stale activeElement from a different cell.
    if (el.value !== value) return null;
    return { el, start: selectionStart, end: selectionEnd };
  }

  // Apply a transform. When a selection is present, replace only that
  // range; otherwise replace the whole value. `transform` returning null
  // signals a malformed input — silently ignore to match the existing
  // try/catch behaviour of the menu.
  function apply(transform: (input: string) => string | null): void {
    const sel = getActiveSelection();
    if (sel) {
      const slice = value.slice(sel.start, sel.end);
      const transformed = transform(slice);
      if (transformed === null) return;
      const next = value.slice(0, sel.start) + transformed + value.slice(sel.end);
      onChange(next);
      // Re-select the freshly transformed range so the user can hit the
      // same menu item again to round-trip.
      const newEnd = sel.start + transformed.length;
      requestAnimationFrame(() => {
        try {
          sel.el.setSelectionRange(sel.start, newEnd);
        } catch {
          /* element may have unmounted */
        }
      });
      return;
    }
    const transformed = transform(value);
    if (transformed === null) return;
    onChange(transformed);
  }

  const copy = (): void => {
    const sel = getActiveSelection();
    const text = sel ? value.slice(sel.start, sel.end) : value;
    void navigator.clipboard.writeText(text);
  };
  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      const sel = getActiveSelection();
      if (sel) {
        onChange(value.slice(0, sel.start) + text + value.slice(sel.end));
      } else {
        onChange(text);
      }
    } catch {
      /* clipboard read denied or no permission */
    }
  };
  const clear = (): void => onChange('');

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => apply(urlEncode)}>URL encode</ContextMenuItem>
        <ContextMenuItem onSelect={() => apply(urlDecode)}>URL decode</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => apply(base64Encode)}>Base64 encode</ContextMenuItem>
        <ContextMenuItem onSelect={() => apply(base64Decode)}>Base64 decode</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => apply(stringify)}>Stringify</ContextMenuItem>
        <ContextMenuItem onSelect={() => apply(destringify)}>Destringify</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copy}>Copy</ContextMenuItem>
        <ContextMenuItem onSelect={() => void paste()}>Paste</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={clear}>
          Clear
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
