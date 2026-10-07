import {
  prizeColumn,
  prizeUsdEach,
  type CampaignConfig,
  type EarnKitCampaign,
  type SponsorState,
  type YourEntry,
} from './campaigns';
import { sql, type Db } from './db';
import { prizeFunds } from './funds';
import { MANUAL_CHECK, TERMS_CHANGED, fromTerms, type FrozenTerms } from './payout';
import type { CampaignRow } from './present';
import type { TokenPolicy } from './program-file';
import { sponsorIdentity, trackRecord } from './sponsor-verify';
import { shownUrl } from './untrusted-text';
import { pickWinners, rankEntries, standingText, type Candidate, type RunState } from './winners';

export type BoardRow = {
  id: number;
  name: string;
  repo_url: string | null;
  live_url: string | null;
  score: number | null;
  /** Null for an unscored EarnKit entry (it has no rank yet). */
  rank: number | null;
  token_url: string | null;
  prize_tx: string | null;
  payout_wallet: string;
  prize_amount: string | null;
  prize_reason: string | null;
  /** EarnKit campaigns: the entry's standing (v2.4 §6), e.g. "#3, in the top 5" or "in review". */
  standing?: string;
};

/**
 * The campaign as the cron pays it: the payout terms frozen when the review opened
 * (campaign_runs.terms) replace the program's current ones. Pure; exported for tests.
 */
export const payingCampaign = (c: EarnKitCampaign, terms: FrozenTerms | null | undefined): EarnKitCampaign => {
  if (!terms) return c;
  const t = fromTerms(terms);
  return { ...c, prize: { ...c.prize, ...t.prize }, amount_each: t.amount_each, winners: t.winners, min_score: t.min_score };
};

/**
 * The payout state as the public reads it (fix round 1): campaign_runs.note is for the owner (it
 * can name env vars or wallets), so the public page shows a short sentence. Pure;
 * exported for tests.
 */
export function publicNote(run: { state: RunState; note: string | null } | null | undefined) {
  if (run?.state !== 'paying') return null;
  if (run.note && /^Waiting for the transfer/.test(run.note)) return 'Waiting for a transfer to confirm.';
  if (run.note?.includes(MANUAL_CHECK)) return 'Payouts paused; EarnKit is checking a transfer.';
  if (run.note?.includes(TERMS_CHANGED)) return 'Payouts paused; EarnKit is checking the prize terms.';
  if (run.note) return 'Payouts paused; they resume automatically.';
  return 'Paying winners now.';
}

/** One entry with its review evidence (v2.4 §3): counted users, smart accounts, users shared with other entries, Builder Code share. */
export type ReviewRow = Candidate & {
  name: string;
  rank: number;
  contracts: string[];
  deployers: string[] | null;
  live_url: string | null;
  repo_url: string | null;
  code_share: number | null;
  score_error: string | null;
  /** A read hit its page cap: the score may be low. Payable, but flagged in the review (ruling 20). */
  score_partial: boolean;
  veto_reason: string | null;
  counted: number;
  smart: number;
  shared: number;
};

/**
 * A campaign's scored entries ranked with evidence, and the winners as the cron would pay them
 * now (under the frozen terms once the review opened), with the entries skipped and why.
 */
export async function reviewRows(slug: string, c: EarnKitCampaign) {
  const [run] = await sql()<{ terms: FrozenTerms | null }[]>`
    SELECT terms FROM campaign_runs WHERE program_id = ${slug}`;
  const terms = payingCampaign(c, run?.terms);
  const rows = await sql()<Omit<ReviewRow, 'rank'>[]>`
    SELECT p.id, p.name, p.score, p.submitted_at, p.payout_wallet, p.installation_id, p.vetoed_at,
      p.veto_reason, p.payout_status, p.prize_tx, p.live_url, p.repo_url, p.contracts, p.deployers,
      p.code_share, p.score_error, p.score_partial,
      (SELECT count(*) FROM entry_wallets w WHERE w.project_id = p.id)::int AS counted,
      (SELECT count(*) FROM entry_wallets w WHERE w.project_id = p.id AND w.kind = 'smart')::int AS smart,
      (SELECT count(*) FROM entry_wallets w WHERE w.project_id = p.id AND EXISTS (
         SELECT 1 FROM entry_wallets o JOIN projects op ON op.id = o.project_id
         WHERE o.wallet = w.wallet AND o.project_id <> p.id AND op.program_id = p.program_id))::int AS shared
    FROM projects p WHERE p.program_id = ${slug} AND p.payout_wallet IS NOT NULL`;
  const ranked: ReviewRow[] = rankEntries(rows).map((r, i) => ({
    ...r,
    rank: i + 1,
    contracts: r.contracts ?? [],
    live_url: shownUrl(r.live_url),
    repo_url: shownUrl(r.repo_url),
  }));
  const { winners, skipped } = pickWinners(ranked, terms.winners, terms.min_score);
  return { ranked, picks: winners, skipped };
}

