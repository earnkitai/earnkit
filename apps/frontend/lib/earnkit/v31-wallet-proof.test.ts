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
import { attachToX, bindX } from './x-install';
import { productOdds, productScore, traction } from './match';
import type { RepoFit } from './present';
import {
  MOMENT_ASK, SHIP_ASK, TITLES_ASK, WALLET_ASK, WALLET_DONE, WALLET_SKIPPED, stateAsk, walletChange, walletNotYet, walletOffer,
  type BenchProject,
} from './bench-reply';
import { WALLET_NOTE, WALLET_SIGN_IN_FIRST, walletOfferLink } from './wallet-offer';
import { WALLET_TEXT, provenWallet, upgradeOf, walletMessage, walletPost } from './wallet-proof';
import { COIN_WALLET_ASK, coinWallet, coinYes, offerCoin } from './coin-moments';
import { discoverPerson } from './discovery';
import { walletFirstTxFrom, type ReaderDeps } from './source-readers';
import { highlights } from './site-data';
import { githubProfileHref, profileData, type ProfileData } from './bench-data';
import HeroCard from '../../app/[handle]/site/HeroCard';
import { MAYA, MAYA_SITE } from './fixtures/profile-data';
import { PRIVATE_NAME } from './page-data';

/**
 * v3.1 wallet proof (owner-approved 2026-10-23): the optional wallet step right after setup, once, never with another
 * question; "done" checks the signature, "skip" is remembered; "change my reward wallet" sends a fresh link; the newest
 * proven wallet is the reward recipient (coin fees, program payouts); a proof queues discovery, whose contracts and
 * "On Base since" show in Highlights; the hero's GitHub button falls back to the builder's GitHub profile.
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
/** Every wallet reply: exactly one https link, exactly one question, no em dash or emoji, never a wallet address. */
const rule = (s: string) => {
  assert.equal(links(s).length, 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}/u, s);
  assert.doesNotMatch(s, /0x[0-9a-f]{40}/i, s);
  return s;
};
const viemVerify = (a: { address: string; message: string; signature: string }) =>
  verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` });
const tokenOf = (s: string) => decodeURIComponent(/https:\/\/earnkit\.com\/claim\/wallet\?t=(\S+)/.exec(s)![1]);
/** Signs the link's message with `acct` and posts it as the page does. */
async function sign(handle: string, s: string, acct = privateKeyToAccount(generatePrivateKey())) {
  const t = tokenOf(s);
  const signature = await acct.signMessage({ message: walletMessage(handle, t) });
  const r = await walletPost(
    new Request('https://earnkit.com/claim/wallet', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com' }, body: JSON.stringify({ t, wallet: acct.address, signature }) }),
    { limit: async () => {}, verify: viemVerify },
  );
  return { status: r.status, line: ((await r.json()) as { line: string }).line, wallet: acct.address.toLowerCase() };
}

test('the copy, word for word: the offer, the change link, done, not yet, skipped', () => {
  const L = 'https://earnkit.com/claim/wallet?t=1.2.x';
  assert.equal(walletOffer(L), `Optional: prove your Base wallet so your contracts show on your page. One signature, no fee: ${L}\nDone, or want to skip it?`);
  assert.equal(walletChange(L), `Sign with the wallet you want your rewards sent to. One signature, no fee: ${L}\nDone?`);
  assert.equal(walletNotYet(L), `I don't see a signature yet. Here's a fresh link (one signature, no fee): ${L}\nDone?`);
  assert.equal(WALLET_DONE, 'Done. Your rewards now go to the wallet you signed with, and your contracts on Base will show on your page soon.');
  assert.equal(WALLET_SKIPPED, 'Skipped. Ask me anytime to add your reward wallet.');
  for (const s of [walletOffer(L), walletChange(L), walletNotYet(L)]) rule(s);
});

test('the wallet step never shares a reply with another question: after connect, a post, apply, backing and the weekly moment; before titles, Base steps and ship', () => {
  const project: BenchProject = { key: 'kit/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const v = { state: 'ranked' as const, variant: null, project, link: null, handle: 'kit', wallet: 'https://earnkit.com/claim/wallet?t=x' };
  assert.equal(stateAsk({ ...v, connect: { weeks: 3, points: 40 } }).kind, 'connect');
  assert.equal(stateAsk({ ...v, apply: { program_id: 'p', title: 'P', amount: null, when: null } }).kind, 'apply');
  assert.equal(stateAsk({ ...v, backing: 'Want backing?' }).kind, 'backing');
  assert.equal(stateAsk({ ...v, share: true }).line, MOMENT_ASK);
  const w = stateAsk({ ...v, titles: true });
  assert.equal(w.kind, 'wallet');
  assert.ok(w.line.endsWith(WALLET_ASK));
  assert.equal(stateAsk({ ...v, wallet: null, titles: true }).line, TITLES_ASK);
  assert.equal(stateAsk({ ...v, wallet: null }).line, SHIP_ASK);
  assert.equal(stateAsk({ ...v, state: 'no_project', link: 'https://x' }).kind, 'pick_repo', 'never before setup is done');
});

/** A signed-in builder whose one project is ranked through the App (pool of 13), the connect offer shown. */
async function rankedBuilder(tag: string) {
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
  const r3 = await mcpCall(ctx, 'find', {});
  // The reply after the App connects asks its own question (the connect weeks): never the wallet beside it.
  assert.equal((r3.reply?.move_up as { kind: string }).kind, 'connect', show(r3));
  assert.doesNotMatch(show(r3), /wallet/i);
  // The connect yes: its own reply (the page link) never carries the wallet either.
  const yes = show(await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } }));
  assert.doesNotMatch(yes, /wallet/i);
  return { c, ctx, key, handle };
}
const start = async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);
};
const seen = async (id: number) => (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;

test('offered once, in the first reply after setup with no other question; "done" before signing sends a fresh link; signing proves it, queues discovery, and "done" is done', db, async () => {
  await start();
  const { c, ctx, key, handle } = await rankedBuilder('o');
  const r = await mcpCall(ctx, 'find', {});
  const s = rule(show(r));
  const lines = s.split('\n');
  assert.match(lines[0], /^Kit · #\d+ of 13 builders · \d+ weeks? in a row$/);
  assert.match(lines[1], /^Optional: prove your Base wallet so your contracts show on your page\. One signature, no fee: https:\/\/earnkit\.com\/claim\/wallet\?t=\S+$/);
  assert.equal(lines[2], 'Done, or want to skip it?');
  assert.equal(lines.length, 3, 'no money line, no points line');
  assert.deepEqual(r.reply?.move_up, { kind: 'wallet', project_key: key, agent_note: WALLET_NOTE });
  assert.equal(upgradeOf(tokenOf(s), new Date()), c.id, 'a fresh link for this builder');

  // "Done" before the signature: a fresh link (the first may have expired) and the same question, the ask kept.
  const notYet = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } });
  const ns = rule(show(notYet));
  assert.match(ns, /^I don't see a signature yet\. Here's a fresh link \(one signature, no fee\): https:\/\/earnkit\.com\/claim\/wallet\?t=\S+\nDone\?$/);
  assert.deepEqual(notYet.reply?.move_up, { kind: 'wallet', project_key: key, agent_note: WALLET_NOTE });
  // Signing on the page proves it and queues discovery (walletCreations then finds its contracts).
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${c.id}`;
  const signed = await sign(handle, ns);
  assert.deepEqual({ status: signed.status, line: signed.line }, { status: 200, line: WALLET_TEXT.done });
  const [q] = await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${c.id}`;
  assert.deepEqual({ ...q }, { reason: 'wallet', done_at: null });
  assert.equal(await provenWallet(c.id), signed.wallet);
  // The hourly discover step reads it (discovery tests); here it is marked done so a refresh never reads the network.
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${c.id}`;
  const done = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } });
  assert.equal(show(done), WALLET_DONE);
  // Answered once; the next replies never offer it again.
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } })), 'Okay.');
  for (let i = 0; i < 2; i++) assert.doesNotMatch(show(await mcpCall(ctx, 'find', {})), /wallet/i);
  // The same link never proves a second wallet.
  assert.equal((await sign(handle, ns)).line, WALLET_TEXT.used);

  // "Change my reward wallet": a fresh link; the wallet proven with it becomes the recipient.
  mock.timers.tick(60_000);
  const change = await mcpCall(ctx, 'tell', { wallet: 'change' });
  const cs = rule(show(change));
  assert.match(cs, /^Sign with the wallet you want your rewards sent to\. One signature, no fee: https:\/\/earnkit\.com\/claim\/wallet\?t=\S+\nDone\?$/);
  assert.deepEqual(change.reply?.move_up, { kind: 'wallet', project_key: key, agent_note: WALLET_NOTE });
  const next = await sign(handle, cs);
  assert.equal(next.status, 200);
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'yes' } })), WALLET_DONE);
  assert.equal(await provenWallet(c.id), next.wallet, 'the newest proven wallet is the recipient');
  assert.equal(await coinWallet(c.id), next.wallet);
});

