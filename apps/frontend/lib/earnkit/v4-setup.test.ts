import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { appEnv } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fakeGitHub } from './fixtures/fake-github';
import { installApp } from './fixtures/app-install';
import { NO_GITHUB_HINT, TOKEN_NO_LINE, benchReply, pickRepoAgain, pickRepoAsk, programsTable, setupDoneLead, stateAsk, walletSetupAsk, type BenchProject, type BenchView } from './bench-reply';
import { setupDoneFor, setupRows } from './bench-find';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { tokenOfferDue, walletSetupDue, walletSetupToken } from './wallet-offer';
import { provenWallet, upgradeToken, walletLink, walletMessage, walletPost } from './wallet-proof';
import { declineBuilderToken, retryDroppedBuilderTokens } from './builder-token';

/**
 * v4.0 Task 3 (docs/design-docs-and-implementation-plans/v4-builder-tokens.md, "Approved copy" 1 and 2): setup steps 1
 * and 2 word for word; the Lovable or Bolt hint only when the builder has no GitHub (said so, a link-only project, or a
 * Lovable or Bolt live link), never assumed.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v4-setup-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const linkOf = (s: string) => s.match(/https:\/\/\S+/)?.[0] ?? '';
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HINT = 'Built it in Lovable or Bolt? Connect GitHub there first (Lovable: Project settings, then Git. Bolt: the GitHub icon, top right).';
const intro = (open: string | null, link: string) => [
  '**EarnKit gets you paid for building.**',
  '',
  `Every week I read what you ship, rank you against other builders, and find grants and programs you qualify for.${open ? ` ${open}` : ''}`,
  '',
  'Setup takes about a minute:',
  `1. Sign in with X: ${link}`,
  '2. Connect your code',
  '3. Add your wallet',
  '',
  'Done with step 1?',
].join('\n');
const step2 = (link: string, hint: boolean) =>
  `**Step 2 of 3:** connect your app's code on GitHub so I can match you to the right programs. Read-only, one click: ${link}\n\n${hint ? `${HINT}\n\n` : ''}Done?`;

test('the copy, word for word: the hint sentence and step 2 with and without it', () => {
  assert.equal(NO_GITHUB_HINT, HINT);
  const L = 'https://earnkit.com/github/verify?n=abc';
  assert.equal(pickRepoAsk(L, false), step2(L, false));
  assert.equal(pickRepoAsk(L, true), step2(L, true));
});

test('step 1: the intro with the open grant from its data (amount and organizer), and without one', () => {
  const link = 'https://earnkit.com/signin/abc';
  const v: BenchView = {
    state: 'signed_out', variant: null, project: null, rank: null, streak: 0, target: null, handle: null, link, fund: [], due: [], held: null,
    ask: stateAsk({ state: 'signed_out', variant: null, project: null, link }), open: { org: 'Base', amount: '$5,000', chain: 'Base', name: 'Base Builder Grants' },
  };
  assert.equal(benchReply(v), intro('Up to $5,000 is open from Base right now.', link));
  assert.equal(benchReply({ ...v, open: { org: 'Circle', amount: '$10,000', chain: null } }), intro('Up to $10,000 is open from Circle right now.', link));
  assert.equal(benchReply({ ...v, open: null }), intro(null, link));
  const retry = benchReply({ ...v, link: null, ask: stateAsk({ state: 'signed_out', variant: null, project: null, link: null }) });
  assert.ok(retry.endsWith("I couldn't make your sign-in link just now. Want me to try again?"), retry);
  assert.ok(retry.startsWith('**EarnKit gets you paid for building.**\n\n'), retry);
});

test('step 2 view: the hint only when view.noGithub', () => {
  const link = 'https://earnkit.com/github/verify?n=abc';
  const v = (noGithub: boolean): BenchView => ({ state: 'no_project', variant: null, project: null, rank: null, streak: 0, target: null, handle: 'maya', link, fund: [], due: [], held: null, welcome: true, noGithub, ask: stateAsk({ state: 'no_project', variant: null, project: null, link, noGithub }) });
  assert.equal(benchReply(v(false)), `You're in, @maya. Really glad you're here.\n\n${step2(link, false)}`);
  assert.equal(benchReply(v(true)), `You're in, @maya. Really glad you're here.\n\n${step2(link, true)}`);
});

let n = 0;
/** A signed-in builder with no project yet (the connect step). */
async function newcomer(tag: string) {
  n++;
  const t = `ek_v4s_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const own = (await connectInstallation(t))!.own;
  const handle = `v4s${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `94${RUN}${n}${tag.length}`, username: handle, name: 'v4s', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  return { ctx, id: c.id, handle };
}

test('(a) signed out: the intro block with the sign-in link in item 1, ending "Done with step 1?", no token', db, async () => {
  const t = `ek_v4s_out_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  const s = show(await mcpCall(ctx, 'find', { agent_can_build: false }));
  const link = linkOf(s);
  assert.match(link, /^https:\/\/\S+\/signin\/[A-Za-z0-9_-]{22}$/, s);
  const grant = s.match(/ (Up to \$[\d,]+ is open from [^.\n]+ right now\.)\n/)?.[1] ?? null;
  assert.equal(s, intro(grant, link));
  assert.ok(s.endsWith('Done with step 1?'), s);
  assert.doesNotMatch(s, /token|coin/i, s);
});

test('(b) first reply after sign-in, GitHub unknown: the welcome, step 2 of 3 with its link, no Lovable or Bolt hint', db, async () => {
  const p = await newcomer('b');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.ok(s.startsWith(`You're in, @${p.handle}. Really glad you're here.`), s);
  assert.match(s, /\*\*Step 2 of 3:\*\*/);
  const link = linkOf(s);
  assert.match(link, /^https:\/\/earnkit\.com\/github\/verify\?n=/, s);
  assert.equal(s, `You're in, @${p.handle}. Really glad you're here.\n\n${step2(link, false)}`);
  assert.doesNotMatch(s, /Built it in Lovable or Bolt\?/);
  // A connect yes with nothing connected and GitHub unknown: no hint either.
  const yes = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } }));
  assert.doesNotMatch(yes, /Built it in Lovable or Bolt/, yes);
});

test('(c) a link-only main project (Lovable): the welcome step 2 carries the hint', db, async () => {
  const p = await newcomer('c');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false, identity: { project: { name: 'MealMate', live_url: 'https://mealmate.lovable.app' } } }));
  assert.ok(s.startsWith(`You're in, @${p.handle}. Really glad you're here.`), s);
  assert.match(s, /\*\*Step 2 of 3:\*\*/);
  assert.ok(s.includes(HINT), s);
  assert.ok(s.endsWith(`${HINT}\n\nDone?`), s);
});

test('(c) a link-only main project on any host: the hint', db, async () => {
  const p = await newcomer('k');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false, identity: { project: { name: 'Tiply', live_url: 'https://tiply.example.com' } } }));
  assert.match(s, /\*\*Step 2 of 3:\*\*/, s);
  assert.ok(s.includes(HINT), s);
});

test('(c) standing_seen.github_no set: step 2 again (connect after all) carries the hint', db, async () => {
  const p = await newcomer('g');
  await mcpCall(p.ctx, 'find', { agent_can_build: false });
  await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'no' } });
  const s = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } }));
  assert.match(s, new RegExp(`^${esc('**Step 2 of 3:**')}`), s);
  assert.ok(s.includes(HINT), s);
});

test('(d) the same-day repeat keeps its short form', db, async () => {
  const p = await newcomer('d');
  await mcpCall(p.ctx, 'find', { agent_can_build: false });
  const second = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.equal(second, pickRepoAgain(linkOf(second)));
  assert.doesNotMatch(second, /You're in|Built it in Lovable/);
});

// ---- v4.0 Task 4: setup step 3 (wallet and token), the launch on the wallet proof, the opt-out, "launch my token".

const step3 = (project: string, link: string, token: boolean) =>
  `${project} is connected. One last step.\n\n**Step 3 of 3:** sign with your wallet. It's where your grants and community support get paid. One signature, no fee: ${link}\n\n` +
  `${token ? "Once you sign, your token goes live so people who believe in your work can back it, and 40% of every trade's fee goes straight to you. Rather skip the token? Just say no.\n\n" : ''}Done?`;
const hex = (k: number) => randomBytes(k).toString('hex');
const viemVerify = (a: { address: string; message: string; signature: string }) =>
  verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` });
const walletToken = (s: string) => decodeURIComponent(/https:\/\/earnkit\.com\/claim\/wallet\?t=(\S+)/.exec(s)![1]);
/** tokens.fun's deploy endpoint, faked: every call kept, a launched answer. */
const fakeTokensFun = () => {
  const calls: Record<string, unknown>[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ success: true, tokenAddress: `0x${hex(20)}`, txHash: '0xabc', chainId: 8453 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls, deps: { fetch: f, check: async () => true } };
};
const tokenRow = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${id}`)[0]?.status ?? null;
/** The launch runs beside the proof's answer (never awaited there): wait for its row to settle (or a second to pass). */
async function settled(id: number): Promise<string | null> {
  for (let i = 0; i < 50; i++) {
    const s = await tokenRow(id);
    if (s !== null && s !== 'launching') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  return tokenRow(id);
}
/** Signs the link's message and posts it as the page does (fake verify, no discovery, tokens.fun faked). */
async function signOn(handle: string, s: string, tf: ReturnType<typeof fakeTokensFun>, acct = privateKeyToAccount(generatePrivateKey()), afterProof?: (id: number) => Promise<void>) {
  const t = walletToken(s);
  const signature = await acct.signMessage({ message: walletMessage(handle, t) });
  const r = await walletPost(
    new Request('https://earnkit.com/claim/wallet', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com' }, body: JSON.stringify({ t, wallet: acct.address, signature }),
    }),
    { limit: async () => {}, verify: viemVerify, discover: async () => {}, builderToken: tf.deps, ...(afterProof && { afterProof }) },
  );
  return { status: r.status, body: (await r.json()) as { line: string; recipient?: boolean } };
}

/** A signed-in builder whose MealMate repo is connected through the App (setup step 2 done). */
async function connected(tag: string) {
  const p = await newcomer(tag);
  const tf = fakeTokensFun();
  const key = `${p.handle}/mealmate`.toLowerCase();
  const commits = [0, 1, 2].map((w) => ({ sha: `c${w}`, message: `Ship feature ${w}`, date: new Date(Date.now() - w * 7 * 86_400_000 - 86_400_000).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: 7700 + Number(RUN.slice(-2)) + n * 3 + tag.charCodeAt(0), owner: p.handle, installation: 77 + n, private: false, commits } });
  const ctx = { ...(p.ctx as object), codesFetch: gh as typeof fetch, builderTokenDeps: tf.deps } as never as Parameters<typeof mcpCall>[0];
  await mcpCall(ctx, 'find', { agent_can_build: false });
  await mcpCall(ctx, 'find', { agent_can_build: false, identity: { project: { name: 'MealMate', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: p.id, repoKey: key, login: p.handle.toLowerCase(), gh });
  return { ...p, ctx, key, tf };
}

test('step 3 copy, word for word: with the token sentence, and without it', () => {
  const L = 'https://earnkit.com/claim/wallet?t=1.2.x';
  assert.equal(walletSetupAsk('MealMate', L, true), step3('MealMate', L, true));
  assert.equal(walletSetupAsk('MealMate', L, false), step3('MealMate', L, false));
  assert.equal(TOKEN_NO_LINE, 'Got it.');
  for (const s of [walletSetupAsk('MealMate', L, true), walletSetupAsk('MealMate', L, false)]) {
    assert.doesNotMatch(s, /coin|—|\p{Extended_Pictographic}/u, s);
    assert.equal((s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length - (s.includes('Rather skip the token?') ? 1 : 0), 1, s);
  }
  // Before every ranked ask (connect, apply...), and after the GitHub no's walk-through offer.
  const project: BenchProject = { key: 'maya/mealmate', name: 'MealMate', confirmed: true, live: false, weeks: 1 };
  const setup = { link: L, project: 'MealMate', token: true };
  const ranked = { state: 'ranked' as const, variant: null, project, link: null, handle: 'maya', walletSetup: setup };
  assert.equal(stateAsk({ ...ranked, connect: { weeks: 3 } }).kind, 'wallet_setup');
  assert.equal(stateAsk({ ...ranked, apply: { program_id: 'p', title: 'P', amount: null, when: null } }).line, step3('MealMate', L, true));
  assert.equal(stateAsk({ ...ranked, walletSetup: null, connect: { weeks: 3 } }).kind, 'connect');
  const no = { state: 'no_project' as const, variant: null, project: null, link: null, githubNo: true, walletSetup: { ...setup, project: null } };
  assert.equal(stateAsk({ ...no, baseAsk: true }).kind, 'base_start');
  assert.equal(stateAsk(no).kind, 'wallet_setup');
});

test('(a) after GitHub connects, the next reply is step 3 with the project and the wallet link; flag off: no token sentence', db, async () => {
  try {
  for (const on of [true, false]) {
    process.env.EARNKIT_BUILDER_TOKENS = on ? 'on' : 'off';
    const p = await connected(on ? 'a' : 'o');
    const r = await mcpCall(p.ctx, 'find', { agent_can_build: false });
    const s = show(r);
    const link = linkOf(s);
    assert.match(link, /^https:\/\/earnkit\.com\/claim\/wallet\?t=/, s);
    assert.equal(s, step3('MealMate', link, on));
    assert.equal((r.reply?.move_up as { kind: string }).kind, 'wallet_setup');
    assert.match(String((r.reply?.move_up as { agent_note: string }).agent_note), /kind: 'wallet'/);
    // Asked once: the next reply moves on.
    assert.doesNotMatch(show(await mcpCall(p.ctx, 'find', { agent_can_build: false })), /Step 3 of 3/);
  }
  } finally {
    process.env.EARNKIT_BUILDER_TOKENS = 'on';
  }
});

test('(b) a no to the wallet step: skipped, remembered, never asked again; no token', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const p = await connected('s');
  assert.match(show(await mcpCall(p.ctx, 'find', { agent_can_build: false })), /\*\*Step 3 of 3:\*\*/);
  const no = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'wallet', project_key: p.key, answer: 'no' } }));
  assert.ok(no.startsWith("No worries, add it whenever you're ready."), no);
  assert.equal(await walletSetupDue(p.id, new Date()), null);
  assert.doesNotMatch(show(await mcpCall(p.ctx, 'find', { agent_can_build: false })), /Step 3 of 3|wallet/i);
  assert.equal(await tokenRow(p.id), null);
  assert.equal(p.tf.calls.length, 0);
});

