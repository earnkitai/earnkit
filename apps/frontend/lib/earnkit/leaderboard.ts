import type { CampaignConfig } from './campaigns';
import { sql } from './db';

export type BoardRow = {
  id: number;
  name: string;
  score: number | null;
  rank: number;
  token_url: string | null;
  prize_tx: string | null;
};

/** A campaign and its ranked entries (public; campaigns only). */
export async function getCampaignBoard(slug: string) {
  const [program] = await sql()<
    {
      id: string;
      title: string;
      description: string;
      summary: string;
      ends_at: Date;
      campaign: CampaignConfig | null;
      rules: string[];
    }[]
  >`SELECT id, title, description, summary, ends_at, campaign, rules FROM programs WHERE id = ${slug}`;
  if (!program?.campaign) return null;
  const rows = await sql()<BoardRow[]>`
    SELECT id, name, score, token_url, prize_tx,
      row_number() OVER (ORDER BY score DESC NULLS LAST, submitted_at)::int AS rank
    FROM projects WHERE program_id = ${slug} AND contracts IS NOT NULL
    ORDER BY score DESC NULLS LAST, submitted_at`;
  return { program: { ...program, campaign: program.campaign }, rows };
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
      submitted_at: Date;
      program_id: string;
      program_title: string;
      campaign: CampaignConfig;
      rank: number;
      entries: number;
    }[]
  >`
    SELECT * FROM (
      SELECT p.id, p.name, p.description, p.repo_url, p.live_url, p.token_url, p.contracts, p.score,
        p.scored_at, p.prize_tx, p.submitted_at, p.program_id, pr.title AS program_title, pr.campaign,
        row_number() OVER (PARTITION BY p.program_id ORDER BY p.score DESC NULLS LAST, p.submitted_at)::int AS rank,
        count(*) OVER (PARTITION BY p.program_id)::int AS entries
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE pr.campaign IS NOT NULL AND p.contracts IS NOT NULL
    ) x WHERE x.id = ${id}`;
  return row ?? null;
}
