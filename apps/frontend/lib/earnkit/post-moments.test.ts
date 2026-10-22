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
  hasEntry,
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
import { writePost } from './post-writer';
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

test('proof (owner ruling 3, fix round): the program\'s own host or a subdomain, or a post by its own X account; nothing else', () => {
  const o = {
    proofHosts: ['base.org'], listings: ['https://www.base.org/builders/grants', 'https://forms.base.org/apply'], xHandles: ['base', 'BuildOnBase'], builderHandle: 'maya',
    own: { sites: ['https://recipes.app'], repo: 'maya/recipes' },
  };
  assert.equal(proofUrlOk('https://x.com/base/status/1849000000000000000', o), 'https://x.com/base/status/1849000000000000000');
  assert.equal(proofUrlOk('https://twitter.com/buildonbase/status/18490#reply', o), 'https://twitter.com/buildonbase/status/18490');
  assert.equal(proofUrlOk('https://blog.base.org/grant-winners-october', o), 'https://blog.base.org/grant-winners-october');
  assert.equal(proofUrlOk('https://www.base.org/builders/grants/round-3-winners', o), 'https://www.base.org/builders/grants/round-3-winners');
  for (const bad of [
    undefined, null, 42, '', 'not a link', 'http://x.com/base/status/1', 'https://x.com/base', 'https://x.com/i/flow/login',
    // Another account's post, or the builder's own (even if listed).
    'https://x.com/randomperson/status/1849000000000000000', 'https://x.com/maya/status/1',
    // The listing pages themselves, with or without a slash, query or fragment.
    'https://www.base.org/builders/grants', 'https://base.org/builders/grants/', 'https://forms.base.org/apply?x=1', 'https://www.base.org/builders/grants#top',
    // Look-alike hosts and public suffixes.
    'https://base.org.evil.com/winners', 'https://evilbase.org/winners', 'https://co.uk/winners',
    'https://earnkit.com/maya', 'https://recipes.app/we-won', 'https://github.com/maya/recipes/releases', 'https://medium.com/@maya/we-won',
    'https://user:pw@base.org/winners', 'https://203.0.113.9/winners', 'https://base.org:8443/winners', `https://base.org/${'a'.repeat(2050)}`,
    'javascript:alert(1)',
  ])
    assert.equal(proofUrlOk(bad, o), null, String(bad).slice(0, 60));
  // A program on a co.uk host: only that host and its subdomains, never another name under co.uk.
  const uk = { ...o, proofHosts: ['grants.co.uk'], listings: ['https://www.grants.co.uk/apply'], xHandles: [] };
  assert.equal(proofUrlOk('https://news.grants.co.uk/winners', uk), 'https://news.grants.co.uk/winners');
  assert.equal(proofUrlOk('https://other.co.uk/winners', uk), null);
  // No X accounts listed: no X post is proof.
  assert.equal(proofUrlOk('https://x.com/base/status/1', uk), null);
  // A program listed on a shared host: no page there is proof (anyone can publish one).
  for (const [listing, page] of [
    ['https://dorahacks.io/hackathon/x', 'https://dorahacks.io/hackathon/x/winners'], ['https://circle.questbook.app/', 'https://circle.questbook.app/winners'],
    ['https://grants.github.io/', 'https://grants.github.io/winners'], ['https://forms.gle/abc', 'https://forms.gle/winners'],
    ['https://ethglobal.com/events/mumbai', 'https://ethglobal.com/showcase/my-project-abc'], ['https://fund.vercel.app/', 'https://fund.vercel.app/winners'],
    ['https://x.notion.site/grants', 'https://x.notion.site/winners'], ['https://mirror.xyz/fund', 'https://mirror.xyz/fund/winners'],
    ['https://paragraph.xyz/@fund', 'https://paragraph.xyz/@fund/winners'], ['https://fund.netlify.app/', 'https://fund.netlify.app/winners'],
  ])
    assert.equal(proofUrlOk(page, { ...o, proofHosts: [new URL(listing).hostname.replace(/^www\./, '')], listings: [listing] }), null, page);
  // ethglobal.com outside /showcase is its own site, when the program file lists it.
  assert.equal(proofUrlOk('https://ethglobal.com/events/mumbai/prizes', { ...o, proofHosts: ['ethglobal.com'], listings: ['https://ethglobal.com/events/mumbai'] }), 'https://ethglobal.com/events/mumbai/prizes');
});

