import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { GitHubError } from './match-projects';
import {
  CONTRIBUTORS_CAP,
  GitHubBudget,
  HOLDERS_CAP,
  INTEREST_CAP,
  SIGNAL_KEYS,
  canFreeze,
  rankNormalize,
  rankRound,
  SINGLE_COMMIT_FLAG,
  finalRanking,
  UNVERIFIED_PAGE_FLAG,
  readyToFreeze,
  resolveBonusWallet,
  scoreOpenRounds,
  scoreRound,
  signalsFor,
  type Signals,
  type TractionDeps,
  type TractionEntry,
  type TractionStore,
} from './traction';

const d = (s: string) => new Date(s);
const ZERO: Signals = { users: 0, liveRatio: 0, commitDays: 0, contributors: 0, interest: 0, holders: 0, marketCapUsd: 0 };
const sig = (s: Partial<Signals>): Signals => ({ ...ZERO, ...s });
const entry = (id: number, at = `2026-10-0${id}T00:00:00Z`) => ({ id, submittedAt: d(at) });

// ---- rank normalization and the score ----

test('rankNormalize: rank-based in [0, 1], the best gets 1, ties average, zero gets 0', () => {
  assert.deepEqual(rankNormalize([10, 20, 30, 40]), [0.25, 0.5, 0.75, 1]);
  // 20 and 20 share ranks 2 and 3: (2 + 3) / 2 / 4.
  assert.deepEqual(rankNormalize([10, 20, 20, 40]), [0.25, 0.625, 0.625, 1]);
  // Zero is always 0, and still takes the bottom ranks (beating zeros counts).
  assert.deepEqual(rankNormalize([0, 0, 5, 9]), [0, 0, 0.75, 1]);
  assert.deepEqual(rankNormalize([0, 0]), [0, 0]);
  assert.deepEqual(rankNormalize([3]), [1]);
  assert.deepEqual(rankNormalize([]), []);
});

test('rankRound: 40 users + 20 live + 20 shipping (commit days 3 : contributors 1) + 10 interest + 10 holders', () => {
  const only = (s: Partial<Signals>) => rankRound([entry(1)], new Map([[1, sig(s)]]))[0].score;
  assert.equal(only({ users: 1 }), 40);
  assert.equal(only({ liveRatio: 0.5 }), 20);
  assert.equal(only({ commitDays: 3 }), 15);
  assert.equal(only({ contributors: 2 }), 5);
  assert.equal(only({ interest: 1 }), 10);
  assert.equal(only({ holders: 1 }), 10);
  assert.equal(only({ users: 1, liveRatio: 1, commitDays: 1, contributors: 1, interest: 1, holders: 1 }), 100);
  assert.equal(only({ marketCapUsd: 1e9 }), 0, 'market cap carries no weight');
});

test('rankRound: all-zero users still ranks by the other signals', () => {
  const r = rankRound(
    [entry(1), entry(2), entry(3)],
    new Map([
      [1, sig({ liveRatio: 0.2, commitDays: 1 })],
      [2, sig({ liveRatio: 1, commitDays: 9, contributors: 3, holders: 40 })],
      [3, sig({ liveRatio: 0.6, commitDays: 4, contributors: 1 })],
    ]),
  );
  assert.deepEqual(r.map((x) => x.id), [2, 3, 1]);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3]);
  assert.ok(r.every((x) => x.score > 0));
});

test('rankRound: interest and holders are capped (above the cap ties)', () => {
  const r = rankRound(
    [entry(1), entry(2)],
    new Map([
      [1, sig({ interest: INTEREST_CAP + 10, holders: HOLDERS_CAP + 500, marketCapUsd: 1 })],
      [2, sig({ interest: INTEREST_CAP + 300, holders: HOLDERS_CAP + 1, marketCapUsd: 2 })],
    ]),
  );
  assert.equal(r[0].score, r[1].score, 'both at the cap: same score');
  assert.equal(r[0].id, 2, 'the exact tie goes to market cap');
});

test('rankRound: market cap only breaks exact ties, then the earlier entry', () => {
  const r = rankRound(
    [entry(1), entry(2), entry(3)],
    new Map([
      [1, sig({ users: 5, marketCapUsd: 1 })],
      [2, sig({ users: 6, marketCapUsd: 0 })],
      [3, sig({ users: 5, marketCapUsd: 1e12 })],
    ]),
  );
  // 2 has more users and wins despite no market cap; 1 and 3 tie exactly, 3's market cap wins.
  assert.deepEqual(r.map((x) => x.id), [2, 3, 1]);
  const t = rankRound(
    [entry(5, '2026-10-05T00:00:00Z'), entry(4, '2026-10-02T00:00:00Z')],
    new Map([
      [5, sig({ users: 5 })],
      [4, sig({ users: 5 })],
    ]),
  );
  assert.deepEqual(t.map((x) => x.id), [4, 5], 'same score and market cap: the earlier entry');
});

test('trading volume is not an input: Signals has exactly these fields', () => {
  assert.deepEqual([...SIGNAL_KEYS].sort(), ['commitDays', 'contributors', 'holders', 'interest', 'liveRatio', 'marketCapUsd', 'users']);
  // @ts-expect-error a volume field is not part of Signals
  const withVolume: Signals = { ...ZERO, volumeUsd: 1 };
  // An extra field smuggled in at runtime changes nothing.
  const a = rankRound([entry(1), entry(2)], new Map([[1, sig({ users: 1 })], [2, { ...withVolume, users: 1, volumeUsd: 1e9 } as Signals]]));
  assert.equal(a[0].score, a[1].score);
  assert.equal(a[0].id, 1);
});

