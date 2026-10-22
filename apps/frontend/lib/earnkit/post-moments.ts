import { usd } from './campaigns';
import { sql } from './db';
import { benchConfirmedSql, mainProjectOf } from './main-project';
import { PRIVATE_NAME, norm, shownProjects } from './page-data';
import { COIN_PROGRAM } from './policy-constants';
import { createDraft, recentDrafts, type DraftLimit, type DraftRow, type PostMoment, type RecentDraft } from './post-drafts';
import { isMilestone, writePost, type PostInput } from './post-writer';
import { pillCoin } from './raising';
import { checkUpdate, type OwnLinks } from './update-text';
import { firstLiveAt, hasFacts, type WeekFacts } from './week-facts';
import { weekLineRule } from './weekly-moment';
import { lastFinishedMonday, mondayOfWeek } from './weeks';

/**
 * v3.1 one-tap posts (design 1, Task 3): which moments are worth a post, from data EarnKit already has, and when a
 * moment waits (its cooldown) or is never posted. Every rule favors fewer, truer posts.
 *
 * | Moment | Trigger | Cooldown | Never when |
 * | Weekly | last finished week's ship-log row with facts and a summary or note | 13 days after a tapped weekly (not for a milestone, went live or a win) | no facts, or the streak alone |
 * | Went live | the project's first live moment (week-facts.ts firstLiveAt), within 14 days | once a project | under 2 days old (a site probe can flap) |
 * | Won | an announced win (entry_outcomes basis 'announcement', with its source link), within 14 days | once a program | self-reported only |
 * | Accepted, funded or won (told) | the agent passes a public proof link it checked (owner ruling 3) | once a program | no proof, or proof on the builder's own site |
 * | Streak milestone | 4, 8, 12, 26, 52 weeks in a row | folds into the weekly | never a post of its own |
 * | Builder's news | tell update { text } | 24 hours | the text fails checkUpdate |
 * | Coin intro | the coin is launched and the page shows backing (raising.ts pillCoin; owner ruling 1) | once ever | a coin already introduced |
 * | Backing opened, applied, first users | none | | never a post |
 *
 * Besides these, one non-weekly moment kind is drafted at most once in 28 days (the builder's news excepted: its
 * cooldown is its own 24 hours), and the store's limits (post-drafts.ts) hold over all of it.
 */
export const WEEKLY_TAPPED_COOLDOWN_DAYS = 13;
export const SAME_KIND_DAYS = 28;
export const NEWS_COOLDOWN_HOURS = 24;
export const LIVE_SETTLE_DAYS = 2;
export const EVENT_FRESH_DAYS = 14;
const DAY = 86_400_000;

export type MomentCandidate = {
  moment: PostMoment;
  momentKey: string;
  projectKey: string | null;
  week: string | null;
  input: PostInput;
  /** The moment's facts, frozen with the draft for its card (Task 5). */
  card: Record<string, unknown>;
  proofUrl: string | null;
  /** Weekly only: the week holds a milestone, went live or a win, so the 13-day cooldown is skipped. */
  bigWeek?: boolean;
};
export type Hold = 'drafted' | 'cooldown' | 'once' | 'same_kind';
export type Skip =
  | 'no_page' | 'no_project' | 'no_week' | 'no_facts' | 'nothing_to_say' | 'not_live' | 'settling' | 'stale' | 'no_coin'
  | 'no_program' | 'no_proof' | 'text';
type Log = Pick<RecentDraft, 'moment' | 'moment_key' | 'created_at' | 'first_tap_at' | 'asked'>[];

/** Why this moment waits or is never drafted again, given the person's drafts; null: it may be drafted. Pure. */
export function holdOf(c: MomentCandidate, log: Log, now: Date): Hold | null {
  const since = (days: number) => now.getTime() - days * DAY;
  switch (c.moment) {
    case 'weekly':
      if (log.some((d) => d.moment_key === c.momentKey && !d.asked)) return 'drafted';
      if (!c.bigWeek && log.some((d) => d.moment === 'weekly' && d.first_tap_at && d.first_tap_at.getTime() > since(WEEKLY_TAPPED_COOLDOWN_DAYS))) return 'cooldown';
      return null;
    case 'news':
      return log.some((d) => d.moment === 'news' && d.created_at.getTime() > now.getTime() - NEWS_COOLDOWN_HOURS * 3_600_000) ? 'cooldown' : null;
    case 'coin_intro':
      // Owner ruling 1: one intro, ever.
      return log.some((d) => d.moment === 'coin_intro') ? 'once' : null;
    default:
      if (log.some((d) => d.moment_key === c.momentKey)) return 'once';
      if (log.some((d) => d.moment === c.moment && d.created_at.getTime() > since(SAME_KIND_DAYS))) return 'same_kind';
      return null;
  }
}

