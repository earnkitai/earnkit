/**
 * v2.14: a fake GitHub for the App and the readings: installations, tokens (ghs_fake_<installation>), repos
 * (a private one answers 404 without an installation token), commits and pulls (T8), and the repo reading's
 * GraphQL query (commit dates as the default branch's history). Records every call
 * with its Authorization header, so a test can see which token read what.
 */
export type FakeCommit = { sha: string; message: string; date: string; login?: string; type?: 'User' | 'Bot'; parents?: number };
export type FakePull = { number: number; title: string; merged_at: string | null; login?: string; type?: 'User' | 'Bot' };
export type FakeRepo = {
  id: number; owner: string; ownerType?: 'User' | 'Organization'; private?: boolean; fork?: boolean; template?: boolean;
  installation?: number | null; admins?: string[]; commits?: FakeCommit[]; pulls?: FakePull[];
  /**
   * Fix rounds 2 and 4: the landings GitHub's /activity lists (default: one push at each commit's date), a time
   * (a push) or a time with its activity type; null answers 500.
   */
  pushes?: (string | { at: string; type: string })[] | null; created?: string;
  /** Scoring and clarity R3: the README's markdown (GET /repos/{key}/readme, base64 in JSON); none answers 404, null 500. */
  readme?: string | null;
  /**
   * v3.1 Task 7: the default branch's files (path to text), for GET /repos/{key}/git/trees/HEAD?recursive=1 and
   * GET /repos/{key}/contents/{path} (base64 in JSON); none answers 404, null 500.
   */
  files?: Record<string, string> | null;
};
/** `routed`: false when no fake route answered (a 404 'fake: not routed'): a test can assert every call was one it fakes (T12 D3). */
export type FakeGitHub = typeof fetch & { calls: { method: string; path: string; auth: string | null; routed: boolean }[]; repos: Record<string, FakeRepo> };

