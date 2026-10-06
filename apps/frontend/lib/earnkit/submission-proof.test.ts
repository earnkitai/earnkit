import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROOF_RECHECK_INTERVAL_MS,
  RECHECK_BATCH,
  proofCheck,
  proofProblem,
  recheckSubmissionProofs,
  recheckUpdate,
  hostLinked,
  sharedHost,
} from './submission-proof';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { SafeFetchError } from './safe-fetch';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { recordSubmission, submissionBasis } from './projects';
import { committedProgram } from './fixtures/program-file';

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
  const f = committedProgram('arc-microgrants');
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

// ---- v2.6: submission proof is a bonus check (spec §3; Rulings 4, 5, 15 (plan)) ---------------

const arcProgram = { id: 'arc', submission_proof: { host: 'dorahacks.io', path_pattern: '^/buidl/\\d+$' } };
const KIT = 'https://github.com/acme/kit';

test('Ruling 15 (plan): unreachable vs refused', async () => {
  const blocked = await proofCheck(arcProgram, 'https://dorahacks.io/buidl/7', KIT, undefined, {
    fetchText: async () => { throw new SafeFetchError('it answered 405'); },
  });
  assert.equal(blocked.kind, 'unreachable');
  const big = await proofCheck(arcProgram, 'https://dorahacks.io/buidl/7', KIT, undefined, {
    fetchText: async () => { throw new SafeFetchError('larger than 512000 bytes'); },
  });
  assert.equal(big.kind, 'unreachable');
  const network = await proofCheck(arcProgram, 'https://dorahacks.io/buidl/7', KIT, undefined, {
    fetchText: async () => { throw new Error('ECONNRESET'); },
  });
  assert.equal(network.kind, 'unreachable');
  assert.deepEqual(
    await proofCheck(arcProgram, 'https://dorahacks.io/buidl/7', KIT, undefined, { fetchText: async () => '<html>other</html>' }),
    { kind: 'refused', loaded: true, problem: "the page at https://dorahacks.io/buidl/7 doesn't link to your repo yet; add the repo link there, and EarnKit checks again daily." },
  );
  assert.equal((await proofCheck(arcProgram, 'https://dorahacks.io/buidl/7', undefined, 'https://kit.example', { fetchText: async () => 'other' }) as { loaded?: true }).loaded, true);
  // N2: refusals of the link itself never loaded a page.
  for (const bad of ['https://evil.io/buidl/7', 'http://dorahacks.io/buidl/7', 'https://dorahacks.io/hackathon/arc'])
    assert.equal((await proofCheck(arcProgram, bad, KIT, undefined, { fetchText: async () => 'github.com/acme/kit' }) as { loaded?: true }).loaded, undefined, bad);
  assert.equal((await proofCheck(arcProgram, 'https://evil.io/buidl/7', KIT, undefined)).kind, 'refused');
  assert.equal((await proofCheck(arcProgram, 'https://dorahacks.io/about', KIT, undefined)).kind, 'refused');
  assert.equal((await proofCheck(arcProgram, 'https://dorahacks.io/buidl/7', undefined, undefined)).kind, 'refused');
  assert.equal((await proofCheck(arcProgram, 'https://dorahacks.io/buidl/7', KIT, undefined, { fetchText: async () => 'github.com/acme/kit' })).kind, 'ok');
  // proofProblem keeps its v2.5 shape: the problem, or null.
  assert.equal(await proofProblem(arcProgram, 'https://dorahacks.io/buidl/7', KIT, undefined, { fetchText: async () => 'github.com/acme/kit' }), null);
  assert.equal(
    await proofProblem(arcProgram, 'https://dorahacks.io/buidl/7', KIT, undefined, { fetchText: async () => { throw new SafeFetchError('it answered 405'); } }),
    "couldn't check yet; we retry daily.",
  );
});

test('v2.6 §3: how a submission counts', () => {
  const un = { kind: 'unreachable' as const, problem: "couldn't check yet; we retry daily." };
  const no = { kind: 'refused' as const, problem: "the page at x doesn't link to your repo yet" };
  assert.deepEqual(submissionBasis({ hasPattern: true, outcome: { kind: 'ok' }, confirmed: false }), { basis: 'page', note: null });
  assert.deepEqual(submissionBasis({ hasPattern: true, outcome: { kind: 'ok' }, confirmed: true }), { basis: 'page', note: null });
  assert.deepEqual(submissionBasis({ hasPattern: true, outcome: un, confirmed: true }), { basis: 'unverified_page', note: null });
  assert.equal(submissionBasis({ hasPattern: true, outcome: un, confirmed: false }).basis, null);
  assert.match(submissionBasis({ hasPattern: true, outcome: un, confirmed: false }).note!, /builder_submitted: true/);
  assert.equal(submissionBasis({ hasPattern: true, outcome: no, confirmed: true }).basis, null, 'a mismatch is never rescued by confirmation');
  assert.doesNotMatch(submissionBasis({ hasPattern: true, outcome: no, confirmed: false }).note!, /builder_submitted/);
  assert.equal(submissionBasis({ hasPattern: true, outcome: null, confirmed: true }).basis, null, 'a pattern program still needs its link');
  assert.deepEqual(submissionBasis({ hasPattern: false, outcome: null, confirmed: true }), { basis: 'confirmed', note: null });
  assert.equal(submissionBasis({ hasPattern: false, outcome: null, confirmed: false }).basis, null);
  assert.match(submissionBasis({ hasPattern: false, outcome: null, confirmed: false }).note!, /builder_submitted: true/);
});

