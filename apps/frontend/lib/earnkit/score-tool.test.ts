import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FILL_LINES, HELD_LINE, MORE_USERS_LINE, SCORE_NOTES, SCORE_SHARED, SITE_TXT_LINE, WORKING_LINE, movedLine, nextAction, programLine, scoreLines, scoreReply, secondLine, youLine, type ScoreProgram } from './score-tool';
import { listPrograms, upsertProgram } from './programs';
import { ProgramFile } from './program-file';
import { committedProgram } from './fixtures/program-file';
import { emptyReasonOf, pitchAllowed, siteShowsUse, verifiedProject } from './builder-score';
import { discover } from './discovery';
import type { ReaderDeps } from './source-readers';
import { profileCode } from './discovery-clues';
import { CONSENT_LINE } from './profiles';
import { sql } from './db';
import { computeScore, type Parts } from './score';
import { calibration } from './score-calibration';
import { tokenLineFor } from './token-gate';

const NOW = new Date('2026-10-12T12:00:00Z');
const parts = (users: number) => computeScore([{ key: 'k', title: 'k', users, money_usd: 0, outcomes: [], first_outcome_at: null, last_used_at: null, commit_weeks: [] }], calibration(), NOW).parts;

test('8.1 the reply: score, top N%, change, what moved, one next action, one question at most, no tool names', () => {
  const next = nextAction({ parts: parts(40), missing: null, hasPackage: false, hasSite: false });
  const text = scoreLines({ score: 41, percentile: 78, change: 6, moved: 'Users +6.', held: false, slug: 'lee', next, program: null });
  assert.equal(text.split('\n')[0], 'Score 41, top 22%, up 6 since you last asked. earnkit.com/b/lee');
  assert.equal(text.split('\n')[1], 'Users +6.');
  assert.ok((text.match(/\?/g) ?? []).length <= 1);
  assert.doesNotMatch(text, /\b(find|prepare|confirm|tell|score tool)\b|—/);
  // With the event log off the change is over 7 days, and says so; a hidden profile shows no link (it is a 404).
  const week = scoreLines({ score: 41, percentile: 78, change: -3, since: 'week', moved: null, held: false, slug: 'lee', hidden: true, next, program: null });
  assert.equal(week.split('\n')[0], 'Score 41, top 22%, down 3 this week.');
});

test('final T15 ruling: "top N%" only for N <= 50, in the score reply and find\'s line; above it the score alone', () => {
  const next = nextAction({ parts: null, missing: null, hasPackage: false, hasSite: false });
  const base = { change: null, moved: null, held: false, slug: 'lee', next, program: null };
  assert.equal(scoreLines({ ...base, score: 41, percentile: 50 }).split('\n')[0], 'Score 41, top 50%. earnkit.com/b/lee');
  assert.equal(scoreLines({ ...base, score: 7, percentile: 31 }).split('\n')[0], 'Score 7. earnkit.com/b/lee');
  assert.equal(scoreLines({ ...base, score: 7, percentile: 31, change: 2 }).split('\n')[0], 'Score 7, up 2 since you last asked. earnkit.com/b/lee');
  assert.equal(youLine({ score: 7, percentile: 31, slug: 'lee' }), 'You: score 7. earnkit.com/b/lee');
  assert.equal(youLine({ score: 41, percentile: 78, slug: 'lee' }), 'You: score 41, top 22%. earnkit.com/b/lee');
  assert.equal(youLine({ score: 7, percentile: 0, slug: 'lee', hidden: true }), 'You: score 7.');
});

