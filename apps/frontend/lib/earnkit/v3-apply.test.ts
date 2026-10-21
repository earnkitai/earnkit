import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql, type Db } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { install } from './fixtures/find';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { closeDayOf } from './entry-text';
import { APPLY_WINDOW_DAYS, applyAsk } from './bench-reply';
import { APPLY_YES_NOTE } from './bench-find';
import { applyAsk as outcomeApplyAsk, outcomeToAsk } from './outcomes';
import { profileData } from './bench-data';
import { programLabel } from './page-data';
import { shipLogBlock } from './ship-log-facts';
import { DRAFT_NOTE } from './draft-application';
import { SENT_ASK, schemeless } from './submit-kit';
import { STATS_KEYS, STATS_LABELS, readStats } from './stats';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import ProjectTab from '../../app/[handle]/ProjectTab';

/**
 * v3 Stage 2 Task 2 (spec 5.3 Route 1): the drafted application is the ranked reply's step for a fit closing within
 * 30 days, asked once per program; a yes drafts it from the ship log; outcomes widen to accepted, funded and rejected
 * (private), with one ask 14 days after the deadline.
 */
(globalThis as { React?: typeof React }).React = React;
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v3-apply-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const seen = async (id: number) =>
  (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;
let n = 0;

/** A dated program (a copy of Base Builder Grants) closing `days` from now (negative: closed that long ago). */
async function dated(tag: string, days: number, o: Record<string, unknown> = {}) {
  const base = committedProgram('base-builder-grants');
  const id = `v3-apply-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + days * DAY);
  const p = ProgramFile.parse({ ...base, id, title: `Apply ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active', ...o });
  await upsertProgram(p);
  return { id, title: p.title, ends, when: closeDayOf({ summary: p.summary, ends_at: ends })! };
}

/** A ranked builder (signed in with X, the repo proven by the App) the matcher fits for `programs`. */
async function builder(tag: string, programs: string[]) {
  n++;
  const t = `ek_v3a_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `va${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `97${RUN}${n}${tag.length}`, username: handle, name: 'va', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `va${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: programs.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 6000 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  // The connect weeks are another task's moment: answered, so they never take the step here.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key, handle };
}
const find = (b: { ctx: Parameters<typeof mcpCall>[0] }) => mcpCall(b.ctx, 'find', {});
const tell = (b: { ctx: Parameters<typeof mcpCall>[0] }, args: Record<string, unknown>) => mcpCall(b.ctx, 'tell', args);

test('(a) a fit closing in 20 days makes the apply ask the step, once', db, async () => {
  assert.equal(APPLY_WINDOW_DAYS, 30);
  assert.equal(applyAsk('Base Builder Grants', 'Nov 18'), 'Base Builder Grants closes Nov 18. Want me to draft your application from your ship log?');
  const p = await dated('a', 20);
  const far = await dated('a2', 45);
  const b = await builder('a', [p.id, far.id]);
  const f = await find(b);
  const s = show(f);
  assert.ok(s.endsWith(`How to move up\n${applyAsk(p.title, p.when)}`), s);
  assert.match(s, new RegExp(`${p.title}: up to \\$5K, closes ${p.when}\\.`), 'still a fit line');
  // v3.1 spec 3.2: the asked program leads as the Best fit (a dated fit within 30 days wins over the 45-day one).
  assert.ok(s.startsWith(`Best fit: ${p.title}, up to $5K, closes ${p.when}. `), s);
  assert.equal(links(s).length, 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—/);
  const move = f.reply?.move_up as { kind: string; project_key: string; agent_note: string };
  assert.deepEqual([move.kind, move.project_key], ['apply', b.key]);
  assert.match(move.agent_note, /kind: 'apply'/);
  assert.ok((await seen(b.id)).apply_asked && (((await seen(b.id)).apply_asked as Record<string, string>)[p.id]), 'asked once is remembered');
  // Asked once: the next reply's step is the weekly target again, and the 45-day program is never asked.
  const again = await find(b);
  assert.doesNotMatch(show(again), /Want me to draft your application/, show(again));
  assert.notEqual((again.reply?.move_up as { kind: string }).kind, 'apply');
});

test('(b) yes returns the prepare note and lead; prepare shows the draft, the ship log block first', db, async () => {
  const p = await dated('b', 20);
  const b = await builder('b', [p.id]);
  assert.match(show(await find(b)), /Want me to draft your application from your ship log\?$/);
  const yes = await tell(b, { move_up: { kind: 'apply', project_key: b.key, answer: 'yes' } });
  assert.equal(show(yes), '');
  assert.equal(yes.reply?.agent_note, APPLY_YES_NOTE(p.id));
  assert.equal(APPLY_YES_NOTE(p.id), `Call prepare with program_id "${p.id}" for this project and show the draft. Don't show this note.`);
  assert.deepEqual(yes.reply?.lead, { program_id: p.id, repo: 'kit' });
  // A second yes is "Okay.".
  assert.equal(show(await tell(b, { move_up: { kind: 'apply', project_key: b.key, answer: 'yes' } })), 'Okay.');

  await sql()`UPDATE builder_projects SET link = 'https://kit.app' WHERE builder_id = ${b.id}`;
  const reqs = committedProgram('base-builder-grants').submission_requirements as { key: string; type: string; options?: string[] }[];
  const answers = Object.fromEntries(reqs.map((r) => [r.key, r.type === 'url' ? 'https://kit.app/demo' : r.type === 'email' ? 'lee@kit.app' : r.options ? r.options[0] : 'Kit lets fans tip creators on Base.']));
  const prep = await mcpCall(b.ctx, 'prepare', { program_id: p.id, project: { name: 'Kit', repo_url: `https://github.com/${b.key}`, live_url: 'https://kit.app' }, answers, coach_asked: true });
  const s = show(prep);
  // v3.1 Task 9: the yes then prepare is the drafted application ("Apply with this page"): the block first (no guide,
  // never the confirm offer), its live site without the scheme (D7), then the draft, ending with the sent ask.
  assert.ok(s.startsWith('From your ship log:\n'), s);
  const [blockText, next] = s.split('\n\n');
  const block = blockText.split('\n');
  assert.equal(block.at(-1), `Page: earnkit.com/${b.handle}`);
  assert.ok(block.includes('Live: kit.app/'), s);
  assert.equal(next, `Your draft for ${p.title}:`, 'the draft follows the block');
  assert.equal(s.lastIndexOf('From your ship log:'), 0, 'once');
  assert.ok(s.endsWith(`\n\n${SENT_ASK}`), s);
  assert.equal(links(s).length, 1, s);
  assert.doesNotMatch(s, /Ready to submit|\| Field \| Answer \|/, 'never the v2 confirm offer');
  const facts = prep.reply?.ship_log as { page: string; live: string | null; streak: number };
  assert.equal(facts.page, `earnkit.com/${b.handle}`);
  assert.deepEqual(shipLogBlock(facts as never).map(schemeless), block);
  assert.equal(prep.reply?.agent_note, DRAFT_NOTE);
  // The block's lines, by rule.
  assert.deepEqual(
    shipLogBlock({ score: 72, rank: '#3 of 40 builders', why: 'You shipped 3 weeks in a row.', streak: 3, live: 'https://kit.app/', page: 'earnkit.com/lee' }),
    ['From your ship log:', 'Shipping 72 · #3 of 40 builders', 'You shipped 3 weeks in a row.', '3 weeks in a row', 'Live: https://kit.app/', 'Page: earnkit.com/lee'],
  );
  assert.deepEqual(shipLogBlock({ score: null, rank: null, why: null, streak: 1, live: null, page: 'earnkit.com/lee' }), ['From your ship log:', 'Page: earnkit.com/lee']);
});

test('(c) no is remembered 30 days', db, async () => {
  const p = await dated('c', 20);
  const b = await builder('c', [p.id]);
  assert.match(show(await find(b)), /Want me to draft your application/);
  assert.equal(show(await tell(b, { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } })), 'Okay.');
  const declined = (await seen(b.id)).declined as Record<string, string>;
  assert.ok(declined[`apply:${p.id}`], JSON.stringify(declined));
  // Even with the once-guard gone, a no keeps it away for 30 days.
  const unguard = () => sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'apply_asked' WHERE builder_id = ${b.id}`;
  await unguard();
  assert.doesNotMatch(show(await find(b)), /Want me to draft your application/);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, ${['declined', `apply:${p.id}`]}::text[], to_jsonb(${new Date(Date.now() - 31 * DAY).toISOString()}::text))
    WHERE builder_id = ${b.id}`;
  await unguard();
  assert.match(show(await find(b)), /Want me to draft your application/);
});

