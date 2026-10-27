import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { sql } from './db';

/**
 * v2.12.2: db-migrate reruns all of schema.sql before every deploy. A CHECK dropped and re-added
 * twice must allow the same values both times: an earlier, shorter list fails on rows the later
 * list let in, and the deploy stops (production, 2026-10-15: builder_events_type_check).
 */
const SCHEMA = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');

function checkValues(body: string): string[] {
  return [...body.replace(/--[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

test('every CHECK the schema re-adds more than once allows the same values each time', () => {
  const adds = new Map<string, string[][]>();
  for (const m of SCHEMA.matchAll(/ADD CONSTRAINT (\w+)\s+CHECK \(([\s\S]*?)\)\);/g)) {
    adds.set(m[1], [...(adds.get(m[1]) ?? []), checkValues(m[2])]);
  }
  const repeated = [...adds].filter(([, lists]) => lists.length > 1);
  assert.ok(repeated.some(([name]) => name === 'builder_events_type_check'), 'the parser still sees the repeated adds');
  for (const [name, lists] of repeated) {
    for (const list of lists) assert.deepEqual(list, lists.at(-1), `${name}: every add allows the last add's values`);
  }
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('v3 Stage 2 Task 4: a database with the first creator_fees (two-column key) moves to (tx_hash, log_index, coin) and re-credits under the cap', dbTest, async () => {
  const key = async () => (await sql()<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'creator_fees_pkey' AND conrelid = 'creator_fees'::regclass`)[0]?.def;
  // The round-1 table, with an uncapped claim and its coin cursor.
  // owner_people reads creator_fees (v3.1 owner tracker); the rerun below recreates it.
  await sql()`DROP VIEW IF EXISTS owner_people`;
  await sql()`DROP TABLE creator_fees`;
  await sql()`CREATE TABLE creator_fees (tx_hash text NOT NULL, log_index integer NOT NULL, coin text NOT NULL, wallet text NOT NULL, amount_wei numeric NOT NULL, block_number bigint NOT NULL, block_time timestamptz NOT NULL, PRIMARY KEY (tx_hash, log_index))`;
  await sql()`INSERT INTO creator_fees VALUES ('0xold', 1, '0xc0', '0xw0', 10, 1, now())`;
  await sql()`INSERT INTO bonus_cursor (id, block) VALUES ('creator_fees:0xc0', 100) ON CONFLICT (id) DO UPDATE SET block = 100`;
  await sql()`INSERT INTO bonus_cursor (id, block) VALUES ('safe-rerun-test', 7) ON CONFLICT (id) DO NOTHING`;
  assert.equal(await key(), 'PRIMARY KEY (tx_hash, log_index)');
  await sql().unsafe(SCHEMA);
  assert.equal(await key(), 'PRIMARY KEY (tx_hash, log_index, coin)');
  assert.equal((await sql()`SELECT 1 FROM creator_fees`).length, 0, 'the uncapped rows are cleared');
  assert.equal((await sql()`SELECT 1 FROM bonus_cursor WHERE id LIKE 'creator_fees:%'`).length, 0, 'their cursors too');
  assert.equal((await sql()`SELECT 1 FROM bonus_cursor WHERE id = 'safe-rerun-test'`).length, 1, 'other cursors stay');
  // Run again: the three-column key is kept and new rows stay.
  await sql()`INSERT INTO creator_fees VALUES ('0xnew', 1, '0xc0', '0xw0', 10, 1, now()), ('0xnew', 1, '0xc1', '0xw0', 5, 1, now())`;
  await sql().unsafe(SCHEMA);
  assert.equal(await key(), 'PRIMARY KEY (tx_hash, log_index, coin)');
  assert.equal((await sql()`SELECT 1 FROM creator_fees`).length, 2);
});

test('v3.1 Highlights: repo_builder_codes.path and builder_sources.deployed_at are added once, nullable, and a rerun keeps their values', dbTest, async () => {
  const col = async (table: string, column: string) =>
    (await sql()<{ nullable: string; type: string }[]>`
      SELECT is_nullable AS nullable, data_type AS type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`)[0];
  const key = `rerun-hl-${process.pid}/app`;
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at, path) VALUES (${key}, true, now(), 'src/tx.ts')`;
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by, deployed_at)
    VALUES (${-process.pid}, 'contract', ${`base:0x${'1'.repeat(40)}`}, 'k', 'verified', 'server', '2025-06-10T00:00:00Z') RETURNING id::int AS id`;
  await sql().unsafe(SCHEMA);
  await sql().unsafe(SCHEMA);
  assert.deepEqual(await col('repo_builder_codes', 'path'), { nullable: 'YES', type: 'text' });
  assert.deepEqual(await col('builder_sources', 'deployed_at'), { nullable: 'YES', type: 'timestamp with time zone' });
  assert.equal((await sql()<{ path: string }[]>`SELECT path FROM repo_builder_codes WHERE repo_key = ${key}`)[0]?.path, 'src/tx.ts');
  assert.equal((await sql()<{ at: Date }[]>`SELECT deployed_at AS at FROM builder_sources WHERE id = ${id}`)[0]?.at.toISOString(), '2025-06-10T00:00:00.000Z');
  await sql()`DELETE FROM repo_builder_codes WHERE repo_key = ${key}`;
  await sql()`DELETE FROM builder_sources WHERE id = ${id}`;
});

test('v3.1 Highlights fix round 1: repo_builder_codes_attempts and builder_sources.origin_read_at survive a rerun with their values', dbTest, async () => {
  const key = `rerun-att-${process.pid}/app`;
  await sql()`INSERT INTO repo_builder_codes_attempts (repo_key, attempted_at) VALUES (${key}, '2026-10-01T00:00:00Z')`;
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by, origin_read_at)
    VALUES (${-process.pid - 1}, 'contract', ${`base:0x${'2'.repeat(40)}`}, 'k', 'verified', 'server', '2026-10-02T00:00:00Z') RETURNING id::int AS id`;
  await sql().unsafe(SCHEMA);
  await sql().unsafe(SCHEMA);
  assert.equal((await sql()<{ at: Date }[]>`SELECT attempted_at AS at FROM repo_builder_codes_attempts WHERE repo_key = ${key}`)[0]?.at.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal((await sql()<{ at: Date }[]>`SELECT origin_read_at AS at FROM builder_sources WHERE id = ${id}`)[0]?.at.toISOString(), '2026-10-02T00:00:00.000Z');
  await sql()`DELETE FROM repo_builder_codes_attempts WHERE repo_key = ${key}`;
  await sql()`DELETE FROM builder_sources WHERE id = ${id}`;
});

test('v3.1 Used by: repo_builder_codes.codes and app_usage survive a rerun with their values; the source CHECK holds', dbTest, async () => {
  const key = `rerun-ub-${process.pid}/app`;
  const id = -process.pid - 2;
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at, path, codes) VALUES (${key}, true, now(), 'src/tx.ts', ${['maya', 'maya_2']}::text[])`;
  await sql()`INSERT INTO app_usage (builder_id, source, day, users, "returning", capped, href, chains) VALUES (${id}, 'contracts', '2026-10-27', 120, 30, true, 'https://basescan.org/address/0x1', ${['base']}::text[])`;
  await sql().unsafe(SCHEMA);
  await sql().unsafe(SCHEMA);
  assert.deepEqual([...await sql()`SELECT codes FROM repo_builder_codes WHERE repo_key = ${key}`], [{ codes: ['maya', 'maya_2'] }]);
  assert.deepEqual([...await sql()`SELECT users, "returning" AS r, capped, chains FROM app_usage WHERE builder_id = ${id}`], [{ users: 120, r: 30, capped: true, chains: ['base'] }]);
  await assert.rejects(sql()`INSERT INTO app_usage (builder_id, source, day, users, "returning") VALUES (${id}, 'tokens', '2026-10-27', 1, 0)`, /app_usage_source_check/);
  await sql()`DELETE FROM repo_builder_codes WHERE repo_key = ${key}`;
  await sql()`DELETE FROM app_usage WHERE builder_id = ${id}`;
});

test('v3.1 one-tap posts: post_drafts and its index survive a rerun with their rows; a bad code or an over-long text is refused', dbTest, async () => {
  const code = `rr${'a'.repeat(8)}`;
  await sql()`DELETE FROM post_drafts WHERE code = ${code}`;
  await sql()`INSERT INTO post_drafts (code, builder_id, moment, moment_key, shape, text, expires_at, taps)
    VALUES (${code}, ${-process.pid}, 'weekly', 'weekly:k:2026-10-12', 'change', 'Added offline mode.', now() + interval '14 days', 3)`;
  await sql().unsafe(SCHEMA);
  await sql().unsafe(SCHEMA);
  const [row] = await sql()<{ taps: number; text: string }[]>`SELECT taps, text FROM post_drafts WHERE code = ${code}`;
  assert.deepEqual(row, { taps: 3, text: 'Added offline mode.' });
  const [ix] = await sql()`SELECT 1 FROM pg_indexes WHERE tablename = 'post_drafts' AND indexname = 'post_drafts_builder'`;
  assert.ok(ix);
  await assert.rejects(sql()`INSERT INTO post_drafts (code, builder_id, moment, moment_key, shape, text, expires_at)
    VALUES ('BAD-CODE!!', 1, 'weekly', 'k', 'change', 't', now())`, /check/i);
  await assert.rejects(sql()`INSERT INTO post_drafts (code, builder_id, moment, moment_key, shape, text, expires_at)
    VALUES ('bbbbbbbbbb', 1, 'weekly', 'k', 'change', ${'x'.repeat(241)}, now())`, /check/i);
  await sql()`DELETE FROM post_drafts WHERE code = ${code}`;
});
