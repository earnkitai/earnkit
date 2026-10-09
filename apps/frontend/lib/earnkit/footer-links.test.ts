import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Footer from '../../app/components/common/Footer';
import { Wordmark } from '../../app/components/ui/Logo';
import { EXTERNAL_ALLOW, FOOTER_COLUMNS, FOOTER_TAGLINE, appRoutes, footerLinkProblems, type FooterColumn } from './footer-links';

// The test runner compiles JSX with the classic runtime (no tsconfig at the repo root; see
// public-pages.test.ts).
(globalThis as { React?: typeof React }).React = React;

const APP_DIR = join(import.meta.dirname, '..', '..', 'app');

test('footerLinkProblems: FOOTER_COLUMNS has no problems against the app\'s real routes', () => {
  assert.deepEqual(footerLinkProblems(FOOTER_COLUMNS, appRoutes(APP_DIR)), []);
});

test('11.6 (F22): the Legal column is one Terms link to /terms, a real route', () => {
  assert.deepEqual(FOOTER_COLUMNS.find((c) => c.title === 'Legal')?.links, [{ label: 'Terms', href: '/terms' }]);
  assert.ok(appRoutes(APP_DIR).includes('/terms'));
  for (const old of ['/policy', '/risk-disclosure', '/sponsor-terms']) assert.ok(!appRoutes(APP_DIR).includes(old), old);
  assert.ok(renderToStaticMarkup(React.createElement(Footer)).includes('EarnKit is a product of Tokenfi Inc.'));
});

test('footerLinkProblems: reports a missing internal page, a disallowed external link, and an empty label', () => {
  const columns: FooterColumn[] = [
    { title: 'Product', links: [{ label: 'Nope', href: '/nope' }] },
    { title: 'Resources', links: [{ label: 'Evil', href: 'https://evil.example' }] },
    { title: 'Legal', links: [{ label: '', href: '/terms' }] },
  ];
  const problems = footerLinkProblems(columns, appRoutes(APP_DIR));
  assert.ok(problems.includes('internal link /nope has no page'), problems.join('; '));
  assert.ok(problems.includes('external link not allowed: https://evil.example'), problems.join('; '));
  assert.ok(problems.includes('Legal: empty label'), problems.join('; '));
  assert.equal(problems.length, 3);
});

test('appRoutes: includes the top-level routes and a dynamic segment', () => {
  const routes = appRoutes(APP_DIR);
  for (const r of ['/', '/programs', '/terms', '/programs/[id]']) assert.ok(routes.includes(r), r);
});

test('Footer: renders exactly the FOOTER_COLUMNS hrefs plus the logo link, the tagline, the faded wordmark, and the copyright', () => {
  const h = renderToStaticMarkup(React.createElement(Footer));
  const hrefs = new Set([...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
  const expected = new Set(['/', ...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href))]);
  assert.deepEqual(hrefs, expected);
  assert.ok(h.includes(FOOTER_TAGLINE));
  // v2.8.1 (owner): the faded wordmark is the navbar's logo (the same SVG: mark and "EarnKit"), not text.
  const faded = /<div aria-hidden="true" data-footer-wordmark=""[^>]*>(<svg[\s\S]*?<\/svg>)<\/div>/.exec(h);
  assert.ok(faded, 'the faded wordmark is an SVG');
  const navbar = renderToStaticMarkup(React.createElement(Wordmark));
  assert.equal(/ d="([^"]+)"/.exec(faded[1])?.[1], / d="([^"]+)"/.exec(navbar)?.[1], 'the same logo path as the navbar');
  assert.match(faded[1], /viewBox="0 0 124 23"/);
  assert.doesNotMatch(faded[1], /role="img"/);
  assert.doesNotMatch(h, />EARNKIT</);
  assert.match(h, new RegExp(`© ${new Date().getFullYear()} Tokenfi Inc\\. All rights reserved\\.`));
  assert.match(h, /aria-label="@jenilt on X"[^>]*>[\s\S]{0,200}?<svg/);
  // No emojis, no em dash, no placeholder links.
  assert.doesNotMatch(h, /\p{Emoji_Presentation}/u);
  assert.doesNotMatch(h, /—/);
});

// Ruling 22 (plan): the network check of external links runs only with LINK_CHECK=1, never in
// `pnpm test`.
const LINK_CHECK = process.env.LINK_CHECK === '1';
test(
  'LINK_CHECK=1: every external https footer link answers under 400 within 10s',
  { skip: !LINK_CHECK && 'set LINK_CHECK=1 to run this against the network' },
  async () => {
    const urls = EXTERNAL_ALLOW.filter((u) => u.startsWith('https://'));
    for (const url of urls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      assert.ok(res.status < 400, `${url}: ${res.status}`);
    }
  },
);
