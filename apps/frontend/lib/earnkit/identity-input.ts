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

/**
 * One reported project, read leniently: the repo (a remote, a github.com link or 'owner/repo'), the
 * live origin, a package, contracts on a named chain, and a name (else the repo's or the site's).
 * Null when it names nothing to read. The `chain` an agent sends is read nowhere. Pure.
 */
export function projectOf(raw: unknown): IdentityProject | null {
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
  if (!name || (!repo && !live && !pkg && contracts.length === 0)) return null;
  return { name, what: s(p.what, 60) || null, repo, live_url: live, package: pkg, contracts };
}

export function identityInput(v: unknown, legacy?: LocalGit): Identity {
  try {
    const i = o(v);
    const login = s(i.github_login, 39).toLowerCase();
    const projects: IdentityProject[] = [];
    for (const raw of list(i.projects, 100)) {
      if (projects.length >= IDENTITY_CAPS.projects) break;
      const p = projectOf(raw);
      if (p) projects.push(p);
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

/** The project key a reported project is stored under (projectSources' key). Pure. */
export const projectKeyOf = (p: IdentityProject): string => p.repo ?? p.live_url ?? p.package ?? p.contracts[0];

/**
 * v2.13 spec "2a": the one project the agent is in: `identity.project` (an object), else the first
 * entry of an older agent's `identity.projects[]` (the rest ignored). Null when neither reads. Pure.
 */
export function benchProject(identity: unknown): IdentityProject | null {
  const i = o(identity);
  if (i.project !== undefined) return Array.isArray(i.project) ? null : projectOf(i.project);
  return Array.isArray(i.projects) && i.projects.length > 0 ? projectOf(i.projects[0]) : null;
}

/** A live link as an agent gives it ("earnkit.com" or "https://earnkit.com/app"): its public https origin, or null. Pure. */
const liveOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 300) return null;
  return publicHttpsOrigin(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
};
/** find's github_user as an agent gives it ("@octocat", "github.com/octocat"), lowercase, or null. Pure. */
const loginOf = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 200) return null;
  const t = v.trim().replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '').replace(/\/.*$/, '').toLowerCase();
  return LOGIN.test(t) ? t : null;
};

/**
 * v2.13.3 (1, the owner's production test): an agent that sends the GitHub login and the repo through
 * find's older fields (github_user, repos, local_repos, local_git, a live_url) is never silently
 * dropped under the Bench. They fill what identity doesn't carry: github_user is identity.github_login;
 * the first repo (repos, else a local_repos url, else local_git's remotes) is the project's repo, named
 * by its local_repos entry (else the repo's name), with that entry's live link (else the top-level
 * live_url, else local_git's first live link). identity.project wins: its missing repo is filled, and
 * its missing live link only when the repo is the same (or it had none). Unchanged when there is
 * nothing to fill. Pure.
 */
export function benchIdentity(a: {
  identity: Identity; project: IdentityProject | null; local_git: LocalGit;
  github_user?: unknown; repos?: unknown; local_repos?: unknown; live_url?: unknown;
}): { identity: Identity; project: IdentityProject | null } {
  try {
    const login = a.identity.github_login ?? loginOf(a.github_user);
    const identity = login === a.identity.github_login ? a.identity : { ...a.identity, github_login: login };
    const locals = (a.local_repos == null ? [] : Array.isArray(a.local_repos) ? a.local_repos : [a.local_repos]).slice(0, 20).map((x) => {
      const r = typeof x === 'string' ? { name: x } : o(x);
      // v2.13.4 (production): an entry names its repo by `url`, `remote` or `repo` (agents send each).
      return { name: s(r.name, 40), repo: repoOf(r.url) ?? repoOf(r.remote) ?? repoOf(r.repo), live: liveOf(r.live_url) };
    });
    const repo = list(a.repos == null ? [] : Array.isArray(a.repos) ? a.repos : [a.repos], 30).map(repoOf).find((r): r is string => r !== null)
      ?? locals.find((l) => l.repo)?.repo ?? a.local_git.remotes[0] ?? null;
    const entry = repo ? locals.find((l) => l.repo === repo) : undefined;
    const live = entry?.live ?? liveOf(a.live_url) ?? a.local_git.live_urls[0] ?? null;
    const p = a.project;
    if (!p) {
      const made = repo || live ? projectOf({ name: entry?.name || undefined, repo, live_url: live }) : null;
      return { identity, project: made };
    }
    const sameRepo = !p.repo || !repo || p.repo === repo;
    // v2.13.4 (production): the matching local_repos entry fills a missing live link (same repo only).
    const own = locals.find((l) => l.repo && l.repo === (p.repo ?? repo));
    const filled = { ...p, repo: p.repo ?? repo, live_url: p.live_url ?? own?.live ?? (sameRepo ? live : null) };
    return { identity, project: filled.repo === p.repo && filled.live_url === p.live_url ? p : filled };
  } catch {
    return { identity: a.identity, project: a.project };
  }
}

