import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntryError } from './campaigns';
import { GitHubError } from './match-projects';
import {
  checkOwnership,
  githubRepo,
  ownershipBaseUrl,
  ownershipFileUrl,
  ownershipProblem,
  ownershipProblems,
  parseOwnershipFile,
  fetchOwnershipViaApi,
  fetchOwnershipLatestBranch,
  shownBranch,
  deployerOf,
  type DeployerLookup,
  type FetchResult,
  type RepoFacts,
  FORK_REFUSED,
} from './ownership';
import { entryMessage } from './entry-proof';

const W = '0x00000000000000000000000000000000000000a1';
const OTHER = '0x00000000000000000000000000000000000000b2';
const C1 = '0x00000000000000000000000000000000000000c1';
const C2 = '0x00000000000000000000000000000000000000c2';
const original: RepoFacts = {
  fork: false,
  created_at: '2026-01-02T00:00:00Z',
  pushed_at: '2026-10-01T00:00:00Z',
};
const repoFacts = async () => original;
const where = {
  repo: 'github.com/acme/app',
  fileUrl: 'https://raw.githubusercontent.com/acme/app/HEAD/earnkit.txt',
};

test('parseOwnershipFile: the payout_wallet line; contracts and other lines are ignored', () => {
  const f = parseOwnershipFile(
    [
      '# EarnKit ownership',
      `Payout_Wallet: ${W.toUpperCase().replace('0X', '0x')}`,
      `contracts: ${C1}, ${C2}`,
      'contracts: not even an address',
      'earnkit-sponsor: 0x0000000000000000000000000000000000000001',
      'anything else',
    ].join('\r\n'),
  );
  assert.deepEqual(f, {
    payoutWallet: W,
    creatorWallets: [],
    tokens: [],
    codes: [],
    problems: [],
  });
  assert.deepEqual(parseOwnershipFile(''), {
    payoutWallet: null,
    creatorWallets: [],
    tokens: [],
    codes: [],
    problems: [],
  });
});

test('parseOwnershipFile: creator_wallet and token lines; malformed ones are ignored, never a problem', () => {
  const C = '0x' + 'c'.repeat(40);
  const f = parseOwnershipFile(
    `payout_wallet: ${W}\nCreator_Wallet: ${C}\ncreator_wallet: nope\ntoken: kits\nTOKEN: CHAIN   a1b2c3d4e5 # this launch\ntoken: three bad words\ntoken: x-y code\ntoken:`,
  );
  assert.equal(f.payoutWallet, W.toLowerCase());
  assert.deepEqual(f.creatorWallets, [C]);
  assert.deepEqual(f.tokens, [
    { symbol: 'KITS', code: null },
    { symbol: 'CHAIN', code: 'a1b2c3d4e5' },
  ]);
  assert.deepEqual(f.problems, []);
  // A campaign entry's check is unaffected by them.
  assert.equal(
    ownershipProblem(where, f, {
      payoutWallet: W.toLowerCase(),
      contracts: [],
    }),
    null,
  );
});

test('v2.6: parseOwnershipFile reads a ticker-free token line; legacy lines unchanged', () => {
  const f = parseOwnershipFile('token: A1B2C3D4E5F60718\ntoken: KIT a1b2c3d4e5\npayout_wallet: nonsense');
  assert.deepEqual(f.codes, ['a1b2c3d4e5f60718']);
  assert.deepEqual(f.tokens, [{ symbol: 'KIT', code: 'a1b2c3d4e5' }]);
  // Not 16 hex: never a code (a 15- or 17-character value, or a non-hex one).
  const g = parseOwnershipFile('token: a1b2c3d4e5f6071\ntoken: a1b2c3d4e5f607189\ntoken: g1b2c3d4e5f60718');
  assert.deepEqual(g.codes, []);
});

