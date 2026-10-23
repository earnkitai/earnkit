import { PUBLIC_REPO_DAYS } from './repo-public'; // a repo is named only while read public this recently
import { cache } from 'react';
import { sql } from './db';
import { guideProgramSql } from './guide-pages';
import { standingOf } from './person-score';
import { COIN_PROGRAM } from './policy-constants';
import { rankLine, shownRankLine } from './rank';
import { pagePath } from './reserved-routes';

/**
 * v2.12.1 spec "Profile", "Card": what the page at earnkit.com/<x-handle> and its share card show. Every public sentence is here (one place for the copy review).
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

export const NOTHING_YET = 'Projects show here once they are live.';
export const topLine = (name: string, n: number, noun: string) => `${name} has shipped ${n} ${noun} with AI.`;
export const buildingLine = (name: string) => `${name} is building with AI.`;
export const peopleUse = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'person uses' : 'people use'}`;

/** v2.13: the X intent with the post's whole text (benchShareText) and the page; empty text: the page alone. Pure. */
export function shareIntentText(handle: string, text: string): string {
  const u = new URL('https://x.com/intent/post');
  if (text) u.searchParams.set('text', text);
  u.searchParams.set('url', `https://earnkit.com${pagePath(handle)}`);
  return u.toString();
}

/**
 * A builder's picture, in order: their X picture (pbs.twimg.com only, over https, at 400px instead of X's 48px default),
 * else their GitHub picture from the proven login (avatars.githubusercontent.com only), else null (the initial). Pure.
 */
export function avatarUrl(raw: string | null | undefined, githubLogin?: string | null): string | null {
  return xAvatar(raw) ?? githubAvatar(githubLogin);
}

/** X's own image host only, at its 400x400 size. Pure. */
function xAvatar(raw: string | null | undefined): string | null {
  if (!raw || !URL.canParse(raw)) return null;
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.hostname !== 'pbs.twimg.com' || u.username || u.password || u.port) return null;
  u.pathname = u.pathname.replace(/_(normal|bigger|mini)(\.[a-z]+)$/i, '_400x400$2');
  return u.toString();
}

/** GitHub's login rule: letters, digits and single inner hyphens, 1 to 39 characters. */
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
/**
 * Clarity batch: with no X picture, the GitHub one of the builder's proven login (builder_profiles.github_login), as
 * exactly `https://avatars.githubusercontent.com/<login>?s=200`; any other login shape gives null (then the initial). Pure.
 */
function githubAvatar(login: string | null | undefined): string | null {
  return login && GITHUB_LOGIN.test(login) ? `https://avatars.githubusercontent.com/${login}?s=200` : null;
}

export type PageHead = { handle: string; name: string; avatar: string | null; topLine: string; rank: string | null; score: number | null };

export const PRIVATE_NAME = 'Private project';
const WALLET = /\b0x[0-9a-f]{40}\b/i;
/** A project or entry key compared: no scheme, no github.com/, no www., no trailing slash, lowercase. */
export const norm = (k: string) => k.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^(www\.)?github\.com\//, '').replace(/^www\./, '').replace(/\/+$/, '');
// Final review 7: the vibecoder hosts too (Lovable, Replit, Bolt, Framer, Webflow, Wix, Carrd).
const SHARED_PLATFORMS = new RegExp(`(^|\\.)(${[
  'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'onrender.com', 'railway.app', 'up.railway.app', 'herokuapp.com', 'fly.dev', 'web.app',
  'firebaseapp.com', 'surge.sh', 'glitch.me', 'replit.app', 'replit.dev', 'repl.co', 'lovable.app', 'lovable.dev', 'bolt.new', 'framer.website',
  'framer.app', 'webflow.io', 'wixsite.com', 'carrd.co', 'github.io',
].map((h) => h.replace(/\./g, '\\.')).join('|')})$`);
/**
 * A proven site's host as a project name ("earnkit.com"; no reliable host-to-brand mapping exists, so the host itself).
 * Null for a GitHub host, or a host on a shared platform (a free subdomain the repo's name could be in) that holds the
 * private repo's name. A domain the builder owns may hold it ("earnkit.com" for a private "earnkit"): it is their public brand. Pure.
 */
export function siteName(ref: string, repoName: string): string | null {
  const u = URL.canParse(ref) ? new URL(ref) : URL.canParse(`https://${ref}`) ? new URL(`https://${ref}`) : null;
  const host = u?.hostname.toLowerCase().replace(/^www\./, '') ?? '';
  if (!host || !host.includes('.') || /(^|\.)github\.(io|com)$/.test(host)) return null;
  if (SHARED_PLATFORMS.test(host) && repoName.length >= 3 && host.includes(repoName.toLowerCase())) return null;
  return host;
}
const REPO_KEY = /^[^/:\s]+\/[^/\s]+$/;

