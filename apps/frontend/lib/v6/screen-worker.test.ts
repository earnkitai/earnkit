import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { replayFetch } from '../v5/fixtures/github';
import { programFixture } from '../v5/fixtures/program';
import { upsertProgram } from '../v5/programs';
import { readEvidence, type Evidence, type EvidenceDeps, type Subject } from './evidence';
import { blockscout } from './explorers';
import { evidence, liveRows } from './fixtures/evidence-builder';
import { replayExplorer } from './fixtures/explorer';
import { fakeRdap, fakeSite } from './fixtures/site';
import { createJob, jobResults } from './screen-jobs';
import { SCREEN_BATCH, SCREEN_TRIGGER_MAX, SCREEN_TRIGGER_MS, workQueue } from './screen-worker';

after(() => sql().end());
beforeEach(async () => {
  await sql()`DELETE FROM evidence_cache`;
  await sql()`DELETE FROM screen_applicants`;
  await sql()`DELETE FROM screen_jobs`;
});

const NOW = new Date('2026-11-06T12:00:00Z');
const BASE = 'https://base.blockscout.com/api/v2';
const FAST = { gapMs: 0, sleep: async () => {} };
const CONTRACT = '0x426e2ca323fa707bd1921eccce0a27ad7804b2a2';
const fakes = (): Partial<EvidenceDeps> => ({
  gh: replayFetch('../../../v6/fixtures/repos/onchain-reaction').fetch,
  explorer: (c, f) => (c === 'base' ? blockscout(BASE, f, FAST) : null),
  explorerFetch: replayExplorer('onchain-reaction').fetch,
  probe: fakeSite().probe,
  rdap: fakeRdap().rdap,
});
const queue = async (programId: string, applicants: Parameters<typeof createJob>[0]['applicants'], now = NOW) => {
  await upsertProgram(programFixture({ id: programId }), 'file', NOW);
  // The job belongs to the program; builder 1 reads it as one of its reviewers (L15-12).
  await sql()`INSERT INTO program_reviewers (program_id, builder_id) VALUES (${programId}, 1) ON CONFLICT DO NOTHING`;
  return createJob({ programId, builderId: 1, installationId: 1, applicants, now });
};

test('the batch sizes and the trigger cap', () => {
  assert.deepEqual([SCREEN_BATCH, SCREEN_TRIGGER_MAX, SCREEN_TRIGGER_MS], [200, 300, 600_000]);
});

test('workQueue reads a two-applicant job over the recorded fakes: tiers, because, public rows; a failing read is failed and the job still finishes', async () => {
  const j = await queue('work-a', [
    { ref: 'or', name: 'Onchain Reaction', repo_url: 'https://github.com/Shijas786/onchain-reaction', live_url: 'https://onchainreaction.vercel.app/', contracts: [{ chain: 'base', address: CONTRACT }] },
    { ref: 'bad', name: 'Broken', repo_url: 'https://github.com/acme/broken' },
  ]);
  const real = readEvidence;
  const out = await workQueue({
    now: NOW,
    limit: 10,
    deps: {
      ...fakes(),
      evidence: async (s: Subject, d: EvidenceDeps) => {
        if (s.repo_url?.includes('broken')) throw new TypeError('boom with private detail');
        return real(s, d);
      },
    },
  });
  assert.deepEqual(out, { read: 2, jobs_finished: [j.id] });
  const rows = await sql()`SELECT * FROM screen_applicants WHERE job_id = ${j.id} ORDER BY ref`;
  const bad = rows.find((r) => r.ref === 'bad')!;
  const or = rows.find((r) => r.ref === 'or')!;
  assert.equal(bad.status, 'failed');
  assert.equal(bad.error, 'TypeError');
  assert.equal(or.status, 'done');
  assert.ok(['live', 'used'].includes(or.tier), or.tier);
  assert.ok(Array.isArray(or.because) && or.because.length > 0);
  assert.match(or.line, /^(live|used): .+\.$/);
  assert.ok(or.rows.length > 0);
  assert.ok(or.rows.every((r: { basis: string }) => ['github', 'explorer', 'site', 'earnkit'].includes(r.basis)));
  assert.ok(or.read_at instanceof Date);
  const [job] = await sql()`SELECT done, total, finished_at FROM screen_jobs WHERE id = ${j.id}`;
  assert.deepEqual([job.done, job.total], [2, 2]);
  assert.ok(job.finished_at);
});

