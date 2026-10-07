import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowState, scrollStep } from '../../app/components/sections/carousel';

// v2.8 Ruling 20 (plan): the carousel's scroll math, pure (no DOM).
const at = (scrollLeft: number, dir: 1 | -1) => scrollStep({ scrollLeft, clientWidth: 1000, scrollWidth: 2400, cardWidth: 320, gap: 16, dir });

test('v2.8 Ruling 20: scrollStep moves one card and its gap, clamped to the ends', () => {
  assert.equal(at(0, 1), 336);
  assert.equal(at(336, 1), 672);
  assert.equal(at(672, -1), 336);
  assert.equal(at(2064, 1), 1400); // past the end: the last scrollLeft
  assert.equal(at(100, -1), 0); // before the start: 0
  assert.equal(at(1400, 1), 1400);
  // Nothing to scroll: always 0.
  assert.equal(scrollStep({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 800, cardWidth: 320, gap: 16, dir: 1 }), 0);
});

test('v2.8 Ruling 20: arrowState disables each arrow at its end, and both when nothing overflows', () => {
  assert.deepEqual(arrowState({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 2400 }), { prev: false, next: true });
  assert.deepEqual(arrowState({ scrollLeft: 500, clientWidth: 1000, scrollWidth: 2400 }), { prev: true, next: true });
  assert.deepEqual(arrowState({ scrollLeft: 1400, clientWidth: 1000, scrollWidth: 2400 }), { prev: true, next: false });
  // Sub-pixel rounding at the end still counts as the end.
  assert.deepEqual(arrowState({ scrollLeft: 1399.5, clientWidth: 1000, scrollWidth: 2400 }), { prev: true, next: false });
  assert.deepEqual(arrowState({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 1000 }), { prev: false, next: false });
  assert.deepEqual(arrowState({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 600 }), { prev: false, next: false });
});
