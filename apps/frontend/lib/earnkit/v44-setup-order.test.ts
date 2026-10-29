import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { appEnv, installApp } from './fixtures/app-install';
import { fakeGitHub } from './fixtures/fake-github';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { TOKEN_OFFER, TOKEN_OFFER_LEAD, setupDoneLead, setupTokenOffer, walletSetupAsk } from './bench-reply';
import { tokenOfferDue } from './wallet-offer';
import { walletLink, walletMessage, walletPost } from './wallet-proof';
import { tradeUrl } from './builder-token';
import type { ReaderDeps } from './source-readers';
import { shortWallet } from './entry-text';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v4.4 Task 1 (docs/design-docs-and-implementation-plans/v4.4-plan.md): setup step 3 asks for the wallet only (never sets
 * token_offered, so the proof launches nothing); the one token offer follows the step-3 sign, and its answer is the
 * setup-done reply. Builders shown v4.0's token sentence keep their launch. tokens.fun is faked.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v44-setup-order-secret';
process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
type Ctx = Parameters<typeof mcpCall>[0];
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const kindOf = (r: R) => (r.reply?.move_up as { kind?: string } | undefined)?.kind;
const hex = (k: number) => randomBytes(k).toString('hex');
const ROLLING = 'base-builder-grants';
const OPEN = "Here's what's open for you right now:";
const L = 'https://earnkit.com/claim/wallet?t=1.2.x';

// ---- (a) the copy, word for word

test('(a) step 3, the setup offer and the ranked offer, word for word', () => {
  assert.equal(walletSetupAsk('MealMate', L),
    `MealMate is connected. One last step.\n\n**Step 3 of 3:** add your wallet. It's where grant money and builder campaign payouts get paid. One signature, no fee: ${L}\n\nDone?`);
  assert.equal(walletSetupAsk(null, L),
    `One last step.\n\n**Step 3 of 3:** add your wallet. It's where grant money and builder campaign payouts get paid. One signature, no fee: ${L}\n\nDone?`);
  assert.equal(setupTokenOffer('0x12ab…cd34'),
    "Done. Your payouts go to 0x12ab…cd34.\n\nOne optional thing: your own token, so people who believe in your work can back it. 40% of every trade's fee goes to you, claimed for you. If you already have a token or would rather skip it, just say so and I won't ask again.\n\nWant it live?");
  assert.equal(TOKEN_OFFER,
    "One new thing: your token can go live today, so people who believe in your work can back it. 40% of every trade's fee goes to you, claimed for you. If you already have a token or would rather skip it, just say so and I won't ask again.\n\nWant it live?");
  assert.equal(setupDoneLead('Maya', 'existing'), `You're all set, Maya.\n\n${OPEN}`);
  for (const s of [walletSetupAsk('MealMate', L), walletSetupAsk(null, L), setupTokenOffer('0x12ab…cd34'), TOKEN_OFFER]) {
    assert.doesNotMatch(s, /coin|points|—|\p{Extended_Pictographic}/u, s);
    // Exactly one question, the last line.
    assert.equal((s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, 1, s);
    assert.match(s.split('\n').at(-1)!, /\?$/, s);
  }
  assert.doesNotMatch(walletSetupAsk('MealMate', L), /token/i);
});

// ---- the flows

const fakeTokensFun = () => {
  const calls: Record<string, unknown>[] = [];
  const coin = `0x${hex(20)}`;
  const f = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ success: true, tokenAddress: coin, txHash: '0xabc', chainId: 8453 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { coin, calls, deps: { fetch: f, check: async () => true } };
};
function repoFits(key: string): RepoFit[] {
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  return [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: [{ program_id: ROLLING, program: ROLLING, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }],
  }];
}
/** The score refresh's readers, faked offline and quiet: every read answers empty (no network, nothing logged). */
const quietReader: ReaderDeps = {
  gh: async <T>() => [] as T, ghGraphql: async <T>() => ({}) as T, probe: async () => ({ status: 404 }), fetchText: async () => '', json: async <T>() => ({}) as T,
  contractOrigin: async () => ({}) as never, walletCreations: async () => [], now: new Date(), ghSpent: () => false,
};
let n = 0;
/** A ranked builder "Maya Lin" (the Kit repo proven by the App, fitting Base Builder Grants), shown step 3. */
async function fitted(tag: string) {
  n++;
  const t = `ek_v44_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `v44${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `91${RUN}${n}${tag.length}`, username: handle, name: 'Maya Lin', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `${handle}/kit`;
  const tf = fakeTokensFun();
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits: repoFits(key) })) as never,
    tokenDeps: { check: async () => true }, builderTokenDeps: tf.deps, readerDeps: quietReader,
  } as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 50_000 + Math.floor(Math.random() * 40_000);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  (ctx as { codesFetch?: typeof fetch }).codesFetch = gh as typeof fetch;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  const r = await mcpCall(ctx, 'find', {});
  const step = show(r);
  assert.match(step, /\*\*Step 3 of 3:\*\* add your wallet\./, step);
  assert.equal(kindOf(r), 'wallet_setup', step);
  return { ctx, id: c.id, own: c.own, key, handle, tf, step };
}
type B = Awaited<ReturnType<typeof fitted>>;
const tokenRow = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${id}`)[0]?.status ?? null;
const seen = async (id: number) => (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;
/** The launch runs beside the proof's answer (never awaited there): wait for its row to settle (or a second to pass). */
async function settled(id: number): Promise<string | null> {
  for (let i = 0; i < 50; i++) {
    const s = await tokenRow(id);
    if (s !== null && s !== 'launching') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  return tokenRow(id);
}
/** Signs the reply's wallet link on the page (fake verify, no discovery, tokens.fun faked); returns the wallet. */
async function signOn(b: B, s: string): Promise<string> {
  const t = decodeURIComponent(/https:\/\/earnkit\.com\/claim\/wallet\?t=(\S+)/.exec(s)![1]);
  const acct = privateKeyToAccount(generatePrivateKey());
  const signature = await acct.signMessage({ message: walletMessage(b.handle, t) });
  const res = await walletPost(
    new Request('https://earnkit.com/claim/wallet', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com' }, body: JSON.stringify({ t, wallet: acct.address, signature }) }),
    { limit: async () => {}, verify: (a) => verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` }), discover: async () => {}, builderToken: b.tf.deps },
  );
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 100));
  return acct.address;
}
/** Step 3 shown, signed on the page, and the agent's "done": the setup offer. */
async function offered(tag: string) {
  const b = await fitted(tag);
  const wallet = await signOn(b, b.step);
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'yes' } });
  return { ...b, wallet, r };
}

