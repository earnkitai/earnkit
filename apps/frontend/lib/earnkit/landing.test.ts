import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { bonusPill, bonusPoolsText, HOME_CARDS, INSTALLS_SHOWN_FROM, landingFrom, readGuideIds, readGuidePage, readLanding, statsLine } from './landing';
import { ProgramFile } from './program-file';
import { getProgramRow, poolFacts, upsertProgram } from './programs';
import { sql } from './db';
import type { Card } from './present';
import type { PublicStats } from './stats';
import { committedProgram } from './fixtures/program-file';

const stats = (o: Partial<PublicStats> = {}): PublicStats => ({
  open_money_usd: 0,
  programs_open: 5,
  bonus_programs_open: 4,
  coins_launched: 0,
  fees_to_safe_eth: 0,
  bonus_paid_eth: 0,
  bonus_pools_eth: 0,
  installs: 12,
  ...o,
});
const now = new Date('2026-10-06T12:00:00Z');
const medium = { level: 'Medium' as const, estimate: true, basis: 'no past results yet' };

const arc: Card = {
  id: 'arc-microgrants',
  title: 'Arc Microgrants',
  summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET',
  tag: null,
  each_time: [],
  ends_at: new Date('2026-10-15T03:59:00Z'),
  max_award_usd: 500,
  builder_bonus: true,
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
  builder_bonus: true,
  difficulty: { level: 'Hard', estimate: false, basis: '20 of ~160 entries won last round' },
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
  builder_bonus: false,
  difficulty: null,
  logo: null,
  chains: ['monad', 'base', 'robinhood'],
};
const sponsored: Card = { ...arc, id: 'acme-campaign', title: 'Acme', max_award_usd: 90000, sponsored: true, builder_bonus: false };
const campaign: Card = { ...arc, id: 'earnkit-campaign-1-base', title: 'EarnKit Campaign #1', max_award_usd: 80000, earnkit_campaign: true, builder_bonus: false };

test('v2.7 §1: tiles are curated programs sorted by prize; plain JSON (Review Focus 2)', () => {
  const l = landingFrom([monad, arc, sponsored, campaign, base], new Map([['arc-microgrants', 42n * 10n ** 16n]]), stats(), now);
  assert.deepEqual(l.tiles.map((t) => t.id), ['monad-metropolis', 'base-builder-grants', 'arc-microgrants']);
  const arcTile = l.tiles.find((t) => t.id === 'arc-microgrants')!;
  assert.equal(arcTile.bonus, '+ 0.42 ETH bonus');
  assert.equal(arcTile.ends, '9 days left'); // Oct 15 03:59 UTC is 9 UTC days after Oct 6
  assert.equal(l.bonus_pools, '0.42 ETH in pools so far');
  assert.deepEqual(JSON.parse(JSON.stringify(l)), l);
});

test('v2.7.1: each tile field; no pool means the per-winner amount is the big line', () => {
  const l = landingFrom([monad, arc, base], new Map([['base-builder-grants', null]]), stats(), now);
  const [m, b, a] = l.tiles;
  assert.deepEqual(m, {
    id: 'monad-metropolis',
    title: 'Monad Metropolis',
    chain: 'Monad · Base · Robinhood Chain',
    prize: 'up to $25,000 per winner',
    prize_note: null, // the big line already says it
    prize_usd: 25000,
    pool_usd: null,
    difficulty: '—',
    ends: '14 days left',
    bonus: null, // opted out
    logo: null,
  });
  assert.equal(b.ends, 'rolling');
  assert.equal(b.difficulty, 'Hard');
  assert.equal(b.bonus, null); // its round froze (I2)
  assert.equal(a.difficulty, 'Medium (estimate)');
  assert.equal(a.bonus, '+ Builder bonus'); // no pool read yet: the pill still shows
  assert.equal(a.logo, '/programs/arc-microgrants.svg');
  assert.equal(b.prize, 'up to $5,000 per winner');
  assert.equal(l.open_text, null); // no tile states a pool
  assert.equal(l.bonus_pools, null); // every pool empty: never "0 ETH"
  assert.equal(HOME_CARDS, 6);
});

test('v2.7.1: a pool is the big line, "up to $X per winner" under it; unknown amounts keep the curated text', () => {
  const pooled = (c: Card, pool_usd: number, pool_line: string, pool_plus = false): Card => ({ ...c, pool_usd, pool_line, pool_plus });
  const circle: Card = { ...base, id: 'circle-developer-grants', title: 'Circle Developer Grants', summary: 'milestone-based USDC grants · rolling', max_award_usd: null };
  const l = landingFrom(
    [pooled(monad, 250000, '$250K+ in prizes', true), pooled(arc, 10000, '10,000 USDC pool'), base, circle, sponsored, campaign],
    new Map(),
    stats(),
    now,
  );
  const t = (id: string) => l.tiles.find((x) => x.id === id)!;
  assert.deepEqual([t('monad-metropolis').prize, t('monad-metropolis').prize_note], ['$250K+ in prizes', 'up to $25,000 per winner']);
  assert.deepEqual([t('arc-microgrants').prize, t('arc-microgrants').prize_note], ['10,000 USDC pool', 'up to $500 per winner']);
  assert.deepEqual([t('base-builder-grants').prize, t('base-builder-grants').prize_note], ['up to $5,000 per winner', null]);
  assert.deepEqual([t('circle-developer-grants').prize, t('circle-developer-grants').prize_note], ['milestone-based USDC grants', null]);
  // The sponsor and EarnKit campaigns never count; "+" for Monad's "+" and for the programs without a pool.
  assert.equal(l.open_text, '$260K+');
  assert.equal(landingFrom([pooled(arc, 10000, '10,000 USDC pool')], new Map(), stats(), now).open_text, '$10K');
});

