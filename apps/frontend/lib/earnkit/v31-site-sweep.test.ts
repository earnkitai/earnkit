import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { humanStrings } from './human-text';

/**
 * v3.1 site Task 11: the whole-site sweep. (a) every literal string in the files Tasks 1 to 10 created or rewrote keeps
 * the copy rules; (b) nothing under app/ imports a component the redesign deleted; (c) no link to the old programs list;
 * (d) every component with a transition, an animation or a pointer transform has a reduced-motion path.
 */
const FRONT = join(import.meta.dirname, '..', '..');
const APP = join(FRONT, 'app');
const read = (rel: string) => readFileSync(join(FRONT, rel), 'utf8');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

/** The page files Tasks 1 to 10 created or rewrote (git diff dd1ae3cb..c1ad215c), plus the two copy modules they read. */
const SITE_FILES = [
  'app/HomeView.tsx',
  'app/[handle]/handle-view.tsx',
  'app/[handle]/BenchProfileView.tsx',
  'app/[handle]/site/ActivityCard.tsx',
  'app/[handle]/site/HeroCard.tsx',
  'app/[handle]/site/HighlightsCard.tsx',
  'app/[handle]/site/ScoreCard.tsx',
  'app/[handle]/site/StreakCard.tsx',
  'app/[handle]/site/TokenCard.tsx',
  'app/components/common/Footer.tsx',
  'app/components/common/Header.tsx',
  'app/components/sections/AddToAgent.tsx',
  'app/components/landing/Activity.tsx',
  'app/components/landing/Hero.tsx',
  'app/components/landing/HeroArt.tsx',
  'app/components/landing/Opportunities.tsx',
  'app/components/landing/Steps.tsx',
  'app/components/site/AgentMarks.tsx',
  'app/components/site/FooterLight.tsx',
  'app/components/site/Money.tsx',
  'app/components/site/NavLinks.tsx',
  'app/components/site/Pager.tsx',
  'app/components/site/ScoreText.tsx',
  'app/components/site/SegTabs.tsx',
  'app/components/site/Serif.tsx',
  'app/components/site/XHandle.tsx',
  'app/components/site/ui.ts',
  'app/components/site/useReducedMotion.ts',
  'app/docs/DocsView.tsx',
  'app/docs/InstallCard.tsx',
  'app/docs/page.tsx',
  'app/feed/FeedRow.tsx',
  'app/feed/FeedStats.tsx',
  'app/feed/FeedView.tsx',
  'app/feed/page.tsx',
  'app/layout.tsx',
  'app/leaderboard/BenchRowItem.tsx',
  'app/leaderboard/BenchView.tsx',
  'app/leaderboard/Podium.tsx',
  'app/leaderboard/page.tsx',
  'app/not-found.tsx',
  'app/programs/[id]/GuideView.tsx',
  'app/terms/page.tsx',
  'lib/earnkit/site-copy.ts',
  'lib/earnkit/docs-copy.ts',
];

test('(a) every literal string in the Tasks 1 to 10 files keeps the copy rules: no em dash, banned words, caps, "builders ... this week", "points" or "Originality"', () => {
  const rules: [string, RegExp][] = [
    ['em dash', /\u2014/],
    ['banned word', /community round|\braise\b|\braising\b|\bfundrais|EARN points|Shipping points|What builders shipped|\bthe Bench\b/i],
    ['all-caps word', /\b[A-Z]{3,}\b(?<!\b(?:USDC|JSON|MCP|URL)\b)/],
    ['builders then this week', /builders[\s\S]{0,20}this week/i],
    ['points', /\bpoints\b/i],
    ['Originality', /originality/i],
  ];
  let swept = 0;
  for (const f of SITE_FILES)
    for (const { text, line } of humanStrings(f, read(f))) {
      swept++;
      for (const [label, r] of rules) assert.doesNotMatch(text, r, `${label} at ${f}:${line}: "${text}"`);
    }
  assert.ok(swept > 100, `swept ${swept} strings`);
});

test('(b) no file under app/ imports a component the redesign deleted', () => {
  const gone = ['MoneyTab', 'ProjectTab', 'FilterChip', 'FeaturedCard', 'BenchTop', 'FeedRows', 'ProgramCards', 'ProgramRow', 'BackedBy'];
  for (const p of walk(APP)) {
    const src = readFileSync(p, 'utf8');
    for (const name of gone)
      assert.doesNotMatch(src, new RegExp(`import[^;]*from\\s+['"][^'"]*/${name}['"]`), `${relative(FRONT, p)} imports ${name}`);
  }
});

test('(c) no href="/programs" (exact) under app/ or in brand-page.ts', () => {
  const exact = /href=\{?\s*["'`]\/programs["'`]/;
  for (const p of walk(APP)) assert.doesNotMatch(readFileSync(p, 'utf8'), exact, relative(FRONT, p));
  const brand = read('lib/earnkit/brand-page.ts');
  assert.doesNotMatch(brand, /href=\\?["']\/programs\\?["']/);
  assert.doesNotMatch(brand, exact);
});

test('(d) every component with a transition, an animation or a pointer transform has a reduced-motion path', () => {
  /** A class token that moves: transition*, animate-*, the drift, pulse and twinkle layers. */
  const moving = /(?<![\w:-])(?:transition(?:-[a-z]+)?|animate-[a-z-]+|ek-drift|ek-pulse|ek-twinkle)(?![\w-])/;
  const pointerTransform = /onPointerMove|onMouseMove|addEventListener\(\s*['"]pointermove/;
  const offenders: string[] = [];
  for (const p of walk(APP)) {
    const src = readFileSync(p, 'utf8');
    const reduced = /motion-reduce:/.test(src) || /useReducedMotion\(/.test(src);
    if (reduced) continue;
    // A token behind motion-safe: is the reduced-motion path for that token; anything else needs one in the file.
    const strings = humanStrings(p, src).map((s) => s.text);
    const bare = strings.some((s) => s.split(/\s+/).some((tok) => moving.test(tok)));
    if (bare || pointerTransform.test(src)) offenders.push(relative(FRONT, p));
  }
  assert.deepEqual(offenders, [], 'transition, animation or pointer transform with no motion-reduce: and no useReducedMotion()');
});
