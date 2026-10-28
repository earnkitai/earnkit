import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { mcpCall, mcpListTools } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { humanStrings, humanTextFiles } from './human-text';
import { COACH_NOTES, tools } from './tools';
import { TOKEN_ON_ITS_WAY } from './bench-find';
import { TOKEN_EXPLAINER, TOKEN_OFF } from './token-answers';
import { NOTED_LINE } from './stand-text';
import { randomBytes } from 'node:crypto';

/**
 * v4.0 Task 11 (docs/design-docs-and-implementation-plans/v4-builder-tokens.md, Build E2): the per-project coin offers
 * are retired. Builder tokens (one per builder, at setup step 3) replaced them. (a) no builder-facing string says
 * "coin"; (b) an old agent's `tell coin` is answered with the builder token (a no is the builder token's no); (c) the
 * tools expose no `confirm` (the project coin launch).
 */
/** The wallet link (setup step 3) is signed. */
process.env.EARNKIT_AUTH_SECRET ??= 'v4-retire-test-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');

/** The word itself, never part of an identifier (coin_address, coin_backers, --ek-s-coin-ring). */
const COIN = /(?<![\w-])coins?(?![\w-])/i;
/** Not builder text: a SQL statement or fragment, a log tag. */
const notCopy = (s: string) => /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|JOIN|COALESCE|GROUP BY|IS NULL)\b/.test(s) || /^\s*\[[\w -]+\]/.test(s);

test('(a) no reply or page string says "coin": every string literal and JSX text under lib/earnkit and app', () => {
  const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
  const files = humanTextFiles(ROOT).filter((f) => /^apps\/frontend\/(lib\/earnkit|app)\/.*\.tsx?$/.test(f));
  assert.ok(files.length > 100, `the scan found the sources (${files.length})`);
  const hits: string[] = [];
  for (const f of files)
    for (const { text, line } of humanStrings(f, readFileSync(join(ROOT, f), 'utf8')))
      if (/\s/.test(text.trim()) && COIN.test(text) && !notCopy(text)) hits.push(`${f}:${line}: ${text.trim().slice(0, 120)}`);
  assert.deepEqual(hits, []);
  // The retired modules are gone.
  for (const f of ['coin-moments.ts', 'token-offers.ts', 'raising.ts']) assert.equal(existsSync(join(import.meta.dirname, f)), false, f);
});

let n = 0;
/** A signed-in builder (an X account, so a builder token can be kept for them). */
async function signedIn(tag: string) {
  n++;
  const t = `ek_v4r_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const own = (await connectInstallation(t))!.own;
  const handle = `v4r${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `95${RUN}${n}${tag.length}`, username: handle, name: 'v4r', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  return { ctx, id: c.id };
}
const tokenRow = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${id}`)[0]?.status ?? null;

/** tokens.fun faked: every deploy call counted, a launched answer; tickers always free. */
const fakeTokensFun = () => {
  const calls: unknown[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    calls.push(init?.body);
    return new Response(JSON.stringify({ success: true, tokenAddress: `0x${randomBytes(20).toString('hex')}`, txHash: '0xabc', chainId: 8453 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, deps: { fetch: f, check: async () => true } };
};
/** Tokens on and a tokens.fun key, so any launch that runs reaches the (faked) deploy call. */
async function launchesOn(fn: () => Promise<void>) {
  const prev = { on: process.env.EARNKIT_BUILDER_TOKENS, key: process.env.TOKENSFUN_DEPLOY_API_KEY };
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'v4-retire-key';
  try {
    await fn();
  } finally {
    if (prev.on === undefined) delete process.env.EARNKIT_BUILDER_TOKENS; else process.env.EARNKIT_BUILDER_TOKENS = prev.on;
    if (prev.key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY; else process.env.TOKENSFUN_DEPLOY_API_KEY = prev.key;
  }
}
/** A signed-in builder with a proven reward wallet (a launch would reach tokens.fun), tokens.fun faked. */
async function withWallet(tag: string) {
  const p = await signedIn(tag);
  const tf = fakeTokensFun();
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${p.id}, now())`;
  return { ...p, tf, ctx: { ...(p.ctx as object), builderTokenDeps: tf.deps } as never as Parameters<typeof mcpCall>[0] };
}
const setRow = (id: number, status: string) =>
  sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${id}, x_user_id, ${status} FROM builder_profiles WHERE builder_id = ${id}`;
/** The Bench's stored token offer (what the v4.0 'ask' used to store; Task 6 stores it again). */
const storeTokenAsk = (id: number) =>
  sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"token","key":null}}'::jsonb WHERE builder_id = ${id}`;
