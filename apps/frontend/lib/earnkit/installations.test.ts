import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { testInstallationIds } from './installations';

test('Ruling 6 (plan): EARNKIT_TEST_INSTALLATIONS', () => {
  const warns: string[] = [];
  const w = (l: string) => warns.push(l);
  assert.deepEqual(testInstallationIds({}, w), []);
  assert.deepEqual(testInstallationIds({ EARNKIT_TEST_INSTALLATIONS: ' 12, 7 ,12,,' }, w), [7, 12]);
  assert.equal(warns.length, 0);
  assert.deepEqual(testInstallationIds({ EARNKIT_TEST_INSTALLATIONS: '5,abc,-3,9999999999,0,1.5,sk_live_secret' }, w), [5]);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /ignored 6 malformed ids \(position 2, 3, 4, 5, 6, 7\)/);
  assert.doesNotMatch(warns[0], /abc|sk_live|secret/, 'never echoes the text');
  testInstallationIds({ EARNKIT_TEST_INSTALLATIONS: '5,abc,-3,9999999999,0,1.5,sk_live_secret' }, w);
  assert.equal(warns.length, 1, 'one warning per distinct value');
});

test('8.5 v2.10 item 3: setWorkingOn is true only when it adds the program', { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' }, async () => {
  const { sql } = await import('./db');
  const { setWorkingOn } = await import('./installations');
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t8-working-${process.pid}-${Date.now()}`}) RETURNING id`;
  assert.equal(await setWorkingOn(id, 'arc', true), true);
  assert.equal(await setWorkingOn(id, 'arc', true), false, 'already there');
  assert.equal(await setWorkingOn(id, 'base', true), true, 'another program');
  assert.equal(await setWorkingOn(id, 'arc', false), false, 'removing is never "added"');
  assert.equal(await setWorkingOn(id, 'arc', true), true, 'added again after removal');
  const [row] = await sql()<{ working_on: string[] }[]>`SELECT working_on FROM installations WHERE id = ${id}`;
  assert.deepEqual(row.working_on, ['base', 'arc']);
  assert.equal(await setWorkingOn(-1, 'arc', true), false, 'no installation');
});

after(async () => {
  const { sql } = await import('./db');
  if (process.env.DATABASE_URL) await sql().end();
});
