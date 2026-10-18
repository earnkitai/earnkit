import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { assertLocalPostgres, isLocalPostgres, testDbName, withDatabase } from './fixtures/test-db';
import { mcpCall, mcpListTools } from './fixtures/mcp-call';
import { saveInstallation, connectInstallation } from './installations';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

test('2.1 a test file gets a stable, distinct database name', () => {
  const a = testDbName('/x/a.test.ts', 41);
  assert.match(a, /^ek_t_[0-9a-f]{10}_41$/);
  assert.equal(testDbName('/x/a.test.ts', 41), a);
  assert.notEqual(testDbName('/x/b.test.ts', 41), a);
  assert.notEqual(testDbName('/x/a.test.ts', 42), a);
});

test('2.2 withDatabase swaps only the database', () => {
  assert.equal(
    withDatabase('postgres://postgres@127.0.0.1:55442/postgres?sslmode=disable', 'ek_t_0123456789_7'),
    'postgres://postgres@127.0.0.1:55442/ek_t_0123456789_7?sslmode=disable',
  );
});

test('2.2b per-file databases refuse a remote Postgres', () => {
  for (const u of ['postgres://u:p@db.neon.tech/x', 'postgres://u:p@10.0.0.5:5432/x', 'postgres://u:p@localhost.evil.com/x', 'postgres:///x?host=db.neon.tech', 'not a url'])
    assert.equal(isLocalPostgres(u), false, u);
  assert.throws(() => assertLocalPostgres('postgres://u:p@db.neon.tech/x'), /only run against a local Postgres/);
  for (const u of ['postgres://u@localhost:5432/x', 'postgres://u@127.0.0.1:55442/postgres', 'postgres://u@[::1]:5432/x', 'postgres:///x?host=/var/run/postgresql'])
    assert.equal(isLocalPostgres(u), true, u);
  assert.doesNotThrow(() => assertLocalPostgres('postgres://u@localhost/x'));
});

test('2.3 this file runs in its own database, with the schema and the programs', db, async () => {
  const [{ name }] = await sql()<{ name: string }[]>`SELECT current_database() AS name`;
  assert.match(name, /^ek_t_[0-9a-f]{10}_\d+$/);
  const [t] = await sql()`SELECT 1 FROM information_schema.tables WHERE table_name = 'builder_profiles'`;
  assert.ok(t, 'the schema is there');
  const [p] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM programs`;
  assert.ok(p.n > 0, 'the programs were synced into the template');
});

test('2.4 mcpCall goes through tools/call: the schema runs before the handler', db, async () => {
  const token = `ek_t2_${process.pid}_${Date.now()}`;
  await saveInstallation(token, undefined, false);
  const c = (await connectInstallation(token))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared };
  const r = await mcpCall(ctx, 'find', {});
  assert.equal(r.isError, false, r.text);
  assert.equal(typeof r.reply?.show_to_builder, 'string');
  const bad = await mcpCall(ctx, 'confirm', { yes: 'not-a-boolean' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /invalid|yes|expected/i, `the schema's validation message, got: ${bad.text}`);
  // find's schema is a plain object: an unknown key is stripped, not an error.
  const stripped = await mcpCall(ctx, 'find', { not_a_real_key: 1 });
  assert.equal(stripped.isError, false, stripped.text);
  // confirm's schema is .strict(): an unknown key is a validation error naming the key.
  const strict = await mcpCall(ctx, 'confirm', { not_a_real_key: 1 });
  assert.equal(strict.isError, true);
  assert.match(strict.text, /not_a_real_key|unrecognized|invalid/i, strict.text);
});

test('2.5 mcpListTools lists the five tools', async () => {
  // Until T3 removes the flag, score registers only with EARNKIT_BUILDER_SCORE=on; T3 deletes this env line.
  try {
    const names = (await mcpListTools({ installationId: 1 })).map((t) => t.name).sort();
    assert.deepEqual(names, ['confirm', 'find', 'prepare', 'score', 'tell']);
  } finally {
  }
});

test('2.6 every v214 agent-input test goes through mcpCall, never a handler alone', () => {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((f) => /^v214-.*\.test\.ts$/.test(f));
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\btools\.(find|prepare|confirm|tell|score)\(/, `${f} calls a tool handler directly`);
    if (/\b(find|tell|score|prepare|confirm)\b/.test(src) && /mcp|tool/i.test(src)) assert.match(src, /mcpCall\(/, `${f} needs mcpCall`);
  }
});
