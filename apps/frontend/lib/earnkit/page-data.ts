import { PUBLIC_REPO_DAYS } from './repo-public'; // a repo is named only while read public this recently
import { cache } from 'react';
import { sql } from './db';
import { listedRanked, standingOf } from './person-score';
import { COIN_PROGRAM } from './policy-constants';
import { rankWords } from './rank';
import { pagePath } from './reserved-routes';
import { shownUrl } from './untrusted-text';

/**
 * v2.12.1 spec "Profile", "Card and leaderboard": what the page at earnkit.com/<x-handle>, its share
 * card and the leaderboard show. Every public sentence is here (one place for the copy review).
 * Public facts only: a project's people and money only when confirmed and not waiting for a review,
 * a repo's name only while its newest reading says public and is under a week old, never a wallet
 * as the name, hidden people never.
 */

/** v2.12.1 T12 (from v2.12's profile-data.ts): money in plain words, "$1.2k". Pure. */
export function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${Math.round(n)}`;
}

export const SOURCES_LINE =
  'Numbers come from public data EarnKit can check: GitHub, live sites, package downloads, public transactions and EarnKit itself. Projects marked not yet confirmed are shown but do not count.';
export const NOT_CONFIRMED = 'Not yet confirmed';
export const NOT_TRACKED = 'Not tracked right now';
/** T11 fix round 1: when no card is confirmed, one quiet line instead of a label on each. */
export const NONE_CONFIRMED = "None of these are confirmed yet, so they don't count toward a rank.";
export const NOTHING_YET = 'Projects show here once they are live.';
export const BOARD_TITLE = 'Builders on EarnKit';
export const boardLine = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'builder' : 'builders'}, ranked by what they shipped and who uses it.`;
export const topLine = (name: string, n: number, noun: string) => `${name} has shipped ${n} ${noun} with AI.`;
export const buildingLine = (name: string) => `${name} is building with AI.`;
export const peopleLine = (k: number) => (k === 0 ? null : `${k} of them ${k === 1 ? 'has people using it' : 'have people using them'}.`);
export const peopleUse = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'person uses' : 'people use'}`;

export function cardHeadline(h: { moment: 'shipped' | 'people' | 'rank' | null; shipped: number; noun: string; best: { name: string; people: number } | null; rank: string | null }): string {
  if (h.moment === 'people' && h.best && h.best.people > 0) return `${peopleUse(h.best.people)} ${h.best.name}`;
  if (h.moment === 'rank' && h.rank) return h.rank;
  if (h.shipped <= 0) return 'Building with AI';
  return `Shipped ${h.shipped} ${h.noun} with AI`;
}

/** The X intent for the share link: the card's headline and the page; nothing else. Pure. */
export function shareIntent(handle: string, headline: string): string {
  return shareIntentText(handle, `${headline} on EarnKit.`);
}
/** v2.13: the X intent with the post's whole text (benchShareText) and the page. Pure. */
export function shareIntentText(handle: string, text: string): string {
  const u = new URL('https://x.com/intent/post');
  u.searchParams.set('text', text);
  u.searchParams.set('url', `https://earnkit.com${pagePath(handle)}`);
  return u.toString();
}

/** X's own image host only, over https; the 400px size instead of X's 48px default. Null otherwise. Pure. */
export function avatarUrl(raw: string | null | undefined): string | null {
  if (!raw || !URL.canParse(raw)) return null;
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.hostname !== 'pbs.twimg.com' || u.username || u.password || u.port) return null;
  u.pathname = u.pathname.replace(/_(normal|bigger|mini)(\.[a-z]+)$/i, '_400x400$2');
  return u.toString();
}

export type PageCard = {
  key: string; name: string; what: string | null; link: string | null; people: number | null; money: string | null;
  programs: { title: string; won: boolean }[]; confirmed: boolean; tracked: boolean;
};
export type PageHead = { handle: string; name: string; avatar: string | null; topLine: string; rank: string | null; peopleLine: string | null; score: number | null };

/** The page shows at most this many projects (25 tracked, then the rest as not tracked). */
const CARDS_MAX = 50;
const PRIVATE_NAME = 'Private project';
const WALLET = /\b0x[0-9a-f]{40}\b/i;
/** A project or entry key compared: no scheme, no github.com/, no www., no trailing slash, lowercase. */
export const norm = (k: string) => k.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^(www\.)?github\.com\//, '').replace(/^www\./, '').replace(/\/+$/, '');
const REPO_KEY = /^[^/:\s]+\/[^/\s]+$/;

