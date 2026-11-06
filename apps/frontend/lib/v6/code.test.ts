import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepo } from '../v5/github';
import { replayFetch } from '../v5/fixtures/github';
import { activeWeeks, type Boilerplate, type Budget, hasCi, hasTests, noteBudget, readCode, since90, templateOverlap } from './code';
import BOILERPLATES from './boilerplates.json';

// The v6 recordings sit beside this file; the v5 replay reads them by a relative slug.
const replay = (slug: string) => replayFetch(`../../../v6/fixtures/repos/${slug}`);
const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const budget = (): Budget => ({ remaining: null, stopped: false });
const code = async (slug: string) => {
  const rec = replay(slug);
  const read = await readRepo(rec.repo, { fetch: rec.fetch, token: 'test' });
  return { read, rows: await readCode(read, { gh: rec.fetch, now: NOW, budget: budget() }), rec };
};
const starters = BOILERPLATES as Boilerplate[];

test('the recordings were made on the pinned date', () => {
  for (const s of ['earnkit', 'onchain-reaction', 'nextjs-dashboard', 'astral-logbook']) assert.equal(replay(s).recorded_at, '2026-11-06');
  assert.equal(since90(NOW), '2026-08-08T00:00:00Z');
  assert.equal(since90(new Date('2026-11-06T23:59:59Z')), '2026-08-08T00:00:00Z');
});

test('fork with own work is not flagged', async () => {
  const { read, rows } = await code('astral-logbook');
  const se2 = starters.find((b) => b.name === 'scaffold-eth-2')!;
  const m = templateOverlap(read.tree.filter((t) => t.type === 'blob').map((t) => t.path), [se2]);
  assert.ok(m && m.overlap > 0.6, `overlap ${m?.overlap}`);
  assert.equal(rows.fork_of, 'scaffold-eth/scaffold-eth-2');
  assert.ok(rows.own_share! > 0.2, `own_share ${rows.own_share}`);
  // The starter it forked is measured by own_share, not again as a template match.
  assert.notEqual(rows.template_name, 'scaffold-eth-2');
  assert.equal(rows.note, null);
});

test('earnkit: tests, CI, no fork, little starter overlap', async () => {
  const { rows } = await code('earnkit');
  assert.equal(rows.has_tests, true);
  assert.equal(rows.has_ci, true);
  assert.equal(rows.fork_of, null);
  assert.ok(rows.template_overlap !== null && rows.template_overlap < 0.2, `overlap ${rows.template_overlap}`);
  assert.equal(rows.commits_90d, 300);
  assert.equal(rows.note, 'commits_90d capped at 300');
  assert.ok(rows.active_weeks_90d! >= 1);
  assert.match(rows.first_commit_at ?? '', /^\d{4}-\d\d-\d\dT/);
  assert.match(rows.last_push_at ?? '', /^\d{4}-\d\d-\d\dT/);
  for (const k of ['releases', 'issues_open', 'issues_answered_90d'] as const) assert.equal(typeof rows[k], 'number');
});

test('nextjs-dashboard: the course starter, little of its own', async () => {
  const { rows } = await code('nextjs-dashboard');
  assert.equal(rows.template_name, 'next-learn-dashboard');
  assert.ok(rows.template_overlap! > 0.6, `overlap ${rows.template_overlap}`);
  assert.ok(rows.own_share! < 0.2, `own_share ${rows.own_share}`);
  assert.equal(rows.fork_of, null);
  assert.equal(rows.note, null);
});

test('templateOverlap: best starter with 20+ paths, build folders ignored', () => {
  const big: Boilerplate = { name: 'big', repo: 'a/big', recorded_at: '2026-11-06', paths: [...Array(20)].map((_, i) => `src/f${i}.ts`) };
  const small: Boilerplate = { name: 'small', repo: 'a/small', recorded_at: '2026-11-06', paths: ['package.json', 'README.md'] };
  assert.equal(templateOverlap(['package.json', 'README.md'], [small]), null);
  const m = templateOverlap([...big.paths.slice(0, 15), 'package.json', 'node_modules/x/src/f19.ts'], [big, small]);
  assert.deepEqual(m, { name: 'big', overlap: 0.75 });
  // Every recorded starter excludes node_modules.
  for (const b of starters) assert.ok(!b.paths.some((p) => p.includes('node_modules/')), b.name);
});

test('hasTests and hasCi', () => {
  assert.equal(hasTests(['src/a.test.ts']), true);
  assert.equal(hasTests(['test/Counter.t.sol']), true);
  assert.equal(hasTests(['node_modules/x/test/a.js', 'src/index.ts']), false);
  assert.equal(hasCi(['.github/workflows/ci.yml']), true);
  assert.equal(hasCi(['.gitlab-ci.yml']), true);
  assert.equal(hasCi(['vercel.json', '.github/dependabot.yml']), false);
});

