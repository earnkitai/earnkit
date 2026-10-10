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
  starterRepo,
  type MatchDeps,
} from './match-projects';
import { KNOWN_TOKEN_ADDRESSES, SIGNAL_WORDS, UNCHECKED_NOTE, type ProgramFacts } from './match';
import { FIND_DESCRIPTION } from './mcp';
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
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main', public: true });
    assert.deepEqual(calls.sort(), ['/repos/bob/kit', COMMITS].sort());
  });
});

test('repoCodeFacts: a fork with commits is compared with its parent (per_page=1)', async () => {
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: json([{ sha: 'a' }]), [COMPARE]: json({ ahead_by: 3 }) }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: true, hasCommits: true, aheadOfParent: 3, defaultBranch: 'main', public: true });
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1), COMPARE);
  });
});

test('repoCodeFacts: an empty repo (409) is no commits, and an empty fork is never compared', async () => {
  const empty = json({ message: 'Git Repository is empty.' }, 409);
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: empty }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: true, hasCommits: false, aheadOfParent: null, defaultBranch: 'main', public: true });
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
  'cachedRepoChains: credited mainnets only (review fix round 1, item 2; v2.10 item 9) — a testnet-only or mention-only chain never counts as a fit; no row is null',
  dbTest,
  async () => {
    const full = `test/cached-chains-${process.pid}-${Date.now()}`;
    assert.equal(await cachedRepoChains(full), null, 'nothing cached yet');
    await sql()`
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES (
        ${full}, now(),
        ${sql().json({
          base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' },
          avalanche: { mainnet: false, testnet: true, evidence: 'fuji only', basis: 'mention' },
          // v2.10 R6: a v2.9 row without basis reads as a mention.
          monad: { mainnet: true, testnet: false, evidence: 'imports monad' },
          tempo: { mainnet: true, testnet: false, evidence: 'rpc host', basis: 'mention' },
        })},
        '{}')`;
    assert.deepEqual(await cachedRepoChains(full), ['base'], 'the Avalanche Fuji-only evidence never counts as a fit');
    // The latest row for this full name wins, same as the chains cache elsewhere.
    await sql()`
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES (
        ${full}, now() + interval '1 second',
        ${sql().json({ arc: { mainnet: true, testnet: false, evidence: 'y', basis: 'deployed' } })},
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

/** A repo's files: a README over 1.5 KB and a Base mainnet network entry (v2.10 Ruling H2) naming one contract. */
function repoFiles(u: URL): Response | undefined {
  if (u.host === 'api.github.com' && /\/git\/trees\//.test(u.pathname))
    return body({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'hardhat.config.ts', type: 'blob', size: 100 }] });
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/README.md')) return body(README);
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/hardhat.config.ts')) return body(`networks: { base: { url: 'https://mainnet.base.org', chainId: 8453 } } // token ${ADDR}`);
  // v2.10 item 8: the 90-day commits read (any author on an owned repo).
  if (u.host === 'api.github.com' && /\/commits$/.test(u.pathname) && u.searchParams.has('since')) return body([{ sha: 'a' }]);
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
      // v2.10 item 6: no Blockscout read leaves the test (a test about counts sets its own).
      blockscout: async () => ({ transactions_count: '0' }),
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
    return m ? body(`networks: { base: { chainId: 8453 } } // ${`0x${m[1].padStart(40, 'a')}`}`) : undefined;
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
      // v2.10 item 8: one 90-day commits read per scored repo, by any author (owned repos).
      assert.equal(calls.filter((c) => c.includes('/commits?since=')).length, 8);
      assert.equal(calls.filter((c) => c.includes('author=')).length, 0);
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

test('2.9 (Review Focus 1) EarnKit kits, a one-commit contribution, a fork, a template and an archived repo: nothing fits, nothing read', async () => {
  // Ruling G15: a tutorial-like name is scored (G15 I2 below), so none is listed here.
  const own = [
    ghRepo('alice', 'forked', { fork: true }),
    ghRepo('alice', 'tmpl', { is_template: true }),
    ghRepo('alice', 'old', { archived: true }),
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
      assert.equal(r.checked, 6);
      assert.deepEqual(calls.map((c) => c.split('?')[0]), ['api.github.com/users/alice/repos', 'api.github.com/search/commits']);
      const card = { id: 'base-x', title: 'Base X', summary: 'up to $5,000', tag: null, each_time: [], ends_at: null, builder_fields: 0 };
      const text = presentFirstMessage({
        more: true, // v2.10 item 2: the v2.9 tables are behind "show more"
        alerts: [], campaigns: [], cards: [card], repos: r, githubGiven: true, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: T_NOW,
      });
      assert.match(text, /None of your 6 repos fits an open program yet\./);
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
  assert.equal(second.calls.filter((c) => c.includes('/commits?since=')).length, 1);
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
        return body(`networks: { base: { chainId: 8453 } } // usdc 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
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
  assert.match(FIND_DESCRIPTION, /last_commit_at/);
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
        // v2.10.1 B2: still not owned (never a product on polish alone), but GitHub couldn't say, so
        // ownership is unchecked: never named "not your repo".
        assert.ok(!r.fits[0].product.missing.includes('owned'));
        assert.deepEqual(r.fits[0].product.unchecked, ['readme', 'owned']);
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
  // v2.10 Pre-flight P8: the agent-reported Base mainnet is a claim, so the row waits on it alone.
  assert.equal(r.fits[0].verdicts[0].status, 'after_step');
  assert.equal(r.fits[0].verdicts[0].note, 'confirm: mainnet');
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

// ---- Ruling G15 (Part 1 final fix wave) ----

test('G15 I1: a getCode that throws is "not checked yet": no cached "no code", never named missing; the next call deploys it', async (t) => {
  const log = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = log;
  });
  const { n, deps } = checkDeps();
  deps.checks!.getCode = async () => {
    n.getCodes++;
    throw new Error('HTTP request failed. Status: 429');
  };
  const input = MatchProjectsInput.parse({ local_repos: [{ name: 'tipjar', chains: ['base'], contracts: [ADDR] }] });
  const first = await matchProjects(input, deps);
  assert.equal(n.getCodes, 1);
  const p = first.fits[0].product;
  assert.ok(!p.missing.includes('deployed'), 'an RPC error is never "no live site or contract found"');
  assert.ok(p.unchecked?.includes('deployed'));
  assert.notEqual(first.fits[0].verdicts[0].note, SIGNAL_WORDS.deployed);
  // Nothing cached: the next call checks again, and a real answer makes it a product.
  deps.checks!.getCode = async () => (n.getCodes++, '0x6080');
  const second = await matchProjects(input, deps);
  assert.equal(n.getCodes, 2);
  assert.equal(second.fits[0].product.tier, 'product');
  assert.ok(!second.fits[0].product.missing.includes('deployed'));
});

test('G15 I2: tutorial-like names and topics are scored (they only lose original); a docs repo or a COVID tracker never gets an a16z row', async () => {
  const a16z: ProgramFacts = { ...baseProgram, id: 'a16z', title: 'a16z speedrun', chains: [], any_chain: true, investment: true, min_product_score: 5 };
  const names = ['arc-pay-demo', 'doc-signer', 'exercise-tracker', 'uniswap-clone'];
  const own = [
    ...names.map((n, i) => ghRepo('alice', n, { homepage: `https://${n}.xyz`, pushed_at: daysAgo(i + 1) })),
    ghRepo('alice', 'tipjar', { homepage: 'https://tipjar.xyz', topics: ['demo'], pushed_at: daysAgo(5) }),
    // The newest three get the probes (5 per call), so they are deployed products.
    ghRepo('alice', 'docs', { homepage: 'https://docs-alice.xyz', pushed_at: daysAgo(0.2) }),
    ghRepo('alice', 'covid-19-tracker', { homepage: 'https://covid-alice.xyz', pushed_at: daysAgo(0.3) }),
    ghRepo('alice', 'paylink', { homepage: 'https://paylink.xyz', pushed_at: daysAgo(0.1) }),
  ];
  const { deps } = checkDeps({ probeOk: true });
  deps.programs = [baseProgram, a16z];
  await withFetch(
    (u) => (u.pathname === '/users/alice/repos' ? body(own) : u.pathname === '/search/commits' ? body({ items: [] }) : repoFiles(u)),
    async () => {
      const r = await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps);
      assert.equal(r.scored, 8);
      const fit = (repo: string) => r.fits.find((f) => f.repo === repo);
      for (const repo of [...names, 'tipjar', 'docs', 'covid-19-tracker']) {
        const f = fit(repo);
        assert.ok(f, `${repo} gets a row`);
        assert.ok(f.product.missing.includes('original'), repo);
        assert.ok(f.verdicts.some((v) => v.program_id === 'base-x'), `${repo} matches Base X`);
        assert.ok(!f.verdicts.some((v) => v.program_id === 'a16z'), `${repo} never gets an a16z row`);
      }
      assert.equal(fit('docs')!.product.tier, 'product');
      assert.equal(fit('covid-19-tracker')!.product.tier, 'product');
      // The control: an original product still gets its a16z row.
      assert.ok(fit('paylink')!.verdicts.some((v) => v.program_id === 'a16z'));
    },
  );
  for (const name of [...names, 'docs']) assert.equal(droppedRepo(ghRepo('alice', name) as never, T_NOW), false, name);
  assert.equal(droppedRepo(ghRepo('alice', 'tipjar', { topics: ['demo'] }) as never, T_NOW), false);
  assert.equal(droppedRepo(ghRepo('earnkitai', 'chain-kits') as never, T_NOW), true);
});

test('G15 I2: a tutorial-like repo named explicitly or reported locally is scored too', async () => {
  const { deps } = checkDeps({ probeOk: true });
  await withFetch(
    (u) => (u.pathname === '/repos/alice/arc-pay-demo' ? body(ghRepo('alice', 'arc-pay-demo')) : repoFiles(u)),
    async () => {
      const named = await matchProjects(MatchProjectsInput.parse({ repos: ['alice/arc-pay-demo'] }), deps);
      assert.deepEqual(named.fits.map((f) => f.key), ['alice/arc-pay-demo']);
    },
  );
  const local = await matchProjects(
    MatchProjectsInput.parse({ local_repos: [{ name: 'uniswap-clone', chains: ['base'], live_url: 'https://uniswap-clone.xyz' }] }),
    checkDeps({ probeOk: true }).deps,
  );
  assert.equal(local.fits.length, 1);
  // Review M9: a local repo's README is never read, so it is never the row's note.
  assert.ok(!local.fits[0].product.missing.includes('readme'));
  assert.equal(local.fits[0].verdicts[0].note, SIGNAL_WORDS.original);
});

// ---- v2.10 item 8: commits by any author count toward activity ----

const DAY_IN_MS = 86_400_000;
const SINCE_90 = new Date(T_NOW.getTime() - 90 * DAY_IN_MS).toISOString();
/** One owned repo of bob's, pushed `pushedDaysAgo`, whose 90-day commits read answers `commits` (null: a 404). */
async function ownedRun(commits: unknown[] | null, pushedDaysAgo = 0) {
  const { deps } = checkDeps({ probeOk: true });
  return withFetch(
    (u) =>
      u.pathname === '/users/bob/repos'
        ? body([ghRepo('bob', 'kit', { homepage: 'https://kit.xyz', pushed_at: daysAgo(pushedDaysAgo) })])
        : u.pathname === '/search/commits'
          ? body({ items: [] })
          : u.pathname === '/repos/bob/kit/commits' && u.searchParams.get('since') === SINCE_90
            ? (commits ? body(commits) : new Response('{"message":"Not Found"}', { status: 404 }))
            : repoFiles(u),
    async (calls) => ({ r: await matchProjects(MatchProjectsInput.parse({ github_user: 'bob' }), deps), calls }),
  );
}
const unlinked = (n: number) => Array.from({ length: n }, (_, i) => ({ sha: `${i}`, author: null, commit: { author: { email: 'me@laptop.local' } } }));
const commitReads = (calls: string[], repo: string) => calls.filter((c) => c.startsWith(`api.github.com/repos/${repo}/commits?since=`));

test('1.6 an owned repo with 3 commits by an unlinked email is active: one commits read, no author= (and 1.9: commits_90d is 3)', async () => {
  const { r, calls } = await ownedRun(unlinked(3));
  const fit = r.fits.find((f) => f.key === 'bob/kit')!;
  assert.ok(!fit.product.missing.includes('active'));
  const reads = commitReads(calls, 'bob/kit');
  assert.equal(reads.length, 1);
  assert.equal(reads[0], `api.github.com/repos/bob/kit/commits?since=${SINCE_90}&per_page=100`);
  assert.ok(!reads[0].includes('author='));
  assert.equal(fit.facts.commits_90d, 3);
});

test('1.7 an empty commits read with a push today is active (the fallback runs on an empty read, not only on an error)', async () => {
  const { r } = await ownedRun([], 0);
  const fit = r.fits.find((f) => f.key === 'bob/kit')!;
  assert.ok(!fit.product.missing.includes('active'));
  assert.equal(fit.facts.commits_90d, 0);
  // An empty read with an old push is not active; a failed read is null, never 0, and falls back to the push.
  const stale = await ownedRun([], 200);
  assert.ok(stale.r.fits.find((f) => f.key === 'bob/kit')!.product.missing.includes('active'));
  const failed = (await ownedRun(null, 0)).r.fits.find((f) => f.key === 'bob/kit')!;
  assert.equal(failed.facts.commits_90d, null);
  assert.ok(!failed.product.missing.includes('active'));
});

test('1.8 a repo someone else owns, kept by the contribution rule, reads only the builder\'s commits: author=alice, one read', async () => {
  const items = Array.from({ length: 6 }, () => ({ repository: { full_name: 'acme/app' } }));
  const recent = Array.from({ length: 100 }, (_, i) => ({ sha: `${i}`, author: { login: i < 40 ? 'alice' : 'bob' } }));
  const { deps } = checkDeps({ probeOk: true });
  const { r, calls } = await withFetch(
    (u) =>
      u.pathname === '/users/alice/repos'
        ? body([])
        : u.pathname === '/search/commits'
          ? body({ items })
          : u.pathname === '/repos/acme/app'
            ? body(ghRepo('acme', 'app', { homepage: 'https://acme-app.xyz' }))
            : u.pathname === '/repos/acme/app/commits' && u.searchParams.get('per_page') === '100'
              ? body(u.searchParams.has('since') ? recent.slice(0, 7) : recent)
              : repoFiles(u),
    async (calls) => ({ r: await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps), calls }),
  );
  assert.equal(r.fits[0].key, 'acme/app');
  const reads = commitReads(calls, 'acme/app');
  assert.deepEqual(reads, [`api.github.com/repos/acme/app/commits?since=${SINCE_90}&per_page=100&author=alice`]);
  assert.equal(r.fits[0].facts.commits_90d, 7);
});