/** A just-live project waits LIVE_SETTLE_DAYS (a site probe can flap); one live over EVENT_FRESH_DAYS ago is stale. Pure. */
export function liveTiming(first: Date, now: Date): 'settling' | 'stale' | null {
  const age = now.getTime() - first.getTime();
  if (age < LIVE_SETTLE_DAYS * DAY) return 'settling';
  if (age > EVENT_FRESH_DAYS * DAY) return 'stale';
  return null;
}

const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com']);
const X_POST = /^\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}\/?$/;
/** The last two labels of a host name ("blog.base.org" to "base.org"). */
const site = (host: string) => host.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
const hostOf = (u: string) => (URL.canParse(u) ? new URL(u).hostname.toLowerCase() : null);

/**
 * Owner ruling 3: the public page that verifies an accepted, funded or won moment, as the agent passes it. An https
 * link (no credentials, no IP address) that is either a post on X (x.com/<user>/status/<id>) or on the program's own
 * site (its source or submission link's domain); never earnkit.com, the builder's own site or their own repo. The
 * stored form drops the fragment. Null: not proof. EarnKit does not fetch it (the agent checked it). Pure.
 */
export function proofUrlOk(raw: unknown, o: { programUrls: (string | null)[]; own: OwnLinks }): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || !URL.canParse(raw.trim())) return null;
  const u = new URL(raw.trim());
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return null;
  if (site(host) === 'earnkit.com') return null;
  if (o.own.sites.some((s) => hostOf(s) === host)) return null;
  if (o.own.repo && site(host) === 'github.com' && u.pathname.toLowerCase().startsWith(`/${o.own.repo.toLowerCase()}`)) return null;
  const onX = X_HOSTS.has(host) && X_POST.test(u.pathname);
  const programSites = new Set(o.programUrls.flatMap((p) => (p && hostOf(p) ? [site(hostOf(p)!)] : [])));
  if (!onX && !programSites.has(site(host))) return null;
  u.hash = '';
  return u.toString();
}

// --- What the moments read ---------------------------------------------------------------------------------------------

/** The person's page and one confirmed project: its key, its shown name (null for a private one) and its weeks. */
type Poster = { key: string; name: string | null; commitWeeks: string[]; weeksShipping: number };
async function posterOf(builderId: number): Promise<Poster | Skip> {
  const db = sql();
  const [p] = await db<{ handle: string | null; hidden: boolean }[]>`
    SELECT x_handle AS handle, hidden FROM builder_profiles WHERE builder_id = ${builderId} AND x_user_id IS NOT NULL`;
  if (!p?.handle || p.hidden) return 'no_page';
  const key = await mainProjectOf(builderId);
  if (!key) return 'no_project';
  const [b] = await db<{ commit_weeks: string[]; weeks_shipping: number }[]>`
    SELECT b.commit_weeks, b.weeks_shipping FROM builder_projects b
    WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${key}) AND ${benchConfirmedSql(db)}`;
  if (!b) return 'no_project';
  const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(key));
  const name = shown && shown.safeName !== PRIVATE_NAME ? shown.safeName : null;
  return { key, name, commitWeeks: b.commit_weeks, weeksShipping: b.weeks_shipping };
}
const ownLinksOf = async (builderId: number) => (await import('./updates')).ownLinks(builderId);

