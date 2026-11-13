/** The people backfill (v6.1.20): the dry run writes nothing, --apply writes the plan, a rerun changes nothing. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { upsertBuilder } from './builders';
import { run } from './people-backfill';

after(() => sql().end());

const NOW = new Date('2026-11-13T00:00:00Z');
const counts = async () => {
  const [r] = await sql()<{ people: number; linked: number }[]>`SELECT (SELECT count(*)::int FROM people) AS people, (SELECT count(*)::int FROM installations WHERE person_id IS NOT NULL) AS linked`;
  return r;
};

test('dry run plans and writes nothing; apply writes the plan and is idempotent', async () => {
  const db = sql();
  const ins = async (name: string | null, at: string, extra: Record<string, unknown> = {}) => {
    const [r] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, created_at, last_project_key, last_find_at, builder_id)
      VALUES (${'bf-' + Math.random()}, ${name}, ${at}, ${(extra.key as string) ?? null}, ${(extra.find as string) ?? null}, ${(extra.builder as number) ?? null}) RETURNING id`;
    return r.id;
  };
  const b = await upsertBuilder({ github_id: 777, login: 'linked-one', name: null, avatar_url: null }, NOW);
  const plain = await ins('Claude Code', '2026-10-01T00:00:00Z');
  const repro = await ins('l33-abc-agent', '2026-11-01T00:00:00Z');
  const linked = await ins('Cursor', '2026-11-02T00:00:00Z', { builder: b.id });
  const claimed = await ins('Codex', '2026-11-03T00:00:00Z', { key: 'https://github.com/acme/widget', find: '2026-11-03T01:00:00Z' });
  const legacy = await ins('Old', '2026-10-05T00:00:00Z');
  const found = await ins('NoRepo', '2026-11-04T00:00:00Z', { key: 'name:thing', find: '2026-11-04T01:00:00Z' });
  await db`CREATE TABLE builder_profiles (builder_id int PRIMARY KEY, x_handle text, x_user_id text, x_name text, github_login text, slug text)`;
  try {
    await db`INSERT INTO builder_profiles VALUES (${legacy}, 'oldx', 'x-123', 'Old X', null, 'old')`;
    const lines: string[] = [];
    const before = await counts();
    const dry = await run([], (s) => lines.push(s));
    assert.deepEqual(await counts(), before, 'a dry run writes nothing');
    assert.equal(dry.summary.installations, 6);
    assert.equal(dry.summary.would_create_people, 6);
    assert.equal(dry.summary.would_link_to_builder, 1);
    assert.deepEqual(dry.summary.identity, { github_signin: 1, x_signin_legacy: 1, github_claimed: 1, none: 3 });
    assert.deepEqual(dry.summary.none_reasons, { 'never called find': 2, 'anonymous install, never linked, no repo seen': 1 });
    assert.deepEqual(dry.summary.test, { repro: 1 });
    assert.equal(dry.summary.since.from, '2026-10-24');
    assert.equal(dry.summary.since.installations, 4);
    assert.equal(dry.summary.since.identity.none, 2);
    // One summary and one line per installation; no token hash anywhere.
    assert.equal(lines.length, 1 + 6);
    assert.ok(lines.every((l) => !/bf-0\./.test(l) && !/token/.test(l)));

    await run(['--apply'], () => {});
    const after1 = await counts();
    assert.equal(after1.linked, 6);
    assert.equal(after1.people, 6);
    const p = async (id: number) => (await db`SELECT p.* FROM installations i JOIN people p ON p.id = i.person_id WHERE i.id = ${id}`)[0];
    assert.equal((await p(plain)).test_reason, null);
    assert.equal((await p(repro)).test_reason, 'repro');
    assert.equal((await p(linked)).builder_id, b.id);
    assert.equal((await p(claimed)).github_login, 'acme');
    const lp = await p(legacy);
    assert.equal(lp.x_handle, 'oldx');
    assert.equal(lp.x_user_id, 'x-123');
    assert.equal(lp.legacy_profile_id, legacy);
    assert.equal((await p(found)).github_login, null);
    const view = await db<{ identity_source: string | null }[]>`SELECT identity_source FROM owner_people WHERE ${legacy} = ANY(installation_ids)`;
    assert.equal(view[0].identity_source, 'x_signin_legacy');

    const again = await run(['--apply'], () => {});
    assert.deepEqual(await counts(), after1, 'a second apply changes nothing');
    assert.equal(again.summary.would_create_people, 0);
    assert.equal(again.summary.already_with_person, 6);
  } finally {
    await db`DROP TABLE builder_profiles`;
  }
});

test('--since filters the lines, and a bad date is refused', async () => {
  const lines: string[] = [];
  await run(['--since', '2026-11-03'], (s) => lines.push(s));
  assert.ok(lines.length >= 1);
  await assert.rejects(run(['--since', 'yesterday'], () => {}), /YYYY-MM-DD/);
});
