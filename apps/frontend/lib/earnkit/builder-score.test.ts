import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { HOLD, SCORE_SLICE, buildInputs, siteShowsUse, emptyReason, holdReason, percentiles, profileEmpty, publicScore, scoreBuilders, scoreSliceEnd, scoresAdminKey, scoresPost, sourceShares, type ReadingRow, type SourceRow } from './builder-score';
import { ScoreDeadline } from './campaigns';
import { discover, proofLineCheck, provenLogin } from './discovery';
import { oneParam } from './http';
import { profileCode } from './discovery-clues';
import { computeScore } from './score';
import { calibration } from './score-calibration';
import { GitHubBudgetStop, type ReaderDeps } from './source-readers';
import { CONTRACT_REFUSALS, claimContract, proposeSource, readSources, rejectSource, verifySource } from './sources';
import { bonusVetoKey, vetoKey } from './veto';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  // The mutable rows of this run's people (scores and readings are append-only and stay).
  await sql()`DELETE FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 29}`;
  await sql()`DELETE FROM discovery_queue WHERE builder_id BETWEEN ${T} AND ${T + 29}`;
  await sql()`DELETE FROM builder_profiles WHERE builder_id BETWEEN ${T} AND ${T + 29}`;
  await sql().end();
});
const NOW = new Date('2026-10-12T23:00:00Z');
const iso = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const old = (id: string, at = iso(5)) => ({ id, at, created_at: iso(900) });

test('6.1 buildInputs: repo touches by project; org contributors never count; PR credit; downloads / 50', () => {
  const sources: SourceRow[] = [
    { id: 1, kind: 'repo', ref: 'lee/tipjar', project_key: 'lee/tipjar', owner_is_org: false },
    { id: 2, kind: 'repo', ref: 'acme/app', project_key: 'acme/app', owner_is_org: true },
    { id: 3, kind: 'package_npm', ref: 'tipjar', project_key: 'lee/tipjar', owner_is_org: false },
    { id: 4, kind: 'merged_pr', ref: 'https://github.com/big/lib/pull/1', project_key: 'oss', owner_is_org: false },
  ];
  const repo = (stars: string[], contributors: string[]) => ({ owner: 'x', fork: false, template: false, stargazers: stars.map((s) => old(s)), forkers: [], issue_authors: [], contributors: contributors.map((c) => old(c)), commit_weeks: ['2026-W40'], partial: false });
  const readings: ReadingRow[] = [
    { source_id: 1, day: '2026-10-12', ok: true, signals: repo(['gh:a', 'gh:b'], ['gh:lee']) },
    { source_id: 2, day: '2026-10-12', ok: true, signals: repo(['gh:c'], ['gh:d', 'gh:e']) },
    { source_id: 3, day: '2026-10-12', ok: true, signals: { weekly: 100, repo_url: 'https://github.com/lee/tipjar' } },
    { source_id: 4, day: '2026-10-12', ok: true, signals: { target: 'big/lib', target_stars: 999, merged_at: iso(10), author: 'lee' } },
  ];
  const { projects } = buildInputs(sources, readings, { self: new Set(['gh:lee']), owner: new Map(), edges: [], person: 1, now: NOW });
  const by = Object.fromEntries(projects.map((p) => [p.key, p]));
  assert.equal(by['lee/tipjar'].users, 2 + 100 / 50);
  assert.equal(by['acme/app'].users, 1, 'org contributors d and e never count');
  assert.equal(by.oss.users, Math.min(5, Math.log10(1 + 999)));
  assert.deepEqual(by['lee/tipjar'].commit_weeks, ['2026-W40']);
});

test('6.2 buildInputs: a failed reading adds nothing; contract callers across readings count once each', () => {
  const sources: SourceRow[] = [{ id: 9, kind: 'contract', ref: 'base:0x' + '1'.repeat(40), project_key: 'k', owner_is_org: false }];
  const call = (w: string, days: number) => ({ id: w, at: iso(days), value_usd: 0, first_tx_at: iso(500) });
  const readings: ReadingRow[] = [
    { source_id: 9, day: '2026-10-10', ok: true, signals: { callers: [call('wallet:0xa', 3), call('wallet:0xb', 2)], partial: false } },
    { source_id: 9, day: '2026-10-11', ok: true, signals: { callers: [call('wallet:0xa', 1), call('wallet:0xc', 1)], partial: false } },
    { source_id: 9, day: '2026-10-12', ok: false, signals: {} },
  ];
  const { projects } = buildInputs(sources, readings, { self: new Set(), owner: new Map(), edges: [], person: 1, now: NOW });
  assert.equal(projects[0].users, 3);
});

test('6.3 holdReason: +30 in a day, or one source over 80% at 60+; a first score is held only by the one-source rule (R26)', () => {
  assert.equal(holdReason(10, 40, [0.5, 0.5]), 'jump');
  assert.equal(holdReason(10, 39, [0.5, 0.5]), null);
  assert.equal(holdReason(null, 80, [0.5, 0.5]), null);
  assert.equal(holdReason(null, 60, [0.81, 0.19]), 'one_source');
  assert.equal(holdReason(50, 59, [1]), null);
  assert.equal(HOLD.jump, 30);
});

test('6.4 emptyReason: the single thing that would fill the profile', () => {
  assert.equal(emptyReason({ login: false, proposed: 0, verified: 0, okReadings: 0, failedReadings: 0 }), 'no_github');
  assert.equal(emptyReason({ login: false, proposed: 2, verified: 0, okReadings: 0, failedReadings: 0 }), 'ownership_unproven');
  assert.equal(emptyReason({ login: true, proposed: 0, verified: 3, okReadings: 0, failedReadings: 3 }), 'read_failed');
  assert.equal(emptyReason({ login: true, proposed: 0, verified: 3, okReadings: 3, failedReadings: 0 }), 'nothing_live');
});

