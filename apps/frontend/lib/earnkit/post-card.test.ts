import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { padPool } from './fixtures/rank-pool';
import { createDraft } from './post-drafts';
import { BACKERS_SHOWN_FROM, GRID_WEEKS, cardWeeks, freezeCard, postCardFacts, postCardView, type LiveFacts } from './post-card';
import { draftMoment, weeklyCandidate, type MomentCandidate } from './post-moments';
import { isoWeekOf, lastFinishedMonday } from './weeks';

/**
 * v3.1 one-tap posts, Task 5 (design 4): each post's card. Frozen facts (rank only from RANK_MIN_POOL), 3 layouts by
 * moment, the Backing pill only while EARNKIT_RAISING is on, backers only from 5, never a price, never a self-report.
 */
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date('2026-10-19T16:00:00Z');
const MONDAY = lastFinishedMonday(NOW);
const OFF: LiveFacts = { backing: null };
const grid = Array.from({ length: GRID_WEEKS }, (_, i) => i % 3 !== 0);
const frozen = { project: 'Recipes', streak: 6, score: 72, rank: '#3 of 40 builders', grid };
const weekly = (o: Record<string, unknown> = {}) => ({
  moment: 'weekly' as const, proof_url: null, card: { ...frozen, week: 6, monday: MONDAY, summary: 'Added offline mode and fixed several sync bugs.', commits: 14, ...o },
});

test('the weekly card: number-led, "Week 6" with the summary under it; commits, Shipping and the rank; the 12 weeks of code', () => {
  assert.deepEqual(postCardView(weekly(), OFF), {
    layout: 'number', kicker: 'Recipes', big: 'Week 6', sub: 'Added offline mode and fixed several sync bugs.',
    stats: [{ value: '14', label: 'commits that week' }, { value: '72', label: 'Shipping' }, { value: '#3', label: 'of 40 builders' }],
    grid, backing: null,
  });
  // Under RANK_MIN_POOL no rank was frozen, so none shows; no score line, no Shipping.
  const small = postCardView(weekly({ rank: null, score: null }), OFF)!;
  assert.deepEqual(small.stats, [{ value: '14', label: 'commits that week' }]);
  assert.doesNotMatch(JSON.stringify(small), /#\d|of \d+ builders/);
});

test('three layouts: a milestone is the streak number alone; went live is "Live" with the weeks it took; a verified win is text-led', () => {
  const m = postCardView(weekly({ week: 26, streak: 26 }), OFF)!;
  assert.deepEqual([m.layout, m.big, m.kicker], ['milestone', '26', 'Recipes']);
  assert.ok(!m.stats.some((s) => s.label.endsWith('in a row')), 'the number is the streak');
  const live = postCardView({ moment: 'went_live', proof_url: null, card: { ...frozen, weeks: 9 } }, OFF)!;
  assert.deepEqual([live.layout, live.big, live.sub], ['number', 'Live', '9 weeks from first commit']);
  assert.deepEqual(live.stats[0], { value: '6', label: 'weeks in a row' });
  const won = postCardView({ moment: 'won', proof_url: 'https://x.com/base/status/1', card: { ...frozen, program: 'Base Builder Grant', award: '$5,000' } }, OFF)!;
  assert.deepEqual([won.layout, won.kicker, won.big, won.sub], ['text', 'Won', 'Base Builder Grant', 'Recipes · $5,000']);
  const funded = postCardView({ moment: 'funded', proof_url: 'https://base.org/r3', card: { ...frozen, program: 'Base Builder Grant', award: null } }, OFF)!;
  assert.deepEqual([funded.kicker, funded.sub], ['Funded by', 'Recipes']);
  // The builder's news: the week and its summary, never the note.
  const news = postCardView({ moment: 'news', proof_url: null, card: { ...frozen, summary: 'Added search.' } }, OFF)!;
  assert.deepEqual([news.layout, news.big, news.sub], ['number', 'Week 6', 'Added search.']);
});

test('never a self-report: an accepted, funded or won card without its proof link is the page\'s own card', () => {
  for (const moment of ['accepted', 'funded', 'won'] as const)
    assert.equal(postCardView({ moment, proof_url: null, card: { ...frozen, program: 'Base Builder Grant', award: '$5,000' } }, OFF), null, moment);
});

test('the token pill (read live): holders only from 5, in the pill; never a price', () => {
  assert.equal(postCardView(weekly(), OFF)!.backing, null);
  const four = postCardView(weekly(), { backing: { symbol: 'RCP', holders: BACKERS_SHOWN_FROM - 1 } })!;
  assert.equal(four.backing, '$RCP');
  const five = postCardView(weekly(), { backing: { symbol: 'RCP', holders: 5 } })!;
  assert.equal(five.backing, '$RCP · 5 holders');
  assert.ok(!five.stats.some((s) => /backers|holders/.test(s.label)), 'v4.0 Task 9: the pill carries the count');
  // No price anywhere: the view has no price and the card's code reads none.
  assert.doesNotMatch(JSON.stringify(five), /price|\$\d/i);
  for (const f of ['post-card.ts', '../../app/[handle]/post-card-image.tsx'])
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, f), 'utf8'), /cachedWethUsd|wethToUsd|priceUsd|price_usd|marketCap|market_cap|from '\.\/fees'|lib\/earnkit\/fees'/, f);
});