test('canFreeze: only once the deposit index has read past the round end', () => {
  const ends = d('2026-10-15T04:00:00Z');
  assert.equal(canFreeze(ends, null), false);
  assert.equal(canFreeze(ends, { time: null }), false);
  assert.equal(canFreeze(ends, { time: ends }), false);
  assert.equal(canFreeze(ends, { time: d('2026-10-15T04:00:01Z') }), true);
});

// ---- signalsFor with injected readers ----

const ROUND = { key: 'r', starts: d('2026-10-01T00:00:00Z'), ends: d('2026-11-01T00:00:00Z') };
const NOW = d('2026-10-11T12:00:00Z');
const E: TractionEntry = {
  id: 7,
  contracts: ['0x' + '1'.repeat(40)],
  repo_url: 'https://github.com/Acme/App',
  live_url: 'https://app.example',
  coin_address: '0x' + 'c'.repeat(40),
  creator_wallet: '0x' + 'a'.repeat(40),
  payout_wallet: '0x' + 'b'.repeat(40),
  deployers: ['0x' + 'd'.repeat(40)],
  submitted_at: d('2026-10-02T00:00:00Z'),
  builder_login: 'BuilderMe',
};
const OLD = '2025-01-01T00:00:00Z';
const E18 = 10n ** 18n;
const pageOf = (path: string) => Number(/[?&]page=(\d+)/.exec(path)?.[1]);
const holder = (hash: string, value: bigint | string = 5n * E18) => ({ address: { hash }, value: String(value) });
const commit = (sha: string, login: string | null) => ({ sha, author: login ? { login } : null });

/** commit sightings and account ages in memory (the DB store's twin). */
function memStore(): TractionStore & { rows: Map<string, { day: string; login: string | null }> } {
  const accounts = new Map<string, number>();
  const rows = new Map<string, { day: string; login: string | null }>();
  const k = (r: string, p: number, s: string) => `${r}|${p}|${s}`;
  return {
    rows,
    accounts: async (ls) => new Map(ls.filter((l) => accounts.has(l)).map((l) => [l, accounts.get(l)!])),
    saveAccount: async (l, ms) => void accounts.set(l, ms),
    unseen: async (r, p, shas) => new Set(shas.filter((s) => !rows.has(k(r, p, s)))),
    record: async (r, p, day, cs) => {
      for (const c of cs) if (!rows.has(k(r, p, c.sha))) rows.set(k(r, p, c.sha), { day, login: c.login });
    },
    singleCommitStreak: async () => 0,
    stats: async (r, p) => {
      const mine = [...rows].filter(([key]) => key.startsWith(`${r}|${p}|`)).map(([, v]) => v);
      return { days: new Set(mine.map((m) => m.day)).size, contributors: new Set(mine.map((m) => m.login).filter(Boolean)).size };
    },
  };
}

const ACCOUNTS: Record<string, string> = {
  alice: OLD,
  bob: '2026-10-01T00:00:00Z', // too new at the read
  veteran: OLD,
  newbie: '2026-09-25T00:00:00Z',
  forker: OLD,
  builderme: OLD, // in the DB tests the builder's login is unknown (no installation)
};

/** A fake GitHub + Blockscout: records every call; no network. */
function fakes(over: Partial<TractionDeps> = {}, commits = () => [
  commit('s1', 'alice'),
  commit('s2', 'alice'),
  commit('s3', 'bob'),
  commit('s4', null),
  commit('s5', 'dependabot[bot]'),
]) {
  const calls = { github: [] as string[], explorer: [] as string[], users: 0, live: 0, usersArgs: [] as string[][] };
  const github = async (path: string) => {
    calls.github.push(path);
    if (path === '/repos/acme/app') return { stargazers_count: 120, forks_count: 2, owner: { login: 'acme' } };
    if (path.startsWith('/repos/acme/app/commits')) return pageOf(path) === 1 ? commits() : [];
    if (path.startsWith('/repos/acme/app/stargazers')) {
      // 120 stars: page 2 (the newest 20) is read first.
      if (pageOf(path) === 2)
        return [
          { starred_at: '2026-09-20T00:00:00Z', user: { login: 'before' } },
          { starred_at: '2026-10-04T00:00:00Z', user: { login: 'veteran' } },
          { starred_at: '2026-10-05T00:00:00Z', user: { login: 'newbie' } },
          { starred_at: '2026-10-06T00:00:00Z', user: { login: 'acme' } },
          { starred_at: '2026-10-06T00:00:00Z', user: { login: 'builderme' } },
        ];
      return [{ starred_at: '2026-01-01T00:00:00Z', user: { login: 'ancient' } }];
    }
    if (path.startsWith('/repos/acme/app/forks'))
      return [
        { created_at: '2026-10-08T00:00:00Z', owner: { login: 'forker' } },
        { created_at: '2026-10-08T00:00:00Z', owner: { login: 'Veteran' } }, // starred too: one account, once
        { created_at: '2026-09-01T00:00:00Z', owner: { login: 'oldfork' } },
      ];
    const user = /^\/users\/(.+)$/.exec(path)?.[1]?.toLowerCase();
    if (user && ACCOUNTS[user]) return { created_at: ACCOUNTS[user] };
    throw new Error(`unexpected GitHub path ${path}`);
  };
  const explorer = async (path: string) => {
    calls.explorer.push(path);
    if (path.includes('/holders'))
      return {
        items: [
          holder(E.creator_wallet!),
          holder(E.payout_wallet!),
          holder(E.deployers![0]),
          holder('0xc8a889577446153e28d42254b75238ae31ec7d57'), // the Safe
          holder('0x' + 'e'.repeat(40)), // the bonus wallet
          holder('0x498581ff718922c3f8e6a244956af099b2652b2b'), // the v4 PoolManager
          holder('0x8e845ead15737bf71904a30bddd3aee76d6adf6c'), // the Clanker vault
          holder('0x' + '2'.repeat(40), 5n * E18), // $2.50
          holder('0x' + '3'.repeat(40), 2n * E18), // $1.00
          holder('0x' + '5'.repeat(40), E18), // $0.50: dust
          holder('0x' + '4'.repeat(40), 0n),
        ],
        next_page_params: null,
      };
    return { circulating_market_cap: '12345.6', exchange_rate: '0.5', total_supply: String(10n ** 9n * E18), decimals: '18' };
  };
  const deps: TractionDeps = {
    now: NOW,
    github,
    explorer,
    store: memStore(),
    users: async (contracts) => {
      calls.users++;
      calls.usersArgs.push(contracts);
      return { score: 4, timedOut: false };
    },
    live: async () => {
      calls.live++;
      return 0.8;
    },
    excluded: ['0x' + 'e'.repeat(40)],
    ...over,
  };
  return { deps, calls };
}

