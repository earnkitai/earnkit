import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PolicySection from '../../app/terms/sections/PolicySection';
import TermsPage from '../../app/terms/page';
import nextConfig from '../../next.config';
import { CONTACT_EMAIL, PROFILES_POINTS, RECORDS_ANCHOR, RECORDS_HREF, RECORD_STEPS } from './policy';
import Footer from '../../app/components/common/Footer';
import HomeView from '../../app/HomeView';
import { CTA_INSTALL, EARN_FOOT, EARN_TITLE, HERO_SUB } from './site-copy';
import Header from '../../app/components/common/Header';
import NotFound from '../../app/not-found';
import { NOT_FOUND_HOME, NOT_FOUND_TEXT, NOT_FOUND_TITLE } from './site-copy';
import { AGENTS, Command, INTRO } from '../../app/components/sections/AddToAgent';
import ProgramLogo, { monogram } from '../../app/components/sections/ProgramLogo';
import AddToAgent, { START_PROMPT } from '../../app/components/sections/AddToAgent';
import type { Landing } from './landing';
import { homeFixture } from './fixtures/landing';
import GuideView, { Unavailable } from '../../app/programs/[id]/GuideView';
import AskAgent from '../../app/programs/[id]/AskAgent';
import ProgramCards from '../../app/components/sections/ProgramCards';
import type { GuidePage } from './landing';
import { closedGuide, emptyGuide, fullGuide, partialGuide, predecessorGuide } from './fixtures/guide';
import { gatedGuidePage, guideDescription } from './landing';
import { shownUrl } from './untrusted-text';
import { unsign } from './fixtures/page-words';

// The test runner compiles JSX with the classic runtime (no tsconfig at the repo root).
(globalThis as { React?: typeof React }).React = React;

// v3.1 Task 7: Money draws currency signs in their own span; read them as one word.
const html = (el: React.ReactElement) => unsign(renderToStaticMarkup(el));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('footer: links the terms page', () => {
  assert.match(html(React.createElement(Footer)), /href="\/terms"/);
});

// ---- v2.7 §1: the homepage (HomeView is the pure render; app/page.tsx does the cached read).
const home = (landing: Landing | null) => html(React.createElement(HomeView, { landing }));

test('Ruling 1 (plan): no logo renders the monogram, never an <img>; a logo is a local <img>', () => {
  const none = html(React.createElement(ProgramLogo, { logo: null, title: 'Arc Microgrants' }));
  assert.match(none, />AM</);
  assert.doesNotMatch(none, /<img/);
  assert.match(none, /font-funnel-display/);
  assert.match(none, /bg-ek-raised/);
  const one = html(React.createElement(ProgramLogo, { logo: '/programs/arc-microgrants.svg', title: 'Arc Microgrants' }));
  assert.match(one, /<img src="\/programs\/arc-microgrants.svg" alt="Arc Microgrants"/);
  assert.equal(monogram('Base Builder Grant Program'), 'BB');
  assert.equal(monogram('Monad'), 'M');
});

test('v2.7.1, R18, v3.1: one header on every page: Leaderboard, Feed, Docs and the install; the X link is in the footer only', () => {
  const h = html(React.createElement(Header));
  assert.equal((h.match(/<button[^>]*>Add to your agent<\/button>/g) ?? []).length, 1);
  assert.equal((h.match(/<a[^>]*href="\/docs"[^>]*>Docs<\/a>/g) ?? []).length, 1);
  assert.match(h, /href="\/leaderboard"/);
  assert.match(h, /href="\/feed"/);
  // v3.1 (Nav board): transparent, not sticky.
  assert.doesNotMatch(h, /<header[^>]*class="[^"]*\bsticky\b/);
  assert.doesNotMatch(h, /x\.com\//);
  assert.match(html(React.createElement(Footer)), /href="https:\/\/x\.com\/EarnKitAI"/);
});

test('fix round 1, Important 4: the Hero never imports the server money modules (viem, zod)', () => {
  for (const f of ['Hero.tsx', 'HeroArt.tsx']) {
    const hero = readFileSync(join(import.meta.dirname, `../../app/components/landing/${f}`), 'utf8');
    assert.doesNotMatch(hero, /lib\/earnkit\/campaigns|from 'viem'|from 'zod'/, f);
  }
  for (const f of ['ProgramCards.tsx', 'carousel.ts', 'ProgramLogo.tsx', 'AddToAgent.tsx'])
    // Final review M1: only no-cell.ts, which imports nothing, may be shared at runtime.
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, `../../app/components/sections/${f}`), 'utf8'), /import (?!type)[^;]*lib\/earnkit\/(?!no-cell';)/, f);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, 'no-cell.ts'), 'utf8'), /^import /m, 'no-cell.ts stays import-free');
  // v3.1 Task 6 fix round 1: the landing's program cards import no db-backed module at runtime (HomeView picks the
  // programs with landing.ts landingPrograms); only types and the pure site-copy.ts (which imports weeks and site-theme).
  const opp = readFileSync(join(import.meta.dirname, '../../app/components/landing/Opportunities.tsx'), 'utf8');
  assert.doesNotMatch(opp, /import (?!type)[^;]*lib\/earnkit\/(?!site-copy';)/);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, 'site-copy.ts'), 'utf8'), /^import (?!type)[^;]*from '\.\/(?!weeks'|site-theme')/m, 'site-copy stays pure');
});

