import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { heldForReview, partLines, publicRow, scoresAdminKey, scoresPost } from './builder-score';
import { isConfirmedProof } from './confirmed';
import { sql } from './db';
import { rescorePerson, refreshPerson, scorePeopleV2, standingOf, trackedKeys } from './person-score';
import type { ReaderDeps } from './source-readers';

process.env.EARNKIT_BUILDER_SCORE = 'on';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const T = 2_100_950_000 + (process.pid % 900) * 20;
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
  return { gh: no, ghGraphql: no, tokenTransfers: no, probe: no, fetchText: no, json: no, baseTxs: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, now: NOW };
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
    VALUES (${id}, ${l.score}, '{"shipped":{"points":10,"raw":{}}}'::jsonb, ${l.ranked}, ${l.ranked ? 1 : 0}, 0, 'v2', 'v2-launch', ${new Date(NOW.getTime() - DAY)})`;
}
/** Yesterday's public history row (formula v2): the 30-point jump is measured against it. */
async function history(id: number, score: number, day = new Date(NOW.getTime() - DAY)) {
  await sql()`
    INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${day.toISOString().slice(0, 10)}, ${score}, 0, '{}', '{}', 'v2', 'v2-launch', false)
    ON CONFLICT (builder_id, day) DO NOTHING`;
}
/** 600 callers across 30 days on an EarnKit-deployed contract; `rich`: long-lived wallets sending $100 each (60+ from one source). */
async function fakeBigUse(id: number, o: { rich?: boolean; seed?: number } = {}) {
  const addr = `0x${hex40(id + 1e9 * (o.seed ?? 0))}`;
  const key = `lee/big${id}`;
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

test('4.2 an EarnKit-hosted live app is a confirmed ship: ranked, Shipped 10', dbTest, async () => {
  const id = T + 1;
  await person(id, { ring: true });
  await hosted(id, { slug: `tip${id}`, repo_key: `lee/tip${id}`, status: 'live' });
  const r = await rescorePerson(id, NOW);
  assert.equal(r.ranked, true);
  const [l] = await sql()<{ parts: { shipped: { points: number } } }[]>`SELECT parts FROM builder_live WHERE builder_id = ${id}`;
  assert.equal(l.parts.shipped.points, 10);
});

test('4.3 rank counts every ranked person with a higher score; ties share a number', dbTest, async () => {
  await live(T + 2, { score: 50, ranked: true });
  await live(T + 3, { score: 30, ranked: true });
  await live(T + 4, { score: 30, ranked: true });
  await live(T + 5, { score: 90, ranked: false });
  const s = await standingOf(T + 3, { only: [T + 2, T + 3, T + 4, T + 5] });
  assert.deepEqual([s.rank, s.total, s.ranked], [2, 3, true]);
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

test('4.7 coin buys count toward Used and the creator fees toward Earned (an EarnKit coin is a ship)', dbTest, async () => {
  const id = T + 8;
  await person(id, { ring: true });
  const coin = `0x${hex40(id + 7)}`;
  const creator = `0x${hex40(id + 8)}`;
  const key = `lee/coin${id}`;
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
  const [l] = await sql()<{ parts: { used: { raw: { U: number } }; earned: { raw: { E: number } }; shipped: { raw: { S: number } } } }[]>`
    SELECT parts FROM builder_live WHERE builder_id = ${id}`;
  assert.ok(l.parts.used.raw.U > 0, 'coin buys are people using it');
  assert.equal(l.parts.earned.raw.E, 120);
  assert.equal(l.parts.shipped.raw.S, 1, 'the coin and its source are one project');
  const [p] = await sql()`SELECT kind, has_coin, confirmed, people, money_usd::float AS money FROM builder_projects WHERE builder_id = ${id}`;
  assert.deepEqual({ ...p }, { kind: 'coin', has_coin: true, confirmed: true, people: 12, money: 120 });
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

test('4.9 flag off: a refresh reads and writes nothing', dbTest, async () => {
  const id = T + 10;
  await person(id, {});
  delete process.env.EARNKIT_BUILDER_SCORE;
  try {
    let reads = 0;
    const reader = { ...fakeReader(), probe: async () => (reads++, { status: 200 }) };
    assert.deepEqual(await refreshPerson(id, { now: NOW, deadline: Date.now() + 3000, reader }), { refreshed: false });
    assert.equal(reads, 0);
    assert.equal((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${id}`).length, 0);
  } finally {
    process.env.EARNKIT_BUILDER_SCORE = 'on';
  }
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
  assert.equal(lines.length, 4);
  assert.ok(lines.some((l) => /^shipped: [\d.]+ \(S 1, keep [\d.]+\)$/.test(l)), lines.join(' | '));
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

