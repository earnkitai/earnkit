import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { withThisWeek } from './site-streak';
import { sql } from './db';
import { profileData, type ProfileData } from './bench-data';
import { PRIVATE_NAME, projectPrograms, projectProgramsDated } from './page-data';
import { person, withEnv } from './fixtures/find';
import { padPool } from './fixtures/rank-pool';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { last52, mondayOfWeek, isoWeekOf } from './weeks';
import { BASE_GENESIS_UNIX, backerWeeks, highlights, lastShippedAt, profileSite, standingPill, thisWeekCommits, tokenAllowed } from './site-data';

/** v3.1 site Task 3: the profile's reads (last shipped, this week, Highlights, the standing pill, backer weeks, the Token card guard). */

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});

const NOW = new Date('2026-10-21T12:00:00Z');
const DAY = 86_400_000;
const RUN = randomBytes(2).toString('hex');
let n = 0;

type B = { id: number; key: string };
/**
 * A claimed person whose one project is `key` (find.ts person: a confirmed project gets its verified repo source), with
 * its chains, commit weeks, the repo proof, the claim date and, unless `hidden`, a public repo reading carrying `signals`.
 */
async function builder(o: {
  key?: string; name?: string; what?: string | null; link?: string | null; chains?: string[]; commitWeeks?: string[]; confirmed?: boolean; proof?: string;
  claimedAt?: Date; score?: number; ranked?: boolean; signals?: Record<string, unknown>; hidden?: boolean; source?: boolean;
} = {}): Promise<B> {
  n++;
  const key = o.key ?? `s${RUN}o${n}/app${n}`;
  const id = await person({ projects: [{ key, name: o.name ?? `App ${n}`, what: o.what ?? null, confirmed: o.confirmed ?? true }], main: key, claimed: `s${RUN}${n}`, score: o.score ?? 50, ranked: o.ranked ?? false });
  await sql()`UPDATE builder_profiles SET claimed_at = ${o.claimedAt ?? new Date(NOW.getTime() - 200 * DAY)}, x_name = 'Sam Lee' WHERE builder_id = ${id}`;
  await sql()`UPDATE builder_projects SET chains = ${o.chains ?? []}, commit_weeks = ${o.commitWeeks ?? []}, link = ${o.link ?? null} WHERE builder_id = ${id}`;
  if (o.source && !(o.confirmed ?? true))
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at) VALUES (${id}, 'repo', ${key}, ${key}, 'proof_line', 'verified', 'agent', now())`;
  if (o.proof) await sql()`UPDATE builder_sources SET proof = ${o.proof} WHERE builder_id = ${id} AND kind = 'repo'`;
  if (!o.hidden) await reading(id, o.signals ?? {});
  return { id, key };
}
/** The repo source's live reading: public, plus `signals`. */
async function reading(id: number, signals: Record<string, unknown>) {
  await sql()`
    INSERT INTO source_live (source_id, signals, ok, read_at)
    SELECT id, ${sql().json({ private: false, ...signals } as never)}, true, now() FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo'
    ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals, read_at = EXCLUDED.read_at`;
}
const page = async (id: number, o: { only?: number[] } = {}) => (await profileData(id, NOW, o)) as ProfileData;

test('(a) lastShippedAt reads pushed_at from the ship reading; null with no verified repo, a future pushed_at, or an unconfirmed project', db, async () => {
  const at = '2026-10-21T10:00:00Z';
  const b = await builder({ signals: { pushed_at: at } });
  assert.equal((await lastShippedAt(b.id, NOW))?.toISOString(), new Date(at).toISOString());
  assert.equal((await profileSite(b.id, await page(b.id), NOW)).lastShippedAt, new Date(at).toISOString());
  // No verified repo: the project is not confirmed and has no repo source.
  const none = await builder({ confirmed: false });
  assert.equal(await lastShippedAt(none.id, NOW), null);
  const future = await builder({ signals: { pushed_at: '2026-10-22T10:00:00Z' } });
  assert.equal(await lastShippedAt(future.id, NOW), null);
  const garbage = await builder({ signals: { pushed_at: 'yesterday' } });
  assert.equal(await lastShippedAt(garbage.id, NOW), null);
  // A verified repo source but the project itself not confirmed.
  const unconfirmed = await builder({ confirmed: false, source: true, signals: { pushed_at: at } });
  assert.equal(await lastShippedAt(unconfirmed.id, NOW), null);
});

test('(b) thisWeekCommits returns this ISO week\'s count and 0 for a week weekCounts refuses', db, async () => {
  const week = isoWeekOf(NOW);
  const b = await builder({ signals: { commit_counts: { [week]: 14, '2026-W01': 3 }, pushes_checked: true, created_at: '2025-01-01T00:00:00Z' } });
  assert.equal(await thisWeekCommits(b.id, NOW), 14);
  // profileSite reads the same ship reading once for both.
  const s = await profileSite(b.id, await page(b.id), NOW);
  assert.equal(s.thisWeek, 14);
  assert.equal(s.lastShippedAt, null);
  // The repo was created after this week (backdated counts): refused.
  const later = await builder({ signals: { commit_counts: { [week]: 9 }, pushes_checked: true, created_at: new Date(NOW.getTime() + 10 * DAY).toISOString() } });
  assert.equal(await thisWeekCommits(later.id, NOW), 0);
  const none = await builder({ confirmed: false });
  assert.equal(await thisWeekCommits(none.id, NOW), 0);
});

/** A verified site source of the project, its daily readings (`up` per day). */
async function site(b: B, ref: string, days: [string, boolean][]) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
    VALUES (${b.id}, 'site', ${ref}, ${b.key}, 'repo_link', 'verified', 'agent', now()) RETURNING id`;
  for (const [day, up] of days) await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${id}, ${day}, ${sql().json({ up } as never)}, true)`;
}
const addr = () => `0x${randomBytes(20).toString('hex')}`;
const codes = (key: string, found: boolean) =>
  sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${key.toLowerCase()}, ${found}, ${NOW}) ON CONFLICT (repo_key) DO UPDATE SET found = EXCLUDED.found`;

