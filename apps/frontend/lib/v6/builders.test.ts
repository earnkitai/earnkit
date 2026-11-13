import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { record, summary } from '../v5/ledger';
import { getProgram, upsertProgram } from '../v5/programs';
import { LinkRefused, deleteBuilder, getBuilder, hasUnlinkedNotice, linkInstallation, ownerKey, takeUnlinkedNotice, unlinkInstallation, unlinkedReason, upsertBuilder } from './builders';
import { createSession } from './sessions';
import { createLinkCode } from './link-routes';
import { jobStatus } from './screen-jobs';

after(() => sql().end());
// createLinkCode derives codes with the auth secret.
process.env.EARNKIT_AUTH_SECRET ??= 'builders-test-secret';

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
let gh = 900_000;
const install = async () =>
  ((await sql()`INSERT INTO installations (token_hash) VALUES (${'builders-' + Math.random()}) RETURNING id`)[0].id as number);
const prog = async (id: string) => {
  // A users item, so gap_done with item users is one of its own (v6.1.7, C27).
  await upsertProgram(programFixture({ id, max_award_usd: 5000, eligibility: [{ kind: 'users' }] }), 'file', NOW);
  return (await getProgram(id))!;
};
const builder = (login = 'ada') => upsertBuilder({ github_id: ++gh, login, name: 'Ada', avatar_url: null }, NOW);
const rows = async (owner: string) =>
  (await sql()<{ program_id: string; status: string }[]>`SELECT program_id, status FROM applications WHERE owner = ${owner} ORDER BY program_id`).map((r) => ({ ...r }));

test('ownerKey: b:<builder> when linked, else i:<installation>', () => {
  assert.equal(ownerKey(7, null), 'i:7');
  assert.equal(ownerKey(7, 3), 'b:3');
});

test('upsert twice with the same github_id is one row with the new login', async () => {
  const a = await upsertBuilder({ github_id: 4242, login: 'old', name: null, avatar_url: null }, NOW);
  const b = await upsertBuilder({ github_id: 4242, login: 'new', name: 'New', avatar_url: 'https://a/x.png' }, NOW);
  assert.equal(a.id, b.id);
  assert.deepEqual(b, { id: a.id, github_id: 4242, login: 'new', name: 'New', avatar_url: 'https://a/x.png' });
  assert.equal((await sql()`SELECT count(*)::int AS n FROM builders WHERE github_id = 4242`)[0].n, 1);
  assert.deepEqual(await getBuilder(a.id), b);
  assert.equal(await getBuilder(2 ** 30), null);
});

