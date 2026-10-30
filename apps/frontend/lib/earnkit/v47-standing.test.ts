import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { padPool } from './fixtures/rank-pool';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { profileData } from './bench-data';
import { benchScore, standingFields } from './bench-find';
import { RANK_MIN_POOL } from './rank';
import { applicationCounts, nextDeadline, pageScore, standingLeads, standingParagraph, streakOnly, wonUsdOf, type Standing } from './standing';
import { saveInstallation, connectInstallation } from './installations';
import { FIND_DESCRIPTION_BENCH, SCORE_DESCRIPTION, SERVER_INSTRUCTIONS } from './mcp';

/**
 * v4.7 Task 2: "where do I stand" gets a real answer: the page's own score and rank, the weeks, money won,
 * applications and drafts, and the next deadline, in every find and score reply; score's first paragraph.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v47-standing-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
const BARE: Standing = { score: null, rank: null, streak: 0, wonUsd: 0, applied: 0, drafts: 0, next: null };
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');

test('a full standing, word for word', () => {
  const full: Standing = { score: 77, rank: '#1 of 40 builders', streak: 6, wonUsd: 5000, applied: 2, drafts: 1, next: { program: 'a16z CSX', day: 'Nov 1' } };
  assert.equal(standingParagraph(full), 'Score 77 · #1 of 40 builders. 6 weeks shipping in a row. $5,000 won so far. 2 applications in, 1 draft ready. Next: a16z CSX closes Nov 1.');
  assert.equal(standingParagraph({ ...full, rank: 'Top 4% of builders', streak: 1, applied: 1, drafts: 3 }),
    'Score 77 · Top 4% of builders. 1 week shipping. $5,000 won so far. 1 application in, 3 drafts ready. Next: a16z CSX closes Nov 1.');
  assert.deepEqual(standingFields(full), { streak: 6, standing: standingParagraph(full) });
});

test('each part only when true: no rank under the pool, no wins, no applications or drafts, no deadline', () => {
  assert.equal(standingParagraph({ ...BARE, score: 77 }), 'Score 77. No grants won yet.');
  assert.equal(standingParagraph(BARE), 'No grants won yet.');
  assert.equal(standingParagraph({ ...BARE, applied: 3 }), 'No grants won yet. 3 applications in.');
  assert.equal(standingParagraph({ ...BARE, drafts: 1 }), 'No grants won yet. 1 draft ready.');
  assert.equal(standingParagraph({ ...BARE, wonUsd: 1234.4, next: { program: 'Base', day: 'Nov 3' } }), '$1,234 won so far. Next: Base closes Nov 3.');
  // A rank with no score never shows (the page shows neither).
  assert.equal(standingParagraph({ ...BARE, rank: '#1 of 40 builders' }), 'No grants won yet.');
  // Fix round 1: wins unknown (a failed read, or a streak-only caller): no wins part, never "No grants won yet".
  assert.equal(standingParagraph({ ...BARE, wonUsd: null }), '');
  assert.equal(standingParagraph({ ...BARE, score: 77, wonUsd: null }), 'Score 77.');
  assert.equal(standingParagraph(streakOnly(6)), '6 weeks shipping in a row.');
  assert.equal(standingParagraph(streakOnly(0)), '');
});

test('fix round 1 (R5): the standing leads only with a score or a streak part', () => {
  assert.equal(standingLeads(BARE), false);
  assert.equal(standingLeads({ ...BARE, wonUsd: 5000, applied: 2 }), false);
  assert.equal(standingLeads({ ...BARE, score: 0 }), true);
  assert.equal(standingLeads({ ...BARE, streak: 1 }), true);
});

test('pageScore: the stored Shipping number only while listed (the page\'s rule)', () => {
  const live = { parts: { shipping: { points: 77, raw: { mask: 3, live_ships: 0 } } } };
  assert.equal(pageScore({ listed: true }, live), 77);
  assert.equal(pageScore({ listed: false }, live), null);
  assert.equal(pageScore({ listed: true }, undefined), null);
  assert.equal(pageScore({ listed: true }, { parts: { people: 3 } }), null, 'an older row shows no number');
});

test('nextDeadline: the earliest open dated fit, in the program\'s own zone; rolling and closed never', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const cards = [
    { id: 'a16z', title: 'a16z CSX', summary: 'up to $500K · Nov 1, 11:59 PM PT', ends_at: new Date('2026-11-02T07:59:59Z') },
    { id: 'late', title: 'Late', summary: 'up to $5K', ends_at: new Date('2026-12-01T00:00:00Z') },
    { id: 'roll', title: 'Rolling', summary: 'up to $5K · rolling', ends_at: new Date('2026-10-31T00:00:00Z') },
    { id: 'gone', title: 'Gone', summary: 'up to $5K', ends_at: new Date('2026-10-29T00:00:00Z') },
    { id: 'none', title: 'None', summary: 'up to $5K', ends_at: null },
  ];
  const fits = ['late', 'roll', 'gone', 'none', 'a16z'].map((program_id) => ({ program_id }));
  assert.deepEqual(nextDeadline(fits, cards, now), { program: 'a16z CSX', day: 'Nov 1' });
  assert.deepEqual(nextDeadline([{ program_id: 'late' }], cards, now), { program: 'Late', day: 'Dec 1' });
  assert.equal(nextDeadline([{ program_id: 'roll' }, { program_id: 'gone' }, { program_id: 'missing' }], cards, now), null);
});

test('the descriptions cover where do I stand, under 800 characters; the instructions are unchanged in size', () => {
  assert.match(SCORE_DESCRIPTION, /where do I stand or how am I doing/);
  assert.match(SCORE_DESCRIPTION, /first paragraph \(standing\) answers it/);
  assert.match(FIND_DESCRIPTION_BENCH, /answer from standing/);
  for (const d of [SCORE_DESCRIPTION, FIND_DESCRIPTION_BENCH, SERVER_INSTRUCTIONS]) assert.ok(d.length < 800, String(d.length));
  // v4.7 T5 (ruling R1): the session-start line covers where they stand; the score line was folded into it.
  assert.ok(SERVER_INSTRUCTIONS.includes('whenever they ask about money, grants or where they stand.'));
});

/** A ranked, listed builder at `score` (a Shipping row), with a confirmed repo project (fixtures/find.ts person). */
async function ranked(tag: string, score: number, streak = 0) {
  const key = `${tag}${RUN}${randomBytes(2).toString('hex')}/app`;
  const id = await person({
    main: key, claimed: `${tag}${RUN}`.slice(0, 15), ranked: true, score,
    seen: { connect_done: '2026-09-01T00:00:00.000Z', declined: { [`qualify:${key}`]: new Date().toISOString() } },
    projects: [{ key, name: 'App', confirmed: true, streak }],
  });
  await sql()`UPDATE builder_live SET parts = ${sql().json({ shipping: { points: score, raw: { mask: 1, live_ships: 0 } } } as never)} WHERE builder_id = ${id}`;
  return { id, ctx: { installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 0, fits: [] })) as never } };
}

