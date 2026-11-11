/**
 * Pages for everyone (lane 27, v6.1.16 Task 13; Review Focus 18 and 19): keyboard, screen reader, no JavaScript,
 * reader mode, print and small screens, pinned on server-rendered HTML (no browser).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';
import { SITE } from './site-theme';
import { CTA_INSTALL, ME_DELETED_LINE, NAV_RECORD, PROJECT_NAME_LIMIT, SKIP_LINK } from './site-copy';
import type { Landing, Tile } from './landing';
import HomeView from '../../app/HomeView';
import Header from '../../app/components/common/Header';
import Opportunities, { blocksOf, initialsOf, Logo } from '../../app/components/landing/Opportunities';
import DocsPage from '../../app/docs/page';
import ProgramGuidePage from '../../app/programs/[id]/page';
import MeView from '../../app/me/MeView';
import { metadata as meMetadata } from '../../app/me/page';
import { inertSiteRoot, SITE_ROOT, trapTarget } from '../../app/components/site/useFocusTrap';
import { getRecord, saveRecord, upsertBuilder } from '../v6/builders';
import { meData } from '../v6/me-view';
import { mergeRecord } from '../v6/record';

(globalThis as { React?: typeof React }).React = React;
after(() => sql().end());

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const APP = join(import.meta.dirname, '..', '..', 'app');
const read = (f: string) => readFileSync(join(APP, f), 'utf8');

before(async () => {
  await upsertProgram(programFixture({ id: 'zz-a11y-open', title: 'A11y Open Grants', organizer: 'Base Ecosystem Fund', ends_at: '2027-06-01T12:00:00Z', summary: 'Up to $5,000 · rolling', max_award_usd: 5000 }), 'file', new Date());
});

const tile = (i: number, over: Partial<Tile> = {}): Tile => ({
  id: `t-${i}`, title: `Tile ${i} Grants`, organizer: `Org ${i}`, money: 'Up to $5,000', big: true, when: 'Closes Dec 1', closes_at: null, zone: 'UTC', kind: 'grant', status: 'active', logo: null, ...over,
});
const LANDING: Landing = { chip: '$1.7M in grants and prizes open now', tiles: [tile(1), tile(2, { status: 'upcoming', when: 'Not open yet' })], featured: [tile(1)], total: 2 };

/** The install link as every primary action renders it (L27-1). */
const installLink = (label: string) => new RegExp(`<a href="/docs#install" data-install=""[^>]*>${label}</a>`);

test('L27-1 (Review Focus 18): the primary actions are links to /docs#install in the server HTML, never only a button', async () => {
  const home = html(React.createElement(HomeView, { landing: LANDING }));
  assert.match(home, installLink(CTA_INSTALL), 'hero and footer');
  assert.equal((home.match(/<a href="\/docs#install" data-install=""/g) ?? []).length, 2);
  const header = html(React.createElement(Header));
  assert.match(header, /<a href="\/docs#install" data-install=""[^>]*><span class="max-\[360px\]:hidden">Add EarnKit to your agent<\/span>/);
  const guide = html(await ProgramGuidePage({ params: Promise.resolve({ id: 'zz-a11y-open' }) }));
  assert.match(guide, installLink('Ask your agent'));
  const docs = html(DocsPage());
  assert.match(docs, installLink(CTA_INSTALL), 'the docs footer');
  for (const m of [home, header, guide, docs]) assert.ok(!/<button type="button"[^>]*>(Add EarnKit to your agent|Add to your agent|Ask your agent)</.test(m));
});

test('L27-2 (Review Focus 19): Tab from the last element goes to the first, Shift+Tab from the first to the last; focus outside comes back in', () => {
  const items = ['close', 'copy', 'tab', 'link'];
  assert.equal(trapTarget(false, items, 'link'), 'close');
  assert.equal(trapTarget(true, items, 'close'), 'link');
  assert.equal(trapTarget(false, items, 'copy'), null, 'the browser steps inside');
  assert.equal(trapTarget(true, items, 'tab'), null);
  assert.equal(trapTarget(false, items, 'behind'), 'close');
  assert.equal(trapTarget(true, items, null), 'link');
  assert.equal(trapTarget(false, [], 'x'), null);
});

test('L27-2: while the modal is open #site-root is inert, and it is removed on close; the layout wraps all but the portal', () => {
  const attrs = new Map<string, string>();
  const root = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
  const doc = { getElementById: (id: string) => (id === SITE_ROOT ? root : null) };
  inertSiteRoot(doc, true);
  assert.equal(attrs.get('inert'), '');
  inertSiteRoot(doc, false);
  assert.equal(attrs.has('inert'), false);
  const layout = read('layout.tsx');
  assert.ok(layout.indexOf('className="skip-link"') < layout.indexOf('<div id="site-root">'), 'the skip link comes first');
  assert.ok(layout.includes('<main id="content"'));
  const modal = read('components/sections/AddToAgent.tsx');
  assert.ok(modal.includes('useFocusTrap(dialogRef, true)') && modal.includes('createPortal(dialog, document.body)'));
  // The trap is declared before the focus-return effect, so inert is gone before focus goes back.
  assert.ok(modal.indexOf('useFocusTrap(') < modal.indexOf('previous?.focus()'));
});