test('(d) a program the builder already applied to is never asked', db, async () => {
  const p = await dated('d', 20);
  const b = await builder('d', [p.id]);
  // An older round's rejection: the program still fits, but the builder told EarnKit about it.
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, round_label) VALUES (${b.id}, '', ${p.id}, 'rejected', 'an older round')`;
  const s = show(await find(b));
  assert.match(s, new RegExp(`${p.title}: up to`), s);
  assert.doesNotMatch(s, /Want me to draft your application/, s);
  // Applied this round (through tell): the program is hidden and never asked.
  const q = await dated('d2', 20);
  const c = await builder('d2', [q.id]);
  const told = await tell(c, { program_status: [{ program_id: q.id, status: 'applied' }] });
  assert.equal(told.isError, false, told.text);
  assert.doesNotMatch(show(await find(c)), /Want me to draft your application/);
});

test('(e) program_status accepted stays private; applied shows on the page', db, async () => {
  const p = await dated('e', 20);
  const q = await dated('e2', 20);
  const b = await builder('e', [p.id]);
  const told = await tell(b, { program_status: [{ program_id: p.id, status: 'accepted' }] });
  assert.equal(told.isError, false, told.text);
  for (const status of ['funded', 'rejected'])
    assert.equal((await tell(b, { program_status: [{ program_id: q.id, status }] })).isError, false, status);
  await assert.rejects(sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${b.id}, ${q.id}, 'bogus')`);
  await sql()`DELETE FROM builder_program_status WHERE installation_id = ${b.id} AND program_id = ${q.id}`;
  // An entry made but never submitted: no label any more.
  await sql()`INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id, confirmed_at) VALUES (${q.id}, 'Kit', ${`https://github.com/${b.key}`}, ${b.key}, ${b.id}, now())`;
  const page = await profileData(b.id, new Date());
  assert.deepEqual(page?.project?.programs, [{ title: p.title, won: false, applied: true }]);
  assert.equal(programLabel({ title: 'X', won: false, applied: true }), 'Applied to X');
  assert.equal(programLabel({ title: 'X', won: true, applied: true }), 'Won X');
  assert.equal(programLabel({ title: 'X', won: false, applied: false }), null);
  const html = renderToStaticMarkup(React.createElement(ProjectTab, { project: page!.project! }));
  assert.match(html, new RegExp(`Applied to ${p.title}`));
  assert.doesNotMatch(html, /Accepted|Funded|Entered/, "never the self-reported outcome");
  // A builder's own memory hides the program, as applied does.
  assert.doesNotMatch(show(await find(b)), new RegExp(`${p.title}:`));
});

