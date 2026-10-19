import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { heldForReview, partLines, publicRow, scoresAdminKey, scoresPost } from './builder-score';
import { isConfirmedProof } from './confirmed';
import { sql } from './db';
import { PAGE_REFRESH_MS, pageViewRefresh, personInputsV2, rescorePerson, refreshPerson, scorePeopleV2, standingOf, trackedKeys } from './person-score';
import { calibrationV2 } from './score-calibration';
import { countUse } from './score-v2';
import { isoWeekOf } from './weeks';
import { LIMITS, windowStart } from './rate-limit';
import type { ReaderDeps } from './source-readers';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// Task 17: a fresh block of ids each run (not the pid's bucket): builder_scores is append-only, so an
// earlier run's score rows for a reused id made the cron see the day as already scored.
const T = 2_100_950_000 + Math.floor(Math.random() * 400_000) * 20;
const NOW = new Date('2026-10-12T12:00:00Z');
const DAY = 86_400_000;
const hex40 = (n: number) => n.toString(16).padStart(40, '0');

after(async () => {
  if (!process.env.DATABASE_URL) return;
  // builder_live rows of this file never count in another file's rank.
  await sql()`DELETE FROM builder_live WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM score_releases WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_projects WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 19})`;
  await sql()`DELETE FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_profiles WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM projects WHERE installation_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM installations WHERE id BETWEEN ${T} AND ${T + 19}`;
  await sql().end();
});

/** A ReaderDeps whose every read throws, unless a test overrides it. */
function fakeReader(): ReaderDeps {
  const no = async () => {
    throw new Error('unexpected');
  };
  return { gh: no, ghGraphql: no, tokenTransfers: no, probe: no, fetchText: no, json: no, baseTxs: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, walletCreations: no, now: NOW };
}

async function clear(id: number) {
  await sql()`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
  for (const t of ['builder_profiles', 'builder_sources', 'builder_live', 'builder_projects'])
    await sql()`DELETE FROM ${sql()(t)} WHERE builder_id = ${id}`;
  await sql()`DELETE FROM projects WHERE installation_id = ${id}`;
  await sql()`DELETE FROM installations WHERE id = ${id}`;
}
/** `ring`: the cron already computed the person's ring (empty); otherwise it was never computed. */
async function person(id: number, o: { login?: string | null; reported?: string | null; ring?: boolean }) {
  await clear(id);
  await sql()`INSERT INTO installations (id, token_hash) VALUES (${id}, ${`ps-test-${id}`})`;
  await sql()`
    INSERT INTO builder_profiles (builder_id, slug, github_login, reported_github, ring)
    VALUES (${id}, ${`ps${id}`}, ${o.login ?? null}, ${o.reported ?? null}, ${o.ring ? sql().json({ ring: [], ringOwner: [] }) : sql().json({})})`;
}
async function source(id: number, s: { kind: string; ref: string; key?: string; state: string; proof: string | null; by: 'agent' | 'server' }) {
  await sql()`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, ${s.kind}, ${s.ref}, ${s.key ?? s.ref}, ${s.state}, ${s.proof}, ${s.by})`;
}
/** The newest reading of the newest source with this ref, a day before NOW. */
async function reading(ref: string, signals: unknown, day = new Date(NOW.getTime() - DAY)) {
  await sql()`
    INSERT INTO source_readings (source_id, day, signals, ok)
    SELECT id, ${day.toISOString().slice(0, 10)}, ${sql().json(signals as never)}, true
    FROM builder_sources WHERE ref = ${ref} AND builder_id BETWEEN ${T} AND ${T + 19} ORDER BY id DESC LIMIT 1
    ON CONFLICT (source_id, day) DO NOTHING`;
}
async function hosted(id: number, h: { slug: string; repo_key: string; status: string }) {
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${h.slug}, 'lee', ${h.repo_key}, ${id}, 0, 0, ${h.status}, ${new Date(NOW.getTime() - 2 * DAY)})
    ON CONFLICT (slug) DO UPDATE SET installation_id = EXCLUDED.installation_id, status = EXCLUDED.status, repo_key = EXCLUDED.repo_key`;
}
async function live(id: number, l: { score: number; ranked: boolean }) {
  await sql()`DELETE FROM builder_live WHERE builder_id = ${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`ps${id}`}) ON CONFLICT (builder_id) DO NOTHING`;
  await sql()`
    INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at)
    VALUES (${id}, ${l.score}, '{"shipping":{"points":10,"raw":{"mask":0,"live_ships":1}}}'::jsonb, ${l.ranked}, ${l.ranked ? 1 : 0}, 0, 'v2', 'v2-shipping', ${new Date(NOW.getTime() - DAY)})`;
}
/** Yesterday's public history row (formula v2, the live calibration): the 30-point jump is measured against it. */
async function history(id: number, score: number, day = new Date(NOW.getTime() - DAY), calibration = 'v2-shipping') {
  await sql()`
    INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${day.toISOString().slice(0, 10)}, ${score}, 0, '{}', '{}', 'v2', ${calibration}, false)
    ON CONFLICT (builder_id, day) DO NOTHING`;
}
/**
 * A big score: an EarnKit-deployed contract (Shipping's live bonus) with 600 callers across 30 days (people,
 * not scored; `rich`: long-lived wallets sending $100 each) on the person's one project, whose proven repo has
 * commits in the `active` most recent weeks before `at` (default: every week from 80 days before NOW to 30
 * days after it, so Shipping is 100 at any time a test scores). A second call (`seed`) adds a contract and
 * replaces the repo's commit weeks.
 */
async function fakeBigUse(id: number, o: { rich?: boolean; seed?: number; active?: number; at?: Date } = {}) {
  const addr = `0x${hex40(id + 1e9 * (o.seed ?? 0))}`;
  const key = `lee/big${id}`;
  await sql()`UPDATE builder_profiles SET main_project_key = ${key} WHERE builder_id = ${id}`;
  if (!o.seed) await source(id, { kind: 'repo', ref: key, state: 'verified', proof: 'repo_owner', by: 'server' });
  const weeks = o.active !== undefined
    ? Array.from({ length: o.active }, (_, i) => isoWeekOf(new Date((o.at ?? NOW).getTime() - i * 7 * DAY)))
    : Array.from({ length: 17 }, (_, i) => isoWeekOf(new Date(NOW.getTime() + 30 * DAY - i * 7 * DAY)));
  // Readings are append-only: a second call's weeks arrive as the live read (newer than the daily one).
  const signals = sql().json({ owner: 'lee', owner_type: 'User', commit_weeks: weeks } as never);
  if (o.seed) await sql()`
    INSERT INTO source_live (source_id, signals, ok, read_at) SELECT id, ${signals}, true, ${NOW}
    FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND ref = ${key}
    ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals, ok = true, read_at = EXCLUDED.read_at`;
  else await reading(key, { owner: 'lee', owner_type: 'User', commit_weeks: weeks });
  await sql()`
    INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, address, status, cost_micro_usd, created_at)
    VALUES (${id}, ${`k${id}`}, ${key}, 'base', ${`0x${'a'.repeat(64)}`}, ${addr}, 'deployed', 0, ${new Date(NOW.getTime() - 40 * DAY)})`;
  await source(id, { kind: 'contract', ref: `base:${addr}`, key, state: 'verified', proof: 'deployer', by: 'server' });
  const callers = Array.from({ length: 600 }, (_, i) => ({
    id: `wallet:0x${hex40(1_000_000 + i)}`, at: new Date(NOW.getTime() - (i % 30) * DAY - 3_600_000).toISOString(),
    value_usd: o.rich ? 100 : 0, codes: [], ...(o.rich && { first_tx_at: '2024-01-01T00:00:00Z' }),
  }));
  await reading(`base:${addr}`, { callers, partial: false });
}

