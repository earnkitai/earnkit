import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
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
import { EVENT_LOG_FLAG } from './events';
import { runCron } from './cron';
import { claimGet, claimPost, xCallback } from './claim';
import { rootOf } from './identity';
import { REFRESH_BUDGET_MS, refreshPerson, standingOf } from './person-score';
import { NOT_CONFIRMED, boardRows, pageCards, pageHead } from './page-data';
import { coinPitchAllowed } from './coin-moments';
import { HEADS } from './where-you-stand';
import { rankWords } from './rank';
import { bannedIn } from './fixtures/banned-words';
import type { ReaderDeps } from './source-readers';
import type { XOAuthDeps } from './x-oauth';
import ProfileView from '../../app/[handle]/ProfileView';
import ProjectCards from '../../app/[handle]/ProjectCards';
import LeaderboardView from '../../app/leaderboard/LeaderboardView';

/**
 * v2.12.1 T12 (spec "Acceptance test", in fixtures): a fresh install to a filled page, a counted
 * project, a coin moment, a card and a leaderboard row, through the real flag-on code paths:
 * find with `identity` (the three-part reply, the claim link, the 10-second refresh), the claim
 * (claimGet, claimPost, xCallback), a second agent joining the same page with both yeses, tell's
 * move_up yes (count past users), the page's refresh guard, the page markup, tell's card yes and the
 * share route, the score tool and the leaderboard rows. It replaces the v2.12 journey's parked
 * cases (tools 7.8, 7.8c, 9.4; share 11.8, 11.9, 11.10: consent line, score line, card offer).
 *
 * Real: the tools, the readers' parsing, discovery, the v2 score and its anti-farming rules, the
 * rank, the claim and its X binding, the join, the event log, every program file, and a throwaway
 * database of its own (schema.sql, dropped after).
 *
 * Faked, the outside world only: GitHub (one GraphQL person query, and its REST profile), the site
 * probe, Blockscout (the contract's callers and creator), tokens.fun's ticker check and X (the token
 * exchange and /2/users/me).
 * The one-time wallet signature on the claim page (wallet-proof.ts, tested in T7) is written as its
 * row. Every other fetch is noted and refused; case 8 asserts none happened.
 */

