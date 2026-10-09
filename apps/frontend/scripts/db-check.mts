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
// v2.8.1 §E17/E18: additive. Installations made before v2.8.1 are not hosted, not linked, no pickup offer.
const [pre281] = await db<{ shared_client: boolean; builder_id: number | null; pickup: unknown }[]>`
  SELECT shared_client, builder_id, pickup FROM installations WHERE token_hash = 'h1'`;
ok(pre281.shared_client === false && pre281.builder_id === null && pre281.pickup === null, 'existing installations get shared_client false, no link and no pickup offer');
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

// v2.8 Part D, Ruling 6 (plan): the answer bank, the application snapshot and judging are additive;
// existing rows get NULL; one bank row per installation, project and kind; long answers refused.
const [v28Judging] = await db<{ judging: unknown }[]>`SELECT judging FROM programs WHERE id = 'v25-migrate'`;
ok(v28Judging.judging === null, 'a v2.5 program gets judging = NULL from the v2.8 migration');
// v2.8 Part E, Rulings 8 and 27 (plan): the submit kit's columns are additive; an existing program
// gets no submit host, no agent API and no form, and keeps them when the schema runs again.
const kitCols = async () =>
  (await db<{ submit_host: string | null; submit_api: boolean; form: unknown }[]>`
    SELECT submit_host, submit_api, form FROM programs WHERE id = 'v25-migrate'`)[0];
const kitOld = await kitCols();
ok(kitOld.submit_host === null && kitOld.form === null, 'a v2.5 program gets submit_host and form = NULL from the v2.8 migration');
ok(kitOld.submit_api === false, 'a v2.5 program gets submit_api = false from the v2.8 migration');
await db`UPDATE programs SET form = ${db.json({ url: 'https://tally.so/r/abc', fields: { name: 'project' }, sign_in: false, read_at: '2026-10-07' })} WHERE id = 'v25-migrate'`;
await db.unsafe(now);
ok(((await kitCols()).form as { url?: string } | null)?.url === 'https://tally.so/r/abc', 'a program form survives the schema running again');
await db`UPDATE programs SET form = NULL WHERE id = 'v25-migrate'`;
const [appCount] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM projects WHERE application IS NOT NULL`;
ok(appCount.n === 0, 'existing entries get application = NULL');
const [{ id: bankInst }] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('v28-bank') RETURNING id`;
await db`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id) VALUES (${bankInst}, 'name:tipjar', 'traction', '40 users', 'p')`;
let dupBank = false;
try {
  await db`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id) VALUES (${bankInst}, 'name:tipjar', 'traction', 'again', 'p')`;
} catch {
  dupBank = true;
}
ok(dupBank, 'answer_bank holds one row per installation, project and kind');
let longBank = false;
try {
  await db`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id) VALUES (${bankInst}, 'name:tipjar', 'team', ${'x'.repeat(4097)}, 'p')`;
} catch {
  longBank = true;
}
ok(longBank, 'answer_bank refuses an answer over 4096 characters');
await db.unsafe(now); // re-applying the schema keeps the bank
const [bankKept] = await db<{ answer: string }[]>`SELECT answer FROM answer_bank WHERE installation_id = ${bankInst}`;
ok(bankKept?.answer === '40 users', 'answer_bank rows survive the schema running again');
await db`DELETE FROM installations WHERE id = ${bankInst}`;
const [bankGone] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM answer_bank WHERE installation_id = ${bankInst}`;
ok(bankGone.n === 0, "an installation's bank goes with it (ON DELETE CASCADE)");

// v2.8 Rulings 1-3 (plan): complete_at and its one backfill, applied over real pre-v2.8 rows (the
// schema of f4923fb, v2.8 Part A on main, before these columns; Ruling C7 pins a commit on main). Proves no entry eligible before the migration
// loses it: the pre-v2.8 rule (inlined as it was) and eligibleSql after select the same rows.
const v28pre = execFileSync('git', ['-C', root, 'show', 'f4923fb:apps/frontend/db/schema.sql'], {
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
  (await db<{ id: number }[]>`SELECT p.id FROM projects p WHERE p.program_id = 'v28-elig' AND ${eligibleSql(ENDS, null)}`).map((r) => r.id),
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

// v2.8 Part G, Ruling 30 (plan): outcomes are additive. On the same pre-v2.8 rows: programs get no
// results, entries were never asked, installations fit no chain yet; entry_outcomes takes one row
// per entry, round and basis, refuses an unknown result or basis, survives the schema running
// again, and goes with its entry.
const [outcomeProg] = await db<{ results: unknown }[]>`SELECT results FROM programs WHERE id = 'v28-elig'`;
ok(outcomeProg.results === null, 'a pre-v2.8 program gets results = NULL');
const [asked] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM projects WHERE outcome_asked_at IS NOT NULL`;
ok(asked.n === 0, 'existing entries get outcome_asked_at = NULL');
const [{ id: fitInst }] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('v28-fit') RETURNING id`;
const [fit] = await db<{ fit_chains: string[] }[]>`SELECT fit_chains FROM installations WHERE id = ${fitInst}`;
ok(Array.isArray(fit.fit_chains) && fit.fit_chains.length === 0, "an installation's fit_chains defaults to an empty list");
const outcome = (result: string, basis: string, round = 'R1') => db`
  INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis)
  VALUES (${seeded.eligible}, 'v28-elig', ${round}, ${result}, ${basis})`;
await outcome('won', 'announcement');
await outcome('not_selected', 'self_reported');
const refused = async (f: () => Promise<unknown>) => {
  try {
    await f();
    return false;
  } catch {
    return true;
  }
};
ok(await refused(() => outcome('placed', 'announcement')), 'entry_outcomes holds one row per entry, round and basis');
ok(await refused(() => outcome('champion', 'announcement', 'R2')), 'entry_outcomes refuses an unknown result');
ok(await refused(() => outcome('won', 'rumour', 'R2')), 'entry_outcomes refuses an unknown basis');
await db.unsafe(now);
const [kept2] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM entry_outcomes WHERE project_id = ${seeded.eligible}`;
ok(kept2.n === 2, 'entry_outcomes rows survive the schema running again');
await db`DELETE FROM projects WHERE id = ${seeded.eligible}`;
const [gone] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM entry_outcomes WHERE project_id = ${seeded.eligible}`;
ok(gone.n === 0, "an entry's outcomes go with it (ON DELETE CASCADE)");

// v2.8.1 §E17/E18: a link and the hosted flag survive the schema running again.
const [{ id: rootInst }] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('v281-root') RETURNING id`;
await db`INSERT INTO installations (token_hash, builder_id, shared_client) VALUES ('v281-linked', ${rootInst}, true)`;
await db.unsafe(now);
const [linked] = await db<{ shared_client: boolean; builder_id: number | null }[]>`
  SELECT shared_client, builder_id FROM installations WHERE token_hash = 'v281-linked'`;