type OffPlanAward = { wallet: string; amount: string; entry_id: number | null };

/** A campaign and its ranked entries (public; campaigns only). */
export async function getCampaignBoard(slug: string) {
  const [program] = await sql()<
    {
      id: string;
      title: string;
      description: string;
      summary: string;
      ends_at: Date;
      status: 'active' | 'closed';
      campaign: CampaignConfig | null;
      rules: string[];
      token_policy: TokenPolicy;
    }[]
  >`SELECT id, title, description, summary, ends_at, status, campaign, rules, token_policy FROM programs WHERE id = ${slug}`;
  if (!program?.campaign) return null;
  // A taken-down sponsor campaign is removed from public view immediately (refunded/awarded
  // campaigns stay visible).
  const [sponsorRow] = await sql()<
    {
      state: SponsorState;
      award_onchain: OffPlanAward[] | null;
      sponsor_url: string | null;
      sponsor_wallet: string | null;
    }[]
  >`SELECT state, award_onchain, sponsor_url, sponsor_wallet FROM sponsor_campaigns WHERE program_id = ${slug}`;
  if (sponsorRow?.state === 'taken_down') return null;
  const rows = await sql()<(BoardRow & Candidate & { rank: number })[]>`
    SELECT id, name, repo_url, live_url, score, token_url, prize_tx, payout_wallet, prize_amount,
      prize_reason, submitted_at, installation_id, vetoed_at, payout_status, row_number() OVER (ORDER BY score DESC NULLS LAST, submitted_at)::int AS rank
    FROM projects WHERE program_id = ${slug} AND payout_wallet IS NOT NULL
    ORDER BY score DESC NULLS LAST, submitted_at`;
  // An EarnKit campaign that closed without ever taking an entry (Campaign #1) isn't public.
  if (
    program.campaign.kind === 'earnkit' &&
    program.status === 'closed' &&
    rows.length === 0
  )
    return null;
  const earnkit = program.campaign.kind === 'earnkit' ? program.campaign : null;
  const [run] = earnkit
    ? await sql()<{ state: RunState; review_until: Date | null; note: string | null; terms: FrozenTerms | null }[]>`
        SELECT state, review_until, note, terms FROM campaign_runs WHERE program_id = ${slug}`
    : [];
  const state: RunState = run?.state ?? 'running';
  const ended = program.ends_at <= new Date();
  const paying = earnkit ? payingCampaign(earnkit, run?.terms) : null;
  return {
    program: { ...program, campaign: program.campaign },
    // Builder links are data: a stored value that isn't a plain https link is not shown.
    rows: rows.map((r): BoardRow => ({
      id: r.id,
      name: r.name,
      score: r.score,
      token_url: r.token_url,
      prize_tx: r.prize_tx,
      payout_wallet: r.payout_wallet,
      prize_amount: r.prize_amount,
      prize_reason: r.prize_reason,
      live_url: shownUrl(r.live_url),
      repo_url: shownUrl(r.repo_url),
      ...(paying
        ? { rank: r.score === null ? null : r.rank, standing: standingText(r, rows, paying, { state, ended }) }
        : { rank: r.rank }),
    })),
    run: run ? { state: run.state, review_until: run.review_until, note: publicNote(run) } : null,
    review: earnkit && state !== 'running' ? await reviewRows(slug, earnkit) : null,
    // Memoized (60 s): anonymous views share one balance read.
    funds: paying ? await prizeFunds(paying) : null,
    sponsorState: sponsorRow?.state ?? null,
    offPlan: sponsorRow?.award_onchain ?? null,
    // Who the sponsor is (lazily re-verified) and what its wallet has done before.
    sponsor: sponsorRow
      ? {
          identity: await sponsorIdentity(sponsorRow),
          trackRecord: await trackRecord(sponsorRow.sponsor_wallet),
        }
      : null,
  };
}