test('"skip" is remembered and never asked again; a builder who already proved a wallet is never offered it', db, async () => {
  await start();
  const { c, ctx, key } = await rankedBuilder('s');
  const r = await mcpCall(ctx, 'find', {});
  rule(show(r));
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'wallet');
  const no = await mcpCall(ctx, 'tell', { move_up: { kind: 'wallet', project_key: key, answer: 'no' } });
  assert.equal(show(no), WALLET_SKIPPED);
  const s = await seen(c.id);
  assert.equal(typeof s.wallet_skipped, 'string');
  assert.equal(typeof s.wallet_asked, 'string');
  for (let i = 0; i < 2; i++) assert.doesNotMatch(show(await mcpCall(ctx, 'find', {})), /wallet/i);
  // The news line's record of where the builder stands keeps both (stand-view.ts takeNews).
  const { takeNews } = await import('./stand-view');
  await takeNews(c.id, {}, { standing: { ranked: true, rank: 2, total: 13 }, claimed: true, handle: 'x', signInLink: null }, new Date(), false);
  const kept = await seen(c.id);
  assert.equal(typeof kept.wallet_asked, 'string');
  assert.equal(typeof kept.wallet_skipped, 'string');
  assert.equal(await walletOfferLink(c.id, new Date()), null, 'never offered again');

  // Proven before the offer (another person row): no offer, nothing claimed.
  const id = await person({ projects: [], claimed: `wpp${RUN}${randomBytes(2).toString('hex')}`, walletStep: true });
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${id})`;
  assert.equal(await walletOfferLink(id, new Date()), null);
  assert.equal((await seen(id)).wallet_asked, undefined);
  // Not signed in with X: no page to sign for, so no offer, and "change" says to sign in first.
  const plain = await person({ projects: [], walletStep: true });
  assert.equal(await walletOfferLink(plain, new Date()), null);
  const ch = await mcpCall({ installationId: plain, ownInstallationId: plain, sharedClient: false }, 'tell', { wallet: 'change' });
  assert.equal(show(ch), WALLET_SIGN_IN_FIRST);
  // A shared agent (many builders) is never given a wallet link.
  const shared = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: true }, 'tell', { wallet: 'change' });
  assert.doesNotMatch(show(shared), /https:/);
});

test('the proven wallet is the reward recipient: coin fees use it without asking; with none, the wallet is asked', db, async () => {
  const claimedPerson = async (tag: string) => {
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v31wp-${tag}-${randomBytes(8).toString('hex')}`}) RETURNING id`;
    await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v31wp-${id}`})`;
    assert.ok((await bindX(id, { id: `v31wp${randomBytes(6).toString('hex')}`, username: `${tag}${randomBytes(3).toString('hex')}`, name: tag, avatar: null }, new Date())).ok);
    const key = `lee/${tag}${randomBytes(3).toString('hex')}`;
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, last_active_at) VALUES (${id}, ${key}, 'Tip Jar', 'app', true, true, 9, now())`;
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at, public_at) VALUES (${id}, 'repo', ${key}, ${key}, 'repo_owner', 'verified', 'server', now(), now())`;
    return { id, key };
  };
  const noCheck = { check: async () => true };
  // No wallet anywhere: the yes asks for one (COIN_WALLET_ASK).
  const a = await claimedPerson('wpa');
  assert.ok(await offerCoin(a.id, a.key, 'has_people', noCheck));
  assert.deepEqual(await coinYes(a.id, a.key, null, noCheck), { show_to_builder: COIN_WALLET_ASK });
  // Proven after the offer (the offer named no wallet): the yes uses it, never asks.
  const W1 = `0x${randomBytes(20).toString('hex')}`;
  const W2 = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id, proven_at) VALUES (${W1}, ${a.id}, now() - interval '1 day'), (${W2}, ${a.id}, now())`;
  assert.equal(await coinWallet(a.id), W2, 'the newest proven wallet');
  const yes = await coinYes(a.id, a.key, null, noCheck);
  assert.ok('project_id' in yes, JSON.stringify(yes));
  assert.equal((yes as { wallet: string }).wallet, W2);
  // An offer made after the proof names it before the yes.
  const b = await claimedPerson('wpb');
  const W3 = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W3}, ${b.id})`;
  const offer = await offerCoin(b.id, b.key, 'has_people', noCheck);
  assert.equal(offer?.wallet, W3);
});

test('discovery: a proven wallet\'s contracts and its first Base transaction show in Highlights (never the address)', db, async () => {
  const key = `wpd${RUN}${randomBytes(2).toString('hex')}/app`;
  const id = await person({ projects: [{ key, name: 'App', confirmed: true }], main: key, claimed: `wpd${RUN}${randomBytes(2).toString('hex')}`, score: 50 });
  await sql()`UPDATE builder_projects SET chains = ${['base']} WHERE builder_id = ${id}`;
  const W = `0x${randomBytes(20).toString('hex')}`;
  const contract = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const no = async () => {
    throw new Error('not read');
  };
  const firstTx: string[] = [];
  const reader = {
    gh: async () => null, ghGraphql: no, probe: no, fetchText: no, json: no,
    contractOrigin: async () => ({ deployer: W, created_at: '2025-05-02T00:00:00Z' }),
    walletCreations: async () => [{ address: contract, created_at: '2025-05-02T00:00:00Z' }],
    walletFirstTx: async (w: string) => (firstTx.push(w), '2024-01-15T10:00:00Z'),
    now: new Date(),
  } as unknown as ReaderDeps;
  await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => null });
  assert.deepEqual(firstTx, [W]);
  const [src] = await sql()<{ state: string; proof: string }[]>`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND ref = ${`base:${contract}`}`;
  assert.deepEqual({ ...src }, { state: 'verified', proof: 'deploy_wallet' });
  const data = (await profileData(id, new Date())) as ProfileData;
  const items = await highlights(id, data, new Date());
  assert.deepEqual(items.find((h) => h.icon === 'contract'), {
    icon: 'contract', title: '1 contract on Base', sub: 'First deployed May 2025 · On Base since Jan 2024', href: `https://basescan.org/address/${contract}`,
  });
  assert.doesNotMatch(JSON.stringify(items), new RegExp(W.slice(2)), 'never the wallet');
  // Read once: a second discovery doesn't ask again.
  await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => null });
  assert.equal(firstTx.length, 1);
  // The read itself: one oldest-first txlist row; none is null.
  const paths: string[] = [];
  assert.equal(await walletFirstTxFrom(W, async (p) => (paths.push(p), { status: '1', result: [{ timeStamp: '1705312800' }] })), '2024-01-15T10:00:00.000Z');
  assert.equal(paths[0], `/api?module=account&action=txlist&address=${W}&sort=asc&page=1&offset=1`);
  assert.equal(await walletFirstTxFrom(W, async () => ({ status: '0', result: [] })), null);
  await assert.rejects(walletFirstTxFrom('nope', async () => ({})));
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