test('fix round 1: a logo path that is not a local programs file renders the monogram', () => {
  for (const logo of ['https://evil.example/x.svg', '/programs/../x.svg', 'javascript:alert(1)', '/programs/x.gif'])
    assert.doesNotMatch(html(React.createElement(ProgramLogo, { logo, title: 'Arc Microgrants' })), /<img/, logo);
});

test('v2.7 §1: the install modal asks the starting phrase, or the program\'s own', () => {
  assert.equal(START_PROMPT, 'What can I earn?');
  const t = text(html(React.createElement(AddToAgent, { onClose: () => {}, prompt: 'What can I earn on Arc Microgrants?' })));
  assert.ok(t.includes('Then ask your agent: “What can I earn on Arc Microgrants?”'));
  assert.ok(text(html(React.createElement(AddToAgent, { onClose: () => {} }))).includes('Then ask your agent: “What can I earn?”'));
  // v2.14: no builder bonus pill.
  assert.ok(!t.includes('Builder bonus'), t);
});

test('v2.7: the site description and llms.txt use the starting phrase and name the guides', () => {
  const layout = readFileSync(join(import.meta.dirname, '../../app/layout.tsx'), 'utf8');
  assert.ok(layout.includes('Add EarnKit to your AI agent and ask "What can I earn?". It finds grants that fit and ranks what you ship on a public leaderboard.'));
  const llms = readFileSync(join(import.meta.dirname, 'llms/v213.txt'), 'utf8');
  assert.ok(llms.includes('What can I earn?'));
  assert.match(llms, /earnkit\.com\/programs\/<id>/);
  assert.doesNotMatch(llms, /Anything worth building/);
  // Ruling C9: the homepage publishes live figures, so llms.txt no longer forbids stating them.
  assert.doesNotMatch(llms, /Do not state any/);
  assert.match(llms, /earnkit\.com\/api\/stats/);
  // v2.9 F21: the figure is the top prize of every open program (never pools), open_money_text.
  assert.match(llms, /the top prize of\nevery open program, summed/);
  assert.match(llms, /open_money_text/);
  assert.doesNotMatch(llms, /prize pools|open_pools/);
});

// ---- v2.7 §2, Ruling 22 (plan): the program guide page (GuideView is the pure render;
// app/programs/[id]/page.tsx does the cached read) and the /programs index.
const guideHtml = (page: GuidePage) => html(React.createElement(GuideView, { page }));
/** Every element GuideView returns, walked through children (finds the client AskAgent's props). */
function elements(node: unknown, out: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) for (const n of node) elements(n, out);
  else if (React.isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: unknown }).children, out);
  }
  return out;
}
const asks = (page: GuidePage) =>
  elements(GuideView({ page })).filter((e) => e.type === AskAgent).map((e) => (e.props as { prompt: string }).prompt);

test('v2.7 §2: a partial guide leaves out the parts it has no data for', () => {
  const h = guideHtml(partialGuide);
  assert.doesNotMatch(h, /What won/);
  assert.match(h, /<h2[^>]*>What Arc wants now<\/h2>/);
  assert.match(h, /<h2[^>]*>Your best bet<\/h2>/);
});

test('v2.7 §2: an empty guide is the header, the difficulty and "Ask your agent"', () => {
  const h = guideHtml(emptyGuide);
  const t = text(h);
  assert.match(h, /<h1[^>]*>Circle Developer Grants<\/h1>/);
  // v3 Stage 3 Task 4: the facts are separate spans (the award, "Rolling"; Task 7: each starts with a capital, as the row chips do), not one dotted string.
  assert.match(h, /<span[^>]*>Milestone-based USDC grants<\/span>/);
  assert.match(h, /<span[^>]*>Rolling<\/span>/);
  assert.ok(!t.includes('grants · rolling'));
  assert.ok(t.includes('Difficulty: Medium (estimate). No past results yet.'));
  assert.doesNotMatch(h, /<h2/);
  assert.doesNotMatch(t, /Builder bonus/);
  assert.equal(asks(emptyGuide).length, 1, 'R18: one Ask, at the top');
  assert.ok(asks(emptyGuide).every((p) => p === 'What can I earn on Circle Developer Grants?'));
  assert.match(h, /<span[^>]*aria-hidden="true"[^>]*>CD<\/span>/, 'the monogram (Ruling 1)');
  assert.ok(t.includes('Sources: program page'));
});