ok(linked.shared_client === true && linked.builder_id === rootInst, 'a link and the hosted flag survive the schema running again');

// v2.9 A5: the check cache and the verified columns; existing rows read as not verified.
const [v29] = await db<{ live_verified_at: Date | null; contract_verified_at: Date | null }[]>`
  SELECT live_verified_at, contract_verified_at FROM projects ORDER BY id LIMIT 1`;
ok(v29 && v29.live_verified_at === null && v29.contract_verified_at === null, 'existing entries get live_verified_at and contract_verified_at = NULL');
const [needs] = await db<{ n: number; set: number }[]>`
  SELECT count(*)::int AS n, count(needs_contract)::int AS set FROM programs`;
ok(needs.n > 0 && needs.set === 0, 'existing programs get needs_contract = NULL');
await db`INSERT INTO url_checks (key, ok) VALUES ('url:https://tipjar.xyz', true)`;
await db.unsafe(now);
const [check] = await db<{ ok: boolean; checked_at: Date }[]>`SELECT ok, checked_at FROM url_checks WHERE key = 'url:https://tipjar.xyz'`;
ok(check?.ok === true && check.checked_at instanceof Date, 'url_checks rows survive the schema running again, checked_at defaults to now()');
// v2.10 item 14 (R5): the note and count columns, added to a pre-v2.10 table; existing rows read
// as NULL, a note round-trips.
await db.unsafe('ALTER TABLE url_checks DROP COLUMN note; ALTER TABLE url_checks DROP COLUMN n;');
await db.unsafe(now);
const [noted] = await db<{ note: string | null; n: number | null }[]>`SELECT note, n FROM url_checks WHERE key = 'url:https://tipjar.xyz'`;
ok(noted && noted.note === null && noted.n === null, 'existing url_checks rows get note = NULL and n = NULL');
await db`INSERT INTO url_checks (key, ok, note, n) VALUES ('url:https://err.tipjar.xyz', false, 'This page could not be found', 3)`;
await db.unsafe(now);
const [noteKept] = await db<{ note: string | null; n: number | null }[]>`SELECT note, n FROM url_checks WHERE key = 'url:https://err.tipjar.xyz'`;
ok(noteKept?.note === 'This page could not be found' && noteKept.n === 3, 'url_checks note and n survive the schema running again');

