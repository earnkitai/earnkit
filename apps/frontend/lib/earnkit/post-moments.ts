import { usd } from './campaigns';
import { sql } from './db';
import { benchConfirmedSql, mainProjectOf } from './main-project';
import { PRIVATE_NAME, norm, shownProjects } from './page-data';
import { COIN_PROGRAM } from './policy-constants';
import { createDraft, recentDrafts, type DraftLimit, type DraftRow, type PostMoment, type RecentDraft } from './post-drafts';
import { isMilestone, writePost, type PostInput } from './post-writer';
import { X_HOSTS, proofNamesBuilder, type ProofFetch } from './outcome-proof';
import { SHARED_HOSTS } from './submit-hosts';
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
 * | Went live | the project's first live moment (week-facts.ts firstLiveAt), within 14 days | once a project | under 2 days old (a site probe can flap); not up within 3 days |
 * | Won | an announced win (entry_outcomes basis 'announcement', with its source link), within 14 days | once a program | self-reported only |
 * | Accepted, funded or won (told) | the agent passes a public proof link it checked (owner ruling 3) | once a program | no proof, or proof on the builder's own site |
 * | Streak milestone | 4, 8, 12, 26, 52 weeks in a row | folds into the weekly | never a post of its own |
 * | Builder's news | tell update { text } | 24 hours | the text fails checkUpdate |
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
/** Task 6 (design 6 ruling): went live and won go before the apply step for this long after they can be posted. */
export const HOT_HOURS = 48;
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
  /** When the moment could first be posted (went live: once it settled; an announced win: when it was recorded). */
  at?: Date;
};
export type Hold = 'drafted' | 'cooldown' | 'once' | 'same_kind';
export type Skip =
  | 'no_page' | 'no_project' | 'no_week' | 'no_facts' | 'nothing_to_say' | 'not_live' | 'not_up' | 'settling' | 'stale'
  | 'no_program' | 'no_proof' | 'no_proof_source' | 'no_entry' | 'text';
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

