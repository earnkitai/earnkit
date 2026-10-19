/**
 * v2.14: a fake GitHub for the App and the readings: installations, tokens (ghs_fake_<installation>), repos
 * (a private one answers 404 without an installation token), commits and pulls (T8). Records every call
 * with its Authorization header, so a test can see which token read what.
 */
export type FakeCommit = { sha: string; message: string; date: string; login?: string; type?: 'User' | 'Bot'; parents?: number };
export type FakePull = { number: number; title: string; merged_at: string | null; login?: string; type?: 'User' | 'Bot' };
export type FakeRepo = {
  id: number; owner: string; ownerType?: 'User' | 'Organization'; private?: boolean; fork?: boolean; template?: boolean;
  installation?: number | null; admins?: string[]; commits?: FakeCommit[]; pulls?: FakePull[];
};
export type FakeGitHub = typeof fetch & { calls: { method: string; path: string; auth: string | null }[]; repos: Record<string, FakeRepo> };

export function fakeGitHub(repos: Record<string, FakeRepo>): FakeGitHub {
  const calls: FakeGitHub['calls'] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? 'GET';
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ method, path: url.pathname + url.search, auth });
    const p = url.pathname;
    const inst = Number(/ghs_fake_(\d+)/.exec(auth ?? '')?.[1] ?? NaN);
    let m: RegExpExecArray | null;
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      return r?.installation ? json(200, { id: r.installation }) : json(404, {});
    }
    if ((m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(p)) && method === 'POST') return json(201, { token: `ghs_fake_${m[1]}` });
    if ((m = /^\/app\/installations\/(\d+)$/.exec(p))) {
      const r = Object.values(repos).find((x) => x.installation === Number(m![1]));
      return r ? json(200, { account: { login: r.owner } }) : json(404, {});
    }
    if (p === '/installation/repositories')
      return json(200, { repositories: Object.entries(repos).filter(([, r]) => r.installation === inst).map(([k]) => ({ full_name: k })) });
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
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(p))) {
      const r = repos[m[1].toLowerCase()];
      if (!r || (r.private && r.installation !== inst)) return json(404, {});
      return json(200, (r.pulls ?? []).map((x) => ({ number: x.number, title: x.title, merged_at: x.merged_at, updated_at: x.merged_at, user: { login: x.login ?? 'someone', type: x.type ?? 'User' } })));
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)$/.exec(p))) {
      const k = m[1].toLowerCase();
      const r = repos[k];
      if (!r || (r.private && r.installation !== inst)) return json(404, {});
      return json(200, { id: r.id, full_name: k, private: Boolean(r.private), fork: Boolean(r.fork), is_template: Boolean(r.template), owner: { login: r.owner, type: r.ownerType ?? 'User' } });
    }
    return json(404, { message: 'fake: not routed' });
  }) as FakeGitHub;
  f.calls = calls;
  f.repos = repos;
  return f;
}
