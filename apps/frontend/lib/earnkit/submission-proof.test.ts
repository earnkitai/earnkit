import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROOF_RECHECK_INTERVAL_MS,
  RECHECK_BATCH,
  proofProblem,
  recheckSubmissionProofs,
  hostLinked,
  sharedHost,
} from './submission-proof';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { SafeFetchError } from './safe-fetch';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';

const program = {
  id: 'arc-microgrants',
  submission_proof: { host: 'dorahacks.io', path_pattern: '^/buidl/\\d+$' },
};
const URL_OK = 'https://dorahacks.io/buidl/12345';
const REPO = 'https://github.com/alice/tipjar';
const LIVE = 'https://tipjar.example';

test('proofProblem: no submission_proof on the program at all', async () => {
  const problem = await proofProblem(
    { id: 'no-proof', submission_proof: null },
    URL_OK,
    REPO,
    LIVE,
  );
  assert.match(problem!, /no public submission page/);
});

test('proofProblem: wrong host is refused before any fetch', async () => {
  let called = false;
  const problem = await proofProblem(
    program,
    'https://evil.example/buidl/12345',
    REPO,
    LIVE,
    { fetchText: async () => ((called = true), 'x') },
  );
  assert.match(problem!, /must be on dorahacks\.io/);
  assert.equal(called, false);
});

test('proofProblem: a www. host still matches (leniency), a different host does not', async () => {
  const problem = await proofProblem(
    program,
    'https://www.dorahacks.io/buidl/12345',
    REPO,
    LIVE,
    { fetchText: async () => `See ${REPO}` },
  );
  assert.equal(problem, null);
});

test('proofProblem: path mismatch (not a specific entry) is refused before any fetch', async () => {
  let called = false;
  const problem = await proofProblem(
    program,
    'https://dorahacks.io/hackathons/arc',
    REPO,
    LIVE,
    { fetchText: async () => ((called = true), 'x') },
  );
  assert.match(problem!, /doesn't look like one specific entry/);
  assert.equal(called, false);
});

test('proofProblem: a page without the entry\'s link is refused', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => '<html>Some unrelated BUIDL page about pandas.</html>',
  });
  assert.match(problem!, /doesn't link to your repo yet/);
});

test('Ruling 22: an entry with a repo needs its repo on the page; its live site alone never proves it', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => 'Try it live: https://tipjar.example',
  });
  assert.match(problem!, /doesn't link to your repo yet/);
});

test('Ruling 22: a live link on the proof host or a shared platform never proves a repo-less entry', async () => {
  // Another team's BUIDL page links dorahacks.io and github.com like every page does.
  const otherTeam = async () =>
    '<a href="https://dorahacks.io/buidl/777">BUIDL</a> <a href="https://github.com/bob/other">Repo</a> https://x.com/bob';
  for (const live of ['https://dorahacks.io/buidl/12345', 'https://www.dorahacks.io/', 'https://github.com/alice', 'https://x.com/alice', 'https://vercel.app/'])
    assert.match((await proofProblem(program, URL_OK, undefined, live, { fetchText: otherTeam }))!, /can't prove this entry/, live);
  // A project's own subdomain on a hosting platform is its own site.
  assert.equal(
    await proofProblem(program, URL_OK, undefined, 'https://tipjar.vercel.app', { fetchText: async () => 'Live: https://tipjar.vercel.app' }),
    null,
  );
  assert.equal(sharedHost('docs.github.com', 'dorahacks.io'), true);
  assert.equal(sharedHost('tipjar.example', 'dorahacks.io'), false);
});

test('proofProblem: the repo link in another case or form still matches (normalized)', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, undefined, {
    fetchText: async () =>
      '<a href="HTTPS://GitHub.com/Alice/TipJar/">Repo</a>',
  });
  assert.equal(problem, null);
});

test('proofProblem: the live host alone (no repo match) is enough', async () => {
  const problem = await proofProblem(program, URL_OK, undefined, LIVE, {
    fetchText: async () => 'Try it live: https://www.tipjar.example/demo',
  });
  assert.equal(problem, null);
});

test('proofProblem: an oversize page is refused with a specific message, not the retry note', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => {
      throw new SafeFetchError('larger than 512000 bytes');
    },
  });
  assert.match(problem!, /larger than EarnKit can check/);
});

test('proofProblem: a fetch failure (network, timeout, a bad status) retries daily', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => {
      throw new SafeFetchError('answered 404, not 200');
    },
  });
  assert.equal(problem, "couldn't check yet; we retry daily.");

  const problem2 = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => {
      throw new Error('ECONNRESET');
    },
  });
  assert.equal(problem2, "couldn't check yet; we retry daily.");
});

test('proofProblem: no repo or live link to check against is refused before any fetch', async () => {
  let called = false;
  const problem = await proofProblem(program, URL_OK, undefined, undefined, {
    fetchText: async () => ((called = true), 'x'),
  });
  assert.match(problem!, /no repo_url or live_url/);
  assert.equal(called, false);
});