const X_POST = /^\/([A-Za-z0-9_]{1,15})\/status\/\d{1,25}\/?$/;
/** Shared paths on an otherwise single-owner host: anyone's project page. */
const SHARED_PATHS: [string, RegExp][] = [['ethglobal.com', /^\/showcase(?:\/|$)/i]];
const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);
const bare = (host: string) => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
/** A page's identity for "is it the listing page itself": host without www, path without a trailing slash. Pure. */
const pageId = (u: URL) => `${bare(u.hostname)}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;

/**
 * Proof ruling: a proof_hosts entry ("www.base.org/blog/") matches a page on exactly that host whose path starts with
 * the entry's path ("/blog/"). An entry without "/" (an older form) matches nothing. Pure.
 */
export function proofEntryMatches(entry: string, host: string, path: string): boolean {
  const slash = entry.indexOf('/');
  if (slash < 1) return false;
  return host === entry.slice(0, slash).toLowerCase() && path.startsWith(entry.slice(slash));
}

export type ProofContext = {
  /**
   * Final review 1, proof ruling: the program file's proof_hosts, owner-reviewed "host/path-prefix/" entries (a page
   * on that exact host under that path may be proof). Never derived from the listing or submission page.
   */
  proofHosts: string[];
  /** The program's listing pages (source_url, submission_url): the pages themselves are never proof. */
  listings: (string | null)[];
  /** The program's own X accounts (program file x_handles); none: no X post is proof. */
  xHandles: string[];
  /** The builder's own X handle: a post of theirs is never proof. */
  builderHandle: string | null;
  own: OwnLinks;
};
/**
 * Owner ruling 3, fix round: the public page that verifies an accepted, funded or won moment, as the agent passes it.
 * An https link (no credentials, no port, no IP address) that is either (a) a page on one of the program file's
 * proof_hosts entries (proof ruling: that exact host, its path under the entry's prefix; an owner-reviewed allowlist,
 * never a host taken from the listing or submission page; never a shared host such as github.io or dorahacks.io even
 * when listed, never ethglobal.com/showcase, never the listing page itself), or (b) a post on X
 * (x.com/<user>/status/<id>) by one of the program's own X accounts. Never earnkit.com, the builder's own site, repo or
 * X account. The stored form drops the query and fragment; a path with an encoded slash, backslash or dot, a
 * backslash, an empty or a dot segment is refused. Null: not proof. The page must also name the builder
 * (outcome-proof.ts proofNamesBuilder, fetched by verifiedOutcomeCandidate). Pure.
 */
export function proofUrlOk(raw: unknown, o: ProofContext): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || !URL.canParse(raw.trim())) return null;
  // Last fix wave (B): a path with an encoded slash, backslash or dot, a backslash, an empty or a dot segment is
  // never proof (checked on the link as given, before the URL parser folds it).
  const rawPath = raw.trim().replace(/^https?:\/\/[^/?#]*/i, '').split(/[?#]/)[0];
  if (/%(2f|5c|2e)/i.test(rawPath) || rawPath.includes('\\') || /\/\//.test(rawPath) || /(^|\/)\.\.?(\/|$)/.test(rawPath)) return null;
  // Whitespace or control characters inside the link are stripped by the URL parser, so the raw check above could
  // miss what the parsed path holds: refuse them, then run the same path checks on the parsed pathname.
  if (/[\u0000-\u0020\u007f]/.test(raw.trim())) return null;
  const u = new URL(raw.trim());
  if (/%(2f|5c|2e)/i.test(u.pathname) || u.pathname.includes('\\') || /\/\//.test(u.pathname) || /(^|\/)\.\.?(\/|$)/.test(u.pathname)) return null;
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return null;
  if (under(bare(host), 'earnkit.com')) return null;
  if (o.own.sites.some((s) => URL.canParse(s) && bare(new URL(s).hostname) === bare(host))) return null;
  if (o.own.repo && under(bare(host), 'github.com') && u.pathname.toLowerCase().startsWith(`/${o.own.repo.toLowerCase()}`)) return null;
  // Last fix wave (B): stored and fetched without its query and fragment.
  u.hash = '';
  u.search = '';
  if (X_HOSTS.has(host)) {
    const who = X_POST.exec(u.pathname)?.[1]?.toLowerCase();
    if (!who || who === o.builderHandle?.toLowerCase()) return null;
    return o.xHandles.some((h) => h.toLowerCase() === who) ? u.toString() : null;
  }
  if (SHARED_HOSTS.some((h) => under(bare(host), h))) return null;
  if (SHARED_PATHS.some(([h, re]) => under(bare(host), h) && re.test(u.pathname))) return null;
  if (!o.proofHosts.some((e) => proofEntryMatches(e, host, u.pathname))) return null;
  const listed = new Set(o.listings.flatMap((l) => (l && URL.canParse(l) ? [pageId(new URL(l))] : [])));
  if (listed.has(pageId(u))) return null;
  return u.toString();
}

/**
 * Fix round: the builder has an entry in the program (projects) or told EarnKit they applied (builder_program_status
 * applied_at, kept through later statuses; an accepted or funded row alone could be the unverified tell itself), or a
 * verified outcome of it was drafted before; read before what they just told is stored. Never throws (a failed read is
 * no).
 */
export async function hasEntry(builderId: number, programId: string): Promise<boolean> {
  try {
    const [r] = await sql()<{ yes: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM projects x JOIN installations i ON i.id = x.installation_id
          WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND x.program_id = ${programId})
        OR EXISTS (SELECT 1 FROM builder_program_status s JOIN installations i ON i.id = s.installation_id
          WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND s.program_id = ${programId} AND s.applied_at IS NOT NULL)
        -- A verified outcome of this program drafted before (an acceptance, then funding): the status row now says
        -- accepted, which an unverified tell could also have written, so only the draft vouches for it.
        OR EXISTS (SELECT 1 FROM post_drafts d WHERE d.builder_id = ${builderId}
          AND d.moment_key IN (${`accepted:${programId}`}, ${`funded:${programId}`}, ${`won:${programId}`}) AND d.proof_url IS NOT NULL) AS yes`;
    return r?.yes === true;
  } catch (err) {
    console.error('[post] entry', err instanceof Error ? err.name : 'error');
    return false;
  }
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

