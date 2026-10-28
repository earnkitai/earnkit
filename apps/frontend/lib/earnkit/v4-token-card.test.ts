import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Hex } from 'viem';
import { sql } from './db';
import { person } from './fixtures/find';
import { setFeeSource } from './fees';
import { profileData, type ProfileData } from './bench-data';
import { BASE_GENESIS_UNIX, profileSite, type TokenCard as Token } from './site-data';
import { BACKERS_SHOWN_FROM, postCardFacts, postCardView } from './post-card';
import { createDraft } from './post-drafts';
import { lastFinishedMonday } from './weeks';
import { CONFIRMATIONS, type BonusRpc, type TxLog } from './bonus-ledger';
import { POOL_MANAGER, backersOf, indexBackers } from './backers';
import { allTimeCommunityUsd } from './community';
import { shareCardFacts } from '../../app/[handle]/card-facts';
import TokenCard from '../../app/[handle]/site/TokenCard';
import { MAYA, MAYA_SITE } from './fixtures/profile-data';

/**
 * v4.0 Task 9: the builder page's navy Token card and the post card show the builder's own token (builder_tokens
 * status 'launched'), never a project's coin: $SYMBOL, holders, fees earned by the builder, 12 weeks of new holders,
 * "Trade" to Uniswap, and the builder's X photo in the circle.
 */
(globalThis as { React?: typeof React }).React = React;
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  setFeeSource(null);
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date('2026-10-21T12:00:00Z');
const RUN = randomBytes(2).toString('hex');
let n = 0;
const addr = () => `0x${randomBytes(20).toString('hex')}`;
/** $2,000 a WETH. */
const PRICE = 2000;
const wei = (usd: number) => ((BigInt(Math.round(usd * 1e6)) * 10n ** 18n) / BigInt(PRICE * 1e6)).toString();
const blockAt = (t: number) => Math.ceil((t / 1000 - BASE_GENESIS_UNIX) / 2);
const page = async (id: number) => (await profileData(id, NOW)) as ProfileData;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const words = (h: string) => h.replace(/<span data-ek-sign=""[^>]*>([^<]*)<\/span>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** A claimed builder named Maya Lee, with an X photo, on `key` (default: their own repo). */
async function builder(o: { key?: string; avatar?: string | null } = {}) {
  n++;
  const key = o.key ?? `t9${RUN}o${n}/app${n}`;
  const id = await person({ projects: [{ key, name: `App ${n}`, confirmed: true }], main: key, claimed: `t9${RUN}${n}`, score: 50 });
  await sql()`UPDATE builder_profiles SET x_name = 'Maya Lee', x_avatar_url = ${o.avatar === undefined ? 'https://pbs.twimg.com/maya.jpg' : o.avatar} WHERE builder_id = ${id}`;
  return { id, key, handle: `t9${RUN}${n}` };
}
async function token(id: number, status: string, o: { symbol?: string; coin?: string | null; wallet?: string | null } = {}) {
  await sql()`
    INSERT INTO builder_tokens (builder_id, x_user_id, status, symbol, coin_address, wallet)
    VALUES (${id}, ${`x${id}`}, ${status}, ${o.symbol ?? 'MAYA'}, ${o.coin === undefined ? addr() : o.coin}, ${o.wallet === undefined ? addr() : o.wallet})`;
  const [t] = await sql()<{ coin_address: string; wallet: string }[]>`SELECT coin_address, wallet FROM builder_tokens WHERE builder_id = ${id}`;
  return t;
}

test('(a) a launched builder token: site.token with the Uniswap url, holders, all-time fees and 12 weeks; the X photo (https only)', db, async () => {
  setFeeSource({ availableWeth: async () => 0n, wethUsd: async () => PRICE });
  const b = await builder();
  const t = await token(b.id, 'launched');
  // 6 holders, 2 of them new this week; fees: $30 + $16 claimed to the token's wallet, $500 to someone else, $99 as Safe.
  for (let i = 0; i < 6; i++)
    await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${t.coin_address}, ${addr()}, ${blockAt(NOW.getTime() - (i < 2 ? 1 : 20) * 86_400_000)})`;
  const claim = (owner: string, usd: number, role = 'creator') =>
    sql()`INSERT INTO fee_claims (tx_hash, owner, role, weth, gas_wei, at) VALUES (${`0x${randomBytes(32).toString('hex')}`}, ${owner}, ${role}, ${wei(usd)}, 0, ${new Date(NOW.getTime() - 400 * 86_400_000)})`;
  await claim(t.wallet.toUpperCase().replace('0X', '0x'), 30);
  await claim(t.wallet, 16);
  await claim(addr(), 500);
  await claim(t.wallet, 99, 'safe');
  const s = await profileSite(b.id, await page(b.id), NOW);
  assert.ok(s.token, 'the Token card');
  assert.equal(s.token.symbol, 'MAYA');
  assert.equal(s.token.url, `https://app.uniswap.org/swap?chain=base&outputCurrency=${t.coin_address}`);
  assert.equal(s.token.backers, 6);
  assert.equal(Math.round(s.token.fees_usd), 46);
  assert.equal(s.token.weeks.length, 12);
  assert.equal(s.token.weeks[11], 2, 'this week: 2 new holders');
  assert.equal(s.token.photo, 'https://pbs.twimg.com/maya.jpg');
  assert.equal(s.token.letter, 'M', "the builder's initial");
  assert.equal(Math.round(await allTimeCommunityUsd(b.id, async () => PRICE)), 46);
  // No price: 0, never a wrong number.
  assert.equal(await allTimeCommunityUsd(b.id, async () => null), 0);
  // An http photo never shows; the initial does.
  const plain = await builder({ avatar: 'http://pbs.twimg.com/maya.jpg' });
  await token(plain.id, 'launched');
  assert.equal((await profileSite(plain.id, await page(plain.id), NOW)).token?.photo, null);
  // The token is the builder's, not the project's: shown on EarnKit's own repo too, and with EARNKIT_RAISING off.
  const own = await builder({ key: `earnkitai/t9${RUN}` });
  await token(own.id, 'launched', { symbol: 'JENIL' });
  assert.equal((await profileSite(own.id, await page(own.id), NOW)).token?.symbol, 'JENIL');
});