/** The display name: the X name (trimmed, never a wallet), else @handle. Pure. */
export function displayName(xName: string | null, handle: string): string {
  const n = (xName ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  return n && !WALLET.test(n) ? n : `@${handle}`;
}

/** `listed`: in the leaderboard's pool, so ranked even while `rank` is null (v3.1 F3: under RANK_MIN_POOL). */
export type PersonFacts = { name: string; handle: string; avatar: string | null; shipped: number; noun: string; rank: string | null; listed: boolean; people: number; score: number; moment: 'shipped' | 'rank' | null };

/** What the header and the card need about one claimed person. Null when there is no claimed profile. */
export async function personFacts(builderId: number, o: { only?: number[] } = {}): Promise<PersonFacts | null> {
  const [p] = await sql()<{ x_name: string | null; x_handle: string | null; x_avatar_url: string | null; github_login: string | null; moment: string | null }[]>`
    SELECT x_name, x_handle, x_avatar_url, github_login, card_moments->>'latest' AS moment FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_handle) return null;
  const s = await standingOf(builderId, o);
  // Spec S1: every shipped project counts in the top line, confirmed or not; the rank only from confirmed data.
  const kinds = await sql()<{ kind: string }[]>`SELECT kind FROM builder_projects WHERE builder_id = ${builderId} AND shipped`;
  const n = kinds.length;
  const apps = n > 0 && kinds.every((k) => k.kind === 'app');
  const noun = apps ? (n === 1 ? 'app' : 'apps') : n === 1 ? 'project' : 'projects';
  // Hotfix 2026-10-19: a public rank only inside the leaderboard's pool (bench-rank rankLines' rule).
  // v3.1 F3: none under RANK_MIN_POOL ranked builders either.
  const rank = s.listed ? shownRankLine(s) : null;
  const moment = p.moment === 'rank' ? p.moment : 'shipped';
  const listed = s.listed && rankLine(s) !== null;
  return { name: displayName(p.x_name, p.x_handle), handle: p.x_handle, avatar: avatarUrl(p.x_avatar_url, p.github_login), shipped: n, noun, rank, listed, people: s.people, score: s.score, moment };
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
    // The ring sits only on a ranked page (never a bare "0/100"); v3.1 F3: under RANK_MIN_POOL too, as the profile.
    score: f.listed ? f.score : null,
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
  // A hidden repo with no name of the builder's own reads as the host of a site they proved for it (never GitHub's).
  const sites = await db<{ builder_id: number; project_key: string; ref: string }[]>`
    SELECT builder_id, project_key, ref FROM builder_sources
    WHERE builder_id IN ${db(ids)} AND kind = 'site' AND state = 'verified' ORDER BY id`;
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
    const hosts = sites.filter((x) => x.builder_id === r.builder_id && norm(x.project_key) === k).map((x) => siteName(x.ref, repoName)).filter((h): h is string => !!h);
    // The builder's own name for it, when it is also the name of a site they proved (EarnKit for earnkit.com), is
    // already public: show it as they wrote it, even when it matches the private repo's name.
    const ownName = r.name.trim();
    const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
    const publicBySite = !!own?.names.has(ownName.toLowerCase()) && hosts.some((h) => squash(h.split('.')[0] ?? '') === squash(ownName));
    const safeName = hiddenRepo && nameIsRepo && !publicBySite ? (hosts[0] ?? PRIVATE_NAME) : r.name;
    const safeWhat = hiddenRepo && !(r.what && own?.whats.has(r.what)) ? null : r.what;
    const list = out.get(r.builder_id) ?? [];
    // A hidden repo's own GitHub page (or its Pages site) would name it: no link then. v3.1 GTM W3: nor a registry page.
    const linkHost = r.link && URL.canParse(r.link) ? new URL(r.link).hostname.toLowerCase() : '';
    const safeLink = hiddenRepo && /(^|\.)(github\.(io|com)|npmjs\.com|pypi\.org)$/.test(linkHost) ? null : r.link;
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

/**
 * Programs entered and won (announcements only), matched to a project by its repo or live link; coin entries are not
 * program entries. v3 Stage 2: `applied`, the entry was submitted (the Ruling C10 rule).
 */
async function programEntries(builderId: number) {
  return sql()<{ keys: (string | null)[]; title: string; won: boolean; applied: boolean; submitted_at: Date; guide: string | null }[]>`
    SELECT ARRAY[p.repo_key, p.token_repo_key, p.repo_url, p.live_url] AS keys, g.title, p.submitted_at,
      CASE WHEN ${guideProgramSql(sql())} THEN g.id END AS guide,
      EXISTS (SELECT 1 FROM entry_outcomes o WHERE o.project_id = p.id AND o.basis = 'announcement' AND o.result IN ('won', 'placed', 'finalist')) AS won,
      (p.confirmed_at IS NULL OR p.submission_proof_ok_at IS NOT NULL OR p.submission_confirmed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM submissions su WHERE su.project_id = p.id)) AS applied
    FROM projects p JOIN installations i ON i.id = p.installation_id JOIN programs g ON g.id = p.program_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND p.program_id <> ${COIN_PROGRAM} AND p.vetoed_at IS NULL
    ORDER BY p.submitted_at, p.id`;
}
/**
 * v3 Stage 2: the programs the builder told EarnKit they applied to (builder_program_status applied, accepted, funded or
 * rejected: all read as "Applied", so a self-reported acceptance never shows), for their one project.
 */
async function toldApplied(builderId: number) {
  return sql()<{ title: string; at: Date; guide: string | null }[]>`
    SELECT g.title, max(s.at) AS at, CASE WHEN ${guideProgramSql(sql())} THEN g.id END AS guide
    FROM builder_program_status s JOIN installations i ON i.id = s.installation_id JOIN programs g ON g.id = s.program_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND s.login = '' AND s.status IN ('applied', 'accepted', 'funded', 'rejected')
    GROUP BY g.id ORDER BY g.title`;
}
/** A program on the Project tab: won (announced only), else applied (submitted, or the builder said so). */
export type ProgramLabel = { title: string; won: boolean; applied: boolean };
/** "Won X", "Applied to X", else nothing (an entry never submitted has no label). Pure. */
export const programLabel = (g: ProgramLabel): string | null => (g.won ? `Won ${g.title}` : g.applied ? `Applied to ${g.title}` : null);
/**
 * The programs one project (by key) won or applied to, won first; plus what the builder told EarnKit (`told`). `at`: the
 * earliest date of a row that earns the label (an entry's submitted_at, a told row's at). `guide`: the id of a program
 * by that title with a guide page (/programs/<id>: guide-pages.ts guideProgramSql, the guide set's own rule), else null. Pure.
 */
const programsOf = (
  entries: Awaited<ReturnType<typeof programEntries>>, key: string, told: { title: string; at: Date; guide?: string | null }[] = [],
): (ProgramLabel & { at: Date; guide: string | null })[] => {
  const k = norm(key);
  const programs = new Map<string, { won: boolean; applied: boolean; at: Date; guide: string | null }>();
  const add = (title: string, won: boolean, applied: boolean, at: Date, guide: string | null) => {
    const was = programs.get(title);
    // The date comes from a row that earns the label (an entry never submitted dates nothing once another row does).
    const counts = won || applied;
    const wasCounts = Boolean(was && (was.won || was.applied));
    const date = !was || (counts && !wasCounts) ? at : wasCounts && !counts ? was.at : was.at <= at ? was.at : at;
    programs.set(title, { won: (was?.won ?? false) || won, applied: (was?.applied ?? false) || applied, at: date, guide: was?.guide ?? guide });
  };
  for (const e of entries) if (e.keys.some((x) => x && norm(x) === k)) add(e.title, e.won, e.applied, new Date(e.submitted_at), e.guide ?? null);
  for (const t of told) add(t.title, false, true, new Date(t.at), t.guide ?? null);
  return [...programs]
    .map(([title, g]) => ({ title, ...g }))
    .filter((g) => programLabel(g) !== null)
    .sort((a, b) => Number(b.won) - Number(a.won));
};
/** v3.1 site S10: the programs the person's project `key` won or applied to (projectPrograms' rule), each with its date. */
export const projectProgramsDated = async (builderId: number, key: string) => programsOf(await programEntries(builderId), key, await toldApplied(builderId));
/** v2.13 T11: the programs the person's project `key` won or applied to (v3 Stage 2: told applications too). */
export const projectPrograms = async (builderId: number, key: string): Promise<ProgramLabel[]> =>
  (await projectProgramsDated(builderId, key)).map((g) => ({ title: g.title, won: g.won, applied: g.applied }));