test('signalsFor: each signal from its source, inside the round window', async () => {
  const { deps, calls } = fakes();
  const { signals, failed } = await signalsFor(E, ROUND, deps);
  assert.deepEqual(failed, []);
  assert.deepEqual(signals, {
    users: 4,
    liveRatio: 0.8,
    commitDays: 1, // every commit was first seen in this one read
    contributors: 1, // alice; bob is too new, the unlinked commit and the bot never count
    interest: 2, // veteran (star and fork: once) + forker; newbie is too new, acme and the builder never count
    holders: 2, // $2.50 and $1.00; the builder's, EarnKit's and Clanker's wallets never count, nor dust
    marketCapUsd: 12345.6,
  });
  const commits = calls.github.find((p) => p.startsWith('/repos/acme/app/commits'))!;
  assert.match(commits, /since=2026-10-01T00:00:00.000Z/);
  assert.match(commits, /until=2026-10-11T12:00:00.000Z/, 'until now while the round runs');
});

test('signalsFor: no contracts, no repo, no live link, no coin: zeros without a read', async () => {
  const { deps, calls } = fakes();
  const bare = { ...E, contracts: [], repo_url: null, live_url: null, coin_address: null };
  const { signals, failed } = await signalsFor(bare, ROUND, deps);
  assert.deepEqual(signals, ZERO);
  assert.deepEqual(failed, []);
  assert.deepEqual(calls.github, []);
  assert.deepEqual(calls.explorer, []);
  assert.equal(calls.users + calls.live, 0);
});

test('signalsFor: the coin and Clanker/Uniswap contracts never count as the entry\'s contracts', async () => {
  const { deps, calls } = fakes();
  const mine = '0x' + '1'.repeat(40);
  await signalsFor({ ...E, contracts: [mine, E.coin_address!, '0x498581fF718922c3f8e6A244956aF099B2652b2b', '0xE85A59c628F7d27878ACeB4bf3b35733630083a9'] }, ROUND, deps);
  assert.deepEqual(calls.usersArgs, [[mine]]);
  const { signals } = await signalsFor({ ...E, contracts: [E.coin_address!] }, ROUND, deps);
  assert.equal(signals.users, 0);
  assert.equal(calls.users, 1, 'nothing left to read');
});

test('signalsFor: holders and interest are capped; contributors cap at 10; page reads are capped', async () => {
  const many = (n: number, offset: number) => Array.from({ length: n }, (_, i) => holder('0x' + (offset + i).toString(16).padStart(40, '0')));
  let pages = 0;
  const { deps } = fakes({
    explorer: async (path: string) => {
      if (!path.includes('/holders')) return { circulating_market_cap: null, exchange_rate: '1', decimals: '18' };
      pages++;
      return { items: many(50, pages * 1000), next_page_params: { page: pages + 1 } };
    },
    github: async (path: string) => {
      if (path === '/repos/acme/app') return { stargazers_count: 100_000, forks_count: 0, owner: { login: 'acme' } };
      if (path.includes('/stargazers'))
        return Array.from({ length: 100 }, (_, i) => ({ starred_at: '2026-10-05T00:00:00Z', user: { login: `u${pageOf(path)}x${i}` } }));
      if (path.includes('/commits'))
        return pageOf(path) === 1 ? Array.from({ length: 15 }, (_, i) => commit(`c${i}`, `dev${i}`)) : [];
      if (path.includes('/forks')) return [];
      if (path.startsWith('/users/')) return { created_at: OLD };
      throw new Error(path);
    },
  });
  const { signals } = await signalsFor(E, ROUND, deps);
  assert.equal(signals.holders, HOLDERS_CAP);
  assert.equal(signals.interest, INTEREST_CAP);
  assert.equal(signals.contributors, CONTRIBUTORS_CAP);
  assert.ok(pages <= 5, `holder pages capped (${pages})`);
});