test('Ruling 22 (plan): a closed program still renders, "· closed", with no "Ask your agent"', () => {
  const h = guideHtml(closedGuide);
  const t = text(h);
  assert.match(h, /<span[^>]*>500 USDC × 20 grants<\/span>/);
  assert.match(h, /<span[^>]*>Closed<\/span>/);
  assert.ok(!t.includes('grants · closed'));
  assert.doesNotMatch(t, /Ask your agent/);
  assert.deepEqual(asks(closedGuide), []);
  assert.match(h, /href="\/#earn"/, 'v3.1 W10: "All programs" goes to the landing section');
});

test('Ruling 22 (plan): the guide route, the index, the sitemap and the logo CSP', () => {
  const read = (f: string) => readFileSync(join(import.meta.dirname, '../../', f), 'utf8');
  const page = read('app/programs/[id]/page.tsx');
  assert.match(page, /export const revalidate = 600;/);
  assert.match(page, /if \(page === null\) notFound\(\);/);
  // A runtime connection() in an ISR route is a 500 (DYNAMIC_SERVER_USAGE), not the panel.
  assert.doesNotMatch(page, /generateStaticParams/);
  assert.ok(page.includes('This guide is unavailable right now. Try again in a few minutes.'));
  assert.ok(page.includes('description: guideDescription(page)'));
  assert.ok(page.includes('`${page.title} guide · EarnKit`'));
  // v3.1 W10: the index is a permanent redirect to the landing's earn section.
  assert.match(read('app/programs/page.tsx'), /permanentRedirect\('\/#earn'\)/);
  const cache = read('app/lib/landing-cache.ts');
  assert.match(cache, /\['guide-v3'\], \{ revalidate: 600 \}/); // review #7, v3 Stage 3 Task 7: bumped with the GuidePage shape (`chain`)
  assert.match(cache, /\['guide-ids-v27'\], \{ revalidate: 600 \}/);
  assert.match(cache, /gatedGuidePage\(id, cachedIds, cachedGuide\)/);
  assert.match(cache, /export const getGuidePage = cache\(/);
  assert.match(cache, /console\.error\('\[guide\]'/);
  const sitemap = read('app/sitemap.ts');
  assert.ok(!sitemap.includes('`${SITE}/programs`'), 'v3.1 W10: the index left the sitemap');
  assert.ok(sitemap.includes('`${SITE}/programs/${p.id}`'));
  assert.match(sitemap, /status = 'active' AND source = 'file' AND campaign IS NULL\s+AND \(ends_at IS NULL OR ends_at > now\(\)\)/);
  // The logo files' sandbox CSP never matches a guide page route.
  const csp = /^\/programs\/([a-z0-9-]+\.(?:svg|png))$/;
  assert.ok(csp.test('/programs/arc-microgrants.svg'));
  assert.ok(!csp.test('/programs/arc-microgrants'));
  assert.ok(!csp.test('/programs'));
  assert.ok(read('next.config.ts').includes("source: '/programs/:file([a-z0-9-]+\\\\.(?:svg|png))'"));
});

test('the unavailable panel (v3.1 W10: the programs list became the landing\'s #earn cards)', async () => {
  const u = text(html(React.createElement(Unavailable, { text: 'Programs are unavailable right now.' })));
  assert.ok(u.includes('Programs are unavailable right now.'));
  assert.ok(u.includes('EarnKit is a product of Tokenfi Inc.'), 'the footer');
});

// ---- v2.8 Task 3, v3.1 Task 6: the Earning opportunities cards (Rulings 20, 21 (plan); W2: the first 4 open programs).
/** The section from its heading to its end. */
function programsSection(h: string): string {
  const sec = h.slice(h.lastIndexOf('<section', h.indexOf('id="earn"')));
  return sec.slice(0, sec.indexOf('</section>'));
}
/** The cards: each whole-card link of the section. */
function cardsOf(h: string): string[] {
  return [...programsSection(h).matchAll(/<a [\s\S]*?<\/a>/g)].map((m) => m[0]);
}

test('3.1 v2.8, R18, v3.1: the section is the h2, then whole-card links to the guides (no button: each card opens its guide), then the foot line', () => {
  const sec = programsSection(home(homeFixture));
  assert.match(sec, new RegExp(`<h2[^>]*>${EARN_TITLE}</h2>`));
  assert.ok(!sec.includes('Ask your agent'), 'R18: no repeated button');
  const cards = cardsOf(sec);
  assert.equal(cards.length, 4, 'W2: the first four');
  for (const [i, c] of cards.entries()) {
    const id = homeFixture.tiles[i].id;
    assert.match(c, new RegExp(`^<a [^>]*href="/programs/${id}"`), id);
    assert.doesNotMatch(c, /<button/, id);
  }
  assert.ok(text(sec).includes(EARN_FOOT));
  assert.doesNotMatch(sec, /See all/);
});

test('3.2 v3.1: each card: logo or (clarity batch) the organizer name, when, title, the big number (else the prize text), the kind; no bonus pill, no coin, no em dash', () => {
  const tiles = [{ ...homeFixture.tiles[3], big: null }, ...homeFixture.tiles];
  const cards = cardsOf(home({ ...homeFixture, tiles }));
  assert.equal(cards.length, 4);
  for (const [i, c] of cards.entries()) {
    const tl = tiles[i];
    const ct = text(c);
    const name = tl.organizer.replace(/'/g, '&#x27;');
    assert.ok(tl.logo ? new RegExp(`<img[^>]*src="${tl.logo}"`).test(c) : c.includes(`data-ek-logo-name="" aria-hidden="true"`) && c.includes(`<span class="truncate">${name}</span>`), tl.id);
    for (const s of [tl.title.replace(/'/g, '&#x27;'), tl.big ?? tl.prize, tl.kind, tl.when]) assert.ok(c.includes(s), `${tl.id}: ${s}`);
    // Named by its content, never an aria-label that hides it.
    assert.doesNotMatch(c, /<a [^>]*aria-label=/, tl.id);
    assert.ok(!ct.includes('Builder bonus') && !/\(estimate\)/.test(ct), tl.id);
    assert.doesNotMatch(ct, /\bcoins?\b|\u2014/i, tl.id);
  }
  assert.ok(text(cards[0]).includes('10,000 USDC pool'), 'no big number: the prize text');
});

test('3.3 v3 Stage 3, v3.1: no carousel on the landing: no arrows, no snap scroller; the section is the #earn anchor', () => {
  const sec = programsSection(home(homeFixture));
  assert.match(sec, /^<section id="earn"/);
  assert.doesNotMatch(sec, /Previous programs|Next programs|snap-x|snap-mandatory|overflow-x-auto|tabindex="0"/);
});

test('3.4 v2.8: one tile is one card', () => {
  assert.equal(cardsOf(home({ ...homeFixture, tiles: [homeFixture.tiles[0]] })).length, 1);
});

test('3.5 v2.8, v3.1: zero tiles render the title and the foot line; a failed read renders no section', () => {
  const empty = home({ ...homeFixture, tiles: [] });
  assert.ok(text(programsSection(empty)).includes(EARN_FOOT));
  assert.equal(cardsOf(empty).length, 0);
  const failed = home(null);
  assert.doesNotMatch(failed, /id="earn"/);
  assert.ok(!text(failed).includes(EARN_TITLE) && !text(failed).includes(EARN_FOOT));
});

test('3.6 v3.1: the copy-review shim (sections/ProgramCards) renders every tile as the landing\'s cards, and the money line', () => {
  const shim = html(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', figure: homeFixture.open_text }));
  assert.ok(text(shim).includes(homeFixture.open_text!));
  assert.equal(cardsOf(shim).length, homeFixture.tiles.length, 'every tile it is given');
  assert.deepEqual(cardsOf(shim).slice(0, 4).map((c) => text(c).trim()), cardsOf(home(homeFixture)).map((c) => text(c).trim()));
  // Nothing under app/ renders it.
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, '../../app/HomeView.tsx'), 'utf8'), /ProgramCards/);
});

test('3.7 v2.8: keyboard: cards are never taken out of the tab order', () => {
  for (const f of ['landing/Opportunities.tsx', 'sections/ProgramCards.tsx'])
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, `../../app/components/${f}`), 'utf8'), /tabIndex=\{-1\}/, f);
  assert.doesNotMatch(programsSection(home(homeFixture)), /tabindex="-1"/);
  // HomeView passes no card cap of its own (landingPrograms holds W2's four).
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, '../../app/HomeView.tsx'), 'utf8'), /HOME_CARDS|limit=|seeAll/);
});


