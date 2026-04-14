import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useAvailableVariables } from '../hooks/useAvailableVariables.js';

const VAR_PATTERN = /\{\{[\w.-]+\}\}/g;

export type HighlightedInputVariant = 'field' | 'cell';

export interface HighlightedInputProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  variant?: HighlightedInputVariant;
  type?: 'text' | 'password';
  className?: string;
  inputClassName?: string;
}

interface AutocompleteState {
  open: boolean;
  query: string;
  // Range in the value string covering the whole {{partial token (without
  // closing braces). Used for replacement on selection.
  tokenStart: number;
  tokenEnd: number;
  selectedIndex: number;
}

const CLOSED_AUTOCOMPLETE: AutocompleteState = {
  open: false,
  query: '',
  tokenStart: 0,
  tokenEnd: 0,
  selectedIndex: 0,
};

export const HighlightedInput = forwardRef<HTMLInputElement, HighlightedInputProps>(
  function HighlightedInput(
    {
      value,
      onChange,
      onPaste,
      placeholder,
      variant = 'field',
      type = 'text',
      className = '',
      inputClassName = '',
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const variables = useAvailableVariables();
    const [auto, setAuto] = useState<AutocompleteState>(CLOSED_AUTOCOMPLETE);
    const [popoverRect, setPopoverRect] = useState<{
      top: number;
      left: number;
      width: number;
    } | null>(null);

    const filtered = useMemo(() => {
      if (!auto.open) return [];
      const q = auto.query.toLowerCase();
      const matches = variables.filter((v) =>
        q ? v.name.toLowerCase().includes(q) : true,
      );
      // Exact-prefix matches first.
      matches.sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.name.localeCompare(b.name);
      });
      return matches.slice(0, 12);
    }, [auto.open, auto.query, variables]);

    const sync = (): void => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
      }
    };

    useEffect(() => {
      sync();
    }, [value]);

    // Compute portal popover position from the input's bounding rect.
    // Runs after layout so the rect reflects the final position, and
    // updates on window scroll/resize for stability.
    useLayoutEffect(() => {
      if (!auto.open) {
        setPopoverRect(null);
        return;
      }
      const update = (): void => {
        const el = wrapperRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPopoverRect({
          top: r.bottom + 4,
          left: r.left,
          width: Math.max(260, r.width),
        });
      };
      update();
      window.addEventListener('scroll', update, true);
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('scroll', update, true);
        window.removeEventListener('resize', update);
      };
    }, [auto.open, value]);

    const checkAutocomplete = (
      newValue: string,
      cursor: number,
    ): AutocompleteState => {
      // Walk backwards from cursor to find an unclosed `{{`.
      let i = cursor - 1;
      while (i >= 0) {
        const ch = newValue[i];
        if (ch === '}' || ch === ' ' || ch === '\n' || ch === '\t') {
          return CLOSED_AUTOCOMPLETE;
        }
        if (ch === '{' && newValue[i - 1] === '{') {
          // Found the start of a {{ token. Now find the end of the partial.
          const partialStart = i + 1; // first char after `{{`
          let j = cursor;
          while (j < newValue.length) {
            const c = newValue[j];
            if (c === '}' || c === ' ' || c === '\n' || c === '\t') break;
            j++;
          }
          const query = newValue.slice(partialStart, j);
          return {
            open: true,
            query,
            tokenStart: i - 1, // points at the first `{`
            tokenEnd: j,
            selectedIndex: 0,
          };
        }
        i--;
      }
      return CLOSED_AUTOCOMPLETE;
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
      onChange(e);
      const cursor = e.target.selectionStart ?? e.target.value.length;
      const next = checkAutocomplete(e.target.value, cursor);
      setAuto(next);
      requestAnimationFrame(sync);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
      // ⌘A / Ctrl+A — scope select-all to this input only. Without this,
      // the parent overflow-hidden + transparent-text overlay leaks the
      // event up to the body and Chromium runs page-level select all.
      const isMacUA = navigator.userAgent.includes('Mac');
      const modKey = isMacUA ? e.metaKey : e.ctrlKey;
      if (modKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.select();
        return;
      }

      if (!auto.open || filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAuto((a) => ({
          ...a,
          selectedIndex: (a.selectedIndex + 1) % filtered.length,
        }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAuto((a) => ({
          ...a,
          selectedIndex:
            (a.selectedIndex - 1 + filtered.length) % filtered.length,
        }));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const choice = filtered[auto.selectedIndex];
        if (choice) {
          e.preventDefault();
          insertVariable(choice.name);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setAuto(CLOSED_AUTOCOMPLETE);
      }
    };

    const insertVariable = (name: string): void => {
      const input = inputRef.current;
      if (!input) return;
      const before = value.slice(0, auto.tokenStart);
      const after = value.slice(auto.tokenEnd).replace(/^\}*/, '');
      const insertion = `{{${name}}}`;
      const nextValue = before + insertion + after;
      const nextCursor = before.length + insertion.length;

      // Drive the controlled input via the standard onChange handler.
      const synthetic = {
        target: { value: nextValue, selectionStart: nextCursor },
      } as unknown as ChangeEvent<HTMLInputElement>;
      onChange(synthetic);
      setAuto(CLOSED_AUTOCOMPLETE);

      // Restore the cursor after React commits the new value.
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(nextCursor, nextCursor);
        }
      });
    };

    const baseInner =
      'font-mono text-sm leading-[20px] whitespace-pre tabular-nums';
    const wrapperCls =
      variant === 'field'
        ? `relative flex h-8 items-center rounded-md border border-line bg-bg-canvas focus-within:border-accent focus-within:shadow-focus ${className}`
        : `relative flex h-8 items-center ${className}`;
    const padding = variant === 'field' ? 'px-2.5' : 'pr-2';
    const inputCls = `peer relative z-10 h-full w-full bg-transparent ${padding} ${baseInner} text-transparent caret-ink-1 outline-none placeholder:text-ink-4 ${inputClassName}`;

    return (
      <div ref={wrapperRef} className={wrapperCls}>
        <div
          ref={overlayRef}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden ${padding} ${baseInner} text-ink-1`}
        >
          <span className="block whitespace-pre">
            {value.length > 0 ? renderHighlighted(value) : null}
          </span>
        </div>
        <input
          ref={inputRef}
          type={type}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={sync}
          onBlur={() => {
            // Delay so click on a popover item still fires before close.
            setTimeout(() => setAuto(CLOSED_AUTOCOMPLETE), 120);
          }}
          {...(onPaste ? { onPaste } : {})}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className={inputCls}
        />

        {auto.open &&
          filtered.length > 0 &&
          popoverRect &&
          createPortal(
            <div
              style={{
                position: 'fixed',
                top: popoverRect.top,
                left: popoverRect.left,
                width: popoverRect.width,
                maxWidth: 480,
                zIndex: 9999,
              }}
              className="overflow-hidden rounded-md border border-line bg-bg-canvas shadow-popover animate-slide-down-fade"
            >
              <div className="border-b border-line-subtle bg-bg-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                Variables
              </div>
              <ul className="max-h-[260px] overflow-y-auto py-1">
                {filtered.map((variable, index) => (
                  <li key={`${variable.kind}-${variable.name}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        // Prevent input blur before click handler runs.
                        e.preventDefault();
                        insertVariable(variable.name);
                      }}
                      onMouseEnter={() =>
                        setAuto((a) => ({ ...a, selectedIndex: index }))
                      }
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
                        index === auto.selectedIndex
                          ? 'bg-accent-soft text-ink-1'
                          : 'text-ink-2 hover:bg-bg-hover'
                      }`}
                    >
                      <span className="font-mono font-medium text-accent">
                        {variable.name}
                      </span>
                      <span className="ml-auto truncate text-[10px] text-ink-4">
                        {variable.preview}
                      </span>
                      {variable.kind === 'builtin' && (
                        <span className="rounded bg-bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-ink-4">
                          built-in
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )}
      </div>
    );
  },
);

function renderHighlighted(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  VAR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VAR_PATTERN.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <span
        key={`v-${match.index}`}
        className="rounded-sm bg-accent-soft px-0.5 font-medium text-accent"
      >
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
