import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LeaderboardView from '../../app/leaderboard/LeaderboardView';
import { campaignRow, earnkitCampaignRows } from './leaderboard';
import type { CampaignConfig } from './campaigns';
import { sql } from './db';
import { BOARD_MAX, boardRows, type BoardRow } from './page-data';

(globalThis as { React?: typeof React }).React = React;

const campaign: CampaignConfig = {
  kind: 'earnkit',
  prize: { token: '0x' + 'a'.repeat(40), symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5, amount_each: '1', prize_usd_total: 500, metric: 'unique_wallets', min_score: 10,
};
const now = new Date('2026-10-04T12:00:00Z');
const p = { id: 'c1', title: 'C1', campaign, ends_at: new Date('2026-10-18T23:59:00Z'), status: 'active' as const, state: null };
const entry = (id: number, score: number | null) => ({
  id, program_id: 'c1', score, submitted_at: new Date(Date.UTC(2026, 9, 1, id)), payout_wallet: `0x${String(id).padStart(40, '0')}`,
  installation_id: id, vetoed_at: null, payout_status: null, prize_tx: null,
});

test('campaignRow: live numbers without an entry; the builder\'s best standing with one', () => {
  const entries = [30, 25, 20, 18, 14, 9, null].map((s, i) => entry(i + 1, s));
  const row = campaignRow(p, entries, new Set(), now);
  assert.deepEqual(
    { prize: row.prize, entries: row.entries, cutoff: row.cutoff, you: row.you, open: row.open, each: row.prize_usd_each },
    { prize: '$100 each to top 5 (in MINI)', entries: 7, cutoff: 14, you: null, open: true, each: 100 },
  );
  assert.equal(campaignRow(p, entries, new Set([6, 7]), now).you, '#6, 1 user short of the 10 minimum');
  assert.equal(campaignRow(p, entries, new Set([3, 7]), now).you, '#3, in the top 5');
  assert.equal(campaignRow(p, entries, new Set([7]), now).you, 'not scored yet');
  const ended = campaignRow({ ...p, ends_at: new Date('2026-10-01T00:00:00Z'), state: 'review' }, entries, new Set([2]), now);
  assert.deepEqual([ended.open, ended.you], [false, 'in review']);
});

test('I1: the cutoff is the last payable pick (min score, vetoes, one prize per wallet), else null', () => {
  // Under the minimum: nobody is payable, so the field is "not full", never "#5 has 2 users".
  const low = campaignRow(p, [30, 8, 5, 3, 2].map((s, i) => entry(i + 1, s)), new Set(), now);
  assert.deepEqual([low.cutoff, low.scored, low.min_score], [null, 5, 10]);
  // A vetoed #1 and a repeated wallet don't hold a slot: the bar is the 5th payable entry.
  const entries = [40, 30, 25, 20, 18, 14, 12].map((s, i) => entry(i + 1, s));
  entries[0].vetoed_at = new Date() as never;
  entries[2].payout_wallet = entries[1].payout_wallet;
  assert.equal(campaignRow(p, entries, new Set(), now).cutoff, 12);
  // Before the first scoring nothing is scored.
  assert.equal(campaignRow(p, [entry(1, null), entry(2, null)], new Set(), now).scored, 0);
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const dbTest = db;
// v2.12.1 T11: this run's board people (fresh ids; builder_live rows count in every rank).
const B = 2_129_000_000 + Math.floor(Math.random() * 300_000) * 20;
after(async () => {
  if (!process.env.DATABASE_URL) return;
  const ids = Array.from({ length: 20 }, (_, i) => B + i);
  for (const t of ['builder_projects', 'builder_live', 'builder_profiles']) await sql()`DELETE FROM ${sql()(t)} WHERE builder_id IN ${sql()(ids)}`;
  await sql().end();
});

const ROWS: BoardRow[] = Array.from({ length: 25 }, (_, i) => ({ rank: i + 1, handle: `lee${i}`, avatar: i ? null : 'https://pbs.twimg.com/a_400x400.jpg', best: `${140 - i} people use app${i}` }));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('11.5 the leaderboard is one list of ranked people with a confirmed X; no filters, no capitals', dbTest, async () => {
  const { rows } = await boardRows();
  for (const r of rows) assert.ok(r.handle && r.rank >= 1);
  const html = renderToStaticMarkup(React.createElement(LeaderboardView, { rows: ROWS, count: 25 }));
  assert.doesNotMatch(html, /Filters|aria-label="Chain"|uppercase|Top \d+%/);
  assert.match(html, /25 builders/);
});

test('11.5b the board: one ordered list linking each page (reserved handles at /b/), the best project in plain words', () => {
  const rows = [...ROWS.slice(0, 2), { rank: 7, handle: 'terms', avatar: null, best: 'Shipped 3 apps with AI' }];
  const h = renderToStaticMarkup(React.createElement(LeaderboardView, { rows, count: 3 }));
  const main = h.split('<footer')[0];
  assert.equal((main.match(/<li data-row=/g) ?? []).length, 3);
  assert.match(main, /<ol/);
  assert.match(main, /href="\/lee0"/);
  assert.match(main, /href="\/b\/terms"/);
  assert.match(text(main), /#1 @lee0 140 people use app0/);
  assert.match(text(main), /#7 T @terms Shipped 3 apps with AI/, 'the letter is the picture of a person without one (aria-hidden)');
  assert.match(text(main), /Builders on EarnKit 3 builders, ranked by what they shipped and who uses it\./);
  assert.match(main, /<img src="https:\/\/pbs\.twimg\.com\/a_400x400\.jpg" alt=""/);
  assert.doesNotMatch(main, /tracking-\[|—|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(text(main), /Builder 0|\bscore\b|outcome/i);
  assert.match(text(renderToStaticMarkup(React.createElement(LeaderboardView, { rows: [], count: 0 })).split('<footer')[0]), /No one is ranked yet\./);
});

test('11.5c the page ignores every query parameter, reads one cached board per 10 minutes, and is a 404 with the flag off', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/leaderboard/page.tsx'), 'utf8');
  assert.doesNotMatch(page, /searchParams/);
  assert.match(page, /if \(!builderScoreEnabled\(\)\) notFound\(\)/);
  const load = readFileSync(join(import.meta.dirname, '../../app/leaderboard/leaderboard-load.ts'), 'utf8');
  assert.match(load, /unstable_cache\(async \(\) => boardRows\(\), \[[^\]]+\], \{ revalidate: 600, tags: \[PROFILE_TAG\] \}\)/);
  assert.equal(BOARD_MAX, 100);
});

test('11.5d boardRows: claimed, shown and not held only; the rank counts everyone ranked; the best project or what they shipped', dbTest, async () => {
  const person = async (i: number, score: number, o: { claimed?: boolean; hidden?: boolean; held?: boolean } = {}) => {
    const id = B + i;
    const claimed = o.claimed ?? true;
    await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, hidden, held) VALUES
      (${id}, ${`lb${id}`}, ${claimed ? `8${id}` : null}, ${claimed ? `b${id}`.slice(0, 15) : null}, ${o.hidden ?? false}, ${o.held ?? false})`;
    await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at)
      VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2', now())`;
    return id;
  };
  // Scores of 100 sit above every other test's people, so this run's top rows are its own.
  const top = await person(0, 100);
  await person(1, 100, { claimed: false });
  await person(2, 100, { hidden: true });
  await person(3, 100, { held: true });
  const second = await person(4, 99);
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES
    (${top}, 'https://tokens.fun', 'tokens.fun', 'app', true, true, 140), (${top}, 'https://b.example', 'B', 'app', true, true, 3),
    (${second}, 'https://a.example', 'A', 'app', false, true, 0), (${second}, 'k2', 'K', 'package', false, true, 0)`;
  const { rows, count } = await boardRows(BOARD_MAX);
  const mine = rows.filter((r) => r.handle.startsWith('b') && [top, second].some((x) => r.handle === `b${x}`.slice(0, 15)));
  assert.deepEqual(mine.map((r) => [r.handle, r.best]), [[`b${top}`.slice(0, 15), '140 people use tokens.fun'], [`b${second}`.slice(0, 15), 'Shipped 2 projects with AI']]);
  assert.equal(mine[0].rank, rows[0].rank);
  // Four people of this run share 100 (one rank for all); the next score comes at least four places
  // later even though only one 100 of them is listed (other files' people may share it too).
  assert.ok(mine[1].rank - mine[0].rank >= 4);
  assert.ok(count >= 2);
  assert.ok(!rows.some((r) => [B + 1, B + 2, B + 3].some((x) => r.handle === `b${x}`.slice(0, 15))));
});

test('earnkitCampaignRows: an ended entry made elsewhere with a wallet this agent owns (any case) is "yours"', db, async () => {
  const tag = `test-rows-${process.pid}-${Date.now()}`;
  const ids = [`${tag}-open`, `${tag}-ended`, `${tag}-other`];
  const wallet = '0xAbCdEf0000000000000000000000000000000001';
  const insert = (id: string, endsInMs: number, status: string) => sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, campaign, ends_at)
    VALUES (${id}, 'o', ${id}, 'd', 'https://x', 'https://x', 'r', 's', ${status}, 'unknown', ${sql().json(campaign as never)}, ${new Date(Date.now() + endsInMs)})`;
  await insert(ids[0], 86_400_000, 'active');
  await insert(ids[1], -86_400_000, 'closed');
  await insert(ids[2], -86_400_000, 'closed');
  const [me] = await sql()`INSERT INTO installations (token_hash) VALUES (${tag + '-me'}) RETURNING id`;
  const [other] = await sql()`INSERT INTO installations (token_hash) VALUES (${tag + '-other'}) RETURNING id`;
  try {
    await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${me.id}, ${wallet.toLowerCase()})`;
    await sql()`INSERT INTO campaign_runs (program_id, state) VALUES (${ids[1]}, 'review')`;
    await sql()`
      INSERT INTO projects (program_id, name, installation_id, payout_wallet, score) VALUES
        (${ids[1]}, 'mine', ${other.id}, ${wallet}, 15),
        (${ids[2]}, 'theirs', ${other.id}, ${'0x' + '4'.repeat(40)}, 15)`;
    const rows = (await earnkitCampaignRows(me.id)).filter((r) => ids.includes(r.id));
    assert.deepEqual(
      rows.map((r) => [r.id, r.open, r.you]),
      [[ids[1], false, 'in review'], [ids[0], true, null]],
    );
  } finally {
    await sql()`DELETE FROM projects WHERE program_id IN ${sql()(ids)}`;
    await sql()`DELETE FROM campaign_runs WHERE program_id IN ${sql()(ids)}`;
    await sql()`DELETE FROM programs WHERE id IN ${sql()(ids)}`;
    await sql()`DELETE FROM installations WHERE id IN ${sql()([me.id, other.id])}`;
  }
});

test('v2.8 Ruling 23 (plan): earnkitCampaignOpen reads one query and keeps the answer 10 minutes', { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' }, async () => {
  const { CAMPAIGN_OPEN_TTL_MS, earnkitCampaignOpen, resetCampaignOpenMemo } = await import('./leaderboard');
  assert.equal(CAMPAIGN_OPEN_TTL_MS, 10 * 60 * 1000);
  resetCampaignOpenMemo();
  // Far in the future, every campaign has ended: none is open.
  const later = new Date('2200-01-01T00:00:00Z');
  assert.equal(await earnkitCampaignOpen(later), false);
  // Memoized: a time within 10 minutes returns the same answer without reading again.
  const db = sql();
  const id = `r23-memo-${process.pid}-${Date.now()}`;
  await db`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, ends_at, campaign)
    VALUES (${id}, 'EarnKit', 'Memo test', 'd', 'https://earnkit.com', 'https://earnkit.com', 'r', 's', 'active', 'allowed',
      ${new Date('2300-01-01T00:00:00Z')}, ${db.json({ kind: 'earnkit' })})`;
  try {
    assert.equal(await earnkitCampaignOpen(new Date(later.getTime() + 60_000)), false);
    // After 10 minutes it reads again and sees the open campaign.
    assert.equal(await earnkitCampaignOpen(new Date(later.getTime() + CAMPAIGN_OPEN_TTL_MS)), true);
  } finally {
    await db`DELETE FROM programs WHERE id = ${id}`;
    resetCampaignOpenMemo();
  }
});