// DB: one person with a verified repo whose stars are real.
async function person(id: number, slug: string, stars: number, extra: { held?: boolean; weeks?: number } = {}) {
  await sql()`DELETE FROM builder_profiles WHERE builder_id = ${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, held, first_find_at) VALUES (${id}, ${slug}, ${extra.held ?? false}, ${new Date(NOW.getTime() - 3_600_000)})`;
  const [s] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof, verified_at, last_read_day)
    VALUES (${id}, 'repo', ${`${slug}/r`}, ${`${slug}/r`}, 'server', 'verified', 'repo_owner', now(), '2026-10-12') RETURNING id`;
  const signals = { owner: slug, fork: false, template: false, stargazers: Array.from({ length: stars }, (_, i) => old(`gh:${slug}fan${i}`)), forkers: [], issue_authors: [], contributors: [], commit_weeks: Array.from({ length: extra.weeks ?? 0 }, (_, i) => `2026-W${String(20 + i).padStart(2, '0')}`), partial: false };
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${s.id}, '2026-10-12', ${sql().json(signals as never)}, true)`;
}
// A fresh block of person keys per run (T to T + 29): builder_scores and builder_events are
// append-only, so a key reused by a later run would find its rows already there.
const T = 2_110_000_000 + Math.floor(Math.random() * 1_000_000) * 30;

test('6.5 scoreBuilders: one row per person per day, an event, and a second run writes nothing', dbTest, async () => {
  await person(T, `p${T}`, 40);
  const a = await scoreBuilders(NOW, { deadline: Date.now() + 30_000, only: [T] });
  assert.equal(a.scored, 1);
  const b = await scoreBuilders(NOW, { deadline: Date.now() + 30_000, only: [T] });
  assert.equal(b.scored, 0);
  const rows = await sql()<{ score: number; formula: string; calibration: string }[]>`SELECT score, formula, calibration FROM builder_scores WHERE builder_id = ${T}`;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].score > 0 && rows[0].score < HOLD.minScore, String(rows[0].score));
  assert.deepEqual([rows[0].formula, rows[0].calibration], ['v1', 'v1-launch']);
});

test('6.6 the hold: a one-source score of 60+ is held; the public score stays the last unheld until the owner releases it', dbTest, async () => {
  const id = T + 1;
  await person(id, `q${id}`, 5000, { weeks: 13 }); // 45 users + about 9.6 recency + 10 consistency, all from one source
  const r = await scoreBuilders(NOW, { deadline: Date.now() + 30_000, only: [id] });
  assert.deepEqual(r.held, [id]);
  const [p] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.held, true);
  assert.equal(await publicScore(id), null, 'no unheld score yet');
  const key = scoresAdminKey('k'.repeat(40))!;
  process.env.ADMIN_VETO_SECRET = 'k'.repeat(40);
  const form = (k: string) => new Request('https://earnkit.com/api/admin/scores', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key: k, builder: String(id), day: '2026-10-12' }) });
  assert.equal((await scoresPost(form('wrong'), { limit: async () => {} })).status, 404);
  assert.equal((await scoresPost(form(key), { limit: async () => {} })).status, 303);
  delete process.env.ADMIN_VETO_SECRET;
  assert.ok((await publicScore(id))!.score >= HOLD.minScore);
  const [after] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(after.held, false);
});

test('6.7 percentiles: one pass over public scores, hidden included, a held person at the last unheld score', dbTest, async () => {
  const ids = [T + 10, T + 11, T + 12, T + 13]; // 10; 20; 30 and hidden; held today at 90 after 15 yesterday
  const row = (id: number, day: string, score: number, held: boolean) => sql()`
    INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${day}, ${score}, 0, '{}', '{}', 'v1', 'v1-launch', ${held})`;
  for (const [i, id] of ids.entries())
    await sql()`INSERT INTO builder_profiles (builder_id, slug, hidden, held) VALUES (${id}, ${`r${id}`}, ${i === 2}, ${i === 3})`;
  await row(ids[0], '2026-10-12', 10, false);
  await row(ids[1], '2026-10-12', 20, false);
  await row(ids[2], '2026-10-12', 30, false);
  await row(ids[3], '2026-10-11', 15, false);
  await row(ids[3], '2026-10-12', 90, true);
  await percentiles(NOW);
  const ranks = await sql()<{ builder_id: number; score: number; percentile: number }[]>`
    SELECT builder_id, score, percentile FROM builder_ranks WHERE builder_id IN ${sql()(ids)} ORDER BY builder_id`;
  assert.equal(ranks.length, 4, 'the hidden one is ranked too');
  assert.equal(ranks[3].score, 15, 'held: ranked at the last unheld score');
  assert.ok(ranks[2].percentile > ranks[1].percentile && ranks[1].percentile > ranks[3].percentile && ranks[3].percentile > ranks[0].percentile);
});

test('6.8 profileEmpty: once, 10 minutes after the first find, with its reason; a filled profile gets none', dbTest, async () => {
  const [id, filled] = [T + 20, T + 21];
  const tenMinutesAgo = new Date(NOW.getTime() - 11 * 60_000);
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${id}, ${`e${id}`}, ${tenMinutesAgo}), (${filled}, ${`f${filled}`}, ${tenMinutesAgo})`;
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${filled}, '2026-10-12', 12, 0, '{}', '{}', 'v1', 'v1-launch', false)`;
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    await profileEmpty(NOW);
    await profileEmpty(NOW);
  } finally {
    delete process.env.EARNKIT_EVENT_LOG;
  }
  const ev = await sql()<{ detail: { missing: string } }[]>`SELECT detail FROM builder_events WHERE dedupe_key = ${`profile_empty:${id}`}`;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].detail.missing, 'no_github');
  const none = await sql()`SELECT 1 FROM builder_events WHERE dedupe_key = ${`profile_empty:${filled}`}`;
  assert.equal(none.length, 0, 'a filled profile gets no profile_empty');
});