/** The display name: the X name (trimmed, never a wallet), else @handle. Pure. */
export function displayName(xName: string | null, handle: string): string {
  const n = (xName ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  return n && !WALLET.test(n) ? n : `@${handle}`;
}

export type PersonFacts = { name: string; handle: string; avatar: string | null; shipped: number; noun: string; rank: string | null; people: number; score: number; moment: 'shipped' | 'people' | 'rank' | null };

/** What the header and the card need about one claimed person. Null when there is no claimed profile. */
export async function personFacts(builderId: number, o: { only?: number[] } = {}): Promise<PersonFacts | null> {
  const [p] = await sql()<{ x_name: string | null; x_handle: string | null; x_avatar_url: string | null; moment: string | null }[]>`
    SELECT x_name, x_handle, x_avatar_url, card_moments->>'latest' AS moment FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_handle) return null;
  const s = await standingOf(builderId, o);
  // Spec S1: every shipped project counts in the top line, confirmed or not; the rank only from confirmed data.
  const kinds = await sql()<{ kind: string }[]>`SELECT kind FROM builder_projects WHERE builder_id = ${builderId} AND shipped`;
  const n = kinds.length;
  const apps = n > 0 && kinds.every((k) => k.kind === 'app');
  const noun = apps ? (n === 1 ? 'app' : 'apps') : n === 1 ? 'project' : 'projects';
  const rank = rankWords(s)?.short ?? null;
  const moment = p.moment === 'people' || p.moment === 'rank' ? p.moment : 'shipped';
  return { name: displayName(p.x_name, p.x_handle), handle: p.x_handle, avatar: avatarUrl(p.x_avatar_url), shipped: n, noun, rank, people: s.people, score: s.score, moment };
}

/** The page header; React cache(): the page and its metadata read it once per request. */
export const pageHead = cache(async (builderId: number, o: { only?: number[] } = {}): Promise<PageHead> => {
  const f = await personFacts(builderId, o);
  if (!f) throw new Error('pageHead: no claimed profile');
  return {
    handle: f.handle,
    name: f.name,
    avatar: f.avatar,
    topLine: f.shipped > 0 ? topLine(f.name, f.shipped, f.noun) : buildingLine(f.name),
    rank: f.rank,
    // The ring and the people line sit only beside a rank that reads well (never "0/100").
    peopleLine: f.rank ? peopleLine(f.people) : null,
    score: f.rank ? f.score : null,
  };
});

type Row = {
  builder_id: number; key: string; name: string; what: string | null; link: string | null; confirmed: boolean; tracked: boolean;
  people: number; money_usd: number; last_active_at: Date | null; held: boolean;
};

/**
 * The projects of these people, safe to show: a repo-derived name or description only while the
 * repo's newest reading (daily or live) is ok, says public and is under a week old; people and money
 * only on confirmed projects of people not waiting for a review. Ordered per person: tracked first,
 * then most people, then most recently active.
 */
export type ShownProject = Row & { safeName: string; safeWhat: string | null; hiddenRepo: boolean };
export async function shownProjects(ids: number[]): Promise<Map<number, ShownProject[]>> {
  const out = new Map<number, ShownProject[]>();
  if (ids.length === 0) return out;
  const db = sql();
  const rows = await db<Row[]>`
    SELECT bp.builder_id, bp.project_key AS key, bp.name, bp.what, bp.link, bp.confirmed, bp.tracked, bp.people, bp.money_usd::float8 AS money_usd,
      bp.last_active_at, COALESCE(l.pending IS NOT NULL, false) OR COALESCE(p.held, false) AS held
    FROM builder_projects bp LEFT JOIN builder_live l USING (builder_id) LEFT JOIN builder_profiles p USING (builder_id)
    WHERE bp.builder_id IN ${db(ids)}`;
  const cut = new Date(Date.now() - PUBLIC_REPO_DAYS * 86_400_000);
  const repos = await db<{ builder_id: number; ref: string; public: boolean }[]>`
    SELECT b.builder_id, b.ref, COALESCE(n.ok AND n.signals->'private' = 'false'::jsonb AND n.at >= ${cut}, false)
      -- v2.13.1 O5 N4: a cheap read of the repo itself said public, after its newest reading (if any).
      OR COALESCE(b.public_at >= ${cut} AND b.public_at > COALESCE(n.at, '-infinity'::timestamptz), false) AS public
    FROM builder_sources b
    LEFT JOIN LATERAL (
      SELECT x.ok, x.signals, x.at FROM (
        (SELECT r.ok, r.signals, r.day::timestamptz AS at FROM source_readings r WHERE r.source_id = b.id ORDER BY r.day DESC LIMIT 1)
        UNION ALL (SELECT s.ok, s.signals, s.read_at FROM source_live s WHERE s.source_id = b.id ORDER BY s.read_at DESC LIMIT 1)
      ) x ORDER BY x.at DESC LIMIT 1) n ON true
    WHERE b.builder_id IN ${db(ids)} AND b.kind = 'repo' AND b.state <> 'rejected'`;
  const shownRepo = new Set(repos.filter((r) => r.public).map((r) => `${r.builder_id}:${norm(r.ref)}`));
  const idents = await db<{ builder_id: number; identity: { projects?: unknown } | null }[]>`
    SELECT builder_id, identity FROM builder_profiles WHERE builder_id IN ${db(ids)}`;
  const reported = new Map<number, { names: Set<string>; whats: Set<string> }>();
  for (const i of idents) {
    const ps = Array.isArray(i.identity?.projects) ? (i.identity.projects as { name?: unknown; what?: unknown }[]) : [];
    reported.set(i.builder_id, {
      names: new Set(ps.map((p) => (typeof p?.name === 'string' ? p.name.trim().slice(0, 60).toLowerCase() : '')).filter(Boolean)),
      whats: new Set(ps.map((p) => (typeof p?.what === 'string' ? p.what.trim().slice(0, 120) : '')).filter(Boolean)),
    });
  }
  for (const r of rows) {
    const k = norm(r.key);
    const hiddenRepo = REPO_KEY.test(k) && !shownRepo.has(`${r.builder_id}:${k}`);
    const own = reported.get(r.builder_id);
    // The agent's own name for it is the builder's; the repo's name only while the repo reads public.
    const repoName = k.split('/')[1] ?? '';
    const nameIsRepo = r.name.trim().toLowerCase() === repoName || !own?.names.has(r.name.trim().toLowerCase());
    const safeName = hiddenRepo && nameIsRepo ? PRIVATE_NAME : r.name;
    const safeWhat = hiddenRepo && !(r.what && own?.whats.has(r.what)) ? null : r.what;
    const list = out.get(r.builder_id) ?? [];
    // A hidden repo's own GitHub page (or its Pages site) would name it: no link then.
    const linkHost = r.link && URL.canParse(r.link) ? new URL(r.link).hostname.toLowerCase() : '';
    const safeLink = hiddenRepo && /(^|\.)github\.(io|com)$/.test(linkHost) ? null : r.link;
    list.push({ ...r, link: safeLink, safeName, safeWhat, hiddenRepo, people: r.confirmed && !r.held ? r.people : 0 });
    out.set(r.builder_id, list);
  }
  const at = (d: Date | null) => (d ? d.getTime() : 0);
  for (const list of out.values())
    list.sort((a, b) => Number(b.tracked) - Number(a.tracked) || b.people - a.people || at(b.last_active_at) - at(a.last_active_at) || a.key.localeCompare(b.key));
  return out;
}

/**
 * Final fix I1: the shown name of a person's project by key, as the profile and the card show it
 * (shownProjects' safeName: never a private repo's name), for many people in one read. A key with no
 * row reads as the private name.
 */
export async function safeNames(ids: number[]): Promise<(builderId: number, key: string) => string> {
  const shown = await shownProjects([...new Set(ids)]);
  return (id, key) => (shown.get(id) ?? []).find((r) => norm(r.key) === norm(key))?.safeName ?? PRIVATE_NAME;
}

/** Programs entered and won (announcements only), matched to a project by its repo or live link; coin entries are not program entries. */
async function programEntries(builderId: number) {
  return sql()<{ keys: (string | null)[]; title: string; won: boolean; submitted_at: Date }[]>`
    SELECT ARRAY[p.repo_key, p.token_repo_key, p.repo_url, p.live_url] AS keys, g.title, p.submitted_at,
      EXISTS (SELECT 1 FROM entry_outcomes o WHERE o.project_id = p.id AND o.basis = 'announcement' AND o.result IN ('won', 'placed', 'finalist')) AS won
    FROM projects p JOIN installations i ON i.id = p.installation_id JOIN programs g ON g.id = p.program_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND p.program_id <> ${COIN_PROGRAM} AND p.vetoed_at IS NULL
    ORDER BY p.submitted_at, p.id`;
}
/** The programs one project (by key) entered and won, won first. Pure. */
const programsOf = (entries: Awaited<ReturnType<typeof programEntries>>, key: string) => {
  const k = norm(key);
  const programs = new Map<string, boolean>();
  for (const e of entries)
    if (e.keys.some((x) => x && norm(x) === k)) programs.set(e.title, (programs.get(e.title) ?? false) || e.won);
  return [...programs].map(([title, won]) => ({ title, won })).sort((a, b) => Number(b.won) - Number(a.won));
};
/** v2.13 T11: the programs the person's project `key` entered and won, as pageCards reads them. */
export const projectPrograms = async (builderId: number, key: string) => programsOf(await programEntries(builderId), key);

export async function pageCards(builderId: number): Promise<PageCard[]> {
  const list = ((await shownProjects([builderId])).get(builderId) ?? []).slice(0, CARDS_MAX);
  if (list.length === 0) return [];
  const entries = await programEntries(builderId);
  return list.map((r, i) => {
    const measured = r.confirmed && !r.held;
    return {
      // Public markup: never a key that could name a private repo.
      key: r.safeName === PRIVATE_NAME ? `project-${i + 1}` : `project-${i + 1}-${r.safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: r.safeName,
      what: r.safeWhat,
      link: shownUrl(r.link),
      people: measured && r.people > 0 ? r.people : null,
      money: measured && r.money_usd > 1 ? money(r.money_usd) : null,
      programs: programsOf(entries, r.key),
      confirmed: r.confirmed,
      tracked: r.tracked,
    };
  });
}

