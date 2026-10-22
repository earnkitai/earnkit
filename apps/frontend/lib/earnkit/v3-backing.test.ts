import { after, test } from 'node:test';
import { RANK_MIN_POOL } from './rank';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { withEnv } from './fixtures/find';
import { BENCH_EXTRA, bannedInBench } from './fixtures/banned-words';
import { pageWords, unsign } from './fixtures/page-words';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { lastFinishedMonday } from './weeks';
import { BACKING_OFFER, COIN_YES_NOTE, coinAllowed, raiseLine } from './coin-moments';
import { BACKING_NOT_YET, tokenUnavailable } from './bench-find';
import { RAISE_LINES, showRaisingLine } from './raising';
import { backingLine } from './bench-reply';
import { BACKING_EXCLUDED_REPOS } from './policy-constants';
import { BACKING_POINTS } from './policy';
import { benchCardFacts, benchRows, filterHref, parseBenchFilter, profileData } from './bench-data';
import { builderJson, builderResponse } from './builder-json';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { profileSite } from './site-data';
import BenchView, { FILTER_BACKED } from '../../app/leaderboard/BenchView';
import BenchRowItem from '../../app/leaderboard/BenchRowItem';
import RaisingPill from '../../app/components/ui/RaisingPill';
import { benchCard } from '../../app/[handle]/card-response';
import PolicySection from '../../app/terms/sections/PolicySection';

/**
 * v3 Stage 2 Task 3 (spec 5.3 Route 2): Backing. The coin is offered once, in the first ranked reply after the builder's
 * first approved week with code; every word is Backing; EARNKIT_RAISING gates every coin-facing surface; the owner's repo
 * is never offered; the page's Back button, the Backed chip and filter, the terms section and the builder JSON.
 */
(globalThis as { React?: typeof React }).React = React;
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v3-backing-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const WALLET = '0x12ab000000000000000000000000000000009f3e';
const ON = { EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'v3-backing-key' };
const OFF = { EARNKIT_RAISING: undefined, TOKENSFUN_DEPLOY_API_KEY: 'v3-backing-key' };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const off = <T>(fn: () => Promise<T>) => withEnv(OFF, fn);
let n = 0;

