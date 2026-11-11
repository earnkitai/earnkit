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
import { CTA_INSTALL, EARN_ALL, EARN_EMPTY, HERO_SUB, HERO_TITLE, PROGRAMS_DESCRIPTION, STEPS } from './site-copy';
import SchemaOrg from '../../app/components/ui/SchemaOrg';
import type { Landing, Tile } from './landing';
import Home from '../../app/page';
import HomeView from '../../app/HomeView';
import Steps from '../../app/components/landing/Steps';
import Opportunities, { Logo } from '../../app/components/landing/Opportunities';
import ProgramsPage from '../../app/programs/page';
import ProgramGuidePage, { generateMetadata as guideMetadata } from '../../app/programs/[id]/page';
import DocsPage from '../../app/docs/page';
import TermsPage from '../../app/terms/page';
import { GET as llmsGet } from '../../app/llms.txt/route';
import { GET as statsGet } from '../../app/api/stats/route';
import { GET as programsGet } from '../../app/api/programs/route';
import sitemap from '../../app/sitemap';
import { proxy } from '../../proxy';
import MeView from '../../app/me/MeView';
import { getRecord, saveRecord, upsertBuilder } from '../v6/builders';
import { meData } from '../v6/me-view';
import { mergeRecord } from '../v6/record';
import { linkGet } from '../v6/link-routes';
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
  when: i % 3 ? 'Closes Dec 1' : 'Rolling', kind: 'grant', status: 'active', logo: null,
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
  assert.match(t, /See all \d+ programs/);
  assert.ok(!m.includes('href="/programs/zz-page-soon"') && !m.includes('href="/programs/zz-page-shut"'));
  assert.ok(t.includes('Add EarnKit to your agent'));
  assert.ok(!/Leaderboard|Feed|Bench|Activity/.test(t));
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
});

test('the landing with 45 programs: six cards, then one link "See all 45 programs" to /programs (v6.2.0)', () => {
  const m = html(React.createElement(HomeView, { landing: LANDING45 }));
  const t = textOf(m);
  assert.deepEqual(cardLinks(m), TILES45.slice(0, 6).map((x) => `href="/programs/${x.id}"`));
  assert.equal(EARN_ALL(45), 'See all 45 programs');
  assert.match(m, /<a[^>]*href="\/programs"[^>]*>See all 45 programs<\/a>/);
  assert.equal(t.split('See all 45 programs').length, 2);
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
  assert.equal(t, `Open now ${EARN_EMPTY} ${EARN_ALL(45)}`);
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

test('#1 (v6.1.15): the meta description and SchemaOrg copy the hero line: it fills the forms, never applies', () => {
  const layout = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'layout.tsx'), 'utf8');
  assert.ok(layout.includes('const DESCRIPTION = `${CTA_INSTALL} and ask: What can I earn? ${HERO_SUB}`;'));
  assert.equal(`${CTA_INSTALL} and ask: What can I earn? ${HERO_SUB}`, 'Add EarnKit to your agent and ask: What can I earn? Your agent finds the grants and prizes you fit and fills the forms. Free.');
  assert.ok(!layout.includes('applies'));
  const ld = JSON.parse(/<script[^>]*>([\s\S]*)<\/script>/.exec(html(React.createElement(SchemaOrg)))![1]) as { description: string };
  assert.equal(ld.description, 'Your agent finds the grants and prizes you fit and fills the forms. Free. Agents connect at https://earnkit.com/mcp.');
  assert.ok(ld.description.startsWith(HERO_SUB));
  assert.ok(!ld.description.includes('applies'));
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
});

test('/programs/<id>: an upcoming and a closed program still render', async () => {
  assert.ok(textOf(html(await ProgramGuidePage(params('zz-page-soon')))).includes('Not open yet'));
  assert.ok(textOf(html(await ProgramGuidePage(params('zz-page-shut')))).includes('Closed'));
});

test('/programs/<id>: an unknown id and a record that no longer parses render the site\'s not-found text server-side (L21-4)', async () => {
  // L21-4 (v6.1.16): notFound() here left the production body empty (the text only in the script payload), so the
  // page renders the not-found content itself: one h1, the same text and link as /nope, noindex.
  for (const id of ['nope', 'zz-page-broken', 'Not A Slug']) {
    const m = html(await ProgramGuidePage(params(id)));
    assert.equal((m.match(/<h1/g) ?? []).length, 1, id);
    assert.ok(textOf(m).includes('Nothing shipped here.') && m.includes('href="/"') && textOf(m).includes('Go home.'), id);
  }
  const meta = await guideMetadata(params('nope'));
  assert.match(String(meta.title), /Not found · EarnKit/);
  assert.equal((meta.robots as { index?: boolean }).index, false);
});

