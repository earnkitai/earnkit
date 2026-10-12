import { personInputs, publicRow, publicScore, scoreContext } from './builder-score';
import { sql } from './db';
import { shortWallet } from './entry-text';
import { profileOf, resolveSlug } from './profiles';
import { publicReadKey, PUBLIC_READ_DAYS } from './repo-cache';
import { topPercent, type Parts } from './score';
import { shownUrl } from './untrusted-text';

/**
 * v2.12 spec 7: the public profile's data (/b/<slug>). Public facts only: verified sources, the
 * public score (held days never), announced outcomes. Nothing self-reported, no private repo name,
 * never a wallet as the name.
 */

/** The ring's gradient stops and the panel they sit on (ek-score-orange, ek-score-purple, ek-navy-deep); plan R17. */
export const SCORE_COLORS = { from: '#FF7A1A', to: '#9B6BFF', panel: '#0F1839' } as const;
export type Stat = { value: string; meaning: string };
export type SourceKind = 'github' | 'site' | 'onchain' | 'packages';
export type ProjectCard = {
  key: string;
  title: string;
  numbers: string[];
  sources: { kind: SourceKind; label: string; href: string | null }[];
  entries: { program: string; outcome: 'won' | 'submitted' | 'entered' }[];
};
export type ProfileData = {
  name: string; slug: string; score: number; top_percent: number; change_7d: number | null;
  stats: Stat[]; projects: ProjectCard[]; sources: ProjectCard['sources']; spark: number[]; stricter_note: string | null;
};
/** spec 7: the public page of a profile with nothing verified. Neutral: the page is public, so the fill step stays in the agent's replies. */
export const EMPTY_LINE = 'No verified outcomes yet.';
export type EmptyProfile = { name: string; slug: string; line: typeof EMPTY_LINE };

const WALLET_SLUG = /^0x[0-9a-f]{8}(-\d+)?$/;
/** spec 7: X, else the proven GitHub login, else a neutral label. A wallet is never the name (only a source badge). Pure. */
export function profileName(p: { x_handle: string | null; github_login: string | null; slug: string }): string {
  if (p.x_handle) return `@${p.x_handle}`;
  if (p.github_login) return p.github_login;
  return WALLET_SLUG.test(p.slug) ? 'Builder' : `Builder ${p.slug}`;
}

export function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${Math.round(n)}`;
}

const MONTH_MS = 30.44 * 86_400_000;
const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The three strongest parts of the score, in words, each with a one-line plain meaning. Pure. */
export function statsOf(parts: Parts, projects: { first_outcome_at: string | null }[], now: Date): Stat[] {
  const firsts = projects.map((p) => p.first_outcome_at).filter((x): x is string => !!x).map(Date.parse);
  const months = firsts.length ? Math.max(1, Math.floor((now.getTime() - Math.min(...firsts)) / MONTH_MS)) : 0;
  const all: (Stat & { points: number })[] = [
    { points: parts.users.points, value: count(Math.round(parts.users.raw.U ?? 0), 'user', 'users'), meaning: 'people who used what they shipped' },
    { points: parts.staying.points, value: `${count(months, 'month', 'months')} live`, meaning: 'how long the work kept being used' },
    { points: parts.money.points, value: `${money(parts.money.raw.M ?? 0)} fees and volume`, meaning: 'money through what they built, last 12 months' },
    { points: parts.consistency.points, value: `${count(parts.consistency.raw.weeks ?? 0, 'week', 'weeks')} shipping`, meaning: 'weeks shipping to something people use' },
    { points: parts.recency.points, value: 'Active lately', meaning: 'people used the work recently' },
  ];
  return all.filter((s) => s.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map(({ value, meaning }) => ({ value, meaning }));
}

/** Rows newest first. The note shows only when the calibration changed and the percentile did not fall. Pure. */
export function stricterNote(rows: { day: string; calibration: string; percentile: number }[]): string | null {
  const [now, ...older] = rows;
  const before = older.find((r) => r.calibration !== now?.calibration);
  if (!now || !before || now.percentile < before.percentile) return null;
  const d = new Date(`${now.day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `Scoring got stricter on ${d}; your rank is unchanged.`;
}

