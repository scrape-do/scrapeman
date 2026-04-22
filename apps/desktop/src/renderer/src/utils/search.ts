// Fuzzy scorer shared by CommandPalette command filtering and request search.
// Returns null if query characters cannot be found in order inside text.
// Higher score = better match. Exact prefix > word prefix > substring > subsequence.
export function score(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const wordStart = ` ${t}`.indexOf(` ${q}`);
  if (wordStart >= 0) return 800 - wordStart;

  let ti = 0;
  let firstIdx = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    if (firstIdx < 0) firstIdx = found;
    ti = found + 1;
  }
  if (t.includes(q)) return 500 - t.indexOf(q);
  return 200 - firstIdx;
}
