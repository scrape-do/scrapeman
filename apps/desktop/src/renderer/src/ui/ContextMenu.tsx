import * as RCM from '@radix-ui/react-context-menu';
import type { ReactNode } from 'react';

export const ContextMenu = RCM.Root;
export const ContextMenuTrigger = RCM.Trigger;

export function ContextMenuContent({ children }: { children: ReactNode }): JSX.Element {
  return (
    <RCM.Portal>
      <RCM.Content className="z-50 min-w-[180px] rounded-md border border-line bg-bg-canvas p-1 shadow-popover animate-slide-down-fade">
        {children}
      </RCM.Content>
    </RCM.Portal>
  );
}

export function ContextMenuItem({
  children,
  onSelect,
  shortcut,
  destructive = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  shortcut?: string;
  destructive?: boolean;
}): JSX.Element {
  return (
    <RCM.Item
      onSelect={onSelect}
      className={`flex cursor-default items-center justify-between gap-4 rounded px-2.5 py-1.5 text-xs outline-none ${
        destructive
          ? 'text-method-delete data-[highlighted]:bg-method-delete/10'
          : 'text-ink-2 data-[highlighted]:bg-accent data-[highlighted]:text-white'
      }`}
    >
      <span>{children}</span>
      {shortcut && (
        <span className="font-mono text-[10px] text-ink-4 data-[highlighted]:text-white/70">
          {shortcut}
        </span>
      )}
    </RCM.Item>
  );
}

export function ContextMenuSeparator(): JSX.Element {
  return <RCM.Separator className="my-1 h-px bg-line-subtle" />;
}