test('Ruling 14 (plan): contents API first; raw only when rate-limited; 404 is missing', async () => {
  const res = (status: number, body = '', headers: Record<string, string> = {}) =>
    new Response(status === 204 || status === 304 ? null : body, { status, headers });
  let rawCalls = 0;
  const raw = async () => { rawCalls++; return { status: 'ok' as const, text: 'token: from-raw' }; };
  const r = { owner: 'acme', repo: 'kit' };
  assert.deepEqual(await fetchOwnershipViaApi(r, { fetch: async () => res(200, 'token: x'), raw }), { status: 'ok', text: 'token: x' });
  assert.deepEqual(await fetchOwnershipViaApi(r, { fetch: async () => res(404), raw }), { status: 'missing' });
  assert.equal(rawCalls, 0);
  assert.deepEqual(
    await fetchOwnershipViaApi(r, { fetch: async () => res(403, '', { 'x-ratelimit-remaining': '0' }), raw }),
    { status: 'ok', text: 'token: from-raw' },
  );
  await fetchOwnershipViaApi(r, { fetch: async () => res(429), raw });
  assert.equal(rawCalls, 2);
  const e = await fetchOwnershipViaApi(r, { fetch: async () => res(403, '', { 'x-ratelimit-remaining': '42' }), raw });
  assert.equal(e.status, 'error');
  assert.equal(rawCalls, 2, 'a 403 that is not a rate limit never falls back');
  const moved = await fetchOwnershipViaApi(r, { fetch: async () => res(301, '', { location: 'https://api.github.com/x' }), raw });
  assert.equal(moved.status, 'error', 'a redirect is an error, not followed');
  const down = await fetchOwnershipViaApi(r, { fetch: async () => { throw new TypeError('fetch failed'); }, raw });
  assert.deepEqual(down, { status: 'error', message: "GitHub couldn't be reached" });
  assert.equal(rawCalls, 2, 'neither falls back');
  const big = await fetchOwnershipViaApi(r, { fetch: async () => res(200, 'x'.repeat(5000)), raw });
  assert.deepEqual(big, { status: 'error', message: 'the file is larger than 4 KB' }, 'the 4 KB cap holds on the API too');
  // Plain messages, no HTTP status codes.
  assert.deepEqual(e, { status: 'error', message: "GitHub didn't answer" });
  assert.deepEqual(moved, { status: 'error', message: 'the repo moved; use its current GitHub link' });
});

test("fix round 1: GitHub's secondary rate limit (403 with retry-after or its message) also falls back to raw", async () => {
  let rawCalls = 0;
  const raw = async () => { rawCalls++; return { status: 'ok' as const, text: 'token: from-raw' }; };
  const r = { owner: 'acme', repo: 'kit' };
  const f = (body: string, headers: Record<string, string>) => async () => new Response(body, { status: 403, headers });
  assert.deepEqual(await fetchOwnershipViaApi(r, { fetch: f('', { 'retry-after': '60', 'x-ratelimit-remaining': '4000' }), raw }), { status: 'ok', text: 'token: from-raw' });
  await fetchOwnershipViaApi(r, { fetch: f('{"message":"You have exceeded a secondary rate limit."}', { 'x-ratelimit-remaining': '4000' }), raw });
  await fetchOwnershipViaApi(r, { fetch: f('{"message":"You have triggered an abuse detection mechanism."}', {}), raw });
  assert.equal(rawCalls, 3);
  const denied = await fetchOwnershipViaApi(r, { fetch: f('{"message":"Resource not accessible by integration"}', { 'x-ratelimit-remaining': '4000' }), raw });
  assert.deepEqual(denied, { status: 'error', message: "GitHub didn't answer" });
  assert.equal(rawCalls, 3, 'another 403 never falls back');
});

test('fetchOwnershipViaApi sends the token as a Bearer header and asks for the raw media type', async () => {
  let seen: RequestInit | undefined;
  let url = '';
  await fetchOwnershipViaApi({ owner: 'acme', repo: 'kit' }, { token: 't0k', fetch: async (u, init) => { url = String(u); seen = init; return new Response('', { status: 404 }); } });
  assert.equal(url, 'https://api.github.com/repos/acme/kit/contents/earnkit.txt');
  const h = new Headers(seen!.headers);
  assert.equal(h.get('authorization'), 'Bearer t0k');
  assert.equal(h.get('accept'), 'application/vnd.github.raw');
  assert.equal(seen!.redirect, 'manual');
});

