import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { builderOf, cleanClientName, connectInstallation, lastGaps, lastProjectKey, markFind, rememberProject, saveInstallation } from './installations';
import { linkInstallation, upsertBuilder } from '../v6/builders';

after(() => sql().end());

const NOW = new Date('2026-11-06T12:00:00Z');

test('connectInstallation returns builderId null before linking and the builder after', async () => {
  const token = 'inst-' + Math.random();
  const id = await saveInstallation(token, 'Test Agent');
  assert.deepEqual(await connectInstallation(token), { id, builderId: null, audience: null });
  assert.equal(await builderOf(id), null);
  const b = await upsertBuilder({ github_id: 555_001, login: 'lin', name: null, avatar_url: null }, NOW);
  await linkInstallation(id, b.id, NOW);
  assert.deepEqual(await connectInstallation(token), { id, builderId: b.id, audience: null });
  assert.equal(await builderOf(id), b.id);
  assert.equal(await connectInstallation('no-such-token'), null);
  assert.equal(await builderOf(2 ** 30), null);
});

test('markFind keeps the project of a find with one; a find without leaves it (v6.1.10, L1c-1)', async () => {
  const id = await saveInstallation('pk-' + Math.random());
  assert.equal(await lastProjectKey(id), '');
  await markFind(id, NOW, {}, 'https://github.com/acme/a');
  assert.equal(await lastProjectKey(id), 'https://github.com/acme/a');
  await markFind(id, new Date(NOW.getTime() + 60_000));
  assert.equal(await lastProjectKey(id), 'https://github.com/acme/a');
  await markFind(id, new Date(NOW.getTime() + 120_000), undefined, 'name:b app');
  assert.equal(await lastProjectKey(id), 'name:b app');
});

test('final round (v6.1.10): the last gaps and their project are written together; another project drops the gaps', async () => {
  const id = await saveInstallation('pg-' + Math.random());
  const g = { what: 'add Base Builder Codes', kind: 'builder_codes', item: 'builder_codes' };
  await markFind(id, NOW, { 'p-1': g }, 'https://github.com/acme/a');
  assert.deepEqual([await lastProjectKey(id), await lastGaps(id)], ['https://github.com/acme/a', { 'p-1': g }]);
  // The same project again (a one-program find of it): its gaps stay.
  await rememberProject(id, 'https://github.com/acme/a');
  assert.deepEqual(await lastGaps(id), { 'p-1': g });
  // A one-program or category find of another project: the gaps were A's, so they go with the key change.
  await rememberProject(id, 'name:b app');
  assert.deepEqual([await lastProjectKey(id), await lastGaps(id)], ['name:b app', {}]);
  await markFind(id, NOW, { 'p-1': g }, 'https://github.com/acme/a');
  await markFind(id, new Date(NOW.getTime() + 60_000), undefined, 'name:b app');
  assert.deepEqual([await lastProjectKey(id), await lastGaps(id)], ['name:b app', {}]);
});

test("markFind keeps the last find's gaps; lastGaps reads them, {} before any find", async () => {
  const id = await saveInstallation('gaps-' + Math.random());
  assert.deepEqual(await lastGaps(id), {});
  const g = { what: 'add Base Builder Codes', kind: 'builder_codes', item: 'builder_codes' };
  await markFind(id, NOW, { 'p-1': g });
  assert.deepEqual(await lastGaps(id), { 'p-1': g });
  // No gaps passed (a category-filtered find, v6.1.7 C24a): the time moves, the gaps stay.
  await markFind(id, new Date(NOW.getTime() + 60_000));
  assert.deepEqual(await lastGaps(id), { 'p-1': g });
  await markFind(id, new Date(NOW.getTime() + 120_000), {});
  assert.deepEqual(await lastGaps(id), {});
});

test('an agent name is cleaned at registration: control and format characters out, 60 characters (v6.1.7 C1)', async () => {
  const id = await saveInstallation('name-' + Math.random(), `  Evil\u202Eagent\u200B\u0007 \n ${'x'.repeat(100)}  `);
  const [row] = await sql()<{ client_name: string }[]>`SELECT client_name FROM installations WHERE id = ${id}`;
  assert.equal(row.client_name, `Evilagent ${'x'.repeat(100)}`.slice(0, 60));
  assert.equal(row.client_name.length, 60);
  assert.equal(cleanClientName('\u202E\u200B  '), null);
  assert.equal(cleanClientName(null), null);
  assert.equal(cleanClientName('Claude Code'), 'Claude Code');
  // 60 characters, not 60 UTF-16 units: an astral character is never cut in half.
  assert.equal(cleanClientName('\u{1F600}'.repeat(70)), '\u{1F600}'.repeat(60));
});

test('v6.1.16 Task 5: a revoked installation never connects; its audience is kept', async () => {
  const { revokeInstallation } = await import('./installations');
  const token = 'rev-' + Math.random();
  const id = await saveInstallation(token, 'Agent', 'https://earnkit.test/mcp');
  assert.deepEqual(await connectInstallation(token), { id, builderId: null, audience: 'https://earnkit.test/mcp' });
  await revokeInstallation(token);
  assert.equal(await connectInstallation(token), null);
  const [row] = await sql()`SELECT revoked_at FROM installations WHERE id = ${id}`;
  assert.ok(row.revoked_at instanceof Date);
});
