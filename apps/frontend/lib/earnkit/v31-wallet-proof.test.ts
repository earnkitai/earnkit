import './fixtures/no-network-checks';
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { padPool } from './fixtures/rank-pool';
import { person } from './fixtures/find';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { productOdds, productScore, traction } from './match';
import type { RepoFit } from './present';
import {
  MOMENT_ASK, SHIP_ASK, TITLES_ASK, WALLET_ASK, WALLET_BUILDER_CODE, WALLET_COIN_FEES, WALLET_SKIPPED, stateAsk, walletChange, walletChangeX,
  walletContractsOnly, walletDone, walletNotYet, walletNotice, walletOffer, type BenchProject,
} from './bench-reply';
import { WALLET_SETUP_SKIPPED, walletSetupAsk } from './bench-reply';
import { WALLET_NOTE, WALLET_SIGN_IN_FIRST, walletChangeReply, walletOfferDue, walletSetupDue, walletSetupNote } from './wallet-offer';
import { WALLET_TEXT, provenWallet, upgradeOf, walletContractsLine, walletDoneLine, walletMessage, walletPost } from './wallet-proof';
import { titlesAskDue } from './updates';
import { walletXSignIn } from './fixtures/wallet-step';
import { discoverPerson } from './discovery';
import { walletFirstTxFrom, walletFirstTxRpc, type NonceRpc, type ReaderDeps } from './source-readers';
import { blockscoutUrl } from './campaigns';
import { highlights } from './site-data';
import { githubProfileHref, profileData, type ProfileData } from './bench-data';
import HeroCard from '../../app/[handle]/site/HeroCard';
import { MAYA, MAYA_SITE } from './fixtures/profile-data';
import { PRIVATE_NAME } from './page-data';