test('linkInstallation moves i: applications to b: and keeps the newer status on a duplicate program', async () => {
  const b = await builder();
  const one = await install();
  const two = await install();
  await prog('bl-a');
  await prog('bl-b');
  await prog('bl-dup');
  await record(ownerKey(one, null), 'bl-a', 'applied', { now: NOW });
  await record(ownerKey(one, null), 'bl-b', 'skipped', { now: NOW });
  await record(ownerKey(one, null), 'bl-dup', 'applied', { now: NOW });
  await record(ownerKey(one, null), 'bl-dup', 'gap_done', { item: 'users', now: NOW });
  assert.deepEqual(await linkInstallation(one, b.id, NOW), { migrated: 3 });
  assert.deepEqual(await rows(`i:${one}`), []);
  assert.deepEqual(await rows(`b:${b.id}`), [
    { program_id: 'bl-a', status: 'applied' },
    { program_id: 'bl-b', status: 'skipped' },
    { program_id: 'bl-dup', status: 'applied' },
  ]);
  const inst = (await sql()`SELECT builder_id, linked_at FROM installations WHERE id = ${one}`)[0];
  assert.equal(inst.builder_id, b.id);
  assert.equal((inst.linked_at as Date).getTime(), NOW.getTime());

  // The second installation's newer result on bl-dup wins; its gap item duplicates the first's.
  const later = new Date(NOW.getTime() + DAY);
  await record(ownerKey(two, null), 'bl-dup', 'applied', { now: later });
  await record(ownerKey(two, null), 'bl-dup', 'rejected', { now: later });
  await record(ownerKey(two, null), 'bl-dup', 'gap_done', { item: 'users', now: later });
  assert.deepEqual(await linkInstallation(two, b.id, later), { migrated: 1 });
  assert.deepEqual(await rows(`b:${b.id}`), [
    { program_id: 'bl-a', status: 'applied' },
    { program_id: 'bl-b', status: 'skipped' },
    { program_id: 'bl-dup', status: 'rejected' },
  ]);
  const hist = (await sql()`SELECT count(*)::int AS n FROM application_history WHERE owner = ${`b:${b.id}`}`)[0].n;
  assert.equal(hist, 7);
  const gaps = await sql()`SELECT item FROM gaps_done WHERE owner = ${`b:${b.id}`}`;
  assert.deepEqual(gaps.map((g) => g.item), ['users']);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE owner LIKE 'i:%' AND owner IN (${`i:${one}`}, ${`i:${two}`})`)[0].n, 0);
});

test('linkInstallation keeps each done step with its project; only the same project\'s repeat merges (v6.1.10, L1c-1)', async () => {
  const b = await builder();
  const one = await install();
  const two = await install();
  await prog('bl-pk');
  const A = 'https://github.com/acme/a';
  await record(ownerKey(one, null), 'bl-pk', 'gap_done', { item: 'users', projectKey: A, now: NOW });
  await linkInstallation(one, b.id, NOW);
  await record(ownerKey(two, null), 'bl-pk', 'gap_done', { item: 'users', projectKey: A, now: NOW });
  await record(ownerKey(two, null), 'bl-pk', 'gap_done', { item: 'users', projectKey: 'name:b app', now: NOW });
  await linkInstallation(two, b.id, NOW);
  const gaps = await sql()`SELECT project_key, item FROM gaps_done WHERE owner = ${`b:${b.id}`} AND program_id = 'bl-pk' ORDER BY project_key`;
  assert.deepEqual(gaps.map((g) => ({ ...g })), [{ project_key: A, item: 'users' }, { project_key: 'name:b app', item: 'users' }]);
});

test('an older i: row loses to the b: row on the same program', async () => {
  const b = await builder();
  const one = await install();
  const two = await install();
  await prog('bl-old');
  await record(ownerKey(one, null), 'bl-old', 'applied', { now: new Date(NOW.getTime() + DAY) });
  await linkInstallation(one, b.id, NOW);
  await record(ownerKey(one, b.id), 'bl-old', 'won', { installationId: one, amount_usd: 100, now: new Date(NOW.getTime() + 2 * DAY) });
  await record(ownerKey(two, null), 'bl-old', 'skipped', { now: NOW });
  assert.deepEqual(await linkInstallation(two, b.id, NOW), { migrated: 0 });
  assert.deepEqual(await rows(`b:${b.id}`), [{ program_id: 'bl-old', status: 'won' }]);
});

test('a second installation linked to the same builder shares summary', async () => {
  const b = await builder();
  const one = await install();
  const two = await install();
  const p = await prog('bl-share');
  await linkInstallation(one, b.id, NOW);
  await linkInstallation(two, b.id, NOW);
  await record(ownerKey(one, b.id), 'bl-share', 'applied', { installationId: one, now: NOW });
  const s1 = await summary(ownerKey(one, b.id), [p], NOW);
  const s2 = await summary(ownerKey(two, b.id), [p], NOW);
  assert.equal(s1.applied, 1);
  assert.deepEqual(s2, s1);
});

test('deleteBuilder leaves no builder, session, link code or b: ledger row; the installation is unlinked', async () => {
  const b = await builder();
  const one = await install();
  await prog('bl-del');
  await record(ownerKey(one, null), 'bl-del', 'applied', { now: NOW });
  await createLinkCode(one, NOW);
  await linkInstallation(one, b.id, NOW);
  await record(ownerKey(one, b.id), 'bl-del', 'gap_done', { installationId: one, item: 'users', now: NOW });
  await createSession(b.id, NOW);
  await deleteBuilder(b.id);
  const owner = `b:${b.id}`;
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  assert.equal(await getBuilder(b.id), null);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM sessions WHERE builder_id = ${b.id}`), 0);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM link_codes WHERE installation_id = ${one}`), 0);
  for (const t of ['applications', 'application_history', 'gaps_done'])
    assert.equal(await n(sql()`SELECT count(*)::int AS n FROM ${sql()(t)} WHERE owner = ${owner}`), 0, t);
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${one}`)[0].builder_id, null);
});

