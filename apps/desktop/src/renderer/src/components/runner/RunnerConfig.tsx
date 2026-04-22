import { useRef } from 'react';
import { useAppStore } from '../../store.js';
import { bridge } from '../../bridge.js';

export function RunnerConfig(): JSX.Element {
  const runner = useAppStore((s) => s.runner);
  const updateRunnerConfig = useAppStore((s) => s.updateRunnerConfig);
  const startRunner = useAppStore((s) => s.startRunner);
  const stopRunner = useAppStore((s) => s.stopRunner);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeRun = runner.activeRunId ? runner.runs.get(runner.activeRunId) : null;
  const isRunning = activeRun?.running === true;

  const handleCsvPick = async (): Promise<void> => {
    const filePath = await bridge.pickFile({
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
    });
    if (!filePath) return;
    // Read the file via the Node fs bridge — we pass the path to the main
    // process in the RunnerStartInput, so we just need the file contents here
    // for the preview. We use fetch with a file:// URL since the renderer has
    // sandbox:false.
    try {
      const res = await fetch(`file://${filePath}`);
      const text = await res.text();
      updateRunnerConfig({ csvContent: text });
    } catch {
      // If fetch fails (sandboxed), store the path; main process will read it.
      updateRunnerConfig({ csvContent: `__path__:${filePath}` });
    }
  };

  const clearCsv = (): void => {
    updateRunnerConfig({ csvContent: '' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const csvRowCount = (() => {
    if (!runner.csvContent || !runner.csvContent.trim()) return 0;
    if (runner.csvContent.startsWith('__path__:')) return null;
    const lines = runner.csvContent.trim().split('\n');
    // First row is header.
    return Math.max(0, lines.length - 1);
  })();

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Mode */}
      <div>
        <div className="mb-1.5 text-xs font-semibold text-ink-2">Mode</div>
        <div className="flex gap-2">
          {(['sequential', 'parallel'] as const).map((m) => (
            <button
              key={m}
              onClick={() => updateRunnerConfig({ mode: m })}
              disabled={isRunning}
              className={`rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                runner.mode === m
                  ? 'bg-accent text-white'
                  : 'bg-bg-hover text-ink-2 hover:text-ink-1'
              } disabled:opacity-50`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Concurrency (parallel only) */}
      {runner.mode === 'parallel' && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-2">
            Concurrency
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={runner.concurrency}
            disabled={isRunning}
            onChange={(e) =>
              updateRunnerConfig({
                concurrency: Math.max(1, parseInt(e.target.value, 10) || 1),
              })
            }
            className="w-24 rounded border border-line bg-bg px-2 py-1 text-xs text-ink-1 outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
      )}

      {/* Delay */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-ink-2">
          Delay between requests (ms)
        </label>
        <input
          type="number"
          min={0}
          value={runner.delayMs}
          disabled={isRunning}
          onChange={(e) =>
            updateRunnerConfig({
              delayMs: Math.max(0, parseInt(e.target.value, 10) || 0),
            })
          }
          className="w-24 rounded border border-line bg-bg px-2 py-1 text-xs text-ink-1 outline-none focus:border-accent disabled:opacity-50"
        />
      </div>

      {/* Iterations / CSV */}
      {!runner.csvContent.trim() ? (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-2">
            Iterations
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            value={runner.iterations}
            disabled={isRunning}
            onChange={(e) =>
              updateRunnerConfig({
                iterations: Math.max(1, parseInt(e.target.value, 10) || 1),
              })
            }
            className="w-24 rounded border border-line bg-bg px-2 py-1 text-xs text-ink-1 outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
      ) : (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-2">Iterations</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-2">
              {csvRowCount !== null
                ? `${csvRowCount} rows from CSV`
                : 'CSV file loaded'}
            </span>
            <button
              onClick={clearCsv}
              disabled={isRunning}
              className="text-xs text-ink-3 hover:text-red-400 disabled:opacity-50"
            >
              Remove CSV
            </button>
          </div>
        </div>
      )}

      {/* CSV upload */}
      {!runner.csvContent.trim() && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-2">
            Data-driven iterations (CSV)
          </div>
          <button
            onClick={() => void handleCsvPick()}
            disabled={isRunning}
            className="btn-ghost text-xs text-ink-3 hover:text-ink-1 disabled:opacity-50"
          >
            Upload CSV file…
          </button>
          <div className="mt-1 text-[11px] text-ink-4">
            Header row defines variable names. One iteration per data row.
          </div>
        </div>
      )}

      {/* Run / Stop */}
      <div className="flex gap-2 pt-2">
        {isRunning ? (
          <button
            onClick={() => void stopRunner()}
            className="rounded bg-red-500/20 px-4 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/30"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => void startRunner()}
            className="btn-primary text-xs"
          >
            Run collection
          </button>
        )}
      </div>
    </div>
  );
}
