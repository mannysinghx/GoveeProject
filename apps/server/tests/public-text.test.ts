import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERNAL_TEXT_PATTERNS } from '../../../packages/shared/src/public-text.js';

/*
 * Messages the server sends to people: error messages, key status notes, connection advice
 * and Govee failure messages. None may name a server setting, a command, a docs path or the
 * tools behind the service. Log lines and startup errors are for the owner's log and are not
 * checked here.
 */
const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');

const settingNames = (): string[] => {
  const env = readFileSync(path.join(SRC, 'config/env.ts'), 'utf8');
  const names = [...env.matchAll(/^\s+([A-Z][A-Z0-9]*_[A-Z0-9_]+):/gm)].map((m) => m[1]!);
  return [...new Set([...names, 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GLM_API_KEY', 'AI_ENABLED', 'SETUP_TOKEN'])];
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const STRING = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`(?:[^\`\\]|\\.)*\`)`;
const SENT = [
  new RegExp(String.raw`new AppError\(\s*\d+,\s*'[a-z_]+',\s*(${STRING})`, 'g'),
  new RegExp(String.raw`(?:unprocessable|notFound|conflict|badRequest)\(\s*'[a-z_]+',\s*(${STRING})`, 'g'),
  new RegExp(String.raw`errorBody\(\s*request,\s*'[a-z_]+',\s*(${STRING})`, 'g'),
  new RegExp(String.raw`new TransportError\(\s*'[a-z_]+',\s*(${STRING})`, 'g'),
  new RegExp(String.raw`\b(?:note|message|explanation|title):\s*(?:[^,\n]*\?\s*)?(${STRING})`, 'g'),
];

function sentMessages(): { file: string; text: string }[] {
  return files(SRC)
    .filter((file) => !file.includes(`${path.sep}cli${path.sep}`) && !file.endsWith(`config${path.sep}env.ts`))
    .flatMap((file) => {
      const code = readFileSync(file, 'utf8');
      const steps = [...code.matchAll(/steps:\s*\[([\s\S]*?)\]/g)].flatMap((m) => [...m[1]!.matchAll(new RegExp(STRING, 'g'))].map((s) => s[0]));
      const found = SENT.flatMap((re) => [...code.matchAll(re)].map((m) => m[1]!));
      return [...found, ...steps].map((text) => ({ file: path.relative(SRC, file), text }));
    });
}

describe('messages the server sends to people', () => {
  const messages = sentMessages();

  it('finds them', () => {
    expect(messages.length).toBeGreaterThan(100);
    expect(messages.some((m) => m.text.includes('Keys cannot be added right now'))).toBe(true);
  });

  it('name no server setting', () => {
    const names = settingNames();
    const found = messages.filter((m) => names.some((name) => new RegExp(`\\b${name}\\b`).test(m.text)));
    expect(found).toEqual([]);
  });

  it('mention no command, docs path, internal tool or this server', () => {
    const found = messages.filter((m) => INTERNAL_TEXT_PATTERNS.some((p) => p.test(m.text)) || /this server|the server|\bendpoint\b/i.test(m.text));
    expect(found).toEqual([]);
  });
});