test('an installation linked to one builder is never re-linked to another; the same builder again is a no-op', async () => {
  const a = await builder();
  const b = await builder();
  const x = await install();
  await prog('bl-re');
  await record(ownerKey(x, null), 'bl-re', 'applied', { now: NOW });
  assert.deepEqual(await linkInstallation(x, a.id, NOW), { migrated: 1 });
  const before = await rows(`b:${a.id}`);
  await assert.rejects(linkInstallation(x, b.id, NOW), (e) => e instanceof LinkRefused && e.reason === 'other_builder');
  assert.deepEqual(await rows(`b:${a.id}`), before);
  assert.deepEqual(await rows(`b:${b.id}`), []);
  const inst = (await sql()`SELECT builder_id, linked_at FROM installations WHERE id = ${x}`)[0];
  assert.equal(inst.builder_id, a.id);
  assert.equal((inst.linked_at as Date).getTime(), NOW.getTime());
  assert.deepEqual(await linkInstallation(x, a.id, new Date(NOW.getTime() + DAY)), { migrated: 0 });
  await assert.rejects(createLinkCode(x, NOW), (e) => e instanceof LinkRefused && e.reason === 'already_linked');
});

test('a record under b:A from X does not raise beside an orphan i:X row for the same program', async () => {
  const a = await builder();
  const x = await install();
  await prog('bl-orphan');
  await linkInstallation(x, a.id, NOW);
  // A call in flight at link time writes under the old owner.
  await record(ownerKey(x, null), 'bl-orphan', 'applied', { now: NOW });
  await record(ownerKey(x, null), 'bl-orphan', 'gap_done', { item: 'users', now: NOW });
  assert.equal((await record(ownerKey(x, a.id), 'bl-orphan', 'applied', { installationId: x, now: NOW })).ok, true);
  assert.equal((await record(ownerKey(x, a.id), 'bl-orphan', 'gap_done', { installationId: x, item: 'users', now: NOW })).ok, true);
  assert.deepEqual(await rows(`b:${a.id}`), [{ program_id: 'bl-orphan', status: 'applied' }]);
  assert.deepEqual(await rows(`i:${x}`), [{ program_id: 'bl-orphan', status: 'applied' }]);
});

test('B11, L15-18 (v6.1.14): deleteBuilder removes their reviewer rows; the program keeps their screens, applicants and outcomes, unowned, and its other reviewer reads them', async () => {
  const b = await builder('rev');
  const other = await builder('rev2');
  const one = await install();
  for (const [who, job] of [[b.id, 'bl-job-a'], [other.id, 'bl-job-b']] as const) {
    await sql()`INSERT INTO program_reviewers (program_id, builder_id) VALUES ('bl-del-rev', ${who})`;
    await sql()`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, total, expires_at)
      VALUES (${job}, 'bl-del-rev', ${who}, ${one}, ${NOW}, 1, ${new Date(NOW.getTime() + 30 * DAY)})`;
    await sql()`INSERT INTO screen_applicants (job_id, ref, name, repo_url) VALUES (${job}, 'r1', 'Coffee Pay', 'https://github.com/acme/coffee')`;
    await sql()`INSERT INTO screen_outcomes (job_id, ref, outcome) VALUES (${job}, 'r1', 'rejected')`;
  }
  await deleteBuilder(b.id);
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM program_reviewers WHERE builder_id = ${b.id}`), 0);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM screen_jobs WHERE builder_id = ${b.id}`), 0);
  // L15-18: the program's history stays: the job, its applicant and its outcome, the job tied to no builder.
  const [kept] = await sql()`SELECT program_id, builder_id FROM screen_jobs WHERE id = 'bl-job-a'`;
  assert.deepEqual([kept.program_id, kept.builder_id], ['bl-del-rev', null]);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM screen_applicants WHERE job_id = 'bl-job-a'`), 1);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM screen_outcomes WHERE job_id = 'bl-job-a'`), 1);
  // The program's other reviewer reads the job the deleted one queued (L15-12).
  assert.equal((await jobStatus('bl-job-a', other.id, NOW))?.program_id, 'bl-del-rev');
  // Deleting again, or another delete, changes nothing more.
  await deleteBuilder(b.id);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM screen_outcomes WHERE job_id = 'bl-job-a'`), 1);
  // The other reviewer's rows stay.
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM screen_jobs WHERE builder_id = ${other.id}`), 1);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM screen_applicants WHERE job_id = 'bl-job-b'`), 1);
  assert.equal(await n(sql()`SELECT count(*)::int AS n FROM screen_outcomes WHERE job_id = 'bl-job-b'`), 1);
});

test('B10: unlinkInstallation unlinks only the builder\'s own and marks it; the notice is taken once; a new link clears it', async () => {
  const b = await builder('unl');
  const stranger = await builder('unl2');
  const one = await install();
  await linkInstallation(one, b.id, NOW);
  assert.equal(await unlinkInstallation(one, stranger.id, NOW), false);
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${one}`)[0].builder_id, b.id);
  assert.equal(await takeUnlinkedNotice(one), false);
  assert.equal(await unlinkInstallation(one, b.id, NOW), true);
  const [row] = await sql()`SELECT builder_id, linked_at, unlinked_at FROM installations WHERE id = ${one}`;
  assert.deepEqual([row.builder_id, row.linked_at, (row.unlinked_at as Date).toISOString()], [null, null, NOW.toISOString()]);
  // Reading leaves the mark, so a find that throws before its reply is built keeps the notice for the next one.
  assert.equal(await hasUnlinkedNotice(one), true);
  assert.equal(await hasUnlinkedNotice(one), true);
  assert.equal(await takeUnlinkedNotice(one), true);
  assert.equal(await takeUnlinkedNotice(one), false);
  assert.equal(await hasUnlinkedNotice(one), false);
  // Linked again before any find: no unlinked notice is left to show.
  await linkInstallation(one, b.id, NOW);
  await unlinkInstallation(one, b.id, NOW);
  await linkInstallation(one, b.id, NOW);
  assert.equal((await sql()`SELECT unlinked_at FROM installations WHERE id = ${one}`)[0].unlinked_at, null);
});

