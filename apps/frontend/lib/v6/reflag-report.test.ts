/**
 * v3.8: the deploy's reflag dry run (`people-backfill.mts --reflag-report`, run by `pnpm predeploy`): counts and public
 * handles only, read only (nothing written), and it never fails the deploy.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { upsertBuilder } from './builders';
import { reflagReport, run } from './people-backfill';

after(() => sql().end());

const FRONTEND = join(import.meta.dirname, '..', '..');
const NOW = new Date('2026-11-24T00:00:00Z');
const checksum = async () => {
  const [r] = await sql()<{ p: string; i: string; b: string }[]>`SELECT
    (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM people t) AS p,
    (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM installations t) AS i,
    (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM builders t) AS b`;
  return r;
};
const install = async (client: string, builder: number | null, person: number | null = null) =>
  (await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, builder_id, person_id) VALUES (${'rr-' + Math.random()}, ${client}, ${builder}, ${person}) RETURNING id`)[0].id;

test('the report prints counts and handles only, and writes nothing', async () => {
  const db = sql();
  for (const [login, gid] of [['rr-owner', 9901], ['rr-dog', 9902], ['rr-plain', 9903]] as const) {
    const b = await upsertBuilder({ github_id: gid, login, name: 'Secret Person', avatar_url: null }, NOW);
    await db`UPDATE builders SET record = ${db.json({ person: { name: 'Secret Person', email: `${login}@example.com`, wallet: '0xabc0000000000000000000000000000000000001' } })} WHERE id = ${b.id}`;
    await install('Claude Code', b.id);
  }
  await run(['--apply'], () => {}, {});
  await db`UPDATE people SET test_reason = 'test', test_reason_source = 'EARNKIT_TEST_INSTALLATIONS' WHERE builder_id = (SELECT id FROM builders WHERE login = 'rr-dog')`;
  // A person with no builder (a claimed GitHub login) whose installation's client name is a persona lane.
  const [p] = await db<{ id: number }[]>`INSERT INTO people (github_login, x_name) VALUES ('rr-claimed', 'Secret Person') RETURNING id`;
  await install('journey-runner-9', null, p.id);

  const before = await checksum();
  const lines: string[] = [];
  const env = { EARNKIT_OWNER_LOGINS: 'rr-owner', EARNKIT_DOGFOOD_LOGINS: 'rr-dog', DATABASE_URL: 'postgres://should-not-print' };
  assert.deepEqual(await reflagReport((s) => lines.push(s), env), { scanned: 4, changed: 3 });
  assert.deepEqual(await checksum(), before, 'a dry run writes nothing');
  assert.deepEqual(lines, [
    '[reflag dry-run] read only, rolled back; env lists: EARNKIT_OWNER_LOGINS=1 EARNKIT_DOGFOOD_LOGINS=1 EARNKIT_TEST_INSTALLATIONS=0',
    '[reflag dry-run] people scanned: 4',
    '[reflag dry-run] test_reason would change: 3',
    '[reflag dry-run]   test_reason null -> owner: 1',
    '[reflag dry-run]   test_reason null -> persona: 1',
    '[reflag dry-run]   test_reason test -> dogfood: 1',
    '[reflag dry-run] owner would change: 1',
    '[reflag dry-run]   owner false -> true: 1',
    '[reflag dry-run] verified would change: 0 (reflag never sets verified_by or verified_at)',
    '[reflag dry-run]   rr-owner: test_reason null -> owner, owner false -> true',
    '[reflag dry-run]   rr-dog: test_reason test -> dogfood',
    '[reflag dry-run]   rr-claimed: test_reason null -> persona',
    '[reflag dry-run] done',
  ]);
  const all = lines.join('\n');
  assert.doesNotMatch(all, /@|example\.com|Secret|0xabc|postgres|token/);
});

test('the handle list stops at 200 lines', async () => {
  const db = sql();
  const ids = await db<{ id: number }[]>`INSERT INTO people (github_login) SELECT 'cap-' || g FROM generate_series(1, 205) g RETURNING id`;
  for (const { id } of ids) await install('journey-runner-1', null, id);
  const lines: string[] = [];
  await reflagReport((s) => lines.push(s), {});
  assert.equal(lines.filter((l) => /^\[reflag dry-run\] {3}(cap-|rr-)/.test(l)).length, 200);
  assert.ok(lines.includes('[reflag dry-run]   ... 6 more not listed (cap 200)'), lines.slice(-3).join('\n'));
});

test('a forced error logs one line and exits 0 (the deploy never fails on it)', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(FRONTEND, 'scripts', 'people-backfill.mts'), '--reflag-report'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres@127.0.0.1:1/none' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\[reflag dry-run\] skipped: [A-Za-z_]+\n$/);
  assert.doesNotMatch(r.stdout + r.stderr, /127\.0\.0\.1|postgres:/);
});

test('predeploy runs the report last, after programs:sync, and never fails on it', () => {
  const pkg = JSON.parse(readFileSync(join(FRONTEND, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.predeploy, 'pnpm db:migrate && pnpm programs:sync && (pnpm people:reflag-report || true)');
  assert.match(pkg.scripts['people:reflag-report'], /people-backfill\.mts --reflag-report$/);
});
