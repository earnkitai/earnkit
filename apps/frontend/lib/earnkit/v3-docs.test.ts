import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DocsView from '../../app/docs/DocsView';
import Header from '../../app/components/common/Header';
import Footer from '../../app/components/common/Footer';
import { FOOTER_COLUMNS } from './footer-links';
import { RESERVED_ROUTES } from './reserved-routes';
import * as copy from './docs-copy';

(globalThis as { React?: typeof React }).React = React;
const html = renderToStaticMarkup(React.createElement(DocsView));
const text = html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const root = join(import.meta.dirname, '..', '..');

test('a: /docs renders the six H2s in order and the six agent names', () => {
  const h2 = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(h2, ['Add EarnKit to your agent', 'What your agent can do', 'The three numbers', 'How the week works', 'For program selectors', 'Terms']);
  for (const a of ['Grok Bot', 'Muse', 'OpenClaw', 'Claude Code', 'Cursor', 'Codex']) assert.match(html, new RegExp(`<h3[^>]*>${a}</h3>`));
  assert.match(html, /<pre[^>]*><code>/);
  assert.match(html, /id="selectors"/);
  assert.match(html, /\/api\/builders\/&lt;handle&gt;\.json/);
  assert.match(html, /\/badge\/&lt;handle&gt;\.svg/);
  assert.match(html, /mailto:j@earnkit\.com/);
  assert.doesNotMatch(text, /EARN points/);
});

test('b: header, footer and the shell link /docs in the same tab; no external docs link remains', () => {
  const h = renderToStaticMarkup(React.createElement(Header));
  assert.match(h, /<a[^>]*href="\/docs"[^>]*>Docs<\/a>/);
  assert.doesNotMatch(h.match(/<a[^>]*href="\/docs"[^>]*>/)![0], /target=/);
  const f = renderToStaticMarkup(React.createElement(Footer));
  assert.match(f, /href="\/docs"/);
  assert.match(f, /href="\/docs#selectors"[^>]*>For sponsors/);
  assert.deepEqual(FOOTER_COLUMNS.flatMap((c) => c.links).filter((l) => /github\.com\/earnkitai/.test(l.href)), []);
  assert.match(readFileSync(join(root, 'lib/earnkit/brand-page.ts'), 'utf8'), /href="\$\{DOCS\}">Docs/);
  assert.doesNotMatch(readFileSync(join(root, 'lib/earnkit/footer-links.ts'), 'utf8'), /connect-an-agent/);
});

test('c: docs is reserved and in the sitemap; the dead link constants are gone', () => {
  assert.ok(RESERVED_ROUTES.has('docs'));
  assert.match(readFileSync(join(root, 'app/sitemap.ts'), 'utf8'), /\/docs`/);
  const links = readFileSync(join(root, 'app/lib/links.ts'), 'utf8');
  for (const k of ['FOLLOW_X', 'RUN_CAMPAIGN', 'FOR_ECOSYSTEMS', 'FOR_AGENTS']) assert.doesNotMatch(links, new RegExp(k));
});

test('d: the page has no em dash, no emoji, under 600 words', () => {
  assert.doesNotMatch(text, /—/);
  assert.doesNotMatch(JSON.stringify(copy), /—|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
  const words = text.trim().split(' ').length;
  assert.ok(words < 600, `${words} words`);
});
