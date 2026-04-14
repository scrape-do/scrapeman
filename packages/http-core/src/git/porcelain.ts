// Pure parser for `git status --porcelain=v1 -b -z` output. Kept here (and
// not in the desktop main process) so it can be imported and unit-tested
// without pulling electron into the test runner.

export type GitFileChangeStatus =
  | 'untracked'
  | 'modified'
  | 'deleted'
  | 'added'
  | 'renamed';

export interface GitFileChange {
  path: string;
  status: GitFileChangeStatus;
  staged: boolean;
  // Only set for renames.
  originalPath?: string;
}

export interface ParsedGitStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
}

function mapCode(code: string): GitFileChangeStatus | null {
  switch (code) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'added';
    case 'U':
      return 'modified';
    case 'T':
      return 'modified';
    case '?':
      return 'untracked';
    default:
      return null;
  }
}

// Input is the raw NUL-delimited output of
// `git status --porcelain=v1 -b -z`. The header lines (before the first
// entry) use "\n" and the entries themselves are NUL-separated. Renames
// consume an extra NUL-delimited field for the original path.
export function parsePorcelainStatus(raw: string): ParsedGitStatus {
  const result: ParsedGitStatus = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changes: [],
  };

  if (!raw) return result;

  // Split off header (## ...) which appears before the first NUL.
  const firstNul = raw.indexOf('\0');
  const headerBlock = firstNul < 0 ? raw : raw.slice(0, firstNul);
  const body = firstNul < 0 ? '' : raw.slice(firstNul + 1);

  // The branch header may be followed (still before the first NUL) by
  // a "\n" terminator when there are no entries yet.
  const headerLine = headerBlock.split('\n').find((l) => l.startsWith('## '));
  if (headerLine) {
    const rest = headerLine.slice(3);
    // Shapes:
    //   "## HEAD (no branch)"
    //   "## main"
    //   "## main...origin/main"
    //   "## main...origin/main [ahead 1]"
    //   "## main...origin/main [ahead 1, behind 2]"
    //   "## No commits yet on main"
    if (rest.startsWith('No commits yet on ')) {
      result.branch = rest.slice('No commits yet on '.length).trim();
    } else if (rest.startsWith('HEAD (no branch)')) {
      result.branch = null;
    } else {
      const bracketIdx = rest.indexOf(' [');
      const tracking = bracketIdx >= 0 ? rest.slice(0, bracketIdx) : rest;
      const sep = tracking.indexOf('...');
      if (sep >= 0) {
        result.branch = tracking.slice(0, sep);
        result.upstream = tracking.slice(sep + 3);
      } else {
        result.branch = tracking;
      }
      if (bracketIdx >= 0) {
        const inside = rest.slice(bracketIdx + 2, rest.length - 1);
        for (const part of inside.split(', ')) {
          const [name, value] = part.split(' ');
          const n = Number(value);
          if (name === 'ahead' && Number.isFinite(n)) result.ahead = n;
          if (name === 'behind' && Number.isFinite(n)) result.behind = n;
        }
      }
    }
  }

  if (!body) return result;

  // Walk NUL-separated entries. Rename entries consume an extra field.
  const fields = body.split('\0');
  // `split` leaves a trailing empty field after the final NUL — drop it.
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();

  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!;
    if (entry.length < 3) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    const x = xy[0]!;
    const y = xy[1]!;

    if (x === '?' && y === '?') {
      result.changes.push({ path, status: 'untracked', staged: false });
      continue;
    }

    // Renames: original path follows in the next field.
    if (x === 'R' || y === 'R') {
      const originalPath = fields[i + 1] ?? '';
      i += 1;
      if (x === 'R') {
        result.changes.push({
          path,
          status: 'renamed',
          staged: true,
          originalPath,
        });
      }
      if (y === 'R') {
        result.changes.push({
          path,
          status: 'renamed',
          staged: false,
          originalPath,
        });
      }
      continue;
    }

    // Staged change (index column).
    if (x !== ' ' && x !== '?') {
      const status = mapCode(x);
      if (status) result.changes.push({ path, status, staged: true });
    }
    // Unstaged change (worktree column).
    if (y !== ' ' && y !== '?') {
      const status = mapCode(y);
      if (status) result.changes.push({ path, status, staged: false });
    }
  }

  return result;
}
