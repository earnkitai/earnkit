import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SITE, siteVar } from './site-theme';
import Pager from '../../app/components/site/Pager';
import ScoreText from '../../app/components/site/ScoreText';

/**
 * v3.1 site Task 1: the owner-approved canvas's tokens (SITE, as --ek-s-* in globals.css and s-* in
 * Tailwind), the Kaftan Serif file, the two paintings as pre-sized JPEGs, the reduced-motion rules and the
 * Pager and ScoreText primitives.
 */
// The components use the automatic JSX runtime under Next; tsx compiles them classic, so React is a global here.
(globalThis as { React?: typeof React }).React = React;
const FRONTEND = join(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(join(FRONTEND, p), 'utf8');
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const esc = (s: string) => s.replace(/[().*+?^$|[\]\\{}]/g, '\\$&');

// Same WCAG relative luminance as v3-tokens.test.ts.
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('(a) every SITE key has a --ek-s-* line in globals.css with the same value, and :root declares nothing else under --ek-s-', () => {
  assert.equal(siteVar('onBlueSoft'), '--ek-s-on-blue-soft');
  assert.equal(siteVar('inset22'), '--ek-s-inset22');
  assert.equal(SITE.page, '#0B0C14');
  assert.equal(SITE.deep, '#05060D');
  assert.equal(SITE.onBlueSoft, '#F4F7FF', 'S11');
  assert.equal(SITE.dim, '#747C97', 'S12');
  const css = read('app/globals.css');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const k of Object.keys(SITE) as (keyof typeof SITE)[])
    assert.match(root, new RegExp(`${siteVar(k)}: ${esc(SITE[k])};`), k);
  const declared = [...root.matchAll(/(--ek-s-[a-z0-9-]+):/g)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), Object.keys(SITE).map((k) => siteVar(k as keyof typeof SITE)).sort());
  // Nothing outside :root declares an --ek-s- variable either.
  assert.equal((css.match(/--ek-s-[a-z0-9-]+:/g) ?? []).length, declared.length);
});