test('fix round 1, Minor 3: a predecessor round reads "What won before" and names the round', () => {
  const h = guideHtml(predecessorGuide);
  const t = text(h);
  assert.match(h, /<h2[^>]*>What won before<\/h2>/);
  assert.doesNotMatch(t, /last (time|round)/);
  assert.ok(t.includes("Difficulty: Medium. 20 of ~160 entries won in Arc's HackMoney 2026 track."));
});

test('Ruling C12: the web guide names the event under "What won before", never under "What won last time"', () => {
  const pre = guideHtml(predecessorGuide);
  assert.match(pre, /<h2[^>]*>What won before<\/h2>\s*<div>\s*<p[^>]*>in Arc&#x27;s HackMoney 2026 track<\/p>\s*<ul/);
  const own = guideHtml(fullGuide);
  assert.doesNotMatch(own, /<h2[^>]*>What won last time<\/h2>\s*<div>\s*<p/);
});

test('fix round 1, Important 1: a malformed or unknown id is a 404 with no per-id read', async () => {
  const read: string[] = [];
  let idReads = 0;
  const ids = async () => { idReads++; return ['arc-microgrants', 'old-closed']; };
  const reader = async (id: string) => { read.push(id); return fullGuide; };
  for (const id of ['Arc', '../x', 'a'.repeat(65), '', 'arc microgrants', 'x.svg']) assert.equal(await gatedGuidePage(id, ids, reader), null, id);
  assert.equal(idReads, 0, 'a malformed id reads nothing');
  assert.equal(await gatedGuidePage('nope', ids, reader), null);
  assert.equal(await gatedGuidePage('old-closed', ids, reader), fullGuide, 'closed ids keep their page');
  assert.equal(await gatedGuidePage('arc-microgrants', ids, reader), fullGuide);
  assert.deepEqual(read, ['old-closed', 'arc-microgrants'], 'only known ids are read');
  // A failed id-set read rejects (the unavailable panel), never null (a 404).
  await assert.rejects(gatedGuidePage('arc-microgrants', async () => { throw new Error('db down'); }, reader));
});

test('fix round 1, Minor 6: the description names only the parts the guide has', () => {
  assert.equal(guideDescription(fullGuide), 'What can I earn on Arc Microgrants? Difficulty, what won before, and what Arc wants now.');
  assert.equal(guideDescription(partialGuide), 'What can I earn on Arc Microgrants? Difficulty and what Arc wants now.');
  assert.equal(guideDescription(emptyGuide), 'What can I earn on Circle Developer Grants? Difficulty.');
});

test('fix round 1, Minor 5: every source_url in programs/*.json survives shownUrl (no source silently dropped)', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const urls: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (k === 'source_url' && typeof x === 'string') urls.push(x);
        else walk(x);
      }
  };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) walk(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  assert.ok(urls.length >= 6);
  for (const u of urls) assert.notEqual(shownUrl(u), null, u);
});