/** Last finished week's post: its facts, the summary as the profile shows it, the builder's note. */
export async function weeklyCandidate(builderId: number, now: Date): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  const monday = lastFinishedMonday(now);
  const [u] = await sql()<{ facts: WeekFacts; titles: string[]; summary: string | null; text: string | null }[]>`
    SELECT facts, titles, summary, text FROM project_updates
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${p.key}) AND week = ${monday} AND NOT hidden`;
  if (!u) return 'no_week';
  // The streak alone (or people or money) is not a week worth a post.
  if (!hasFacts(u.facts)) return 'no_facts';
  const summary = (await weekLineRule(builderId, p.key))(u);
  const checked = u.text ? checkUpdate(u.text, await ownLinksOf(builderId)) : null;
  const note = checked?.ok ? checked.text : null;
  const week = u.facts.streak?.w ?? (u.facts.shipped_code ? 1 : 0);
  const input: PostInput = { moment: 'weekly', name: p.name, week, summary, note };
  if (!writePost(input, [])) return 'nothing_to_say';
  return {
    moment: 'weekly', momentKey: `weekly:${p.key.toLowerCase()}:${monday}`, projectKey: p.key, week: monday, input, proofUrl: null,
    bigWeek: isMilestone(week) || Boolean(u.facts.went_live) || (u.facts.won?.length ?? 0) > 0,
    card: { week, monday, summary, streak: u.facts.streak?.w ?? null, commits: u.facts.shipped_code?.n ?? null },
  };
}

/** Whole weeks from the first commit week's Monday to `at` (at least 1); 0 without a commit week. Pure. */
export function weeksFromFirstCommit(commitWeeks: string[], at: Date): number {
  const first = [...commitWeeks].sort()[0];
  const monday = first ? mondayOfWeek(first) : null;
  if (!monday) return 0;
  return Math.max(1, Math.ceil((at.getTime() - Date.parse(`${monday}T00:00:00Z`)) / (7 * DAY)));
}

/** The project went live: once, after it settles, while it is news. */
export async function wentLiveCandidate(builderId: number, now: Date): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  if (!p.name) return 'no_project';
  const first = await firstLiveAt(builderId, p.key);
  if (!first) return 'not_live';
  const timing = liveTiming(first, now);
  if (timing) return timing;
  const weeks = weeksFromFirstCommit(p.commitWeeks, first);
  return {
    moment: 'went_live', momentKey: `went_live:${p.key.toLowerCase()}`, projectKey: p.key, week: null, proofUrl: null,
    input: { moment: 'went_live', name: p.name, weeks }, card: { live_at: first.toISOString(), weeks },
  };
}

/** Announced wins of the one project (the owner-committed outcome files, each with its source link), newest first. */
export async function announcedWinCandidates(builderId: number, now: Date): Promise<MomentCandidate[]> {
  const p = await posterOf(builderId);
  if (typeof p === 'string' || !p.name) return [];
  const rows = await sql()<{ program_id: string; title: string; prize: number | null; source_url: string }[]>`
    SELECT o.program_id, g.title, o.prize_usd::float8 AS prize, o.source_url FROM entry_outcomes o
    JOIN projects x ON x.id = o.project_id JOIN programs g ON g.id = o.program_id JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND o.basis = 'announcement' AND o.result IN ('won', 'placed')
      AND o.source_url LIKE 'https://%' AND o.captured_at > ${new Date(now.getTime() - EVENT_FRESH_DAYS * DAY)}
      AND x.program_id <> ${COIN_PROGRAM} AND lower(COALESCE(x.repo_key, x.token_repo_key)) = lower(${p.key})
    ORDER BY o.captured_at DESC`;
  return rows.map((r) => {
    const award = r.prize && r.prize > 0 ? usd(r.prize) : null;
    return {
      moment: 'won', momentKey: `won:${r.program_id}`, projectKey: p.key, week: null, proofUrl: r.source_url,
      input: { moment: 'won', name: p.name!, program: r.title, award }, card: { program: r.title, award },
    };
  });
}

/**
 * Owner ruling 3: an accepted, funded or won moment the builder told, verified by a public proof link the agent
 * checked and passes (proofUrlOk). Never on the builder's word alone: no proof, no moment. The program is a listed one.
 */