// v2.9 A2: the product column and the program floor; existing rows read as unscored and no floor.
const [floor] = await db<{ n: number; set: number }[]>`
  SELECT count(*)::int AS n, count(*) FILTER (WHERE min_product_score <> 0)::int AS set FROM programs`;
ok(floor.n > 0 && floor.set === 0, 'existing programs get min_product_score = 0');
await db`INSERT INTO github_repo_facts (full_name, pushed_at, chains) VALUES ('v29/check', now(), '{}')`;
const [unscored] = await db<{ product: unknown }[]>`SELECT product FROM github_repo_facts WHERE full_name = 'v29/check'`;
ok(unscored && unscored.product === null, 'existing repo facts get product = NULL');
await db`UPDATE github_repo_facts SET product = '{"young":true}' WHERE full_name = 'v29/check'`;
await db.unsafe(now);
const [keptProduct] = await db<{ product: { young?: boolean } | null }[]>`SELECT product FROM github_repo_facts WHERE full_name = 'v29/check'`;
ok(keptProduct?.product?.young === true, 'github_repo_facts.product survives the schema running again');

// v2.9 A3: builder memory; rows survive the schema running again, defaults hold, statuses are checked.
const [{ id: memInst }] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('v29-memory') RETURNING id`;
await db`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${memInst}, 'arc-microgrants', 'not_interested')`;
await db`INSERT INTO builder_repo_facts (installation_id, repo_key) VALUES (${memInst}, 'alice/tipjar')`;
await db.unsafe(now);
const [said] = await db<{ mainnet_chains: string[]; testnet_chains: string[]; not_mine: boolean; at: Date }[]>`
  SELECT mainnet_chains, testnet_chains, not_mine, at FROM builder_repo_facts WHERE installation_id = ${memInst}`;
ok(said && said.mainnet_chains.length === 0 && said.testnet_chains.length === 0 && said.not_mine === false && said.at instanceof Date,
  'builder_repo_facts rows survive the schema running again with empty chains, not_mine false and at = now()');
const [status] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_program_status WHERE installation_id = ${memInst}`;
ok(status.n === 1, 'builder_program_status rows survive the schema running again');
const badStatus = await db`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${memInst}, 'x', 'won')`.then(
  () => false,
  () => true,
);
ok(badStatus, "builder_program_status only takes 'applied' or 'not_interested'");

// v2.9 A7, A8: fit_repos defaults to [], match_shown keeps one row per day, the floor columns start NULL.
const [fitRepos] = await db<{ fit_repos: unknown }[]>`SELECT fit_repos FROM installations WHERE id = ${memInst}`;
ok(Array.isArray(fitRepos?.fit_repos) && (fitRepos.fit_repos as unknown[]).length === 0, 'existing installations get fit_repos = []');
await db`INSERT INTO match_shown (installation_id, program_id, repo_key, status, product_score, row_level, day)
  VALUES (${memInst}, 'arc-microgrants', 'alice/tipjar', 'likely', 6, 'Easy', '2026-10-08')`;
const dupShown = await db`INSERT INTO match_shown (installation_id, program_id, repo_key, status, product_score, row_level, day)
  VALUES (${memInst}, 'arc-microgrants', 'alice/tipjar', 'likely', 6, 'Easy', '2026-10-08')`.then(() => false, () => true);