test('10.11 v3 Stage 3: the hero shows neither the stats line nor the won line (never "$0"): the words, one button, then the sections', () => {
  const won = 'Builders using EarnKit won $12,500';
  const heroBits = (h: string) => {
    const afterH1 = h.slice(h.indexOf('</h1>'));
    return [...afterH1.slice(0, afterH1.indexOf('</section>')).matchAll(/>([^<]+)</g)].map((m) => text(m[1]).trim()).filter(Boolean);
  };
  for (const landing of [homeFixture, { ...homeFixture, won_line: won }, { ...homeFixture, stats_line: null, won_line: won }]) {
    const h = home(landing);
    assert.deepEqual(heroBits(h), [HERO_SUB, CTA_INSTALL]);
    assert.doesNotMatch(text(h), /Builders using EarnKit|agents earning|won \$0/);
  }
});

// ---- v2.9 Task 11 (F22 to F24): one legal page, quieter navigation, the MINI line.

test('11.5 next.config redirects: the old legal paths 301 to their /terms anchor', async () => {
  const rules = await nextConfig.redirects!();
  assert.deepEqual(
    rules.map((r) => ({ source: r.source, destination: r.destination, statusCode: (r as { statusCode?: number }).statusCode })),
    [
      { source: '/policy', destination: '/terms#policy', statusCode: 301 },
      { source: '/risk-disclosure', destination: '/terms#risk-disclosure', statusCode: 301 },
      { source: '/sponsor-terms', destination: '/terms#sponsor-terms', statusCode: 301 },
    ],
  );
  for (const r of rules) assert.ok(!('permanent' in r), `${r.source}: permanent sends 308`);
});

test('11.6 footer: Tokenfi line and the Terms link', () => {
  const h = html(React.createElement(Footer));
  assert.ok(text(h).includes('EarnKit is a product of Tokenfi Inc.'));
  assert.match(h, /href="\/terms"[^>]*>[\s\S]{0,80}?Terms/);
  assert.doesNotMatch(h, /href="\/(policy|risk-disclosure|sponsor-terms)"/);
});

test('11.7 (F23): builder navigation never links the sponsor pages; the routes are archived (v2.12 spec 9)', () => {
  const navs = [html(React.createElement(Header)), html(React.createElement(Footer)), html(React.createElement(HomeView, { landing: homeFixture })), html(React.createElement(GuideView, { page: fullGuide }))];
  for (const h of navs) assert.doesNotMatch(h, /href="[^"]*\/(fund|award)\b/);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, 'llms/v213.txt'), 'utf8'), /earnkit\.com\/(fund|award)\b/);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, 'llms/v213.txt'), 'utf8'), /sponsor_campaign/);
  for (const r of ['fund/[ref]', 'award/[ref]']) assert.ok(!existsSync(join(import.meta.dirname, '../../app', r, 'page.tsx')), r);
});

