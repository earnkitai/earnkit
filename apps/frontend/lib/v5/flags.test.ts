import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, PREVIEW_FLAGS, flagOn, flagsOn } from './flags';

test('the flag names of the v3.8 first ship, in order', () => {
  assert.deepEqual([...FLAGS], ['auto_live', 'x_signin', 'private_rows', 'track_v2', 'draft_check', 'form', 'reply_fields', 'copy_v38', 'screen_v2', 'install_signin']);
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
  // v3.8 flags-on suite: the guard clears it; only the flags-on preload (fixtures/flags-on.ts) sets it after, to exactly PREVIEW_FLAGS.
  const preloaded = process.env.EARNKIT_FLAGS === PREVIEW_FLAGS.join(',');
  assert.equal(process.env.EARNKIT_FLAGS, preloaded ? PREVIEW_FLAGS.join(',') : undefined);
  assert.deepEqual(flagsOn(), preloaded ? FLAGS.filter((f) => PREVIEW_FLAGS.includes(f)) : []);
});