test('8.2 the next action is the step with the most expected points; "no outside users" only when the users part is 0', () => {
  assert.equal(nextAction({ parts: null, missing: 'ownership_unproven', hasPackage: false, hasSite: false }).kind, 'link_repo');
  assert.equal(nextAction({ parts: null, missing: 'no_github', hasPackage: false, hasSite: false }).kind, 'link_site');
  assert.equal(nextAction({ parts: parts(3), missing: null, hasPackage: false, hasSite: true }).kind, 'ship_to_users');
  assert.equal(nextAction({ parts: null, missing: 'read_failed', hasPackage: false, hasSite: false }).kind, 'wait_read');
  assert.equal(FILL_LINES.ownership_unproven.ask, "Your repos aren't linked yet. Add a one-line earnkit.txt so they count?");
  // Users part 0: nothing has outside users yet.
  assert.equal(nextAction({ parts: parts(0), missing: null, hasPackage: false, hasSite: true }).line, FILL_LINES.nothing_live.say);
  // A score of 41 (users 40) has outside users: the best-gain step, never "nothing has users".
  const forty = nextAction({ parts: parts(40), missing: null, hasPackage: false, hasSite: false });
  assert.deepEqual([forty.kind, forty.line], ['ship_to_users', MORE_USERS_LINE]);
  // Users full: linking the site (staying power) is worth more.
  assert.equal(nextAction({ parts: parts(500), missing: null, hasPackage: false, hasSite: false }).kind, 'link_site');
  // A site a repo only links is shown, never scored: the step is its earnkit.txt line.
  assert.equal(nextAction({ parts: parts(500), missing: null, hasPackage: false, hasSite: false, linkedSite: true }).line, SITE_TXT_LINE);
});

test('8.3 movedLine names parts that moved by a point or more, biggest first; nothing moved is null', () => {
  assert.equal(movedLine({ users: 6.2, money: 0, staying: -1.4, recency: 0.3, consistency: 0 }), 'Users +6, staying power -1.');
  assert.equal(movedLine({ users: 0.4, money: 0, staying: 0, recency: 0, consistency: 0 }), null);
});

test('8.4 a held score says it is in review and shows the last public number; a program line names the prize', () => {
  const next = nextAction({ parts: parts(40), missing: null, hasPackage: false, hasSite: false });
  const text = scoreLines({ score: 41, percentile: 78, change: null, moved: null, held: true, slug: 'lee', next, program: programLine({ title: 'Arc Microgrants', prize: '500 USDC' }) });
  assert.match(text, /^Score 41, top 22%\. earnkit\.com\/b\/lee\nYour newest score is in a quick review\./);
  // Money first: the program line comes before the next step.
  assert.match(text, /\nArc Microgrants fits you: 500 USDC\.\nMore people using what you shipped moves your score most\.$/);
});

test('8.5 a shared client gets one plain line and nothing is read', async () => {
  assert.deepEqual(await scoreReply({ installationId: 1, sharedClient: true }, NOW), { show_to_builder: SCORE_SHARED, score: null, percentile: null });
});

// ---- With a database: the whole reply.

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// builder_scores and builder_events are append-only: this run's people are fresh ids.
const T = 2_141_000_000 + Math.floor(Math.random() * 200_000) * 20;
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await sql()`DELETE FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM discovery_queue WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_ranks WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_profiles WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM proof_line_issues WHERE installation_id BETWEEN ${T} AND ${T + 19}`;
  await sql().end();
});
const SECRET = 's'.repeat(40);
async function withEnv<R>(env: Record<string, string>, fn: () => Promise<R>): Promise<R> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}
const profile = (id: number, o: { held?: boolean; hidden?: boolean } = {}) =>
  sql()`INSERT INTO builder_profiles (builder_id, slug, held, hidden, consent_shown_at) VALUES (${id}, ${`s${id}`}, ${o.held ?? false}, ${o.hidden ?? false}, now())`;
const scoreRow = (id: number, day: string, score: number, p: Parts | Record<string, never>, held = false, top: Record<string, unknown> = {}) =>
  sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${day}, ${score}, 50, ${sql().json(p as never)}, ${sql().json(top as never)}, 'v1', 'v1-launch', ${held})`;
const source = (id: number, kind: string, ref: string, state: string, proof: string | null = null, project_key = ref) =>
  sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, ${kind}, ${ref}, ${project_key}, ${state}, ${proof}, 'server')`;