test('(b) step 3 has no token and never sets token_offered; the sign launches nothing; "done" is the setup offer, not setup done', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('b');
  assert.doesNotMatch(b.step, /token/i, b.step);
  assert.equal((await seen(b.id)).token_offered, undefined);
  const wallet = await signOn(b, b.step);
  assert.equal(await tokenRow(b.id), null);
  assert.equal(b.tf.calls.length, 0);
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'yes' } });
  const s = show(r);
  assert.equal(s, setupTokenOffer(shortWallet(wallet.toLowerCase())));
  assert.ok(s.endsWith('Want it live?'), s);
  assert.doesNotMatch(s, /You're all set|\| Program \|/, s);
  assert.equal(kindOf(r), 'token');
  const ask = (await seen(b.id)).bench_ask as { kind: string; key: string | null; setup?: boolean };
  assert.equal(ask.kind, 'token');
  assert.equal(ask.key, null);
  assert.equal(ask.setup, true);
});

test('(c) a yes to the setup offer launches through the fake and is the setup-done reply with the trade link', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await offered('c');
  assert.equal(kindOf(b.r), 'token');
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } });
  const s = show(r);
  assert.equal(b.tf.calls.length, 1);
  assert.equal(await tokenRow(b.id), 'launched');
  assert.ok(s.startsWith(`You're all set, Maya. Your token is live, so your community can back what you're building: ${tradeUrl(b.tf.coin)}\n\n${OPEN}`), s);
  assert.match(s, /\| Program \| Up to \| Closes \|/, s);
  assert.doesNotMatch(s, /Want it live\?/, s);
  // Said once.
  assert.doesNotMatch(show(await mcpCall(b.ctx, 'find', {})), /You're all set|Want it live\?/);
});

test('(d) a no to the setup offer is "No problem, no token." setup done; the offer never comes back (row declined)', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await offered('d');
  const s = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'no' } }));
  assert.ok(s.startsWith(`No problem, no token. ${OPEN}`), s);
  assert.equal(await tokenRow(b.id), 'declined');
  assert.equal(await tokenOfferDue(b.id), false);
  for (let i = 0; i < 4; i++) {
    const f = show(await mcpCall(b.ctx, 'find', {}));
    assert.ok(!f.includes(TOKEN_OFFER_LEAD) && !f.includes('Want it live?'), f);
  }
  assert.equal(b.tf.calls.length, 0);
});

