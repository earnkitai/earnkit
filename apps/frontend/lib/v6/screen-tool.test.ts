import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { mcpCall } from '../v5/fixtures/mcp-call';
import { programFixture } from '../v5/fixtures/program';
import { connectInstallation, saveInstallation } from '../v5/installations';
import { upsertProgram } from '../v5/programs';
import { windowStart } from '../v5/rate-limit';
import { linkInstallation, saveRecord, upsertBuilder } from './builders';
import { type Evidence, type Row } from './evidence';
import { evidence, liveRows } from './fixtures/evidence-builder';
import { EMPTY_RECORD } from './record';
import { addReviewer } from './reviewers';
import { workQueue } from './screen-worker';

after(() => sql().end());

const NOW = new Date('2026-11-06T12:00:00Z');
const PITCH = 'The secret pitch text that names a payments app for coffee shops on Base mainnet today';
let gh = 930_000;
async function linked() {
  const token = 'screen-' + Math.random();
  await saveInstallation(token, 'Program Agent');
  const inst = await connectInstallation(token);
  const b = await upsertBuilder({ github_id: ++gh, login: 'scr' + gh, name: null, avatar_url: null }, NOW);
  await linkInstallation(inst!.id, b.id, NOW);
  return { installationId: inst!.id, builderId: b.id, login: b.login, now: NOW };
}
async function reviewerOf(programId: string) {
  await upsertProgram(programFixture({ id: programId, title: `Grants ${programId}` }), 'file', NOW);
  const c = await linked();
  assert.deepEqual(await addReviewer(programId, c.login, null), { ok: true, builder_id: c.builderId });
  return c;
}
const APPLICANTS = [
  { ref: 'r-1', name: 'Coffee Pay', repo_url: 'https://github.com/acme/coffee', pitch: PITCH },
  { ref: 'r-2', name: 'Site Only', live_url: 'https://site.example/' },
];
/** A read with a record row and a site row: the record row must never reach a program. */
const fake = async (): Promise<Evidence> => {
  const e = evidence({ live: liveRows({ url: 'https://site.example/', url_ok: true }) });
  const leak: Row = { key: 'person.name', value: 'Ada', basis: 'record', read_at: NOW.toISOString(), note: null };
  return { ...e, rows: [leak] };
};

test('screen needs a reviewer: unlinked and linked non-reviewer each answer one line, and nothing is written', async () => {
  const token = 'screen-unlinked-' + Math.random();
  await saveInstallation(token, 'Agent');
  const inst = await connectInstallation(token);
  await upsertProgram(programFixture({ id: 'scr-none' }), 'file', NOW);
  const u = await mcpCall({ installationId: inst!.id, builderId: null, now: NOW }, 'screen', { program_id: 'scr-none', applicants: APPLICANTS });
  assert.equal(u.isError, false, u.text);
  assert.equal(u.reply!.show_to_builder, 'Sign in first; the owner then marks you as a reviewer for your program.');
  const c = await linked();
  const n = await mcpCall(c, 'screen', { program_id: 'scr-none', applicants: APPLICANTS });
  assert.equal(n.reply!.show_to_builder, 'You are not a reviewer for that program here; ask the EarnKit owner.');
  assert.equal('job_id' in n.reply!, false);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM screen_jobs`)[0].n, 0);
  // A refused non-reviewer never counts against the daily limit.
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = ${`screenJobs:b:${c.builderId}`}`).length, 0);
});

