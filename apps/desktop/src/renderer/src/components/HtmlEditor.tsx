import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';

/**
 * Read-only CodeMirror editor for HTML pretty view.
 * Adapts between light and dark themes by watching the `html.dark` class on
 * the document element (same mechanism as the rest of the app's Tailwind theme).
 */
export function HtmlEditor({ content }: { content: string }): JSX.Element {
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

  return (
    <div
      ref={containerRef}
      className="h-full overflow-hidden"
      aria-label="HTML source"
      role="region"
    />
  );
}