test('1.9 commits_90d is the count read, capped at 100', async () => {
  const { r } = await ownedRun(unlinked(120));
  assert.equal(r.fits.find((f) => f.key === 'bob/kit')!.facts.commits_90d, 100);
});

// ---- v2.10 Ruling H1 (c3): on a repo someone else owns, only the builder's own commits ----

test('H1 c3: a contribution repo with no builder commits in 90 days is not active, even pushed today; with one it is', async () => {
  const run = async (own: unknown[] | null) => {
    const items = Array.from({ length: 6 }, () => ({ repository: { full_name: 'acme/app' } }));
    const recent = Array.from({ length: 100 }, (_, i) => ({ sha: `${i}`, author: { login: i < 40 ? 'alice' : 'bob' } }));
    const { deps } = checkDeps({ probeOk: true });
    return withFetch(
      (u) =>
        u.pathname === '/users/alice/repos'
          ? body([])
          : u.pathname === '/search/commits'
            ? body({ items })
            : u.pathname === '/repos/acme/app'
              ? body(ghRepo('acme', 'app', { homepage: 'https://acme-app.xyz', pushed_at: daysAgo(0) }))
              : u.pathname === '/repos/acme/app/commits' && u.searchParams.has('since')
                ? own
                  ? body(own)
                  : new Response('{"message":"Server Error"}', { status: 500 })
                : u.pathname === '/repos/acme/app/commits' && u.searchParams.get('per_page') === '100'
                  ? body(recent)
                  : repoFiles(u),
      async () => (await matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps)).fits.find((f) => f.key === 'acme/app'),
    );
  };
  for (const own of [[], null]) {
    const fit = await run(own);
    assert.ok(fit, JSON.stringify(own));
    assert.ok(fit.product.missing.includes('active'), `no pushed_at fallback (${JSON.stringify(own)})`);
  }
  assert.ok(!(await run([{ sha: 'a', author: { login: 'alice' } }]))!.product.missing.includes('active'));
});