test('(b) tailwind.config.ts maps s-<kebab> to var(--ek-s-<kebab>) for every key and holds no #hex', () => {
  const tw = read('tailwind.config.ts');
  for (const k of Object.keys(SITE)) assert.match(tw, new RegExp(`'s-${kebab(k)}': 'var\\(--ek-s-${kebab(k)}\\)'`), k);
  assert.doesNotMatch(tw, /#[0-9a-f]{3,8}\b/i, 'raw hex in tailwind.config.ts');
  assert.match(tw, /kaftan: \['var\(--font-kaftan\)'/);
});

test('(c) contrast 4.5:1 or more for every text-on-surface pair the canvas uses; dim never sits on a card', () => {
  const pairs: [keyof typeof SITE, keyof typeof SITE][] = [];
  const on = (texts: (keyof typeof SITE)[], bgs: (keyof typeof SITE)[]) => { for (const t of texts) for (const b of bgs) pairs.push([t, b]); };
  on(['text', 'muted', 'dim'], ['page', 'deep']);
  on(['stepText'], ['stepBottom']);
  on(['heroSub', 'footLink'], ['deep']);
  on(['cardBody', 'cardMeta', 'cardHandle'], ['cardTop', 'cardBottom']);
  on(['muted'], ['panel']);
  on(['onBlue', 'onBlueSoft'], ['blue']);
  on(['onNavy', 'onNavySoft'], ['navy']);
  on(['rustSub', 'rustSoft', 'rustLight'], ['rust']);
  on(['inkBody', 'inkMuted', 'inkSoft'], ['light', 'lightInner']);
  on(['greenSub'], ['greenTop']);
  on(['goodText', 'midText', 'lowText'], ['cardTop', 'panel']);
  for (const [t, b] of pairs) {
    const r = contrast(SITE[t], SITE[b]);
    assert.ok(r >= 4.5, `${t} ${SITE[t]} on ${b} ${SITE[b]}: ${r.toFixed(2)}`);
  }
  // S12: dim passes only on the page backgrounds, so no component that draws a card uses it.
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
  const app = files(join(FRONTEND, 'app'));
  assert.ok(app.some((p) => p.endsWith('/components/site/ui.ts')), 'the card classes are in the scan');
  for (const f of app) {
    const src = readFileSync(f, 'utf8');
    if (/\bCARD_[A-Z]+\b/.test(src)) assert.doesNotMatch(src, /\bs-dim\b/, `s-dim beside a card class in ${f.slice(FRONTEND.length)}`);
  }
});

/** The width in a JPEG's SOF0 or SOF2 frame header. */
const jpegWidth = (b: Buffer): number | null => {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return b.readUInt16BE(i + 7);
    i += 2 + len;
  }
  return null;
};

test('(d) the six paintings are JPEGs at their widths and under their byte budgets', () => {
  const files: [string, number, number][] = [
    ['hero-eckersberg-3200.jpg', 3200, 1_700_000],
    ['hero-eckersberg-1600.jpg', 1600, 400_000],
    ['hero-eckersberg-800.jpg', 800, 110_000],
    ['foot-panini-2800.jpg', 2800, 1_000_000],
    ['foot-panini-1400.jpg', 1400, 220_000],
    ['foot-panini-700.jpg', 700, 80_000],
  ];
  for (const [name, width, budget] of files) {
    const p = join(FRONTEND, 'public/art', name);
    assert.ok(existsSync(p), name);
    const b = readFileSync(p);
    assert.equal(b.readUInt16BE(0), 0xffd8, `${name} is a JPEG`);
    assert.equal(jpegWidth(b), width, `${name} width`);
    assert.ok(b.length <= budget, `${name}: ${b.length} bytes over ${budget}`);
  }
});

test('(e) Kaftan Serif is a local woff2 loaded as --font-kaftan; .ek-serif adjusts its size', () => {
  const font = readFileSync(join(FRONTEND, 'app/fonts/kaftan-serif.woff2'));
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2');
  const layout = read('app/layout.tsx');
  assert.match(layout, /localFont\(\{\s*src: '\.\/fonts\/kaftan-serif\.woff2',\s*variable: '--font-kaftan',\s*weight: '400',\s*display: 'swap',?\s*\}\)/);
  assert.match(layout, /className=\{`[^`]*\$\{kaftan\.variable\}/, 'on the body');
  const rule = read('app/globals.css').match(/\.ek-serif \{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /font-family: var\(--font-kaftan\), Georgia, serif;/);
  assert.match(rule, /font-size-adjust: 0\.36;/);
  assert.match(rule, /font-weight: 400;/);
});

test('(f) reduced motion stops the drift, the pulse, the twinkles and transitions; the body is the page token, deep pages switch it', () => {
  const css = read('app/globals.css');
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const block = blocks.find((b) => b.includes('.ek-drift')) ?? '';
  for (const c of ['.ek-drift', '.ek-pulse', '.ek-twinkle']) assert.ok(block.includes(c), c);
  assert.match(block, /animation: none/);
  assert.match(block, /transition: none/);
  for (const c of ['ek-drift', 'ek-pulse', 'ek-twinkle']) assert.match(css, new RegExp(`\\.${c} \\{`), `${c} is defined`);
  assert.match(css, /body \{[^}]*background-color: var\(--ek-s-page\)/);
  assert.match(css, /body:has\(\[data-ek-deep\]\) \{[^}]*background-color: var\(--ek-s-deep\)/);
});

test('(g) Pager: "1 of 3" with Previous disabled and Next linking on; numbers 1..pages with the current page marked; one page renders nothing', () => {
  const href = (n: number) => `/leaderboard?page=${n}`;
  const h = html(React.createElement(Pager, { page: 1, pages: 3, href }));
  assert.match(h, /1 of 3/);
  assert.match(h, /<span[^>]*aria-disabled="true"[^>]*>Previous<\/span>/);
  assert.match(h, /<a[^>]*href="\/leaderboard\?page=2"[^>]*>Next<\/a>/);
  assert.doesNotMatch(h, /<a[^>]*>Previous/);
  const disabled = h.match(/<span[^>]*class="([^"]*)"[^>]*aria-disabled="true"|<span[^>]*aria-disabled="true"[^>]*class="([^"]*)"/);
  assert.match((disabled?.[1] ?? disabled?.[2]) ?? '', /(^| )opacity-35( |$)/);
  for (const m of h.matchAll(/<(?:a|span) [^>]*class="([^"]*)"[^>]*>(?:Previous|Next)</g)) assert.match(m[1], /(^| )min-h-11( |$)/, 'a 44px target on a phone');

  const last = html(React.createElement(Pager, { page: 3, pages: 3, href, labels: ['Newer', 'Older'], numbers: true }));
  assert.match(last, /<a[^>]*href="\/leaderboard\?page=2"[^>]*>Newer<\/a>/);
  assert.match(last, /<span[^>]*aria-disabled="true"[^>]*>Older<\/span>/);
  for (const n of [1, 2]) assert.match(last, new RegExp(`<a[^>]*href="/leaderboard\\?page=${n}"[^>]*>${n}</a>`));
  assert.match(last, /<(?:a|span)[^>]*aria-current="page"[^>]*>3<\/(?:a|span)>/);
  assert.equal((last.match(/aria-current="page"/g) ?? []).length, 1);
  assert.doesNotMatch(last, /of 3/);

  assert.equal(html(React.createElement(Pager, { page: 1, pages: 1, href })), '');
  assert.equal(html(React.createElement(Pager, { page: 1, pages: 0, href })), '');
});

test('(h) ScoreText: one colour per band (70+, 40 to 69, under 40)', () => {
  const cls = (score: number) => html(React.createElement(ScoreText, { score, size: 30 })).match(/class="([^"]*)"/)?.[1] ?? '';
  assert.match(cls(70), /(^| )text-s-good-text( |$)/);
  assert.match(cls(100), /(^| )text-s-good-text( |$)/);
  assert.match(cls(69), /(^| )text-s-mid-text( |$)/);
  assert.match(cls(40), /(^| )text-s-mid-text( |$)/);
  assert.match(cls(39), /(^| )text-s-low-text( |$)/);
  assert.match(cls(0), /(^| )text-s-low-text( |$)/);
  assert.match(cls(70), /(^| )ek-serif( |$)/);
  assert.match(html(React.createElement(ScoreText, { score: 70, size: 30 })), />70</);
});
