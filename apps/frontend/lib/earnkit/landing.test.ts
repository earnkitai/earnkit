import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME_CARDS, INSTALLS_SHOWN_FROM, landingFrom, readGuidePage, readLanding } from './landing';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { sql } from './db';
import type { Card } from './present';
import type { PublicStats } from './stats';

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
  assert.equal(l.open_usd, 30500);
  const arcTile = l.tiles.find((t) => t.id === 'arc-microgrants')!;
  assert.equal(arcTile.bonus, '0.42 ETH so far');
  assert.equal(arcTile.ends, '9 days left'); // Oct 15 03:59 UTC is 9 UTC days after Oct 6
  assert.deepEqual(JSON.parse(JSON.stringify(l)), l);
});

test('v2.7 §1: each tile field', () => {
  const l = landingFrom([monad, arc, base], new Map([['base-builder-grants', null]]), stats(), now);
  const [m, b, a] = l.tiles;
  assert.deepEqual(m, {
    id: 'monad-metropolis',
    title: 'Monad Metropolis',
    chain: 'Monad · Base · Robinhood Chain',
    prize: 'up to $25,000 per winner',
    prize_note: '$25,000 top prize',
    prize_usd: 25000,
    difficulty: '—',
    ends: '14 days left',
    bonus: null, // opted out
    logo: null,
  });
  assert.equal(b.ends, 'rolling');
  assert.equal(b.difficulty, 'Hard');
  assert.equal(b.bonus, null); // its round froze (I2)
  assert.equal(a.difficulty, 'Medium (estimate)');
  assert.equal(a.bonus, 'new pool'); // no pool read yet
  assert.equal(a.logo, '/programs/arc-microgrants.svg');
  assert.equal(a.prize, 'up to $500 per winner');
  assert.equal(a.prize_note, '500 USDC × 20 grants');
  assert.equal(b.prize, 'up to $5,000 per winner');
  assert.equal(b.prize_note, null); // "up to $5,000" only restates the amount
  assert.equal(HOME_CARDS, 6);
});

test('Ruling C8: the cards\' per-winner amounts add up to the hero figure; unknown amounts keep the curated text', () => {
  const circle: Card = { ...base, id: 'circle-developer-grants', title: 'Circle Developer Grants', summary: 'milestone-based USDC grants · rolling', max_award_usd: null };
  const l = landingFrom([monad, arc, base, circle, sponsored, campaign], new Map(), stats(), now);
  assert.equal(l.tiles.reduce((sum, t) => sum + t.prize_usd, 0), l.open_usd);
  assert.equal(l.open_usd, 30500);
  const c = l.tiles.find((t) => t.id === 'circle-developer-grants')!;
  assert.equal(c.prize, 'milestone-based USDC grants');
  assert.equal(c.prize_note, null);
  assert.equal(c.prize_usd, 0);
  for (const t of l.tiles.filter((x) => x.prize_usd > 0)) assert.match(t.prize, /^up to \$[\d,]+ per winner$/);
});

test('Ruling 20 (plan): installs hidden under 100; bonus paid > pools > programs', () => {
  const label = (s: PublicStats) => landingFrom([arc], new Map(), s, now).stats.map((i) => `${i.label}: ${i.value}`);
  assert.equal(INSTALLS_SHOWN_FROM, 100);
  assert.deepEqual(label(stats({ installs: 99 })).filter((s) => s.startsWith('Agents earning')), []);
  assert.ok(label(stats({ installs: 100 })).includes('Agents earning: 100'));
  assert.ok(label(stats({ installs: 1234 })).includes('Agents earning: 1,234'));
  assert.ok(label(stats({ bonus_paid_eth: 0.5, bonus_pools_eth: 2 })).includes('Builder bonus: 0.50 ETH paid'));
  assert.ok(label(stats({ bonus_pools_eth: 0.6 })).includes('Builder bonus: 0.60 ETH so far'));
  // Fix round 1, Important 3: float flooring never shows a cent less than the 6-decimal amount.
  assert.ok(label(stats({ bonus_pools_eth: 0.29 })).includes('Builder bonus: 0.29 ETH so far'));
  assert.ok(label(stats({ bonus_paid_eth: 1.13 })).includes('Builder bonus: 1.13 ETH paid'));
  assert.ok(label(stats({ bonus_pools_eth: 0.57 })).includes('Builder bonus: 0.57 ETH so far'));
  assert.ok(label(stats({ bonus_pools_eth: 0.299999 })).includes('Builder bonus: 0.29 ETH so far')); // still rounds down
  assert.ok(label(stats({ bonus_pools_eth: 0.004 })).includes('Builder bonus: under 0.01 ETH so far'));
  assert.ok(label(stats()).includes('Builder bonus: on 4 programs'));
  assert.equal(label(stats())[0], 'Open money: $500');
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
  JSON.parse(readFileSync(join(import.meta.dirname, `../../../../programs/${name}.json`), 'utf8'));

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
  } finally {
    await sql()`DELETE FROM programs WHERE id = ${f.id}`;
  }
});

test('readGuidePage: an EarnKit campaign, a sponsor campaign and an unknown id are null (a 404)', dbTest, async () => {
  const camp = programFile('earnkit-campaign-1-base');
  await upsertProgram(ProgramFile.parse(camp));
  assert.equal(await readGuidePage(camp.id, now), null);
  const sponsor = `t7-sponsor-${process.pid}`;
  try {
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
        status, existing_work, builder_bonus, campaign, source)
      VALUES (${sponsor}, 'X', 'a', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', true,
        ${sql().json({ kind: 'sponsor' })}, 'sponsor')`;
    assert.equal(await readGuidePage(sponsor, now), null);
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
