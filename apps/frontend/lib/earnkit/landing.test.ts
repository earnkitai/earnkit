import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byPool, INSTALLS_SHOWN_FROM, landingFrom, readGuideIds, readGuidePage, readLanding, statsLine } from './landing';
import { ProgramFile } from './program-file';
import { getProgramRow, poolFacts, upsertProgram } from './programs';
import { sql } from './db';
import { NO_CELL, type Card } from './present';
import type { PublicStats } from './stats';
import { committedProgram } from './fixtures/program-file';
import { presentFirstMessage } from './present';
import { moneyText, openMoneyUsd, wonLine } from './stats';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeView from '../../app/HomeView';
import Footer from '../../app/components/common/Footer';
import { homeFixture as LANDING_FIXTURE } from './fixtures/landing';
import { BENCH_FOOTER_TAGLINE } from './footer-links';
import { BENCH_HERO_SUBTITLE, BENCH_HERO_SUBTITLE_NO_RAISE, BENCH_HERO_TITLE } from '../../app/components/sections/Hero';
import { BENCH_TOP_TITLE, SEE_BENCH } from '../../app/components/sections/BenchTop';
import { CAROUSEL_TITLE } from '../../app/components/sections/UpdateCarousel';
import { BENCH_HOW_TITLE, BENCH_STEPS, BENCH_STEPS_NO_RAISE } from '../../app/components/sections/BenchHowItWorks';

// The components are compiled with the classic JSX runtime here (as feed.test.ts).
(globalThis as { React?: typeof React }).React = React;

const stats = (o: Partial<PublicStats> = {}): PublicStats => ({
  open_money_usd: 0,
  open_money_text: null,
  open_pools_usd: 0,
  open_pools_plus: false,
  programs_open: 5,
  bonus_programs_open: 4,
  coins_launched: 0,
  fees_to_safe_eth: 0,
  bonus_paid_eth: 0,
  bonus_pools_eth: 0,
  installs: 12,
  labelled_entries: 0,
  entries_won: 0,
  builders_won_usd: 0,
  ...o,
});
const now = new Date('2026-10-06T12:00:00Z');
const medium = { level: 'Medium' as const, estimate: true, rated: false, basis: 'no past results yet' };

const arc: Card = {
  id: 'arc-microgrants',
  title: 'Arc Microgrants',
  summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET',
  tag: null,
  each_time: [],
  ends_at: new Date('2026-10-15T03:59:00Z'),
  max_award_usd: 500,
  difficulty: medium,
  logo: 'programs/arc-microgrants.svg',
  chains: ['arc'],
};
const base: Card = {
  id: 'base-builder-grants',
  title: 'Base Builder Grant Program',
  summary: 'up to $5,000 · rolling',
  tag: 'needs a live product',
  each_time: [],
  ends_at: null,
  max_award_usd: 5000,
  difficulty: { level: 'Hard', estimate: false, rated: false, basis: '20 of ~160 entries won last round' },
  logo: null,
  chains: ['base'],
};
const monad: Card = {
  id: 'monad-metropolis',
  title: 'Monad Metropolis',
  summary: '$25,000 top prize · closes Oct 20',
  tag: null,
  each_time: [],
  ends_at: new Date('2026-10-20T23:59:00Z'),
  max_award_usd: 25000,
  difficulty: null,
  logo: null,
  chains: ['monad', 'base', 'robinhood'],
};
const sponsored: Card = { ...arc, id: 'acme-campaign', title: 'Acme', max_award_usd: 90000, sponsored: true };
const campaign: Card = { ...arc, id: 'earnkit-campaign-1-base', title: 'EarnKit Campaign #1', max_award_usd: 80000, earnkit_campaign: true };

test('v2.7 §1: tiles are curated programs sorted by prize; plain JSON (Review Focus 2)', () => {
  const l = landingFrom([monad, arc, sponsored, campaign, base], stats(), now);
  assert.deepEqual(l.tiles.map((t) => t.id), ['monad-metropolis', 'base-builder-grants', 'arc-microgrants']);
  const arcTile = l.tiles.find((t) => t.id === 'arc-microgrants')!;
  assert.equal(arcTile.days_left, '9 days left'); // Oct 15 03:59 UTC is 9 UTC days after Oct 6
  assert.deepEqual(JSON.parse(JSON.stringify(l)), l);
});