test('(a2) indexBackers indexes a launched builder token, its creator wallet never a holder', db, async () => {
  const b = await builder();
  const t = await token(b.id, 'launched');
  const coin = t.coin_address as Hex;
  const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  const log = (from: string, to: string, block: bigint): TxLog => ({
    address: coin, topics: encodeEventTopics({ abi: [TRANSFER], eventName: 'Transfer', args: { from: from as Hex, to: to as Hex } }) as Hex[],
    data: encodeAbiParameters([{ type: 'uint256' }], [1000n]), logIndex: 1, txHash: `0x${randomBytes(32).toString('hex')}` as Hex, blockNumber: block,
  });
  const logs = [log(POOL_MANAGER, addr(), 1_100n), log(POOL_MANAGER, addr(), 1_200n), log(POOL_MANAGER, t.wallet, 1_300n)];
  const rpc = {
    blockNumber: async () => 1_500n + CONFIRMATIONS,
    receiptLogs: async () => ({ blockNumber: 1_000n, logs: [] }),
    transferLogs: async (c: Hex, lo: bigint, hi: bigint) => logs.filter((l) => l.address === c && l.blockNumber >= lo && l.blockNumber <= hi),
    poolHooks: async () => null,
  } as unknown as BonusRpc;
  await sql()`UPDATE builder_tokens SET tx_hash = ${`0x${'ab'.repeat(32)}`} WHERE builder_id = ${b.id}`;
  const r = await indexBackers(NOW, { rpc, deadline: Date.now() + 25_000, only: [coin] });
  assert.equal((r as { coins: number }).coins, 1, JSON.stringify(r));
  assert.equal((await backersOf([coin])).get(coin), 2);
});