/** One campaign entry's public page. */
export async function getProjectPage(id: number) {
  const [row] = await sql()<
    {
      id: number;
      name: string;
      description: string | null;
      repo_url: string | null;
      live_url: string | null;
      token_url: string | null;
      contracts: string[];
      score: number | null;
      scored_at: Date | null;
      prize_tx: string | null;
      prize_amount: string | null;
      prize_reason: string | null;
      submitted_at: Date;
      program_id: string;
      program_title: string;
      campaign: CampaignConfig;
      sponsor_state: SponsorState | null;
      rank: number;
      entries: number;
      /** Whether any entry in the campaign has a score (rank means something only then). */
      any_scored: boolean;
    }[]
  >`
    SELECT * FROM (
      SELECT p.id, p.name, p.description, p.repo_url, p.live_url, p.token_url, p.contracts, p.score,
        p.scored_at, p.prize_tx, p.prize_amount, p.prize_reason, p.submitted_at, p.program_id,
        pr.title AS program_title, pr.campaign, sc.state AS sponsor_state,
        row_number() OVER (PARTITION BY p.program_id ORDER BY p.score DESC NULLS LAST, p.submitted_at)::int AS rank,
        count(*) OVER (PARTITION BY p.program_id)::int AS entries,
        bool_or(p.score IS NOT NULL) OVER (PARTITION BY p.program_id) AS any_scored
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      LEFT JOIN sponsor_campaigns sc ON sc.program_id = pr.id
      WHERE pr.campaign IS NOT NULL AND p.payout_wallet IS NOT NULL
        AND sc.state IS DISTINCT FROM 'taken_down'
    ) x WHERE x.id = ${id}`;
  if (!row) return null;
  // EarnKit campaigns: the entry's standing (v2.4 §6), against the terms the cron pays.
  let standing: string | null = null;
  if (row.campaign.kind === 'earnkit') {
    const all = await campaignCandidates([row.program_id]);
    const [run] = await sql()<{ state: RunState; terms: FrozenTerms | null }[]>`
      SELECT state, terms FROM campaign_runs WHERE program_id = ${row.program_id}`;
    const [p] = await sql()<{ ends_at: Date }[]>`SELECT ends_at FROM programs WHERE id = ${row.program_id}`;
    const self = all.find((e) => e.id === row.id);
    if (self)
      standing = standingText(self, all, payingCampaign(row.campaign, run?.terms), {
        state: run?.state ?? 'running',
        ended: p.ends_at <= new Date(),
      });
  }
  return {
    ...row,
    standing,
    live_url: shownUrl(row.live_url),
    repo_url: shownUrl(row.repo_url),
  };
}

/**
 * The caller's campaign entries, for list_programs' "Your campaign entries": rank while running,
 * the sponsor campaign's state (null for EarnKit campaigns), the prize once paid.
 */
export async function yourCampaignEntries(installationId: number) {
  return sql()<YourEntry[]>`
    SELECT e.name, e.campaign_title, e.campaign, e.ends_at, e.sponsor_state, e.score, e.rank,
      e.entries, e.prize_tx, e.prize_paid_at, e.prize_amount
    FROM (
      SELECT p.name, p.installation_id, p.score, p.prize_tx, p.prize_paid_at, p.prize_amount,
        pr.title AS campaign_title, pr.campaign, pr.ends_at, sc.state AS sponsor_state,
        row_number() OVER (PARTITION BY p.program_id ORDER BY p.score DESC NULLS LAST, p.submitted_at)::int AS rank,
        count(*) OVER (PARTITION BY p.program_id)::int AS entries
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      LEFT JOIN sponsor_campaigns sc ON sc.program_id = pr.id
      WHERE pr.campaign IS NOT NULL AND p.payout_wallet IS NOT NULL
    ) e
    WHERE e.installation_id = ${installationId}`;
}