/** The people (score-v2 countUse, stored on the project rows, never scored) a rescore at `at` counts: the stored ring, as a refresh reads it. */
const useAt = async (id: number, at: Date) => countUse((await personInputsV2(id, at)).input, calibrationV2(), at);

test('4.0 confirmed proofs: earnkit.txt and DNS site proofs are not confirmed', () => {
  assert.equal(isConfirmedProof('repo_owner'), true);
  assert.equal(isConfirmedProof('earnkit_hosted'), true);
  assert.equal(isConfirmedProof('earnkit_txt'), false);
  assert.equal(isConfirmedProof('dns_txt'), false);
  assert.equal(isConfirmedProof(null), false);
});

test('4.1 only confirmed sources score; an agent-reported repo shows as a project and adds nothing', dbTest, async () => {
  const id = T;
  await person(id, { login: null, reported: 'lee' });
  await source(id, { kind: 'repo', ref: 'lee/tipjar', state: 'proposed', proof: null, by: 'agent' });
  await source(id, { kind: 'site', ref: 'https://tip.example.com', key: 'lee/tipjar', state: 'proposed', proof: null, by: 'agent' });
  await reading('https://tip.example.com', { status: 200, up: true });
  const r = await rescorePerson(id, NOW);
  assert.deepEqual(r, { score: 0, ranked: false, held: false });
  const [p] = await sql()`SELECT confirmed, shipped FROM builder_projects WHERE builder_id = ${id}`;
  assert.deepEqual({ ...p }, { confirmed: false, shipped: true });
});

test('4.3 rank counts every listed ranked person with a higher score; ties share a number', dbTest, async () => {
  await live(T + 2, { score: 50, ranked: true });
  await live(T + 3, { score: 30, ranked: true });
  await live(T + 4, { score: 30, ranked: true });
  await live(T + 5, { score: 90, ranked: false });
  const only = [T + 2, T + 3, T + 4, T + 5];
  // v2.12.1 T11 fix round 1: the population is the listed one (claimed with X, shown, not held).
  await sql()`UPDATE builder_profiles SET x_user_id = 'x' || builder_id, x_handle = 'h' || builder_id, hidden = false, held = false WHERE builder_id IN ${sql()(only)}`;
  const s = await standingOf(T + 3, { only });
  assert.deepEqual([s.rank, s.total, s.ranked], [2, 3, true]);
  // A held person leaves the population; asking, they are counted in again (a place for their own reply).
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${T + 4}`;
  assert.deepEqual(await standingOf(T + 3, { only }).then((x) => [x.rank, x.total]), [2, 2]);
  assert.deepEqual(await standingOf(T + 4, { only }).then((x) => [x.rank, x.total]), [2, 3]);
  // Not claimed with X: the same, outside the population until the claim.
  await sql()`UPDATE builder_profiles SET held = false WHERE builder_id = ${T + 4}`;
  await sql()`UPDATE builder_profiles SET x_user_id = NULL WHERE builder_id = ${T + 2}`;
  assert.deepEqual(await standingOf(T + 3, { only }).then((x) => [x.rank, x.total]), [1, 2]);
  assert.deepEqual(await standingOf(T + 2, { only }).then((x) => [x.rank, x.total]), [1, 3]);
  await sql()`UPDATE builder_profiles SET x_user_id = NULL, x_handle = NULL WHERE builder_id IN ${sql()(only)}`;
});

test('4.4 at most 25 tracked projects, most recently active first; a tracked one quiet 90 days frees its place', () => {
  const now = NOW;
  const ps = Array.from({ length: 30 }, (_, i) => ({ key: `p${i}`, last_active_at: new Date(now.getTime() - i * 86_400_000) }));
  const first = trackedKeys(ps, now, new Set());
  assert.equal(first.size, 25);
  assert.ok(first.has('p0') && !first.has('p29'));
  const quiet = ps.map((p) => (p.key === 'p0' ? { ...p, last_active_at: new Date(now.getTime() - 91 * 86_400_000) } : p));
  const next = trackedKeys(quiet, now, first);
  assert.ok(!next.has('p0') && next.has('p25'));
});

test('4.5 a refresh reads at most once in 10 minutes; a failed read keeps the last good number', dbTest, async () => {
  const id = T + 6;
  await person(id, { login: null, reported: 'lee' });
  await source(id, { kind: 'site', ref: 'https://keep.example.com', key: 'keep', state: 'proposed', proof: null, by: 'agent' });
  await reading('https://keep.example.com', { status: 200, up: true }); // yesterday's good reading
  let reads = 0;
  const reader = { ...fakeReader(), probe: async () => { reads++; throw new Error('502'); } };
  await refreshPerson(id, { now: NOW, deadline: Date.now() + 3000, reader });
  const first = reads;
  assert.ok(first >= 1);
  await refreshPerson(id, { now: new Date(NOW.getTime() + 5 * 60_000), deadline: Date.now() + 3000, reader });
  assert.equal(reads, first);
  const [p] = await sql()<{ shipped: boolean }[]>`SELECT shipped FROM builder_projects WHERE builder_id = ${id} AND project_key = 'keep'`;
  assert.equal(p.shipped, true); // the failed read did not replace the last good one
  await refreshPerson(id, { now: new Date(NOW.getTime() + 11 * 60_000), deadline: Date.now() + 3000, reader });
  assert.ok(reads > first);
});

test('4.5b (final fix wave) a page view re-reads only a person last read over a day ago, under a global hourly cap and a per-IP cap', dbTest, async () => {
  const id = T + 6;
  await person(id, { login: null, reported: 'lee' });
  await source(id, { kind: 'site', ref: 'https://keep.example.com', key: 'keep', state: 'proposed', proof: null, by: 'agent' });
  let reads = 0;
  const reader = { ...fakeReader(), probe: async () => { reads++; return { status: 200 }; } };
  const ip = `203.0.113.${process.pid % 250}`;
  const view = (at: number, from = ip) => pageViewRefresh(id, { now: new Date(NOW.getTime() + at), deadline: Date.now() + 3000, ip: from, reader });
  assert.equal(PAGE_REFRESH_MS, 86_400_000);
  // Never read: the first view reads (a claim resets read_at the same way).
  assert.deepEqual(await view(0), { refreshed: true });
  const first = reads;
  assert.ok(first >= 1);
  // find and score keep the 10-minute refresh; a page view waits a day.
  assert.deepEqual(await view(11 * 60_000), { refreshed: false });
  assert.deepEqual(await view(23 * 3_600_000), { refreshed: false });
  assert.equal(reads, first, 'nothing read');
  assert.deepEqual(await refreshPerson(id, { now: new Date(NOW.getTime() + 11 * 60_000), deadline: Date.now() + 3000, reader }), { refreshed: true });
  const asked = reads;
  assert.ok(asked > first, 'the person asking still refreshes at 10 minutes');
  // A day after that read: the view reads again.
  const day = 11 * 60_000 + PAGE_REFRESH_MS + 60_000;
  assert.deepEqual(await view(day), { refreshed: true });
  assert.ok(reads > asked);
  // The caps: this IP is out of views for the hour, then every IP is.
  const at = new Date(NOW.getTime() + 2 * PAGE_REFRESH_MS);
  const seed = async (key: string, count: number) => {
    const start = windowStart(at, 3_600_000);
    await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${key}, ${start}, ${count})
      ON CONFLICT (key, window_start) DO UPDATE SET count = EXCLUDED.count`;
  };
  await seed(`pageRefreshIp:${ip}`, LIMITS.pageRefreshIp.limit);
  const n = reads;
  assert.deepEqual(await view(2 * PAGE_REFRESH_MS), { refreshed: false }, 'per-IP cap');
  assert.equal(reads, n);
  await seed('pageRefresh:global', LIMITS.pageRefresh.limit);
  try {
    assert.deepEqual(await view(2 * PAGE_REFRESH_MS, `198.51.100.${process.pid % 250}`), { refreshed: false }, 'global cap');
    assert.equal(reads, n);
  } finally {
    await sql()`DELETE FROM rate_windows WHERE key = 'pageRefresh:global'`;
  }
  assert.equal(LIMITS.pageRefresh.limit, 200);
  assert.equal(LIMITS.pageRefresh.windowSeconds, 3_600);
});

