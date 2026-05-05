// Extract one or more version sections from a "Keep a Changelog"-style
// markdown body. Sections start with `## [X.Y.Z]` (date suffix optional).
// The leading `# Changelog` preamble is dropped.

export interface ChangelogSection {
  version: string;
  body: string;
}

const HEADER_RE = /^## \[(\d+\.\d+\.\d+(?:-[^\]]+)?)\][^\n]*$/m;

export function parseChangelog(markdown: string): ChangelogSection[] {
  // Split on the section header line. The first chunk is the file
  // preamble (`# Changelog`, intro paragraph) which we drop.
  const chunks = markdown.split(/(?=^## \[\d+\.\d+\.\d+(?:-[^\]]+)?\])/m);
  const out: ChangelogSection[] = [];
  for (const chunk of chunks) {
    const headerMatch = HEADER_RE.exec(chunk);
    if (!headerMatch) continue;
    const version = headerMatch[1]!;
    const body = chunk.slice(chunk.indexOf('\n') + 1).trim();
    out.push({ version, body });
  }
  return out;
}

/** Compares two semver strings (e.g. 0.6.0 > 0.5.2). Pre-release suffixes
 *  are ignored — they don't appear in shipped CHANGELOG entries. */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

/** All sections strictly newer than `from` and at most `to`. Used to show
 *  every release the user crossed in a single multi-version upgrade. */
export function sectionsBetween(
  markdown: string,
  from: string,
  to: string,
): ChangelogSection[] {
  return parseChangelog(markdown).filter(
    (s) => isNewerVersion(s.version, from) && !isNewerVersion(s.version, to),
  );
}