test('v2.7.1: the real program files add up to "$1.3M+ open right now"', () => {
  const ids = ['colosseum-worlds-fair', 'monad-metropolis', 'arc-microgrants', 'circle-developer-grants', 'base-builder-grants'];
  const cards = ids.map((id): Card => {
    const f = ProgramFile.parse(committedProgram(id));
    return { ...arc, id, title: f.title, max_award_usd: f.max_award_usd ?? null, ends_at: null, ...poolFacts({ ...f, pool_usd: f.pool_usd == null ? null : String(f.pool_usd), campaign: null }) };
  });
  const l = landingFrom(cards, new Map(), stats(), now);
  assert.equal(l.open_text, '$1.3M+');
  const t = (id: string) => l.tiles.find((x) => x.id === id)!;
  assert.equal(t('colosseum-worlds-fair').prize, '$840K in prizes');
  assert.equal(t('colosseum-worlds-fair').prize_note, 'up to $30,000 per winner');
  assert.equal(t('monad-metropolis').prize, '$250K+ in prizes');
  assert.equal(t('arc-microgrants').prize, '10,000 USDC pool');
  assert.equal(t('circle-developer-grants').prize, '$200K in grants');
  assert.equal(t('base-builder-grants').prize, 'up to $5,000 per winner');
  assert.equal(t('base-builder-grants').pool_usd, null);
});

test('v2.7.1: the stats line shows only from 100 installs or once bonus is paid', () => {
  assert.equal(INSTALLS_SHOWN_FROM, 100);
  assert.equal(statsLine(stats({ installs: 99, bonus_pools_eth: 2 })), null);
  assert.equal(statsLine(stats({ installs: 100 })), '100 agents earning');
  assert.equal(statsLine(stats({ installs: 312, bonus_paid_eth: 0.42 })), '312 agents earning · 0.42 ETH builder bonus paid');
  assert.equal(statsLine(stats({ bonus_paid_eth: 1.13 })), '1.13 ETH builder bonus paid');
  // Fix round 1, Important 3: float flooring never shows a cent less than the 6-decimal amount.
  assert.equal(statsLine(stats({ bonus_paid_eth: 0.29 })), '0.29 ETH builder bonus paid');
  assert.equal(statsLine(stats({ bonus_paid_eth: 0.299999 })), '0.29 ETH builder bonus paid');
  assert.equal(statsLine(stats({ bonus_paid_eth: 0.004 })), 'under 0.01 ETH builder bonus paid');
  assert.equal(statsLine(stats({ installs: 1234 })), '1,234 agents earning');
});

test('v2.7.1: builder bonus pills and the pools figure', () => {
  assert.equal(bonusPill('new pool'), '+ Builder bonus');
  assert.equal(bonusPill('new pool', true), '+ Builder bonus · new pool');
  assert.equal(bonusPill('0.42 ETH so far'), '+ 0.42 ETH bonus');
  assert.equal(bonusPill('0.42 ETH so far', true), '+ 0.42 ETH bonus');
  assert.equal(bonusPill('under 0.01 ETH so far'), '+ under 0.01 ETH bonus');
  assert.equal(bonusPoolsText(0n), null);
  assert.equal(bonusPoolsText(10n ** 15n), 'under 0.01 ETH in pools so far');
  assert.equal(bonusPoolsText(6n * 10n ** 17n), '0.60 ETH in pools so far');
  // Pools of programs without a bonus (opted out, frozen) never count.
  const l = landingFrom([monad, arc], new Map([['monad-metropolis', 10n ** 18n], ['arc-microgrants', 2n * 10n ** 17n]]), stats(), now);
  assert.equal(l.bonus_pools, '0.20 ETH in pools so far');
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

test('readGuidePage: a curated program\'s guide, plain JSON (unstable_cache serializes it)', dbTest, async () => {
  await upsertProgram(ProgramFile.parse(programFile('arc-microgrants')));
  const page = await readGuidePage('arc-microgrants', now);
  assert.ok(page);
  assert.deepEqual(JSON.parse(JSON.stringify(page)), page);
  assert.equal(page.title, 'Arc Microgrants');
  assert.equal(page.open, true);
  assert.equal(page.source_url, 'https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq');
  assert.match(page.guide.header, /^Arc Microgrants · 500 USDC × 20 grants · ends Oct 14$/);
  assert.equal(page.board_path, '/bonus/arc-microgrants-2026-09-16');
  assert.equal(page.guide.bonus?.board.endsWith(page.board_path!), true);
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
    assert.equal(page.board_path, null);
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
