import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForkCheckError, GitHubError, repoCodeFacts } from './match-projects';

/** Stubs global fetch with GitHub answers by path (query kept); records every path asked. */
async function withGitHub<T>(answers: Record<string, () => Response>, run: (calls: string[]) => Promise<T>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const path = u.pathname + u.search;
    calls.push(path);
    const answer = answers[path];
    return answer ? answer() : new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const repo = (extra: Record<string, unknown> = {}) =>
  json({ full_name: 'bob/kit', default_branch: 'main', fork: false, private: false, visibility: 'public', ...extra });
const COMMITS = '/repos/bob/kit/commits?per_page=1';
const COMPARE = '/repos/acme/kit/compare/dev...bob:main?per_page=1';
const fork = repo({ fork: true, parent: { full_name: 'acme/kit', default_branch: 'dev' } });

test('repoCodeFacts: a public non-fork is two reads, no compare', async () => {
  await withGitHub({ '/repos/bob/kit': repo(), [COMMITS]: json([{ sha: 'a' }]) }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: false, hasCommits: true, aheadOfParent: null });
    assert.deepEqual(calls.sort(), ['/repos/bob/kit', COMMITS].sort());
  });
});

test('repoCodeFacts: a fork with commits is compared with its parent (per_page=1)', async () => {
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: json([{ sha: 'a' }]), [COMPARE]: json({ ahead_by: 3 }) }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: true, hasCommits: true, aheadOfParent: 3 });
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1), COMPARE);
  });
});

test('repoCodeFacts: an empty repo (409) is no commits, and an empty fork is never compared', async () => {
  const empty = json({ message: 'Git Repository is empty.' }, 409);
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: empty }, async (calls) => {
    assert.deepEqual(await repoCodeFacts('bob/kit'), { fork: true, hasCommits: false, aheadOfParent: null });
    assert.equal(calls.length, 2);
  });
});

test('repoCodeFacts: a private repo the token can see is refused as "not found (or private)"', async () => {
  for (const extra of [{ private: true, visibility: 'private' }, { private: false, visibility: 'internal' }])
    await withGitHub({ '/repos/bob/kit': repo(extra), [COMMITS]: json([{ sha: 'a' }]) }, async () => {
      await assert.rejects(repoCodeFacts('bob/kit'), (err: unknown) =>
        err instanceof GitHubError && !(err instanceof ForkCheckError) && /not found \(or private\)/.test(err.message));
    });
  // A missing repo is the same "not found".
  await withGitHub({}, async () => {
    await assert.rejects(repoCodeFacts('bob/kit'), /not found \(or private\)/);
  });
});

test('repoCodeFacts: a failed compare is a ForkCheckError, never "not found (or private)" alone', async () => {
  await withGitHub({ '/repos/bob/kit': fork, [COMMITS]: json([{ sha: 'a' }]) }, async () => {
    await assert.rejects(repoCodeFacts('bob/kit'), (err: unknown) => err instanceof ForkCheckError && err.status === 404);
  });
});