test('signalsFor: a dust airdrop counts 0 holders; a coin without a price has 0 holders (Ruling 15)', async () => {
  const airdrop = Array.from({ length: 300 }, (_, i) => holder('0x' + (i + 1).toString(16).padStart(40, '0'), 10n ** 15n));
  const { deps } = fakes({
    explorer: async (path: string) =>
      path.includes('/holders') ? { items: airdrop, next_page_params: null } : { exchange_rate: '0.5', decimals: '18', total_supply: String(10n ** 9n * E18) },
  });
  assert.equal((await signalsFor(E, ROUND, deps)).signals.holders, 0, '$0.0005 each');
  // No price: 0, however large the balances, and the holder list isn't read.
  const whales = [holder('0x' + '9'.repeat(40), 10n ** 8n * E18), holder('0x' + '8'.repeat(40), 10n ** 7n * E18)];
  const unpriced = fakes({
    explorer: async (path: string) =>
      path.includes('/holders')
        ? { items: whales, next_page_params: null }
        : { exchange_rate: null, circulating_market_cap: null, decimals: '18', total_supply: String(10n ** 9n * E18) },
  });
  const r = await signalsFor(E, ROUND, unpriced.deps);
  assert.equal(r.signals.holders, 0);
  assert.deepEqual(r.failed, []);
  assert.ok(!unpriced.calls.explorer.some((p) => p.includes('/holders')));
});

test('signalsFor: a failed source keeps its previous value and is reported; the others still read', async () => {
  const { deps } = fakes({
    github: async () => {
      throw new Error('GitHub down');
    },
  });
  const prev = sig({ commitDays: 2, contributors: 1, interest: 3 });
  const { signals, failed } = await signalsFor(E, ROUND, { ...deps, previous: prev });
  assert.deepEqual(failed, ['github']);
  assert.equal(signals.commitDays, 2);
  assert.equal(signals.interest, 3);
  assert.equal(signals.users, 4);
});

test('signalsFor: an empty repo (409), a legal block (451) or a missing sub-resource (404) is no activity, not a failure', async () => {
  for (const [where, status] of [['/commits', 409], ['/repos/acme/app', 451], ['/stargazers', 404], ['/forks', 404]] as const) {
    const base = fakes();
    const { deps } = fakes({
      github: async (path: string, accept, budget) => {
        if (where === '/repos/acme/app' ? path === where : path.includes(where)) throw new GitHubError('nope', status);
        return base.deps.github!(path, accept, budget);
      },
    });
    const { failed, signals } = await signalsFor(E, ROUND, deps);
    assert.deepEqual(failed, [], `${where} ${status}`);
    if (status === 451) assert.equal(signals.commitDays + signals.interest, 0);
  }
});

test('signalsFor: GitHub reads stop below 1000 requests left (the budget is shared by the run)', async () => {
  const budget = new GitHubBudget();
  const { deps, calls } = fakes();
  const github = async (path: string, accept: string | undefined, b: GitHubBudget) => {
    b.note('999');
    return deps.github!(path, accept, b);
  };
  const a = await signalsFor(E, ROUND, { ...deps, github, budget });
  assert.deepEqual(a.failed, ['github']);
  assert.equal(calls.github.length, 1, 'stopped after the response that said 999 left');
  const b = await signalsFor({ ...E, id: 8 }, ROUND, { ...deps, github, budget, previous: sig({ commitDays: 4 }) });
  assert.deepEqual(b.failed, ['github']);
  assert.equal(b.signals.commitDays, 4, 'kept, retried next run');
  assert.equal(calls.github.length, 1, 'no GitHub call for the next entry');
  // Plenty left: no stop (and a missing header changes nothing).
  const ok = new GitHubBudget();
  ok.note(null);
  ok.note('4999');
  assert.deepEqual((await signalsFor(E, ROUND, { ...deps, budget: ok })).failed, []);
});

test('signalsFor: commit days are built read by read; a backdated last-day push counts as one day', async () => {
  let list = [commit('a1', 'alice'), commit('a2', 'alice')];
  const store = memStore();
  const { deps } = fakes({ store }, () => list);
  const days = async (now: string) => (await signalsFor(E, ROUND, { ...deps, now: d(now) })).signals.commitDays;
  assert.equal(await days('2026-10-11T12:00:00Z'), 1);
  assert.equal(await days('2026-10-11T18:00:00Z'), 1, 'the same day again: nothing new');
  list = [...list, commit('b1', 'alice')];
  assert.equal(await days('2026-10-12T12:00:00Z'), 2);
  assert.equal(await days('2026-10-13T12:00:00Z'), 2, 'a day with no new commits adds nothing');
  // After the end, 30 commits appear, dated all over the round: one day, the round's last.
  list = [...list, ...Array.from({ length: 30 }, (_, i) => commit(`late${i}`, 'alice'))];
  assert.equal(await days('2026-11-01T01:00:00Z'), 3);
  assert.equal(store.rows.get('r|7|late0')?.day, '2026-10-31');
  assert.equal(await days('2026-11-02T01:00:00Z'), 3);
});

test('resolveBonusWallet: EARNKIT_BONUS_WALLET, else the payout key once, else none (never throws)', () => {
  const w = '0x77C0000000000000000000000000000000006975'.toLowerCase();
  assert.deepEqual(resolveBonusWallet({ EARNKIT_BONUS_WALLET: w }), [w]);
  const key = '0x' + '11'.repeat(32);
  assert.equal(resolveBonusWallet({ CAMPAIGN_PAYOUT_PRIVATE_KEY: key }).length, 1);
  assert.deepEqual(resolveBonusWallet({ CAMPAIGN_PAYOUT_PRIVATE_KEY: 'not a key' }), []);
  assert.deepEqual(resolveBonusWallet({}), []);
});

// ---- DB-gated: daily scoring, caching and the freeze ----
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
holdBonusDbLock();
const PID = 't6-traction';