// ---- v2.10 item 9 (Task 1 review): a mention becomes deployed through getCode ----

test('Task 1 review: a wagmi-only repo is "deploy to Base first" until its contract has code on Base; then deployed and likely', async () => {
  const run = async (code: string) => {
    const { n, deps } = checkDeps({ probeOk: true });
    deps.checks!.getCode = async () => {
      n.getCodes++;
      return code;
    };
    const r = await withFetch(
      (u) =>
        u.pathname === '/users/bob/repos'
          ? body([ghRepo('bob', 'tipjar', { homepage: 'https://tipjar.xyz', pushed_at: daysAgo(1) })])
          : u.pathname === '/search/commits'
            ? body({ items: [] })
            : u.host === 'api.github.com' && /\/git\/trees\//.test(u.pathname)
              ? body({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'src/wagmi.ts', type: 'blob', size: 100 }] })
              : u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/src/wagmi.ts')
                ? body(`import { base } from 'wagmi/chains'\nexport const TIPJAR = '${ADDR}'`)
                : repoFiles(u),
      async () => matchProjects(MatchProjectsInput.parse({ github_user: 'bob' }), deps),
    );
    return { fit: r.fits.find((f) => f.key === 'bob/tipjar')!, n };
  };
  const empty = await run('0x');
  assert.equal(empty.n.getCodes, 1, 'the mention chain is checked though the live link loaded');
  assert.equal(empty.fit.facts.chains.base!.basis, 'mention');
  assert.equal(empty.fit.verdicts[0].note, 'deploy to Base first');
  assert.deepEqual(empty.fit.chains, []);
  const deployed = await run('0x6080');
  assert.equal(deployed.fit.facts.chains.base!.basis, 'deployed');
  assert.equal(deployed.fit.verdicts[0].status, 'likely');
  assert.deepEqual(deployed.fit.chains, ['base']);
});

