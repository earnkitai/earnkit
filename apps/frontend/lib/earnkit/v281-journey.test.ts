import './fixtures/no-network-checks';
import { withoutQuotedFacts } from './fixtures/quoted-facts';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { getProgramRow, upsertProgram } from './programs';
import { guideText, programGuide } from './guide';
import { handlers } from './tools';
import { tokenLineFor } from './token-gate';
import { deployToken, LAUNCHING } from './tokens';
import { STILL_CHECKING, TECHNICAL_TERMS, launchReplyMs, type TokenFlowDeps } from './token-launch';
import { CANT_PUSH, NO_WALLET_HINT } from './confirm';
import { GitHubError } from './match-projects';
import { rootOf } from './identity';
import type { FetchResult } from './ownership';

/**
 * v2.8.1 Task 7 (spec Testing): the friction audit's 10 builder journeys (friction-journeys.md), plus
 * the agent switch with its pickup, re-run through the real tools layer as a test. Every real program
 * file; a throwaway database of its own (as v28-journey.test.ts). Mocks: tokens.fun (check-ticker
 * and the deploy API, behind the real deployToken) and GitHub (repo facts, earnkit.txt). Every other
 * fetch gets a 503; the last test asserts only the alerts' soft WETH price read tried one.
 *
 * Asserted across the journeys:
 * - "40%" exactly once per entry flow (first message to "Entered in…"), never on later programs;
 * - the bonus note at most once per reply;
 * - no reply waits on the slow-deploy mock for 50 s (every call is timed);
 * - a builder with a repo is never led with speedrun (an investment program);
 * - Arc never dead-ends for a builder with no repo;
 * - the returning builder's recap shows and entered programs are not offered again;
 * - an agent that can push never hears "open this in Claude Code or Cursor".
 */

const localDb = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
})();
const dbTest = {
  skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres',
};

const PROGRAMS_DIR = join(import.meta.dirname, '../../../../programs');
const SCHEMA = join(import.meta.dirname, '../../db/schema.sql');
const FAR = '2099-01-01T00:00:00Z';
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v281_journey_${process.pid}`;
const savedEnv: Record<string, string | undefined> = {};
const ENV = { TOKENSFUN_DEPLOY_API_KEY: 'v281-journey-key', EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v281-journey-secret' };

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
    process.env[k] = v;
  }
  // Every real program file, as programs:sync loads it; curated programs open with a 2099 deadline
  // so the journeys never depend on real dates (campaign files keep their status).
  for (const f of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, f), 'utf8'));
    if (!raw.campaign) Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
    await upsertProgram(ProgramFile.parse(raw));
  }
});

after(async () => {
  if (!sharedUrl || !localDb) return;
  // The slow deploy finishes in the background; let it record itself before the database goes.
  await Promise.all(pendingDeploys);
  await sql().end();
  globalThis.fetch = realFetch;
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

// ---- Mocks -------------------------------------------------------------------------------------

/** No network: every fetch that reaches the real one gets a 503 and is noted (the mocks never fetch). */
const blocked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    blocked.push(url);
    return new Response('v281-journey: no network', { status: 503 });
  }
  return realFetch(input);
}) as typeof fetch;

/** tokens.fun's check-ticker: these are taken. */
const TAKEN = new Set(['TIPJAR', 'CKB', 'TIPJ2']);
const deployed: string[] = [];
const pendingDeploys: Promise<unknown>[] = [];
/** tokens.fun's deploy API, behind the real deployToken. `delayMs`: the slow-deploy mock. */
const tokensFun = (delayMs = 0) =>
  (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { symbol: string };
    const wait = new Promise((r) => setTimeout(r, delayMs));
    pendingDeploys.push(wait);
    await wait;
    deployed.push(body.symbol);
    const addr = '0x' + String(deployed.length).padStart(40, 'a');
    return new Response(
      JSON.stringify({ success: true, tokenAddress: addr, txHash: '0x' + 'cd'.repeat(32), urls: { tokensfun: `https://tokens.fun/coin/${addr}` } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

/** Every installation made here; the mock earnkit.txt holds each one's line (the agent pushed it). */
const OWNERS = new Set<number>();
/** GitHub's earnkit.txt: a repo named "nopush" never has it. */
const earnkitTxt = async (r: { owner: string; repo: string }): Promise<FetchResult> => {
  if (r.repo.includes('nopush')) return { status: 'missing' };
  const url = `https://github.com/${r.owner}/${r.repo}`;
  return { status: 'ok', text: [...OWNERS].map((id) => tokenLineFor(id, url)).join('\n') + '\n' };
};

type RepoCode = { fork: boolean; hasCommits: boolean; aheadOfParent: number | null };
const goodRepo = async (): Promise<RepoCode> => ({ fork: false, hasCommits: true, aheadOfParent: null });

