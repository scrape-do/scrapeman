import { useEffect, useMemo, useRef } from 'react';
import { EditorView, keymap, Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  useAvailableVariables,
  type AvailableVariable,
} from '../hooks/useAvailableVariables.js';

/**
 * Lint a JSON document and return a single diagnostic at the position
 * the parser bailed at, mirroring VSCode's "Document errors" gutter.
 * Skipped when the body contains a `{{variable}}` placeholder — the
 * resolver hasn't run yet, so JSON.parse would falsely flag the braces.
 */
function jsonLintSource(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];
  if (/\{\{[^}]+\}\}/.test(text)) return [];
  try {
    JSON.parse(text);
    return [];
  } catch (e) {
    if (!(e instanceof SyntaxError)) return [];
    // V8 syntax errors look like "Unexpected token ] in JSON at position 18".
    // Pull the offset out so the gutter mark lands on the offending byte.
    const m = e.message.match(/at position (\d+)/);
    const pos = m ? Math.min(view.state.doc.length, parseInt(m[1]!, 10)) : 0;
    return [
      {
        from: pos,
        to: Math.min(view.state.doc.length, pos + 1),
        severity: 'error',
        message: e.message,
      },
    ];
  }
}

export type BodyEditorLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'text';

export interface RequestBodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: BodyEditorLanguage;
  disabled?: boolean;
  placeholder?: string;
  /** Fires when the user presses Shift+Cmd/Ctrl+F inside the editor. The
   *  parent decides whether to beautify (only meaningful for JSON). */
  onBeautify?: () => void;
}

const VAR_RE = /\{\{[\w.-]+\}\}/g;

/**
 * Editable body editor with three layers of help:
 *
 *   1. Language-aware syntax highlighting (json / xml / html / javascript).
 *   2. `{{var}}` decoration — known names render in the accent palette,
 *      unknown ones in the destructive palette so the user notices that
 *      they will resolve to empty at send time.
 *   3. Autocomplete: typing `{{` opens a list of every active environment
 *      variable plus the built-in dynamic variables (random, uuid, …).
 *
 * Implementation note: the CodeMirror editor instance is created once per
 * `language` and `theme` combination; doc edits flow in via dispatch
 * without recreating the view. The available-variables list is read from
 * a ref so React state changes propagate without rebuilding extensions.
 */
