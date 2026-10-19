import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { OWNED_REPOS_QUERY, PERSON_GITHUB_QUERY, reposQuery } from './person-github';
import { readSources } from './sources';
import { defaultReaderDeps, graphqlErrors, readError } from './source-readers';

/**
 * Prod hotfix 2026-10-19: every repo reading failed with error 'Error'. The by-name query asked for
 * `stargazers` (and `forks`), which GitHub refuses to EarnKit's fine-grained token and to the App's installation
 * token: a 200 with data and a FORBIDDEN error at r0.stargazers, which graphqlUsable rightly refuses. This is the
 * answer GitHub gave the old query for earnkitai/earnkit, with either token.
 */
const FORBIDDEN_BODY = {
  data: { r0: { nameWithOwner: 'earnkitai/earnkit', stargazers: null } },
  errors: [
    {
      type: 'FORBIDDEN',
      path: ['r0', 'stargazers'],
      extensions: { saml_failure: false, ip_allow_list_failure: false },
      locations: [{ line: 6, column: 9 }],
      message: 'Resource not accessible by personal access token',
    },
  ],
};
const REFUSED_FIELDS = /\bstargazers\b|\bforks\s*\(|\bwatchers\b/;

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const ID = 2_100_009_000 + (process.pid % 1000);
const REF = `earnkitai-${process.pid}/earnkit`;
const NOW = new Date();
const origFetch = globalThis.fetch;
const origToken = process.env.GITHUB_TOKEN;
after(async () => {
  globalThis.fetch = origFetch;
  if (origToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = origToken;
  if (process.env.DATABASE_URL) await sql().end();
});
beforeEach(async () => {
  globalThis.fetch = origFetch;
  if (process.env.DATABASE_URL) await sql()`DELETE FROM builder_sources WHERE builder_id = ${ID}`;
});

/**
 * GitHub as EarnKit's fine-grained token sees it: a GraphQL query naming a field the token may not read gets the
 * FORBIDDEN answer above; otherwise the repo (an organization's, one commit this week). The activity call lists one push.
 */
function fakeGitHub(o: { alwaysForbidden?: boolean } = {}): { graphql: string[] } {
  const seen = { graphql: [] as string[] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === 'https://api.github.com/graphql') {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      seen.graphql.push(query);
      if (o.alwaysForbidden || REFUSED_FIELDS.test(query)) return json(FORBIDDEN_BODY);
      return json({
        data: {
          r0: {
            nameWithOwner: REF, description: null, homepageUrl: null, primaryLanguage: { name: 'TypeScript' }, isFork: false, isTemplate: false,
            isPrivate: false, createdAt: '2024-12-26T14:44:39Z', pushedAt: NOW.toISOString(), owner: { __typename: 'Organization', login: REF.split('/')[0] },
            parent: null, templateRepository: null,
            defaultBranchRef: { target: { history: { nodes: [{ committedDate: new Date(NOW.getTime() - 3_600_000).toISOString() }] } } },
          },
        },
      });
    }
    if (url.startsWith(`https://api.github.com/repos/${REF}/activity`))
      return json([{ timestamp: new Date(NOW.getTime() - 3_000_000).toISOString(), activity_type: 'push' }]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return seen;
}

const addRepo = async () => {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
    VALUES (${ID}, 'repo', ${REF}, ${REF}, 'proof_branch', 'verified', 'server') RETURNING id`;
  return Number(row.id);
};
const readingOf = async (id: number) => {
  const [r] = await sql()<{ ok: boolean; error: string | null; signals: Record<string, unknown> }[]>`
    SELECT ok, error, signals FROM source_readings WHERE source_id = ${id}`;
  return r;
};

test('hotfix: no repo query asks GitHub for a field its tokens may not read (stargazers, forks, watchers)', () => {
  for (const q of [reposQuery(1), reposQuery(25), PERSON_GITHUB_QUERY, OWNED_REPOS_QUERY]) assert.doesNotMatch(q, REFUSED_FIELDS);
});

test("hotfix: a refused GraphQL answer says what GitHub said (type, path, message), never just 'Error'", () => {
  assert.equal(
    graphqlErrors(FORBIDDEN_BODY),
    'GitHub GraphQL answered errors: FORBIDDEN at r0.stargazers (Resource not accessible by personal access token)',
  );
  assert.equal(graphqlErrors({ message: 'Bad credentials' }), 'GitHub GraphQL answered no data');
  assert.equal(readError(new Error('GitHub GraphQL returned 502')), 'Error: GitHub GraphQL returned 502');
  assert.equal(readError(new TypeError('fetch failed')), 'TypeError: fetch failed');
  assert.equal(readError('x'), 'error');
  assert.ok(readError(new Error('y'.repeat(500))).length <= 200);
});

test('hotfix: the daily read of a verified org repo, through the real GraphQL reader, writes a good reading', dbTest, async () => {
  process.env.GITHUB_TOKEN = 'github_pat_fake';
  const id = await addRepo();
  const seen = fakeGitHub();
  const out = await readSources(NOW, { deadline: Date.now() + 10_000, reader: defaultReaderDeps(NOW, Date.now() + 10_000), only: [ID] });
  assert.deepEqual(out, { read: 1, failed: 0 });
  assert.equal(seen.graphql.length, 1);
  const r = await readingOf(id);
  assert.equal(r.ok, true, `reading failed: ${r.error}`);
  assert.equal(r.error, null);
  assert.equal(r.signals.owner_type, 'Organization');
  assert.equal((r.signals.commit_weeks as string[]).length, 1);
  assert.equal(r.signals.pushes_checked, true);
});

test("hotfix: a read GitHub refuses is a failed reading whose error names GitHub's answer", dbTest, async () => {
  process.env.GITHUB_TOKEN = 'github_pat_fake';
  const id = await addRepo();
  fakeGitHub({ alwaysForbidden: true });
  const logged: unknown[][] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const out = await readSources(NOW, { deadline: Date.now() + 10_000, reader: defaultReaderDeps(NOW, Date.now() + 10_000), only: [ID] });
    assert.deepEqual(out, { read: 0, failed: 1 });
  } finally {
    console.error = origError;
  }
  const r = await readingOf(id);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Error: GitHub GraphQL answered errors: FORBIDDEN at r0.stargazers (Resource not accessible by personal access token)');
  const line = logged.find((a) => a[0] === '[read] failed');
  assert.ok(line, 'the failed read is logged');
  assert.match(String(line[2]), /FORBIDDEN at r0\.stargazers/);
  assert.doesNotMatch(JSON.stringify(logged), /github_pat_fake/, 'the token is never logged');
});
