import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { shortcutLabel } from '../hooks/useShortcuts.js';

export function ImportCurlDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (input: string) => Promise<string | null>;
}): JSX.Element {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    if (!value.trim() || importing) return;
    setImporting(true);
    const err = await onImport(value);
    setImporting(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg-canvas p-5 shadow-popover animate-slide-down-fade">
          <RadixDialog.Title className="text-sm font-semibold text-ink-1">
            Import curl command
          </RadixDialog.Title>
          <RadixDialog.Description className="mt-1 text-xs text-ink-3">
            Paste any <span className="font-mono text-ink-2">curl</span>{' '}
            command — Chrome copy-as-curl, Firefox, Postman export, or hand-written. Multi-line with
            backslashes is fine.
          </RadixDialog.Description>
          <textarea
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
              if (e.key === 'Escape') onClose();
            }}
            placeholder={`curl 'https://api.example.com/users' \\\n  -H 'Accept: application/json' \\\n  --compressed`}
            spellCheck={false}
            rows={8}
            className="mt-4 w-full resize-none rounded-md border border-line bg-bg-subtle p-3 font-mono text-xs text-ink-1 outline-none focus:border-accent focus:shadow-focus"
          />
          {error && (
            <div className="mt-2 rounded-md bg-method-delete/10 px-3 py-2 font-mono text-xs text-method-delete">
              {error}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="text-[10px] text-ink-4">
              Supports <span className="font-mono">-X</span>, -H, -d, --data-*, -u, -F,
              --user-agent, --cookie, -L, -k
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary" onClick={onClose} title="Cancel import">
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void submit()}
                disabled={!value.trim() || importing}
                title="Import curl command"
              >
                {importing ? 'Importing…' : 'Import'}
                <span className="ml-1.5 font-mono text-[10px] opacity-60">
                  {shortcutLabel('mod+enter')}
                </span>
              </button>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
