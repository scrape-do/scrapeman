import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type {
  AuthConfig,
  CollectionSettings,
  EnvironmentVariable,
} from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';
import { AuthForm } from './AuthForm.js';

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

export function CollectionSettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const collectionSettings = useAppStore((s) => s.collectionSettings);
  const saveCollectionSettings = useAppStore((s) => s.saveCollectionSettings);

  const [activeTab, setActiveTab] = useState<'variables' | 'auth'>('variables');
  const [rows, setRows] = useState<RowState[]>([]);
  const [auth, setAuth] = useState<AuthConfig>({ type: 'none' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(
        collectionSettings.variables.length > 0
          ? collectionSettings.variables.map((v) => ({
              ...v,
              id: crypto.randomUUID(),
            }))
          : [newRow()],
      );
      setAuth(collectionSettings.auth ?? { type: 'none' });
    }
    if (!open) setRows([]);
  }, [open, collectionSettings]);

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
    const settings: CollectionSettings = {
      variables,
      ...(auth.type !== 'none' ? { auth } : {}),
    };
    await saveCollectionSettings(settings);
    setSaving(false);
    onClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[760px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade">
          <div className="border-b border-line px-5 py-4">
            <RadixDialog.Title className="text-sm font-semibold text-ink-1">
              Collection settings
            </RadixDialog.Title>
            <RadixDialog.Description className="mt-0.5 text-xs text-ink-3">
              Variables and default auth that apply to every request in this
              workspace.
            </RadixDialog.Description>
          </div>

          <div className="flex gap-4 border-b border-line px-5">
            <button
              onClick={() => setActiveTab('variables')}
              className={`border-b-2 py-2 text-xs font-semibold ${
                activeTab === 'variables'
                  ? 'border-accent text-ink-1'
                  : 'border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              Variables
            </button>
            <button
              onClick={() => setActiveTab('auth')}
              className={`border-b-2 py-2 text-xs font-semibold ${
                activeTab === 'auth'
                  ? 'border-accent text-ink-1'
                  : 'border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              Default auth
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'variables' && (
              <>
                <div className="grid grid-cols-[32px_1fr_1.5fr_72px_32px] items-center border-b border-line bg-bg-subtle px-5 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                  <div />
                  <div className="py-2">Key</div>
                  <div className="py-2">Value</div>
                  <div className="py-2">Secret</div>
                  <div />
                </div>
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="group grid grid-cols-[32px_1fr_1.5fr_72px_32px] items-center border-b border-line-subtle px-5 hover:bg-bg-subtle"
                  >
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) =>
                          update(row.id, { enabled: e.target.checked })
                        }
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
                        onChange={(e) =>
                          update(row.id, { secret: e.target.checked })
                        }
                        className="h-3.5 w-3.5 cursor-pointer accent-accent"
                      />
                    </div>
                    <button
                      onClick={() => remove(row.id)}
                      className="opacity-0 group-hover:opacity-100 icon-btn"
                      aria-label="Remove variable"
                      title="Remove variable"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={add}
                  className="flex h-9 items-center px-5 text-xs text-ink-3 transition-colors hover:bg-bg-subtle hover:text-accent"
                  title="Add variable"
                >
                  + Add variable
                </button>
              </>
            )}

            {activeTab === 'auth' && (
              <div className="p-4">
                <p className="mb-4 text-xs text-ink-3">
                  Set a default auth that applies to all requests unless
                  overridden by a folder or individual request.
                </p>
                <AuthForm auth={auth} onChange={setAuth} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3">
            <button onClick={onClose} className="btn-secondary" title="Cancel">
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="btn-primary"
              title="Save collection settings"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
