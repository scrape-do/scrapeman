import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { EditorSelection, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';

export interface HtmlEditorActiveMatch {
  lineIndex: number;
  start: number;
  end: number;
}

/**
 * Read-only CodeMirror editor for HTML pretty view.
 * Adapts between light and dark themes by watching the `html.dark` class on
 * the document element (same mechanism as the rest of the app's Tailwind theme).
 * When activeMatch is set, scrolls that range into view and selects it so
 * the browser's selection highlight doubles as the "active match" cue.
 */
export function HtmlEditor({
  content,
  activeMatch,
}: {
  content: string;
  activeMatch?: HtmlEditorActiveMatch | null;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDark = document.documentElement.classList.contains('dark');

  // Mount the editor once, then update doc when content changes.
  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      basicSetup,
      html(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      // Light-mode base styling that matches the app canvas.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]); // Recreate when theme changes.

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
      aria-label="HTML source"
      role="region"
    />
  );
}
