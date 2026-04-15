// Thin wrapper around the git binary. All git calls use execFile with
// array args so nothing is ever shell-parsed — safe against paths with
// spaces or shell metacharacters. Parsing of status output lives in
// @scrapeman/http-core (pure function, independently tested).

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parsePorcelainStatus } from '@scrapeman/http-core';
import type {
  GitCommit,
  GitFileChange,
  GitStatus,
} from '@scrapeman/shared-types';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

async function run(
  cwd: string,
  args: string[],
  opts: { maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
      // Inherit env; rely on the user's credential helper for push/pull.
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    const message = stderr.trim() || e.message || 'git command failed';
    const code = typeof e.code === 'number' ? e.code : null;
    throw new GitError(message, stderr, code);
  }
}

async function isInsideWorkTree(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      { cwd },
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function gitIsRepo(workspacePath: string): Promise<boolean> {
  return isInsideWorkTree(workspacePath);
}

// Null byte separates fields, record separator (0x1e) separates commits.
// This keeps the parser safe against commit subjects that contain newlines.
const LOG_FORMAT = '%H%x00%h%x00%s%x00%an%x00%ae%x00%at%x1e';

export async function gitLog(
  workspacePath: string,
  limit = 50,
): Promise<GitCommit[]> {
  const isRepo = await isInsideWorkTree(workspacePath);
  if (!isRepo) return [];
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  try {
    const { stdout } = await run(workspacePath, [
      'log',
      `--max-count=${safeLimit}`,
      `--pretty=format:${LOG_FORMAT}`,
    ]);
    const commits: GitCommit[] = [];
    for (const raw of stdout.split('\x1e')) {
      const record = raw.replace(/^\n/, '');
      if (!record) continue;
      const parts = record.split('\x00');
      if (parts.length < 6) continue;
      const [hash, shortHash, subject, authorName, authorEmail, ts] = parts as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      commits.push({
        hash,
        shortHash,
        subject,
        authorName,
        authorEmail,
        date: Number(ts) || 0,
      });
    }
    return commits;
  } catch (err) {
    // A freshly initialised repo with zero commits fails `git log` with
    // "does not have any commits yet" — treat that as an empty history.
    if (err instanceof GitError && /does not have any commits/i.test(err.stderr)) {
      return [];
    }
    throw err;
  }
}

export async function gitStatus(workspacePath: string): Promise<GitStatus> {
  const isRepo = await isInsideWorkTree(workspacePath);
  if (!isRepo) {
    return { isRepo: false, branch: null, ahead: 0, behind: 0, changes: [] };
  }
  const { stdout } = await run(workspacePath, [
    'status',
    '--porcelain=v1',
    '-b',
    '-z',
    '--untracked-files=all',
  ]);
  const parsed = parsePorcelainStatus(stdout);
  const changes: GitFileChange[] = parsed.changes.map((c) => ({
    path: c.path,
    status: c.status,
    staged: c.staged,
    ...(c.originalPath ? { originalPath: c.originalPath } : {}),
  }));
  return {
    isRepo: true,
    branch: parsed.branch,
    ahead: parsed.ahead,
    behind: parsed.behind,
    changes,
  };
}

export async function gitDiff(
  workspacePath: string,
  relPath: string,
  options: { staged: boolean },
): Promise<string> {
  const args = ['diff', '--no-color'];
  if (options.staged) args.push('--cached');
  args.push('--', relPath);
  const { stdout } = await run(workspacePath, args);
  if (stdout.trim().length > 0) return stdout;

  // Untracked files don't appear in `git diff` at all — synthesise a
  // pseudo-diff so the UI can still render a useful preview.
  if (!options.staged) {
    try {
      const content = await fsp.readFile(join(workspacePath, relPath), 'utf8');
      const lines = content.split('\n');
      const header = `diff --git a/${relPath} b/${relPath}\nnew file\n--- /dev/null\n+++ b/${relPath}\n`;
      return header + lines.map((l) => `+${l}`).join('\n');
    } catch {
      return '';
    }
  }
  return '';
}

export async function gitStage(
  workspacePath: string,
  relPath: string,
): Promise<void> {
  await run(workspacePath, ['add', '--', relPath]);
}

export async function gitUnstage(
  workspacePath: string,
  relPath: string,
): Promise<void> {
  // `git restore --staged` is the modern equivalent of `reset HEAD --`
  // and works on repos without any commits (where HEAD does not resolve).
  try {
    await run(workspacePath, ['restore', '--staged', '--', relPath]);
  } catch {
    // Fallback for pre-2.23 git.
    await run(workspacePath, ['reset', 'HEAD', '--', relPath]);
  }
}

export async function gitStageAll(workspacePath: string): Promise<void> {
  await run(workspacePath, ['add', '-A']);
}

export async function gitUnstageAll(workspacePath: string): Promise<void> {
  await run(workspacePath, ['reset']);
}

export async function gitDiscard(
  workspacePath: string,
  relPath: string,
): Promise<void> {
  // Figure out whether this path is tracked; if not, delete it from disk.
  try {
    await run(workspacePath, [
      'ls-files',
      '--error-unmatch',
      '--',
      relPath,
    ]);
    await run(workspacePath, ['checkout', 'HEAD', '--', relPath]);
  } catch {
    // Untracked — remove from worktree.
    try {
      await fsp.rm(join(workspacePath, relPath), { force: true });
    } catch (err) {
      throw new GitError(
        `Failed to remove ${relPath}`,
        err instanceof Error ? err.message : String(err),
        null,
      );
    }
  }
}

export async function gitCommit(
  workspacePath: string,
  message: string,
): Promise<void> {
  if (!message.trim()) {
    throw new GitError('Commit message is required', '', null);
  }
  await run(workspacePath, ['commit', '-m', message]);
}

// Local-only hide feature (issue #42): mark a request as ignored via
// .git/info/exclude so it stays on disk for the current user but is never
// synced via .gitignore (which itself would be tracked). Entries live in a
// marker block so we can list and unhide them cleanly without clobbering
// anything the user has in the rest of the file.
const EXCLUDE_BEGIN = '# >>> scrapeman:hidden (managed — do not edit)';
const EXCLUDE_END = '# <<< scrapeman:hidden';

async function gitDir(workspacePath: string): Promise<string> {
  const { stdout } = await run(workspacePath, ['rev-parse', '--git-dir']);
  const dir = stdout.trim();
  return dir.startsWith('/') ? dir : join(workspacePath, dir);
}

async function readExcludeFile(
  workspacePath: string,
): Promise<{ path: string; lines: string[] }> {
  const path = join(await gitDir(workspacePath), 'info', 'exclude');
  try {
    const text = await fsp.readFile(path, 'utf8');
    return { path, lines: text.split('\n') };
  } catch {
    return { path, lines: [] };
  }
}

function parseHiddenBlock(lines: string[]): {
  before: string[];
  hidden: string[];
  after: string[];
} {
  const begin = lines.indexOf(EXCLUDE_BEGIN);
  if (begin < 0) return { before: lines, hidden: [], after: [] };
  const end = lines.indexOf(EXCLUDE_END, begin + 1);
  if (end < 0) return { before: lines, hidden: [], after: [] };
  const hidden: string[] = [];
  for (let i = begin + 1; i < end; i += 1) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    hidden.push(line.startsWith('/') ? line.slice(1) : line);
  }
  return {
    before: lines.slice(0, begin),
    hidden,
    after: lines.slice(end + 1),
  };
}