ok(dupShown, 'match_shown takes one row per (installation, program, repo, day)');
await db.unsafe(now);
const [shown] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM match_shown WHERE installation_id = ${memInst}`;
ok(shown.n === 1, 'match_shown rows survive the schema running again');
const [floors] = await db<{ set: number }[]>`
  SELECT count(*) FILTER (WHERE match_floor IS NOT NULL OR match_precision IS NOT NULL)::int AS set FROM programs`;
ok(floors.set === 0, 'existing programs get match_floor and match_precision = NULL');
const [scoreCol] = await db<{ n: number }[]>`SELECT count(product_score)::int AS n FROM projects`;
ok(scoreCol.n === 0, 'existing entries get product_score = NULL');

// v2.9 B9: builder memory keyed by login ('' = the installation's own); a database made before the
// column gets it and the wider primary key; sign-in nonces and verifications survive the schema again.
const [memLogin] = await db<{ login: string }[]>`SELECT login FROM builder_program_status WHERE installation_id = ${memInst}`;
ok(memLogin?.login === '', "existing builder memory gets login = ''");
await db`INSERT INTO builder_program_status (installation_id, login, program_id, status) VALUES (${memInst}, 'alice', 'arc-microgrants', 'applied')`;
const [twoLogins] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_program_status WHERE installation_id = ${memInst}`;
ok(twoLogins.n === 2, 'one program status per (installation, login, program)');
await db.unsafe(`ALTER TABLE builder_repo_facts DROP COLUMN login CASCADE; ALTER TABLE builder_repo_facts ADD PRIMARY KEY (installation_id, repo_key);`);
await db.unsafe(now);
const pk = await db<{ attname: string }[]>`
  SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'builder_repo_facts'::regclass AND i.indisprimary`;
ok(pk.map((r) => r.attname).sort().join(',') === 'installation_id,login,repo_key', 'an old builder_repo_facts gets login in its primary key');
const [keptFacts] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_repo_facts WHERE installation_id = ${memInst} AND login = ''`;
ok(keptFacts.n === 1, 'builder_repo_facts rows survive the key change');
await db`INSERT INTO github_verify_nonces (nonce_hash, installation_id, repo_key, purpose, expires_at)
  VALUES ('h1', ${memInst}, 'alice/tipjar', 'pickup', now() + interval '15 minutes')`;
const badPurpose = await db`INSERT INTO github_verify_nonces (nonce_hash, installation_id, repo_key, purpose, expires_at)
  VALUES ('h2', ${memInst}, 'alice/tipjar', 'login', now())`.then(() => false, () => true);
ok(badPurpose, "github_verify_nonces only takes 'entry', 'pickup' or 'host'");
await db`INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos)
  VALUES ('alice/tipjar', 'alice', ${memInst}, now(), 1)`;
await db.unsafe(now);
const [ver] = await db<{ purpose: string; used_at: Date | null; code_hash: string | null; n: number }[]>`
  SELECT purpose, used_at, code_hash, (SELECT count(*)::int FROM github_verify_nonces WHERE installation_id = ${memInst}) AS n
  FROM github_verifications WHERE installation_id = ${memInst}`;
ok(ver && ver.purpose === 'entry' && ver.used_at === null && ver.code_hash === null && ver.n === 1,
  "sign-in rows survive the schema running again; verifications default to purpose 'entry', unused, no code");

// v2.9 B10: token declines count per (installation, repo) and survive the schema running again.
await db`INSERT INTO token_declines (installation_id, repo_key) VALUES (${memInst}, 'alice/tipjar')`;
await db`INSERT INTO token_declines (installation_id, login, repo_key) VALUES (${memInst}, 'bob', 'alice/tipjar')`;
await db.unsafe(now);
const declined = await db<{ login: string; count: number; offers: string[] }[]>`
  SELECT login, count, offers FROM token_declines WHERE installation_id = ${memInst} ORDER BY login`;
ok(declined.length === 2 && declined[0].login === '' && declined[0].offers.length === 0,
  "token_declines keeps one row per installation, login ('' by default) and repo, and survives the schema running again");

const [firstReply] = await db<{ n: number }[]>`
  SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'token_offers' AND column_name = 'first_reply_at'`;
ok(firstReply.n === 1, 'token_offers has first_reply_at (Ruling G14)');

// v2.9 D16, D18: existing entries get no cached fee recipients; fee_claims takes only the four roles and
// survives the schema running again.
const [recipientsCol] = await db<{ n: number }[]>`SELECT count(fee_recipients)::int AS n FROM projects`;
ok(recipientsCol.n === 0, 'existing entries get fee_recipients = NULL');
await db`INSERT INTO fee_claims (tx_hash, owner, role, weth, gas_wei) VALUES ('0xc1', ${W}, 'creator', 10, 1)`;
const badRole = await db`INSERT INTO fee_claims (tx_hash, owner, role, weth, gas_wei) VALUES ('0xc2', ${W}, 'builder', 10, 1)`.then(
  () => false,
  () => true,
);
ok(badRole, "fee_claims only takes 'safe', 'bonus', 'creator' or 'mini'");
await db.unsafe(now);
const [claimRows] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM fee_claims`;
ok(claimRows.n === 1, 'fee_claims rows survive the schema running again');

