import {
  prizeColumn,
  prizeUsdEach,
  type CampaignConfig,
  type EarnKitCampaign,
  type SponsorState,
  type YourEntry,
} from './campaigns';
import { sql } from './db';
import type { CampaignRow } from './present';
import type { TokenPolicy } from './program-file';
import { sponsorIdentity, trackRecord } from './sponsor-verify';
import { shownUrl } from './untrusted-text';
import { rankEntries, standingText, type Candidate, type RunState } from './winners';

export type BoardRow = {
  id: number;
  name: string;
  repo_url: string | null;
  live_url: string | null;
  score: number | null;
  rank: number;
  token_url: string | null;
  prize_tx: string | null;
  payout_wallet: string;
  prize_amount: string | null;
  prize_reason: string | null;
};

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
  const rows = await sql()<BoardRow[]>`
    SELECT id, name, repo_url, live_url, score, token_url, prize_tx, payout_wallet, prize_amount,
      prize_reason, row_number() OVER (ORDER BY score DESC NULLS LAST, submitted_at)::int AS rank
    FROM projects WHERE program_id = ${slug} AND payout_wallet IS NOT NULL
    ORDER BY score DESC NULLS LAST, submitted_at`;
  // An EarnKit campaign that closed without ever taking an entry (Campaign #1) isn't public.
  if (
    program.campaign.kind === 'earnkit' &&
    program.status === 'closed' &&
    rows.length === 0
  )
    return null;
  return {
    program: { ...program, campaign: program.campaign },
    // Builder links are data: a stored value that isn't a plain https link is not shown.
    rows: rows.map((r) => ({
      ...r,
      live_url: shownUrl(r.live_url),
      repo_url: shownUrl(r.repo_url),
    })),
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
  return row
    ? {
        ...row,
        live_url: shownUrl(row.live_url),
        repo_url: shownUrl(row.repo_url),
      }
    : null;
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

/** Every entry of these campaigns as winner selection reads it. */
export async function campaignCandidates(programIds: string[]) {
  if (programIds.length === 0) return [];
  return sql()<(Candidate & { program_id: string })[]>`
    SELECT id, program_id, score, submitted_at, payout_wallet, installation_id, vetoed_at,
      payout_status, prize_tx
    FROM projects
    WHERE program_id IN ${sql()(programIds)} AND payout_wallet IS NOT NULL`;
}

/** One EarnKit campaign row for list_programs (v2.4 §1): live numbers and the builder's best standing. Pure; exported for tests. */
export function campaignRow(
  p: { id: string; title: string; campaign: CampaignConfig; ends_at: Date; status: 'active' | 'closed'; state: RunState | null },
  entries: Candidate[],
  mine: Set<number>,
  now: Date,
): CampaignRow {
  const c = p.campaign as EarnKitCampaign;
  const ranked = rankEntries(entries);
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
    cutoff: ranked.length >= c.winners ? ranked[c.winners - 1].score : null,
    winners: c.winners,
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
