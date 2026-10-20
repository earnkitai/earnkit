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