const localDb = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
})();
const db = { skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres' };

const PROGRAMS_DIR = join(import.meta.dirname, '../../../../programs');
const SCHEMA = join(import.meta.dirname, '../../db/schema.sql');
const FAR = '2099-01-01T00:00:00Z';
const DAY = 86_400_000;
const NOW = new Date();
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v2121_journey_${process.pid}`;

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, '\n').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const savedEnv: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  EARNKIT_BUILDER_SCORE: 'on',
  [EVENT_LOG_FLAG]: 'on',
  EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v2121-journey-secret',
  X_CLIENT_ID: 'v2121-journey-x',
  X_CLIENT_SECRET: 'v2121-journey-xs',
  EARNKIT_URL: 'https://earnkit.com',
  // Token launches are on (the coin moment); nothing launches here.
  TOKENSFUN_DEPLOY_API_KEY: 'test',
  GITHUB_TOKEN: undefined,
};

/** No network: every outside host is refused and noted (the database is on this machine). */
const blocked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
  // tokens.fun's ticker check (the coin line names a free ticker): faked, every ticker is free.
  if (u.hostname === 'tokens.fun' && u.pathname === '/api/check-ticker') {
    reads.push('tokens.fun');
    return Response.json({ available: true });
  }
  blocked.push(url);
  return new Response('v2121-journey: no network', { status: 503 });
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
  const fresh = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await fresh.unsafe(readFileSync(SCHEMA, 'utf8'));
  } finally {
    await fresh.end();
  }
  process.env.DATABASE_URL = url.toString();
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
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
const address = () => `0x${randomBytes(20).toString('hex')}`;
/** lee's own wallet: it created the tip jar's contract, and lee signs with it once on the claim page. */
const W = address();
const C = address();
const CONTRACT = `base:${C}`;
const CALLERS = 12;
/** Calls into the outside world, by kind (the refresh guard: a guarded view reads nothing). */
const reads: string[] = [];

const repoNode = (name: string, homepage: string | null) => ({
  nameWithOwner: `lee/${name}`, description: null, homepageUrl: homepage, isFork: false, isTemplate: false, isPrivate: false,
  createdAt: iso(NOW.getTime() - 200 * DAY), pushedAt: iso(NOW.getTime() - DAY), stargazerCount: 0, forkCount: 0,
  owner: { __typename: 'User', login: 'lee' }, parent: null, templateRepository: null,
  stargazers: { edges: [] }, forks: { nodes: [] },
  defaultBranchRef: { target: { history: { nodes: [1, 8, 15].map((d) => ({ committedDate: iso(NOW.getTime() - d * DAY) })) } } },
});
/** lee's GitHub: one public repo (the tip jar, live at its homepage); the X field names @lee_builds. */
const REPOS: Record<string, ReturnType<typeof repoNode>> = { tipjar: repoNode('tipjar', 'https://tipjar.example.com') };
const PERSON = { data: { user: { login: 'lee', twitterUsername: 'lee_builds', websiteUrl: null, repositories: { nodes: Object.values(REPOS) } } } };

function world(): ReaderDeps {
  const now = new Date();
  const no = (what: string) => async (): Promise<never> => {
    reads.push(`unexpected ${what}`);
    throw new Error(`v2121-journey: ${what} not served`);
  };
  const callers = Array.from({ length: CALLERS }, (_, i) => ({
    timestamp: iso(now.getTime() - (1 + (i % 10)) * DAY), status: 'ok', from: { hash: address() }, value: '0',
  }));
  return {
    ghGraphql: async <T,>(_q: string, v: Record<string, unknown>) => {
      reads.push('github');
      if (v.login === 'lee') return PERSON as T;
      const data: Record<string, unknown> = {};
      for (let i = 0; v[`o${i}`] !== undefined; i++) if (v[`o${i}`] === 'lee' && REPOS[String(v[`n${i}`])]) data[`r${i}`] = REPOS[String(v[`n${i}`])];
      return { data } as T;
    },
    gh: async <T,>(path: string) => {
      reads.push('github');
      if (path === '/users/lee') return { login: 'lee', created_at: iso(now.getTime() - 2000 * DAY), blog: null, twitter_username: 'lee_builds', public_repos: 1, type: 'User' } as T;
      if (path.startsWith('/users/lee/repos'))
        return [{ name: 'tipjar', full_name: 'lee/tipjar', fork: false, is_template: false, private: false, homepage: 'https://tipjar.example.com', has_pages: false, owner: { login: 'lee', type: 'User' }, created_at: iso(now.getTime() - 200 * DAY), pushed_at: iso(now.getTime() - DAY), stargazers_count: 0 }] as T;
      if (path === '/users/lee/orgs') return [] as T;
      if (path.startsWith('/search/issues?')) return { items: [] } as T;
      throw new Error(`v2121-journey: GitHub ${path} not served`);
    },
    probe: async (url) => {
      reads.push('site');
      return { status: /^https:\/\/(tipjar|recipes|budget)\.example\.com\/?$/.test(url) ? 200 : 404 };
    },
    fetchText: async () => {
      throw new Error('not found');
    },
    baseTxs: async () => {
      reads.push('blockscout');
      return { items: callers, next_page_params: null };
    },
    contractOrigin: async () => {
      reads.push('blockscout');
      return { deployer: W, created_at: iso(now.getTime() - 30 * DAY) };
    },
    tokenTransfers: no('Blockscout transfers'),
    json: no('npm/pypi'),
    arcLogs: no('Arc logs'),
    arcHead: no('Arc head'),
    arcSender: no('Arc sender'),
    usdPerNative: async () => 3000,
    walletCreations: async () => [],
    now,
  };
}

/** X: the token exchange and /2/users/me, as X answers for @Lee_Builds (user id 1). */
const fakeX: XOAuthDeps = { exchange: async () => 'x-token', me: async () => ({ id: '1', username: 'Lee_Builds', name: 'Lee', avatar: null }) };

// ---- Helpers -----------------------------------------------------------------------------------

async function freshInstallation(): Promise<{ installationId: number; readerDeps: ReaderDeps }> {
  const token = `v2121-${randomBytes(16).toString('hex')}`;
  await saveInstallation(token);
  const id = await touchInstallation(token);
  assert.ok(id);
  return { installationId: id, readerDeps: world() };
}
type Reply = { show_to_builder: string; claim?: { link: string }; move_up?: { kind: string; project_key: string | null }; pick_up?: { question: string }; coin?: { project_key: string } };
const call = async (tool: 'find' | 'tell' | 'score', input: unknown, ctx: { installationId: number; readerDeps: ReaderDeps }) =>
  (await (tools[tool] as (i: unknown, c: unknown) => Promise<unknown>)(input, ctx)) as Reply;
/** As if `minutes` passed since the person's last read: the refresh guard and each source's live reading. */
async function ago(id: number, minutes: number) {
  const at = new Date(Date.now() - minutes * 60_000);
  await sql()`UPDATE builder_live SET read_at = ${at} WHERE builder_id = ${id}`;
  await sql()`UPDATE source_live SET read_at = LEAST(read_at, ${at}) WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
}
const EXEMPT = ['TipJar', 'Recipes', 'Budget', 'EarnKit', 'AI'];