test('(e) tokens off: the step-3 sign goes straight to the setup-done reply, no offer', db, async () => {
  try {
    process.env.EARNKIT_BUILDER_TOKENS = 'off';
    const b = await fitted('e');
    await signOn(b, b.step);
    const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'yes' } });
    const s = show(r);
    assert.ok(s.startsWith(`You're all set, Maya.\n\n${OPEN}`), s);
    assert.doesNotMatch(s, /token|Want it live\?/i, s);
    assert.equal(kindOf(r), 'apply');
    assert.equal(await tokenRow(b.id), null);
  } finally {
    process.env.EARNKIT_BUILDER_TOKENS = 'on';
  }
});

test('(e) an owner test installation never gets the setup offer', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const before = process.env.EARNKIT_TEST_INSTALLATIONS;
  const b = await fitted('ot');
  try {
    process.env.EARNKIT_TEST_INSTALLATIONS = String(b.own);
    await signOn(b, b.step);
    const s = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'yes' } }));
    assert.ok(s.startsWith(`You're all set, Maya.\n\n${OPEN}`), s);
    assert.equal(b.tf.calls.length, 0);
  } finally {
    if (before === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = before;
  }
});

test('(f) Review Focus 1: a builder shown v4.0\'s token sentence (token_offered) still launches on the sign; no second offer', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('f');
  // As v4.0's step 3 left it: the token sentence shown with the wallet ask.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('token_offered', now()::text) WHERE builder_id = ${b.id}`;
  await signOn(b, b.step);
  assert.equal(await settled(b.id), 'launched');
  assert.equal(b.tf.calls.length, 1);
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'yes' } });
  const s = show(r);
  assert.ok(s.startsWith(`You're all set, Maya. Your token is live, so your community can back what you're building: ${tradeUrl(b.tf.coin)}`), s);
  assert.doesNotMatch(s, /Want it live\?|One optional thing/, s);
  assert.equal(b.tf.calls.length, 1);
});

test('(f) a builder mid v4.0 step 3: a plain no is still the token\'s no (the wallet step stays open)', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('fn');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('token_offered', now()::text) WHERE builder_id = ${b.id}`;
  const s = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet_setup', project_key: b.key, answer: 'no' } }));
  assert.ok(s.startsWith('No problem, no token.'), s);
  assert.equal(await tokenRow(b.id), 'declined');
  // A v4.4 builder's no is the wallet skip.
  const v = await fitted('fs');
  const skip = show(await mcpCall(v.ctx, 'tell', { move_up: { kind: 'wallet_setup', project_key: v.key, answer: 'no' } }));
  assert.ok(skip.startsWith("No worries, add it whenever you're ready."), skip);
  assert.equal(await tokenRow(v.id), null);
});

test('(g) Review Focus 2: a step-3 skip shows no offer; a wallet proven later gets the ranked offer once', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('g');
  const skip = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'no' } }));
  assert.ok(skip.startsWith("No worries, add it whenever you're ready."), skip);
  assert.doesNotMatch(skip, /token|Want it live\?/i, skip);
  assert.equal(await tokenOfferDue(b.id), false);
  // A wallet added later (the change link): its "done" is the wallet's line, never the setup offer.
  const change = walletLink(b.id, new Date())!;
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('wallet_link_at', now()::text) WHERE builder_id = ${b.id}`;
  await signOn(b, change);
  const done = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'yes' } }));
  assert.match(done, /^Done\. Your rewards now go to /, done);
  assert.doesNotMatch(done, /One optional thing|Want it live\?/, done);
  assert.equal(await tokenOfferDue(b.id), true);
  // Then the ranked offer, once, in a quiet reply.
  const replies: string[] = [];
  for (let i = 0; i < 6; i++) replies.push(show(await mcpCall(b.ctx, 'find', {})));
  assert.equal(replies.filter((s) => s.includes(TOKEN_OFFER)).length, 1, replies.join('\n----\n'));
  assert.equal(await tokenOfferDue(b.id), false);
  assert.equal(b.tf.calls.length, 0);
});