test('/docs: the seven sections, under 460 words, the copy rules', () => {
  const m = html(DocsPage());
  const t = textOf(m);
  for (const s of ['Install', 'How a session goes', 'Your record', 'Screening, for programs', 'For program owners', 'How programs are checked', 'Terms']) assert.ok(t.includes(s), s);
  assert.ok(m.includes('href="/terms"'));
  assert.ok(!/selector/i.test(t));
  const words = t.split(' ').length;
  // L15-20 (v6.1.14): the program owners' five lines add about 90 words to the old 330.
  // #15 (v6.1.15): the ruled tier glosses add 36 words to the screening text (455 now).
  assert.ok(words < 460, `docs page is ${words} words`);
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
  assert.ok(!t.includes('—'));
});

test('/terms: five sections; "token" only in "launch a token"', () => {
  const m = html(TermsPage());
  const t = textOf(m);
  // The record page is a link, not a path (lane 5, 3.30).
  assert.match(m, /any time on <a [^>]*href="\/me"[^>]*>your record page<\/a>\./);
  assert.ok(t.replaceAll(' .', '.').includes('You can edit or delete it any time on your record page.'), t);
  assert.ok(!/\s\/me\b/.test(t), t);
  for (const s of ['What EarnKit reads', 'What it stores', 'What it never does', 'Your record', 'Programs']) assert.ok(t.includes(s), s);
  assert.ok(!BANNED.test(t.replaceAll('launch a token', '')), t.match(BANNED)?.[0]);
  assert.ok(!t.includes('—'));
});

test('/llms.txt is plain text', async () => {
  const res = await llmsGet();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
  assert.match(await res.text(), /https:\/\/earnkit\.com\/mcp/);
});

test('/api/stats answers the nine keys', async () => {
  const res = await statsGet();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, number>;
  assert.equal(Object.keys(body).length, 9);
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
  assert.ok(textOf(html(await ProgramGuidePage(params('zz-page-stale')))).includes('Nothing shipped here.'));
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
    for (const headers of [{}, { cookie: 'ek_me=forged' }] as Record<string, string>[]) {
      const r = await proxy(new Request('http://10.0.0.7:8080/me', { headers }) as never);
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), 'https://earnkit.com/docs#record');
    }
  } finally {
    if (saved === undefined) delete process.env.EARNKIT_URL;
    else process.env.EARNKIT_URL = saved;
  }
});

test('/link/nope is 404 text when sign-in is set up and 503 when not', async () => {
  const keys = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'EARNKIT_AUTH_SECRET'] as const;
  const saved = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    const off = await linkGet(new Request('https://earnkit.com/link/nope', { headers: { 'x-real-ip': '198.51.100.201' } }), 'nope');
    assert.equal(off.status, 503);
    Object.assign(process.env, { GITHUB_OAUTH_CLIENT_ID: 'Iv1.x', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_AUTH_SECRET: 'pages-secret-0123456789abcdef0123456789' });
    const on = await linkGet(new Request('https://earnkit.com/link/nope', { headers: { 'x-real-ip': '198.51.100.202' } }), 'nope');
    assert.equal(on.status, 404);
    assert.match(on.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await on.text(), 'This link is not one of ours.');
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  }
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
  const m = html(MeView({ data: await meData(b, now, 'sess'), problem: '<b>Email: bad.</b>' }));
  const t = textOf(m);
  assert.ok(!/<script/i.test(m));
  assert.ok(m.includes('&lt;b&gt;Email: bad.&lt;/b&gt;'), 'the problem line is escaped');
  assert.ok(t.indexOf('Read these, then approve each: an unapproved answer is never sent.') < t.indexOf('About you'));
  assert.ok(t.lastIndexOf('Deleting your account unlinks your agents, ends your reviewer access and removes your applications. Programs keep their screens.') > t.indexOf('Your agents'));
  for (const w of ['About you', 'Your projects', 'The company', 'Your documents', 'Traction', 'Your answers', 'Standing approval', 'Apply overnight without asking, within these limits', 'Press submit for me when I say yes.', 'Skip awards above (USD)', 'Your one line on traction'])
    assert.ok(t.includes(w), w);
  assert.ok(!/\b(person|company|traction|policy|answers)\.[a-z_]+\b/.test(t), 'no path is shown');
  assert.ok(!BANNED.test(t.replace('pagesme', '')), t.match(BANNED)?.[0]);
  // An Approve form carries the set_at the builder saw.
  assert.ok(/name="action" value="approve"\/><input type="hidden" name="seen" value="\d{4}-/.test(m), 'approve carries seen');
  const forms = m.match(/<form[^>]*>/g) ?? [];
  assert.ok(forms.length > 10 && forms.every((f) => /method="post"/.test(f) && /action="\/me\//.test(f)));
  assert.equal((m.match(/name="csrf"/g) ?? []).length, forms.length);
});