test('4.15 a first score of 60+ from one contract is held: public 0 and unranked, the score waits in pending', dbTest, async () => {
  const id = T + 16;
  await person(id, {});
  await fakeBigUse(id, { rich: true });
  const r = await rescorePerson(id, NOW);
  assert.deepEqual([r.held, r.score, r.ranked], [true, 0, false]);
  const [row] = await sql()<{ score: number; ranked: boolean; pending: { score: number } | null }[]>`SELECT score, ranked, pending FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual([row.score, row.ranked], [0, false]);
  assert.ok(row.pending!.score >= 60, String(row.pending?.score));
  const [p] = await sql()<{ held: boolean }[]>`SELECT held FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.held, true);
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
  const starFork = async () => (await sql()<{ v: number }[]>`SELECT (parts->'used'->'raw'->>'star_fork')::float AS v FROM builder_live WHERE builder_id = ${a}`)[0].v;
  const faded = (days: number) => 0.5 ** (days / 90); // the star is 2 days old at NOW
  // No stored ring yet: the refresh looks up only the owners of the accounts that touched a's work
  // (never everyone's edges): b is another EarnKit person, so b's star weighs 0.5.
  await refreshPerson(a, { now: NOW, deadline: Date.now() + 3000, reader: fakeReader() });
  assert.ok(Math.abs((await starFork()) - 0.5 * faded(2)) < 1e-6, String(await starFork()));
  // The cron step computes and stores the ring: b and a star each other, so b's star weighs 0.5.
  await scorePeopleV2(new Date(NOW.getTime() + 4 * DAY), { deadline: Date.now() + 10_000, only: [a] });
  const [p] = await sql()<{ ring: { ring?: [string, number][] } }[]>`SELECT ring FROM builder_profiles WHERE builder_id = ${a}`;
  assert.deepEqual(p.ring.ring, [[`gh:${lb}`, 0.5]]);
  await refreshPerson(a, { now: new Date(NOW.getTime() + 4 * DAY + 11 * 60_000), deadline: Date.now() + 3000, reader: fakeReader() });
  assert.ok(Math.abs((await starFork()) - 0.5 * faded(6 + 11 / 1440)) < 1e-6, String(await starFork()));
});

test('4.19 a never-computed ring fails strict: another person\'s account counts 0.5, and no rank until the cron computes the ring', dbTest, async () => {
  const [a, c] = [T + 3, T + 4];
  const [la, lc] = [`na${T}`, `nc${T}`];
  await person(c, { login: lc, ring: true });
  await person(a, { login: la });
  await hosted(a, { slug: `nr${a}`, repo_key: `${la}/x`, status: 'live' });
  await source(a, { kind: 'repo', ref: `${la}/x`, state: 'verified', proof: 'repo_owner', by: 'server' });
  const starred = { owner: la, owner_type: 'User', fork: false, template: false, forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false,
    stargazers: [{ id: `gh:${lc}`, at: new Date(NOW.getTime() - 2 * DAY).toISOString(), created_at: '2020-01-01T00:00:00Z' }] };
  await reading(`${la}/x`, starred);
  const r = await rescorePerson(a, NOW);
  assert.equal(r.ranked, false, 'no rank before the ring is computed');
  const [l] = await sql()<{ ranked: boolean; v: number }[]>`SELECT ranked, (parts->'used'->'raw'->>'star_fork')::float AS v FROM builder_live WHERE builder_id = ${a}`;
  assert.equal(l.ranked, false);
  assert.ok(Math.abs(l.v - 0.5 * 0.5 ** (2 / 90)) < 1e-6, String(l.v));
  // A redaction-cleared ring ('{}') is never-computed too; a malformed one as well.
  await sql()`UPDATE builder_profiles SET ring = '{"ring": "junk"}'::jsonb WHERE builder_id = ${a}`;
  assert.equal((await rescorePerson(a, NOW)).ranked, false);
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
  const [l] = await sql()<{ v: number }[]>`SELECT (parts->'used'->'raw'->>'star_fork')::float AS v FROM builder_live WHERE builder_id = ${a}`;
  assert.ok(Math.abs(l.v - 1.5) < 1e-6, String(l.v));
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
  const starFork = async () => (await sql()<{ v: number }[]>`SELECT (parts->'used'->'raw'->>'star_fork')::float AS v FROM builder_live WHERE builder_id = ${a}`)[0].v;
  await refreshPerson(a, { now: NOW, deadline: Date.now() + 3000, reader: fakeReader() });
  assert.ok(Math.abs((await starFork()) - 0.5) < 1e-6, String(await starFork()));
  await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [a] });
  assert.ok(Math.abs((await starFork()) - 1) < 1e-6, String(await starFork()));
  // The next refresh reads the stored check: still in full.
  await refreshPerson(a, { now: new Date(NOW.getTime() + 11 * 60_000), deadline: Date.now() + 3000, reader: fakeReader() });
  assert.ok(Math.abs((await starFork()) - 0.5 ** ((11 / 1440) / 90)) < 1e-6, String(await starFork()));
  // A check older than 36 hours is not honoured: strict again until the next cron run.
  await refreshPerson(a, { now: new Date(NOW.getTime() + 37 * 3_600_000), deadline: Date.now() + 3000, reader: fakeReader() });
  assert.ok(Math.abs((await starFork()) - 0.5 * 0.5 ** ((37 / 24) / 90)) < 1e-6, String(await starFork()));
});