function serializeExcludeFile(
  before: string[],
  hidden: string[],
  after: string[],
): string {
  const pieces: string[] = [];
  if (before.length > 0) pieces.push(before.join('\n').replace(/\n+$/, ''));
  if (hidden.length > 0) {
    const block = [EXCLUDE_BEGIN, ...hidden.map((p) => `/${p}`), EXCLUDE_END];
    pieces.push(block.join('\n'));
  }
  if (after.length > 0) pieces.push(after.join('\n').replace(/^\n+/, ''));
  return pieces.filter((p) => p.length > 0).join('\n\n') + '\n';
}

// "Whatever appears in git is unhidden": if any entry in our managed block
// is currently tracked by git (e.g. the user ran `git add` manually, or we
// failed to `rm --cached` earlier), drop it from the exclude file and
// report it as not-hidden. This makes hide/unhide self-consistent with the
// index — the only source of truth that matters for sync.
export async function gitLocalHiddenList(
  workspacePath: string,
): Promise<string[]> {
  if (!(await isInsideWorkTree(workspacePath))) return [];
  const { path, lines } = await readExcludeFile(workspacePath);
  const { before, hidden, after } = parseHiddenBlock(lines);
  if (hidden.length === 0) return [];

  const tracked = new Set<string>();
  try {
    const { stdout } = await run(workspacePath, [
      'ls-files',
      '-z',
      '--',
      ...hidden,
    ]);
    for (const entry of stdout.split('\0')) {
      if (entry) tracked.add(entry);
    }
  } catch {
    // ls-files shouldn't fail, but if it does treat nothing as tracked.
  }

  const stillHidden = hidden.filter((p) => !tracked.has(p));
  if (stillHidden.length !== hidden.length) {
    await fsp.writeFile(
      path,
      serializeExcludeFile(before, stillHidden, after),
      'utf8',
    );
  }
  return stillHidden;
}

export async function gitLocalHide(
  workspacePath: string,
  relPath: string,
): Promise<void> {
  if (!(await isInsideWorkTree(workspacePath))) {
    throw new GitError(
      'Hiding requires a git repository. Run `git init` in this workspace first.',
      '',
      null,
    );
  }
  const { path, lines } = await readExcludeFile(workspacePath);
  const { before, hidden, after } = parseHiddenBlock(lines);
  if (!hidden.includes(relPath)) hidden.push(relPath);
  await fsp.mkdir(dirname(path), { recursive: true });
  await fsp.writeFile(path, serializeExcludeFile(before, hidden, after), 'utf8');

  // If the file is already tracked, remove it from the index so the hide
  // actually takes effect. `--cached` leaves the working-tree file alone.
  try {
    await run(workspacePath, ['rm', '--cached', '--quiet', '--', relPath]);
  } catch {
    // Not tracked — nothing to do.
  }
}

export async function gitLocalUnhide(
  workspacePath: string,
  relPath: string,
): Promise<void> {
  if (!(await isInsideWorkTree(workspacePath))) return;
  const { path, lines } = await readExcludeFile(workspacePath);
  const { before, hidden, after } = parseHiddenBlock(lines);
  const next = hidden.filter((p) => p !== relPath);
  if (next.length === hidden.length) return;
  await fsp.writeFile(path, serializeExcludeFile(before, next, after), 'utf8');
}

export async function gitPush(
  workspacePath: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { stdout, stderr } = await run(workspacePath, ['push']);
    return { ok: true, message: (stderr || stdout).trim() };
  } catch (err) {
    const message =
      err instanceof GitError ? err.message : (err as Error).message;
    return { ok: false, message };
  }
}

export async function gitPull(
  workspacePath: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { stdout, stderr } = await run(workspacePath, [
      'pull',
      '--ff-only',
    ]);
    return { ok: true, message: (stderr || stdout).trim() };
  } catch (err) {
    const message =
      err instanceof GitError ? err.message : (err as Error).message;
    return { ok: false, message };
  }
}
