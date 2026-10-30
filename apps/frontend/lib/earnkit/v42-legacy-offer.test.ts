import './fixtures/no-network-checks';
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { padPool } from './fixtures/rank-pool';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { productOdds, productScore, traction } from './match';
import type { RepoFit } from './present';
import { TOKEN_OFFER, TOKEN_OFFER_LEAD, TOKEN_OFFER_QUESTION, stateAsk, type BenchProject } from './bench-reply';
import { TOKEN_ASK_NOTE } from './bench-find';
import { TOKEN_EXPLAINER } from './token-answers';
import { tokenOfferDue } from './wallet-offer';
import { retryDroppedBuilderTokens } from './builder-token';
import { moneyStepDone } from './fixtures/wallet-step';

/**
 * v4.2 Task 6 (F11): a builder who set up before v4 (a proven wallet, no token row, never offered) hears the token offer
 * once: on their next quiet find, or when they ask about their token. A yes launches (tokens.fun faked: nothing real is
 * ever launched); a no is kept; silence is never re-asked. Never during setup, never beside another question, never for an
 * owner test installation.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v42-legacy-offer-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
const DAY = 86_400_000;
after(async () => {
  mock.timers.reset();
  delete process.env.EARNKIT_BUILDER_TOKENS;
  delete process.env.EARNKIT_TEST_INSTALLATIONS;
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const seen = async (id: number) => (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;
const row = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${id}`)[0]?.status ?? null;
const on = async (fn: () => Promise<void>) => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'v42-key';
  try { await fn(); } finally { delete process.env.EARNKIT_BUILDER_TOKENS; delete process.env.EARNKIT_TEST_INSTALLATIONS; }
};

test('the offer copy is exact, the statement then the question last, no em dash or "coin"', () => {
  // v4.4: the opt-out ("already have one, or skip") before the question, which ends the reply.
  assert.equal(TOKEN_OFFER, "One new thing: your token can go live today, so people who believe in your work can back it. 40% of every trade's fee goes to you, claimed for you. If you already have a token or would rather skip it, just say so and I won't ask again.\n\nWant it live?");
  assert.equal(TOKEN_OFFER, `${TOKEN_OFFER_LEAD} ${TOKEN_OFFER_QUESTION}`);
  assert.doesNotMatch(TOKEN_OFFER, /—|coin/i);
});

test('the offer yields to every other ranked question and to setup step 3, and comes before the lighter nudges', () => {
  const project: BenchProject = { key: 'kit/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const v = { state: 'ranked' as const, variant: null, project, link: null, handle: 'kit', tokenOffer: true };
  assert.equal(stateAsk(v).kind, 'token');
  assert.equal(stateAsk(v).project_key, null);
  assert.equal(stateAsk({ ...v, connect: { weeks: 3 } }).kind, 'connect');
  assert.equal(stateAsk({ ...v, apply: { program_id: 'p', title: 'P', amount: null, when: null } }).kind, 'apply');
  assert.equal(stateAsk({ ...v, share: true }).kind, 'share');
  assert.equal(stateAsk({ ...v, walletSetup: { link: 'https://x/w', project: 'Kit' } }).kind, 'wallet_setup');
  assert.equal(stateAsk({ ...v, newRepo: true }).kind, 'token');
  assert.equal(stateAsk({ ...v, tokenOffer: false }).kind, 'ship');
});

/** A signed-in builder whose one project is ranked through the App (pool of 13), with a proven wallet, as one who set up before v4. */
async function legacy(tag: string, o: { wallet?: boolean; applied?: boolean } = {}) {
  const t = `ek_v42lo${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c0 = (await connectInstallation(t))!;
  const handle = `lo${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(c0.own, { id: `97${tag}${RUN}${randomBytes(2).toString('hex')}`, username: handle, name: 'Kit Builder', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `${handle}/kit`.toLowerCase();
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 0, live_ok: false, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: null, created_at: '2025-01-01T00:00:00Z', chains: {}, commits_in_window: {}, product, tx_count: 0, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, verdicts: [] }];
  const commits = [0, 1, 2, 3].map((w) => ({ sha: `c${w}`, message: `Ship feature ${w}`, date: new Date(Date.now() - w * 7 * DAY - DAY).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: 9700 + Number(RUN.slice(-2)) + tag.charCodeAt(0), owner: handle, installation: 97, private: false, commits } });
  const calls: unknown[] = [];
  const fetchFake = (async (_u: string, init?: RequestInit) => {
    calls.push(init?.body);
    return new Response(JSON.stringify({ success: true, tokenAddress: `0x${randomBytes(20).toString('hex')}`, txHash: '0xabc', chainId: 8453 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, codesFetch: gh as typeof fetch,
    matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never, builderTokenDeps: { fetch: fetchFake, check: async () => true },
  } as never as Parameters<typeof mcpCall>[0];
  await mcpCall({ ...ctx, matchProjects: (async () => ({ checked: 0, scored: 0, fits: [] })) as never }, 'find', {});
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  if (o.wallet !== false) await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${c.id}, now())`;
  // v4.7 T3 (token after money): the offer waits for one application; these builders have one unless `applied` is false.
  if (o.applied !== false) await moneyStepDone(c.id);
  return { c, ctx, key, handle, calls };
}
const start = async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);
};
/** Finds until the offer shows (other once-only questions may come first), at most `max` times; returns the reply that carried it. */
async function findOffer(b: Awaited<ReturnType<typeof legacy>>, max = 6): Promise<R | null> {
  for (let i = 0; i < max; i++) {
    const r = await mcpCall(b.ctx, 'find', {});
    if (show(r).includes(TOKEN_OFFER)) return r;
    mock.timers.tick(DAY);
  }
  return null;
}

test('a find shows the offer once, as the one question; a kindless yes launches it with the just-launched copy; silence never re-asks', db, () => on(async () => {
  await start();
  const b = await legacy('y');
  assert.equal(await tokenOfferDue(b.c.id), true);
  const r = await findOffer(b);
  assert.ok(r, 'the offer shows on a later find');
  assert.ok(show(r!).endsWith(TOKEN_OFFER), show(r!));
  assert.deepEqual(r!.reply?.move_up, { kind: 'token', project_key: null, agent_note: TOKEN_ASK_NOTE });
  const s = await seen(b.c.id);
  // Final review 1: showing the offer is not a yes: only token_offer_legacy is kept (token_offered waits for the yes).
  assert.equal(s.token_offered, undefined);
  assert.equal(typeof s.token_offer_legacy, 'string');
  assert.equal((s.bench_ask as { kind: string }).kind, 'token');
  assert.equal(await row(b.c.id), null, 'showing the offer launches nothing');
  assert.equal(await tokenOfferDue(b.c.id), false);
  // A yes with no kind answers the stored ask: it launches, once.
  const yes = show(await mcpCall(b.ctx, 'tell', { move_up: { project_key: null, answer: 'yes' } }));
  assert.match(yes, /^Done\. Your token is live: https:\/\/app\.uniswap\.org\/swap\?chain=base&outputCurrency=0x[0-9a-f]{40}\nIt's on your page too: .+\/lo/);
  assert.equal(b.calls.length, 1);
  assert.equal(await row(b.c.id), 'launched');
  assert.equal(typeof (await seen(b.c.id)).token_offered, 'string', 'the yes marks token_offered');
  // A second yes is the Live copy; no second deploy; later finds never offer again.
  assert.match(show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } })), /^Your token is live: /);
  assert.equal(b.calls.length, 1);
  for (let i = 0; i < 3; i++) { mock.timers.tick(DAY); assert.ok(!show(await mcpCall(b.ctx, 'find', {})).includes(TOKEN_OFFER)); }
}));

test('a no declines for good; silence is never re-asked; a later kindless yes does not reverse the no', db, () => on(async () => {
  await start();
  const no = await legacy('n');
  assert.ok(await findOffer(no));
  const r = show(await mcpCall(no.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'no' } }));
  assert.match(r, /Got it/);
  assert.equal(await row(no.c.id), 'declined');
  for (let i = 0; i < 3; i++) { mock.timers.tick(DAY); assert.ok(!show(await mcpCall(no.ctx, 'find', {})).includes(TOKEN_OFFER)); }
  await mcpCall(no.ctx, 'tell', { move_up: { project_key: null, answer: 'yes' } });
  assert.equal(await row(no.c.id), 'declined');
  assert.equal(no.calls.length, 0);
  // Silence: offered, ignored through more finds: shown once only.
  const quiet = await legacy('q');
  let shown = 0;
  for (let i = 0; i < 8; i++) { if (show(await mcpCall(quiet.ctx, 'find', {})).includes(TOKEN_OFFER)) shown++; mock.timers.tick(DAY); }
  assert.equal(shown, 1);
  assert.equal(await row(quiet.c.id), null);
  assert.equal(quiet.calls.length, 0);
}));

test('never in setup, never off, never for a test installation, never over a token row', db, () => on(async () => {
  await start();
  // Setup step 3 open (no wallet yet): not due; the find shows step 3, not the offer.
  const setup = await legacy('s', { wallet: false });
  assert.equal(await tokenOfferDue(setup.c.id), false);
  assert.ok(!show(await mcpCall(setup.ctx, 'find', {})).includes(TOKEN_OFFER));
  // An owner test installation.
  const test_ = await legacy('t');
  assert.equal(await tokenOfferDue(test_.c.id), true);
  process.env.EARNKIT_TEST_INSTALLATIONS = String(test_.c.id);
  assert.equal(await tokenOfferDue(test_.c.id), false);
  assert.equal(await findOffer(test_, 3), null);
  delete process.env.EARNKIT_TEST_INSTALLATIONS;
  // A token row (even declined).
  const has = await legacy('h');
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${has.c.id}, x_user_id, 'declined' FROM builder_profiles WHERE builder_id = ${has.c.id}`;
  assert.equal(await tokenOfferDue(has.c.id), false);
  // v4.7 T3: no application or draft yet: not due, and no find shows it.
  const early = await legacy('e', { applied: false });
  assert.equal(await tokenOfferDue(early.c.id), false);
  assert.equal(await findOffer(early, 3), null);
  await moneyStepDone(early.c.id);
  assert.equal(await tokenOfferDue(early.c.id), true, 'after the first application');
  // Tokens off.
  const off = await legacy('o');
  delete process.env.EARNKIT_BUILDER_TOKENS;
  assert.equal(await tokenOfferDue(off.c.id), false);
  assert.equal(await findOffer(off, 3), null);
}));

test('asking about the token: the explainer then the offer, once, as the stored ask; a yes launches; a second ask is the explainer alone', db, () => on(async () => {
  await start();
  const b = await legacy('a');
  const ask = await mcpCall(b.ctx, 'tell', { token: 'ask' });
  assert.equal(show(ask), `${TOKEN_EXPLAINER}\n\n${TOKEN_OFFER_QUESTION}`);
  assert.deepEqual(ask.reply?.move_up, { kind: 'token', project_key: null, agent_note: TOKEN_ASK_NOTE });
  assert.equal(((await seen(b.c.id)).bench_ask as { kind: string }).kind, 'token');
  assert.equal(b.calls.length, 0);
  assert.equal(show(await mcpCall(b.ctx, 'tell', { token: 'ask' })), TOKEN_EXPLAINER, 'not re-offered');
  // Final review 2: the explainer alone asks nothing, so the stored ask is cleared: a kindless yes after it launches nothing.
  assert.equal((await seen(b.c.id)).bench_ask, undefined);
  await mcpCall(b.ctx, 'tell', { move_up: { project_key: null, answer: 'yes' } });
  assert.equal(b.calls.length, 0);
  assert.match(show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } })), /^Done\. Your token is live: /);
  assert.equal(b.calls.length, 1);
  // A test installation asking: the explainer alone, nothing stored.
  const t = await legacy('u');
  process.env.EARNKIT_TEST_INSTALLATIONS = String(t.c.id);
  const r = await mcpCall(t.ctx, 'tell', { token: 'ask' });
  assert.equal(show(r), TOKEN_EXPLAINER);
  assert.equal(r.reply?.move_up, undefined);
  assert.equal((await seen(t.c.id)).token_offered, undefined);
}));