test('B15: a win survives an unlink and relink with a skipped row in between; an application beats a later claim', async () => {
  const b = await builder('relink');
  const one = await install();
  await prog('bl-win');
  await prog('bl-app');
  await linkInstallation(one, b.id, NOW);
  await record(ownerKey(one, b.id), 'bl-app', 'applied', { installationId: one, now: NOW });
  await record(ownerKey(one, b.id), 'bl-win', 'applied', { installationId: one, now: NOW });
  await record(ownerKey(one, b.id), 'bl-win', 'won', { installationId: one, amount_usd: 1000, now: NOW });
  assert.equal(await unlinkInstallation(one, b.id, NOW), true);
  const later = new Date(NOW.getTime() + DAY);
  // Unlinked, the same agent skips the program it won and claims the one it applied to.
  await record(ownerKey(one, null), 'bl-win', 'skipped', { now: later });
  await sql()`INSERT INTO applications (owner, installation_id, program_id, status, at, claimed_at, claimed_by)
    VALUES (${ownerKey(one, null)}, ${one}, 'bl-app', 'started', ${later}, ${later}, ${one})`;
  await linkInstallation(one, b.id, new Date(later.getTime() + DAY));
  assert.deepEqual(await rows(`b:${b.id}`), [
    { program_id: 'bl-app', status: 'applied' },
    { program_id: 'bl-win', status: 'won' },
  ]);
  assert.deepEqual(await rows(`i:${one}`), []);
  const [won] = await sql()`SELECT amount_usd FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = 'bl-win'`;
  assert.equal(Number(won.amount_usd), 1000);
});

test('B15: equal statuses keep the newer row; applied beats an older skip from the builder ledger', async () => {
  const b = await builder('relink2');
  const one = await install();
  const two = await install();
  await prog('bl-eq');
  await prog('bl-up');
  await linkInstallation(one, b.id, NOW);
  await record(ownerKey(one, b.id), 'bl-eq', 'skipped', { installationId: one, note: 'old', now: NOW });
  await record(ownerKey(one, b.id), 'bl-up', 'skipped', { installationId: one, now: new Date(NOW.getTime() + 2 * DAY) });
  await record(ownerKey(two, null), 'bl-eq', 'skipped', { note: 'new', now: new Date(NOW.getTime() + DAY) });
  await record(ownerKey(two, null), 'bl-up', 'applied', { now: new Date(NOW.getTime() + DAY) });
  await linkInstallation(two, b.id, NOW);
  assert.deepEqual(await rows(`b:${b.id}`), [
    { program_id: 'bl-eq', status: 'skipped' },
    { program_id: 'bl-up', status: 'applied' },
  ]);
  const [eq] = await sql()`SELECT note FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = 'bl-eq'`;
  assert.equal(eq.note, 'new');
});

