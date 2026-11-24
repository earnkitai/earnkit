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
  'DATABASE_URL', 'EARNKIT_AUTH_SECRET', 'EARNKIT_URL', 'GITHUB_TOKEN', 'CRON_SECRET',
  'EARNKIT_PROGRAMS_TOKEN', 'EARNKIT_PROGRAMS_API', 'NODE_ENV', 'EARNKIT_TEST_GUARD', 'TEST_GUARD_LOG',
  'EK_TEST_DB', 'NODE_TEST_CONTEXT',
  // The test template's catalog sync clock (fixtures/test-db-template.mjs); a deploy never sets it.
  'EARNKIT_SYNC_NOW',
  // Local only: where `pnpm screen` writes when no --out is given.
  'EARNKIT_SCREEN_OUT',
  // GitHub sign-in for builders (lib/v6/github-auth.ts).
  'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET',
  // v3.8 E5: X sign-in (lib/v6/x-auth.ts), behind the x_signin flag; the same X app the pre-v5 X sign-in used.
  'X_CLIENT_ID', 'X_CLIENT_SECRET',
  // v6.1.21: people (lib/v6/people.ts); all optional. (The install sign-in is the install_signin flag, v3.8 E4.)
  'EARNKIT_TEST_INSTALLATIONS', 'EARNKIT_OWNER_LOGINS', 'EARNKIT_DOGFOOD_LOGINS',
  // v6.1.16 (S): the build id keying the page cache (app/lib/cached.ts), inlined at build by next.config.ts from
  // Railway's git SHA; a deploy never sets EK_BUILD_ID itself.
  'EK_BUILD_ID', 'RAILWAY_GIT_COMMIT_SHA',
  // v6.1.17 Task 5: the repro pack's local target (scripts/repro/target.ts); a deploy never sets them.
  'REPRO_BASE_URL', 'REPRO_DATABASE_URL', 'REPRO_AUTH_SECRET', 'REPRO_CRON_SECRET', 'REPRO_ALLOW_REMOTE', 'REPRO_SCRIPT',
  // Task 17 (v6.1.16): the boot check runs on the Node runtime only.
  'NEXT_RUNTIME',
  // v3.8 first ship: the feature flags (lib/v5/flags.ts), a comma list; unset turns every flag off.
  'EARNKIT_FLAGS',
]);
const REMOVED_DEPS = ['@anthropic-ai/sdk', '@huggingface/transformers', 'aws4fetch', 'fflate', 'ox', 'viem'];

// Every directory under app/ that may exist (route segments and the folders the pages share).
const APP_DIRS = new Set([
  'components', 'components/common', 'components/landing', 'components/sections', 'components/site', 'components/ui',
  'fonts', 'lib', 'docs', 'programs', 'programs/[id]', 'terms', 'llms.txt', 'mcp',
  'install', 'install/consent', 'oauth', 'oauth/authorize', 'oauth/register', 'oauth/token',
  '.well-known', '.well-known/oauth-authorization-server', '.well-known/oauth-protected-resource',
  '.well-known/oauth-protected-resource/[[...path]]',
  'api', 'api/programs', 'api/programs/write', 'api/programs/writes', 'api/programs/applications', 'api/programs/revert', 'api/programs/reviewers',
  // v3.8 E7r: the owner's digest as a read (programs bearer).
  'api/programs/digest',
  'api/stats', 'api/cron',
  // v6.1.17 Task 4: the header's signed-in check, and the page a guide goes to when its ids cannot be read.
  'api/me', 'api/me/signed-in', 'guide-unavailable',
  'link', 'link/[code]', 'link/[code]/confirm', 'auth', 'auth/github', 'auth/github/callback', 'auth/x',
  // v3.8 E5: X's callback, at the URI the X app has registered since the pre-v5 X sign-in.
  'x', 'x/callback',
  'me', 'me/edit', 'me/approve', 'me/policy', 'me/delete', 'me/signout', 'me/unlink', 'me/link', 'me/sent',
  // v3.8 E12: the onboarding form, its post, and the privacy page.
  'me/start', 'me/consent', 'privacy',
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