test('(c) highlights: live, Builder Code, contracts on Base, applied, shipping since, in that order', db, async () => {
  const weeks = last52(NOW).slice(-5);
  const b = await builder({ chains: ['base'], proof: 'github_app', commitWeeks: weeks });
  await site(b, 'https://www.earnkit.com', [['2026-07-30', false], ['2026-08-03', true], ['2026-08-04', true]]);
  await codes(b.key, true);
  // One Base contract source, one Arc contract source (not counted), one EarnKit deploy on Base, one on Arc (not counted).
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by) VALUES
    (${b.id}, 'contract', ${`base:${addr()}`}, ${b.key}, 'deployer', 'verified', 'agent'),
    (${b.id}, 'contract', ${`arc:${addr()}`}, ${b.key}, 'deployer', 'verified', 'agent'),
    (${b.id}, 'contract', ${`base:${addr()}`}, ${b.key}, 'deployer', 'proposed', 'agent')`;
  await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, address, status, cost_micro_usd) VALUES
    (${b.id}, 'k', ${b.key}, 'base', ${`0x${randomBytes(32).toString('hex')}`}, ${addr()}, 'deployed', 0),
    (${b.id}, 'k', ${b.key}, 'arc', ${`0x${randomBytes(32).toString('hex')}`}, ${addr()}, 'deployed', 0),
    (${b.id}, 'k', ${b.key}, 'base', ${`0x${randomBytes(32).toString('hex')}`}, ${addr()}, 'reverted', 0)`;
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'alliance-all19', 'applied', '2026-10-14T09:00:00Z')`;
  const d = await page(b.id);
  assert.equal(d.streak, 5);
  assert.deepEqual(await highlights(b.id, d, NOW), [
    { icon: 'live', title: 'Live at earnkit.com', sub: 'Since Aug 2026' },
    { icon: 'code', title: 'Base Builder Code', sub: 'Found in the repo' },
    { icon: 'contract', title: '2 contracts on Base', sub: 'Deployed by the project' },
    { icon: 'applied', title: 'Applied to Alliance ALL19', sub: 'Oct 14' },
    { icon: 'start', title: 'Shipping since Sep 21', sub: '5 weeks in a row' },
  ]);
});

test('(c2) first week, Builder Codes false, an Arc project, codes unknown, no project', db, async () => {
  const fresh = await builder({ chains: ['base'], proof: 'github_app', claimedAt: new Date(NOW.getTime() - 3 * DAY), commitWeeks: [isoWeekOf(NOW)] });
  await codes(fresh.key, false);
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${fresh.id}, ${fresh.key}, '2026-10-19', ${sql().json({ shipped_code: { n: 3 } } as never)})`;
  const d = await page(fresh.id);
  assert.equal(d.log.length, 1);
  assert.equal(d.log[0].commits, 3);
  const h = await highlights(fresh.id, d, NOW);
  assert.deepEqual(h.find((x) => x.icon === 'code'), { icon: 'code', title: 'Base Builder Code', sub: 'Not in the repo yet' });
  assert.deepEqual(h.at(-1), { icon: 'start', title: 'Shipping since Oct 19', sub: 'First week on EarnKit' });
  // Builder Codes are a Base step: an Arc project gets no code item, whatever is stored.
  const arc = await builder({ chains: ['arc'], proof: 'github_app' });
  await codes(arc.key, true);
  assert.ok(!(await highlights(arc.id, await page(arc.id), NOW)).some((x) => x.icon === 'code'));
  // Never checked: no code item.
  const unknown = await builder({ chains: ['base'], proof: 'github_app' });
  assert.ok(!(await highlights(unknown.id, await page(unknown.id), NOW)).some((x) => x.icon === 'code'));
  // Not proven through the App: the stored answer is not read.
  const unproven = await builder({ chains: ['base'] });
  await codes(unproven.key, true);
  assert.ok(!(await highlights(unproven.id, await page(unproven.id), NOW)).some((x) => x.icon === 'code'));
  // No commit weeks, claimed long ago: shipping since the claim; under one week of code reads as the first week (never "0 weeks").
  const quiet = await builder({ claimedAt: new Date('2026-03-02T00:00:00Z') });
  assert.deepEqual(await highlights(quiet.id, await page(quiet.id), NOW), [{ icon: 'start', title: 'Shipping since Mar 2026', sub: 'First week on EarnKit' }]);
  const one = await builder({ commitWeeks: [last52(NOW)[30]] });
  assert.equal((await highlights(one.id, await page(one.id), NOW)).at(-1)?.sub, '1 week with code in the last year');
  // No project at all.
  const bare = await person({ projects: [], claimed: `s${RUN}bare` });
  await sql()`UPDATE builder_profiles SET claimed_at = '2026-10-02T08:00:00Z' WHERE builder_id = ${bare}`;
  assert.deepEqual(await highlights(bare, await page(bare), NOW), [{ icon: 'start', title: 'On EarnKit since Oct 2', sub: 'No project on the leaderboard yet' }]);
  // A project not confirmed yet is not on the leaderboard either.
  const confirming = await builder({ confirmed: false });
  assert.deepEqual(await highlights(confirming.id, await page(confirming.id), NOW), [{ icon: 'start', title: 'On EarnKit since Apr 4', sub: 'No project on the leaderboard yet' }]);
});