// v2.9 C12-C14: hosted sites take only the four statuses, one per repo; the hosting rows and the
// free-tier counters survive the schema running again.
await db`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
  VALUES ('tipjar-alice', 'alice', 'alice/tipjar', ${memInst}, 100, 1, 'live')`;
const badSiteStatus = await db`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
  VALUES ('x-alice', 'alice', 'alice/x', ${memInst}, 1, 1, 'gone')`.then(() => false, () => true);
ok(badSiteStatus, "hosted_sites only takes 'live', 'review', 'killed', 'ended', 'deploying' or 'failed'");
const badDeployStatus = await db`INSERT INTO host_deploys (login, slug, status) VALUES ('alice', 'x', 'done')`.then(() => false, () => true);
ok(badDeployStatus, "host_deploys only takes 'deploying', 'live', 'review', 'failed' or 'cleaned'");
const twoPerRepo = await db`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
  VALUES ('tipjar2-alice', 'alice', 'alice/tipjar', ${memInst}, 1, 1, 'live')`.then(() => false, () => true);
ok(twoPerRepo, 'hosted_sites holds one site per repo');
await db`INSERT INTO host_deploys (login, slug) VALUES ('alice', 'tipjar-alice')`;
await db`INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at)
  VALUES ('h', ${memInst}, 'alice', 'alice/tipjar', 'tipjar-alice', 'TipJar', now())`;
await db`INSERT INTO free_tier_usage (name, period, used) VALUES ('r2Writes', '2026-10', 5)`;
await db.unsafe(now);
const [hostRows] = await db<{ s: number; d: number; t: number; f: number; flags: string[] }[]>`
  SELECT (SELECT count(*)::int FROM hosted_sites) AS s, (SELECT count(*)::int FROM host_deploys) AS d,
    (SELECT count(*)::int FROM host_upload_tokens) AS t, (SELECT used FROM free_tier_usage WHERE name = 'r2Writes') AS f,
    (SELECT flags FROM hosted_sites WHERE slug = 'tipjar-alice') AS flags`;
ok(hostRows.s === 1 && hostRows.d === 1 && hostRows.t === 1 && hostRows.f === 5 && hostRows.flags.length === 0,
  'hosting rows and free-tier counters survive the schema running again; flags default to none');

// v2.9 E19: a digest subscription keeps its opt-in and send times when the schema runs again; an
// email over 254 characters is refused; the question's time sits on the installation.
await db`UPDATE installations SET digest_asked_at = now() WHERE id = ${memInst}`;
await db`INSERT INTO digest_subscriptions (installation_id, email, opted_in_at, last_sent_at)
  VALUES (${memInst}, 'a@b.co', now(), now())`;
const longEmail = await db`UPDATE digest_subscriptions SET email = ${'a'.repeat(250) + '@b.co'} WHERE installation_id = ${memInst}`
  .then(() => false, () => true);
ok(longEmail, 'digest_subscriptions refuses an email over 254 characters');
// Ruling G21: one row per (installation, login); an opt-in always has an address.
await db`INSERT INTO digest_subscriptions (installation_id, login, asked_at) VALUES (${memInst}, 'alice', now())`;
const optedNoEmail = await db`UPDATE digest_subscriptions SET opted_in_at = now() WHERE installation_id = ${memInst} AND login = 'alice'`
  .then(() => false, () => true);
ok(optedNoEmail, 'digest_subscriptions refuses an opt-in without an email');
await db.unsafe(now);
const [digestRow] = await db<{ email: string; opted: boolean; sent: boolean; asked: boolean }[]>`
  SELECT d.email, d.opted_in_at IS NOT NULL AS opted, d.last_sent_at IS NOT NULL AS sent, i.digest_asked_at IS NOT NULL AS asked
  FROM digest_subscriptions d JOIN installations i ON i.id = d.installation_id WHERE d.installation_id = ${memInst} AND d.login = ''`;
ok(digestRow?.email === 'a@b.co' && digestRow.opted && digestRow.sent && digestRow.asked,
  'digest subscriptions and digest_asked_at survive the schema running again');

await db.end();
console.log(`db check: ${checks} checks passed`);