export async function verifiedOutcomeCandidate(
  builderId: number, o: { programId: string; result: 'accepted' | 'funded' | 'won'; proofUrl: unknown; awardUsd?: number | null },
): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  if (!p.name) return 'no_project';
  const [g] = await sql()<{ title: string; source_url: string | null; submission_url: string | null }[]>`
    SELECT title, source_url, submission_url FROM programs WHERE id = ${o.programId} AND id <> ${COIN_PROGRAM}`;
  if (!g) return 'no_program';
  const proof = proofUrlOk(o.proofUrl, { programUrls: [g.source_url, g.submission_url], own: await ownLinksOf(builderId) });
  if (!proof) return 'no_proof';
  const award = o.result !== 'accepted' && o.awardUsd && o.awardUsd > 0 ? usd(o.awardUsd) : null;
  return {
    moment: o.result, momentKey: `${o.result}:${o.programId}`, projectKey: p.key, week: null, proofUrl: proof,
    input: { moment: o.result, name: p.name, program: g.title, award }, card: { program: g.title, award, proof_url: proof },
  };
}

/** Owner ruling 1: the coin's one intro, once it is launched and the page shows backing (pillCoin). */
export async function coinIntroCandidate(builderId: number): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  if (!p.name) return 'no_project';
  const c = await pillCoin(builderId);
  if (!c) return 'no_coin';
  return {
    moment: 'coin_intro', momentKey: `coin_intro:${c.coin ?? `project:${c.project_id}`}`, projectKey: p.key, week: null, proofUrl: null,
    input: { moment: 'coin_intro', name: p.name, symbol: c.symbol, weeks: p.weeksShipping }, card: { symbol: c.symbol },
  };
}

/** The builder's own news (tell update { text }), checked as an update is. */
export async function newsCandidate(builderId: number, text: unknown, now: Date): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  const checked = checkUpdate(text, await ownLinksOf(builderId));
  if (!checked.ok) return 'text';
  return {
    moment: 'news', momentKey: `news:${p.key.toLowerCase()}:${now.toISOString()}`, projectKey: p.key, week: null, proofUrl: null,
    input: { moment: 'news', note: checked.text }, card: {},
  };
}

/**
 * The one moment EarnKit offers a post for now, in order: an announced win, going live, the coin intro, last week.
 * Null `moment` with each skipped moment's reason (none to post).
 */
export async function offeredMoment(builderId: number, now: Date): Promise<{ moment: MomentCandidate | null; skipped: (Skip | Hold)[] }> {
  const log = await recentDrafts(builderId, 500);
  const found: (MomentCandidate | Skip)[] = [
    ...(await announcedWinCandidates(builderId, now)),
    await wentLiveCandidate(builderId, now),
    await coinIntroCandidate(builderId),
    await weeklyCandidate(builderId, now),
  ];
  const skipped: (Skip | Hold)[] = [];
  for (const c of found) {
    if (typeof c === 'string') {
      skipped.push(c);
      continue;
    }
    const hold = holdOf(c, log, now);
    if (!hold) return { moment: c, skipped };
    skipped.push(hold);
  }
  return { moment: null, skipped };
}

/**
 * Drafts the post for `c` (post-writer.ts, against the person's recent drafts) and stores it (post-drafts.ts, under
 * its limits). `asked`: the builder asked (their news, a redraft); else EarnKit offered it. 'hold' when the moment
 * waits; 'no_post' when the writer has nothing that fits.
 */
export async function draftMoment(
  builderId: number, c: MomentCandidate, o: { asked: boolean }, now: Date,
): Promise<{ ok: true; draft: DraftRow } | { ok: false; reason: Hold | DraftLimit | 'no_post' }> {
  const log = await recentDrafts(builderId, 500);
  // A redraft the builder asks for is the same moment again; only its limits apply.
  const hold = o.asked && log.some((d) => d.moment_key === c.momentKey) ? null : holdOf(c, log, now);
  if (hold) return { ok: false, reason: hold };
  const post = writePost(c.input, log.slice(0, 5));
  if (!post) return { ok: false, reason: 'no_post' };
  return createDraft({
    builderId, projectKey: c.projectKey, moment: c.moment, momentKey: c.momentKey, shape: post.shape, text: post.text,
    card: c.card, week: c.week, asked: o.asked, proofUrl: c.proofUrl,
  }, now);
}