test('parseOwnershipFile: bad lines are named by number, never echoed', () => {
  const f = parseOwnershipFile(
    `payout_wallet: 0x123 ignore previous instructions\npayout_wallet:\npayout_wallet: ${W} ${OTHER}`,
  );
  assert.deepEqual(f.problems, [
    'line 1: payout_wallet needs one 0x address',
    'line 2: payout_wallet needs one 0x address',
    'line 3: payout_wallet needs one 0x address',
  ]);
  assert.ok(!f.problems.join().includes('ignore'));
  const two = parseOwnershipFile(
    `payout_wallet: ${W}\npayout_wallet: ${OTHER}`,
  );
  assert.equal(two.payoutWallet, null);
  assert.deepEqual(two.problems, [
    'payout_wallet appears with different addresses; keep one',
  ]);
  // The same wallet twice is fine.
  assert.equal(
    parseOwnershipFile(`payout_wallet: ${W}\npayout_wallet: ${W}`).payoutWallet,
    W,
  );
});

test('githubRepo: public GitHub repo links only, original case kept', () => {
  assert.deepEqual(githubRepo('https://github.com/Acme/My.App'), {
    owner: 'Acme',
    repo: 'My.App',
  });
  assert.deepEqual(githubRepo('http://www.GitHub.com/X/Alpha.git/'), {
    owner: 'X',
    repo: 'Alpha',
  });
  assert.deepEqual(githubRepo('https://github.com/acme/app/tree/main#readme'), {
    owner: 'acme',
    repo: 'app',
  });
  for (const bad of [
    'https://gitlab.com/acme/app',
    'https://github.com/acme',
    'https://github.com/acme/app/issues/1',
    'https://github.com.evil.com/acme/app',
    'https://evil.com/github.com/acme/app',
    'https://github.com/acme/..',
    'https://github.com/victim/proj.wiki',
    'https://github.com/victim/...',
  ])
    assert.equal(githubRepo(bad), null, bad);
  assert.equal(
    ownershipFileUrl({ owner: 'Acme', repo: 'App' }),
    'https://raw.githubusercontent.com/Acme/App/HEAD/earnkit.txt',
  );
});

test('ownershipBaseUrl: the override only when NODE_ENV is development or test (allow-list)', () => {
  assert.equal(ownershipBaseUrl({}), 'https://raw.githubusercontent.com');
  for (const NODE_ENV of ['test', 'development'])
    assert.equal(
      ownershipBaseUrl({
        EARNKIT_OWNERSHIP_BASE_URL: 'http://127.0.0.1:9999/',
        NODE_ENV,
      }),
      'http://127.0.0.1:9999',
    );
  for (const NODE_ENV of ['production', 'Production', 'staging', undefined])
    assert.throws(
      () =>
        ownershipBaseUrl({
          EARNKIT_OWNERSHIP_BASE_URL: 'http://127.0.0.1:9999',
          NODE_ENV,
        }),
      /development and tests only/,
      String(NODE_ENV),
    );
});

test('ownershipProblem: wallet match and mismatch', () => {
  const file = {
    payoutWallet: W,
    creatorWallets: [],
    tokens: [],
    codes: [],
    problems: [],
  };
  assert.equal(
    ownershipProblem(where, file, { payoutWallet: W, contracts: [] }),
    null,
  );
  const missing = ownershipProblem(where, null, {
    payoutWallet: W,
    contracts: [C1],
  });
  assert.match(
    missing!,
    /^repo_url: EarnKit needs proof you own github\.com\/acme\/app/,
  );
  assert.ok(
    missing!.includes(
      `Add a file named earnkit.txt at the root of github.com/acme/app on its default branch with the line "payout_wallet: ${W}", push it`,
    ),
    missing!,
  );
  assert.equal(
    ownershipProblem(where, file, { payoutWallet: OTHER, contracts: [] }),
    `payout_wallet: earnkit.txt in github.com/acme/app says payout_wallet: ${W}, not ${OTHER}. ` +
      `Enter with the wallet in the file, or (if the builder owns the repo) change that line to "payout_wallet: ${OTHER}", push it, then call confirm again.`,
  );
  assert.match(
    ownershipProblem(
      where,
      { payoutWallet: null, creatorWallets: [], tokens: [], codes: [], problems: [] },
      { payoutWallet: W, contracts: [] },
    )!,
    /has no payout_wallet line/,
  );
  assert.match(
    ownershipProblem(
      where,
      {
        payoutWallet: null,
        creatorWallets: [],
        tokens: [],
        codes: [],
        problems: ['line 1: x'],
      },
      { payoutWallet: W, contracts: [] },
    )!,
    /has a problem \(line 1: x\)/,
  );
});