// ---- v2.10 item 6: traction, Blockscout budget, starters ----

test('3.5 five Base repos with code: at most 2 Blockscout reads (LIST_BUDGET.txCounts), newest first; a contract with no code gets none', async (t) => {
  const log = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = log;
  });
  const own = Array.from({ length: 6 }, (_, i) => ghRepo('alice', `app${i}`, { pushed_at: daysAgo(i + 1) }));
  const addr = (i: number) => `0x${String(i).padStart(40, 'a')}`;
  const ownConfig = (u: URL) => {
    const m = u.host === 'raw.githubusercontent.com' && u.pathname.match(/^\/alice\/app(\d+)\/main\/hardhat\.config\.ts$/);
    return m ? body(`networks: { base: { chainId: 8453 } } // ${addr(Number(m[1]))}`) : undefined;
  };
  const { deps } = checkDeps();
  // app5 (the oldest) has no code; the others do.
  deps.checks!.getCode = async (_rpc, a) => (a === addr(5) ? '0x' : '0x6080');
  const read: string[] = [];
  deps.checks!.blockscout = async (url) => (read.push(url), { transactions_count: '75' });
  const r = await withFetch(
    (u) => (u.pathname === '/users/alice/repos' ? body(own) : u.pathname === '/search/commits' ? body({ items: [] }) : (ownConfig(u) ?? repoFiles(u))),
    async () => matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps),
  );
  assert.equal(read.length, 2);
  assert.deepEqual(read, [0, 1].map((i) => `https://base.blockscout.com/api/v2/addresses/${addr(i)}/counters`));
  const fit = (k: string) => r.fits.find((f) => f.key === `alice/${k}`)!;
  assert.equal(fit('app0').product.traction, 3 * 2 + 1, 'tx 75 (band 2) and commits 1 (band 1), no live link');
  assert.equal(fit('app2').product.traction, 1, 'no slot left: tx unknown, scored 0');
  assert.ok(!read.some((u) => u.includes(addr(5))), 'no read for a contract with no code');
});

test('3.5b a live Base product: its contract is checked for code though the link loads, and its count lifts it to good odds', async () => {
  const { n, deps } = checkDeps({ probeOk: true });
  deps.checks!.getCode = async () => (n.getCodes++, '0x6080');
  deps.checks!.blockscout = async () => ({ transactions_count: '120' });
  const r = await withFetch(
    (u) =>
      u.pathname === '/users/bob/repos'
        ? body([ghRepo('bob', 'tipjar', { homepage: 'https://tipjar.xyz', pushed_at: daysAgo(1) })])
        : u.pathname === '/search/commits'
          ? body({ items: [] })
          : repoFiles(u),
    async () => matchProjects(MatchProjectsInput.parse({ github_user: 'bob' }), deps),
  );
  assert.equal(n.getCodes, 1);
  const p = r.fits[0].product;
  assert.equal(p.traction, 6 + 2 + 1);
  assert.equal(p.odds, 'good');
  assert.equal(p.low_reason, null);
  assert.equal(r.fits[0].facts.commits_90d, 1);
});