test('proof (final review 1): only the owner-reviewed proof_hosts; never a host taken from the listing or submission page', () => {
  const o = { proofHosts: [] as string[], listings: ['https://www.base.org/builders/grants', 'https://forms.base.org/apply'], xHandles: [], builderHandle: 'maya', own: { sites: [], repo: null } };
  for (const page of ['https://blog.base.org/grant-winners-october', 'https://www.base.org/builders/grants/round-3-winners', 'https://forms.base.org/winners'])
    assert.equal(proofUrlOk(page, o), null, page);
  // A listed host and its subdomains, nothing else; the listing page itself is still never proof.
  const listed = { ...o, proofHosts: ['blog.base.org'] };
  assert.equal(proofUrlOk('https://blog.base.org/grant-winners-october', listed), 'https://blog.base.org/grant-winners-october');
  assert.equal(proofUrlOk('https://news.blog.base.org/w', listed), 'https://news.blog.base.org/w');
  assert.equal(proofUrlOk('https://www.base.org/builders/grants/round-3-winners', listed), null);
  assert.equal(proofUrlOk('https://evilblog.base.org/w', listed), null);
  // A shared host listed by mistake is still denied; the builder's own site is never proof.
  assert.equal(proofUrlOk('https://fund.vercel.app/winners', { ...o, proofHosts: ['fund.vercel.app'] }), null);
  assert.equal(proofUrlOk('https://recipes.app/won', { ...o, proofHosts: ['recipes.app'], own: { sites: ['https://recipes.app'], repo: null } }), null);
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
  // The moment's facts, with the card's frozen ones (Task 5: the project, Shipping, the rank, the weeks of code).
  const { grid, ...card } = d.draft.card as Record<string, unknown>;
  assert.deepEqual(card, { week: 6, monday: MONDAY, summary: 'Added offline mode and fixed several sync bugs.', streak: 6, commits: 14, project: 'Recipes', score: null, rank: null });
  assert.equal((grid as boolean[]).length, 12);
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
  // Fix round: live needs a recent up reading. A site (not EarnKit-hosted) last seen up 5 days ago is not offered.
  const site = await maya({ weeks: [isoWeekOf(ago(30))] });
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${site.id}, 'site', 'https://recipes.example', ${site.key}, 'verified', 'repo_link', 'agent') RETURNING id::int AS sid`;
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${ago(5).toISOString().slice(0, 10)}, '{"up": true}'::jsonb, true)`;
  assert.equal(await wentLiveCandidate(site.id, NOW), 'not_up', 'up 5 days ago, nothing since');
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${ago(1).toISOString().slice(0, 10)}, '{"up": true}'::jsonb, true)`;
  assert.equal((await wentLiveCandidate(site.id, NOW) as MomentCandidate).moment, 'went_live');
  const never = await maya();
  assert.equal(await wentLiveCandidate(never.id, NOW), 'not_live');
});

/** A program and an entry of the person's one project in it. */
async function entered(id: number, key: string, o: { proofHosts?: string[] | null } = {}) {
  const program = `pm-${randomBytes(4).toString('hex')}`;
  await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${program}, 'Base', 'Base Builder Grant', 'd', 'https://www.base.org/builders', 'https://forms.base.org/apply', 'r', 's', 'active', 'allowed')`;
  if (o.proofHosts !== null) await sql()`UPDATE programs SET proof_hosts = ${o.proofHosts ?? ['base.org']}::text[] WHERE id = ${program}`;
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