test('ownershipProblem: every contract must be deployed from the payout wallet (no listing escape)', () => {
  const entry = { payoutWallet: W, contracts: [C1, C2] };
  const file = {
    payoutWallet: W,
    creatorWallets: [],
    tokens: [],
    codes: [],
    problems: [],
  };
  assert.equal(
    ownershipProblem(where, file, entry, { [C1]: W, [C2]: W }),
    null,
  );
  // Someone else's contract: refused, whatever the file says.
  assert.equal(
    ownershipProblem(where, file, entry, { [C1]: W, [C2]: OTHER }),
    `Contract ${C2} was deployed by ${OTHER}, not by your payout wallet.`,
  );
  // No creation transaction on record: not proven either.
  assert.match(
    ownershipProblem(where, file, entry, { [C1]: null, [C2]: W })!,
    /^Contract 0x0+c1 was deployed by an unknown wallet, not by your payout wallet\.$/,
  );
  assert.match(
    ownershipProblem(where, file, entry, { [C1]: W })!,
    /couldn't read who deployed 0x0+c2.*Try again/,
  );
});

/** A fake explorer: contract -> creation tx, tx -> sender. */
const explorer = (
  txs: Record<string, string | null>,
  senders: Record<string, string>,
  asked: string[] = [],
): DeployerLookup => ({
  creationTx: async (c) => {
    asked.push(c);
    return txs[c] ?? null;
  },
  txSender: async (h) => senders[h],
});

test("deployerOf: the creation transaction's sender, lowercase (direct and factory deploys alike)", async () => {
  const lookup = explorer(
    { [C1]: '0xd1', [C2]: '0xf1' },
    // Direct deploy and a factory/CREATE2 deploy: both sent by the builder's wallet.
    { '0xd1': W.toUpperCase().replace('0X', '0x'), '0xf1': W },
  );
  assert.equal(await deployerOf(C1, lookup), W);
  assert.equal(await deployerOf(C2, lookup), W);
  assert.equal(await deployerOf(OTHER, lookup), null);
});

test('checkOwnership: fetches the raw file, then the deployer of every contract', async () => {
  const fetched: string[] = [];
  const asked: string[] = [];
  const fetchFile = async (url: string): Promise<FetchResult> => {
    fetched.push(url);
    // A contracts line listing someone else's contract changes nothing.
    return { status: 'ok', text: `payout_wallet: ${W}\ncontracts: ${C2}` };
  };
  const deployer = explorer(
    { [C1]: '0xa', [C2]: '0xb' },
    { '0xa': W, '0xb': OTHER },
    asked,
  );
  await checkOwnership(
    {
      repoUrl: 'https://github.com/Acme/App',
      payoutWallet: W,
      contracts: [C1],
    },
    { fetchFile, deployer, repoFacts, baseUrl: 'http://127.0.0.1:1' },
  );
  assert.deepEqual(fetched, ['http://127.0.0.1:1/Acme/App/HEAD/earnkit.txt']);
  assert.deepEqual(asked, [C1]);
  // Contract squatting: C2 is listed in the file but deployed by someone else.
  await assert.rejects(
    checkOwnership(
      {
        repoUrl: 'https://github.com/Acme/App',
        payoutWallet: W,
        contracts: [C1, C2],
      },
      { fetchFile, deployer, repoFacts },
    ),
    (e) =>
      e instanceof EntryError &&
      e.message ===
        `Contract ${C2} was deployed by ${OTHER}, not by your payout wallet.`,
  );
  // Repo squatting: the victim's file names the victim's wallet; Blockscout isn't asked.
  asked.length = 0;
  await assert.rejects(
    checkOwnership(
      {
        repoUrl: 'https://github.com/Acme/App',
        payoutWallet: OTHER,
        contracts: [C2],
      },
      { fetchFile, deployer, repoFacts },
    ),
    (e) => e instanceof EntryError && /says payout_wallet/.test(e.message),
  );
  assert.deepEqual(asked, []);
  // Not GitHub, a missing file, and a fetch error.
  await assert.rejects(
    checkOwnership(
      { repoUrl: 'https://gitlab.com/a/b', payoutWallet: W, contracts: [] },
      { fetchFile, deployer, repoFacts },
    ),
    /public GitHub repo/,
  );
  await assert.rejects(
    checkOwnership(
      { repoUrl: 'https://github.com/a/b', payoutWallet: W, contracts: [] },
      { fetchFile: async () => ({ status: 'missing' }), deployer, repoFacts },
    ),
    /no earnkit\.txt found/,
  );
  await assert.rejects(
    checkOwnership(
      { repoUrl: 'https://github.com/a/b', payoutWallet: W, contracts: [] },
      {
        fetchFile: async () => ({
          status: 'error',
          message: 'no answer within 5 s',
        }),
        deployer,
        repoFacts,
      },
    ),
    /couldn't read .*\(no answer within 5 s\)\. Try again/,
  );
  // A failed explorer read is retryable, not a crash.
  await assert.rejects(
    checkOwnership(
      { repoUrl: 'https://github.com/a/b', payoutWallet: W, contracts: [C1] },
      {
        fetchFile,
        repoFacts,
        deployer: {
          creationTx: async () => {
            throw new Error('explorer down');
          },
          txSender: async () => W,
        },
      },
    ),
    /couldn't read who deployed/,
  );
});