test('a reviewer queues a job and gets job_id; the eleventh screen in a day is refused', async () => {
  const c = await reviewerOf('scr-queue');
  const r = await mcpCall(c, 'screen', { program_id: 'scr-queue', applicants: APPLICANTS });
  assert.equal(r.isError, false, r.text);
  assert.match(r.reply!.job_id as string, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(r.reply!.show_to_builder, 'Queued 2 applicants for Grants scr-queue; 0 already read. Results by tomorrow morning, or sooner when EarnKit runs the queue.');
  assert.equal(r.reply!.agent_note, 'Call screen with job_id for progress and results. Tell the builder what each tier means: used, live, building, unverified, flagged.');
  const [w] = await sql()`SELECT count FROM rate_windows WHERE key = ${`screenJobs:b:${c.builderId}`} AND window_start = ${windowStart(NOW, 86_400_000)}`;
  assert.equal(w.count, 1);
  await sql()`UPDATE rate_windows SET count = 9 WHERE key = ${`screenJobs:b:${c.builderId}`} AND window_start = ${windowStart(NOW, 86_400_000)}`;
  const tenth = await mcpCall(c, 'screen', { program_id: 'scr-queue', applicants: APPLICANTS });
  assert.ok(tenth.reply!.job_id, tenth.text);
  const over = await mcpCall(c, 'screen', { program_id: 'scr-queue', applicants: APPLICANTS });
  assert.equal(over.reply!.show_to_builder, 'Ten screens a day is the limit here.');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM screen_jobs WHERE builder_id = ${c.builderId}`)[0].n, 2);
});

test('results carry public evidence only; outcomes record', async () => {
  // The earlier test's screen of the same repo would count too.
  await sql()`DELETE FROM screen_applicants`;
  const c = await reviewerOf('scr-results');
  const other = await reviewerOf('scr-other-program');
  // Another program screened the same repo first: the count shows, its id never does.
  await mcpCall(other, 'screen', { program_id: 'scr-other-program', applicants: [{ ref: 'z', name: 'Coffee Pay', repo_url: 'https://github.com/acme/coffee', pitch: 'Their own words about another thing.' }] });
  await workQueue({ now: NOW, limit: 10, deps: { evidence: fake } });
  // A builder with a record on the same repo: nothing of theirs reaches the program.
  const b = await upsertBuilder({ github_id: ++gh, login: 'own' + gh, name: 'Ada', avatar_url: null }, NOW);
  await saveRecord(b.id, { ...EMPTY_RECORD, person: { name: 'Ada Secret' }, projects: [{ id: 'p', repo_url: 'https://github.com/acme/coffee', answers: { problem: { text: 'Hidden answer', written_by: 'builder' } } }] }, NOW);

  const q = await mcpCall(c, 'screen', { program_id: 'scr-results', applicants: APPLICANTS });
  const jobId = q.reply!.job_id as string;
  const pending = await mcpCall(c, 'screen', { job_id: jobId });
  assert.equal(pending.reply!.show_to_builder, '2 applicants: 0 used, 0 live, 0 building, 0 unverified, 0 flagged; 2 pending.');
  await workQueue({ now: NOW, limit: 10, deps: { evidence: fake } });
  const r = await mcpCall(c, 'screen', { job_id: jobId });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.show_to_builder, '2 applicants: 0 used, 2 live, 0 building, 0 unverified, 0 flagged; 0 pending.');
  assert.equal(r.reply!.agent_note, 'Sort: used, then live, then building; flagged last with the rule named.');
  const results = r.reply!.results as { finished: boolean; applicants: { ref: string; because: string[]; rows: Row[] }[] };
  assert.equal(results.finished, true);
  const s = JSON.stringify(results);
  assert.ok(!s.includes('pitch') && !s.includes('secret pitch'), s);
  assert.ok(!s.includes('scr-other-program'), s);
  assert.ok(!s.includes('person.') && !s.includes('"answers"') && !s.includes('Ada'), s);
  assert.ok(results.applicants.every((a) => a.rows.every((x) => x.basis !== 'record')));
  assert.ok(results.applicants.find((a) => a.ref === 'r-1')!.because.includes('seen in 1 other screen in 90 days'));
  const nosy = await mcpCall(other, 'screen', { job_id: jobId });
  assert.equal(nosy.reply!.show_to_builder, 'No screen with that id here.');
  assert.equal('results' in nosy.reply!, false);

  const o = await mcpCall(c, 'screen', { job_id: jobId, outcomes: [{ ref: 'r-1', outcome: 'won', amount_usd: 2000 }, { ref: 'r-2', outcome: 'rejected' }] });
  assert.equal(o.reply!.show_to_builder, 'Recorded 2 outcomes.');
  assert.equal(o.reply!.recorded, 2);
  const late = await mcpCall({ ...c, now: new Date(NOW.getTime() + 31 * 86_400_000) }, 'screen', { job_id: jobId });
  assert.equal(late.reply!.show_to_builder, 'That screen has expired; queue the list again.');
});