/** Project names by entry id (the award page names each winner). */
export async function entryNames(ids: number[]) {
  const rows = await sql()<{ id: number; name: string }[]>`
    SELECT id, name FROM projects WHERE id IN ${sql()(ids.concat(0))}`;
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Every entry of these campaigns as winner selection reads it (on `db`: the pool or a transaction). */
export async function campaignCandidates(programIds: string[], db: Db = sql()) {
  if (programIds.length === 0) return [];
  return db<(Candidate & { program_id: string })[]>`
    SELECT id, program_id, score, submitted_at, payout_wallet, installation_id, vetoed_at,
      payout_status, prize_tx
    FROM projects
    WHERE program_id IN ${db(programIds)} AND payout_wallet IS NOT NULL`;
}

/** One EarnKit campaign row for list_programs (v2.4 §1): live numbers and the builder's best standing. Pure; exported for tests. */
export function campaignRow(
  p: { id: string; title: string; campaign: CampaignConfig; ends_at: Date; status: 'active' | 'closed'; state: RunState | null },
  entries: Candidate[],
  mine: Set<number>,
  now: Date,
): CampaignRow {
  const c = p.campaign as EarnKitCampaign;
  // The payout bar: the last payable pick, not the raw score at #winners (fix round 1, I1).
  const picks = pickWinners(entries, c.winners, c.min_score).winners;
  const ended = p.ends_at <= now;
  const state = p.state ?? 'running';
  const own = entries.filter((e) => mine.has(e.id));
  // The builder's best entry: the best-ranked scored one, else any.
  const best = rankEntries(own)[0] ?? own[0];
  return {
    id: p.id,
    title: p.title,
    prize: prizeColumn(c),
    prize_usd_each: prizeUsdEach(c),
    ends_at: p.ends_at,
    entries: entries.length,
    cutoff: picks.length >= c.winners ? picks[c.winners - 1].score : null,
    scored: entries.filter((e) => e.score !== null).length,
    winners: c.winners,
    min_score: c.min_score,
    you: best ? standingText(best, entries, c, { state, ended }) : null,
    open: !ended && p.status === 'active',
  };
}

/**
 * EarnKit campaigns for the first message: open ones, plus ended ones not yet paid out where this
 * installation (or one of its wallets) has an entry (v2.4 §1, §5).
 */
export async function earnkitCampaignRows(installationId: number, now = new Date()) {
  const db = sql();
  const mineSql = () => db`(x.installation_id = ${installationId}
    OR lower(x.payout_wallet) IN (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  const programs = await db<
    { id: string; title: string; campaign: CampaignConfig; ends_at: Date; status: 'active' | 'closed'; state: RunState | null }[]
  >`
    SELECT p.id, p.title, p.campaign, p.ends_at, p.status, r.state
    FROM programs p LEFT JOIN campaign_runs r ON r.program_id = p.id
    WHERE p.campaign->>'kind' = 'earnkit' AND p.ends_at IS NOT NULL AND (
      (p.status = 'active' AND p.ends_at > ${now})
      OR (COALESCE(r.state, 'running') <> 'paid' AND p.ends_at <= ${now}
          AND EXISTS (SELECT 1 FROM projects x WHERE x.program_id = p.id AND ${mineSql()})))
    ORDER BY p.ends_at`;
  if (programs.length === 0) return [];
  const entries = await campaignCandidates(programs.map((p) => p.id));
  const mine = new Set(
    (await db<{ id: number }[]>`
      SELECT x.id FROM projects x WHERE x.program_id IN ${db(programs.map((p) => p.id))} AND ${mineSql()}`).map((r) => r.id),
  );
  // The larger prize per winner first, then the earlier end (controller ruling 12).
  return programs
    .map((p) => campaignRow(p, entries.filter((e) => e.program_id === p.id), mine, now))
    .sort((a, b) => b.prize_usd_each - a.prize_usd_each || a.ends_at.getTime() - b.ends_at.getTime());
}

/** How long earnkitCampaignOpen keeps its answer (v2.8 Ruling 23 (plan): one query per 10 minutes). */
export const CAMPAIGN_OPEN_TTL_MS = 10 * 60 * 1000;
let campaignOpenMemo: { at: number; open: boolean } | null = null;

/**
 * v2.8 Ruling 23 (plan): whether any EarnKit campaign is open now (active, not past its end), the
 * same rule as earnkitCampaignRows' `open`. Memoized in the module for 10 minutes; a failed read
 * rejects and is not memoized (the MCP route then uses false).
 */
export async function earnkitCampaignOpen(now = new Date()): Promise<boolean> {
  if (campaignOpenMemo && now.getTime() - campaignOpenMemo.at < CAMPAIGN_OPEN_TTL_MS) return campaignOpenMemo.open;
  const [row] = await sql()<{ open: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM programs
      WHERE campaign->>'kind' = 'earnkit' AND status = 'active' AND ends_at IS NOT NULL AND ends_at > ${now}
    ) AS open`;
  campaignOpenMemo = { at: now.getTime(), open: row.open };
  return row.open;
}

/** Test only: forget the memoized answer. */
export function resetCampaignOpenMemo() {
  campaignOpenMemo = null;
}
