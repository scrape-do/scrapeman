// DiffViewer — renders a unified diff string as a VS Code-style line-by-line
// view with a gutter (old/new line numbers) and green/red line backgrounds.
// No Monaco required — plain divs + Tailwind.

export interface DiffViewerProps {
  filePath: string;
  diff: string;
  onClose: () => void;
}

// Parsed representation of a single diff line.
interface ParsedLine {
  type: 'added' | 'removed' | 'context' | 'hunk' | 'file-header';
  content: string;
  oldNum: number | null;
  newNum: number | null;
}

// Parse a @@ -a,b +c,d @@ hunk header into starting line numbers.
function parseHunkHeader(line: string): { oldStart: number; newStart: number } {
  const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    return { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10) };
  }
  return { oldStart: 1, newStart: 1 };
}

function parseDiff(raw: string): ParsedLine[] {
  const rawLines = raw.split('\n');
  const result: ParsedLine[] = [];

  let oldNum = 0;
  let newNum = 0;

  for (const line of rawLines) {
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file')) {
      result.push({ type: 'file-header', content: line, oldNum: null, newNum: null });
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      result.push({ type: 'file-header', content: line, oldNum: null, newNum: null });
    } else if (line.startsWith('@@')) {
      const { oldStart, newStart } = parseHunkHeader(line);
      oldNum = oldStart;
      newNum = newStart;
      result.push({ type: 'hunk', content: line, oldNum: null, newNum: null });
    } else if (line.startsWith('+')) {
      result.push({ type: 'added', content: line.slice(1), oldNum: null, newNum: newNum });
      newNum++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', content: line.slice(1), oldNum: oldNum, newNum: null });
      oldNum++;
    } else {
      // Context line or trailing empty line.
      if (result.length > 0 || line.length > 0) {
        result.push({ type: 'context', content: line, oldNum: oldNum, newNum: newNum });
        oldNum++;
        newNum++;
      }
    }
  }

  return result;
}

function GutterCell({ num }: { num: number | null }): JSX.Element {
  return (
    <span className="inline-block w-10 shrink-0 select-none text-right pr-2 text-ink-4 tabular-nums">
      {num !== null ? num : ''}
    </span>
  );
}

function DiffLineRow({ line }: { line: ParsedLine }): JSX.Element {
  if (line.type === 'file-header') {
    return (
      <div className="flex min-w-0 border-b border-line/50 bg-bg-subtle py-0.5 last:border-b-0">
        <span className="inline-block w-10 shrink-0" />
        <span className="inline-block w-10 shrink-0" />
        <span className="inline-block w-4 shrink-0 text-ink-4" />
        <span className="min-w-0 text-ink-3">{line.content || '\u00a0'}</span>
      </div>
    );
  }

  if (line.type === 'hunk') {
    return (
      <div className="flex min-w-0 bg-[color:rgb(var(--bg-muted))] py-0.5">
        <span className="inline-block w-10 shrink-0" />
        <span className="inline-block w-10 shrink-0" />
        <span className="inline-block w-4 shrink-0 text-ink-4" />
        <span className="min-w-0 text-ink-3">{line.content || '\u00a0'}</span>
      </div>
    );
  }

  if (line.type === 'added') {
    return (
      <div className="flex min-w-0 bg-green-500/10 py-0.5 hover:bg-green-500/20">
        <GutterCell num={null} />
        <GutterCell num={line.newNum} />
        <span className="inline-block w-4 shrink-0 text-center text-green-600 dark:text-green-400 select-none">
          +
        </span>
        <span className="min-w-0 text-green-800 dark:text-green-200">
          {line.content || '\u00a0'}
        </span>
      </div>
    );
  }

  if (line.type === 'removed') {
    return (
      <div className="flex min-w-0 bg-red-500/10 py-0.5 hover:bg-red-500/20">
        <GutterCell num={line.oldNum} />
        <GutterCell num={null} />
        <span className="inline-block w-4 shrink-0 text-center text-red-600 dark:text-red-400 select-none">
          -
        </span>
        <span className="min-w-0 text-red-800 dark:text-red-200">
          {line.content || '\u00a0'}
        </span>
      </div>
    );
  }

  // Context line.
  return (
    <div className="flex min-w-0 py-0.5">
      <GutterCell num={line.oldNum} />
      <GutterCell num={line.newNum} />
      <span className="inline-block w-4 shrink-0 text-ink-4 select-none" />
      <span className="min-w-0 text-ink-2">{line.content || '\u00a0'}</span>
    </div>
  );
}

export function DiffViewer({ filePath, diff, onClose }: DiffViewerProps): JSX.Element {
  if (!diff.trim()) {
    return (
      <div className="flex h-full flex-col">
        <DiffHeader filePath={filePath} onClose={onClose} />
        <div className="flex flex-1 items-center justify-center text-xs text-ink-3">
          No diff available.
        </div>
      </div>
    );
  }

  const lines = parseDiff(diff);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DiffHeader filePath={filePath} onClose={onClose} />
      {/* Horizontally scrollable so long lines don't wrap. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <pre className="font-mono text-[11px] leading-[1.5] min-w-max w-full">
          {lines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </pre>
      </div>
    </div>
  );
}

function DiffHeader({ filePath, onClose }: { filePath: string; onClose: () => void }): JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-bg-subtle px-3">
      <span className="flex-1 truncate font-mono text-[11px] text-ink-2" title={filePath}>
        {filePath}
      </span>
      <button
        onClick={onClose}
        aria-label="Close diff view"
        title="Close diff view"
        className="icon-btn -mr-1"
      >
        ×
      </button>
    </div>
  );
}