test('Review Focus 5 (v6.1.9 N3): a relink never turns a win into a rejection; won beats rejected beats no_result whatever the time', async () => {
  const b = await builder('relink3');
  const one = await install();
  const two = await install();
  for (const id of ['bl-w-b', 'bl-w-i', 'bl-r-nr', 'bl-w-nr']) await prog(id);
  await linkInstallation(one, b.id, NOW);
  const bo = ownerKey(one, b.id);
  const io = ownerKey(two, null);
  const later = new Date(NOW.getTime() + DAY);
  const latest = new Date(NOW.getTime() + 2 * DAY);
  // A win in the builder ledger; a newer rejection in the other.
  await record(bo, 'bl-w-b', 'applied', { installationId: one, now: NOW });
  await record(bo, 'bl-w-b', 'won', { installationId: one, amount_usd: 111, now: NOW });
  await record(io, 'bl-w-b', 'applied', { now: later });
  await record(io, 'bl-w-b', 'rejected', { now: latest });
  // A win in the unlinked ledger; a newer rejection in the builder's.
  await record(io, 'bl-w-i', 'applied', { now: NOW });
  await record(io, 'bl-w-i', 'won', { amount_usd: 222, now: NOW });
  await record(bo, 'bl-w-i', 'applied', { installationId: one, now: later });
  await record(bo, 'bl-w-i', 'rejected', { installationId: one, now: latest });
  // A rejection beats a newer no result.
  await record(bo, 'bl-r-nr', 'applied', { installationId: one, now: NOW });
  await record(bo, 'bl-r-nr', 'rejected', { installationId: one, now: NOW });
  await record(io, 'bl-r-nr', 'applied', { now: later });
  await record(io, 'bl-r-nr', 'no_result', { now: latest });
  // A win beats a newer no result (Task 2 review Minor).
  await record(bo, 'bl-w-nr', 'applied', { installationId: one, now: NOW });
  await record(bo, 'bl-w-nr', 'won', { installationId: one, amount_usd: 333, now: NOW });
  await record(io, 'bl-w-nr', 'applied', { now: later });
  await record(io, 'bl-w-nr', 'no_result', { now: latest });
  await linkInstallation(two, b.id, new Date(latest.getTime() + DAY));
  assert.deepEqual(await rows(`b:${b.id}`), [
    { program_id: 'bl-r-nr', status: 'rejected' },
    { program_id: 'bl-w-b', status: 'won' },
    { program_id: 'bl-w-i', status: 'won' },
    { program_id: 'bl-w-nr', status: 'won' },
  ]);
  const amounts = await sql()`SELECT program_id, amount_usd FROM applications WHERE owner = ${`b:${b.id}`} AND status = 'won' ORDER BY program_id`;
  assert.deepEqual(amounts.map((r) => Number(r.amount_usd)), [111, 222, 333]);
});

test('C51: deleteBuilder marks each linked installation, so its next call says the record was deleted, once', async () => {
  const b = await builder('gone');
  const one = await install();
  await linkInstallation(one, b.id, NOW);
  await deleteBuilder(b.id, NOW);
  assert.equal(await unlinkedReason(one), 'deleted');
  assert.equal(await hasUnlinkedNotice(one), true);
  assert.equal(await takeUnlinkedNotice(one), true);
  assert.equal(await unlinkedReason(one), null);
  // A plain unlink reads as unlinked.
  const c = await builder('gone2');
  const two = await install();
  await linkInstallation(two, c.id, NOW);
  await unlinkInstallation(two, c.id, NOW);
  assert.equal(await unlinkedReason(two), 'unlinked');
});