test('6.10 the four steps get at most 40% of what remains of the run', () => {
  assert.equal(SCORE_SLICE, 0.4);
  assert.equal(scoreSliceEnd(1_000, 11_000), 5_000);
  assert.equal(scoreSliceEnd(12_000, 11_000), 11_000, 'past the deadline: no time at all');
});

// ---- Beyond the brief: discover, readSources, the contract claim, shares and money.

const hex40 = (n: number, pad = '0') => n.toString(16).padStart(40, pad);
/** A ReaderDeps whose GitHub answers come from `gh` (an Error value is thrown) and every other read throws unless overridden. */
function fakeReader(gh: Record<string, unknown>, over: Partial<ReaderDeps> = {}): ReaderDeps {
  const no = (what: string) => async () => {
    throw new Error(`unexpected ${what}`);
  };
  return {
    gh: async <T,>(path: string): Promise<T> => {
      if (!(path in gh)) throw new Error(`no fake for ${path}`);
      const v = gh[path];
      if (v instanceof Error) throw v;
      return v as T;
    },
    probe: no('probe'),
    fetchText: no('fetchText'),
    json: no('json'),
    baseTxs: no('baseTxs'),
    contractOrigin: no('contractOrigin'),
    arcLogs: no('arcLogs'),
    arcHead: no('arcHead'),
    arcSender: no('arcSender'),
    usdPerNative: no('usdPerNative'),
    now: NOW,
    ...over,
  };
}
const b64 = (s: string) => ({ content: Buffer.from(s).toString('base64'), encoding: 'base64' });
type Src = { kind: string; ref: string; state: string; proof: string | null; reject_reason: string | null; project_key: string; deployer: string | null };
const sourcesOf = async (id: number) => {
  const rows = await sql()<Src[]>`SELECT kind, ref, state, proof, reject_reason, project_key, deployer FROM builder_sources WHERE builder_id = ${id} ORDER BY id`;
  return Object.fromEntries(rows.map((r) => [`${r.kind} ${r.ref}`, r]));
};

test('6.11 discover: a proven login finds own repos, their sites, packages, contracts and merged PRs; only the server verifies', dbTest, async () => {
  const id = T + 22;
  const L = `lee${T}`;
  const addr = `0x${hex40(T)}`;
  const dep = `0x${hex40(T + 1, 'd')}`;
  const secret = 's'.repeat(40);
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`d${id}`})`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'first_find')`;
  // The agent proposed a live link with no GitHub; its earnkit.txt names this person.
  await proposeSource({ builder_id: id, kind: 'site', ref: 'https://mine.example.com', project_key: 'https://mine.example.com', proposed_by: 'agent' });
  const repo = (name: string, o: Record<string, unknown> = {}) => ({
    full_name: `${L}/${name}`, name, fork: false, is_template: false, homepage: null, has_pages: false,
    created_at: '2025-01-01T00:00:00Z', pushed_at: iso(2), owner: { login: L, type: 'User' }, ...o,
  });
  const broadcast = JSON.stringify({ chain: 8453, transactions: [{ transactionType: 'CREATE', contractAddress: addr, transaction: { from: dep } }] });
  const reader = fakeReader({
    [`/users/${L}`]: { blog: 'https://blog.lee.dev', twitter_username: 'leex' },
    [`/users/${L}/repos?type=owner&per_page=100`]: [repo('app', { homepage: 'https://app.lee.dev', has_pages: true }), repo('fork', { fork: true })],
    [`/users/${L}/orgs`]: [],
    [`/repos/${L}/app/git/trees/HEAD?recursive=1`]: { tree: [{ path: 'package.json', type: 'blob' }, { path: 'broadcast/Deploy.s.sol/8453/run-latest.json', type: 'blob' }, { path: 'src/a.ts', type: 'blob' }] },
    [`/repos/${L}/app/contents/package.json`]: b64(JSON.stringify({ name: `lee-app-${T}` })),
    [`/repos/${L}/app/contents/broadcast/Deploy.s.sol/8453/run-latest.json`]: b64(broadcast),
    [`/search/issues?q=${encodeURIComponent(`type:pr author:${L} is:merged -user:${L}`)}&per_page=100`]: {
      items: [{ html_url: 'https://github.com/big/lib/pull/7', repository_url: 'https://api.github.com/repos/big/lib', pull_request: { merged_at: iso(30) } }],
    },
    '/repos/big/lib': { stargazers_count: 999 },
    '/repos/big/lib/pulls/7': { merged_by: { login: 'maint' } },
  }, {
    contractOrigin: async () => ({ deployer: dep, created_at: '2026-01-01T00:00:00Z' }),
    fetchText: async (url) => {
      if (url === 'https://mine.example.com/earnkit.txt') return `profile: ${profileCode(id, 'https://mine.example.com', secret)}\n`;
      throw new Error('not found');
    },
  });
  const before = process.env.EARNKIT_AUTH_SECRET;
  process.env.EARNKIT_AUTH_SECRET = secret;
  let r;
  try {
    r = await discover(NOW, { deadline: Date.now() + 30_000, reader, login: async () => ({ login: L, basis: 'signin' }), only: [id] });
  } finally {
    if (before === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = before;
  }
  assert.equal(r.people, 1);
  const s = await sourcesOf(id);
  assert.deepEqual([s[`repo ${L}/app`].state, s[`repo ${L}/app`].proof], ['verified', 'repo_owner']);
  assert.deepEqual([s[`repo ${L}/fork`].state, s[`repo ${L}/fork`].reject_reason], ['rejected', 'derived']);
  assert.deepEqual([s['site https://app.lee.dev'].state, s['site https://app.lee.dev'].proof, s['site https://app.lee.dev'].project_key], ['verified', 'repo_link', `${L}/app`]);
  assert.equal(s[`site https://${L}.github.io/app/`].state, 'verified', 'the Pages site');
  assert.equal(s['site https://blog.lee.dev'].state, 'proposed', 'a blog not linked from a verified repo and with no earnkit.txt line stays proposed');
  assert.deepEqual([s['site https://mine.example.com'].state, s['site https://mine.example.com'].proof], ['verified', 'earnkit_txt']);
  assert.equal(s[`package_npm lee-app-${T}`].state, 'proposed', 'packages are verified on their first read');
  assert.deepEqual([s[`contract base:${addr}`].state, s[`contract base:${addr}`].proof, s[`contract base:${addr}`].deployer], ['verified', 'repo_link', dep]);
  const pr = s['merged_pr https://github.com/big/lib/pull/7'];
  assert.deepEqual([pr.state, pr.proof, pr.project_key], ['verified', 'github_signin', 'oss']);
  const [p] = await sql()<{ github_login: string; fallback_handle: string; twitter_prefill: string }[]>`SELECT github_login, fallback_handle, twitter_prefill FROM builder_profiles WHERE builder_id = ${id}`;
  assert.deepEqual([p.github_login, p.fallback_handle, p.twitter_prefill], [L, L, 'leex']);
  const [q] = await sql()<{ done_at: Date | null; attempts: number }[]>`SELECT done_at, attempts FROM discovery_queue WHERE builder_id = ${id}`;
  assert.ok(q.done_at);
  assert.equal(q.attempts, 1);
});

