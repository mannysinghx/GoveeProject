import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Layout mistakes that a test environment cannot see, because it draws nothing. Each one was found
 * on a real 320 px phone, so these read the source instead.
 */
const SRC = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'test' ? [] : sourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

describe('narrow phones', () => {
  it('give every grid a base column that can shrink, so a wide child cannot push the page sideways', () => {
    // A grid with only `sm:grid-cols-2` has an automatic first column, which will not get narrower
    // than its widest child. `grid-cols-1` is `minmax(0, 1fr)`: it will.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const match of line.matchAll(/className="([^"]*)"/g)) {
            const classes = (match[1] ?? '').split(/\s+/);
            if (classes.includes('grid') && !classes.some((name) => name.startsWith('grid-cols-'))) {
              offenders.push(`${path.relative(SRC, file)}:${index + 1}: ${match[1]}`);
            }
          }
        });
    }
    // The one grid that sets its columns inline (the pattern editor's LED boxes) is not a className.
    expect(offenders.filter((line) => !line.includes('PatternEditorPage.tsx:319'))).toEqual([]);
  });
});