/** `shared`: a hosted agent's installation (shared_client), as the OAuth token route flags Grok Bot's. */
async function newInstallation(o: { shared?: boolean } = {}) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client)
    VALUES (${`v281-${process.pid}-${Date.now()}-${Math.random()}`}, ${o.shared ?? false}) RETURNING id`;
  OWNERS.add(id);
  return id;
}

function ctxFor(id: number, o: { repo?: (owner: string, repo: string) => Promise<RepoCode>; delayMs?: number } = {}) {
  const tokenDeps: TokenFlowDeps = {
    available: () => true,
    limit: async () => {},
    check: async (symbol) => !TAKEN.has(symbol),
    gate: { repo: o.repo ?? goodRepo, owner: earnkitTxt, latest: async () => null, screen: async () => {} },
    deploy: (a) => deployToken(a, { fetch: tokensFun(o.delayMs), sleep: async () => {} }),
  };
  return {
    installationId: id,
    roundPools: async () => new Map(),
    tokenDeps,
    pickupDeps: { owner: earnkitTxt, latest: async () => null },
    // The entry proof page links the repo (the builder's submitted page).
    entryDeps: { fetchProof: async (u: string) => `<html><a href="https://github.com/alice/tipjar">${u}</a><a href="https://github.com/kim/arcpay">x</a></html>` },
  };
}
type Ctx = ReturnType<typeof ctxFor> & { ownInstallationId?: number; sharedClient?: boolean; matchProjects?: unknown };
/** GitHub matching for a stated GitHub user (never the network). */
const noMatching = { matchProjects: async () => ({ checked: 0, fits: [] }) };

// ---- The recorder ------------------------------------------------------------------------------

type Reply = Record<string, unknown> & { show_to_builder: string; kit?: { show_to_builder?: string; mode?: string } };
type Said = { journey: string; label: string; text: string; ms: number; reply: Reply };
const said: Said[] = [];
const MAX_REPLY_MS = 50_000;

/** One tool call, as the agent makes it; timed, and its builder-facing text kept. */
async function call(journey: string, label: string, tool: keyof typeof handlers, input: unknown, ctx: Ctx): Promise<Reply> {
  const started = Date.now();
  // v2.10 item 2: these journeys read the first reply's tables, which are behind "show more".
  const given = tool === 'list_programs' && input && typeof input === 'object' && !('more' in input) ? { ...input, more: true } : input;
  const reply = (await (handlers[tool] as (i: unknown, c: unknown) => Promise<unknown>)(given, ctx)) as Reply;
  const ms = Date.now() - started;
  const text = [reply.show_to_builder ?? '', reply.kit?.show_to_builder && reply.kit.show_to_builder !== reply.show_to_builder ? reply.kit.show_to_builder : '']
    .filter(Boolean)
    .join('\n');
  said.push({ journey, label, text, ms, reply });
  assert.ok(ms < MAX_REPLY_MS, `${journey} ${label}: replied in ${ms} ms`);
  return reply;
}
const forty = (journey: string) => said.filter((s) => s.journey === journey).reduce((n, s) => n + (s.text.match(/40%/g)?.length ?? 0), 0);
const dump = (journey: string) => said.filter((s) => s.journey === journey).map((s) => `[${s.label}]\n${s.text}`).join('\n\n');

// ---- Drafts ------------------------------------------------------------------------------------

const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
const GROK = { browser: false, can_push: false };
const CC = { browser: true, can_push: true };
const DRAFT: Record<string, string> = {
  description: 'TipJar lets fans tip creators in USDC; 120 creators received 900 tips in the first month.',
  builder_profile: 'https://github.com/alice',
  full_name: 'Alice Doe',
  email: 'alice@example.com',
  x_handle: '@alice',
  telegram: '@alice',
  project_name_description: 'TipJar: tips for creators in USDC.',
  founding_team: 'Alice, solo builder; shipped two payment apps.',
  demo_loom: 'https://loom.com/share/abc',
  contract_address: '0x1111111111111111111111111111111111111111',
  usage_numbers: '120 creators got 900 tips in the first month.',
  revenue: '1% fee on each tip.',
  gtm_plan: 'Recurring tips by March; 500 creators by June.',
  builder_code: 'bc_tipjar',
  primary_challenge: 'User acquisition',
  credits: 'None',
  project_name: 'TipJar',
  one_sentence_description: 'Tips for creators in USDC.',
  requested_amount_usd: '5000',
  summary: 'TipJar lets fans tip creators in USDC on Avalanche C-Chain; 120 creators in month one.',
  milestones: 'M1 recurring tips (Dec 2026); M2 500 creators (Feb 2027).',
  why_grant: 'Live product with 120 users, solo builder shipping weekly.',
  x_profile: '@alice',
  project_url: 'https://tipjar.xyz',
};
/** What the agent drafts plus what the builder answers, for every field of the program's form. */
function answersFor(programId: string, over: Record<string, string> = {}) {
  const p = JSON.parse(readFileSync(join(PROGRAMS_DIR, `${programId}.json`), 'utf8')) as {
    submission_requirements: { key: string; type: string; options?: string[] }[];
  };
  const a: Record<string, string> = {};
  for (const r of p.submission_requirements) {
    if (r.type === 'choice' && r.options) a[r.key] = r.options[0];
    else if (DRAFT[r.key]) a[r.key] = DRAFT[r.key];
  }
  return { ...a, ...over };
}

/**
 * One entry, the way the audit's driver ran it: the pick (the coach's questions), the answers (the
 * draft and the offer), the builder's word on the offer, and "I submitted".
 */
async function entry(o: {
  journey: string;
  ctx: Ctx;
  program: string;
  project: Record<string, string | string[]>;
  agent: typeof CC;
  decision?: 'go' | 'skip';
  /** The wallet the builder gives in the coach round; null: none. */
  wallet?: string | null;
  token?: { name: string; symbol: string };
  answers?: Record<string, string>;
  record?: boolean;
}) {
  const { journey, ctx, program, project, agent } = o;
  const q = await call(journey, `${program} questions`, 'prepare_submission', { program_id: program, project, agent }, ctx);
  const answers = { ...(o.answers ?? answersFor(program)), ...(o.wallet !== null && { payout_wallet: o.wallet ?? W }) };
  const d = (await call(journey, `${program} draft`, 'prepare_submission', { program_id: program, project, agent, answers, coach_asked: true }, ctx)) as Reply & {
    ready: boolean;
    shown_wallet?: string;
  };
  if (!d.ready) return { q, d, answers };
  const wallet = o.wallet === null ? undefined : d.shown_wallet;
  const c = await call(
    journey,
    `${program} ${o.decision ?? 'go'}`,
    'confirm_entry',
    { program_id: program, project, answers, builder_confirmed: true, decision: o.decision ?? 'go', ...(wallet && { wallet }), ...(o.token && { token: o.token }), agent },
    ctx,
  );
  let rec: Reply | null = null;
  if (o.record !== false && c.kit)
    rec = await call(
      journey,
      `${program} record`,
      'record_submission',
      {
        program_id: program,
        project,
        submission_data: answers,
        builder_submitted: true,
        ...((c.kit as { proof?: { kind?: string } }).proof?.kind === 'entry_link' && { external_submission_url: 'https://dorahacks.io/buidl/31337' }),
        ...(wallet && { payout_wallet: wallet }),
      },
      ctx,
    );
  return { q, d, c, rec, answers };
}

const NO_BONUS_NOTE = /no builder bonus:|don't add to it/;
const BONUS_NOTE = /builder bonus (rides|counts|is in)/gi;
const speedrunOffer = /Want me to (start on|build something new for) a16z speedrun/;

// ---- The journeys ------------------------------------------------------------------------------


/** v2.10 item 3: the first prepare for a program starts with its guide; returns what follows it. */
async function afterGuide(programId: string, text: string) {
  const g = guideText(programGuide(await getProgramRow(programId), null));
  assert.ok(text.startsWith(`${g}\n\n`), text);
  return text.slice(g.length + 2);
}

test('J1: no repo, Grok Bot, Arc: never offered, and picking it anyway says so first with a way forward', dbTest, async () => {
  const J = 'J1';
  const ctx = ctxFor(await newInstallation());
  const list = await call(J, 'list', 'list_programs', { agent_can_build: false }, ctx);
  assert.match(list.show_to_builder, /\| Arc Microgrants \(needs a repo\) \|/);
  assert.doesNotMatch(list.show_to_builder, /Want me to start on Arc/);
  assert.doesNotMatch(list.show_to_builder, speedrunOffer);
  const project = { name: 'TipJar', live_url: 'https://tipjar.xyz' };
  const arc = await call(J, 'arc questions', 'prepare_submission', { program_id: 'arc-microgrants', project, agent: GROK }, ctx);
  // The blocker comes with the questions, never only after the builder answered them, and names a
  // program this builder can enter as they are.
  // v2.10 item 3: the first prepare for Arc shows its guide first.
  arc.show_to_builder = await afterGuide('arc-microgrants', arc.show_to_builder);
  assert.match(arc.show_to_builder, /^Arc Microgrants needs a public repo with your project's code\. No repo yet\? (.+) doesn't need one: say the word and I'll start there\.\n\n/);
  const alt = /No repo yet\? (.+) doesn't need one/.exec(arc.show_to_builder)![1];
  // v2.10 Ruling H1 (c1): the lowest difficulty without "needs a live product"; Circle is never named.
  assert.equal(alt, 'Avalanche Team1 Mini Grants');
  // The way forward works: the program named asks its questions (no repo needed).
  const ava = await call(J, 'avalanche questions', 'prepare_submission', { program_id: 'avalanche-team1-mini-grants', project, agent: GROK }, ctx);
  assert.doesNotMatch(ava.show_to_builder, /needs a public repo/);
  assert.ok(Array.isArray(ava.questions) && (ava.questions as unknown[]).length > 0, ava.show_to_builder);
  assert.equal(forty(J), 0, dump(J));
});

test('J2, J3, J7: a repo in Claude Code, Base then Avalanche then Arc, and the next day', dbTest, async () => {
  const J = 'J2';
  const id = await newInstallation();
  const ctx = ctxFor(id);
  const repo = 'https://github.com/alice/tipjar';
  await sql()`
    INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES ('alice/tipjar', now(),
      ${sql().json({ base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' }, avalanche: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' }, arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } })},
      '{}') ON CONFLICT DO NOTHING`;
  const localRepos = [
    {
      name: 'tipjar',
      url: repo,
      chains: [{ chain: 'base', mainnet: true }, { chain: 'avalanche', mainnet: true }, { chain: 'arc', mainnet: true }],
      // v2.9 Pre-flight P22: no live link reported, so the repo stays below product tier and the
      // v2.8.1 first reply (no token offer) and its "40%" placement hold.
      last_commit_at: new Date().toISOString(),
    },
  ];
  const list = await call(J, 'list', 'list_programs', { local_repos: localRepos }, ctx);
  assert.match(list.show_to_builder, /\| a16z speedrun SR008 \|/, 'speedrun shows in the table');
  assert.doesNotMatch(list.show_to_builder, speedrunOffer, 'a builder with a repo is never led with speedrun');
  assert.match(list.show_to_builder, /Want me to start on .+ with tipjar\?/);

  const project = { name: 'TipJar', repo_url: repo, live_url: 'https://tipjar.xyz', contracts: ['0xcccccccccccccccccccccccccccccccccccccccc'] };
  const base = await entry({ journey: J, ctx, program: 'base-builder-grants', project, agent: CC });
  // §C11, §C12: one round asks the wallet, the Loom demo and the Builder Code; the confirmation is a single yes.
  assert.match(base.q.show_to_builder, /the wallet for your token's fees/);
  assert.match(base.q.show_to_builder, /Loom product demo/);
  assert.match(base.q.show_to_builder, /Base Builder Code/);
  assert.equal(base.d.ready, true, base.d.show_to_builder);
  // v2.10 item 5: the one confirm line.
  assert.match(base.d.show_to_builder, /Yes submits your entry and launches \$TIP \(TipJar\): 40% of its fees to you, plus the builder bonus\./);
  assert.equal((base.c!.token as { status: string }).status, 'launched');
  assert.ok(base.rec, 'recorded');
  assert.match(base.rec!.show_to_builder, /^Entered in Base Builder Grant Program\./);
  // §F19: "40%" once in the whole first entry flow: the offer's Yes line.
  assert.equal(forty(J), 1, dump(J));
  assert.deepEqual(said.filter((s) => s.journey === J && /40%/.test(s.text)).map((s) => s.label), ['base-builder-grants draft']);

  // J3: more programs in the same session: no "40%", the bonus note once (Also qualifies), no stubs.
  const J3 = 'J3';
  for (const program of ['avalanche-team1-mini-grants', 'arc-microgrants']) {
    const e = await entry({ journey: J3, ctx, program, project, agent: CC });
    assert.equal(e.d.ready, true, e.d.show_to_builder);
    assert.ok(e.d.show_to_builder.endsWith('Ready to submit?'), e.d.show_to_builder);
    assert.ok(e.rec, `${program} recorded`);
  }
  assert.equal(forty(J3), 0, dump(J3));
  assert.equal(deployed.filter((s) => s === 'TIP').length >= 1, true);

  // J7: the next day, a new session, the agent passes nothing: the recap first, entered programs
  // marked and never offered again, no repeated "no builder bonus" notes, never speedrun.
  const J7 = 'J7';
  await sql()`UPDATE installations SET alerts_checked_at = now() - interval '1 day', programs_checked_at = now() - interval '1 day' WHERE id = ${id}`;
  for (const label of ['next day', 'same day again']) {
    const r = await call(J7, label, 'list_programs', {}, ctx);
    const text = r.show_to_builder;
    assert.match(text, /^Your entries: /m, text);
    for (const t of ['Arc Microgrants', 'Avalanche Team1 Mini Grants', 'Base Builder Grant Program']) {
      assert.match(text, new RegExp(`Your entries: .*${t} \\(TipJar, submitted\\)`), `${t} in the recap`);
      assert.match(text, new RegExp(`\\| ${t} \\(entered\\) \\|`), `${t} marked entered`);
      assert.doesNotMatch(text, new RegExp(`Want me to (start on|build something new for) ${t}`), `${t} not offered again`);
    }
    assert.doesNotMatch(text, speedrunOffer);
    assert.doesNotMatch(text, NO_BONUS_NOTE);
    assert.equal(forty(J7), 0);
  }
});

test('J4: no wallet: one wallet ask in the coach round, one line on "yes", then it launches', dbTest, async () => {
  const J = 'J4';
  const ctx = ctxFor(await newInstallation());
  const project = { name: 'TipJar Pro', repo_url: 'https://github.com/bob/tipjar-nowallet', live_url: 'https://tipjarpro.xyz' };
  await call(J, 'list', 'list_programs', { local_repos: [{ name: 'tipjar-nowallet', url: project.repo_url, chains: [{ chain: 'base', mainnet: true }], live_url: project.live_url }] }, ctx);
  const e = await entry({ journey: J, ctx, program: 'base-builder-grants', project, agent: CC, wallet: null, record: false });
  assert.equal(e.c!.show_to_builder, NO_WALLET_HINT);
  const answers = answersFor('base-builder-grants');
  const go = await call(J, 'go with wallet', 'confirm_entry', { program_id: 'base-builder-grants', project, answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC }, ctx);
  assert.equal((go.token as { status: string }).status, 'launched');
  await call(J, 'record', 'record_submission', { program_id: 'base-builder-grants', project, submission_data: answers, builder_submitted: true, payout_wallet: W }, ctx);
  assert.equal(forty(J), 1, dump(J));
});

test('J5: an edited ticker that is taken: named, and the second offer does not repeat the 40%', dbTest, async () => {
  const J = 'J5';
  const ctx = ctxFor(await newInstallation());
  const project = { name: 'Tip Jar', repo_url: 'https://github.com/carol/tip-jar', live_url: 'https://tj.xyz' };
  const e = await entry({ journey: J, ctx, program: 'base-builder-grants', project, agent: CC, token: { name: 'Tip Jar', symbol: 'TIPJAR' }, record: false });
  assert.match(e.c!.show_to_builder, /^\$TIPJAR is taken\. Yes submits your entry and launches \$TIP \(Tip Jar\)\. /);
  const go = await call(
    J,
    'go',
    'confirm_entry',
    { program_id: 'base-builder-grants', project, answers: e.answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC, token: (e.c!.token as { proposed: object }).proposed },
    ctx,
  );
  assert.equal((go.token as { status: string }).status, 'launched');
  assert.equal(forty(J), 1, dump(J));
});

test('J6: skip the token: the shortest path, "40%" once (the offer)', dbTest, async () => {
  const J = 'J6';
  const ctx = ctxFor(await newInstallation());
  const project = { name: 'Skipper', repo_url: 'https://github.com/dave/skipper', live_url: 'https://skipper.xyz' };
  const e = await entry({ journey: J, ctx, program: 'base-builder-grants', project, agent: CC, decision: 'skip' });
  assert.match(e.c!.show_to_builder, /^No token, no builder bonus\.\n/);
  assert.equal(e.rec!.show_to_builder, 'Entered in Base Builder Grant Program.');
  assert.equal(forty(J), 1, dump(J));
});

test('J8: a repo whose only fit is speedrun: never led with it; its kit says the application continues', dbTest, async () => {
  const J = 'J8';
  const ctx = ctxFor(await newInstallation());
  // J8a: an Ethereum repo (outside the enum) never fails the first message.
  const list = await call(J, 'list', 'list_programs', { local_repos: [{ name: 'ethapp', url: 'https://github.com/erin/ethapp', chains: [{ chain: 'ethereum', mainnet: true }], last_commit_at: new Date().toISOString() }] }, ctx);
  assert.match(list.show_to_builder, /\| a16z speedrun SR008 \|/);
  assert.doesNotMatch(list.show_to_builder, speedrunOffer);
  // J8b: no chains reported.
  const list2 = await call(J, 'list (no chains)', 'list_programs', { local_repos: [{ name: 'ethapp', url: 'https://github.com/erin/ethapp2', chains: [], live_url: 'https://ethapp.xyz' }] }, ctx);
  assert.doesNotMatch(list2.show_to_builder, speedrunOffer);
  // The builder asks for it anyway: the kit says the application continues on a16z's site, and the
  // pre-submit check never puts a link in the email answer.
  const e = await entry({ journey: J, ctx, program: 'a16z-speedrun', project: { name: 'EthApp', repo_url: 'https://github.com/erin/ethapp' }, agent: CC, answers: { email: 'erin@example.com' } });
  assert.match(e.c!.kit!.show_to_builder!, /continues on a16z's site/);
  assert.ok(!((e.d.agent_fixes as { key: string }[] | undefined) ?? []).some((f) => f.key === 'email'), JSON.stringify(e.d.agent_fixes));
  assert.equal(forty(J), 1, dump(J));
});

test('J9: an incomplete entry: the missing items first; confirming anyway shows the offer once', dbTest, async () => {
  const J = 'J9';
  const ctx = ctxFor(await newInstallation());
  const project = { name: 'Half Done', repo_url: 'https://github.com/frank/halfdone' };
  const answers = answersFor('base-builder-grants', { payout_wallet: W });
  delete (answers as Record<string, string>).contract_address;
  delete (answers as Record<string, string>).demo_loom;
  await call(J, 'questions', 'prepare_submission', { program_id: 'base-builder-grants', project, agent: CC }, ctx);
  const d = await call(J, 'draft', 'prepare_submission', { program_id: 'base-builder-grants', project, agent: CC, answers, coach_asked: true }, ctx);
  assert.match(d.show_to_builder, /^Before you submit: /);
  await call(J, 'confirm anyway', 'confirm_entry', { program_id: 'base-builder-grants', project, answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC }, ctx);
  // The offer shows, exactly once (final fix wave, M8: `<= 1` passed with no offer at all).
  assert.equal(forty(J), 1, dump(J));
  assert.equal(said.filter((s) => s.journey === J && /Yes submits your entry and launches \$\w+ \(Half Done\)/.test(s.text)).length, 1, dump(J));
});

test('J10: repo problems at the token gate: plain words, the kit, and never "open this in Claude Code"', dbTest, async () => {
  const cases: { tag: string; repo: string; gate?: (o: string, r: string) => Promise<RepoCode>; reply: RegExp }[] = [
    { tag: 'J10a', repo: 'https://github.com/gina/forked', gate: async () => ({ fork: true, hasCommits: true, aheadOfParent: 0 }), reply: /^The repo is a fork with no new commits/ },
    {
      tag: 'J10b',
      repo: 'https://github.com/henry/secret',
      gate: async () => {
        throw new GitHubError('Repo not found or private: henry/secret');
      },
      reply: /^The repo henry\/secret isn't public on GitHub\./,
    },
    { tag: 'J10d', repo: 'https://github.com/jay/empty', gate: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }), reply: /^The repo has no commits yet\./ },
  ];
  for (const k of cases) {
    const ctx = ctxFor(await newInstallation(), { repo: k.gate });
    const project = { name: 'Thing', repo_url: k.repo, live_url: 'https://thing.xyz' };
    const e = await entry({ journey: k.tag, ctx, program: 'base-builder-grants', project, agent: CC, record: false });
    assert.match(e.c!.show_to_builder, k.reply);
    assert.ok(e.c!.kit, `${k.tag}: never a dead end`);
  }
  // J10c: the proof line not pushed: the launch stays open, never "open this in Claude Code".
  const ctx = ctxFor(await newInstallation());
  const project = { name: 'Nopush', repo_url: 'https://github.com/ivy/nopush-app', live_url: 'https://nopush.xyz' };
  const e = await entry({ journey: 'J10c', ctx, program: 'base-builder-grants', project, agent: CC, record: false });
  const again = await call('J10c', 'go again', 'confirm_entry', { program_id: 'base-builder-grants', project, answers: e.answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC }, ctx);
  assert.match(again.show_to_builder, /^Your entry is saved\. Your token is waiting on a short proof line on your repo's default branch; say go once I've pushed it\./);
  for (const j of ['J10a', 'J10b', 'J10c', 'J10d']) assert.equal(forty(j), 1, dump(j));
});

test('J1c: Grok Bot (a hosted agent) with a repo, then Claude Code: no pickup is offered; Claude Code enters on its own', dbTest, async () => {
  const J = 'J1c';
  const repo = 'https://github.com/kim/arcpay';
  const project = { name: 'ArcPay', repo_url: repo, live_url: 'https://arcpay.xyz', contracts: ['0xcccccccccccccccccccccccccccccccccccccccc'] };
  // Grok Bot is a hosted agent: one registration may serve many builders (shared_client).
  const grokId = await newInstallation({ shared: true });
  const grok: Ctx = { ...ctxFor(grokId), sharedClient: true, ...noMatching };
  const G = 'J1c-grok';
  await call(G, 'grok list', 'list_programs', { agent_can_build: false }, grok);
  const g = await entry({ journey: G, ctx: grok, program: 'arc-microgrants', project, agent: GROK, record: false });
  // An agent that can't push: the one place the "open this in Claude Code" line belongs.
  assert.ok(g.c!.show_to_builder.startsWith(`${CANT_PUSH}\n`), g.c!.show_to_builder);
  // A hosted agent is never offered a pickup, even naming the repo's owner.
  const grokAgain = await call(G, 'grok list (repo)', 'list_programs', { github_user: 'kim', repos: [repo] }, grok);
  assert.doesNotMatch(grokAgain.show_to_builder, /Pick up/);
  assert.ok(!('pick_up' in grokAgain));

  // The builder installs EarnKit in Claude Code: a new installation, the same repo. Final fix wave
  // (C2): the Grok Bot installation is hosted, so it is never offered or linked.
  const ccId = await newInstallation();
  const cc: Ctx = { ...ctxFor(ccId), ownInstallationId: ccId };
  // v2.9 Pre-flight P22: no live link reported, so the repo stays below product tier (no token offer).
  const localRepos = [{ name: 'arcpay', url: repo, chains: [{ chain: 'arc', mainnet: true }] }];
  const first = await call(J, 'cc list', 'list_programs', { local_repos: localRepos }, cc);
  assert.doesNotMatch(first.show_to_builder, /Pick up/);
  assert.ok(!('pick_up' in first), 'no pickup question for the agent');
  const picked = await call(J, 'cc pick up', 'pick_up_entries', { answer: 'yes' }, cc);
  assert.doesNotMatch(picked.show_to_builder, /^Done\./);
  assert.equal(await rootOf(ccId), ccId, 'not linked');
  assert.equal(await rootOf(grokId), grokId);

  // Arc in Claude Code: its own entry, and the repo's one token.
  const e = await entry({ journey: J, ctx: cc, program: 'arc-microgrants', project, agent: CC });
  assert.equal((e.c!.token as { status: string }).status, 'launched', e.c!.show_to_builder);
  const rows = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM projects WHERE repo_url = ${repo} AND token_url IS NOT NULL AND token_url <> 'pending'`;
  assert.equal(rows[0].n, 1, 'one token for the repo');
  assert.equal(forty(J), 1, dump(J));
  assert.equal(forty(G), 0, dump(G));
});

