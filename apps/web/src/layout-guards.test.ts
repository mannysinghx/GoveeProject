import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Layout mistakes that a test environment cannot see, because it draws nothing. This one was found by
 * opening every page at 320 px wide in a browser, so these read the source instead.
 */
const SRC = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'test' ? [] : sourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

// Every string in the file, in any quotes. Templates may run over several lines.
const LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
// What a list of Tailwind classes looks like, so a sentence that mentions "grid" is not mistaken for one.
const CLASS_LIKE = /^[A-Za-z0-9:_\-[\]/.%()!,&>*#=]+$/;

/**
 * Finds grids with no base column. `grid sm:grid-cols-2` has an automatic first column, which will not get
 * narrower than its widest child, so one wide child pushes the page sideways on a narrow phone. `grid-cols-1`
 * is `minmax(0, 1fr)`: it will shrink. A grid that sets its columns inline is fine.
 */
export function findGridsWithoutBaseColumn(source: string, file: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(LITERAL)) {
    const text = match[1] ?? match[2] ?? match[3] ?? '';
    const tokens = text.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || !tokens.every((token) => CLASS_LIKE.test(token))) continue;
    if (!tokens.some((token) => token.includes('-') || token.includes(':'))) continue;
    if (!tokens.includes('grid') || tokens.some((token) => token.startsWith('grid-cols-'))) continue;
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 160);
    if (after.includes('gridTemplateColumns')) continue;
    const line = source.slice(0, match.index).split('\n').length;
    found.push(`${file}:${line}: ${text}`);
  }
  return found;
}

describe('narrow phones', () => {
  it('give every grid in the app a base column that can shrink', () => {
    const offenders = sourceFiles(SRC).flatMap((file) => findGridsWithoutBaseColumn(readFileSync(file, 'utf8'), path.relative(SRC, file)));
    expect(offenders).toEqual([]);
  });

  describe('the check itself', () => {
    it('catches a grid with only a wider-screen column, in double quotes, single quotes and templates', () => {
      expect(findGridsWithoutBaseColumn('<div className="grid gap-4 sm:grid-cols-2">', 'a.tsx')).toHaveLength(1);
      expect(findGridsWithoutBaseColumn("const GRID = 'grid gap-3 md:grid-cols-3';", 'a.tsx')).toHaveLength(1);
      expect(findGridsWithoutBaseColumn('<div className={`mt-2 grid gap-2 ${wide ? "xl:grid-cols-3" : ""}`}>', 'a.tsx').length).toBeGreaterThan(0);
    });

    it('catches one written over several lines, and reports the right line', () => {
      const source = ['const a = 1;', '<div className={`', '  grid gap-4', '  sm:grid-cols-2', '`}>'].join('\n');
      const [found] = findGridsWithoutBaseColumn(source, 'a.tsx');
      expect(found).toMatch(/^a\.tsx:2:/);
    });

    it('lets through a grid with a base column, one that sets its columns inline, and a sentence that mentions a grid', () => {
      expect(findGridsWithoutBaseColumn('<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">', 'a.tsx')).toEqual([]);
      expect(findGridsWithoutBaseColumn('<div className="grid gap-1" style={{ gridTemplateColumns: `repeat(3, 1fr)` }}>', 'a.tsx')).toEqual([]);
      expect(findGridsWithoutBaseColumn('<p>Each LED is one box on the grid of lights.</p>', 'a.tsx')).toEqual([]);
    });
  });
});