const LIVE = /^Done\. Your token is live: https:\/\/app\.uniswap\.org\/swap\?chain=base&outputCurrency=0x[0-9a-f]{40}/;
const storedAsk = async (id: number) => (await sql()<{ k: string | null }[]>`SELECT standing_seen->'bench_ask'->>'kind' AS k FROM builder_profiles WHERE builder_id = ${id}`)[0]?.k ?? null;

test('(b) an old agent\'s tell coin no is the builder token\'s no only after the token offer; a later "launch my token" reopens it', db, () => launchesOn(async () => {
  // No stored token offer: an old coin no changes nothing ("Okay.").
  const a = await signedIn('a');
  const bare = await mcpCall(a.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'no' } });
  assert.equal(bare.isError, false, bare.text);
  assert.equal(show(bare), NOTED_LINE);
  assert.equal(await tokenRow(a.id), null);
  // After the builder token offer (tell token 'ask' stores it), an old coin no is the builder token's no.
  const p = await signedIn('n');
  await storeTokenAsk(p.id);
  assert.equal(await storedAsk(p.id), 'token');
  const no = await mcpCall(p.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'no' } });
  assert.equal(no.isError, false, no.text);
  assert.equal(await tokenRow(p.id), 'declined');
  assert.doesNotMatch(show(no), COIN);
  // v4.2: declined, a question about it gets the off line; the builder's own "launch my token" reopens it (no wallet
  // yet: the wallet link, and the first sign launches it).
  assert.equal(show(await mcpCall(p.ctx, 'tell', { token: 'ask' })), TOKEN_OFF);
  assert.equal(await tokenRow(p.id), 'declined');
  const launch = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } }));
  assert.match(launch, /claim\/wallet/);
  assert.equal(await tokenRow(p.id), null);
  // An old backing switch changes nothing and says nothing about a coin.
  const raising = await mcpCall(p.ctx, 'tell', { coin: { raising: true } });
  assert.equal(raising.isError, false, raising.text);
  assert.doesNotMatch(show(raising), COIN);
  // A token already on its way is unchanged by an old coin no after the offer.
  const q = await signedIn('q');
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"token","key":null}}'::jsonb WHERE builder_id = ${q.id}`;
  await setRow(q.id, 'launching');
  assert.equal(show(await mcpCall(q.ctx, 'tell', { coin: { project_key: 'x/y', answer: 'no' } })), TOKEN_ON_ITS_WAY);
  assert.equal(await tokenRow(q.id), 'launching');
}));

test('(d) fix round 1: tell token \'ask\' only answers the token\'s status; it never launches one, in any state', db, () => launchesOn(async () => {
  // Each existing row: its status, no call to tokens.fun, the row unchanged.
  for (const [status, line] of [['launched', /^Your token is live: https:/], ['declined', /^Your token is off\. Want it on\? Say launch my token\.$/], ['launching', new RegExp(`^${TOKEN_ON_ITS_WAY}$`)], ['unknown', new RegExp(`^${TOKEN_ON_ITS_WAY}$`)]] as const) {
    const b = await withWallet(`d${status.slice(0, 3)}`);
    await setRow(b.id, status);
    if (status === 'launched') await sql()`UPDATE builder_tokens SET coin_address = ${`0x${'ab'.repeat(20)}`}, symbol = 'ABC', wallet = ${`0x${'cd'.repeat(20)}`} WHERE builder_id = ${b.id}`;
    const r = await mcpCall(b.ctx, 'tell', { token: 'ask' });
    assert.equal(r.isError, false, r.text);
    assert.match(show(r), line, status);
    assert.equal(b.tf.calls.length, 0, status);
    assert.equal(await tokenRow(b.id), status);
  }
  // No token, a wallet proven (step 3 not due; v4.2 Task 6: an earlier builder, never offered): the explainer and the
  // one-time offer question, stored as the ask; nothing launched until the builder's yes.
  const b = await withWallet('dnone');
  const r = await mcpCall(b.ctx, 'tell', { token: 'ask' });
  assert.equal(show(r), `${TOKEN_EXPLAINER}\n\nWant it live? Rather skip it? Just say no.`);
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'token');
  assert.equal(b.tf.calls.length, 0);
  assert.equal(await tokenRow(b.id), null);
  assert.equal(await storedAsk(b.id), 'token');
  assert.doesNotMatch(show(r), COIN);
  // The builder's own yes (move_up kind token, or kindless after a stored offer) launches it.
  await storeTokenAsk(b.id);
  const yes = await mcpCall(b.ctx, 'tell', { move_up: { project_key: null, answer: 'yes' } });
  assert.match(show(yes), LIVE, yes.text);
  assert.equal(b.tf.calls.length, 1);
  assert.equal(await tokenRow(b.id), 'launched');
  // No token and setup step 3 due (GitHub no, no wallet yet): step 3's reply, no launch.
  const s = await signedIn('dstep');
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"github_no":"2026-10-01T00:00:00Z"}'::jsonb WHERE builder_id = ${s.id}`;
  const step = await mcpCall(s.ctx, 'tell', { token: 'ask' });
  assert.match(show(step), /\*\*Step 3 of 3:\*\*/, step.text);
  assert.equal(await storedAsk(s.id), 'wallet_setup');
  assert.equal(await tokenRow(s.id), null);
}));

