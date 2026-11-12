import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { sql } from './db';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';
import { gatedGuidePage, guideTextById, listGuideIds } from './guide-page';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CTA_INSTALL, EARN_ALL, EARN_EMPTY, HERO_SUB, HERO_TITLE, ONE_LINE, PROGRAMS_DESCRIPTION, STEPS } from './site-copy';
import SchemaOrg from '../../app/components/ui/SchemaOrg';
import type { Landing, Tile } from './landing';
import Home from '../../app/page';
import HomeView from '../../app/HomeView';
import Steps from '../../app/components/landing/Steps';
import Opportunities, { Logo } from '../../app/components/landing/Opportunities';
import ProgramsPage from '../../app/programs/page';
import ProgramGuidePage, { generateMetadata as guideMetadata } from '../../app/programs/[id]/page';
import DocsPage, { generateMetadata as docsMetadata } from '../../app/docs/page';
import TermsPage, { generateMetadata as termsMetadata } from '../../app/terms/page';
import { metadata as homeMetadata } from '../../app/page';
import { metadata as programsMetadata } from '../../app/programs/page';
import NotFoundPage, { metadata as notFoundMetadata } from '../../app/not-found';
import { firstLine, SITE_METADATA as layoutMetadata } from '../../app/lib/meta';
import { GET as llmsGet } from '../../app/llms.txt/route';
import { GET as statsGet } from '../../app/api/stats/route';
import { GET as programsGet } from '../../app/api/programs/route';
import sitemap from '../../app/sitemap';
import { NOT_A_ROUTE, guideGate, proxy } from '../../proxy';
import MeView from '../../app/me/MeView';
import { getRecord, saveRecord, upsertBuilder } from '../v6/builders';
import { meData } from '../v6/me-view';
import { mergeRecord } from '../v6/record';
import { linkDocTitle, linkState } from '../v6/link-routes';
import LinkView from '../../app/link/[code]/LinkView';
import nextConfig from '../../next.config';

// tsx compiles the components without the automatic JSX runtime, so they need React in scope.
(globalThis as { React?: typeof React }).React = React;

after(() => sql().end());

const BANNED = /\b(coins?|points?|scores?|ranks?|ranked|streaks?|tokens?|leaderboards?|profiles?)\b/i;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
/** The words a visitor reads: no scripts, styles or tags. */
const textOf = (markup: string) =>
  markup
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

