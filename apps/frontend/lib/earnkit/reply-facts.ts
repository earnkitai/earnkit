import { sql } from './db';
import { profileData } from './bench-data';
import { BUILDER_CODES_GUIDE } from './bench-reply';
import { BENCH_VERIFIED, HERO_TITLE, STEPS } from './site-copy';
import { DOCS_SCORE } from './docs-copy';
import { shortWallet, siteUrl } from './entry-text';
import { pagePath } from './reserved-routes';
import { REVENUE_MIN, tractionFacts } from './ship-log-facts';
import { provenWallet } from './wallet-proof';
import { personal } from './standing';
import { lastFinishedMonday } from './weeks';
import { weekFactsFor } from './week-facts';

/**
 * v3.1 answerable replies (spec section 1): the facts find and score carry so the agent can answer the builder's own
 * question ("what's my wallet", "who backed me") in one short line. Only what is true and
 * known; unknown keys are left out. Only the caller's own data: a shared client without a signed-in builder gets
 * `about` alone. The `about` lines are EarnKit's existing site and docs copy, never new claims.
 */
export type ReplyFacts = {
  page?: { url: string; public: boolean };
  rank?: { line: string; score?: number };
  streak?: number;
  shipped_last_week?: { week: string; summary?: string; note?: string; commits?: number };
  wallet?: string;
  earned?: { usd: number };
  applications?: { program: string; status: string }[];
  /** v4.5 Task 3: people who used the builder's app in the last 30 days, verified onchain (the ship log's usage line's rules). */
  used_by_30d?: number;
  /** v4.5 Task 3: whole dollars outside wallets paid into the builder's contracts in the last 30 days (the revenue line's rules). Private. */
  revenue_30d_usd?: number;
  /** v4.6 Task 3: whole dollars received through Stripe in the last 30 days (the ship log line's rules). Private. */
  stripe_30d_usd?: number;
  /** v4.6 Task 3: whole dollars of active subscriptions a month, from REVENUE_MIN (the ship log line's rules). Private. */
  stripe_mrr_usd?: number;
  about: Record<string, string>;
};

/**
 * v4.2 Task 3 (F10): the answers to the questions builders ask mid-flow. Each line is checked against the code:
 * tokens split 40% builder / 60% Safe after Clanker's share (builder-token.ts, policy.ts SPLIT); the page shows the
 * weekly summary written from commit and PR titles, never titles or code, and a private repo's name, link and (unless
 * titles are on or the builder approved that text) summary stay off it (ship-titles.ts titlesShown, week-summary.ts
 * summaryShown, page-data.ts shownProjects); the App is read-only, Contents and Metadata (github-app.ts); hide is
 * tell profile 'hide'. Pure.
 */
export function askedFacts(): Record<string, string> {
  return {
    earnkit_gets: "Builders pay nothing. When a builder's token trades, 40% of the fee goes to the builder and the rest keeps EarnKit running.",
    privacy:
      "EarnKit gets read-only access to only the repos you pick, and never shows or posts your code. Your page shows a short summary of what you shipped each week, written from your commit titles, never the titles or the code. A private repo's name and link stay off your page, and its summary shows only if you allow it. Say hide my page and it's hidden.",
    token_earnings: "It depends on how much people trade. There's no promise; 40% of every trade's fee goes to you, claimed for you.",
    token_chain: 'Tokens are on Base. Grants can be on any chain.',
  };
}

/** What EarnKit is, how ranking works, Builder Codes and the page: existing copy only (site-copy, docs-copy). Pure. */
export function aboutFacts(): Record<string, string> {
  return {
    earnkit: `${HERO_TITLE} ${STEPS[1].text} ${STEPS[2].text}`,
    ranking: `Builders are ranked by how often they ship. Shipping score: ${DOCS_SCORE.text} ${BENCH_VERIFIED}`,
    builder_code: `A Builder Code is a one-line tag Base uses to see your traffic. Guide: https://${BUILDER_CODES_GUIDE}`,
    data: 'You can hide your page anytime (say hide my page).',
    ...askedFacts(),
  };
}

/**
 * v4.10.2 Task 3 (R6): `shipped_last_week` names the last FINISHED ISO week (weeks.ts lastFinishedMonday), never an older
 * week's row. The week's ship-log card gives its summary, note and commits; when it has none (the row is written Mondays
 * from 15:00 UTC, week-facts.ts weeklyFactsStep) the repo reading's commit count for that week stands in (weekFactsFor,
 * the ship log's own rule), no summary. A hidden row stays hidden (no fallback). Absent when the week has nothing. Never throws.
 */
