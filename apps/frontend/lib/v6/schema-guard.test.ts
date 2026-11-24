/**
 * v3.8 deploy safety: db/schema.sql runs on every deploy, so it must stay additive. The guard (schema-guard.ts) is
 * static; the last tests apply the real file twice to this file's test database.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { checkSchema, describeViolations, statements } from './schema-guard';
import { SCHEMA_ALLOWLIST } from './schema-allowlist';

const FRONTEND = join(import.meta.dirname, '..', '..');
const SCHEMA = readFileSync(join(FRONTEND, 'db', 'schema.sql'), 'utf8');
after(() => sql().end());
const rulesOf = (text: string) => checkSchema(text).map((v) => v.rule);

test('the current schema.sql passes the guard', () => {
  assert.deepEqual(checkSchema(SCHEMA), [], describeViolations(checkSchema(SCHEMA)));
});

test('every allowlist entry is still a statement of schema.sql (no stale entry widens the list)', () => {
  const present = new Set(statements(SCHEMA));
  for (const e of SCHEMA_ALLOWLIST) assert.ok(present.has(e.sql), `stale allowlist entry: ${e.sql.slice(0, 80)}`);
  assert.equal(new Set(SCHEMA_ALLOWLIST.map((e) => e.sql)).size, SCHEMA_ALLOWLIST.length);
});

test('a new destructive statement fails, each kind', () => {
  const cases: [string, string][] = [
    ['DROP TABLE IF EXISTS applications;', 'DROP TABLE'],
    ['ALTER TABLE applications DROP COLUMN IF EXISTS proof;', 'DROP COLUMN'],
    ['DROP SCHEMA public CASCADE;', 'DROP SCHEMA'],
    ['DROP TYPE IF EXISTS stage_t;', 'DROP TYPE'],
    ['TRUNCATE applications;', 'TRUNCATE'],
    ['DELETE FROM people;', 'DELETE'],
    ['UPDATE people SET test_reason = NULL;', 'UPDATE'],
    ['ALTER TABLE applications ALTER COLUMN round TYPE int USING round::int;', 'ALTER ... TYPE'],
    ['ALTER TYPE stage_t ADD VALUE \'x\';', 'ALTER ... TYPE'],
    ['ALTER TABLE applications RENAME COLUMN proof TO proofs;', 'RENAME'],
    ['ALTER TABLE applications ALTER COLUMN stage SET NOT NULL;', 'SET NOT NULL'],
    ['ALTER TABLE builders DROP CONSTRAINT IF EXISTS builders_one_account;', 'DROP'],
    ['DROP INDEX IF EXISTS installations_person;', 'DROP'],
    ['CREATE TABLE foo (id int);', 'CREATE TABLE without IF NOT EXISTS'],
    ['CREATE UNIQUE INDEX foo_id ON foo (id);', 'CREATE INDEX without IF NOT EXISTS'],
    ['DO $$ BEGIN PERFORM 1; END $$;', 'DO block'],
    ['CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;', 'CREATE FUNCTION/PROCEDURE/TRIGGER/RULE'],
  ];
  for (const [stmt, rule] of cases) assert.deepEqual(rulesOf(`${SCHEMA}\n${stmt}\n`), [rule], stmt);
});

test('an allowlisted statement edited even slightly fails (the key is the exact statement)', () => {
  const edited = SCHEMA.replace('DROP INDEX IF EXISTS gaps_done_owner_item;', 'DROP INDEX IF EXISTS gaps_done_owner_items;');
  assert.notEqual(edited, SCHEMA);
  assert.deepEqual(rulesOf(edited), ['DROP']);
});

test('comments are ignored, and whitespace does not change the key', () => {
  const commented = `${SCHEMA}\n-- DROP TABLE applications;\n/* TRUNCATE people;\n DELETE FROM builders; */\nALTER TABLE x ADD COLUMN IF NOT EXISTS y text; -- UPDATE x\n`;
  assert.deepEqual(checkSchema(commented), []);
  assert.deepEqual(checkSchema('DROP   VIEW IF EXISTS\n  owner_people ;'), []);
  // A string or $$ body that looks like a comment is not one, and its semicolon does not split the statement.
  assert.deepEqual(rulesOf("COMMENT ON TABLE x IS '--'; DROP TABLE x;"), ['DROP TABLE']);
  assert.deepEqual(rulesOf("DO $$ BEGIN RAISE NOTICE '; -- '; DELETE FROM x; END $$;"), ['DO block']);
});

test('the guard runs in db-migrate.mts before any SQL and fails closed', () => {
  const src = readFileSync(join(FRONTEND, 'scripts', 'db-migrate.mts'), 'utf8');
  assert.ok(src.indexOf('checkSchema(') > 0 && src.indexOf('checkSchema(') < src.indexOf("import('../lib/v5/db')"));
  assert.match(src, /process\.exit\(1\)/);
});

test('db-migrate.mts exits non-zero on a violation, before connecting', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ek-schema-')), 'schema.sql');
  writeFileSync(file, `${SCHEMA}\nTRUNCATE applications;\n`);
  let code = 0;
  let err = '';
  try {
    // An unreachable database: reaching it would fail differently (and the guard must stop first).
    execFileSync(process.execPath, ['--import', 'tsx', join(FRONTEND, 'scripts', 'db-migrate.mts'), file], {
      env: { ...process.env, DATABASE_URL: 'postgres://postgres@127.0.0.1:1/none' },
      stdio: 'pipe',
    });
  } catch (e) {
    const x = e as { status: number; stderr: Buffer };
    code = x.status;
    err = x.stderr.toString();
  }
  assert.equal(code, 1);
  assert.match(err, /schema guard: TRUNCATE: TRUNCATE applications/);
  assert.match(err, /nothing was run/);
});

test('schema.sql applied twice succeeds, and applications has the v3.8 track columns', async () => {
  await sql().unsafe(SCHEMA);
  await sql().unsafe(SCHEMA);
  const rows = await sql()<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'applications'`;
  const cols = new Set(rows.map((r) => r.column_name));
  for (const c of ['stage', 'held_reason', 'proof', 'round', 'draft_text', 'draft_check', 'final_hash']) assert.ok(cols.has(c), c);
});