test('final review 9: skipping the wallet skips the token: a wallet proven later (the change link) and the hourly retry deploy nothing; only "launch my token" launches', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('k9');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.ok(s.includes('Rather skip the token? Just say no.'), s);
  assert.ok(show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'wallet', project_key: p.key, answer: 'no' } })).startsWith("No worries, add it whenever you're ready."));
  assert.equal(await tokenRow(p.id), null);
  // A wallet added later another way: the change link.
  const change = walletLink(p.id, new Date());
  assert.ok(change);
  assert.equal((await signOn(p.handle, change!, p.tf)).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(await provenWallet(p.id));
  assert.equal(await tokenRow(p.id), null);
  assert.deepEqual(await retryDroppedBuilderTokens(new Date(), { ...p.tf.deps, only: [p.id] }), { tried: 0, launched: 0, blocked: [] });
  // Never re-pitched by the legacy offer either.
  assert.equal(await tokenOfferDue(p.id), false);
  assert.equal(p.tf.calls.length, 0);
  // The builder's own "launch my token" launches, once.
  assert.match(show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } })), /^Done\. Your token is live: https:/);
  assert.equal(p.tf.calls.length, 1);
});

test('(c) the proof on the wallet page launches the token, no tell call needed', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('l');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  const signed = await signOn(p.handle, s, p.tf);
  assert.equal(signed.status, 200);
  assert.equal(signed.body.recipient, true);
  assert.equal(await settled(p.id), 'launched');
  assert.equal(p.tf.calls.length, 1);
  assert.equal(p.tf.calls[0].creatorWallet, await provenWallet(p.id));
});