/**
 * Last finished week's post: its facts, the summary as the profile shows it, the builder's note. `week`: the week's
 * number as the reply around the post names it (Task 6: the Monday moment's "Week 4 done.", weekly-moment.ts
 * weekNumber), so the two never differ; else the week's own streak fact.
 */
export async function weeklyCandidate(builderId: number, now: Date, o: { week?: number } = {}): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  const monday = lastFinishedMonday(now);
  const [u] = await sql()<{ facts: WeekFacts; titles: string[]; summary: string | null; text: string | null }[]>`
    SELECT facts, titles, summary, text FROM project_updates
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${p.key}) AND week = ${monday} AND NOT hidden`;
  if (!u) return 'no_week';
  // The streak alone (or people or money) is not a week worth a post.
  if (!hasFacts(u.facts)) return 'no_facts';
  // Owner batch 2026-10-23: a private repo's summary only once the builder approved that text (summaryConsented).
  const summary = (await weekLineRule(builderId, p.key))(u);
  const checked = u.text ? checkUpdate(u.text, await ownLinksOf(builderId)) : null;
  const note = checked?.ok ? checked.text : null;
  const week = o.week ?? u.facts.streak?.w ?? (u.facts.shipped_code ? 1 : 0);
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
  // Fix round: live now, by a recent reading (a site probe can flap): an up reading of its site within UP_WITHIN_DAYS,
  // its EarnKit-hosted site serving, or a deployed contract (onchain; it can't go down).
  if (!(await upNow(builderId, p.key, now))) return 'not_up';
  const weeks = weeksFromFirstCommit(p.commitWeeks, first);
  return {
    moment: 'went_live', momentKey: `went_live:${p.key.toLowerCase()}`, projectKey: p.key, week: null, proofUrl: null,
    at: new Date(first.getTime() + LIVE_SETTLE_DAYS * DAY),
    input: { moment: 'went_live', name: p.name, weeks }, card: { live_at: first.toISOString(), weeks },
  };
}

