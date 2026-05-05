import { describe, expect, it } from 'vitest';
import { isNewerVersion, parseChangelog, sectionsBetween } from './changelog.js';

const SAMPLE = `# Changelog

Some intro text that should be dropped.

## [0.6.0] — 2026-05-08

Big release.

### Added
- TLS verification toggle (#80).
- Restore unsaved tabs on restart (#71).

## [0.5.2] — 2026-05-05

Patch release.

### Added
- Cmd+R parallel send.

### Fixed
- Headers Overflow Error.

## [0.5.1] — 2026-04-29

Watched headers.
`;

describe('parseChangelog', () => {
  it('returns one entry per ## [version] section', () => {
    const sections = parseChangelog(SAMPLE);
    expect(sections.map((s) => s.version)).toEqual(['0.6.0', '0.5.2', '0.5.1']);
  });

  it('captures the full body of each section', () => {
    const [first] = parseChangelog(SAMPLE);
    expect(first!.body).toMatch(/Big release/);
    expect(first!.body).toMatch(/TLS verification/);
    expect(first!.body).not.toMatch(/0\.5\.2/);
  });

  it('returns [] for input with no version sections', () => {
    expect(parseChangelog('# Changelog\n\nNothing here yet.')).toEqual([]);
  });
});

describe('isNewerVersion', () => {
  it('compares major.minor.patch correctly', () => {
    expect(isNewerVersion('0.6.0', '0.5.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.5.2', '0.5.2')).toBe(false);
    expect(isNewerVersion('0.5.1', '0.5.2')).toBe(false);
  });

  it('strips pre-release suffixes for comparison', () => {
    expect(isNewerVersion('0.6.0-rc1', '0.5.9')).toBe(true);
  });
});

describe('sectionsBetween', () => {
  it('returns sections strictly above `from` and at most `to`', () => {
    expect(sectionsBetween(SAMPLE, '0.5.0', '0.6.0').map((s) => s.version)).toEqual([
      '0.6.0',
      '0.5.2',
      '0.5.1',
    ]);
  });

  it('excludes the `from` version itself', () => {
    expect(sectionsBetween(SAMPLE, '0.5.1', '0.6.0').map((s) => s.version)).toEqual([
      '0.6.0',
      '0.5.2',
    ]);
  });

  it('does not include releases above `to`', () => {
    expect(sectionsBetween(SAMPLE, '0.5.0', '0.5.2').map((s) => s.version)).toEqual([
      '0.5.2',
      '0.5.1',
    ]);
  });

  it('returns [] when from === to', () => {
    expect(sectionsBetween(SAMPLE, '0.6.0', '0.6.0')).toEqual([]);
  });
});
