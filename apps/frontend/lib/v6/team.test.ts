import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepo } from '../v5/github';
import { replayFetch } from '../v5/fixtures/github';
import { type Budget, forkRef, readCode, starterMaintainers } from './code';
import { readTeam } from './team';

const replay = (slug: string) => replayFetch(`../../../v6/fixtures/repos/${slug}`);
const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const budget = (): Budget => ({ remaining: null, stopped: false });

test('earnkit: the window authors, ages read, the window cap noted', async () => {
  const rec = replay('earnkit');
  const t = await readTeam(rec.repo, { gh: rec.fetch, now: NOW, budget: budget() });
  assert.ok(t.contributors_90d! >= 1);
  assert.ok(t.top_share! > 0 && t.top_share! <= 1);
  assert.ok(t.account_ages_days.length >= 1 && t.account_ages_days.length <= 5);
  assert.ok(t.logins.length >= 1 && t.logins.length <= 5);
  assert.equal(typeof t.prior_repos_used, 'number');
  assert.equal(t.note, 'commits window capped at 300');
});

test('onchain-reaction: no commits in 90 days, so no team in the window', async () => {
  const rec = replay('onchain-reaction');
  const t = await readTeam(rec.repo, { gh: rec.fetch, now: NOW, budget: budget() });
  assert.equal(t.contributors_90d, 0);
  assert.equal(t.top_share, null);
  assert.deepEqual(t.logins, []);
  assert.deepEqual(t.account_ages_days, []);
  assert.equal(t.note, null);
});

test('readCode and readTeam on one budget read the commit window once', async () => {
  const rec = replay('earnkit');
  const b = budget();
  const read = await readRepo(rec.repo, { fetch: rec.fetch, token: 'test' });
  await readCode(read, { gh: rec.fetch, now: NOW, budget: b });
  await readTeam(rec.repo, { gh: rec.fetch, now: NOW, budget: b });
  assert.equal(rec.calls.filter((u) => u.includes('/commits?since=')).length, 3);
});

// A synthetic repo: window commits by login (null = no linked GitHub author), account dates and repos by login.
type Person = { login: string | null; commits: number; created_days_ago?: number; repos?: object[] };
const fakeTeam = (people: Person[], over: (url: string) => Response | null = () => null) => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = over(url);
    if (hit) return hit;
    if (url.includes('/repos/a/b/commits?since=')) {
      return Response.json(
        people.flatMap((p) => [...Array(p.commits)].map(() => ({ author: p.login ? { login: p.login, type: 'User' } : null, commit: { author: { date: NOW.toISOString() } } }))),
      );
    }
    const repos = url.match(/\/users\/([^/]+)\/repos\?/)?.[1];
    if (repos) return Response.json(people.find((p) => p.login === repos)?.repos ?? []);
    const user = url.match(/\/users\/([^/?]+)$/)?.[1];
    const p = people.find((x) => x.login === user);
    if (p) return Response.json({ login: p.login, created_at: new Date(NOW.getTime() - (p.created_days_ago ?? 900) * DAY).toISOString() });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
};

test('an account created 10 days before now is not counted; unlinked commits count toward the share only', async () => {
  const { f, calls } = fakeTeam([
    { login: 'old', commits: 6, created_days_ago: 900 },
    { login: 'fresh', commits: 2, created_days_ago: 10 },
    { login: null, commits: 2 },
  ]);
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: budget() });
  assert.equal(t.contributors_90d, 1);
  assert.deepEqual(t.account_ages_days, [900, 10]);
  assert.equal(t.top_share, 0.6);
  assert.deepEqual(t.logins, ['old', 'fresh']);
  assert.ok(!calls.some((u) => u.includes('/contributors')));
});

test('only the top 5 window authors are read; the rest are noted', async () => {
  const { f, calls } = fakeTeam([...Array(7)].map((_, i) => ({ login: `p${i}`, commits: 10 - i })));
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: budget() });
  assert.deepEqual(t.logins, ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.equal(t.contributors_90d, 5);
  assert.equal(t.note, 'contributors beyond 5 not read');
  assert.ok(!calls.some((u) => u.endsWith('/users/p5')));
});

