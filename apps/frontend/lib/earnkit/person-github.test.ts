import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSON_GITHUB_QUERY, personGithubFrom, readPersonGithub } from './person-github';

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
  let calls = 0;
  const d = { ghGraphql: async (q: string, v: Record<string, unknown>) => { calls++; assert.equal(q, PERSON_GITHUB_QUERY); assert.equal(v.login, 'lee'); return body([repo({})]); }, now: NOW } as never;
  assert.ok(await readPersonGithub('lee', d));
  assert.equal(calls, 1);
  await assert.rejects(readPersonGithub('bad login!', d), /not a GitHub login/);
});
