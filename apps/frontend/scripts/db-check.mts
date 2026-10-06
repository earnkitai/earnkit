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

// v2.5 builder bonus ledger.
const [coin] = await db<{ coin_address: string | null }[]>`SELECT coin_address FROM projects WHERE program_id = 'old-active'`;
ok(coin.coin_address === null, 'existing entries have no coin address (pre-v2.5 coins have no bonus slot)');
await db`INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at) VALUES ('old-active:2026-10', 'old-active', now(), now())`;
const [round] = await db<{ state: string }[]>`SELECT state FROM bonus_rounds WHERE round_key = 'old-active:2026-10'`;
ok(round.state === 'open', "a new round is 'open'");
let mismatched = false;
try {
  await db`INSERT INTO bonus_ledger (tx_hash, log_index, destination, amount_wei, block_time) VALUES ('0x1', 0, 'round', 1, now())`;
} catch {
  mismatched = true;
}
ok(mismatched, 'a deposit booked to a round always names it');
await db`INSERT INTO bonus_sweeps (amount_wei, to_wallet) VALUES (1, '0xsafe')`;
let twoOpen = false;
try {
  await db`INSERT INTO bonus_sweeps (amount_wei, to_wallet) VALUES (1, '0xsafe')`;
} catch {
  twoOpen = true;
}
ok(twoOpen, 'at most one sweep to the Safe is unfinished');

// v2.5 Task 7: round lifecycle and payouts.
const [r7] = await db<{ frozen_at: Date | null; note: string | null; pay_failures: number; flagged_notified_at: Date | null; freeze_failures: number }[]>`
  SELECT frozen_at, note, pay_failures, flagged_notified_at, freeze_failures FROM bonus_rounds WHERE round_key = 'old-active:2026-10'`;
ok(
  r7.frozen_at === null && r7.note === null && r7.pay_failures === 0 && r7.flagged_notified_at === null && r7.freeze_failures === 0,
  'existing rounds get safe lifecycle defaults (never notified, no failures)',
);
await db`INSERT INTO bonus_ledger (tx_hash, log_index, round_key, destination, amount_wei, block_time) VALUES ('0x2', 0, 'old-active:2026-10', 'safe', 1, now())`;
const [moved] = await db<{ round_key: string | null }[]>`SELECT round_key FROM bonus_ledger WHERE tx_hash = '0x2'`;
ok(moved.round_key === 'old-active:2026-10', "an empty round's booking moved to the Safe keeps its round");
const [entry] = await db<{ id: number }[]>`SELECT id FROM projects WHERE program_id = 'old-active'`;
await db`INSERT INTO bonus_payouts (round_key, project_id, rank, score, slot, tx_hash) VALUES ('old-active:2026-10', ${entry.id}, 1, 1, 0, '0xa')`;
let twice = false;
try {
  await db`INSERT INTO bonus_payouts (round_key, project_id, rank, score) VALUES ('old-active:2026-10', ${entry.id}, 2, 1)`;
} catch {
  twice = true;
}
ok(twice, 'an entry is in a round ranking once');
const [{ id: other }] = await db<{ id: number }[]>`
  INSERT INTO projects (program_id, name) VALUES ('old-active', 'Q') RETURNING id`;
let samePlace = false;
try {
  await db`INSERT INTO bonus_payouts (round_key, project_id, rank, score, slot, tx_hash) VALUES ('old-active:2026-10', ${other}, 2, 1, 0, '0xb')`;
} catch {
  samePlace = true;
}
ok(samePlace, 'two transfers never take the same place of a round');
await db`INSERT INTO bonus_vetoes (round_key, project_id, reason) VALUES ('old-active:2026-10', ${other}, 'r')`;
let vetoTwice = false;
try {
  await db`INSERT INTO bonus_vetoes (round_key, project_id, reason) VALUES ('old-active:2026-10', ${other}, 'r')`;
} catch {
  vetoTwice = true;
}
ok(vetoTwice, 'one veto per entry per round');

// v2.6 §4: every existing program gets the builder bonus by default; existing projects keep their
// submission_proof_ok_at and get no submission_basis; the new CHECK rejects an unknown basis.
const [prog] = await db<{ builder_bonus: boolean }[]>`SELECT builder_bonus FROM programs WHERE id = 'old-active'`;
ok(prog.builder_bonus === true, 'an existing program gets builder_bonus = true');
const [proj] = await db<{ submission_proof_ok_at: Date | null; submission_basis: string | null }[]>`
  SELECT submission_proof_ok_at, submission_basis FROM projects WHERE program_id = 'old-active' LIMIT 1`;
ok(proj.submission_basis === null, 'an existing project has no submission_basis yet');
let badBasis = false;
try {
  await db`UPDATE projects SET submission_basis = 'other' WHERE program_id = 'old-active'`;
} catch {
  badBasis = true;
}
ok(badBasis, "submission_basis rejects anything but 'page', 'unverified_page' or 'confirmed'");

// v2.6 §4 (fix round 1): a real migration check for submission_proof_ok_at, not a round-trip. The
// checks above run after `now` has already added builder_bonus/submission_basis (lines 49-50), so
// a value set there would always just be reading back what was written moments earlier on columns
// that already existed. Here the row is seeded under the actual v2.5 schema (main's last v2.5
// commit, 1823018, before this branch's columns exist), and only then is the current schema.sql
// (the v2.6 delta) applied over it.
const v25 = execFileSync('git', ['-C', root, 'show', '1823018:apps/frontend/db/schema.sql'], {
  encoding: 'utf8',
});
await db.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await db.unsafe(v25);
const PROOF_AT = new Date('2026-09-20T00:00:00Z');
await db`
  INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
    status, existing_work, submission_proof)
  VALUES ('v25-migrate', 'X', 'V25', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed',
    ${db.json({ host: 'x.example', path_pattern: '^/b/$' })})`;
await db`INSERT INTO projects (program_id, name, submission_proof_ok_at) VALUES ('v25-migrate', 'P25', ${PROOF_AT})`;
await db.unsafe(now); // the v2.6 migration, over real v2.5 rows
const [migrated] = await db<{ submission_proof_ok_at: Date; submission_basis: string | null }[]>`
  SELECT submission_proof_ok_at, submission_basis FROM projects WHERE program_id = 'v25-migrate'`;
ok(
  migrated.submission_proof_ok_at.toISOString() === PROOF_AT.toISOString(),
  "a v2.5 project's submission_proof_ok_at survives the v2.6 migration unchanged",
);
ok(migrated.submission_basis === null, 'a v2.5 project gets no submission_basis from the v2.6 migration');
const [migratedProg] = await db<{ builder_bonus: boolean }[]>`SELECT builder_bonus FROM programs WHERE id = 'v25-migrate'`;
ok(migratedProg.builder_bonus === true, 'a v2.5 program gets builder_bonus = true from the v2.6 migration');

await db.end();
console.log(`db check: ${checks} checks passed`);