/** The sources one reported project proposes (kind, ref), under its project key. Pure. */
function projectSources(p: IdentityProject): { key: string; sources: { kind: string; ref: string }[] } {
  const sources: { kind: string; ref: string }[] = [];
  if (p.repo) sources.push({ kind: 'repo', ref: p.repo });
  if (p.live_url) sources.push({ kind: 'site', ref: p.live_url });
  if (p.package) sources.push(p.package.startsWith('pypi:') ? { kind: 'package_pypi', ref: p.package.slice(5) } : { kind: 'package_npm', ref: p.package });
  for (const c of p.contracts) sources.push({ kind: 'contract', ref: c });
  return { key: projectKeyOf(p), sources };
}

const refsOf = (p: IdentityProject) => [p.repo, p.live_url, p.package, ...p.contracts].filter((v): v is string => typeof v === 'string');
const asProject = (v: unknown): IdentityProject | null => {
  const p = o(v);
  if (typeof p.name !== 'string' || !p.name) return null;
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  return {
    name: p.name, what: str(p.what), repo: str(p.repo), live_url: str(p.live_url), package: str(p.package),
    contracts: Array.isArray(p.contracts) ? p.contracts.filter((c): c is string => typeof c === 'string') : [],
  };
};

/**
 * Final fix wave: a new report merged into the stored one, so one agent (or a find with only the
 * login) never erases what another reported. A stored project that shares a link, repo, package
 * or contract with a new one is that project: the new report wins, and what it left out (the plain
 * words, a link) is kept. Stored projects the new report did not mention stay, after the new ones,
 * up to IDENTITY_CAPS.projects. The login is the new one, else the stored one; wallets are both,
 * newest first. Pure.
 */
export function mergeIdentity(stored: unknown, next: Identity): Identity {
  const old = o(stored);
  const before = (Array.isArray(old.projects) ? old.projects : []).map(asProject).filter((p): p is IdentityProject => p !== null);
  const used = new Set<number>();
  const projects = next.projects.map((p) => {
    const refs = new Set(refsOf(p).map((r) => r.toLowerCase()));
    const i = before.findIndex((q, k) => !used.has(k) && refsOf(q).some((r) => refs.has(r.toLowerCase())));
    if (i < 0) return p;
    used.add(i);
    const q = before[i];
    return {
      name: p.name, what: p.what ?? q.what, repo: p.repo ?? q.repo, live_url: p.live_url ?? q.live_url, package: p.package ?? q.package,
      contracts: [...new Set([...p.contracts, ...q.contracts])].slice(0, IDENTITY_CAPS.contracts),
    };
  });
  for (const [k, q] of before.entries()) if (!used.has(k) && projects.length < IDENTITY_CAPS.projects) projects.push(q);
  const oldWallets = Array.isArray(old.wallets) ? old.wallets.filter((w): w is string => typeof w === 'string' && ADDRESS.test(w)) : [];
  const oldLogin = typeof old.github_login === 'string' && LOGIN.test(old.github_login) ? old.github_login : null;
  return {
    github_login: next.github_login ?? oldLogin,
    projects: projects.slice(0, IDENTITY_CAPS.projects),
    wallets: [...new Set([...next.wallets, ...oldWallets])].slice(0, IDENTITY_CAPS.wallets),
  };
}

/** At most this many agent-reported projects (their project keys) per person; more are refused. */
export const AGENT_PROJECTS_MAX = 25;

/**
 * What find's identity tells EarnKit about a person (their group root), never as proof: the
 * reported login is kept as `reported_github` (a new one queues discovery, which reads it as a
 * clue), the report merged into `identity` (mergeIdentity: names and few words per project, shown as
 * not yet confirmed; never erased by another agent's or a login-only report), every repo, site, package and contract as an agent-proposed source (one insert; at
 * most AGENT_PROJECTS_MAX project keys per person, a new one past that is refused), and the wallets
 * remembered (never proven, never a merge). One `identity_given` event per person per UTC day.
 * Fix round 1: a find that carried nothing (no login, project or wallet) writes nothing, so it never
 * wipes the last report. Only for a person with a profile (the caller made it). v2.13 (T2 fix round 1):
 * `propose: false` stores the report in identity only (no source proposed), for a project that is not
 * the person's one project.
 */
export async function noteIdentity(builderId: number, i: Identity, now: Date, o: { propose?: boolean } = {}): Promise<{ proposed: number }> {
  if (!i.github_login && i.projects.length === 0 && i.wallets.length === 0) return { proposed: 0 };
  const result = await sql().begin(async (tx) => {
    // The profile row's lock also serializes the cap below between two finds at once.
    const [p] = await tx<{ reported: string | null; identity: unknown }[]>`
      SELECT reported_github AS reported, identity FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!p) return null;
    const login = i.github_login ?? p.reported;
    // Final fix wave: merged into the stored report (a second agent or a login-only find never wipes it).
    await tx`
      UPDATE builder_profiles SET reported_github = ${login}, identity = ${tx.json(mergeIdentity(p.identity, i) as never)}, updated_at = now()
      WHERE builder_id = ${builderId}`;
    const held = new Set(
      (await tx<{ key: string }[]>`
        SELECT DISTINCT project_key AS key FROM builder_sources WHERE builder_id = ${builderId} AND proposed_by = 'agent'`).map((r) => r.key),
    );
    const rows: { builder_id: number; kind: string; ref: string; project_key: string; proposed_by: 'agent' }[] = [];
    for (const project of o.propose === false ? [] : i.projects) {
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
