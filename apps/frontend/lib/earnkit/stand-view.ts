import { claimLink } from './claim';
import { sql } from './db';
import { siteUrl } from './entry-text';
import { noteEvent } from './events';
import { createVerifyLink, githubVerifyEnabled } from './github-verify';
import { REFRESH_BUDGET_MS, refreshPerson, standingOf } from './person-score';
import { r2Enabled } from './r2';
import type { Standing } from './rank';
import type { ReaderDeps } from './source-readers';
import { upgradeToken } from './wallet-proof';
import { confirmLinkLine, pageReadyLine, plainWhat, standingNews, type StandProject, type StandView } from './where-you-stand';

/**
 * v2.12.1 T8: the reads and writes behind the three-part reply (where-you-stand.ts is pure): the
 * on-demand refresh within its budget, the person's view, the news since they last looked, the
 * one-time "Your page is ready", and the yes to a `confirm` step. Builder score flag on only;
 * callers check it.
 */

/** What the person was last told (builder_profiles.standing_seen). */
export type Seen = { rank?: number; people?: Record<string, number>; at?: string };
export type StandBase = Omit<StandView, 'step' | 'news' | 'earn' | 'fresh'>;

/**
 * spec 2: "Inside that call (10-second budget) EarnKit reads the person's public data. Anything
 * slower finishes on the next reply or page view." Starts the refresh (Task 4: at most once every
 * 10 minutes, never throws); `within` resolves when it is done or the budget is spent, whichever is
 * first. A reader that ignores its deadline keeps running in the background and its rescore lands
 * for the next reply; this reply uses the last stored numbers.
 */
export function startRefresh(id: number, o: { now: Date; start: number; reader?: ReaderDeps }): { within: () => Promise<void> } {
  const deadline = o.start + REFRESH_BUDGET_MS;
  const refresh = refreshPerson(id, { now: o.now, deadline, reader: o.reader }).catch((err: unknown) => {
    console.error('[stand] refresh', err instanceof Error ? err.name : 'error');
  });
  return {
    within: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const spent = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      });
      await Promise.race([refresh, spent]);
      clearTimeout(timer);
    },
  };
}

type ProjectDbRow = {
  project_key: string; name: string; what: string | null; kind: string; confirmed: boolean; shipped: boolean; people: number;
  has_coin: boolean; sends_tx: boolean; tagged: boolean; untracked_contract: string | null;
};

/** A GitHub repo key ("lee/tipjar"): the project EarnKit can host (R2) or put on GitHub Pages. Pure. */
const REPO_KEY = /^[a-z0-9-]+\/[a-z0-9._-]+$/i;
/**
 * Ruling S15: EarnKit can put this project online now: it has a GitHub repo, and EarnKit hosting
 * is on (R2) or the agent can push a GitHub Pages branch (it builds).
 */
export const hostFor = (agentCanBuild: boolean) => (key: string) => REPO_KEY.test(key) && (r2Enabled() || agentCanBuild);

/**
 * The person's view without programs or a step: their standing (Task 4), their projects (shipped
 * first, then people, then newest), and the claim link while they have no page. Null without a profile.
 */
export async function standBase(id: number): Promise<{ base: StandBase; seen: Seen; created_at: Date; page_ready_shown_at: Date | null } | null> {
  const [p] = await sql()<{ standing_seen: unknown; created_at: Date; page_ready_shown_at: Date | null }[]>`
    SELECT standing_seen, created_at, page_ready_shown_at FROM builder_profiles WHERE builder_id = ${id}`;
  if (!p) return null;
  const s = await standingOf(id);
  const rows = await sql()<ProjectDbRow[]>`
    SELECT project_key, name, what, kind, confirmed, shipped, people, has_coin, sends_tx, tagged, untracked_contract
    FROM builder_projects WHERE builder_id = ${id}
    ORDER BY shipped DESC, people DESC, last_active_at DESC NULLS LAST, project_key`;
  const projects: StandProject[] = rows.map((r) => ({
    key: r.project_key,
    name: r.name,
    what: plainWhat(r.what),
    shipped: r.shipped,
    people: Math.max(0, r.people),
    has_coin: r.has_coin,
    sends_tx: r.sends_tx,
    tagged: r.tagged,
    untracked_contract: r.untracked_contract,
    // Task 4 sets untracked_contract only for a contract with callers; the count itself is T9's read.
    untracked_people: r.untracked_contract ? 1 : 0,
    // T9 (countableNow): whether counting them moves the rank today. Until then, never promised.
    certain: false,
    app: r.kind === 'app',
    confirmed: r.confirmed,
  }));
  const claimed = s.claimed && Boolean(s.handle);
  const link = claimed ? null : await claimLink(id).catch((err: unknown) => {
    console.error('[stand] claim link', err instanceof Error ? err.name : 'error');
    return null;
  });
  const standing: Standing = { ranked: s.ranked, rank: s.rank, total: s.total };
  const seen = p.standing_seen && typeof p.standing_seen === 'object' ? (p.standing_seen as Seen) : {};
  return {
    base: { standing, claimed, handle: claimed ? s.handle : null, claimLink: link, projects },
    seen,
    created_at: p.created_at,
    page_ready_shown_at: p.page_ready_shown_at,
  };
}