test('Ruling 4 (plan): re-check transitions; a loaded page without the link clears the confirmation (I2)', () => {
  const now = new Date('2026-10-06T00:00:00Z');
  const t0 = new Date('2026-10-05T00:00:00Z');
  const un = { kind: 'unreachable' as const, problem: 'x' };
  const no = { kind: 'refused' as const, problem: 'x', loaded: true as const };
  const badLink = { kind: 'refused' as const, problem: 'x' };
  // N2: a refusal of the link itself (no page read) ends the count but keeps the confirmation.
  assert.deepEqual(recheckUpdate({ ok_at: t0, basis: 'unverified_page', confirmed: true }, badLink, now), { ok_at: null, basis: null, confirmed: true });
  assert.equal(recheckUpdate({ ok_at: null, basis: null, confirmed: true }, badLink, now), null);
  assert.deepEqual(recheckUpdate({ ok_at: t0, basis: 'unverified_page', confirmed: true }, { kind: 'ok' }, now), { ok_at: t0, basis: 'page', confirmed: true });
  assert.deepEqual(recheckUpdate({ ok_at: t0, basis: 'unverified_page', confirmed: true }, no, now), { ok_at: null, basis: null, confirmed: false });
  assert.equal(recheckUpdate({ ok_at: t0, basis: 'unverified_page', confirmed: true }, un, now), null);
  assert.deepEqual(recheckUpdate({ ok_at: null, basis: null, confirmed: true }, un, now), { ok_at: now, basis: 'unverified_page', confirmed: true });
  assert.equal(recheckUpdate({ ok_at: null, basis: null, confirmed: false }, un, now), null);
  assert.deepEqual(recheckUpdate({ ok_at: null, basis: null, confirmed: true }, no, now), { ok_at: null, basis: null, confirmed: false });
  assert.equal(recheckUpdate({ ok_at: null, basis: null, confirmed: false }, no, now), null);
  assert.deepEqual(recheckUpdate({ ok_at: null, basis: null, confirmed: false }, { kind: 'ok' }, now), { ok_at: now, basis: 'page', confirmed: false });
  // I2: unverified, then a page without the link, then a bot wall again: still not counting.
  const cleared = recheckUpdate({ ok_at: t0, basis: 'unverified_page', confirmed: true }, no, now)!;
  assert.equal(recheckUpdate({ ok_at: cleared.ok_at, basis: cleared.basis, confirmed: cleared.confirmed }, un, now), null);
});

test('Ruling 4 (plan): an unverified page that later loads without the link stops counting; no second fetch within 24 h', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const t0 = new Date('2026-10-02T00:00:00Z');
  const program = recheckProgram(`t5v26-unv-${process.pid}-${Date.now()}`, {
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2026-12-01T00:00:00Z',
  });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  try {
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, installation_id, submission_proof_url, submission_proof_ok_at,
        submission_basis, submission_confirmed_at, submission_proof_checked_at)
      VALUES (${program.id}, 'Unverified', 'https://github.com/alice/unverified', ${installationId},
        'https://dorahacks.io/buidl/31337', ${t0}, 'unverified_page', ${t0}, ${t0})
      RETURNING id`;
    let fetches = 0;
    const fetchText = async () => ((fetches++), '<html>another team</html>');
    await recheckSubmissionProofs(now, Date.now() + 60_000, { fetchText });
    assert.equal(fetches, 1);
    const [row] = await sql()<{ submission_proof_ok_at: Date | null; submission_basis: string | null; submission_proof_checked_at: Date | null }[]>`
      SELECT submission_proof_ok_at, submission_basis, submission_proof_checked_at FROM projects WHERE id = ${id}`;
    assert.equal(row.submission_proof_ok_at, null);
    assert.equal(row.submission_basis, null);
    assert.equal(row.submission_proof_checked_at!.getTime(), now.getTime());
    await recheckSubmissionProofs(new Date(now.getTime() + 3_600_000), Date.now() + 60_000, { fetchText });
    assert.equal(fetches, 1, 'a second run within 24 h fetches nothing');
    const [c] = await sql()<{ submission_confirmed_at: Date | null }[]>`SELECT submission_confirmed_at FROM projects WHERE id = ${id}`;
    assert.equal(c.submission_confirmed_at, null, 'I2: the page loaded without the link, so the confirmation is cleared');
    // A day later the site blocks EarnKit again: the entry stays out (never an unverified page again).
    await recheckSubmissionProofs(new Date(now.getTime() + 25 * 3_600_000), Date.now() + 60_000, {
      fetchText: async () => { throw new SafeFetchError('it answered 405'); },
    });
    const [again] = await sql()<{ submission_proof_ok_at: Date | null; submission_basis: string | null }[]>`
      SELECT submission_proof_ok_at, submission_basis FROM projects WHERE id = ${id}`;
    assert.deepEqual([again.submission_proof_ok_at, again.submission_basis], [null, null]);
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${program.id}`;
    await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});

