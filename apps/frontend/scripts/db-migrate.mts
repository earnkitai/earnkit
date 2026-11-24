/**
 * pnpm db:migrate [schema file]: runs db/schema.sql (or the given file; the guard's test passes one). The additive-only
 * guard (lib/v6/schema-guard.ts) reads the file first and, on any destructive statement not in the allowlist, exits 1
 * before connecting, so the deploy stops (railway.toml preDeployCommand).
 */
import './env.mts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSchema, describeViolations } from '../lib/v6/schema-guard';

const schema = readFileSync(process.argv[2] ?? join(import.meta.dirname, '..', 'db', 'schema.sql'), 'utf8');
const violations = checkSchema(schema);
if (violations.length) {
  console.error(describeViolations(violations));
  console.error(`schema guard: ${violations.length} destructive statement(s) not in lib/v6/schema-allowlist.ts; nothing was run.`);
  process.exit(1);
}
const { sql } = await import('../lib/v5/db');
const db = sql();
await db.unsafe(schema);
console.log('Schema is up to date.');
await db.end();