type B = { ctx: Parameters<typeof mcpCall>[0]; id: number; key: string; handle: string };
/** A ranked builder (signed in with X, the repo proven by the App and read public), with a proven wallet. */
async function builder(tag: string, o: { key?: string; week?: boolean; private?: boolean; programs?: string[] } = {}): Promise<B> {
  n++;
  const t = `ek_v3b_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `vb${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `98${RUN}${n}${tag.length}`, username: handle, name: 'vb', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = o.key ?? `vb${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const verdicts = (o.programs ?? []).map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }));
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts }];
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never,
    tokenDeps: { check: async () => true },
  } as Parameters<typeof mcpCall>[0];
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 7000 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key.toLowerCase()]: o.key
    ? { id: gid, owner: key.split('/')[0], ownerType: 'Organization', admins: [handle], installation: gid + 1, private: o.private }
    : { id: gid, owner: handle, installation: gid + 1, private: o.private } }) });
  // The connect weeks are another task's moment: answered, so they never take the step here.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  if (!o.private) await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${(c.id + 1000).toString(16).padStart(40, '0')}`}, ${c.id}) ON CONFLICT DO NOTHING`;
  const b = { ctx, id: c.id, key, handle };
  if (o.week) await approvedWeek(b);
  return b;
}
/** Last week's ship-log row of the one project, with code and the builder's yes. */
async function approvedWeek(b: B, f: Record<string, unknown> = { shipped_code: { n: 3 }, checked: true, approved: true }) {
  await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${b.id}, ${b.key}, ${lastFinishedMonday(new Date())}, ${sql().json(f as never)})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts`;
}
const find = (b: B) => mcpCall(b.ctx, 'find', {});
const tell = (b: B, args: Record<string, unknown>) => mcpCall(b.ctx, 'tell', args);
const lastLine = (s: string) => s.split('\n').at(-1) ?? '';
const moments = async (id: number) => (await sql()<{ moment: string; answer: string | null }[]>`SELECT moment, answer FROM coin_moments WHERE builder_id = ${id}`).map((r) => ({ ...r }));
const OFFER_RE = /^People can back (.+) onchain\. EarnKit launches a \$([A-Z0-9]+) coin on tokens\.fun for it; you keep 40% of its trading fees, paid to (0x[0-9a-f]{4}…[0-9a-f]{4})\. It is a tradable token on Base and can go to zero\. Want to open backing for \1\?$/;
/** The coin launched (as tokens.ts would record it) for the entry the yes made. */
async function launched(b: B, projectId: number, symbol: string) {
  await sql()`
    UPDATE projects SET token_symbol = ${symbol}, token_url = ${`https://tokens.fun/coin/0x${b.id}`}, token_status = 'launched',
      token_repo_key = ${`github.com/${b.key.toLowerCase()}`}, coin_launched_at = now() WHERE id = ${projectId}`;
}

test('(a) after the first approved week the backing offer is the one question, once', db, () => on(async () => {
  assert.equal(BACKING_OFFER('Kit', 'KIT', null),
    'People can back Kit onchain. EarnKit launches a $KIT coin on tokens.fun for it; you keep 40% of its trading fees. It is a tradable token on Base and can go to zero. Want to open backing for Kit?');
  assert.equal(BACKING_OFFER('Kit', 'KIT', WALLET),
    'People can back Kit onchain. EarnKit launches a $KIT coin on tokens.fun for it; you keep 40% of its trading fees, paid to 0x12ab…9f3e. It is a tradable token on Base and can go to zero. Want to open backing for Kit?');
  const b = await builder('a');
  // No approved week yet: never offered.
  const before = show(await find(b));
  assert.doesNotMatch(before, /backing/i, before);
  assert.equal((await moments(b.id)).length, 0);
  // A week approved but with no code is not the moment either.
  await approvedWeek(b, { checked: true, approved: true });
  assert.doesNotMatch(show(await find(b)), /backing/i);
  await approvedWeek(b);
  const f = await find(b);
  const s = show(f);
  const m = lastLine(s).match(OFFER_RE);
  assert.ok(m, s);
  // Task 16: the standing, then the offer as the one question (no points line: backing earns none).
  assert.equal(s, `Kit · 1 week in a row\n${BACKING_OFFER(m[1], m[2], `0x${(b.id + 1000).toString(16).padStart(40, '0')}`)}`);
  assert.equal(links(s).length, 0, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—|community round|\braise\b|raising/i);
  const move = f.reply?.move_up as { kind: string; project_key: string; agent_note: string };
  assert.deepEqual([move.kind, move.project_key], ['backing', b.key]);
  assert.match(move.agent_note, /kind: 'backing'/);
  assert.deepEqual(await moments(b.id), [{ moment: 'first_week', answer: null }]);
  // Once: the next reply never repeats it.
  const again = await find(b);
  assert.doesNotMatch(show(again), /backing/i, show(again));
  assert.notEqual((again.reply?.move_up as { kind: string }).kind, 'backing');
  // v3.1 spec 3.2 (R1): an apply ask due goes first; backing waits, unclaimed, for the next reply.
  const both = await builder('a2', { week: true, programs: ['base-builder-grants'] });
  const first = await find(both);
  assert.equal((first.reply?.move_up as { kind: string }).kind, 'apply', show(first));
  assert.doesNotMatch(show(first), /backing/i, show(first));
  assert.equal((await moments(both.id)).length, 0, 'the backing moment waits unclaimed');
  const second = await find(both);
  assert.match(lastLine(show(second)), OFFER_RE, show(second));
  assert.equal(questions(show(second)), 1, show(second));
}));

test('(b) yes routes to the coin flow note; no counts a decline', db, () => on(async () => {
  const b = await builder('b', { week: true });
  const s = show(await find(b));
  const sym = lastLine(s).match(OFFER_RE)?.[2];
  assert.ok(sym, s);
  const yes = await tell(b, { move_up: { kind: 'backing', project_key: b.key, answer: 'yes' } });
  assert.equal(yes.reply?.agent_note, COIN_YES_NOTE, JSON.stringify(yes.reply));
  assert.equal(typeof yes.reply?.project_id, 'number');
  assert.equal((yes.reply?.token as { symbol: string }).symbol, sym);
  const [x] = await sql()<{ raising: boolean }[]>`SELECT raising_at IS NOT NULL AS raising FROM projects WHERE id = ${yes.reply!.project_id as number}`;
  assert.equal(x.raising, true, 'the yes opens backing (shown once the coin is launched)');
  assert.deepEqual(await moments(b.id), [{ moment: 'first_week', answer: 'yes' }]);
  // Answered once.
  assert.equal(show(await tell(b, { move_up: { kind: 'backing', project_key: b.key, answer: 'yes' } })), 'Okay.');

  const c = await builder('bn', { week: true });
  assert.match(lastLine(show(await find(c))), OFFER_RE);
  const no = await tell(c, { move_up: { kind: 'backing', project_key: c.key, answer: 'no' } });
  assert.equal(show(no), 'Okay.');
  assert.deepEqual(await moments(c.id), [{ moment: 'first_week', answer: 'no' }], 'a decline (counts toward DECLINES_MAX)');
  assert.doesNotMatch(show(await find(c)), /backing/i);
}));

test('(c) never for a private repo, a held profile, a taken repo, a project with a coin, or earnkitai/earnkit', db, () => on(async () => {
  assert.deepEqual([...BACKING_EXCLUDED_REPOS], ['earnkitai/earnkit']);
  const none = async (b: B, label: string, ranked = true) => {
    const r = await find(b);
    const s = show(r);
    // Ranked (the offer's own state), so only the rule under test keeps it away.
    if (ranked) assert.equal((r.reply?.move_up as { kind: string } | undefined)?.kind !== undefined && /^Kit (is on EarnKit\.|· )/m.test(s), true, `${label} is ranked: ${s} ${JSON.stringify(r.reply?.move_up)}`);
    assert.doesNotMatch(s, /backing/i, `${label}: ${s}`);
    assert.equal((await moments(b.id)).length, 0, label);
  };
  const priv = await builder('cp', { week: true, private: true });
  await none(priv, 'private');
  const held = await builder('ch', { week: true });
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${held.id}`;
  await none(held, 'held');
  const coin = await builder('cc', { week: true });
  await sql()`UPDATE builder_projects SET has_coin = true WHERE builder_id = ${coin.id}`;
  await none(coin, 'has a coin');
  const own = await builder('co', { week: true, key: 'earnkitai/earnkit' });
  await none(own, 'earnkitai/earnkit');
  // Review fix 1: nor when the builder asks about a token (tell token: 'ask'); the exclusion is in coinAllowed.
  const ownAsk = await tell(own, { token: 'ask' });
  assert.equal(show(ownAsk), tokenUnavailable('Kit'), show(ownAsk));
  assert.equal((await moments(own.id)).length, 0);
  assert.equal(await coinAllowed(own.id, 'earnkitai/earnkit'), false);
  assert.equal(await coinAllowed(own.id, 'EarnKitAI/EarnKit'), false, 'compared lowercase');
  // Another person holds the repo: never ranked for it, never offered.
  const holder = await builder('ct', { week: true });
  const t = `ek_v3b_ct2_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own2 = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own2, { id: `99${RUN}${n}`, username: `vbct2${RUN}`.slice(0, 15), name: 'vb', avatar: null }, new Date())).ok);
  const c2 = (await connectInstallation(t))!;
  const taker = { ctx: { installationId: c2.id, ownInstallationId: c2.own, sharedClient: false, tokenDeps: { check: async () => true } } as Parameters<typeof mcpCall>[0], id: c2.id, key: holder.key, handle: '' };
  const r = await mcpCall(taker.ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${holder.key}` } } });
  assert.doesNotMatch(show(r), /backing/i);
  assert.equal((await moments(c2.id)).length, 0);
}));

