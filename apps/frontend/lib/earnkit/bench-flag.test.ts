import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_FLAG, benchEnabled } from './builder-score-flag';

test('1.1 the Bench is on only with the score flag and EARNKIT_BENCH=on', () => {
  assert.equal(BENCH_FLAG, 'EARNKIT_BENCH');
  assert.equal(benchEnabled({}), false);
  assert.equal(benchEnabled({ EARNKIT_BENCH: 'on' }), false, 'needs the score flag');
  assert.equal(benchEnabled({ EARNKIT_BUILDER_SCORE: 'on' }), false);
  assert.equal(benchEnabled({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'yes' }), false, 'exactly "on"');
  assert.equal(benchEnabled({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on' }), true);
});

test('1.2 the test guard clears the switch (flag off is the default in every test)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./fixtures/test-guard.ts', import.meta.url), 'utf8');
  assert.match(src, /'EARNKIT_BENCH'/);
  assert.equal(process.env.EARNKIT_BENCH, undefined);
});
