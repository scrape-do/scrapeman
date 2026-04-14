import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function Tooltip({
  label,
  children,
  side = 'bottom',
  delayMs = 250,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delayMs?: number;
}): JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={delayMs} skipDelayDuration={100}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className="z-[10000] max-w-[280px] rounded-md border border-line bg-bg-canvas px-2 py-1 text-[11px] leading-snug text-ink-1 shadow-popover animate-slide-down-fade"
          >
            {label}
            <RadixTooltip.Arrow className="fill-bg-canvas" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
