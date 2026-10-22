import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { POST_MOMENTS, createDraft, type PostMoment } from './post-drafts';
import {
  EVENT_FRESH_DAYS,
  LIVE_SETTLE_DAYS,
  NEWS_COOLDOWN_HOURS,
  SAME_KIND_DAYS,
  WEEKLY_TAPPED_COOLDOWN_DAYS,
  announcedWinCandidates,
  coinIntroCandidate,
  draftMoment,
  holdOf,
  liveTiming,
  newsCandidate,
  offeredMoment,
  proofUrlOk,
  verifiedOutcomeCandidate,
  weeklyCandidate,
  weeksFromFirstCommit,
  wentLiveCandidate,
  type MomentCandidate,
} from './post-moments';
import { isoWeekOf, lastFinishedMonday } from './weeks';

/**
 * v3.1 one-tap posts, Task 3 (design 1): every row of the moments table, including the moments never posted.
 */
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const DAY = 86_400_000;
const NOW = new Date('2026-10-19T16:00:00Z'); // a Monday, after the weekly job
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const MONDAY = lastFinishedMonday(NOW); // 2026-10-12

const cand = (moment: PostMoment, momentKey: string, o: Partial<MomentCandidate> = {}): MomentCandidate => ({
  moment, momentKey, projectKey: 'maya/recipes', week: null, input: { moment: 'news', note: 'x' }, card: {}, proofUrl: null, ...o,
});
const logged = (moment: PostMoment, moment_key: string, created: Date, o: { tapped?: Date; asked?: boolean } = {}) => ({
  moment, moment_key, created_at: created, first_tap_at: o.tapped ?? null, asked: o.asked ?? false,
});

// ---- Pure rules ----

test('the moments: weekly, went live, won, accepted, funded, news, coin intro; never backing opened, applied, first users or a streak alone', () => {
  assert.deepEqual([...POST_MOMENTS], ['weekly', 'went_live', 'won', 'accepted', 'funded', 'news', 'coin_intro']);
  for (const never of ['backing', 'raising_on', 'applied', 'first_users', 'streak']) assert.ok(!(POST_MOMENTS as readonly string[]).includes(never), never);
  assert.deepEqual([WEEKLY_TAPPED_COOLDOWN_DAYS, SAME_KIND_DAYS, NEWS_COOLDOWN_HOURS, LIVE_SETTLE_DAYS, EVENT_FRESH_DAYS], [13, 28, 24, 2, 14]);
});

test('weekly: 13 days after a tapped weekly, unless the week has a milestone, went live or a win; an untapped one never holds it; one offer a week', () => {
  const w = cand('weekly', `weekly:maya/recipes:${MONDAY}`);
  assert.equal(holdOf(w, [logged('weekly', 'weekly:maya/recipes:2026-10-05', ago(10), { tapped: ago(10) })], NOW), 'cooldown');
  assert.equal(holdOf(w, [logged('weekly', 'weekly:maya/recipes:2026-09-28', ago(14), { tapped: ago(14) })], NOW), null);
  assert.equal(holdOf(w, [logged('weekly', 'weekly:maya/recipes:2026-10-05', ago(7))], NOW), null, 'drafted, never tapped');
  assert.equal(holdOf({ ...w, bigWeek: true }, [logged('weekly', 'weekly:maya/recipes:2026-10-05', ago(7), { tapped: ago(7) })], NOW), null);
  assert.equal(holdOf(w, [logged('weekly', w.momentKey, ago(0))], NOW), 'drafted');
  assert.equal(holdOf(w, [logged('weekly', w.momentKey, ago(0), { asked: true })], NOW), null, 'the builder\'s own redraft is not the offer');
});

test('went live: once a project; settles 2 days (a site probe can flap); stale after 14', () => {
  const c = cand('went_live', 'went_live:maya/recipes');
  assert.equal(holdOf(c, [logged('went_live', 'went_live:maya/recipes', ago(300))], NOW), 'once');
  assert.equal(holdOf(c, [logged('went_live', 'went_live:other/app', ago(20))], NOW), 'same_kind');
  assert.equal(holdOf(c, [logged('went_live', 'went_live:other/app', ago(29))], NOW), null);
  assert.equal(liveTiming(ago(1), NOW), 'settling');
  assert.equal(liveTiming(ago(3), NOW), null);
  assert.equal(liveTiming(ago(15), NOW), 'stale');
  assert.equal(weeksFromFirstCommit([isoWeekOf(ago(60)), isoWeekOf(ago(30))], ago(3)), 9);
  assert.equal(weeksFromFirstCommit([], ago(3)), 0);
});

