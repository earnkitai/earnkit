import { githubRemote } from './discovery-clues';
import { enqueueDiscovery, publicHttpsOrigin, type LocalGit } from './discovery';
import { sql } from './db';
import { noteEvent } from './events';
import { rememberWallets } from './installations';
import { plainText } from './untrusted-text';

/**
 * v2.12.1 spec "1. Connect": in the first find the agent passes what it can already see, never
 * asking the builder: the GitHub login (git config, gh auth status), local projects with a few
 * plain words on what each does, live links, packages, and any wallet and the contracts it
 * deployed. Read leniently (never refused). Everything here is a clue: shown as not yet confirmed,
 * never scored, never a merge.
 */
export type IdentityProject = { name: string; what: string | null; repo: string | null; live_url: string | null; package: string | null; contracts: string[] };
export type Identity = { github_login: string | null; projects: IdentityProject[]; wallets: string[] };
export const IDENTITY_CAPS = { projects: 25, contracts: 5, wallets: 5 } as const;

const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const CONTRACT = /^(base|arc|monad|tempo):(0x[0-9a-f]{40})$/;
const NPM = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]{0,213}$/;
const PYPI = /^pypi:[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/i;
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
// plainText keeps letters out of markup ("<b>now</b>" would read "bnow/b"), so tags go first; a dash
// between words becomes a comma (the copy rule: no em dashes in builder text, and these words are shown).
const s = (v: unknown, max: number) =>
  typeof v === 'string'
    ? plainText(v.slice(0, 1000).replace(/<[^>]*>/g, ''), true).replace(/\s*[–—]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
const BARE_REPO = /^([a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38})\/((?!\.\.?$)[a-z0-9._-]{1,100})$/i;
/** A GitHub repo as 'owner/repo' (lowercase): a remote, a github.com link, or the bare 'owner/repo'. */
const repoOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?=github\.com\/)/i, 'https://');
  return githubRemote(t) ?? (BARE_REPO.test(t) ? t.replace(/\.git$/i, '').toLowerCase() : null);
};
const list = (v: unknown, scan: number): unknown[] => (Array.isArray(v) ? v.slice(0, scan) : []);

export function identityInput(v: unknown, legacy?: LocalGit): Identity {
  try {
    const i = o(v);
    const login = s(i.github_login, 39).toLowerCase();
    const projects: IdentityProject[] = [];
    for (const raw of list(i.projects, 100)) {
      if (projects.length >= IDENTITY_CAPS.projects) break;
      const p = o(raw);
      const repo = repoOf(p.repo);
      const live = typeof p.live_url === 'string' ? publicHttpsOrigin(p.live_url) : null;
      const given = s(p.package, 214).toLowerCase();
      const pkg = NPM.test(given) || PYPI.test(given) ? given : null;
      // A bare address names no chain, so it is dropped; monad and tempo are kept (shown "not tracked yet").
      const contracts = [
        ...new Set(
          list(p.contracts, 20)
            .map((c) => (typeof c === 'string' ? c.trim().toLowerCase() : ''))
            .filter((c) => CONTRACT.test(c)),
        ),
      ].slice(0, IDENTITY_CAPS.contracts);
      const name = s(p.name, 40) || (repo ? repo.split('/')[1] : '') || (live ? new URL(live).hostname : '');
      if (!name || (!repo && !live && !pkg && contracts.length === 0)) continue;
      projects.push({ name, what: s(p.what, 60) || null, repo, live_url: live, package: pkg, contracts });
    }
    // The v2.12 local_git, still accepted: its remotes and live links fill in when there is room.
    for (const r of legacy?.remotes ?? [])
      if (projects.length < IDENTITY_CAPS.projects && !projects.some((p) => p.repo === r))
        projects.push({ name: r.split('/')[1], what: null, repo: r, live_url: null, package: null, contracts: [] });
    for (const u of legacy?.live_urls ?? [])
      if (projects.length < IDENTITY_CAPS.projects && !projects.some((p) => p.live_url === u))
        projects.push({ name: new URL(u).hostname, what: null, repo: null, live_url: u, package: null, contracts: [] });
    const wallets = [
      ...new Set(list(i.wallets, 50).map((w) => (typeof w === 'string' ? w.trim().toLowerCase() : '')).filter((w) => ADDRESS.test(w))),
    ].slice(0, IDENTITY_CAPS.wallets);
    return { github_login: LOGIN.test(login) ? login : null, projects, wallets };
  } catch {
    return { github_login: null, projects: [], wallets: [] };
  }
}

