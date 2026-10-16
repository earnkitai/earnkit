import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools } from './tools';
import { scoreReply } from './score-tool';
import { EVENT_LOG_FLAG } from './events';
import type { ReaderDeps } from './source-readers';
import { discover, discoverPerson, proofLineCheck } from './discovery';
import { GitHubError } from './match-projects';
import { ScoreDeadline } from './campaigns';

/**
 * v2.12.2: a fresh install whose agent reports only `identity.github_login` (an octocat-like
 * account with public owned repos, none with a live site) used to get "I couldn't find anything
 * you've made yet." Now its own repos are shown, not yet confirmed. Mirrors production with the flag on, GITHUB_TOKEN set (a fake reader answers GitHub), no
 * X keys, no R2. Every GitHub call the server makes is recorded.
 */

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date();

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const was: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
// Production: flag on, no X keys, no R2.
const prod = <T>(fn: () => Promise<T>) =>
  withEnv({ EARNKIT_BUILDER_SCORE: 'on', [EVENT_LOG_FLAG]: 'on', X_CLIENT_ID: undefined, X_CLIENT_SECRET: undefined, R2_BUCKET: undefined }, fn);

async function install(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2122-gh-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  return id;
}

/** octocat-like public repos: owned, not forks, two with descriptions, none with a homepage; only Spoon-Knife is web code. */
const repos = (login: string, web = true) => [
  { name: 'Hello-World', description: 'My first repository on GitHub!', language: null },
  { name: 'Spoon-Knife', description: 'This repo is for demonstration purposes only.', language: web ? 'HTML' : 'Shell' },
  { name: 'linguist', description: null, language: 'Ruby' },
].map((r, i) => ({ ...r, full_name: `${login}/${r.name}`, login, pushed: new Date(NOW.getTime() - (i + 1) * 86_400_000).toISOString() }));

/** A fake GitHub (REST + GraphQL) that answers for `login` and records each call. */
function fakeGithub(login: string, web = true) {
  const calls: string[] = [];
  const rs = repos(login, web);
  const reader = new Proxy({} as ReaderDeps, {
    get: (_t, k) => {
      if (k === 'now') return NOW;
      if (k === 'gh')
        return async (path: string) => {
          calls.push(`gh ${path}`);
          if (path.startsWith(`/users/${login}/repos`))
            return rs.map((r) => ({ full_name: r.full_name, fork: false, is_template: false, homepage: null, has_pages: false, pushed_at: r.pushed, created_at: r.pushed, owner: { login, type: 'User' } }));
          if (path === `/users/${login}`) return { login, blog: null, twitter_username: null };
          if (path.startsWith(`/users/${login}/orgs`)) return [];
          return {};
        };
      if (k === 'ghGraphql')
        return async (_q: string, v: Record<string, unknown>) => {
          // The light owned-repos listing (OWNED_REPOS_QUERY, `first`) is recorded apart from the full person query.
          calls.push(`${'first' in v ? 'owned' : 'graphql'} ${JSON.stringify(v.login ?? Object.keys(v).filter((x) => x.startsWith('n')).map((x) => v[x]))}`);
          const node = (r: ReturnType<typeof repos>[number]) => ({
            nameWithOwner: r.full_name, description: r.description, homepageUrl: null, primaryLanguage: r.language ? { name: r.language } : null, isFork: false, isTemplate: false, isPrivate: false,
            createdAt: r.pushed, pushedAt: r.pushed, stargazerCount: 0, forkCount: 0, owner: { __typename: 'User', login },
            parent: null, templateRepository: null, stargazers: { edges: [] }, forks: { nodes: [] },
            defaultBranchRef: { target: { history: { nodes: [{ committedDate: r.pushed }] } } },
          });
          if (typeof v.login === 'string') return { data: { user: { login, twitterUsername: null, websiteUrl: null, repositories: { nodes: rs.map(node) } } } };
          const data: Record<string, unknown> = {};
          for (const key of Object.keys(v).filter((x) => /^n\d+$/.test(x))) {
            const r = rs.find((x) => x.name.toLowerCase() === String(v[key]).toLowerCase());
            data[`r${key.slice(1)}`] = r ? node(r) : null;
          }
          return { data };
        };
      if (k === 'probe') return async () => ({ status: 404 });
      if (k === 'ghSpent') return () => false;
      if (typeof k !== 'string' || k === 'then') return undefined;
      return async () => {
        throw new Error('offline');
      };
    },
  });
  return { reader, calls };
}

