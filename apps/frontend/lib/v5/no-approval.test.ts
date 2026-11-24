/**
 * v3.8 decision 25: no person approves a program add. The owner approval email, the signed approve link, its confirm
 * page and app/api/programs/approve are deleted; this test fails if any of them returns. (`/me/approve` is the builder
 * approving their own answers, not a program approval, and is not matched.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as programsApi from './programs-api';
import * as programsPending from './programs-pending';

const FRONTEND = join(import.meta.dirname, '..', '..');

/** Every source file under app/ and lib/, tests and fixtures left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'fixtures' || name === 'node_modules' ? [] : sources(p);
    return /\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

/** What an owner approval path is made of. */
const BANNED: [RegExp, string][] = [
  [/programs\/approve/, 'the approve route'],
  [/program-approve/, 'the approve link signature'],
  [/\bapprove(Url|Token|Target|Expiry)\b/, 'the signed approve link'],
  [/\bAPPROVE_(TEXT|TTL_DAYS)\b/, 'the approve confirm page'],
  [/\b(mailPending|pendingMailText|PENDING_SUBJECT)\b/, 'the owner approval email'],
  [/\bowner_emailed\b/, 'the owner approval email'],
  [/program write waits for|waits for the owner|approve it here|Approve this program/i, 'owner approval copy'],
];

test('app/api/programs/approve does not exist', () => {
  assert.equal(existsSync(join(FRONTEND, 'app', 'api', 'programs', 'approve')), false);
});

test('no source file carries an owner approval path', () => {
  const hits = sources(join(FRONTEND, 'app'))
    .concat(sources(join(FRONTEND, 'lib')))
    .flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return BANNED.filter(([re]) => re.test(text)).map(([, what]) => `${relative(FRONTEND, file)}: ${what}`);
    });
  assert.deepEqual(hits, []);
});

test('the write API exports nothing that approves a program', () => {
  const names = [...Object.keys(programsApi), ...Object.keys(programsPending)].filter((n) => /approve/i.test(n));
  assert.deepEqual(names, []);
});