/** The sources one reported project proposes (kind, ref), under its project key. Pure. */
function projectSources(p: IdentityProject): { key: string; sources: { kind: string; ref: string }[] } {
  const sources: { kind: string; ref: string }[] = [];
  if (p.repo) sources.push({ kind: 'repo', ref: p.repo });
  if (p.live_url) sources.push({ kind: 'site', ref: p.live_url });
  if (p.package) sources.push(p.package.startsWith('pypi:') ? { kind: 'package_pypi', ref: p.package.slice(5) } : { kind: 'package_npm', ref: p.package });
  for (const c of p.contracts) sources.push({ kind: 'contract', ref: c });
  return { key: p.repo ?? p.live_url ?? p.package ?? p.contracts[0], sources };
}

/** At most this many agent-reported projects (their project keys) per person; more are refused. */
export const AGENT_PROJECTS_MAX = 25;

/**
 * What find's identity tells EarnKit about a person (their group root), never as proof: the
 * reported login is kept as `reported_github` (a new one queues discovery, which reads it as a
 * clue), the whole report as `identity` (names and few words per project, shown as not yet
 * confirmed), every repo, site, package and contract as an agent-proposed source (one insert; at
 * most AGENT_PROJECTS_MAX project keys per person, a new one past that is refused), and the wallets
 * remembered (never proven, never a merge). One `identity_given` event per person per UTC day.
 * Fix round 1: a find that carried nothing (no login, project or wallet) writes nothing, so it never
 * wipes the last report. Only for a person with a profile (the caller made it).
 */
export async function noteIdentity(builderId: number, i: Identity, now: Date): Promise<{ proposed: number }> {
  if (!i.github_login && i.projects.length === 0 && i.wallets.length === 0) return { proposed: 0 };
  const result = await sql().begin(async (tx) => {
    // The profile row's lock also serializes the cap below between two finds at once.
    const [p] = await tx<{ reported: string | null }[]>`
      SELECT reported_github AS reported FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!p) return null;
    const login = i.github_login ?? p.reported;
    await tx`
      UPDATE builder_profiles SET reported_github = ${login}, identity = ${tx.json(i as never)}, updated_at = now()
      WHERE builder_id = ${builderId}`;
    const held = new Set(
      (await tx<{ key: string }[]>`
        SELECT DISTINCT project_key AS key FROM builder_sources WHERE builder_id = ${builderId} AND proposed_by = 'agent'`).map((r) => r.key),
    );
    const rows: { builder_id: number; kind: string; ref: string; project_key: string; proposed_by: 'agent' }[] = [];
    for (const project of i.projects) {
      const { key, sources } = projectSources(project);
      if (!held.has(key)) {
        if (held.size >= AGENT_PROJECTS_MAX) continue;
        held.add(key);
      }
      for (const x of sources) rows.push({ builder_id: builderId, kind: x.kind, ref: x.ref, project_key: key, proposed_by: 'agent' });
    }
    const added = rows.length === 0 ? [] : await tx<{ id: string; kind: string }[]>`
      INSERT INTO builder_sources ${tx(rows)} ON CONFLICT (builder_id, kind, ref) DO NOTHING RETURNING id, kind`;
    return { changed: login !== p.reported, added };
  });
  if (result === null) return { proposed: 0 };
  for (const s of result.added)
    await noteEvent('source_proposed', () => ({
      type: 'source_proposed', dedupe_key: `source_proposed:${s.id}`, installation_id: builderId,
      detail: { source_id: Number(s.id), kind: s.kind, by: 'agent' },
    }));
  await rememberWallets(builderId, i.wallets);
  if (result.changed || result.added.length > 0) await enqueueDiscovery(builderId, 'local_repo');
  const day = now.toISOString().slice(0, 10);
  await noteEvent('identity_given', () => ({
    type: 'identity_given', dedupe_key: `identity_given:${builderId}:${day}`, installation_id: builderId,
    detail: { projects: i.projects.length },
  }));
  return { proposed: result.added.length };
}