test('checkOwnership: forks are refused; GitHub errors are clear; the repo dates come back', async () => {
  const fetchFile = async (): Promise<FetchResult> => ({
    status: 'ok',
    text: `payout_wallet: ${W}`,
  });
  const deployer = explorer({}, {});
  const input = {
    repoUrl: 'https://github.com/attacker/app',
    payoutWallet: W,
    contracts: [],
  };
  await assert.rejects(
    checkOwnership(input, {
      fetchFile,
      deployer,
      repoFacts: async () => ({ ...original, fork: true }),
    }),
    (e) => e instanceof EntryError && e.message === FORK_REFUSED,
  );
  assert.equal(
    FORK_REFUSED,
    "Forks can't be entered; enter the original repo.",
  );
  await assert.rejects(
    checkOwnership(input, {
      fetchFile,
      deployer,
      repoFacts: async () => {
        throw new GitHubError(
          'GitHub: /repos/attacker/app not found (or private)',
        );
      },
    }),
    /GitHub doesn't show github\.com\/attacker\/app; campaign entries need a public repo/,
  );
  await assert.rejects(
    checkOwnership(input, {
      fetchFile,
      deployer,
      repoFacts: async () => {
        throw new GitHubError('GitHub request failed (403)');
      },
    }),
    /couldn't read github\.com\/attacker\/app from GitHub\. Try again/,
  );
  const ok = await checkOwnership(input, { fetchFile, deployer, repoFacts });
  assert.equal(ok.repo_created_at.toISOString(), '2026-01-02T00:00:00.000Z');
  assert.equal(ok.repo_pushed_at.toISOString(), '2026-10-01T00:00:00.000Z');
});

test('v2.4: a contract deployed by the wallet that signed the entry is proven; every wrong one is listed', () => {
  const where = { repo: 'github.com/alice/tipjar', fileUrl: 'https://raw.githubusercontent.com/alice/tipjar/HEAD/earnkit.txt' };
  const PAYOUT = '0x' + 'a'.repeat(40);
  const AGENT = '0x' + 'b'.repeat(40);
  const OTHER = '0x' + 'e'.repeat(40);
  const C1 = '0x' + '1'.repeat(40);
  const C2 = '0x' + '2'.repeat(40);
  const C3 = '0x' + '3'.repeat(40);
  const file = { payoutWallet: PAYOUT, creatorWallets: [], tokens: [], codes: [], problems: [] };
  const deployers = { [C1]: AGENT, [C2]: PAYOUT, [C3]: OTHER };
  assert.deepEqual(
    ownershipProblems(where, file, { payoutWallet: PAYOUT, contracts: [C1, C2], signer: AGENT }, deployers),
    [],
  );
  assert.deepEqual(
    ownershipProblems(where, file, { payoutWallet: PAYOUT, contracts: [C1, C3], signer: AGENT }, deployers),
    [`Contract ${C3} was deployed by ${OTHER}, not by the wallet that signed the entry (${AGENT}) or the payout wallet.`],
  );
  // Without a signature: who deployed it, never "redeploy" (projects.ts adds the exact text to sign).
  assert.deepEqual(
    ownershipProblems(where, file, { payoutWallet: PAYOUT, contracts: [C1, C3] }, deployers),
    [C1, C3].map((c) => `Contract ${c} was deployed by ${deployers[c]}, not by your payout wallet.`),
  );
  assert.equal(
    entryMessage('earnkit-campaign-1-base', 'github.com/alice/tipjar', PAYOUT, [C2, C1]),
    `EarnKit entry: earnkit-campaign-1-base github.com/alice/tipjar ${PAYOUT} ${C1},${C2}`,
  );
});

