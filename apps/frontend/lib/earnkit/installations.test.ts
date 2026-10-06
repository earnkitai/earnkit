import { test } from 'node:test';
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