type Found = { show_to_builder: string; note?: string };
const find = (id: number, input: Record<string, unknown>, extra: Record<string, unknown>) =>
  tools.find(input, { installationId: id, ...extra } as never) as Promise<Found>;

// Other files running in parallel open and close programs on the shared DB, so a second find may
// start with their "Since you last checked: new: ..." line; what is tested here comes after it.
const FIXED_STAND = /^(Since you last checked: [^\n]*\n\n)?Where you stand\nYou've made 3 projects on GitHub: Hello-World, Spoon-Knife and linguist\. None is live yet\./;
const GO_LIVE = /How to move up\nWant me to put Spoon-Knife online\? It takes a few minutes and you won't have to do anything\.$/;

test('fixed: identity.github_login only (unproven) -> one read lists their own repos, shown on GitHub, not confirmed (find, find, score)', dbTest, () =>
  prod(async () => {
    const id = await install();
    const login = `octo${randomBytes(3).toString('hex')}`;
    const gh = fakeGithub(login);
    let matchedUser: unknown = 'not called';
    const extra = { readerDeps: gh.reader, matchProjects: async (i: { github_user?: string }) => ((matchedUser = i.github_user), { checked: 0, scored: 0, fits: [] }) };

    const one = await find(id, { identity: { github_login: login } }, extra);
    const two = await find(id, { identity: { github_login: login } }, extra);
    const three = await scoreReply({ installationId: id, sharedClient: false } as never, new Date(), { reader: gh.reader });
    for (const r of [one, two, three]) {
      assert.match(r.show_to_builder, FIXED_STAND, r.show_to_builder);
      assert.doesNotMatch(r.show_to_builder, /couldn't find anything/);
    }
    assert.match(one.show_to_builder, GO_LIVE, one.show_to_builder);

    // The login stays only reported (never proven: no X claim, no sign-in, no proof line).
    const [p] = await sql()<{ github_login: string | null; reported_github: string | null }[]>`SELECT github_login, reported_github FROM builder_profiles WHERE builder_id = ${id}`;
    assert.deepEqual(p, { github_login: null, reported_github: login });
    const [q] = await sql()<{ done_at: Date | null }[]>`SELECT done_at FROM discovery_queue WHERE builder_id = ${id}`;
    assert.ok(q?.done_at, 'discovery ran in the refresh');
    // Discovery listed the reported login's repos with one light listing (about 1 s; the full person
    // query can take the refresh's whole 8 s on an account with popular repos), no REST repo listing.
    assert.equal(gh.calls.filter((c) => c === `owned "${login}"`).length, 1, `GitHub calls: ${gh.calls.join(', ')}`);
    assert.equal(gh.calls.filter((c) => c.startsWith(`gh /users/${login}/repos`)).length, 0, gh.calls.join(', '));
    const s = await sql()<{ state: string; proposed_by: string }[]>`SELECT state, proposed_by FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo'`;
    assert.equal(s.length, 3);
    assert.ok(s.every((x) => x.state === 'proposed' && x.proposed_by === 'server'), 'proposed only, never verified');
    const [{ confirmed, n }] = await sql()<{ confirmed: number; n: number }[]>`SELECT count(*)::int AS n, count(*) FILTER (WHERE confirmed)::int AS confirmed FROM builder_projects WHERE builder_id = ${id}`;
    assert.equal(n, 3);
    assert.equal(confirmed, 0, 'never scored');
    // find's v2.11 matching sees the reported login, so a program can be tied to one of their repos.
    assert.equal(matchedUser, login);
  }),
);

test('fixed: repos the agent named (identity.projects) read as "on GitHub", and the one yes puts one online', dbTest, () =>
  prod(async () => {
    const id = await install();
    const login = `octo${randomBytes(3).toString('hex')}`;
    const gh = fakeGithub(login);
    const r = await find(
      id,
      { identity: { github_login: login, projects: repos(login).map((x) => ({ name: x.name, repo: x.full_name })) } },
      { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) },
    );
    assert.ok(gh.calls.some((c) => c.startsWith('graphql')), `one person query: ${gh.calls.join(', ')}`);
    assert.match(r.show_to_builder, FIXED_STAND, r.show_to_builder);
    assert.match(r.show_to_builder, GO_LIVE, r.show_to_builder);
  }),
);