test('3.6 starters (R7): a package.json name or a first README heading matching an EarnKit example loses original', async () => {
  const starterFiles = (pkgName: string | null, readme: string) => (u: URL): Response | undefined => {
    if (u.host === 'api.github.com' && /\/git\/trees\//.test(u.pathname))
      return body({
        tree: [
          { path: 'README.md', type: 'blob', size: readme.length },
          { path: 'hardhat.config.ts', type: 'blob', size: 100 },
          ...(pkgName ? [{ path: 'package.json', type: 'blob', size: 50 }] : []),
        ],
      });
    if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/package.json')) return body(JSON.stringify({ name: pkgName }));
    if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/README.md')) return body(readme);
    return repoFiles(u);
  };
  const run = async (pkgName: string | null, readme: string) => {
    const { deps } = checkDeps({ probeOk: true });
    deps.starters = ['tip-jar-starter'];
    const r = await withFetch(
      (u) =>
        u.pathname === '/users/bob/repos'
          ? body([ghRepo('bob', 'tipjar', { homepage: 'https://tipjar.xyz' })])
          : u.pathname === '/search/commits'
            ? body({ items: [] })
            : starterFiles(pkgName, readme)(u),
      async () => matchProjects(MatchProjectsInput.parse({ github_user: 'bob' }), deps),
    );
    return r.fits[0].product.missing;
  };
  assert.ok((await run('tip-jar-starter', README)).includes('original'), 'by package.json name');
  // A short README (under 1.5 KB) still gives its heading (Pre-flight P27); case and dashes are folded.
  assert.ok((await run(null, '# Tip Jar Starter\n\nTips.')).includes('original'), 'by README heading');
  assert.ok((await run('TIP_JAR starter', README)).includes('original'));
  assert.ok(!(await run('tipjar-app', README)).includes('original'), 'another name stays original');
  assert.ok(!(await run(null, '# My Tip Jar\n\nTip Jar Starter inside the text.')).includes('original'));
  assert.equal(starterRepo({ packageName: 'earnkit-base-campaign-starter', heading: null }), true, 'the default list has the chain-kit examples');
  assert.equal(starterRepo({ packageName: null, heading: 'Base Campaign Starter (EarnKit)' }), true);
  assert.equal(starterRepo({ packageName: 'tipjar', heading: 'TipJar' }), false);
});

test('3.6b a cached product without `starter` (a row from before v2.10) is read again; the row keeps traction and odds', async () => {
  const { deps } = checkDeps({ probeOk: true });
  const saved: unknown[] = [];
  deps.cache = {
    load: async () => ({
      chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } },
      commits_since: {},
      product: { young: true, original: true, readme: true, addresses: [] },
      fetched_at: T_NOW,
    }),
    save: async (_n, _p, facts) => void saved.push(facts.product),
  };
  const r = await withFetch(
    (u) =>
      u.pathname === '/users/bob/repos'
        ? body([ghRepo('bob', 'tipjar', { homepage: 'https://tipjar.xyz' })])
        : u.pathname === '/search/commits'
          ? body({ items: [] })
          : repoFiles(u),
    async (calls) => ({ r: await matchProjects(MatchProjectsInput.parse({ github_user: 'bob' }), deps), calls }),
  );
  assert.equal(r.calls.filter((c) => c.includes('/git/trees/')).length, 1, 'the files are read again');
  assert.equal(saved.length, 1);
  const p = saved[0] as { starter?: boolean; traction?: number; odds?: string };
  assert.equal(p.starter, false);
  assert.equal(p.traction, r.r.fits[0].product.traction);
  assert.equal(p.odds, r.r.fits[0].product.odds);
});

test('3.7 checkLocal (R3), v2.11 8a: a last commit 10 days ago is commits band 1; without one, unknown (null, scores 0)', async () => {
  const { deps } = checkDeps();
  const run = async (last_commit_at?: string) =>
    (await matchProjects(MatchProjectsInput.parse({ local_repos: [{ name: 'tipjar', chains: ['base'], ...(last_commit_at && { last_commit_at }) }] }), deps)).fits[0];
  const recent = await run(daysAgo(10));
  assert.equal(recent.facts.commits_90d, 1);
  assert.equal(recent.product.traction, 1);
  const unknown = await run();
  assert.equal(unknown.facts.commits_90d, null);
  assert.equal(unknown.product.traction, 0);
  assert.equal(unknown.product.odds, 'low');
});

// ---- v2.10 Ruling H5 (Task 3 fix round 1) ----