test('4.6 a 30-point jump is held: the public score stays, the new one waits in pending', dbTest, async () => {
  const id = T + 7;
  await person(id, {});
  await history(id, 10);
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id); // 600 callers across 30 days on an EarnKit-deployed contract
  const r = await rescorePerson(id, NOW);
  assert.equal(r.held, true);
  const [row] = await sql()<{ score: number; pending: { score: number } | null }[]>`SELECT score, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.equal(row.score, 10);
  assert.ok(row.pending!.score >= 40);
});

test('4.8 a tagged call marks the project tagged; junk in a reading never makes the score NaN; own wallets never count', dbTest, async () => {
  const id = T + 9;
  await person(id, {});
  const addr = `0x${hex40(id + 3)}`;
  const own = `0x${hex40(id + 4)}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${own}, ${id}) ON CONFLICT (wallet) DO UPDATE SET builder_id = EXCLUDED.builder_id`;
  await source(id, { kind: 'contract', ref: `base:${addr}`, key: `lee/tag${id}`, state: 'verified', proof: 'deploy_wallet', by: 'server' });
  const at = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
  await reading(`base:${addr}`, {
    callers: [
      { id: `wallet:0x${hex40(3_000_001)}`, at: at(1), value_usd: 'NaN', codes: ['earnkit'] },
      { id: `wallet:0x${hex40(3_000_002)}`, at: at(2), value_usd: Infinity, codes: [] },
      { id: `wallet:0x${hex40(3_000_003)}`, at: at(3), value_usd: 5 },
      { id: `wallet:${own}`, at: at(1), value_usd: 50 },
      { id: 42, at: at(1), value_usd: 1 },
      { id: `wallet:0x${hex40(3_000_004)}`, at: 'yesterday', value_usd: 1 },
    ],
    partial: false,
  });
  const r = await rescorePerson(id, NOW);
  assert.ok(Number.isFinite(r.score) && r.score > 0, String(r.score));
  const [p] = await sql()`SELECT tagged, sends_tx, people, kind FROM builder_projects WHERE builder_id = ${id}`;
  assert.deepEqual({ ...p }, { tagged: true, sends_tx: true, people: 3, kind: 'contract' });
});

test('4.10 a refresh with a good read uses it over the daily one; a first refresh is never held against its own claim row', dbTest, async () => {
  const id = T + 11;
  await person(id, { login: null });
  await hosted(id, { slug: `up${id}`, repo_key: `lee/up${id}`, status: 'live' });
  await fakeBigUse(id);
  const reader = { ...fakeReader(), baseTxs: async () => ({ items: [], next_page_params: null }), usdPerNative: async () => 2000 };
  const r = await refreshPerson(id, { now: NOW, deadline: Date.now() + 3000, reader });
  assert.deepEqual(r, { refreshed: true });
  const [l] = await sql()<{ score: number; pending: unknown; read_at: Date }[]>`SELECT score, pending, read_at FROM builder_live WHERE builder_id = ${id}`;
  assert.ok(l.score >= 40, 'the claim row (score 0) is not a previous score: no 30-point hold');
  assert.equal(l.pending, null);
  const [live] = await sql()<{ ok: boolean }[]>`SELECT ok FROM source_live WHERE source_id = (SELECT id FROM builder_sources WHERE builder_id = ${id} AND kind = 'contract')`;
  assert.equal(live.ok, true);
});

test('4.11 the cron score step: one history row per person per day (formula v2), and a rerun with nothing new scores no one', dbTest, async () => {
  const id = T + 12;
  await person(id, {});
  await hosted(id, { slug: `cr${id}`, repo_key: `lee/cr${id}`, status: 'live' });
  await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [id] });
  const [h] = await sql()<{ formula: string; score: number; held: boolean }[]>`SELECT formula, score, held FROM builder_scores WHERE builder_id = ${id} AND day = ${NOW.toISOString().slice(0, 10)}`;
  assert.deepEqual({ ...h }, { formula: 'v2', score: 10, held: false });
  assert.deepEqual(await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [id] }), { scored: 0, held: [] });
});

test('4.12 the owner releasing a held day makes the pending live score public', dbTest, async () => {
  const id = T + 13;
  const day = new Date(NOW.getTime() + 2 * DAY);
  await person(id, {});
  await history(id, 10, new Date(day.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id);
  const r = await scorePeopleV2(day, { deadline: Date.now() + 10_000, only: [id] });
  const [before] = await sql()<{ score: number; pending: { score: number } | null }[]>`SELECT score, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual(r.held, [id]);
  assert.equal(before.score, 10);
  const target = before.pending!.score;
  // The held history row carries what the owner reviews: the pending score, not the public one.
  const [h] = await sql()<{ score: number; held: boolean }[]>`SELECT score, held FROM builder_scores WHERE builder_id = ${id} AND day = ${day.toISOString().slice(0, 10)}`;
  assert.deepEqual({ ...h }, { score: target, held: true });
  // /admin/scores shows the v2 day, its parts, and the public live score.
  const review = (await heldForReview()).find((x) => x.builder_id === id)!;
  assert.deepEqual([review.score, review.formula, review.shown?.score], [target, 'v2', 10]);
  const lines = partLines(review.parts);
  assert.deepEqual(lines, ['shipping: 100 (mask 4095, weeks 12, recent 4, live_ships 1)']);
  assert.deepEqual(partLines('junk'), []);
  process.env.ADMIN_VETO_SECRET = 'k'.repeat(40);
  try {
    const body = new URLSearchParams({ key: scoresAdminKey()!, builder: String(id), day: day.toISOString().slice(0, 10) });
    const res = await scoresPost(new Request('https://earnkit.com/api/admin/scores', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }), { limit: async () => {} });
    assert.equal(res.status, 303);
  } finally {
    delete process.env.ADMIN_VETO_SECRET;
  }
  const [after] = await sql()<{ score: number; pending: unknown }[]>`SELECT score, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual({ ...after }, { score: target, pending: null });
});

test('4.13 a refresh runs discovery when the person is queued, then at most once a day', dbTest, async () => {
  const id = T + 14;
  await person(id, {});
  await sql()`DELETE FROM discovery_queue WHERE builder_id = ${id}`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'first_find')`;
  const doneAt = async () => (await sql()<{ done_at: Date | null }[]>`SELECT done_at FROM discovery_queue WHERE builder_id = ${id}`)[0].done_at;
  try {
    await refreshPerson(id, { now: NOW, deadline: Date.now() + 3000, reader: fakeReader() });
    const first = await doneAt();
    assert.ok(first, 'queued: discovered and marked done');
    await refreshPerson(id, { now: new Date(NOW.getTime() + 11 * 60_000), deadline: Date.now() + 3000, reader: fakeReader() });
    assert.equal((await doneAt())!.getTime(), first.getTime(), 'done less than a day ago: not discovered again');
  } finally {
    await sql()`DELETE FROM discovery_queue WHERE builder_id = ${id}`;
  }
});