/**
 * v3.1 wallet proof (owner-approved 2026-10-23): the optional wallet step right after setup, once, never with another
 * question; "done" checks the signature, "skip" is remembered; "change my reward wallet" sends a fresh link; the newest
 * proven wallet is the reward recipient (program payouts); a proof queues discovery, whose contracts (every
 * chain, v3.1 Highlights competence) show in Highlights; the hero's GitHub button falls back to the builder's GitHub profile.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-wallet-proof-test-secret';
process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
(globalThis as { React?: typeof React }).React = React;

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
/** Every wallet reply: exactly one https link, exactly one question, no em dash or emoji, never a full wallet address. */
const rule = (s: string) => {
  assert.equal(links(s).length, 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}/u, s);
  assert.doesNotMatch(s, /0x[0-9a-f]{40}/i, s);
  return s;
};
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const viemVerify = (a: { address: string; message: string; signature: string }) =>
  verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` });
const tokenOf = (s: string) => decodeURIComponent(/https:\/\/earnkit\.com\/claim\/wallet\?t=(\S+)/.exec(s)![1]);
/** The people whose discovery a proof ran at once (walletPost's discover). */
const discovered: number[] = [];
/** Signs the link's message with `acct` and posts it as the page does. */
async function sign(handle: string, s: string, acct = privateKeyToAccount(generatePrivateKey()), cookie: string | null = null) {
  const t = tokenOf(s);
  const signature = await acct.signMessage({ message: walletMessage(handle, t) });
  const r = await walletPost(
    new Request('https://earnkit.com/claim/wallet', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com', ...(cookie && { cookie }) }, body: JSON.stringify({ t, wallet: acct.address, signature }),
    }),
    { limit: async () => {}, verify: viemVerify, discover: async (id) => void discovered.push(id) },
  );
  const j = (await r.json()) as { line: string; recipient?: boolean };
  return { status: r.status, line: j.line, recipient: j.recipient, wallet: acct.address.toLowerCase() };
}

test('the copy, word for word: the offer, the change links, done, contracts only, not yet, skipped, the notice', () => {
  const L = 'https://earnkit.com/claim/wallet?t=1.2.x';
  // v3.1 cold read (owner-approved): no "Optional:", and the one question is "Done?".
  assert.equal(walletOffer(L), `Prove your Base wallet so your contracts show on your page. One signature, no fee: ${L}\nDone?`);
  assert.equal(walletChange(L), `Sign with the wallet you want your rewards sent to. One signature, no fee: ${L}\nDone?`);
  assert.equal(
    walletChangeX('0x12ab…abcd', L, [WALLET_BUILDER_CODE, WALLET_COIN_FEES]),
    `Your rewards go to 0x12ab…abcd. To change that, sign in with X and sign with the new wallet (one signature, no fee): ${L}\n` +
      "Your Base Builder Code stays on your first wallet.\nYour token's fees keep going to the wallet it launched with.\nDone?",
  );
  assert.equal(walletNotYet(L), `I don't see a signature yet. Here's a fresh link (one signature, no fee): ${L}\nDone?`);
  assert.equal(walletDone('0x12ab…abcd', true), 'Done. Your rewards now go to 0x12ab…abcd. Your contracts on Base will show on your page soon.');
  assert.equal(walletContractsOnly('0x12ab…abcd'), 'Done. That wallet counts for your contracts. Your rewards still go to 0x12ab…abcd until you sign in with X on the wallet page.');
  assert.equal(walletNotice('0x12ab…abcd'), 'Your reward wallet changed to 0x12ab…abcd.');
  assert.equal(WALLET_SKIPPED, 'Skipped. Ask me anytime to add your reward wallet.');
  for (const s of [walletOffer(L), walletChange(L), walletNotYet(L), walletChangeX('0x12ab…abcd', L, [WALLET_BUILDER_CODE, WALLET_COIN_FEES])]) rule(s);
});

test('the wallet step never shares a reply with another question: after connect, a post, apply and the weekly moment; before titles, Base steps and ship', () => {
  const project: BenchProject = { key: 'kit/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const v = { state: 'ranked' as const, variant: null, project, link: null, handle: 'kit', wallet: 'https://earnkit.com/claim/wallet?t=x' };
  assert.equal(stateAsk({ ...v, connect: { weeks: 3, points: 40 } }).kind, 'connect');
  assert.equal(stateAsk({ ...v, apply: { program_id: 'p', title: 'P', amount: null, when: null } }).kind, 'apply');
  assert.equal(stateAsk({ ...v, share: true }).line, MOMENT_ASK);
  const w = stateAsk({ ...v, titles: true });
  assert.equal(w.kind, 'wallet');
  assert.ok(w.line.endsWith(WALLET_ASK));
  assert.equal(stateAsk({ ...v, wallet: null, titles: true }).line, TITLES_ASK);
  assert.equal(stateAsk({ ...v, wallet: null }).line, SHIP_ASK);
  assert.equal(stateAsk({ ...v, state: 'no_project', link: 'https://x' }).kind, 'pick_repo', 'never before setup is done');
});

/**
 * A signed-in builder whose one project is ranked through the App (pool of 13). v4.0: the next reply is setup step 3
 * (before the connect offer), so the test's own find shows it.
 */
async function rankedBuilder(tag: string, o: { baseContract?: boolean } = {}) {
  const t = `ek_v31wp${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c0 = (await connectInstallation(t))!;
  const handle = `wp${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(c0.own, { id: `96${tag}${RUN}${randomBytes(2).toString('hex')}`, username: handle, name: 'Kit Builder', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `${handle}/kit`.toLowerCase();
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 0, live_ok: false, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: null, created_at: '2025-01-01T00:00:00Z', chains: {}, commits_in_window: {}, product, tx_count: 0, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, verdicts: [] }];
  const commits = [0, 1, 2, 3].map((w) => ({ sha: `c${w}`, message: `Ship feature ${w}`, date: new Date(Date.now() - w * 7 * DAY - DAY).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: 9600 + Number(RUN.slice(-2)) + tag.charCodeAt(0), owner: handle, installation: 96, private: false, commits } });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, codesFetch: gh as typeof fetch, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall({ ...ctx, matchProjects: (async () => ({ checked: 0, scored: 0, fits: [] })) as never }, 'find', {});
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  // v3.1 cold read: the wallet step is only for a builder with contracts on Base known or reported.
  if (o.baseContract !== false)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${c.id}, 'contract', ${`base:0x${randomBytes(20).toString('hex')}`}, ${key}, 'agent')`;
  return { c, ctx, key, handle };
}
const start = async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);
};
const seen = async (id: number) => (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;

test('offered once, claimed only when shown; "done" before signing sends a fresh link; the first proof is the recipient; a change needs X, else contracts only; the change is said once', db, async () => {
  await start();
  const { c, ctx, key, handle } = await rankedBuilder('o');
  // Due but not claimed until a reply carries it (v4.0: setup step 3, the first reply after the App connects).
  assert.ok(await walletSetupDue(c.id, new Date()));
  assert.equal((await seen(c.id)).wallet_asked, undefined);
  const r = await mcpCall(ctx, 'find', {});
  const s = rule(show(r));
  // v4.0 approved copy 3, alone: no standing, money or points line (tokens off here: no token sentence).
  assert.equal(s, walletSetupAsk('Kit', links(s)[0] ?? '', false));
  assert.deepEqual(r.reply?.move_up, { kind: 'wallet_setup', project_key: key, agent_note: walletSetupNote(false) });
  assert.equal(upgradeOf(tokenOf(s), new Date()), c.id, 'a fresh link for this builder');
  assert.equal(typeof (await seen(c.id)).wallet_asked, 'string', 'claimed with the reply that carries it');

  // "Done" before the signature: a fresh link (the first may have expired) and the same question.
  const notYet = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } });
  const ns = rule(show(notYet));
  assert.match(ns, /^I don't see a signature yet\. Here's a fresh link \(one signature, no fee\): https:\/\/earnkit\.com\/claim\/wallet\?t=\S+\nDone\?$/);
  assert.deepEqual(notYet.reply?.move_up, { kind: 'wallet', project_key: key, agent_note: WALLET_NOTE });
  // Signing on the page proves it (the first reward wallet: the link alone) and queues discovery.
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${c.id}`;
  const signed = await sign(handle, ns);
  assert.deepEqual({ status: signed.status, line: signed.line, recipient: signed.recipient }, { status: 200, line: walletDoneLine(signed.wallet), recipient: true });
  const [q] = await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${c.id}`;
  assert.deepEqual({ ...q }, { reason: 'wallet', done_at: null });
  assert.ok(discovered.includes(c.id), 'the proof runs the discovery at once');
  assert.equal(await provenWallet(c.id), signed.wallet);
  // The hourly discover step reads it (discovery tests); here it is marked done so a refresh never reads the network.
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${c.id}`;
  // Fix round 8: a reply in between, then "done": still answered from the wallet's state.
  assert.doesNotMatch(show(await mcpCall(ctx, 'find', {})), /wallet/i);
  const done = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } });
  assert.equal(show(done), walletDone(short(signed.wallet), true));
  // Answered once; the next replies never offer it again.
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } })), 'Okay.');
  assert.doesNotMatch(show(await mcpCall(ctx, 'find', {})), /wallet/i);
  // The same link never proves a second wallet.
  assert.equal((await sign(handle, ns)).line, WALLET_TEXT.used);

  // "Change my reward wallet" without the X sign-in (a leaked link): the new wallet counts for contracts only.
  mock.timers.tick(60_000);
  const change = await mcpCall(ctx, 'tell', { wallet: 'change' });
  const cs = rule(show(change));
  assert.equal(cs, walletChangeX(short(signed.wallet), `https://earnkit.com/claim/wallet?t=${encodeURIComponent(tokenOf(cs))}`));
  assert.deepEqual(change.reply?.move_up, { kind: 'wallet', project_key: key, agent_note: WALLET_NOTE });
  const leaked = await sign(handle, cs);
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${c.id}`;
  assert.deepEqual({ line: leaked.line, recipient: leaked.recipient }, { line: walletContractsLine(signed.wallet), recipient: false });
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } })), walletContractsOnly(short(signed.wallet)));
  assert.equal(await provenWallet(c.id), signed.wallet, 'the rewards never moved');

  // With the page's X sign-in: the new wallet is the recipient, and the next reply says so once.
  mock.timers.tick(60_000);
  // Fix rounds 2 and 7: only when true, the Builder Code and a launched token's fees stay where they are.
  await sql()`UPDATE builder_profiles SET base_builder_code = 'bc_test' WHERE builder_id = ${c.id}`;
  await sql()`INSERT INTO projects (program_id, name, installation_id, token_url) VALUES ('earnkit-coin', 'Kit', ${c.id}, 'https://tokens.fun/kit')`;
  const change2 = await mcpCall(ctx, 'tell', { wallet: 'change' });
  const c2 = rule(show(change2));
  assert.ok(c2.endsWith(`\n${WALLET_BUILDER_CODE}\n${WALLET_COIN_FEES}\nDone?`), c2);
  const [{ x }] = await sql()<{ x: string }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${c.id}`;
  const xCookie = await walletXSignIn(tokenOf(c2), x);
  assert.ok(xCookie);
  const moved = await sign(handle, c2, undefined, xCookie);
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${c.id}`;
  assert.equal(moved.recipient, true);
  assert.equal(await provenWallet(c.id), moved.wallet);
  const next = show(await mcpCall(ctx, 'find', {}));
  assert.equal(next.split('\n')[0], walletNotice(short(moved.wallet)));
  assert.doesNotMatch(show(await mcpCall(ctx, 'find', {})), /Your reward wallet changed/, 'once');
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } })), walletDone(short(moved.wallet), true));

  // "Add my wallet": agents send the named address to find's wallet or tell's wallet. Either gets the signing link.
  const named = `0x${randomBytes(20).toString('hex')}`;
  const changeLine = new RegExp(`^Your rewards go to ${short(moved.wallet).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. To change that, sign in with X .*https://earnkit\\.com/claim/wallet\\?t=\\S+`);
  const viaFind = await mcpCall(ctx, 'find', { wallet: named });
  assert.match(show(viaFind), changeLine);
  assert.deepEqual(viaFind.reply?.move_up, { kind: 'wallet', project_key: key, agent_note: WALLET_NOTE });
  assert.match(show(await mcpCall(ctx, 'tell', { wallet: named })), changeLine);
  // The proven wallet itself is no request: the status reply.
  assert.doesNotMatch(show(await mcpCall(ctx, 'find', { wallet: moved.wallet })), /claim\/wallet/);
});

