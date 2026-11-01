import { getAddress } from 'viem';
import { sql, type Db } from './db';
import { prizeColumn, usd, wonUsdText, type CampaignConfig, type EarnKitCampaign } from './campaigns';
import { prizeOf, shortWallet } from './entry-text';
import { hoursLeft } from './deadline';
import { COIN_PROGRAM } from './policy-constants';
import { cachedFeesUsd, feeAlert } from './fees';
import { campaignCandidates } from './leaderboard';
import { difficultyOf, rowDifficulty, type Difficulty } from './guide';
import { applyBuilderFacts, EFFORT_ORDER, fitsWideProgram, matchRepo, onlyMentioned, type Chain, type Detection, type Product, type ProgramFacts, type RepoFacts, type Verdict } from './match';
import { hiddenIds, hiddenPrograms, type BuilderMemory, type SaidRepo } from './builder-memory';
import type { PastRound } from './program-file';
import { winLine } from './outcomes';
import { eth } from './present';
import { eligibleSql } from './traction';
import { pickWinners } from './winners';
import { perWinnerUsd, type ProgramRow } from './programs';

/** The checksummed form (M2, fix round 1): `bonus_payouts.wallet` is stored lowercase; a builder
 * confirmed the checksummed form on the coin's wallet line, so the alert should match it. Falls
 * back to the raw value on anything that isn't a valid address (defensive; never throws). */
const checksummed = (w: string) => {
  try {
    return getAddress(w);
  } catch {
    return w;
  }
};

/**
 * What alerts remember per installation: whether each scored entry was in the top N, and the ids
 * already announced (campaigns, prize-winning projects). Ids, not time, decide what is news, so
 * nothing paid or opened around a check is lost. Older rows may lack the id lists.
 * `bonusTop`/`bonusWins` (v2.5 §3): the builder bonus's own rank-tracking and seen-win ids, kept
 * apart from the EarnKit/sponsor campaign ones (`top`/`prizes`) since a project can be in both.
 */
export type AlertState = {
  top: Record<string, boolean>;
  campaigns?: string[];
  prizes?: number[];
  bonusTop?: Record<string, boolean>;
  /** Seen builder bonus wins by bonus_payouts.id (M2: one entry can win several rounds). */
  bonusWins?: number[];
  /** v2.8 Part G: seen announced outcomes by entry_outcomes.id (win alerts show each once). */
  outcomes?: number[];
  /**
   * v2.8 Ruling 10 (plan): curated programs already announced, or open when tracking began, or not
   * a fit when they opened. Absent on rows from before v2.8 (then "opened since the last check").
   */
  newPrograms?: string[];
};
export type AlertMemory = { checkedAt: Date | null; state: AlertState | null; feeAlertedUsd: number | null };

/**
 * A builder bonus round payout, already paid (v2.5 §3). THE SEAM: Task 7 ("Round lifecycle and
 * WETH payouts") pays round winners and must record each one somewhere queryable by project. Until
 * then, `paidBonusWins` (below) finds nothing, so this list is always empty and the alert it feeds
 * never fires — nothing here needs to change once Task 7 lands, only `paidBonusWins`'s query.
 */
export type BonusWin = {
  /** bonus_payouts.id: one per round win, so a second round's win of the same entry is news too (M2). */
  id: number;
  project_id: number;
  name: string;
  program_title: string;
  amount_wei: bigint;
  tx_hash: string;
  paid_at: Date;
  /** bonus_payouts.wallet: the entry's creator_wallet at payout time (Ruling 14), for the alert line (v2.6 §3). */
  wallet: string | null;
  /** The round this win was paid for, for its leaderboard link (v2.6 §3, Ruling 12 (plan)). */
  round_key: string;
};
/** Where an eligible entry stands in its open builder bonus round right now (v2.5 §3, from bonus_scores). */
export type BonusStanding = {
  project_id: number;
  program_title: string;
  inTop: boolean;
  /** The open round, for its leaderboard link (v2.6 §3, Ruling 12 (plan)). */
  round_key: string;
};
export type AlertFacts = {
  newCampaigns: { id: string; title: string; prize: string; opened_at: Date }[];
  standings: { project_id: number; name: string; campaign_title: string; winners: number; scored: boolean; inTop: boolean }[];
  prizes: { project_id: number; name: string; won: string; prize_tx: string; paid_at: Date }[];
  fees: { usd: number; tokens: { url: string; symbol: string | null }[] } | null;
  bonusWins: BonusWin[];
  bonusStandings: BonusStanding[];
  /** v2.8 Ruling 10 (plan): open curated programs (newProgramLines picks the new ones that fit). */
  newPrograms: NewProgram[];
  /** v2.9 A7: the builder's best owned repos when they last matched (installations.fit_repos). */
  fitRepos: FitRepo[];
  /** v2.9 A7: programs never alerted: entered, or applied outside EarnKit / not interested (builder memory). */
  skip: AlertSkip;
  /** v2.8 Part G: announced wins (won or placed) of this installation's entries; never a self-report. */
  outcomeWins: OutcomeWin[];
  /** v2.10 item 15: this installation's entries, for the deadline line (the read that builds skip.entered). */
  entries: DeadlineEntry[];
};

/**
 * v2.10 item 15: an entry as the deadline line reads it. `ends_at` is its program's deadline (null:
 * rolling, a campaign, or the program isn't active); `submitted` as projects.ts openEntries says it.
 */