test('J1d: a reinstall picks up only the groups its proof covers; a stranger naming the same GitHub user stays out', dbTest, async () => {
  const J = 'J1d';
  const repo = 'https://github.com/dana/dapp';
  const project = { name: 'Dapp', repo_url: repo, live_url: 'https://dapp.xyz' };
  const localRepos = [{ name: 'dapp', url: repo, chains: [{ chain: 'base', mainnet: true }], live_url: project.live_url }];
  // Dana's first install (Claude Code) enters Base with her repo.
  const danaId = await newInstallation();
  const dana: Ctx = { ...ctxFor(danaId), ownInstallationId: danaId };
  await call('J1d-dana', 'list', 'list_programs', { local_repos: localRepos }, dana);
  await entry({ journey: 'J1d-dana', ctx: dana, program: 'base-builder-grants', project, agent: CC, record: false });
  // A stranger's install claims Dana's GitHub user and enters from another repo.
  const malloryId = await newInstallation();
  const mallory: Ctx = { ...ctxFor(malloryId), ownInstallationId: malloryId, ...noMatching };
  await call('J1d-mallory', 'list', 'list_programs', { github_user: 'dana' }, mallory);
  const [m] = await sql()<{ github_user: string | null }[]>`SELECT github_user FROM installations WHERE id = ${malloryId}`;
  assert.equal(m.github_user?.toLowerCase(), 'dana', 'the stranger matches by GitHub user');
  await entry({
    journey: 'J1d-mallory',
    ctx: mallory,
    program: 'base-builder-grants',
    project: { name: 'Other', repo_url: 'https://github.com/mallory/other', live_url: 'https://other.xyz' },
    agent: CC,
    record: false,
  });

  // Dana reinstalls (Cursor): the offer counts only her entry, and the yes links only her group.
  const freshId = await newInstallation();
  const fresh: Ctx = { ...ctxFor(freshId), ownInstallationId: freshId };
  const first = await call(J, 'list', 'list_programs', { local_repos: localRepos }, fresh);
  assert.match(first.show_to_builder, /^Pick up your earlier entry\?\n/, 'one entry, never the stranger\'s');
  const picked = await call(J, 'pick up', 'pick_up_entries', { answer: 'yes' }, fresh);
  assert.match(picked.show_to_builder, /^Done\./);
  assert.equal(await rootOf(freshId), danaId);
  assert.equal(await rootOf(malloryId), malloryId, 'the stranger is never linked');
  const linked: Ctx = { ...ctxFor(freshId), installationId: danaId, ownInstallationId: freshId };
  const again = await call(J, 'list again', 'list_programs', { local_repos: localRepos }, linked);
  assert.match(again.show_to_builder, /Your entries: Base Builder Grant Program \(Dapp, not submitted yet\)/);
  assert.doesNotMatch(again.show_to_builder, /Other/);
});