test('v2.7.1: each tile field; no pool means the per-winner amount is the big line', () => {
  const l = landingFrom([monad, arc, base], stats(), now);
  const [m, b, a] = l.tiles;
  assert.deepEqual(m, {
    id: 'monad-metropolis',
    title: 'Monad Metropolis',
    chain: 'Monad · Base · Robinhood Chain',
    prize: 'up to $25,000 per winner',
    prize_note: null, // the big line already says it
    prize_usd: 25000,
    pool_usd: null,
    difficulty: NO_CELL,
    days_left: '14 days left',
    logo: null,
  });
  assert.equal(b.days_left, 'rolling');
  assert.equal(b.difficulty, 'Hard'); // its round froze (I2)
  assert.equal(a.difficulty, 'Medium'); // v2.8 Ruling 21: the level word only; the guide keeps "(estimate)" // no pool read yet: the pill still shows // never "0 ETH"
  assert.equal(a.logo, '/programs/arc-microgrants.svg');
  assert.equal(b.prize, 'up to $5,000 per grant'); // review #1: a grant program
  assert.equal(l.open_text, '$30.5K'); // v2.9 F21: the top prizes (Monad, Arc, Base), never the sponsor's or the campaign's
});

test('v2.8 Ruling 20, 21 (plan): every open curated program is a tile (no cap); the difficulty is the level word only', () => {
  const many = Array.from({ length: 9 }, (_, i): Card => ({ ...arc, id: `p${i}`, title: `P${i}`, max_award_usd: 1000 + i }));
  const l = landingFrom([...many, sponsored, campaign], stats(), now);
  assert.equal(l.tiles.length, 9);
  const hard = landingFrom([{ ...base, difficulty: { level: 'Hard', estimate: true, rated: false, basis: 'a16z publishes no acceptance figures' } }], stats(), now);
  assert.equal(hard.tiles[0].difficulty, 'Hard');
  assert.ok(!('ends' in hard.tiles[0]), 'days_left replaces ends');
});

test('v2.7.1: a pool is the big line, "up to $X per winner" under it; unknown amounts keep the curated text', () => {
  const pooled = (c: Card, pool_usd: number, pool_line: string, pool_plus = false): Card => ({ ...c, pool_usd, pool_line, pool_plus });
  const circle: Card = { ...base, id: 'circle-developer-grants', title: 'Circle Developer Grants', summary: 'milestone-based USDC grants · rolling', max_award_usd: null };
  const l = landingFrom(
    [pooled(monad, 250000, '$250K+ in prizes', true), pooled(arc, 10000, '10,000 USDC pool'), base, circle, sponsored, campaign],
    stats(),
    now,
  );
  const t = (id: string) => l.tiles.find((x) => x.id === id)!;
  assert.deepEqual([t('monad-metropolis').prize, t('monad-metropolis').prize_note], ['$250K+ in prizes', 'up to $25,000 per winner']);
  assert.deepEqual([t('arc-microgrants').prize, t('arc-microgrants').prize_note], ['10,000 USDC pool', 'up to $500 per grant']);
  assert.deepEqual([t('base-builder-grants').prize, t('base-builder-grants').prize_note], ['up to $5,000 per grant', null]);
  assert.deepEqual([t('circle-developer-grants').prize, t('circle-developer-grants').prize_note], ['milestone-based USDC grants', null]);
  // v2.9 F21: the top prizes, never the pools; the sponsor and EarnKit campaigns never count.
  assert.equal(l.open_text, '$30.5K');
  assert.equal(landingFrom([pooled(arc, 10000, '10,000 USDC pool')], stats(), now).open_text, '$500');
});