test('(d) a no to the token before the proof: the setup-done reply, then the proof deploys nothing; declined', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('n');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  // v4.0 Task 5: the no is the setup-done reply now (MealMate fits nothing open here).
  const none = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: p.key, answer: 'no' } }));
  // v4.2 (F3): programs are open, so the table, never "doesn't fit"; MealMate was matched and fits none of them, so no question (never a program picked for a reason EarnKit does not have).
  assert.ok(none.startsWith(`No problem, no token. ${OPEN}\n\n| Program | Up to | Closes |`), none);
  assert.doesNotMatch(none, /doesn't fit/, none);
  // Matched, nothing fits: the Monday check-in (this client can schedule and was never asked), stored so a yes routes right.
  assert.ok(none.endsWith('| Circle Developer Grants | $100,000 | Rolling |\n\nWant me to check in here every Monday?'), none);
  assert.equal((await signOn(p.handle, s, p.tf)).status, 200);
  assert.equal(await settled(p.id), 'declined');
  assert.equal(p.tf.calls.length, 0);
  // A declined builder never sees the token sentence again; only their own "launch my token" (v4.2) reverses the no.
  assert.equal(await walletSetupToken(p.id), false);
  assert.equal(show(await mcpCall(p.ctx, 'tell', { token: 'ask' })), 'Your token is off. Say launch my token anytime to turn it on.');
  assert.equal(p.tf.calls.length, 0);
  assert.match(show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } })), /^Done\. Your token is live: https:/);
  assert.equal(p.tf.calls.length, 1);
});