test('a named job is the only one worked; the plain run takes the oldest', async () => {
  const older = await queue('work-b', [{ ref: 'o', name: 'Old', live_url: 'https://old.example/' }], new Date(NOW.getTime() - 3_600_000));
  const named = await queue('work-c', [{ ref: 'n', name: 'New', live_url: 'https://new.example/' }]);
  const seen: string[] = [];
  const fake = async (s: Subject): Promise<Evidence> => (seen.push(s.live_url!), evidence({ live: liveRows({ url: s.live_url!, url_ok: true }) }));
  const first = await workQueue({ now: NOW, limit: 1, jobId: named.id, deps: { evidence: fake } });
  assert.deepEqual(first, { read: 1, jobs_finished: [named.id] });
  assert.deepEqual(seen, ['https://new.example/']);
  const [n] = await sql()`SELECT tier, line FROM screen_applicants WHERE job_id = ${named.id}`;
  assert.equal(n.tier, 'live');
  assert.equal((await sql()`SELECT status FROM screen_applicants WHERE job_id = ${older.id}`)[0].status, 'queued');
  await workQueue({ now: NOW, limit: 1, deps: { evidence: fake } });
  assert.deepEqual(seen, ['https://new.example/', 'https://old.example/']);
});

test('a site-only applicant is read again with the repo its page links', async () => {
  const j = await queue('work-d', [{ ref: 's', name: 'Thing', live_url: 'https://thing.example/' }]);
  const subjects: Subject[] = [];
  const fake = async (s: Subject): Promise<Evidence> => {
    subjects.push(s);
    return evidence({ live: liveRows({ url: s.live_url!, url_ok: true, domain: 'thing.example', github_links: ['https://github.com/acme/thing'] }) });
  };
  await workQueue({ now: NOW, limit: 5, deps: { evidence: fake } });
  assert.deepEqual(subjects.map((s) => s.repo_url ?? null), [null, 'https://github.com/acme/thing']);
  const [a] = await sql()`SELECT repo_key FROM screen_applicants WHERE job_id = ${j.id}`;
  assert.equal(a.repo_key, 'acme/thing');
});

test('applicants sharing contributors within a job count each other; a later screen of the same repo by the same program shows in because, by another program never (L15-11)', async () => {
  const j = await queue('work-e', [
    { ref: 'e1', name: 'One', repo_url: 'https://github.com/acme/one' },
    { ref: 'e2', name: 'Two', repo_url: 'https://github.com/acme/two' },
  ]);
  const fake = async (): Promise<Evidence> => evidence({ live: liveRows({ url: 'https://x.example/', url_ok: true }), team: { contributors_90d: 1, top_share: 1, account_ages_days: [], prior_repos_used: 0, logins: ['Ada'], note: null } });
  await workQueue({ now: NOW, limit: 5, deps: { evidence: fake } });
  const shared = await sql()`SELECT ref, shared_contributors FROM screen_applicants WHERE job_id = ${j.id} ORDER BY ref`;
  assert.deepEqual(shared.map((r) => r.shared_contributors), [0, 1]);
  const k = await queue('work-e', [{ ref: 'f1', name: 'One', repo_url: 'https://github.com/acme/one' }]);
  const elsewhere = await queue('work-f', [{ ref: 'f2', name: 'One', repo_url: 'https://github.com/acme/one' }]);
  await workQueue({ now: NOW, limit: 5, deps: { evidence: fake } });
  const [f] = await sql()`SELECT because, rows FROM screen_applicants WHERE job_id = ${k.id}`;
  assert.ok(f.because.includes('seen in 1 earlier screen of this program in 90 days'), JSON.stringify(f.because));
  const xp = f.rows.find((r: { key: string }) => r.key === 'xp.applications_90d');
  assert.deepEqual([xp?.basis, xp?.value, xp?.note], ['earnkit', 1, 'earlier screens by this program in 90 days']);
  // Another program's screen of the same repo sees none of program work-e's.
  const [g] = await sql()`SELECT because, rows FROM screen_applicants WHERE job_id = ${elsewhere.id}`;
  assert.ok(!g.because.some((b: string) => b.startsWith('seen in')), JSON.stringify(g.because));
  assert.equal(g.rows.find((r: { key: string }) => r.key === 'xp.applications_90d')?.value, 0);
});

test('two overlapping runs read each applicant exactly once; a taken row over 30 minutes old is free again; reading counts as pending', async () => {
  const j = await queue('work-g', [1, 2, 3, 4, 5].map((i) => ({ ref: `g${i}`, name: `G${i}`, live_url: `https://g${i}.example/` })));
  const seen: string[] = [];
  const fake = async (s: Subject): Promise<Evidence> => {
    seen.push(s.live_url!);
    await new Promise((r) => setTimeout(r, 5));
    return evidence({ live: liveRows({ url: s.live_url!, url_ok: true }) });
  };
  const [a, b] = await Promise.all([workQueue({ now: NOW, limit: 10, deps: { evidence: fake } }), workQueue({ now: NOW, limit: 10, deps: { evidence: fake } })]);
  assert.equal(a.read + b.read, 5);
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5].map((i) => `https://g${i}.example/`));
  assert.deepEqual([...a.jobs_finished, ...b.jobs_finished], [j.id]);

  const k = await queue('work-h', [{ ref: 'h1', name: 'H1', live_url: 'https://h1.example/' }, { ref: 'h2', name: 'H2', live_url: 'https://h2.example/' }]);
  await sql()`UPDATE screen_applicants SET status = 'reading', taken_at = ${new Date(NOW.getTime() - 31 * 60_000)} WHERE job_id = ${k.id} AND ref = 'h1'`;
  await sql()`UPDATE screen_applicants SET status = 'reading', taken_at = ${new Date(NOW.getTime() - 5 * 60_000)} WHERE job_id = ${k.id} AND ref = 'h2'`;
  const r = await jobResults(k.id, 1, NOW);
  assert.equal(r!.totals.pending, 2);
  const again: string[] = [];
  await workQueue({ now: NOW, limit: 10, deps: { evidence: async (s) => (again.push(s.live_url!), evidence({ live: liveRows({ url: s.live_url!, url_ok: true }) })) } });
  assert.deepEqual(again, ['https://h1.example/']);
});

