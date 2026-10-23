import { sql } from './db';
import { profileData } from './bench-data';
import { backersOfCoin } from './backers';
import { BUILDER_CODES_GUIDE } from './bench-reply';
import { raisingEnabled } from './builder-score-flag';
import { BENCH_VERIFIED, HERO_TITLE, STEPS } from './site-copy';
import { DOCS_SCORE } from './docs-copy';
import { earnedUsd } from './earned';
import { shortWallet, siteUrl } from './entry-text';
import { POINTS_PAGE_LINE } from './points';
import { raisingCoin } from './raising';
import { pagePath } from './reserved-routes';
import { provenWallet } from './wallet-proof';
import { mondayOf } from './weeks';

/**
 * v3.1 answerable replies (spec section 1): the facts find and score carry so the agent can answer the builder's own
 * question ("how many points do I have", "what's my wallet", "who backed me") in one short line. Only what is true and
 * known; unknown keys are left out. Only the caller's own data: a shared client without a signed-in builder gets
 * `about` alone. The `about` lines are EarnKit's existing site and docs copy, never new claims.
 */
export type ReplyFacts = {
  page?: { url: string; public: boolean };
  points?: { total: number; this_week: number; what_for: string };
  rank?: { line: string; score?: number };
  streak?: number;
  shipped_last_week?: { week: string; summary?: string; note?: string; commits?: number };
  wallet?: string;
  coin?: { symbol: string; url: string; backers: number; fees_to_you: number } | null;
  earned?: { usd: number };
  applications?: { program: string; status: string }[];
  about: Record<string, string>;
};

/** What EarnKit is, how ranking works, Builder Codes, backers and the page: existing copy only (site-copy, docs-copy). Pure. */
export function aboutFacts(raising: boolean = raisingEnabled()): Record<string, string> {
  return {
    earnkit: `${HERO_TITLE} ${STEPS[1].text} ${STEPS[2].text}`,
    ranking: `Builders are ranked by how often they ship. Shipping score: ${DOCS_SCORE.text} ${BENCH_VERIFIED}`,
    points: POINTS_PAGE_LINE,
    builder_code: `A Builder Code is a one-line tag Base uses to see your traffic. Guide: https://${BUILDER_CODES_GUIDE}`,
    ...(raising && {
      backers: "Backers follow posts about real progress. For a post about this week: call tell with token: 'ask', and a yes drafts it.",
    }),
    data: 'You can hide your page anytime (say hide my page).',
  };
}

/** Whether the caller is a person: not a shared client, or a shared client whose own installation is bound to X. */
async function personal(ctx: { installationId: number; ownInstallationId?: number; sharedClient?: boolean }): Promise<boolean> {
  if (!ctx.sharedClient) return true;
  const [r] = await sql()<{ x: string | null }[]>`SELECT x_user_id AS x FROM installations WHERE id = ${ctx.ownInstallationId ?? ctx.installationId}`;
  return Boolean(r?.x);
}

/**
 * The facts for this caller: `about` always; the builder's own page, points, rank, streak, last shipped week (as the page
 * shows it: bench-data.ts profileData's visibility rules), proven reward wallet (short), coin, Earned and applications
 * only for a signed-in builder with a page. Never throws: a failed read leaves its keys out (logged).
 */
export async function replyFacts(ctx: { installationId: number; ownInstallationId?: number; sharedClient?: boolean }, now: Date = new Date()): Promise<ReplyFacts> {
  const about = aboutFacts();
  try {
    if (!(await personal(ctx))) return { about };
    const id = ctx.installationId;
    const d = await profileData(id, now);
    if (!d) return { about };
    const db = sql();
    const [[prof], [week], wallet, statuses] = await Promise.all([
      db<{ hidden: boolean; bound: boolean }[]>`SELECT hidden, x_user_id IS NOT NULL AS bound FROM builder_profiles WHERE builder_id = ${id}`,
      db<{ n: string }[]>`SELECT COALESCE(sum(points), 0)::text AS n FROM builder_points WHERE builder_id = ${id} AND created_at >= ${`${mondayOf(now)}T00:00:00Z`}::timestamptz`,
      provenWallet(id),
      db<{ program: string; status: string }[]>`
        SELECT g.title AS program, s.status FROM builder_program_status s JOIN installations i ON i.id = s.installation_id JOIN programs g ON g.id = s.program_id
        WHERE COALESCE(i.builder_id, i.id) = ${id} AND s.login = '' AND s.status <> 'not_interested' ORDER BY s.at DESC`,
    ]);
    const facts: ReplyFacts = {
      page: { url: `${siteUrl()}${pagePath(d.handle)}`, public: Boolean(prof && !prof.hidden && prof.bound) },
      points: { total: d.points, this_week: Number(week?.n ?? 0), what_for: POINTS_PAGE_LINE },
      about,
    };
    if (d.bench) facts.rank = { line: d.bench, ...(d.score !== null && { score: d.score }) };
    if (d.project?.confirmed) facts.streak = d.streak;
    const last = d.log.find((c) => c.summary || c.text || c.commits);
    if (last)
      facts.shipped_last_week = { week: last.week, ...(last.summary && { summary: last.summary }), ...(last.text && { note: last.text }), ...(last.commits && { commits: last.commits }) };
    if (wallet) facts.wallet = shortWallet(wallet);
    if (raisingEnabled()) {
      const c = await raisingCoin(id).catch(() => null);
      facts.coin = c && c.status === 'launched'
        ? { symbol: c.symbol, url: c.url, backers: await backersOfCoin(c.coin).catch(() => 0), fees_to_you: Math.round((await earnedUsd(id, now).catch(() => null))?.fees_usd ?? 0) }
        : null;
    }
    facts.earned = { usd: Math.round(d.earned.paid_usd) };
    // The builder's own statuses, then a won program the page shows that they never told EarnKit about.
    const apps = statuses.map((s) => ({ program: s.program, status: s.status }));
    for (const g of d.project?.programs ?? []) if (g.won && !apps.some((a) => a.program === g.title)) apps.push({ program: g.title, status: 'won' });
    facts.applications = apps;
    return facts;
  } catch (err) {
    console.error('[reply facts]', err instanceof Error ? err.name : 'error');
    return { about };
  }
}