test('(d) backerWeeks buckets first_block by BASE_GENESIS_UNIX + 2 * block into the last 12 ISO weeks; an older backer counts nowhere; length is 12', db, async () => {
  assert.equal(BASE_GENESIS_UNIX, 1686789347);
  const coin = addr();
  const weeks = last52(NOW).slice(-12);
  const blockAt = (t: number) => Math.ceil((t / 1000 - BASE_GENESIS_UNIX) / 2);
  const monday = (w: string) => Date.parse(`${mondayOfWeek(w)}T00:00:00Z`);
  const rows: [string, number][] = [
    [addr(), blockAt(monday(weeks[0]))], // the first block of the oldest week
    [addr(), blockAt(monday(weeks[0]) + 3 * DAY)],
    [addr(), blockAt(monday(weeks[0])) - 1], // the week before: counts nowhere
    [addr(), blockAt(monday(weeks[5]) + DAY)],
    [addr(), blockAt(NOW.getTime() - 3600_000)],
  ];
  for (const [wallet, block] of rows) await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${wallet}, ${block})`;
  const out = await backerWeeks(coin.toUpperCase().replace('0X', '0x'), NOW);
  assert.equal(out.length, 12);
  assert.deepEqual(out, [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(await backerWeeks(addr(), NOW), Array(12).fill(0));
});

test('(e) standingPill: under 10 none; Base percentile with its metal; outside the top 25% none; whole pool off Base', db, async () => {
  const onBase = async (ids: number[]) => sql()`UPDATE builder_projects SET chains = '{base}' WHERE builder_id IN ${sql()(ids)}`;
  const me = await builder({ chains: ['base'], score: 90, ranked: true });
  const eight = await padPool(8);
  await onBase(eight);
  let only = [me.id, ...eight];
  assert.equal(await standingPill(me.id, await page(me.id, { only }), { only }), null, '9 ranked');
  const ninth = await padPool(1);
  await onBase(ninth);
  only = [...only, ...ninth];
  assert.deepEqual(await standingPill(me.id, await page(me.id, { only }), { only }), { label: 'Top 10% on Base', tier: 'silver', title: '#1 of 10 builders on Base' });
  const more = await padPool(30);
  await onBase(more);
  only = [...only, ...more];
  assert.deepEqual(await standingPill(me.id, await page(me.id, { only }), { only }), { label: 'Top 3% on Base', tier: 'gold', title: '#1 of 40 builders on Base' });
  // Rank 11 of 40: 28%, no metal, no pill.
  const top = await padPool(10, 95);
  await onBase(top);
  const mid = [me.id, ...top, ...eight, ...ninth, ...more.slice(0, 20)];
  assert.equal(mid.length, 40);
  assert.equal(await standingPill(me.id, await page(me.id, { only: mid }), { only: mid }), null);
  // An Arc builder: the whole pool.
  const arc = await builder({ chains: ['arc'], score: 90, ranked: true });
  const pool = [arc.id, ...(await padPool(9))];
  assert.deepEqual(await standingPill(arc.id, await page(arc.id, { only: pool }), { only: pool }), { label: 'Top 10% of builders', tier: 'silver', title: '#1 of 10 builders' });
  // Not ranked: none.
  const unranked = await builder({ chains: ['base'] });
  assert.equal(await standingPill(unranked.id, await page(unranked.id, { only }), { only }), null);
});

/** A launched coin with backing open on the builder's one project (raising.ts raisingCoin's row). */
async function coin(b: B, symbol: string): Promise<string> {
  const c = addr();
  await sql()`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_launched_at, coin_address)
    VALUES ('earnkit-coin', 'Kit', ${`https://github.com/${b.key}`}, ${`github.com/${b.key.toLowerCase()}`}, ${b.id}, ${symbol}, 'launched', ${`https://tokens.fun/coin/${c}`}, now(), now(), ${c})`;
  return c;
}

test('(f) profileSite.token: raising on with an open coin; never with raising off; never for earnkitai/earnkit', db, async () => {
  const b = await builder({ chains: ['base'] });
  const c = await coin(b, 'TIPJAR');
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${c}, ${addr()}, ${Math.ceil((NOW.getTime() / 1000 - BASE_GENESIS_UNIX) / 2) - 100})`;
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    const s = await profileSite(b.id, await page(b.id), NOW);
    assert.ok(s.token);
    assert.equal(s.token.symbol, 'TIPJAR');
    assert.equal(s.token.backers, 1);
    assert.equal(s.token.letter, 'T');
    assert.equal(s.token.weeks.length, 12);
    assert.equal(s.token.weeks[11], 1);
  });
  await withEnv({ EARNKIT_RAISING: undefined }, async () => {
    assert.equal((await profileSite(b.id, await page(b.id), NOW)).token, null);
  });
  // EarnKit's own repo: never backing, even with the flag on and a coin open.
  const own = await builder({ key: 'earnkitai/earnkit', name: 'EarnKit', chains: ['base'], link: 'https://earnkit.com' });
  await coin(own, 'EARNKIT');
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    const s = await profileSite(own.id, await page(own.id), NOW);
    assert.equal(s.token, null);
    assert.equal(s.project?.earnkit, true);
    assert.equal(s.project?.onBase, true);
    assert.deepEqual(s.project?.link, { href: 'https://earnkit.com/', text: 'earnkit.com' });
    assert.equal(s.project?.repo, 'https://github.com/earnkitai/earnkit');
    assert.equal(s.first, 'Sam');
  });
  // Fails closed: an unknown main key (none, or its read failed) never allows the card; EarnKit's repos never do.
  assert.equal(tokenAllowed(null), false);
  assert.equal(tokenAllowed(''), false);
  assert.equal(tokenAllowed('earnkitai/earnkit'), false);
  assert.equal(tokenAllowed('EarnKitAI/other'), false);
  assert.equal(tokenAllowed(b.key), true);
  // Backing on the page data but no main project key (as after a failed read): no Token card.
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    const d = await page(b.id);
    assert.ok(d.backing);
    await sql()`UPDATE builder_profiles SET main_project_key = NULL WHERE builder_id = ${b.id}`;
    try {
      assert.equal((await profileSite(b.id, d, NOW)).token, null);
    } finally {
      await sql()`UPDATE builder_profiles SET main_project_key = ${b.key} WHERE builder_id = ${b.id}`;
    }
  });
});

