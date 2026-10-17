import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/** Test only (v2.13.1 O1, shared by v2.13.2): a fake GitHub REST API for proof branches. */
export type RepoMeta = { id?: number; full_name?: string; fork?: boolean; is_template?: boolean; owner?: { login: string; type: 'User' | 'Organization' } };
/** GitHub's numeric id for a repo key (stable per key unless a test re-creates the repo). */
export const idOf = (key: string) => parseInt(createHash('sha256').update(key.toLowerCase()).digest('hex').slice(0, 8), 16);
/**
 * A fake GitHub REST API (keys as GitHub spells them, matched case-insensitively): branches and their
 * activity per repo, repo metadata (default: its own, a User's, not a fork), and per-repo overrides for
 * the ref read (a status such as 301, or a ref url naming another repo).
 */
export function fakeGitHub() {
  // `owner/repo#branch` (lowercase) -> its activity, newest first (GitHub's order).
  const branches = new Map<string, { activity_type: string; actor: { login: string } | null }[]>();
  const repos: Record<string, RepoMeta> = {};
  const refStatus: Record<string, number> = {};
  const refUrlRepo: Record<string, string> = {};
  const calls: string[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    assert.equal(url.host, 'api.github.com');
    assert.equal(init?.redirect, 'manual', 'redirects are refused');
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) return json(404, {});
    const key = `${m[1]}/${m[2]}`.toLowerCase();
    const rest = m[3] ?? '';
    const ref = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
    if (ref) {
      if (refStatus[key]) return json(refStatus[key], { message: 'Moved Permanently' });
      const b = branches.get(`${key}#${ref[1]}`);
      return b
        ? json(200, { ref: `refs/heads/${ref[1]}`, url: `https://api.github.com/repos/${refUrlRepo[key] ?? `${m[1]}/${m[2]}`}/git/refs/heads/${ref[1]}`, object: { sha: 'a'.repeat(40), type: 'commit' } })
        : json(404, { message: 'Not Found' });
    }
    if (rest === '/activity') {
      const want = url.searchParams.get('ref');
      const list = [...branches.entries()]
        .filter(([k]) => k.startsWith(`${key}#`) && (!want || want === `refs/heads/${k.split('#')[1]}`))
        .flatMap(([k, v]) => v.map((e) => ({ ...e, ref: `refs/heads/${k.split('#')[1]}`, before: '0'.repeat(40), after: 'a'.repeat(40), timestamp: new Date().toISOString() })));
      return json(200, list);
    }
    if (rest === '') {
      const meta = repos[key] ?? {};
      return json(200, { id: idOf(key), full_name: `${m[1]}/${m[2]}`, fork: false, is_template: false, owner: { login: m[1], type: 'User' }, ...meta });
    }
    return json(404, {});
  }) as typeof fetch;
  /** The agent's push: the branch created on `key` by `actor` (default: the repo's owner; null: GitHub shows no actor). */
  const push = (key: string, branch: string, actor: string | null = key.split('/')[0]) =>
    void branches.set(`${key.toLowerCase()}#${branch}`, [{ activity_type: 'branch_creation', actor: actor === null ? null : { login: actor } }]);
  /** A later push to the same branch (newest first), by `actor`. */
  const pushAgain = (key: string, branch: string, actor: string) =>
    void branches.get(`${key.toLowerCase()}#${branch}`)!.unshift({ activity_type: 'push', actor: { login: actor } });
  const refReads = () => calls.filter((c) => c.includes('/git/ref/')).length;
  return { f, branches, push, pushAgain, repos, refStatus, refUrlRepo, calls, refReads };
}