test('slow deploy: the reply comes before 50 s ("launching"); the check-back returns the token and the kit', dbTest, async () => {
  const J = 'slow';
  assert.ok(launchReplyMs({}) <= MAX_REPLY_MS, 'the default reply time is inside 50 s');
  const prev = process.env.EARNKIT_LAUNCH_REPLY_MS;
  // The mock deploy takes 2.5 s; the reply time is lowered to 0.5 s so the test doesn't wait 40 s.
  process.env.EARNKIT_LAUNCH_REPLY_MS = '500';
  try {
    const ctx = ctxFor(await newInstallation(), { delayMs: 2_500 });
    const project = { name: 'Slowpoke', repo_url: 'https://github.com/lee/slowpoke', live_url: 'https://slow.xyz' };
    const e = await entry({ journey: J, ctx, program: 'base-builder-grants', project, agent: CC, record: false });
    const first = said.find((s) => s.journey === J && s.label === 'base-builder-grants go')!;
    assert.equal(e.c!.show_to_builder, LAUNCHING);
    assert.ok(first.ms < 2_500, `replied in ${first.ms} ms, before the deploy answered`);
    await Promise.all(pendingDeploys);
    await new Promise((r) => setTimeout(r, 300));
    const back = await call(
      J,
      'check back',
      'confirm_entry',
      { program_id: 'base-builder-grants', project, answers: e.answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC, check_back: true },
      ctx,
    );
    assert.equal((back.token as { status: string }).status, 'launched', back.show_to_builder);
    assert.ok(back.kit);
    assert.equal(forty(J), 1, dump(J));
  } finally {
    if (prev === undefined) delete process.env.EARNKIT_LAUNCH_REPLY_MS;
    else process.env.EARNKIT_LAUNCH_REPLY_MS = prev;
  }
});