test('(e) a wallet change after the launch deploys nothing; a declined builder\'s later proof deploys nothing', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('e');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  await signOn(p.handle, s, p.tf);
  assert.equal(await settled(p.id), 'launched');
  await sql()`DELETE FROM builder_tokens WHERE builder_id = ${p.id}`.then(() => {}, () => {});
  // The row is the guard; even without it, a second proof is a change (never a first wallet), so nothing launches.
  const change = show(await mcpCall(p.ctx, 'tell', { wallet: 'change' }));
  assert.equal((await signOn(p.handle, change, p.tf)).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await tokenRow(p.id), null);
  assert.equal(p.tf.calls.length, 1);

  const d = await connected('f');
  const ds = show(await mcpCall(d.ctx, 'find', { agent_can_build: false }));
  assert.equal(await declineBuilderToken(d.id), 'declined');
  await signOn(d.handle, ds, d.tf);
  await new Promise((r) => setTimeout(r, 100));
  const later = show(await mcpCall(d.ctx, 'tell', { wallet: 'change' }));
  await signOn(d.handle, later, d.tf);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await tokenRow(d.id), 'declined');
  assert.equal(d.tf.calls.length, 0);
});

test('(f) no X account (x_user_id): no step 3, no token sentence, and a proof launches nothing', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('x');
  await sql()`UPDATE builder_profiles SET x_user_id = NULL WHERE builder_id = ${p.id}`;
  assert.equal(await walletSetupDue(p.id, new Date()), null);
  assert.equal(await walletSetupToken(p.id), false);
  assert.doesNotMatch(show(await mcpCall(p.ctx, 'find', { agent_can_build: false })), /Step 3 of 3|token/i);
  const link = `https://earnkit.com/claim/wallet?t=${encodeURIComponent(upgradeToken(p.id, new Date())!)}`;
  const signed = await signOn(p.handle, link, p.tf);
  assert.equal(signed.status, 400);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await tokenRow(p.id), null);
  assert.equal(p.tf.calls.length, 0);
});