export function RequestBodyEditor({
  value,
  onChange,
  language,
  disabled,
  placeholder,
  onBeautify,
}: RequestBodyEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDark = document.documentElement.classList.contains('dark');

  // Stable refs the CodeMirror plugins read from. Updated each render so
  // changing variables / disabled / onChange doesn't force a rebuild.
  const variables = useAvailableVariables();
  const variablesRef = useRef(variables);
  variablesRef.current = variables;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBeautifyRef = useRef(onBeautify);
  onBeautifyRef.current = onBeautify;

  // Memo a Set of names so the decorator can do O(1) lookups per match.
  const variableNames = useMemo(
    () => new Set(variables.map((v) => v.name)),
    [variables],
  );
  const variableNamesRef = useRef(variableNames);
  variableNamesRef.current = variableNames;

  // Compartments let us swap the editable / placeholder extensions
  // without tearing down the editor when `disabled` flips.
  const editableCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!containerRef.current) return;

    const langExt =
      language === 'json'
        ? json()
        : language === 'xml'
          ? xml()
          : language === 'html'
            ? html()
            : language === 'javascript'
              ? javascript()
              : [];

    const variableDecorationPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = this.build(view);
        }
        update(u: ViewUpdate): void {
          // Re-decorate whenever the doc changes OR the viewport changes
          // (so off-screen edits still get picked up when scrolled to).
          if (u.docChanged || u.viewportChanged) {
            this.decorations = this.build(u.view);
          }
        }
        build(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const known = variableNamesRef.current;
          for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            VAR_RE.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = VAR_RE.exec(text)) !== null) {
              const name = m[0].slice(2, -2);
              const start = from + m.index;
              const end = start + m[0].length;
              const cls = known.has(name)
                ? 'cm-var-known'
                : 'cm-var-unknown';
              builder.add(
                start,
                end,
                Decoration.mark({ class: cls, attributes: known.has(name) ? {} : { title: 'undefined variable' } }),
              );
            }
          }
          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations },
    );

    const variableCompletionSource = (
      ctx: CompletionContext,
    ): CompletionResult | null => {
      // Trigger when the cursor is inside a `{{...}}` token. Walk back
      // from the cursor to find the most recent `{{` without crossing a
      // closing `}}` or whitespace.
      const before = ctx.state.sliceDoc(0, ctx.pos);
      const open = before.lastIndexOf('{{');
      if (open < 0) return null;
      // Anything between `{{` and the cursor that would close or break
      // the token aborts the suggestion.
      const between = before.slice(open + 2);
      if (/[\s}]/.test(between)) return null;

      const list: AvailableVariable[] = variablesRef.current;
      return {
        from: open + 2,
        to: ctx.pos,
        options: list.map((v) => ({
          label: v.name,
          detail: v.preview,
          // `kind` rides along on the option object so the row renderer
          // (addToOptions below) can decide whether to draw the
          // "built-in" badge — same surface the URL bar popover uses.
          // CodeMirror types the option payload loosely so the cast is
          // safe at runtime.
          kind: v.kind,
          // Apply replaces the partial token AND closes the braces so the
          // user doesn't have to type `}}` themselves.
          apply: `${v.name}}}`,
        })),
        // Match against the bare partial after `{{` (no leading braces).
        filter: true,
        validFor: /^[\w.-]*$/,
      };
    };

    const beautifyKeymap = keymap.of([
      {
        key: 'Mod-Shift-f',
        run: () => {
          onBeautifyRef.current?.();
          return true;
        },
      },
    ]);

    const docChangeListener = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      onChangeRef.current(u.state.doc.toString());
    });

    // JSON gets the inline lint gutter + red squiggle for parse errors,
    // matching VSCode's editor.gutter.warning behaviour. Other languages
    // ship without it for now — XML/HTML/JS error reporting needs a
    // language-server-grade parser to be useful and we don't have one.
    const lintExt =
      language === 'json' ? [linter(jsonLintSource), lintGutter()] : [];

    const extensions = [
      basicSetup,
      langExt,
      variableDecorationPlugin,
      ...lintExt,
      autocompletion({
        override: [variableCompletionSource],
        // Activate as soon as the user types `{` — the source itself
        // gates on `{{`. This makes the popover feel responsive.
        activateOnTyping: true,
        closeOnBlur: true,
        addToOptions: [
          {
            // Append a small `built-in` badge to the row when the
            // completion came from the dynamic-variable list. Mirrors
            // the URL bar variable picker so the two popovers read the
            // same.
            render(completion) {
              const kind = (completion as { kind?: string }).kind;
              if (kind !== 'builtin') {
                const blank = document.createElement('span');
                return blank;
              }
              const span = document.createElement('span');
              span.className = 'cm-completion-builtin-badge';
              span.textContent = 'built-in';
              return span;
            },
            // Position 80 puts the badge after the detail (which sits
            // at 70 by default in CM's row layout).
            position: 80,
          },
        ],
      }),
      beautifyKeymap,
      docChangeListener,
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
        '.cm-content': { padding: '12px 0' },
      }),
      ...(isDark ? [oneDark] : []),
      editableCompartment.current.of([
        EditorView.editable.of(!disabled),
        EditorState.readOnly.of(disabled === true),
      ]),
    ];

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate when language or theme changes; the doc/disabled/handlers
    // flow in via refs and dispatched updates so they don't trigger
    // a teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, isDark]);

  // External value → editor doc.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  // Toggle editable without rebuilding the view.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure([
        EditorView.editable.of(!disabled),
        EditorState.readOnly.of(disabled === true),
      ]),
    });
  }, [disabled]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        aria-label="Request body"
        role="textbox"
      />
      {value.length === 0 && placeholder && (
        <div className="pointer-events-none absolute left-3 top-3 font-mono text-xs text-ink-4">
          {placeholder.split('\n').map((line, i) => (
            <div key={i}>{line || ' '}</div>
          ))}
        </div>
      )}
    </div>
  );
}