test('(g) a hidden repo: Private project, no repo, no link unless a non-GitHub site, no about; Highlights never names the repo', db, async () => {
  const key = `s${RUN}h/secretsauce`;
  const b = await builder({ key, name: 'secretsauce', what: 'the secret sauce', link: 'https://own.github.io/secretsauce', hidden: true, commitWeeks: last52(NOW).slice(-2) });
  await site(b, 'https://secretsauce.github.io', [['2026-08-03', true]]);
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'alliance-all19', 'applied', '2026-10-14T09:00:00Z')`;
  const d = await page(b.id);
  const s = await profileSite(b.id, d, NOW);
  assert.equal(s.project?.name, PRIVATE_NAME);
  assert.equal(s.project?.repo, null);
  assert.equal(s.project?.link, null);
  assert.equal(s.project?.about, null);
  assert.equal(s.project?.letter, 'P');
  assert.ok(s.highlights.length > 0);
  for (const h of s.highlights) assert.doesNotMatch(`${h.title} ${h.sub}`, /secretsauce/i, JSON.stringify(h));
  // Its own non-GitHub site is its link.
  await sql()`UPDATE builder_projects SET link = 'https://sauce.example/' WHERE builder_id = ${b.id}`;
  assert.deepEqual((await profileSite(b.id, await page(b.id), NOW)).project?.link, { href: 'https://sauce.example/', text: 'sauce.example' });
});

test('(h) projectProgramsDated returns the told application\'s at and the entry\'s submitted_at', db, async () => {
  const b = await builder();
  const base = committedProgram('alliance-all19');
  const id = `v31-site-${process.pid}-entry`;
  await upsertProgram(ProgramFile.parse({ ...base, id, title: `Entry program ${RUN}` }));
  await sql()`INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id, submitted_at) VALUES (${id}, 'Kit', ${`https://github.com/${b.key}`}, ${b.key}, ${b.id}, '2026-10-01T10:00:00Z')`;
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'alliance-all19', 'applied', '2026-10-14T09:00:00Z')`;
  const dated = await projectProgramsDated(b.id, b.key);
  assert.deepEqual(dated.map((g) => ({ ...g, at: g.at.toISOString() })), [
    { title: `Entry program ${RUN}`, won: false, applied: true, at: '2026-10-01T10:00:00.000Z' },
    { title: 'Alliance ALL19', won: false, applied: true, at: '2026-10-14T09:00:00.000Z' },
  ]);
  // projectPrograms keeps its shape (no date).
  assert.deepEqual(await projectPrograms(b.id, b.key), [
    { title: `Entry program ${RUN}`, won: false, applied: true },
    { title: 'Alliance ALL19', won: false, applied: true },
  ]);
});

