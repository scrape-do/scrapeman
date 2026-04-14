import { describe, expect, it } from 'vitest';
import { parsePorcelainStatus } from '../src/git/porcelain.js';

// Helper: build a porcelain -z blob from an array of entries. The real
// git output has the branch header followed by a NUL, then each entry
// terminated by NUL. Renames carry an extra NUL-delimited original path.
function build(header: string, entries: string[]): string {
  return header + '\0' + entries.join('\0') + (entries.length ? '\0' : '');
}

describe('parsePorcelainStatus', () => {
  it('returns empty state for empty input', () => {
    const out = parsePorcelainStatus('');
    expect(out.branch).toBeNull();
    expect(out.changes).toEqual([]);
    expect(out.ahead).toBe(0);
    expect(out.behind).toBe(0);
  });

  it('parses branch name without upstream', () => {
    const out = parsePorcelainStatus(build('## main', []));
    expect(out.branch).toBe('main');
    expect(out.upstream).toBeNull();
  });

  it('parses branch name and upstream with ahead/behind', () => {
    const out = parsePorcelainStatus(
      build('## feat/x...origin/feat/x [ahead 2, behind 3]', []),
    );
    expect(out.branch).toBe('feat/x');
    expect(out.upstream).toBe('origin/feat/x');
    expect(out.ahead).toBe(2);
    expect(out.behind).toBe(3);
  });

  it('parses "No commits yet" state', () => {
    const out = parsePorcelainStatus(build('## No commits yet on main', []));
    expect(out.branch).toBe('main');
  });

  it('parses modified, staged, deleted, untracked', () => {
    const out = parsePorcelainStatus(
      build('## main', [
        ' M src/a.ts',
        'M  src/b.ts',
        ' D src/c.ts',
        '?? src/d.ts',
        'A  src/e.ts',
      ]),
    );
    expect(out.changes).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: false },
      { path: 'src/b.ts', status: 'modified', staged: true },
      { path: 'src/c.ts', status: 'deleted', staged: false },
      { path: 'src/d.ts', status: 'untracked', staged: false },
      { path: 'src/e.ts', status: 'added', staged: true },
    ]);
  });

  it('parses renames with original path in next field', () => {
    const out = parsePorcelainStatus(
      build('## main', ['R  new/path.ts', 'old/path.ts']),
    );
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toEqual({
      path: 'new/path.ts',
      status: 'renamed',
      staged: true,
      originalPath: 'old/path.ts',
    });
  });

  it('emits two change rows for files that are both staged and dirty', () => {
    const out = parsePorcelainStatus(build('## main', ['MM src/a.ts']));
    expect(out.changes).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: true },
      { path: 'src/a.ts', status: 'modified', staged: false },
    ]);
  });

  it('handles detached HEAD header', () => {
    const out = parsePorcelainStatus(build('## HEAD (no branch)', []));
    expect(out.branch).toBeNull();
  });
});
