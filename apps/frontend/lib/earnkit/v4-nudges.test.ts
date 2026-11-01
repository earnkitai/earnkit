import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { pathQuiet } from './fixtures/wallet-step';
import { dropPrograms } from './fixtures/programs-cleanup';
import { isoWeekOf } from './weeks';
import { acceptedNudge, closingNudge, fridayNudge, milestoneNudge, nudgeFor } from './nudges';

/**
 * v4.0 Task 8 (approved copy 6, "Nudges"): at most one nudge a week, in a friendly mentor voice: accepted or funded, a
 * users milestone, a program closing within 3 days with a draft ready, nothing shipped by Friday. Claimed through
 * standing_seen.nudge_week (the week's Monday); it leads a ranked reply only.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v4-nudges-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// Friday Oct 30 2026, 15:00 UTC (the ISO week starting Monday Oct 26).
const FRIDAY = Date.parse('2026-10-30T15:00:00Z');
const MONDAY = Date.parse('2026-10-26T00:00:00Z');
const DAY = 86_400_000;
const FRIDAY_ISO = new Date(FRIDAY).toISOString();
mock.timers.enable({ apis: ['Date'], now: FRIDAY });
const programs: string[] = [];
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) {
    await dropPrograms(programs);
    await sql().end();
  }
});
const RUN = String(process.pid % 100000);
const at = (t: number) => new Date(t);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
/** The `n` ISO weeks ending with the week before `t`'s. */
const weeksBefore = (t: number, n: number) => Array.from({ length: n }, (_, i) => isoWeekOf(new Date(t - (i + 1) * 7 * DAY))).sort();