test('accepted, funded or won as told: only with a proof link the agent checked, for a program they entered; the award only as announced', dbTest, async () => {
  const { id, key } = await maya();
  const { program, pid } = await entered(id, key);
  assert.equal(await verifiedOutcomeCandidate(id, { programId: program, result: 'accepted', proofUrl: undefined, entered: true }), 'no_proof', 'never on the builder\'s word alone');
  assert.equal(await verifiedOutcomeCandidate(id, { programId: program, result: 'accepted', proofUrl: 'https://medium.com/@maya/in', entered: true }), 'no_proof');
  assert.equal(await verifiedOutcomeCandidate(id, { programId: 'no-such-program', result: 'won', proofUrl: 'https://x.com/base/status/2', entered: true }), 'no_program');
  // No entry or application before the tell: no moment, whatever the proof.
  assert.equal(await verifiedOutcomeCandidate(id, { programId: program, result: 'funded', proofUrl: 'https://www.base.org/builders/grants-round-3', entered: false }), 'no_entry');
  assert.equal(await hasEntry(id, program), true);
  assert.equal(await hasEntry(id, 'no-such-program'), false);
  // An amount the agent states is never printed (the input takes none); none announced: no award.
  const c = await verifiedOutcomeCandidate(id, { programId: program, result: 'funded', proofUrl: 'https://www.base.org/builders/grants-round-3#winners', entered: true });
  assert.ok(typeof c !== 'string');
  const d = await draftMoment(id, c, { asked: true }, NOW);
  assert.ok(d.ok);
  assert.equal(d.draft.text, 'Recipes was funded by the Base Builder Grant.');
  assert.equal(d.draft.proof_url, 'https://www.base.org/builders/grants-round-3');
  // An announced prize (the outcomes file) is the award.
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, source_url, captured_at)
    VALUES (${pid}, ${program}, 'R1', 'won', 3000, 'announcement', 'https://www.base.org/builders/winners', ${ago(1)})`;
  const w = (await verifiedOutcomeCandidate(id, { programId: program, result: 'won', proofUrl: 'https://www.base.org/builders/winners-r1', entered: true })) as MomentCandidate;
  assert.deepEqual(w.input, { moment: 'won', name: 'Recipes', program: 'Base Builder Grant', award: '$3,000' });
});

test('final review 1: a program with no proof_hosts and no x_handles: no told outcome is ever proof (the announced outcomes only)', dbTest, async () => {
  const { id, key } = await maya();
  const { program } = await entered(id, key, { proofHosts: null });
  for (const proofUrl of [undefined, 'https://www.base.org/builders/grants-round-3', 'https://x.com/base/status/1'])
    assert.equal(await verifiedOutcomeCandidate(id, { programId: program, result: 'accepted', proofUrl, entered: true }), 'no_proof_source', String(proofUrl));
  // An X account listed is enough to ask for proof.
  await sql()`UPDATE programs SET x_handles = '{base}' WHERE id = ${program}`;
  assert.equal(await verifiedOutcomeCandidate(id, { programId: program, result: 'accepted', proofUrl: undefined, entered: true }), 'no_proof');
  assert.ok(typeof (await verifiedOutcomeCandidate(id, { programId: program, result: 'accepted', proofUrl: 'https://x.com/base/status/1', entered: true })) !== 'string');
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
    await sql()`INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_address, coin_launched_at)
      VALUES ('earnkit-coin', 'Recipes', ${`https://github.com/${key}`}, ${`github.com/${key}`}, ${id}, 'RCP', 'launched', 'https://tokens.fun/c/1', now(), ${`0x${randomBytes(20).toString('hex')}`}, ${ago(20)})`;
    delete process.env.EARNKIT_RAISING;
    assert.equal(await coinIntroCandidate(id, NOW), 'no_coin', 'backing off: no intro');
    process.env.EARNKIT_RAISING = 'on';
    // Fix round: launched 20 days ago: old news, no intro.
    assert.equal(await coinIntroCandidate(id, NOW), 'stale');
    await sql()`UPDATE projects SET coin_launched_at = ${ago(2)} WHERE installation_id = ${id} AND program_id = 'earnkit-coin'`;
    delete process.env.EARNKIT_RAISING;
    process.env.EARNKIT_RAISING = 'on';
    const r = await offeredMoment(id, NOW);
    assert.equal(r.moment?.moment, 'coin_intro');
    const d = await draftMoment(id, r.moment!, { asked: false }, NOW);
    assert.ok(d.ok);
    assert.equal(d.draft.text, 'Recipes has a coin now, $RCP. 9 weeks shipping so far.');
    const later = await offeredMoment(id, new Date(NOW.getTime() + 5 * DAY));
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

test('final review 2: a private project named by its proven site host ("earnkit.com") gets its went-live and weekly posts', dbTest, async () => {
  const { id, key } = await maya({ privateRepo: true, weeks: [isoWeekOf(ago(60))] });
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'site', 'https://earnkit.com', ${key}, 'verified', 'proof_line', 'agent')`;
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pmh${id}`}, 'maya', ${key}, ${id}, 1, 1, 'live', ${ago(3)})`;
  const live = await wentLiveCandidate(id, NOW);
  assert.ok(typeof live !== 'string', String(live));
  assert.equal((live.input as { name: string }).name, 'earnkit.com');
  const d = await draftMoment(id, live, { asked: false }, NOW);
  assert.ok(d.ok, JSON.stringify(d));
  assert.match(d.draft.text, /^earnkit\.com is live\./);
  await sql()`UPDATE builder_profiles SET ship_titles_at = now() WHERE builder_id = ${id}`;
  await weekRow(id, key, { facts: { shipped_code: { n: 4 }, streak: { w: 3 } }, summary: 'Added search.' });
  const w = (await weeklyCandidate(id, NOW)) as MomentCandidate;
  assert.equal((w.input as { name: string }).name, 'earnkit.com');
  // Its first shape names it (the drafted one rotates away from the went-live post's opening word).
  assert.equal(writePost(w.input, [])?.text, 'earnkit.com, week 3: added search.');
});

