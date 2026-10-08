import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import {
  ForkCheckError,
  GitHubError,
  MatchProjectsInput,
  SCORE_LIMIT,
  cachedRepoAddresses,
  cachedRepoChains,
  droppedRepo,
  matchProjects,
  unoriginal,
  repoCodeFacts,
  repoKey,
  type MatchDeps,
} from './match-projects';
import { KNOWN_TOKEN_ADDRESSES, SIGNAL_WORDS, UNCHECKED_NOTE, type ProgramFacts } from './match';
import { LIST_PROGRAMS_DESCRIPTION } from './mcp';
import { presentFirstMessage } from './present';

/** Stubs global fetch with GitHub answers by path (query kept); records every path asked. */
async function withGitHub<T>(answers: Record<string, () => Response>, run: (calls: string[]) => Promise<T>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const path = u.pathname + u.search;
    calls.push(path);
    const answer = answers[path];
    return answer ? answer() : new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const repo = (extra: Record<string, unknown> = {}) =>
  json({ full_name: 'bob/kit', default_branch: 'main', fork: false, private: false, visibility: 'public', ...extra });
const COMMITS = '/repos/bob/kit/commits?per_page=1';
const COMPARE = '/repos/acme/kit/compare/dev...bob:main?per_page=1';
const fork = repo({ fork: true, parent: { full_name: 'acme/kit', default_branch: 'dev' } });

test('repoCodeFacts: a public non-fork is two reads, no compare', async () => {
  await withGitHub({ '/repos/bob/kit': repo(), [COMMITS]: json([{ sha: 'a' }]) }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main' });
    assert.deepEqual(calls.sort(), ['/repos/bob/kit', COMMITS].sort());
  });
});

test('repoCodeFacts: a fork with commits is compared with its parent (per_page=1)', async () => {
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: json([{ sha: 'a' }]), [COMPARE]: json({ ahead_by: 3 }) }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: true, hasCommits: true, aheadOfParent: 3, defaultBranch: 'main' });
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1), COMPARE);
  });
});

test('repoCodeFacts: an empty repo (409) is no commits, and an empty fork is never compared', async () => {
  const empty = json({ message: 'Git Repository is empty.' }, 409);
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: empty }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: true, hasCommits: false, aheadOfParent: null, defaultBranch: 'main' });
    assert.equal(calls.length, 2);
  });
});

test('repoCodeFacts: a private repo the token can see is refused as "not found (or private)"', async () => {
  for (const extra of [{ private: true, visibility: 'private' }, { private: false, visibility: 'internal' }])
    await withGitHub({ '/repos/bob/kit': repo(extra), [COMMITS]: json([{ sha: 'a' }]) }, async () => {
      await assert.rejects(repoCodeFacts('bob/kit'), (err: unknown) =>
        err instanceof GitHubError && !(err instanceof ForkCheckError) && /not found \(or private\)/.test(err.message));
    });
  // A missing repo is the same "not found".
  await withGitHub({}, async () => {
    await assert.rejects(repoCodeFacts('bob/kit'), /not found \(or private\)/);
  });
});

test('repoCodeFacts: a failed compare is a ForkCheckError, never "not found (or private)" alone', async () => {
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: json([{ sha: 'a' }]) }, async () => {
    await assert.rejects(repoCodeFacts('bob/kit'), (err: unknown) => err instanceof ForkCheckError && err.status === 404);
  });
});