test('(d) the page shows Back <project>, the pill reads Backing, the leaderboard chip Backed, and the JSON carries backing', db, () => on(async () => {
  const b = await builder('d', { week: true });
  const sym = lastLine(show(await find(b))).match(OFFER_RE)![2];
  const yes = await tell(b, { move_up: { kind: 'backing', project_key: b.key, answer: 'yes' } });
  // Not launched yet: nothing shows.
  assert.equal((await profileData(b.id, new Date()))!.backing, null);
  await launched(b, yes.reply!.project_id as number, sym);
  const url = `https://tokens.fun/coin/0x${b.id}`;
  const d = (await profileData(b.id, new Date()))!;
  assert.deepEqual(d.backing, { symbol: sym, url, backers: 0, earned_usd: 0 });
  // v3.1 Task 7: the coin is on the Token card (site.token): $SYMBOL, "Back <first>" to the coin's page. The card reads
  // the coin's backers by its address, which a real launch records.
  await sql()`UPDATE projects SET coin_address = ${`0x${String(b.id).padStart(40, 'd')}`} WHERE id = ${yes.reply!.project_id as number}`;
  const site = await profileSite(b.id, d, new Date());
  assert.ok(site.token, 'the Token card');
  const html = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, site, page: 1 }));
  const tok = unsign(html.slice(html.indexOf('data-ek-token')));
  assert.ok(tok.includes(`$${sym}`), tok);
  assert.match(tok, new RegExp(`<a[^>]*href="${url.replace(/\./g, '\\.')}"[^>]*>Back ${site.first}</a>`), tok);
  assert.doesNotMatch(html, /Community round/);
  assert.equal(pageWords(React.createElement(RaisingPill, { symbol: 'KIT', url })).trim(), 'Backing · $KIT');
  // The card's pill.
  const card = (await benchCardFacts(b.id))!;
  assert.equal(card.raising, sym);
  const cardHtml = renderToStaticMarkup(benchCard(card, null, false));
  assert.ok(cardHtml.includes(`Backing · $${sym}`), cardHtml);
  assert.doesNotMatch(cardHtml, /Community round/);

  // The leaderboard: the row's pill, the Backed chip and filter.
  const other = await builder('d2');
  assert.deepEqual(parseBenchFilter({ backed: '1' }), { chain: null, weekly: false, backed: true });
  assert.equal(filterHref({ chain: null, weekly: false, backed: true }), '/leaderboard?backed=1');
  const all = await benchRows({ chain: null, weekly: false, backed: false }, { only: [b.id, other.id] });
  assert.equal(all.rows.length, 2);
  const backed = await benchRows({ chain: null, weekly: false, backed: true }, { only: [b.id, other.id] });
  assert.deepEqual(backed.rows.map((r) => r.handle), [b.handle]);
  assert.deepEqual(backed.rows[0].backing, { symbol: sym, url });
  assert.equal(FILTER_BACKED, 'Backed');
  // The filter rail shows from RANK_MIN_POOL ranked builders (solo launch), so the board is read as a full pool here.
  const board = renderToStaticMarkup(React.createElement(BenchView, { ...all, count: RANK_MIN_POOL, filter: { chain: null, weekly: false, backed: false }, page: 1 }));
  assert.match(board, /<a[^>]*href="\/leaderboard\?backed=1"[^>]*>Backed<\/a>/, board);
  // v3.1 Task 8: a list row carries the Backed tag (never the coin's symbol or link on the leaderboard).
  const row = renderToStaticMarkup(React.createElement(BenchRowItem, { r: backed.rows[0], ranked: false }));
  assert.match(row, /data-ek-backed=""[^>]*>Backed</, row);
  assert.ok(!row.includes(`$${sym}`) && !row.includes('tokens.fun'));

  // The reply's money line (Task 16): a statement, its page the reply's one https link (no other link there).
  const r = show(await find(b));
  assert.ok(r.includes(`\nBacking open. Your page: https://earnkit.com/${b.handle}\n`), r);
  assert.equal(links(r).length, 1, r);
  assert.ok(questions(r) <= 1, r);
  assert.equal(backingLine(0, 0, 'earnkit.com/x'), 'Backing open. Your page: earnkit.com/x');
  assert.equal(backingLine(3, 12, 'earnkit.com/x'), 'Backing: 3 backers, $12 in fees. Your page: earnkit.com/x');

  // The builder JSON, for the tokens.fun coin page.
  const j = (await builderJson(b.handle, new Date()))!;
  assert.equal(j.handle, b.handle);
  assert.equal(j.page, `https://earnkit.com/${b.handle}`);
  assert.deepEqual(j.backing, { symbol: sym, url, backers: 0, earned_usd: 0 });
  assert.deepEqual(Object.keys(j).sort(), ['backing', 'earned', 'handle', 'last_shipped_days', 'last_week', 'name', 'page', 'points', 'rank', 'shipping', 'stopped_shipping', 'streak', 'total'].sort());
  assert.equal(j.last_week?.week, lastFinishedMonday(new Date()));
  assert.equal(j.stopped_shipping, false);
  // The route's answer (route.ts passes its cached read; here the read itself).
  const load = (h: string) => builderJson(h, new Date());
  const builderRoute = (h: string) => builderResponse(h, load);
  const res = await builderRoute(`${b.handle}.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://tokens.fun');
  assert.deepEqual((await res.json()).backing, { symbol: sym, url, backers: 0, earned_usd: 0 });
  const missing = await builderRoute('nobody_here_x.json');
  assert.equal(missing.status, 404);
  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${other.id}`;
  const hidden = await builderRoute(`${other.handle}.json`);
  assert.equal(hidden.status, 404);
}));

