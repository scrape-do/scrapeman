import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import type { HttpMethod } from '@scrapeman/shared-types';
import { PromptDialog } from '../ui/Dialog.js';

const STANDARD_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

export function MethodPicker({
  value,
  onChange,
}: {
  value: HttpMethod;
  onChange: (method: HttpMethod) => void;
}): JSX.Element {
  const [customOpen, setCustomOpen] = useState(false);
  const isCustom = !STANDARD_METHODS.includes(value);
  const color = METHOD_COLOR[value] ?? 'text-method-custom';

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex h-8 w-[108px] items-center justify-between rounded-md border border-line bg-bg-canvas px-2.5 hover:bg-bg-hover focus:border-accent focus:shadow-focus"
            title="Select HTTP method"
          >
            <span className={`font-mono text-xs font-semibold ${color}`}>
              {value}
            </span>
            <span className="text-ink-4">▾</span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-[140px] rounded-md border border-line bg-bg-canvas p-1 shadow-popover animate-slide-down-fade"
          >
            {STANDARD_METHODS.map((m) => (
              <DropdownMenu.Item
                key={m}
                onSelect={() => onChange(m)}
                className="flex cursor-default items-center rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-bg-hover"
              >
                <span className={`font-mono font-semibold ${METHOD_COLOR[m]}`}>
                  {m}
                </span>
              </DropdownMenu.Item>
            ))}
            {isCustom && (
              <DropdownMenu.Item
                onSelect={() => {}}
                className="flex cursor-default items-center rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-bg-hover"
              >
                <span className="font-mono font-semibold text-method-custom">
                  {value}
                </span>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
            <DropdownMenu.Item
              onSelect={() => setCustomOpen(true)}
              className="flex cursor-default items-center rounded px-2 py-1.5 text-xs text-ink-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white"
            >
              Custom method…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <PromptDialog
        open={customOpen}
        title="Custom HTTP method"
        description="Enter any verb the server accepts — PROPFIND, QUERY, REPORT, etc."
        placeholder="PROPFIND"
        initialValue={isCustom ? value : ''}
        confirmLabel="Use method"
        onConfirm={(v) => onChange(v.toUpperCase())}
        onClose={() => setCustomOpen(false)}
      />
    </>
  );
}
