import { signInLink } from './x-link';
import { sql } from './db';
import { noteEvent } from './events';
import { REFRESH_BUDGET_MS, refreshPerson, standingOf } from './person-score';
import type { Standing } from './rank';
import type { ReaderDeps } from './source-readers';
import { standingNews } from './stand-text';
import { closeDayOf, prizeOf } from './entry-text';
import { hoursLeft } from './deadline';
import { byDeadline, byPrize, type Card } from './present';
import { moneyText, openCurated } from './pool';
import { newProgramOf, openCuratedRows, repoCanWin, type FitRepo } from './alerts';
import { readFitRepos } from './installations';
import type { Chain } from './match';

/**
 * v2.12.1 T8: the reads and writes behind the Bench reply (bench-reply.ts is pure): the on-demand refresh
 * within its budget, where the person stands, the news since they last looked, and the programs the one
 * project fits (score's, without a GitHub read).
 */

/** What the person was last told (builder_profiles.standing_seen). */
export type Seen = { rank?: number; people?: Record<string, number>; at?: string; declined?: Record<string, string> };
/** Where the person stands, their page and, while they have none, the X sign-in link. */
export type StandBase = { standing: Standing; claimed: boolean; handle: string | null; signInLink: string | null };

/**
 * spec 2: "Inside that call (10-second budget) EarnKit reads the person's public data. Anything
 * slower finishes on the next reply or page view." Starts the refresh (Task 4: at most once every
 * 10 minutes, never throws); `within` resolves when it is done or the budget is spent, whichever is
 * first. A reader that ignores its deadline keeps running in the background and its rescore lands
 * for the next reply; this reply uses the last stored numbers.
 * v4.10.1 Task 3 (R5): `within` is true when the refresh settled in time, false while it still runs, so the reply
 * says no score or week count it would contradict. A refresh of the same person still running in this process (the
 * last call's, past its wait) is joined, never started again: its read claim made this call's own refresh a no-op, so
 * waiting on that alone would read the numbers it is about to replace.
 */
export function startRefresh(id: number, o: { now: Date; start: number; reader?: ReaderDeps; minAgeMs?: number }): { within: (capMs?: number) => Promise<boolean> } {
  const running = RUNNING.get(id);
  // The joined refresh ends by its own deadline (a reader that ignores it is not waited for, nor said to be updating).
  const joined = running && Date.now() < running.deadline ? running : null;
  const deadline = joined?.deadline ?? o.start + REFRESH_BUDGET_MS;
  let refresh: Promise<unknown>;
  if (joined) refresh = joined.done;
  else {
    const entry = { deadline, done: Promise.resolve() as Promise<unknown> };
    entry.done = refreshPerson(id, { now: o.now, deadline, reader: o.reader, minAgeMs: o.minAgeMs }).catch((err: unknown) => {
      console.error('[stand] refresh', err instanceof Error ? err.name : 'error');
    }).finally(() => {
      if (RUNNING.get(id) === entry) RUNNING.delete(id);
    });
    RUNNING.set(id, entry);
    refresh = entry.done;
  }
  let settled = false;
  return {
    // v2.13.1 O5 N1: `capMs` (the Bench's reply wait) ends the wait sooner; the refresh runs on to its deadline.
    within: async (capMs?: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const until = capMs === undefined ? deadline : Math.min(deadline, o.start + capMs);
      const spent = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, until - Date.now()));
      });
      await Promise.race([refresh.then(() => (settled = true)), spent]);
      clearTimeout(timer);
      return settled || Date.now() >= deadline;
    },
  };
}
/**
 * v4.10.1 Task 3: the refreshes running in this process, by person (removed when each settles). In-process only: it
 * assumes one replica (railway.toml sets no numReplicas). With more, a call on another instance reads a no-op refresh as
 * settled; the DB check would then be `read_at > computed_at AND read_at > now - REFRESH_BUDGET_MS` (updating). Past its
 * deadline a refresh counts as settled on purpose (a hung one never leaves a person "updating"), though a reader that
 * ignores its deadline can still write a repo reading streaksFor reads live.
 */