test('v3.1 cold read: no wallet step without contracts on Base known or reported, nor within 7 days of a coin\'s fee wallet', db, async () => {
  await start();
  // v4.0: the older step (walletOfferDue) keeps its rules, for a builder whose setup step 3 was not taken.
  const none = await rankedBuilder('n', { baseContract: false });
  assert.equal(await walletOfferDue(none.c.id, new Date()), null, 'no Base contract known or reported');
  // Reported by the builder (tell repo_facts: mainnet on Base): offered.
  await mcpCall(none.ctx, 'tell', { repo_facts: [{ repo: none.key, mainnet_chains: ['base'] }] });
  assert.ok(await walletOfferDue(none.c.id, new Date()), 'reported on Base: offered');
  // A fee wallet given for a coin within 7 days: never offered.
  const fee = await rankedBuilder('f');
  assert.ok(await walletOfferDue(fee.c.id, new Date()));
  await sql()`INSERT INTO projects (program_id, name, installation_id, creator_wallet, confirmed_at) VALUES ('earnkit-coin', 'Kit', ${fee.c.id}, ${`0x${randomBytes(20).toString('hex')}`}, ${new Date()})`;
  assert.equal(await walletOfferDue(fee.c.id, new Date()), null, 'a coin fee wallet in the last 7 days');
  await sql()`UPDATE projects SET confirmed_at = ${new Date(Date.now() - 8 * DAY)} WHERE installation_id = ${fee.c.id}`;
  assert.ok(await walletOfferDue(fee.c.id, new Date()), 'after 7 days: offered again');
});

