import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { feedWeeks, rankFeed } from './feed';
import { logCards } from './bench-data';
import { approveWeek } from './weekly-moment';
import { UNCONFIRMED_LABEL } from './week-facts';
import UpdateCard from '../../app/components/ui/UpdateCard';

/** v3 Task 3 (spec 5.4, D1): a week the builder has not said yes to is shown, marked "Not yet confirmed". */
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
(globalThis as { React?: typeof React }).React = React;
const RUN = randomBytes(3).toString('hex');
const NOW = new Date('2026-10-21T12:00:00Z');
const MON = '2026-10-12';

test('the label text is exact', () => assert.equal(UNCONFIRMED_LABEL, 'Not yet confirmed'));

test('(a) a feed card is confirmed:false until the builder approves the week', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v3-unc-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `u${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v3u-${id}`}, ${key}, ${`ux${id}`}, ${`u${RUN}${id}`}, 'Maya')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, 50, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'Recipe planner', 'app', true, true)`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, ${MON}, 'Pushed code.', ${sql().json({ shipped_code: { n: 3 } } as never)})`;
  await rankFeed(NOW);
  const before = (await feedWeeks(NOW, { only: [id] }))[0].cards;
  assert.equal(before.length, 1);
  assert.equal(before[0].confirmed, false);
  assert.equal(await approveWeek(id, key, MON, NOW), true);
  const after_ = (await feedWeeks(NOW, { only: [id] }))[0].cards;
  assert.equal(after_[0].confirmed, true);
});

test('v4.10.3 final fix (F5): after the automatic add the feed card still reads "Not yet confirmed"; the builder\'s yes confirms it', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v3-unc-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `u${RUN}/a${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v3a-${id}`}, ${key}, ${`ax${id}`}, ${`a${RUN}${id}`}, 'Maya')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, 50, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'Recipe planner', 'app', true, true)`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, ${MON}, 'Pushed code.', ${sql().json({ shipped_code: { n: 3 } } as never)})`;
  await rankFeed(NOW);
  assert.equal(await approveWeek(id, key, MON, NOW, 'auto', null), true);
  const auto = (await feedWeeks(NOW, { only: [id] }))[0].cards;
  assert.equal(auto[0].confirmed, false, 'an automatic add is not the builder\'s confirmation');
  assert.equal(await approveWeek(id, key, MON, NOW, 'email', null), true);
  assert.equal((await feedWeeks(NOW, { only: [id] }))[0].cards[0].confirmed, true);
});

test('v4.10.3 final fix (F5): logCards marks an automatic week unconfirmed (the page reads "Not yet confirmed")', () => {
  const cards = logCards([
    { week: '2026-10-12', text: 'a', facts: { shipped_code: { n: 1 }, approved: true, approved_via: 'auto' } as never },
    { week: '2026-10-05', text: 'b', facts: { shipped_code: { n: 1 }, approved: true, approved_via: 'email' } as never },
  ], 'Recipes');
  assert.deepEqual(cards.map((c) => c.confirmed), [false, true]);
});

test('(b) logCards sets confirmed from facts.approved; a Started card is never marked', () => {
  const cards = logCards([
    { week: '2026-10-12', text: 'a', facts: { shipped_code: { n: 1 }, approved: true } as never },
    { week: '2026-10-05', text: 'b', facts: { shipped_code: { n: 1 } } },
    { week: '2026-09-28', text: null, facts: { started: { live: false, weeks: 0 } } },
  ], 'Recipes');
  assert.equal(cards[0].confirmed, true);
  assert.equal(cards[1].confirmed, false);
  assert.equal(cards[2].started, 'Started tracking Recipes.');
});

test('(c) the card renders the label only for an unconfirmed, non-started week', () => {
  const h = (card: object, extra = {}) => renderToStaticMarkup(React.createElement(UpdateCard, { card: { week: MON, text: 'x', chips: [], ...card } as never, shape: 'long', showPerson: false, ...extra }));
  const un = h({ confirmed: false });
  assert.ok(un.includes('data-ek-unconfirmed'));
  assert.ok(un.includes(UNCONFIRMED_LABEL));
  assert.ok(!h({ confirmed: true }).includes('data-ek-unconfirmed'));
  assert.ok(!h({}).includes('data-ek-unconfirmed'), 'unknown is not marked');
  assert.ok(!h({ confirmed: false, started: 'Started tracking X.' }).includes('data-ek-unconfirmed'));
  assert.ok(!un.includes('—'));
});