export async function shippedLastWeek(
  id: number,
  log: { week: string; summary?: string | null; text: string | null; commits?: number }[],
  now: Date,
): Promise<ReplyFacts['shipped_last_week'] | undefined> {
  const monday = lastFinishedMonday(now);
  const card = log.find((c) => c.week === monday && (c.summary || c.text || c.commits));
  if (card) return { week: card.week, ...(card.summary && { summary: card.summary }), ...(card.text && { note: card.text }), ...(card.commits && { commits: card.commits }) };
  try {
    const [hidden] = await sql()<{ x: number }[]>`SELECT 1 AS x FROM project_updates WHERE builder_id = ${id} AND week = ${monday} AND hidden LIMIT 1`;
    if (hidden) return undefined;
    const n = (await weekFactsFor(id, monday, now)).shipped_code?.n ?? 0;
    return n > 0 ? { week: monday, commits: n } : undefined;
  } catch (err) {
    console.error('[reply facts] last week', err instanceof Error ? err.name : 'error');
    return undefined;
  }
}

/**
 * The facts for this caller: `about` always; the builder's own page, rank, streak, last shipped week (as the page
 * shows it: bench-data.ts profileData's visibility rules), proven reward wallet (short), Earned, applications and
 * (v4.5 Task 3, hidden page or not) verified usage and revenue only for a signed-in builder with a page. Never throws: a failed read leaves its keys out (logged).
 */
export async function replyFacts(ctx: { installationId: number; ownInstallationId?: number; sharedClient?: boolean }, now: Date = new Date()): Promise<ReplyFacts> {
  const about = aboutFacts();
  try {
    if (!(await personal(ctx))) return { about };
    const id = ctx.installationId;
    const d = await profileData(id, now);
    if (!d) return { about };
    const db = sql();
    const [[prof], wallet, statuses, traction] = await Promise.all([
      db<{ hidden: boolean; bound: boolean }[]>`SELECT hidden, x_user_id IS NOT NULL AS bound FROM builder_profiles WHERE builder_id = ${id}`,
      provenWallet(id),
      db<{ program: string; status: string }[]>`
        SELECT g.title AS program, s.status FROM builder_program_status s JOIN installations i ON i.id = s.installation_id JOIN programs g ON g.id = s.program_id
        WHERE COALESCE(i.builder_id, i.id) = ${id} AND s.login = '' AND s.status <> 'not_interested' ORDER BY s.at DESC`,
      // v4.5 Task 3: a failed traction read leaves its keys out, never the rest.
      tractionFacts(id, now).catch((err: unknown) => {
        console.error('[reply facts] traction', err instanceof Error ? err.name : 'error');
        return null;
      }),
    ]);
    const facts: ReplyFacts = {
      page: { url: `${siteUrl()}${pagePath(d.handle)}`, public: Boolean(prof && !prof.hidden && prof.bound) },
      about,
    };
    if (d.bench) facts.rank = { line: d.bench, ...(d.score !== null && { score: d.score }) };
    if (d.project?.confirmed) facts.streak = d.streak;
    const shipped = await shippedLastWeek(id, d.log, now);
    if (shipped) facts.shipped_last_week = shipped;
    if (wallet) facts.wallet = shortWallet(wallet);
    facts.earned = { usd: Math.round(d.earned.paid_usd) };
    // The builder's own statuses, then a won program the page shows that they never told EarnKit about.
    const apps = statuses.map((s) => ({ program: s.program, status: s.status }));
    for (const g of d.project?.programs ?? []) if (g.won && !apps.some((a) => a.program === g.title)) apps.push({ program: g.title, status: 'won' });
    facts.applications = apps;
    if (traction?.usedBy) facts.used_by_30d = traction.usedBy.users;
    if (traction?.revenue) facts.revenue_30d_usd = traction.revenue.usd;
    if (traction?.stripe) {
      facts.stripe_30d_usd = traction.stripe.usd;
      if (traction.stripe.mrr >= REVENUE_MIN) facts.stripe_mrr_usd = traction.stripe.mrr;
    }
    return facts;
  } catch (err) {
    console.error('[reply facts]', err instanceof Error ? err.name : 'error');
    return { about };
  }
}