test('cardWeeks: the 12 ISO weeks ending at the Monday, oldest first', () => {
  const w = cardWeeks(MONDAY);
  assert.equal(w.length, GRID_WEEKS);
  assert.equal(w.at(-1), isoWeekOf(new Date(`${MONDAY}T12:00:00Z`)));
  assert.equal(w[0], isoWeekOf(new Date(Date.parse(`${MONDAY}T12:00:00Z`) - 11 * 7 * 86_400_000)));
});

// ---- From the data ----

async function maya(o: { ranked?: boolean } = {}) {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`pc-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `pcmaya${id}/recipes`;
  const handle = `pc_${id}`.slice(0, 15);
  const weeks = [1, 2, 3].map((i) => isoWeekOf(new Date(Date.parse(`${MONDAY}T12:00:00Z`) - (i - 1) * 7 * 86_400_000)));
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`pc-${id}`}, ${key}, ${`pcx${id}`}, ${handle}, 'Maya')`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, commit_weeks) VALUES (${id}, ${key}, 'Recipes', 'app', true, true, ${weeks})`;
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent') RETURNING id::int AS sid`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${sid}, '{"private": false}'::jsonb, true, now())`;
  if (o.ranked) await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, 80, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, summary)
    VALUES (${id}, ${key}, ${MONDAY}, ${sql().json({ checked: true, shipped_code: { n: 14 }, streak: { w: 3 } } as never)}, 'Added offline mode.')`;
  return { id, key, handle };
}

test('drafting freezes the card: the project, streak, Shipping, the weeks of code; the rank only from RANK_MIN_POOL ranked builders', dbTest, async () => {
  const small = await maya({ ranked: true });
  const f = await freezeCard(small.id, MONDAY, NOW);
  assert.equal(f.project, 'Recipes');
  assert.equal(f.score, 80);
  assert.equal(f.rank, null, 'fewer than 10 ranked: no rank frozen');
  assert.deepEqual(f.grid.slice(-3), [true, true, true]);
  await padPool(10);
  const big = await maya({ ranked: true });
  const d = await draftMoment(big.id, (await weeklyCandidate(big.id, NOW)) as MomentCandidate, { asked: false }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.card.rank, '#1 of 12 builders');
  assert.equal(d.draft.card.summary, 'Added offline mode.');
  assert.equal(d.draft.card.commits, 14);
  // Frozen: the rank later moving never changes this post's card.
  await sql()`UPDATE builder_live SET score = 0 WHERE builder_id = ${big.id}`;
  const card = await postCardFacts(big.id, d.draft.code);
  assert.deepEqual(card?.view.stats.find((s) => s.label.includes('builders')), { value: '#1', label: 'of 12 builders' });
  assert.equal(card?.handle, big.handle);
  assert.equal(card?.name, 'Maya');
});