test('12.1 v2.11 /terms "What EarnKit records": login and how it was checked, wallet, repo, program, each step and its proof, why, removal', () => {
  const page = html(React.createElement(TermsPage));
  assert.match(page, new RegExp(`<div id="${RECORDS_ANCHOR}"[^>]*>[\\s\\S]*?<h2[^>]*>What EarnKit records</h2>`));
  assert.equal(RECORDS_HREF, '/terms#what-earnkit-records');
  assert.match(page, /href="#what-earnkit-records"/, 'the section nav names it');
  const h = html(React.createElement(PolicySection));
  const start = h.indexOf('What EarnKit records</h2>');
  const section = h.slice(start, h.indexOf('<h2', start + 1));
  const t = text(section);
  // The whole section, in order (I1 to I3): what the agent sends, what EarnKit reads, the IP, the
  // step history and its proofs, the login and how it was checked, why, how long, and removal.
  const expected = [
    'What EarnKit records',
    'To match you and track your entries, EarnKit keeps what your agent sends:',
    'Your GitHub username, your repos and what you say about them.',
    'The programs you work on, your entries and your application answers.',
    "Your token's name, ticker and image.",
    'The wallets you give, the sites you host, and your email if you ask for updates.',
    'It also keeps what it reads from public GitHub and chains:',
    'Your GitHub account age and public repo count.',
    'Repo facts and commit authors.',
    'Contract activity.',
    'For up to 3 days it keeps your IP address, to limit abuse.',
    'EarnKit also keeps a history of each step you ship, with its public proof:',
    'A build: its repo and your one-line idea for it.',
    'A contract deploy: its transaction and address.',
    'A hosted site: its live link.',
    'An entry: its EarnKit entry page.',
    'A submission: the link you gave, if any.',
    "A program result: the program's results page, or your own answer.",
    "A usage check: your contract's use, checked 30 and 90 days after its deploy.",
    'Each step notes the repo, the program and the wallet you gave.',
    // v2.14: github-verify.ts loginBasisFor returns the App's login, or a sign-in kept from before v2.14.
    'It notes your GitHub login only if EarnKit checked it with the read-only EarnKit GitHub App, or by a GitHub sign-in from before the App.',
    'EarnKit keeps it to show your builder history. Onchain proofs are public anyway.',
    'EarnKit keeps this history for as long as EarnKit runs, unless you ask to remove your login and wallet.',
    `To remove your GitHub login and wallet from your step history, email ${CONTACT_EMAIL} .`,
    'The steps, repos and proofs stay, and a repo name or hosted link can still show your login.',
    'Email to ask about removing them from your other EarnKit records.',
  ].join(' ');
  assert.equal(t.trim(), expected);
  assert.match(section, new RegExp(`<a href="mailto:${CONTACT_EMAIL}"`), 'the removal email is a link');
  for (const step of RECORD_STEPS) assert.ok(t.includes(step), step);
  assert.equal(CONTACT_EMAIL, 'j@earnkit.com');
  // Plain words: no em or en dash, no emojis, never "coin" or "vault".
  assert.doesNotMatch(section, /[\u2013\u2014]|&mdash;|&ndash;/);
  assert.doesNotMatch(t, /\p{Emoji_Presentation}|\bcoin\b|vault/iu);
});

const withScoreFlag = <T,>(fn: () => T): T => fn();

test('v2.14 final fix: the terms say the page is made at the X sign-in, what is read, confirmed vs not, same X same page and hide; no v2.12 slug or earnkit.txt words', () => {
  const t = withScoreFlag(() => text(html(React.createElement(TermsPage))));
  assert.match(t, /page is made when you sign in with X/);
  assert.match(t, /GitHub, live sites, package downloads, public transactions/);
  assert.match(t, /marked not yet confirmed, and counts for nothing/);
  assert.match(t, /same X account uses that same page\. It is added with no question/);
  assert.match(t, /keeps your X user id, handle, name and picture/);
  const section = t.slice(t.indexOf('Builder profiles Your EarnKit page'), t.indexOf(' Risk Risk disclosure'));
  assert.ok(section.length > 100, 'the section is found');
  assert.doesNotMatch(section, /earnkit\.txt|0xabcd1234|your public name may be your GitHub login|Your score counts/);
  assert.doesNotMatch(t, /[\u2013\u2014]/);
});