test('won, accepted, funded: once a program each; one of a kind in 28 days', () => {
  const c = cand('won', 'won:base-builder-grants');
  assert.equal(holdOf(c, [logged('won', 'won:base-builder-grants', ago(100))], NOW), 'once');
  assert.equal(holdOf(c, [logged('won', 'won:arc', ago(10))], NOW), 'same_kind');
  assert.equal(holdOf(c, [logged('accepted', 'accepted:base-builder-grants', ago(10))], NOW), null, 'accepted then won: another moment');
});

test('news: 24 hours; coin intro: once ever, whatever the coin', () => {
  const n = cand('news', 'news:maya/recipes:2026-10-19T16:00:00.000Z');
  assert.equal(holdOf(n, [logged('news', 'news:maya/recipes:2026-10-18', new Date(NOW.getTime() - 23 * 3_600_000))], NOW), 'cooldown');
  assert.equal(holdOf(n, [logged('news', 'news:maya/recipes:2026-10-18', new Date(NOW.getTime() - 25 * 3_600_000))], NOW), null);
  const coin = cand('coin_intro', 'coin_intro:0xnew');
  assert.equal(holdOf(coin, [logged('coin_intro', 'coin_intro:0xold', ago(400))], NOW), 'once');
  assert.equal(holdOf(coin, [], NOW), null);
});

test('proof (owner ruling 3): an X post or the program\'s own site, over https; never earnkit.com, the builder\'s own site or repo, or any other host', () => {
  const o = { programUrls: ['https://www.base.org/builders/grants', null], own: { sites: ['https://recipes.app'], repo: 'maya/recipes' } };
  assert.equal(proofUrlOk('https://x.com/base/status/1849000000000000000', o), 'https://x.com/base/status/1849000000000000000');
  assert.equal(proofUrlOk('https://twitter.com/base/status/18490#reply', o), 'https://twitter.com/base/status/18490');
  assert.equal(proofUrlOk('https://blog.base.org/grant-winners-october', o), 'https://blog.base.org/grant-winners-october');
  for (const bad of [
    undefined, null, 42, '', 'not a link', 'http://x.com/base/status/1', 'https://x.com/base', 'https://x.com/i/flow/login',
    'https://earnkit.com/maya', 'https://recipes.app/we-won', 'https://github.com/maya/recipes/releases', 'https://medium.com/@maya/we-won',
    'https://user:pw@base.org/winners', 'https://203.0.113.9/winners', 'https://base.org:8443/winners', `https://base.org/${'a'.repeat(2050)}`,
    'javascript:alert(1)',
  ])
    assert.equal(proofUrlOk(bad, o), null, String(bad).slice(0, 60));
});

// ---- From the data ----

let seq = 0;
/** A claimed person whose one project (a public, confirmed repo) is `key`, named Recipes, with these commit weeks. */
async function maya(o: { weeks?: string[]; weeksShipping?: number; hidden?: boolean; privateRepo?: boolean } = {}) {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`pm-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `maya${++seq}/recipes`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, hidden)
    VALUES (${id}, ${`pm-${id}`}, ${key}, ${`pmx${id}`}, ${`pm_${id}`}, ${o.hidden ?? false})`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, commit_weeks, weeks_shipping)
    VALUES (${id}, ${key}, 'Recipes', 'app', true, true, ${o.weeks ?? []}, ${o.weeksShipping ?? 0})`;
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent') RETURNING id::int AS sid`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${sid}, ${sql().json({ private: o.privateRepo ?? false } as never)}, true, now())`;
  return { id, key };
}
const weekRow = (id: number, key: string, o: { facts: Record<string, unknown>; summary?: string | null; text?: string | null; hidden?: boolean }) =>
  sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, summary, text, hidden)
    VALUES (${id}, ${key}, ${MONDAY}, ${sql().json(o.facts as never)}, ${o.summary ?? null}, ${o.text ?? null}, ${o.hidden ?? false})`;
const tapped = (id: number, code: string, at: Date) => sql()`UPDATE post_drafts SET taps = 1, first_tap_at = ${at} WHERE code = ${code} AND builder_id = ${id}`;