test('v2.9 F21: the real program files: the top prizes add up to "$160.5K open right now"', () => {
  const ids = ['colosseum-worlds-fair', 'monad-metropolis', 'arc-microgrants', 'circle-developer-grants', 'base-builder-grants'];
  const cards = ids.map((id): Card => {
    const f = ProgramFile.parse(committedProgram(id));
    return { ...arc, id, title: f.title, reward: f.reward, max_award_usd: f.max_award_usd ?? null, min_award_usd: f.min_award_usd ?? null, ends_at: null, ...poolFacts({ ...f, pool_usd: f.pool_usd == null ? null : String(f.pool_usd), campaign: null }) };
  });
  const l = landingFrom(cards, stats(), now);
  assert.equal(l.open_text, '$160.5K');
  const t = (id: string) => l.tiles.find((x) => x.id === id)!;
  assert.equal(t('colosseum-worlds-fair').prize, '$840K in prizes');
  assert.equal(t('colosseum-worlds-fair').prize_note, 'up to $30,000 per winner');
  assert.equal(t('monad-metropolis').prize, '$250K+ in prizes');
  assert.equal(t('arc-microgrants').prize, '10,000 USDC pool');
  assert.equal(t('circle-developer-grants').prize, '$200K in grants');
  // Review #1: grant programs say "per grant", with the stated range; hackathons keep "per winner".
  assert.equal(t('circle-developer-grants').prize_note, '$5K–$100K per grant');
  assert.equal(t('arc-microgrants').prize_note, '500 USDC per grant');
  assert.equal(t('monad-metropolis').prize_note, 'up to $25,000 per winner');
  // Fix: sorted by pool, highest first; no pool falls back to the per-winner amount.
  assert.deepEqual(l.tiles.map((x) => x.id), ['colosseum-worlds-fair', 'monad-metropolis', 'circle-developer-grants', 'arc-microgrants', 'base-builder-grants']);
  assert.equal(t('base-builder-grants').prize, 'up to $5,000 per grant');
  assert.equal(t('base-builder-grants').pool_usd, null);
});

test('v2.7.1 fix: byPool orders pools first by size, then the rest by per-winner amount, then the sooner deadline', () => {
  const c = (id: string, pool_usd: number | null, max_award_usd: number | null, ends: string | null): Card =>
    ({ ...arc, id, pool_usd, max_award_usd, ends_at: ends ? new Date(ends) : null });
  const sorted = [
    c('small-pool', 10000, 500, null),
    c('no-pool-big-award', null, 50000, null),
    c('big-pool', 840000, 30000, null),
    c('nothing', null, null, null),
    c('same-pool-later', 10000, 500, '2026-10-30T00:00:00Z'),
    c('same-pool-sooner', 10000, 500, '2026-10-10T00:00:00Z'),
  ].sort(byPool).map((x) => x.id);
  // Review #10: every program with a pool before any without (never a pool against a per-winner amount).
  assert.deepEqual(sorted, ['big-pool', 'same-pool-sooner', 'same-pool-later', 'small-pool', 'no-pool-big-award', 'nothing']);
});

test('v2.7.1: the stats line shows only from 100 installs (v2.14: never the builder bonus)', () => {
  assert.equal(INSTALLS_SHOWN_FROM, 100);
  assert.equal(statsLine(stats({ installs: 99, bonus_pools_eth: 2 })), null);
  assert.equal(statsLine(stats({ installs: 100 })), '100 agents earning');
  assert.equal(statsLine(stats({ installs: 312, bonus_paid_eth: 0.42 })), '312 agents earning');
  assert.equal(statsLine(stats({ bonus_paid_eth: 1.13 })), null);
  assert.equal(statsLine(stats({ installs: 1234 })), '1,234 agents earning');
});

test('Review Focus 1: an unreachable database rejects; never empty data that would read "$0 open"', async () => {
  const g = globalThis as { earnkitSql?: { end: (o?: object) => Promise<void> } };
  const prevUrl = process.env.DATABASE_URL;
  const prevPool = g.earnkitSql;
  process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none?connect_timeout=2';
  delete g.earnkitSql;
  try {
    await assert.rejects(readLanding(now));
  } finally {
    const opened = Reflect.get(g, 'earnkitSql') as typeof prevPool; // the pool readLanding opened
    await opened?.end({ timeout: 0 });
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevPool) g.earnkitSql = prevPool;
    else delete g.earnkitSql;
  }
});

// ---- v2.7 §2, Ruling 22 (plan): readGuidePage.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const programFile = (name: string) =>
  committedProgram(name);

test('v2.7.1: programs:sync writes pool_usd and the row reads back as the card\'s pool facts', dbTest, async () => {
  await upsertProgram(ProgramFile.parse(programFile('arc-microgrants')));
  const row = await getProgramRow('arc-microgrants');
  assert.equal(Number(row.pool_usd), 10000);
  assert.deepEqual(poolFacts(row), { pool_usd: 10000, pool_plus: false, pool_line: '10,000 USDC pool' });
  await upsertProgram(ProgramFile.parse(programFile('base-builder-grants')));
  assert.equal((await getProgramRow('base-builder-grants')).pool_usd, null);
});

