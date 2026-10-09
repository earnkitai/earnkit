import { sql } from './db';
import { placesFor, roundRows, type BonusPayoutRow, type BonusTerms } from './bonus-payout';
import { bonusOn, roundFor } from './bonus-rounds';
import { roundEndLabel } from './entry-text';
import { testInstallationIds } from './installations';
import { coinSql, eligibleSql } from './traction';
import { shownUrl } from './untrusted-text';

/**
 * The public builder bonus leaderboard of one round (/bonus/<round>, v2.5 §4). Public data only:
 * project names, their canonical https links, scores, eligibility in plain words, each place's
 * amount and, once mined, its payout transaction. Never a wallet, a review flag, a veto reason or
 * a signal breakdown (those are the owner's review page).
 * - open (and frozen, before the review opens): every entry of the program, the eligible ones
 *   ranked by the round's latest traction scores.
 * - review, paying, paid: the frozen ranking (bonus_payouts) minus the entries removed in review,
 *   renumbered, the top 10 plus any entry holding a place.
 */
export type BoardRow = {
  rank: number | null;
  name: string;
  repo_url: string | null;
  live_url: string | null;
  score: string | null;
  eligible: boolean;
  note: string;
  /** This place's amount in ETH (frozen ranking only). */
  amount: string | null;
  /** The mined payout transaction (paid rows only). */
  tx: string | null;
};

export type BoardState = 'open' | 'frozen' | 'review' | 'paying' | 'paid' | 'empty';

export type Board = {
  round: string;
  title: string;
  state: BoardState;
  ends_at: Date;
  /** Ruling 29: the round's end as the first message and the entry reply show it ("Oct 14"). */
  ends_label: string;
  review_until: Date | null;
  /** The round's pool so far (frozen at the review), ETH. */
  pool: string;
  days_left: number;
  rows: BoardRow[];
  /** Entries removed in review (frozen ranking only). */
  removed: number;
};

const DAY_MS = 86_400_000;

/** Whole days until `ends`, rounded up; 0 once it has passed. Pure. */
export const daysLeft = (ends: Date, now: Date) => Math.max(0, Math.ceil((ends.getTime() - now.getTime()) / DAY_MS));