const RUNNING = new Map<number, { deadline: number; done: Promise<unknown> }>();

/**
 * Where the person stands (Task 4) and the X sign-in link while they have no page (x-link.ts signInLink, for
 * the caller's own installation). Null without a profile.
 */
export async function standBase(id: number, o: { own?: number } = {}): Promise<{ base: StandBase; seen: Seen } | null> {
  const [p] = await sql()<{ standing_seen: unknown }[]>`SELECT standing_seen FROM builder_profiles WHERE builder_id = ${id}`;
  if (!p) return null;
  const s = await standingOf(id);
  const claimed = s.claimed && Boolean(s.handle);
  const link = claimed ? null : await signInLink(o.own ?? id, new Date()).catch((err: unknown) => {
    console.error('[stand] sign-in link', err instanceof Error ? err.name : 'error');
    return null;
  });
  const standing: Standing = { ranked: s.ranked, rank: s.rank, total: s.total };
  const seen = p.standing_seen && typeof p.standing_seen === 'object' ? (p.standing_seen as Seen) : {};
  return { base: { standing, claimed, handle: claimed ? s.handle : null, signInLink: link }, seen };
}

/** The standing_seen keys takeNews owns (it replaces them); every other key is kept. */
export const NEWS_KEYS = ['rank', 'at', 'people'];

/**
 * spec 4: the news line since the person last looked, or null. The first look records where they
 * stand and says nothing (nothing happened yet). A line made records the new standing and, with a
 * card offer, the card's moment (card_moments.latest), and one news_shown event.
 */
export async function takeNews(id: number, seen: Seen, base: StandBase, now: Date, ask: boolean): Promise<string | null> {
  const record = async (card: 'rank' | null) => {
    const next: Seen = {
      ...(base.standing.ranked && { rank: base.standing.rank }),
      at: now.toISOString(),
    };
    // v4.0 Task 8 fix round 1: every key is kept but the ones this rewrite owns (where the person stood when told:
    // `rank`, `at`, and the retired `people`), replaced by `next`; an allow-list dropped every key added since
    // (token_offered, setup_asked, setup_done, ...), so a new key can never be lost here again.
    await sql()`
      UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - ${NEWS_KEYS}::text[]) || ${sql().json(next as never)}::jsonb,
        card_moments = CASE WHEN ${card}::text IS NULL THEN card_moments ELSE card_moments || jsonb_build_object('latest', ${card}::text) END
      WHERE builder_id = ${id}`;
  };
  if (!seen.at) {
    await record(null);
    return null;
  }
  const news = standingNews(seen, { standing: base.standing }, now, ask);
  if (!news) return null;
  await record(news.card);
  await noteEvent('news_shown', () => ({
    type: 'news_shown', dedupe_key: `news_shown:${id}:${now.toISOString()}`, installation_id: id, detail: { card: news.card },
  }));
  return news.line;
}

// ---- Ways to get funded -------------------------------------------------------------------------

/**
 * An earn line's prize: "up to $10K" from the per-winner award, else the summary's prize. v3 Stage 2 final
 * review: an investment reads "up to $500K investment" (as pool.ts eachLine), never as a prize. Pure.
 */
export const earnPrize = (c: { max_award_usd?: number | null; summary: string; investment?: boolean }) =>
  c.max_award_usd ? `up to ${moneyText(c.max_award_usd)}${c.investment ? ' investment' : ''}` : prizeOf(c).split(' × ')[0];
/** "closes Oct 14", or "open all year" for a rolling program (the profile's words). Pure. */
export const earnWhen = (c: { summary: string; ends_at?: Date | null }) => {
  const day = closeDayOf(c);
  return day ? `closes ${day}` : 'open all year';
};
/**
 * R12: a reply's funding line deadline: "closes Oct 30", or "rolling". v4.8.1 final fix (R-3): with `now`, a close
 * under 48 hours away is the time left ("closes in 20 hours", deadline.ts hoursLeft), never a calendar day. Every
 * builder-facing caller passes `now`; only a flag (=== 'rolling') or MoveProgram's own `when` leaves it out. Pure.
 */
