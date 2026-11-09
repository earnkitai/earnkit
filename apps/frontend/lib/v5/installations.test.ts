import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { builderOf, connectInstallation, lastGaps, markFind, saveInstallation } from './installations';
import { linkInstallation, upsertBuilder } from '../v6/builders';

after(() => sql().end());

const NOW = new Date('2026-11-06T12:00:00Z');

test('connectInstallation returns builderId null before linking and the builder after', async () => {
  const token = 'inst-' + Math.random();
  const id = await saveInstallation(token, 'Test Agent');
  assert.deepEqual(await connectInstallation(token), { id, builderId: null });
  assert.equal(await builderOf(id), null);
  const b = await upsertBuilder({ github_id: 555_001, login: 'lin', name: null, avatar_url: null }, NOW);
  await linkInstallation(id, b.id, NOW);
  assert.deepEqual(await connectInstallation(token), { id, builderId: b.id });
  assert.equal(await builderOf(id), b.id);
  assert.equal(await connectInstallation('no-such-token'), null);
  assert.equal(await builderOf(2 ** 30), null);
});

test("markFind keeps the last find's gaps; lastGaps reads them, {} before any find", async () => {
  const id = await saveInstallation('gaps-' + Math.random());
  assert.deepEqual(await lastGaps(id), {});
  const g = { what: 'add Base Builder Codes', kind: 'builder_codes', item: 'builder_codes' };
  await markFind(id, NOW, { 'p-1': g });
  assert.deepEqual(await lastGaps(id), { 'p-1': g });
  // No gaps passed (a filtered find, v6.1.7 C24): the time moves, the gaps stay.
  await markFind(id, new Date(NOW.getTime() + 60_000));
  assert.deepEqual(await lastGaps(id), { 'p-1': g });
  await markFind(id, new Date(NOW.getTime() + 120_000), {});
  assert.deepEqual(await lastGaps(id), {});
});