test('6.11b discover: no login leaves the person with proposed sources only; a failed read retries, a spent GitHub budget does not count', dbTest, async () => {
  const [a, b] = [T + 25, T + 26];
  for (const id of [a, b]) await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'first_find')`;
  await proposeSource({ builder_id: a, kind: 'repo', ref: `x${T}/r`, project_key: `x${T}/r`, proposed_by: 'agent' });
  const none = await discover(NOW, { deadline: Date.now() + 30_000, reader: fakeReader({}), login: async () => null, only: [a] });
  assert.deepEqual(none, { people: 1, proposed: 0, verified: 0 });
  assert.equal((await sourcesOf(a))[`repo x${T}/r`].state, 'proposed');
  const L = `bo${T}`;
  const login = async () => ({ login: L, basis: 'signin' as const });
  await discover(NOW, { deadline: Date.now() + 30_000, reader: fakeReader({ [`/users/${L}`]: new Error('500') }), login, only: [b] });
  const [q1] = await sql()<{ done_at: Date | null; attempts: number }[]>`SELECT done_at, attempts FROM discovery_queue WHERE builder_id = ${b}`;
  assert.deepEqual([q1.done_at, q1.attempts], [null, 1], 'a failed read leaves it queued');
  await discover(NOW, { deadline: Date.now() + 30_000, reader: fakeReader({ [`/users/${L}`]: new GitHubBudgetStop() }), login, only: [b] });
  const [q2] = await sql()<{ done_at: Date | null; attempts: number }[]>`SELECT done_at, attempts FROM discovery_queue WHERE builder_id = ${b}`;
  assert.deepEqual([q2.done_at, q2.attempts], [null, 1], 'a spent budget is not an attempt');
  await sql()`UPDATE discovery_queue SET attempts = 4 WHERE builder_id = ${b}`;
  await discover(NOW, { deadline: Date.now() + 30_000, reader: fakeReader({ [`/users/${L}`]: new Error('500') }), login, only: [b] });
  const [q3] = await sql()<{ done_at: Date | null; attempts: number }[]>`SELECT done_at, attempts FROM discovery_queue WHERE builder_id = ${b}`;
  assert.ok(q3.done_at, 'after 5 attempts it is done until the next clue');
});

test('6.12 readSources: each kind read once a day; packages verified on first read; a failed read is stored; a spent budget writes nothing', dbTest, async () => {
  const id = T + 24;
  const R = `r${T}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, github_login) VALUES (${id}, ${`s${id}`}, ${R})`;
  const add = async (kind: string, ref: string, state = 'verified', key = `${R}/a`) => {
    const [row] = await sql()<{ id: string }[]>`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof)
      VALUES (${id}, ${kind}, ${ref}, ${key}, 'server', ${state}, ${state === 'verified' ? 'repo_owner' : null}) RETURNING id`;
    return Number(row.id);
  };
  const repo = await add('repo', `${R}/a`);
  const site = await add('site', 'https://r.example.com');
  const contract = await add('contract', `base:0x${hex40(T)}`);
  const stopped = await add('merged_pr', 'https://github.com/big/lib/pull/7', 'verified', 'oss');
  const pr = await add('merged_pr', 'https://github.com/big/lib2/pull/3', 'verified', 'oss');
  const npm = await add('package_npm', `r-pkg-${T}`, 'proposed');
  const pypi = await add('package_pypi', `other-${T}`, 'proposed');
  const reader = fakeReader({
    [`/repos/${R}/a`]: { owner: { login: R, type: 'User' }, fork: false, is_template: false, stargazers_count: 0, created_at: iso(400) },
    [`/repos/${R}/a/forks?per_page=100`]: [],
    [`/repos/${R}/a/issues?state=all&per_page=100`]: [],
    [`/repos/${R}/a/contributors?per_page=100`]: [],
    [`/repos/${R}/a/stats/commit_activity`]: [],
    '/repos/big/lib': new GitHubBudgetStop(),
    '/repos/big/lib2': { stargazers_count: 50 },
    '/repos/big/lib2/pulls/3': { merged_at: iso(9), merged_by: { login: 'maint' } },
  }, {
    probe: async () => ({ status: 200 }),
    usdPerNative: async () => {
      throw new Error('price down');
    },
    json: async <T,>(url: string): Promise<T> => {
      if (url.includes('api.npmjs.org')) return { downloads: Array.from({ length: 28 }, () => ({ day: '2026-10-01', downloads: 10 })) } as T;
      if (url.includes('registry.npmjs.org')) return { repository: { url: `git+https://github.com/${R}/a.git` } } as T;
      if (url.includes('pypistats')) return { data: { last_month: 40 } } as T;
      return { info: { project_urls: { Source: 'https://github.com/someone/else' } } } as T;
    },
  });
  const r = await readSources(NOW, { deadline: Date.now() + 30_000, reader, only: [id] });
  assert.deepEqual(r, { read: 4, failed: 1 });
  const readings = await sql()<{ source_id: number; ok: boolean; error: string | null; signals: Record<string, unknown> }[]>`
    SELECT source_id::int, ok, error, signals FROM source_readings WHERE source_id IN ${sql()([repo, site, contract, stopped, pr, npm, pypi])}`;
  const by = new Map(readings.map((x) => [x.source_id, x]));
  assert.equal(by.get(repo)?.ok, true);
  assert.equal(by.get(site)?.signals.up, true);
  assert.deepEqual([by.get(contract)?.ok, by.get(contract)?.error], [false, 'Error']);
  assert.equal(by.has(stopped), false, 'a spent GitHub budget leaves the source unread');
  assert.deepEqual([by.get(pr)?.signals.target_stars, by.get(pr)?.signals.merged_at, by.get(pr)?.signals.author], [50, iso(9), R]);
  assert.equal(by.get(npm)?.signals.weekly, 70);
  assert.equal(by.has(pypi), false);
  const s = await sourcesOf(id);
  assert.deepEqual([s[`package_npm r-pkg-${T}`].state, s[`package_npm r-pkg-${T}`].proof], ['verified', 'repo_link']);
  assert.deepEqual([s[`package_pypi other-${T}`].state, s[`package_pypi other-${T}`].reject_reason], ['rejected', 'repo_mismatch']);
  const [left] = await sql()<{ last_read_day: string | null }[]>`SELECT last_read_day::text FROM builder_sources WHERE id = ${stopped}`;
  assert.equal(left.last_read_day, null, 'still due');
  assert.deepEqual(await readSources(NOW, { deadline: Date.now() + 30_000, reader, only: [id] }), { read: 0, failed: 0 }, 'once a day (the stopped one stays stopped)');
});

