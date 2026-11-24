import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { main, METHOD_VERSION, reportLines, RoundFile, type Scored, scoreRound, verdictOf } from './backtest';
import { deleteBuilder, upsertBuilder } from './builders';
import { type Budget, readCode } from './code';
import type { Explorer, Tx } from './explorers';
import { evidence } from './fixtures/evidence-builder';
import { fakeRdap, fakeSite } from './fixtures/site';
import { readContract } from './onchain';
import { place, TIERS } from './tiers';

after(() => sql().end());
beforeEach(async () => {
  await sql()`DELETE FROM backtest_scores`;
  await sql()`DELETE FROM backtest_entries`;
  await sql()`DELETE FROM backtest_rounds`;
  await sql()`DELETE FROM evidence_cache`;
});

const DAY = 86_400_000;
const UNTIL = new Date('2026-06-30T23:59:59Z');
const at = (days: number) => new Date(UNTIL.getTime() + days * DAY).toISOString();
const budget = (): Budget => ({ remaining: null, stopped: false });

// A repo whose GitHub answers ignore the until parameter: every commit, 30 before the cutoff and 50 after, and a push
// date long after it. The cutoff has to hold on EarnKit's side.
const leakyRepo = () => {
  const calls: string[] = [];
  const commits = [...[...Array(30)].map((_, i) => at(-1 - i)), ...[...Array(50)].map((_, i) => at(1 + i))];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/commits?since=')) return Response.json(commits.map((d) => ({ author: { login: 'dev', type: 'User' }, commit: { author: { date: d } } })));
    return url.includes('/search/issues') ? Response.json({ total_count: 0, items: [] }) : Response.json([]);
  }) as typeof fetch;
  const read = {
    repo: { full_name: 'a/b', html_url: '', homepage: null, default_branch: 'main', created_at: '2025-01-01T00:00:00Z', pushed_at: at(50) },
    tree: [{ path: 'src/index.ts', type: 'blob' }],
    readme: null,
    files: [],
    first_commit_at: '2025-01-01T00:00:00Z',
    partial: false,
  };
  return { f, calls, read };
};

// A contract whose explorer answers ignore the cutoff: 4 transactions before it from 2 senders, 40 after from 40 more.
const leakyExplorer = (): Explorer => {
  const tx = (from: string, when: string): Tx => ({ hash: '0x1', from, to: '0xc', at: when, value_wei: '0', is_error: false });
  return {
    contractInfo: async () => ({ is_contract: true, verified_source: true, name: 'C', deployer: '0xd', deployed_at: null, created_tx: null }),
    txsTo: async () => [...[...Array(40)].map((_, i) => tx(`0xa${i}`, at(1 + i))), tx('0x1', at(-1)), tx('0x1', at(-2)), tx('0x2', at(-3)), tx('0x2', at(-4))],
    firstTxs: async () => [],
  };
};

test('cutoff: no commit or push after until reaches the code rows, and GitHub is asked only up to it', async () => {
  const r = leakyRepo();
  const rows = await readCode(r.read, { gh: r.f, now: UNTIL, budget: budget(), until: UNTIL });
  assert.equal(rows.commits_90d, 30);
  assert.equal(rows.commits_60d, 30);
  assert.equal(rows.last_push_at, at(-1));
  assert.ok(r.calls.some((u) => u.includes(`&until=${UNTIL.toISOString()}`)));
  // Without a cutoff the same answers count everything: the cut is the only thing holding them out.
  const open = leakyRepo();
  const all = await readCode(open.read, { gh: open.f, now: UNTIL, budget: budget() });
  assert.equal(all.last_push_at, at(50));
  assert.ok(!open.calls.some((u) => u.includes('&until=')));
});

test('cutoff: no transaction or sender after until reaches the onchain rows', async () => {
  const r = await readContract('base', '0xc', { explorer: leakyExplorer(), repoAddresses: [], now: UNTIL, until: UNTIL });
  assert.equal(r.tx_90d, 4);
  assert.equal(r.senders_90d, 2);
  assert.equal(r.funded_sample, 2);
  const all = await readContract('base', '0xc', { explorer: leakyExplorer(), repoAddresses: [], now: UNTIL });
  assert.equal(all.tx_90d, 44);
});

test('cutoff: a scored round reads through the cutoff, never the cache, and names what it could not cut', async () => {
  const round = RoundFile.parse({
    program_id: 'demo', round: '2026-q2', until: UNTIL.toISOString(),
    entries: [{ ref: '1', name: 'Alpha', live_url: 'https://earnkit.com/', contracts: [{ chain: 'base', address: `0x${'c'.repeat(40)}` }], won: true }],
  });
  const [s] = await scoreRound(round, { explorer: () => leakyExplorer(), probe: fakeSite().probe, rdap: fakeRdap().rdap });
  assert.equal(s.evidence?.onchain[0].tx_90d, 4);
  assert.equal(s.evidence?.read_at, UNTIL.toISOString());
  assert.deepEqual(s.leaked, ['site', 'contract source']);
  assert.equal((await sql()`SELECT 1 FROM evidence_cache`).length, 0);
});

test('verdict: a pick that won and a non-pick that did not are hits; the rest misses; nothing read is no pick', () => {
  assert.equal(verdictOf('used', true), 'hit');
  assert.equal(verdictOf('building', false), 'miss');
  assert.equal(verdictOf('unverified', true), 'miss');
  assert.equal(verdictOf('flagged', false), 'hit');
  assert.equal(verdictOf(null, true), 'miss');
});