test('weekly: last week\'s facts, summary and streak make the post; drafting stores it with its card', dbTest, async () => {
  const { id, key } = await maya();
  await weekRow(id, key, { facts: { checked: true, shipped_code: { n: 14 }, streak: { w: 6 } }, summary: 'Added offline mode and fixed several sync bugs.' });
  const c = await weeklyCandidate(id, NOW);
  assert.ok(typeof c !== 'string');
  assert.deepEqual(c.input, { moment: 'weekly', name: 'Recipes', week: 6, summary: 'Added offline mode and fixed several sync bugs.', note: null });
  assert.equal(c.bigWeek, false);
  const d = await draftMoment(id, c, { asked: false }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.text, 'Recipes, week 6: added offline mode and fixed several sync bugs.');
  assert.equal(d.draft.week, MONDAY);
  assert.deepEqual(d.draft.card, { week: 6, monday: MONDAY, summary: 'Added offline mode and fixed several sync bugs.', streak: 6, commits: 14 });
  assert.deepEqual(await draftMoment(id, c, { asked: false }, NOW), { ok: false, reason: 'drafted' }, 'one offer a week');
  // The builder asks for another version: the next shape.
  const again = await draftMoment(id, c, { asked: true }, new Date(NOW.getTime() + 60_000));
  assert.ok(again.ok);
  assert.equal(again.draft.text, 'Added offline mode and fixed several sync bugs.');
});

test('weekly: the builder\'s note wins; a 12-week streak is the count; 26 with no summary is the bare week', dbTest, async () => {
  const a = await maya();
  await weekRow(a.id, a.key, { facts: { shipped_code: { n: 3 }, streak: { w: 3 } }, summary: 'Added billing.', text: 'first paying customer today, $9/mo, from a stranger' });
  assert.deepEqual((await weeklyCandidate(a.id, NOW) as MomentCandidate).input, { moment: 'weekly', name: 'Recipes', week: 3, summary: 'Added billing.', note: 'first paying customer today, $9/mo, from a stranger' });
  const b = await maya();
  await weekRow(b.id, b.key, { facts: { shipped_code: { n: 3 }, streak: { w: 12 } }, summary: 'Added CSV export.' });
  const cb = (await weeklyCandidate(b.id, NOW)) as MomentCandidate;
  assert.equal(cb.bigWeek, true, 'a milestone');
  const db = await draftMoment(b.id, cb, { asked: false }, NOW);
  assert.ok(db.ok);
  assert.equal(db.draft.text, '12 weeks shipping Recipes without missing one. This week: added CSV export.');
  const c = await maya();
  await weekRow(c.id, c.key, { facts: { shipped_code: { n: 2 }, streak: { w: 26 } } });
  const dc = await draftMoment(c.id, (await weeklyCandidate(c.id, NOW)) as MomentCandidate, { asked: false }, NOW);
  assert.ok(dc.ok);
  assert.equal(dc.draft.text, 'Week 26.');
});

test('weekly, never: no row, a hidden week, the streak alone, nothing to say, a hidden page, an unconfirmed project', dbTest, async () => {
  const a = await maya();
  assert.equal(await weeklyCandidate(a.id, NOW), 'no_week');
  await weekRow(a.id, a.key, { facts: { streak: { w: 6 }, checked: true }, summary: 'Added search.' });
  assert.equal(await weeklyCandidate(a.id, NOW), 'no_facts', 'the streak alone is never a post');
  const b = await maya();
  await weekRow(b.id, b.key, { facts: { shipped_code: { n: 4 }, streak: { w: 5 } } });
  assert.equal(await weeklyCandidate(b.id, NOW), 'nothing_to_say');
  const c = await maya();
  await weekRow(c.id, c.key, { facts: { shipped_code: { n: 4 } }, summary: 'Added search.', hidden: true });
  assert.equal(await weeklyCandidate(c.id, NOW), 'no_week');
  const d = await maya({ hidden: true });
  await weekRow(d.id, d.key, { facts: { shipped_code: { n: 4 } }, summary: 'Added search.' });
  assert.equal(await weeklyCandidate(d.id, NOW), 'no_page');
  const e = await maya();
  await sql()`UPDATE builder_sources SET state = 'proposed' WHERE builder_id = ${e.id}`;
  assert.equal(await weeklyCandidate(e.id, NOW), 'no_project');
});

