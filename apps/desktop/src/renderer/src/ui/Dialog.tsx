import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

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
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={!value.trim()}
            >
              {confirmLabel}
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
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
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
