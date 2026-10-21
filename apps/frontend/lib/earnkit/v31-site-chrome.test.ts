import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Header from '../../app/components/common/Header';
import Footer from '../../app/components/common/Footer';
import FooterLight, { lightOn } from '../../app/components/site/FooterLight';
import Pager from '../../app/components/site/Pager';
import { AGENT_MARKS, AgentMark } from '../../app/components/site/AgentMarks';
import { X } from '../../app/lib/links';
import { brandShell } from './brand-page';
import { FOOTER_COLUMNS, appRoutes, footerLinkProblems } from './footer-links';
import { ART_CREDIT, CTA_INSTALL, FOOT_CTA, FOOT_GET_PAGE, NAV_INSTALL } from './site-copy';

/**
 * v3.1 site Task 5: the Nav (Header), the full and minimal Footer, the footer light, the agent marks, the
 * footer link list, and the programs list leaving the nav (/programs redirects to /#earn; guides stay).
 */
// The components use the automatic JSX runtime under Next; tsx compiles them classic, so React is a global here.
(globalThis as { React?: typeof React }).React = React;
const FRONTEND = join(import.meta.dirname, '../..');
const APP_DIR = join(FRONTEND, 'app');
const read = (p: string) => readFileSync(join(FRONTEND, p), 'utf8');
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const hrefs = (h: string) => [...h.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('(a) Header renders the wordmark link, exactly the links Leaderboard /leaderboard, Feed /feed, Docs /docs, one button "Add to your agent", and no /programs href', () => {
  const h = html(React.createElement(Header));
  assert.deepEqual(hrefs(h), ['/', '/leaderboard', '/feed', '/docs']);
  const home = h.match(/<a [^>]*href="\/"[^>]*>\s*<svg[^>]*>/)?.[0] ?? '';
  assert.match(home, /aria-label="EarnKit home"/);
  assert.match(home, /<svg[^>]*width="104"[^>]*height="20"/);
  for (const [label, href] of [['Leaderboard', '/leaderboard'], ['Feed', '/feed'], ['Docs', '/docs']])
    assert.match(h, new RegExp(`<a [^>]*href="${href}"[^>]*>${label}</a>`), label);
  assert.equal(NAV_INSTALL, 'Add to your agent');
  const buttons = [...h.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)];
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0][2], NAV_INSTALL);
  for (const c of ['bg-s-blue', 'text-s-on-blue', 'h-11', 'px-5', 'rounded-full', 'text-[14px]', 'font-semibold'])
    assert.match(buttons[0][1], new RegExp(`(^| )${c.replace(/[[\]]/g, '\\$&')}( |$)`), c);
  assert.doesNotMatch(h, /\/programs/);
  // Transparent, not sticky; the 1200px column.
  const header = h.match(/<header[^>]*class="([^"]*)"/)?.[1] ?? '';
  assert.doesNotMatch(header, /(^| )(sticky|fixed)( |$)|bg-/);
  for (const c of ['max-w-[1200px]', 'mx-auto', 'px-4', 'md:px-6', 'py-5']) assert.ok(header.split(' ').includes(c), c);
});

test('(a2) NavLinks marks the active link: s-text, weight 600, aria-current="page"; the rest s-muted', () => {
  const src = read('app/components/site/NavLinks.tsx');
  assert.match(src, /^'use client';/);
  assert.match(src, /usePathname\(\)/);
  for (const p of ['/leaderboard', '/feed', '/docs']) assert.ok(src.includes(`'${p}'`), p);
  const h = html(React.createElement(Header));
  for (const m of h.matchAll(/<a [^>]*href="\/(?:leaderboard|feed|docs)"[^>]*class="([^"]*)"/g)) {
    assert.match(m[1], /(^| )min-h-11( |$)/, 'a 44px target');
    assert.match(m[1], /(^| )text-\[15px\]( |$)/);
  }
});