/** Fix round: a went-live post needs the project up within this many days. */
export const UP_WITHIN_DAYS = 3;
/** The project `key` is up now (wentLiveCandidate's rule). Throws on a database error. */
async function upNow(builderId: number, key: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - UP_WITHIN_DAYS * DAY);
  const [r] = await sql()<{ up: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM hosted_sites h JOIN installations i ON i.id = h.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND lower(h.repo_key) = lower(${key}) AND h.status = 'live')
      OR EXISTS (SELECT 1 FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND d.status = 'deployed' AND lower(d.repo_key) = lower(${key}))
      OR EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${builderId} AND s.kind = 'site' AND s.state = 'verified'
        AND lower(s.project_key) = lower(${key}) AND (
          EXISTS (SELECT 1 FROM source_readings r WHERE r.source_id = s.id AND r.ok AND r.signals->>'up' = 'true' AND r.day >= ${since}::date)
          OR EXISTS (SELECT 1 FROM source_live l WHERE l.source_id = s.id AND l.ok AND l.signals->>'up' = 'true' AND l.read_at >= ${since}))) AS up`;
  return r?.up === true;
}

/** Announced wins of the one project (the owner-committed outcome files, each with its source link), newest first. */
export async function announcedWinCandidates(builderId: number, now: Date): Promise<MomentCandidate[]> {
  const p = await posterOf(builderId);
  if (typeof p === 'string' || !p.name) return [];
  const rows = await sql()<{ program_id: string; title: string; prize: number | null; source_url: string; captured_at: Date }[]>`
    SELECT o.program_id, g.title, o.prize_usd::float8 AS prize, o.source_url, o.captured_at FROM entry_outcomes o
    JOIN projects x ON x.id = o.project_id JOIN programs g ON g.id = o.program_id JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND o.basis = 'announcement' AND o.result IN ('won', 'placed')
      AND o.source_url LIKE 'https://%' AND o.captured_at > ${new Date(now.getTime() - EVENT_FRESH_DAYS * DAY)}
      AND x.program_id <> ${COIN_PROGRAM} AND lower(COALESCE(x.repo_key, x.token_repo_key)) = lower(${p.key})
    ORDER BY o.captured_at DESC`;
  return rows.map((r) => {
    const award = r.prize && r.prize > 0 ? usd(r.prize) : null;
    return {
      moment: 'won', momentKey: `won:${r.program_id}`, projectKey: p.key, week: null, proofUrl: r.source_url, at: r.captured_at,
      input: { moment: 'won', name: p.name!, program: r.title, award }, card: { program: r.title, award },
    };
  });
}

/**
 * Owner ruling 3: an accepted, funded or won moment the builder told, verified by a public proof link the agent
 * checked and passes (proofUrlOk). Never on the builder's word alone: no proof, no moment. Fix round: the program is a
 * listed one (with proof_hosts or x_handles, else 'no_proof_source') the builder had an entry or application in (`entered`, read before the tell was stored: hasEntry), and
 * an award is only the announced one (entry_outcomes basis 'announcement', the owner-committed outcomes files), never
 * an amount the agent or builder states.
 */
export async function verifiedOutcomeCandidate(
  builderId: number, o: { programId: string; result: 'accepted' | 'funded' | 'won'; proofUrl: unknown; entered: boolean },
  deps: { proofFetch?: ProofFetch } = {},
): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  if (!p.name) return 'no_project';
  const [g] = await sql()<{ title: string; source_url: string | null; submission_url: string | null; x_handles: string[]; proof_hosts: string[] }[]>`
    SELECT title, source_url, submission_url, x_handles, proof_hosts FROM programs WHERE id = ${o.programId} AND id <> ${COIN_PROGRAM}`;
  if (!g) return 'no_program';
  // v3.1 cold read round 2 (owner): an outcome post needs verification (the proof checks below), not a prior application.
  // Final review 1: no proof hosts and no X accounts listed: no link could prove it (its posts come from announced outcomes only).
  if (!g.proof_hosts?.length && !g.x_handles?.length) return 'no_proof_source';
  const [b] = await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${builderId}`;
  const own = await ownLinksOf(builderId);
  const proof = proofUrlOk(o.proofUrl, {
    proofHosts: g.proof_hosts ?? [], listings: [g.source_url, g.submission_url], xHandles: g.x_handles ?? [], builderHandle: b?.handle ?? null, own,
  });
  if (!proof) return 'no_proof';
  // Proof ruling, last fix wave (A): the page (or the X post's own words) must name the builder by their verified handle,
  // verified site or public repo, never the project's name; any fetch failure is no proof.
  const who = { handle: b?.handle ?? null, sites: own.sites, repo: own.repo, programTitle: g.title, xHandles: g.x_handles ?? [] };
  if (!(await proofNamesBuilder(proof, who, deps.proofFetch))) return 'no_proof';
  const [won] = o.result === 'accepted' ? [] : await sql()<{ prize: number | null }[]>`
    SELECT max(o.prize_usd)::float8 AS prize FROM entry_outcomes o JOIN projects x ON x.id = o.project_id JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND o.program_id = ${o.programId} AND o.basis = 'announcement' AND o.prize_usd > 0`;
  const award = won?.prize && won.prize > 0 ? usd(won.prize) : null;
  return {
    moment: o.result, momentKey: `${o.result}:${o.programId}`, projectKey: p.key, week: null, proofUrl: proof,
    input: { moment: o.result, name: p.name, program: g.title, award }, card: { program: g.title, award, proof_url: proof },
  };
}

/** The builder's own news (tell update { text }), checked as an update is. */
export async function newsCandidate(builderId: number, text: unknown, now: Date): Promise<MomentCandidate | Skip> {
  const p = await posterOf(builderId);
  if (typeof p === 'string') return p;
  const checked = checkUpdate(text, await ownLinksOf(builderId));
  if (!checked.ok) return 'text';
  // Task 5: the card shows last week's summary (as the profile shows it), never the note again.
  const [u] = await sql()<{ titles: string[]; summary: string | null; facts: WeekFacts }[]>`
    SELECT titles, summary, facts FROM project_updates
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${p.key}) AND week = ${lastFinishedMonday(now)} AND NOT hidden`;
  const summary = u ? (await weekLineRule(builderId, p.key))(u) : null;
  return {
    moment: 'news', momentKey: `news:${p.key.toLowerCase()}:${now.toISOString()}`, projectKey: p.key, week: null, proofUrl: null,
    input: { moment: 'news', note: checked.text }, card: { summary },
  };
}