test('review #1, #9: Circle\'s range and pool source reach the DB and the guide\'s sources', dbTest, async () => {
  await upsertProgram(ProgramFile.parse(programFile('circle-developer-grants')));
  const row = await getProgramRow('circle-developer-grants');
  assert.equal(Number(row.min_award_usd), 5000);
  assert.equal(row.pool_source_url, 'https://circle.questbook.app/');
  const page = await readGuidePage('circle-developer-grants', now);
  assert.deepEqual(page?.sources.slice(0, 2), [
    { label: 'program page', url: 'https://www.circle.com/grant' },
    { label: 'prize pool', url: 'https://circle.questbook.app/' },
  ]);
});

test('readGuidePage: a curated program\'s guide, plain JSON (unstable_cache serializes it)', dbTest, async (t) => {
  // isOpen reads the clock itself: pin it to the test's `now`, so Arc is open whatever today's date.
  t.mock.timers.enable({ apis: ['Date'], now });
  await upsertProgram(ProgramFile.parse(programFile('arc-microgrants')));
  const page = await readGuidePage('arc-microgrants', now);
  assert.ok(page);
  assert.deepEqual(JSON.parse(JSON.stringify(page)), page);
  assert.equal(page.title, 'Arc Microgrants');
  assert.equal(page.open, true);
  assert.equal(page.source_url, 'https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq');
  assert.match(page.guide.header, /^Arc Microgrants · 500 USDC × 20 grants · ends Oct 14, 11:59 PM ET$/);
  assert.equal(page.ecosystem, page.guide.wants?.ecosystem ?? 'Arc');
  assert.deepEqual(page.sources[0], { label: 'program page', url: page.source_url });
  assert.ok((await readGuideIds()).includes('arc-microgrants'));
});

test('readGuidePage: a closed curated program still has a page, not open', dbTest, async () => {
  const f = { ...programFile('arc-microgrants'), id: `t7-closed-${process.pid}`, status: 'closed' };
  try {
    await upsertProgram(ProgramFile.parse(f));
    const page = await readGuidePage(f.id, now);
    assert.ok(page);
    assert.equal(page.open, false);
    assert.match(page.guide.header, /· closed$/);
    // Fix round 1: the gate's id set keeps closed curated programs (old links keep working).
    assert.ok((await readGuideIds()).includes(f.id));
  } finally {
    await sql()`DELETE FROM programs WHERE id = ${f.id}`;
  }
});