async function setup() {
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
      status, existing_work, starts_at, ends_at, submission_proof)
    VALUES (${PID}, 'X', 'T6', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed',
      ${ROUND.starts}, ${ROUND.ends}, ${sql().json({ host: 'x.example' })})`;
  await sql()`INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at) VALUES (${PID}, ${PID}, ${ROUND.starts}, ${ROUND.ends})`;
  let n = 0;
  const add = async (
    name: string,
    eligible: boolean,
    coin: string | null,
    repo = `https://github.com/acme/${name}`,
    at = E.submitted_at,
    contracts = ['0x' + String(++n).padStart(40, '0')],
  ) => {
    const [r] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, live_url, contracts, coin_address, coin_launched_at, creator_wallet,
        submission_proof_ok_at, submitted_at, bonus_repo_key)
      VALUES (${PID}, ${name}, 'https://github.com/acme/app', 'https://app.example', ${contracts}, ${coin}, ${coin ? at : null},
        ${E.creator_wallet}, ${eligible ? NOW : null}, ${at}, ${repo.replace('https://', '')})
      RETURNING id`;
    return r.id;
  };
  const a = await add('a', true, '0x' + 'c1'.repeat(20));
  const b = await add('b', true, '0x' + 'c2'.repeat(20));
  const noProof = await add('no-proof', false, '0x' + 'c3'.repeat(20));
  const noCoin = await add('no-coin', true, null);
  // The same repo as a, entered later: recorded, never eligible (Ruling 13b).
  const dup = await add('dup', true, '0x' + 'c4'.repeat(20), 'https://github.com/acme/a', d('2026-10-03T00:00:00Z'));
  // Ruling 15: earlier INELIGIBLE rows of a repo never block it: a squatter's (b's repo, no coin
  // or proof) and the builder's own earlier failed attempt (a's repo, proof failed, no coin).
  const squatter = await add('squatter', false, null, 'https://github.com/acme/b', d('2026-10-01T00:00:00Z'));
  const attempt = await add('attempt', false, null, 'https://github.com/acme/a', d('2026-10-01T12:00:00Z'));
  return { a, b, noProof, noCoin, dup, squatter, attempt, add };
}
async function cleanup() {
  await sql()`DELETE FROM github_users WHERE login IN ${sql()(Object.keys(ACCOUNTS))}`;
  await sql()`DELETE FROM bonus_scores WHERE round_key = ${PID}`;
  await sql()`DELETE FROM bonus_commits WHERE round_key = ${PID}`;
  await sql()`DELETE FROM live_checks WHERE project_id IN (SELECT id FROM projects WHERE program_id = ${PID})`;
  await sql()`DELETE FROM projects WHERE program_id = ${PID}`;
  await sql()`DELETE FROM bonus_rounds WHERE program_id = ${PID}`;
  await sql()`DELETE FROM programs WHERE id = ${PID}`;
}
const dbFakes = (over: Partial<TractionDeps> = {}) => fakes({ live: undefined, probe: async () => true, store: undefined, ...over });

test('scoreRound: only eligible entries (one per repo); GitHub, explorer and users read at most once per entry per day', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    const { deps, calls } = dbFakes();
    const first = await scoreRound(PID, deps);
    assert.deepEqual(
      new Set(first.map((r) => r.id)),
      new Set([ids.a, ids.b]),
      'no coin, no proof or a later duplicate of an eligible repo: not ranked; an earlier squatter or failed attempt blocks nothing',
    );
    assert.deepEqual(first.map((r) => r.rank), [1, 2]);
    const githubAfterFirst = calls.github.length;
    assert.equal(calls.github.filter((p) => p === '/repos/acme/app').length, 2, 'one GitHub call set per entry');
    assert.equal(calls.github.filter((p) => p === '/users/alice').length, 1, 'an account is read once, then kept');

    const again = await scoreRound(PID, { ...deps, now: new Date(NOW.getTime() + 3 * 3_600_000) });
    assert.deepEqual(again, first);
    assert.equal(calls.github.length, githubAfterFirst, 'no new GitHub calls the same day');
    assert.equal(calls.users, 2);

    await scoreRound(PID, { ...deps, now: new Date(NOW.getTime() + 86_400_000) });
    assert.equal(calls.github.filter((p) => p === '/repos/acme/app').length, 4);
    assert.equal(calls.github.filter((p) => p === '/users/alice').length, 1, 'account ages persist across days');
    assert.equal(calls.users, 4);

    const rows = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM bonus_scores WHERE round_key = ${PID}`;
    assert.equal(rows[0].n, 4);
    const probes = await sql()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM live_checks WHERE project_id IN (${ids.a}, ${ids.b})`;
    assert.equal(probes[0].n, 4, 'one live probe per entry per day');
  } finally {
    await cleanup();
  }
});

test('scoreRound: a failed probe is retried later the same day and the day turns ok; ratio over at least 7 days', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    let up = false;
    let probes = 0;
    const { deps } = dbFakes({ probe: async () => (probes++, up) });
    const late = { ...deps, now: d('2026-10-02T12:00:00Z') }; // the entries' first day
    const ratio = async () =>
      (await sql()<{ r: number }[]>`SELECT (signals->>'liveRatio')::float AS r FROM bonus_scores WHERE project_id = ${ids.a} ORDER BY day DESC LIMIT 1`)[0].r;
    await scoreRound(PID, late);
    assert.equal(await ratio(), 0);
    up = true;
    await scoreRound(PID, { ...late, now: d('2026-10-02T13:00:00Z') });
    assert.equal(probes, 4, 're-probed once each');
    assert.equal(await ratio(), 1 / 7, 'one ok day over the 7-day minimum');
    const [row] = await sql()<{ ok: boolean }[]>`SELECT ok FROM live_checks WHERE project_id = ${ids.a}`;
    assert.equal(row.ok, true);
    await scoreRound(PID, { ...late, now: d('2026-10-02T14:00:00Z') });
    assert.equal(probes, 4, 'an ok day is never probed again');
  } finally {
    await cleanup();
  }
});

test('scoreRound: at most maxEntries reads per run, oldest read first; the rest wait for the next run', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    const { deps, calls } = dbFakes({ maxEntries: 1 });
    const one = await scoreRound(PID, deps);
    assert.deepEqual(one.map((r) => r.id), [ids.a]);
    const two = await scoreRound(PID, { ...deps, now: new Date(NOW.getTime() + 3_600_000) });
    assert.equal(two.length, 2);
    assert.equal(calls.users, 2);
    await scoreRound(PID, { ...deps, now: new Date(NOW.getTime() + 86_400_000) });
    assert.equal(calls.usersArgs.length, 3, 'next day: one read, the oldest');
  } finally {
    await cleanup();
  }
});

test('scoreRound: a failed source is retried on the next run that day, alone', db, async () => {
  await cleanup();
  try {
    await setup();
    let down = true;
    const { deps, calls } = dbFakes();
    const flaky = {
      ...deps,
      github: async (p: string, a: string | undefined, b: GitHubBudget) => {
        if (down) throw new Error('GitHub down');
        return deps.github!(p, a, b);
      },
    };
    await scoreRound(PID, flaky);
    assert.equal(calls.users, 2);
    down = false;
    await scoreRound(PID, { ...flaky, now: new Date(NOW.getTime() + 3_600_000) });
    assert.equal(calls.users, 2, 'users were not read again');
    assert.equal(calls.github.filter((p) => p === '/repos/acme/app').length, 2, 'GitHub retried once per entry');
    await scoreRound(PID, { ...flaky, now: new Date(NOW.getTime() + 2 * 3_600_000) });
    assert.equal(calls.github.filter((p) => p === '/repos/acme/app').length, 2, 'then cached');
  } finally {
    await cleanup();
  }
});

test('scoreRound: after the end, one final read covering the whole window, then cached', db, async () => {
  await cleanup();
  try {
    await setup();
    const { deps, calls } = dbFakes();
    await scoreRound(PID, { ...deps, now: d('2026-10-31T20:00:00Z') });
    await scoreRound(PID, { ...deps, now: d('2026-10-31T23:30:00Z') }); // the same UTC day, still before the end
    assert.equal(calls.users, 2, 'same day before the end: cached');
    await scoreRound(PID, { ...deps, now: d('2026-11-01T01:00:00Z') });
    assert.equal(calls.users, 4, 'after the end: one final read');
    const commits = calls.github.filter((p) => p.includes('/commits')).at(-1)!;
    assert.match(commits, /until=2026-11-01T00:00:00.000Z/, 'the final read stops at the end');
    await scoreRound(PID, { ...deps, now: d('2026-11-02T01:00:00Z') });
    assert.equal(calls.users, 4, 'final scores are never read again');
    const [r] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM live_checks WHERE day >= '2026-11-01'`;
    assert.equal(r.n, 0, 'no live probe after the round');
  } finally {
    await cleanup();
  }
});