/** ETH from wei, up to 4 decimals, rounded down; "under 0.0001" for dust. Pure. */
export function ethText(wei: bigint) {
  if (wei <= 0n) return '0';
  const units = wei / 10n ** 14n;
  if (units === 0n) return 'under 0.0001';
  const frac = (units % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${units / 10_000n}.${frac}` : `${units / 10_000n}`;
}

const scoreText = (s: number | null) => (s === null ? null : s.toFixed(1));

export type OpenEntry = {
  id: number;
  name: string;
  repo_url: string | null;
  live_url: string | null;
  coin: boolean;
  proof: boolean;
  /** The program has a public entry page pattern (else the builder's confirmation counts). */
  pattern: boolean;
  /** v2.8 Ruling 2 (plan): the entry was complete before the round's end (complete_at). */
  complete: boolean;
  /** v2.8 Ruling 3 (plan): the builder confirmed the entry with "skip" (no token, no bonus). */
  skipped: boolean;
  eligible: boolean;
  /** v2.6 §5, Ruling 6 (plan): an owner test installation (EARNKIT_TEST_INSTALLATIONS). */
  test: boolean;
  rank: number | null;
  score: number | null;
  submitted_at: Date;
};

/** Why an entry isn't eligible, in plain words (v2.8 Rulings 2-3 (plan): a skip, then an incomplete entry). Pure. */
const notEligible = (e: OpenEntry) =>
  e.skipped
    ? 'No: entered without a token'
    : !e.coin
      ? 'No: no token'
      : !e.complete
        ? 'No: entry incomplete'
        : !e.proof
          ? e.pattern
            ? 'No: submission page not confirmed yet'
            : 'No: submission not confirmed yet'
          : 'No: an earlier entry of this repo counts';

/**
 * An open round's rows: eligible entries with a score first, by their stored rank renumbered 1..n
 * (an entry that lost eligibility since keeps no rank), then eligible entries not scored yet, then
 * the rest with the reason — an owner test installation (v2.6 Ruling 6 (plan)) listed among them
 * as `Test entry: not ranked`, never scored or ranked whatever its own eligible/rank fields say.
 * Pure.
 */
export function openRows(entries: OpenEntry[]): BoardRow[] {
  const byTime = (a: OpenEntry, b: OpenEntry) => a.submitted_at.getTime() - b.submitted_at.getTime() || a.id - b.id;
  const ranked = entries.filter((e) => !e.test && e.eligible && e.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const waiting = entries.filter((e) => !e.test && e.eligible && e.rank === null).sort(byTime);
  const out = entries.filter((e) => e.test || !e.eligible).sort(byTime);
  const row = (e: OpenEntry, rank: number | null, note: string): BoardRow => ({
    rank,
    name: e.name,
    repo_url: shownUrl(e.repo_url),
    live_url: shownUrl(e.live_url),
    score: rank === null ? null : scoreText(e.score),
    eligible: e.test ? false : e.eligible,
    note,
    amount: null,
    tx: null,
  });
  return [
    ...ranked.map((e, i) => row(e, i + 1, 'Yes')),
    ...waiting.map((e) => row(e, null, 'Yes, not scored yet')),
    ...out.map((e) => row(e, null, e.test ? 'Test entry: not ranked' : notEligible(e))),
  ];
}

type Names = Map<number, { name: string; repo_url: string | null; live_url: string | null }>;

/**
 * A frozen round's rows: the frozen ranking without removed entries, renumbered, the first 10
 * plus any entry further down holding a place (placesFor, the payout's own rule), with its place
 * amount, and the transaction once the payout is mined. Pure.
 */
export function frozenRows(rows: BonusPayoutRow[], amounts: bigint[], names: Names): { rows: BoardRow[]; removed: number } {
  const places = new Map(placesFor(rows, amounts).map((p) => [p.project_id, p]));
  const kept = [...rows].filter((r) => !r.vetoed).sort((a, b) => a.rank - b.rank);
  const shown = kept
    .map((r, i) => ({ r, rank: i + 1 }))
    .filter(({ r, rank }) => rank <= 10 || places.has(r.project_id));
  return {
    removed: rows.length - kept.length,
    rows: shown.map(({ r, rank }) => {
      const n = names.get(r.project_id);
      const place = places.get(r.project_id);
      return {
        rank,
        name: n?.name ?? 'Entry',
        repo_url: shownUrl(n?.repo_url),
        live_url: shownUrl(n?.live_url),
        score: scoreText(r.score),
        eligible: true,
        note: 'Yes',
        amount: place ? ethText(place.amount) : null,
        tx: r.status === 'paid' && r.tx_hash ? r.tx_hash : null,
      };
    }),
  };
}

type RoundRow = {
  round_key: string;
  program_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  state: BoardState;
  review_until: Date | null;
  terms: BonusTerms | null;
  summary: string;
  program_ends_at: Date | null;
};

/**
 * The board of `roundKey`, or null when it isn't a round. A round with no deposit yet has no
 * bonus_rounds row: it still shows (pool 0) while it is the open round of an active program whose
 * entries can earn the builder bonus (bonusOn's SQL twin).
 */
export async function bonusBoard(roundKey: string, now = new Date()): Promise<Board | null> {
  let [r] = await sql()<RoundRow[]>`
    SELECT b.round_key, b.program_id, p.title, b.starts_at, b.ends_at, b.state, b.review_until, b.terms,
      p.summary, p.ends_at AS program_ends_at
    FROM bonus_rounds b JOIN programs p ON p.id = b.program_id WHERE b.round_key = ${roundKey}`;
  if (!r) {
    const [p] = await sql()<{ id: string; title: string; summary: string; status: string; starts_at: Date | null; ends_at: Date | null; builder_bonus: boolean | null; campaign: unknown }[]>`
      SELECT id, title, summary, status, starts_at, ends_at, builder_bonus, campaign FROM programs WHERE id = ${roundKey.split(':')[0]}`;
    const round = p && bonusOn(p) ? roundFor(p, now) : null;
    if (!p || round?.key !== roundKey) return null;
    r = { round_key: roundKey, program_id: p.id, title: p.title, starts_at: round.starts, ends_at: round.ends, state: 'open', review_until: null, terms: null, summary: p.summary, program_ends_at: p.ends_at };
  }
  const base = {
    round: r.round_key,
    title: r.title,
    state: r.state,
    ends_at: r.ends_at,
    ends_label: roundEndLabel({ summary: r.summary, ends_at: r.program_ends_at }, r.ends_at),
    review_until: r.review_until,
    days_left: daysLeft(r.ends_at, now),
  };
  if (r.state === 'open' || r.state === 'frozen') {
    const [{ wei }] = await sql()<{ wei: string }[]>`
      SELECT COALESCE(sum(amount_wei), 0)::text AS wei FROM bonus_ledger WHERE round_key = ${r.round_key} AND destination = 'round'`;
    const testIds = testInstallationIds();
    const entries = await sql()<OpenEntry[]>`
      -- v2.10 R10: a private repo's URL never reaches the public board (the project name only).
      SELECT p.id, p.name, CASE WHEN p.repo_private THEN NULL ELSE p.repo_url END AS repo_url, p.live_url, p.submitted_at,
        (p.coin_address IS NOT NULL OR ${coinSql('p', r.ends_at, r.round_key)}) AS coin, (p.submission_proof_ok_at IS NOT NULL) AS proof,
        (g.submission_proof IS NOT NULL) AS pattern,
        (p.complete_at IS NOT NULL AND p.complete_at < ${r.ends_at}) AS complete,
        (p.confirm_choice IS NOT DISTINCT FROM 'skip') AS skipped,
        (${eligibleSql(r.ends_at, r.round_key)}) AS eligible,
        COALESCE(p.installation_id = ANY(${testIds}::int[]), false) AS test, s.rank, s.score
      FROM projects p
      JOIN programs g ON g.id = p.program_id
      LEFT JOIN LATERAL (
        SELECT rank, score FROM bonus_scores b
        WHERE b.round_key = ${r.round_key} AND b.project_id = p.id ORDER BY b.day DESC LIMIT 1) s ON true
      WHERE p.program_id = ${r.program_id} AND p.submitted_at < ${r.ends_at}
        -- v2.8 Ruling C10: an entry confirmed at the confirmation step shows only once the builder
        -- has submitted it (a recorded submission, their word, or a proof); never before.
        AND (p.confirmed_at IS NULL OR p.submission_proof_ok_at IS NOT NULL OR p.submission_confirmed_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM submissions su WHERE su.project_id = p.id))
      ORDER BY s.rank NULLS LAST, p.submitted_at, p.id
      LIMIT 500`;
    return { ...base, pool: ethText(BigInt(wei)), rows: openRows(entries), removed: 0 };
  }
  const frozen = await roundRows(r.round_key);
  const ids = frozen.map((x) => x.project_id);
  const names: Names = new Map(
    (ids.length
      ? await sql()<{ id: number; name: string; repo_url: string | null; live_url: string | null }[]>`
          SELECT id, name, CASE WHEN repo_private THEN NULL ELSE repo_url END AS repo_url, live_url FROM projects WHERE id IN ${sql()(ids)}`
      : []
    ).map((p) => [p.id, p]),
  );
  const { rows, removed } = frozenRows(frozen, (r.terms?.amounts ?? []).map(BigInt), names);
  return { ...base, pool: ethText(BigInt(r.terms?.pool_wei ?? '0')), rows, removed };
}
