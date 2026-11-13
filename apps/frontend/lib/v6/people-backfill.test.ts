/** The people backfill (v6.1.21): the dry run writes nothing, --apply writes the plan, a rerun changes nothing. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { upsertBuilder } from './builders';
import { main, run } from './people-backfill';

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

test('M4 (v6.1.21): the env lists never flag a claimed repo owner, only a proven identity', async () => {
  const db = sql();
  const [r] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, last_project_key, last_find_at)
    VALUES (${'bf-' + Math.random()}, 'Claude Code', 'https://github.com/theowner/thing', now()) RETURNING id`;
  const env = { EARNKIT_OWNER_LOGINS: 'theowner' };
  const p = await run([], () => {}, env);
  const line = p.lines.find((l) => l.id === r.id)!;
  assert.equal(line.identity, 'github_claimed');
  assert.equal(line.test_reason, null);
  await run(['--apply'], () => {}, env);
  await main(['--reflag', '--apply'], () => {}, env);
  assert.equal((await db`SELECT p.test_reason FROM installations i JOIN people p ON p.id = i.person_id WHERE i.id = ${r.id}`)[0].test_reason, null);
});

test('I1 (v6.1.21): --reflag flags existing people from the env lists (dry run writes nothing), never clears, owner beats dogfood beats test', async () => {
  const db = sql();
  const mk = async (login: string, gid: number) => {
    const b = await upsertBuilder({ github_id: gid, login, name: null, avatar_url: null }, NOW);
    const [i] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, builder_id) VALUES (${'bf-' + Math.random()}, 'Claude Code', ${b.id}) RETURNING id`;
    return { b, i: i.id };
  };
  const owner = await mk('reflag-owner', 8801);
  const cto = await mk('reflag-cto', 8802);
  const plain = await mk('reflag-plain', 8803);
  const [anon] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name) VALUES (${'bf-' + Math.random()}, 'journey-runner-7') RETURNING id`;
  await run(['--apply'], () => {}, {});
  const reason = async (i: number) => (await db`SELECT p.test_reason, p.test_reason_source FROM installations x JOIN people p ON p.id = x.person_id WHERE x.id = ${i}`)[0];
  assert.equal((await reason(owner.i)).test_reason, null);
  assert.equal((await reason(anon.id)).test_reason, 'persona');
  // The owner's person was flagged `test` by the installation list earlier; owner is stronger and replaces it.
  await db`UPDATE people SET test_reason = 'test', test_reason_source = 'EARNKIT_TEST_INSTALLATIONS' WHERE builder_id = ${owner.b.id}`;
  // The CTO's person is already `owner`: a weaker dogfood never replaces it.
  await db`UPDATE people SET test_reason = 'owner', test_reason_source = 'EARNKIT_OWNER_LOGINS' WHERE builder_id = ${cto.b.id}`;
  const env = { EARNKIT_OWNER_LOGINS: 'reflag-owner', EARNKIT_DOGFOOD_LOGINS: 'reflag-cto' };
  const lines: string[] = [];
  const dry = (await main(['--reflag'], (s) => lines.push(s), env)) as { person_key: string; to: string }[];
  assert.deepEqual(dry.map((c) => [c.person_key, c.to]).filter(([k]) => [`b:${owner.b.id}`, `b:${cto.b.id}`, `b:${plain.b.id}`].includes(k)), [[`b:${owner.b.id}`, 'owner']]);
  assert.equal((await reason(owner.i)).test_reason, 'test', 'a dry run writes nothing');
  assert.match(lines[0], /"EARNKIT_OWNER_LOGINS": 1/);
  await main(['--reflag', '--apply'], () => {}, env);
  assert.deepEqual(await reason(owner.i), { test_reason: 'owner', test_reason_source: 'EARNKIT_OWNER_LOGINS' });
  assert.equal((await reason(cto.i)).test_reason, 'owner');
  assert.equal((await reason(plain.i)).test_reason, null);
  // Never cleared: with the lists gone, a rerun changes nothing.
  await main(['--reflag', '--apply'], () => {}, {});
  assert.equal((await reason(owner.i)).test_reason, 'owner');
  assert.equal((await reason(anon.id)).test_reason, 'persona');
});

test('I2 (v6.1.21): --unflag clears one person by key, and nothing automatic flags them again', async () => {
  const db = sql();
  const [i] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name) VALUES (${'bf-' + Math.random()}, 'my test-agent') RETURNING id`;
  await run(['--apply'], () => {}, {});
  const reason = async () => (await db`SELECT p.test_reason, p.test_reason_source FROM installations x JOIN people p ON p.id = x.person_id WHERE x.id = ${i.id}`)[0];
  assert.equal((await reason()).test_reason, 'test');
  await main(['--unflag', `i:${i.id}`], () => {}, {});
  assert.equal((await reason()).test_reason, 'test', 'a dry run writes nothing');
  await main(['--unflag', `i:${i.id}`, '--apply'], () => {}, {});
  assert.deepEqual(await reason(), { test_reason: null, test_reason_source: 'unflagged' });
  await main(['--reflag', '--apply'], () => {}, {});
  assert.equal((await reason()).test_reason, null);
  await assert.rejects(main(['--unflag', 'nobody'], () => {}, {}), /person key/);
  await assert.rejects(main(['--unflag', 'p:999999999'], () => {}, {}), /no person/);
});
