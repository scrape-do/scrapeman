import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type { EnvironmentVariable } from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';

interface RowState extends EnvironmentVariable {
  id: string;
}

function newRow(): RowState {
  return {
    id: crypto.randomUUID(),
    key: '',
    value: '',
    enabled: true,
    secret: false,
  };
}

export function VariablesPanel({
  open,
  environmentName,
  onClose,
}: {
  open: boolean;
  environmentName: string | null;
  onClose: () => void;
}): JSX.Element {
  const environments = useAppStore((s) => s.environments);
  const saveEnvironment = useAppStore((s) => s.saveEnvironment);
  const deleteEnvironment = useAppStore((s) => s.deleteEnvironment);

  const env = environments.find((e) => e.name === environmentName) ?? null;

  const [rows, setRows] = useState<RowState[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && env) {
      setRows(
        env.variables.length > 0
          ? env.variables.map((v) => ({ ...v, id: crypto.randomUUID() }))
          : [newRow()],
      );
    }
    if (!open) setRows([]);
  }, [open, env]);

  if (!environmentName || !env) {
    return <RadixDialog.Root open={false}><div /></RadixDialog.Root>;
  }

  const update = (id: string, patch: Partial<RowState>): void => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const remove = (id: string): void => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const add = (): void => {
    setRows((prev) => [...prev, newRow()]);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    const variables: EnvironmentVariable[] = rows
      .filter((r) => r.key.trim().length > 0)
      .map(({ id: _id, ...v }) => ({ ...v, key: v.key.trim() }));
    await saveEnvironment({ name: environmentName, variables });
    setSaving(false);
    onClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[760px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="text-sm font-semibold text-ink-1">
                Environment · {environmentName}
              </RadixDialog.Title>
              <RadixDialog.Description className="mt-0.5 text-xs text-ink-3">
                Use as <span className="font-mono text-ink-2">{`{{name}}`}</span> in URL,
                headers, body, params, and auth.{' '}
                <span className="text-ink-4">
                  Built-ins:{' '}
                  <span className="font-mono text-accent">{`{{random}}`}</span>{' '}
                  <span className="font-mono text-accent">{`{{timestamp}}`}</span>{' '}
                  <span className="font-mono text-accent">{`{{isoDate}}`}</span>{' '}
                  <span className="font-mono text-accent">{`{{randomInt}}`}</span>
                </span>
              </RadixDialog.Description>
            </div>
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete environment "${environmentName}"? Variables will be lost.`,
                  )
                ) {
                  void deleteEnvironment(environmentName);
                  onClose();
                }
              }}
              className="btn-ghost text-method-delete hover:text-method-delete"
            >
              Delete env
            </button>
          </div>

          <div className="grid grid-cols-[32px_1fr_1.5fr_72px_32px] items-center border-b border-line bg-bg-subtle px-5 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
            <div />
            <div className="py-2">Key</div>
            <div className="py-2">Value</div>
            <div className="py-2">Secret</div>
            <div />
          </div>

          <div className="flex-1 overflow-y-auto">
            {rows.map((row) => (
              <div
                key={row.id}
                className="group grid grid-cols-[32px_1fr_1.5fr_72px_32px] items-center border-b border-line-subtle px-5 hover:bg-bg-subtle"
              >
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => update(row.id, { enabled: e.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer accent-accent"
                  />
                </div>
                <input
                  type="text"
                  value={row.key}
                  placeholder="VARIABLE_NAME"
                  onChange={(e) => update(row.id, { key: e.target.value })}
                  className="h-9 bg-transparent pr-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-4"
                />
                <input
                  type={row.secret ? 'password' : 'text'}
                  value={row.value}
                  placeholder="value"
                  onChange={(e) => update(row.id, { value: e.target.value })}
                  className="h-9 bg-transparent pr-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-4"
                />
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={row.secret}
                    onChange={(e) => update(row.id, { secret: e.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer accent-accent"
                  />
                </div>
                <button
                  onClick={() => remove(row.id)}
                  className="opacity-0 group-hover:opacity-100 icon-btn"
                  aria-label="Remove variable"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={add}
              className="flex h-9 items-center px-5 text-xs text-ink-3 transition-colors hover:bg-bg-subtle hover:text-accent"
            >
              + Add variable
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3">
            <button onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
