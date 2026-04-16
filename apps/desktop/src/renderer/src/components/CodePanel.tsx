import { useEffect, useRef, useState } from 'react';
import { FORMAT_VERSION, type CodegenTarget, type ScrapemanRequest } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore, type BuilderState } from '../store.js';

interface TargetMeta {
  target: CodegenTarget;
  label: string;
}

const TARGETS: TargetMeta[] = [
  { target: 'curl', label: 'curl' },
  { target: 'fetch', label: 'JS (fetch)' },
  { target: 'python', label: 'Python (requests)' },
  { target: 'go', label: 'Go (net/http)' },
];

export function CodePanel(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const workspace = useAppStore((s) => s.workspace);

  const [target, setTarget] = useState<CodegenTarget>('curl');
  const [inlineVars, setInlineVars] = useState(false);
  const [code, setCode] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!activeTab) {
      setCode('');
      return;
    }
    const request = buildRequestFromBuilder(activeTab.builder, activeTab.name);
    bridge
      .generateCode({
        target,
        request,
        inlineVariables: inlineVars,
        ...(workspace?.path ? { workspacePath: workspace.path } : {}),
      })
      .then(setCode)
      .catch((err: unknown) => setCode(`// error: ${String(err)}`));
  }, [activeTab, target, inlineVars, workspace?.path]);

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-4">
        Open a request to generate code.
      </div>
    );
  }

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-bg-subtle px-4 py-2">
        <div className="flex items-center gap-1">
          {TARGETS.map((t) => (
            <button
              key={t.target}
              onClick={() => setTarget(t.target)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                target === t.target
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-3">
          <input
            type="checkbox"
            checked={inlineVars}
            onChange={(e) => setInlineVars(e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          Inline variables
        </label>
        <button onClick={copy} className="btn-ghost">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        ref={preRef}
        tabIndex={0}
        onKeyDown={(e) => {
          // ⌘A scoped to the code block — by default <pre> is not
          // focusable so the browser's ⌘A falls through to the body.
          const isMacUA = navigator.userAgent.includes('Mac');
          const modKey = isMacUA ? e.metaKey : e.ctrlKey;
          if (
            modKey &&
            !e.shiftKey &&
            !e.altKey &&
            e.key.toLowerCase() === 'a' &&
            preRef.current
          ) {
            e.preventDefault();
            e.stopPropagation();
            const range = document.createRange();
            range.selectNodeContents(preRef.current);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }}
        className="flex-1 overflow-auto whitespace-pre-wrap break-words bg-bg-canvas p-4 font-mono text-xs text-ink-1 focus:outline-none"
      >
        {code}
      </pre>
    </div>
  );
}

function buildRequestFromBuilder(builder: BuilderState, name: string): ScrapemanRequest {
  const headers: Record<string, string> = {};
  for (const row of builder.headers) {
    if (row.enabled && row.key.trim()) headers[row.key.trim()] = row.value;
  }
  const request: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name },
    method: builder.method,
    url: builder.url,
  };
  if (Object.keys(headers).length > 0) request.headers = headers;
  if (builder.bodyType !== 'none' && builder.body.trim().length > 0) {
    const contentType: 'json' | 'text' = builder.bodyType;
    request.body = { type: contentType, content: builder.body };
    if (!request.headers) request.headers = {};
    if (contentType === 'json' && !('Content-Type' in request.headers)) {
      request.headers['Content-Type'] = 'application/json';
    }
  }
  return request;
}
