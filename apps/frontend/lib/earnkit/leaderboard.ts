import type { CampaignConfig, SponsorState, YourEntry } from './campaigns';
import { sql } from './db';
import { sponsorIdentity, trackRecord } from './sponsor-verify';
import { shownUrl } from './untrusted-text';

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
    }[]
  >`SELECT id, title, description, summary, ends_at, status, campaign, rules FROM programs WHERE id = ${slug}`;
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
