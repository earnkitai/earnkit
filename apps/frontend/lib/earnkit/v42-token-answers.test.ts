import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { tradeUrl } from './builder-token';
import { TOKEN_EXPLAINER, TOKEN_GOES_LIVE_ON_SIGN, TOKEN_OFF, tokenAnswerText, tokenSignLine, type TokenAnswerState } from './token-answers';
import { TOKEN_ON_ITS_WAY } from './bench-find';
import { shortWallet } from './entry-text';

/**
 * v4.2 Task 1 (F1, F2, F12, F4): a token question gets an answer in every state; a later "launch my token" launches once;
 * the launch reply carries the trade link. tokens.fun is faked: no real token is ever launched.
 */
process.env.EARNKIT_AUTH_SECRET ??= 'v42-token-answers-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
const COIN = '0x' + 'ab'.repeat(20);
const WALLET = '0x' + 'cd'.repeat(20);

// Pure copy, every state.
const base: TokenAnswerState = { token: null, handle: 'ada', communityUsd: 0, walletStepOpen: false, signLink: null, hasWallet: false };
test('the text of each state is exact', () => {
  const live = { status: 'launched', symbol: 'ADA', coin_address: COIN, wallet: WALLET } as const;
  assert.equal(tokenAnswerText({ ...base, walletStepOpen: true }), `${TOKEN_EXPLAINER}\n\n${TOKEN_GOES_LIVE_ON_SIGN}`);
  assert.equal(TOKEN_EXPLAINER, "Your token is how people who believe in your work can back it. Anyone can trade it, and 40% of every trade's fee goes to your wallet, claimed for you. It lives on Base, whatever chain you build on.");
  assert.equal(TOKEN_GOES_LIVE_ON_SIGN, 'It goes live when you sign. Rather skip it? Just say no.');
  assert.equal(tokenAnswerText({ ...base, signLink: 'https://x.test/w' }), `${TOKEN_EXPLAINER}\n\nSign with your wallet and it goes live: https://x.test/w`);
  assert.equal(tokenSignLine('L'), 'Sign with your wallet and it goes live: L');
  // Wallet, no offer: the explainer alone, with the seam for Task 6's question.
  assert.equal(tokenAnswerText({ ...base, hasWallet: true }), TOKEN_EXPLAINER);
  assert.equal(tokenAnswerText({ ...base, hasWallet: true }, { offerQuestion: 'Q?' }), `${TOKEN_EXPLAINER}\n\nQ?`);
  assert.equal(tokenAnswerText({ ...base, token: live }), `Your token is live: ${tradeUrl(COIN)}\n40% of every trade's fee goes to ${shortWallet(WALLET)}, claimed for you.`);
  assert.equal(
    tokenAnswerText({ ...base, token: live, communityUsd: 1234 }),
    `Your token is live: ${tradeUrl(COIN)}\n40% of every trade's fee goes to ${shortWallet(WALLET)}, claimed for you.\nSo far: $1,234.`,
  );
  assert.equal(tokenAnswerText({ ...base, token: { ...live, status: 'declined' } }), 'Your token is off. Say launch my token anytime to turn it on.');
  assert.equal(TOKEN_OFF, 'Your token is off. Say launch my token anytime to turn it on.');
  assert.equal(tokenAnswerText({ ...base, token: { ...live, status: 'launching' } }), TOKEN_ON_ITS_WAY);
  assert.equal(tokenAnswerText({ ...base, token: live }, { justLaunched: true }), `Done. Your token is live: ${tradeUrl(COIN)}\nIt's on your page too: https://earnkit.com/ada`);
  for (const s of ['', 'x'].map((_, i) => tokenAnswerText({ ...base, hasWallet: i === 0 }))) assert.doesNotMatch(s, /—|coin/i);
});

