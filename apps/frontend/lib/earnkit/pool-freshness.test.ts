import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { poolChanged } from './profile-cache';

/**
 * Prod hotfix 2026-10-19: the profile said "#1 of 1" while the home page said "Nobody on the leaderboard yet" (its
 * cached read was taken while nobody was ranked, 10 minutes, served stale until a visit after that). Every cache of
 * the pool now carries PROFILE_TAG, and a pool change (a rescore that moves a score, rank or hold; a written ship-log
 * week) expires them at once through poolChanged.
 */
const src = (p: string) => readFileSync(join(import.meta.dirname, p), 'utf8');

test('hotfix: the landing, feed and leaderboard caches carry PROFILE_TAG', () => {
  assert.match(src('../../app/lib/landing-cache.ts'), /unstable_cache\(\(\) => readLanding\(\), \[key\], \{ revalidate: 600, tags: \[PROFILE_TAG\] \}\)/);
  assert.match(src('../../app/feed/page.tsx'), /\['feed-v213'\], \{ revalidate: 300, tags: \[PROFILE_TAG\] \}/);
  assert.match(src('../../app/leaderboard/bench-load.ts'), /tags: \[PROFILE_TAG\]/);
});

test('hotfix: a rescore that moves the pool and a written ship-log week expire them (poolChanged)', () => {
  const score = src('person-score.ts');
  assert.match(score, /const changed = !cur \|\| cur\.score !== out\.score \|\| cur\.ranked !== out\.ranked \|\| reason !== null;/);
  assert.match(score, /if \(result\.changed\) poolChanged\(\);/);
  const weeks = src('week-facts.ts');
  assert.equal(weeks.match(/if \(rows > 0\) poolChanged\(\);/g)?.length, 2, 'the backfill and the weekly job');
  // Outside a Next request there is no cache: it does nothing and never throws.
  assert.doesNotThrow(() => poolChanged());
});