test('6.13 claimContract: a contract another person holds is refused, and two people claiming one contract at once never both win', dbTest, async () => {
  const [a, b] = [T + 27, T + 28];
  const ref = `base:0x${hex40(T + 2)}`;
  const dep = `0x${hex40(T + 3, 'e')}`;
  const facts = { deployer: dep, created_at: '2026-01-01T00:00:00Z', earnkitDeployed: false, repo: { deployer: dep, created_at: '2025-01-01T00:00:00Z' } };
  const ia = (await proposeSource({ builder_id: a, kind: 'contract', ref, project_key: 'k', proposed_by: 'server' }))!;
  const ib = (await proposeSource({ builder_id: b, kind: 'contract', ref, project_key: 'k', proposed_by: 'server' }))!;
  const results = await Promise.all([claimContract(ia, a, ref, facts, new Set()), claimContract(ib, b, ref, facts, new Set())]);
  assert.equal(results.filter((x) => 'proof' in x).length, 1, String(JSON.stringify(results)));
  assert.equal(results.filter((x) => 'reject' in x && x.reject === CONTRACT_REFUSALS.taken).length, 1);
  const states = await sql()<{ state: string }[]>`SELECT state FROM builder_sources WHERE kind = 'contract' AND lower(ref) = ${ref} AND state = 'verified'`;
  assert.equal(states.length, 1);
  // Deterministic: while another transaction holds the contract's lock and verifies it for someone
  // else, a claim waits, then sees that verification and is refused.
  const ref2 = `base:0x${hex40(T + 4)}`;
  const ic = (await proposeSource({ builder_id: a, kind: 'contract', ref: ref2, project_key: 'k', proposed_by: 'server' }))!;
  const id2 = (await proposeSource({ builder_id: b, kind: 'contract', ref: ref2, project_key: 'k', proposed_by: 'server' }))!;
  let settled = false;
  let claim: Promise<{ proof: string } | { reject: string }> | undefined;
  await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`v212:contract:${ref2}`}))`;
    claim = claimContract(ic, a, ref2, facts, new Set());
    void claim.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(settled, false, 'the claim waits on the lock');
    await tx`UPDATE builder_sources SET state = 'verified', proof = 'deployer' WHERE id = ${id2}`;
  });
  assert.deepEqual(await claim, { reject: CONTRACT_REFUSALS.taken });
});

test('6.14 sourceShares and money: one source holding the users is 1.0; a call read twice is money once', () => {
  const sources: SourceRow[] = [
    { id: 1, kind: 'contract', ref: 'base:0x' + '2'.repeat(40), project_key: 'k', owner_is_org: false },
    { id: 2, kind: 'repo', ref: 'lee/x', project_key: 'k', owner_is_org: false },
  ];
  const call = (w: string, days: number) => ({ id: w, at: iso(days), value_usd: 100 });
  const calls = [call('wallet:0xa', 3), call('wallet:0xb', 2), call('wallet:0xc', 1)];
  const readings: ReadingRow[] = [
    { source_id: 1, day: '2026-10-11', ok: true, signals: { callers: calls, partial: false } },
    { source_id: 1, day: '2026-10-12', ok: true, signals: { callers: [calls[2]], partial: false } },
    { source_id: 2, day: '2026-10-12', ok: true, signals: { owner: 'lee', fork: false, template: false, stargazers: [old('gh:s')], forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false } },
  ];
  const { projects, perSource } = buildInputs(sources, readings, { self: new Set(), owner: new Map(), edges: [], person: 1, now: NOW });
  // Three wallets of unknown first transaction (50%) and $100 each; each capped at 10% of $300.
  assert.ok(Math.abs(projects[0].money_usd - 0.01 * 3 * 30 * 0.5) < 1e-9, String(projects[0].money_usd));
  assert.equal(projects[0].users, 1.5 + 1);
  const s = computeScore(projects, calibration(), NOW);
  const shares = sourceShares(perSource, s);
  assert.equal(shares.length, 2);
  assert.ok(Math.abs(shares.reduce((n, x) => n + x, 0) - 1) < 1e-9, String(shares));
  assert.ok(shares[0] > shares[1]);
});

test('6.15 buildInputs: the owners of a ring are passed along, so a partner with many accounts counts once at 50%', () => {
  const sources: SourceRow[] = [{ id: 1, kind: 'repo', ref: 'lee/x', project_key: 'lee/x', owner_is_org: false }];
  const owner = new Map([['gh:bob', 2], ['gh:bob2', 2], ['gh:lee', 1]]);
  const readings: ReadingRow[] = [{ source_id: 1, day: '2026-10-12', ok: true, signals: { owner: 'lee', fork: false, template: false, stargazers: [old('gh:bob'), old('gh:bob2'), old('gh:ann')], forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false } }];
  const { projects } = buildInputs(sources, readings, { self: new Set(['gh:lee']), owner, edges: [[1, 2], [2, 1]], person: 1, now: NOW });
  assert.equal(projects[0].users, 1 + 0.5);
});

test('6.16 /admin/scores: a POST-only release with its own key; the page is rate limited, noindex, and a wrong key is a 404', () => {
  const app = join(import.meta.dirname, '../../app');
  const route = readFileSync(join(app, 'api/admin/scores/route.ts'), 'utf8');
  assert.match(route, /export async function POST\(request: Request\) \{\s*return scoresPost\(request\);\s*\}/);
  assert.doesNotMatch(route, /\bGET\b/);
  const page = readFileSync(join(app, 'admin/scores/page.tsx'), 'utf8');
  assert.match(page, /method="post" action="\/api\/admin\/scores"/);
  assert.match(page, /enforce\('veto', /);
  assert.match(page, /index: false/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, />Release</);
  const secret = 'k'.repeat(40);
  const key = scoresAdminKey(secret);
  for (const other of [vetoKey('scores', secret), vetoKey('admin', secret), bonusVetoKey('admin:scores', secret)]) assert.notEqual(key, other);
  assert.equal(scoresAdminKey('short'), null);
});

test('6.17 scoresPost: only a held day can be released, and only a real date; a newer held day keeps the profile held', dbTest, async () => {
  const id = T + 29;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, held) VALUES (${id}, ${`h${id}`}, true)`;
  const row = (day: string, score: number, held: boolean) => sql()`
    INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${day}, ${score}, 0, '{}', '{}', 'v1', 'v1-launch', ${held})`;
  await row('2026-10-10', 20, false);
  await row('2026-10-11', 70, true);
  await row('2026-10-12', 75, true);
  process.env.ADMIN_VETO_SECRET = 'k'.repeat(40);
  const post = (day: string) => scoresPost(new Request('https://earnkit.com/api/admin/scores', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key: scoresAdminKey()!, builder: String(id), day }) }), { limit: async () => {} });
  try {
    for (const day of ['2026-10-10', '2026-02-31', 'nope']) assert.equal((await post(day)).status, 303);
    assert.equal((await sql()`SELECT 1 FROM score_releases WHERE builder_id = ${id}`).length, 0, 'an unheld day or a bad date releases nothing');
    await post('2026-10-11');
    const [a] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`;
    assert.equal(a.held, true, 'the newer held day still waits');
    assert.equal((await publicScore(id))!.score, 70);
    await post('2026-10-12');
    const [b] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`;
    assert.equal(b.held, false);
    assert.equal((await publicScore(id))!.score, 75);
  } finally {
    delete process.env.ADMIN_VETO_SECRET;
  }
});