export type DeadlineEntry = { id: number; title: string; ends_at: Date | null; submitted: boolean };

/** v2.10 item 15: the deadline line covers entries closing within this many days. */
export const DEADLINE_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * v2.10 item 15: the soonest unsubmitted entry closing within DEADLINE_DAYS that wasn't shown today
 * (`shown`: entry id to the UTC day it was last shown): "Arc Microgrants closes in 2 days; your entry
 * isn't submitted." ("closes in 20 hours" under 48 h, v4.8.1 final fix R-3). The days are whole days left
 * before the program's own deadline instant (rounded down), so the line never reads later than the
 * program's own close, whatever its time zone (Pre-flight P1). Null when none. Pure.
 */
export function deadlineLine(entries: DeadlineEntry[], shown: Record<string, string>, now: Date): { line: string; id: number } | null {
  const day = now.toISOString().slice(0, 10);
  const e = entries
    .filter(
      (x) =>
        !x.submitted &&
        x.ends_at !== null &&
        x.ends_at > now &&
        x.ends_at.getTime() - now.getTime() <= DEADLINE_DAYS * DAY_MS &&
        shown[String(x.id)] !== day,
    )
    .sort((a, b) => a.ends_at!.getTime() - b.ends_at!.getTime())[0];
  if (!e) return null;
  const days = Math.floor((e.ends_at!.getTime() - now.getTime()) / DAY_MS);
  // v4.8.1 final fix (R-3): under 48 hours the time left (deadline.ts hoursLeft), never "today" or "tomorrow".
  const when = hoursLeft(e.ends_at!.toISOString(), now) ?? `in ${days} days`;
  return { id: e.id, line: `${e.title} closes ${when}; your entry isn't submitted.` };
}

/**
 * v2.10 item 15: the deadline line for this reply, once per entry per UTC day
 * (`installations.deadline_shown`). The mark is one conditional UPDATE, so two replies at once show
 * it once. Never throws: on an error, no line.
 */