test('readyToFreeze: index past the end and every entry final; 24h after the end, failed sources stop holding it (flagged)', db, async () => {
  await cleanup();
  const [saved] = await sql()<{ block: string | null; block_time: Date | null }[]>`SELECT block, block_time FROM bonus_cursor WHERE id = 'weth'`;
  const cursor = (t: Date) => sql()`
    INSERT INTO bonus_cursor (id, block, block_time) VALUES ('weth', 1, ${t})
    ON CONFLICT (id) DO UPDATE SET block = 1, block_time = ${t}`;
  try {
    const ids = await setup();
    await cursor(d('2026-11-01T00:30:00Z'));
    const before = await readyToFreeze(PID, d('2026-11-01T00:40:00Z'));
    assert.deepEqual(before, { ready: false, pending: [ids.a, ids.b], flagged: [] }, 'no final reads yet');

    // Final reads after the end; b's GitHub keeps failing (e.g. the repo became unreadable).
    const { deps } = dbFakes();
    let failB = false;
    const github = async (p: string, a: string | undefined, bud: GitHubBudget) => {
      if (p === '/repos/acme/app' && failB) throw new Error('GitHub down');
      return deps.github!(p, a, bud);
    };
    await scoreRound(PID, { ...deps, now: d('2026-11-01T01:00:00Z'), maxEntries: 1 }); // a
    failB = true;
    await scoreRound(PID, { ...deps, github, now: d('2026-11-01T02:00:00Z') }); // b, failing
    const held = await readyToFreeze(PID, d('2026-11-01T03:00:00Z'));
    assert.deepEqual(held, { ready: false, pending: [ids.b], flagged: [] });
    const escaped = await readyToFreeze(PID, d('2026-11-02T00:00:01Z'));
    assert.deepEqual(escaped, { ready: true, pending: [], flagged: [ids.b] });

    // The index hasn't read past the end: never ready.
    await cursor(d('2026-10-31T23:59:59Z'));
    assert.equal((await readyToFreeze(PID, d('2026-11-03T00:00:00Z'))).ready, false);
    // All final and clean: ready once the index is past the end.
    failB = false;
    await scoreRound(PID, { ...deps, github, now: d('2026-11-01T04:00:00Z') });
    await cursor(d('2026-11-01T00:00:01Z'));
    assert.deepEqual(await readyToFreeze(PID, d('2026-11-01T05:00:00Z')), { ready: true, pending: [], flagged: [] });
  } finally {
    if (saved) await sql()`UPDATE bonus_cursor SET block = ${saved.block}, block_time = ${saved.block_time} WHERE id = 'weth'`;
    else await sql()`DELETE FROM bonus_cursor WHERE id = 'weth'`;
    await cleanup();
  }
});