/**
 * spec 4: the news line since the person last looked, or null. The first look records where they
 * stand and says nothing (nothing happened yet). A line made records the new standing and, with a
 * card offer, the card's moment (card_moments.latest), and one news_shown event.
 */
export async function takeNews(id: number, seen: Seen, base: StandBase, now: Date, ask: boolean): Promise<string | null> {
  const record = async (card: 'people' | 'rank' | null) => {
    const next: Seen = {
      ...(base.standing.ranked && { rank: base.standing.rank }),
      people: Object.fromEntries(base.projects.map((p) => [p.key, p.people])),
      at: now.toISOString(),
    };
    await sql()`
      UPDATE builder_profiles SET standing_seen = ${sql().json(next as never)},
        card_moments = CASE WHEN ${card}::text IS NULL THEN card_moments ELSE card_moments || jsonb_build_object('latest', ${card}::text) END
      WHERE builder_id = ${id}`;
  };
  if (!seen.at) {
    await record(null);
    return null;
  }
  const news = standingNews(seen, { standing: base.standing, projects: base.projects }, now, ask);
  if (!news) return null;
  await record(news.card);
  await noteEvent('news_shown', () => ({
    type: 'news_shown', dedupe_key: `news_shown:${id}:${now.toISOString()}`, installation_id: id, detail: { card: news.card },
  }));
  return news.line;
}

/**
 * The one-time "Your EarnKit page is ready" (plan T8 step 6): a person who used find before their
 * profile existed (a v2.11 builder on their first find with the flag on), unclaimed, never shown it,
 * with a claim link and something on the page. Marks it shown. Null otherwise.
 */
export async function takePageReady(
  id: number,
  o: { lastCheck: Date | null; created_at: Date; page_ready_shown_at: Date | null; claimed: boolean; link: string | null; projects: number },
): Promise<string | null> {
  // Spec example 3: with nothing found there is no page to claim yet, so nothing is "ready".
  if (o.lastCheck === null || o.claimed || o.page_ready_shown_at || !o.link || o.projects === 0 || !(o.lastCheck < o.created_at)) return null;
  const [row] = await sql()`
    UPDATE builder_profiles SET page_ready_shown_at = now() WHERE builder_id = ${id} AND page_ready_shown_at IS NULL RETURNING 1`;
  if (!row) return null;
  await noteEvent('page_ready_shown', () => ({ type: 'page_ready_shown', dedupe_key: `page_ready_shown:${id}`, installation_id: id }));
  return pageReadyLine(o.link);
}

/**
 * The yes to a `confirm` step (T7 carry): the claim page's upgrade links last 30 minutes, so the
 * reply makes a new one. A contract or coin is shown to be theirs with a wallet signature; other
 * work with GitHub sign-in while it is on (else the wallet). Unclaimed: the claim link first.
 */
export async function confirmYes(id: number, now: Date): Promise<{ show_to_builder: string; agent_note?: string }> {
  const v = await standBase(id);
  if (!v) return { show_to_builder: '', agent_note: 'There is nothing to confirm yet.' };
  if (!v.base.claimed)
    return v.base.claimLink ? { show_to_builder: `Claim your page with X first: ${v.base.claimLink}` } : { show_to_builder: '', agent_note: 'There is no page to confirm yet.' };
  const [onchain] = await sql()`
    SELECT 1 FROM builder_projects WHERE builder_id = ${id} AND shipped AND NOT confirmed AND (kind IN ('contract','coin') OR untracked_contract IS NOT NULL) LIMIT 1`;
  const wallet = () => {
    const t = upgradeToken(id, now);
    return t ? `${siteUrl()}/claim/wallet?t=${encodeURIComponent(t)}` : null;
  };
  let link: string | null = null;
  if (!onchain && githubVerifyEnabled())
    link = await createVerifyLink({ installationId: id, projectId: null, repoKey: `claim/${id}`, purpose: 'claim' }).catch((err: unknown) => {
      console.error('[stand] github link', err instanceof Error ? err.name : 'error');
      return null;
    });
  link ??= wallet();
  return link ? { show_to_builder: confirmLinkLine(link) } : { show_to_builder: '', agent_note: 'No link can be made right now. Ask again later.' };
}