test('activeWeeks: 10 dates in 3 distinct weeks is 3; older than 90 days not counted', () => {
  const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
  const dates = [0.1, 1, 2, 3, 8, 9, 10, 11, 20, 20.5].map(at);
  assert.equal(activeWeeks(dates, NOW), 3);
  assert.equal(activeWeeks([at(91), at(200)], NOW), 0);
});

// A synthetic repo answering commit pages of a set size; every other list empty.
const fakeRepo = (pages: number[], extra: (url: string) => Response | null = () => null) => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = extra(url);
    if (hit) return hit;
    if (url.includes('/commits?since=')) {
      const page = Number(url.match(/&page=(\d+)/)?.[1] ?? 1);
      const n = pages[page - 1] ?? 0;
      return Response.json([...Array(n)].map((_, i) => ({ commit: { author: { date: new Date(NOW.getTime() - (i % 30) * DAY).toISOString() } } })));
    }
    return Response.json([]);
  }) as typeof fetch;
  const read = {
    repo: { full_name: 'a/b', html_url: '', homepage: null, default_branch: 'main', created_at: '2025-01-01T00:00:00Z', pushed_at: '2026-11-01T00:00:00Z' },
    tree: [{ path: 'src/index.ts', type: 'blob' }],
    readme: null,
    files: [],
    first_commit_at: '2025-01-01T00:00:00Z',
    partial: false,
  };
  return { f, calls, read };
};

test('commits_90d counted across pages; a full third page caps at 300', async () => {
  const two = fakeRepo([100, 100, 37]);
  const r = await readCode(two.read, { gh: two.f, now: NOW, budget: budget() });
  assert.equal(r.commits_90d, 237);
  assert.equal(r.note, null);
  assert.equal(two.calls.filter((u) => u.includes('/commits?since=2026-08-08T00:00:00Z&per_page=100')).length, 3);
  const full = fakeRepo([100, 100, 100, 100]);
  const c = await readCode(full.read, { gh: full.f, now: NOW, budget: budget() });
  assert.equal(c.commits_90d, 300);
  assert.equal(c.note, 'commits_90d capped at 300');
  assert.equal(full.calls.filter((u) => u.includes('/commits?since=')).length, 3);
});

test('issues answered: commented or closed, pull requests left out', async () => {
  const r = fakeRepo([1], (url) =>
    url.includes('/issues?state=all')
      ? Response.json([{ state: 'open', comments: 2 }, { state: 'closed', comments: 0 }, { state: 'open', comments: 0 }, { state: 'closed', comments: 3, pull_request: {} }])
      : url.includes('/issues?state=open')
        ? new Response('[{}]', { headers: { link: '<https://api.github.com/repositories/1/issues?state=open&per_page=1&page=7>; rel="last"' } })
        : null,
  );
  const rows = await readCode(r.read, { gh: r.f, now: NOW, budget: budget() });
  assert.equal(rows.issues_answered_90d, 2);
  assert.equal(rows.issues_open, 7);
});

test('budget: under 500 left, later reads are skipped and noted; what was read stays', async () => {
  const b = budget();
  noteBudget(b, new Response('', { headers: { 'x-ratelimit-remaining': '4999' } }));
  assert.deepEqual(b, { remaining: 4999, stopped: false });
  const r = fakeRepo([5], (url) => (url.includes('/commits?since=') ? Response.json([{ commit: { author: { date: NOW.toISOString() } } }], { headers: { 'x-ratelimit-remaining': '499' } }) : null));
  const rows = await readCode(r.read, { gh: r.f, now: NOW, budget: b });
  assert.equal(rows.commits_90d, 1);
  assert.equal(rows.releases, null);
  assert.equal(rows.issues_open, null);
  assert.equal(rows.note, 'not read: budget');
  assert.equal(b.stopped, true);
  assert.equal(r.calls.length, 1);
});

test('a failed read is a null row with a note, never a throw', async () => {
  const r = fakeRepo([0], (url) => (url.includes('/releases') ? new Response('nope', { status: 403 }) : url.includes('/issues') ? new Response('gone', { status: 404 }) : null));
  const rows = await readCode(r.read, { gh: r.f, now: NOW, budget: budget() });
  assert.equal(rows.releases, null);
  assert.equal(rows.issues_open, null);
  assert.equal(rows.commits_90d, 0);
  assert.equal(rows.note, 'not read: github 403; not read: private or missing');
  const down = await readCode(r.read, { gh: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch, now: NOW, budget: budget() });
  assert.equal(down.commits_90d, null);
  assert.equal(down.note, 'not read: github unreachable');
});

test('a fork whose parent is gone: own_share null with a note', async () => {
  const r = fakeRepo([0], (url) => (url.includes('/compare/') ? new Response('gone', { status: 404 }) : null));
  const read = { ...r.read, repo: { ...r.read.repo, fork: true, parent: { full_name: 'x/starter', default_branch: 'main' } } };
  const rows = await readCode(read, { gh: r.f, now: NOW, budget: budget() });
  assert.equal(rows.fork_of, 'x/starter');
  assert.equal(rows.own_share, null);
  assert.equal(rows.note, 'own_share not read: parent gone');
});