test('"skip" is remembered and never asked again; a builder who already proved a wallet is never offered it', db, async () => {
  await start();
  const { c, ctx, key } = await rankedBuilder('s');
  const r = await mcpCall(ctx, 'find', {});
  rule(show(r));
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'wallet_setup');
  const no = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'no' } });
  // v4.0 Task 5: step 3's skip is the setup-done reply (approved copy 4), its first sentence the skip line.
  assert.ok(show(no).startsWith(WALLET_SETUP_SKIPPED), show(no));
  assert.equal(await walletSetupDue(c.id, new Date()), null, 'step 3 never asked again');
  const s = await seen(c.id);
  assert.equal(typeof s.wallet_asked, 'string');
  assert.equal(s.wallet_link_at, undefined, 'the wallet state ended');
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } })), 'Okay.');
  for (let i = 0; i < 2; i++) assert.doesNotMatch(show(await mcpCall(ctx, 'find', {})), /wallet/i);
  // Fix round 3: the news line's record of where the builder stands keeps every once-ask guard (stand-view.ts takeNews),
  // so a news line never re-asks the wallet step, the titles question or Base's steps.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('titles_asked', now()::text, 'qualify_given', jsonb_build_object(${key}::text, now()::text))
    WHERE builder_id = ${c.id}`;
  const { takeNews } = await import('./stand-view');
  await takeNews(c.id, {}, { standing: { ranked: true, rank: 2, total: 13 }, claimed: true, handle: 'x', signInLink: null }, new Date(), false);
  const kept = await seen(c.id);
  assert.equal(typeof kept.wallet_asked, 'string');
  assert.equal(typeof kept.titles_asked, 'string');
  assert.equal(typeof (kept.qualify_given as Record<string, string>)?.[key], 'string');
  assert.equal(await titlesAskDue(c.id, key, new Date()), false, 'titles never asked again');
  assert.equal(await walletOfferDue(c.id, new Date()), null, 'never offered again');

  // Proven before the offer (another person row): no offer, nothing claimed.
  const id = await person({ projects: [], claimed: `wpp${RUN}${randomBytes(2).toString('hex')}`, walletStep: true });
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${id})`;
  assert.equal(await walletOfferDue(id, new Date()), null);
  assert.equal((await seen(id)).wallet_asked, undefined);
  // Not signed in with X: no page to sign for, so no offer, and "change" says to sign in first.
  const plain = await person({ projects: [], walletStep: true });
  assert.equal(await walletOfferDue(plain, new Date()), null);
  const ch = await mcpCall({ installationId: plain, ownInstallationId: plain, sharedClient: false }, 'tell', { wallet: 'change' });
  assert.equal(show(ch), WALLET_SIGN_IN_FIRST);
  // A shared agent (many builders) is never given a wallet link.
  const shared = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: true }, 'tell', { wallet: 'change' });
  assert.doesNotMatch(show(shared), /https:/);
});

