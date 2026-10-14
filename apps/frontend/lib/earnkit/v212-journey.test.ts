import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { tools } from './tools';
import { saveInstallation, touchInstallation } from './installations';
import { runCron } from './cron';
import { EVENT_LOG_FLAG } from './events';
import { profileData } from './profile-data';
import { SEND_LINK_LINE } from './where-you-stand';
import { enqueueDiscovery } from './discovery';
import type { ReaderDeps } from './source-readers';
import ProfileView from '../../app/b/[slug]/ProfileView';

/**
 * v2.12 Task 15 (spec 11, "End to end"): a fresh install ends with a filled public profile and a
 * next action, through the real flag-on code paths: find with local_git (the profile, the consent
 * line, the agent's remote proposed), the hourly cron's builder-score steps (discover, read, score,
 * ranks, the empty check), /b/<slug>'s data and view, and the score tool.
 *
 * Real: the tools, the cron, discovery, the readers' parsing, the anti-farming rules, the formula
 * and the v1-launch calibration, percentiles, the event log, every program file, and a throwaway
 * database of its own (schema.sql, dropped after).
 *
 * Faked, the outside world only: GitHub (fakeWorld's gh), the site probe, Blockscout and Arc (never
 * reached: no contract here), and who the GitHub login is (the v2.11 proof line the agent pushed,
 * read from GitHub's push record, stands in as `login`). Every other fetch gets a 503 and is noted;
 * 15.6 asserts nothing tried the network.
 *
 * Clock: real time (the database's now() writes first_find_at). NOW is taken when the file loads.
 */

const localDb = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
})();
const db = {
  skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres',
};