test('(e) the terms section renders only with the flag on and contains no "community round"', () => {
  assert.deepEqual([...BACKING_POINTS], [
    "Of a coin's trading fees, Clanker keeps 20%. Of the rest, 40% goes to the builder's wallet, 10% buys MINI and 50% goes to EarnKit's Safe.",
    'Backing is offered once, after the first approved week, and only with a yes.',
    'A coin is a tradable token on Base. It can go to zero. EarnKit never says it will rise.',
    'Closing backing hides it from the page; the coin stays onchain.',
    'Backing never changes Shipping or rank.',
  ]);
  const render = () => renderToStaticMarkup(React.createElement(PolicySection));
  const onHtml = withEnvSync({ EARNKIT_RAISING: 'on' }, render);
  assert.match(onHtml, />Backing<\/h2>/);
  for (const p of BACKING_POINTS) assert.ok(onHtml.includes(p.replace(/'/g, '&#x27;')), p);
  assert.match(onHtml, /Where token fees go/, 'the fee table stays');
  const offHtml = withEnvSync({ EARNKIT_RAISING: undefined }, render);
  assert.doesNotMatch(offHtml, />Backing<\/h2>/);
  for (const h of [onHtml, offHtml]) {
    assert.doesNotMatch(h, /community round|The token is optional|Every entry is offered a token|\braise\b|\braising\b|fundrais/i);
  }
});

test('(f) flag off: no backing text anywhere (reply, page, card, terms, JSON backing null)', db, async () => {
  const b = await off(() => builder('f', { week: true }));
  const s = await off(async () => show(await find(b)));
  assert.doesNotMatch(s, /backing|\bBack\b/i, s);
  assert.equal((await moments(b.id)).length, 0);
  // A coin opened while the flag was on: with it off, nothing shows.
  const [{ pid }] = await sql()<{ pid: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_launched_at)
    VALUES ('earnkit-coin', 'Kit', ${`https://github.com/${b.key}`}, ${`github.com/${b.key.toLowerCase()}`}, ${b.id}, 'KITF', 'launched', 'https://tokens.fun/coin/0xf', now(), now()) RETURNING id AS pid`;
  assert.ok(pid);
  await off(async () => {
    const d = (await profileData(b.id, new Date()))!;
    assert.equal(d.backing, null);
    const html = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, site: await profileSite(b.id, d, new Date()), page: 1 }));
    assert.doesNotMatch(html, /data-ek-back|data-ek-token|Backing|data-pill|tokens\.fun/, html);
    assert.equal((await benchCardFacts(b.id))!.raising, null);
    assert.deepEqual(parseBenchFilter({ backed: '1' }), { chain: null, weekly: false, backed: false });
    const all = await benchRows({ chain: null, weekly: false, backed: false }, { only: [b.id] });
    assert.ok(all.rows.every((r) => r.backing === null));
    // The filter rail shows from RANK_MIN_POOL ranked builders (solo launch), so the board is read as a full pool here.
  const board = renderToStaticMarkup(React.createElement(BenchView, { ...all, count: RANK_MIN_POOL, filter: { chain: null, weekly: false, backed: false }, page: 1 }));
    assert.doesNotMatch(board, /Backed|Backing|backed=1/);
    // v3.1 Task 8: a list row of the same builder carries no Backed tag either.
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(BenchRowItem, { r: all.rows[0], ranked: false })), /Backed|Backing/);
    assert.equal((await builderJson(b.handle, new Date()))!.backing, null);
    const r = show(await find(b));
    assert.doesNotMatch(r, /backing/i, r);
    // The tell coin schema keeps its old shape (no raising).
    const t = await tell(b, { coin: { raising: true } });
    assert.equal(t.isError, true, t.text);
  });
  assert.doesNotMatch(withEnvSync({ EARNKIT_RAISING: undefined }, () => renderToStaticMarkup(React.createElement(PolicySection))), />Backing</);
});

test('(g) copy-review: "community round", "raise", "raising" absent from builder-facing text', () => {
  assert.ok(BENCH_EXTRA.some((r) => r.test('a community round')), 'banned in Bench text');
  const texts = withEnvSync({ EARNKIT_RAISING: 'on' }, () => [
    BACKING_OFFER('Recipe planner', 'RECIPE', null), BACKING_OFFER('Recipe planner', 'RECIPE', WALLET), raiseLine('Recipe planner', 'RECIPE', null),
    showRaisingLine('RECIPE'), RAISE_LINES.on('RECIPE'), RAISE_LINES.off, RAISE_LINES.notLaunched,
    backingLine(0, 0, 'earnkit.com/maya'), backingLine(2, 40, 'earnkit.com/maya'),
    pageWords(React.createElement(RaisingPill, { symbol: 'RECIPE', url: 'https://tokens.fun/coin/0xabc' })),
  ]);
  assert.equal(RAISE_LINES.on('RECIPE'), 'Done. Your page shows backing for $RECIPE.');
  assert.equal(RAISE_LINES.off, 'Okay. Your page no longer shows backing. Your coin stays onchain.');
  assert.equal(RAISE_LINES.notLaunched, 'Backing opens once your coin is launched.');
  const EXEMPT = ['Recipe planner', 'EarnKit', 'tokens.fun', '$RECIPE', 'RECIPE'];
  for (const t of texts) {
    assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
    assert.doesNotMatch(t, /community round|\braise\b|\braising\b|fundrais|—/i, t);
  }
  for (const p of BACKING_POINTS) assert.doesNotMatch(p, /community round|\braise\b|\braising\b|fundrais|—/i, p);
});

test('(h) review fix 3: tell token: \'ask\' before the first approved week says backing opens after it; after it, the same once-a-project offer', db, () => on(async () => {
  assert.equal(BACKING_NOT_YET, 'Backing opens after your first confirmed week.');
  const b = await builder('h');
  assert.equal(show(await tell(b, { token: 'ask' })), BACKING_NOT_YET);
  assert.equal((await moments(b.id)).length, 0, 'nothing spent');
  await approvedWeek(b);
  const asked = await tell(b, { token: 'ask' });
  assert.match(show(asked), OFFER_RE, show(asked));
  assert.deepEqual(await moments(b.id), [{ moment: 'first_week', answer: null }]);
  // Asked again: the same line (the open offer), and find never offers it a second time.
  assert.equal(show(await tell(b, { token: 'ask' })), show(asked));
  assert.doesNotMatch(show(await find(b)), /backing/i);
}));

test('(i) review fix 2: a slow ticker check never holds the reply; the offer waits for a later reply, unspent', db, () => on(async () => {
  const b = await builder('i', { week: true });
  let slow = true;
  b.ctx.tokenDeps = {
    check: async () => {
      if (slow) await new Promise((r) => setTimeout(r, 2_500));
      return true;
    },
  };
  const t = Date.now();
  const late = show(await find(b));
  assert.ok(Date.now() - t < 2_400, `the reply went on (${Date.now() - t} ms)`);
  assert.doesNotMatch(late, /backing/i, late);
  await new Promise((r) => setTimeout(r, 2_000));
  assert.equal((await moments(b.id)).length, 0, 'the late offer never claimed the moment');
  slow = false;
  assert.match(lastLine(show(await find(b))), OFFER_RE);
}));

/** withEnv for a synchronous body. */
function withEnvSync<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const was: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