before(async () => {
  const now = new Date();
  await upsertProgram(programFixture({ id: 'zz-page-open', title: 'Page Open Grants', organizer: 'Page Org', ends_at: '2027-06-01T12:00:00Z', summary: 'Up to $5,000 · rolling', max_award_usd: 5000,
    rules: ['Apply from a public repo.'],
    submission_requirements: [{ key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' }],
    logo: { path: 'programs/zz-page-open.svg', source_url: 'https://example.com/logo' } }), 'file', now);
  await upsertProgram(programFixture({ id: 'zz-page-soon', title: 'Page Soon Grants', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [] }), 'file', now);
  await upsertProgram(programFixture({ id: 'zz-page-shut', title: 'Page Shut Grants', status: 'closed' }), 'file', now);
  await sql()`INSERT INTO programs (id, file, source, category, status) VALUES ('zz-page-broken', '{}'::jsonb, 'file', 'grant', 'closed') ON CONFLICT DO NOTHING`;
});

/** The program card links (`/programs/<id>`), not the pill or the footer's `/programs`. */
const cardLinks = (markup: string) => markup.match(/href="\/programs\/[^"]+"/g) ?? [];
const tileOf = (i: number): Tile => ({
  id: `t-${i}`, title: `Tile ${i} Grants`, organizer: `Org ${i}`, money: i % 2 ? '$50K' : '$1M in prizes', big: i % 2 === 1,
  when: i % 3 ? 'Closes Dec 1' : 'Rolling', closes_at: i % 3 ? '2026-12-01T12:00:00Z' : null, zone: 'UTC', kind: 'grant', status: 'active', logo: null,
});
const TILES45 = Array.from({ length: 45 }, (_, i) => tileOf(i));
const LANDING45: Landing = { chip: '$1.7M in grants and prizes open now', tiles: TILES45, featured: TILES45.slice(0, 6), total: 45 };

test('/ shows the hero, the steps, at most six programs, the link to all of them and the install button', async () => {
  const m = html(await Home());
  const t = textOf(m);
  assert.ok(t.includes(HERO_TITLE));
  for (const step of STEPS) assert.ok(t.includes(step), step);
  assert.ok(t.includes('Open now'));
  assert.ok(cardLinks(m).length <= 6, String(cardLinks(m).length));
  assert.ok(t.includes('See all programs.'));
  assert.ok(!m.includes('href="/programs/zz-page-soon"') && !m.includes('href="/programs/zz-page-shut"'));
  assert.ok(t.includes('Add EarnKit to your agent'));
  assert.ok(!/Leaderboard|Feed|Bench|Activity/.test(t));
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
});

test('the landing with 45 programs: six cards, then one link "See all programs." to /programs (v6.2.0, L25-15)', () => {
  const m = html(React.createElement(HomeView, { landing: LANDING45 }));
  const t = textOf(m);
  assert.deepEqual(cardLinks(m), TILES45.slice(0, 6).map((x) => `href="/programs/${x.id}"`));
  // L25-15 (v6.1.16): no count on the link.
  assert.equal(EARN_ALL, 'See all programs.');
  assert.match(m, /<a[^>]*href="\/programs"[^>]*>See all programs\.<\/a>/);
  assert.equal(t.split('See all programs.').length, 2);
  assert.ok(!t.includes('See all 45'));
  assert.ok(t.includes('Closes Dec 1') && t.includes('Rolling'));
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
});

test('the landing cards: the first blue, the other five neutral; /programs all neutral (v6.2.0)', () => {
  const landing = html(React.createElement(Opportunities, { programs: TILES45.slice(0, 6), total: 45 }));
  assert.equal(landing.match(/border-s-blue-line/g)?.length, 1);
  assert.equal(landing.match(/border border-s-line bg-gradient-to-b from-s-card-top to-s-card-bottom/g)?.length, 5);
  assert.equal(landing.match(/hover:border-s-line-hover/g)?.length, 5);
  const all = html(React.createElement(Opportunities, { programs: TILES45, total: 45, full: true }));
  assert.equal(all.match(/border-s-blue-line/g), null);
  assert.equal(all.match(/border border-s-line bg-gradient-to-b from-s-card-top to-s-card-bottom/g)?.length, 45);
});

test('the landing grid is 1, 2 then 3 columns; /programs keeps auto-fit (v6.2.0)', () => {
  const landing = html(React.createElement(Opportunities, { programs: TILES45.slice(0, 6), total: 45 }));
  assert.match(landing, /class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"/);
  assert.ok(!landing.includes('auto-fit'));
  const all = html(React.createElement(Opportunities, { programs: TILES45, total: 45, full: true }));
  assert.match(all, /class="grid gap-4 \[grid-template-columns:repeat\(auto-fit,minmax\(260px,1fr\)\)\]"/);
  assert.ok(!all.includes('lg:grid-cols-3'));
});

test('no featured programs but some listed: the title, "Nothing is open right now." and the pill (v6.2.0)', () => {
  const t = textOf(html(React.createElement(Opportunities, { programs: [], total: 45 })));
  assert.equal(t, `Open now ${EARN_EMPTY} ${EARN_ALL}`);
  assert.equal(EARN_EMPTY, 'Nothing is open right now.');
});

test('logos: a wordmark gets the wide tile, a flat mark is forced black, a square mark the 52px tile (v6.2.0)', () => {
  const wide = html(React.createElement(Logo, { id: 'thiel-fellowship', logo: '/programs/thiel-fellowship.svg', organizer: 'Thiel Foundation' }));
  assert.ok(wide.includes('data-ek-logo-wide') && wide.includes('w-[96px]') && wide.includes('brightness-0'));
  const square = html(React.createElement(Logo, { id: 'paypal-ai-hackathon', logo: '/programs/paypal-ai-hackathon.png', organizer: 'PayPal' }));
  assert.ok(square.includes('w-[52px]') && !square.includes('data-ek-logo-wide') && !square.includes('brightness-0'));
});

test('components write no raw hex and no /NN opacity on a token class; s-dim only in the footer (DESIGN.md)', () => {
  const dir = join(import.meta.dirname, '../../app/components');
  for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((x) => x.endsWith('.tsx'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.ok(!/\[#[0-9a-fA-F]{3,8}\]|\bs-[a-z0-9-]+\/\d/.test(src), f);
    if (!f.endsWith('Footer.tsx')) assert.ok(!src.includes('s-dim'), f);
  }
});

test('a failed read: the hero and the steps, no programs and no link (v6.2.0)', () => {
  const m = html(React.createElement(HomeView, { landing: null }));
  const t = textOf(m);
  assert.ok(t.includes(HERO_TITLE));
  for (const step of STEPS) assert.ok(t.includes(step), step);
  assert.ok(!t.includes('Open now') && !/See all/.test(t));
  assert.deepEqual(cardLinks(m), []);
});

test('the steps: one card, an ordered list of the three lines with serif numerals, no icons, no title (v6.2.0)', () => {
  const m = html(React.createElement(Steps));
  assert.equal(m.match(/<ol role="list"/g)?.length, 1);
  assert.ok(!/<svg|<h[1-6]/.test(m));
  const items = [...m.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
  assert.equal(items.length, 3);
  items.forEach((li, i) => {
    assert.match(li, new RegExp(`<span[^>]*ek-serif[^>]*>${i + 1}</span>`));
    assert.equal(textOf(li.replace(/<span[^>]*ek-serif[^>]*>\d<\/span>/, '')), STEPS[i]);
  });
  assert.equal(textOf(m), STEPS.map((s, i) => `${i + 1} ${s}`).join(' '));
});

test('#1 (v6.1.15), L25-2 (v6.1.16): the meta description, every share card and SchemaOrg say the one line: it fills the forms, never applies', async () => {
  assert.equal(ONE_LINE, 'Your agent finds the grants and prizes your repo fits and fills the forms. Free.');
  assert.equal(HERO_SUB, ONE_LINE);
  const layout = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'layout.tsx'), 'utf8');
  assert.ok(layout.includes('export const metadata: Metadata = SITE_METADATA;'));
  assert.ok(!layout.includes('applies'));
  assert.equal(layoutMetadata.description, ONE_LINE);
  assert.equal(layoutMetadata.openGraph?.description, ONE_LINE);
  assert.equal(homeMetadata.description, ONE_LINE);
  assert.equal(homeMetadata.openGraph?.description, ONE_LINE);
  const ld = JSON.parse(/<script[^>]*>([\s\S]*)<\/script>/.exec(html(React.createElement(SchemaOrg)))![1]) as { description: string };
  assert.equal(ld.description, 'Your agent finds the grants and prizes your repo fits and fills the forms. Free. Agents connect at https://earnkit.com/mcp.');
  assert.ok(!ld.description.includes('applies'));
});

test('L25-6 (v6.1.16, Review Focus 13): every page has its own share card: og:url is the canonical, and no two og:titles match', async () => {
  await upsertProgram(programFixture({ id: 'zz-page-card', title: 'Page Card Grants', summary: 'Up to $7,500 · rolling', max_award_usd: 7500, description: 'Grants for card makers. Second sentence here.' }), 'file', new Date());
  const metas = [
    ['/', homeMetadata],
    ['/docs', docsMetadata()],
    ['/programs', programsMetadata],
    ['/terms', termsMetadata()],
    ['/programs/zz-page-open', await guideMetadata(params('zz-page-open'))],
    ['/programs/zz-page-soon', await guideMetadata(params('zz-page-soon'))],
    ['/programs/zz-page-card', await guideMetadata(params('zz-page-card'))],
  ] as const;
  const titles = new Set<string>();
  for (const [path, m] of metas) {
    const og = m.openGraph as { url?: string; title?: string; description?: string; images?: unknown[] };
    assert.equal(String(m.alternates?.canonical), path === '/' ? 'https://earnkit.com' : `https://earnkit.com${path}`, path);
    assert.equal(String(og.url), String(m.alternates?.canonical), path);
    assert.ok(og.title && og.description && (og.images ?? []).length === 1, path);
    titles.add(String(og.title));
  }
  assert.equal(titles.size, metas.length);
  assert.equal(docsMetadata().title, 'Add EarnKit to your agent · EarnKit');
  assert.equal(programsMetadata.title, 'Programs · EarnKit');
  assert.equal(termsMetadata().title, 'Terms · EarnKit');
  const card = (await guideMetadata(params('zz-page-card'))).openGraph as { title?: string; description?: string };
  assert.equal(card.title, 'Page Card Grants: Up to $7,500');
  assert.equal(card.description, 'Grants for card makers.');
  assert.equal(firstLine(''), ONE_LINE);
});

test('L25-21 (v6.1.16): the 404 has no canonical and one robots noindex', async () => {
  assert.equal(layoutMetadata.alternates, undefined);
  assert.equal(layoutMetadata.robots, undefined);
  assert.equal((layoutMetadata.openGraph as { url?: string }).url, undefined);
  // The unmatched-path 404: Next adds its own noindex to a 404 response, so the page sets none (one meta, checked on
  // the built server); the unknown guide answers 200 and carries the one noindex itself.
  assert.deepEqual(notFoundMetadata, { title: 'Not found · EarnKit' });
  const guide = await guideMetadata(params('nope'));
  assert.equal(guide.title, 'Not found · EarnKit');
  assert.deepEqual(guide.robots, { index: false });
  assert.equal('alternates' in guide, false);
  assert.equal('openGraph' in guide, false);
});

test('no rust look remains in the landing components (v6.2.0)', () => {
  for (const f of ['Opportunities.tsx', 'Steps.tsx']) {
    const src = readFileSync(join(import.meta.dirname, '../../app/components/landing', f), 'utf8');
    assert.ok(!/rust/i.test(src), f);
  }
});

test('/programs is a page with every listed program, the title and the description line, not a redirect', async () => {
  const m = html(await ProgramsPage());
  assert.ok(m.includes('href="/programs/zz-page-open"') && m.includes('href="/programs/zz-page-soon"'));
  assert.match(m, /<h1[^>]*>Programs<\/h1>/);
  assert.ok(textOf(m).includes(PROGRAMS_DESCRIPTION));
  assert.ok(textOf(m).includes('Not open yet'));
  assert.ok(!/See all/.test(textOf(m)));
  const all = html(React.createElement(Opportunities, { programs: TILES45, total: 45, full: true }));
  assert.equal(cardLinks(all).length, 45);
  assert.ok(!/See all/.test(textOf(all)));
});

test('/programs/<id> renders the guide; a missing logo file renders no image', async () => {
  const m = html(await ProgramGuidePage(params('zz-page-open')));
  const t = textOf(m);
  assert.ok(t.includes('Page Open Grants') && /\$\s?5,000/.test(t));
  assert.ok(t.includes('Project name') && t.includes('A project name.'));
  assert.ok(t.includes('Apply from a public repo.'));
  assert.ok(t.includes('https://example.com/grants') || t.includes('Program page.'));
  assert.ok(!m.includes('/programs/zz-page-open.svg'), 'no image for a logo file that does not exist');
  assert.ok(!/<img[^>]+programs\/zz/.test(m));
  // One text node, so no gap before the colon (lane 5, 4).
  assert.ok(m.includes('>Sources:</span>'), m);
  const meta = await guideMetadata(params('zz-page-open'));
  assert.match(String(meta.title), /Page Open Grants/);
  assert.ok(t.includes('What the form asks'));
});

test('L25-18 (v6.1.16): a guide whose form lists nothing has no "What the form asks"', async () => {
  const t = textOf(html(await ProgramGuidePage(params('zz-page-soon'))));
  assert.ok(t.includes('Page Soon Grants'));
  assert.ok(!t.includes('What the form asks'), t);
});

test('/programs/<id>: an upcoming and a closed program still render', async () => {
  assert.ok(textOf(html(await ProgramGuidePage(params('zz-page-soon')))).includes('Not open yet'));
  assert.ok(textOf(html(await ProgramGuidePage(params('zz-page-shut')))).includes('Closed'));
});

/** The page's notFound(): Next's 404 signal, thrown. */
const throws404 = async (p: Promise<unknown>) => assert.rejects(p, (e: { digest?: string }) => e.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');

test('L27-3 (v6.1.16): an unknown guide id is a true 404: the proxy rewrites it to the site 404 page (lang, main, h1), the page itself calls notFound()', async () => {
  // A notFound() thrown by the page reaches the browser as Next 16.4's empty error shell, so the proxy rewrites an id
  // no list shows to a path no route serves; that renders app/not-found.tsx inside the layout with status 404.
  const ids = async () => new Set(['zz-page-open']);
  for (const id of ['nope', 'no-such-program', 'zz-page-broken']) assert.equal((await guideGate(new URL(`https://earnkit.com/programs/${id}`), ids))?.pathname, NOT_A_ROUTE, id);
  assert.equal(await guideGate(new URL('https://earnkit.com/programs/zz-page-open'), ids), null);
  assert.equal(await guideGate(new URL('https://earnkit.com/programs'), ids), null);
  assert.equal(await guideGate(new URL('https://earnkit.com/programs/zz-page-open.svg'), ids), null);
  assert.equal(await guideGate(new URL('https://earnkit.com/docs'), ids), null);
  // A failed read leaves the page to answer.
  assert.equal(await guideGate(new URL('https://earnkit.com/programs/nope'), async () => { throw new Error('db down'); }), null);
  // The page behind it: notFound() for an unknown id and a record that no longer parses (noindex through the metadata).
  for (const id of ['nope', 'zz-page-broken', 'Not A Slug']) await throws404(ProgramGuidePage(params(id)));
  const meta = await guideMetadata(params('nope'));
  assert.match(String(meta.title), /Not found · EarnKit/);
  assert.equal((meta.robots as { index?: boolean }).index, false);
  // The 404 page: one h1 with the 404 text and the link home; the layout gives it lang and main.
  const m = html(React.createElement(NotFoundPage));
  assert.equal((m.match(/<h1/g) ?? []).length, 1);
  assert.match(m, /<h1[^>]*>Nothing shipped here\.<\/h1>/);
  assert.ok(m.includes('href="/"') && textOf(m).includes('Go home.'));
  const layout = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'layout.tsx'), 'utf8');
  assert.ok(layout.includes('<html lang="en">') && layout.includes('<main id="content"'));
});

test('/docs: the seven sections, under 470 words, the copy rules', () => {
  const m = html(DocsPage());
  const t = textOf(m);
  for (const s of ['Install', 'How a session goes', 'Your record', 'Screening, for programs', 'For program owners', 'How programs are checked', 'Terms']) assert.ok(t.includes(s), s);
  assert.ok(m.includes('href="/terms"'));
  assert.ok(!/selector/i.test(t));
  const words = t.split(' ').length;
  // L15-20 (v6.1.14): the program owners' five lines add about 90 words to the old 330.
  // #15 (v6.1.15): the ruled tier glosses add 36 words to the screening text (455 now).
  // L27-31 (v6.1.16): the record card's ruled name-limit line adds 7 words (464 now); the controller ruled the 470 cap
  // (Task 13 fix round 1, N1): the ruled lines added the words.
  assert.ok(words < 470, `docs page is ${words} words`);
  // L25-4, L25-8, L25-11 (v6.1.16): the other-agent line under the tabs, the approval line, the results promise.
  for (const line of ['Another agent? Add https://earnkit.com/mcp as a remote MCP server and sign in.', 'Your agent sends nothing you did not say yes to, and saved answers wait for your approval on your record page.', 'Results come once a day, within 24 hours,'])
    assert.ok(t.includes(line), line);
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
  assert.ok(!t.includes('—'));
});

test('/terms: five sections; no "token" (L25-22)', () => {
  const m = html(TermsPage());
  const t = textOf(m);
  // The record page is a link, not a path (lane 5, 3.30).
  assert.match(m, /any time on <a [^>]*href="\/me"[^>]*>your record page<\/a>\./);
  assert.ok(t.replaceAll(' .', '.').includes('You can edit or delete it any time on your record page.'), t);
  assert.ok(!/\s\/me\b/.test(t), t);
  for (const s of ['What EarnKit reads', 'What it stores', 'What it never does', 'Your record', 'Programs']) assert.ok(t.includes(s), s);
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
  assert.ok(!/\btokens?\b/i.test(t), t);
  assert.ok(!t.includes('—'));
});

test('/llms.txt is plain text', async () => {
  const res = await llmsGet();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
  assert.match(await res.text(), /https:\/\/earnkit\.com\/mcp/);
});

test('/api/stats answers the eleven keys (L22-1, v6.1.16: won_other and won_without_amount)', async () => {
  const res = await statsGet();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, number>;
  assert.equal(Object.keys(body).length, 11);
  assert.ok(body.programs_open >= 2);
});

test('/api/programs lists the programs', async () => {
  const res = await programsGet(new Request('https://earnkit.com/api/programs'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; programs: { id: string }[] };
  assert.ok(body.ok && body.programs.some((p) => p.id === 'zz-page-open'));
});

test('the sitemap lists the pages and every listed program', async () => {
  const urls = (await sitemap()).map((e) => e.url);
  for (const u of ['https://earnkit.com', 'https://earnkit.com/programs', 'https://earnkit.com/docs', 'https://earnkit.com/terms', 'https://earnkit.com/programs/zz-page-open', 'https://earnkit.com/programs/zz-page-soon'])
    assert.ok(urls.includes(u), u);
  assert.ok(!urls.some((u) => /leaderboard|feed/.test(u)));
  assert.ok(!urls.includes('https://earnkit.com/programs/zz-page-shut'));
});

test('a stale API program has no guide; a closed file program says Closed and has no Apply link', async () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
  await upsertProgram(programFixture({ id: 'zz-page-stale', title: 'Page Stale Grants', verified_at: old }), 'api', new Date());
  await sql()`UPDATE programs SET verified_at = ${old} WHERE id = 'zz-page-stale'`;
  await throws404(ProgramGuidePage(params('zz-page-stale')));
  const m = html(await ProgramGuidePage(params('zz-page-shut')));
  assert.ok(textOf(m).includes('Closed'));
  assert.ok(!m.includes('https://example.com/apply') && !textOf(m).includes('Apply on the program site'));
  assert.ok(!m.includes(">Ask your agent<"));
});

test('/docs says it connects once (the intro line) and never asks the builder to approve a page', () => {
  const t = textOf(html(DocsPage()));
  assert.equal(t.split('connects').length - 1, 1, t);
  assert.ok(t.includes('It connects at once.'));
  assert.ok(!t.includes('Approve the connection') && !t.includes('Approve it when the page opens'));
});

test('an unknown id is gated before any per-id read', async () => {
  let reads = 0;
  const read = async (id: string) => (reads++, guideTextById(id));
  assert.equal(await gatedGuidePage('nope', async () => ['zz-page-open'], read), null);
  assert.equal(reads, 0);
  assert.ok(await gatedGuidePage('zz-page-open', async () => ['zz-page-open'], read));
  assert.equal(reads, 1);
  const ids = await listGuideIds();
  assert.ok(ids.includes('zz-page-open') && ids.includes('zz-page-shut') && !ids.includes('zz-page-stale') && !ids.includes('nope'));
});

test('/me without a cookie is a redirect to /docs#record, on the public origin', async () => {
  const saved = process.env.EARNKIT_URL;
  process.env.EARNKIT_URL = 'https://earnkit.com';
  try {
    // L23-15 (v6.1.16): a cookie whose session is gone (ended, or never one) goes to the expired line, the cookie cleared.
    for (const [headers, to] of [[{}, '/docs#record'], [{ cookie: 'ek_me=forged' }, '/docs?expired=1#record']] as [Record<string, string>, string][]) {
      const r = await proxy(new Request('http://10.0.0.7:8080/me', { headers }) as never);
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), `https://earnkit.com${to}`);
      assert.equal(/ek_me=;.*Max-Age=0/.test(r.headers.get('set-cookie') ?? ''), to.includes('expired'), to);
    }
  } finally {
    if (saved === undefined) delete process.env.EARNKIT_URL;
    else process.env.EARNKIT_URL = saved;
  }
});

test('L27-4 (v6.1.16): /link/nope is a page: 404 in the data with its h1 when sign-in is set up, 503 when not; a POST to it is 405', async () => {
  const keys = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'EARNKIT_AUTH_SECRET'] as const;
  const saved = keys.map((k) => process.env[k]);
  const view = (s: Awaited<ReturnType<typeof linkState>>) => html(React.createElement(LinkView, { s, code: 'nope', host: 'earnkit.com' }));
  try {
    for (const k of keys) delete process.env[k];
    const off = await linkState('nope', new Date(), new Headers({ 'x-real-ip': '198.51.100.201' }));
    assert.equal(off.status, 503);
    assert.match(view(off), /<h1[^>]*>Sign-in is not set up yet\.<\/h1>/);
    Object.assign(process.env, { GITHUB_OAUTH_CLIENT_ID: 'Iv1.x', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_AUTH_SECRET: 'pages-secret-0123456789abcdef0123456789' });
    const on = await linkState('nope', new Date(), new Headers({ 'x-real-ip': '198.51.100.202' }));
    assert.equal(on.status, 404);
    assert.match(view(on), /<h1[^>]*>This link is not one of ours\.<\/h1>/);
    assert.equal(linkDocTitle(on.title), 'This link is not one of ours · EarnKit');
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  }
  // The page's old POST moved to /link/<code>/confirm (Task 5's helper: 405 with Allow).
  const post = await proxy(new Request('https://earnkit.com/link/nope', { method: 'POST' }) as never);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  // A sign-in code is case-sensitive: never lower-cased (Task 10's 308 skips /link).
  const get = await proxy(new Request('https://earnkit.com/link/AbCdEfGhIjKlMnOpQrStUv') as never);
  assert.notEqual(get.status, 308);
});

test('no response names the framework: X-Powered-By is off (v6.1.7 S5)', () => {
  assert.equal(nextConfig.poweredByHeader, false);
});

test('the sitemap has no /me, /link or /auth', async () => {
  const urls = (await sitemap()).map((e) => e.url);
  assert.ok(!urls.some((u) => /\/(me|link|auth)(\/|$)/.test(u)));
});

test('/me renders the record in builder words: approvals first, plain forms, no script, the delete card last', async () => {
  process.env.EARNKIT_AUTH_SECRET ??= 'pages-secret-0123456789abcdef0123456789';
  const now = new Date();
  const b = await upsertBuilder({ github_id: 990_001, login: 'pagesme', name: null, avatar_url: null }, now);
  const patch = { person: { name: 'Pat' }, answers: { problem: { text: 'Builders <miss> grants.' } }, projects: [{ id: 'kit', name: 'Kit' }] };
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), patch, 'agent', now).record, now);
  const m = html(MeView({ data: await meData(b, now, 'sess'), problem: '<b>Email: bad.</b>', open: 'answers.problem' }));
  const t = textOf(m);
  assert.ok(!/<script/i.test(m));
  assert.ok(m.includes('&lt;b&gt;Email: bad.&lt;/b&gt;'), 'the problem line is escaped');
  assert.ok(t.indexOf('Read these, then approve each: an unapproved answer is never sent.') < t.indexOf('About you'));
  assert.ok(t.lastIndexOf('Deleting your account unlinks your agents, ends your reviewer access and removes your applications. Programs keep their screens.') > t.indexOf('Your agents'));
  for (const w of ['About you', 'Your projects', 'The company', 'Your documents', 'Traction', 'Your answers', 'Standing approval', 'Apply without asking, within these limits', 'Press submit for me when I say yes.', 'Ask me first above (USD)', 'Your one line on traction'])
    assert.ok(t.includes(w), w);
  assert.ok(!/\b(person|company|traction|policy|answers)\.[a-z_]+\b/.test(t), 'no path is shown');
  assert.ok(!BANNED.test(t.replace('pagesme', '')), t.match(BANNED)?.[0]);
  // An Approve form carries the set_at the builder saw.
  assert.ok(/name="action" value="approve"\/><input type="hidden" name="seen" value="\d{4}-/.test(m), 'approve carries seen');
  const forms = m.match(/<form[^>]*>/g) ?? [];
  assert.ok(forms.length > 10 && forms.every((f) => /method="post"/.test(f) && /action="\/me\//.test(f)));
  assert.equal((m.match(/name="csrf"/g) ?? []).length, forms.length);
});

test('L21-22 (v6.1.16, fix round 1 M2): on /me with a linked agent the footer and header drop the install pill; the Ask line stays', async () => {
  const { default: Footer } = await import('../../app/components/common/Footer');
  const { default: Header } = await import('../../app/components/common/Header');
  const { FOOT_CTA } = await import('./site-copy');
  const linked = html(Footer({ linked: true }));
  const plain = html(Footer());
  assert.ok(textOf(linked).includes(FOOT_CTA) && textOf(plain).includes(FOOT_CTA), 'Ask your agent: What can I earn? stays');
  assert.ok(!linked.includes(CTA_INSTALL), 'no install pill with a linked agent');
  assert.ok(plain.includes(CTA_INSTALL), 'the pill everywhere else');
  // The header's pill hides on a page that carries data-me-linked (MeView, with a linked agent).
  const header = html(Header());
  assert.ok(header.includes('[body:has([data-me-linked])_&amp;]:hidden') || header.includes('[body:has([data-me-linked])_&]:hidden'), header);
});

test('L21-16, L21-24 (v6.1.16, fix round 1 M3): a rendered guide shows the city pill first and the close in days', async () => {
  const ends = new Date(Date.now() + 5 * 86_400_000 - 3_600_000).toISOString();
  await upsertProgram(programFixture({ id: 'zz-page-city', title: 'Page City Hack', in_person: true, city: 'Eugene', ends_at: ends, summary: '$4,600 in prizes · 11:59 PM PT', pool_usd: 4600, reward: '$4,600 in prizes' }), 'file', new Date());
  const m = html(await ProgramGuidePage(params('zz-page-city')));
  const pills = m.match(/<ul aria-label="How to apply"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const first = pills.match(/<li[^>]*>([^<]*)<\/li>/)?.[1];
  assert.equal(first, 'In person: Eugene.', pills);
  assert.ok(textOf(m).includes('Closes in 5 days.'), textOf(m));
});

test('L21-5 (v6.1.16): the landing, programs-list and guide caches are keyed through cacheKey, which holds the build id', async () => {
  const src = readFileSync(join(import.meta.dirname, '../../app/lib/landing-cache.ts'), 'utf8');
  // The landing and /programs share the landing read; the guide ids and each guide have their own.
  // L23-2 (v6.1.16): the guide's row is cached; its page is derived from the clock at render.
  for (const key of ['landing-v6.4', 'guide-ids-v6', 'guide-row-v6.1.16']) assert.match(src, new RegExp(`cachedRead\\([^\\n]*\\['${key.replaceAll('.', '\\.')}'\\]\\)`), key);
  assert.ok(!/unstable_cache/.test(src), 'no cache made around cacheKey');
  const cached = readFileSync(join(import.meta.dirname, '../../app/lib/cached.ts'), 'utf8');
  assert.match(cached, /unstable_cache\(read, cacheKey\(key\),/);
  const { BUILD_ID, cacheKey } = await import('../../app/lib/cached');
  assert.equal(cacheKey(['guide-row-v6.1.16']).at(-1), BUILD_ID);
  // No other page cache bypasses it.
  for (const dir of ['app', 'app/lib', 'app/programs', 'app/programs/[id]']) {
    const d = join(import.meta.dirname, '../..', dir);
    for (const f of readdirSync(d).filter((x) => /\.tsx?$/.test(x) && x !== 'cached.ts'))
      assert.ok(!/unstable_cache\(/.test(readFileSync(join(d, f), 'utf8')), `${dir}/${f}`);
  }
});

test('v6.1.17 Task 4: /api/me/signed-in answers only { signedIn } and is never stored: true with a live session, false without', async () => {
  const { GET } = await import('../../app/api/me/signed-in/route');
  const { createSession, cookieName } = await import('../v6/sessions');
  const b = await upsertBuilder({ github_id: 990_101, login: 'signedinroute', name: null, avatar_url: null }, new Date());
  const { token } = await createSession(b.id, new Date());
  for (const [cookie, want] of [[`${cookieName()}=${token}`, true], [null, false], [`${cookieName()}=forged`, false]] as const) {
    const r = await GET(new Request('https://earnkit.test/api/me/signed-in', { headers: cookie ? { cookie } : {} }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store', String(cookie));
    assert.deepEqual(await r.json(), { signedIn: want }, String(cookie));
  }
  // The home page's server HTML (the layout's header and the page) never names the record link.
  const layout = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'layout.tsx'), 'utf8');
  assert.ok(!/headers\(\)|cookies\(\)/.test(layout));
  const { default: Header } = await import('../../app/components/common/Header');
  assert.ok(!html(Header()).includes('Your record'));
});

test('L35-24 (v6.1.17 Task 4): /me collapses each answer to its first line, one open at a time, and a 154-answer record stays under 500 KB', async () => {
  process.env.EARNKIT_AUTH_SECRET ??= 'pages-secret-0123456789abcdef0123456789';
  const { ANSWER_KINDS } = await import('./program-file');
  const { firstLineOf } = await import('../v6/me-view');
  const now = new Date();
  // Lane 35's H.19 fixture: 14 kinds in 11 places (the record and 10 projects), each near the 2,000 cap (emoji count
  // two toward it today).
  for (const [n, body] of [[0, '\u{1F600}'.repeat(960)], [1, 'x'.repeat(1930)]] as const) {
    const b = await upsertBuilder({ github_id: 990_200 + n, login: `bigrecord${n}`, name: null, avatar_url: null }, now);
    const ans = (tag: string) => Object.fromEntries(ANSWER_KINDS.map((k) => [k, { text: `${tag} ${k} ${body}\nSecond line ${k}.` }]));
    const patch = { answers: ans('rec'), projects: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Proj ${i}`, answers: ans(`p${i}`) })) };
    const merged = mergeRecord(await getRecord(b.id), patch, 'agent', now);
    assert.deepEqual(merged.problems, []);
    await saveRecord(b.id, merged.record, now);
    const data = await meData(b, now, 'sess');
    const closed = html(MeView({ data, problem: null }));
    assert.equal((closed.match(/<details[^>]*name="answers"/g) ?? []).length, 154);
    assert.ok(!/<details[^>]* open=""/.test(closed), 'none open');
    assert.ok(!closed.includes('Second line'), 'collapsed to the first line');
    // Waiting for you counts the 154 and links the first; each is marked where it sits.
    assert.ok(textOf(closed).includes('154 answers wait for you below. Open the first one'));
    assert.ok(closed.includes('href="/me?open=answers.one_liner#a-answers.one_liner"'));
    assert.equal(closed.split('Waiting for you.').length - 1, 154);
    // The page in a browser carries the React payload too, about one and a half times this again (lane 35 measured the
    // whole response: 755 KB before the count replaced the repeated rows, under 500 KB after).
    const size = Buffer.byteLength(closed);
    assert.ok(size < 200 * 1024, `${Math.round(size / 1024)} KB`);
    // One open: its field (the edit box and Approve) in full; every other stays one line.
    const opened = html(MeView({ data, problem: null, open: 'projects.p3.answers.risks' }));
    assert.equal((opened.match(/<details[^>]* open=""/g) ?? []).length, 1);
    assert.equal(opened.split('Second line risks.').length - 1, 1);
    assert.match(opened, /name="path" value="projects\.p3\.answers\.risks"\/><input type="hidden" name="action" value="approve"\/>/);
    assert.ok(opened.includes('name="projects.p3.answers.risks"'));
    assert.ok(/<input type="hidden" name="open" value="projects\.p3\.answers\.risks"\/>/.test(opened), 'the open answer stays open after Save');
    assert.ok(Buffer.byteLength(opened) < 200 * 1024);
    assert.ok(closed.includes(`href="/me?open=answers.problem#a-answers.problem"`));
  }
  // The first line: cut at a word with an ellipsis, by characters.
  assert.equal(firstLineOf('\n  First one.\nSecond.'), 'First one.');
  assert.equal(firstLineOf(`${'word '.repeat(40)}`), `${'word '.repeat(12).trim()}…`);
  assert.equal(Array.from(firstLineOf('\u{1F600}'.repeat(300))).length, 61);
});

test('v6.1.16 Task 13 N2 (v6.1.17 Task 4): /link pages send form-action self and GitHub, after the site-wide CSP so theirs wins, frame-ancestors kept', async () => {
  const rules = await nextConfig.headers!();
  const csp = (source: string) => rules.findLastIndex((r) => r.source === source && r.headers.some((h) => h.key === 'Content-Security-Policy'));
  const link = rules[csp('/link/:path*')];
  assert.ok(link, 'a /link CSP rule');
  assert.ok(csp('/link/:path*') > csp('/:path*'), 'after the site-wide one');
  assert.equal(link.headers.find((h) => h.key === 'Content-Security-Policy')?.value, "frame-ancestors 'none'; form-action 'self' https://github.com");
});

test('v6.1.16 Task 13 N3 (v6.1.17 Task 4): a failed guide-id read is never kept as a 404; the next request reads again', async () => {
  const { okFor } = await import('../../proxy');
  const { definiteGuideIds } = await import('./guide-page');
  // An empty list is a failed read: it throws, so no cache keeps it.
  await assert.rejects(definiteGuideIds(new Date(), async () => []), /no guide ids/);
  assert.ok((await definiteGuideIds()).includes('zz-page-open'));
  // The proxy's minute cache keeps only a success: a failure throws (the gate lets the request through) and is retried.
  let t = 0;
  let calls = 0;
  let fail = true;
  const ids = okFor(async () => {
    calls++;
    if (fail) throw new Error('db down');
    return new Set(['zz-page-open']);
  }, 60_000, () => t);
  await assert.rejects(ids());
  assert.equal(await guideGate(new URL('https://earnkit.com/programs/nope'), ids), null, 'a failed read is never a 404');
  fail = false;
  assert.ok((await ids()).has('zz-page-open'));
  assert.equal(calls, 3, 'retried on the next request');
  t = 59_000;
  await ids();
  assert.equal(calls, 3, 'a success is kept for a minute');
  // The page's gate: a failed id read throws (getGuidePage answers 'error', uncached), never null (a 404).
  await assert.rejects(gatedGuidePage('zz-page-open', async () => { throw new Error('db down'); }, guideTextById));
  const src = readFileSync(join(import.meta.dirname, '../../app/lib/landing-cache.ts'), 'utf8');
  assert.match(src, /cachedRead\(\(\) => definiteGuideIds\(\), \['guide-ids-v6'\]\)/);
  assert.match(src, /await connection\(\);\n    return 'error';/);
});