test('a trigger works only its job: the other stays queued; an unknown id reads nothing', async () => {
  const other = await queue('work-i', [{ ref: 'i1', name: 'I1', live_url: 'https://i1.example/' }], new Date(NOW.getTime() - 3_600_000));
  const named = await queue('work-j', [{ ref: 'j1', name: 'J1', live_url: 'https://j1.example/' }, { ref: 'j2', name: 'J2', live_url: 'https://j2.example/' }]);
  const fake = async (s: Subject): Promise<Evidence> => evidence({ live: liveRows({ url: s.live_url!, url_ok: true }) });
  assert.deepEqual(await workQueue({ now: NOW, limit: 10, jobId: named.id, deps: { evidence: fake } }), { read: 2, jobs_finished: [named.id] });
  assert.equal((await sql()`SELECT status FROM screen_applicants WHERE job_id = ${other.id}`)[0].status, 'queued');
  assert.deepEqual(await workQueue({ now: NOW, limit: 10, jobId: 'no-such-job', deps: { evidence: fake } }), { read: 0, jobs_finished: [] });
  assert.equal((await sql()`SELECT status FROM screen_applicants WHERE job_id = ${other.id}`)[0].status, 'queued');
});

test('a budget stop mid-job puts the applicant back and ends the run; the next run finishes the job', async () => {
  const j = await queue('work-k', [1, 2, 3].map((i) => ({ ref: `k${i}`, name: `K${i}`, repo_url: `https://github.com/acme/k${i}` })));
  let calls = 0;
  const stopping = async (s: Subject, d: EvidenceDeps): Promise<Evidence> => {
    calls++;
    if (calls === 2) {
      d.budget!.stopped = true;
      return evidence({ partial: true, notes: ['not read: budget'] });
    }
    return evidence({ live: liveRows({ url: 'https://k.example/', url_ok: true }) });
  };
  const first = await workQueue({ now: NOW, limit: 10, deps: { evidence: stopping } });
  assert.deepEqual(first, { read: 1, jobs_finished: [] });
  assert.equal(calls, 2);
  const st = await sql()`SELECT ref, status, taken_at FROM screen_applicants WHERE job_id = ${j.id} ORDER BY ref`;
  assert.deepEqual(st.map((r) => [r.ref, r.status, r.taken_at]), [['k1', 'done', st[0].taken_at], ['k2', 'queued', null], ['k3', 'queued', null]]);
  const [job] = await sql()`SELECT done, finished_at FROM screen_jobs WHERE id = ${j.id}`;
  assert.deepEqual([job.done, job.finished_at], [1, null]);
  assert.equal((await jobResults(j.id, 1, NOW))!.totals.pending, 2);
  const fine = async (): Promise<Evidence> => evidence({ live: liveRows({ url: 'https://k.example/', url_ok: true }) });
  assert.deepEqual(await workQueue({ now: NOW, limit: 10, deps: { evidence: fine } }), { read: 2, jobs_finished: [j.id] });
});

test('a read worth a retry goes back to the queue; the third is failed with the count', async () => {
  const j = await queue('work-l', [{ ref: 'l1', name: 'L1', repo_url: 'https://github.com/acme/l1' }]);
  const flaky = async (): Promise<Evidence> => evidence({ partial: true, notes: ['not read: timeout'] });
  for (const n of [1, 2]) {
    assert.deepEqual(await workQueue({ now: NOW, limit: 10, deps: { evidence: flaky } }), { read: 0, jobs_finished: [] });
    const [a] = await sql()`SELECT status, attempts FROM screen_applicants WHERE job_id = ${j.id}`;
    assert.deepEqual([a.status, a.attempts], ['queued', n]);
  }
  assert.deepEqual(await workQueue({ now: NOW, limit: 10, deps: { evidence: flaky } }), { read: 1, jobs_finished: [j.id] });
  const [a] = await sql()`SELECT status, attempts, error, line FROM screen_applicants WHERE job_id = ${j.id}`;
  assert.deepEqual([a.status, a.attempts, a.error, a.line], ['failed', 3, 'read failed 3 times', 'no tier: the read failed.']);
});