test('v2.8.1 §A3: the most recently pushed other branch: one API call (push activity), then the file at that commit from raw', async () => {
  const r = { owner: 'acme', repo: 'kit' };
  const sha = (c: string) => c.repeat(40);
  const urls: string[] = [];
  const activity = (items: unknown, status = 200) => async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify(items), { status });
  };
  const rawUrls: string[] = [];
  const raw = async (url: string) => { rawUrls.push(url); return { status: 'ok' as const, text: 'token: x' }; };
  const pushes = [
    { ref: 'refs/heads/main', after: sha('a') },
    { ref: 'refs/tags/v1', after: sha('b') },
    { ref: 'refs/heads/gone', after: sha('0') },
    { ref: 'refs/heads/feat/proof', after: sha('c') },
    { ref: 'refs/heads/older', after: sha('d') },
  ];
  const got = await fetchOwnershipLatestBranch(r, 'main', { fetch: activity(pushes) as typeof fetch, raw, token: 't' });
  assert.deepEqual(got, { branch: 'feat/proof', file: { status: 'ok', text: 'token: x' } });
  assert.deepEqual(urls, ['https://api.github.com/repos/acme/kit/activity?activity_type=push&per_page=10']);
  assert.deepEqual(rawUrls, [`https://raw.githubusercontent.com/acme/kit/${sha('c')}/earnkit.txt`]);
  // Nothing but the default branch, an API error, junk, or a network failure: null (the default answer stands).
  assert.equal(await fetchOwnershipLatestBranch(r, 'main', { fetch: activity([pushes[0]]) as typeof fetch, raw }), null);
  assert.equal(await fetchOwnershipLatestBranch(r, 'main', { fetch: activity({ message: 'x' }, 403) as typeof fetch, raw }), null);
  assert.equal(await fetchOwnershipLatestBranch(r, 'main', { fetch: activity({ not: 'a list' }) as typeof fetch, raw }), null);
  assert.equal(await fetchOwnershipLatestBranch(r, 'main', { fetch: (async () => { throw new TypeError('down'); }) as typeof fetch, raw }), null);
  assert.equal(rawUrls.length, 1);
  assert.equal(shownBranch('feat/proof-1.2'), 'feat/proof-1.2');
  assert.equal(shownBranch('x"; rm -rf'), null);
});

// ---- v2.11 T9 security fix (I1): who pushed the line (GitHub's authenticated push actor)