// Against the local database when configured.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test(
  'cachedRepoChains: mainnet evidence only (review fix round 1, item 2) — a testnet-only chain never counts as a fit; no row is null',
  dbTest,
  async () => {
    const full = `test/cached-chains-${process.pid}-${Date.now()}`;
    assert.equal(await cachedRepoChains(full), null, 'nothing cached yet');
    await sql()`
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES (
        ${full}, now(),
        ${sql().json({
          base: { mainnet: true, testnet: false, evidence: 'x' },
          avalanche: { mainnet: false, testnet: true, evidence: 'fuji only' },
        })},
        '{}')`;
    assert.deepEqual(await cachedRepoChains(full), ['base'], 'the Avalanche Fuji-only evidence never counts as a fit');
    // The latest row for this full name wins, same as the chains cache elsewhere.
    await sql()`
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES (
        ${full}, now() + interval '1 second',
        ${sql().json({ arc: { mainnet: true, testnet: false, evidence: 'y' } })},
        '{}')`;
    assert.deepEqual(await cachedRepoChains(full), ['arc']);
    await sql()`DELETE FROM github_repo_facts WHERE full_name = ${full}`;
  },
);

test('v2.9 A5: reportedUrl drops placeholders; local_repos carry up to 2 contracts', async () => {
  const { reportedUrl, reportedContracts, ReportedRepoInput } = await import('./match-projects');
  assert.equal(reportedUrl('example.com'), undefined);
  assert.equal(reportedUrl('https://127.0.0.1:3000'), undefined);
  assert.equal(reportedUrl('https://earnkit.com'), undefined);
  assert.equal(reportedUrl('tipjar.xyz'), 'https://tipjar.xyz');
  const a = `0x${'A'.repeat(40)}`;
  const b = `0x${'b'.repeat(40)}`;
  assert.deepEqual(reportedContracts([a, b, `0x${'c'.repeat(40)}`]), [a.toLowerCase(), b]);
  assert.deepEqual(reportedContracts(`deployed at ${b}`), [b]);
  assert.equal(reportedContracts('none'), undefined);
  assert.equal(reportedContracts(42), undefined);
  assert.deepEqual(ReportedRepoInput.parse({ name: 'tipjar', chains: [], contracts: [b] }).contracts, [b]);
});

// ---- v2.9 A1, A2: owned repos only, the real-product score, at most 8 scored ----

const T_NOW = new Date('2026-10-08T12:00:00Z');
const daysAgo = (n: number) => new Date(T_NOW.getTime() - n * 86_400_000).toISOString();
const ghRepo = (owner: string, name: string, extra: Record<string, unknown> = {}) => ({
  name, full_name: `${owner}/${name}`, html_url: `https://github.com/${owner}/${name}`, homepage: null,
  default_branch: 'main', created_at: daysAgo(100), pushed_at: daysAgo(5), fork: false, archived: false,
  owner: { login: owner }, description: null, topics: [], ...extra,
});
const baseProgram: ProgramFacts = {
  id: 'base-x', title: 'Base X', chains: ['base'], any_chain: false, existing_work: 'allowed', tag: null,
  starts_at: null, investment: false, min_product_score: 0,
};
const ADDR = '0x1111111111111111111111111111111111111111';
const README = `# Tipjar\n\n${'Tips for creators on Base, paid in USDC. '.repeat(60)}`;

/** Stubs global fetch (GitHub API and raw files) by host + path + query; records every call. */
async function withFetch<T>(answer: (u: URL) => Response | undefined, run: (calls: string[]) => Promise<T>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    calls.push(u.host + u.pathname + u.search);
    return answer(u) ?? new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const body = (b: unknown) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: 200 });

/** A repo's files: a README over 1.5 KB and a Base mainnet config naming one contract. */
function repoFiles(u: URL): Response | undefined {
  if (u.host === 'api.github.com' && /\/git\/trees\//.test(u.pathname))
    return body({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'hardhat.config.ts', type: 'blob', size: 100 }] });
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/README.md')) return body(README);
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/hardhat.config.ts')) return body(`chainId: 8453 // token ${ADDR}`);
  if (u.host === 'api.github.com' && /\/commits$/.test(u.pathname) && u.searchParams.has('author')) return body([{ sha: 'a' }]);
  return undefined;
}