test('H5 I1: a live, active local Arc product (count unknown) is good odds and can lead; a measured Base product still ranks above it', async () => {
  const { deps } = checkDeps({ probeOk: true });
  deps.checks!.getCode = async () => '0x6080';
  deps.programs = [{ ...baseProgram, id: 'arc-microgrants', title: 'Arc Microgrants', chains: ['arc'] }];
  const local = (o: Record<string, unknown>) =>
    matchProjects(MatchProjectsInput.parse({ local_repos: [{ name: 'quill', chains: ['arc'], contracts: [ADDR], last_commit_at: daysAgo(1), ...o }] }), deps);
  const live = (await local({ live_url: 'https://quill.xyz' })).fits[0];
  assert.equal(live.product.tier, 'product');
  assert.equal(live.product.traction, 3);
  assert.equal(live.product.odds, 'good');
  assert.equal(live.product.low_reason, null);
  const noLink = (await local({})).fits[0];
  assert.deepEqual([noLink.product.odds, noLink.product.low_reason], ['low', 'live link not loading']);
  // The first reply: the Arc product leads alone, counts in $X; a Base product with 120 transactions ranks above it.
  const arcCard = { id: 'arc-microgrants', title: 'Arc Microgrants', summary: '500 USDC', tag: null, each_time: [], ends_at: null, max_award_usd: 500, builder_fields: 0 };
  const baseCard = { ...arcCard, id: 'base-x', title: 'Base X' };
  const msg = (fits: unknown[]) => ({
    alerts: [], campaigns: [], cards: [arcCard, baseCard], repos: { checked: fits.length, fits }, workingOn: [], agentCanBuild: true,
    sponsorEntries: null, now: T_NOW, more: true, // v2.10 item 2: the v2.9 tables are behind "show more"
  }) as Parameters<typeof presentFirstMessage>[0];
  const alone = presentFirstMessage(msg([live]));
  assert.match(alone, /EarnKit matches you to \$500 in prizes you qualify for\./, alone);
  assert.match(alone, /\| Arc Microgrants \| .+ \| quill \|$/m, alone);
  const measured = { ...live, repo: 'payapp', key: 'alice/payapp', verdicts: [{ ...live.verdicts[0], program_id: 'base-x', program: 'Base X' }], product: { ...live.product, traction: 9 } };
  const both = presentFirstMessage(msg([live, measured]));
  assert.ok(both.indexOf('| Base X |') < both.indexOf('| Arc Microgrants |'), both);
});

test('H5 I2: a kit clone with a live link and 10+ commits (the real scoring path) is low odds', async () => {
  const { deps } = checkDeps({ probeOk: true });
  deps.starters = ['tip-jar-starter'];
  const ten = Array.from({ length: 12 }, (_, i) => ({ sha: `${i}` }));
  const r = await withFetch(
    (u) =>
      u.pathname === '/users/bob/repos'
        ? body([ghRepo('bob', 'tipjar', { homepage: 'https://tipjar.xyz' })])
        : u.pathname === '/search/commits'
          ? body({ items: [] })
          : u.host === 'api.github.com' && /\/git\/trees\//.test(u.pathname)
            ? body({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'hardhat.config.ts', type: 'blob', size: 100 }, { path: 'package.json', type: 'blob', size: 40 }] })
            : u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/package.json')
              ? body(JSON.stringify({ name: 'tip-jar-starter' }))
              : u.host === 'api.github.com' && /\/commits$/.test(u.pathname) && u.searchParams.has('since')
                ? body(ten)
                : repoFiles(u),
    async () => matchProjects(MatchProjectsInput.parse({ github_user: 'bob' }), deps),
  );
  const p = r.fits[0].product;
  assert.equal(p.tier, 'product', 'still a product (5 of 6)');
  assert.ok(p.missing.includes('original'));
  assert.ok((p.traction ?? 0) >= 4, `traction ${p.traction}`);
  assert.deepEqual([p.odds, p.low_reason], ['low', SIGNAL_WORDS.original]);
});