test('(g) "launch my token" with a proven wallet and no row launches; asked again, the existing status', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('g');
  // A wallet proven before tokens were on (no launch then).
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${hex(20)}`}, ${p.id}, now())`;
  const yes = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } }));
  assert.match(yes, /^Done\. Your token is live: https:\/\/app\.uniswap\.org\//);
  assert.equal(await tokenRow(p.id), 'launched');
  assert.match(show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } })), /^Your token is live: https:/);
  assert.equal(p.tf.calls.length, 1);
  for (const s of [yes]) assert.doesNotMatch(s, /coin/i);
  // Without a wallet: the wallet link.
  const w = await connected('w');
  const nw = show(await mcpCall(w.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } }));
  assert.match(nw, /https:\/\/earnkit\.com\/claim\/wallet\?t=/, nw);
  assert.equal(w.tf.calls.length, 0);
});

// ---- Fix round 1.

test('fix 1: a kindless no to step 3 with the token sentence shown declines the token (the wallet step stays open)', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('k1');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.ok(s.includes('Rather skip the token? Just say no.'), s);
  assert.ok(show(await mcpCall(p.ctx, 'tell', { move_up: { project_key: p.key, answer: 'no' } })).startsWith('No problem, no token.'));
  assert.equal(await tokenRow(p.id), 'declined');
  assert.equal((await signOn(p.handle, s, p.tf)).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await tokenRow(p.id), 'declined');
  assert.equal(p.tf.calls.length, 0);
});