test('under RANK_MIN_POOL: "Score 77" with no rank, and the page shows the same score and no rank (Review Focus 1)', db, async () => {
  const hid = (await sql()<{ builder_id: number }[]>`UPDATE builder_profiles SET hidden = true WHERE hidden = false RETURNING builder_id`).map((r) => r.builder_id);
  try {
    const b = await ranked('stp', 77);
    const page = await profileData(b.id, new Date());
    assert.equal(page?.score, 77);
    assert.equal(page?.bench, null, `pool under ${RANK_MIN_POOL}: no rank on the page`);
    for (const tool of ['score', 'find'] as const) {
      const r = await mcpCall(b.ctx, tool, {});
      assert.equal(r.reply?.standing, 'Score 77. No grants won yet.', tool);
      assert.doesNotMatch(JSON.stringify(r.reply), /#\d+ of|Top [\d.]+%/, tool);
    }
  } finally {
    if (hid.length > 0) await sql()`UPDATE builder_profiles SET hidden = false WHERE builder_id = ANY(${hid}::int[])`;
  }
});

test('ranked: score\'s first paragraph is the standing, with the page\'s own score and rank; find carries it on a no-change day; no points', db, async () => {
  await padPool(RANK_MIN_POOL);
  const b = await ranked('str', 88, 6);
  const page = await profileData(b.id, new Date());
  assert.equal(page?.score, 88);
  assert.ok(page?.bench, 'the page shows a rank');
  const want = `Score 88 · ${page!.bench}. 6 weeks shipping in a row. No grants won yet.`;
  const sc = await mcpCall(b.ctx, 'score', {});
  assert.equal(sc.reply?.standing, want);
  assert.equal(show(sc).split('\n\n')[0], want);
  assert.equal(show(sc).split(want).length, 2, 'said once');
  // find: twice, so the second is a no-change day (the standing line was shown already); the fact is still there.
  await mcpCall(b.ctx, 'find', {});
  const f = await mcpCall(b.ctx, 'find', {});
  assert.equal(f.reply?.standing, want);
  assert.equal(f.reply?.streak, 6);
  // No points in what the builder reads (the agent note's "never call it points" is the only mention).
  for (const r of [sc, f]) for (const t of [show(r), String(r.reply?.standing)]) assert.doesNotMatch(t, /\bpoints\b/i, t);
});

test('wins, applications and drafts: announced prizes only; one per program; real drafts in open programs only', db, async () => {
  const b = await ranked('sta', 50);
  const base = committedProgram('base-builder-grants');
  const mk = async (tag: string, o: Record<string, unknown> = {}) => {
    const p = ProgramFile.parse({ ...base, id: `v47-st-${process.pid}-${tag}`, title: `St ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: new Date(Date.now() + 9 * DAY).toISOString(), status: 'active', ...o });
    await upsertProgram(p);
    return p.id;
  };
  const [sent, told, draft, ghost, closed] = [await mk('sent'), await mk('told'), await mk('draft'), await mk('ghost'), await mk('closed')];
  await sql()`UPDATE programs SET ends_at = ${new Date(Date.now() - DAY)} WHERE id = ${closed}`;
  const entry = async (program: string, o: { confirmed?: boolean; answers?: Record<string, string> } = {}) => {
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, confirmed_at, application)
      VALUES (${program}, 'App', ${b.id}, ${o.confirmed ? new Date() : null}, ${o.answers ? sql().json({ answers: o.answers } as never) : null}) RETURNING id`;
    return id;
  };
  assert.deepEqual(await applicationCounts(b.id), { applied: 0, drafts: 0 });
  // Submitted (no confirmation step), twice in one program: one application.
  const won = await entry(sent);
  await entry(sent);
  // Told EarnKit they applied; not interested never counts.
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${b.id}, ${told}, 'applied'), (${b.id}, ${'circle-developer-grants'}, 'not_interested')`;
  // A draft with a real answer counts; a placeholder, a closed program and a program applied to don't.
  await entry(draft, { confirmed: true, answers: { pitch: 'A recipe planner that plans the week.' } });
  await entry(ghost, { confirmed: true, answers: { pitch: '(pitch: answer for pitch)' } });
  await entry(closed, { confirmed: true, answers: { pitch: 'Real words.' } });
  await entry(told, { confirmed: true, answers: { pitch: 'Real words.' } });
  // Fix round 1: a told "applied" for a campaign or the coin program never counts (as entries).
  const camp = await mk('camp');
  await sql()`UPDATE programs SET campaign = '{}'::jsonb WHERE id = ${camp}`;
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${b.id}, ${camp}, 'applied'), (${b.id}, ${'earnkit-coin'}, 'applied')`;
  assert.deepEqual(await applicationCounts(b.id), { applied: 2, drafts: 1 });

  // Wins: an announced prize counts, a self-report never does.
  assert.equal(await wonUsdOf(b.id), 0);
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis)
    VALUES (${won}, ${sent}, 'r1', 'won', 5000, 'announcement'), (${won}, ${sent}, 'r1', 'won', 900, 'self_reported')`;
  assert.equal(await wonUsdOf(b.id), 5000);
  const r = await mcpCall(b.ctx, 'score', {});
  assert.match(String(r.reply?.standing), /^Score 50(?: · [^.]+)?\. \$5,000 won so far\. 2 applications in, 1 draft ready\.$/);
  assert.equal(show(r).split('\n\n')[0], r.reply?.standing);
});

test('fix round 1 (R7): signed out, or a shared client that is no person: the weeks only, no score, rank, wins or applications', db, async () => {
  await padPool(RANK_MIN_POOL);
  const b = await ranked('stx', 66, 4);
  const [{ id: won }] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id) VALUES ('base-builder-grants', 'App', ${b.id}) RETURNING id`;
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis) VALUES (${won}, 'base-builder-grants', 'rx', 'won', 700, 'announcement')`;
  const full = await mcpCall(b.ctx, 'find', {});
  assert.match(String(full.reply?.standing), /^Score 66 · .+\. 4 weeks shipping in a row\. \$700 won so far\. 1 application in\.$/);
  // A shared client (one agent, many builders) whose own installation has no X account: never this builder's numbers.
  const t = `ek_v47sh_${RUN}_${randomBytes(4).toString('hex')}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const shared = { ...b.ctx, ownInstallationId: own, sharedClient: true };
  const r = await mcpCall(shared as never, 'find', {});
  // The tools never reach the Bench for a shared client (find's hosted path, score's SCORE_SHARED); the Bench's own
  // gate holds anyway: benchScore called directly says the weeks only.
  assert.doesNotMatch(JSON.stringify(r.reply ?? {}), /Score 66|\$700|application in/);
  const direct = await benchScore(shared as never, new Date());
  assert.equal(direct?.standing, '4 weeks shipping in a row.');
  assert.doesNotMatch(JSON.stringify(direct ?? {}), /Score 66|\$700|application in/);
  // A shared client whose own installation is bound to X is that person (replyFacts' rule): the full standing.
  await sql()`UPDATE installations SET x_user_id = ${`x${own}`} WHERE id = ${own}`;
  assert.match(String((await benchScore(shared as never, new Date()))?.standing), /^Score 66 · .+\$700 won so far/);
  // Signed out (X sign-in on, the profile's X claim removed): the weeks only.
  await sql()`UPDATE builder_profiles SET x_user_id = NULL, x_handle = NULL WHERE builder_id = ${b.id}`;
  const was = [process.env.X_CLIENT_ID, process.env.X_CLIENT_SECRET];
  [process.env.X_CLIENT_ID, process.env.X_CLIENT_SECRET] = ['cid', 'sec'];
  try {
    for (const tool of ['find', 'score'] as const) {
      const o = await mcpCall(b.ctx, tool, {});
      assert.equal(o.reply?.standing, '4 weeks shipping in a row.', tool);
      assert.doesNotMatch(String(o.reply?.show_to_builder), /Score 66|\$700|application in/, tool);
    }
  } finally {
    for (const [k, v] of [['X_CLIENT_ID', was[0]], ['X_CLIENT_SECRET', was[1]]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