test('discovery: a proven wallet\'s own contracts on every chain show in Highlights (never the address); a token or an unused one never does', db, async () => {
  const key = `wpd${RUN}${randomBytes(2).toString('hex')}/app`;
  const id = await person({ projects: [{ key, name: 'App', confirmed: true }], main: key, claimed: `wpd${RUN}${randomBytes(2).toString('hex')}`, score: 50 });
  await sql()`UPDATE builder_projects SET chains = ${['base']} WHERE builder_id = ${id}`;
  const W = `0x${randomBytes(20).toString('hex')}`;
  const [contract, coin, eth] = [0, 1, 2].map(() => `0x${randomBytes(20).toString('hex')}`);
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const no = async () => {
    throw new Error('not read');
  };
  const firstTx: string[] = [];
  const reader = {
    gh: async () => null, ghGraphql: no, probe: no, fetchText: no, json: no,
    contractOrigin: async () => ({ deployer: W, created_at: '2025-05-02T00:00:00Z' }),
    // One read covers Base and the other chains: walletCreations is never asked.
    walletCreations: no,
    walletContracts: async () => [
      { chain: 'base', address: contract, created_at: '2025-05-02T00:00:00Z', counts: true },
      { chain: 'base', address: coin, created_at: '2025-06-02T00:00:00Z', counts: false },
      { chain: 'ethereum', address: eth, created_at: '2023-09-14T00:00:00Z', counts: true },
    ],
    walletFirstTx: async (w: string) => (firstTx.push(w), '2024-01-15T10:00:00Z'),
    now: new Date(),
  } as unknown as ReaderDeps;
  await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => null });
  assert.deepEqual(firstTx, [W]);
  const [src] = await sql()<{ state: string; proof: string }[]>`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND ref = ${`base:${contract}`}`;
  assert.deepEqual({ ...src }, { state: 'verified', proof: 'deploy_wallet' }, 'the Base claim still comes from the same read');
  const data = (await profileData(id, new Date())) as ProfileData;
  const items = await highlights(id, data, new Date());
  assert.deepEqual(items.find((h) => h.icon === 'contract'), {
    icon: 'contract', title: '2 contracts on 2 chains', sub: 'Since Sep 2023', href: `https://etherscan.io/address/${eth}`,
  });
  assert.doesNotMatch(JSON.stringify(items), new RegExp(`${W.slice(2)}|${coin.slice(2)}|On Base since`), 'never the wallet, the token or "On Base since"');
  // Read once: a second discovery doesn't ask the first transaction again.
  await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => null });
  assert.equal(firstTx.length, 1);
  // The read itself: one oldest-first txlist row; none is null.
  const paths: string[] = [];
  assert.equal(await walletFirstTxFrom(W, async (p) => (paths.push(p), { status: '1', result: [{ timeStamp: '1705312800' }] })), '2024-01-15T10:00:00.000Z');
  assert.equal(paths[0], `/api?module=account&action=txlist&address=${W}&sort=asc&page=1&offset=1`);
  assert.equal(await walletFirstTxFrom(W, async () => ({ status: '0', result: [] })), null);
  await assert.rejects(walletFirstTxFrom('nope', async () => ({})));
});

