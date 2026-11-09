import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { sql } from './db';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';
import { gatedGuidePage, guideTextById, listGuideIds } from './guide-page';
import { HERO_TITLE, STEPS } from './site-copy';
import Home from '../../app/page';
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
const isNotFound = (e: unknown) => (e as { digest?: string })?.digest?.includes('404') === true;

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

test('/ shows the hero, the steps, every listed program and the install button', async () => {
  const m = html(await Home());
  const t = textOf(m);
  assert.ok(t.includes(HERO_TITLE));
  for (const [title] of STEPS) assert.ok(t.includes(title), title);
  assert.ok(t.includes('Open programs'));
  assert.ok(m.includes('href="/programs/zz-page-open"') && m.includes('href="/programs/zz-page-soon"'));
  assert.ok(!m.includes('href="/programs/zz-page-shut"'));
  assert.ok(t.includes('Not open yet'));
  assert.ok(t.includes('Add EarnKit to your agent'));
  assert.ok(!/Leaderboard|Feed|Bench|Activity/.test(t));
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
});

test('/programs is a page with the same list, not a redirect', async () => {
  const m = html(await ProgramsPage());
  assert.ok(m.includes('href="/programs/zz-page-open"') && m.includes('href="/programs/zz-page-soon"'));
  assert.match(m, /<h1[^>]*>Programs<\/h1>/);
});

test('/programs/<id> renders the guide; a missing logo file renders no image', async () => {
  const m = html(await ProgramGuidePage(params('zz-page-open')));
  const t = textOf(m);
  assert.ok(t.includes('Page Open Grants') && /\$\s?5K/.test(t));
  assert.ok(t.includes('Project name') && t.includes('a project name'));
  assert.ok(t.includes('Apply from a public repo.'));
  assert.ok(t.includes('https://example.com/grants') || t.includes('program page'));
  assert.ok(!m.includes('/programs/zz-page-open.svg'), 'no image for a logo file that does not exist');
  assert.ok(!/<img[^>]+programs\/zz/.test(m));
  const meta = await guideMetadata(params('zz-page-open'));
  assert.match(String(meta.title), /Page Open Grants/);
});

test('/programs/<id>: an upcoming and a closed program still render', async () => {
  assert.ok(textOf(html(await ProgramGuidePage(params('zz-page-soon')))).includes('Not open yet'));
  assert.ok(textOf(html(await ProgramGuidePage(params('zz-page-shut')))).includes('Closed'));
});

test('/programs/<id> is a 404 for an unknown id and for a record that no longer parses', async () => {
  for (const id of ['nope', 'zz-page-broken', 'Not A Slug'])
    await assert.rejects(() => ProgramGuidePage(params(id)) as Promise<unknown>, isNotFound, id);
  assert.match(String((await guideMetadata(params('nope'))).title), /Not found/);
});

test('/docs: the six sections, under 330 words, the copy rules', () => {
  const m = html(DocsPage());
  const t = textOf(m);
  for (const s of ['Install', 'How a session goes', 'Your record', 'Screening, for programs', 'How programs are checked', 'Terms']) assert.ok(t.includes(s), s);
  assert.ok(m.includes('href="/terms"'));
  assert.ok(!/selector/i.test(t));
  const words = t.split(' ').length;
  assert.ok(words < 330, `docs page is ${words} words`);
  assert.ok(!BANNED.test(t), t.match(BANNED)?.[0]);
  assert.ok(!t.includes('—'));
});

test('/terms: five sections; "token" only in "launch a token"', () => {
  const t = textOf(html(TermsPage()));
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
  await assert.rejects(() => ProgramGuidePage(params('zz-page-stale')) as Promise<unknown>, isNotFound);
  const m = html(await ProgramGuidePage(params('zz-page-shut')));
  assert.ok(textOf(m).includes('Closed'));
  assert.ok(!m.includes('https://example.com/apply') && !textOf(m).includes('Apply on the program site'));
  assert.ok(!m.includes(">Ask your agent<"));
});

test('/docs says "It connects on its own" once and never asks the builder to approve a page', () => {
  const t = textOf(html(DocsPage()));
  assert.equal(t.split('It connects on its own').length - 1, 1);
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
    assert.equal(await on.text(), 'This link has expired. Ask your agent for a new one.');
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  }
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
  assert.ok(t.lastIndexOf('This removes your record, your ledger and your sign-ins.') > t.indexOf('Your agents'));
  for (const w of ['About you', 'Your projects', 'The company', 'Your documents', 'Traction', 'Your answers', 'Standing approval', 'Apply without asking'])
    assert.ok(t.includes(w), w);
  assert.ok(!/\b(person|company|traction|policy|answers)\.[a-z_]+\b/.test(t), 'no path is shown');
  assert.ok(!BANNED.test(t.replace('pagesme', '')), t.match(BANNED)?.[0]);
  // An Approve form carries the set_at the builder saw.
  assert.ok(/name="action" value="approve"\/><input type="hidden" name="seen" value="\d{4}-/.test(m), 'approve carries seen');
  const forms = m.match(/<form[^>]*>/g) ?? [];
  assert.ok(forms.length > 10 && forms.every((f) => /method="post"/.test(f) && /action="\/me\//.test(f)));
  assert.equal((m.match(/name="csrf"/g) ?? []).length, forms.length);
});
