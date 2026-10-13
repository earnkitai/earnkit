import type postgres from 'postgres';
import { archiveFlag, builderScoreEnabled } from './builder-score-flag';
import { sql } from './db';
import { testInstallationIds } from './installations';

/**
 * Builder bonus rounds (v2.5 §3). A program with an end date (`ends_at`) is one round per window,
 * open from `starts_at` (inclusive) to `ends_at` (exclusive), keyed `<program id>:YYYY-MM-DD` (the
 * window's UTC start day, Ruling 21): a re-run cohort under the same program id (a new start) is a
 * new round, while an extended or shortened end keeps the round, whose stored window follows the
 * program file until it freezes (bookDeposit, programs.ts upsertProgram). A windowed program needs
 * a `starts_at` to have a round (M4: never a window from 1970; program-file.ts refuses a builder
 * bonus without one). A rolling program (no `ends_at`) has UTC calendar-month rounds, keyed
 * `<program id>:YYYY-MM`, none before its `starts_at`.
 */
export type Round = { key: string; starts: Date; ends: Date };
type Window = { id: string; starts_at: Date | null; ends_at: Date | null };

/** A windowed program's round key: its id and its window's UTC start day (Ruling 21). Pure. */
export const windowKey = (id: string, startsAt: Date) => `${id}:${startsAt.toISOString().slice(0, 10)}`;

/**
 * Ruling 12 (plan): a round's URL slug, its key with the `:` as `-`
 * ("arc-microgrants-2026-09-16", "base-builder-grants-2026-10"). Pure.
 */
export const boardSlug = (roundKey: string) => roundKey.replace(':', '-');

/** v2.12: the program id of a round key (`windowKey`'s shape, or a month key), else null. Pure. */
export function programOfRound(key: string): string | null {
  return /^([a-z0-9-]{1,100}):\d{4}-\d{2}(?:-\d{2})?$/.exec(key)?.[1] ?? null;
}

/**
 * v2.12 final review (T14 ruling): the board states that stay public on /bonus/<round>: a frozen
 * round, the 48-hour review, and the payouts (paying, paid; win alerts link there, alerts.ts). Only
 * an open or empty round's board moves to the leaderboard. Pure.
 */
export const BOARD_STAYS: ReadonlySet<string> = new Set(['frozen', 'review', 'paying', 'paid']);
export const boardStays = (state: string) => BOARD_STAYS.has(state);

/**
 * v2.12 spec 9, owner rulings D1 and D5: where a program board goes, or null to render it as in
 * v2.11. Only with EARNKIT_BUILDER_SCORE=on (the leaderboard is a 404 before); never while the round
 * stays public (`stays`: boardStays, so the review and the payout proof stay public); never once the
 * boards are restored. The pages send it as a temporary redirect (307, final review M2): the flag
 * can still be turned off, and a cached 308 would strand visitors on a 404. Pure.
 */
export function boardRedirect(
  b: { program: string | null; stays: boolean },
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!builderScoreEnabled(env) || archiveFlag('PROGRAM_LEADERBOARDS', env) || b.stays || !b.program) return null;
  return `/leaderboard?program=${encodeURIComponent(b.program)}`;
}

/**
 * The round key of a board URL segment: a slug (boardSlug) or the v2.5 `:` form, returned as is.
 * Anything without a trailing date is returned unchanged (and finds no round). Pure.
 */
export function roundKeyFromSlug(slug: string) {
  if (slug.includes(':')) return slug;
  const m = /^(.+)-(\d{4}-\d{2}(?:-\d{2})?)$/.exec(slug);
  return m ? `${m[1]}:${m[2]}` : slug;
}

/**
 * The round key of a /bonus/[round] URL segment (the public board page uses it): the slug
 * "arc-microgrants-2026-09-16" or the v2.5 "arc-microgrants:2026-09-16" (also as %3A). Null for a
 * malformed escape (M1: the page answers a 404, never a 500). Pure.
 */
