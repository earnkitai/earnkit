import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, flagOn, flagsOn } from './flags';

test('the flag names of the v3.8 first ship, in order', () => {
  assert.deepEqual([...FLAGS], ['auto_live', 'x_signin', 'private_rows', 'track_v2', 'draft_check', 'form', 'reply_fields', 'copy_v38', 'screen_v2']);
});

test('unset or empty EARNKIT_FLAGS turns every flag off', () => {
  for (const env of [{}, { EARNKIT_FLAGS: '' }, { EARNKIT_FLAGS: ' , ,' }]) {
    assert.deepEqual(flagsOn(env), []);
    for (const f of FLAGS) assert.equal(flagOn(f, env), false);
  }
});

test('a comma list turns on the named flags, trimmed and case-insensitive, each once, in FLAGS order', () => {
  const env = { EARNKIT_FLAGS: ' Track_V2 ,auto_live,track_v2,, form ' };
  assert.deepEqual(flagsOn(env), ['auto_live', 'track_v2', 'form']);
  assert.equal(flagOn('track_v2', env), true);
  assert.equal(flagOn('x_signin', env), false);
});

test('unknown names are ignored and turn nothing on', () => {
  const env = { EARNKIT_FLAGS: 'launch,all,*,auto-live,auto_live_v2,copy_v38' };
  assert.deepEqual(flagsOn(env), ['copy_v38']);
});

test('the test guard clears EARNKIT_FLAGS, so no test inherits a flag from the shell', () => {
  assert.equal(process.env.EARNKIT_FLAGS, undefined);
  assert.deepEqual(flagsOn(), []);
});