test('fix 2: a first proof launches only after the token sentence was seen; else only "launch my token" does', db, async () => {
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('t2');
  let s: string;
  try {
    process.env.EARNKIT_BUILDER_TOKENS = 'off';
    s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
    assert.doesNotMatch(s, /token/i, s);
  } finally {
    process.env.EARNKIT_BUILDER_TOKENS = 'on';
  }
  assert.equal((await signOn(p.handle, s, p.tf)).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await tokenRow(p.id), null);
  assert.equal(p.tf.calls.length, 0);
  assert.equal(show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } })).split('\n')[0].replace(/https:.*/, 'LINK'), 'Done. Your token is live: LINK');
  assert.equal(p.tf.calls.length, 1);
});

test('fix 3: an App-connected builder whose main project is not counted gets step 3', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const p = await connected('nc');
  await sql()`UPDATE builder_profiles SET main_project_key = ${`${p.handle}/other`.toLowerCase()} WHERE builder_id = ${p.id}`;
  const r = await mcpCall(p.ctx, 'find', { agent_can_build: false });
  const s = show(r);
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'wallet_setup', s);
  assert.equal(s, step3('Your code', linkOf(s), true));
});

test('fix 4: a throwing side effect after the proof still launches the token', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const p = await connected('se');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  await assert.rejects(signOn(p.handle, s, p.tf, undefined, async () => { throw new Error('side effect down'); }));
  assert.equal(await settled(p.id), 'launched');
  assert.equal(p.tf.calls.length, 1);
});

// ---- v4.0 Task 5: setup done (approved copy 4): the first reply after step 3 settles, with the open programs table.