test('(i) Task 7 fix round 2: Highlights and the Streak card read one streak (withThisWeek): bumped, not bumped, already lit, quiet', db, async () => {
  (globalThis as { React?: typeof React }).React = React;
  const w = last52(NOW);
  const signals = (n: number) => ({ commit_counts: { [isoWeekOf(NOW)]: n }, pushes_checked: true, created_at: '2025-01-01T00:00:00Z' });
  /** The Streak card's "N weeks" and the start highlight's sub line, from profileSite as the page reads them. */
  const both = async (b: B) => {
    const d = await page(b.id);
    const s = await profileSite(b.id, d, NOW);
    const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, site: s, page: 1 }));
    const card = h.slice(h.indexOf('data-ek-streak'));
    const weeks = Number(/<span class="ek-serif[^"]*">(\d+) weeks?<\/span>/.exec(card)![1]);
    return { weeks, sub: s.highlights.at(-1)!.sub, lit: (card.slice(0, card.indexOf('</div></div>')).match(/bg-s-rust-on/g) ?? []).length, d };
  };
  // Bumped: two weeks before this one, commits this week (not yet in the grid): 3 on the card and in Highlights.
  const bumped = await both(await builder({ commitWeeks: [w[49], w[50]], signals: signals(5) }));
  assert.equal(bumped.d.streak, 2, 'stored');
  assert.deepEqual([bumped.weeks, bumped.sub, bumped.lit], [3, '3 weeks in a row', 3]);
  // Not bumped: no commits this week.
  const flat = await both(await builder({ commitWeeks: [w[49], w[50]], signals: signals(0) }));
  assert.deepEqual([flat.weeks, flat.sub], [2, '2 weeks in a row']);
  // Already lit this week: never counted twice.
  const lit = await both(await builder({ commitWeeks: [w[50], w[51]], signals: signals(4) }));
  assert.equal(lit.weeks, lit.d.streak);
  assert.equal(lit.sub, `${lit.weeks} weeks in a row`);
  // The first-week builder shipping this week (seeded sam): 2 weeks on both, never "First week on EarnKit" beside it.
  const fresh = await both(await builder({ commitWeeks: [w[50]], signals: signals(6), claimedAt: new Date(NOW.getTime() - 3 * DAY) }));
  assert.deepEqual([fresh.weeks, fresh.sub], [2, '2 weeks in a row']);
  // Quiet (not confirmed): 0 weeks, nothing lit, and Highlights says it is not on the leaderboard.
  const quiet = await both(await builder({ confirmed: false, source: true, commitWeeks: [w[50]], signals: signals(6) }));
  assert.deepEqual([quiet.weeks, quiet.lit, quiet.sub], [0, 0, 'No project on the leaderboard yet']);
  // The helper itself.
  const g = (on: boolean[]) => on.map((x, i) => ({ week: `2026-W${i + 1}`, on: x }));
  const proj = { ...(bumped.d.project!), confirmed: true };
  assert.deepEqual(withThisWeek({ grid: g([true, false]), streak: 1, project: proj }, 3), { grid: g([true, true]), streak: 2 });
  assert.deepEqual(withThisWeek({ grid: g([true, false]), streak: 1, project: proj }, 0), { grid: g([true, false]), streak: 1 });
  assert.deepEqual(withThisWeek({ grid: g([true, true]), streak: 2, project: proj }, 9), { grid: g([true, true]), streak: 2 });
  assert.deepEqual(withThisWeek({ grid: g([true, false]), streak: 1, project: { ...proj, confirmed: false } }, 3), { grid: g([false, false]), streak: 0 });
  assert.deepEqual(withThisWeek({ grid: g([true]), streak: 1, project: null }, 3), { grid: g([false]), streak: 0 });
});