/** The claim link's page, its form and X's callback, as a browser carries them. */
async function claim(link: string): Promise<Response> {
  const code = link.split('/').pop()!;
  const get = await claimGet(new Request(`https://earnkit.com/claim/${code}`), code);
  assert.equal(get.status, 200);
  const cookie = get.headers.get('set-cookie')!.split(';')[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(await get.text())![1];
  const post = await claimPost(
    new Request(`https://earnkit.com/claim/${code}`, {
      method: 'POST',
      headers: { cookie, origin: 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf }),
    }),
    code,
    { limit: async () => {} },
  );
  assert.equal(post.status, 303);
  const state = new URL(post.headers.get('location')!).searchParams.get('state')!;
  return xCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie } }), { x: fakeX, limit: async () => {} });
}

/** Three other people on the board, ranked and claimed, so lee's rank can move. Never read again. */
async function others() {
  for (const [i, score] of [[1, 30], [2, 20], [3, 14]] as const) {
    const id = 900_000 + i;
    await sql()`INSERT INTO installations (id, token_hash) VALUES (${id}, ${`v2121-other-${i}`})`;
    await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, claimed_at) VALUES (${id}, ${`other${i}`}, ${`90${i}`}, ${`other${i}`}, now())`;
    await sql()`
      INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
      VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-launch', now(), now() + interval '1 day')`;
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${`o${i}/app`}, ${`App${i}`}, 'app', true, true)`;
  }
}

const IDENTITY = {
  github_login: 'lee',
  wallets: [W],
  projects: [
    { name: 'TipJar', what: 'a tip jar', repo: 'https://github.com/lee/tipjar', live_url: 'https://tipjar.example.com', contracts: [CONTRACT] },
    { name: 'Recipes', what: 'a recipe planner', live_url: 'https://recipes.example.com' },
    { name: 'Budget', what: 'a budget tracker', live_url: 'https://budget.example.com' },
  ],
};

// ---- The journey -------------------------------------------------------------------------------

let lee: { installationId: number; readerDeps: ReaderDeps };
let second: { installationId: number; readerDeps: ReaderDeps };
let rankBefore = 0;

test('1. a fresh install: find with identity answers in three parts, at most one question, with the claim link; no v2.12 line', db, async () => {
  await others();
  lee = await freshInstallation();
  const r = await call('find', { identity: IDENTITY }, lee);
  const t = r.show_to_builder;
  const at = [HEADS.stand, HEADS.earn, HEADS.up].map((h) => t.indexOf(`${h}\n`));
  assert.ok(at[0] === 0 && at[0] < at[1] && at[1] < at[2], t);
  assert.ok((t.match(/\?/g) ?? []).length <= 1, t);
  assert.match(r.claim?.link ?? '', /^earnkit\.com\/claim\/[a-z2-7]{12}$/);
  assert.ok(t.includes(`Claim your page with X: ${r.claim!.link}`), t);
  assert.match(t, /You've shipped 3 apps with AI: (a tip jar|a recipe planner|a budget tracker), (a tip jar|a recipe planner|a budget tracker) and (a tip jar|a recipe planner|a budget tracker)\./);
  for (const w of ['a tip jar', 'a recipe planner', 'a budget tracker']) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /#\d+ of/, 'nothing confirmed yet: no rank (plan S1)');
  assert.doesNotMatch(t, /Say hide anytime|earnkit\.com\/b\/|You: score|Score \d|Top \d+%/);
  assert.deepEqual(bannedIn(t.replace(/^Ways to earn right now\n.*$/m, ''), EXEMPT), [], t);
  // The refresh inside find read lee's world once (the agent's sites and contract), nothing else.
  assert.ok(reads.includes('site') && reads.includes('blockscout'), reads.join(','));
  // The score tool says the same three things (v2.12's "Score N" half of 15.2b, replaced).
  const s = await call('score', {}, lee);
  assert.match(s.show_to_builder, /^Where you stand\nYou've shipped 3 apps with AI/);
  assert.ok((s.show_to_builder.match(/\?/g) ?? []).length <= 1);
});

test('2. the claim with X: the X field on GitHub matches, so lee ranks; the next find says "Your page: earnkit.com/Lee_Builds"', db, async () => {
  const link = (await call('find', {}, lee)).claim!.link;
  const done = await claim(link);
  assert.equal(done.status, 200);
  assert.match(await done.text(), /Your page is live/);
  const [p] = await sql()<{ x_user_id: string; x_handle: string }[]>`SELECT x_user_id, x_handle FROM builder_profiles WHERE builder_id = ${lee.installationId}`;
  assert.deepEqual({ ...p }, { x_user_id: '1', x_handle: 'Lee_Builds' });
  // Final fix wave (first-message rank): NO cron run here. lee asks again 11 minutes later; that
  // find's own refresh reads GitHub's X field (x_match, queued by the claim), scores the confirmed
  // ship and ranks it at once: no other EarnKit person touched lee's work, so no ring is needed.
  const [ring] = await sql()<{ ring: unknown }[]>`SELECT ring FROM builder_profiles WHERE builder_id = ${lee.installationId}`;
  assert.deepEqual(ring.ring, {}, 'the cron never computed a ring');
  await ago(lee.installationId, 11);
  const r = await call('find', {}, lee);
  assert.match(r.show_to_builder, /Your page: earnkit\.com\/Lee_Builds(\n|$)/, r.show_to_builder);
  assert.equal(r.claim, undefined, 'claimed: no claim link');
  const [g] = await sql()<{ github_login: string; github_basis: string }[]>`SELECT github_login, github_basis FROM builder_profiles WHERE builder_id = ${lee.installationId}`;
  assert.deepEqual({ ...g }, { github_login: 'lee', github_basis: 'x_match' });
  const st = await standingOf(lee.installationId);
  assert.equal(st.ranked, true, 'a confirmed ship ranks');
  // Lee's one confirmed ship (the tip jar) ties @other3 at 14 behind 30 and 20: #3 of 4 listed.
  assert.deepEqual({ ranked: st.ranked, rank: st.rank, total: st.total, score: st.score }, { ranked: true, rank: 3, total: 4, score: 14 });
  rankBefore = st.rank;
  // spec "Lead with the work": the rank line only when it reads well, the top half under 50 ranked
  // (T2 ruling): #3 of 4 is not, so the reply has no rank line.
  assert.equal(rankWords(st), null);
  assert.doesNotMatch(r.show_to_builder, /#\d+ of \d+/, r.show_to_builder);
});

test('3. a second agent claims with the same X account: both agents say yes once, then one person and one page', db, async () => {
  second = await freshInstallation();
  const r = await call('find', {}, second);
  const done = await claim(r.claim!.link);
  assert.equal(done.status, 200);
  assert.match(await done.text(), /already has an EarnKit page/);
  assert.notEqual(await rootOf(second.installationId), await rootOf(lee.installationId), 'never at once');
  for (const ctx of [lee, second]) {
    const asked = await call('find', {}, ctx);
    assert.ok(asked.pick_up?.question, asked.show_to_builder);
    await call('tell', { pickup: 'yes' }, ctx);
  }
  assert.equal(await rootOf(second.installationId), await rootOf(lee.installationId));
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_profiles WHERE x_user_id = '1'`;
  assert.equal(n, 1, 'one page');
});