async function program(title: string, endsAt: number | null): Promise<string> {
  const id = `v4n-${randomBytes(4).toString('hex')}-${process.pid}`;
  await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, ends_at, status, existing_work)
    VALUES (${id}, 'Org', ${title}, 'x', 'https://example.com', 'https://example.com/apply', '$1', 'x', ${endsAt === null ? null : at(endsAt)}, 'active', 'allowed')`;
  programs.push(id);
  return id;
}
/** A ranked builder on X with one Bench-confirmed repo, code `streak` weeks in a row up to last week. */
async function builder(tag: string, o: { streak?: number; name?: string } = {}) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({
    main: key, claimed: handle, ranked: true, seen: { connect_done: '2026-09-01T00:00:00.000Z' },
    projects: [{ key, name: o.name ?? 'MealMate', confirmed: true, commit_weeks: weeksBefore(FRIDAY, o.streak ?? 0) }],
  });
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) SELECT id, '{"private": false}'::jsonb, true, now() FROM builder_sources WHERE builder_id = ${id}`;
  return { id, key, handle };
}
async function usage(id: number, day: number, users: number) {
  await sql()`INSERT INTO app_usage (builder_id, source, day, users, "returning") VALUES (${id}, 'contracts', ${ymd(day)}::date, ${users}, 0)`;
}
async function outcomeDraft(id: number, programId: string, createdAt: number, status: 'accepted' | 'funded' = 'accepted') {
  const code = Array.from(randomBytes(10), (b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('');
  await sql()`INSERT INTO post_drafts (code, builder_id, project_key, moment, moment_key, shape, text, proof_url, created_at, expires_at)
    VALUES (${code}, ${id}, 'x/app', ${status}, ${`${status}:${programId}`}, ${status}, 'MealMate was accepted.', 'https://example.com/news',
      ${at(createdAt)}, ${at(createdAt + 14 * DAY)})`;
  return code;
}
async function draftEntry(id: number, programId: string) {
  await sql()`INSERT INTO projects (program_id, name, installation_id, confirmed_at) VALUES (${programId}, 'MealMate', ${id}, ${at(FRIDAY - 5 * DAY)})`;
}
const nudgeWeek = async (id: number) =>
  (await sql()<{ w: string | null }[]>`SELECT standing_seen->>'nudge_week' AS w FROM builder_profiles WHERE builder_id = ${id}`)[0]?.w ?? null;

test('the four approved lines, word for word', () => {
  assert.equal(fridayNudge(5), 'Quiet week, no stress. Ship anything small by Sunday and your 5-week streak stays alive.');
  assert.equal(closingNudge('Arc Builders', 'Friday'), 'Heads up, Arc Builders closes Friday. Your draft is ready. Want to send it?');
  assert.equal(closingNudge('Arc Builders', 'today'), 'Heads up, Arc Builders closes today. Your draft is ready. Want to send it?');
  assert.equal(milestoneNudge('MealMate', 100, 'Base'), "MealMate just passed 100 users. That's real traction, and it makes your Base application a lot stronger.");
  assert.equal(milestoneNudge('MealMate', 100, null), "MealMate just passed 100 users. That's real traction.");
  assert.equal(acceptedNudge('Arc Builders', 'https://earnkit.com/maya/post/abcdefghij'), 'You got into Arc Builders. Huge, well earned. Want to share it? https://earnkit.com/maya/post/abcdefghij');
  for (const s of [fridayNudge(5), closingNudge('A', 'today'), milestoneNudge('M', 10, 'B'), acceptedNudge('A', 'https://x.y')])
    assert.doesNotMatch(s, /—|[Cc]oin|\p{Extended_Pictographic}/u);
});

test('(a) accepted or funded: the line with the outcome post link, once; a congratulation this week is the week\'s nudge', db, async () => {
  const me = await builder('v4na', { streak: 3 });
  const arc = await program('Arc Builders', null);
  const code = await outcomeDraft(me.id, arc, FRIDAY - 8 * DAY);
  assert.equal(await nudgeFor(me.id, at(FRIDAY)), `You got into Arc Builders. Huge, well earned. Want to share it? https://earnkit.com/${me.handle}/post/${code}`);
  assert.equal(await nudgeWeek(me.id), ymd(MONDAY));
  // Next week: never the same outcome again (the streak is 0 by then, so nothing else is due).
  assert.equal(await nudgeFor(me.id, at(FRIDAY + 7 * DAY)), null);
  // Funded reads the same way.
  const b = await builder('v4nf');
  const g = await program('Base Grants', null);
  const c2 = await outcomeDraft(b.id, g, FRIDAY - 9 * DAY, 'funded');
  assert.equal(await nudgeFor(b.id, at(FRIDAY)), `You got into Base Grants. Huge, well earned. Want to share it? https://earnkit.com/${b.handle}/post/${c2}`);
  // Congratulated this week already (the tell's reply): no repeat, and that congratulation is the week's nudge.
  const c = await builder('v4nc', { streak: 3 });
  await outcomeDraft(c.id, await program('Arc Builders', null), FRIDAY - 2 * DAY);
  assert.equal(await nudgeFor(c.id, at(FRIDAY)), null, 'not the Friday line either');
  assert.equal(await nudgeWeek(c.id), ymd(MONDAY));
  // Shared already (the post was tapped): nothing to ask.
  const d = await builder('v4nt');
  const dc = await outcomeDraft(d.id, await program('Arc Builders', null), FRIDAY - 8 * DAY);
  await sql()`UPDATE post_drafts SET first_tap_at = ${at(FRIDAY - 7 * DAY)}, taps = 1 WHERE code = ${dc}`;
  assert.equal(await nudgeFor(d.id, at(FRIDAY)), null);
});

test('(b) a milestone crossed this week: the line with the Best fit, else ending at traction; once ever', db, async () => {
  const me = await builder('v4nm');
  await usage(me.id, MONDAY - 2 * DAY, 80);
  await usage(me.id, FRIDAY - DAY, 120);
  assert.equal(await nudgeFor(me.id, at(FRIDAY), { best: 'Base' }), "MealMate just passed 100 users. That's real traction, and it makes your Base application a lot stronger.");
  // Never again for 100, even in a later week.
  assert.equal(await nudgeFor(me.id, at(FRIDAY + 7 * DAY), { best: 'Base' }), null);
  // No Best fit: the line ends after "That's real traction."; the highest milestone crossed (10 and 100 at once: 100).
  const b = await builder('v4nn', { name: 'Tally' });
  await usage(b.id, MONDAY - 3 * DAY, 4);
  await usage(b.id, FRIDAY - DAY, 140);
  assert.equal(await nudgeFor(b.id, at(FRIDAY)), "Tally just passed 100 users. That's real traction.");
  // Passed before this week: no milestone.
  const c = await builder('v4no');
  await usage(c.id, MONDAY - DAY, 110);
  await usage(c.id, FRIDAY - DAY, 130);
  assert.equal(await nudgeFor(c.id, at(FRIDAY)), null);
});

test('final review 5: no reading before this week is no baseline: a first reading of 500 is never "just passed"', db, async () => {
  const me = await builder('v4zz');
  await usage(me.id, FRIDAY - DAY, 500);
  assert.equal(await nudgeFor(me.id, at(FRIDAY), { best: 'Base' }), null);
  // Once a reading before Monday exists, the next week can cross a milestone.
  await usage(me.id, FRIDAY + 6 * DAY, 1200);
  assert.equal(await nudgeFor(me.id, at(FRIDAY + 7 * DAY)), "MealMate just passed 1,000 users. That's real traction.");
});

test('(c) a program closing within 3 days with a draft ready: the program-zone day, or the hours left under 48 hours', db, async () => {
  const me = await builder('v4nd');
  // Wednesday Oct 28: closes Friday Oct 30, 51 hours later: the day in the program's zone (v4.8.1 final fix R-3).
  const wed = FRIDAY - 2 * DAY;
  await draftEntry(me.id, await program('Arc Builders', FRIDAY + 3 * 3600_000));
  assert.match((await nudgeFor(me.id, at(wed)))!, /^Heads up, Arc Builders closes Oct 30\. Your draft is ready\. Want to send it\?$/);
  // The deadline is 3 hours away: the hours left, never "today".
  const b = await builder('v4ne');
  await draftEntry(b.id, await program('Arc Builders', FRIDAY + 3 * 3600_000));
  assert.equal(await nudgeFor(b.id, at(FRIDAY)), 'Heads up, Arc Builders closes in 3 hours. Your draft is ready. Want to send it?');
  // Over 3 days away, submitted, or no draft: nothing.
  const c = await builder('v4ng');
  await draftEntry(c.id, await program('Far Away', wed + 4 * DAY));
  await program('No Draft', wed + DAY);
  assert.equal(await nudgeFor(c.id, at(wed)), null);
  const d = await builder('v4nh');
  const sent = await program('Sent One', wed + DAY);
  await draftEntry(d.id, sent);
  await sql()`UPDATE projects SET submission_confirmed_at = ${at(wed - DAY)} WHERE installation_id = ${d.id}`;
  assert.equal(await nudgeFor(d.id, at(wed)), null);
});

test('(d) nothing shipped by Friday: the streak line', db, async () => {
  const me = await builder('v4nq', { streak: 5 });
  assert.equal(await nudgeFor(me.id, at(FRIDAY)), 'Quiet week, no stress. Ship anything small by Sunday and your 5-week streak stays alive.');
});

test('(e) two nudges due in one week: only one shows that week', db, async () => {
  const me = await builder('v4nw', { streak: 4 });
  await usage(me.id, MONDAY - 3 * DAY, 2);
  await usage(me.id, FRIDAY - DAY, 12);
  assert.equal(await nudgeFor(me.id, at(FRIDAY)), "MealMate just passed 10 users. That's real traction.", 'the milestone comes first');
  assert.equal(await nudgeFor(me.id, at(FRIDAY)), null, 'the Friday line waits');
  assert.equal(await nudgeFor(me.id, at(FRIDAY + DAY)), null, 'Saturday too: one a week');
});

test('(f) the Friday rule: Friday to Sunday UTC only, and only with a streak of 2 or more', db, async () => {
  const thu = await builder('v4nr', { streak: 3 });
  assert.equal(await nudgeFor(thu.id, at(FRIDAY - DAY)), null, 'Thursday');
  assert.equal(await nudgeFor(thu.id, at(FRIDAY - 15 * 3600_000 - 1000)), null, 'Thursday 23:59:59 UTC');
  const one = await builder('v4ns', { streak: 1 });
  assert.equal(await nudgeFor(one.id, at(FRIDAY)), null, 'a streak of 1');
  const sat = await builder('v4nu', { streak: 2 });
  assert.equal(await nudgeFor(sat.id, at(FRIDAY + DAY)), 'Quiet week, no stress. Ship anything small by Sunday and your 2-week streak stays alive.');
  const sun = await builder('v4nv', { streak: 2 });
  assert.equal(await nudgeFor(sun.id, at(FRIDAY + 2 * DAY + 8 * 3600_000)), 'Quiet week, no stress. Ship anything small by Sunday and your 2-week streak stays alive.', 'Sunday 23:00 UTC');
  // Shipped this week: no nudge.
  const shipped = await builder('v4nx', { streak: 3 });
  await sql()`UPDATE builder_projects SET commit_weeks = array_append(commit_weeks, ${isoWeekOf(at(FRIDAY))}) WHERE builder_id = ${shipped.id}`;
  assert.equal(await nudgeFor(shipped.id, at(FRIDAY)), null);
});

test('the nudge leads a ranked find reply, once that week', db, async () => {
  await sql()`UPDATE builder_profiles SET hidden = true`;
  const me = await builder('v4ny', { streak: 3 });
  // v4.8 Task 1: a nudge with no question leads the older ranked reply; the path (which it waits behind) is parked.
  await pathQuiet(me.id);
  // Scored "just now" on the mocked clock (a live row older than its refresh window is rescored, without GitHub here).
  await sql()`UPDATE builder_live SET computed_at = ${at(FRIDAY)}, read_at = ${at(FRIDAY)} WHERE builder_id = ${me.id}`;
  const ctx = { installationId: me.id, ownInstallationId: me.id, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 0, fits: [] })) as never };
  const first = String((await mcpCall(ctx, 'find', {})).reply?.show_to_builder ?? '');
  assert.ok(first.startsWith('Quiet week, no stress. Ship anything small by Sunday and your 3-week streak stays alive.\n\n'), first);
  const again = String((await mcpCall(ctx, 'find', {})).reply?.show_to_builder ?? '');
  assert.doesNotMatch(again, /Quiet week/, again);
});