test('L27-8: the skip link reads "Skip to content." and shows on focus', () => {
  assert.equal(SKIP_LINK, 'Skip to content.');
  assert.ok(read('layout.tsx').includes('<a href="#content" className="skip-link">'));
  const css = read('globals.css');
  assert.match(css, /\.skip-link:focus \{\s*top: 12px;/);
});

test('L27-6, L27-13: /programs is a list: one h2 per block, a ul of article items with an h3 link, the money and the close line; the landing one block and one h1', () => {
  const all = html(React.createElement(Opportunities, { programs: [tile(1), tile(2, { status: 'upcoming', when: 'Not open yet' }), tile(3)], total: 3, full: true }));
  assert.deepEqual([...all.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]), ['Open now', 'Not open yet']);
  assert.equal((all.match(/<h1/g) ?? []).length, 1);
  assert.equal((all.match(/<ul role="list"/g) ?? []).length, 2);
  const items = [...all.matchAll(/<li[^>]*><article[^>]*>([\s\S]*?)<\/article><\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.match(it, /^<h3[^>]*><a[^>]*href="\/programs\/t-\d"[^>]*>Tile \d Grants<\/a><\/h3>/);
    const words = it.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(words.includes('$ 5,000') && /Closes Dec 1|Not open yet/.test(words), words);
  }
  assert.deepEqual(blocksOf([tile(1, { status: 'closed' as Tile['status'] })]).map((b) => b.title), ['Closed']);
  const home = html(React.createElement(HomeView, { landing: LANDING }));
  assert.equal((home.match(/<h1/g) ?? []).length, 1, 'the hero h1 only');
  assert.match(home, /<section aria-labelledby="hero-title"[\s\S]*<h1 id="hero-title"/);
  assert.equal((home.match(/<h2[^>]*>Open now<\/h2>/g) ?? []).length, 1);
  assert.ok(/<li[^>]*><article/.test(home));
});

test('L27-7: one print block: white page, near-black text, nav, install actions and modal hidden, logo kept, links underlined', () => {
  const css = read('globals.css');
  assert.equal((css.match(/@media print/g) ?? []).length, 1);
  const print = css.slice(css.indexOf('@media print'));
  for (const rule of ['background: #fff', 'color: #111', 'header nav', '[data-install]', "[role='dialog']", 'display: none', 'text-decoration: underline'])
    assert.ok(print.includes(rule), rule);
  assert.ok(!/header svg[^{]*\{[^}]*display: none/.test(print), 'the logo stays');
});

/** The contrast ratio of two #RRGGBB colours (WCAG 2). Pure. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('L27-12, L27-28: field edges at 3:1 or better on the page and the field panel; docs numerals and the record panel at 5:1 or better', () => {
  assert.ok(contrast(SITE.fieldLine, SITE.page) >= 3, String(contrast(SITE.fieldLine, SITE.page)));
  assert.ok(contrast(SITE.fieldLine, SITE.panelInner) >= 3);
  assert.ok(contrast(SITE.blueTop, SITE.lightInner) >= 5, 'step numerals');
  assert.ok(contrast(SITE.onBlue, SITE.blueTop) >= 5, 'record panel');
  const docs = html(DocsPage());
  assert.match(docs, /data-ek-step=""[^>]*><span class="ek-serif text-\[32px\] leading-none text-s-blue-top">1</);
  assert.match(docs, /<section id="record"[^>]*class="[^"]*bg-s-blue-top/);
  assert.ok(read('me/MeView.tsx').includes('border border-s-field-line'));
});

test('L27-30, L27-31: the docs command block is a focusable region; the record card tells the name limit', () => {
  const docs = html(DocsPage());
  assert.match(docs, /<pre data-ek-code="" tabindex="0" role="region" aria-label="Command"/);
  assert.match(read('globals.css'), /\[data-ek-code\]:focus-visible \{\s*outline: 2px solid/);
  assert.ok(docs.includes(`>${PROJECT_NAME_LIMIT}</p>`));
});

test('L27-16, L27-17: signed in the nav shows Your record to /me; under 360px the pill says Add', () => {
  const out = html(Header());
  const signed = html(Header({ signedIn: true }));
  assert.ok(!out.includes(NAV_RECORD));
  assert.match(signed, new RegExp(`<a[^>]*href="/me"[^>]*>${NAV_RECORD}</a>`));
  assert.ok(signed.includes('<span class="hidden max-[360px]:inline">Add</span>'));
  assert.ok(signed.includes('max-[360px]:gap-x-4'));
  assert.ok(read('layout.tsx').includes('<Header signedIn={Boolean((await cookies()).get(COOKIE)?.value)} />'));
});

test('L27-23, L27-24: a tile without a logo shows the organizer initials; the organizer chip wraps to two lines, no ellipsis', () => {
  assert.equal(initialsOf('Base Ecosystem Fund'), 'BE');
  assert.equal(initialsOf('Thiel Foundation'), 'TF');
  assert.equal(initialsOf('The Graph'), 'G');
  assert.equal(initialsOf('Department of Energy'), 'DE');
  assert.equal(initialsOf('PayPal'), 'P');
  const logo = html(React.createElement(Logo, { id: 'x', logo: null, organizer: 'Base Ecosystem Fund' }));
  assert.match(logo, /data-ek-logo-initials=""[^>]*w-\[52px\][^>]*>BE<\/span>/);
  const card = html(React.createElement(Opportunities, { programs: [tile(1, { organizer: 'Ethereum Foundation Trillion Dollar Security' })], total: 1, full: true }));
  assert.match(card, /<span class="line-clamp-2[^"]*">Ethereum Foundation Trillion Dollar Security<\/span>/);
  assert.ok(!/\btruncate\b|text-ellipsis/.test(read('components/landing/Opportunities.tsx')));
});

test('L27-8, L27-29, L27-21 (Review Focus 18): /me: every form has an action and a submit, one Save per section, hints as described-by, no canonical', async () => {
  process.env.EARNKIT_AUTH_SECRET ??= 'a11y-secret-0123456789abcdef0123456789';
  const now = new Date();
  const b = await upsertBuilder({ github_id: 990_301, login: 'a11yme', name: null, avatar_url: null }, now);
  // The agent set the stage, so the choice field carries a hint (From your agent).
  const patch = { person: { name: 'Pat' }, company: { stage: 'building' }, projects: [{ id: 'kit', name: 'Kit' }] };
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), patch, 'agent', now).record, now);
  const data = await meData(b, now, 'sess');
  const m = html(MeView({ data, problem: null }));
  const forms = [...m.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/g)];
  for (const [, attrs, body] of forms) {
    assert.match(attrs, /action="\/me\/[a-z]+"/);
    assert.match(body, /<button type="submit"/);
  }
  // One Save per section card (the policy form included); delete, sign out and approvals are their own buttons.
  const saves = (m.match(/>Save<\/button>/g) ?? []).length;
  assert.equal(saves, data.blocks.filter((b) => b.fields.length > 0).length);
  assert.equal((m.match(/<input type="hidden" name="section"/g) ?? []).length, saves - 1);
  // Tab stops: every field, one Save per section, sign out and delete (lane 27 counted 126 with a Save per field).
  const stops = (m.match(/<(a [^>]*href|button|select|textarea|input(?![^>]*type="hidden"))/g) ?? []).length;
  assert.ok(stops < 75, `${stops} tab stops`);
  assert.equal((m.match(/type="submit"/g) ?? []).length, saves + 2, 'the Saves, sign out and delete');
  // Every field belongs to its section's form.
  for (const key of ['person', 'projects', 'answers']) assert.match(m, new RegExp(`<form id="form-${key}"[^>]*action="/me/edit"`), key);
  const control = (id: string) => new RegExp(`<(input|textarea|select) id="${id.replace(/\./g, '\\.')}"[^>]*>`).exec(m);
  assert.match(control('f-person.name')![0], /form="form-person"/);
  assert.match(control('f-person.name')![0], /name="person\.name"/);
  // Label, then the control, then the hint by id (a text, a long and a choice field).
  for (const [path, tag] of [['projects.kit.name', 'input'], ['docs.other', 'textarea'], ['company.stage', 'select']] as const) {
    const id = `f-${path}`;
    const c = control(id)!;
    assert.equal(c[1], tag, path);
    assert.ok(c[0].includes(`aria-describedby="${id}-hint"`), path);
    const label = m.indexOf(`<label for="${id}"`);
    const hint = m.indexOf(`<p id="${id}-hint"`);
    assert.ok(label >= 0 && label < c.index && c.index < hint, path);
    // The label holds the label only, never the hint (L27-29).
    assert.match(m.slice(label), /^<label[^>]*>[^<]+<\/label>/, path);
  }
  assert.ok(m.includes(`<span>${PROJECT_NAME_LIMIT}</span>`));
  // The delete input has a visible label.
  assert.match(m, /<label for="delete-confirm"[^>]*>Type your GitHub login to confirm\.<\/label>/);
  // Saved. and a refusal sit beside their section.
  const saved = html(MeView({ data, problem: null, saved: 'person' }));
  assert.match(saved, /<form id="form-person"[\s\S]*?>Saved\.<\/span><\/div><\/form>/);
  const refused = html(MeView({ data, problem: 'Type your GitHub login to delete.', at: 'delete' }));
  assert.match(refused, /action="\/me\/delete"[\s\S]*role="alert"[^>]*>Type your GitHub login to delete\.<\/p><\/form>/);
  assert.equal((refused.match(/role="alert"/g) ?? []).length, 1);
  assert.equal((meMetadata as { alternates?: unknown }).alternates, undefined);
  assert.deepEqual(meMetadata.robots, { index: false, follow: false });
});

test('L27-11: after a delete the home page line is "Your record is deleted."', () => {
  assert.equal(ME_DELETED_LINE, 'Your record is deleted.');
  assert.ok(read('HomeView.tsx').includes('<DeletedNote text={ME_DELETED_LINE} />'));
});