test('(b) Footer full: the CTA words, one "Add EarnKit to your agent" button, links Leaderboard, Feed, Docs, Terms, the art credit, the X link, the lazy Panini <img>; minimal: "Get your page" to /docs and Leaderboard, no img, no credit', () => {
  const f = html(React.createElement(Footer));
  assert.ok(text(f).includes(FOOT_CTA), 'the CTA');
  assert.match(f, new RegExp(`<span[^>]*class="[^"]*\\bek-serif\\b[^"]*"[^>]*>${FOOT_CTA.replace('.', '\\.')}</span>`));
  const buttons = [...f.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  assert.deepEqual(buttons, [CTA_INSTALL]);
  assert.deepEqual(hrefs(f), ['/', '/leaderboard', '/feed', '/docs', '/terms', X]);
  assert.ok(text(f).includes(ART_CREDIT.replace(/&/g, '&amp;')) || f.includes(ART_CREDIT), 'the art credit');
  assert.match(f, new RegExp(`<a [^>]*href="${X.replace(/[.]/g, '\\.')}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="EarnKit on X"`));
  const img = f.match(/<img [^>]*>/)?.[0] ?? '';
  for (const w of ['700', '1400', '2800']) assert.ok(img.includes(`/art/foot-panini-${w}.jpg ${w}w`), w);
  assert.match(img, /loading="lazy"/);
  assert.match(img, /decoding="async"/);
  assert.match(img, /alt=""/);
  assert.match(img, /sizes="\(min-width: 1240px\) 1192px, calc\(100vw - 32px\)"/);
  assert.ok(text(f).includes('EarnKit is a product of Tokenfi Inc.'));

  const m = html(React.createElement(Footer, { variant: 'minimal' }));
  assert.deepEqual(hrefs(m), ['/', '/docs', '/leaderboard', X]);
  assert.match(m, new RegExp(`<a [^>]*href="/docs"[^>]*>${FOOT_GET_PAGE}</a>`));
  assert.match(m, /<a [^>]*href="\/leaderboard"[^>]*>Leaderboard<\/a>/);
  assert.doesNotMatch(m, /<img/);
  assert.ok(!m.includes('Eckersberg'), 'no credit');
  assert.doesNotMatch(m, /<button/);
  assert.match(m, /max-w-\[1152px\]/);
  assert.ok(text(m).includes('EarnKit is a product of Tokenfi Inc.'));
  for (const h of [f, m]) {
    assert.doesNotMatch(h, /—/);
    assert.doesNotMatch(h, /\/programs/);
  }
});

test('(c) FOOTER_COLUMNS hrefs are exactly /leaderboard, /feed, /docs, /terms and the X url; footerLinkProblems is empty against appRoutes', () => {
  assert.deepEqual(FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)), ['/leaderboard', '/feed', '/docs', '/terms', X]);
  assert.deepEqual(footerLinkProblems(FOOTER_COLUMNS, appRoutes(APP_DIR)), []);
  assert.equal(X, 'https://x.com/EarnKitAI');
  const labels = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.label)).join(' ');
  assert.doesNotMatch(labels, /Programs|For sponsors|@|mailto/);
});

test('(d) brandShell header has no /programs link; app/programs/page.tsx redirects to /#earn; sitemap has no ${SITE}/programs entry but keeps guide entries', () => {
  const shell = brandShell('<p>x</p>', { fonts: false });
  assert.doesNotMatch(shell, /href="\/programs"/);
  for (const p of ['/leaderboard', '/feed', '/docs']) assert.ok(shell.includes(`href="${p}"`), p);
  const page = read('app/programs/page.tsx');
  assert.match(page, /permanentRedirect\('\/#earn'\)/);
  assert.doesNotMatch(page, /ProgramCards|getLanding/);
  const sitemap = read('app/sitemap.ts');
  assert.ok(!sitemap.includes('`${SITE}/programs`'));
  assert.ok(sitemap.includes('`${SITE}/programs/${p.id}`'));
  assert.match(read('app/programs/[id]/GuideView.tsx'), /href="\/#earn"/);
  assert.doesNotMatch(read('app/programs/[id]/GuideView.tsx'), /href="\/programs"/);
  assert.ok(appRoutes(APP_DIR).includes('/programs/[id]'), 'guides stay reachable');
});