test('scoreRound (Ruling 15): a contract backs only the earliest eligible entry of the program', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    const shared = '0x' + 'f'.repeat(40);
    const mine = '0x' + 'e1'.repeat(20);
    // Later than a and b, claiming a's contract too; an ineligible earlier row claiming it holds nothing.
    await ids.add('early-ineligible', false, null, 'https://github.com/acme/x', d('2026-09-30T00:00:00Z'), [shared]);
    const first = await ids.add('first', true, '0x' + 'c5'.repeat(20), 'https://github.com/acme/first', d('2026-10-02T06:00:00Z'), [shared]);
    const later = await ids.add('later', true, '0x' + 'c6'.repeat(20), 'https://github.com/acme/later', d('2026-10-04T00:00:00Z'), [shared, mine]);
    const { deps, calls } = dbFakes();
    const seen = new Map<string, string[]>();
    await scoreRound(PID, {
      ...deps,
      users: async (contracts) => {
        seen.set(contracts.join(','), contracts);
        calls.users++;
        return { score: contracts.length, timedOut: false };
      },
    });
    assert.ok(seen.has(shared), 'the earliest eligible entry keeps it');
    assert.ok(seen.has(mine), 'the later one keeps only its own');
    assert.ok(![...seen.keys()].some((k) => k.includes(shared) && k.includes(mine)));
    const users = async (id: number) =>
      (await sql()<{ u: number }[]>`SELECT (signals->>'users')::int AS u FROM bonus_scores WHERE project_id = ${id}`)[0].u;
    assert.equal(await users(first), 1);
    assert.equal(await users(later), 1);
  } finally {
    await cleanup();
  }
});

test('scoreOpenRounds: one entry allowance for the whole run, across rounds', db, async () => {
  await cleanup();
  const P2 = `${PID}-2`;
  try {
    await setup();
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
        status, existing_work, starts_at, ends_at, submission_proof)
      VALUES (${P2}, 'X', 'T6b', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed',
        ${ROUND.starts}, ${ROUND.ends}, ${sql().json({ host: 'x.example' })})`;
    await sql()`INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at) VALUES (${P2}, ${P2}, ${ROUND.starts}, ${ROUND.ends})`;
    await sql()`INSERT INTO projects (program_id, name, repo_url, contracts, coin_address, coin_launched_at, submission_proof_ok_at, submitted_at)
      VALUES (${P2}, 'z', 'https://github.com/acme/app', ${['0x' + '7'.repeat(40)]}, ${'0x' + 'c9'.repeat(20)}, ${NOW}, ${NOW}, ${E.submitted_at})`;
    const { deps, calls } = dbFakes({ maxEntries: 2 });
    const only = [PID, P2];
    const out = await scoreOpenRounds({ ...deps, only });
    assert.equal(calls.users, 2, 'two reads in all, not two per round');
    assert.equal(out.length, 2);
    await scoreOpenRounds({ ...deps, only, now: new Date(NOW.getTime() + 3_600_000) });
    assert.equal(calls.users, 3, 'the next run reads the one left');
  } finally {
    await sql()`DELETE FROM bonus_scores WHERE round_key = ${P2}`;
    await sql()`DELETE FROM bonus_commits WHERE round_key = ${P2}`;
    await sql()`DELETE FROM projects WHERE program_id = ${P2}`;
    await sql()`DELETE FROM bonus_rounds WHERE program_id = ${P2}`;
    await sql()`DELETE FROM programs WHERE id = ${P2}`;
    await cleanup();
  }
});

test('scoreRound: 7+ days in a row with exactly one new commit each is flagged for the review (never scored)', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    const seed = async (id: number, days: string[]) => {
      for (const [i, day] of days.entries())
        await sql()`INSERT INTO bonus_commits (round_key, project_id, sha, day, login) VALUES (${PID}, ${id}, ${`seed${id}-${i}`}, ${day}, null)`;
    };
    const week = (from: number, n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(from + i).padStart(2, '0')}`);
    await seed(ids.a, week(1, 7)); // Oct 1-7, one a day
    await seed(ids.b, [...week(1, 6), '2026-10-08']); // a gap on Oct 7: 6 in a row
    const { deps } = dbFakes();
    const ranked = await scoreRound(PID, deps);
    const flags = async (id: number) =>
      (await sql()<{ f: string[] }[]>`SELECT review_flags AS f FROM bonus_scores WHERE project_id = ${id}`)[0].f;
    assert.deepEqual(await flags(ids.a), [SINGLE_COMMIT_FLAG]);
    assert.deepEqual(await flags(ids.b), []);
    // Shown, not scored: a's flag changes nothing in its signals.
    assert.equal(ranked.length, 2);
  } finally {
    await cleanup();
  }
});