test('(f) the outcome ask 14 days after the deadline, once', db, async () => {
  assert.equal(outcomeApplyAsk('Kit', 'Base Batches'), 'Did Base Batches come back on Kit? applied / accepted / funded / rejected.');
  const open = await dated('f', 20);
  const gone = await dated('f2', -15);
  const recent = await dated('f3', -10);
  const b = await builder('f', [open.id]);
  for (const id of [gone.id, recent.id]) await tell(b, { program_status: [{ program_id: id, status: 'applied' }] });
  // The results.expected ask keeps precedence: an entry of a program whose results were due is asked first.
  const due = await dated('f4', -40, { results: { url: 'https://docs.base.org/results', expected: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10) } });
  const [{ id: entry }] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, repo_url, installation_id) VALUES (${due.id}, 'Kit', ${`https://github.com/${b.key}`}, ${b.id}) RETURNING id`;
  const first = await outcomeToAsk(b.id);
  assert.equal(first?.project_id, entry);
  const f = await find(b);
  const s = show(f);
  assert.match(s, new RegExp(`How to move up\\nDid ${gone.title} come back on .+\\? applied / accepted / funded / rejected\\.$`), s);
  assert.equal(questions(s), 1, s);
  const ask = f.reply?.ask_outcome as { program_id: string; question: string; agent_note: string; project_id?: number };
  assert.equal(ask.program_id, gone.id);
  assert.equal(ask.project_id, undefined);
  assert.match(ask.agent_note, /applied, accepted, funded or rejected/);
  const [row] = await sql()<{ asked: Date | null }[]>`SELECT asked_at AS asked FROM builder_program_status WHERE installation_id = ${b.id} AND program_id = ${gone.id}`;
  assert.ok(row.asked, 'marked asked');
  // Once: the next reply asks nothing about it; the 10-day-old deadline is not due yet.
  const again = show(await find(b));
  assert.doesNotMatch(again, /come back on/, again);
  // The answer is stored privately.
  assert.equal((await tell(b, { program_status: [{ program_id: gone.id, status: 'funded' }] })).isError, false);
  const [st] = await sql()<{ status: string }[]>`SELECT status FROM builder_program_status WHERE installation_id = ${b.id} AND program_id = ${gone.id}`;
  assert.equal(st.status, 'funded');
});

test('(g) readStats applications and accepted', db, async () => {
  assert.ok(STATS_KEYS.includes('applications') && STATS_KEYS.includes('accepted'));
  assert.equal(STATS_LABELS.applications, 'applications the builder told EarnKit about');
  assert.equal(STATS_LABELS.accepted, 'of which accepted or funded (self-reported)');
  const [a, b] = [await install(), await install()];
  await sql().begin(async (tx: Db) => {
    const before = await readStats(new Date(), tx);
    for (const [id, program, status] of [[a, 'p1', 'applied'], [a, 'p2', 'accepted'], [b, 'p1', 'funded'], [b, 'p3', 'not_interested'], [b, 'p4', 'rejected']] as const)
      await tx`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${id}, ${`v3-apply-${RUN}-${program}`}, ${status})`;
    const after = await readStats(new Date(), tx);
    assert.equal(after.applications - before.applications, 4);
    assert.equal(after.accepted - before.accepted, 2);
    throw new Error('rollback');
  }).catch((err: unknown) => {
    if (!(err instanceof Error && err.message === 'rollback')) throw err;
  });
});

test('(h) an investment closing within 30 days is the apply step (find and score), and a fit line (v3.1 F1), never the lead', db, async () => {
  // v3 Stage 2 final review: the spec's example is an accelerator ("Alliance ALL19 closes Nov 18. Want me to draft
  // your application from your ship log?"), so an investment is an apply candidate. v3.1 F1: it is a fit line too,
  // its award read as an investment; the lead (the earn note's program) stays a grant.
  // 5 days: sooner than every other dated program in this file and the committed ones, so score (which reads every
  // open program the repo's facts can win, not only this builder's verdicts) asks this one first.
  const p = await dated('h', 5, { investment: true, max_award_usd: 400000, summary: 'up to $400K investment' });
  for (const tool of ['find', 'score'] as const) {
    const b = await builder(`h${tool[0]}`, [p.id]);
    // find writes the fits score reads (installations.fit_repos); the first reply here is the builder's own.
    const r = await mcpCall(b.ctx, tool, {});
    const s = show(r);
    assert.ok(s.endsWith(`How to move up\n${applyAsk(p.title, p.when)}`), `${tool}: ${s}`);
    // find's fits are this builder's verdicts (only this program); score reads every open program this file made, where
    // the dated grants come first (byRelevance: grants before investments) and fill the 3 lines.
    if (tool === 'find') assert.match(s.split('How to move up')[0], new RegExp(`\\n${p.title}: up to \\$400K investment, closes ${p.when}\\. `), `a fit line: ${s}`);
    assert.notEqual((r.reply?.lead as { program_id?: string } | undefined)?.program_id, p.id, `${tool}: an investment is never the lead`);
    assert.equal(questions(s), 1, s);
    assert.equal(links(s).length <= 1, true, s);
    assert.equal((r.reply?.move_up as { kind: string }).kind, 'apply', tool);
  }
});