test('4.24 a release publishes only the reviewed pending score: a cron-held day the owner never saw stays private and is never the baseline', dbTest, async () => {
  const id = T + 13;
  const D = new Date(NOW.getTime() + 9 * DAY);
  const d = D.toISOString().slice(0, 10);
  await person(id, { ring: true });
  await history(id, 10, new Date(D.getTime() - DAY));
  await live(id, { score: 10, ranked: true });
  await fakeBigUse(id);
  await scorePeopleV2(D, { deadline: Date.now() + 10_000, only: [id] }); // the cron holds about 53 on D
  const [cronHeld] = await sql()<{ score: number; held: boolean }[]>`SELECT score, held FROM builder_scores WHERE builder_id = ${id} AND day = ${d}`;
  assert.equal(cronHeld.held, true);
  // A later rescore that day holds 30 instead; the owner reviews and releases 30.
  await sql()`UPDATE builder_live SET pending = jsonb_set(jsonb_set(pending, '{score}', '30'), '{at}', '"v-30"') WHERE builder_id = ${id}`;
  assert.equal((await release(id, { day: d, version: 'v-30' })).status, 303);
  assert.equal((await sql()<{ score: number }[]>`SELECT score FROM builder_live WHERE builder_id = ${id}`)[0].score, 30);
  const pub = await sql()`SELECT 1 FROM builder_scores s WHERE s.builder_id = ${id} AND s.day = ${d} AND ${publicRow()}`;
  assert.equal(pub.length, 0, `the cron-held ${cronHeld.score} was never reviewed: not public`);
  // The next day's rescore (about 53) is measured from the released 30, not from 10 (held) or the unseen day.
  const r = await rescorePerson(id, new Date(D.getTime() + DAY));
  assert.equal(r.held, false, 'a 23-point rise from the released 30');
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
  const starFork = async () => (await sql()<{ v: number }[]>`SELECT (parts->'used'->'raw'->>'star_fork')::float AS v FROM builder_live WHERE builder_id = ${a}`)[0].v;
  await scorePeopleV2(NOW, { deadline: Date.now() + 10_000, only: [a] });
  assert.ok(Math.abs((await starFork()) - 1) < 1e-6, 'checked by the cron: in full');
  // The login now belongs to another person.
  await sql()`UPDATE builder_profiles SET github_login = NULL WHERE builder_id = ${c}`;
  await sql()`UPDATE builder_profiles SET github_login = ${lc} WHERE builder_id = ${e}`;
  await refreshPerson(a, { now: new Date(NOW.getTime() + 11 * 60_000), deadline: Date.now() + 3000, reader: fakeReader() });
  assert.ok(Math.abs((await starFork()) - 0.5 * 0.5 ** ((11 / 1440) / 90)) < 1e-6, String(await starFork()));
});

test('4.26 an older rescore never overwrites a newer one (decided and written under one per-person lock)', dbTest, async () => {
  const id = T + 17;
  await person(id, { ring: true });
  await hosted(id, { slug: `ol${id}`, repo_key: `lee/ol${id}`, status: 'live' });
  await rescorePerson(id, new Date(NOW.getTime() + DAY));
  await sql()`DELETE FROM hosted_sites WHERE slug = ${`ol${id}`}`;
  // A slow refresh that started before (an older `now`, a stale ring): it writes nothing.
  const r = await rescorePerson(id, NOW);
  assert.deepEqual(r, { score: 10, ranked: true, held: false });
  const [l] = await sql()<{ score: number; computed_at: Date }[]>`SELECT score, computed_at FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual([l.score, l.computed_at.getTime()], [10, NOW.getTime() + DAY]);
  assert.equal((await sql()`SELECT 1 FROM builder_projects WHERE builder_id = ${id}`).length, 1);
});