const PROGRAMS_DIR = join(import.meta.dirname, '../../../../programs');
const SCHEMA = join(import.meta.dirname, '../../db/schema.sql');
const METRIC = join(import.meta.dirname, '../../scripts/v212-metric.mts');
const ROOT = join(import.meta.dirname, '../../../..');
const FAR = '2099-01-01T00:00:00Z';
const DAY = 86_400_000;
const NOW = new Date();
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v212_journey_${process.pid}`;
let journeyUrl = '';
/** 15.2's installation (the person lee). */
let journeyId = 0;

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

const savedEnv: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  EARNKIT_BUILDER_SCORE: 'on',
  [EVENT_LOG_FLAG]: 'on',
  EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v212-journey-secret',
  // No real GitHub: every read goes through fakeWorld().
  GITHUB_TOKEN: undefined,
};

/** No network: every outside host gets a 503 and is noted (the database is on this machine). */
const blocked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
  blocked.push(url);
  return new Response('v212-journey: no network', { status: 503 });
}) as typeof fetch;

before(async () => {
  if (!sharedUrl || !localDb) return;
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
    await admin.unsafe(`CREATE DATABASE ${journeyDb}`);
  } finally {
    await admin.end();
  }
  const url = new URL(sharedUrl);
  url.pathname = `/${journeyDb}`;
  journeyUrl = url.toString();
  const fresh = postgres(journeyUrl, { max: 1, onnotice: () => {} });
  try {
    await fresh.unsafe(readFileSync(SCHEMA, 'utf8'));
  } finally {
    await fresh.end();
  }
  process.env.DATABASE_URL = journeyUrl;
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Every real program file, as programs:sync loads it; curated programs close in 2099.
  for (const f of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, f), 'utf8'));
    if (!raw.campaign) Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
    await upsertProgram(ProgramFile.parse(raw));
  }
});

after(async () => {
  globalThis.fetch = realFetch;
  if (!sharedUrl || !localDb) return;
  await sql().end();
  process.env.DATABASE_URL = sharedUrl;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
  } finally {
    await admin.end();
  }
});

// ---- The outside world -------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();
const FANS = Array.from({ length: 40 }, (_, i) => `fan${i + 1}`);
const TIPJAR = {
  name: 'tipjar',
  full_name: 'lee/tipjar',
  fork: false,
  is_template: false,
  private: false,
  homepage: null,
  has_pages: false,
  owner: { login: 'lee', type: 'User' },
  created_at: iso(NOW.getTime() - 200 * DAY),
  pushed_at: iso(NOW.getTime() - DAY),
  stargazers_count: FANS.length,
};
/** Unexpected GitHub paths, for the failure message (a read the fake doesn't serve throws). */
const unserved: string[] = [];

/**
 * GitHub, the site probe, Blockscout and Arc, as lee's world stands: one own public repo, lee/tipjar,
 * starred by 40 accounts 900 days old over the last 12 days, a few commit weeks, and a CNAME of
 * tip.example.com that answers 200. No orgs, no merged PRs, no contract. Arc and Blockscout are
 * never asked (no contract source); they throw if they are.
 */
function fakeWorld(): ReaderDeps {
  const now = new Date();
  const weeks = [1, 2, 3, 5, 8].map((w) => ({ week: Math.floor((now.getTime() - w * 7 * DAY) / 1000), total: 4 }));
  const gh: Record<string, unknown> = {
    '/users/lee': { login: 'lee', created_at: iso(now.getTime() - 2000 * DAY), blog: null, twitter_username: null, public_repos: 1, type: 'User' },
    '/users/lee/repos?type=owner&per_page=100': [TIPJAR],
    '/users/lee/orgs': [],
    '/repos/lee/tipjar': TIPJAR,
    '/repos/lee/tipjar/git/trees/HEAD?recursive=1': { tree: [{ path: 'CNAME', type: 'blob' }, { path: 'README.md', type: 'blob' }] },
    '/repos/lee/tipjar/contents/CNAME': { content: Buffer.from('tip.example.com\n').toString('base64'), encoding: 'base64' },
    '/repos/lee/tipjar/stargazers?per_page=100&page=1': FANS.map((f, i) => ({ starred_at: iso(now.getTime() - ((i % 12) + 1) * DAY), user: { login: f } })),
    '/repos/lee/tipjar/forks?per_page=100': [],
    '/repos/lee/tipjar/issues?state=all&per_page=100': [],
    '/repos/lee/tipjar/contributors?per_page=100': [{ login: 'lee' }],
    '/repos/lee/tipjar/contributors?per_page=1': [{ login: 'lee' }],
    '/repos/lee/tipjar/stats/commit_activity': weeks,
  };
  for (const f of FANS) gh[`/users/${f}`] = { login: f, created_at: iso(now.getTime() - 900 * DAY) };
  const no = (what: string) => async () => {
    throw new Error(`v212-journey: unexpected ${what} read`);
  };
  // v2.12.1: the daily read is one GraphQL query for lee (the newest 10 stargazers, as GitHub answers).
  const person = {
    data: {
      user: {
        login: 'lee', twitterUsername: null, websiteUrl: null,
        repositories: {
          nodes: [{
            nameWithOwner: 'lee/tipjar', description: null, homepageUrl: null, isFork: false, isTemplate: false,
            createdAt: TIPJAR.created_at, pushedAt: TIPJAR.pushed_at, stargazerCount: FANS.length, forkCount: 0, parent: null, templateRepository: null,
            stargazers: { edges: FANS.slice(-10).map((f, i) => ({ starredAt: iso(now.getTime() - ((i % 12) + 1) * DAY), node: { login: f, createdAt: iso(now.getTime() - 900 * DAY) } })) },
            forks: { nodes: [] },
            defaultBranchRef: { target: { history: { nodes: weeks.map((w) => ({ committedDate: iso(w.week * 1000) })) } } },
          }],
        },
      },
    },
  };
  return {
    ghGraphql: async <T,>(_q: string, v: Record<string, unknown>) => {
      if (v.login === 'lee') return person as T;
      // v2.12.1 T8: lee/tipjar by name (find's refresh reads the agent's repo before the login is proven).
      if (v.o0 === 'lee' && v.n0 === 'tipjar' && v.o1 === undefined) return { data: { r0: person.data.user.repositories.nodes[0] } } as T;
      unserved.push(`graphql ${String(v.login)}`);
      throw new Error('v212-journey: GraphQL not served');
    },
    gh: async <T,>(path: string) => {
      if (path.startsWith('/search/issues?')) return { items: [] } as T;
      if (path in gh) return gh[path] as T;
      unserved.push(path);
      throw new Error(`v212-journey: GitHub ${path} not served`);
    },
    probe: async (url) => ({ status: url.replace(/\/$/, '') === 'https://tip.example.com' ? 200 : 404 }),
    fetchText: async () => {
      throw new Error('not found');
    },
    json: no('npm/pypi'),
    baseTxs: no('Blockscout'),
    tokenTransfers: no('Blockscout transfers'),
    contractOrigin: no('contract origin'),
    arcLogs: no('Arc logs'),
    arcHead: no('Arc head'),
    arcSender: no('Arc sender'),
    usdPerNative: no('price'),
    walletCreations: no('walletCreations'),
    now,
  };
}

// ---- Helpers -----------------------------------------------------------------------------------

/** A new connection, as the MCP route makes it: the token saved, then used. */
async function freshInstallation(): Promise<{ installationId: number }> {
  const token = `v212-${randomBytes(16).toString('hex')}`;
  await saveInstallation(token);
  const id = await touchInstallation(token);
  assert.ok(id);
  return { installationId: id };
}

async function eventTypes(id: number): Promise<string[]> {
  return (await sql()<{ type: string }[]>`SELECT DISTINCT type FROM builder_events WHERE installation_id = ${id}`).map((r) => r.type);
}

const proven = async () => ({ login: 'lee', basis: 'proof_line' as const });

// ---- The journey -------------------------------------------------------------------------------

test('15.2 fresh install to a filled live score: find with local_git, cron discover, read, score (v2.12.1: the live v2 score)', db, async () => {
  const ctx = await freshInstallation();
  journeyId = ctx.installationId;
  // v2.12.1 T8: the first find is the three-part reply (no v2.12 consent line or score line); its
  // refresh reads the same fake world (no network).
  const first = (await tools.find({ local_git: { emails: ['lee@x.dev'], remotes: ['git@github.com:lee/tipjar.git'] } }, { ...ctx, readerDeps: fakeWorld() })) as { show_to_builder: string };
  assert.match(first.show_to_builder, /^Where you stand\n/);
  assert.ok((first.show_to_builder.match(/\?/g) ?? []).length <= 1, first.show_to_builder);
  assert.doesNotMatch(first.show_to_builder, /\bscore\b|Say hide anytime|earnkit\.com\/b\/|—/);
  // The agent's remote is a clue only (R4): proposed, never verified by find.
  const [remote] = await sql()<{ state: string; proposed_by: string }[]>`SELECT state, proposed_by FROM builder_sources WHERE builder_id = ${ctx.installationId} AND kind = 'repo' AND ref = 'lee/tipjar'`;
  assert.deepEqual(remote, { state: 'proposed', proposed_by: 'agent' });
  // The agent pushed the proof line (fake pusher = owner), so the login is proven. v2.12.1 T8: find's
  // refresh already ran discovery once (no proof then); the pushed line queues it again, as
  // noteLineIssued's caller does in production.
  await enqueueDiscovery(ctx.installationId, 'local_repo');
  const run = (await runCron({ now: NOW, only: ['none'], deps: { builderScore: { reader: fakeWorld(), login: proven, only: [ctx.installationId] } } })) as { builder_score?: Record<string, unknown> };
  assert.deepEqual(unserved, [], 'every GitHub read was served');
  assert.ok(run.builder_score, 'the score steps ran');
  for (const s of ['discover', 'read', 'score', 'empty']) assert.doesNotMatch(JSON.stringify(run.builder_score[s]), /"step":"(error|skipped)"/, s);
  const sources = await sql()<{ kind: string; ref: string; state: string }[]>`SELECT kind, ref, state FROM builder_sources WHERE builder_id = ${ctx.installationId} ORDER BY kind, ref`;
  assert.deepEqual([...sources], [
    { kind: 'repo', ref: 'lee/tipjar', state: 'verified' },
    { kind: 'site', ref: 'https://tip.example.com', state: 'verified' },
  ]);
  // v2.12.1 T4: the cron's score step writes the live v2 score (builder_live) and a v2 history row.
  const [live] = await sql()<{ score: number; ranked: boolean }[]>`SELECT score, ranked FROM builder_live WHERE builder_id = ${ctx.installationId}`;
  assert.ok(live && live.score > 0 && live.ranked, JSON.stringify(live));
  const [hist] = await sql()<{ formula: string }[]>`SELECT formula FROM builder_scores WHERE builder_id = ${ctx.installationId}`;
  assert.equal(hist.formula, 'v2');
  // The old random slug is kept in the history (its v2.12 page redirect is 15.2c's, replaced in T11).
  const [{ old }] = await sql()<{ old: string }[]>`SELECT old_slug AS old FROM profile_slug_history WHERE builder_id = ${ctx.installationId}`;
  assert.ok(old);
  const events = await eventTypes(ctx.installationId);
  for (const t of ['source_proposed', 'source_verified', 'reading_taken', 'score_computed']) assert.ok(events.includes(t), t);
  // A filled profile is never counted empty.
  assert.ok(!events.includes('profile_empty'));
});

// v2.12.1 T8 (replaces 15.2b's score half): after the cron, the score tool answers with where lee
// stands: rank first (lee is the only ranked person here), the shipped app with people using it,
// and the one step up; no score number, no percentile, no v2.12 link.
test('15.2b the score tool after the cron: where you stand, the rank only as it reads well, one step', db, async () => {
  assert.ok(journeyId, '15.2 ran');
  const ctx = { installationId: journeyId, readerDeps: fakeWorld() } as Parameters<typeof tools.score>[1];
  const s = (await tools.score({}, ctx)) as { show_to_builder: string; move_up?: { kind: string } };
  // Stars count toward the score (at most 5), not as people using the app: lee leads with the work.
  assert.match(s.show_to_builder, /^Where you stand\nYou've shipped 1 app with AI: tipjar\. You're #1 of 1 builder on EarnKit\.\n/);
  assert.doesNotMatch(s.show_to_builder, /\bscore\b|top \d+%|earnkit\.com\/b\/|—|\b(find|prepare|confirm|tell)\b/i);
  assert.ok((s.show_to_builder.match(/\?/g) ?? []).length <= 1, s.show_to_builder);
  assert.ok((await eventTypes(journeyId)).includes('score_viewed'));
});

// v2.12.1 T4: the v2.12 page and "Top N% of builders" read v1 rows only (publicScore), which the cron
// no longer writes. T11 replaces them (deleted in T12).
test('15.2c the v2.12 page after the cron (percentiles, "Top N% of builders")', { ...db, todo: 'replaced in T11' }, async () => {
  assert.ok(journeyId, '15.2 ran');
  // v2.12 final I4: a page whose consent line was never shown is not public; v2.12.1 T8's find has no consent line.
  const [{ old }] = await sql()<{ old: string }[]>`SELECT old_slug AS old FROM profile_slug_history WHERE builder_id = ${journeyId}`;
  assert.deepEqual(await profileData(old, NOW), { redirect: 'lee' });
  const page = await profileData('lee', NOW);
  assert.ok(page && 'score' in page && page.score > 0, JSON.stringify(page));
  // Final review: "Top N%" only for N <= 50 (the rank depends on everyone in the DB).
  const view = html(React.createElement(ProfileView, { data: page }));
  if (page.top_percent === null) assert.doesNotMatch(view, /Top \d+%/);
  else assert.ok(page.top_percent <= 50 && view.includes(`Top ${page.top_percent}% of builders`));
});

test('15.3 a rerun of the cron the same day writes no score, reading or event', db, async () => {
  assert.ok(journeyId, '15.2 ran');
  const counts = async () => (await sql()<{ s: number; r: number; e: number }[]>`
    SELECT (SELECT count(*)::int FROM builder_scores) AS s, (SELECT count(*)::int FROM source_readings) AS r, (SELECT count(*)::int FROM builder_events) AS e`)[0];
  const before = await counts();
  assert.ok(before.s > 0 && before.r > 0 && before.e > 0);
  await runCron({ now: NOW, only: ['none'], deps: { builderScore: { reader: fakeWorld(), login: proven, only: [journeyId] } } });
  assert.deepEqual(await counts(), before);
});

test('15.4 an install with nothing verifiable gets one profile_empty with its reason, and find says nothing was found and asks for a link', db, async () => {
  const ctx = { ...(await freshInstallation()), readerDeps: fakeWorld() };
  await tools.find({}, ctx);
  const later = new Date(Date.now() + 11 * 60_000);
  await runCron({ now: later, only: ['none'], deps: { builderScore: { reader: fakeWorld(), login: async () => null, only: [ctx.installationId] } } });
  const [e] = await sql()<{ detail: { missing: string } }[]>`SELECT detail FROM builder_events WHERE dedupe_key = ${`profile_empty:${ctx.installationId}`}`;
  assert.equal(e.detail.missing, 'no_github');
  // Once: a second run writes no second event.
  await runCron({ now: new Date(later.getTime() + 60_000), only: ['none'], deps: { builderScore: { reader: fakeWorld(), login: async () => null, only: [ctx.installationId] } } });
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'profile_empty' AND installation_id = ${ctx.installationId}`;
  assert.equal(n, 1);
  // v2.12.1 T8 (replaces v2.12's fill-step line): spec example 3's first and last parts.
  const again = (await tools.find({}, ctx)) as { show_to_builder: string };
  assert.match(again.show_to_builder, /^Where you stand\nI couldn't find anything you've made yet\.\n/);
  assert.ok(again.show_to_builder.endsWith(`How to move up\n${SEND_LINK_LINE}`), again.show_to_builder);
});

test('15.5 v212-metric prints the empty rate for new installs per day', db, async () => {
  // Real time: the profiles above were made by the database's now(); read the journey database, not the shared one.
  const [{ day }] = await sql()<{ day: string }[]>`SELECT (first_find_at AT TIME ZONE 'UTC')::date::text AS day FROM builder_profiles WHERE builder_id = ${journeyId}`;
  const r = spawnSync(process.execPath, ['--import', 'tsx', METRIC, '--as-of', new Date(Date.now() + 15 * 60_000).toISOString()], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: journeyUrl },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  // Both installs were made today: 2 new, 1 empty (15.4's).
  assert.match(r.stdout, new RegExp(`^${day}: \\d+ new, \\d+ empty \\(\\d+%\\)$`, 'm'));
  assert.match(r.stdout, new RegExp(`^${day}: 2 new, 1 empty \\(50%\\)$`, 'm'), r.stdout);
  // Bad input is refused.
  const bad = spawnSync(process.execPath, ['--import', 'tsx', METRIC, '--days', '0'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: journeyUrl }, encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

test('15.6 nothing in the journey reached the network', db, () => {
  assert.deepEqual(blocked, []);
});