let n = 0;
async function builder(tag: string, withWallet: boolean) {
  n++;
  const t = `ek_v42ta_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const own = (await connectInstallation(t))!.own;
  const handle = `v42${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `96${RUN}${n}${tag.length}`, username: handle, name: 'v42', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const calls: unknown[] = [];
  const fetchFake = (async (_u: string, init?: RequestInit) => {
    calls.push(init?.body);
    return new Response(JSON.stringify({ success: true, tokenAddress: `0x${randomBytes(20).toString('hex')}`, txHash: '0xabc', chainId: 8453 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }), builderTokenDeps: { fetch: fetchFake, check: async () => true } } as never as Parameters<typeof mcpCall>[0];
  if (withWallet) await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${c.id}, now())`;
  return { ctx, id: c.id, handle, calls };
}
const row = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${id}`)[0]?.status ?? null;
const storedAsk = async (id: number) => (await sql()<{ k: string | null }[]>`SELECT standing_seen->'bench_ask'->>'kind' AS k FROM builder_profiles WHERE builder_id = ${id}`)[0]?.k ?? null;
const yes = { move_up: { kind: 'token', project_key: null, answer: 'yes' } };
async function on(fn: () => Promise<void>) {
  const prev = { on: process.env.EARNKIT_BUILDER_TOKENS, key: process.env.TOKENSFUN_DEPLOY_API_KEY };
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'v42-key';
  try { await fn(); } finally {
    if (prev.on === undefined) delete process.env.EARNKIT_BUILDER_TOKENS; else process.env.EARNKIT_BUILDER_TOKENS = prev.on;
    if (prev.key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY; else process.env.TOKENSFUN_DEPLOY_API_KEY = prev.key;
  }
}

test('a declined builder\'s own "launch my token" launches once; a second yes is the Live copy', db, () => on(async () => {
  const b = await builder('dec', true);
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${b.id}, x_user_id, 'declined' FROM builder_profiles WHERE builder_id = ${b.id}`;
  // A question never launches or reopens.
  assert.equal(show(await mcpCall(b.ctx, 'tell', { token: 'ask' })), TOKEN_OFF);
  assert.equal(b.calls.length, 0);
  assert.equal(await row(b.id), 'declined');
  // The builder's own yes launches, with the trade link and the page.
  const first = show(await mcpCall(b.ctx, 'tell', yes));
  assert.match(first, new RegExp(`^Done\\. Your token is live: https://app\\.uniswap\\.org/swap\\?chain=base&outputCurrency=0x[0-9a-f]{40}\\nIt's on your page too: .+/${b.handle}$`));
  assert.equal(b.calls.length, 1);
  assert.equal(await row(b.id), 'launched');
  const [t] = await sql()<{ coin_address: string; wallet: string }[]>`SELECT coin_address, wallet FROM builder_tokens WHERE builder_id = ${b.id}`;
  // A second yes: the Live copy, no second deploy.
  const second = show(await mcpCall(b.ctx, 'tell', yes));
  assert.equal(second, `Your token is live: ${tradeUrl(t.coin_address)}\n40% of every trade's fee goes to ${shortWallet(t.wallet)}, claimed for you.`);
  assert.equal(b.calls.length, 1);
  assert.equal(show(await mcpCall(b.ctx, 'tell', { token: 'ask' })), second);
}));

test('a question with the wallet step open answers with the explainer and adds no question; nothing launches', db, () => on(async () => {
  const b = await builder('open', false);
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
    || '{"wallet_setup":"2026-10-01T00:00:00Z","wallet_asked":"2026-10-01T00:00:00Z","token_offered":"2026-10-01T00:00:00Z","bench_ask":{"kind":"wallet_setup","key":null}}'::jsonb WHERE builder_id = ${b.id}`;
  const r = await mcpCall(b.ctx, 'tell', { token: 'ask' });
  assert.equal(show(r), `${TOKEN_EXPLAINER}\n\n${TOKEN_GOES_LIVE_ON_SIGN}`);
  assert.equal(r.reply?.move_up, undefined);
  assert.equal(await storedAsk(b.id), 'wallet_setup');
  assert.equal(await row(b.id), null);
  assert.equal(b.calls.length, 0);
}));

test('no wallet and no step open: the explainer and a signing link; wallet proven and no offer: the explainer alone', db, () => on(async () => {
  const a = await builder('nowal', false);
  const r = show(await mcpCall(a.ctx, 'tell', { token: 'ask' }));
  assert.match(r, new RegExp(`^${TOKEN_EXPLAINER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\nSign with your wallet and it goes live: https://\\S+/claim/wallet\\S+$`));
  assert.equal(a.calls.length, 0);
  const w = await builder('wal', true);
  // v4.2 Task 6: a wallet and never offered is the earlier builder: the explainer then the one-time offer question (stored as the ask).
  const q = await mcpCall(w.ctx, 'tell', { token: 'ask' });
  assert.equal(show(q), `${TOKEN_EXPLAINER}\n\nWant it live? Rather skip it? Just say no.`);
  assert.equal((q.reply?.move_up as { kind: string }).kind, 'token');
  assert.equal(await storedAsk(w.id), 'token');
  assert.equal(w.calls.length, 0);
  // Already offered: the explainer alone, no second question.
  assert.equal(show(await mcpCall(w.ctx, 'tell', { token: 'ask' })), TOKEN_EXPLAINER);
  assert.equal(await row(w.id), null);
}));

test('declined with no wallet: the builder\'s own yes gives the wallet link; no token is made', db, () => on(async () => {
  const b = await builder('decnw', false);
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${b.id}, x_user_id, 'declined' FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.match(show(await mcpCall(b.ctx, 'tell', yes)), /claim\/wallet/);
  assert.equal(b.calls.length, 0);
}));

test('F4: a wallet signed while the token launched: the "Done" reply names the token with its trade link and page', db, () => on(async () => {
  const b = await builder('sign', true);
  const coin = `0x${randomBytes(20).toString('hex')}`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_link_at', (now() - interval '1 minute')::text) WHERE builder_id = ${b.id}`;
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, symbol, coin_address, wallet)
    SELECT ${b.id}, x_user_id, 'launched', 'V42', ${coin}, ${WALLET} FROM builder_profiles WHERE builder_id = ${b.id}`;
  const s = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: null, answer: 'yes' } }));
  // v4.2 Task 10 (G4): one "Done.", the wallet and the token in the first line.
  assert.match(s, /^Done\. Your rewards now go to 0x[^\n]+, and your token is live: /);
  assert.equal(s.match(/Done\./g)?.length, 1, s);
  assert.ok(s.includes(`, and your token is live: ${tradeUrl(coin)}\nIt's on your page too: `), s);
  assert.ok(s.endsWith(`/${b.handle}`), s);
}));

test('review 3: a wallet change on an already-live token gets the Live copy, not "Done."', db, () => on(async () => {
  const b = await builder('chg', true);
  const coin = `0x${randomBytes(20).toString('hex')}`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_link_at', (now() - interval '1 minute')::text) WHERE builder_id = ${b.id}`;
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, symbol, coin_address, wallet, created_at)
    SELECT ${b.id}, x_user_id, 'launched', 'V42', ${coin}, ${WALLET}, now() - interval '2 days' FROM builder_profiles WHERE builder_id = ${b.id}`;
  const s = show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: null, answer: 'yes' } }));
  assert.match(s, /^Done\. Your rewards now go to 0x/);
  assert.ok(s.includes(`\n\nYour token is live: ${tradeUrl(coin)}\n40% of every trade's fee goes to ${shortWallet(WALLET)}`), s);
  assert.doesNotMatch(s, /Done\. Your token is live/);
}));

test('review 4: a stale token ask or an old coin yes never reverses a no; only the explicit yes does; a lasting failure restores the no', db, () => on(async () => {
  const b = await builder('stale', true);
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${b.id}, x_user_id, 'declined' FROM builder_profiles WHERE builder_id = ${b.id}`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"token","key":null}}'::jsonb WHERE builder_id = ${b.id}`;
  for (const input of [{ move_up: { project_key: null, answer: 'yes' } }, { coin: { project_key: 'a/b', answer: 'yes' } }, { move_up: { kind: 'coin', project_key: null, answer: 'yes' } }]) {
    const r = show(await mcpCall(b.ctx, 'tell', input));
    assert.ok(r === TOKEN_OFF || r === 'Okay.' || /off/.test(r), r);
    assert.equal(await row(b.id), 'declined');
    assert.equal(b.calls.length, 0);
  }
  // A lasting failure on the builder's own yes puts the no back.
  const f = await builder('nore', true);
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${f.id}, x_user_id, 'declined' FROM builder_profiles WHERE builder_id = ${f.id}`;
  const ctx = { ...(f.ctx as object), builderTokenDeps: { fetch: (async () => { throw new Error('no'); }) as unknown as typeof fetch, check: async () => false } } as never as Parameters<typeof mcpCall>[0];
  await mcpCall(ctx, 'tell', yes);
  assert.equal(await row(f.id), 'declined');
  // A no clears a stale token ask.
  const c = await builder('clr', true);
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"bench_ask":{"kind":"token","key":null}}'::jsonb WHERE builder_id = ${c.id}`;
  await mcpCall(c.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'no' } });
  assert.equal(await storedAsk(c.id), null);
}));

test('final review 2: the off copy asks nothing, and a token answer with no question clears an old stored ask, so a later kindless yes launches nothing', db, () => on(async () => {
  assert.doesNotMatch(TOKEN_OFF, /\?/);
  const b = await builder('clr', true);
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${b.id}, x_user_id, 'declined' FROM builder_profiles WHERE builder_id = ${b.id}`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', jsonb_build_object('kind', 'token', 'key', null))
    WHERE builder_id = ${b.id}`;
  assert.equal(show(await mcpCall(b.ctx, 'tell', { token: 'ask' })), TOKEN_OFF);
  assert.equal(await storedAsk(b.id), null);
  await mcpCall(b.ctx, 'tell', { move_up: { project_key: null, answer: 'yes' } });
  assert.equal(b.calls.length, 0);
  assert.equal(await row(b.id), 'declined');
}));