export function fakeGitHub(repos: Record<string, FakeRepo>): FakeGitHub {
  const calls: FakeGitHub['calls'] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? 'GET';
    const auth = new Headers(init?.headers).get('authorization');
    const call = { method, path: url.pathname + url.search, auth, routed: true };
    calls.push(call);
    const p = url.pathname;
    const inst = Number(/ghs_fake_(\d+)/.exec(auth ?? '')?.[1] ?? NaN);
    let m: RegExpExecArray | null;
    // Scoring and clarity: the repo reading's GraphQL query (person-github.ts reposQuery), one repository per
    // alias r<k> named by variables o<k>/n<k>; a private repo answers null without its installation token.
    if (p === '/graphql' && method === 'POST') {
      const vars = (JSON.parse(String(init?.body ?? '{}')) as { variables?: Record<string, string> }).variables ?? {};
      const data: Record<string, unknown> = {};
      for (let k = 0; `o${k}` in vars; k++) {
        const key = `${vars[`o${k}`]}/${vars[`n${k}`]}`.toLowerCase();
        const r = repos[key];
        data[`r${k}`] = !r || (r.private && r.installation !== inst) ? null : {
          nameWithOwner: key, owner: { __typename: r.ownerType ?? 'User' }, isPrivate: Boolean(r.private), isFork: Boolean(r.fork), isTemplate: Boolean(r.template),
          createdAt: r.created ?? '2025-01-01T00:00:00Z', pushedAt: r.commits?.at(-1)?.date ?? null, stargazerCount: 0, forkCount: 0, stargazers: { edges: [] }, forks: { nodes: [] },
          defaultBranchRef: { target: { history: { nodes: (r.commits ?? []).map((c) => ({ committedDate: c.date })) } } },
        };
      }
      return json(200, { data });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      return r?.installation ? json(200, { id: r.installation }) : json(404, {});
    }
    if ((m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(p)) && method === 'POST') return json(201, { token: `ghs_fake_${m[1]}` });
    if ((m = /^\/app\/installations\/(\d+)$/.exec(p))) {
      const r = Object.values(repos).find((x) => x.installation === Number(m![1]));
      return r ? json(200, { account: { login: r.owner, type: r.ownerType ?? 'User' } }) : json(404, {});
    }
    // Launch ready L2: the picker's setup reads pushed_at (the newest commit's date) and pages by per_page and page.
    if (p === '/installation/repositories') {
      const per = Number(url.searchParams.get('per_page') ?? 30);
      const page = Number(url.searchParams.get('page') ?? 1);
      const all = Object.entries(repos).filter(([, r]) => r.installation === inst)
        .map(([k, r]) => ({ full_name: k, private: Boolean(r.private), fork: Boolean(r.fork), pushed_at: r.commits?.at(-1)?.date ?? null }));
      return json(200, { total_count: all.length, repositories: all.slice((page - 1) * per, page * per) });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)\/permission$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      return json(200, { permission: r?.admins?.includes(decodeURIComponent(m[2]).toLowerCase()) ? 'admin' : 'write' });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/commits$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      if (!r || (r.private && r.installation !== inst)) return json(404, {});
      const since = url.searchParams.get('since');
      const until = url.searchParams.get('until');
      return json(200, (r.commits ?? []).filter((c) => (!since || c.date >= since) && (!until || c.date < until)).map((c) => ({
        sha: c.sha, commit: { message: c.message, author: { name: c.login ?? 'someone', date: c.date } },
        author: c.login ? { login: c.login, type: c.type ?? 'User' } : null, parents: Array.from({ length: c.parents ?? 1 }, (_, i) => ({ sha: `p${i}` })),
      })));
    }
    // An organization repo's reading asks for its contributors (the owner's admins stand in for them).
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/contributors$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      if (!r || (r.private && r.installation !== inst)) return json(404, {});
      return json(200, (r.admins ?? [r.owner]).map((login) => ({ login })));
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/activity$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      if (!r || (r.private && r.installation !== inst)) return json(404, {});
      if (r.pushes === null) return json(500, {});
      // Newest first; direction=asc oldest first. Cursor paging (Link header) is not faked: EarnKit reads one page.
      const all = (r.pushes ?? (r.commits ?? []).map((c) => c.date))
        .map((x) => (typeof x === 'string' ? { at: x, type: 'push' } : x))
        .sort((a, b) => b.at.localeCompare(a.at));
      if (url.searchParams.get('direction') === 'asc') all.reverse();
      const per = Number(url.searchParams.get('per_page') ?? 30);
      return json(200, all.slice(0, per).map((x, i) => ({ id: i, timestamp: x.at, activity_type: x.type, ref: 'refs/heads/main' })));
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/readme$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      if (!r || (r.private && r.installation !== inst) || r.readme === undefined) return json(404, {});
      if (r.readme === null) return json(500, {});
      return json(200, { name: 'README.md', encoding: 'base64', content: Buffer.from(r.readme, 'utf8').toString('base64') });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/trees\/HEAD$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      if (!r || (r.private && r.installation !== inst) || r.files === undefined) return json(404, {});
      if (r.files === null) return json(500, {});
      return json(200, { truncated: false, tree: Object.entries(r.files).map(([path, text]) => ({ path, type: 'blob', size: Buffer.byteLength(text) })) });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      const path = m[2].split('/').map(decodeURIComponent).join('/');
      if (!r || (r.private && r.installation !== inst) || !r.files || !(path in r.files)) return json(404, {});
      return json(200, { path, encoding: 'base64', content: Buffer.from(r.files[path], 'utf8').toString('base64') });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      if (!r || (r.private && r.installation !== inst)) return json(404, {});
      return json(200, (r.pulls ?? []).map((x) => ({ number: x.number, title: x.title, merged_at: x.merged_at, updated_at: x.merged_at, user: { login: x.login ?? 'someone', type: x.type ?? 'User' } })));
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)$/.exec(p))) {
      const k = m[1].toLowerCase();
      const r = repos[k];
      if (!r || (r.private && r.installation !== inst)) return json(404, {});
      return json(200, { id: r.id, full_name: k, created_at: r.created, private: Boolean(r.private), fork: Boolean(r.fork), is_template: Boolean(r.template), owner: { login: r.owner, type: r.ownerType ?? 'User' } });
    }
    call.routed = false;
    return json(404, { message: 'fake: not routed' });
  }) as FakeGitHub;
  f.calls = calls;
  f.repos = repos;
  return f;
}