test('(e) fix round 1: an old coin yes (tell coin, or move_up kind coin) launches only after the builder token offer', db, () => launchesOn(async () => {
  // No stored ask: "Okay.", no call, no row.
  const a = await withWallet('ea');
  for (const input of [{ coin: { project_key: 'someone/app', answer: 'yes' } }, { move_up: { kind: 'coin', project_key: null, answer: 'yes' } }]) {
    const r = await mcpCall(a.ctx, 'tell', input);
    assert.equal(r.isError, false, r.text);
    assert.equal(show(r), NOTED_LINE, JSON.stringify(input));
  }
  assert.equal(a.tf.calls.length, 0);
  assert.equal(await tokenRow(a.id), null);
  // Another stored ask (not the token's): still nothing.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"next_step","key":null}}'::jsonb WHERE builder_id = ${a.id}`;
  assert.equal(show(await mcpCall(a.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'yes' } })), NOTED_LINE);
  assert.equal(a.tf.calls.length, 0);
  // The token offer stored (tell token 'ask'): the old coin yes launches it.
  const b = await withWallet('eb');
  await storeTokenAsk(b.id);
  assert.equal(b.tf.calls.length, 0);
  assert.match(show(await mcpCall(b.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'yes' } })), LIVE);
  assert.equal(b.tf.calls.length, 1);
  assert.equal(await tokenRow(b.id), 'launched');
  // move_up kind coin after the offer: the same.
  const c = await withWallet('ec');
  await storeTokenAsk(c.id);
  assert.match(show(await mcpCall(c.ctx, 'tell', { move_up: { kind: 'coin', project_key: null, answer: 'yes' } })), LIVE);
  assert.equal(c.tf.calls.length, 1);
  // Setup step 3 with the token sentence (wallet_setup and token_offered): an old coin no is the token's no.
  const d = await withWallet('ed');
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"wallet_setup","key":null},"token_offered":"2026-10-01T00:00:00Z"}'::jsonb WHERE builder_id = ${d.id}`;
  await mcpCall(d.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'no' } });
  assert.equal(await tokenRow(d.id), 'declined');
  assert.equal(d.tf.calls.length, 0);
  // Step 3 without the token sentence: an old coin no is nothing.
  const e = await withWallet('ee');
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"wallet_setup","key":null}}'::jsonb WHERE builder_id = ${e.id}`;
  assert.equal(show(await mcpCall(e.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'no' } })), NOTED_LINE);
  assert.equal(await tokenRow(e.id), null);
}));

test('(c) the tools expose no confirm (the project coin launch), with or without the old EARNKIT_RAISING', db, async () => {
  assert.equal(Object.hasOwn(tools, 'confirm'), false);
  const prev = process.env.EARNKIT_RAISING;
  try {
    for (const v of ['on', undefined]) {
      if (v === undefined) delete process.env.EARNKIT_RAISING;
      else process.env.EARNKIT_RAISING = v;
      const p = await signedIn(`c${v ?? ''}`);
      const names = (await mcpListTools(p.ctx)).map((t) => t.name);
      assert.ok(names.includes('find') && names.includes('tell'), names.join());
      assert.equal(names.includes('confirm'), false, names.join());
      // No tool text names a coin: the descriptions, and the tell field old agents still send is undocumented ((b)).
      const texts: string[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'description' && typeof x === 'string' ? texts.push(x) : walk(x);
      };
      walk(await mcpListTools(p.ctx));
      assert.ok(texts.length > 20, `${texts.length} descriptions`);
      for (const t of texts) assert.doesNotMatch(t, COIN, t);
    }
  } finally {
    if (prev === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = prev;
  }
});

test('(f) fix round 1: no agent note asks about the retired offer (no token line in how_to_submit, no wallet-answer coach note)', () => {
  assert.equal(Object.hasOwn(COACH_NOTES, 'WALLET_ANSWER_NOTE'), false);
  const src = readFileSync(join(import.meta.dirname, 'tools.ts'), 'utf8');
  assert.doesNotMatch(src, /together with the token line/);
  assert.doesNotMatch(src, /When they say yes to the offer, pass shown_wallet/);
});