const ROLLING = 'base-builder-grants';
const ROLLING_TITLE = 'Base Builder Grant Program';
const OPEN = "Here's what's open for you right now:";
const TABLE = `| Program | Up to | Closes |\n|---|---|---|\n| ${ROLLING_TITLE} | $5,000 | Rolling |`;
const BEST_ASK = `${ROLLING_TITLE} looks like your best fit. Want me to draft it?`;
type Ctx = Parameters<typeof mcpCall>[0];
const kindOf = (r: R) => (r.reply?.move_up as { kind?: string } | undefined)?.kind;
function repoFits(key: string, programs: string[]): RepoFit[] {
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  return [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: programs.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
}
/** A ranked builder named "Maya Lin" on X (the Kit repo proven by the App, the matcher fitting `programs`), shown step 3. */
async function fitted(tag: string, programs: string[], clientName = 'Claude Code') {
  n++;
  const t = `ek_v4s5_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, clientName);
  const own = (await connectInstallation(t))!.own;
  const handle = `v5${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `93${RUN}${n}${tag.length}`, username: handle, name: 'Maya Lin', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `${handle}/kit`;
  const tf = fakeTokensFun();
  const fits = repoFits(key, programs);
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never,
    tokenDeps: { check: async () => true }, builderTokenDeps: tf.deps,
  } as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 50_000 + Math.floor(Math.random() * 40_000);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  (ctx as { codesFetch?: typeof fetch }).codesFetch = gh as typeof fetch;
  // The connect weeks are another task's moment: answered, so they never take the step here.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  const r = await mcpCall(ctx, 'find', {});
  const step = show(r);
  assert.match(step, /\*\*Step 3 of 3:\*\*/, step);
  assert.equal(kindOf(r), 'wallet_setup', step);
  return { ctx, id: c.id, key, handle, tf, step };
}

test('setup done copy, word for word: the three leads, the neutral one, and the table', () => {
  assert.equal(setupDoneLead('Maya', 'launched'), `You're all set, Maya. Your community can now back what you're building.\n\n${OPEN}`);
  assert.equal(setupDoneLead('Maya', 'declined'), `No problem, no token. ${OPEN}`);
  assert.equal(setupDoneLead('Maya', 'skipped'), `No worries, add it whenever you're ready. ${OPEN}`);
  assert.equal(setupDoneLead('Maya', 'set'), `You're all set, Maya.\n\n${OPEN}`);
  assert.equal(
    programsTable([{ program: 'Base Builder Grant Program', upTo: '$5,000', closes: 'Rolling' }, { program: 'Arc Builders', upTo: '$10,000', closes: 'Nov 15' }]),
    '| Program | Up to | Closes |\n|---|---|---|\n| Base Builder Grant Program | $5,000 | Rolling |\n| Arc Builders | $10,000 | Nov 15 |',
  );
  // A cell never breaks the table.
  assert.equal(programsTable([{ program: 'A | B', upTo: '$1', closes: 'Rolling' }]).split('\n')[2], '| A / B | $1 | Rolling |');
  for (const o of ['launched', 'declined', 'skipped', 'set'] as const) assert.doesNotMatch(setupDoneLead('Maya', o), /coin|—|\p{Extended_Pictographic}/u);
  // Rows: at most 3, the Best fit first; rolling is "Rolling", a deadline its day.
  const f = (id: string, when: string) => ({ program_id: id, title: id.toUpperCase(), amount: '$5,000', when }) as never;
  assert.deepEqual(setupRows([f('b', 'closes Nov 15'), f('a', 'rolling'), f('c', 'rolling'), f('d', 'rolling')]), [
    { program: 'B', upTo: '$5,000', closes: 'Nov 15' }, { program: 'A', upTo: '$5,000', closes: 'Rolling' }, { program: 'C', upTo: '$5,000', closes: 'Rolling' },
  ]);
});

test('(a) signed on the page, token launched: the next find leads with "You\'re all set", the table and the draft question', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const b = await fitted('a', [ROLLING]);
  assert.equal((await signOn(b.handle, b.step, b.tf)).status, 200);
  assert.equal(await settled(b.id), 'launched');
  const r = await mcpCall(b.ctx, 'find', {});
  const s = show(r);
  // v4.2: the sign that launched the token says so, with the trade link.
  assert.match(s, /^You're all set, Maya\. Your token is live, so your community can back what you're building: https:\/\/\S+\n\n/, s);
  assert.equal(s.split('\n\n').slice(1).join('\n\n'), `${OPEN}\n\n${TABLE}\n\n${BEST_ASK}`);
  assert.equal(kindOf(r), 'apply');
  // The yes drafts it (the apply flow).
  const yes = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'apply', project_key: (r.reply?.move_up as { project_key: string }).project_key, answer: 'yes' } });
  assert.equal((yes.reply?.lead as { program_id?: string } | undefined)?.program_id, ROLLING, JSON.stringify(yes.reply));
});

test('(a) signed with tokens off: the neutral "You\'re all set", no token claim', db, async () => {
  const b = await (async () => {
    try {
      process.env.EARNKIT_BUILDER_TOKENS = 'off';
      return await fitted('n', [ROLLING]);
    } finally {
      process.env.EARNKIT_BUILDER_TOKENS = 'on';
    }
  })();
  assert.equal((await signOn(b.handle, b.step, b.tf)).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await tokenRow(b.id), null);
  const s = show(await mcpCall(b.ctx, 'find', {}));
  assert.equal(s, `You're all set, Maya.\n\n${OPEN}\n\n${TABLE}\n\n${BEST_ASK}`);
});

test('(b) a no to the token: "No problem, no token." with the table, right away', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('b', [ROLLING]);
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: b.key, answer: 'no' } });
  assert.equal(show(r), `No problem, no token. ${OPEN}\n\n${TABLE}\n\n${BEST_ASK}`);
  assert.equal(kindOf(r), 'apply');
  assert.equal(await tokenRow(b.id), 'declined');
});

test('(c) skipped the wallet: "No worries, add it whenever you\'re ready." with the table, right away', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('c', [ROLLING]);
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'no' } });
  assert.equal(show(r), `No worries, add it whenever you're ready. ${OPEN}\n\n${TABLE}\n\n${BEST_ASK}`);
  assert.equal(kindOf(r), 'apply');
});