export function resolveRoundParam(raw: string): string | null {
  let round: string;
  try {
    round = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return roundKeyFromSlug(round);
}

/** The round of `program` open at `at`, or null. Pure. */
export function roundFor(program: Window, at: Date): Round | null {
  const t = at.getTime();
  if (program.starts_at && t < program.starts_at.getTime()) return null;
  if (program.ends_at) {
    if (!program.starts_at || t >= program.ends_at.getTime()) return null;
    return { key: windowKey(program.id, program.starts_at), starts: program.starts_at, ends: program.ends_at };
  }
  const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const starts = program.starts_at && program.starts_at > month ? program.starts_at : month;
  return { key: `${program.id}:${month.toISOString().slice(0, 7)}`, starts, ends: next };
}

/**
 * v2.6 §4, Ruling 7 (plan): whether a program's entries can earn the builder bonus. One rule for
 * booking, list_programs, the coin row, the board and the cron. SQL twin:
 * `g.status = 'active' AND g.builder_bonus AND g.campaign IS NULL`. Pure.
 */
export function bonusOn(p: { status: string; builder_bonus?: boolean | null; campaign?: unknown }) {
  return p.status === 'active' && p.builder_bonus !== false && (p.campaign === null || p.campaign === undefined);
}

/**
 * Where a deposit at `at` from a coin entered in `program` goes: its open round, or the Safe (v2.8.1
 * §D: bookDeposit then tries the repo's next open entry, `rollsOver`). The Safe when the program opted out (builder_bonus: false) or is a campaign, and
 * whenever it isn't 'active'. v2.6 drops v2.5's "no submission_proof → Safe" (Ruling 9); deposits
 * booked under it stay with the Safe (Ruling 2 (plan)). Pure.
 */
export function bookingFor(
  program: Window & { status: string; builder_bonus?: boolean | null; campaign?: unknown },
  at: Date,
): { destination: 'round'; round: Round } | { destination: 'safe'; reason: string } {
  // fix round 1 (Minor 2): the opt-out/campaign test is bonusOn's own (status forced 'active' so
  // only that part of the rule is checked here); the status check stays below, for its own reason.
  if (!bonusOn({ ...program, status: 'active' }))
    return { destination: 'safe', reason: 'builder bonus off' };
  const round = program.status !== 'active' ? null : roundFor(program, at);
  return round ? { destination: 'round', round } : { destination: 'safe', reason: 'no open round' };
}

/**
 * v2.8.1 §D (option B): whether a deposit at `at` from a coin entered in `program` rolls over to
 * the repo's next open entry, because the program's round is over: the program has the builder
 * bonus (not opted out, not a campaign), the deposit is not before its start, and the program has
 * ended by `at` (its `ends_at` passed, or it is no longer active; a rolling program ends only when
 * it closes). A round that froze while its window still runs is the caller's case (bookDeposit).
 * Pure.
 */
export function rollsOver(program: Window & { status: string; builder_bonus?: boolean | null; campaign?: unknown }, at: Date) {
  if (!bonusOn({ ...program, status: 'active' })) return false;
  if (program.starts_at && at.getTime() < program.starts_at.getTime()) return false;
  return program.status !== 'active' || (program.ends_at !== null && at.getTime() >= program.ends_at.getTime());
}

/**
 * v2.8.1 §D: the rounds a rolled-over deposit at `at` may book to, earliest first (by end, then
 * start, then key): the round open at `at` of each candidate program that has the builder bonus
 * (bonusOn). The caller takes the first whose stored round is still 'open'. Pure.
 */
export function rolloverRounds(
  programs: (Window & { status: string; builder_bonus?: boolean | null; campaign?: unknown })[],
  at: Date,
): { programId: string; round: Round }[] {
  return programs
    .filter((p) => bonusOn(p))
    .flatMap((p) => {
      const round = roundFor(p, at);
      return round ? [{ programId: p.id, round }] : [];
    })
    .sort(
      (a, b) =>
        a.round.ends.getTime() - b.round.ends.getTime() ||
        a.round.starts.getTime() - b.round.starts.getTime() ||
        (a.round.key < b.round.key ? -1 : a.round.key > b.round.key ? 1 : 0),
    );
}

export type BonusProgram = Window & { status: string; builder_bonus: boolean | null; campaign: unknown; title: string };

/**
 * v2.8.1 §D: the programs a deposit at `at` of the repo's token (entered by project `coin.project`
 * in `coin.program`) may roll over to: other programs where the same repo (`bonus_repo_key`) has
 * an entry submitted (`submission_proof_ok_at`) and complete (`complete_at`) by `at`, never
 * skipped, not an owner test installation (nor the token's own entry). Both stamps are judged at
 * `at`, so re-indexing books the same way. rolloverRounds orders their rounds. F7: a rolling
 * (monthly) home program never ends by date, so its token keeps funding its own next month.
 */
export async function rolloverPrograms(
  db: postgres.Sql | postgres.TransactionSql,
  coin: { project: number; program: string; repoKey: string | null },
  at: Date,
): Promise<BonusProgram[]> {
  if (!coin.repoKey) return [];
  return db<BonusProgram[]>`
    SELECT DISTINCT g.id, g.title, g.starts_at, g.ends_at, g.status, g.builder_bonus, g.campaign
    FROM projects e JOIN programs g ON g.id = e.program_id
    WHERE e.bonus_repo_key = ${coin.repoKey} AND e.id <> ${coin.project} AND e.program_id <> ${coin.program}
      AND e.submission_proof_ok_at <= ${at} AND e.complete_at <= ${at}
      AND e.confirm_choice IS DISTINCT FROM 'skip'
      AND NOT COALESCE(e.installation_id = ANY(${testInstallationIds()}::int[]), false)
      -- T5 fix round 1 (Minor 8): an owner test installation's token never rolls into a real round.
      AND NOT EXISTS (SELECT 1 FROM projects tk WHERE tk.id = ${coin.project}
        AND COALESCE(tk.installation_id = ANY(${testInstallationIds()}::int[]), false))`;
}

/**
 * v2.8.1 §D: the round a token's fees book to at `now`, by bookDeposit's rule without writing:
 * its own program's round while that is open (`round` null when the program has no round yet,
 * e.g. a windowed program with no start, while it still runs); once that is over (rollsOver, or
 * its round froze), the earliest still-open round it rolls over to (rolloverPrograms,
 * rolloverRounds). Null: the Safe. `home`: the token's project, its program and its repo key.
 */
export async function currentBonusRound(
  home: BonusProgram & { project: number; repo_key: string | null },
  now = new Date(),
): Promise<{ program_id: string; title: string; round: Round | null } | null> {
  if (!bonusOn({ ...home, status: 'active' })) return null;
  const stateOf = async (key: string) =>
    (await sql()<{ state: string }[]>`SELECT state FROM bonus_rounds WHERE round_key = ${key}`)[0]?.state ?? 'open';
  const b = bookingFor(home, now);
  let over = rollsOver(home, now);
  if (b.destination === 'round') {
    if ((await stateOf(b.round.key)) === 'open') return { program_id: home.id, title: home.title, round: b.round };
    over = true;
  }
  // Not over yet: the bonus still rides on the token's own entry.
  if (!over) return { program_id: home.id, title: home.title, round: null };
  const programs = await rolloverPrograms(sql(), { project: home.project, program: home.id, repoKey: home.repo_key }, now);
  for (const c of rolloverRounds(programs, now))
    if ((await stateOf(c.round.key)) === 'open')
      return { program_id: c.programId, title: programs.find((p) => p.id === c.programId)!.title, round: c.round };
  return null;
}

/**
 * v2.8.1 §D, the T4 carry: the program whose round the repo's token fees book to now, for every
 * builder-facing bonus note ("Your builder bonus rides on your <title> entry."): currentBonusRound
 * of the repo's token. Null when the fees go to the Safe; undefined when the repo has no EarnKit
 * token, or its program has no builder bonus (the caller keeps its own wording).
 */
export async function bonusEntryProgram(
  repoKey: string,
  now = new Date(),
): Promise<{ program_id: string; title: string } | null | undefined> {
  const [home] = await sql()<(BonusProgram & { project: number; repo_key: string | null })[]>`
    SELECT p.id AS project, p.token_repo_key AS repo_key, g.id, g.title, g.starts_at, g.ends_at, g.status, g.builder_bonus, g.campaign
    FROM projects p JOIN programs g ON g.id = p.program_id
    WHERE p.token_repo_key = ${repoKey} AND p.token_url IS NOT NULL
    ORDER BY p.id LIMIT 1`;
  // No token, or its program never had the builder bonus (an opt-out, a campaign): nothing rolls.
  if (!home || !bonusOn({ ...home, status: 'active' })) return undefined;
  const r = await currentBonusRound(home, now);
  return r && { program_id: r.program_id, title: r.title };
}

/** v2.10 item 1: an open round's builder bonus pool so far, in wei, and the tokens launched in it. */
export type RoundPool = { wei: bigint; tokens: number };

/**
 * The builder bonus pool so far of each program's round open now, by program id, with the count of
 * tokens launched in that round, in ONE grouped read (Ruling 3; v2.10 item 1 adds the count). Only
 * active programs whose round is open now (never a future `starts_at` or an ended window), only
 * this month's round of a rolling program. A program missing from the map has no pool and no token
 * yet. A program whose current round exists but is no longer 'open' (it froze, then the file moved
 * its end or re-ran the same start day) maps to null: its bonus is not available (I2). The round
 * key is computed in SQL exactly as `roundFor` does (UTC start day; UTC month). A token counts when
 * its entry is in the program, it launched (coin_address) at or after the round's start (the
 * program's starts_at; a rolling program's UTC month start), and it isn't an owner test
 * installation's.
 */
export async function roundPools(
  programIds: string[],
  opts: { now?: Date; onQuery?: () => void } = {},
): Promise<Map<string, RoundPool | null>> {
  if (programIds.length === 0) return new Map();
  const now = opts.now ?? new Date();
  // Task 11 fix (DB+anvil run): a live read (no opts.now) counts every launched token. The upper
  // bound is only for an "as of" read: the app's clock is in milliseconds and the database's
  // coin_launched_at in microseconds (and on another machine), so a token launched a moment before
  // the read could fall after `now` and the reply would say "no tokens yet" under its own token.
  const live = opts.now === undefined;
  const testIds = testInstallationIds();
  opts.onQuery?.();
  const rows = await sql()<{ id: string; state: string | null; wei: string | null; tokens: number }[]>`
    WITH open AS (
      SELECT p.id,
        CASE WHEN p.ends_at IS NULL
          THEN p.id || ':' || to_char(${now}::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM')
          ELSE p.id || ':' || to_char(p.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS round_key,
        CASE WHEN p.ends_at IS NULL
          THEN date_trunc('month', ${now}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          ELSE p.starts_at END AS round_start
      FROM programs p
      WHERE p.id IN ${sql()(programIds)} AND p.status = 'active'
        AND (p.starts_at IS NULL OR p.starts_at <= ${now})
        AND (p.ends_at IS NULL OR (p.starts_at IS NOT NULL AND ${now} < p.ends_at))
    )
    SELECT o.id, r.state,
      (SELECT sum(l.amount_wei) FROM bonus_ledger l WHERE l.round_key = o.round_key AND l.destination = 'round')::text AS wei,
      (SELECT count(*) FROM projects t
        WHERE t.program_id = o.id AND t.coin_address IS NOT NULL AND t.coin_launched_at >= o.round_start
          AND (${live} OR t.coin_launched_at <= ${now})
          AND NOT COALESCE(t.installation_id = ANY(${testIds}::int[]), false))::int AS tokens
    FROM open o LEFT JOIN bonus_rounds r ON r.round_key = o.round_key`;
  const out = new Map<string, RoundPool | null>();
  for (const r of rows) {
    if (r.state !== null && r.state !== 'open') out.set(r.id, null);
    else if (r.wei !== null || r.tokens > 0) out.set(r.id, { wei: r.wei === null ? 0n : BigInt(r.wei), tokens: r.tokens });
  }
  return out;
}

/**
 * roundPools' pools in wei, for programs with booked deposits (wei > 0) or a frozen round (null),
 * as before v2.10: the public pages' "0.42 ETH so far" and the guide pill.
 */
export async function roundPoolsWei(
  programIds: string[],
  opts: { now?: Date; onQuery?: () => void } = {},
): Promise<Map<string, bigint | null>> {
  const out = new Map<string, bigint | null>();
  for (const [id, pool] of await roundPools(programIds, opts)) {
    if (pool === null) out.set(id, null);
    else if (pool.wei > 0n) out.set(id, pool.wei);
  }
  return out;
}