test('T5-F6 (v6.1.14): on link the stronger row stays and carries the dropped row\'s application id when it has none', async () => {
  const b = await builder('carry');
  const one = await install();
  await prog('bl-carry');
  await linkInstallation(one, b.id, NOW);
  assert.deepEqual(await record(`b:${b.id}`, 'bl-carry', 'applied', { installationId: one, now: NOW }), { ok: true });
  assert.deepEqual(await record(`b:${b.id}`, 'bl-carry', 'won', { installationId: one, amount_usd: 100, now: NOW }), { ok: true });
  // A win from before v6.1.14 has no id.
  await sql()`UPDATE applications SET application_id = NULL WHERE owner = ${`b:${b.id}`} AND program_id = 'bl-carry'`;
  const two = await install();
  assert.deepEqual(await record(`i:${two}`, 'bl-carry', 'applied', { installationId: two, now: new Date(NOW.getTime() + DAY) }), { ok: true });
  const [i] = await sql()`SELECT application_id FROM applications WHERE owner = ${`i:${two}`} AND program_id = 'bl-carry'`;
  await linkInstallation(two, b.id, new Date(NOW.getTime() + DAY));
  const kept = await sql()`SELECT status, application_id FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = 'bl-carry'`;
  assert.deepEqual(kept.map((r) => [r.status, r.application_id]), [['won', i.application_id]]);
  // A kept row with its own id keeps it.
  await prog('bl-carry2');
  assert.deepEqual(await record(`b:${b.id}`, 'bl-carry2', 'applied', { installationId: one, now: NOW }), { ok: true });
  const [own] = await sql()`SELECT application_id FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = 'bl-carry2'`;
  const three = await install();
  assert.deepEqual(await record(`i:${three}`, 'bl-carry2', 'skipped', { installationId: three, now: NOW }), { ok: true });
  await linkInstallation(three, b.id, NOW);
  assert.equal((await sql()`SELECT application_id FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = 'bl-carry2'`)[0].application_id, own.application_id);
});

