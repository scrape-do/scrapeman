import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { MouseEvent } from 'react';
import { useAppStore } from '../store.js';

/**
 * Compact path tail for a workspace dropdown row, e.g.
 *   /Users/mert/Developer/scrapeman/example  →  …scrapeman/example
 * Trims to roughly two trailing segments so the user can disambiguate
 * workspaces that share a leaf folder name.
 */
function pathTail(path: string): string {
  if (!path) return '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

export function WorkspaceSwitcher(): JSX.Element | null {
  const workspace = useAppStore((s) => s.workspace);
  const openWorkspaces = useAppStore((s) => s.openWorkspaces);
  const switchWorkspace = useAppStore((s) => s.switchWorkspace);
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const pickAndOpenWorkspace = useAppStore((s) => s.pickAndOpenWorkspace);

  if (!workspace) return null;

  const onCloseClick = (e: MouseEvent, path: string): void => {
    e.preventDefault();
    e.stopPropagation();
    void closeWorkspace(path);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={workspace.path}
          className="flex h-9 w-full items-center gap-1.5 border-b border-line bg-bg-subtle px-3 text-left text-xs font-semibold text-ink-1 hover:bg-bg-hover"
        >
          <span className="truncate flex-1">{workspace.name}</span>
          {openWorkspaces.length > 1 && (
            <span className="rounded bg-bg-active px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
              {openWorkspaces.length}
            </span>
          )}
          <span className="text-ink-4 text-base leading-none">▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={2}
          className="z-50 min-w-[260px] max-w-[420px] rounded-md border border-line bg-bg-canvas p-1 shadow-popover animate-slide-down-fade"
        >
          {openWorkspaces.map((w) => {
            const isActive = w.path === workspace.path;
            return (
              <DropdownMenu.Item
                key={w.path}
                onSelect={() => {
                  if (!isActive) void switchWorkspace(w.path);
                }}
                className="group flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
              >
                <span className="w-3 text-center text-accent text-base leading-none">
                  {isActive ? '✓' : ''}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-ink-1">{w.name}</span>
                  <span className="truncate text-[10px] text-ink-4">
                    {pathTail(w.path)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => onCloseClick(e, w.path)}
                  title="Close workspace"
                  aria-label={`Close ${w.name}`}
                  className="ml-1 rounded px-1 text-base leading-none text-ink-4 opacity-0 hover:bg-bg-active hover:text-ink-1 group-hover:opacity-100"
                >
                  ✕
                </button>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
          <DropdownMenu.Item
            onSelect={() => void pickAndOpenWorkspace()}
            className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
          >
            <span className="w-3 text-center text-base leading-none">+</span>
            <span>Open another workspace…</span>
          </DropdownMenu.Item>
          {openWorkspaces.length > 1 && (
            <DropdownMenu.Item
              onSelect={() => void closeWorkspace(workspace.path)}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-bg-hover"
            >
              <span className="w-3 text-center text-base leading-none">✕</span>
              <span>Close current workspace</span>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