const viewed = (id: number) => sql()<{ detail: { score: number | null; day: string | null } }[]>`
  SELECT detail FROM builder_events WHERE type = 'score_viewed' AND installation_id = ${id} ORDER BY at`;
const noPrograms = { programs: async () => [] };

test('8.7 no score yet: the profile is made and queued, the reply says it is being worked out, with the link; one score_viewed a minute', dbTest, async () => {
  const id = T;
  const [r, again] = await withEnv({ EARNKIT_EVENT_LOG: 'on' }, async () => {
    const r = await scoreReply({ installationId: id }, NOW, noPrograms);
    return [r, await scoreReply({ installationId: id }, NOW, noPrograms)];
  });
  const [p] = await sql()<{ slug: string; consent: boolean }[]>`SELECT slug, consent_shown_at IS NOT NULL AS consent FROM builder_profiles WHERE builder_id = ${id}`;
  // Final review I4: a first call to score delivers the consent line once (it carries the link).
  assert.equal(r.show_to_builder, `${WORKING_LINE}\n${CONSENT_LINE(p.slug)}`);
  assert.equal(again.show_to_builder, `${WORKING_LINE}\nearnkit.com/b/${p.slug}`);
  assert.equal(p.consent, true);
  assert.deepEqual([r.score, r.percentile], [null, null]);
  const [q] = await sql()<{ reason: string }[]>`SELECT reason FROM discovery_queue WHERE builder_id = ${id}`;
  assert.equal(q.reason, 'first_find');
  assert.equal((await viewed(id)).length, 1, 'deduped by the minute');
});

test('8.8 an empty profile leads with its fill step: unproven repos get their earnkit.txt lines (at most 5, each issued) and discovery runs again', dbTest, async () => {
  const id = T + 1;
  await profile(id);
  await scoreRow(id, '2026-10-11', 0, {});
  for (let i = 0; i < 6; i++) await source(id, 'repo', `lee${T}/app${i}`, 'proposed');
  await sql()`INSERT INTO discovery_queue (builder_id, reason, done_at) VALUES (${id}, 'first_find', now())`;
  assert.equal(await emptyReasonOf(id), 'ownership_unproven');
  const r = await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => scoreReply({ installationId: id, ownInstallationId: id }, NOW, noPrograms));
  assert.equal(r.show_to_builder, `${FILL_LINES.ownership_unproven.ask}\nearnkit.com/b/s${id}`);
  assert.equal(r.proof_line?.length, 5);
  const line = await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, async () => tokenLineFor(id, `https://github.com/lee${T}/app0`));
  assert.deepEqual(r.proof_line?.[0], { repo: `lee${T}/app0`, line });
  assert.match(r.agent_note ?? '', /earnkit\.txt/);
  const issued = await sql()`SELECT repo_key FROM proof_line_issues WHERE installation_id = ${id}`;
  assert.equal(issued.length, 5);
  const [q] = await sql()<{ done_at: Date | null }[]>`SELECT done_at FROM discovery_queue WHERE builder_id = ${id}`;
  assert.equal(q.done_at, null, 'queued again, so the pushed line is checked next run');
});