export async function takeDeadlineLine(installationId: number, entries: DeadlineEntry[], now = new Date()): Promise<string | null> {
  if (entries.length === 0) return null;
  try {
    const [row] = await sql()<{ deadline_shown: Record<string, string> | null }[]>`
      SELECT deadline_shown FROM installations WHERE id = ${installationId}`;
    const pick = deadlineLine(entries, row?.deadline_shown ?? {}, now);
    if (!pick) return null;
    const day = now.toISOString().slice(0, 10);
    const id = String(pick.id);
    const taken = await sql()<{ id: number }[]>`
      UPDATE installations
      SET deadline_shown = COALESCE(deadline_shown, '{}'::jsonb) || jsonb_build_object(${id}::text, ${day}::text)
      WHERE id = ${installationId} AND COALESCE(deadline_shown->>${id}::text, '') <> ${day}
      RETURNING id`;
    return taken.length > 0 ? pick.line : null;
  } catch (err) {
    console.error('[deadline]', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * v2.8 Ruling 10 (plan); v2.9 A7: an open curated program, as new program alerts read it: the facts
 * matching reads (matchRepo), the program level (difficultyOf) and its match precision (rowDifficulty).
 */
export type NewProgram = {
  id: string;
  title: string;
  prize: string;
  chains: Chain[];
  any_chain: boolean;
  opened_at: Date;
  ends_at: Date | null;
  max_award_usd: number | null;
  investment: boolean;
  min_product_score: number;
  tag: string | null;
  existing_work: ProgramFacts['existing_work'];
  starts_at: Date | null;
  difficulty: Difficulty;
  past_rounds: PastRound[];
  match_floor: number | null;
  match_precision: number | null;
};

/**
 * v2.9 A7: one of the builder's best owned repos as it last matched (installations.fit_repos), so
 * alerts make no GitHub call. `homepage` is the repo's own link (a link only the builder gave is in
 * `said`, so it stays a claim); `said` is what the builder told EarnKit about it.
 */
export type FitRepo = {
  key: string;
  name: string;
  url: string;
  homepage: string | null;
  created_at: string;
  chains: Detection;
  product: Product;
  live_verified: boolean;
  said: SaidRepo | null;
  /** v2.10.1 B2: the transaction count read for its contracts (real use); absent on rows from before v2.10.1 (unknown). */
  tx_count?: number | null;
};
/**
 * v2.9 A7 (Pre-flight P13): a matched repo as alerts remember it, from its merged facts. A live link
 * only the builder gave is left out of `homepage` (it is in `said`), so it stays a claim; null for a
 * fit without facts or a score. Pure.
 */
export function fitRepoOf(
  f: { key?: string; repo: string; repo_url: string | null; product?: Product; live_verified?: boolean; facts?: RepoFacts },
  said: SaidRepo | null,
): FitRepo | null {
  const facts = f.facts;
  const product = f.product ?? facts?.product;
  if (!facts || !product) return null;
  return {
    key: f.key ?? f.repo,
    name: facts.name,
    url: facts.url,
    homepage: facts.claims?.includes('live') ? null : facts.homepage,
    created_at: facts.created_at,
    chains: facts.chains,
    product,
    live_verified: (f.live_verified ?? facts.live_verified) === true,
    said,
    tx_count: facts.tx_count ?? null,
  };
}

export type AlertSkip = { entered: Set<string>; hidden: Set<string> };
export const NO_SKIP: AlertSkip = { entered: new Set(), hidden: new Set() };
/** v2.8 Part G: an announced win (entry_outcomes, basis 'announcement', result won or placed). */
export type OutcomeWin = { id: number; project_id: number; name: string; program_title: string; prize_usd: number | null; captured_at: Date };

/** At most this many prize lines per check (a wallet added later may bring several old wins). */
export const MAX_PRIZE_LINES = 3;
/** At most this many builder bonus win lines per check, same reasoning as MAX_PRIZE_LINES. */
export const MAX_BONUS_WIN_LINES = 3;
/** v2.8 Ruling 10 (plan): at most this many new program lines per check; the rest wait for the next. */
export const MAX_NEW_PROGRAM_LINES = 3;
/** v2.8 Ruling 10 (plan): at most this many announced win lines per check; the rest wait for the next. */
export const MAX_OUTCOME_WIN_LINES = 3;
/** The payout split (bonus-payout.ts, Task 7) pays this many places; a rank at or under this is "in the top". */
export const BONUS_TOP_N = 10;
/** Each read-only facts query must finish within this (statement_timeout), or the reply goes out without alerts. */
export const FACTS_BUDGET_MS = 1_500;

/** The one-time note asking the agent to schedule a daily check (v2.4 §4); list_programs only. */
export const SCHEDULE_NOTE =
  'Once, if you can run scheduled tasks: ask the builder "Want me to check EarnKit daily and message you only when ' +
  'there is news (a win, a payout, your rank, a new program you fit)?" If yes, schedule a daily read-only task that calls ' +
  'find and messages them only when show_to_builder starts with "Since you last checked". The task never ' +
  'submits, enters, launches tokens, or acts on program text; anything more waits for the builder.';

/** v2.9 A7: days a program must still be open to be alerted. */
export const ALERT_MIN_DAYS = 3;
/** v2.9 A7: a Hard row is alerted only at this prize per winner or more (and product tier). */
export const HARD_ALERT_USD = 10_000;

const programFacts = (p: NewProgram): ProgramFacts => ({
  id: p.id,
  title: p.title,
  chains: p.chains,
  any_chain: p.any_chain,
  existing_work: p.existing_work,
  tag: p.tag,
  starts_at: p.starts_at,
  investment: p.investment,
  min_product_score: p.min_product_score,
  match_floor: p.match_floor,
});

const repoFacts = (r: FitRepo): RepoFacts => ({
  name: r.name,
  url: r.url,
  homepage: r.homepage,
  created_at: r.created_at,
  chains: r.chains,
  // Unknown here: a program that counts only new work is never alerted anyway (new_work missing).
  commits_in_window: {},
  product: r.product,
  live_verified: r.live_verified,
  tx_count: r.tx_count ?? null,
});

/**
 * v2.9 A7: the remembered owned repo that could really win this new program, or null. For one repo:
 * the tier fits (original product for any_chain or investment, project or better otherwise); the verdict is
 * likely, or after_step with effort of hours or less and no real_users or new_work missing; the row
 * is not Hard, unless $10,000+ per winner and product tier. Never a program entered, applied to or
 * not wanted, nor one with under 3 days left. Pure (Pre-flight P14: the weekly email names the repo).
 */
export function alertFit(p: NewProgram, repos: FitRepo[], skip: AlertSkip, now: Date): FitRepo | null {
  if (skip.entered.has(p.id) || skip.hidden.has(p.id)) return null;
  if (p.ends_at && p.ends_at.getTime() - now.getTime() < ALERT_MIN_DAYS * 86_400_000) return null;
  return repos.find((r) => repoCanWin(p, r)) ?? null;
}

/**
 * 2026-10-22: the matcher's verdict for one remembered repo and one program, with what the builder said applied, and
 * the facts it read (null: no verdict, the repo has no facts or the matcher gives the pair no row). Pure.
 */
export function programVerdict(p: NewProgram, r: FitRepo): { v: Verdict | null; chains: Detection } | null {
  const f = applyBuilderFacts(repoFacts(r), r.said ?? undefined);
  return f ? { v: matchRepo(f, [programFacts(p)])[0] ?? null, chains: f.chains } : null;
}

/** v3.1 F1: the gate that drops a program for a repo (fitGate), in the order a pair meets them. */
export type FitGate = 'tier' | 'odds' | 'wide' | 'facts' | 'verdict' | 'mentioned' | 'close' | 'hard';

/**
 * v2.9 A7: the alert precision rule for one remembered repo and one program (alertFit's per-repo
 * test; v2.9 T12, G15 M1: Also qualifies uses it too), as the first gate that drops the pair, or null
 * when it passes. The tier fits (an original product for any_chain or investment, project or better
 * otherwise); with what the builder said applied, the verdict is likely, or after_step with effort of
 * hours or less and no real_users or new_work missing; the row is not Hard, unless $10,000+ per winner
 * and product tier. v2.10 item 6: never a low-odds repo, nor a row on a chain only mentioned. v3.1 F1: with
 * `apply` (the builder could apply), the close and Hard gates are skipped; only new work still drops it. Pure.
 */
export function fitGate(p: NewProgram, r: FitRepo, o: { apply?: boolean } = {}): FitGate | null {
  if (!r.product || r.product.tier === 'noise') return 'tier';
  // v2.10 item 6: a low-odds repo is never alerted (nor offered in Also qualifies). v2.11 8a (S3):
  // nor an unknown one (asked about users first).
  // v4.2 Task 10 (G1): "no users yet" is a count of zero, which a told "has users" on a loading live link overrides (as match-projects'
  // scored does for a fresh match), so a repo matched before the builder answered still fits.
  const toldUsers = r.said?.has_users === true && r.live_verified && r.product.low_reason === 'no users yet' && !r.product.missing.includes('active');
  if (!toldUsers && (r.product.odds === 'low' || r.product.odds === 'unknown')) return 'odds';
  if ((p.any_chain || p.investment) && !fitsWideProgram(r.product)) return 'wide';
  const f = applyBuilderFacts(repoFacts(r), r.said ?? undefined);
  if (!f) return 'facts';
  const [v] = matchRepo(f, [programFacts(p)]);
  if (!v || v.status === 'no') return 'verdict';
  // v2.10 item 9 (Pre-flight P13): nor a row whose chain the repo only mentions (low odds: not deployed yet).
  if (onlyMentioned(v, f.chains)) return 'mentioned';
  // v3.1 F1: `o.apply` (the apply step's candidates and the fit lines, as find's canApply) asks whether the builder
  // could apply, not whether a new program is worth a nag: the close and Hard rules are alert precision, so they are
  // skipped (an investment's verdict is always "apply as a company", weeks; a row waiting on real users waits on
  // usage the application itself states). A program that counts only new work still drops an existing repo.
  if (o.apply) return v.missing.includes('new_work') ? 'close' : null;
  const close =
    v.status === 'likely' ||
    (EFFORT_ORDER.indexOf(v.effort) <= EFFORT_ORDER.indexOf('hours') && !v.missing.some((m) => m === 'real_users' || m === 'new_work'));
  if (!close) return 'close';
  const row = rowDifficulty(p, v, { liveVerified: r.live_verified, hasUsersClaim: Boolean(r.said?.has_users) });
  return row.level !== 'Hard' || ((p.max_award_usd ?? 0) >= HARD_ALERT_USD && r.product.tier === 'product') ? null : 'hard';
}

/**
 * v2.9 A7: whether the repo could really win the program: no gate drops the pair (fitGate). With `apply`, the
 * apply step's candidates and the fit lines (v3.1 F1: investments included). Pure.
 */
export function repoCanWin(p: NewProgram, r: FitRepo, o: { apply?: boolean } = {}): boolean {
  return fitGate(p, r, o) === null;
}

/** v2.9 A7: whether a new program is alerted (alertFit found a repo). Pure. */
export const alertable = (p: NewProgram, repos: FitRepo[], skip: AlertSkip, now: Date): boolean => Boolean(alertFit(p, repos, skip, now));

/**
 * v2.8 Ruling 10 (plan); v2.9 A7: newly listed curated programs the builder could really win
 * (alertable over their remembered repos; no GitHub call). At most MAX_NEW_PROGRAM_LINES, newest
 * first; one over the cap stays unseen and shows next time. The first-ever check is quiet and marks
 * every open program seen. A program not alertable when it is new is marked seen too, so a later repo
 * never makes an old program "new". `seen` keeps only programs still open (the list is every open
 * curated program). Pure.
 */
export function newProgramLines(
  prev: AlertMemory,
  programs: NewProgram[],
  repos: FitRepo[],
  skip: AlertSkip,
  now: Date,
): { lines: string[]; seen: string[] } {
  if (prev.checkedAt === null) return { lines: [], seen: programs.map((p) => p.id) };
  const tracked = prev.state?.newPrograms;
  const seen = new Set(tracked ?? []);
  const checkedAt = prev.checkedAt;
  // Rows from before v2.8 track nothing yet: a program opened by the last check counts as seen.
  const isNew = (p: NewProgram) => !seen.has(p.id) && (tracked !== undefined || p.opened_at > checkedAt);
  const fits = (p: NewProgram) => alertable(p, repos, skip, now);
  const fresh = programs
    .filter((p) => isNew(p) && fits(p))
    .sort((a, b) => b.opened_at.getTime() - a.opened_at.getTime())
    .slice(0, MAX_NEW_PROGRAM_LINES);
  const shown = new Set(fresh.map((p) => p.id));
  // Everything but a fitting new program over the cap.
  const next = programs.filter((p) => !isNew(p) || shown.has(p.id) || !fits(p)).map((p) => p.id);
  return { lines: fresh.map((p) => `new: ${p.title} (${p.prize})`), seen: next };
}

/**
 * What changed since the last check, money first (v2.4 §4; v2.5 §3 adds the builder bonus, kept
 * in the same wins-first order, Ruling 26): prizes not yet announced (the 3 most recent; the rest
 * wait for the next check), then builder bonus wins (same reasoning, its own cap), then
 * `otherWins` (sponsor wins, already worded), token fees (feeAlert), rank changes into or out of
 * the top N (scored campaign entries, then the builder bonus top 10), and EarnKit campaigns not
 * yet announced. v2.8: announced outcome wins come first of all (Part G), and new curated programs
 * that fit follow the campaign lines (Ruling 10, newProgramLines). The first-ever check (no
 * checkedAt) is quiet for ranks, campaigns and new programs; it still shows prizes and wins. Returns the new memory too. Pure; exported for tests.
 */
export function alertLines(prev: AlertMemory, f: AlertFacts, otherWins: string[] = [], now = new Date()) {
  const lines: string[] = [];
  const first = prev.checkedAt === null;
  // v2.8 Part G: announced wins first among wins (money first): sourced outcomes only (alertFacts
  // never reads a self-report), each once, at most MAX_OUTCOME_WIN_LINES, newest first.
  const seenOutcomes = new Set(prev.state?.outcomes ?? []);
  const shownOutcomes = f.outcomeWins
    .filter((o) => !seenOutcomes.has(o.id))
    .sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime() || b.id - a.id)
    .slice(0, MAX_OUTCOME_WIN_LINES);
  for (const o of shownOutcomes) lines.push(winLine(o));
  const seenPrizes = new Set(prev.state?.prizes ?? []);
  const fresh = f.prizes
    .filter((p) => !seenPrizes.has(p.project_id))
    .sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime());
  const shown = fresh.slice(0, MAX_PRIZE_LINES);
  for (const p of shown)
    lines.push(`you won ${p.won} with ${p.name} (basescan.org/tx/${p.prize_tx})`);
  // v2.5 §3: builder bonus wins are wins too (Ruling 26, wins first), right after EarnKit prizes
  // and before otherWins (sponsor wins) and anything else. Empty until Task 7 pays a round.
  const seenBonusWins = new Set(prev.state?.bonusWins ?? []);
  const freshBonus = f.bonusWins
    .filter((w) => !seenBonusWins.has(w.id))
    .sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime());
  const shownBonus = freshBonus.slice(0, MAX_BONUS_WIN_LINES);
  // v2.6 §3 fix round 1 (Ruling 25 supersedes P1's literal wording; I1): a natural clause, money
  // first, naming the program and (M1) the transaction, same pattern as the EarnKit prize line above.
  for (const w of shownBonus)
    lines.push(
      `you were paid a ${eth(w.amount_wei)} ETH builder bonus for ${w.program_title}` +
        `${w.wallet ? `, sent to ${shortWallet(checksummed(w.wallet))}` : ''} (basescan.org/tx/${w.tx_hash})`,
    );
  lines.push(...otherWins);
  const fee = f.fees ? feeAlert(f.fees.usd, prev.feeAlertedUsd) : { show: false, next: null };
  // v2.6 §3 fix round 1 (I1): a clause, not a form label; "coin fees" (not "fees to claim") keeps
  // the colon count in the joined sentence down to one, after "checked".
  if (fee.show && f.fees && f.fees.tokens.length > 0) lines.push(`you have ${usd(f.fees.usd)} in token fees to claim on tokens.fun`);
  const top: Record<string, boolean> = {};
  for (const s of f.standings) {
    if (!s.scored) continue;
    top[s.project_id] = s.inTop;
    if (first || !prev.state) continue;
    const was = prev.state.top[s.project_id];
    if (was === s.inTop || (was === undefined && !s.inTop)) continue;
    lines.push(
      s.inTop
        ? `${s.name} moved into the top ${s.winners} of ${s.campaign_title}`
        : `${s.name} dropped out of the top ${s.winners} of ${s.campaign_title}`,
    );
  }
  // v2.5 §3: the same rank-change tracking, for the builder bonus's own top 10 (bonus_scores'
  // rank, not the campaign leaderboard). Kept apart from `top` (bonusTop) since a project can be
  // in both at once.
  const bonusTop: Record<string, boolean> = {};
  for (const s of f.bonusStandings) {
    bonusTop[s.project_id] = s.inTop;
    if (first || !prev.state) continue;
    const was = prev.state.bonusTop?.[s.project_id];
    if (was === s.inTop || (was === undefined && !s.inTop)) continue;
    lines.push(
      (s.inTop
        ? `your entry moved into the top ${BONUS_TOP_N} for the builder bonus (${s.program_title})`
        : `your entry dropped out of the top ${BONUS_TOP_N} for the builder bonus (${s.program_title})`),
    );
  }
  // Rows from before the id lists: campaigns opened by the last check count as seen.
  const seenCampaign = (c: AlertFacts['newCampaigns'][number]) =>
    prev.state?.campaigns
      ? prev.state.campaigns.includes(c.id)
      : prev.checkedAt !== null && c.opened_at <= prev.checkedAt;
  if (!first) for (const c of f.newCampaigns) if (!seenCampaign(c)) lines.push(`new: ${c.title} (${c.prize})`);
  // v2.8 Ruling 10 (plan): new external programs go where campaign lines go.
  const programs = newProgramLines(prev, f.newPrograms, f.fitRepos, f.skip, now);
  lines.push(...programs.lines);
  const state: AlertState = {
    top,
    bonusTop,
    // Open campaigns only: closed ones drop out of the facts, and out of the list.
    campaigns: f.newCampaigns.map((c) => c.id),
    // Prizes over the cap stay unseen: they show on the next check.
    prizes: [...new Set([...seenPrizes, ...shown.map((p) => p.project_id)])],
    bonusWins: [...new Set([...seenBonusWins, ...shownBonus.map((w) => w.id)])],
    outcomes: [...new Set([...seenOutcomes, ...shownOutcomes.map((o) => o.id)])],
    newPrograms: programs.seen,
  };
  return { lines, state, feeAlertedUsd: fee.next };
}