const DAY_MS = 86_400_000;
const KIND_ORDER: Record<SourceKind, number> = { github: 0, site: 1, packages: 2, onchain: 3 };
const RANK: Record<ProjectCard['entries'][number]['outcome'], number> = { won: 3, submitted: 2, entered: 1 };
const MAX_PROJECTS = 6;
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The public profile behind `slug`: null for unknown or hidden (also through an old slug), a
 * redirect for an old slug, the neutral empty line without a public score above 0, else the score
 * (the last unheld or released day), its 90-day trend, the stats and the verified projects.
 */
export async function profileData(slug: string, now: Date = new Date()): Promise<{ redirect: string } | ProfileData | EmptyProfile | null> {
  const r = await resolveSlug(slug);
  if (!r) return null;
  if (r.redirect) return { redirect: r.redirect };
  const p = await profileOf(r.builderId);
  if (!p || p.hidden) return null;
  const name = profileName(p);
  const pub = await publicScore(p.builder_id);
  if (!pub || pub.score <= 0) return { name, slug: p.slug, line: EMPTY_LINE };

  // The public rows of the 90 days up to the public day: the trend, the week's change, the note.
  const rows = await sql()<{ day: string; score: number; calibration: string; percentile: number }[]>`
    SELECT s.day::text AS day, s.score, s.calibration, s.percentile FROM builder_scores s
    WHERE s.builder_id = ${p.builder_id} AND ${publicRow()} AND s.day <= ${pub.day}::date AND s.day > ${addDays(pub.day, -90)}::date
    ORDER BY s.day DESC`;
  const weekAgo = rows.find((x) => x.day <= addDays(pub.day, -7));
  const { sources, readings, projects } = await personInputs(p.builder_id, await scoreContext(), new Date(`${pub.day}T23:59:59Z`), pub.day);

  // Repos shown only when GitHub said public within 7 days (repo_public_reads) or the latest reading
  // (made without access to private repos) is that recent; otherwise the card names no repo.
  const fresh = addDays(now.toISOString().slice(0, 10), -PUBLIC_READ_DAYS);
  const lastOk = new Map<number, string>();
  for (const x of readings) if (x.ok && (lastOk.get(x.source_id) ?? '') < x.day) lastOk.set(x.source_id, x.day);
  const repoKeys = sources.filter((s) => s.kind === 'repo').map((s) => publicReadKey(s.ref));
  const publicReads = new Set(
    repoKeys.length === 0
      ? []
      : (await sql()<{ repo_key: string }[]>`
          SELECT repo_key FROM repo_public_reads WHERE repo_key IN ${sql()(repoKeys)} AND read_at > ${new Date(now.getTime() - PUBLIC_READ_DAYS * DAY_MS)}`).map((x) => x.repo_key),
  );
  const latestSignals = (id: number) => readings.find((x) => x.source_id === id && x.ok && x.day === lastOk.get(id))?.signals as Record<string, unknown> | undefined;

  const chips = new Map<string, ProjectCard['sources']>();
  const titles = new Map<string, string>();
  const shownRepos = new Set<string>();
  for (const s of sources) {
    const list = chips.get(s.project_key) ?? [];
    let chip: ProjectCard['sources'][number] | null = null;
    if (s.kind === 'repo' && (publicReads.has(publicReadKey(s.ref)) || (lastOk.get(s.id) ?? '') >= fresh)) {
      chip = { kind: 'github', label: s.ref, href: shownUrl(`https://github.com/${s.ref}`) };
      shownRepos.add(publicReadKey(s.ref));
      if (s.ref === s.project_key) titles.set(s.project_key, s.ref.split('/')[1] ?? s.ref);
    } else if (s.kind === 'merged_pr') {
      const target = latestSignals(s.id)?.target;
      chip = { kind: 'github', label: typeof target === 'string' ? `PR to ${target}` : 'Merged PR', href: shownUrl(s.ref) };
      if (!titles.has(s.project_key)) titles.set(s.project_key, 'Open source');
    } else if (s.kind === 'site') {
      // A site is shown only when its latest reading found it up: "live", never more (siteShowsUse decides what scores).
      const h = host(s.ref);
      if (h && latestSignals(s.id)?.up === true) {
        chip = { kind: 'site', label: h, href: shownUrl(s.ref) };
      }
    } else if (s.kind === 'package_npm' || s.kind === 'package_pypi') {
      const npm = s.kind === 'package_npm';
      chip = { kind: 'packages', label: `${npm ? 'npm' : 'PyPI'} ${s.ref}`, href: shownUrl(npm ? `https://www.npmjs.com/package/${s.ref}` : `https://pypi.org/project/${s.ref}`) };
    } else if (s.kind === 'contract') {
      const [chain, address] = s.ref.split(':');
      if (address && /^0x[0-9a-f]{40}$/i.test(address))
        chip = { kind: 'onchain', label: shortWallet(address.toLowerCase()), href: chain === 'base' ? shownUrl(`https://basescan.org/address/${address.toLowerCase()}`) : null };
    }
    if (chip) list.push(chip);
    chips.set(s.project_key, list);
  }

  // Entries: the person's projects whose repo is a shown one; announced outcomes only (never self-reported).
  const entryRows = shownRepos.size === 0 ? [] : await sql()<{ repo_url: string; program: string; won: boolean; submitted: boolean }[]>`
    SELECT p.repo_url, g.title AS program,
      EXISTS (SELECT 1 FROM entry_outcomes o WHERE o.project_id = p.id AND o.basis = 'announcement' AND o.result IN ('won', 'placed', 'finalist')) AS won,
      (p.submission_proof_ok_at IS NOT NULL OR EXISTS (SELECT 1 FROM builder_events e WHERE e.type = 'submitted' AND e.project_id = p.id)) AS submitted
    FROM projects p JOIN installations i ON i.id = p.installation_id JOIN programs g ON g.id = p.program_id
    WHERE COALESCE(i.builder_id, i.id) = ${p.builder_id} AND p.repo_url IS NOT NULL`;
  const entries = new Map<string, Map<string, ProjectCard['entries'][number]['outcome']>>();
  for (const e of entryRows) {
    const repo = publicReadKey(e.repo_url);
    if (!shownRepos.has(repo)) continue;
    const outcome: ProjectCard['entries'][number]['outcome'] = e.won ? 'won' : e.submitted ? 'submitted' : 'entered';
    const m = entries.get(repo) ?? new Map<string, ProjectCard['entries'][number]['outcome']>();
    if (!m.has(e.program) || RANK[outcome] > RANK[m.get(e.program)!]) m.set(e.program, outcome);
    entries.set(repo, m);
  }

  const cards: ProjectCard[] = [...projects]
    .sort((a, b) => b.users + b.money_usd / 10 - (a.users + a.money_usd / 10) || a.key.localeCompare(b.key))
    .map((x, i) => {
      const users = Math.round(x.users);
      const src = (chips.get(x.key) ?? []).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
      const repo = /^[^/]+\/[^/]+$/.test(x.key) ? publicReadKey(x.key) : null;
      return {
        // The key is public markup: a repo's key only when that repo is shown (else it could name a private repo).
        key: titles.has(x.key) && x.key !== 'oss' ? x.key : `project-${i + 1}`,
        // A repo's name only when the repo is shown; else the live site's host or the package's name.
        title: titles.get(x.key) ?? src.find((c) => c.kind === 'site')?.label ?? src.find((c) => c.kind === 'packages')?.label.replace(/^\S+ /, '') ?? 'Private project',
        numbers: [...(users > 0 ? [count(users, 'user', 'users')] : []), ...(x.money_usd >= 1 ? [money(x.money_usd)] : [])],
        sources: src,
        entries: [...((repo && entries.get(repo)) ?? new Map())].map(([program, outcome]) => ({ program, outcome })),
      };
    })
    .filter((c) => c.numbers.length > 0 || c.sources.length > 0)
    .slice(0, MAX_PROJECTS);

  return {
    name,
    slug: p.slug,
    score: pub.score,
    top_percent: topPercent(pub.percentile),
    change_7d: weekAgo ? pub.score - weekAgo.score : null,
    stats: statsOf(pub.parts, projects.map((x) => ({ first_outcome_at: x.first_outcome_at?.toISOString() ?? null })), now),
    projects: cards,
    sources: cards.flatMap((c) => c.sources),
    spark: [...rows].reverse().map((x) => x.score),
    stricter_note: stricterNote(rows),
  };
}