test('Ruling 4 (plan): a confirmed entry whose page stays blocked starts counting as unverified; a v2.5 page row is never re-read', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const t0 = new Date('2026-10-02T00:00:00Z');
  const program = recheckProgram(`t5v26-blk-${process.pid}-${Date.now()}`, {
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2026-12-01T00:00:00Z',
  });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  try {
    const [{ id: blocked }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, installation_id, submission_proof_url, submission_confirmed_at, submission_proof_checked_at)
      VALUES (${program.id}, 'Blocked', 'https://github.com/alice/blocked', ${installationId}, 'https://dorahacks.io/buidl/1', ${t0}, ${t0})
      RETURNING id`;
    const [{ id: v25 }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, installation_id, submission_proof_url, submission_proof_ok_at, submission_proof_checked_at)
      VALUES (${program.id}, 'V25', 'https://github.com/alice/v25', ${installationId}, 'https://dorahacks.io/buidl/2', ${t0}, ${t0})
      RETURNING id`;
    const urls: string[] = [];
    const r = await recheckSubmissionProofs(now, Date.now() + 60_000, {
      fetchText: async (u) => { urls.push(u); throw new SafeFetchError('it answered 405'); },
    });
    assert.deepEqual(urls, ['https://dorahacks.io/buidl/1']);
    assert.equal(r.passed, 1);
    const rows = await sql()<{ id: number; submission_proof_ok_at: Date | null; submission_basis: string | null }[]>`
      SELECT id, submission_proof_ok_at, submission_basis FROM projects WHERE program_id = ${program.id} ORDER BY id`;
    const by = new Map(rows.map((x) => [x.id, x]));
    assert.equal(by.get(blocked)!.submission_basis, 'unverified_page');
    assert.equal(by.get(blocked)!.submission_proof_ok_at!.getTime(), now.getTime());
    assert.equal(by.get(v25)!.submission_basis, null);
    assert.equal(by.get(v25)!.submission_proof_ok_at!.getTime(), t0.getTime());
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${program.id}`;
    await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});

test('v2.6 (N1 scope): a repo filled in at launch_token keeps a builder-confirmed entry counting (no page to re-check)', dbTest, async () => {
  const { launchToken, LaunchTokenInput } = await import('./token-launch');
  const t0 = new Date('2026-10-02T00:00:00Z');
  const program = recheckProgram(`t5v26-n1-${process.pid}-${Date.now()}`, { submission_proof: null, starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  try {
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, live_url, installation_id, submission_proof_ok_at, submission_basis, submission_confirmed_at)
      VALUES (${program.id}, 'Confirmed', 'https://confirmed.example', ${installationId}, ${t0}, 'confirmed', ${t0})
      RETURNING id`;
    await launchToken(LaunchTokenInput.parse({ project_id: id, builder_confirmed: true, repo_url: 'https://github.com/alice/confirmed' }), installationId, { available: () => false });
    const [row] = await sql()<{ repo_url: string | null; submission_proof_ok_at: Date | null; submission_basis: string | null }[]>`
      SELECT repo_url, submission_proof_ok_at, submission_basis FROM projects WHERE id = ${id}`;
    assert.equal(row.repo_url, 'https://github.com/alice/confirmed');
    assert.equal(row.submission_proof_ok_at!.getTime(), t0.getTime());
    assert.equal(row.submission_basis, 'confirmed');
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${program.id}`;
    await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});

test('fix round 1 (I2): a confirmed entry whose page loaded without the link stays out when the site blocks EarnKit later', dbTest, async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const program = recheckProgram(`t5f-i2-${process.pid}-${Date.now()}`, { starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  try {
    const repo = 'https://github.com/alice/i2-entry';
    const r = await recordSubmission(
      {
        program_id: program.id,
        project: { name: 'I2', description: 'x', repo_url: repo },
        submission_data: { description: 'x' },
        external_submission_url: 'https://dorahacks.io/buidl/2222',
        builder_submitted: true,
      } as never,
      installationId,
      { fetchProof: async () => '<html>another team</html>' },
    );
    await sql()`UPDATE projects SET submission_proof_checked_at = ${new Date(now.getTime() - 2 * PROOF_RECHECK_INTERVAL_MS)} WHERE id = ${r.project_id}`;
    await recheckSubmissionProofs(now, Date.now() + 60_000, { fetchText: async () => { throw new SafeFetchError('it answered 405'); } });
    const [row] = await sql()<{ submission_proof_ok_at: Date | null; submission_basis: string | null; submission_confirmed_at: Date | null }[]>`
      SELECT submission_proof_ok_at, submission_basis, submission_confirmed_at FROM projects WHERE id = ${r.project_id}`;
    assert.deepEqual([row.submission_proof_ok_at, row.submission_basis, row.submission_confirmed_at], [null, null, null]);
  } finally {
    await sql()`DELETE FROM submissions WHERE project_id IN (SELECT id FROM projects WHERE program_id = ${program.id})`;
    await sql()`DELETE FROM projects WHERE program_id = ${program.id}`;
    await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});

test('fix round 2 (N2): a bad entry link keeps the confirmation and asks for the link; a page without the link of a repo-less entry asks for the live site link', dbTest, async () => {
  const program = recheckProgram(`t5f2-n2-${process.pid}-${Date.now()}`, { starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(program);
  const installationId = await freshInstallation();
  try {
    let fetched = 0;
    const wrong = await recordSubmission(
      {
        program_id: program.id,
        project: { name: 'N2 Wrong Link', description: 'x', repo_url: 'https://github.com/alice/n2-wrong' },
        submission_data: { description: 'x' },
        external_submission_url: 'https://dorahacks.io/hackathon/arc/detail',
        builder_submitted: true,
      } as never,
      installationId,
      { fetchProof: async () => ((fetched++), '') },
    );
    assert.equal(fetched, 0);
    assert.deepEqual((wrong as { bonus_join?: unknown }).bonus_join, { kind: 'link', site: 'dorahacks.io' });
    const [w] = await sql()<{ submission_confirmed_at: Date | null; submission_basis: string | null }[]>`
      SELECT submission_confirmed_at, submission_basis FROM projects WHERE id = ${wrong.project_id}`;
    assert.ok(w.submission_confirmed_at instanceof Date, 'the confirmation stands: no page was read');
    assert.equal(w.submission_basis, null);
    // The right link later, behind a bot wall: the kept confirmation counts (unverified page).
    const fixed = await recordSubmission(
      {
        program_id: program.id,
        project: { name: 'N2 Wrong Link', description: 'x', repo_url: 'https://github.com/alice/n2-wrong' },
        submission_data: { description: 'x' },
        external_submission_url: 'https://dorahacks.io/buidl/3333',
      } as never,
      installationId,
      { fetchProof: async () => { throw new SafeFetchError('it answered 405'); } },
    );
    assert.equal(fixed.project_id, wrong.project_id);
    const [f] = await sql()<{ submission_basis: string | null }[]>`SELECT submission_basis FROM projects WHERE id = ${wrong.project_id}`;
    assert.equal(f.submission_basis, 'unverified_page');
    // A repo-less entry whose page loaded without its live site: the live site line, never "repo".
    const live = await recordSubmission(
      {
        program_id: program.id,
        project: { name: 'N2 Live Only', description: 'x', live_url: 'https://n2-live.example' },
        submission_data: { description: 'x' },
        external_submission_url: 'https://dorahacks.io/buidl/4444',
        builder_submitted: true,
      } as never,
      installationId,
      { fetchProof: async () => '<html>another team</html>' },
    );
    assert.deepEqual((live as { bonus_join?: unknown }).bonus_join, { kind: 'page', site: 'dorahacks.io', missing: 'live site' });
    const [l] = await sql()<{ submission_confirmed_at: Date | null }[]>`SELECT submission_confirmed_at FROM projects WHERE id = ${live.project_id}`;
    assert.equal(l.submission_confirmed_at, null, 'the page loaded without the link: the confirmation is disproven');
  } finally {
    await sql()`DELETE FROM submissions WHERE project_id IN (SELECT id FROM projects WHERE program_id = ${program.id})`;
    await sql()`DELETE FROM projects WHERE program_id = ${program.id}`;
    await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});