/**
 * The one moment EarnKit offers a post for now, in order: an announced win, going live, last week
 * (`weekly: false`: the events only, Task 6's share slot between Mondays). Null `moment` with each skipped moment's
 * reason (none to post).
 */
export async function offeredMoment(
  builderId: number, now: Date, o: { weekly?: boolean } = {},
): Promise<{ moment: MomentCandidate | null; skipped: (Skip | Hold)[] }> {
  const r = await offeredMoments(builderId, now, o);
  return { moment: r.moments[0] ?? null, skipped: r.skipped };
}

/**
 * Final review 3: every moment that may be offered now, in offeredMoment's order (the first that drafts is the offer),
 * with the reasons of those skipped before the first one.
 */
export async function offeredMoments(
  builderId: number, now: Date, o: { weekly?: boolean } = {},
): Promise<{ moments: MomentCandidate[]; skipped: (Skip | Hold)[] }> {
  const log = await recentDrafts(builderId, 500);
  const found: (MomentCandidate | Skip)[] = [
    ...(await announcedWinCandidates(builderId, now)),
    await wentLiveCandidate(builderId, now),
    ...(o.weekly === false ? [] : [await weeklyCandidate(builderId, now)]),
  ];
  const skipped: (Skip | Hold)[] = [];
  const moments: MomentCandidate[] = [];
  for (const c of found) {
    if (typeof c === 'string') {
      if (!moments.length) skipped.push(c);
      continue;
    }
    const hold = holdOf(c, log, now);
    if (!hold) moments.push(c);
    else if (!moments.length) skipped.push(hold);
  }
  return { moments, skipped };
}

/**
 * Final review 3: a stamp of the writes that can make an event moment appear at once (a coin launched or its backing
 * opened, an announced outcome recorded, a hosted site deployed, the one project changed). post-reply.ts remembers
 * "nothing to draft" for the day only under the same stamp; a moment that comes only with time (going live settling)
 * waits until the next day. One query. Throws on a database error.
 */
export async function eventStamp(builderId: number): Promise<string> {
  const [r] = await sql()<{ stamp: string }[]>`
    SELECT concat_ws('|',
      (SELECT max(GREATEST(x.coin_launched_at, x.raising_at)) FROM projects x JOIN installations i ON i.id = x.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId}),
      (SELECT max(o.captured_at) FROM entry_outcomes o JOIN projects x ON x.id = o.project_id JOIN installations i ON i.id = x.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND o.basis = 'announcement'),
      (SELECT max(h.deployed_at) FROM hosted_sites h JOIN installations i ON i.id = h.installation_id WHERE COALESCE(i.builder_id, i.id) = ${builderId}),
      (SELECT main_project_key FROM builder_profiles WHERE builder_id = ${builderId}),
      'v1') AS stamp`;
  return r?.stamp ?? '';
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
  const redraft = o.asked && log.some((d) => d.moment_key === c.momentKey);
  const hold = redraft ? null : holdOf(c, log, now);
  if (hold) return { ok: false, reason: hold };
  const post = writePost(c.input, log.slice(0, 5));
  if (!post) return { ok: false, reason: 'no_post' };
  // Task 5: the card's facts frozen now (the project, streak, Shipping, the rank only from RANK_MIN_POOL, the weeks of code).
  const frozen = await (await import('./post-card')).freezeCard(builderId, c.week, now);
  return createDraft({
    builderId, projectKey: c.projectKey, moment: c.moment, momentKey: c.momentKey, shape: post.shape, text: post.text,
    card: { ...frozen, ...c.card }, week: c.week, asked: o.asked, proofUrl: c.proofUrl,
    // Fix round: the hold again, under the store's per-person lock (two drafts of one moment at once).
    ...(!redraft && { hold: (inLock: RecentDraft[]) => holdOf(c, inLock, now) }),
  }, now) as Promise<{ ok: true; draft: DraftRow } | { ok: false; reason: Hold | DraftLimit | 'no_post' }>;
}