test('4. one yes counts the tip jar\'s past users: "Done. N people ... now count. You\'re now #..." and the rank moves; the coin is that reply\'s one yes', db, async () => {
  const id = await rootOf(lee.installationId);
  // The wallet that created the contract, as the claim page's one-time signature leaves it: the
  // person_wallets row is inserted directly here; the signature itself (/claim/wallet, EIP-191) is
  // covered by T7 (wallet-proof.test.ts 7.1, 7.3).
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W.toLowerCase()}, ${id})`;
  await ago(id, 11);
  const r = await call('find', {}, lee);
  assert.equal(r.move_up?.kind, 'count_past', r.show_to_builder);
  assert.match(r.show_to_builder, /Want me to count them\? Your rank goes up today\.$/);
  const yes = await call('tell', { move_up: { kind: 'count_past', project_key: r.move_up!.project_key, answer: 'yes' } }, lee);
  assert.match(yes.show_to_builder, new RegExp(`^Done\\. ${CALLERS} people who used TipJar now count\\. You're now #(\\d+) of \\d+\\.`), yes.show_to_builder);
  const now = Number(/You're now #(\d+)/.exec(yes.show_to_builder)![1]);
  assert.ok(now < rankBefore, `${now} < ${rankBefore}`);
  assert.equal((await standingOf(id)).rank, now, 'the reply and the standing agree');
  // spec 3b: the countable reply offers the coin as its one yes, and nothing else does.
  assert.equal(yes.coin?.project_key, 'lee/tipjar', yes.show_to_builder);
  assert.match(yes.show_to_builder, /Want to launch a coin, \$[A-Z0-9]+ \([^)]+\), for TipJar\? You'd get 40% of its trading fees/);
  assert.equal((yes.show_to_builder.match(/\?/g) ?? []).length, 1);
});

