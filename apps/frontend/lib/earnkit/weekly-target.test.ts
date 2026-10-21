import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScoreV2, weekGains, type Ship } from './score-v2';
import { weekStartLine, weeklyTarget, type TargetIn } from './weekly-target';
import { NOTE_LINE, momentLines, momentReady, shareLink, shareText, titleHasLink, type LastWeek } from './weekly-moment';
import { isoWeekOf } from './weeks';

/** Launch ready L5 (the weekly target) and L6 (the weekly moment's lines and share link): the pure parts. */
const NOW = new Date('2026-10-21T12:00:00Z'); // a Wednesday
const WEEK = 7 * 86_400_000;
const weeksAgo = (ages: number[]) => ages.map((i) => isoWeekOf(new Date(NOW.getTime() - i * WEEK)));
const parts = (ages: number[], ships: Ship[] = []) => computeScoreV2({ ships, commitWeeks: weeksAgo(ages) }, NOW).parts;
const site: Ship = { key: 'site:kit.app', kind: 'site' };
const G = { active: false, gain: 14, next: 13 };
const t = (o: Partial<TargetIn>, voice: 'reply' | 'page' = 'reply'): string | null => weeklyTarget({ gains: G, score: 50, rank: 3, above: null, ...o }, voice);

test('L5.1 weekGains: this week not yet active gains what shipping now adds; once active, what it added and what next week adds', () => {
  assert.deepEqual(weekGains(parts([1, 2, 3, 5, 7, 9, 11]), NOW), { active: false, gain: 14, next: 14 });
  assert.deepEqual(weekGains(parts([0, 1, 2]), NOW), { active: true, gain: 14, next: 13 });
  assert.deepEqual(weekGains(parts([]), NOW), { active: false, gain: 14, next: 14 });
  // Every week active and live: the score is at its cap of 100, and the week still added 14 (90 x 12 / 78).
  const all = Array.from({ length: 12 }, (_, i) => i);
  assert.equal(computeScoreV2({ ships: [site], commitWeeks: weeksAgo(all) }, NOW).score, 100);
  assert.deepEqual(weekGains(parts(all, [site]), NOW), { active: true, gain: 14, next: 14 });
  // A row scored last week is read as of this week: last week's commits are no longer "this week".
  assert.equal(weekGains(parts([0]), new Date(NOW.getTime() + WEEK))?.active, false);
  assert.equal(weekGains({}, NOW), null);
});

test('L5.1 the target names the rank only: pass the rank above when this week\'s points beat its score, else move toward it', () => {
  assert.equal(t({ score: 50, above: { rank: 2, score: 60 } }), 'Ship code this week to pass #2.');
  assert.equal(t({ score: 40, above: { rank: 2, score: 60 } }), 'Ship code this week to move toward #2.');
  // A tie is not a pass.
  assert.equal(t({ score: 46, above: { rank: 2, score: 60 } }), 'Ship code this week to move toward #2.');
  assert.equal(t({ score: 47, above: { rank: 2, score: 60 } }), 'Ship code this week to pass #2.');
});

test('L5.3 boundaries: #1 holds, no one above, already active, gain 0, outside the pool', () => {
  assert.equal(t({ rank: 1, above: null }), 'Ship code this week to hold #1.');
  // Tied at the top: no one scores higher, so #1 holds too.
  assert.equal(t({ rank: 1, above: null, score: 80 }), 'Ship code this week to hold #1.');
  // This week already has code: no question, whatever is above.
  assert.equal(t({ gains: { active: true, gain: 14, next: 13 }, above: { rank: 1, score: 99 } }), 'Done this week.');
  assert.equal(t({ gains: { active: true, gain: 0, next: 13 } }), 'Done this week.');
  assert.equal(t({ gains: { active: true, gain: 0, next: 0 } }), 'Done this week.');
  assert.equal(t({ gains: { active: false, gain: 0, next: 0 }, rank: 3 }), 'Ship code this week to hold #3.');
  assert.equal(t({ gains: { active: false, gain: 0, next: 0 }, rank: 1 }), 'Ship code this week to hold #1.');
  assert.equal(t({ gains: { active: false, gain: 0, next: 0 }, rank: null }), 'Ship code this week.');
  assert.equal(t({ rank: null, above: null }), 'Ship code this week.');
  for (const s of [t({ rank: 1 }), t({ gains: { active: true, gain: 14, next: 13 } })]) {
    assert.ok(s && !s.includes('?') && !s.includes('—') && !s.includes('–'), s ?? 'null');
  }
});

test('L10 the page voice (L7: the public profile is read by visitors): the rank as a fact, never "Ship code"', () => {
  assert.equal(t({ score: 50, above: { rank: 2, score: 60 } }, 'page'), 'Code this week passes #2.');
  assert.equal(t({ score: 40, above: { rank: 2, score: 60 } }, 'page'), 'Code this week moves toward #2.');
  assert.equal(t({ rank: 1, above: null }, 'page'), 'Code this week holds #1.');
  assert.equal(t({ rank: null, above: null }, 'page'), null, 'no rank, nothing to say on the page');
  assert.equal(t({ gains: { active: true, gain: 14, next: 13 } }, 'page'), 'Shipped this week.');
  assert.equal(t({ gains: { active: false, gain: 0, next: 0 }, rank: 1 }, 'page'), null, 'a week that adds nothing says nothing on the page');
});

