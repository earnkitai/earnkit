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
  // v2.7: a logo path is tied to its program id (programs/<id>.svg), so the clone has none.
  logo: undefined,
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

// v2.7 §2: program guide facts are additive; an existing program gets empty/NULL defaults and
// keeps its builder_bonus.
const [guide] = await db<{
  past_rounds: unknown;
  logo: unknown;
  focus: unknown;
  best_bet: string | null;
  difficulty_override: unknown;
  winners_per_round: number | null;
  pool_usd: string | null;
  min_award_usd: string | null;
  pool_source_url: string | null;
  builder_bonus: boolean;
}[]>`
  SELECT past_rounds, logo, focus, best_bet, difficulty_override, winners_per_round, pool_usd, min_award_usd, pool_source_url, builder_bonus
  FROM programs WHERE id = 'old-active'`;
ok(JSON.stringify(guide.past_rounds) === '[]', "an existing program's past_rounds defaults to []");
ok(
  guide.logo === null &&
    guide.focus === null &&
    guide.best_bet === null &&
    guide.difficulty_override === null &&
    guide.winners_per_round === null,
  'an existing program gets NULL logo, focus, best_bet, difficulty_override and winners_per_round',
);
ok(guide.builder_bonus === true, 'builder_bonus is still true after the v2.7 migration');
// v2.7.1: pool_usd is additive; an existing program has none until programs:sync writes its file's.
ok(
  guide.pool_usd === null && guide.min_award_usd === null && guide.pool_source_url === null,
  "an existing program's pool_usd, min_award_usd and pool_source_url are NULL",
);

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
// v2.7 §2: the same real migration (a v2.5 row, pre-v2.6/v2.7 columns) gets the v2.7 defaults too.
const [migratedGuide] = await db<{ past_rounds: unknown; logo: unknown }[]>`
  SELECT past_rounds, logo FROM programs WHERE id = 'v25-migrate'`;
ok(
  JSON.stringify(migratedGuide.past_rounds) === '[]' && migratedGuide.logo === null,
  'a v2.5 program gets empty past_rounds and NULL logo from the v2.7 migration',
);

// v2.8 Ruling 13 (plan): any_chain is additive; an existing program (seeded before it) is chain-bound.
const [v28Old] = await db<{ any_chain: boolean; investment: boolean }[]>`SELECT any_chain, investment FROM programs WHERE id = 'v25-migrate'`;
ok(v28Old.any_chain === false, 'a v2.5 program gets any_chain = false from the v2.8 migration');
ok(v28Old.investment === false, 'a v2.5 program gets investment = false from the v2.8 migration (Ruling C5)');
await db.unsafe(now); // re-applying the schema keeps it (idempotent)
const [v28Again] = await db<{ any_chain: boolean }[]>`SELECT any_chain FROM programs WHERE id = 'v25-migrate'`;
ok(v28Again.any_chain === false, 'any_chain stays false when the schema is applied again');

