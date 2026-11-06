import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { record, summary } from '../v5/ledger';
import { getProgram, upsertProgram } from '../v5/programs';
import { deleteBuilder, getBuilder, linkInstallation, ownerKey, upsertBuilder } from './builders';
import { createSession } from './sessions';
import { createLinkCode } from './link-routes';

after(() => sql().end());

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
let gh = 900_000;
const install = async () =>
  ((await sql()`INSERT INTO installations (token_hash) VALUES (${'builders-' + Math.random()}) RETURNING id`)[0].id as number);
const prog = async (id: string) => {
  await upsertProgram(programFixture({ id, max_award_usd: 5000 }), 'file', NOW);
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
  await record(ownerKey(one, null), 'bl-dup', 'gap_done', { item: 'license', now: NOW });
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
  await record(ownerKey(two, null), 'bl-dup', 'gap_done', { item: 'license', now: later });
  assert.deepEqual(await linkInstallation(two, b.id, later), { migrated: 1 });
  assert.deepEqual(await rows(`b:${b.id}`), [
    { program_id: 'bl-a', status: 'applied' },
    { program_id: 'bl-b', status: 'skipped' },
    { program_id: 'bl-dup', status: 'rejected' },
  ]);
  const hist = (await sql()`SELECT count(*)::int AS n FROM application_history WHERE owner = ${`b:${b.id}`}`)[0].n;
  assert.equal(hist, 7);
  const gaps = await sql()`SELECT item FROM gaps_done WHERE owner = ${`b:${b.id}`}`;
  assert.deepEqual(gaps.map((g) => g.item), ['license']);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE owner LIKE 'i:%' AND owner IN (${`i:${one}`}, ${`i:${two}`})`)[0].n, 0);
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
  await linkInstallation(one, b.id, NOW);
  await record(ownerKey(one, b.id), 'bl-del', 'gap_done', { installationId: one, item: 'x', now: NOW });
  await createSession(b.id, NOW);
  await createLinkCode(one, NOW);
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