test('slow gate reads: the reply comes in time ("still checking"); the launch finishes and the check-back has it', dbTest, async () => {
  const J = 'slow-gate';
  const prev = process.env.EARNKIT_LAUNCH_REPLY_MS;
  // The repo check takes 1.5 s; the reply time is lowered to 0.5 s, so the reply comes before the deploy starts.
  process.env.EARNKIT_LAUNCH_REPLY_MS = '500';
  let gateDone: Promise<unknown> = Promise.resolve();
  const slowRepo = (o: string, r: string) => {
    const p = new Promise<void>((res) => setTimeout(res, 1_500)).then(() => goodRepo());
    gateDone = p;
    pendingDeploys.push(p);
    void o;
    void r;
    return p;
  };
  try {
    const ctx = ctxFor(await newInstallation(), { repo: slowRepo });
    const project = { name: 'Slowgate', repo_url: 'https://github.com/mia/slowgate', live_url: 'https://slowgate.xyz' };
    const e = await entry({ journey: J, ctx, program: 'base-builder-grants', project, agent: CC, record: false });
    const first = said.find((s) => s.journey === J && s.label === 'base-builder-grants go')!;
    assert.ok(first.ms < 1_500, `replied in ${first.ms} ms, before the repo check finished`);
    assert.ok(e.c!.show_to_builder.includes(STILL_CHECKING), e.c!.show_to_builder);
    await gateDone;
    await Promise.all(pendingDeploys);
    await new Promise((r) => setTimeout(r, 300));
    const back = await call(
      J,
      'check back',
      'confirm_entry',
      { program_id: 'base-builder-grants', project, answers: e.answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC, check_back: true },
      ctx,
    );
    assert.equal((back.token as { status: string }).status, 'launched', back.show_to_builder);
    assert.ok(back.kit);
    assert.equal(forty(J), 1, dump(J));
  } finally {
    if (prev === undefined) delete process.env.EARNKIT_LAUNCH_REPLY_MS;
    else process.env.EARNKIT_LAUNCH_REPLY_MS = prev;
  }
});