test('15.1 /terms#builder-profiles: every point, the nav link, no em dash', () => {
  const h = withScoreFlag(() => html(React.createElement(TermsPage)));
  assert.match(h, /id="builder-profiles"/);
  assert.match(h, /href="#builder-profiles"/);
  const t = text(h);
  for (const p of PROFILES_POINTS) assert.ok(t.includes(p), p);
  assert.match(t, /merger or acquisition/);
  assert.match(t, /tell your agent "hide my page"/);
  assert.match(t, /A hidden page is not shown or listed, and it does not count toward anyone's rank\./);
  assert.doesNotMatch(t, /still counts? when others/);
  assert.match(t, /read each time you sign in with it/);
  assert.ok(t.includes(CONTACT_EMAIL));
  // The nav lists it right after "What EarnKit records", and the section follows the policy section.
  assert.ok(h.indexOf('href="#builder-profiles"') > h.indexOf(`href="#${RECORDS_ANCHOR}"`));
  assert.ok(h.indexOf('id="builder-profiles"') > h.indexOf(`id="${RECORDS_ANCHOR}"`));
  assert.ok(h.indexOf('id="builder-profiles"') < h.indexOf('id="risk-disclosure"'));
  assert.doesNotMatch(h, /—/);
});

test('12.2 v2.11 /p/<id> links /terms#what-earnkit-records, unconditionally, in the footer', () => {
  const src = readFileSync(join(import.meta.dirname, '../../app/p/[id]/page.tsx'), 'utf8');
  assert.match(src, /import \{ RECORDS_HREF, RECORDS_TITLE \} from '@\/lib\/earnkit\/policy';/);
  assert.match(src, /<Link href=\{RECORDS_HREF\}[^>]*>\{RECORDS_TITLE\}<\/Link>/);
  const footer = src.slice(src.indexOf('</ul>'), src.indexOf('{p.scored_at ?'));
  assert.ok(footer.includes('href={RECORDS_HREF}'), footer);
  assert.doesNotMatch(footer, /\? \(|&&/);
});

// ---- v2.10 R10, Ruling H6: a repo URL reaches a public page only with a fresh anonymous public read.

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('7.12 v2.10 item 5: /p/<id> has one footer line with both token terms links (they left every reply)', () => {
  // The page imports through the "@/" alias, which the test runner doesn't resolve, so its source is
  // read (as 4.13 does) and the footer element rendered on its own.
  const src = readFileSync(join(import.meta.dirname, '../../app/p/[id]/page.tsx'), 'utf8');
  assert.match(src, /import \{ TOKEN_TERMS \} from '@\/lib\/earnkit\/tokens';/);
  const lines = src.split('\n').filter((l) => l.includes('Token terms:'));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.equal(lines[0].trim(), 'Token terms: <A href={TOKEN_TERMS.agreement}>agreement</A> · <A href={TOKEN_TERMS.risks}>risks</A>');
  // Outside any condition: it is between the list and the scored line, unconditionally.
  const footer = src.slice(src.indexOf('</ul>'), src.indexOf('{p.scored_at ?'));
  assert.ok(footer.includes('Token terms:'), footer);
  assert.doesNotMatch(footer, /\? \(|&&/);
});

test('4.13 (H6) a private repo matched only from the local copy (App off) shows no URL on /p or /campaigns; a public one read within 7 days does', dbTest, async (t) => {
  const { sql } = await import('./db');
  const { getCampaignBoard, getProjectPage } = await import('./leaderboard');
  const { matchProjects, MatchProjectsInput } = await import('./match-projects');
  t.after(async () => {
    await sql().end();
  });
  const tag = `t413-${process.pid}-${Date.now()}`;
  const secret = `secret-${tag}`;
  const open = `open-${tag}`;
  const stale = `stale-${tag}`;
  const appRead = `appread-${tag}`;
  // Matching with the App off: alice/<secret> answers 404 and is matched from the local copy; the
  // public repo answers private: false. Only the public one is recorded as publicly read.
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    if (u.pathname === `/repos/alice/${open}`)
      return Response.json({
        name: open, full_name: `alice/${open}`, html_url: `https://github.com/alice/${open}`, homepage: null, default_branch: 'main',
        created_at: new Date().toISOString(), pushed_at: new Date().toISOString(), fork: false, archived: false,
        private: false, visibility: 'public', owner: { login: 'alice' },
      });
    return new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  try {
    const r = await matchProjects(
      MatchProjectsInput.parse({
        repos: [`alice/${secret}`, `alice/${open}`],
        local_repos: [{ name: 'Hidden Jar', url: `https://github.com/alice/${secret}`, chains: ['base'] }],
      }),
      { programs: [] },
    );
    assert.deepEqual(r.fromLocal?.map((l) => l.name), ['Hidden Jar']);
  } finally {
    globalThis.fetch = original;
  }
  const reads = await sql()<{ repo_key: string }[]>`SELECT repo_key FROM repo_public_reads WHERE repo_key LIKE ${`%${tag}`}`;
  assert.deepEqual(reads.map((x) => x.repo_key), [`github.com/alice/${open}`]);
  // A read 8 days ago is stale; an App-read entry (repo_private) stays hidden even with a fresh read.
  await sql()`INSERT INTO repo_public_reads (repo_key, read_at) VALUES (${`github.com/alice/${stale}`}, now() - interval '8 days'),
    (${`github.com/alice/${appRead}`}, now())`;

  const camp = `${tag}-camp`;
  const bonus = `${tag}-bonus`;
  const campaign = {
    kind: 'earnkit',
    prize: { token: '0x' + 'a'.repeat(40), symbol: 'MINI', decimals: 18, chain: 'base' },
    winners: 5, amount_each: '1', prize_usd_total: 500, metric: 'unique_wallets', min_score: 10,
  };
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, campaign, ends_at)
    VALUES (${camp}, 'o', 'Camp', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown', ${sql().json(campaign as never)}, ${new Date(Date.now() + 86_400_000)})`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, builder_bonus)
    VALUES (${bonus}, 'Org', 'Rolling', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown', true)`;
  const add = async (program: string, name: string, repo: string, repoPrivate = false) => {
    const [p] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, repo_private, payout_wallet, submitted_at)
      VALUES (${program}, ${name}, ${`https://github.com/alice/${repo}`}, ${repoPrivate}, ${`0x${'5'.repeat(40)}`}, now() - interval '1 hour')
      RETURNING id`;
    return p.id;
  };
  try {
    const ids: Record<string, number> = {};
    for (const [name, repo, priv] of [['Hidden Jar', secret, false], ['Open Jar', open, false], ['Stale Jar', stale, false], ['App Jar', appRead, true]] as const) {
      ids[name] = await add(camp, name, repo, priv);
      await add(bonus, name, repo, priv);
    }
    const hiddenRepos = [secret, stale, appRead];
    // /p (app/p/[id]/page.tsx renders exactly getProjectPage: "Code:" only with a repo_url).
    for (const name of ['Hidden Jar', 'Stale Jar', 'App Jar']) {
      const page = await getProjectPage(ids[name]);
      assert.equal(page?.name, name);
      assert.equal(page?.repo_url, null, `${name}: no Code: line on /p`);
      assert.ok(!hiddenRepos.some((h) => JSON.stringify(page).includes(h)), name);
    }
    assert.equal((await getProjectPage(ids['Open Jar']))?.repo_url, `https://github.com/alice/${open}`);
    const pageSource = readFileSync(join(import.meta.dirname, '../../app/p/[id]/page.tsx'), 'utf8');
    assert.match(pageSource, /\{p\.repo_url \? \(/, 'the page shows Code: only with a repo_url');
    // /campaigns/<slug> (P33).
    const board = await getCampaignBoard(camp);
    assert.ok(board);
    const boardJson = JSON.stringify(board);
    assert.ok(!hiddenRepos.some((h) => boardJson.includes(h)), 'no hidden repo on the campaign board');
    assert.ok(boardJson.includes(open));
  } finally {
    await sql()`DELETE FROM projects WHERE program_id IN (${camp}, ${bonus})`;
    await sql()`DELETE FROM programs WHERE id IN (${camp}, ${bonus})`;
    await sql()`DELETE FROM repo_public_reads WHERE repo_key LIKE ${`%${tag}`}`;
    await sql()`DELETE FROM github_repo_facts WHERE full_name LIKE ${`%${tag}`}`;
  }
});

test('L10 the site 404 (never Next\'s white default), v3.1 NotFound board: the rust card, "Nothing shipped here.", the way home', () => {
  const h = renderToStaticMarkup(React.createElement(NotFound));
  const main = h.split('<footer')[0];
  assert.ok(main.includes(NOT_FOUND_TEXT), h);
  assert.match(main, new RegExp(`<a [^>]*href="/"[^>]*>${NOT_FOUND_HOME}</a>`));
  assert.match(main, /\bbg-s-rust\b/);
  // One primary per view (the header's): the 404's only link is the white pill, never the blue fill.
  assert.doesNotMatch(main, /<a [^>]*class="[^"]*(bg-ek-brand|bg-s-blue)/);
  assert.equal(NOT_FOUND_TITLE, 'Not found | EarnKit');
});

test('L10, v3.1 W10: the header no longer names Programs; the install modal: no "no account", numbers only for two steps or more', () => {
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Header)), /\/programs|>Programs</);
  assert.doesNotMatch(INTRO, /no account/i);
  const h = renderToStaticMarkup(React.createElement(AddToAgent, { onClose: () => {} }));
  assert.ok(h.includes(INTRO), h);
  // The first tab (Grok Bot) has two steps: a numbered list.
  assert.match(h, /<ol[^>]*list-decimal/);
});

test('final fix I1: a command wraps only between words, and a multi-line block keeps its lines and indentation', () => {
  const plain = (h: string) => h.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
  for (const a of AGENTS) for (const code of [a.code, a.afterCode]) {
    if (!code) continue;
    const h = renderToStaticMarkup(React.createElement(Command, { text: code }));
    assert.equal(plain(h), code, a.name);
    // nowrap collapses a line break into a space, so no nowrap span may hold one (the regression: flat mcp.json).
    for (const m of h.matchAll(/<span class="whitespace-nowrap">([^<]*)<\/span>/g)) assert.ok(!m[1].includes('\n'), `${a.name}: ${JSON.stringify(m[1])}`);
  }
  const cursor = AGENTS.find((a) => a.name === 'Cursor')!.code!;
  assert.ok(cursor.includes('\n'), 'the Cursor block is multi-line');
  assert.equal(plain(renderToStaticMarkup(React.createElement(Command, { text: cursor }))).split('\n').length, cursor.split('\n').length);
  assert.match(renderToStaticMarkup(React.createElement(Command, { text: 'claude mcp add --transport http' })), /<span class="whitespace-nowrap">--transport<\/span>/);
});