// ---- Fix round 1 ----

const findCtx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 0, fits: [] })) as never });
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
/** A ranked builder scored "just now" on the mocked clock, so find never rescores it (without GitHub here). */
async function fresh(tag: string, o: { streak?: number } = {}) {
  await sql()`UPDATE builder_profiles SET hidden = true`;
  const me = await builder(tag, o);
  await sql()`UPDATE builder_live SET computed_at = ${at(FRIDAY)}, read_at = ${at(FRIDAY)} WHERE builder_id = ${me.id}`;
  return me;
}

test('fix round 1 (1): a news line keeps every standing_seen key but the ones it owns', db, async () => {
  const { takeNews } = await import('./stand-view');
  const me = await builder('v4nk');
  const kept = {
    token_offered: '2026-10-20T00:00:00.000Z', setup_asked: '2026-10-20T00:00:00.000Z', setup_done: '2026-10-21T00:00:00.000Z',
    wallet_setup: { at: 'x' }, checkin_asks: 2, nudge_week: '2026-10-26', some_future_key: { a: 1 },
  };
  await sql()`UPDATE builder_profiles SET standing_seen = ${sql().json({ ...kept, people: { x: 1 } } as never)} WHERE builder_id = ${me.id}`;
  const base = { standing: { ranked: true, rank: 3, total: 9 }, claimed: true, handle: me.handle, signInLink: null };
  // The first look records where the person stands (the rewrite), saying nothing.
  assert.equal(await takeNews(me.id, {}, base, at(FRIDAY), false), null);
  const [{ seen }] = await sql()<{ seen: Record<string, unknown> }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${me.id}`;
  for (const [k, v] of Object.entries(kept)) assert.deepEqual(seen[k], v, k);
  assert.equal(seen.rank, 3);
  assert.equal(seen.at, at(FRIDAY).toISOString());
  assert.equal(seen.people, undefined, 'the retired news key it owns is replaced');
});

test('fix round 1 (2, 4): the closing nudge owns the reply\'s one question; its yes drafts that program; only its own deadline line goes', db, async () => {
  const me = await fresh('v4nz');
  // Another entry closes sooner (Saturday), told as applied: the deadline line names it, the nudge skips it.
  const soon = await program('Soon Grant', FRIDAY + DAY);
  await draftEntry(me.id, soon);
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${me.id}, ${soon}, 'applied')`;
  const arc = await program('Arc Builders', FRIDAY + 2 * DAY);
  await draftEntry(me.id, arc);
  const r = await mcpCall(findCtx(me.id), 'find', {});
  const s = String(r.reply?.show_to_builder ?? '');
  // v4.8.1 final fix (R-3): 48 hours away is the program-zone day (UTC here, Nov 1), never a UTC weekday.
  assert.ok(s.startsWith('Heads up, Arc Builders closes Nov 1. Your draft is ready. Want to send it?'), s);
  assert.equal(questions(s), 1, s);
  assert.match(s, /Soon Grant closes in \d+ hours; your entry isn.t submitted\./, 'another program\'s deadline line stays');
  assert.doesNotMatch(s, /Arc Builders closes in/, 'its own deadline line goes');
  const mv = r.reply?.move_up as { kind: string; project_key: string } | undefined;
  assert.deepEqual([mv?.kind, mv?.project_key], ['apply', me.key]);
  // v4.2 Task 5 (F14): the entry has a stored answer, so the draft is ready.
  await sql()`UPDATE projects SET application = ${sql().json({ answers: { note: 'MealMate helps you plan meals' }, kinds: {}, fixes: [], at: FRIDAY_ISO } as never)} WHERE installation_id = ${me.id} AND program_id = ${arc}`;
  const yes = await mcpCall(findCtx(me.id), 'tell', { move_up: { kind: 'apply', project_key: me.key, answer: 'yes' } });
  // v4.2 Task 5 (F14): the entry exists, so the yes opens its draft (never an empty reply or a call to draft again).
  assert.match(String(yes.reply?.show_to_builder ?? ''), /https:\/\/example\.com\/apply/);
  assert.doesNotMatch(String(yes.reply?.agent_note ?? ''), /Call prepare/);
});