test('T9 I1 fetchLinePusher: the actor of the push that introduced the line; never the newest pusher, never a guess', async () => {
  const { fetchLinePusher, PUSHER_MAX_READS } = await import('./ownership');
  const sha = (n: number) => n.toString(16).padStart(40, '0');
  const ZERO = '0'.repeat(40);
  const LINE = 'token: 0123456789abcdef';
  // R4: the repo was created at T0, the line first shown to the installation 5 minutes before, and
  // each push lands 3 minutes after T0 with one fresh single-parent commit dated 2 minutes after T0.
  const T0 = Date.parse('2026-10-11T12:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const push = (actor: string, before: string, after: string, o: { ref?: string; type?: string; at?: number } = {}) => ({
    activity_type: o.type ?? 'push', ref: o.ref ?? 'refs/heads/main', before, after, actor: { login: actor }, timestamp: iso(o.at ?? T0 + 180_000),
  });
  const commit = (at: number, parents = 1) => ({ parents: Array.from({ length: parents }, (_, i) => ({ sha: sha(900 + i) })), commit: { committer: { date: iso(at) } } });
  type R4 = { repo?: unknown; compare?: unknown; commits?: unknown; issuedAt?: Date | null };
  const run = async (activity: unknown, files: Record<string, string>, status = 200, o: R4 = {}) => {
    const reads: string[] = [];
    const api = (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/activity')) return new Response(JSON.stringify(activity), { status });
      if (u.pathname === '/repos/alice/podtips')
        return o.repo === null ? new Response('', { status: 404 }) : Response.json(o.repo ?? { fork: false, template_repository: null, created_at: iso(T0) });
      if (u.pathname.includes('/compare/')) return Response.json(o.compare ?? { status: 'ahead', total_commits: 1, commits: [commit(T0 + 120_000)] });
      if (u.pathname.endsWith('/commits')) return Response.json(o.commits ?? [commit(T0 + 60_000, 0)]);
      return new Response('', { status: 404 });
    };
    const got = await fetchLinePusher(
      { owner: 'alice', repo: 'podtips' },
      (t) => t.includes(LINE),
      o.issuedAt === undefined ? new Date(T0 - 300_000) : o.issuedAt,
      {
        fetch: (async (url: string) => api(url)) as unknown as typeof fetch,
        raw: async (url) => {
          const s = url.split('/')[5];
          reads.push(s);
          return s in files ? { status: 'ok', text: files[s] } : { status: 'missing' };
        },
      },
    );
    return { got, reads };
  };
  // alice created the branch with the line: alice.
  assert.equal((await run([push('Alice', ZERO, sha(1), { type: 'branch_creation' })], { [sha(1)]: LINE })).got, 'alice');
  // mallory added it, then alice pushed something else: mallory (the newest pusher is not the one who added it).
  const collab = [push('alice', sha(2), sha(3)), push('mallory', sha(1), sha(2))];
  assert.equal((await run(collab, { [sha(1)]: 'readme', [sha(2)]: LINE, [sha(3)]: LINE })).got, 'mallory');
  // alice added it after mallory's unrelated push: alice.
  assert.equal((await run(collab, { [sha(1)]: 'x', [sha(2)]: 'x', [sha(3)]: LINE })).got, 'alice');
  // A line on another branch, pushed by mallory: mallory.
  assert.equal((await run([push('mallory', sha(5), sha(6), { ref: 'refs/heads/feature' }), push('alice', sha(4), sha(5))], { [sha(6)]: LINE })).got, 'mallory');
  // The chain breaks (the line predates the activity page): null.
  assert.equal((await run([push('alice', sha(7), sha(8))], { [sha(7)]: LINE, [sha(8)]: LINE })).got, null);
  // No line anywhere, an unreadable activity, a non-push event: null.
  assert.equal((await run([push('alice', sha(1), sha(2))], {})).got, null);
  assert.equal((await run([], {}, 403)).got, null);
  assert.equal((await run([push('alice', ZERO, sha(1), { type: 'branch_deletion' })], { [sha(1)]: LINE })).got, null);
  // R1: a fork PR merged by alice, a merge queue merge, a force push: the mover wrote nothing, so no one.
  const files12 = { [sha(1)]: 'readme', [sha(2)]: LINE };
  assert.equal((await run([push('alice', sha(1), sha(2), { type: 'pr_merge' })], files12)).got, null, 'a fork PR the owner merged');
  assert.equal((await run([push('alice', sha(1), sha(2), { type: 'merge_queue_merge' })], files12)).got, null);
  assert.equal((await run([push('alice', sha(1), sha(2), { type: 'force_push' })], files12)).got, null, 'a force push or reset');
  // The owner's direct push: the owner.
  assert.equal((await run([push('alice', sha(1), sha(2))], files12)).got, 'alice');
  // A branch created from a commit (not the repo's first event): no one; traced to the owner's own push: the owner.
  assert.equal((await run([push('alice', ZERO, sha(2), { type: 'branch_creation', ref: 'refs/heads/b' }), push('bob', sha(9), sha(1))], files12)).got, null);
  assert.equal((await run([push('alice', ZERO, sha(2), { type: 'branch_creation', ref: 'refs/heads/b' }), push('alice', sha(1), sha(2))], files12)).got, 'alice');
  // alice fast-forwards main onto mallory's pushed commit: mallory, never alice.
  const ff = [push('alice', sha(1), sha(3)), push('mallory', sha(1), sha(3), { ref: 'refs/heads/feature' })];
  assert.equal((await run(ff, { [sha(1)]: 'x', [sha(3)]: LINE })).got, 'mallory');
  // A first-event creation on a page that is not the whole history: no one.
  const full = [push('alice', ZERO, sha(1), { type: 'branch_creation' }), ...Array.from({ length: 49 }, () => ({ activity_type: 'branch_deletion', ref: 'refs/heads/x' }))].reverse().reverse();
  assert.equal((await run([...full.slice(1), full[0]], { [sha(1)]: LINE })).got, null);
  // ---- R4: only the owner's own fresh work.
  const files = { [sha(1)]: 'readme', [sha(2)]: LINE };
  const direct = [push('alice', sha(1), sha(2))];
  assert.equal((await run(direct, files)).got, 'alice', 'the owner pushed fresh work');
  // (a) A fork or a repo made from a template: no one.
  assert.equal((await run(direct, files, 200, { repo: { fork: true, template_repository: null, created_at: iso(T0) } })).got, null, 'a fork');
  assert.equal((await run(direct, files, 200, { repo: { fork: false, template_repository: { full_name: 'mallory/tutorial' }, created_at: iso(T0) } })).got, null, 'a template repo');
  assert.equal((await run(direct, files, 200, { repo: null })).got, null, 'no repo read');
  // (b) A local merge of mallory's branch: a two-parent commit.
  assert.equal((await run(direct, files, 200, { compare: { status: 'ahead', total_commits: 2, commits: [commit(T0 + 60_000), commit(T0 + 120_000, 2)] } })).got, null, 'a merge commit');
  // (b) A commit from before the repo existed (a cloned tutorial), or before the line was shown, or after the push.
  assert.equal((await run(direct, files, 200, { compare: { status: 'ahead', total_commits: 1, commits: [commit(T0 - 2 * 86_400_000)] } })).got, null, 'old work');
  assert.equal((await run(direct, files, 200, { issuedAt: new Date(T0 + 30 * 60_000) })).got, null, 'before the line was shown');
  assert.equal((await run(direct, files, 200, { compare: { status: 'ahead', total_commits: 1, commits: [commit(T0 + 86_400_000)] } })).got, null, 'dated after the push');
  assert.equal((await run(direct, files, 200, { issuedAt: null })).got, null, 'the line was never shown');
  assert.equal((await run(direct, files, 200, { compare: { status: 'diverged', total_commits: 1, commits: [commit(T0 + 60_000)] } })).got, null, 'not a fast-forward');
  assert.equal((await run(direct, files, 200, { compare: { status: 'ahead', total_commits: 300, commits: [commit(T0 + 60_000)] } })).got, null, 'more commits than read');
  // (c) A first-event creation an hour after the repo was made (events before it may have aged out): no one.
  const late = [push('alice', ZERO, sha(1), { type: 'branch_creation', at: T0 + 3_600_000 })];
  assert.equal((await run(late, { [sha(1)]: LINE })).got, null, 'a late first event');
  // A clone of mallory's tutorial pushed to a new repo: its history predates the repo.
  const clone = [push('alice', ZERO, sha(1), { type: 'branch_creation' })];
  assert.equal((await run(clone, { [sha(1)]: LINE }, 200, { commits: [commit(T0 - 30 * 86_400_000, 0), commit(T0 - 29 * 86_400_000)] })).got, null, 'a cloned history');
  // The build flow: degit into a new folder, commit locally (2 minutes before the repo exists), create
  // the repo under the builder's account, push: a first-event creation a minute later. The builder.
  const build = [push('alice', ZERO, sha(1), { type: 'branch_creation', at: T0 + 60_000 })];
  assert.equal((await run(build, { [sha(1)]: LINE }, 200, { commits: [commit(T0 - 120_000, 0)] })).got, 'alice', 'the build flow');
  // More reads than allowed: null, and it stops reading.
  const long = Array.from({ length: 10 }, (_, i) => push('alice', sha(i + 10), sha(i + 11))).reverse();
  const many = await run(long, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [sha(i + 10), LINE])));
  assert.equal(many.got, null);
  assert.equal(many.reads.length, PUSHER_MAX_READS);
});
