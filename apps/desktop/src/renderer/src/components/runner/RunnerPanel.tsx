import * as RadixDialog from '@radix-ui/react-dialog';
import { useAppStore } from '../../store.js';
import { RunnerConfig } from './RunnerConfig.js';
import { RunnerResults } from './RunnerResults.js';

/**
 * Full-width modal dialog for the collection runner.
 * Opens from a folder context-menu entry or the workspace header button.
 * Left half: RunnerConfig. Right half: RunnerResults.
 */
export function RunnerPanel(): JSX.Element {
  const runner = useAppStore((s) => s.runner);
  const closeRunnerPanel = useAppStore((s) => s.closeRunnerPanel);
  const workspace = useAppStore((s) => s.workspace);

  const folderLabel = runner.folderRelPath
    ? runner.folderRelPath.split('/').pop()
    : workspace?.name ?? 'Collection';

  return (
    <RadixDialog.Root
      open={runner.open}
      onOpenChange={(next) => !next && closeRunnerPanel()}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/30 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[900px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-2xl outline-none"
          aria-describedby={undefined}
        >
          {/* Header */}
          <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-line px-4">
            <RadixDialog.Title className="flex-1 text-sm font-semibold text-ink-1">
              Run collection
              <span className="ml-2 font-normal text-ink-3">{folderLabel}</span>
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                className="icon-btn"
                aria-label="Close runner"
                title="Close"
              >
                ✕
              </button>
            </RadixDialog.Close>
          </div>

          {/* Body — two-column layout */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Config panel */}
            <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-line">
              <RunnerConfig />
            </div>

            {/* Results panel */}
            <div className="min-w-0 flex-1 overflow-y-auto">
              <RunnerResults />
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