test('4.14 the 30-point jump is measured against yesterday\'s public score: 10, then 39, then 53 within the hour is held', dbTest, async () => {
  const id = T + 15;
  await person(id, {});
  await history(id, 10);
  await live(id, { score: 39, ranked: true }); // stepped up by an earlier refresh (29 points: not held)
  await fakeBigUse(id);
  const r = await rescorePerson(id, NOW);
  assert.equal(r.held, true);
  const [row] = await sql()<{ score: number; pending: { score: number } | null }[]>`SELECT score, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.equal(row.score, 39);
  assert.ok(row.pending!.score >= 40, String(row.pending?.score));
});

test('4.15 scoring and clarity: a first score of 60+ with all its people from one contract is never held (people are not scored)', dbTest, async () => {
  const id = T + 16;
  await person(id, {});
  await fakeBigUse(id, { rich: true });
  const r = await rescorePerson(id, NOW);
  assert.deepEqual([r.held, r.score, r.ranked], [false, 100, true]);
  const [row] = await sql()<{ score: number; ranked: boolean; pending: unknown }[]>`SELECT score, ranked, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual([row.score, row.ranked, row.pending], [100, true, null]);
  const [p] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.held, false);
});

test('4.15c the review hold measures a jump only from a history row of the live calibration (the four-part score is never the baseline)', dbTest, async () => {
  const id = T + 16;
  await person(id, {});
  await history(id, 10, new Date(NOW.getTime() - DAY), 'v2-launch');
  await fakeBigUse(id);
  assert.equal((await rescorePerson(id, NOW)).held, false, 'a 90-point rise from a v2-launch row is not a jump');
});

test('4.16 a release is refused when the pending score changed after the owner reviewed it', dbTest, async () => {
  const id = T + 17;
  const day = new Date(NOW.getTime() + 3 * DAY);
  const d = day.toISOString().slice(0, 10);
  await person(id, {});
  await history(id, 10, new Date(day.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id);
  await scorePeopleV2(day, { deadline: Date.now() + 10_000, only: [id] });
  // A later rescore replaced what the owner saw.
  await sql()`UPDATE builder_live SET pending = jsonb_set(jsonb_set(pending, '{day}', to_jsonb(${new Date(day.getTime() + DAY).toISOString().slice(0, 10)}::text)), '{score}', '99') WHERE builder_id = ${id}`;
  process.env.ADMIN_VETO_SECRET = 'k'.repeat(40);
  let res: Response;
  try {
    const body = new URLSearchParams({ key: scoresAdminKey()!, builder: String(id), day: d });
    res = await scoresPost(new Request('https://earnkit.com/api/admin/scores', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }), { limit: async () => {} });
  } finally {
    delete process.env.ADMIN_VETO_SECRET;
  }
  assert.equal(res.status, 409);
  assert.match(await res.text(), /changed after/);
  const [l] = await sql()<{ score: number }[]>`SELECT score FROM builder_live WHERE builder_id = ${id}`;
  assert.equal(l.score, 10);
  assert.equal((await sql()`SELECT 1 FROM score_releases WHERE builder_id = ${id} AND day = ${d}`).length, 0);
});

