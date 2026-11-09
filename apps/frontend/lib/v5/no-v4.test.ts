/**
 * The v4 code is gone: no v4 library directory, no route outside the v5 surface, none of the six removed
 * dependencies, and no environment variable read outside the v5 list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FRONTEND = join(import.meta.dirname, '..', '..');
const APP = join(FRONTEND, 'app');

const ENV_ALLOWED = new Set([
  'DATABASE_URL', 'EARNKIT_AUTH_SECRET', 'EARNKIT_URL', 'GITHUB_TOKEN', 'RESEND_API_KEY', 'CRON_SECRET',
  'EARNKIT_PROGRAMS_TOKEN', 'EARNKIT_PROGRAMS_API', 'NODE_ENV', 'EARNKIT_TEST_GUARD', 'TEST_GUARD_LOG',
  'EK_TEST_DB', 'NODE_TEST_CONTEXT',
  // Local only: where `pnpm screen` writes when no --out is given.
  'EARNKIT_SCREEN_OUT',
  // GitHub sign-in for builders (lib/v6/github-auth.ts).
  'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET',
]);
const REMOVED_DEPS = ['@anthropic-ai/sdk', '@huggingface/transformers', 'aws4fetch', 'fflate', 'ox', 'viem'];

// Every directory under app/ that may exist (route segments and the folders the pages share).
const APP_DIRS = new Set([
  'components', 'components/common', 'components/landing', 'components/sections', 'components/site', 'components/ui',
  'fonts', 'lib', 'docs', 'programs', 'programs/[id]', 'terms', 'llms.txt', 'mcp',
  'install', 'oauth', 'oauth/authorize', 'oauth/register', 'oauth/token',
  '.well-known', '.well-known/oauth-authorization-server', '.well-known/oauth-protected-resource',
  '.well-known/oauth-protected-resource/[[...path]]',
  'api', 'api/programs', 'api/programs/write', 'api/programs/writes', 'api/programs/approve', 'api/programs/revert', 'api/programs/reviewers',
  'api/stats', 'api/cron',
  'link', 'link/[code]', 'auth', 'auth/github', 'auth/github/callback',
  'me', 'me/edit', 'me/approve', 'me/policy', 'me/delete', 'me/signout', 'me/unlink', 'me/link',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(p + '/');
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

test('the v4 library directory does not exist', () => {
  assert.equal(existsSync(join(FRONTEND, 'lib', 'earnkit')), false);
});

test('app/ has no directory outside the v5 surface', () => {
  const extra = walk(APP)
    .filter((p) => p.endsWith('/'))
    .map((p) => relative(APP, p.slice(0, -1)))
    .filter((d) => !APP_DIRS.has(d));
  assert.deepEqual(extra, []);
});

test('the six v4 dependencies are gone', () => {
  const pkg = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.deepEqual(REMOVED_DEPS.filter((d) => d in deps), []);
});

test('no code reads an environment variable outside the v5 list', () => {
  const READ = /\benv(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"`]([A-Z][A-Z0-9_]*)['"`]\s*\])/g;
  const bad: string[] = [];
  for (const file of walk(FRONTEND)) {
    if (!/\.(ts|tsx|mts|mjs|js)$/.test(file) || file.includes('/fixtures/repos/')) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(READ)) {
      const key = m[1] ?? m[2];
      if (!ENV_ALLOWED.has(key)) bad.push(`${relative(FRONTEND, file)}: ${key}`);
    }
  }
  assert.deepEqual(bad, []);
});