test('H5 I3: live repos get one Base getCode each only while a count slot remains, none with a cached count; an older Arc repo keeps its getCode', async () => {
  const addr = (i: number, j: number) => `0x${`${i}${j}`.padStart(40, 'c')}`;
  const ARC_ADDR = `0x${'d'.repeat(40)}`;
  const own = [
    ...[0, 1, 2].map((i) => ghRepo('alice', `live${i}`, { homepage: `https://live${i}.xyz`, pushed_at: daysAgo(i + 1) })),
    ghRepo('alice', 'arcold', { pushed_at: daysAgo(30) }),
  ];
  const config = (u: URL) => {
    if (u.host !== 'raw.githubusercontent.com' || !u.pathname.endsWith('/hardhat.config.ts')) return undefined;
    const m = u.pathname.match(/^\/alice\/live(\d)\//);
    if (m) return body(`networks: { base: { chainId: 8453 } } // ${addr(Number(m[1]), 1)} ${addr(Number(m[1]), 2)}`);
    return body(`networks: { arc: { chainId: 5042 } } // ${ARC_ADDR}`);
  };
  const { n, deps } = checkDeps({ probeOk: true });
  const asked: string[] = [];
  deps.checks!.getCode = async (rpc, a) => (n.getCodes++, asked.push(`${rpc} ${a}`), '0x6080');
  deps.checks!.blockscout = async () => ({ transactions_count: '7' });
  deps.programs = [baseProgram, { ...baseProgram, id: 'arc-x', title: 'Arc X', chains: ['arc'] }];
  // live0's count is cached: no getCode for it, and its count is used.
  const store = new Map<string, { ok: boolean; checked_at: Date; n?: number | null }>([[`txcount:base:${addr(0, 1)}`, { ok: true, checked_at: T_NOW, n: 99 }]]);
  deps.checks!.cache = { get: async (k) => store.get(k) ?? null, set: async (k, ok, now, extra) => void store.set(k, { ok, checked_at: now, ...extra }) };
  const r = await withFetch(
    (u) => (u.pathname === '/users/alice/repos' ? body(own) : u.pathname === '/search/commits' ? body({ items: [] }) : (config(u) ?? repoFiles(u))),
    async () => matchProjects(MatchProjectsInput.parse({ github_user: 'alice' }), deps),
  );
  const base = asked.filter((x) => x.startsWith('https://mainnet.base.org'));
  assert.deepEqual(base.sort(), [addr(1, 1), addr(2, 1)].map((a) => `https://mainnet.base.org ${a}`), 'one per live repo, none for the cached one');
  assert.ok(asked.includes(`https://rpc.mainnet.arc.io ${ARC_ADDR}`), asked.join('\n'));
  const fit = (k: string) => r.fits.find((f) => f.key === `alice/${k}`)!;
  assert.equal(fit('live0').facts.product!.traction, 6 + 2 + 1, 'the cached 99');
  assert.equal(fit('arcold').product.missing.includes('deployed'), false, 'the Arc contract was checked: deployed');
});

test('H5 I4: one Base pair stays inside the 2-pair cap, with Base listed third', async () => {
  const { n, deps } = checkDeps();
  const asked: string[] = [];
  deps.checks!.getCode = async (rpc) => (n.getCodes++, asked.push(rpc), '0x6080');
  deps.checks!.blockscout = async () => ({ transactions_count: '3' });
  await matchProjects(MatchProjectsInput.parse({ local_repos: [{ name: 'relay', chains: ['arc', 'avalanche', 'base'], contracts: [ADDR], last_commit_at: daysAgo(1) }] }), deps);
  assert.ok(asked.includes('https://mainnet.base.org'), asked.join(', '));
  assert.ok(asked.includes('https://rpc.mainnet.arc.io'), 'the first claimed pair is kept');
  assert.ok(asked.length <= 2);
});

// ---- v2.10 item 7: private repos

const TIPJAR_LOCAL = { name: 'TipJar', url: 'https://github.com/alice/tipjar', chains: ['base'], live_url: 'https://tipjar.xyz' };
const keysOf = (r: { fits: { key: string }[] }) => r.fits.map((f) => f.key).sort();

test('4.1 a named private repo (404) the agent reported locally is scored from the local copy; the other repo still reads', async (t) => {
  const { deps } = checkDeps();
  // The live link's failed probe logs one expected "[verify] live Error" line; kept out of the output.
  const log = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = log;
  });
  await withFetch(
    (u) => (u.pathname === '/repos/alice/site' ? body(ghRepo('alice', 'site')) : u.pathname === '/repos/alice/tipjar' ? undefined : repoFiles(u)),
    async () => {
      const r = await matchProjects(
        MatchProjectsInput.parse({ repos: ['alice/tipjar', 'alice/site'], local_repos: [TIPJAR_LOCAL] }),
        deps,
      );
      assert.equal('error' in r, false);
      assert.equal(r.scored, 2);
      assert.deepEqual(keysOf(r), ['alice/site', 'alice/tipjar']);
      assert.deepEqual(r.fromLocal, [{ name: 'TipJar', full_name: 'alice/tipjar' }]);
      assert.deepEqual(r.unseen, []);
    },
  );
});

test('4.2 a named private repo (404) with no local view is never dropped silently: unseen; the other repo is scored', async () => {
  const { deps } = checkDeps();
  await withFetch(
    (u) => (u.pathname === '/repos/alice/site' ? body(ghRepo('alice', 'site')) : u.pathname === '/repos/alice/tipjar' ? undefined : repoFiles(u)),
    async () => {
      const r = await matchProjects(MatchProjectsInput.parse({ repos: ['alice/tipjar', 'alice/site'] }), deps);
      assert.deepEqual(r.unseen, [{ name: 'tipjar', full_name: 'alice/tipjar' }]);
      assert.deepEqual(r.fromLocal, []);
      assert.deepEqual(keysOf(r), ['alice/site']);
    },
  );
});

test('4.3 (Review Focus 1) a rate limit (403) is not "private": skipped with its local view; all named repos failing that way throws', async () => {
  const { deps } = checkDeps();
  const limited = () => new Response('{"message":"API rate limit exceeded"}', { status: 403 });
  await withFetch(
    (u) => (u.pathname === '/repos/alice/site' ? body(ghRepo('alice', 'site')) : u.pathname === '/repos/alice/tipjar' ? limited() : repoFiles(u)),
    async () => {
      const r = await matchProjects(
        MatchProjectsInput.parse({ repos: ['alice/tipjar', 'alice/site'], local_repos: [TIPJAR_LOCAL] }),
        deps,
      );
      assert.deepEqual(r.unseen, []);
      assert.deepEqual(r.fromLocal, []);
      assert.deepEqual(keysOf(r), ['alice/site'], 'the local view of the 403 repo is not used either');
    },
  );
  await withFetch(
    (u) => (u.pathname === '/repos/alice/site' || u.pathname === '/repos/alice/tipjar' ? limited() : repoFiles(u)),
    async () => {
      await assert.rejects(
        matchProjects(MatchProjectsInput.parse({ repos: ['alice/tipjar', 'alice/site'] }), deps),
        (err: unknown) => err instanceof GitHubError && err.status === 403 && /GitHub request failed \(403\)/.test(err.message),
      );
    },
  );
});