/** The card's best project: the confirmed one most people use (none while held). */
export async function bestProject(builderId: number): Promise<{ name: string; people: number } | null> {
  const top = ((await shownProjects([builderId])).get(builderId) ?? []).filter((p) => p.confirmed && !p.held && p.people > 0).sort((a, b) => b.people - a.people)[0];
  return top ? { name: top.safeName, people: top.people } : null;
}

// ---- The leaderboard -------------------------------------------------------------------------------

export type BoardRow = { rank: number; handle: string; avatar: string | null; best: string };
/** The board lists at most this many people (one page, no paging). */
export const BOARD_MAX = 100;

/**
 * spec "Leaderboard": the listed ranked people (person-score.ts listedRanked: claimed with X, shown,
 * not held) by score. `rank` is their rank in that one population, the same number as their reply,
 * page and card (T11 fix round 1), so the board has no gaps and `count` is the last rank's
 * population. `best` is the most-used project in plain words, else what they shipped. `only`
 * limits the population (tests: the shared DB holds other files' people).
 */
export async function boardRows(limit: number = BOARD_MAX, o: { only?: number[] } = {}): Promise<{ rows: BoardRow[]; count: number }> {
  const db = sql();
  const n = Math.max(1, Math.min(BOARD_MAX, Math.floor(limit)));
  const listed = await db<{ builder_id: number; handle: string; avatar: string | null; rank: number; count: number; shipped: number; apps: boolean }[]>`
    WITH ranked AS (
      SELECT x.builder_id, x.score, rank() OVER (ORDER BY x.score DESC)::int AS rank, count(*) OVER ()::int AS count FROM ${listedRanked(db, o.only)} x)
    SELECT r.builder_id, p.x_handle AS handle, p.x_avatar_url AS avatar, r.rank, r.count,
      (SELECT count(*)::int FROM builder_projects b WHERE b.builder_id = r.builder_id AND b.shipped) AS shipped,
      COALESCE((SELECT bool_and(b.kind = 'app') FROM builder_projects b WHERE b.builder_id = r.builder_id AND b.shipped), false) AS apps
    FROM ranked r JOIN builder_profiles p USING (builder_id)
    ORDER BY r.score DESC, lower(p.x_handle) LIMIT ${n}`;
  const projects = await shownProjects(listed.map((r) => r.builder_id));
  const rows = listed.map((r) => {
    const top = (projects.get(r.builder_id) ?? []).filter((p) => p.confirmed && !p.held && p.people > 0).sort((a, b) => b.people - a.people)[0];
    const noun = r.apps ? (r.shipped === 1 ? 'app' : 'apps') : r.shipped === 1 ? 'project' : 'projects';
    const best = top
      ? cardHeadline({ moment: 'people', shipped: r.shipped, noun, best: { name: top.safeName, people: top.people }, rank: null })
      : cardHeadline({ moment: 'shipped', shipped: r.shipped, noun, best: null, rank: null });
    return { rank: r.rank, handle: r.handle, avatar: avatarUrl(r.avatar), best };
  });
  return { rows, count: listed[0]?.count ?? 0 };
}