/** In-memory caches and counted link and contract checks (Pre-flight P26). */
function checkDeps(o: { probeOk?: boolean } = {}) {
  const n = { probes: 0, getCodes: 0 };
  const store = new Map<string, { ok: boolean; checked_at: Date }>();
  const deps: MatchDeps = {
    now: T_NOW,
    cache: { load: async () => null, save: async () => {} },
    checks: {
      probe: async () => {
        n.probes++;
        if (!o.probeOk) throw new Error('down');
      },
      getCode: async () => {
        n.getCodes++;
        return '0x';
      },
      cache: { get: async (k) => store.get(k) ?? null, set: async (k, ok, now) => void store.set(k, { ok, checked_at: now }) },
    },
    programs: [baseProgram],
  };
  return { n, deps };
}

test('2.8 twenty qualifying repos: 8 scored, probes at most 5, getCode at most 6; a failed probe is deployed: false', async (t) => {
  const own = Array.from({ length: 20 }, (_, i) => ghRepo('alice', `app${i}`, { homepage: `https://app${i}.xyz`, pushed_at: daysAgo(i + 1) }));
  const { n, deps } = checkDeps();
  // The failed probes log one expected "[verify] live Error" line each; kept out of the output.
  const log = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = log;
  });
  // Each repo names its own contract, so no getCode answer is shared through the check cache.
  const ownConfig = (u: URL) => {
    const m = u.host === 'raw.githubusercontent.com' && u.pathname.match(/^\/alice\/app(\d+)\/main\/hardhat\.config\.ts$/);
    return m ? body(`chainId: 8453 // ${`0x${m[1].padStart(40, 'a')}`}`) : undefined;
  };
  await withFetch(
    (u) =>
      u.pathname === '/users/alice/repos'
        ? body(own)
        : u.pathname === '/search/commits'
          ? body({ items: [] })
          : (ownConfig(u) ?? repoFiles(u)),
    async (calls) => {
      const r = await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps);
      assert.equal(r.scored, SCORE_LIMIT);
      assert.equal(r.checked, 20);
      assert.equal(calls.filter((c) => c.includes('/git/trees/')).length, 8);
      assert.equal(calls.filter((c) => c.includes('/commits?author=')).length, 8);
      assert.equal(n.probes, 5);
      assert.equal(n.getCodes, 6);
      for (const f of r.fits) {
        assert.equal(f.live_verified, false);
        // Ruling G4: the 5 newest were probed and failed; the older ones were not checked (never "missing").
        const probed = ['app0', 'app1', 'app2', 'app3', 'app4'].includes(f.repo);
        assert.equal(f.product.missing.includes('deployed'), probed, f.key);
        assert.equal(f.product.unchecked?.includes('deployed') ?? false, !probed, f.key);
        assert.notEqual(f.verdicts[0].status, 'likely');
      }
      // The 8 most recently pushed.
      assert.deepEqual(r.fits.map((f) => f.key).sort(), own.slice(0, 8).map((x) => `alice/${x.name}`).sort());
    },
  );
});

test('2.9 (Review Focus 1) EarnKit kits, a one-commit contribution, a fork, a template, an archived repo and a tutorial: nothing fits, nothing read', async () => {
  const own = [
    ghRepo('alice', 'forked', { fork: true }),
    ghRepo('alice', 'tmpl', { is_template: true }),
    ghRepo('alice', 'old', { archived: true }),
    ghRepo('alice', 'todo-app'),
  ];
  const items = [
    ...Array.from({ length: 12 }, () => ({ repository: { full_name: 'earnkitai/chain-kits' } })),
    { repository: { full_name: 'acme/lib' } },
  ];
  const { deps } = checkDeps();
  await withFetch(
    (u) => (u.pathname === '/users/alice/repos' ? body(own) : u.pathname === '/search/commits' ? body({ items }) : repoFiles(u)),
    async (calls) => {
      const r = await matchProjects(
        MatchProjectsInput.parse({
          github_user: 'alice',
          local_repos: [{ name: 'starter', url: 'https://github.com/earnkitai/starter-agent-service', chains: ['base'] }],
        }),
        deps,
      );
      assert.deepEqual(r.fits, []);
      assert.equal(r.scored, 0);
      assert.equal(r.checked, 7);
      assert.deepEqual(calls.map((c) => c.split('?')[0]), ['api.github.com/users/alice/repos', 'api.github.com/search/commits']);
      const card = { id: 'base-x', title: 'Base X', summary: 'up to $5,000', tag: null, each_time: [], ends_at: null, builder_fields: 0 };
      const text = presentFirstMessage({
        alerts: [], campaigns: [], cards: [card], repos: r, githubGiven: true, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: T_NOW,
      });
      assert.match(text, /None of your 7 repos fits an open program yet\./);
      assert.doesNotMatch(text, /launch/i);
    },
  );
});