// ---- Fix round 1.

const queueOf = async (id: number) => (await sql()<{ done_at: Date | null; attempts: number }[]>`SELECT done_at, attempts FROM discovery_queue WHERE builder_id = ${id}`)[0];

test('6.18 discover cut by the deadline mid-person: still queued, no attempt, nothing rejected, verified or claimed', dbTest, async () => {
  const id = T + 2;
  const L = `cut${T}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`c${id}`})`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'first_find')`;
  const repo = (name: string, fork: boolean) => ({ full_name: `${L}/${name}`, fork, is_template: false, pushed_at: iso(1), owner: { login: L, type: 'User' } });
  const reader = fakeReader({
    [`/users/${L}`]: {},
    [`/users/${L}/repos?type=owner&per_page=100`]: [repo('app', false), repo('fork', true)],
    [`/users/${L}/orgs`]: [],
    // The slice ends while the repo's files are read (a soft read must not swallow it).
    [`/repos/${L}/app/git/trees/HEAD?recursive=1`]: new ScoreDeadline(),
  });
  const r = await discover(NOW, { deadline: Date.now() + 30_000, reader, login: async () => ({ login: L, basis: 'signin' }), only: [id] });
  assert.equal(r.people, 0);
  const q = await queueOf(id);
  assert.deepEqual([q.done_at, q.attempts], [null, 0]);
  const s = await sourcesOf(id);
  assert.equal(s[`repo ${L}/fork`].state, 'proposed', 'no reject from a person cut short');
  assert.equal(s[`repo ${L}/app`].state, 'proposed', 'no verify either');
  const [p] = await sql()<{ github_login: string | null }[]>`SELECT github_login FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.github_login, null);
});

