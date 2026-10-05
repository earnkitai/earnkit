import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import {
  HOLDERS_CAP,
  INTEREST_CAP,
  SIGNAL_KEYS,
  canFreeze,
  rankNormalize,
  rankRound,
  scoreRound,
  signalsFor,
  type Signals,
  type TractionDeps,
  type TractionEntry,
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
};
const OLD = '2025-01-01T00:00:00Z';
const pageOf = (path: string) => Number(/[?&]page=(\d+)/.exec(path)?.[1]);
const holder = (hash: string, value = '1') => ({ address: { hash }, value });

/** A fake GitHub + Blockscout: records every call; no network. */
function fakes(over: Partial<TractionDeps> = {}) {
  const calls = { github: [] as string[], explorer: [] as string[], users: 0, live: 0 };
  const github = async (path: string) => {
    calls.github.push(path);
    if (path === '/repos/acme/app') return { stargazers_count: 120, forks_count: 2, owner: { login: 'acme' } };
    if (path.startsWith('/repos/acme/app/commits')) {
      if (pageOf(path) !== 1) return [];
      return [
        { commit: { author: { date: '2026-10-03T10:00:00Z', email: 'a@x' } }, author: { login: 'alice' } },
        { commit: { author: { date: '2026-10-03T18:00:00Z', email: 'a@x' } }, author: { login: 'alice' } },
        { commit: { author: { date: '2026-10-05T10:00:00Z', email: 'b@x' } }, author: { login: 'bob' } },
        { commit: { author: { date: '2026-10-06T10:00:00Z', email: 'n@x' } }, author: null },
        { commit: { author: { date: '2026-10-07T10:00:00Z', email: 'bot@x' } }, author: { login: 'dependabot[bot]' } },
      ];
    }
    if (path.startsWith('/repos/acme/app/stargazers')) {
      // 120 stars: page 2 (the newest 20) is read first.
      if (pageOf(path) === 2)
        return [
          { starred_at: '2026-09-20T00:00:00Z', user: { login: 'before' } },
          { starred_at: '2026-10-04T00:00:00Z', user: { login: 'veteran' } },
          { starred_at: '2026-10-05T00:00:00Z', user: { login: 'newbie' } },
          { starred_at: '2026-10-06T00:00:00Z', user: { login: 'acme' } },
        ];
      return [{ starred_at: '2026-01-01T00:00:00Z', user: { login: 'ancient' } }];
    }
    if (path.startsWith('/repos/acme/app/forks'))
      return [
        { created_at: '2026-10-08T00:00:00Z', owner: { login: 'forker' } },
        { created_at: '2026-09-01T00:00:00Z', owner: { login: 'oldfork' } },
      ];
    if (path === '/users/veteran' || path === '/users/forker') return { created_at: OLD };
    if (path === '/users/newbie') return { created_at: '2026-09-25T00:00:00Z' };
    throw new Error(`unexpected GitHub path ${path}`);
  };
  const explorer = async (path: string) => {
    calls.explorer.push(path);
    if (path.includes('/holders'))
      return {
        items: [
          holder(E.creator_wallet!),
          holder('0xc8a889577446153e28d42254b75238ae31ec7d57'),
          holder('0x' + 'e'.repeat(40)), // the bonus wallet (excluded)
          holder('0x498581ff718922c3f8e6a244956af099b2652b2b'), // the v4 PoolManager
          holder('0x' + '2'.repeat(40)),
          holder('0x' + '3'.repeat(40)),
          holder('0x' + '4'.repeat(40), '0'),
        ],
        next_page_params: null,
      };
    return { circulating_market_cap: '12345.6', exchange_rate: null, total_supply: null, decimals: '18' };
  };
  const deps: TractionDeps = {
    now: NOW,
    github,
    explorer,
    users: async () => {
      calls.users++;
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
    commitDays: 3, // 10-03 (twice), 10-05, 10-06; a bot's commit never counts
    contributors: 3, // alice, bob and the unlinked n@x; never the bot
    interest: 2, // veteran's star + forker's fork; newbie is too new, acme owns it, the rest are outside the window
    holders: 2,
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
  assert.deepEqual(calls, { github: [], explorer: [], users: 0, live: 0 });
});

test('signalsFor: holders and interest are capped; page reads are capped', async () => {
  const many = (n: number, offset: number) => Array.from({ length: n }, (_, i) => holder('0x' + (offset + i).toString(16).padStart(40, '0')));
  let pages = 0;
  const { deps, calls } = fakes({
    explorer: async (path: string) => {
      if (!path.includes('/holders')) return { circulating_market_cap: null };
      pages++;
      return { items: many(50, pages * 1000), next_page_params: { page: pages + 1 } };
    },
    github: async (path: string) => {
      if (path === '/repos/acme/app') return { stargazers_count: 100_000, forks_count: 0, owner: { login: 'acme' } };
      if (path.includes('/stargazers'))
        return Array.from({ length: 100 }, (_, i) => ({ starred_at: '2026-10-05T00:00:00Z', user: { login: `u${path}${i}` } }));
      if (path.includes('/forks') || path.includes('/commits')) return [];
      if (path.startsWith('/users/')) return { created_at: OLD };
      throw new Error(path);
    },
  });
  const { signals } = await signalsFor(E, ROUND, deps);
  assert.equal(signals.holders, HOLDERS_CAP);
  assert.equal(signals.interest, INTEREST_CAP);
  assert.ok(pages <= 5, `holder pages capped (${pages})`);
  void calls;
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

// ---- DB-gated: daily scoring and caching ----
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
  const add = async (name: string, eligible: boolean, coin: string | null) => {
    const [r] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, live_url, contracts, coin_address, creator_wallet,
        submission_proof_ok_at, submitted_at)
      VALUES (${PID}, ${name}, 'https://github.com/acme/app', 'https://app.example', ${[E.contracts![0]]}, ${coin},
        ${E.creator_wallet}, ${eligible ? NOW : null}, ${E.submitted_at})
      RETURNING id`;
    return r.id;
  };
  const a = await add('a', true, '0x' + 'c1'.repeat(20));
  const b = await add('b', true, '0x' + 'c2'.repeat(20));
  const noProof = await add('no-proof', false, '0x' + 'c3'.repeat(20));
  const noCoin = await add('no-coin', true, null);
  return { a, b, noProof, noCoin };
}
async function cleanup() {
  await sql()`DELETE FROM bonus_scores WHERE round_key = ${PID}`;
  await sql()`DELETE FROM live_checks WHERE project_id IN (SELECT id FROM projects WHERE program_id = ${PID})`;
  await sql()`DELETE FROM projects WHERE program_id = ${PID}`;
  await sql()`DELETE FROM bonus_rounds WHERE program_id = ${PID}`;
  await sql()`DELETE FROM programs WHERE id = ${PID}`;
}

test('scoreRound: only eligible entries; GitHub, explorer and users read at most once per entry per day', db, async () => {
  await cleanup();
  try {
    const ids = await setup();
    const { deps, calls } = fakes({ live: undefined, probe: async () => true });
    const first = await scoreRound(PID, deps);
    assert.deepEqual(new Set(first.map((r) => r.id)), new Set([ids.a, ids.b]), 'no coin or no proof: not ranked');
    assert.deepEqual(first.map((r) => r.rank), [1, 2]);
    const githubAfterFirst = calls.github.length;
    const repoReads = calls.github.filter((p) => p === '/repos/acme/app').length;
    assert.equal(repoReads, 2, 'one GitHub call set per entry');

    // Same day, later: everything comes from bonus_scores.
    const again = await scoreRound(PID, { ...deps, now: new Date(NOW.getTime() + 3 * 3_600_000) });
    assert.deepEqual(again, first);
    assert.equal(calls.github.length, githubAfterFirst, 'no new GitHub calls the same day');
    assert.equal(calls.users, 2);

    // The next day: read again, once.
    await scoreRound(PID, { ...deps, now: new Date(NOW.getTime() + 86_400_000) });
    assert.equal(calls.github.filter((p) => p === '/repos/acme/app').length, 4);
    assert.equal(calls.users, 4);

    const rows = await sql()<{ project_id: number; day: string; score: number; rank: number }[]>`
      SELECT project_id, day::text, score, rank FROM bonus_scores WHERE round_key = ${PID} ORDER BY day, rank`;
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.rank >= 1 && r.score >= 0));
    const probes = await sql()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM live_checks WHERE project_id IN (${ids.a}, ${ids.b})`;
    assert.equal(probes[0].n, 4, 'one live probe per entry per day');
  } finally {
    await cleanup();
  }
});

test('scoreRound: a failed source is retried on the next run that day, alone', db, async () => {
  await cleanup();
  try {
    await setup();
    let down = true;
    const { deps, calls } = fakes({ live: undefined, probe: async () => true });
    const flaky = { ...deps, github: async (p: string) => {
      if (down) throw new Error('GitHub down');
      return deps.github!(p);
    } };
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
    const { deps, calls } = fakes({ live: undefined, probe: async () => true });
    const lastDay = d('2026-10-31T20:00:00Z');
    await scoreRound(PID, { ...deps, now: lastDay });
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