test('proofProblem: a malformed liveUrl (bad stored data) never throws; it just matches on the repo instead', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, 'not a url', {
    fetchText: async () => `See ${REPO}`,
  });
  assert.equal(problem, null);
  const problem2 = await proofProblem(program, URL_OK, undefined, 'not a url', {
    fetchText: async () => 'nothing useful here',
  });
  assert.match(problem2!, /can't prove this entry/);
});

test('proofProblem: an invalid submission URL is refused', async () => {
  assert.match(
    (await proofProblem(program, 'not a url', REPO, LIVE))!,
    /not a valid link/,
  );
  assert.match(
    (await proofProblem(program, 'http://dorahacks.io/buidl/1', REPO, LIVE))!,
    /must be https/,
  );
});

// ---- recheckSubmissionProofs (v2.5 §3, Ruling 11: the cron's daily re-check) ------------------

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// Held for the whole file (M11): the re-check is global, like the other bonus jobs.
holdBonusDbLock();

/** arc-microgrants.json (real submission_proof: dorahacks.io, /buidl/<id>) under a fresh id. */
function recheckProgram(id: string, overrides: Record<string, unknown> = {}) {
  const f = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../programs/arc-microgrants.json'), 'utf8'),
  );
  return ProgramFile.parse({ ...f, id, ...overrides });
}

async function freshInstallation() {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`recheck-${process.pid}-${Date.now()}-${Math.random()}`})
    RETURNING id`;
  return id;
}

async function insertUncheckedEntry(
  programId: string,
  installationId: number,
  opts: { repoUrl?: string; checkedAt?: Date | null },
) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, installation_id, submission_proof_url, submission_proof_checked_at)
    VALUES (${programId}, 'Recheck Project', ${opts.repoUrl ?? null}, ${installationId},
      'https://dorahacks.io/buidl/999', ${opts.checkedAt ?? null})
    RETURNING id`;
  return id;
}

async function proofRow(id: number) {
  const [row] = await sql()<{ submission_proof_ok_at: Date | null; submission_proof_checked_at: Date | null }[]>`
    SELECT submission_proof_ok_at, submission_proof_checked_at FROM projects WHERE id = ${id}`;
  return row;
}

test('recheckSubmissionProofs: a failed proof that later passes becomes eligible', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const program = recheckProgram(`t5fix-pass-${process.pid}-${Date.now()}`, {
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2026-12-01T00:00:00Z',
  });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const repoUrl = 'https://github.com/alice/recheck-pass';
  const id = await insertUncheckedEntry(program.id, installationId, { repoUrl, checkedAt: null });
  const result = await recheckSubmissionProofs(now, Date.now() + 60_000, {
    fetchText: async () => `See the repo: ${repoUrl}`,
  });
  assert.equal(result.checked, 1);
  assert.equal(result.passed, 1);
  const row = await proofRow(id);
  assert.ok(row.submission_proof_ok_at);
  assert.equal(row.submission_proof_ok_at!.getTime(), now.getTime());
  assert.equal(row.submission_proof_checked_at!.getTime(), now.getTime());
});

test('recheckSubmissionProofs: a failure checked under 24h ago is not retried', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const program = recheckProgram(`t5fix-recent-${process.pid}-${Date.now()}`, {
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2026-12-01T00:00:00Z',
  });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const checkedAt = new Date(now.getTime() - (PROOF_RECHECK_INTERVAL_MS - 3_600_000)); // 23h ago
  const id = await insertUncheckedEntry(program.id, installationId, { checkedAt });
  let fetchCalled = false;
  const result = await recheckSubmissionProofs(now, Date.now() + 60_000, {
    fetchText: async () => ((fetchCalled = true), 'x'),
  });
  assert.equal(result.checked, 0);
  assert.equal(fetchCalled, false);
  const row = await proofRow(id);
  assert.equal(row.submission_proof_ok_at, null);
  assert.equal(row.submission_proof_checked_at!.getTime(), checkedAt.getTime());
});

test('recheckSubmissionProofs: never checked once the round has ended', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const program = recheckProgram(`t5fix-ended-${process.pid}-${Date.now()}`, {
    starts_at: '2026-01-01T00:00:00Z',
    ends_at: '2026-02-01T00:00:00Z', // ended well before `now`
  });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const id = await insertUncheckedEntry(program.id, installationId, { checkedAt: null });
  let fetchCalled = false;
  const result = await recheckSubmissionProofs(now, Date.now() + 60_000, {
    fetchText: async () => ((fetchCalled = true), 'x'),
  });
  assert.equal(result.checked, 0);
  assert.equal(fetchCalled, false);
  const row = await proofRow(id);
  assert.equal(row.submission_proof_ok_at, null);
});