test('6.18b readSources: a read cut by the deadline writes no reading; the source stays due', dbTest, async () => {
  const id = T + 5;
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof)
    VALUES (${id}, 'site', 'https://cut.example.com', 'k', 'server', 'verified', 'earnkit_txt') RETURNING id`;
  const reader = fakeReader({}, { probe: async () => { throw new ScoreDeadline(); } });
  assert.deepEqual(await readSources(NOW, { deadline: Date.now() + 30_000, reader, only: [id] }), { read: 0, failed: 0 });
  assert.equal((await sql()`SELECT 1 FROM source_readings WHERE source_id = ${row.id}`).length, 0);
  const [left] = await sql()<{ last_read_day: string | null }[]>`SELECT last_read_day::text FROM builder_sources WHERE id = ${row.id}`;
  assert.equal(left.last_read_day, null);
});

test('6.19 provenLogin: one login across the group or none; the proof-line check is injected, budgeted and deadline-bound', dbTest, async () => {
  const stamp = `${T}-${process.pid}`;
  const inst = async (tag: string, root?: number) => {
    const [r] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, builder_id) VALUES (${`v212-t6-${tag}-${stamp}`}, ${root ?? null}) RETURNING id`;
    return r.id;
  };
  const verified = (installationId: number, login: string) => sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos) VALUES (${`${login}/r`}, ${login}, ${installationId}, now(), 3)`;
  const a = await inst('a');
  await verified(a, 'ann');
  await verified(await inst('a2', a), 'Bob');
  assert.equal(await provenLogin(a), null, 'two logins in one group name no one');
  const c = await inst('c');
  await verified(c, 'Cy');
  await verified(await inst('c2', c), 'cy');
  assert.deepEqual(await provenLogin(c), { login: 'cy', basis: 'signin' });
  const e = await inst('e');
  await proposeSource({ builder_id: e, kind: 'repo', ref: `dee${T}/x`, project_key: `dee${T}/x`, proposed_by: 'agent' });
  const calls: string[] = [];
  const proofLine = async (m: number, ref: string) => {
    calls.push(`${m} ${ref}`);
    return { login: `dee${T}`, basis: 'proof_line' as const };
  };
  assert.deepEqual(await provenLogin(e, { proofLine }), { login: `dee${T}`, basis: 'proof_line' });
  assert.deepEqual(calls, [`${e} dee${T}/x`]);
  assert.equal(await provenLogin(e), null, 'no check given: no proof-line login');
  // The run's check: never without the run's budgeted fetch, never once the budget is spent or the slice is nearly over.
  const noFetch = async () => {
    throw new Error('unexpected fetch');
  };
  assert.equal(await proofLineCheck(fakeReader({}), Date.now() + 60_000)(e, `dee${T}/x`), null);
  await assert.rejects(proofLineCheck(fakeReader({}, { ghFetch: noFetch, ghSpent: () => true }), Date.now() + 60_000)(e, `dee${T}/x`), GitHubBudgetStop);
  await assert.rejects(proofLineCheck(fakeReader({}, { ghFetch: noFetch, ghSpent: () => false }), Date.now() + 1_000)(e, `dee${T}/x`), ScoreDeadline);
  await sql()`DELETE FROM builder_sources WHERE builder_id = ${e}`;
  await sql()`DELETE FROM installations WHERE token_hash LIKE ${`v212-t6-%-${stamp}`}`;
});

test('6.20 one login, one person: a login another profile holds names no one; the database refuses a second holder', dbTest, async () => {
  const [holder, other] = [T + 6, T + 7];
  const L = `held${T}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, github_login) VALUES (${holder}, ${`g${holder}`}, ${L})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${other}, ${`g${other}`})`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${other}, 'first_find')`;
  // No GitHub fake: with the login refused, nothing is read.
  await discover(NOW, { deadline: Date.now() + 30_000, reader: fakeReader({}), login: async () => ({ login: L.toUpperCase(), basis: 'signin' }), only: [other] });
  const [p] = await sql()<{ github_login: string | null }[]>`SELECT github_login FROM builder_profiles WHERE builder_id = ${other}`;
  assert.equal(p.github_login, null);
  assert.ok((await queueOf(other)).done_at);
  await assert.rejects(sql()`UPDATE builder_profiles SET github_login = ${L.toUpperCase()} WHERE builder_id = ${other}`, /duplicate key/);
});