test('final review 1: a shown, unanswered legacy offer never launches from the hourly retry; the yes launches once', db, () => on(async () => {
  await start();
  const b = await legacy('c');
  assert.ok(await findOffer(b));
  const deps = { fetch: (b.ctx as unknown as { builderTokenDeps: { fetch: typeof fetch } }).builderTokenDeps.fetch, check: async () => true, only: [b.c.id] };
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await retryDroppedBuilderTokens(new Date(), deps), { tried: 0, launched: 0, blocked: [] });
    mock.timers.tick(DAY);
    await mcpCall(b.ctx, 'find', {});
  }
  assert.equal(b.calls.length, 0, 'zero deploy calls while the offer is unanswered');
  assert.equal(await row(b.c.id), null);
  assert.equal(await tokenOfferDue(b.c.id), false, 'shown once');
  assert.match(show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } })), /^Done\. Your token is live: /);
  assert.equal(b.calls.length, 1);
  assert.deepEqual(await retryDroppedBuilderTokens(new Date(), deps), { tried: 0, launched: 0, blocked: [] });
  assert.equal(b.calls.length, 1);
}));

test('final review 7: a tell with a move_up answer and token ask never carries two questions: the token is a statement, the offer not claimed', db, () => on(async () => {
  await start();
  const b = await legacy('m');
  assert.equal(await tokenOfferDue(b.c.id), true);
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'checkin', project_key: null, answer: 'yes' }, token: 'ask' });
  assert.ok(show(r).includes(TOKEN_EXPLAINER), show(r));
  assert.ok(!show(r).includes(TOKEN_OFFER_QUESTION), show(r));
  assert.notEqual((r.reply?.move_up as { kind?: string } | undefined)?.kind, 'token');
  assert.notEqual(((await seen(b.c.id)).bench_ask as { kind?: string } | undefined)?.kind, 'token');
  assert.equal(await tokenOfferDue(b.c.id), true, 'still due: shown later on its own');
  assert.equal(b.calls.length, 0);
}));
