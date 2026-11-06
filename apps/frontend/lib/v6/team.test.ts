import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayFetch } from '../v5/fixtures/github';
import type { Budget } from './code';
import { readTeam } from './team';

const replay = (slug: string, patch?: (url: string, body: string) => string) => replayFetch(`../../../v6/fixtures/repos/${slug}`, patch);
const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const budget = (): Budget => ({ remaining: null, stopped: false });

test('onchain-reaction: one real contributor, ages read, at most 5', async () => {
  const rec = replay('onchain-reaction');
  const t = await readTeam(rec.repo, { gh: rec.fetch, now: NOW, budget: budget() });
  assert.ok(t.contributors_90d! >= 1);
  assert.ok(t.top_share! > 0 && t.top_share! <= 1);
  assert.ok(t.account_ages_days.length >= 1 && t.account_ages_days.length <= 5);
  assert.ok(t.logins.length <= 5);
  assert.equal(typeof t.prior_repos_used, 'number');
  assert.equal(t.note, null);
});

test('astral-logbook: top 5 read, the rest noted', async () => {
  const rec = replay('astral-logbook');
  const t = await readTeam(rec.repo, { gh: rec.fetch, now: NOW, budget: budget() });
  assert.equal(t.logins.length, 5);
  assert.equal(t.account_ages_days.length, 5);
  assert.equal(t.note, 'contributors beyond 5 not read');
});

// A synthetic team: contributors, account dates and repos by login.
const fakeTeam = (people: { login: string; contributions: number; created_days_ago: number; repos?: object[] }[], over: (url: string) => Response | null = () => null) => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = over(url);
    if (hit) return hit;
    if (url.endsWith('/repos/a/b/contributors?per_page=10')) return Response.json(people.map(({ login, contributions }) => ({ login, contributions, type: 'User' })));
    const repos = url.match(/\/users\/([^/]+)\/repos\?/)?.[1];
    if (repos) return Response.json(people.find((p) => p.login === repos)?.repos ?? []);
    const user = url.match(/\/users\/([^/?]+)$/)?.[1];
    const p = people.find((x) => x.login === user);
    if (p) return Response.json({ login: p.login, created_at: new Date(NOW.getTime() - p.created_days_ago * DAY).toISOString() });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
};

test('an account created 10 days before now is not counted', async () => {
  const { f } = fakeTeam([
    { login: 'old', contributions: 30, created_days_ago: 900 },
    { login: 'fresh', contributions: 10, created_days_ago: 10 },
  ]);
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: budget() });
  assert.equal(t.contributors_90d, 1);
  assert.deepEqual(t.account_ages_days, [900, 10]);
  assert.equal(t.top_share, 0.75);
  assert.deepEqual(t.logins, ['old', 'fresh']);
});

test('prior repos: 50+ stars or a homepage counts; forks and this repo do not', async () => {
  const { f } = fakeTeam([
    {
      login: 'old',
      contributions: 1,
      created_days_ago: 900,
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
      { login: 'old', contributions: 5, created_days_ago: 900 },
      { login: 'x', contributions: 3, created_days_ago: 900 },
      { login: 'later', contributions: 1, created_days_ago: 900 },
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

test('contributors unreadable: null rows with the reason', async () => {
  const { f } = fakeTeam([], (url) => (url.includes('/contributors') ? new Response('gone', { status: 404 }) : null));
  const t = await readTeam('a/b', { gh: f, now: NOW, budget: budget() });
  assert.equal(t.contributors_90d, null);
  assert.equal(t.prior_repos_used, null);
  assert.equal(t.note, 'not read: private or missing');
  const stopped = await readTeam('a/b', { gh: f, now: NOW, budget: { remaining: 10, stopped: true } });
  assert.equal(stopped.note, 'not read: budget');
});