test('a reported login another profile proved is skipped: nothing of theirs is listed here', dbTest, () =>
  prod(async () => {
    const login = `octo${randomBytes(3).toString('hex')}`;
    const owner = await install();
    await sql()`INSERT INTO builder_profiles (builder_id, slug, github_login) VALUES (${owner}, ${`own${randomBytes(4).toString('hex')}`}, ${login})`;
    const id = await install();
    const gh = fakeGithub(login);
    const r = await find(id, { identity: { github_login: login } }, { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) });
    assert.match(r.show_to_builder, /I couldn't find anything you've made yet\./, r.show_to_builder);
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_sources WHERE builder_id = ${id}`;
    assert.equal(n, 0);
  }),
);

test('proving the reported login later verifies the same proposed rows', dbTest, () =>
  prod(async () => {
    const id = await install();
    const login = `octo${randomBytes(3).toString('hex')}`;
    const gh = fakeGithub(login);
    await find(id, { identity: { github_login: login } }, { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) });
    const before = await sql()<{ id: number }[]>`SELECT id::int AS id FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' ORDER BY id`;
    assert.equal(before.length, 3);
    await sql()`INSERT INTO github_verifications (installation_id, login, repo_key, account_created_at, public_repos) VALUES (${id}, ${login}, ${`${login}/hello-world`}, now() - interval '3 years', 3)`;
    await discoverPerson(id, { deadline: Date.now() + 8000, reader: gh.reader });
    const after = await sql()<{ id: number; state: string }[]>`SELECT id::int AS id, state FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' ORDER BY id`;
    assert.deepEqual(after.map((x) => x.id), before.map((x) => x.id), 'the same rows');
    assert.ok(after.every((x) => x.state === 'verified'), JSON.stringify(after));
  }),
);

test('the on-demand refresh skips the proof-line check when time is short, never throwing (cron still stops)', async () => {
  const reader = { ghFetch: async () => new Response('{}'), ghSpent: () => false } as unknown as ReaderDeps;
  assert.equal(await proofLineCheck(reader, Date.now() + 1_000, { skipShort: true })(1, 'a/b'), null);
  await assert.rejects(proofLineCheck(reader, Date.now() + 1_000)(1, 'a/b'), ScoreDeadline);
});

test('(c) the 10-minute window: the second find within 10 min does not refresh again', dbTest, () =>
  prod(async () => {
    const id = await install();
    const login = `octo${randomBytes(3).toString('hex')}`;
    const gh = fakeGithub(login);
    const extra = { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) };
    await find(id, { identity: { github_login: login } }, extra);
    const [a] = await sql()<{ read_at: Date }[]>`SELECT read_at FROM builder_live WHERE builder_id = ${id}`;
    await find(id, { identity: { github_login: login } }, extra);
    const [b] = await sql()<{ read_at: Date }[]>`SELECT read_at FROM builder_live WHERE builder_id = ${id}`;
    assert.equal(b.read_at.getTime(), a.read_at.getTime(), 'claimed once');
  }),
);

test('review 3: no sign any repo is a website: no go_live offer, the link ask', dbTest, () =>
  prod(async () => {
    const id = await install();
    const login = `octo${randomBytes(3).toString('hex')}`;
    const gh = fakeGithub(login, false);
    const r = await find(id, { identity: { github_login: login } }, { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) });
    assert.match(r.show_to_builder, FIXED_STAND, r.show_to_builder);
    assert.match(r.show_to_builder, /How to move up\nSend me a link to something you've made and I'll add it\.$/, r.show_to_builder);
  }),
);

