import './fixtures/no-network-checks';
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
import { deployToken } from './tokens';
import { type TokenFlowDeps } from './token-launch';
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
  const g = guideText(programGuide(await getProgramRow(programId)));
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
