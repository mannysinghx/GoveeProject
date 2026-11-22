import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERNAL_TEXT_PATTERNS } from '../../../packages/shared/src/public-text';

/*
 * Everything in the web app ships to every visitor, signed in or not, owner-only text
 * included. None of it may name a server setting, a command, a docs path or the tools behind
 * the service. Comments are removed before checking; they do not ship.
 */
const SRC = path.dirname(new URL(import.meta.url).pathname);
const ENV_FILE = path.resolve(SRC, '../../server/src/config/env.ts');

function serverSettingNames(): string[] {
  const names = [...readFileSync(ENV_FILE, 'utf8').matchAll(/^\s+([A-Z][A-Z0-9]*_[A-Z0-9_]+):/gm)].map((m) => m[1]!);
  // AI keys are read outside the schema.
  return [...new Set([...names, 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GLM_API_KEY', 'AI_ENABLED', 'SETUP_TOKEN'])];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'test' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('text the web app ships', () => {
  const files = sourceFiles(SRC).map((file) => ({ file: path.relative(SRC, file), code: withoutComments(readFileSync(file, 'utf8')) }));

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(serverSettingNames()).toEqual(expect.arrayContaining(['GOVEE_API_KEY', 'CREDENTIAL_KEYS', 'SMTP_HOST']));
  });

  it('names no server setting', () => {
    const found = files.flatMap(({ file, code }) =>
      serverSettingNames().filter((name) => new RegExp(`\\b${name}\\b`).test(code)).map((name) => `${file}: ${name}`),
    );
    expect(found).toEqual([]);
  });

  it('mentions no command, docs path or internal tool', () => {
    const found = files.flatMap(({ file, code }) =>
      INTERNAL_TEXT_PATTERNS.filter((pattern) => pattern.test(code)).map((pattern) => `${file}: ${pattern}`),
    );
    expect(found).toEqual([]);
  });
});
