import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSON_GITHUB_QUERY, REPOS_MAX, personGithubFrom, readGithubRepos, readGithubUser, reposQuery } from './person-github';
import { graphqlUsable } from './source-readers';

const NOW = new Date('2026-10-14T00:00:00Z');
const repo = (o: Record<string, unknown>) => ({
  nameWithOwner: 'lee/tipjar', description: 'Tips for my podcast', homepageUrl: 'https://tip.example.com', isFork: false, isTemplate: false,
  createdAt: '2026-01-01T00:00:00Z', pushedAt: '2026-10-01T00:00:00Z', stargazerCount: 12, forkCount: 1, parent: null, templateRepository: null,
  stargazers: { edges: [{ starredAt: '2026-09-01T00:00:00Z', node: { login: 'Ann', createdAt: '2020-01-01T00:00:00Z' } }] },
  forks: { nodes: [{ createdAt: '2026-09-02T00:00:00Z', owner: { login: 'Bob', createdAt: '2019-01-01T00:00:00Z' } }] },
  defaultBranchRef: { target: { history: { nodes: [{ committedDate: '2026-10-01T10:00:00Z' }, { committedDate: '2026-09-30T10:00:00Z' }] } } },
  ...o,
});
const body = (repos: unknown[]) => ({ data: { user: { login: 'Lee', twitterUsername: 'lee_builds', websiteUrl: null, repositories: { nodes: repos } } } });

test('3.1 one query reads every public repo of a person into v2.12 repo signals', () => {
  const g = personGithubFrom(body([repo({})]), NOW)!;
  assert.equal(g.login, 'lee');
  assert.equal(g.twitter, 'lee_builds');
  const r = g.repos.get('lee/tipjar')!;
  assert.equal(r.homepage, 'https://tip.example.com');
  assert.deepEqual(r.stargazers, [{ id: 'gh:ann', at: '2026-09-01T00:00:00Z', created_at: '2020-01-01T00:00:00Z' }]);
  assert.deepEqual(r.forkers.map((f) => f.id), ['gh:bob']);
  assert.deepEqual(r.commit_weeks, ['2026-W40']);
  assert.equal(r.derived, false);
});

test('3.2 forks, templates and repos made from a template are marked derived', () => {
  const g = personGithubFrom(body([repo({ nameWithOwner: 'lee/a', isFork: true }), repo({ nameWithOwner: 'lee/b', templateRepository: { nameWithOwner: 'x/y' } })]), NOW)!;
  assert.equal(g.repos.get('lee/a')!.derived, true);
  assert.equal(g.repos.get('lee/b')!.derived, true);
});

test('3.3 an unknown user or a malformed answer reads as null, never throws', async () => {
  assert.equal(personGithubFrom({ data: { user: null } }, NOW), null);
  assert.equal(personGithubFrom('nonsense', NOW), null);
});

test('3.9 the person query reads the newest 100 repos; others by name, names as variables, up to 25 a call', async () => {
  assert.match(PERSON_GITHUB_QUERY, /repositories\(first: 100,/);
  const q = reposQuery(2);
  assert.match(q, /r0: repository\(owner: \$o0, name: \$n0\)/);
  assert.match(q, /r1: repository\(owner: \$o1, name: \$n1\)/);
  let vars: Record<string, unknown> = {};
  const d = {
    ghGraphql: async (_q: string, v: Record<string, unknown>) => {
      vars = v;
      return { data: { r0: repo({ nameWithOwner: 'Acme/Tool', owner: { __typename: 'Organization', login: 'Acme' } }), r1: null } };
    },
    now: NOW,
  } as never;
  const got = await readGithubRepos(['Acme/Tool', 'lee/gone'], d);
  assert.deepEqual([vars.o0, vars.n0, vars.o1, vars.n1], ['acme', 'tool', 'lee', 'gone']);
  assert.equal(got.get('acme/tool')!.owner_type, 'Organization');
  assert.equal(got.has('lee/gone'), false, 'GitHub does not know it');
  await assert.rejects(readGithubRepos(Array.from({ length: REPOS_MAX + 1 }, (_, i) => `lee/r${i}`), d), /too many repo names/);
  // A malformed name (an owner GitHub refuses, an injection attempt) is never sent; the valid one still is.
  const bad = await readGithubRepos(['a--b/x', 'lee/x") { id } evil: repository(owner: "y', 'Acme/Tool'], d);
  assert.deepEqual(Object.keys(vars).filter((k) => k !== 'since').sort(), ['n0', 'o0']);
  assert.deepEqual([...bad.keys()], ['acme/tool']);
});

test('3.10 a GraphQL answer is read only when every error is NOT_FOUND', () => {
  assert.equal(graphqlUsable({ data: { user: null }, errors: [{ type: 'NOT_FOUND' }] }), true);
  assert.equal(graphqlUsable({ data: { r0: {} } }), true);
  assert.equal(graphqlUsable({ data: { user: {} }, errors: [{ type: 'RATE_LIMITED' }] }), false);
  assert.equal(graphqlUsable({ errors: [{ type: 'NOT_FOUND' }] }), false);
});

test('3.7 commits are counted per ISO week from the dates already read', () => {
  const r = personGithubFrom(body([repo({
    defaultBranchRef: { target: { history: { nodes: [
      { committedDate: '2026-10-13T10:00:00Z' }, { committedDate: '2026-10-12T00:00:01Z' }, { committedDate: '2026-10-11T23:59:59Z' },
      { committedDate: '2026-10-01T10:00:00Z' }, { committedDate: '2099-01-01T00:00:00Z' }, { committedDate: 'junk' },
    ] } } },
  })]), NOW)!.repos.get('lee/tipjar')!;
  assert.deepEqual(r.commit_counts, { '2026-W40': 1, '2026-W41': 1, '2026-W42': 2 }, 'a future or unreadable date counts nowhere');
  assert.deepEqual(r.commit_weeks, ['2026-W40', '2026-W41', '2026-W42']);
});

test('3.8 the light user read asks for the login, X field and website only', async () => {
  let asked = '';
  const d = { now: NOW, ghGraphql: async (q: string) => { asked = q; return { data: { user: { login: 'Lee', twitterUsername: 'lee_builds', websiteUrl: null } } }; } } as never;
  const u = await readGithubUser('lee', d);
  assert.equal(u?.twitter, 'lee_builds');
  assert.equal(u?.repos.size, 0);
  assert.doesNotMatch(asked, /repositories|history|stargazers/);
  await assert.rejects(readGithubUser('not a login', d));
});