test('a proven wallet with no counted contract: no contract row (v3.1 Highlights competence: "On Base since" is out)', db, async () => {
  const key = `wpn${RUN}${randomBytes(2).toString('hex')}/app`;
  const id = await person({ projects: [{ key, name: 'App', confirmed: true }], main: key, claimed: `wpn${RUN}${randomBytes(2).toString('hex')}`, score: 50 });
  const W = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id, base_since) VALUES (${W}, ${id}, '2025-11-26T15:58:43Z')`;
  const items = await highlights(id, (await profileData(id, new Date())) as ProfileData, new Date());
  assert.ok(!items.some((h) => h.icon === 'contract'));
  assert.doesNotMatch(JSON.stringify(items), /On Base since|Wallet proven/);
});

test('the first transaction from the public RPC when the explorer refuses: a binary search on the nonce', async () => {
  const first = 38_691_688n;
  const reads: bigint[] = [];
  const rpc: NonceRpc = {
    latest: async () => 52_000_000n,
    count: async (_w, b) => (reads.push(b), b >= first ? 925 : 0),
    time: async (b) => (b === first ? 1764172723n : 0n),
  };
  const W = `0x${randomBytes(20).toString('hex')}`;
  assert.equal(await walletFirstTxRpc(W, rpc), '2025-11-26T15:58:43.000Z');
  assert.ok(reads.length <= 80, `${reads.length} reads`);
  assert.equal(await walletFirstTxRpc(W, { ...rpc, count: async () => 0 }), null, 'never sent one');
  await assert.rejects(walletFirstTxRpc('nope', rpc));
});

test('Blockscout: the keyed API when BLOCKSCOUT_API_KEY is set, else the public host', () => {
  assert.equal(blockscoutUrl('/api/v2/addresses/0xab', {}), 'https://base.blockscout.com/api/v2/addresses/0xab');
  assert.equal(blockscoutUrl('/api/v2/addresses/0xab', { BLOCKSCOUT_API_KEY: 'k1' }), 'https://api.blockscout.com/8453/api/v2/addresses/0xab?apikey=k1');
  assert.equal(blockscoutUrl('/api?module=account&action=txlist', { BLOCKSCOUT_API_KEY: 'k1' }), 'https://api.blockscout.com/8453/api?module=account&action=txlist&apikey=k1');
  assert.equal(blockscoutUrl('/api/v2/x', { BLOCKSCOUT_API_KEY: 'k1', EARNKIT_BLOCKSCOUT_URL: 'http://localhost:9', NODE_ENV: 'test' }), 'http://localhost:9/api/v2/x', 'the test explorer wins');
});

test('the hero\'s GitHub button: the repo when public; the builder\'s GitHub profile when the repo is private; hidden with neither', () => {
  assert.equal(githubProfileHref('maya-dev'), 'https://github.com/maya-dev');
  assert.equal(githubProfileHref('bad/login'), null);
  assert.equal(githubProfileHref(null), null);
  const hero = (data: ProfileData, repo: string | null) =>
    renderToStaticMarkup(React.createElement(HeroCard, { data, site: { ...MAYA_SITE, project: { ...MAYA_SITE.project!, repo } }, line: null }));
  const priv: ProfileData = { ...MAYA, project: { ...MAYA.project!, name: PRIVATE_NAME, repo: null } };
  assert.match(hero({ ...priv, github: 'https://github.com/maya-dev' }, null), /<a href="https:\/\/github\.com\/maya-dev"[^>]*aria-label="GitHub"/);
  assert.doesNotMatch(hero({ ...priv, github: null }, null), /aria-label="GitHub"/);
  assert.match(hero({ ...MAYA, github: 'https://github.com/maya-dev' }, 'https://github.com/maya/tipjar'), /<a href="https:\/\/github\.com\/maya\/tipjar"[^>]*aria-label="GitHub"/);
});

test('profileData carries the GitHub profile from the stored login', db, async () => {
  const key = `wpg${RUN}${randomBytes(2).toString('hex')}/app`;
  const id = await person({ projects: [{ key, name: 'App', confirmed: true }], main: key, claimed: `wpg${RUN}${randomBytes(2).toString('hex')}` });
  assert.equal((await profileData(id, new Date()))?.github, null);
  await sql()`UPDATE builder_profiles SET github_login = ${`wpg-${id}`} WHERE builder_id = ${id}`;
  assert.equal((await profileData(id, new Date()))?.github, `https://github.com/wpg-${id}`);
});

test('v4.0 final review 4: a launched builder token also gets "Your token\'s fees keep going to the wallet it launched with."', db, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v40-chg-${randomBytes(6).toString('hex')}`}) RETURNING id`;
  const handle = `chg${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, x_name) VALUES (${id}, ${`chg-${id}`}, ${`x-chg-${id}`}, ${handle}, 'Maya')`;
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${wallet}, ${id}, now())`;
  const line = async () => String((await walletChangeReply(id, new Date())).show_to_builder);
  // Launching (not live yet): no fee line.
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, wallet) VALUES (${id}, ${`x-chg-${id}`}, 'launching', ${wallet})`;
  assert.ok(!(await line()).includes(WALLET_COIN_FEES));
  await sql()`UPDATE builder_tokens SET status = 'launched', coin_address = ${`0x${randomBytes(20).toString('hex')}`} WHERE builder_id = ${id}`;
  const s = await line();
  assert.ok(s.endsWith(`\n${WALLET_COIN_FEES}\nDone?`), s);
});