test('6.21 a rejected source is never verified again (discover or verifySource)', dbTest, async () => {
  const id = T + 8;
  const L = `rej${T}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`j${id}`})`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'first_find')`;
  const sid = (await proposeSource({ builder_id: id, kind: 'repo', ref: `${L}/app`, project_key: `${L}/app`, proposed_by: 'agent' }))!;
  await rejectSource(sid, 'merged');
  const reader = fakeReader({
    [`/users/${L}`]: {},
    [`/users/${L}/repos?type=owner&per_page=100`]: [{ full_name: `${L}/app`, fork: false, is_template: false, owner: { login: L, type: 'User' } }],
    [`/users/${L}/orgs`]: [],
    [`/search/issues?q=${encodeURIComponent(`type:pr author:${L} is:merged -user:${L}`)}&per_page=100`]: { items: [] },
  });
  await discover(NOW, { deadline: Date.now() + 30_000, reader, login: async () => ({ login: L, basis: 'signin' }), only: [id] });
  assert.equal((await sourcesOf(id))[`repo ${L}/app`].state, 'rejected');
  await verifySource(sid, 'repo_owner');
  assert.equal((await sourcesOf(id))[`repo ${L}/app`].state, 'rejected');
});

test('6.22 a site a repo merely links (google.com) adds no staying power; a proven site or the repo Pages host does', () => {
  assert.equal(siteShowsUse({ ref: 'https://google.com', project_key: 'lee/x', proof: 'repo_link' }), false);
  assert.equal(siteShowsUse({ ref: 'https://lee.github.io/x/', project_key: 'lee/x', proof: 'repo_link' }), true);
  assert.equal(siteShowsUse({ ref: 'https://evil.github.io/x/', project_key: 'lee/x', proof: 'repo_link' }), false);
  assert.equal(siteShowsUse({ ref: 'https://mine.example.com', project_key: 'k', proof: 'earnkit_txt' }), true);
  assert.equal(siteShowsUse({ ref: 'https://google.com', project_key: 'lee/x' }), false, 'no proof given: strict');
  const stars = { owner: 'lee', fork: false, template: false, stargazers: [old('gh:a', iso(100))], forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false };
  const run = (site: SourceRow) => {
    const sources: SourceRow[] = [{ id: 1, kind: 'repo', ref: 'lee/x', project_key: 'lee/x', owner_is_org: false }, site];
    const readings: ReadingRow[] = [{ source_id: 1, day: '2026-10-12', ok: true, signals: stars }, { source_id: 2, day: '2026-10-12', ok: true, signals: { status: 200, up: true } }];
    const { projects } = buildInputs(sources, readings, { self: new Set(), owner: new Map(), edges: [], person: 1, now: NOW });
    return computeScore(projects, calibration(), NOW).parts;
  };
  const linked = run({ id: 2, kind: 'site', ref: 'https://google.com', project_key: 'lee/x', owner_is_org: false, proof: 'repo_link' });
  assert.equal(linked.staying.points, 0);
  const pages = run({ id: 2, kind: 'site', ref: 'https://lee.github.io/x/', project_key: 'lee/x', owner_is_org: false, proof: 'repo_link' });
  assert.ok(pages.staying.points > 0);
  assert.equal(linked.recency.points, pages.recency.points, 'a site is never an outcome');
});

test('6.23 a later unheld score clears the hold', dbTest, async () => {
  const id = T + 9;
  await person(id, `u${id}`, 40, { held: true });
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, '2026-10-11', 70, 0, '{}', '{}', 'v1', 'v1-launch', true)`;
  const r = await scoreBuilders(NOW, { deadline: Date.now() + 30_000, only: [id] });
  assert.deepEqual(r, { scored: 1, held: [] });
  const [p] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.held, false);
});

test('6.24 admin keys: a repeated ?key= (an array) is never a key; every admin page reads it through oneParam', () => {
  assert.equal(oneParam(['a', 'b']), undefined);
  assert.equal(oneParam(undefined), undefined);
  assert.equal(oneParam('k'), 'k');
  const app = join(import.meta.dirname, '../../app');
  for (const page of ['admin/scores/page.tsx', 'admin/veto/[slug]/page.tsx', 'admin/bonus/[round]/page.tsx'])
    assert.match(readFileSync(join(app, page), 'utf8'), /const key = oneParam\(/, page);
});

test('6.25 (T7) discover sets the login once through setFallback (slug follows); a different proven login later names no one', dbTest, async () => {
  const id = T + 14;
  const L = `once${T}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`o${id}`})`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'first_find')`;
  const reader = (login: string) =>
    fakeReader({
      [`/users/${login}`]: { twitter_username: 'oncex' },
      [`/users/${login}/repos?type=owner&per_page=100`]: [],
      [`/users/${login}/orgs`]: [],
      [`/search/issues?q=${encodeURIComponent(`type:pr author:${login} is:merged -user:${login}`)}&per_page=100`]: { items: [] },
    });
  await discover(NOW, { deadline: Date.now() + 30_000, reader: reader(L), login: async () => ({ login: L, basis: 'signin' }), only: [id] });
  const read = async () =>
    (await sql()<{ github_login: string | null; fallback_handle: string | null; slug: string; twitter_prefill: string | null }[]>`
      SELECT github_login, fallback_handle, slug, twitter_prefill FROM builder_profiles WHERE builder_id = ${id}`)[0];
  assert.deepEqual(await read(), { github_login: L, fallback_handle: L, slug: L, twitter_prefill: 'oncex' });
  await sql()`UPDATE discovery_queue SET done_at = NULL WHERE builder_id = ${id}`;
  const M = `other${T}`;
  // No GitHub fake for M: with the stored login kept, M names no one and nothing is read for it.
  await discover(NOW, { deadline: Date.now() + 30_000, reader: fakeReader({}), login: async () => ({ login: M, basis: 'signin' }), only: [id] });
  assert.deepEqual(await read(), { github_login: L, fallback_handle: L, slug: L, twitter_prefill: 'oncex' });
});

test('6.26 (T7) percentiles count only people with a profile: a merged-away id stops counting and its old rank goes', dbTest, async () => {
  const [kept, gone] = [T + 15, T + 16];
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${kept}, ${`k${kept}`})`;
  for (const id of [kept, gone])
    await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
      VALUES (${id}, '2026-10-12', 33, 0, '{}', '{}', 'v1', 'v1-launch', false)`;
  await sql()`INSERT INTO builder_ranks (builder_id, score, percentile, computed_at) VALUES (${gone}, 33, 10, now())`;
  await percentiles(NOW);
  const ranks = await sql()<{ builder_id: number }[]>`SELECT builder_id FROM builder_ranks WHERE builder_id IN (${kept}, ${gone})`;
  assert.deepEqual(ranks.map((r) => r.builder_id), [kept]);
});