test('4b. the hourly cron then computes lee\'s ring: nothing to discount, so the rank the first replies showed never drops', db, async () => {
  const id = await rootOf(lee.installationId);
  const before = await standingOf(id);
  const run = (await runCron({ now: new Date(), only: ['none'], deps: { builderScore: { reader: world(), only: [id] } } })) as { builder_score?: Record<string, unknown> };
  for (const s of ['discover', 'read', 'score']) assert.doesNotMatch(JSON.stringify(run.builder_score?.[s]), /"step":"(error|skipped)"/, s);
  const [p] = await sql()<{ ring: { ring?: unknown[] } }[]>`SELECT ring FROM builder_profiles WHERE builder_id = ${id}`;
  assert.deepEqual(p.ring.ring, [], 'computed, no ring partner');
  // The cron's full daily read can add history (more weeks, more people); the ring takes nothing away.
  const after = await standingOf(id);
  assert.equal(after.ranked, true);
  assert.ok(after.score >= before.score && after.rank <= before.rank, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
});

test('5. the page reads lee\'s sources at most once every 10 minutes: 5 minutes later nothing, 11 minutes later once', db, async () => {
  const id = await rootOf(lee.installationId);
  const view = () => refreshPerson(id, { now: new Date(), deadline: Date.now() + REFRESH_BUDGET_MS, reader: world() }); // as handle-view.tsx's Cards
  await ago(id, 5);
  const n0 = reads.length;
  assert.deepEqual(await view(), { refreshed: false });
  assert.equal(reads.length, n0, 'nothing read');
  await ago(id, 11);
  assert.deepEqual(await view(), { refreshed: true });
  assert.ok(reads.length > n0, 'read once');
  const n1 = reads.length;
  assert.deepEqual(await view(), { refreshed: false });
  assert.equal(reads.length, n1);
});

test('6. the page: filled at /Lee_Builds, the two projects only the agent named marked "Not yet confirmed", no banned word', db, async () => {
  const id = await rootOf(lee.installationId);
  const head = await pageHead(id);
  assert.equal(head.handle, 'Lee_Builds');
  assert.equal(head.topLine, 'Lee has shipped 3 apps with AI.');
  assert.match(head.rank ?? '', /^#\d+ of \d+ builders on EarnKit$/);
  const cards = await pageCards(id);
  assert.deepEqual(cards.map((c) => [c.name, c.confirmed]).sort(), [['Budget', false], ['Recipes', false], ['TipJar', true]]);
  assert.equal(cards.find((c) => c.name === 'TipJar')?.people, CALLERS);
  const page = html(React.createElement(ProfileView, { head, cards }));
  assert.equal(page.split(NOT_CONFIRMED).length - 1, 2, 'one quiet label on each agent-only card');
  const words = text(page.split('<footer')[0]);
  assert.deepEqual(bannedIn(words, EXEMPT), [], words);
  assert.doesNotMatch(words, /\/100|Top \d+%/);
  assert.equal(html(React.createElement(ProjectCards, { cards: null })).includes('aria-busy="true"'), true, 'skeletons while reading');
});

test('7. the token is offered only at a 3b moment: the countable reply; never on a program entry, never again for the same project', db, async () => {
  const id = await rootOf(lee.installationId);
  const moments = await sql()<{ project_key: string; moment: string }[]>`SELECT project_key, moment FROM coin_moments WHERE builder_id = ${id}`;
  assert.deepEqual(moments.map((m) => `${m.project_key}:${m.moment}`), ['lee/tipjar:countable']);
  // Every pitch and launch path asks coinPitchAllowed (tools.ts tokenPitch): a program entry never.
  for (const program of ['avalanche-team1-mini-grants', 'arc-microgrants'])
    assert.equal(await coinPitchAllowed(id, { program_id: program, build: false }), false, program);
  await ago(id, 11);
  const r = await call('find', {}, lee);
  assert.doesNotMatch(r.show_to_builder, /launch a coin/, 'once per project');
  assert.equal(r.coin, undefined);
});

test('8. the card: tell card yes gives the share link; the share route records it and opens X with the page; the leaderboard lists lee', db, async () => {
  const id = await rootOf(lee.installationId);
  const card = await call('tell', { card: 'yes' }, lee);
  assert.equal(card.show_to_builder, 'Post it: https://earnkit.com/Lee_Builds/share');
  const share = await (await import('../../app/[handle]/share/route')).GET(new Request('https://earnkit.com/Lee_Builds/share'), { params: Promise.resolve({ handle: 'Lee_Builds' }) });
  assert.equal(share.status, 302);
  const to = new URL(share.headers.get('location')!);
  assert.equal(to.origin + to.pathname, 'https://x.com/intent/post');
  assert.match(to.searchParams.get('text') ?? '', /on EarnKit\.$/);
  assert.equal(to.searchParams.get('url'), 'https://earnkit.com/Lee_Builds');
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'card_shared' AND installation_id = ${id}`;
  assert.equal(n, 1);
  const board = await boardRows();
  const row = board.rows.find((r) => r.handle === 'Lee_Builds');
  assert.ok(row, JSON.stringify(board.rows));
  assert.equal(row.rank, (await standingOf(id)).rank, 'one number everywhere');
  assert.equal(board.count, 4);
  const words = text(html(React.createElement(LeaderboardView, board)).split('<footer')[0]);
  assert.deepEqual(bannedIn(words, EXEMPT), [], words);
});

test('9. hide my page: the page is gone (404) and the board drops lee; show brings both back', db, async () => {
  const id = await rootOf(lee.installationId);
  const hid = await call('tell', { profile: 'hide' }, lee);
  assert.equal(hid.show_to_builder, 'Your page is hidden. Say show my page to list it again.');
  const { resolveHandle } = await import('./profiles');
  assert.equal(await resolveHandle('Lee_Builds'), null);
  const hiddenBoard = await boardRows();
  assert.equal(hiddenBoard.rows.some((r) => r.handle === 'Lee_Builds'), false);
  // A hidden page is in no one's rank (terms: "it does not count toward anyone's rank").
  assert.equal(hiddenBoard.count, 3);
  for (const other of [900_001, 900_002, 900_003]) assert.equal((await standingOf(other)).total, 3, String(other));
  assert.equal((await standingOf(900_003)).rank, 3);
  const shown = await call('tell', { profile: 'show' }, lee);
  assert.equal(shown.show_to_builder, 'Your page is public again: earnkit.com/Lee_Builds');
  assert.deepEqual(await resolveHandle('Lee_Builds'), { builderId: id, handle: 'Lee_Builds' });
});

test('10. nothing in the journey reached the network, and every read was one the fake world serves', db, () => {
  assert.deepEqual(blocked, []);
  assert.deepEqual(reads.filter((r) => r.startsWith('unexpected')), [], reads.join(','));
});
