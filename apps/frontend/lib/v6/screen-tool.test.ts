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
import { SCREEN_BATCH, workQueue } from './screen-worker';

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
  assert.equal(u.reply!.show_to_builder, 'Sign in first, then ask EarnKit to add you as a reviewer for your program.');
  const c = await linked();
  const n = await mcpCall(c, 'screen', { program_id: 'scr-none', applicants: APPLICANTS });
  assert.equal(n.reply!.show_to_builder, 'You are not yet a reviewer for that program here. Ask EarnKit to add you.');
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
  assert.equal(r.reply!.show_to_builder, 'Queued 2 applicants for Grants scr-queue; 0 already read. Results by tomorrow morning.');
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
  // Nothing about whether a builder's ledger was reached: a builder's ledger never reaches a program.
  assert.equal(o.reply!.show_to_builder, 'Recorded 2 outcomes.');
  assert.equal(o.reply!.agent_note, 'Tell the builder the outcomes are recorded.');
  assert.equal(o.reply!.recorded, 2);
  assert.doesNotMatch(JSON.stringify(o.reply), /ledger/i);
  const one = await mcpCall(c, 'screen', { job_id: jobId, outcomes: [{ ref: 'r-2', outcome: 'won' }] });
  assert.equal(one.reply!.show_to_builder, 'Recorded 1 outcome.');
  assert.doesNotMatch(JSON.stringify(one.reply), /ledger|usable/i);
  const late = await mcpCall({ ...c, now: new Date(NOW.getTime() + 31 * 86_400_000) }, 'screen', { job_id: jobId });
  assert.equal(late.reply!.show_to_builder, 'That screen has expired; queue the list again.');
});

test('R7 screen unlinked with sign-in configured: the installation link, one line ending with a full stop', async () => {
  const keys = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'EARNKIT_URL', 'EARNKIT_AUTH_SECRET'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_URL: 'https://earnkit.test/', EARNKIT_AUTH_SECRET: 'screen-test-secret' });
  try {
    const token = 'screen-unlinked-link-' + Math.random();
    await saveInstallation(token, 'Agent');
    const inst = await connectInstallation(token);
    const u = await mcpCall({ installationId: inst!.id, builderId: null, now: NOW }, 'screen', { program_id: 'scr-none', applicants: APPLICANTS });
    assert.equal(u.isError, false, u.text);
    const show = u.reply!.show_to_builder as string;
    assert.match(show, /^Sign in once at https:\/\/earnkit\.test\/link\/[A-Za-z0-9_-]{16,} so EarnKit knows which program you review for\.$/);
    assert.ok(!/owner/i.test(show), show);
    assert.equal((await sql()`SELECT count(*)::int AS n FROM link_codes WHERE installation_id = ${inst!.id}`)[0].n, 1);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('C35: input screen cannot read is its one line, the detail in the agent note, never a validation dump', async () => {
  const c = await linked();
  for (const args of [{ applicants: 'everyone' }, { job_id: 7 }, { outcomes: [{ ref: 'r', outcome: 'maybe' }] }, { extra: true }]) {
    const r = await mcpCall(c, 'screen', args);
    assert.equal(r.isError, false, r.text);
    assert.equal(r.reply!.show_to_builder, "I could not read that. Send the applicant list, or a screen's id for its results.");
    assert.match(r.reply!.agent_note as string, /^Nothing was queued\. /);
  }
  const u = await mcpCall({ ...c, builderId: null }, 'screen', { extra: true });
  assert.equal(u.reply!.show_to_builder, "I could not read that. Send the applicant list, or a screen's id for its results.");
});

test('C18: a signed-in builder who reviews no program, with no program named, is told so in one line', async () => {
  const c = await linked();
  for (const args of [{}, { applicants: APPLICANTS }]) {
    const r = await mcpCall(c, 'screen', args);
    assert.equal(r.isError, false, r.text);
    assert.equal(r.reply!.show_to_builder, 'You review no program yet.');
  }
});

test('C39: a threshold outside 0 to 100 is refused with one line and nothing is queued', async () => {
  const c = await reviewerOf('scr-thresh');
  for (const [k, v] of [['used_funded_senders', -5], ['push_within_days', 101]] as const) {
    const r = await mcpCall(c, 'screen', { program_id: 'scr-thresh', applicants: APPLICANTS, thresholds: { [k]: v } });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.reply!.show_to_builder, `Threshold ${k} must be from 0 to 100.`);
    assert.equal('job_id' in r.reply!, false);
  }
  const ok = await mcpCall(c, 'screen', { program_id: 'scr-thresh', applicants: APPLICANTS, thresholds: { used_funded_senders: 0, push_within_days: 100 } });
  assert.ok(ok.reply!.job_id, ok.text);
});

test('C19, C38: outcomes name the refs not found; a win over the program\'s cap is refused as the ledger refuses it', async () => {
  await upsertProgram(programFixture({ id: 'scr-out', title: 'Grants scr-out', max_award_usd: 5000 }), 'file', NOW);
  const c = await linked();
  assert.deepEqual(await addReviewer('scr-out', c.login, null), { ok: true, builder_id: c.builderId });
  const q = await mcpCall(c, 'screen', { program_id: 'scr-out', applicants: APPLICANTS });
  const jobId = q.reply!.job_id as string;
  const over = await mcpCall(c, 'screen', { job_id: jobId, outcomes: [{ ref: 'r-2', outcome: 'rejected' }, { ref: 'r-1', outcome: 'won', amount_usd: 5001 }] });
  assert.equal(over.reply!.show_to_builder, "That's more than this program pays; check the amount.");
  assert.equal((await sql()`SELECT count(*)::int AS n FROM screen_outcomes WHERE job_id = ${jobId}`)[0].n, 0);
  const r = await mcpCall(c, 'screen', { job_id: jobId, outcomes: [{ ref: 'r-1', outcome: 'won', amount_usd: 5000 }, { ref: 'zz', outcome: 'rejected' }, { ref: 'yy', outcome: 'shortlisted' }] });
  assert.equal(r.reply!.show_to_builder, 'Recorded 1 outcome; not found: zz and yy.');
  assert.equal(r.reply!.recorded, 1);
  const none = await mcpCall(c, 'screen', { job_id: jobId, outcomes: [{ ref: 'zz', outcome: 'rejected' }] });
  assert.equal(none.reply!.show_to_builder, 'Recorded 0 outcomes; not found: zz.');
});

test('B14: the promise counts the queue ahead against the daily run of SCREEN_BATCH', async () => {
  assert.equal(SCREEN_BATCH, 200);
  // No table cleared: these two jobs are written a day before every other test's, so only their own rows are ahead.
  const EARLY = new Date(NOW.getTime() - 86_400_000);
  const a = await reviewerOf('scr-big');
  const many = Array.from({ length: 200 }, (_, k) => ({ ref: `m-${k}`, name: `App ${k}` }));
  const first = await mcpCall({ ...a, now: EARLY }, 'screen', { program_id: 'scr-big', applicants: many });
  assert.equal(first.reply!.show_to_builder, 'Queued 200 applicants for Grants scr-big; 0 already read. Results by tomorrow morning.');
  const b = await reviewerOf('scr-after');
  const second = await mcpCall({ ...b, now: new Date(EARLY.getTime() + 60_000) }, 'screen', { program_id: 'scr-after', applicants: APPLICANTS });
  assert.equal(second.reply!.show_to_builder, 'Queued 2 applicants for Grants scr-after; 0 already read. 200 applicants ahead of yours; results within 2 days.');
});