test('every journey reply: under 50 s, the bonus note at most once, no em dash, no Clanker or vault, never "coin", no tool names', dbTest, () => {
  assert.ok(said.length > 50, `${said.length} replies`);
  const coinWords = (text: string) =>
    text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ')
      .match(/\bcoins?\b/gi) ?? [];
  for (const s of said) {
    const where = `${s.journey} ${s.label}`;
    assert.ok(s.ms < MAX_REPLY_MS, where);
    assert.ok((s.text.match(BONUS_NOTE)?.length ?? 0) <= 1, `${where}: ${s.text}`);
    assert.doesNotMatch(s.text, NO_BONUS_NOTE, where);
    assert.doesNotMatch(JSON.stringify(s.reply), /—/, where);
    assert.doesNotMatch(JSON.stringify(s.reply), /clanker/i, where);
    // Ruling H10 (I2): the ban is EarnKit's wording; a program's quoted focus areas may say vaults.
    assert.doesNotMatch(withoutQuotedFacts(s.text), /\bvaults?\b/i, where);
    assert.deepEqual(coinWords(s.text), [], where);
    assert.doesNotMatch(s.reply.show_to_builder ?? '', TECHNICAL_TERMS, where);
    // An agent that can push never hears the line meant for one that can't.
    if (s.journey !== 'J1' && s.journey !== 'J1c-grok') assert.ok(!s.text.includes(CANT_PUSH), where);
  }
  assert.ok(said.some((s) => s.journey === 'J1c-grok' && s.text.includes(CANT_PUSH)), 'the Grok side does carry it');
  // Nothing tried the network but the alerts' fee figure (a best-effort WETH price read that fails
  // soft and is cached; a "[fees]" log line).
  assert.deepEqual(blocked.filter((u) => !u.startsWith('https://coins.llama.fi/')), []);
});