test('(d) said once: the next reply is the normal ranked reply; a later no to the token is "Got it."', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('d', [ROLLING]);
  assert.ok(show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'no' } })).includes(OPEN));
  const next = show(await mcpCall(b.ctx, 'find', {}));
  assert.doesNotMatch(next, /what's open for you right now|You're all set|No worries|\| Program \|/, next);
  assert.equal(show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'no' } })), TOKEN_NO_LINE);
  // Signed on the page after the browser: still once.
  const s = await mcpCall(b.ctx, 'find', {});
  assert.doesNotMatch(show(s), /You're all set|what's open for you right now/, show(s));
});

test('(e) every program already told: the table still shows (v4.2: "doesn\'t fit" only when nothing is open), no question, never an empty table', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('e', []);
  // Every program the stored repo facts could win, told about already (so none is open for it).
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, round_label)
    SELECT ${b.id}, '', id, 'rejected', 'an older round' FROM programs ON CONFLICT DO NOTHING`;
  const r = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'no' } });
  const s = show(r);
  assert.ok(s.startsWith(`No worries, add it whenever you're ready. ${OPEN}\n\n| Program | Up to | Closes |`), s);
  assert.doesNotMatch(s, /doesn't fit/, s);
  assert.doesNotMatch(s, /\?$/, s);
  assert.notEqual(kindOf(r), 'qualify');
});

test('final review 1: a token still launching or unknown is never told as live: "Your token is on its way" in place of the community line', db, async () => {
  assert.equal(setupDoneLead('Maya', 'on_its_way'), `You're all set, Maya. Your token is on its way. I'll confirm it here soon.\n\n${OPEN}`);
  assert.doesNotMatch(setupDoneLead('Maya', 'on_its_way'), /coin|—|\p{Extended_Pictographic}/u);
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const b = await fitted('w', [ROLLING]);
  const unclear = (async () => new Response(JSON.stringify({ error: 'Deployment status unknown' }), { status: 502 })) as unknown as typeof fetch;
  const tf = { f: unclear, calls: [], deps: { fetch: unclear, check: async () => true } };
  assert.equal((await signOn(b.handle, b.step, tf)).status, 200);
  assert.equal(await settled(b.id), 'unknown');
  const s = show(await mcpCall(b.ctx, 'find', {}));
  assert.equal(s, `You're all set, Maya. Your token is on its way. I'll confirm it here soon.\n\n${OPEN}\n\n${TABLE}\n\n${BEST_ASK}`);
});

test('final review 6: the setup-done reply is claimed only once it is built: a failure leaves it for the next reply', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const b = await fitted('f', [ROLLING]);
  // Skipped: no wallet, no token row, the wallet step closed.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'wallet_link_at' WHERE builder_id = ${b.id}`;
  const boom = { filter: () => { throw new Error('boom'); } } as never;
  assert.equal(await setupDoneFor(b.id, new Date(), { fits: boom, skip: new Set(), seen: {}, key: b.key, name: 'Kit' }), null);
  const [p] = await sql()<{ done: boolean }[]>`SELECT COALESCE(standing_seen ? 'setup_done', false) AS done FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.equal(p.done, false, 'not claimed by a failed build');
  const s = show(await mcpCall(b.ctx, 'find', {}));
  assert.ok(s.startsWith("No worries, add it whenever you're ready."), s);
});

// ---- v4.0 Task 6 fix round 1: the programs table end to end, per surface (a real reply with a table, formatted as the route does).
test('(T6) the setup-done programs table: a Muse install gets "Program: $X, Closes" lines and no |; Grok Bot gets the table', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  const mk = async (tag: string, name: string) => {
    const b = await fitted(tag, [ROLLING], name);
    return show(await mcpCall(b.ctx, 'tell', { move_up: { kind: 'wallet', project_key: b.key, answer: 'no' } }, { format: true }));
  };
  const muse = await mk('t6m', 'Muse');
  assert.doesNotMatch(muse, /[|]|\*\*/, muse);
  assert.ok(muse.includes(`${ROLLING_TITLE}: $5,000, Rolling`), muse);
  assert.ok(!muse.includes('Program: Up to'), muse);
  const grok = await mk('t6g', 'Grok Bot');
  assert.ok(grok.includes(TABLE), grok);
});
