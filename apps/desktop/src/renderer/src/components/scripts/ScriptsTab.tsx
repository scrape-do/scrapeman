import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { useAppStore } from '../../store.js';

type ScriptKind = 'preRequest' | 'postResponse';

const SCRIPT_LABELS: Record<ScriptKind, string> = {
  preRequest: 'Pre-request',
  postResponse: 'Post-response',
};

const PLACEHOLDERS: Record<ScriptKind, string> = {
  preRequest: [
    '// Runs before the request is sent.',
    '// Use req.setHeader("X-Token", bru.getVar("token")) to mutate the request.',
    '// Use await bru.setEnvVar("token", "value") to write environment variables.',
  ].join('\n'),
  postResponse: [
    '// Runs after the response is received.',
    '// Use res.getStatus() and res.getBody() to inspect the response.',
    '// Use test("name", () => { expect(res.getStatus()).toBe(200); }) to assert.',
  ].join('\n'),
};

export function ScriptsTab(): JSX.Element {
  const [activeKind, setActiveKind] = useState<ScriptKind>('preRequest');
  const preRequestScript = useAppStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.builder.preRequestScript ?? '',
  );
  const postResponseScript = useAppStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.builder.postResponseScript ?? '',
  );
  const setPreRequestScript = useAppStore((s) => s.setPreRequestScript);
  const setPostResponseScript = useAppStore((s) => s.setPostResponseScript);

  const currentCode = activeKind === 'preRequest' ? preRequestScript : postResponseScript;
  const setCode = activeKind === 'preRequest' ? setPreRequestScript : setPostResponseScript;

  const hasPreRequest = preRequestScript.trim().length > 0;
  const hasPostResponse = postResponseScript.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center border-b border-line px-4 gap-1">
        {(['preRequest', 'postResponse'] as ScriptKind[]).map((kind) => {
          const hasDot = kind === 'preRequest' ? hasPreRequest : hasPostResponse;
          return (
            <button
              key={kind}
              onClick={() => setActiveKind(kind)}
              className={`tab ${activeKind === kind ? 'tab-active' : ''}`}
            >
              {SCRIPT_LABELS[kind]}
              {hasDot && (
                <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">
        <ScriptEditor
          key={activeKind}
          code={currentCode}
          placeholder={PLACEHOLDERS[activeKind]}
          onChange={setCode}
        />
      </div>
    </div>
  );
}

function ScriptEditor({
  code,
  placeholder,
  onChange,
}: {
  code: string;
  placeholder: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep a ref so the updateListener closure doesn't go stale.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const isDark = document.documentElement.classList.contains('dark');

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      basicSetup,
      javascript(),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '12px',
          fontFamily: '"Geist Mono", monospace',
          backgroundColor: 'transparent',
        },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
      }),
      ...(isDark ? [oneDark] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];

    const state = EditorState.create({
      doc: code,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only recreate on theme change. Content updates go through dispatch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  // Sync external code changes without destroying the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === code) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
  }, [code]);

  return (
    <div className="relative h-full overflow-hidden">
      {!code && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-10 p-4 font-mono text-xs leading-5 text-ink-4 whitespace-pre"
        >
          {placeholder}
        </div>
      )}
      <div ref={containerRef} className="h-full" aria-label="Script editor" />
    </div>
  );
}
