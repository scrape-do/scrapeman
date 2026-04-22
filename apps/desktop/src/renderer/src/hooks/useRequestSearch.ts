import { useMemo } from 'react';
import type { CollectionFolderNode, CollectionNode, CollectionRequestNode, HttpMethod } from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';
import { score } from '../utils/search.js';

export interface FolderChild {
  name: string;
  kind: 'request' | 'folder';
  method?: HttpMethod;
  relPath: string;
}

export interface SearchHit {
  id: string;
  kind: 'tab' | 'request' | 'folder';
  label: string;
  sub: string;
  method?: HttpMethod;
  relPath?: string;
  tabId?: string;
  children?: FolderChild[];
  run: () => void;
}

export type SearchMode = 'all' | 'folder' | 'request' | 'focus' | 'header' | 'body';

export interface ParsedQuery {
  mode: SearchMode;
  term: string;
}

const DORK_ALIASES: Record<string, SearchMode> = {
  folder: 'folder',
  dir: 'folder',
  request: 'request',
  focus: 'focus',
  header: 'header',
  body: 'body',
};

export function parseSearchQuery(raw: string): ParsedQuery {
  const m = raw.trim().match(/^([a-z]+):(.*)$/i);
  if (m && m[1] && m[2] !== undefined) {
    const alias = DORK_ALIASES[m[1].toLowerCase()];
    if (alias) return { mode: alias, term: m[2].trim() };
  }
  return { mode: 'all', term: raw.trim() };
}

// Human-readable hint shown in the palette while in dork mode
export const DORK_HINTS: Record<SearchMode, string> = {
  all: '',
  folder: 'Searching folders',
  request: 'Searching requests',
  focus: 'Searching open tabs',
  header: 'Searching by header',
  body: 'Searching by body',
};

function flattenRequests(
  node: CollectionFolderNode,
  folderPath: string,
): Array<{ req: CollectionRequestNode; folderPath: string }> {
  const out: Array<{ req: CollectionRequestNode; folderPath: string }> = [];
  for (const child of node.children) {
    if (child.kind === 'request') {
      out.push({ req: child, folderPath });
    } else {
      const sub = folderPath ? `${folderPath}/${child.name}` : child.name;
      out.push(...flattenRequests(child, sub));
    }
  }
  return out;
}

function flattenFolders(node: CollectionFolderNode): CollectionFolderNode[] {
  const out: CollectionFolderNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'folder') {
      out.push(child);
      out.push(...flattenFolders(child));
    }
  }
  return out;
}

function toFolderChild(node: CollectionNode): FolderChild {
  return node.kind === 'request'
    ? { name: node.name, kind: 'request', method: node.method, relPath: node.relPath }
    : { name: node.name, kind: 'folder', relPath: node.relPath };
}

function best(...scores: (number | null)[]): number | null {
  let max: number | null = null;
  for (const s of scores) {
    if (s !== null && (max === null || s > max)) max = s;
  }
  return max;
}

export function useRequestSearch(query: string, enabled: boolean): SearchHit[] {
  const root = useAppStore((s) => s.root);
  const tabs = useAppStore((s) => s.tabs);
  const openRequest = useAppStore((s) => s.openRequest);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSidebarView = useAppStore((s) => s.setSidebarView);
  const revealInSidebar = useAppStore((s) => s.revealInSidebar);

  return useMemo(() => {
    if (!enabled || !query.trim()) return [];

    const { mode, term } = parseSearchQuery(query);
    // Require a term even in dork mode — no term, nothing to show.
    if (!term) return [];

    const hits: Array<SearchHit & { _score: number }> = [];
    const coveredPaths = new Set<string>();

    // ── Open tabs ─────────────────────────────────────────────────────────
    const includeTabs = mode === 'all' || mode === 'request' || mode === 'focus' || mode === 'header' || mode === 'body';
    if (includeTabs) {
      for (const tab of tabs) {
        let s: number | null = null;

        if (mode === 'focus') {
          s = best(score(tab.name, term), score(tab.builder.url, term));
        } else if (mode === 'header') {
          // Search across all enabled header keys and values
          const haystack = tab.builder.headers
            .filter((h) => h.enabled && h.key)
            .map((h) => `${h.key} ${h.value}`)
            .join(' ');
          s = score(haystack, term);
        } else if (mode === 'body') {
          s = tab.builder.body ? score(tab.builder.body, term) : null;
        } else {
          // 'all' | 'request'
          s = best(score(tab.name, term), score(tab.builder.url, term));
        }

        if (s === null) continue;
        if (tab.relPath) coveredPaths.add(tab.relPath);

        hits.push({
          id: `tab:${tab.id}`,
          kind: 'tab',
          label: tab.name,
          sub: tab.builder.url || '(no URL)',
          method: tab.method,
          tabId: tab.id,
          _score: s + 200,
          run: () => setActiveTab(tab.id),
        });
      }
    }

    if (root) {
      // ── Saved collection requests ────────────────────────────────────────
      // url:/header:/body: only make sense for loaded tabs — skip saved requests.
      const includeRequests = mode === 'all' || mode === 'request';
      if (includeRequests) {
        for (const { req, folderPath } of flattenRequests(root, '')) {
          if (coveredPaths.has(req.relPath)) continue;
          const s = best(
            score(req.name, term) !== null ? (score(req.name, term)! + 50) : null,
            folderPath ? score(folderPath, term) : null,
            score(req.relPath, term) !== null ? score(req.relPath, term)! * 0.4 : null,
          );
          if (s === null) continue;
          hits.push({
            id: `req:${req.relPath}`,
            kind: 'request',
            label: req.name,
            sub: folderPath || '/',
            method: req.method,
            relPath: req.relPath,
            _score: s,
            run: () => void openRequest(req.relPath),
          });
        }
      }

      // ── Folders ──────────────────────────────────────────────────────────
      const includeFolders = mode === 'all' || mode === 'folder';
      if (includeFolders) {
        for (const folder of flattenFolders(root)) {
          const s = best(score(folder.name, term), score(folder.relPath, term));
          if (s === null) continue;
          hits.push({
            id: `folder:${folder.relPath}`,
            kind: 'folder',
            label: folder.name,
            sub: folder.relPath,
            relPath: folder.relPath,
            children: folder.children.map(toFolderChild),
            _score: mode === 'folder' ? s : s * 0.75,
            run: () => {
              setSidebarView('files');
              revealInSidebar(folder.relPath);
            },
          });
        }
      }
    }

    return hits
      .sort((a, b) => b._score - a._score)
      .slice(0, 12)
      .map(({ _score: _s, ...hit }) => hit);
  }, [query, enabled, root, tabs, openRequest, setActiveTab, setSidebarView, revealInSidebar]);
}
