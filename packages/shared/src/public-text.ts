/**
 * Words that must never reach a page or an API response: how the service is run and built is
 * not for the people using it. Checked by a test over the web app's source and the server's
 * messages (apps/web/src/public-text.test.ts, apps/server/tests/public-text.test.ts). Server
 * settings names are added from apps/server/src/config/env.ts by those tests.
 */
export const INTERNAL_TEXT_PATTERNS: readonly RegExp[] = [
  /npm (run|ci|install)/i,
  /\bdocs\//,
  /\.md\b/,
  /(^|[\s"'`>(])\.env\b/,
  /server log/i,
  /restart the (app|server)/i,
  /\bRailway\b/i,
  /\bNamecheap\b/i,
  /Private ?Email/i,
  /\bArgon2/i,
  /\bSQLite\b/i,
  /\bFastify\b/i,
  /\bNode\.js\b/,
  /\bGitHub\b/i,
  /server'?s (variables|environment|settings)/i,
];