test('(e) AGENT_MARKS: Grok Bot, Claude Code, Codex, Muse, each path non-empty; Muse equals public/images/agents/muse.svg', () => {
  assert.deepEqual(AGENT_MARKS.map((a) => a.name), ['Grok Bot', 'Claude Code', 'Codex', 'Muse']);
  for (const a of AGENT_MARKS) {
    assert.ok(a.paths.length > 0 && a.paths.every((p) => p.length > 20), a.name);
    assert.match(a.viewBox, /^0 0 \d+ \d+$/);
  }
  const muse = read('public/images/agents/muse.svg').match(/ d="([^"]+)"/)?.[1];
  assert.deepEqual(AGENT_MARKS[3].paths, [muse]);
  const h = html(React.createElement(AgentMark, { mark: AGENT_MARKS[0], size: 22 }));
  assert.match(h, /<span[^>]*role="img"[^>]*aria-label="Grok Bot"/);
  assert.match(h, /opacity-50/);
  assert.match(h, /<svg[^>]*width="22"[^>]*height="22"[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
  assert.match(h, /<path[^>]*fill="#FFFFFF"/);
  assert.match(read('app/components/site/AgentMarks.tsx'), /@lobehub\/icons-static-svg[\s\S]*MIT/);
});

test('(f) FooterLight renders no light layer listener and no moving style when useReducedMotion is true (render with a matchMedia stub)', () => {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = { matchMedia: (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }) };
  try {
    const h = html(React.createElement(FooterLight));
    assert.equal(h, '', 'no layer');
    assert.doesNotMatch(h, /radial-gradient|style=/);
  } finally {
    g.window = before;
  }
  // The rule the client applies: no light under reduced motion or on a touch screen.
  assert.equal(lightOn({ reduced: true, touch: false }), false);
  assert.equal(lightOn({ reduced: false, touch: true }), false);
  assert.equal(lightOn({ reduced: false, touch: false }), true);
  const src = read('app/components/site/FooterLight.tsx');
  assert.match(src, /useReducedMotion\(\)/);
  assert.match(src, /if \(!on\) return;/, 'no listener is attached when off');
  assert.match(src, /if \(!on\) return null;/, 'no layer is rendered when off');
});

test('(g) Task 1 carry-over: Pager clamps page into 1..pages; disabled ends keep their colour on hover', () => {
  const href = (n: number) => `/feed?page=${n}`;
  const high = html(React.createElement(Pager, { page: 9, pages: 3, href }));
  assert.match(high, /3 of 3/);
  assert.match(high, /<a[^>]*href="\/feed\?page=2"[^>]*>Previous<\/a>/);
  assert.doesNotMatch(high, /page=4|page=10/);
  const low = html(React.createElement(Pager, { page: -2, pages: 3, href, numbers: true }));
  assert.match(low, /<span[^>]*aria-current="page"[^>]*>1<\/span>/);
  assert.match(low, /<a[^>]*href="\/feed\?page=2"[^>]*>Next<\/a>/);
  for (const h of [high, low])
    for (const s of h.matchAll(/<span[^>]*aria-disabled="true"[^>]*class="([^"]*)"|<span[^>]*class="([^"]*)"[^>]*aria-disabled="true"/g))
      assert.doesNotMatch(s[1] ?? s[2], /hover:/);
});

test('(h) Task 1 carry-overs: theme-color is the site page token; the install sheet and DocsView no longer paint bg-ek-page', () => {
  const layout = read('app/layout.tsx');
  assert.match(layout, /<meta name="theme-color" content=\{SITE\.page\} \/>/);
  assert.match(layout, /title: TITLE/);
  assert.match(layout, /const TITLE = 'EarnKit \| Earn from building\.';/);
  assert.match(layout, /<Header \/>/);
  for (const f of ['app/docs/DocsView.tsx', 'app/components/sections/AddToAgent.tsx']) assert.doesNotMatch(read(f), /bg-ek-page/, f);
});
