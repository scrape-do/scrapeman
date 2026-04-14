import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ContextMenu.js';

export interface CellContextMenuProps {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
}

/**
 * Wraps any value-bound input element with a right-click menu offering
 * URL encode / decode, Base64 encode / decode, copy, paste, clear.
 * The trigger forwards ref to its child via `asChild`.
 */
export function CellContextMenu({
  value,
  onChange,
  children,
}: CellContextMenuProps): JSX.Element {
  const urlEncode = (): void => {
    try {
      onChange(encodeURIComponent(value));
    } catch {
      /* ignore */
    }
  };
  const urlDecode = (): void => {
    try {
      onChange(decodeURIComponent(value.replace(/\+/g, ' ')));
    } catch {
      /* ignore */
    }
  };
  const base64Encode = (): void => {
    try {
      onChange(btoa(unescape(encodeURIComponent(value))));
    } catch {
      /* ignore */
    }
  };
  const base64Decode = (): void => {
    try {
      onChange(decodeURIComponent(escape(atob(value))));
    } catch {
      /* ignore */
    }
  };
  const copy = (): void => {
    void navigator.clipboard.writeText(value);
  };
  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      onChange(text);
    } catch {
      /* ignore */
    }
  };
  const clear = (): void => onChange('');

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={urlEncode}>URL encode</ContextMenuItem>
        <ContextMenuItem onSelect={urlDecode}>URL decode</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={base64Encode}>Base64 encode</ContextMenuItem>
        <ContextMenuItem onSelect={base64Decode}>Base64 decode</ContextMenuItem>
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