test('(b) declined, unknown, launching or no row: no Token card and no post card pill', db, async () => {
  const none = await builder();
  assert.equal((await profileSite(none.id, await page(none.id), NOW)).token, null);
  for (const status of ['declined', 'unknown', 'launching']) {
    const b = await builder();
    await token(b.id, status, status === 'declined' ? { coin: null, wallet: null } : {});
    assert.equal((await profileSite(b.id, await page(b.id), NOW)).token, null, status);
  }
  // A project's coin with backing open (the v3 raising path) never makes the card now.
  const old = await builder();
  const c = addr();
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_launched_at, coin_address)
    VALUES ('earnkit-coin', 'Kit', ${`https://github.com/${old.key}`}, ${`github.com/${old.key.toLowerCase()}`}, ${old.id}, 'KIT', 'launched', ${`https://tokens.fun/coin/${c}`}, now(), now(), ${c})`;
  const before = process.env.EARNKIT_RAISING;
  process.env.EARNKIT_RAISING = 'on';
  try {
    assert.equal((await profileSite(old.id, await page(old.id), NOW)).token, null);
  } finally {
    if (before === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = before;
  }
});

const TOK: Token = { symbol: 'MAYA', url: 'https://app.uniswap.org/swap?chain=base&outputCurrency=0xabc', backers: 23, fees_usd: 412, weeks: [0, 1, 0, 2, 1, 3, 2, 4, 3, 2, 5, 4], letter: 'M', color: 'rgb(1, 2, 3)', photo: 'https://pbs.twimg.com/maya.jpg' };

test("(c) the card: $SYMBOL, \"<first>'s token on Base\", holders, earned by <first>, Trade (new tab), keeps 40%; the X photo in the circle", async () => {
  const h = html(React.createElement(TokenCard, { token: TOK, first: 'Maya' }));
  const w = words(h);
  for (const s of ['$MAYA', "Maya's token on Base", '23', 'holders', '$412', 'earned by Maya', 'Trade', 'Maya keeps 40% of fees']) assert.ok(w.includes(s), s);
  for (const s of ['Back', 'backers', 'coin', 'Coin']) assert.ok(!w.includes(s), s);
  assert.match(h, /<a[^>]*href="https:\/\/app\.uniswap\.org\/swap\?chain=base&outputCurrency=0xabc"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Trade<\/a>/);
  // The photo fills the circle (the ring stays); a plain <img>, never the Next image optimizer.
  assert.match(h, /<span[^>]*shadow-\[inset_0_0_0_3px_var\(--ek-s-coin-ring\)\][^>]*>[\s\S]*?<img[^>]*src="https:\/\/pbs\.twimg\.com\/maya\.jpg"/);
  assert.doesNotMatch(h, /_next\/image/);
  assert.match(h, /aria-label="New holders each week, last 12 weeks"/);
  // No photo: the builder's initial on the colour.
  const plain = html(React.createElement(TokenCard, { token: { ...TOK, photo: null }, first: 'Maya' }));
  assert.doesNotMatch(plain, /<img/);
  assert.match(plain, /style="background:rgb\(1, 2, 3\)">M</);
  // The profile page draws it from site.token.
  assert.ok(words(html(React.createElement((await import('../../app/[handle]/BenchProfileView')).default, { data: MAYA, site: { ...MAYA_SITE, token: TOK }, page: 1 }))).includes("Maya's token on Base"));
});

test('(d) the post card pill reads the builder token: "$SYMBOL · N holders" from 5, else "$SYMBOL"; the share tile says holders', db, async () => {
  const card = { project: 'Recipes', streak: 6, score: 72, rank: null, grid: Array(12).fill(true), week: 6, summary: 'Shipped it.', commits: 3 };
  const d = { moment: 'weekly' as const, proof_url: null, card };
  assert.equal(postCardView(d, { backing: null })!.backing, null);
  assert.equal(postCardView(d, { backing: { symbol: 'MAYA', holders: BACKERS_SHOWN_FROM - 1 } })!.backing, '$MAYA');
  assert.equal(postCardView(d, { backing: { symbol: 'MAYA', holders: 1234 } })!.backing, '$MAYA · 1,234 holders');
  assert.ok(!postCardView(d, { backing: { symbol: 'MAYA', holders: 1234 } })!.stats.some((s) => /backers|holders/.test(s.label)), 'the pill has the count');
  // Live from builder_tokens.
  const b = await builder();
  const now = new Date();
  const monday = lastFinishedMonday(now);
  const draft = await createDraft({ builderId: b.id, projectKey: b.key, moment: 'weekly', momentKey: `weekly:${b.key}:${monday}`, shape: 'change', text: 'Shipped it.', card: { ...card, monday }, asked: false }, now);
  assert.ok(draft.ok);
  assert.equal((await postCardFacts(b.id, draft.draft.code))!.view.backing, null, 'no token: no pill');
  const t = await token(b.id, 'launched', { symbol: 'MAYA' });
  assert.equal((await postCardFacts(b.id, draft.draft.code))!.view.backing, '$MAYA');
  for (let i = 0; i < 5; i++) await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${t.coin_address}, ${addr()}, 1)`;
  assert.equal((await postCardFacts(b.id, draft.draft.code))!.view.backing, '$MAYA · 5 holders');
  await sql()`UPDATE builder_tokens SET status = 'unknown' WHERE builder_id = ${b.id}`;
  assert.equal((await postCardFacts(b.id, draft.draft.code))!.view.backing, null, 'unknown: no pill');
  // The share card's tile: the symbol and holders from 5.
  const site = { ...MAYA_SITE, token: TOK };
  assert.deepEqual(shareCardFacts(MAYA, site).tiles.find((x) => x.kind === 'backing'), { kind: 'backing', symbol: 'MAYA', backers: 23 });
});