test('weekly cooldown: a tapped weekly 10 days ago holds an ordinary week; offeredMoment says so', dbTest, async () => {
  const { id, key } = await maya();
  await weekRow(id, key, { facts: { shipped_code: { n: 4 }, streak: { w: 6 } }, summary: 'Added search.' });
  const old = await createDraft({ builderId: id, projectKey: key, moment: 'weekly', momentKey: `weekly:${key}:2026-10-05`, shape: 'name_week', text: 'Recipes, week 5: added tags.', asked: false }, ago(10));
  assert.ok(old.ok);
  await tapped(id, old.draft.code, ago(10));
  const r = await offeredMoment(id, NOW);
  assert.equal(r.moment, null);
  assert.ok(r.skipped.includes('cooldown'), String(r.skipped));
});

test('went live: offered once it settles, ahead of the weekly; named with the weeks from first commit; once a project', dbTest, async () => {
  const { id, key } = await maya({ weeks: [isoWeekOf(ago(60)), isoWeekOf(ago(10))] });
  await weekRow(id, key, { facts: { shipped_code: { n: 4 }, streak: { w: 2 } }, summary: 'Added search.' });
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pm${id}`}, 'maya', ${key}, ${id}, 1, 1, 'live', ${ago(1)})`;
  assert.equal(await wentLiveCandidate(id, NOW), 'settling', 'a day old: it may flap');
  await sql()`UPDATE hosted_sites SET deployed_at = ${ago(3)} WHERE installation_id = ${id}`;
  const r = await offeredMoment(id, NOW);
  assert.equal(r.moment?.moment, 'went_live');
  const d = await draftMoment(id, r.moment!, { asked: false }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.text, 'Recipes is live. 9 weeks from first commit.');
  assert.equal(holdOf(r.moment!, [{ ...d.draft }], new Date(NOW.getTime() + 30 * DAY)), 'once');
  await sql()`UPDATE hosted_sites SET deployed_at = ${ago(20)} WHERE installation_id = ${id}`;
  assert.equal(await wentLiveCandidate(id, NOW), 'stale');
  const never = await maya();
  assert.equal(await wentLiveCandidate(never.id, NOW), 'not_live');
});

