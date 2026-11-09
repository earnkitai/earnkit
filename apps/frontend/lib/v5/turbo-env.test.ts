/**
 * Railway starts the app through turbo (`turbo run start`) and hands it PORT, DATABASE_URL and every
 * secret in the environment. Turbo 2 runs tasks in strict env mode by default, which strips all of
 * them: on 2026-11-09 the deployed app bound port 3000 instead of Railway's and the site answered 502.
 * Loose mode passes the environment through, as turbo 1 did.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('turbo passes the environment through to its tasks (envMode loose)', () => {
  const turbo = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'turbo.json'), 'utf8')) as { envMode?: string };
  assert.equal(turbo.envMode, 'loose');
});
