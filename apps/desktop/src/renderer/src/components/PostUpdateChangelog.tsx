import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import {
  parseChangelog,
  sectionsBetween,
  type ChangelogSection,
} from '../utils/changelog.js';

declare const __APP_VERSION__: string;
declare const __CHANGELOG__: string;

const LAST_LAUNCHED_VERSION_KEY = 'app:lastLaunchedVersion';

/**
 * One-time popup shown the first time the user launches a new version.
 * Compares `__APP_VERSION__` (the running build) to the version persisted
 * in localStorage on the previous launch. When higher, renders the
 * matching CHANGELOG section(s) and writes the new version on dismiss.
 *
 * Skipped on first install — there is no "previous" version to diff
 * against and nothing useful to show beyond a generic welcome.
 */
export function PostUpdateChangelog(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<ChangelogSection[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let previous: string | null;
    try {
      previous = window.localStorage.getItem(LAST_LAUNCHED_VERSION_KEY);
    } catch {
      return;
    }

    if (previous === null) {
      // First run — no upgrade to celebrate. Just record current version.
      try {
        window.localStorage.setItem(LAST_LAUNCHED_VERSION_KEY, __APP_VERSION__);
      } catch {
        /* ignore */
      }
      return;
    }

    if (previous === __APP_VERSION__) return;

    const between = sectionsBetween(__CHANGELOG__, previous, __APP_VERSION__);
    if (between.length > 0) {
      setSections(between);
    } else {
      // Fall back to the top-most section so a user upgrading past a tag
      // we forgot to changelog still sees something meaningful.
      const all = parseChangelog(__CHANGELOG__);
      if (all.length > 0) setSections([all[0]!]);
    }
    setOpen(true);
  }, []);

  const dismiss = (): void => {
    setOpen(false);
    try {
      window.localStorage.setItem(LAST_LAUNCHED_VERSION_KEY, __APP_VERSION__);
    } catch {
      /* ignore */
    }
  };

  const renderedBody = useMemo(() => {
    return sections
      .map((s) => `## v${s.version}\n\n${s.body}`)
      .join('\n\n---\n\n');
  }, [sections]);

  if (sections.length === 0) return null;

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && dismiss()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[600px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-bg-canvas shadow-popover animate-slide-down-fade">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
            <div>
              <RadixDialog.Title className="text-sm font-semibold text-ink-1">
                What's new in Scrapeman v{__APP_VERSION__}
              </RadixDialog.Title>
              <RadixDialog.Description className="mt-0.5 text-xs text-ink-3">
                {sections.length === 1
                  ? `Highlights from this release.`
                  : `Highlights from the ${sections.length} releases since you last opened the app.`}
              </RadixDialog.Description>
            </div>
            <a
              href={`https://github.com/scrape-do/scrapeman/releases/tag/v${__APP_VERSION__}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded border border-line px-2 py-1 font-mono text-[10px] text-ink-3 hover:bg-bg-hover hover:text-ink-1"
            >
              View on GitHub ↗
            </a>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <ChangelogMarkdown source={renderedBody} />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3">
            <button
              type="button"
              onClick={dismiss}
              className="btn-primary"
              title="Dismiss and continue"
            >
              Got it
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * Tiny markdown renderer for our changelog format. We only need: H1/H2,
 * H3, list items, bold spans, inline code, and paragraphs. Pulling in a
 * full markdown library for ~50 lines of text would be wasteful.
 */
function ChangelogMarkdown({ source }: { source: string }): JSX.Element {
  const blocks = source.split(/\n\n+/);
  return (
    <div className="space-y-3 text-xs leading-relaxed text-ink-2">
      {blocks.map((block, i) => {
        if (/^## /.test(block)) {
          return (
            <h2 key={i} className="mt-4 text-sm font-semibold text-ink-1 first:mt-0">
              {block.replace(/^## /, '')}
            </h2>
          );
        }
        if (/^### /.test(block)) {
          return (
            <h3 key={i} className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
              {block.replace(/^### /, '')}
            </h3>
          );
        }
        if (/^---$/.test(block.trim())) {
          return <hr key={i} className="my-3 border-line" />;
        }
        if (/^- /.test(block)) {
          const items = block.split(/\n(?=- )/);
          return (
            <ul key={i} className="ml-4 list-disc space-y-1.5">
              {items.map((item, j) => (
                <li key={j}>{renderInline(item.replace(/^- /, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-ink-2">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  // Tokenise by **bold**, `code`, and plain text. Keep it simple — no
  // links, no italics; nothing in our changelog uses them.
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) {
      parts.push(<span key={i++}>{text.slice(last, m.index)}</span>);
    }
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(
        <strong key={i++} className="font-semibold text-ink-1">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={i++}
          className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px] text-ink-1"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) parts.push(<span key={i++}>{text.slice(last)}</span>);
  return parts;
}