/** A program and an entry of the person's one project in it. */
async function entered(id: number, key: string) {
  const program = `pm-${randomBytes(4).toString('hex')}`;
  await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${program}, 'Base', 'Base Builder Grant', 'd', 'https://www.base.org/builders', 'https://forms.base.org/apply', 'r', 's', 'active', 'allowed')`;
  const [{ pid }] = await sql()<{ pid: number }[]>`INSERT INTO projects (program_id, name, installation_id, repo_key) VALUES (${program}, 'Recipes', ${id}, ${key}) RETURNING id AS pid`;
  return { program, pid };
}

test('won: an announced win with its source link is offered first, with the award; a self-reported one never', dbTest, async () => {
  const { id, key } = await maya();
  const { program, pid } = await entered(id, key);
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, source_url, captured_at)
    VALUES (${pid}, ${program}, 'R1', 'won', 900, 'self_reported', NULL, ${ago(1)})`;
  assert.deepEqual(await announcedWinCandidates(id, NOW), [], 'the builder\'s word alone');
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, source_url, captured_at)
    VALUES (${pid}, ${program}, 'R1', 'won', 5000, 'announcement', 'https://x.com/base/status/1', ${ago(1)})`;
  await weekRow(id, key, { facts: { shipped_code: { n: 4 }, streak: { w: 2 } }, summary: 'Added search.' });
  const r = await offeredMoment(id, NOW);
  assert.equal(r.moment?.moment, 'won');
  assert.equal(r.moment?.proofUrl, 'https://x.com/base/status/1');
  const d = await draftMoment(id, r.moment!, { asked: false }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.text, 'Recipes won the Base Builder Grant ($5,000).');
  assert.equal(d.draft.proof_url, 'https://x.com/base/status/1');
  // Old news is not offered.
  assert.deepEqual(await announcedWinCandidates(id, new Date(NOW.getTime() + 15 * DAY)), []);
});

test('accepted, funded or won as told: only with a proof link the agent checked, stored with the draft', dbTest, async () => {
  const { id, key } = await maya();
  const { program } = await entered(id, key);
  assert.equal(await verifiedOutcomeCandidate(id, { programId: program, result: 'accepted', proofUrl: undefined }), 'no_proof', 'never on the builder\'s word alone');
  assert.equal(await verifiedOutcomeCandidate(id, { programId: program, result: 'accepted', proofUrl: 'https://medium.com/@maya/in' }), 'no_proof');
  assert.equal(await verifiedOutcomeCandidate(id, { programId: 'no-such-program', result: 'won', proofUrl: 'https://x.com/base/status/2' }), 'no_program');
  const c = await verifiedOutcomeCandidate(id, { programId: program, result: 'funded', proofUrl: 'https://www.base.org/builders/grants-round-3#winners', awardUsd: 3000 });
  assert.ok(typeof c !== 'string');
  const d = await draftMoment(id, c, { asked: true }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.text, 'Recipes was funded by the Base Builder Grant ($3,000).');
  assert.equal(d.draft.proof_url, 'https://www.base.org/builders/grants-round-3');
});

test('builder\'s news: checked like an update; 24 hours apart', dbTest, async () => {
  const { id } = await maya();
  assert.equal(await newsCandidate(id, 'call me at 5551234567 for the beta', NOW), 'text');
  const c = await newsCandidate(id, 'first paying customer today, $9/mo, from a stranger', NOW);
  assert.ok(typeof c !== 'string');
  const d = await draftMoment(id, c, { asked: true }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.text, 'first paying customer today, $9/mo, from a stranger');
  const next = (await newsCandidate(id, 'second customer', new Date(NOW.getTime() + 3_600_000))) as MomentCandidate;
  assert.deepEqual(await draftMoment(id, next, { asked: true }, new Date(NOW.getTime() + 3_600_000)), { ok: false, reason: 'cooldown' });
});

test('coin intro (owner ruling 1): once the coin is launched and the page shows backing; never while backing is off; once ever', dbTest, async () => {
  const before = process.env.EARNKIT_RAISING;
  try {
    const { id, key } = await maya({ weeksShipping: 9 });
    await sql()`INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_address)
      VALUES ('earnkit-coin', 'Recipes', ${`https://github.com/${key}`}, ${`github.com/${key}`}, ${id}, 'RCP', 'launched', 'https://tokens.fun/c/1', now(), ${`0x${randomBytes(20).toString('hex')}`})`;
    delete process.env.EARNKIT_RAISING;
    assert.equal(await coinIntroCandidate(id), 'no_coin', 'backing off: no intro');
    process.env.EARNKIT_RAISING = 'on';
    const r = await offeredMoment(id, NOW);
    assert.equal(r.moment?.moment, 'coin_intro');
    const d = await draftMoment(id, r.moment!, { asked: false }, NOW);
    assert.ok(d.ok);
    assert.equal(d.draft.text, 'Recipes has a coin now, $RCP. 9 weeks shipping so far.');
    const later = await offeredMoment(id, new Date(NOW.getTime() + 100 * DAY));
    assert.notEqual(later.moment?.moment, 'coin_intro');
    assert.ok(later.skipped.includes('once'));
  } finally {
    if (before === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = before;
  }
});

test('applied and first users are never a post: an applied program and a week with people offer nothing', dbTest, async () => {
  const { id, key } = await maya();
  const { program } = await entered(id, key);
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${id}, ${program}, 'applied')`;
  await weekRow(id, key, { facts: { users_up: { n: 40 }, checked: true } });
  const r = await offeredMoment(id, NOW);
  assert.equal(r.moment, null);
  assert.deepEqual(r.skipped, ['not_live', 'no_coin', 'no_facts']);
});

test('a private project (no name to show) gets only nameless weekly shapes; no went-live or win post names it', dbTest, async () => {
  const { id, key } = await maya({ privateRepo: true });
  // Titles off: a private repo's summary is never shown, so there is nothing to say.
  await weekRow(id, key, { facts: { shipped_code: { n: 4 }, streak: { w: 2 } }, summary: 'Added search.' });
  assert.equal(await weeklyCandidate(id, NOW), 'nothing_to_say');
  await sql()`DELETE FROM project_updates WHERE builder_id = ${id}`;
  await sql()`UPDATE builder_profiles SET ship_titles_at = now() WHERE builder_id = ${id}`;
  await weekRow(id, key, { facts: { shipped_code: { n: 4 }, streak: { w: 2 } }, summary: 'Added search.' });
  const c = (await weeklyCandidate(id, NOW)) as MomentCandidate;
  assert.deepEqual(c.input, { moment: 'weekly', name: null, week: 2, summary: 'Added search.', note: null });
  const d = await draftMoment(id, c, { asked: false }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.text, 'Added search.');
  assert.equal(await wentLiveCandidate(id, NOW), 'no_project');
});