test('fix round 1 (2): the accepted nudge owns the reply\'s one question; its yes gives the post\'s link', db, async () => {
  const me = await fresh('v4nj', { streak: 3 });
  const code = await outcomeDraft(me.id, await program('Arc Builders', null), FRIDAY - 8 * DAY);
  const link = `https://earnkit.com/${me.handle}/post/${code}`;
  const r = await mcpCall(findCtx(me.id), 'find', {});
  const s = String(r.reply?.show_to_builder ?? '');
  assert.ok(s.startsWith(`You got into Arc Builders. Huge, well earned. Want to share it? ${link}`), s);
  assert.equal(questions(s), 1, s);
  assert.equal((s.match(/https?:\/\/\S+/g) ?? []).length, 1, s);
  const mv = r.reply?.move_up as { kind: string; project_key: string } | undefined;
  assert.equal(mv?.kind, 'outcome_share');
  const yes = await mcpCall(findCtx(me.id), 'tell', { move_up: { kind: 'outcome_share', project_key: me.key, answer: 'yes' } });
  assert.equal(String(yes.reply?.show_to_builder ?? ''), `Your post is ready to share: ${link}`);
});

test('fix round 1 (2): the Friday line is rhetorical: it leads beside the ranked ask', db, async () => {
  const me = await fresh('v4ni', { streak: 3 });
  await pathQuiet(me.id);
  const r = await mcpCall(findCtx(me.id), 'find', {});
  const s = String(r.reply?.show_to_builder ?? '');
  assert.ok(s.startsWith('Quiet week, no stress.'), s);
  assert.ok(r.reply?.move_up, 'the ranked ask stays');
});

