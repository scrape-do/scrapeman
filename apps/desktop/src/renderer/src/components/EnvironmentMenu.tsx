import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import { useAppStore } from '../store.js';
import { VariablesPanel } from './VariablesPanel.js';
import { PromptDialog } from '../ui/Dialog.js';

export function EnvironmentMenu(): JSX.Element {
  const environments = useAppStore((s) => s.environments);
  const activeEnvironment = useAppStore((s) => s.activeEnvironment);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const saveEnvironment = useAppStore((s) => s.saveEnvironment);

  const [variablesOpen, setVariablesOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const openVariables = (name: string): void => {
    setEditingEnv(name);
    setVariablesOpen(true);
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="app-no-drag flex h-8 items-center gap-1.5 rounded-md border border-line bg-bg-canvas px-3 text-xs font-medium text-ink-2 hover:bg-bg-hover hover:text-ink-1"
          >
            <span className={activeEnvironment ? 'h-1.5 w-1.5 rounded-full bg-accent' : 'h-1.5 w-1.5 rounded-full bg-ink-5'} />
            <span className="font-medium">
              {activeEnvironment ?? 'No environment'}
            </span>
            <span className="text-ink-4">▾</span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[220px] rounded-md border border-line bg-bg-canvas p-1 shadow-popover animate-slide-down-fade"
          >
            <DropdownMenu.Item
              onSelect={() => void setActiveEnvironment(null)}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ink-5" />
              <span className="flex-1">No environment</span>
              {activeEnvironment === null && <span className="text-accent">✓</span>}
            </DropdownMenu.Item>
            {environments.length > 0 && (
              <DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
            )}
            {environments.map((env) => (
              <DropdownMenu.Item
                key={env.name}
                onSelect={() => void setActiveEnvironment(env.name)}
                className="group flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="flex-1 truncate">{env.name}</span>
                <span className="text-[10px] text-ink-4">
                  {env.variables.filter((v) => v.enabled).length} vars
                </span>
                {activeEnvironment === env.name && (
                  <span className="text-accent">✓</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openVariables(env.name);
                  }}
                  className="ml-1 rounded px-1 text-ink-4 hover:bg-bg-active hover:text-ink-1"
                  title="Edit variables"
                >
                  ⚙
                </button>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
            <DropdownMenu.Item
              onSelect={() => setCreateOpen(true)}
              className="flex cursor-default items-center rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white"
            >
              + New environment
            </DropdownMenu.Item>
            {activeEnvironment && (
              <DropdownMenu.Item
                onSelect={() => openVariables(activeEnvironment)}
                className="flex cursor-default items-center rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
              >
                Edit "{activeEnvironment}" variables…
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <PromptDialog
        open={createOpen}
        title="New environment"
        description="Create an environment to group variables like tokens, URLs, and IDs."
        placeholder="development"
        confirmLabel="Create"
        onConfirm={async (name) => {
          await saveEnvironment({ name, variables: [] });
          setCreateOpen(false);
          openVariables(name);
        }}
        onClose={() => setCreateOpen(false)}
      />

      <VariablesPanel
        open={variablesOpen}
        environmentName={editingEnv}
        onClose={() => {
          setVariablesOpen(false);
          setEditingEnv(null);
        }}
      />
    </>
  );
}