test('2.10 a repo owned by someone else counts only with 30% of its last 100 commits; at most 3 candidates are read', async () => {
  const run = async (mine: number) => {
    const items = Array.from({ length: 6 }, () => ({ repository: { full_name: 'acme/app' } }));
    const recent = Array.from({ length: 100 }, (_, i) => ({ sha: `${i}`, author: { login: i < mine ? 'Alice' : 'bob' } }));
    const { deps } = checkDeps({ probeOk: true });
    return withFetch(
      (u) =>
        u.pathname === '/users/alice/repos'
          ? body([])
          : u.pathname === '/search/commits'
            ? body({ items })
            : u.pathname === '/repos/acme/app'
              ? body(ghRepo('acme', 'app', { homepage: 'https://acme-app.xyz' }))
              : u.pathname === '/repos/acme/app/commits' && u.searchParams.get('per_page') === '100'
                ? body(recent)
                : repoFiles(u),
      async () => matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps),
    );
  };
  assert.deepEqual((await run(6)).fits, []);
  const kept = await run(40);
  assert.equal(kept.fits.length, 1);
  assert.equal(kept.fits[0].key, 'acme/app');
  assert.ok(!kept.fits[0].product.missing.includes('owned'));
  assert.equal(kept.fits[0].product.tier, 'product');

  // Five candidates with 5+ hits each: only 3 get the 100-commit read.
  const items = ['a', 'b', 'c', 'd', 'e'].flatMap((x) => Array.from({ length: 5 }, () => ({ repository: { full_name: `acme/${x}` } })));
  const { deps } = checkDeps();
  await withFetch(
    (u) =>
      u.pathname === '/users/alice/repos'
        ? body([])
        : u.pathname === '/search/commits'
          ? body({ items })
          : /^\/repos\/acme\/[a-e]$/.test(u.pathname)
            ? body(ghRepo('acme', u.pathname.split('/')[3]))
            : u.searchParams.get('per_page') === '100'
              ? body([])
              : undefined,
    async (calls) => {
      await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps);
      assert.equal(calls.filter((c) => /^api\.github\.com\/repos\/[^/]+\/[^/]+\/commits\?per_page=100$/.test(c)).length, 3);
    },
  );
});

test('2.11 one repo from GitHub and the local report: one fit, keyed owner/repo; the GitHub homepage wins', async () => {
  const local = [{ name: 'tipjar', url: 'https://github.com/Alice/TipJar.git', live_url: 'https://tipjar.xyz', chains: ['base'], last_commit_at: daysAgo(2) }];
  const run = (homepage: string | null) => {
    const { deps } = checkDeps({ probeOk: true });
    return withFetch(
      (u) =>
        u.pathname === '/users/alice/repos'
          ? body([ghRepo('alice', 'tipjar', { homepage })])
          : u.pathname === '/search/commits'
            ? body({ items: [] })
            : repoFiles(u),
      async () => matchProjects(MatchProjectsInput.parse({ github_user: 'alice', local_repos: local }), deps),
    );
  };
  const withHome = await run('https://tipjar.app');
  assert.equal(withHome.fits.length, 1);
  assert.equal(withHome.fits[0].key, 'alice/tipjar');
  assert.equal(withHome.fits[0].facts.homepage, 'https://tipjar.app');
  assert.equal(withHome.checked, 2);
  assert.equal(withHome.scored, 1);
  const noHome = await run(null);
  assert.equal(noHome.fits.length, 1);
  assert.equal(noHome.fits[0].facts.homepage, 'https://tipjar.xyz');
  assert.equal(noHome.fits[0].live_verified, true);
  assert.equal(repoKey({ url: 'https://github.com/Alice/TipJar.git', name: 'x' }), 'alice/tipjar');
  assert.equal(repoKey({ url: null, name: ' TipJar ' }), 'name:tipjar');
});