test('fix round 1 (4): the closing nudge drops its own program\'s deadline line', db, async () => {
  const me = await fresh('v4nl');
  await draftEntry(me.id, await program('Arc Builders', FRIDAY + 2 * DAY));
  const s = String((await mcpCall(findCtx(me.id), 'find', {})).reply?.show_to_builder ?? '');
  assert.ok(s.startsWith('Heads up, Arc Builders closes Nov 1.'), s);
  assert.doesNotMatch(s, /closes in 2 days|isn't submitted/, s);
});

// ---- Fix round 2 ----

test('fix round 2: not counted yet, an unsubmitted entry closing soon keeps its submit question (the nudge never shows)', db, async () => {
  await sql()`UPDATE builder_profiles SET hidden = true`;
  const key = `v4np${RUN}/app`;
  const id = await person({ main: key, claimed: `v4np${RUN}`.slice(0, 15), seen: { connect_done: '2026-09-01T00:00:00.000Z' }, projects: [{ key, name: 'MealMate', confirmed: false }] });
  await sql()`UPDATE builder_live SET computed_at = ${at(FRIDAY)}, read_at = ${at(FRIDAY)} WHERE builder_id = ${id}`;
  await draftEntry(id, await program('Arc Builders', FRIDAY + 2 * DAY));
  const s = String((await mcpCall(findCtx(id), 'find', {})).reply?.show_to_builder ?? '');
  assert.match(s, /Did you submit it\?/, s);
  assert.doesNotMatch(s, /Heads up/, s);
  assert.equal(await nudgeWeek(id), null, 'the week stays unclaimed');
});

test('fix round 2: the Monday block due keeps the submit question (today\'s order); the nudge waits', db, async () => {
  const MON = Date.parse('2026-11-02T16:15:00Z');
  const LAST = '2026-10-26';
  mock.timers.setTime(MON);
  try {
    const me = await fresh('v4nb', { streak: 3 });
    await sql()`UPDATE builder_live SET computed_at = ${at(MON)}, read_at = ${at(MON)} WHERE builder_id = ${me.id}`;
    for (const [day, score] of [['2026-10-25', 40], ['2026-11-01', 44]] as const)
      await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
        VALUES (${me.id}, ${day}, ${score}, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${(await import('./score-calibration')).LIVE_CALIBRATION_V2}, false, true)`;
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, titles, summary)
      VALUES (${me.id}, ${me.key}, ${LAST}, ${sql().json({ checked: true, shipped_code: { n: 4 } } as never)}, ${['Add the planner']}::text[], 'Shipped the planner.')`;
    await draftEntry(me.id, await program('Arc Builders', MON + 2 * DAY));
    const s = String((await mcpCall(findCtx(me.id), 'find', {})).reply?.show_to_builder ?? '');
    assert.match(s, /Did you submit it\?/, s);
    assert.doesNotMatch(s, /Heads up/, s);
    assert.equal(await nudgeWeek(me.id), null, 'the nudge waits, unclaimed');
  } finally {
    mock.timers.setTime(FRIDAY);
  }
});

test('fix round 2: the closing nudge that owns the reply: one question, no submit question, no points line marked shown', db, async () => {
  const me = await fresh('v4na2');
  await draftEntry(me.id, await program('Arc Builders', FRIDAY + 2 * DAY));
  const s = String((await mcpCall(findCtx(me.id), 'find', {})).reply?.show_to_builder ?? '');
  assert.ok(s.startsWith('Heads up, Arc Builders closes Nov 1.'), s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /Did you submit|points/, s);
  const [{ seen }] = await sql()<{ seen: Record<string, unknown> }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${me.id}`;
  assert.equal(seen.nag_week, undefined, 'the points line was not shown, so never marked shown');
  assert.equal(seen.backers_seen, undefined);
});