test('4.17 a shared client\'s group is never refreshed', dbTest, async () => {
  const id = T + 18;
  await person(id, {});
  await sql()`UPDATE installations SET shared_client = true WHERE id = ${id}`;
  let reads = 0;
  const reader = { ...fakeReader(), probe: async () => (reads++, { status: 200 }) };
  assert.deepEqual(await refreshPerson(id, { now: NOW, deadline: Date.now() + 3000, reader }), { refreshed: false });
  assert.equal((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${id}`).length, 0);
  assert.equal(reads, 0);
});

test('4.18 a refresh reads only the person\'s stored ring (no scan of everyone\'s edges); the cron step stores it', dbTest, async () => {
  const [a, b] = [T + 19, T + 5];
  const [la, lb] = [`ra${T}`, `rb${T}`];
  await person(a, { login: la });
  await person(b, { login: lb });
  const star = (who: string) => ({ owner: 'x', owner_type: 'User', fork: false, template: false, stargazers: [{ id: `gh:${who}`, at: new Date(NOW.getTime() - 2 * DAY).toISOString(), created_at: '2020-01-01T00:00:00Z' }], forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false });
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  await source(b, { kind: 'repo', ref: `${lb}/y`, state: 'verified', proof: 'repo_owner', by: 'server' });
  await reading(`${la}/x`, star(lb));
  await reading(`${lb}/y`, star(la));
  const faded = (days: number) => 0.5 ** (days / 90); // the star is 2 days old at NOW
  // No stored ring yet: the refresh looks up only the owners of the accounts that touched a's work
  // (never everyone's edges): b is another EarnKit person, so b's star weighs 0.5.
  await refreshPerson(a, { now: NOW, deadline: Date.now() + 3000, reader: fakeReader() });
  const first = (await useAt(a, NOW)).star_fork;
  assert.ok(Math.abs(first - 0.5 * faded(2)) < 1e-6, String(first));
  // The cron step computes and stores the ring: b and a star each other, so b's star weighs 0.5.
  await scorePeopleV2(new Date(NOW.getTime() + 4 * DAY), { deadline: Date.now() + 10_000, only: [a] });
  const [p] = await sql()<{ ring: { ring?: [string, number][] } }[]>`SELECT ring FROM builder_profiles WHERE builder_id = ${a}`;
  assert.deepEqual(p.ring.ring, [[`gh:${lb}`, 0.5]]);
  const at = new Date(NOW.getTime() + 4 * DAY + 11 * 60_000);
  await refreshPerson(a, { now: at, deadline: Date.now() + 3000, reader: fakeReader() });
  const then = (await useAt(a, at)).star_fork;
  assert.ok(Math.abs(then - 0.5 * faded(6 + 11 / 1440)) < 1e-6, String(then));
});

test('4.19 a never-computed ring fails strict: another person\'s account counts 0.5; R4: the ring no longer gates the rank', dbTest, async () => {
  const [a, c] = [T + 3, T + 4];
  const [la, lc] = [`na${T}`, `nc${T}`];
  await person(c, { login: lc, ring: true });
  await person(a, { login: la });
  await hosted(a, { slug: `nr${a}`, repo_key: `${la}/x`, status: 'live' });
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  const starred = { owner: la, owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
    stargazers: [{ id: `gh:${lc}`, at: new Date(NOW.getTime() - 2 * DAY).toISOString(), created_at: '2020-01-01T00:00:00Z' }] };
  await reading(`${la}/x`, starred);
  await mainIs(a, `${la}/x`);
  const r = await rescorePerson(a, NOW);
  assert.equal(r.ranked, true, 'R4: a confirmed project with a repo reading ranks before the ring is computed');
  const v = (await useAt(a, NOW)).star_fork;
  assert.ok(Math.abs(v - 0.5 * 0.5 ** (2 / 90)) < 1e-6, String(v));
  // A redaction-cleared ring ('{}') is never-computed too; a malformed one as well: strict, still ranked.
  await sql()`UPDATE builder_profiles SET ring = '{"ring": "junk"}'::jsonb WHERE builder_id = ${a}`;
  assert.equal((await rescorePerson(a, NOW)).ranked, true);
  assert.ok(Math.abs((await useAt(a, NOW)).star_fork - v) < 1e-9);
  await scorePeopleV2(new Date(NOW.getTime() + 5 * DAY), { deadline: Date.now() + 10_000, only: [a] });
  assert.equal((await sql()<{ ranked: boolean }[]>`SELECT ranked FROM builder_live WHERE builder_id = ${a}`)[0].ranked, true);
});

test('4.20 with a stored ring, an account another person owns that the ring does not name still counts 0.5', dbTest, async () => {
  const [a, c] = [T + 2, T + 6];
  const [la, lc] = [`sa${T}`, `sc${T}`];
  await person(c, { login: lc, ring: true });
  await person(a, { login: la, ring: true });
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  await reading(`${la}/x`, { owner: la, owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
    stargazers: [{ id: `gh:${lc}`, at: NOW.toISOString(), created_at: '2020-01-01T00:00:00Z' }, { id: 'gh:stranger-x', at: NOW.toISOString(), created_at: '2020-01-01T00:00:00Z' }] });
  await rescorePerson(a, NOW);
  const v = (await useAt(a, NOW)).star_fork;
  assert.ok(Math.abs(v - 1.5) < 1e-6, String(v));
});

const release = async (id: number, f: Record<string, string>) => {
  process.env.ADMIN_VETO_SECRET = 'k'.repeat(40);
  try {
    const body = new URLSearchParams({ key: scoresAdminKey()!, builder: String(id), ...f });
    return await scoresPost(new Request('https://earnkit.com/api/admin/scores', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }), { limit: async () => {} });
  } finally {
    delete process.env.ADMIN_VETO_SECRET;
  }
};

test('4.21 a held day stays releasable after a later rescore changes the pending score: the review shows the current one', dbTest, async () => {
  const id = T + 9;
  const day = new Date(NOW.getTime() + 6 * DAY);
  await person(id, {});
  await history(id, 10, new Date(day.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id);
  await scorePeopleV2(day, { deadline: Date.now() + 10_000, only: [id] });
  // A refresh later that day: more use, a new pending score.
  await fakeBigUse(id, { rich: true, seed: 1 });
  await rescorePerson(id, new Date(day.getTime() + 3_600_000));
  const [l] = await sql()<{ pending: { score: number } }[]>`SELECT pending FROM builder_live WHERE builder_id = ${id}`;
  const review = (await heldForReview()).find((x) => x.builder_id === id)!;
  assert.equal(review.score, l.pending.score, 'the review page shows the current pending score');
  const res = await release(id, { day: review.day, ...(review.version && { version: review.version }) });
  assert.equal(res.status, 303);
  const [after] = await sql()<{ score: number; pending: unknown }[]>`SELECT score, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual({ ...after }, { score: l.pending.score, pending: null });
});

test('4.22 a refresh that holds after the cron wrote an unheld day still puts the person up for review', dbTest, async () => {
  const id = T + 10;
  const day = new Date(NOW.getTime() + 7 * DAY);
  await person(id, { ring: true });
  await history(id, 10, new Date(day.getTime() - DAY));
  await hosted(id, { slug: `rv${id}`, repo_key: `lee/rv${id}`, status: 'live' });
  await scorePeopleV2(day, { deadline: Date.now() + 10_000, only: [id] }); // unheld (10, then 10)
  await fakeBigUse(id);
  const r = await rescorePerson(id, new Date(day.getTime() + 3_600_000));
  assert.equal(r.held, true);
  const review = (await heldForReview()).find((x) => x.builder_id === id);
  assert.ok(review, 'held people always have a review row');
  assert.equal((await release(id, { day: review.day, ...(review.version && { version: review.version }) })).status, 303);
  const [after] = await sql()<{ score: number; pending: unknown }[]>`SELECT score, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.ok(after.score >= 40 && after.pending === null, JSON.stringify(after));
  assert.equal((await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`)[0].held, false);
});

test('4.23 a one-directional user who is another EarnKit person: 0.5 in a refresh before the cron, 1.0 once the cron has checked the full graph', dbTest, async () => {
  const [a, c] = [T + 11, T + 12];
  const [la, lc] = [`oa${T}`, `oc${T}`];
  await person(c, { login: lc, ring: true });
  await person(a, { login: la });
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  await reading(`${la}/x`, { owner: la, owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
    stargazers: [{ id: `gh:${lc}`, at: NOW.toISOString(), created_at: '2020-01-01T00:00:00Z' }] });
  const starFork = async (at: Date) => (await useAt(a, at)).star_fork;
  assert.ok(Math.abs((await starFork(NOW)) - 0.5) < 1e-6, String(await starFork(NOW)));
  await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [a] });
  assert.ok(Math.abs((await starFork(NOW)) - 1) < 1e-6, String(await starFork(NOW)));
  // The next refresh reads the stored check: still in full.
  const t11 = new Date(NOW.getTime() + 11 * 60_000);
  assert.ok(Math.abs((await starFork(t11)) - 0.5 ** ((11 / 1440) / 90)) < 1e-6, String(await starFork(t11)));
  // A check older than 36 hours is not honoured: strict again until the next cron run.
  const t37 = new Date(NOW.getTime() + 37 * 3_600_000);
  assert.ok(Math.abs((await starFork(t37)) - 0.5 * 0.5 ** ((37 / 24) / 90)) < 1e-6, String(await starFork(t37)));
});