test('4.4 with the App\'s token a private repo is read through it, fully scored, and cached as via_app', async () => {
  const saved: { full: string; via_app?: boolean }[] = [];
  const { deps } = checkDeps();
  const asked: string[] = [];
  deps.cache = { load: async () => null, save: async (full, _p, facts) => void saved.push({ full, via_app: facts.via_app }) };
  deps.appToken = async (n) => (asked.push(n), n === 'alice/tipjar' ? 'tok' : null);
  const original = globalThis.fetch;
  const calls: { url: string; auth: string | null }[] = [];
  const priv = ghRepo('alice', 'tipjar', { private: true, visibility: 'private' });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url: u.host + u.pathname + u.search, auth });
    const notFound = () => new Response('{"message":"Not Found"}', { status: 404 });
    if (!u.pathname.startsWith('/repos/alice/tipjar')) return notFound();
    // Without the token GitHub answers 404 for everything in a private repo.
    if (auth !== 'Bearer tok') return notFound();
    if (u.pathname === '/repos/alice/tipjar') return body(priv);
    if (/\/git\/trees\//.test(u.pathname))
      return body({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'hardhat.config.ts', type: 'blob', size: 100 }] });
    if (u.pathname === '/repos/alice/tipjar/contents/README.md' && u.searchParams.get('ref') === 'main') return body(README);
    if (u.pathname === '/repos/alice/tipjar/contents/hardhat.config.ts')
      return body(`networks: { base: { url: 'https://mainnet.base.org', chainId: 8453 } } // token ${ADDR}`);
    if (/\/commits$/.test(u.pathname) && u.searchParams.has('since')) return body([{ sha: 'a' }, { sha: 'b' }]);
    return notFound();
  }) as typeof fetch;
  try {
    const r = await matchProjects(MatchProjectsInput.parse({ repos: ['alice/tipjar'] }), deps);
    assert.deepEqual(asked, ['alice/tipjar']);
    assert.deepEqual(r.unseen, []);
    assert.deepEqual(keysOf(r), ['alice/tipjar']);
    const [fit] = r.fits;
    // README, original, active, young and owned all counted (read through the token); only a deployment is missing.
    assert.deepEqual(fit.product.missing, ['deployed'], JSON.stringify(fit.product));
    assert.equal(fit.facts.chains.base?.basis, 'deploy_config');
    assert.equal(fit.facts.commits_90d, 2);
    // Every read after the first 404 went through the token; nothing went to raw.githubusercontent.com.
    const after404 = calls.slice(1);
    assert.ok(after404.length >= 5, JSON.stringify(calls));
    assert.ok(after404.every((c) => c.auth === 'Bearer tok' && c.url.startsWith('api.github.com/repos/alice/tipjar')), JSON.stringify(calls));
    for (const part of ['/git/trees/', '/contents/README.md', '/contents/hardhat.config.ts', '/commits?since='])
      assert.ok(after404.some((c) => c.url.includes(part)), part);
    assert.deepEqual(saved, [{ full: 'alice/tipjar', via_app: true }]);
  } finally {
    globalThis.fetch = original;
  }
});

test('I2 (fix round 1) an App-read private repo\'s cached addresses, chains and proof reach only the installation (and login) that proved it', dbTest, async () => {
  const { loadRepoFacts, saveRepoFacts } = await import('./repo-cache');
  const { verifiedFor } = await import('./github-verify');
  const tag = `i2-${process.pid}-${Date.now()}`;
  const full = `alice/${tag}`;
  const pushed = new Date().toISOString();
  const [a] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${tag}-a`}) RETURNING id`;
  const [b] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${tag}-b`}) RETURNING id`;
  try {
    await saveRepoFacts(full, pushed, {
      chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } },
      commits_since: {},
      product: { young: true, original: true, readme: true, addresses: [ADDR], starter: false },
      via_app: true,
    });
    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose, via, github_installation_id)
      VALUES (${full}, 'alice', ${a.id}, now(), 1, 'app', 'app', 77)`;
    const url = `https://github.com/${full}`;
    // Another installation naming the repo, or a read with no viewer: nothing.
    assert.equal(await cachedRepoChains(full), null);
    assert.equal(await cachedRepoChains(full, { installationId: b.id }), null);
    assert.deepEqual(await cachedRepoAddresses(url, { installationId: b.id }), []);
    assert.deepEqual(await cachedRepoAddresses(url), []);
    assert.equal(await loadRepoFacts(full, pushed), null, 'the hour cache gives it only to a read through the App');
    assert.equal(await verifiedFor({ installationId: b.id, repoKey: full, purpose: 'app' }), null);
    // The proving installation (and on a shared client only the proving login).
    assert.deepEqual(await cachedRepoChains(full, { installationId: a.id }), ['base']);
    assert.deepEqual(await cachedRepoAddresses(url, { installationId: a.id }), [ADDR]);
    assert.deepEqual(await cachedRepoAddresses(url, { installationId: a.id, login: 'Alice' }), [ADDR]);
    assert.deepEqual(await cachedRepoAddresses(url, { installationId: a.id, login: 'bob' }), []);
    assert.deepEqual(await cachedRepoAddresses(url, { installationId: a.id, login: null }), []);
    assert.ok(await loadRepoFacts(full, pushed, { viaApp: true }));
  } finally {
    await sql()`DELETE FROM github_repo_facts WHERE full_name = ${full}`;
    await sql()`DELETE FROM installations WHERE id IN (${a.id}, ${b.id})`;
  }
});

test('H6: repoCodeFacts gives public evidence only for a read without an App token that says private: false', async () => {
  await withGitHub({ '/repos/bob/kit': repo({ private: true, visibility: 'private' }), [COMMITS]: json([{ sha: 'a' }]) }, async () => {
    assert.equal((await repoCodeFacts('bob/kit', { token: 'ghs_x' })).public, undefined);
  });
  await withGitHub({ '/repos/bob/kit': repo({ private: undefined, visibility: undefined }), [COMMITS]: json([{ sha: 'a' }]) }, async () => {
    assert.equal((await repoCodeFacts('bob/kit')).public, undefined, 'no private field: no evidence');
  });
});
