import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { THEME, themeVar } from './theme';
import { brandShell } from './brand-page';
import { PART_COLORS, SCORE_COLORS } from '../../app/[handle]/score-colors';
import { COLUMN, H1, H2, LEDE, NUM, ROW, ROWS, SECTION, SURFACE } from '../../app/components/common/Panel';
import { BTN_PRIMARY, BTN_SECONDARY } from '../../app/components/common/Button';

/**
 * v3 Stage 3 Task 1 (spec 5.8): the flat system's tokens and primitives. A true black page, white type,
 * one accent (Base blue), hairline rows instead of cards. profile-pages.test.ts 10.5 keeps the
 * THEME-to-globals.css mirror and the profile palette's contrast; this file pins the new values, the
 * no-decoration rules (no gradient, no glow, no shadow, no marquee) and the primitives later tasks build on.
 */
const FRONTEND = join(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(join(FRONTEND, p), 'utf8');

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('T1.1 THEME is the flat system: black page, white type, Base blue brand, white-alpha lines; every value is mirrored in globals.css', () => {
  assert.equal(THEME.page, '#000000');
  assert.equal(THEME.pageTop, '#000000', 'no lighter top: the page is one colour');
  assert.equal(THEME.glass, 'rgba(0,0,0,0.85)');
  assert.equal(THEME.surfaceTop, '#0E1116');
  assert.equal(THEME.surface, '#0E1116', 'no surface gradient: both stops are one colour');
  assert.equal(THEME.raised, '#161A22');
  assert.equal(THEME.border, 'rgba(255,255,255,0.12)');
  assert.equal(THEME.borderStrong, 'rgba(255,255,255,0.24)');
  assert.equal(THEME.hairline, 'rgba(255,255,255,0.12)');
  assert.equal(THEME.chip, 'rgba(255,255,255,0.06)');
  assert.equal(THEME.chipHover, 'rgba(255,255,255,0.12)');
  assert.equal(THEME.track, 'rgba(255,255,255,0.10)');
  assert.equal(THEME.glow, 'rgba(0,0,0,0)', 'the glow token is transparent: nothing glows');
  assert.equal(THEME.text, '#FFFFFF');
  assert.equal(THEME.body, '#C9CDD6');
  assert.equal(THEME.muted, '#7E8694');
  assert.equal(THEME.accent, '#3D7BFF');
  assert.equal(THEME.brand, '#0052FF');
  // (a) every THEME value appears in globals.css as --ek-p-<kebab>: <value>;
  const css = read('app/globals.css');
  for (const k of Object.keys(THEME) as (keyof typeof THEME)[])
    assert.match(css, new RegExp(`${themeVar(k)}: ${THEME[k].replace(/[().]/g, '\\$&')};`, 'i'), k);
});

test('T1.2 contrast: text, body and muted are 4.5:1 or more on the page, the surface and the raised spot; white on brand is 4.5:1 or more; the accent reads as text', () => {
  for (const bg of [THEME.page, THEME.surface, THEME.raised])
    for (const t of [THEME.text, THEME.body, THEME.muted, THEME.accent])
      assert.ok(ratio(t, bg) >= 4.5, `${t} on ${bg}: ${ratio(t, bg).toFixed(2)}`);
  assert.ok(ratio(THEME.text, THEME.brand) >= 4.5, `button text: ${ratio(THEME.text, THEME.brand).toFixed(2)}`);
  // The brand fill is a graphic (3:1 on black); as text it is below 4.5, so text in blue uses the accent.
  assert.ok(ratio(THEME.brand, THEME.page) >= 3, 'brand fill on the page');
  assert.ok(ratio(THEME.brand, THEME.page) < 4.5, 'brand is a fill, not a text colour (DESIGN.md)');
});

test('T1.3 globals.css: body is the page colour with no gradient and no glow; no box-shadow outside :focus-visible; selection is brand; the ring draw keeps both reduced-motion rules; the marquee is gone', () => {
  const css = read('app/globals.css');
  assert.doesNotMatch(css, /gradient\(/, 'no gradient anywhere');
  assert.match(css, /body \{[^}]*background-color: var\(--ek-s-page\)/, 'v3.1: the body is the site page token');
  assert.doesNotMatch(css, /body \{[^}]*background-image/, 'the body has no background image');
  // (c) box-shadow is allowed only inside a :focus-visible rule.
  const rules = css.split('}');
  for (const r of rules) if (/box-shadow/.test(r)) assert.match(r, /:focus-visible/, `box-shadow outside :focus-visible: ${r.trim().slice(0, 80)}`);
  assert.match(css, /::selection \{[^}]*background: var\(--ek-p-brand\)/);
  assert.match(css, /@keyframes ek-arc-in/);
  assert.match(css, /\.ek-arc \{\s*animation: ek-arc-in/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*,/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ek-arc \{\s*animation: none;/);
  assert.doesNotMatch(css, /marquee/, 'the Backed by marquee is gone (a static row in Task 2)');
});

test('T1.4 tailwind.config.ts: every colour is a --ek-p-* variable (no raw hex); ek-brand, ek-brand-hover, ek-chip and ek-accent exist; the three old brand hexes are gone', () => {
  const tw = read('tailwind.config.ts');
  const colors = tw.slice(tw.indexOf('colors:'), tw.indexOf('fontFamily:'));
  // (d) no raw hex: the THEME mirror lives in globals.css, not here.
  assert.doesNotMatch(colors, /#[0-9a-f]{3,8}\b/i, 'raw hex in tailwind colors');
  for (const [k, v] of [['ek-brand', 'brand'], ['ek-brand-hover', 'accent'], ['ek-accent', 'accent'], ['ek-chip', 'chip'], ['ek-line', 'border'], ['ek-line-strong', 'border-strong'], ['ek-track', 'track']])
    assert.match(colors, new RegExp(`'${k}': 'var\\(--ek-p-${v}\\)'`), k);
  for (const old of ['ek-blue-bright', 'ek-blue-soft', 'ek-score-orange']) assert.ok(!tw.includes(old), `${old} removed`);
});

test('T1.5 no page, component or shell (app/ and lib/) uses a removed token or the marquee', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(join(FRONTEND, 'app'));
  walk(join(FRONTEND, 'lib'));
  assert.ok(files.length > 100, 'walked app/ and lib/');
  assert.ok(files.some((p) => p.endsWith('/brand-page.ts')), 'the shell pages are in the scan');
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    for (const old of ['ek-blue-bright', 'ek-blue-soft', 'ek-score-orange', 'animate-marquee']) assert.ok(!src.includes(old), `${old} in ${p.slice(FRONTEND.length)}`);
  }
});

test('T1.6 primitives: a 1120px column, the type scale, flat rows and a flat SURFACE; pill buttons on brand blue with white text', () => {
  assert.equal(COLUMN, 'mx-auto w-full max-w-[1120px] px-4 md:px-8');
  assert.equal(H1, 'font-funnel-display text-[2.25rem] font-medium leading-[1.05] tracking-[-0.03em] text-ek-text md:text-[3.5rem]');
  assert.equal(H2, 'font-funnel-display text-2xl font-medium tracking-[-0.02em] text-ek-text md:text-[2rem]');
  assert.equal(LEDE, 'mt-4 max-w-[36rem] font-funnel-sans text-base text-ek-body md:text-lg');
  assert.equal(SURFACE, 'border-t border-ek-line');
  assert.equal(ROW, 'grid items-center gap-4 border-t border-ek-line py-4 md:py-5');
  assert.equal(ROWS, 'border-b border-ek-line');
  assert.equal(SECTION, 'py-14 md:py-24');
  assert.equal(NUM, 'font-funnel-display tabular-nums tracking-[-0.02em]');
  for (const s of [SURFACE, ROW, ROWS, H1, H2, LEDE]) assert.doesNotMatch(s, /rounded|gradient|shadow|uppercase/, s);
  for (const b of [BTN_PRIMARY, BTN_SECONDARY]) {
    assert.match(b, /\brounded-full\b/, 'pill');
    assert.match(b, /\bmin-h-12\b/, '48px');
    assert.doesNotMatch(b, /shadow|gradient|uppercase/);
  }
  assert.match(BTN_PRIMARY, /\bbg-ek-brand\b/);
  assert.match(BTN_PRIMARY, /\btext-ek-text\b/);
  assert.match(BTN_PRIMARY, /\bhover:bg-ek-accent\b/);
  assert.match(BTN_SECONDARY, /\bborder border-ek-line-strong\b/);
  assert.match(BTN_SECONDARY, /\btext-ek-text\b/);
  assert.match(BTN_SECONDARY, /\bhover:bg-ek-chip\b/);
  assert.doesNotMatch(BTN_SECONDARY, /\bbg-ek-brand\b/);
});

test('T1.7 the profile keeps PART_COLORS; SCORE_COLORS reads the page, surface, track and text from THEME; the ring is white to the accent', () => {
  assert.deepEqual(PART_COLORS, {
    ship: { from: '#3B82F6', to: '#22D3EE', text: '#67E8F9' },
    weeks: { from: '#D946EF', to: '#F472B6', text: '#F9A8D4' },
    wins: { from: '#F59E0B', to: '#FB923C', text: '#FCD34D' },
  });
  assert.equal(SCORE_COLORS.page, THEME.page);
  assert.equal(SCORE_COLORS.surface, THEME.surface);
  assert.equal(SCORE_COLORS.surfaceTop, THEME.surfaceTop);
  assert.equal(SCORE_COLORS.track, THEME.track);
  assert.equal(SCORE_COLORS.text, THEME.text);
  assert.equal(SCORE_COLORS.muted, THEME.muted);
  assert.deepEqual(SCORE_COLORS.total, { from: '#FFFFFF', to: THEME.accent });
  // The layout's theme-color is the page token, not a stale hex (v3.1 Task 5: the site's page token).
  assert.match(read('app/layout.tsx'), /theme-color" content=\{SITE\.page\}/);
});

test('T1.9 the shell pages (brand-page.ts) draw the same system: the button is white on brand at 4.5:1 or more, the body is flat, nothing has a gradient or a shadow', () => {
  const html = brandShell('<p>x</p>');
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  const btn = css.match(/\.ek-btn\{([^}]*)\}/)?.[1];
  assert.ok(btn, '.ek-btn rule');
  const bg = btn.match(/(?:^|;)background:(#[0-9a-f]{6})/i)?.[1];
  const fg = btn.match(/(?:^|;)color:(#[0-9a-f]{6})/i)?.[1];
  assert.equal(bg, THEME.brand, 'button fill');
  assert.equal(fg, THEME.text, 'button text');
  assert.ok(ratio(fg!, bg!) >= 4.5, `shell button text: ${ratio(fg!, bg!).toFixed(2)}`);
  assert.doesNotMatch(css, /gradient\(/, 'no gradient in the shell CSS');
  assert.doesNotMatch(css, /box-shadow/, 'no shadow in the shell CSS');
  assert.match(css, /body\{[^}]*background:#000000/);
  assert.doesNotMatch(css, /navy/i);
});

test('T1.8 DESIGN.md is the rulebook of the v3.1 site system and names what stays flat', () => {
  const md = read('DESIGN.md');
  assert.ok(md.split('\n').length <= 200, `one reading: ${md.split('\n').length} lines`);
  const heads = md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  for (const h of ['Page and card colours', 'Score bands', 'Standing metals', 'Type', 'Shape', 'Paintings', 'Motion', 'Phone', 'Contrast', 'Copy rules', 'What stays on the v3 flat system'])
    assert.ok(heads.includes(h), `DESIGN.md has the section ${h}`);
  for (const must of ['#0B0C14', '#05060D', '#2D6BE0', '#142159', '#241008', '#161927', 'Kaftan Serif', 'font-size-adjust: 0.36', 'Funnel Sans', '390px', '44px',
    '#F4F7FF', '#747C97', 'Eckersberg', 'Panini', 'prefers-reduced-motion', 'Backing', '#000000', '#0052FF', 'PART_COLORS', 'lib/earnkit/site-theme.ts'])
    assert.ok(md.includes(must), `DESIGN.md mentions ${must}`);
  for (const gone of ['ek-blue-bright', 'ek-blue-soft', 'ek-score-orange', 'builder-blue', 'marquee', '#070D24', '—', 'Funnel Display (headings'])
    assert.ok(!md.includes(gone), `DESIGN.md no longer mentions ${JSON.stringify(gone)}`);
  assert.doesNotMatch(md, /^- No gradients/m, 'the flat-system rule "no gradients" no longer headlines the file');
});
