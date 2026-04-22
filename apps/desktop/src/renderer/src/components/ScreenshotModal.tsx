import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { bridge } from '../bridge.js';

export function ScreenshotModal({
  dataUrl,
  onClose,
}: {
  dataUrl: string | null;
  onClose: () => void;
}): JSX.Element | null {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  if (!dataUrl) return null;

  const copy = async (): Promise<void> => {
    try {
      await bridge.writeClipboardImage(dataUrl);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(90vw,1100px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-2">
            <Dialog.Title className="text-sm font-semibold text-ink-1">
              Screenshot
            </Dialog.Title>
            <button
              onClick={copy}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-line bg-bg-canvas px-3 text-xs font-medium text-ink-2 hover:bg-bg-hover hover:text-ink-1"
              title="Copy image to clipboard"
            >
              {copyState === 'copied'
                ? '✓ Copied'
                : copyState === 'error'
                  ? '⚠ Failed'
                  : 'Copy to clipboard'}
            </button>
            <Dialog.Close asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-bg-canvas text-ink-2 hover:bg-bg-hover hover:text-ink-1"
                aria-label="Close"
              >
                ×
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-auto bg-bg-subtle p-3">
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img
              src={dataUrl}
              alt="Request screenshot"
              className="mx-auto max-w-full rounded border border-line"
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
