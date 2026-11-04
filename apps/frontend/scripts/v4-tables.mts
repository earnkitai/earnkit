/**
 * Lists every table in the connected database that db/schema.sql does not create (the v4 tables), with
 * row counts, and prints the DROP TABLE statements. It never runs them: dropping is an owner step, after
 * a backup. Usage: pnpm db:v4-tables
 */
import './env.mts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../lib/v5/db';

const schema = readFileSync(join(import.meta.dirname, '..', 'db', 'schema.sql'), 'utf8');
const kept = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+"?(\w+)"?/gi)].map((m) => m[1].toLowerCase()));

const db = sql();
try {
  const tables = await db<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const v4 = tables.map((t) => t.name).filter((name) => !kept.has(name.toLowerCase()));
  if (v4.length === 0) {
    console.log('No tables outside db/schema.sql.');
  } else {
    console.log(`${v4.length} tables outside db/schema.sql:\n`);
    for (const name of v4) {
      const [{ n }] = await db<{ n: string }[]>`SELECT count(*)::text AS n FROM ${db(name)}`;
      console.log(`${name.padEnd(40)} ${n} rows`);
    }
    console.log('\nTo drop them after a backup (not run by this script):\n');
    for (const name of v4) console.log(`DROP TABLE IF EXISTS "${name}" CASCADE;`);
  }
} finally {
  await db.end();
}