test('v2.9 P6, P4: the repo\'s own signals are cached per version; owned, active and deployed are read every call; file contracts feed entries', dbTest, async () => {
  const name = `cache${process.pid}${Date.now()}`;
  const pushed = daysAgo(3);
  await sql()`DELETE FROM github_repo_facts WHERE full_name = ${`alice/${name}`}`;
  const own = [ghRepo('alice', name, { homepage: 'https://tipjar.xyz', pushed_at: pushed })];
  const run = () => {
    const { deps } = checkDeps({ probeOk: true });
    delete deps.cache; // the real github_repo_facts cache
    return withFetch(
      (u) => (u.pathname === '/users/alice/repos' ? body(own) : u.pathname === '/search/commits' ? body({ items: [] }) : repoFiles(u)),
      async (calls) => ({ r: await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps), calls }),
    );
  };
  const first = await run();
  assert.equal(first.r.fits[0].product.tier, 'product');
  assert.equal(first.calls.filter((c) => c.includes('/git/trees/')).length, 1);
  const second = await run();
  assert.deepEqual(second.r.fits[0].product, first.r.fits[0].product);
  assert.equal(second.calls.filter((c) => c.includes('/git/trees/') || c.startsWith('raw.')).length, 0);
  assert.equal(second.calls.filter((c) => c.includes('/commits?author=')).length, 1);
  assert.deepEqual(await cachedRepoAddresses(`https://github.com/Alice/${name}`), [ADDR]);
  assert.deepEqual(await cachedRepoAddresses('https://gitlab.com/a/b'), []);
  await sql()`DELETE FROM github_repo_facts WHERE full_name = ${`alice/${name}`}`;
});

// ---- Ruling G3 ----

test('G3.1 a description flags only strong tutorial phrases; names keep the full pattern', () => {
  const r = (name: string, description: string | null) => ({ name, description, fork: false, topics: [] });
  assert.equal(unoriginal(r('tipjar', 'A tipjar demo on Base')), false);
  assert.equal(unoriginal(r('tipjar', 'An example of tips, with docs')), false);
  assert.equal(unoriginal(r('tipjar', 'Follow along with the course')), true);
  assert.equal(unoriginal(r('tipjar', 'Next.js starter kit')), true);
  assert.equal(unoriginal(r('tipjar-demo', null)), true);
});

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

