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

test('a: /docs (v3.1 Docs board): the install H1, the three card H2s and the selectors H2 in order, a tab per agent, the link, the selectors JSON', () => {
  const h2 = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1]);
  assert.match(html, /<h1[^>]*>Add EarnKit to your agent<\/h1>/);
  assert.deepEqual(h2, ['No GitHub yet?', 'How the week works', 'Shipping score', 'Programs', 'For selectors']);
  for (const a of ['Grok Bot', 'Claude', 'Muse', 'OpenClaw', 'Claude Code', 'Cursor', 'Codex']) assert.match(html, new RegExp(`<button[^>]*role="tab"[^>]*>${a}</button>`));
  assert.match(html, /<pre[^>]*>(<span[^>]*>)*https:\/\/earnkit\.com\/mcp/);
  assert.match(html, /id="selectors"/);
  assert.match(html.replace(/<wbr\/>/g, ''), /earnkit\.com\/api\/builders\/&lt;handle&gt;\.json/);
  // The rule pins carried over: never "EARN points" (and no points at all on a page), no parentheticals.
  assert.doesNotMatch(text, /EARN points|points/);
  assert.doesNotMatch(text, /\((?:score|tell|find, prepare|confirm)\)/);
  // The page itself stays a server component; only the install card's tabs are client.
  assert.doesNotMatch(readFileSync(join(root, 'app/docs/DocsView.tsx'), 'utf8'), /use client/);
  assert.match(readFileSync(join(root, 'app/docs/InstallCard.tsx'), 'utf8'), /^'use client';/);
  assert.match(readFileSync(join(root, 'app/docs/page.tsx'), 'utf8'), /export const dynamic = 'force-dynamic'/);
});

test('b: header, footer and the shell link /docs in the same tab; no external docs link remains', () => {
  const h = renderToStaticMarkup(React.createElement(Header));
  assert.match(h, /<a[^>]*href="\/docs"[^>]*>Docs<\/a>/);
  assert.doesNotMatch(h.match(/<a[^>]*href="\/docs"[^>]*>/)![0], /target=/);
  const f = renderToStaticMarkup(React.createElement(Footer));
  assert.match(f, /href="\/docs"/);
  // v3.1 (Foot board): "For sponsors" left the footer; the Docs page keeps its selectors section.
  assert.doesNotMatch(f, /For sponsors/);
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

test('d: the page has no em dash, no emoji, under 250 words', () => {
  assert.doesNotMatch(text, /—/);
  assert.doesNotMatch(JSON.stringify(copy), /—|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
  const words = text.trim().split(' ').length;
  assert.ok(words < 250, `${words} words`);
});