test('prior repos: 50+ stars or a homepage counts; forks and this repo do not', async () => {
  const { f } = fakeTeam([
    {
      login: 'old',
      commits: 1,
      repos: [
        { full_name: 'old/popular', fork: false, stargazers_count: 120, homepage: null },
        { full_name: 'old/site', fork: false, stargazers_count: 0, homepage: 'https://site.example' },
        { full_name: 'old/forked', fork: true, stargazers_count: 900, homepage: 'https://x.example' },
        { full_name: 'old/quiet', fork: false, stargazers_count: 3, homepage: '' },
        { full_name: 'A/B', fork: false, stargazers_count: 500, homepage: null },
      ],
    },
  ]);
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: budget() });
  assert.equal(t.prior_repos_used, 2);
});

test('a 403 with no rate left on /users/x: what was read stays, the rest is noted', async () => {
  const { f, calls } = fakeTeam(
    [
      { login: 'old', commits: 5 },
      { login: 'x', commits: 3 },
      { login: 'later', commits: 1 },
    ],
    (url) => (url.endsWith('/users/x') ? new Response('rate limited', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) : null),
  );
  const b = budget();
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: b });
  assert.equal(t.contributors_90d, 1);
  assert.equal(t.note, 'not read: budget');
  assert.equal(b.stopped, true);
  assert.deepEqual(t.account_ages_days, [900]);
  assert.ok(!calls.some((u) => u.includes('/users/later')));
});

test('commits unreadable: null rows with the reason', async () => {
  const { f } = fakeTeam([], (url) => (url.includes('/commits?since=') ? new Response('gone', { status: 404 }) : null));
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: budget() });
  assert.equal(t.contributors_90d, null);
  assert.equal(t.top_share, null);
  assert.equal(t.prior_repos_used, null);
  assert.equal(t.note, 'not read: private or missing');
  const stopped = await readTeam('a/b', { gh: f, now: NOW, budget: { remaining: 10, stopped: true } });
  assert.equal(stopped.note, 'not read: budget');
});

test('astral-logbook, a fork of scaffold-eth-2: the team is the commits after the fork point only', async () => {
  const rec = replay('astral-logbook');
  const read = await readRepo(rec.repo, { fetch: rec.fetch, token: 'test' });
  const fork = forkRef(read);
  assert.deepEqual(fork, { parent: 'scaffold-eth/scaffold-eth-2', parent_branch: 'main', branch: 'main' });
  const now = await readTeam(rec.repo, { gh: rec.fetch, now: NOW, budget: budget() }, { fork });
  assert.deepEqual(now.logins, []);
  assert.equal(now.contributors_90d, 0);
  assert.ok(!rec.calls.some((u) => u.includes('/commits?since=')));
  // As of 2025-10-01 its own authors are in the window; the starter's maintainers never are.
  const then = new Date('2025-10-01T12:00:00Z');
  const gh = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (/\/users\/[^/]+$/.test(url)) return Response.json({ created_at: '2020-01-01T00:00:00Z' });
    if (/\/users\/[^/]+\/repos\?/.test(url)) return Response.json([]);
    return rec.fetch(input, init);
  }) as typeof fetch;
  const t = await readTeam(rec.repo, { gh, now: then, budget: budget() }, { fork });
  assert.deepEqual(t.logins, ['SethDocherty', 'johnx25bd']);
  assert.equal(t.contributors_90d, 2);
  assert.equal(t.top_share, 49 / 50);
  const se2 = new Set(starterMaintainers('scaffold-eth-2'));
  assert.ok(!t.logins.some((l) => se2.has(l.toLowerCase())));
  assert.equal(t.note, null);
});

test("a clone of a starter: the starter's maintainers are dropped and noted, the share is of the rest", async () => {
  const [m1, m2] = starterMaintainers('scaffold-eth-2');
  const { f, calls } = fakeTeam([
    { login: m1, commits: 30 },
    { login: m2, commits: 10 },
    { login: 'builder', commits: 6 },
    { login: 'friend', commits: 2 },
  ]);
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: budget() }, { drop: starterMaintainers('scaffold-eth-2') });
  assert.deepEqual(t.logins, ['builder', 'friend']);
  assert.equal(t.contributors_90d, 2);
  assert.equal(t.top_share, 6 / 8);
  assert.equal(t.note, '2 starter maintainers not counted');
  assert.ok(!calls.some((u) => u.endsWith(`/users/${m1}`)));
  // Without the starter named, the same window is one team led by its maintainer.
  const all = await readTeam('a/b', { gh: f, now: NOW, budget: budget() });
  assert.equal(all.logins[0], m1);
});