test('G3.2 a repo whose only address is Base USDC is not deployed (no getCode spent on it)', async () => {
  const { n, deps } = checkDeps({ probeOk: true });
  await withFetch(
    (u) => {
      if (u.pathname === '/users/alice/repos') return body([ghRepo('alice', 'tipjar')]);
      if (u.pathname === '/search/commits') return body({ items: [] });
      if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/hardhat.config.ts'))
        return body(`chainId: 8453 // usdc 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
      return repoFiles(u);
    },
    async () => {
      const r = await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps);
      assert.ok(r.fits[0].product.missing.includes('deployed'));
      assert.equal(n.getCodes, 0);
      assert.ok(!r.fits[0].facts.homepage);
    },
  );
  assert.equal(KNOWN_TOKEN_ADDRESSES.has(USDC_BASE), true);
});

test('G3.3 a local repo without last_commit_at counts as active; the instruction asks for it', async () => {
  const { deps } = checkDeps({ probeOk: true });
  const r = await matchProjects(
    MatchProjectsInput.parse({ local_repos: [{ name: 'tipjar', chains: ['base'], live_url: 'https://tipjar.xyz' }] }),
    deps,
  );
  assert.equal(r.fits.length, 1);
  assert.ok(!r.fits[0].product.missing.includes('active'));
  assert.ok(!r.fits[0].product.missing.includes('young'));
  assert.equal(r.fits[0].product.tier, 'product');
  const old = await matchProjects(
    MatchProjectsInput.parse({ local_repos: [{ name: 'tipjar', chains: ['base'], live_url: 'https://tipjar.xyz', last_commit_at: daysAgo(400) }] }),
    checkDeps({ probeOk: true }).deps,
  );
  assert.ok(old.fits[0].product.missing.includes('active'));
  assert.match(LIST_PROGRAMS_DESCRIPTION, /last_commit_at/);
});

test('G3.4 a repo the builder names skips the 365-day rule; a named fork or template is still dropped', async () => {
  const stale = { created_at: daysAgo(900), pushed_at: daysAgo(500) };
  const repos: Record<string, unknown> = {
    '/repos/alice/old': ghRepo('alice', 'old', stale),
    '/repos/alice/forked': ghRepo('alice', 'forked', { fork: true }),
    '/repos/alice/tmpl': ghRepo('alice', 'tmpl', { is_template: true }),
  };
  const { deps } = checkDeps({ probeOk: true });
  await withFetch(
    (u) => (repos[u.pathname] ? body(repos[u.pathname]) : repoFiles(u)),
    async () => {
      const r = await matchProjects(MatchProjectsInput.parse({ repos: ['alice/old', 'alice/forked', 'alice/tmpl'] }), deps);
      assert.equal(r.checked, 3);
      assert.equal(r.scored, 1);
      assert.deepEqual(r.fits.map((f) => f.key), ['alice/old']);
    },
  );
  assert.equal(droppedRepo(ghRepo('alice', 'old', stale) as never, T_NOW), true);
  assert.equal(droppedRepo(ghRepo('alice', 'old', stale) as never, T_NOW, { named: true }), false);
});

// ---- Ruling G4 (fix round 1) ----

test('G4 I1: a fork dropped from the GitHub list stays dropped when the same repo comes as a local report', async () => {
  const { deps } = checkDeps({ probeOk: true });
  await withFetch(
    (u) =>
      u.pathname === '/users/alice/repos'
        ? body([ghRepo('alice', 'forked', { fork: true })])
        : u.pathname === '/search/commits'
          ? body({ items: [] })
          : repoFiles(u),
    async () => {
      const r = await matchProjects(
        MatchProjectsInput.parse({
          github_user: 'alice',
          local_repos: [{ name: 'forked', url: 'https://github.com/alice/forked', live_url: 'https://forked.xyz', chains: ['base'] }],
        }),
        deps,
      );
      assert.deepEqual(r.fits, []);
      assert.equal(r.checked, 2);
    },
  );
});

test('G4 I2: the probes go to the 5 newest repos; the older 3 are "not checked yet", never missing; the next call checks them', async () => {
  const own = Array.from({ length: 8 }, (_, i) => ghRepo('alice', `app${i}`, { homepage: `https://app${i}.xyz`, pushed_at: daysAgo(i + 1) }));
  const { n, deps } = checkDeps({ probeOk: true });
  const run = () =>
    withFetch(
      (u) =>
        u.pathname === '/users/alice/repos' ? body(own) : u.pathname === '/search/commits' ? body({ items: [] }) : repoFiles(u),
      async () => matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps),
    );
  const first = await run();
  const byRepo = new Map(first.fits.map((f) => [f.repo, f]));
  for (let i = 0; i < 8; i++) {
    const f = byRepo.get(`app${i}`)!;
    assert.equal(f.live_verified, i < 5, f.repo);
    assert.ok(!f.product.missing.includes('deployed'), f.repo);
    for (const v of f.verdicts) assert.notEqual(v.note, SIGNAL_WORDS.deployed, f.repo);
    if (i >= 5) {
      assert.deepEqual(f.product.unchecked, ['deployed']);
      assert.equal(f.product.tier, 'project');
      assert.equal(f.verdicts[0].note, UNCHECKED_NOTE);
    }
  }
  assert.equal(n.probes, 5);
  // The next call: the 5 passes are cached, so the older 3 get the probes.
  const second = await run();
  assert.equal(n.probes, 8);
  assert.ok(second.fits.every((f) => f.live_verified && f.product.tier === 'product'));
});

test('G4 I3: a local repo in another owner\'s org gets the 5-commit, 30% check with github_user given', async () => {
  const run = (mine: number) => {
    const recent = Array.from({ length: 100 }, (_, i) => ({ sha: `${i}`, author: { login: i < mine ? 'alice' : 'bob' } }));
    const { deps } = checkDeps({ probeOk: true });
    return withFetch(
      (u) =>
        u.pathname === '/users/alice/repos'
          ? body([])
          : u.pathname === '/search/commits'
            ? body({ items: [] })
            : u.pathname === '/repos/acme-labs/app/commits' && u.searchParams.get('per_page') === '100'
              ? body(recent)
              : undefined,
      async (calls) => ({
        r: await matchProjects(
          MatchProjectsInput.parse({
            github_user: 'alice',
            local_repos: [{ name: 'app', url: 'https://github.com/acme-labs/app', live_url: 'https://acme-app.xyz', chains: ['base'] }],
          }),
          deps,
        ),
        calls,
      }),
    );
  };
  const pass = await run(40);
  assert.equal(pass.r.fits[0].product.tier, 'product');
  assert.ok(!pass.r.fits[0].product.missing.includes('owned'));
  assert.equal(pass.calls.filter((c) => c.includes('/repos/acme-labs/app/commits?per_page=100')).length, 1);
  const fail = await run(6);
  assert.ok(fail.r.fits[0].product.missing.includes('owned'));
  assert.notEqual(fail.r.fits[0].product.tier, 'product');
});

// ---- Ruling G5 (fix round 2) ----

test('G5 I2: the checks run in parallel: 5 links with a 50 ms probe finish well under 250 ms', async () => {
  const own = Array.from({ length: 5 }, (_, i) => ghRepo('alice', `p${i}`, { homepage: `https://p${i}.xyz`, pushed_at: daysAgo(i + 1) }));
  const { n, deps } = checkDeps({ probeOk: true });
  deps.checks!.probe = async () => {
    n.probes++;
    await new Promise((r) => setTimeout(r, 50));
  };
  await withFetch(
    (u) => (u.pathname === '/users/alice/repos' ? body(own) : u.pathname === '/search/commits' ? body({ items: [] }) : repoFiles(u)),
    async () => {
      const t0 = Date.now();
      const r = await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps);
      const ms = Date.now() - t0;
      assert.equal(n.probes, 5);
      assert.ok(r.fits.every((f) => f.live_verified));
      assert.ok(ms < 200, `took ${ms} ms`);
    },
  );
});

test('G5 I3: a local repo in an org GitHub can\'t read (private or missing) is not owned with github_user given', async () => {
  const { deps } = checkDeps({ probeOk: true });
  const log = console.error;
  console.error = () => {}; // the failed read logs "[match] contribution read failed: GitHubError"
  try {
    await withFetch(
      (u) => (u.pathname === '/users/alice/repos' ? body([]) : u.pathname === '/search/commits' ? body({ items: [] }) : undefined),
      async (calls) => {
        const r = await matchProjects(
          MatchProjectsInput.parse({
            github_user: 'alice',
            local_repos: [{ name: 'app', url: 'https://github.com/ghost-org/app', live_url: 'https://ghost-app.xyz', chains: ['base'] }],
          }),
          deps,
        );
        assert.equal(calls.filter((c) => c.includes('/repos/ghost-org/app/commits?per_page=100')).length, 1);
        assert.ok(r.fits[0].product.missing.includes('owned'));
        assert.notEqual(r.fits[0].product.tier, 'product');
      },
    );
  } finally {
    console.error = log;
  }
});

// ---- v2.9 A3: the builder's statements, applied before the checks (Pre-flight P15) ----

test('3.P15 a live link the builder told EarnKit is probed like a homepage; a passing probe makes it count', async () => {
  const said = { mainnet: [], testnet: [], live_url: 'https://tipjar.xyz', has_users: null, not_mine: false };
  const local = { name: 'tipjar', chains: ['base'] };
  const { n, deps } = checkDeps({ probeOk: true });
  const r = await matchProjects(MatchProjectsInput.parse({ local_repos: [local], said: { 'name:tipjar': said } }), deps);
  assert.equal(n.probes, 1, 'the claimed link was probed');
  assert.equal(r.fits[0].live_verified, true);
  assert.equal(r.fits[0].product.tier, 'product');
  assert.equal(r.fits[0].verdicts[0].status, 'likely');
  // A link that doesn't load stays a claim: "confirm: live link", never likely.
  const failing = checkDeps();
  const log = console.error;
  console.error = () => {};
  try {
    const down = await matchProjects(MatchProjectsInput.parse({ local_repos: [local], said: { 'name:tipjar': said } }), failing.deps);
    assert.equal(failing.n.probes, 1);
    assert.equal(down.fits[0].verdicts[0].status, 'after_step');
  } finally {
    console.error = log;
  }
});

test('3.P15b a repo the builder said is not theirs is never scored; testnet only clears a reported mainnet', async () => {
  const { deps } = checkDeps({ probeOk: true });
  const local = [
    { name: 'tipjar', chains: ['base'], live_url: 'https://tipjar.xyz' },
    { name: 'theirs', chains: ['base'], live_url: 'https://theirs.xyz' },
  ];
  const r = await matchProjects(
    MatchProjectsInput.parse({
      local_repos: local,
      said: {
        'name:theirs': { mainnet: [], testnet: [], live_url: null, has_users: null, not_mine: true },
        'name:tipjar': { mainnet: [], testnet: ['base'], live_url: null, has_users: null, not_mine: false },
      },
    }),
    deps,
  );
  assert.equal(r.checked, 2);
  assert.equal(r.scored, 1);
  assert.deepEqual(r.fits.map((f) => f.repo), ['tipjar']);
  assert.deepEqual(r.fits[0].verdicts[0].missing, ['mainnet_deploy']);
  assert.equal(r.fits[0].verdicts[0].status, 'after_step');
});

test('3.F1 a claimed Monad mainnet is verified by a contract with code there, even when the live link loads', async () => {
  const monadProgram: ProgramFacts = { ...baseProgram, id: 'monad-x', title: 'Monad X', chains: ['monad'] };
  const said = { 'name:tipjar': { mainnet: ['monad' as const], testnet: [], live_url: null, has_users: null, not_mine: false } };
  const local = { name: 'tipjar', chains: [], live_url: 'https://tipjar.xyz', contracts: [ADDR] };
  const run = async (code: string) => {
    const { n, deps } = checkDeps({ probeOk: true });
    const asked: string[] = [];
    deps.checks!.getCode = async (rpc) => {
      n.getCodes++;
      asked.push(rpc);
      return code;
    };
    deps.programs = [monadProgram];
    const r = await matchProjects(MatchProjectsInput.parse({ local_repos: [local], said }), deps);
    return { r, n, asked };
  };
  const deployed = await run('0x6080');
  assert.deepEqual(deployed.asked, ['https://rpc.monad.xyz'], 'one getCode on the claimed chain, though the link loaded');
  assert.equal(deployed.r.fits[0].verdicts[0].status, 'likely');
  assert.deepEqual(deployed.r.fits[0].facts.claims, []);
  const empty = await run('0x');
  assert.equal(empty.r.fits[0].verdicts[0].status, 'after_step');
  assert.equal(empty.r.fits[0].verdicts[0].note, 'confirm: mainnet');
});
