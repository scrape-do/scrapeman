import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type { GitPullStrategy } from '@scrapeman/shared-types';

export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  initialValue = '',
  confirmLabel = 'Create',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg-canvas p-5 shadow-popover animate-slide-down-fade">
          <RadixDialog.Title className="text-sm font-semibold text-ink-1">
            {title}
          </RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-1 text-xs text-ink-3">
              {description}
            </RadixDialog.Description>
          )}
          <input
            autoFocus
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onClose();
            }}
            className="field mt-4 w-full"
          />
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} title="Cancel">
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={!value.trim()}
              title="Confirm"
            >
              {confirmLabel}
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function PullStrategyDialog({
  open,
  onConfirm,
  onClose,
}: {
  open: boolean;
  onConfirm: (strategy: GitPullStrategy) => void;
  onClose: () => void;
}): JSX.Element {
  const options: { strategy: GitPullStrategy; label: string; description: string }[] = [
    {
      strategy: 'rebase',
      label: 'Rebase',
      description: 'Replays your local commits on top of the remote. Produces a clean, linear history.',
    },
    {
      strategy: 'merge',
      label: 'Merge commit',
      description: 'Merges the remote into your local branch. Creates an extra merge commit.',
    },
  ];

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg-canvas p-5 shadow-popover animate-slide-down-fade">
          <RadixDialog.Title className="text-sm font-semibold text-ink-1">
            Branches have diverged
          </RadixDialog.Title>
          <RadixDialog.Description className="mt-1 text-xs leading-relaxed text-ink-3">
            Your local and remote branches cannot be fast-forwarded. Choose how to reconcile them.
          </RadixDialog.Description>
          <div className="mt-4 flex flex-col gap-2">
            {options.map(({ strategy, label, description }) => (
              <button
                key={strategy}
                type="button"
                autoFocus={strategy === 'rebase'}
                onClick={() => {
                  onConfirm(strategy);
                  onClose();
                }}
                className="flex flex-col items-start rounded-md border border-line bg-bg-subtle px-3.5 py-3 text-left hover:border-accent hover:bg-bg-canvas focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <span className="text-xs font-semibold text-ink-1">{label}</span>
                <span className="mt-0.5 text-xs text-ink-3">{description}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  destructive = false,
  dontAskChecked,
  onDontAskChange,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** When provided, renders a "Don't ask again for this session" checkbox. */
  dontAskChecked?: boolean;
  onDontAskChange?: (checked: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg-canvas p-5 shadow-popover animate-slide-down-fade">
          <RadixDialog.Title className="text-sm font-semibold text-ink-1">
            {title}
          </RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-1 text-xs leading-relaxed text-ink-3">
              {description}
            </RadixDialog.Description>
          )}
          <div className="mt-5 flex items-center justify-between gap-2">
            {dontAskChecked !== undefined && onDontAskChange ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-3 select-none">
                <input
                  type="checkbox"
                  checked={dontAskChecked}
                  onChange={(e) => onDontAskChange(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-accent"
                />
                Don't ask again for this session
              </label>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary" onClick={onClose} title="Cancel">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                title="Confirm action"
                className={
                  destructive
                    ? 'inline-flex h-8 items-center justify-center rounded-md bg-method-delete px-3.5 text-xs font-semibold text-white hover:bg-[#B6383D] active:bg-[#9D3034]'
                    : 'btn-primary'
                }
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