test('(h) Review Focus 5: a kindless yes after the setup offer launches it and is the setup-done reply', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await offered('h');
  assert.equal(kindOf(b.r), 'token');
  const s = show(await mcpCall(b.ctx, 'tell', { move_up: { project_key: null, answer: 'yes' } }));
  assert.equal(b.tf.calls.length, 1);
  assert.ok(s.startsWith(`You're all set, Maya. Your token is live, so your community can back what you're building: ${tradeUrl(b.tf.coin)}\n\n${OPEN}`), s);
  assert.match(s, /\| Program \| Up to \| Closes \|/, s);
  // The token ask is answered: the stored ask is now setup done's (apply), never the token offer.
  assert.notEqual((await seen(b.id)).bench_ask && ((await seen(b.id)).bench_ask as { kind: string }).kind, 'token');
  assert.doesNotMatch(show(await mcpCall(b.ctx, 'find', {})), /You're all set|Want it live\?/);
  assert.equal(b.tf.calls.length, 1);
});

test('(h) a kindless no after the setup offer declines it and is the setup-done reply', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await offered('hn');
  const s = show(await mcpCall(b.ctx, 'tell', { move_up: { project_key: null, answer: 'no' } }));
  assert.ok(s.startsWith(`No problem, no token. ${OPEN}`), s);
  assert.match(s, /\| Program \| Up to \| Closes \|/, s);
  assert.equal(await tokenRow(b.id), 'declined');
  assert.notEqual(((await seen(b.id)).bench_ask as { kind?: string } | undefined)?.kind, 'token');
  assert.doesNotMatch(show(await mcpCall(b.ctx, 'find', {})), /No problem, no token|Want it live\?/);
  assert.equal(b.tf.calls.length, 0);
});

test('fix round 1 (B): signed on the page, then find (no tell): the same setup offer; its yes is the setup-done reply', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('fb');
  const wallet = await signOn(b, b.step);
  const r = await mcpCall(b.ctx, 'find', {});
  assert.equal(show(r), setupTokenOffer(shortWallet(wallet.toLowerCase())));
  assert.equal(kindOf(r), 'token');
  const ask = (await seen(b.id)).bench_ask as { kind: string; setup?: boolean };
  assert.equal(ask.kind, 'token');
  assert.equal(ask.setup, true);
  assert.equal(b.tf.calls.length, 0);
  const yes = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } }));
  assert.equal(b.tf.calls.length, 1);
  assert.ok(yes.startsWith(`You're all set, Maya. Your token is live, so your community can back what you're building: ${tradeUrl(b.tf.coin)}\n\n${OPEN}`), yes);
  assert.doesNotMatch(show(await mcpCall(b.ctx, 'find', {})), /You're all set|Want it live\?/);
});

test('fix round 1 (B): tokens off, signed on the page, then find: setup done directly', db, async () => {
  try {
    process.env.EARNKIT_BUILDER_TOKENS = 'off';
    const b = await fitted('fo');
    await signOn(b, b.step);
    const r = await mcpCall(b.ctx, 'find', {});
    assert.ok(show(r).startsWith(`You're all set, Maya.\n\n${OPEN}`), show(r));
    assert.equal(kindOf(r), 'apply');
  } finally {
    process.env.EARNKIT_BUILDER_TOKENS = 'on';
  }
});

test('fix round 1 (C): a find between the setup offer and its answer is setup done; the offer counts as shown and never repeats', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await offered('fc');
  assert.equal(kindOf(b.r), 'token');
  const f = await mcpCall(b.ctx, 'find', {});
  assert.ok(show(f).startsWith(`You're all set, Maya.\n\n${OPEN}`), show(f));
  assert.equal(kindOf(f), 'apply');
  assert.equal(await tokenOfferDue(b.id), false);
  for (let i = 0; i < 4; i++) {
    const s = show(await mcpCall(b.ctx, 'find', {}));
    assert.ok(!s.includes('Want it live?') && !s.includes("You're all set"), s);
  }
  assert.equal(b.tf.calls.length, 0);
  assert.equal(await tokenRow(b.id), null);
});

test('fix round 1 (D): a yes whose launch fails with no token row is the try-later line; setup done on the next find', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await offered('fd');
  // tokens.fun's ticker check is down: nothing is written.
  (b.ctx as { builderTokenDeps?: unknown }).builderTokenDeps = { fetch: b.tf.deps.fetch, check: async () => null };
  const s = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } }));
  assert.equal(s, "That didn't go through this time. Ask me again in a few minutes.");
  assert.equal(await tokenRow(b.id), null);
  assert.equal(b.tf.calls.length, 0);
  const next = show(await mcpCall(b.ctx, 'find', {}));
  assert.ok(next.startsWith(`You're all set, Maya.\n\n${OPEN}`), next);
});