test('readGuidePage: an EarnKit campaign, a sponsor campaign and an unknown id are null (a 404)', dbTest, async () => {
  const camp = programFile('earnkit-campaign-1-base');
  await upsertProgram(ProgramFile.parse(camp));
  assert.equal(await readGuidePage(camp.id, now), null);
  assert.ok(!(await readGuideIds()).includes(camp.id), 'campaigns are not in the gate set');
  const sponsor = `t7-sponsor-${process.pid}`;
  try {
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
        status, existing_work, builder_bonus, campaign, source)
      VALUES (${sponsor}, 'X', 'a', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', true,
        ${sql().json({ kind: 'sponsor' })}, 'sponsor')`;
    assert.equal(await readGuidePage(sponsor, now), null);
    assert.ok(!(await readGuideIds()).includes(sponsor));
  } finally {
    await sql()`DELETE FROM programs WHERE id = ${sponsor}`;
  }
  assert.equal(await readGuidePage('nope', now), null);
});

test('Review Focus 1: an unreachable database makes readGuidePage reject (the unavailable panel), never null (a 404)', async () => {
  const g = globalThis as { earnkitSql?: { end: (o?: object) => Promise<void> } };
  const prevUrl = process.env.DATABASE_URL;
  const prevPool = g.earnkitSql;
  process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none?connect_timeout=2';
  delete g.earnkitSql;
  try {
    await assert.rejects(readGuidePage('arc-microgrants', now));
  } finally {
    const opened = Reflect.get(g, 'earnkitSql') as typeof prevPool;
    await opened?.end({ timeout: 0 });
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevPool) g.earnkitSql = prevPool;
    else delete g.earnkitSql;
  }
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('v2.9 F21: the landing figure is moneyText(openMoneyUsd) of the same cards, and the no-repo first message says it', () => {
  const pooledMonad = { ...monad, pool_usd: 840000, pool_plus: true };
  const pooledArc = { ...arc, pool_usd: 10000 };
  const cards = [pooledMonad, pooledArc, sponsored, campaign, base];
  const l = landingFrom(cards, stats(), now);
  assert.equal(l.open_text, moneyText(openMoneyUsd(cards, now)));
  assert.equal(l.open_text, '$30.5K');
  const first = presentFirstMessage({
    more: true, // v2.10 item 2: the v2.9 headline is behind "show more"
    alerts: [], campaigns: [], cards, repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now,
  });
  assert.ok(first.startsWith(`${l.open_text} in prizes open right now.`), first);
});

test('v2.8 Ruling C5: an investment program reads "up to $1M investment", never "per winner"', () => {
  const speedrun: Card = {
    id: 'a16z-speedrun',
    title: 'a16z speedrun SR008',
    summary: 'up to $1M · priority window Oct 12 to Nov 1',
    tag: 'long shot',
    each_time: [],
    ends_at: null,
    max_award_usd: 1_000_000,
    reward: 'Up to $1M in funding and $10M+ in credits',
    investment: true,
    difficulty: { level: 'Hard', estimate: false, rated: false, basis: 'x' },
    logo: null,
    chains: [],
    any_chain: true,
  };
  const [tile] = landingFrom([speedrun], stats(), now).tiles;
  assert.equal(tile.prize, 'up to $1M investment');
  assert.equal(tile.prize_note, null);
  assert.doesNotMatch(JSON.stringify(tile), /per winner/);
  // Without the flag, the same card is a prize.
  const [prize] = landingFrom([{ ...speedrun, investment: false }], stats(), now).tiles;
  assert.equal(prize.prize, 'up to $1,000,000 per winner');
});

test('10.11 the won line: absent at 0 (never "$0"); "Builders using EarnKit won $12,500" from announced wins', () => {
  assert.equal(landingFrom([arc], stats(), now).won_line, null);
  assert.equal(landingFrom([arc], stats({ builders_won_usd: 12_500 }), now).won_line, 'Builders using EarnKit won $12,500');
  assert.equal(wonLine(0), null);
  assert.equal(wonLine(1_234_567), 'Builders using EarnKit won $1,234,567');
});

// ---- v2.13 Task 12: the landing page (spec "Landing page", R15).
const page = (landing: Parameters<typeof HomeView>[0]['landing']) => renderToStaticMarkup(React.createElement(HomeView, { landing })).replace(/&#x27;/g, "'");
const ROW = { rank: 1, line: 'Top 1%', handle: 'maya_makes', name: 'Maya Chen', avatar: null, raising: null, chains: ['base' as const], project: 'Recipe planner', best: '31 people this week' };
const CARD = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import. It plans a week.', chips: ['Went live', '+31 people', '12 commits'], titles: [], pinned: false };

test('12.1 the hero, word for word, and its one button', () => {
  assert.equal(BENCH_HERO_TITLE, 'Ship every week. Get funded.');
  assert.equal(BENCH_HERO_SUBTITLE, 'Add EarnKit to your AI agent. It puts your project on the Bench, posts what you ship, and finds you grants and a community round.');
  const h = page({ ...LANDING_FIXTURE, bench: { rows: [ROW], chips: ['base'], cards: [CARD], raising: true } });
  assert.ok(h.includes(BENCH_HERO_TITLE) && h.includes(BENCH_HERO_SUBTITLE) && h.includes('Add to your agent'));
  assert.ok(!h.includes('Agents only'), 'no all-caps eyebrow under the flag');
  assert.ok(!/Builder bonus/i.test(h), 'R16');
});

test('12.1b (v2.13.1 O3) EARNKIT_RAISING off: the hero and How it works never mention raising; on: as built', () => {
  assert.equal(BENCH_HERO_SUBTITLE_NO_RAISE, 'Add EarnKit to your AI agent. It puts your project on the Bench, posts what you ship, and finds you grants.');
  assert.deepEqual(BENCH_STEPS_NO_RAISE, ['Add EarnKit to your agent and connect X.', 'Your project goes on the Bench and your agent posts what you ship each week.', 'Get funded: grants that fit.']);
  const off = page({ ...LANDING_FIXTURE, bench: { rows: [ROW], chips: ['base'], cards: [CARD], raising: false } });
  assert.ok(off.includes(BENCH_HERO_SUBTITLE_NO_RAISE) && !off.includes(BENCH_HERO_SUBTITLE), 'the raise-free subtitle');
  for (const s of BENCH_STEPS_NO_RAISE) assert.ok(off.includes(s), s);
  assert.doesNotMatch(off, /\braise\b|raising|your own coin/i);
  const on = page({ ...LANDING_FIXTURE, bench: { rows: [ROW], chips: ['base'], cards: [CARD], raising: true } });
  assert.ok(on.includes(BENCH_HERO_SUBTITLE) && !on.includes(BENCH_HERO_SUBTITLE_NO_RAISE));
  for (const s of BENCH_STEPS) assert.ok(on.includes(s), s);
});

test('12.2 the sections in order: hero, the Bench top 10, this week on the Bench, grants open now, how it works, backed by', () => {
  const h = page({ ...LANDING_FIXTURE, bench: { rows: Array.from({ length: 12 }, (_, i) => ({ ...ROW, handle: `b${i}`, rank: i + 1 })), chips: ['base'], cards: [CARD], raising: true } });
  const at = [BENCH_HERO_TITLE, BENCH_TOP_TITLE, CAROUSEL_TITLE, 'Money open now', BENCH_HOW_TITLE, 'Backed by'].map((s) => h.indexOf(s));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), at.join(','));
  assert.equal((h.match(/data-row=/g) ?? []).length, 10, 'the top 10');
  assert.match(h, new RegExp(`href="/bench"[^>]*>${SEE_BENCH}`));
  assert.match(h, /href="\/bench\?chain=base"/);
  assert.match(h, /href="\/bench\?raising=1"/);
  assert.match(h, /data-shape="square"/);
  for (const s of BENCH_STEPS) assert.ok(h.includes(s), s);
});

test('12.3 the square card: photo, @handle, project, the first line of the update and at most two chips', () => {
  const h = page({ ...LANDING_FIXTURE, bench: { rows: [ROW], chips: [], cards: [CARD], raising: true } });
  assert.ok(h.includes('Added fridge photo import.') && !h.includes('It plans a week.'));
  assert.ok(h.includes('Went live') && h.includes('+31 people') && !h.includes('12 commits'));
  assert.ok(h.includes('@maya_makes') && h.includes('Recipe planner'));
  // No updates this week: no carousel (the Bench and the grants still show).
  const none = page({ ...LANDING_FIXTURE, bench: { rows: [ROW], chips: [], cards: [], raising: true } });
  assert.ok(!none.includes(CAROUSEL_TITLE) && none.includes(BENCH_TOP_TITLE) && none.includes('Money open now'));
});

test('12.5 the footer tagline: "Ship every week. Get funded."', () => {
  assert.equal(BENCH_FOOTER_TAGLINE, 'Ship every week. Get funded.');
  assert.ok(renderToStaticMarkup(React.createElement(Footer)).includes(`>${BENCH_FOOTER_TAGLINE}<`));
});

test('12.6 readLanding: the Bench (at most 10 rows, its chips, the carousel cards); plain JSON', dbTest, async () => {
  const on = await readLanding(now);
  assert.ok(on.bench);
  assert.ok(Array.isArray(on.bench.rows) && on.bench.rows.length <= 10);
  assert.ok(Array.isArray(on.bench.chips) && Array.isArray(on.bench.cards) && on.bench.cards.length <= 12);
  assert.deepEqual(Object.keys(on.bench).sort(), ['cards', 'chips', 'raising', 'rows']);
  assert.deepEqual(JSON.parse(JSON.stringify(on)), on, 'unstable_cache serializes it');
});

test('12.8 no all-caps labels: "Backed by" and the footer column titles are sentence case', () => {
  const caps = (h: string, text: string) => new RegExp(`<(?:p|h3) class="[^"]*\\buppercase\\b[^"]*">\\s*${text}\\s*<`).test(h);
  const on = page({ ...LANDING_FIXTURE, bench: { rows: [ROW], chips: [], cards: [CARD], raising: true } });
  const fallback = page({ ...LANDING_FIXTURE, bench: null });
  for (const t of ['Backed by', 'Product', 'Resources', 'Legal', 'Contact']) {
    assert.ok(on.includes(`>${t}<`) && !caps(on, t), t);
    assert.ok(!caps(fallback, t), `no Bench data: ${t}`);
  }
  assert.doesNotMatch(on.split('<footer')[1], /\buppercase\b/, 'the footer');
});

test('12.9 the landing\'s Bench parts never import the /bench page module (BenchView pulls in its Footer)', () => {
  const src = readFileSync(join(import.meta.dirname, '../../app/components/sections/BenchTop.tsx'), 'utf8');
  assert.doesNotMatch(src, /bench\/BenchView'/);
});