export const fundWhen = (c: { summary: string; tz?: string | null; ends_at?: Date | string | null }, now?: Date) => {
  const day = closeDayOf(c as Parameters<typeof closeDayOf>[0]);
  if (!day) return 'rolling';
  const left = now && c.ends_at ? hoursLeft(new Date(c.ends_at).toISOString(), now) : null;
  return `closes ${left ?? day}`;
};

/** A program a person could still be shown: curated, open, never an investment, not entered or hidden. Pure. */
export const showable = (c: Card & { agent_completable?: boolean; earnkit_campaign?: boolean }, now: Date, skip: Set<string>) =>
  !c.sponsored && !c.earnkit_campaign && !c.investment && c.agent_completable !== false && !skip.has(c.id) &&
  openCurated(c as Parameters<typeof openCurated>[0], now);


/** v2.13 (spec "2b"): the biggest-prize program a person could still be shown, other than `not`. Pure. */
export const biggestPick = (cards: Card[], now: Date, skip: Set<string>, not: string | null): Card | undefined =>
  cards.filter((c) => c.id !== not && showable(c, now, skip) && (c.max_award_usd ?? 0) > 0).sort(byPrize)[0];

/** R12: at most this many programs are named as fits. */
export const FITS_MAX = 3;
/**
 * R12: score's apply candidates without a GitHub read: the open programs (present.ts byDeadline, the apply step's
 * order) the one project's repo, as find last matched it (installations.fit_repos), could apply to (alerts.ts
 * repoCanWin with `apply`: good odds, never a chain only mentioned, never only new work), investments included, never
 * an in-person program, each with the repo's facts for its why. v3.1 F1: the fit lines are these, in byRelevance
 * order, at most FITS_MAX (bench-find.ts fitLines). Never throws (none on an error).
 */
export async function scoreFits(id: number, main: string, o: { cards: Card[]; skip: Set<string>; now: Date }): Promise<{ card: Card; repo: FitRepo }[]> {
  try {
    const [fits, rows] = await Promise.all([readFitRepos(id), openCuratedRows()]);
    const stored = fits.find((f) => f.key.toLowerCase() === main.toLowerCase());
    if (!stored) return [];
    // v4.2 Task 10 (G1): what the builder told since the repo was matched (has users, a live link, chains) counts now, as
    // in find's next match, so setup done and score read the same fits.
    const [told] = await sql()<{ mainnet_chains: Chain[]; testnet_chains: Chain[]; live_url: string | null; has_users: boolean | null; not_mine: boolean }[]>`
      SELECT mainnet_chains, testnet_chains, live_url, has_users, not_mine FROM builder_repo_facts
      WHERE installation_id = ${id} AND login = '' AND lower(repo_key) = ${main.toLowerCase()}`;
    const repo: FitRepo = told ? { ...stored, said: { mainnet: told.mainnet_chains, testnet: told.testnet_chains, live_url: told.live_url, has_users: told.has_users, not_mine: told.not_mine } } : stored;
    const byId = new Map(rows.map((r) => [r.id, newProgramOf(r)]));
    return o.cards
      // v3 Stage 2: an in-person program is never a fit (a fit is applying from the ship log); it stays on /programs.
      // showable leaves investments out of picks; an investment is an apply candidate here.
      .filter((c) => showable({ ...c, investment: false }, o.now, o.skip) && !c.in_person)
      .sort(byDeadline)
      .filter((c) => {
        const np = byId.get(c.id);
        return Boolean(np && repoCanWin(np, repo, { apply: true }));
      })
      .map((card) => ({ card, repo }));
  } catch (err) {
    console.error('[score] fits', err instanceof Error ? err.name : 'error');
    return [];
  }
}