test('F4 (n) no target, page line or week-start line contains "+N" or "points", over every shape', () => {
  const gainsShapes = [{ active: true, gain: 14, next: 13 }, { active: true, gain: 0, next: 0 }, { active: false, gain: 14, next: 14 }, { active: false, gain: 0, next: 0 }];
  const places: Partial<TargetIn>[] = [{ rank: null, above: null }, { rank: 1, above: null }, { rank: 3, above: { rank: 2, score: 60 } }, { rank: 3, above: { rank: 2, score: 90 } }];
  for (const gains of gainsShapes) for (const place of places) {
    const full = { gains, score: 50, rank: 3, above: null, ...place } as TargetIn;
    for (const line of [weeklyTarget(full, 'reply'), weeklyTarget(full, 'page'), weekStartLine(full)]) {
      if (line !== null) assert.ok(!/\+\d|points/.test(line), line);
    }
  }
});

test('L6.1 the moment lines: deltas up, down and same; no week before; titles at most 2 on one line; the new week\'s line last', () => {
  const w = (score: number, rank: number) => ({ score, rank, total: 40 });
  const lw = (o: Partial<LastWeek>): LastWeek => ({ monday: '2026-10-12', now: w(72, 3), before: w(66, 5), titles: [], checked: true, approved: false, facts: true, ...o });
  assert.deepEqual(momentLines(lw({ titles: ['Add dark mode', 'Fix the login loop', 'Third'] }), 'This week starts at Shipping 50: ship code to pass #2.'),
    ['Last week you finished at Shipping 72 (+6), #3 (up 2).', 'Add dark mode · Fix the login loop', NOTE_LINE, 'This week starts at Shipping 50: ship code to pass #2.']);
  assert.deepEqual(momentLines(lw({ now: w(60, 7) })), ['Last week you finished at Shipping 60 (-6), #7 (down 2).']);
  assert.deepEqual(momentLines(lw({ now: w(66, 5), titles: ['One'] })), ['Last week you finished at Shipping 66 (same), #5 (same).', 'One', NOTE_LINE]);
  assert.deepEqual(momentLines(lw({ now: w(14, 1), before: null })), ['Last week you finished at Shipping 14, #1.']);
});

test('L6.1b the new week\'s line from the target: pass, behind, hold #1; nothing once this week has code', () => {
  const g = { active: false, gain: 14, next: 13 };
  const t = (o: Partial<TargetIn>) => weekStartLine({ gains: g, score: 50, rank: 3, above: null, ...o });
  assert.equal(t({ above: { rank: 2, score: 60 } }), 'This week starts at Shipping 50: ship code to pass #2.');
  assert.equal(t({ above: { rank: 2, score: 70 } }), 'This week starts at Shipping 50: ship code to move toward #2.');
  assert.equal(t({ above: { rank: 2, score: 64 } }), 'This week starts at Shipping 50: ship code to move toward #2.', 'a tie is not a pass');
  assert.equal(t({ rank: 1 }), 'This week starts at Shipping 50: ship code to hold #1.');
  assert.equal(t({ rank: null }), 'This week starts at Shipping 50: ship code to climb.');
  assert.equal(t({ gains: { active: true, gain: 14, next: 13 } }), null);
  assert.equal(t({ gains: { active: false, gain: 0, next: 0 } }), null);
});

test('L6.1c the moment waits for the ship log: the row checked, or this week\'s Monday 15:00 UTC passed', () => {
  assert.equal(momentReady(false, new Date('2026-10-12T10:00:00Z')), false, 'Monday 10:00, no checked row');
  assert.equal(momentReady(true, new Date('2026-10-12T10:00:00Z')), true, 'Monday 10:00, the row checked');
  assert.equal(momentReady(false, new Date('2026-10-12T15:00:00Z')), true, 'Monday 15:00');
  assert.equal(momentReady(false, new Date('2026-10-12T16:00:00Z')), true, 'Monday 16:00');
  assert.equal(momentReady(false, new Date('2026-10-14T01:00:00Z')), true, 'Wednesday');
});

test('L6.1d a title with a link or a host is never shown in the moment', () => {
  for (const t of ['See https://evil.example', 'Moved docs to www.acme.io', 'Launch on acme.com', 'Point to evil.xyz now', 'ftp://x'])
    assert.equal(titleHasLink(t), true, t);
  // File names, versions and frameworks stay (an @ mention is refused by checkUpdate itself).
  for (const t of ['Add dark mode', 'Fix README.md typo', 'Bump to v1.2.3', 'Use Next.js 15']) assert.equal(titleHasLink(t), false, t);
});

test('L6.2 the share link: an X intent URL whose text is the builder\'s own score and rank, and the profile URL, URL-encoded', () => {
  const w = { score: 72, rank: 3, total: 12 };
  assert.equal(shareText(w), 'My week on EarnKit: Shipping 72 · #3 of 12 builders');
  const link = shareLink('maya_makes', w);
  const u = new URL(link);
  assert.equal(`${u.origin}${u.pathname}`, 'https://x.com/intent/post');
  assert.equal(u.searchParams.get('text'), 'My week on EarnKit: Shipping 72 · #3 of 12 builders');
  assert.equal(u.searchParams.get('url'), 'https://earnkit.com/maya_makes');
  assert.ok(!/\s/.test(link), 'no raw spaces');
  assert.equal(link.match(/https:\/\//g)?.length, 1, 'the profile URL is encoded inside it: one https link');
  assert.ok(link.includes('%C2%B7'), 'the middle dot is encoded');
  // v3.1 F3: under RANK_MIN_POOL ranked builders, the score alone.
  assert.equal(shareText({ score: 90, rank: 1, total: 1 }), 'My week on EarnKit: Shipping 90');
  assert.equal(shareText({ score: 90, rank: 1, total: 10 }), 'My week on EarnKit: Shipping 90 · #1 of 10 builders');
  assert.equal(shareText({ score: 40, rank: 1204, total: 3500 }), 'My week on EarnKit: Shipping 40 · #1,204 of 3,500 builders');
});
