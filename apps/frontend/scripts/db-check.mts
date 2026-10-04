import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.4: db/schema.sql runs before every deploy, so it must be idempotent and safe on the rows
 * production already has. Against a throwaway local Postgres only:
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55442/postgres?sslmode=disable pnpm db:check
 * Drops the public schema, applies main's schema (d924e4a), adds rows like production's, applies
 * the current schema twice, and checks the backfills, the defaults and opened_at through sync.
 */
function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
let host = '';
try {
  host = new URL(process.env.DATABASE_URL ?? '').hostname;
} catch {
  fail('DATABASE_URL is missing or not a URL.');
}
if (host !== '127.0.0.1' && host !== 'localhost')
  fail('DATABASE_URL must point at a local Postgres (this script drops the public schema).');

const { sql } = await import('../lib/earnkit/db');
const db = sql();
const root = join(import.meta.dirname, '..', '..', '..');
const before = execFileSync('git', ['-C', root, 'show', 'd924e4a:apps/frontend/db/schema.sql'], {
  encoding: 'utf8',
});
const now = readFileSync(join(import.meta.dirname, '..', 'db', 'schema.sql'), 'utf8');
let checks = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fail(what);
  checks++;
  console.log(`ok: ${what}`);
};
const W = '0x' + 'a'.repeat(40);

await db.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await db.unsafe(before);
await db.unsafe(`
  INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, created_at)
  VALUES ('old-active', 'X', 'Old', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', '2026-09-01T00:00:00Z'),
         ('old-closed', 'X', 'Closed', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'closed', 'allowed', '2026-09-01T00:00:00Z');
  INSERT INTO installations (token_hash, payout_wallet) VALUES ('h1', '${W}'), ('h2', NULL);
  INSERT INTO projects (program_id, name, installation_id, payout_wallet, contracts, score)
  VALUES ('old-active', 'P', 1, '${W}', '{}', 12);`);
await db.unsafe(now);
await db.unsafe(now); // every deploy runs it again

const [active] = await db<{ opened_at: Date | null }[]>`SELECT opened_at FROM programs WHERE id = 'old-active'`;
ok(active.opened_at?.toISOString() === '2026-09-01T00:00:00.000Z', 'an active program gets opened_at = created_at');
const [closed] = await db<{ opened_at: Date | null }[]>`SELECT opened_at FROM programs WHERE id = 'old-closed'`;
ok(closed.opened_at === null, 'a closed program keeps opened_at NULL');
const [w] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM installation_wallets WHERE wallet = ${W}`;
ok(w.n === 1, "an installation's old payout wallet is one of its wallets");
const [p] = await db<{ score: number; score_final: boolean; payout_status: string | null; creator_wallet: string | null }[]>`
  SELECT score, score_final, payout_status, creator_wallet FROM projects`;
ok(p.score === 12 && p.score_final === false && p.payout_status === null && p.creator_wallet === null, 'existing entries keep their score and get safe defaults');
const [i] = await db<{ client_key: string | null }[]>`SELECT client_key FROM installations WHERE token_hash = 'h1'`;
ok(i.client_key === null, 'installations from before v2.4 keep working by token');
await db`UPDATE installations SET client_key = 'k1' WHERE token_hash = 'h1'`;
let duplicate = false;
try {
  await db`UPDATE installations SET client_key = 'k1' WHERE token_hash = 'h2'`;
} catch {
  duplicate = true;
}
ok(duplicate, 'two installations can never share an OAuth client');

// opened_at follows status through programs:sync.
const { upsertProgram } = await import('../lib/earnkit/programs');
const { ProgramFile } = await import('../lib/earnkit/program-file');
const file = ProgramFile.parse({
  ...JSON.parse(readFileSync(join(root, 'programs', 'arc-microgrants.json'), 'utf8')),
  id: 'sync-check',
  status: 'closed',
});
const openedAt = async () =>
  (await db<{ opened_at: Date | null }[]>`SELECT opened_at FROM programs WHERE id = 'sync-check'`)[0].opened_at;
await upsertProgram(file);
ok((await openedAt()) === null, 'a closed program has no opened_at');
await upsertProgram({ ...file, status: 'active' });
const first = await openedAt();
ok(first !== null, 'going active sets opened_at');
await new Promise((r) => setTimeout(r, 20));
await upsertProgram({ ...file, status: 'active' });
ok((await openedAt())?.getTime() === first!.getTime(), 'a later sync of an active program keeps opened_at');
await upsertProgram({ ...file, status: 'closed' });
await upsertProgram({ ...file, status: 'active' });
ok((await openedAt())!.getTime() > first!.getTime(), 'reopening a program is news again');

await db.end();
console.log(`db check: ${checks} checks passed`);