test('final review 3: an event that can\'t be drafted gives way to the next one; nothing to draft is remembered for the day', dbTest, async () => {
  const { eventPost } = await import('./post-reply');
  const { id, key } = await maya({ weeks: [isoWeekOf(ago(60))] });
  // An announced win whose program title the writer refuses (a hype word): never drafted.
  const { program, pid } = await entered(id, key);
  await sql()`UPDATE programs SET title = 'Thrilled Builders Grant' WHERE id = ${program}`;
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, source_url, captured_at)
    VALUES (${pid}, ${program}, 'R1', 'won', 900, 'announcement', 'https://x.com/base/status/1', ${ago(1)})`;
  // Live since 22 hours before NOW: still settling at NOW (16:00), settled by 20:00 the same day.
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pme${id}`}, 'maya', ${key}, ${id}, 1, 1, 'live', ${new Date(NOW.getTime() - (LIVE_SETTLE_DAYS * 24 - 2) * 3_600_000)})`;
  assert.equal(await eventPost(id, `pm_${id}`, NOW, { hot: false }), null, 'the win can\'t be drafted; going live is settling');
  assert.equal(await eventPost(id, `pm_${id}`, new Date(NOW.getTime() + 4 * 3_600_000), { hot: false }), null, 'remembered for the rest of the day');
  const e = await eventPost(id, `pm_${id}`, new Date(NOW.getTime() + DAY), { hot: false });
  assert.ok(e, 'the next day reads again');
  assert.match(e.text, /^Recipes is live\./, 'the win could not be drafted; going live is next');
});

test('final review 3: what nothing-to-draft remembered is read again the same day once a coin launches or a win is announced', dbTest, async () => {
  const { eventPost } = await import('./post-reply');
  const { id, key } = await maya({ weeks: [isoWeekOf(ago(60))] });
  assert.equal(await eventPost(id, `pm_${id}`, NOW, { hot: false }), null);
  const { program, pid } = await entered(id, key);
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, source_url, captured_at)
    VALUES (${pid}, ${program}, 'R1', 'won', 900, 'announcement', 'https://x.com/base/status/1', ${ago(0.1)})`;
  const e = await eventPost(id, `pm_${id}`, new Date(NOW.getTime() + 60_000), { hot: false });
  assert.match(e?.text ?? '', /^Recipes won the Base Builder Grant/);
});

test('fix round: one moment drafted at once from several replies is written once (the hold runs under the store\'s lock)', dbTest, async () => {
  const { id, key } = await maya({ weeks: [isoWeekOf(ago(60))] });
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pmc${id}`}, 'maya', ${key}, ${id}, 1, 1, 'live', ${ago(3)})`;
  const c = (await wentLiveCandidate(id, NOW)) as MomentCandidate;
  // Went live skips the one-offered-a-week limit, so only the hold keeps a second copy out.
  const all = await Promise.all(Array.from({ length: 6 }, () => draftMoment(id, c, { asked: false }, NOW)));
  assert.equal(all.filter((r) => r.ok).length, 1, JSON.stringify(all.map((r) => (r.ok ? 'ok' : r.reason))));
  assert.ok(all.every((r) => r.ok || r.reason === 'once'));
  assert.equal((await sql()`SELECT 1 FROM post_drafts WHERE builder_id = ${id}`).length, 1);
});
