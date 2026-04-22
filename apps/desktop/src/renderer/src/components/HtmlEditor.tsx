import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { EditorSelection, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';

export type CodeMirrorLanguage = 'html' | 'json' | 'xml' | 'javascript' | 'css';

export interface HtmlEditorActiveMatch {
  lineIndex: number;
  start: number;
  end: number;
}

/** Returns the CodeMirror language extension for the given language key. */
function langExtension(language: CodeMirrorLanguage) {
  switch (language) {
    case 'html':
      return html();
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'javascript':
      return javascript();
    case 'css':
      return css();
  }
}

const ARIA_LABEL: Record<CodeMirrorLanguage, string> = {
  html: 'HTML source',
  json: 'JSON source',
  xml: 'XML source',
  javascript: 'JavaScript source',
  css: 'CSS source',
};

/**
 * Read-only CodeMirror editor with syntax highlighting.
 * Supports HTML, JSON, XML, JavaScript, and CSS.
 *
 * Adapts between light and dark themes by checking the `html.dark` class on
 * the document element (same mechanism as the rest of the app's Tailwind theme).
 *
 * When activeMatch is set, scrolls that range into view and selects it so the
 * browser's native selection highlight doubles as the "active match" cue.
 */
export function CodeMirrorViewer({
  content,
  language,
  activeMatch,
}: {
  content: string;
  language: CodeMirrorLanguage;
  activeMatch?: HtmlEditorActiveMatch | null;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDark = document.documentElement.classList.contains('dark');

  // Mount the editor once per theme/language combo, then update doc separately.
  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      basicSetup,
      langExtension(language),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      // Base styling that matches the app canvas in light mode.
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
      // Apply one-dark only when the app is in dark mode.
      ...(isDark ? [oneDark] : []),
    ];

    const state = EditorState.create({
      doc: content,
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
    // Recreate when theme or language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, language]);

  // Update document content without recreating the editor instance.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc === content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, [content]);

  // Follow search navigation from the outer SearchBox: map {lineIndex, start, end}
  // into a CodeMirror range and scroll + select it.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeMatch) return;
    const totalLines = view.state.doc.lines;
    // lineIndex is 0-based; CodeMirror lines are 1-based.
    const lineNumber = Math.min(totalLines, Math.max(1, activeMatch.lineIndex + 1));
    const line = view.state.doc.line(lineNumber);
    const from = Math.min(line.to, line.from + activeMatch.start);
    const to = Math.min(line.to, line.from + activeMatch.end);
    const range = EditorSelection.range(from, to);
    view.dispatch({
      selection: EditorSelection.create([range]),
      effects: EditorView.scrollIntoView(range, { y: 'center', x: 'center' }),
    });
  }, [activeMatch]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-hidden"
      aria-label={ARIA_LABEL[language]}
      role="region"
    />
  );
}

/**
 * Backward-compatible alias. New code should prefer CodeMirrorViewer directly.
 */
export function HtmlEditor({
  content,
  activeMatch,
}: {
  content: string;
  activeMatch?: HtmlEditorActiveMatch | null;
}): JSX.Element {
  return (
    <CodeMirrorViewer
      content={content}
      language="html"
      {...(activeMatch !== undefined ? { activeMatch } : {})}
    />
  );
}