test('4.24 a release publishes only the reviewed pending score: a cron-held day the owner never saw stays private and is never the baseline', dbTest, async () => {
  const id = T + 13;
  const D = new Date(NOW.getTime() + 9 * DAY);
  const d = D.toISOString().slice(0, 10);
  await person(id, { ring: true });
  await history(id, 10, new Date(D.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id, { active: 4, at: D }); // the live bonus and the last 4 weeks: 58
  await scorePeopleV2(D, { deadline: Date.now() + 10_000, only: [id] }); // the cron holds 58 on D
  const [cronHeld] = await sql()<{ score: number; held: boolean }[]>`SELECT score, held FROM builder_scores WHERE builder_id = ${id} AND day = ${d}`;
  assert.equal(cronHeld.held, true);
  // A later rescore that day holds 30 instead; the owner reviews and releases 30.
  await sql()`UPDATE builder_live SET pending = jsonb_set(jsonb_set(pending, '{score}', '30'), '{at}', '"v-30"') WHERE builder_id = ${id}`;
  assert.equal((await release(id, { day: d, version: 'v-30' })).status, 303);
  assert.equal((await sql()<{ score: number }[]>`SELECT score FROM builder_live WHERE builder_id = ${id}`)[0].score, 30);
  const pub = await sql()`SELECT 1 FROM builder_scores s WHERE s.builder_id = ${id} AND s.day = ${d} AND ${publicRow()}`;
  assert.equal(pub.length, 0, `the cron-held ${cronHeld.score} was never reviewed: not public`);
  // The next day's rescore (58) is measured from the released 30, not from 10 (held) or the unseen day.
  const r = await rescorePerson(id, new Date(D.getTime() + DAY));
  assert.equal(r.held, false, 'a 28-point rise from the released 30');
  assert.equal((await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`)[0].held, false);
});

test('4.25 a checked account whose owner changed since the cron counts 0.5 again in a refresh', dbTest, async () => {
  const [a, c, e] = [T + 14, T + 15, T + 16];
  const [la, lc] = [`ka${T}`, `kc${T}`];
  await person(c, { login: lc, ring: true });
  await person(e, { ring: true });
  await person(a, { login: la });
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  await reading(`${la}/x`, { owner: la, owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
    stargazers: [{ id: `gh:${lc}`, at: NOW.toISOString(), created_at: '2020-01-01T00:00:00Z' }] });
  await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [a] });
  assert.ok(Math.abs((await useAt(a, NOW)).star_fork - 1) < 1e-6, 'checked by the cron: in full');
  // The login now belongs to another person.
  await sql()`UPDATE builder_profiles SET github_login = NULL WHERE builder_id = ${c}`;
  await sql()`UPDATE builder_profiles SET github_login = ${lc} WHERE builder_id = ${e}`;
  const t11 = new Date(NOW.getTime() + 11 * 60_000);
  const v = (await useAt(a, t11)).star_fork;
  assert.ok(Math.abs(v - 0.5 * 0.5 ** ((11 / 1440) / 90)) < 1e-6, String(v));
});

// ---- Fix round 4.

test('4.27 a refresh newer than the cron run never stops the cron storing the ring: checked_at is the run; R4: ranked by its repo reading either way', dbTest, async () => {
  const [a, c] = [T + 18, T + 19];
  const [la, lc] = [`ra${T}`, `rc${T}`];
  await person(c, { login: lc, ring: true });
  await person(a, { login: la });
  await hosted(a, { slug: `rk${a}`, repo_key: `${la}/x`, status: 'live' });
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  await reading(`${la}/x`, { owner: la, owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
    stargazers: [{ id: `gh:${lc}`, at: NOW.toISOString(), created_at: '2020-01-01T00:00:00Z' }] });
  await mainIs(a, `${la}/x`);
  // A refresh during the cron run, before this person's turn: a later `now`, never-computed ring.
  const later = new Date(NOW.getTime() + 10 * 60_000);
  assert.equal((await rescorePerson(a, later)).ranked, true);
  await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [a] });
  const [p] = await sql()<{ ring: { ring?: unknown; checked?: [string, number[]][]; checked_at?: string } }[]>`SELECT ring FROM builder_profiles WHERE builder_id = ${a}`;
  assert.ok(Array.isArray(p.ring.ring), 'the cron stored the ring');
  assert.equal(p.ring.checked_at, NOW.toISOString());
  assert.ok(p.ring.checked?.some(([acct]) => acct === `gh:${lc}`));
  const [l] = await sql()<{ ranked: boolean; computed_at: Date }[]>`SELECT ranked, computed_at FROM builder_live WHERE builder_id = ${a}`;
  // The cron rescored the newer row with its computed ring at the row's own time: the other person's
  // star (checked by the cron) counts in full; computed_at never moves back.
  const starNow = (await useAt(a, later)).star_fork;
  assert.equal(l.ranked, true);
  assert.ok(Math.abs(starNow - 0.5 ** ((10 / 1440) / 90)) < 1e-6, String(starNow));
  assert.equal(l.computed_at.getTime(), later.getTime(), 'computed_at stays the newer row\'s');
  // The next refresh honours the cron's check too.
  const t21 = new Date(NOW.getTime() + 21 * 60_000);
  await refreshPerson(a, { now: t21, deadline: Date.now() + 3000, reader: fakeReader() });
  const v = (await useAt(a, t21)).star_fork;
  assert.ok(Math.abs(v - 0.5 ** ((21 / 1440) / 90)) < 1e-6, String(v));
  assert.equal((await sql()<{ ranked: boolean }[]>`SELECT ranked FROM builder_live WHERE builder_id = ${a}`)[0].ranked, true);
});

test('4.33 a cron rescore of a newer held row gets a new version: the review page shown before it is refused once', dbTest, async () => {
  const id = T + 6;
  const D = new Date(NOW.getTime() + 22 * DAY);
  await person(id, { ring: true });
  await history(id, 10, new Date(D.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id);
  const later = new Date(D.getTime() + 10 * 60_000);
  assert.equal((await rescorePerson(id, later)).held, true);
  const shown = (await heldForReview()).find((x) => x.builder_id === id)!;
  await scorePeopleV2(D, { deadline: Date.now() + 10_000, only: [id] });
  const now = (await heldForReview()).find((x) => x.builder_id === id)!;
  assert.notEqual(now.version, shown.version);
  assert.equal((await release(id, { day: shown.day, version: shown.version! })).status, 409);
  assert.equal((await release(id, { day: now.day, version: now.version! })).status, 303);
});

test('4.31 a day-only release keeps the profile held while an earlier v1 held day is not public', dbTest, async () => {
  const id = T + 8;
  await person(id, {});
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${id}`;
  const [d0, d1] = [new Date(NOW.getTime() + 17 * DAY), new Date(NOW.getTime() + 18 * DAY)].map((t) => t.toISOString().slice(0, 10));
  await sql()`
    INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${d0}, 60, 0, '{}', '{}', 'v1', 'v1-launch', true), (${id}, ${d1}, 70, 0, '{}', '{}', 'v1', 'v1-launch', true)
    ON CONFLICT (builder_id, day) DO NOTHING`;
  assert.equal((await release(id, { day: d1 })).status, 303);
  assert.equal((await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`)[0].held, true, `${d0} (v1) still waits`);
  assert.equal((await release(id, { day: d0 })).status, 303);
  assert.equal((await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`)[0].held, false);
});

test('4.28 a second release on the same day keeps the earlier released score public', dbTest, async () => {
  const id = T + 5;
  const D = new Date(NOW.getTime() + 12 * DAY);
  const d = D.toISOString().slice(0, 10);
  await person(id, { ring: true });
  await history(id, 10, new Date(D.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id, { active: 4, at: D });
  await scorePeopleV2(D, { deadline: Date.now() + 10_000, only: [id] }); // the cron holds 58 on D
  const isPublic = async () => (await sql()`SELECT 1 FROM builder_scores s WHERE s.builder_id = ${id} AND s.day = ${d} AND ${publicRow()}`).length === 1;
  const version = async () => (await heldForReview()).find((x) => x.builder_id === id)!.version!;
  assert.equal((await release(id, { day: d, version: await version() })).status, 303);
  assert.ok(await isPublic(), 'the reviewed cron score is public');
  // Later that day a bigger rescore (100, code every week) is held again and the owner releases it too.
  await fakeBigUse(id, { rich: true, seed: 2 });
  assert.equal((await rescorePerson(id, new Date(D.getTime() + 3_600_000))).held, true);
  assert.equal((await release(id, { day: d, version: await version() })).status, 303);
  assert.ok(await isPublic(), 'the earlier released score stays public');
});

test('4.29 the day-only release never publishes an unreviewed v2 day, and a held v1 day keeps the profile held while a later day is not public', dbTest, async () => {
  const id = T + 7;
  const D = new Date(NOW.getTime() + 14 * DAY);
  const d = D.toISOString().slice(0, 10);
  await person(id, { ring: true });
  await history(id, 10, new Date(D.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id);
  await scorePeopleV2(D, { deadline: Date.now() + 10_000, only: [id] });
  const [h] = await sql()<{ score: number; held: boolean }[]>`SELECT score, held FROM builder_scores WHERE builder_id = ${id} AND day = ${d}`;
  assert.equal(h.held, true);
  const keep = (await sql()<{ pending: unknown }[]>`SELECT pending FROM builder_live WHERE builder_id = ${id}`)[0].pending;
  // Nothing pending (a later unheld rescore replaced it): a hand-made day-only POST is refused.
  await sql()`UPDATE builder_live SET pending = NULL WHERE builder_id = ${id}`;
  assert.equal((await release(id, { day: d })).status, 409);
  assert.equal((await sql()`SELECT 1 FROM score_releases WHERE builder_id = ${id} AND day = ${d}`).length, 0);
  // With the reviewed pending score, the day-only release names it.
  await sql()`UPDATE builder_live SET pending = ${sql().json(keep as never)} WHERE builder_id = ${id}`;
  assert.equal((await release(id, { day: d })).status, 303);
  const [x] = await sql()<{ score: number | null }[]>`SELECT score FROM score_releases WHERE builder_id = ${id} AND day = ${d}`;
  assert.equal(x.score, h.score);

  // Held clearing follows publicRow: a later v2 day whose release names another score is not public.
  const id2 = T + 8;
  await person(id2, {});
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${id2}`;
  const [d1, d2] = [new Date(NOW.getTime() + 15 * DAY), new Date(NOW.getTime() + 16 * DAY)].map((t) => t.toISOString().slice(0, 10));
  await sql()`
    INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id2}, ${d1}, 70, 0, '{}', '{}', 'v1', 'v1-launch', true), (${id2}, ${d2}, 55, 0, '{}', '{}', 'v2', 'v2-launch', true)
    ON CONFLICT (builder_id, day) DO NOTHING`;
  await sql()`INSERT INTO score_releases (builder_id, day, score) VALUES (${id2}, ${d2}, 30) ON CONFLICT DO NOTHING`;
  assert.equal((await release(id2, { day: d1 })).status, 303);
  assert.equal((await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id2}`)[0].held, true, `${d2}'s 55 is still not public`);
});

// ---- Restored in v2.14 T3 fix round 1: scoring rules on the Bench (the one project named first, as find does) ----

/** The Bench: find names the one project before any rescore (main-project.ts). */
const mainIs = (id: number, key: string) => sql()`UPDATE builder_profiles SET main_project_key = ${key} WHERE builder_id = ${id}`;
/** ...and, for a repo key, the repo proven (benchConfirmedSql): a hosted app or a coin alone is not on the Bench. */
const mainProven = async (id: number, key: string) => {
  await mainIs(id, key);
  await source(id, { kind: 'repo', ref: key, state: 'verified', proof: 'repo_owner', by: 'server' });
  // R4: ranked needs a repo reading (no commits: Shipping counts the live bonus only).
  await reading(key, { owner: 'lee', owner_type: 'User', commit_weeks: [] });
};

test('4.2 an EarnKit-hosted live app is a live ship: ranked, Shipping 10 (the live bonus)', dbTest, async () => {
  const id = T + 1;
  await person(id, { ring: true });
  await hosted(id, { slug: `tip${id}`, repo_key: `lee/tip${id}`, status: 'live' });
  await mainProven(id, `lee/tip${id}`);
  const r = await rescorePerson(id, NOW);
  assert.equal(r.ranked, true);
  const [l] = await sql()<{ parts: { shipping: { points: number; raw: { live_ships: number } } } }[]>`SELECT parts FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual([l.parts.shipping.points, l.parts.shipping.raw.live_ships], [10, 1]);
});

test('4.2b R4 the ranked rule: a confirmed project ranks only once a repo of it has a reading; no commits ranks at 0', dbTest, async () => {
  const id = T + 1;
  await person(id, { ring: true });
  const key = `lee/rk${id}`;
  await mainIs(id, key);
  await source(id, { kind: 'repo', ref: key, state: 'verified', proof: 'repo_owner', by: 'server' });
  assert.deepEqual(await rescorePerson(id, NOW), { score: 0, ranked: false, held: false }, 'confirmed, never read: not ranked');
  await reading(key, { owner: 'lee', owner_type: 'User', commit_weeks: [] });
  assert.deepEqual(await rescorePerson(id, NOW), { score: 0, ranked: true, held: false }, 'read, no commits: ranked at 0, never hidden');
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at)
    SELECT id, ${sql().json({ owner: 'lee', owner_type: 'User', commit_weeks: [isoWeekOf(NOW)] } as never)}, true, ${NOW} FROM builder_sources WHERE builder_id = ${id} AND ref = ${key}`;
  assert.deepEqual(await rescorePerson(id, NOW), { score: 14, ranked: true, held: false }, 'this week only: 14');
  // A proposed (unproven) repo with a reading never ranks.
  await sql()`UPDATE builder_sources SET state = 'proposed', proof = NULL WHERE builder_id = ${id} AND ref = ${key}`;
  assert.equal((await rescorePerson(id, NOW)).ranked, false);
});

test('4.7 coin buys count as people and the creator fees as money on the project row; neither is scored, and a coin is not a live ship', dbTest, async () => {
  const id = T + 8;
  await person(id, { ring: true });
  const coin = `0x${hex40(id + 7)}`;
  const creator = `0x${hex40(id + 8)}`;
  const key = `lee/coin${id}`;
  await mainProven(id, key);
  await sql()`
    INSERT INTO projects (program_id, name, installation_id, coin_address, creator_wallet, repo_key, coin_launched_at)
    VALUES ('earnkit-coin', 'Tip coin', ${id}, ${coin}, ${creator}, ${key}, ${new Date(NOW.getTime() - 20 * DAY)})`;
  await sql()`
    INSERT INTO token_fees (wallet, weth, usd, read_at) VALUES (${creator}, '0', 120, now())
    ON CONFLICT (wallet) DO UPDATE SET usd = 120`;
  await source(id, { kind: 'coin', ref: `base:${coin}`, key, state: 'verified', proof: 'earnkit_hosted', by: 'server' });
  const traders = Array.from({ length: 12 }, (_, i) => ({ id: `wallet:0x${hex40(2_000_000 + i)}`, at: new Date(NOW.getTime() - (i % 6) * DAY).toISOString() }));
  await reading(`base:${coin}`, { traders, partial: false });
  const r = await rescorePerson(id, NOW);
  assert.equal(r.ranked, true);
  assert.equal(r.score, 0, 'no commits and no live ship');
  const [l] = await sql()<{ parts: Record<string, unknown> }[]>`SELECT parts FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual(Object.keys(l.parts), ['shipping']);
  const use = await useAt(id, NOW);
  assert.ok(use.U > 0, 'coin buys are people using it');
  assert.equal(use.E, 120);
  const [p] = await sql()`SELECT kind, has_coin, confirmed, people, money_usd::float AS money FROM builder_projects WHERE builder_id = ${id}`;
  assert.deepEqual({ ...p }, { kind: 'coin', has_coin: true, confirmed: true, people: 12, money: 120 });
});

test('4.19b (final fix wave) a never-computed ring with no other EarnKit person touching the work ranks on the first rescore', dbTest, async () => {
  const a = T + 5;
  const la = `nb${T}`;
  await person(a, { login: la }); // ring '{}': the cron never computed it
  await hosted(a, { slug: `nb${a}`, repo_key: `${la}/x`, status: 'live' });
  await mainIs(a, `${la}/x`);
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  // A star from someone who is not on EarnKit: no ring partner is possible.
  const starred = { owner: la, owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
    stargazers: [{ id: `gh:stranger${T}`, at: new Date(NOW.getTime() - 2 * DAY).toISOString(), created_at: '2020-01-01T00:00:00Z' }] };
  await reading(`${la}/x`, starred);
  const r = await rescorePerson(a, NOW);
  assert.equal(r.ranked, true, 'ranked at once, no cron run');
  const [l] = await sql()<{ ranked: boolean; ring: unknown }[]>`
    SELECT l.ranked, p.ring FROM builder_live l JOIN builder_profiles p USING (builder_id) WHERE l.builder_id = ${a}`;
  assert.deepEqual({ ...l }, { ranked: true, ring: {} });
});

test('4.26 an older rescore never overwrites a newer one (decided and written under one per-person lock)', dbTest, async () => {
  const id = T + 17;
  await person(id, { ring: true });
  await hosted(id, { slug: `ol${id}`, repo_key: `lee/ol${id}`, status: 'live' });
  await mainProven(id, `lee/ol${id}`);
  await rescorePerson(id, new Date(NOW.getTime() + DAY));
  await sql()`DELETE FROM hosted_sites WHERE slug = ${`ol${id}`}`;
  // A slow refresh that started before (an older `now`, a stale ring): it writes nothing.
  const r = await rescorePerson(id, NOW);
  assert.deepEqual(r, { score: 10, ranked: true, held: false });
  const [l] = await sql()<{ score: number; computed_at: Date }[]>`SELECT score, computed_at FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual([l.score, l.computed_at.getTime()], [10, NOW.getTime() + DAY]);
  assert.equal((await sql()`SELECT 1 FROM builder_projects WHERE builder_id = ${id}`).length, 1);
});

test('4.32 a mid-cron refresh with a never-computed ring over a 15-person cluster: the cron stores the ring that caps the people counted (not scored)', dbTest, async () => {
  const a = T + 1;
  // 14 other people: strict 0.5 each in the refresh (7) is above the cluster cap of 5.
  const cs = Array.from({ length: 14 }, (_, i) => T + 2 + i);
  const login = (id: number) => `cl${id}x${T}`;
  const all = [a, ...cs];
  for (const id of all) await person(id, { login: login(id) });
  await hosted(a, { slug: `cl${a}`, repo_key: `${login(a)}/app`, status: 'live' });
  await mainProven(a, `${login(a)}/app`);
  // Every ci stars every other's repo (a included): a mutual component of 5.
  for (const id of cs) {
    await source(id, { kind: 'repo', ref: `${login(id)}/r`, state: 'verified', proof: 'repo_owner', by: 'server' });
    await reading(`${login(id)}/r`, { owner: login(id), owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
      stargazers: all.filter((o) => o !== id).map((o) => ({ id: `gh:${login(o)}`, at: NOW.toISOString(), created_at: '2020-01-01T00:00:00Z' })) });
  }
  // Each ci owns 2 wallets that call a's contract.
  const callers: unknown[] = [];
  for (const [k, id] of cs.entries())
    for (let i = 0; i < 2; i++) {
      const w = `0x${hex40(7_000_000 + k * 10 + i + (process.pid % 900) * 1000)}`;
      await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${id}, ${w}) ON CONFLICT DO NOTHING`;
      callers.push({ id: `wallet:${w}`, at: new Date(NOW.getTime() - ((k * 2 + i) % 7) * DAY - 3_600_000).toISOString(), value_usd: 0, codes: [], first_tx_at: '2024-01-01T00:00:00Z' });
    }
  const addr = `0x${hex40(a + 3e9)}`;
  await source(a, { kind: 'contract', ref: `base:${addr}`, key: `${login(a)}/app`, state: 'verified', proof: 'deployer', by: 'server' });
  await reading(`base:${addr}`, { callers, partial: false });
  const row = async () => (await sql()<{ score: number; ranked: boolean; computed_at: Date }[]>`
    SELECT score, ranked, computed_at FROM builder_live WHERE builder_id = ${a}`)[0];
  const later = new Date(NOW.getTime() + 10 * 60_000);
  await rescorePerson(a, later); // the refresh: strict 0.5 per other-owned wallet, no cluster cap
  const inflated = (await useAt(a, later)).U;
  assert.ok(inflated > 6, `inflated U ${inflated}`);
  const before = await row();
  assert.equal(before.ranked, true, 'R4: ranked by its repo reading; people never move the score');
  await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [a] });
  const capped = (await useAt(a, later)).U;
  assert.ok(capped <= 5 + 1e-6, `capped U ${capped}`);
  const after = await row();
  assert.deepEqual([after.score, after.ranked], [before.score, true]);
  assert.equal(after.computed_at.getTime(), later.getTime());
  await sql()`DELETE FROM installation_wallets WHERE installation_id IN ${sql()(cs)}`;
});

test('4.30 a mid-cron refresh that already had a known ring stays ranked through the cron skip', dbTest, async () => {
  const id = T + 18;
  await person(id, { ring: true });
  await hosted(id, { slug: `rq${id}`, repo_key: `lee/rq${id}`, status: 'live' });
  await mainProven(id, `lee/rq${id}`);
  const later = new Date(NOW.getTime() + 20 * DAY + 10 * 60_000);
  assert.equal((await rescorePerson(id, later)).ranked, true);
  const r = await scorePeopleV2(new Date(NOW.getTime() + 20 * DAY), { deadline: Date.now() + 10_000, only: [id] });
  assert.equal(r.scored, 1);
  const [l] = await sql()<{ ranked: boolean; computed_at: Date }[]>`SELECT ranked, computed_at FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual([l.ranked, l.computed_at.getTime()], [true, later.getTime()]);
});