// v2.8 Rulings 1-3 (plan): complete_at and its one backfill, applied over real pre-v2.8 rows (the
// schema of 021eba2, the base before these columns). Proves no entry eligible before the migration
// loses it: the pre-v2.8 rule (inlined as it was) and eligibleSql after select the same rows.
const v28pre = execFileSync('git', ['-C', root, 'show', '021eba2:apps/frontend/db/schema.sql'], {
  encoding: 'utf8',
});
await db.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await db.unsafe(v28pre);
const ENDS = new Date('2026-11-01T00:00:00Z');
const at = (day: number) => new Date(Date.UTC(2026, 9, day));
await db`
  INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
  VALUES ('v28-elig', 'X', 'V28', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
const seed = async (name: string, o: { coin?: Date | null; coinAddress?: boolean; proof?: Date | null; at: Date; repo?: string }) =>
  (
    await db<{ id: number }[]>`
      INSERT INTO projects (program_id, name, coin_address, coin_launched_at, submission_proof_ok_at, submitted_at, bonus_repo_key)
      VALUES ('v28-elig', ${name}, ${o.coinAddress === false ? null : '0x' + name.padEnd(40, '0').slice(0, 40)},
        ${o.coin ?? null}, ${o.proof ?? null}, ${o.at}, ${o.repo ?? `acme/${name}`})
      RETURNING id`
  )[0].id;
const seeded = {
  eligible: await seed('eligible', { coin: at(2), proof: at(3), at: at(3) }),
  first: await seed('first', { coin: at(4), proof: at(4), at: at(4), repo: 'acme/shared' }),
  later: await seed('later', { coin: at(5), proof: at(5), at: at(5), repo: 'acme/shared' }),
  noProof: await seed('noproof', { coin: at(2), at: at(2) }),
  noCoin: await seed('nocoin', { coin: null, coinAddress: false, proof: at(2), at: at(2) }),
  lateCoin: await seed('latecoin', { coin: new Date('2026-11-02T00:00:00Z'), proof: at(2), at: at(2) }),
  // A coin address with no launch time: the v2.5 backfill (every deploy, before the v2.8 one)
  // gives it coin_launched_at = submitted_at, so the v2.8 backfill makes it complete too.
  noTime: await seed('notime', { coin: null, proof: at(2), at: at(2) }),
};
const oldRule = async () =>
  new Set(
    (
      await db<{ id: number }[]>`
        SELECT p.id FROM projects p WHERE p.program_id = 'v28-elig'
          AND p.coin_address IS NOT NULL AND p.coin_launched_at < ${ENDS}
          AND p.submission_proof_ok_at IS NOT NULL AND p.submission_proof_ok_at < ${ENDS}
          AND p.submitted_at < ${ENDS}
          AND NOT EXISTS (
            SELECT 1 FROM projects q
            WHERE q.program_id = p.program_id AND q.bonus_repo_key IS NOT NULL AND q.bonus_repo_key = p.bonus_repo_key
              AND q.coin_address IS NOT NULL AND q.coin_launched_at < ${ENDS}
              AND q.submission_proof_ok_at IS NOT NULL AND q.submission_proof_ok_at < ${ENDS}
              AND (q.submitted_at, q.id) < (p.submitted_at, p.id))`
    ).map((r) => r.id),
  );
const eligibleBefore = await oldRule();
ok(
  eligibleBefore.size === 2 && eligibleBefore.has(seeded.eligible) && eligibleBefore.has(seeded.first),
  'pre-v2.8 rows: two entries eligible under the pre-v2.8 rule',
);
await db.unsafe(now);
await db.unsafe(now); // every deploy runs it again
const completes = new Map(
  (await db<{ id: number; complete_at: Date | null; coin_launched_at: Date | null; confirm_choice: string | null; confirmed_at: Date | null }[]>`
    SELECT id, complete_at, coin_launched_at, confirm_choice, confirmed_at FROM projects WHERE program_id = 'v28-elig'`).map((r) => [r.id, r]),
);
ok(
  [seeded.eligible, seeded.first, seeded.later, seeded.noProof, seeded.lateCoin, seeded.noTime].every(
    (id) => completes.get(id)!.complete_at?.getTime() === completes.get(id)!.coin_launched_at!.getTime(),
  ),
  'a row with coin_launched_at gets complete_at = coin_launched_at',
);
ok(completes.get(seeded.noCoin)!.complete_at === null, 'a row without coin_launched_at keeps complete_at NULL');
ok(
  [...completes.values()].every((r) => r.confirm_choice === null && r.confirmed_at === null),
  'existing rows get no confirm_choice and no confirmed_at',
);
const { eligibleSql } = await import('../lib/earnkit/traction');
const eligibleAfter = new Set(
  (await db<{ id: number }[]>`SELECT p.id FROM projects p WHERE p.program_id = 'v28-elig' AND ${eligibleSql(ENDS)}`).map((r) => r.id),
);
const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((id) => b.has(id));
// On the same migrated rows (the v2.5 backfill above can only add launch times), the pre-v2.8 rule
// and eligibleSql agree: the v2.8 conditions remove no entry from the eligible set.
const eligibleOldRuleNow = await oldRule();
ok(
  [...eligibleBefore].every((id) => eligibleOldRuleNow.has(id)) && sameSet(eligibleAfter, eligibleOldRuleNow),
  'every entry eligible before the v2.8 migration is eligible after it, and eligibleSql equals the pre-v2.8 rule on existing rows',
);
let badChoice = false;
try {
  await db`UPDATE projects SET confirm_choice = 'maybe' WHERE id = ${seeded.eligible}`;
} catch {
  badChoice = true;
}
ok(badChoice, "confirm_choice rejects anything but 'go' or 'skip'");
// The backfill runs once: a v2.8 entry whose token launched while it was incomplete (complete_at
// NULL) stays incomplete when the schema runs again at the next deploy.
const launchedIncomplete = await seed('v28-launch', { coin: at(6), proof: at(6), at: at(6) });
await db.unsafe(now);
const [again] = await db<{ complete_at: Date | null }[]>`SELECT complete_at FROM projects WHERE id = ${launchedIncomplete}`;
ok(again.complete_at === null, 'the complete_at backfill never runs again (a later deploy marks nothing complete)');
const [kept] = await db<{ complete_at: Date | null }[]>`SELECT complete_at FROM projects WHERE id = ${seeded.eligible}`;
ok(kept.complete_at?.getTime() === at(2).getTime(), 'a backfilled complete_at is kept by later deploys');

await db.end();
console.log(`db check: ${checks} checks passed`);