const scoredAs = (ref: string, name: string, e: ReturnType<typeof evidence> | null, won: boolean, builder_id?: number, x = { identical_pitch: 0, shared_contributors: 0 }): Scored => {
  const placement = place(e, x, undefined, UNTIL);
  return { entry: { ref, name, won, ...(builder_id && { builder_id }) }, evidence: e, placement, verdict: verdictOf(placement.tier, won), leaked: [] };
};

test('no negative label: a non-user gets hit or miss only, never a tier, flag or reason; a user gets their tier', () => {
  const round = RoundFile.parse({ program_id: 'demo', round: 'r1', until: UNTIL.toISOString(), entries: [{ ref: 'x', name: 'x', won: false }] });
  const flagged = scoredAs('1', 'Flagged Person', evidence(), false, undefined, { identical_pitch: 5, shared_contributors: 0 });
  const unverified = scoredAs('2', 'Quiet Person', evidence(), true);
  const user = scoredAs('3', 'Our Builder', evidence(), false, 7);
  assert.equal(flagged.placement.tier, 'flagged');
  assert.equal(unverified.placement.tier, 'unverified');
  const lines = reportLines(round, [flagged, unverified, user]);
  const of = (name: string) => lines.filter((l) => l.includes(name));
  for (const name of ['Flagged Person', 'Quiet Person']) {
    const [line] = of(name);
    assert.match(line, /: (hit|miss)(, won)?$/);
    for (const t of TIERS) assert.ok(!line.includes(t), `${line} names ${t}`);
  }
  const text = lines.join('\n');
  for (const s of [flagged, unverified]) {
    for (const b of s.placement.because) assert.ok(!text.includes(b), `the report carries "${b}"`);
    for (const f of s.placement.flags) assert.ok(!text.includes(f.rule) && !text.includes(f.detail));
  }
  assert.match(of('Our Builder')[0], /: hit, unverified$/);
  // No order of merit for anyone.
  assert.ok(!/\brank|\b#\d|top \d/i.test(text));
});

test('--apply stores the round under METHOD_VERSION; a rerun keeps every score; another cutoff is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backtest-'));
  const file = join(dir, 'round.json');
  const body = { program_id: 'demo', round: 'r1', until: UNTIL.toISOString(), entries: [{ ref: '1', name: 'Alpha', live_url: 'https://earnkit.com/', won: true }, { ref: '2', name: 'Beta', won: false }] };
  writeFileSync(file, JSON.stringify(body));
  const deps = { evidence: { probe: fakeSite().probe, rdap: fakeRdap().rdap }, now: new Date('2026-11-24T00:00:00Z') };
  const out: string[] = [];
  const dry = await main(['--file', file], (l) => out.push(l), deps);
  assert.equal(dry.stored, null);
  assert.equal((await sql()`SELECT 1 FROM backtest_rounds`).length, 0);
  assert.equal((await main(['--file', file, '--apply'], () => {}, deps)).stored?.written, 2);
  const rows = await sql()<{ method_version: string; verdict: string; leaked: string[] }[]>`SELECT method_version, verdict, leaked FROM backtest_scores ORDER BY id`;
  assert.deepEqual(rows.map((r) => r.method_version), [METHOD_VERSION, METHOD_VERSION]);
  assert.deepEqual(rows[0].leaked, ['site']);
  assert.deepEqual((await main(['--file', file, '--apply'], () => {}, deps)).stored, { written: 0, kept: 2 });
  writeFileSync(file, JSON.stringify({ ...body, until: '2026-07-31T00:00:00Z' }));
  await assert.rejects(main(['--file', file, '--apply'], () => {}, deps), /stored with cutoff/);
  assert.equal((await sql()`SELECT 1 FROM backtest_scores`).length, 2);
});

test('deleteBuilder removes their stored entry and its score; the other entries of the round stay', async () => {
  const b = await upsertBuilder({ github_id: 970_000 + Math.floor(Math.random() * 10_000), login: 'backtest-user', name: null, avatar_url: null }, new Date());
  const dir = mkdtempSync(join(tmpdir(), 'backtest-'));
  const file = join(dir, 'round.json');
  writeFileSync(file, JSON.stringify({ program_id: 'demo', round: 'r2', until: UNTIL.toISOString(), entries: [{ ref: '1', name: 'Ours', won: false, builder_id: b.id }, { ref: '2', name: 'Other', won: true }] }));
  const deps = { evidence: { probe: fakeSite().probe, rdap: fakeRdap().rdap }, now: new Date('2026-11-24T00:00:00Z') };
  assert.equal((await main(['--file', file, '--apply'], () => {}, deps)).stored?.written, 2);
  await deleteBuilder(b.id);
  assert.deepEqual((await sql()<{ name: string }[]>`SELECT name FROM backtest_entries`).map((r) => r.name), ['Other']);
  assert.equal((await sql()`SELECT 1 FROM backtest_scores`).length, 1);
});

test('a round file with a cutoff without a zone, or repeated refs, is refused', () => {
  const entries = [{ ref: '1', name: 'A', won: true }];
  assert.throws(() => RoundFile.parse({ program_id: 'p', round: 'r', until: '2026-06-30', entries }));
  assert.throws(() => RoundFile.parse({ program_id: 'p', round: 'r', until: UNTIL.toISOString(), entries: [...entries, ...entries] }));
});