test('L28-10 (v6.1.16 Task 14, controller ruling): unlink moves nothing and marks the former builder for the duplicate-send check only; a link or the builder\'s delete clears it', async () => {
  const b = await upsertBuilder({ github_id: ++gh, login: 'l28u' + gh, name: null, avatar_url: null }, NOW);
  const i = await install();
  await linkInstallation(i, b.id, NOW);
  await prog('bl-l28');
  assert.deepEqual(await record(`b:${b.id}`, 'bl-l28', 'applied', { installationId: i, now: NOW, project_id: 'name:x' }), { ok: true });
  assert.equal(await unlinkInstallation(i, b.id, NOW), true);
  const former = async () => (await sql()`SELECT former_builder_id AS f FROM installations WHERE id = ${i}`)[0].f;
  assert.equal(await former(), b.id);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${`b:${b.id}`}`)[0].n, 1);
  // The unlinked agent's own ledger is empty and its send of that project is refused, with nothing of the builder's.
  assert.deepEqual(await record(`i:${i}`, 'bl-l28', 'applied', { installationId: i, now: NOW, project_id: 'name:x' }),
    { ok: false, note: 'Already sent from your account; nothing recorded. Sign in again to see it.' });
  assert.equal((await summary(`i:${i}`, [], NOW)).applied, 0);
  await deleteBuilder(b.id, NOW);
  assert.equal(await former(), null);
  const b2 = await upsertBuilder({ github_id: ++gh, login: 'l28v' + gh, name: null, avatar_url: null }, NOW);
  const j = await install();
  await linkInstallation(j, b2.id, NOW);
  await unlinkInstallation(j, b2.id, NOW);
  await linkInstallation(j, b2.id, NOW);
  assert.equal((await sql()`SELECT former_builder_id AS f FROM installations WHERE id = ${j}`)[0].f, null);
});

test('v6.1.16 Task 9 N5 (v6.1.17 Task 3): an unlink takes that agent\'s results-question markers for the builder; its other markers and other agents\' stay', async () => {
  const b = await builder('unl-asks');
  const one = await install();
  const two = await install();
  await linkInstallation(one, b.id, NOW);
  await linkInstallation(two, b.id, NOW);
  const owner = `b:${b.id}`;
  await sql()`INSERT INTO outcome_asks (installation_id, owner, program_id, asked_on) VALUES
    (${one}, ${owner}, 'asks-a', '2026-11-01'), (${two}, ${owner}, 'asks-a', '2026-11-01'), (${one}, ${`i:${one}`}, 'asks-b', '2026-11-01')`;
  assert.equal(await unlinkInstallation(one, b.id, NOW), true);
  const left = await sql()`SELECT installation_id, owner FROM outcome_asks WHERE program_id LIKE 'asks-%' ORDER BY installation_id, owner`;
  assert.deepEqual(left.map((r) => [Number(r.installation_id), r.owner]), [[one, `i:${one}`], [two, owner]]);
  await sql()`DELETE FROM outcome_asks WHERE program_id LIKE 'asks-%'`;
});

// ---- v6.1.22 final fix round (C1, I1, M5): an earlier-round win is never lost, and the builder's counts keep it ----

const L47 = { title: 'L47 Round Grant', max_award_usd: 5000 };
const roundProg = async (id: string, status: 'upcoming' | 'active', over: Record<string, unknown> = {}) =>
  upsertProgram(programFixture({ id, ...L47, status, ...(status === 'upcoming' ? { opens_note: 'Soon' } : {}), ...over }), 'file', NOW);
type RoundRow = { status: string; amount_usd: string | null; claimed_by: number | null; earlier_win: { amount_usd: number; amounts: Record<string, number>; moved?: true } | null };
const roundRow = async (owner: string, id: string): Promise<RoundRow | undefined> =>
  (await sql()<RoundRow[]>`SELECT status, amount_usd, claimed_by, earlier_win FROM applications WHERE owner = ${owner} AND program_id = ${id}`)[0];
/** An outside win while the program is upcoming, then the program opens and a start moves the win off the row. */
async function movedWin(owner: string, id: string, installationId: number, startedAt: Date) {
  await roundProg(id, 'upcoming');
  assert.deepEqual(await record(owner, id, 'won', { amount_usd: 1000, outsideWin: true, installationId, now: new Date(startedAt.getTime() - DAY) }), { ok: true, outside: true });
  await roundProg(id, 'active');
  const { claim } = await import('./claims');
  assert.deepEqual(await claim(owner, id, null, installationId, startedAt), { ok: true });
  assert.equal((await roundRow(owner, id))?.earlier_win?.moved, true);
}
const isRestored = async (owner: string, id: string) => {
  const r = await roundRow(owner, id);
  assert.ok(r, 'the row is kept');
  assert.deepEqual([r.status, Number(r.amount_usd), r.claimed_by, r.earlier_win?.moved, r.earlier_win?.amounts], ['won', 1000, null, undefined, { USD: 1000 }]);
};

test('C1 (v6.1.22 final fix round): the stale release puts a claim over an earlier-round win back to that win', async () => {
  const { releaseStale } = await import('./claims');
  const i = await install();
  const owner = `i:${i}`;
  await movedWin(owner, 'l47-c1-stale', i, new Date(NOW.getTime() - 2 * DAY));
  const released = await releaseStale(owner, NOW);
  assert.deepEqual(released.map((r) => [r.program_id, r.title, r.ask]), [['l47-c1-stale', 'L47 Round Grant', undefined]]);
  await isRestored(owner, 'l47-c1-stale');
  const s = await summary(owner, [], NOW);
  assert.deepEqual([s.applied, s.won, s.won_usd], [1, 1, 1000]);
  // A plain stale claim with no earlier win still goes.
  await prog('l47-c1-plain');
  const { claim } = await import('./claims');
  await claim(owner, 'l47-c1-plain', null, i, new Date(NOW.getTime() - 2 * DAY));
  await releaseStale(owner, NOW);
  assert.equal(await roundRow(owner, 'l47-c1-plain'), undefined);
});

test('C1: an unlink puts its claim over an earlier-round win back to that win', async () => {
  const b = await builder('c1-unlink');
  const i = await install();
  await linkInstallation(i, b.id, NOW);
  const owner = `b:${b.id}`;
  await movedWin(owner, 'l47-c1-unlink', i, NOW);
  assert.equal(await unlinkInstallation(i, b.id, NOW), true);
  await isRestored(owner, 'l47-c1-unlink');
});

test('C1: skip then unskip over a moved earlier-round win puts that win back', async () => {
  const i = await install();
  const owner = `i:${i}`;
  await movedWin(owner, 'l47-c1-skip', i, NOW);
  assert.equal((await record(owner, 'l47-c1-skip', 'skipped', { installationId: i, now: NOW })).ok, true);
  assert.equal((await roundRow(owner, 'l47-c1-skip'))?.status, 'skipped');
  assert.equal((await record(owner, 'l47-c1-skip', 'unskip', { installationId: i, now: NOW })).ok, true);
  await isRestored(owner, 'l47-c1-skip');
});

test('C1: a relink merge never loses an earlier-round win', async () => {
  // The claim over the win meets the builder's newer skip: the win comes back and is kept.
  const b = await builder('c1-relink');
  const i = await install();
  await movedWin(`i:${i}`, 'l47-c1-merge', i, NOW);
  const j = await install();
  await sql()`INSERT INTO applications (owner, installation_id, program_id, status, at) VALUES (${`b:${b.id}`}, ${j}, 'l47-c1-merge', 'skipped', ${new Date(NOW.getTime() + 1000)})`;
  await linkInstallation(i, b.id, new Date(NOW.getTime() + 2000));
  await isRestored(`b:${b.id}`, 'l47-c1-merge');
  // It meets the builder's newer send instead: the send is kept and carries the win, moved (counted once more).
  const b2 = await builder('c1-relink-2');
  const k = await install();
  await movedWin(`i:${k}`, 'l47-c1-merge2', k, NOW);
  await sql()`INSERT INTO applications (owner, installation_id, program_id, status, at, sent_at) VALUES (${`b:${b2.id}`}, ${j}, 'l47-c1-merge2', 'applied', ${new Date(NOW.getTime() + 1000)}, ${new Date(NOW.getTime() + 1000)})`;
  await linkInstallation(k, b2.id, new Date(NOW.getTime() + 2000));
  const r = await roundRow(`b:${b2.id}`, 'l47-c1-merge2');
  assert.deepEqual([r?.status, r?.earlier_win?.moved, r?.earlier_win?.amounts], ['applied', true, { USD: 1000 }]);
  const s = await summary(`b:${b2.id}`, [], NOW);
  assert.deepEqual([s.applied, s.won, s.won_usd, s.pending], [2, 1, 1000, 1]);
});

test('I1 (v6.1.22 final fix round): the builder\'s own counts and applications keep a moved earlier win once', async () => {
  const { applicationsOf, applicationsLine } = await import('../v5/ledger');
  const i = await install();
  const owner = `i:${i}`;
  await movedWin(owner, 'l47-i1', i, NOW);
  let s = await summary(owner, [], NOW);
  assert.deepEqual([s.applied, s.won, s.won_usd, s.pending], [1, 1, 1000, 0]);
  assert.equal(applicationsLine(await applicationsOf(owner), NOW), 'Your applications: L47 Round Grant (won $1,000).');
  // The new round is sent: two sent, one won, one waiting; the earlier win listed once beside the new send.
  assert.equal((await record(owner, 'l47-i1', 'applied', { installationId: i, now: NOW })).ok, true);
  s = await summary(owner, [], NOW);
  assert.deepEqual([s.applied, s.won, s.won_usd, s.pending], [2, 1, 1000, 1]);
  const apps = await applicationsOf(owner);
  assert.deepEqual(apps.map((a) => [a.status, a.amount]), [['waiting', null], ['won', '$1,000']]);
  assert.equal(apps.some((a) => a.earlier), false);
});

test('M5 (v6.1.22 final fix round): a reported project name is cut at 60 in the sent ask', async () => {
  const { askSent } = await import('../v5/ledger');
  const i = await install();
  const owner = `i:${i}`;
  await upsertProgram(programFixture({ id: 'l47-m5', title: 'L47 Builder Sent', submit: 'builder', max_award_usd: 5000 }), 'file', NOW);
  const long = 'A'.repeat(50) + ' ' + 'B'.repeat(50);
  await sql()`INSERT INTO project_reports (owner, project_key, report, at) VALUES (${owner}, 'name:longproject', ${sql().json({ name: long })}, ${NOW})`;
  const { claim } = await import('./claims');
  await claim(owner, 'l47-m5', 'name:longproject', i, new Date(NOW.getTime() - 3 * DAY));
  const [a] = await askSent(owner, [], NOW);
  assert.equal(a.project, 'A'.repeat(50) + ' ' + 'B'.repeat(9));
  assert.equal(Array.from(a.project ?? '').length, 60);
});