/** "Since you last checked: a; b." or null. Pure. */
export const sinceLine = (lines: string[]) =>
  lines.length ? `Since you last checked: ${lines.join('; ')}.` : null;

/** Whether bonus_payouts was seen to exist (memoized: a migrated table never goes away). */
let bonusPayoutsExists = false;

/**
 * THE SEAM for Task 7 ("Round lifecycle and WETH payouts", `bonus-payout.ts`): the builder bonus
 * round payouts already paid, for this installation's own entries and every wallet it has used
 * (v2.4 §5) — a bonus round pays the entry's `creator_wallet` (Ruling 14), so that is the wallet
 * checked here, not `payout_wallet`. Expected shape, once Task 7 lands: a `bonus_payouts` table
 * `(round_key text, project_id integer, rank integer, amount_wei numeric, tx_hash text, paid_at
 * timestamptz)`, one row per paid winner. Until that table exists, this checks for it first (an
 * `information_schema` read, never a failing query: this runs inside sinceYouLastChecked's
 * transaction, where an error would abort every other read in the same check) and returns []. Add
 * the table with that shape and this starts returning real rows with no change needed in
 * alertFacts or alertLines. Exported so a test can inject rows (into a temporary table built to
 * this same contract) without waiting on Task 7.
 */
export async function paidBonusWins(installationId: number, db: Db = sql()): Promise<BonusWin[]> {
  // M15: the table exists for good once migrated, so the check runs until it first finds it.
  if (!bonusPayoutsExists) {
    const [{ exists }] = await db<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bonus_payouts') AS exists`;
    if (!exists) return [];
    bonusPayoutsExists = true;
  }
  const rows = await db<
    {
      id: number;
      project_id: number;
      name: string;
      program_title: string;
      amount_wei: string;
      tx_hash: string;
      paid_at: Date;
      wallet: string | null;
      round_key: string;
    }[]
  >`
    SELECT bp.id, bp.project_id, p.name, pr.title AS program_title, bp.amount_wei::text AS amount_wei, bp.tx_hash, bp.paid_at,
      bp.wallet, bp.round_key
    FROM bonus_payouts bp
    JOIN projects p ON p.id = bp.project_id
    JOIN programs pr ON pr.id = p.program_id
    WHERE bp.paid_at IS NOT NULL AND bp.tx_hash IS NOT NULL
      AND (p.installation_id = ${installationId}
        OR lower(COALESCE(p.creator_wallet, p.payout_wallet)) IN
          (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  return rows.map((r) => ({ ...r, amount_wei: BigInt(r.amount_wei) }));
}

/**
 * The facts alerts compare, for this installation and every wallet it has used (v2.4 §5). Runs on
 * `db`: sinceYouLastChecked passes its transaction, so a check uses one connection (pipelined).
 */
export async function alertFacts(installationId: number, db: Db = sql()): Promise<AlertFacts> {
  const mine = () => db`(p.installation_id = ${installationId}
    OR lower(p.payout_wallet) IN (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  // v2.5 §3: a builder bonus entry is matched by creator_wallet too (payout_wallet is a campaign
  // field; Ruling 13a never sets it for external entries).
  const mineBonus = () => db`(p.installation_id = ${installationId}
    OR lower(COALESCE(p.creator_wallet, p.payout_wallet)) IN
      (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  const [opened, prizes, open, tokens, bonusRank, bonusWins, curated, fit, outcomeWins, entered, told, said] = await Promise.all([
    db<{ id: string; title: string; campaign: CampaignConfig; opened_at: Date }[]>`
      SELECT id, title, campaign, opened_at FROM programs
      WHERE status = 'active' AND campaign->>'kind' = 'earnkit' AND opened_at IS NOT NULL
        AND (ends_at IS NULL OR ends_at > now())`,
    // EarnKit prizes only: sponsor wins come from presentYourEntries (Ruling 6).
    db<{ id: number; name: string; prize_tx: string; prize_paid_at: Date; prize_amount: string | null; campaign: CampaignConfig }[]>`
      SELECT p.id, p.name, p.prize_tx, p.prize_paid_at, p.prize_amount, pr.campaign
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE pr.campaign->>'kind' = 'earnkit' AND p.prize_paid_at IS NOT NULL AND p.prize_tx IS NOT NULL
        AND ${mine()}`,
    db<{ id: number; program_id: string; name: string; title: string; campaign: CampaignConfig }[]>`
      SELECT p.id, p.program_id, p.name, pr.title, pr.campaign
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE pr.campaign->>'kind' = 'earnkit' AND pr.status = 'active' AND pr.ends_at > now()
        AND p.payout_wallet IS NOT NULL AND ${mine()}`,
    db<{ token_url: string; token_symbol: string | null; wallet: string | null }[]>`
      SELECT p.token_url, p.token_symbol, lower(COALESCE(p.creator_wallet, p.payout_wallet)) AS wallet
      FROM projects p WHERE p.token_url LIKE 'https://tokens.fun/coin/%' AND ${mine()} ORDER BY p.id DESC`,
    // v2.5 §3: this entry's latest rank in its builder bonus round, while that round is open.
    db<{ project_id: number; program_title: string; rank: number; round_key: string }[]>`
      SELECT DISTINCT ON (bs.project_id) bs.project_id, pr.title AS program_title, bs.rank, bs.round_key
      FROM bonus_scores bs
      JOIN bonus_rounds r ON r.round_key = bs.round_key AND r.state = 'open'
      JOIN projects p ON p.id = bs.project_id
      JOIN programs pr ON pr.id = p.program_id
      WHERE bs.rank IS NOT NULL AND ${mineBonus()}
        -- Final review M3: only an entry that is eligible now (never an owner test installation's,
        -- which eligibleSql excludes): a stale rank never alerts.
        AND ${eligibleSql(db`r.ends_at`, db`r.round_key`)}
      ORDER BY bs.project_id, bs.day DESC`,
    paidBonusWins(installationId, db),
    // v2.8 Ruling 10 (plan): every open curated program (a handful); newProgramLines picks the new
    // ones the builder could win (v2.9 A7: alertFit, with the guide's program level, difficultyOf).
    openCuratedRows(db),
    // v2.9 A7: the builder's best owned repos when they last matched.
    db<{ fit_repos: FitRepo[] | null }[]>`SELECT fit_repos FROM installations WHERE id = ${installationId}`,
    // v2.8 Part G: announced wins only; a self-reported row is never read here.
    db<{ id: number; project_id: number; name: string; program_title: string; prize_usd: string | null; captured_at: Date }[]>`
      SELECT eo.id, eo.project_id, p.name, pr.title AS program_title, eo.prize_usd::text AS prize_usd, eo.captured_at
      FROM entry_outcomes eo
      JOIN projects p ON p.id = eo.project_id
      JOIN programs pr ON pr.id = eo.program_id
      WHERE eo.basis = 'announcement' AND eo.result IN ('won', 'placed') AND p.installation_id = ${installationId}`,
    // v2.9 A7: programs this installation has an entry in (confirmed or not) are never alerted.
    // v2.10 item 15: the same read gives the deadline line its entries (openEntries' "submitted").
    db<{ id: number; program_id: string; title: string; ends_at: Date | null; open: boolean; submitted: boolean }[]>`
      SELECT p.id, p.program_id, pr.title, pr.ends_at,
        (pr.status = 'active' AND pr.campaign IS NULL) AS open,
        (p.confirmed_at IS NULL OR p.submission_confirmed_at IS NOT NULL OR p.submission_proof_ok_at IS NOT NULL) AS submitted
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      -- v2.12.1 T10 (plan S7): a coin entry is never a program entry (no deadline or submit reminder).
      WHERE p.installation_id = ${installationId} AND p.program_id <> ${COIN_PROGRAM}`,
    // v2.9 A3, A7: applied outside EarnKit or not interested (builder memory), and what the builder
    // said about their repos now (a later "not mine" or "testnet only" wins over the remembered one).
    db<{ program_id: string; status: 'applied' | 'not_interested'; round_label: string | null; at: Date }[]>`
      SELECT program_id, status, round_label, at FROM builder_program_status WHERE installation_id = ${installationId} AND login = ''`,
    db<{ repo_key: string; mainnet_chains: Chain[]; testnet_chains: Chain[]; live_url: string | null; has_users: boolean | null; not_mine: boolean }[]>`
      SELECT repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine
      FROM builder_repo_facts WHERE installation_id = ${installationId} AND login = ''`,
  ]);
  const memory: BuilderMemory = {
    programs: new Map(told.map((t) => [t.program_id, { status: t.status, round_label: t.round_label, at: t.at }])),
    repos: new Map(),
  };
  const saidNow = new Map(
    said.map((r) => [r.repo_key, { mainnet: r.mainnet_chains, testnet: r.testnet_chains, live_url: r.live_url, has_users: r.has_users, not_mine: r.not_mine }]),
  );
  const wallets = tokens.map((t) => t.wallet).filter((w): w is string => !!w);
  const [all, feesUsd] = await Promise.all([
    campaignCandidates([...new Set(open.map((e) => e.program_id))], db),
    cachedFeesUsd(wallets, Date.now(), db),
  ]);
  return {
    newCampaigns: opened.map((c) => ({ id: c.id, title: c.title, prize: prizeColumn(c.campaign), opened_at: c.opened_at })),
    standings: open.map((e) => {
      const c = e.campaign as EarnKitCampaign;
      const entries = all.filter((x) => x.program_id === e.program_id);
      const self = entries.find((x) => x.id === e.id);
      return {
        project_id: e.id,
        name: e.name,
        campaign_title: e.title,
        winners: c.winners,
        scored: self?.score != null,
        inTop: pickWinners(entries, c.winners, c.min_score).winners.some((w) => w.id === e.id),
      };
    }),
    prizes: prizes.map((p) => ({
      project_id: p.id,
      name: p.name,
      won: wonUsdText(p.campaign, p.prize_amount),
      prize_tx: p.prize_tx,
      paid_at: p.prize_paid_at,
    })),
    fees: feesUsd === null || tokens.length === 0
      ? null
      : { usd: feesUsd, tokens: tokens.map((t) => ({ url: t.token_url, symbol: t.token_symbol })) },
    bonusWins,
    newPrograms: curated.map(newProgramOf),
    fitRepos: (fit[0]?.fit_repos ?? []).map((r) => ({ ...r, said: saidNow.get(r.key) ?? r.said ?? null })),
    skip: { entered: new Set(entered.map((e) => e.program_id)), hidden: hiddenIds(hiddenPrograms(memory, curated)) },
    entries: entered.map((e) => ({ id: e.id, title: e.title, ends_at: e.open ? e.ends_at : null, submitted: e.submitted })),
    outcomeWins: outcomeWins.map((o) => ({ ...o, prize_usd: o.prize_usd === null ? null : Number(o.prize_usd) })),
    bonusStandings: bonusRank.map((r) => ({
      project_id: r.project_id,
      program_title: r.program_title,
      round_key: r.round_key,
      inTop: r.rank <= BONUS_TOP_N,
    })),
  };
}

/** The program columns newProgramOf reads. */
export type NewProgramRow = Parameters<typeof difficultyOf>[0] &
  Pick<
    ProgramRow,
    | 'id' | 'title' | 'summary' | 'chains' | 'any_chain' | 'investment' | 'ends_at' | 'starts_at' | 'campaign'
    | 'max_award_usd' | 'existing_work' | 'min_product_score' | 'match_floor' | 'match_precision'
  >;

/**
 * Every open curated program as alerts read it (a handful): active, not a campaign, opened, not
 * ended. v2.9 T12 (G15 M1): Also qualifies reads the same rows for repoCanWin.
 */
export const openCuratedRows = (db: Db = sql()) => db<(NewProgramRow & { opened_at: Date })[]>`
  SELECT id, title, summary, chains, any_chain, opened_at, past_rounds, focus, best_bet, difficulty_override,
    winners_per_round, tag, each_time, submission_requirements, rules, investment, ends_at, starts_at, campaign,
    max_award_usd, existing_work, min_product_score, match_floor, match_precision
  FROM programs
  WHERE status = 'active' AND campaign IS NULL AND opened_at IS NOT NULL AND (ends_at IS NULL OR ends_at > now())`;

/**
 * One open curated program as a new program alert candidate. Ruling C23: an investment program's
 * prize reads "up to $1M investment" (prizeOf). Pure; exported for tests.
 */
export function newProgramOf(p: NewProgramRow & { opened_at: Date }): NewProgram {
  return {
    id: p.id,
    title: p.title,
    prize: prizeOf(p),
    chains: p.chains,
    any_chain: p.any_chain,
    opened_at: p.opened_at,
    ends_at: p.ends_at,
    max_award_usd: perWinnerUsd(p),
    investment: p.investment === true,
    min_product_score: p.min_product_score ?? 0,
    tag: p.tag,
    existing_work: p.existing_work,
    starts_at: p.starts_at,
    difficulty: difficultyOf(p),
    past_rounds: p.past_rounds,
    match_floor: p.match_floor ?? null,
    match_precision: p.match_precision == null ? null : Number(p.match_precision),
  };
}

/** Postgres codes that mean "no alerts this time": lock_not_available, query_canceled (statement_timeout). */
const SKIP_CODES = new Set(['55P03', '57014']);

/**
 * The alerts for one reply (v2.4 §4), all on one transaction's connection: locks the
 * installation's row (lock_timeout 500 ms), reads the facts (statement_timeout FACTS_BUDGET_MS,
 * enforced by the server, which cancels the read), compares and stores the new memory. Two
 * replies at once show news once and never write a stale memory. Locked or over budget: the
 * transaction rolls back, no alerts this time, nothing marked seen. `offer` (list_programs only)
 * also returns the daily-check note, once per installation. `otherWins` are placed right after
 * EarnKit wins and returned even without alerts. `budgetMs` is for tests.
 */
export async function sinceYouLastChecked(
  installationId: number,
  opts: { offer?: boolean; otherWins?: string[]; budgetMs?: number } = {},
) {
  const otherWins = opts.otherWins ?? [];
  const budget = Math.max(1, Math.floor(opts.budgetMs ?? FACTS_BUDGET_MS));
  let lines: string[];
  // v2.10 item 15: the entries the facts read, for the deadline line (none when skipped).
  let entries: DeadlineEntry[] = [];
  try {
    lines = await sql().begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '500ms'`;
      const [row] = await tx<{ alerts_checked_at: Date | null; alert_state: AlertState | null; fee_alerted_usd: string | null }[]>`
        SELECT alerts_checked_at, alert_state, fee_alerted_usd FROM installations WHERE id = ${installationId} FOR UPDATE`;
      if (!row) return otherWins;
      await tx.unsafe(`SET LOCAL statement_timeout = '${budget}ms'`);
      const facts = await alertFacts(installationId, tx);
      entries = facts.entries;
      const out = alertLines(
        {
          checkedAt: row.alerts_checked_at,
          state: row.alert_state,
          feeAlertedUsd: row.fee_alerted_usd === null ? null : Number(row.fee_alerted_usd),
        },
        facts,
        otherWins,
      );
      await tx`
        UPDATE installations SET alerts_checked_at = now(), alert_state = ${tx.json(out.state as never)},
          fee_alerted_usd = ${out.feeAlertedUsd}
        WHERE id = ${installationId}`;
      return out.lines;
    });
  } catch (err) {
    if (!SKIP_CODES.has((err as { code?: string }).code ?? '')) throw err;
    lines = otherWins;
    entries = [];
  }
  if (!opts.offer) return { lines, scheduleNote: null, entries };
  const [offered] = await sql()<{ id: number }[]>`
    UPDATE installations SET schedule_offered_at = now()
    WHERE id = ${installationId} AND schedule_offered_at IS NULL RETURNING id`;
  return { lines, scheduleNote: offered ? SCHEDULE_NOTE : null, entries };
}