test('8.9 a scored person: change since the last time they asked and what moved; a held person sees the public number only', dbTest, async () => {
  const id = T + 2;
  await profile(id);
  await source(id, 'site', 'https://lee.example.com', 'verified', 'earnkit_txt');
  await scoreRow(id, '2026-10-10', 35, parts(30));
  await sql()`INSERT INTO builder_ranks (builder_id, score, percentile, computed_at) VALUES (${id}, 41, 78, now())`;
  const first = await withEnv({ EARNKIT_EVENT_LOG: 'on' }, () => scoreReply({ installationId: id }, new Date('2026-10-10T12:00:00Z'), noPrograms));
  // builder_ranks is rebuilt by any test's percentiles() run, so the rank is read, not fixed.
  assert.match(first.show_to_builder.split('\n')[0], new RegExp(`^Score 35(, top \\d+%)?\\. earnkit\\.com/b/s${id}$`), 'first ask: no change line');
  await scoreRow(id, '2026-10-11', 41, parts(40));
  const second = await withEnv({ EARNKIT_EVENT_LOG: 'on' }, () => scoreReply({ installationId: id }, NOW, noPrograms));
  const lines = second.show_to_builder.split('\n');
  assert.match(lines[0], new RegExp(`^Score 41(, top \\d+%)?, up 6 since you last asked\\. earnkit\\.com/b/s${id}$`));
  assert.match(lines[1], /^Users \+\d+\.$/);
  assert.equal(lines[2], MORE_USERS_LINE);
  assert.equal(second.score, 41);
  assert.equal(typeof second.percentile, 'number');
  const ev = await viewed(id);
  assert.deepEqual(ev.map((e) => e.detail.score), [35, 41]);
  // Held today at 90: the reply still says 41 and that the newest is in review.
  await scoreRow(id, '2026-10-12', 90, parts(500), true);
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${id}`;
  const held = await scoreReply({ installationId: id }, NOW, noPrograms);
  assert.match(held.show_to_builder, /^Score 41(, top \d+%)?\. earnkit\.com\/b\/s\d+\nYour newest score is in a quick review\./);
  assert.doesNotMatch(held.show_to_builder, /\b90\b/);
  assert.equal(held.score, 41);
});

test('8.10 with the event log off the change is over 7 days', dbTest, async () => {
  const id = T + 3;
  await profile(id);
  await source(id, 'site', 'https://lee.example.com', 'verified', 'earnkit_txt');
  await scoreRow(id, '2026-10-03', 30, parts(25));
  await scoreRow(id, '2026-10-11', 41, parts(40));
  const r = await scoreReply({ installationId: id }, NOW, noPrograms);
  assert.match(r.show_to_builder, /^Score 41(, top \d+%)?, up 11 this week\. /);
});

test('8.11 a repo-linked site gets its earnkit.txt line; a program on the top project\'s chain names its prize', dbTest, async () => {
  const id = T + 4;
  await profile(id);
  await source(id, 'repo', `lee${T}/app`, 'verified', 'repo_owner', `lee${T}/app`);
  await source(id, 'site', 'https://app.lee.dev', 'verified', 'repo_link', `lee${T}/app`);
  await source(id, 'contract', `arc:0x${'a'.repeat(40)}`, 'verified', 'deployer', `lee${T}/app`);
  await scoreRow(id, '2026-10-11', 52, parts(500), false, { key: `lee${T}/app`, title: 'app', users: 500, money_usd: 0 });
  const programs: ScoreProgram[] = [
    { title: 'Base Grants', summary: '$5k · closes Oct 30', chains: ['base'], investment: false, earnkit_campaign: false, starts_at: null },
    { title: 'Arc Hard', summary: '1 ETH', chains: ['arc'], investment: false, earnkit_campaign: false, starts_at: null, agent_completable: false },
    { title: 'Arc Fund', summary: 'up to $1M', chains: ['arc'], investment: true, earnkit_campaign: false, starts_at: null },
    { title: 'Arc Microgrants', summary: '500 USDC × 20 grants · rolling', chains: ['arc'], investment: false, earnkit_campaign: false, starts_at: null },
  ];
  const r = await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => scoreReply({ installationId: id }, NOW, { programs: async () => programs }));
  const lines = r.show_to_builder.split('\n');
  // Money first; never the investment program; never the one the agent can't complete.
  assert.equal(lines.at(-2), 'Arc Microgrants fits you: 500 USDC × 20 grants.');
  assert.equal(lines.at(-1), SITE_TXT_LINE);
  assert.deepEqual(r.proof_line, [{ site: 'https://app.lee.dev', line: `profile: ${profileCode(id, 'https://app.lee.dev', SECRET)}` }]);
  assert.equal((r.show_to_builder.match(/\?/g) ?? []).length, 1);
});

test('8.12 (v2.12.1 S9) discovery no longer reads earnkit.txt: a repo-linked site keeps its repo_link proof', dbTest, async () => {
  const id = T + 5;
  await profile(id);
  await source(id, 'site', 'https://app.lee.dev', 'verified', 'repo_link', `lee${T}/app`);
  await source(id, 'site', `https://lee${T}.github.io/app/`, 'verified', 'repo_link', `lee${T}/app`);
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'local_repo')`;
  const read: string[] = [];
  const no = async () => {
    throw new Error('unexpected');
  };
  const reader: ReaderDeps = {
    gh: no, ghGraphql: no, tokenTransfers: no, probe: no, json: no, baseTxs: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, now: NOW,
    fetchText: async (url) => {
      read.push(url);
      if (url === 'https://app.lee.dev/earnkit.txt') return `profile: ${profileCode(id, 'https://app.lee.dev', SECRET)}\n`;
      throw new Error('not found');
    },
  };
  await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => discover(NOW, { deadline: Date.now() + 30_000, reader, login: async () => null, only: [id] }));
  assert.deepEqual(read, []);
  const rows = await sql()<{ ref: string; proof: string }[]>`SELECT ref, proof FROM builder_sources WHERE builder_id = ${id} ORDER BY id`;
  assert.deepEqual(rows.map((r) => r.proof), ['repo_link', 'repo_link']);
  assert.equal(siteShowsUse({ ...rows[0], project_key: `lee${T}/app` }), false);
});

test('8.13 a public score that fell to 0 gets its fill step, not the review line; a newer held score adds the review line', dbTest, async () => {
  const id = T + 6;
  await profile(id);
  await scoreRow(id, '2026-10-09', 20, parts(10));
  await scoreRow(id, '2026-10-10', 0, parts(0));
  const r = await scoreReply({ installationId: id }, NOW, noPrograms);
  assert.equal(r.show_to_builder, `${FILL_LINES.no_github.ask}\nearnkit.com/b/s${id}`);
  assert.equal(r.agent_note, SCORE_NOTES.siteUnknown);
  // A newer score in review (the profile flag not set yet): the review line, then the fill step.
  await scoreRow(id, '2026-10-11', 50, parts(30), true);
  const held = await scoreReply({ installationId: id }, NOW, noPrograms);
  assert.equal(held.show_to_builder, `${HELD_LINE}\n${FILL_LINES.no_github.ask}\nearnkit.com/b/s${id}`);
  assert.doesNotMatch(held.show_to_builder, /\b50\b/);
});

test('8.14 a new proposed site is never crowded out by unproven linked sites: the score tool offers its line first (v2.12.1 S9: discovery reads no earnkit.txt)', dbTest, async () => {
  const id = T + 7;
  await profile(id);
  for (let i = 0; i < 5; i++) await source(id, 'site', `https://l${i}.lee.dev`, 'verified', 'repo_link', `lee${T}/app`);
  await source(id, 'site', 'https://new.lee.dev', 'proposed');
  await scoreRow(id, '2026-10-11', 52, parts(500), false, { key: `lee${T}/app`, title: 'app', users: 500, money_usd: 0 });
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'local_repo')`;
  const read: string[] = [];
  const no = async () => {
    throw new Error('unexpected');
  };
  const reader: ReaderDeps = {
    gh: no, ghGraphql: no, tokenTransfers: no, probe: no, json: no, baseTxs: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, now: NOW,
    fetchText: async (url) => {
      read.push(url);
      throw new Error('not found');
    },
  };
  await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => discover(NOW, { deadline: Date.now() + 30_000, reader, login: async () => null, only: [id] }));
  assert.deepEqual(read, []);
  const r = await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => scoreReply({ installationId: id }, NOW, noPrograms));
  assert.deepEqual(r.proof_line?.map((x) => ('site' in x ? x.site : x.repo)), ['https://new.lee.dev', 'https://l0.lee.dev', 'https://l1.lee.dev', 'https://l2.lee.dev', 'https://l3.lee.dev']);
});

test('9.7 find\'s second line: the score line, else the fill step (declarative when line 1 asks), else nothing', () => {
  assert.equal(youLine({ score: 41, percentile: 78, slug: 'lee' }), 'You: score 41, top 22%. earnkit.com/b/lee');
  assert.equal(youLine({ score: 41, percentile: 78, slug: 'lee', hidden: true }), 'You: score 41, top 22%.');
  const profile = { slug: 'lee' };
  assert.equal(secondLine({ profile, score: { score: 41, percentile: 78 }, missing: null, lineOneAsks: true }), 'You: score 41, top 22%. earnkit.com/b/lee');
  assert.equal(secondLine({ profile, score: null, missing: 'ownership_unproven', lineOneAsks: false }), FILL_LINES.ownership_unproven.ask);
  assert.equal(secondLine({ profile, score: null, missing: 'ownership_unproven', lineOneAsks: true }), FILL_LINES.ownership_unproven.say);
  assert.doesNotMatch(FILL_LINES.ownership_unproven.say, /\?/);
  assert.equal(secondLine({ profile, score: null, missing: null, lineOneAsks: false }), null);
  assert.equal(secondLine({ profile: null, score: { score: 41, percentile: 78 }, missing: null, lineOneAsks: false }), null);
});

test('9.8 listPrograms carries agent_completable, so the score tool never names a program the agent cannot complete', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const hard = { ...committedProgram('colosseum-worlds-fair'), id: `t9s-col-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  const easy = { ...committedProgram('arc-microgrants'), id: `t9s-arc-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(hard));
  await upsertProgram(ProgramFile.parse(easy));
  const cards = await listPrograms();
  assert.equal(cards.find((c) => c.id === hard.id)?.agent_completable, false);
  assert.equal(cards.find((c) => c.id === easy.id)?.agent_completable, true);
  await sql()`UPDATE programs SET status = 'closed' WHERE id IN (${hard.id}, ${easy.id})`;
});

test('9.9 odds read the public score\'s top project: its verified users and money, for that repo only, never a held score', dbTest, async () => {
  const id = T + 15;
  await profile(id);
  await scoreRow(id, '2026-10-10', 30, parts(60), false, { key: `Lee${T}/App`, title: 'app', users: 60, money_usd: 600 });
  await scoreRow(id, '2026-10-11', 90, parts(500), true, { key: `lee${T}/app`, title: 'app', users: 900, money_usd: 9000 });
  assert.deepEqual(await verifiedProject(id, `lee${T}/app`), { users: 60, money_usd: 600 });
  assert.equal(await verifiedProject(id, `lee${T}/other`), null);
  assert.equal(await verifiedProject(T + 16, `lee${T}/app`), null, 'no score: v2.10 traction');
});

test('9.10 the token pitch: flag off always; on, a public score of 20 or more and nothing held', dbTest, async () => {
  const [low, ok, held] = [T + 17, T + 18, T + 19];
  await profile(low);
  await scoreRow(low, '2026-10-11', 19, parts(10));
  await profile(ok);
  await scoreRow(ok, '2026-10-11', 20, parts(10));
  await profile(held, { held: true });
  await scoreRow(held, '2026-10-10', 45, parts(30));
  await scoreRow(held, '2026-10-11', 90, parts(500), true);
  assert.deepEqual([await pitchAllowed(low), await pitchAllowed(ok), await pitchAllowed(held), await pitchAllowed(T + 16)], [true, true, true, true]);
  await withEnv({ EARNKIT_BUILDER_SCORE: 'on' }, async () => {
    assert.deepEqual([await pitchAllowed(low), await pitchAllowed(ok), await pitchAllowed(held), await pitchAllowed(T + 16)], [false, true, false, false]);
  });
});