test('postCardFacts: only this person\'s code; the pill only with a launched builder token, not a project coin; holders from 5', dbTest, async () => {
  const before = process.env.EARNKIT_RAISING;
  try {
    const a = await maya();
    const b = await maya();
    const d = await createDraft({ builderId: a.id, projectKey: a.key, moment: 'weekly', momentKey: `weekly:${a.key}:${MONDAY}`, shape: 'change', text: 'Added offline mode.', card: { ...frozen, week: 3, summary: 'Added offline mode.' }, asked: false }, NOW);
    assert.ok(d.ok);
    assert.equal(await postCardFacts(b.id, d.draft.code), null, 'another person\'s code');
    assert.equal(await postCardFacts(a.id, 'zzzzzzzzzz'), null);
    // v4.0 Task 9: a project's coin with backing open never makes the pill, even with EARNKIT_RAISING on.
    const old = `0x${randomBytes(20).toString('hex')}`;
    await sql()`INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_address)
      VALUES ('earnkit-coin', 'Recipes', ${`https://github.com/${a.key}`}, ${`github.com/${a.key}`}, ${a.id}, 'OLD', 'launched', 'https://tokens.fun/c/1', now(), ${old})`;
    process.env.EARNKIT_RAISING = 'on';
    assert.equal((await postCardFacts(a.id, d.draft.code))!.view.backing, null, 'no builder token: no pill');
    delete process.env.EARNKIT_RAISING;
    const coin = `0x${randomBytes(20).toString('hex')}`;
    await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, symbol, coin_address) VALUES (${a.id}, ${`pc${a.id}`}, 'launched', 'RCP', ${coin})`;
    for (let i = 0; i < 4; i++) await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${`0x${randomBytes(20).toString('hex')}`}, 1)`;
    assert.equal((await postCardFacts(a.id, d.draft.code))!.view.backing, '$RCP');
    await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${`0x${randomBytes(20).toString('hex')}`}, 1)`;
    assert.equal((await postCardFacts(a.id, d.draft.code))!.view.backing, '$RCP · 5 holders');
  } finally {
    if (before === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = before;
  }
});

test('final review 10: the share card, the post card and the page head use the page\'s picture: X, else the proven GitHub login\'s', dbTest, async () => {
  const { benchCardFacts } = await import('./bench-data');
  const { personFacts } = await import('./page-data');
  const m = await maya();
  await sql()`UPDATE builder_profiles SET x_avatar_url = NULL, github_login = ${`pcgh${m.id}`} WHERE builder_id = ${m.id}`;
  const d = await createDraft({ builderId: m.id, projectKey: m.key, moment: 'weekly', momentKey: `weekly:${m.key}:${MONDAY}`, shape: 'change', text: 'Added offline mode.', card: { ...frozen, week: 3, summary: 'Added offline mode.' }, asked: false }, NOW);
  assert.ok(d.ok);
  const gh = `https://avatars.githubusercontent.com/pcgh${m.id}?s=200`;
  assert.equal((await benchCardFacts(m.id, { money: false }))?.avatar, gh);
  assert.equal((await postCardFacts(m.id, d.draft.code))?.avatar, gh);
  assert.equal((await personFacts(m.id))?.avatar, gh);
  // An X picture still comes first.
  await sql()`UPDATE builder_profiles SET x_avatar_url = 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' WHERE builder_id = ${m.id}`;
  assert.equal((await benchCardFacts(m.id, { money: false }))?.avatar, 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg');
});
