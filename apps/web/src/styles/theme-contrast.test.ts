import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every colour pairing the interface relies on, in both themes, checked against WCAG 2.2 contrast
 * from the real stylesheet. A palette edit that makes text or a control hard to see fails here.
 */

const css = readFileSync(join(import.meta.dirname, 'index.css'), 'utf8');

function tokens(selector: RegExp): Record<string, string> {
  const block = selector.exec(css)?.[1];
  if (!block) throw new Error(`No block for ${selector}`);
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [name as string, (value as string).toLowerCase()]));
}

const NIGHT = tokens(/:root \{([^}]*)\}/);
const DAY = { ...NIGHT, ...tokens(/:root\[data-theme='light'\] \{([^}]*)\}/) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { Night: NIGHT, Day: DAY } as const;
const SURFACES = ['canvas', 'surface', 'raised', 'inset'] as const;
const TEXT = ['fg', 'fg-2', 'fg-3', 'fg-4', 'accent-text'] as const;
const STATUS = ['good', 'warn', 'bad', 'info'] as const;

describe.each(Object.entries(THEMES))('%s theme contrast', (_name, t) => {
  const token = (name: string): string => {
    const value = t[name];
    if (!value) throw new Error(`Missing token --${name}`);
    return value;
  };

  it.each(SURFACES.flatMap((surface) => TEXT.map((text) => [text, surface] as const)))('%s text reads on %s (4.5:1)', (text, surface) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('puts readable text on the warm primary button, across its whole gradient', () => {
    for (const fill of ['accent', 'accent-hi', 'accent-lo']) {
      expect(contrast(token('on-accent'), token(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('reads accent text on its wash', () => {
    expect(contrast(token('accent-text'), token('accent-wash'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STATUS)('reads %s text on its wash, on cards and on the page', (status) => {
    for (const background of [token(`${status}-wash`), token('surface'), token('canvas')]) {
      expect(contrast(token(status), background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps focus rings, sliders and selected states clear of every surface (3:1)', () => {
    for (const surface of SURFACES) {
      expect(contrast(token('accent-ui'), token(surface))).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws the edge of a text field at 3:1 against the card, the field and the page (WCAG 1.4.11)', () => {
    for (const surface of SURFACES) {
      expect(contrast(token('field-line'), token(surface))).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws borders that show against the page without shouting', () => {
    expect(contrast(token('line-strong'), token('canvas'))).toBeGreaterThanOrEqual(1.4);
    expect(contrast(token('line-strong'), token('surface'))).toBeGreaterThanOrEqual(1.4);
  });
});

describe('the more-contrast preference', () => {
  it('applies in Day as well as Night: a bare :root is less specific than the Day block and would lose', () => {
    expect(css).toMatch(/@media \(prefers-contrast: more\) \{\s*(?:\/\*[^*]*\*\/\s*)?:root,\s*:root\[data-theme='light'\] \{/);
  });
});

describe('forced colours', () => {
  it('marks selected and current states with an outline that is weaker than the focus outline, so a focused selected control still shows focus', () => {
    expect(css).toMatch(/:where\(\[aria-pressed='true'\][^)]*\[aria-current='page'\][^)]*\)\s*\{\s*outline: 2px solid Highlight/);
  });

  it('keeps colour swatches and beads as the colours they are', () => {
    expect(css).toMatch(/\.spectrum > span,\s*\[style\*='background-color'\] \{\s*forced-color-adjust: none/);
  });
});

describe('the two themes', () => {
  it('define the same set of colours, so neither is missing one the other has', () => {
    const night = Object.keys(NIGHT).filter((name) => !name.startsWith('elev') && name !== 'scrim' && name !== 'glow-strength');
    const day = tokens(/:root\[data-theme='light'\] \{([^}]*)\}/);
    for (const name of night) expect(day, `--${name} is missing from Day`).toHaveProperty(name);
  });
});