test('recheckSubmissionProofs: never checked once the program is no longer active', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const program = recheckProgram(`t5fix-closed-${process.pid}-${Date.now()}`, {
    starts_at: '2026-01-01T00:00:00Z',
    ends_at: '2026-12-01T00:00:00Z',
    status: 'closed',
  });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  const id = await insertUncheckedEntry(program.id, installationId, { checkedAt: null });
  let fetchCalled = false;
  const result = await recheckSubmissionProofs(now, Date.now() + 60_000, {
    fetchText: async () => ((fetchCalled = true), 'x'),
  });
  assert.equal(result.checked, 0);
  assert.equal(fetchCalled, false);
  const row = await proofRow(id);
  assert.equal(row.submission_proof_ok_at, null);
});

test('M11: the re-check reads at most RECHECK_BATCH entries a run, only of rounds open now', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const tag = `t5fix-batch-${process.pid}-${Date.now()}`;
  const open = recheckProgram(`${tag}-open`, { starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' });
  const ended = recheckProgram(`${tag}-ended`, { starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-02-01T00:00:00Z' });
  await upsertProgram(open);
  await upsertProgram(ended);
  const installationId = await freshInstallation();
  try {
    for (let i = 0; i < RECHECK_BATCH + 5; i++) await insertUncheckedEntry(open.id, installationId, { repoUrl: `https://github.com/a/r${i}` });
    const stuck = await insertUncheckedEntry(ended.id, installationId, { checkedAt: null });
    let fetches = 0;
    const r = await recheckSubmissionProofs(now, Date.now() + 60_000, { fetchText: async () => ((fetches++), 'nothing') });
    assert.ok(r.checked <= RECHECK_BATCH && fetches <= RECHECK_BATCH, `${r.checked} checked`);
    assert.equal(RECHECK_BATCH, 50);
    // The ended round's entry is never selected (filtered in SQL), so it can't hold a batch slot.
    const sel = await sql()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM projects WHERE program_id = ${open.id} AND submission_proof_checked_at IS NULL`;
    assert.ok(sel[0].n >= 5, 'the rest wait for the next run');
    assert.equal((await proofRow(stuck)).submission_proof_checked_at, null, 'never read');
  } finally {
    await sql()`DELETE FROM projects WHERE program_id LIKE ${`${tag}-%`}`;
    await sql()`DELETE FROM programs WHERE id LIKE ${`${tag}-%`}`;
    await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});


test('residual N1: a live host matches on host boundaries only, never inside a longer host', () => {
  assert.equal(hostLinked('see https://dex.vercel.app/app', 'dex.vercel.app'), true);
  assert.equal(hostLinked('live at www.dex.vercel.app.', 'dex.vercel.app'), true);
  assert.equal(hostLinked('<a href="https://dex.vercel.app">', 'dex.vercel.app'), true);
  assert.equal(hostLinked('https://super-dex.vercel.app', 'dex.vercel.app'), false);
  assert.equal(hostLinked('https://superdex.vercel.app', 'dex.vercel.app'), false);
  assert.equal(hostLinked('https://dex.vercel.app.evil.io', 'dex.vercel.app'), false);
  assert.equal(hostLinked('https://myapp.xyz', 'app.xyz'), false);
});

test('residual N1: another team\'s page linking a longer host never proves a repo-less entry', async () => {
  const problem = await proofProblem(program, URL_OK, undefined, 'https://dex.vercel.app', {
    fetchText: async () => '<a href="https://super-dex.vercel.app">Live</a>',
  });
  assert.match(problem!, /doesn't link to your live site yet/);
});

test('residual N1: an entry proven by its live site, then given a repo, is not eligible until its repo is on the page', dbTest, async () => {
  const { launchToken, LaunchTokenInput } = await import('./token-launch');
  const now = new Date('2026-10-05T12:00:00Z');
  const program = recheckProgram(`fw-n1-${process.pid}-${Date.now()}`, { starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  try {
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, live_url, installation_id, submission_proof_url, submission_proof_ok_at, submission_proof_checked_at)
      VALUES (${program.id}, 'Dex', 'https://dex.example', ${installationId}, 'https://dorahacks.io/buidl/4242', ${now}, ${now})
      RETURNING id`;
    // launch_token fills the missing repo (tokens unavailable here: no launch, the links still apply).
    await launchToken(LaunchTokenInput.parse({ project_id: id, builder_confirmed: true, repo_url: 'https://github.com/mallory/dex' }), installationId, { available: () => false });
    const after = await proofRow(id);
    assert.equal(after.submission_proof_ok_at, null, 'the live-site proof no longer stands');
    assert.equal(after.submission_proof_checked_at, null, 're-checked on the next run');
    // The page links only the live site: still not eligible. Once it links the repo: eligible.
    const later = new Date(now.getTime() + 3_600_000);
    await recheckSubmissionProofs(later, Date.now() + 60_000, { fetchText: async (u) => (u.endsWith('/4242') ? 'Live: https://dex.example' : '') });
    assert.equal((await proofRow(id)).submission_proof_ok_at, null);
    await sql()`UPDATE projects SET submission_proof_checked_at = NULL WHERE id = ${id}`;
    await recheckSubmissionProofs(later, Date.now() + 60_000, { fetchText: async () => 'Repo: https://github.com/mallory/dex' });
    assert.ok((await proofRow(id)).submission_proof_ok_at);
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${program.id}`;
    await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});