test('review 1: a proof-line check the short refresh skipped stays queued; the cron runs it and proves the login', dbTest, () =>
  prod(async () => {
    const id = await install();
    const login = `octo${randomBytes(3).toString('hex')}`;
    const gh = fakeGithub(login);
    // An agent-reported repo (where the proof line lives), then find: its 8 s refresh skips the 15 s check.
    await find(id, { identity: { github_login: login, projects: [{ name: 'Hello-World', repo: `${login}/Hello-World` }] } },
      { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) });
    const [q] = await sql()<{ done_at: Date | null; reason: string }[]>`SELECT done_at, reason FROM discovery_queue WHERE builder_id = ${id}`;
    assert.deepEqual({ ...q }, { done_at: null, reason: 'proof_line' }, 'left open for the cron');
    // The next refresh does not rerun discovery for it (the cron has the time).
    const before = gh.calls.length;
    await find(id, { identity: { github_login: login } }, { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) });
    assert.equal(gh.calls.slice(before).filter((c) => c === `graphql "${login}"` || c === `owned "${login}"`).length, 0, gh.calls.slice(before).join(', '));
    // The cron's discover runs the check and proves the login.
    const checked: string[] = [];
    await discover(new Date(), { deadline: Date.now() + 60_000, reader: gh.reader, only: [id],
      proofLine: async (_m, ref) => (checked.push(ref), ref === `${login}/hello-world` ? { login, basis: 'proof_line' } : null) });
    assert.equal(checked[0], `${login}/hello-world`);
    const [p] = await sql()<{ github_login: string | null }[]>`SELECT lower(github_login) AS github_login FROM builder_profiles WHERE builder_id = ${id}`;
    assert.equal(p.github_login, login);
    const [d] = await sql()<{ done_at: Date | null }[]>`SELECT done_at FROM discovery_queue WHERE builder_id = ${id}`;
    assert.ok(d.done_at);
  }),
);

test('review 2: the proof-line check and the remote check read agent-reported repos before the 25 server-proposed ones', dbTest, () =>
  prod(async () => {
    const id = await install();
    const login = `octo${randomBytes(3).toString('hex')}`;
    const gh = fakeGithub(login);
    await find(id, { identity: { github_login: login } }, { readerDeps: gh.reader, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) });
    // Six server rows first (oldest ids), then the agent's repo.
    for (let i = 0; i < 6; i++)
      await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'repo', ${`${login}/old${i}`}, ${`${login}/old${i}`}, 'server')`;
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'repo', ${`${login}/agentrepo`}, ${`${login}/agentrepo`}, 'agent')`;
    await sql()`UPDATE discovery_queue SET done_at = NULL WHERE builder_id = ${id}`;
    const checked: string[] = [];
    await discover(new Date(), { deadline: Date.now() + 60_000, reader: gh.reader, only: [id], proofLine: async (_m, ref) => (checked.push(ref), null) });
    assert.equal(checked[0], `${login}/agentrepo`, checked.join(', '));
  }),
);

test('review 4: matching that rides only on the reported login is quiet: no repos or a failed read reads as none given', dbTest, () =>
  prod(async () => {
    const offline = new Proxy({} as ReaderDeps, { get: (_t, k) => (k === 'now' ? NOW : k === 'then' ? undefined : async () => { throw new Error('offline'); }) });
    // "Ways to earn right now" (and any "new:" line) follow the shared DB's open programs, which other
    // files running in parallel add and close: leave them out, so the three runs compare only what
    // the login could change.
    const norm = (t: string) =>
      t
        .replace(/earnkit\.com\/claim\/\S+/g, 'CLAIM')
        .replace(/^Since you last checked: [^\n]*\n\n/, '')
        .replace(/\n\nWays to earn right now\n[\s\S]*?(?=\n\n|$)/, '');
    const login = `octo${randomBytes(3).toString('hex')}`;
    const run = async (input: Record<string, unknown>, matchProjects: () => Promise<unknown>) => {
      const r = await find(await install(), { agent_can_build: true, ...input }, { readerDeps: offline, matchProjects });
      return { text: norm(r.show_to_builder), note: r.note };
    };
    const none = await run({}, async () => assert.fail('not called'));
    const empty = await run({ identity: { github_login: login } }, async () => ({ checked: 0, scored: 0, fits: [] }));
    const failed = await run({ identity: { github_login: login } }, async () => {
      throw new GitHubError('GitHub said no (403)', 403);
    });
    // Same reply and the same agent note (never "EarnKit remembers their GitHub username": it doesn't).
    assert.deepEqual(empty, none);
    assert.deepEqual(failed, none);
    assert.doesNotMatch(failed.text, /Couldn't read your repos/);
  }),
);