test('eligibility is frozen at the round end (Ruling 16): a coin or proof after it never counts; finalRanking re-ranks', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    const late = await ids.add('late-coin', true, '0x' + 'ca'.repeat(20), 'https://github.com/acme/late', d('2026-10-03T00:00:00Z'));
    const { deps } = dbFakes();
    // Final reads after the end, while every entry still looks eligible.
    await scoreRound(PID, { ...deps, now: d('2026-11-01T01:00:00Z') });
    const all = await finalRanking(PID);
    assert.deepEqual(new Set(all.map((r) => r.id)), new Set([ids.a, ids.b, late]));
    assert.ok(all.every((r) => r.flagged === false && Array.isArray(r.review_flags)));
    // The late entry's coin actually launched after the end; b's proof checked out only after it.
    await sql()`UPDATE projects SET coin_launched_at = ${d('2026-11-01T00:00:01Z')} WHERE id = ${late}`;
    await sql()`UPDATE projects SET submission_proof_ok_at = ${d('2026-11-01T00:00:00Z')} WHERE id = ${ids.b}`;
    const final = await finalRanking(PID);
    assert.deepEqual(final.map((r) => [r.id, r.rank]), [[ids.a, 1]], 'stored ranks of displaced entries are never read');
    const [stored] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM bonus_scores WHERE round_key = ${PID} AND rank IS NOT NULL`;
    assert.equal(stored.n, 3, 'their stored ranks still exist');
    // readyToFreeze applies the same rule: only a is waited for.
    await sql()`UPDATE bonus_scores SET failed = '{github}' WHERE project_id IN (${ids.b}, ${late})`;
    assert.deepEqual((await readyToFreeze(PID, d('2026-11-01T02:00:00Z'))).pending, []);
    // A coin launched after the end never holds a contract either: a later eligible entry keeps it.
    assert.equal((await scoreRound(PID, { ...deps, now: d('2026-11-01T03:00:00Z') })).length, 1);
  } finally {
    await cleanup();
  }
});

test('Ruling 4 (plan): an entry counted on an unverified page carries the review flag, never flagged', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    await sql()`UPDATE projects SET submission_basis = 'unverified_page', submission_confirmed_at = ${NOW} WHERE id = ${ids.b}`;
    await sql()`UPDATE projects SET submission_basis = 'confirmed', submission_confirmed_at = ${NOW} WHERE id = ${ids.a}`;
    const { deps } = dbFakes();
    await scoreRound(PID, { ...deps, now: d('2026-11-01T01:00:00Z') });
    const final = await finalRanking(PID);
    const b = final.find((r) => r.id === ids.b)!;
    const a = final.find((r) => r.id === ids.a)!;
    assert.equal(UNVERIFIED_PAGE_FLAG, 'unverified_page');
    assert.ok(b.review_flags.includes('unverified_page'));
    assert.equal(b.flagged, false);
    assert.deepEqual(a.review_flags, [], 'a builder-confirmed entry without a page carries no flag');
    assert.equal(a.flagged, false);
    // No final read at all: it keeps the flag next to no_final_read.
    await sql()`DELETE FROM bonus_scores WHERE round_key = ${PID} AND project_id = ${ids.b}`;
    const unread = (await finalRanking(PID)).find((r) => r.id === ids.b)!;
    assert.deepEqual(unread.review_flags, ['no_final_read', 'unverified_page']);
  } finally {
    await cleanup();
  }
});

test('v2.6 Ruling 6 (plan): an owner test installation (EARNKIT_TEST_INSTALLATIONS) is never eligible, and never blocks a later real entry on the same repo', db, async () => {
  const PID3 = 't6-test-installations';
  const r3 = { starts: d('2026-10-01T00:00:00Z'), ends: d('2026-11-01T00:00:00Z') };
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
      status, existing_work, starts_at, ends_at)
    VALUES (${PID3}, 'X', 'T6c', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', ${r3.starts}, ${r3.ends})`;
  await sql()`INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at) VALUES (${PID3}, ${PID3}, ${r3.starts}, ${r3.ends})`;
  const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${PID3}) RETURNING id`;
  const add = async (name: string, installationId: number | null, repo: string, at: Date) => {
    const [row] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, contracts, coin_address, coin_launched_at, installation_id,
        submission_proof_ok_at, submitted_at, bonus_repo_key)
      VALUES (${PID3}, ${name}, ${`https://github.com/acme/${name}`}, ${['0x' + name.padEnd(40, '0').slice(0, 40)]},
        ${'0x' + name.padEnd(40, 'a').slice(0, 40)}, ${at}, ${installationId}, ${at}, ${at}, ${repo})
      RETURNING id`;
    return row.id;
  };
  try {
    // Pair 1: different repos, one from the test installation.
    const real1 = await add('real1', null, 'acme/real1', d('2026-10-02T00:00:00Z'));
    const test1 = await add('test1', inst.id, 'acme/test1', d('2026-10-02T00:00:00Z'));
    // Pair 2: same repo, the test installation's entry EARLIER (would otherwise block, Ruling 15).
    const real2 = await add('real2', null, 'acme/shared', d('2026-10-05T00:00:00Z'));
    const test2 = await add('test2', inst.id, 'acme/shared', d('2026-10-03T00:00:00Z'));
    delete process.env.EARNKIT_TEST_INSTALLATIONS;
    const before = new Set((await finalRanking(PID3)).map((r) => r.id));
    assert.deepEqual(before, new Set([real1, test1, test2])); // real2 is blocked by the earlier test2, as normal
    process.env.EARNKIT_TEST_INSTALLATIONS = String(inst.id);
    const after = new Set((await finalRanking(PID3)).map((r) => r.id));
    assert.deepEqual(after, new Set([real1, real2]), 'the test installation is excluded, and never blocks real2 either');
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
    await sql()`DELETE FROM bonus_scores WHERE round_key = ${PID3}`;
    await sql()`DELETE FROM projects WHERE program_id = ${PID3}`;
    await sql()`DELETE FROM bonus_rounds WHERE program_id = ${PID3}`;
    await sql()`DELETE FROM installations WHERE id = ${inst.id}`;
    await sql()`DELETE FROM programs WHERE id = ${PID3}`;
  }
});
