import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DocsView from '../../app/docs/DocsView';
import { readingNow } from '../../app/docs/DocsNav';
import { AgentPanel, COPY_SAID, tabKeyTarget } from '../../app/docs/InstallCard';
import SegTabs, { RAIL_FADE, segRail } from '../../app/components/site/SegTabs';
import NotFound from '../../app/not-found';
import GuideView from '../../app/programs/[id]/GuideView';
import TermsPage from '../../app/terms/page';
import { fullGuide, upcomingGuide } from './fixtures/guide';
import { AGENTS, MCP_URL } from '../../app/components/sections/agents';
import { LIVE_BONUS, SHIPPING_WEEKS } from './score-v2';
import { DOCS_GITHUB, DOCS_NAV, DOCS_SELECTORS, DOCS_STEPS } from './docs-copy';
import { NOT_FOUND_BIG, NOT_FOUND_HOME, NOT_FOUND_TEXT } from './site-copy';

/**
 * v3.1 site Task 10 (Docs and NotFound boards): the docs side nav and its five anchors, the install card (a tab per
 * agent in AGENTS order, Grok Bot first, the shown command from AGENTS only, a copy button), the three cards (week,
 * score, money; Backing only while EARNKIT_RAISING is on), the selectors strip with the JSON URL; the rust 404.
 */
// The components use the automatic JSX runtime under Next; tsx compiles them classic, so React is a global here.
(globalThis as { React?: typeof React }).React = React;

const root = join(import.meta.dirname, '..', '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const decode = (h: string) => h.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (h: string) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** The shown command: every data-ek-code block's text, tags stripped (Command wraps words in spans, keeps spaces and line breaks). */
const codes = (h: string) => [...h.matchAll(/<pre[^>]*data-ek-code=""[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')));

function withRaising<T>(on: boolean, f: () => T): T {
  const was = process.env.EARNKIT_RAISING;
  if (on) process.env.EARNKIT_RAISING = 'on';
  else delete process.env.EARNKIT_RAISING;
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = was;
  }
}
const docs = (raising = false) => withRaising(raising, () => renderToStaticMarkup(React.createElement(DocsView)));

test('(a) side nav links to the five anchors and each anchor id exists', () => {
  const h = docs();
  const nav = h.match(/<nav [^>]*aria-label="Docs"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  const links = [...nav.matchAll(/<a [^>]*href="(#[a-z]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links.map((l) => l[0]), ['#install', '#week', '#score', '#money', '#selectors']);
  assert.deepEqual(links.map((l) => l[0]), DOCS_NAV.map((n) => n[0]));
  for (const [href] of links) assert.equal((h.match(new RegExp(`id="${href.slice(1)}"`, 'g')) ?? []).length, 1, href);
  // Server render (the page opens at the top): the first link is lit (panel-inner, white, aria-current), the others
  // muted; in the browser DocsNav moves it with the section in view (QA item 4, readingNow below).
  const as = nav.match(/<a [^>]*>/g)!;
  assert.match(as[0], /aria-current="location"/);
  assert.match(as[0], /bg-s-panel-inner/);
  assert.match(as[0], /text-s-text/);
  for (const a of as.slice(1)) assert.doesNotMatch(a, /aria-current|bg-s-panel-inner/, a);
  // Phone: a wrapping row, every link 44px tall; no horizontal scroll rail.
  assert.match(h.match(/<nav [^>]*aria-label="Docs"[^>]*>/)![0], /flex-wrap/);
  for (const a of nav.match(/<a [^>]*>/g)!) assert.match(a, /min-h-11/);
});

test('(QA 4) readingNow: the lit docs section follows the one in view, rows of cards count once, a pick holds at the bottom', () => {
  // Install, then a row of three cards side by side (one top), then selectors; the read line at 140px.
  const at = (y: number) => [
    { id: 'install', top: y, bottom: y + 600 },
    { id: 'week', top: y + 616, bottom: y + 816 },
    { id: 'score', top: y + 616, bottom: y + 816 },
    { id: 'money', top: y + 616, bottom: y + 816 },
    { id: 'selectors', top: y + 832, bottom: y + 1000 },
  ];
  const o = { line: 140, height: 900, current: 'install', held: null, atBottom: false };
  assert.equal(readingNow(at(100), o), 'install', 'the top of the page');
  assert.equal(readingNow(at(400), o), 'install', 'nothing else past the line yet');
  assert.equal(readingNow(at(-500), o), 'week', 'the row passed the line: its first card');
  assert.equal(readingNow(at(-500), { ...o, current: 'score' }), 'score', 'a clicked card in the row stays lit');
  assert.equal(readingNow(at(-700), { ...o, current: 'score' }), 'selectors');
  assert.equal(readingNow(at(-500), { ...o, current: 'week' }), 'week');
  // At the bottom the last section lights, unless the reader picked one still on screen.
  assert.equal(readingNow(at(-300), { ...o, atBottom: true }), 'selectors');
  assert.equal(readingNow(at(-300), { ...o, atBottom: true, held: 'money' }), 'money');
  assert.equal(readingNow(at(-300), { ...o, atBottom: true, held: 'install' }), 'install', 'install still shows (bottom 300)');
  assert.equal(readingNow(at(-700), { ...o, atBottom: true, held: 'install' }), 'selectors', 'install off screen');
  assert.equal(readingNow([], o), null);
  // No hard-coded lit index left in the view.
  assert.doesNotMatch(read('app/docs/DocsView.tsx'), /i === 0/);
});

test('(b) the install card: a tab per AGENTS name in AGENTS order, Grok Bot selected, its steps and the link; each tab shows exactly its AGENTS command', () => {
  const h = docs();
  const tabs = [...h.matchAll(/<button [^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>([^<]+)<\/button>/g)].map((m) => ({ on: m[1] === 'true', name: m[2] }));
  assert.deepEqual(tabs.map((t) => t.name), AGENTS.map((a) => a.name));
  assert.equal(tabs[0].name, 'Grok Bot');
  assert.deepEqual(tabs.filter((t) => t.on).map((t) => t.name), ['Grok Bot']);
  assert.match(h, /<h1[^>]*>Add EarnKit to your agent<\/h1>/);
  assert.deepEqual(codes(h), [MCP_URL]);
  // Install fixes: two or more steps are numbered, as in the install sheet.
  const grokSteps = [...h.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(grokSteps, AGENTS[0].steps, 'Grok steps as a numbered list');
  // The copy button: labelled, an aria-live span for "Copied".
  assert.match(h, /<button [^>]*aria-label="Copy the command"/);
  assert.match(h, /<span [^>]*aria-live="polite"/);
  // The three numbered steps.
  const steps = [...h.matchAll(/<li [^>]*data-ek-step=""[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
  assert.deepEqual(steps, DOCS_STEPS.map((s, i) => `${i + 1} ${s}`));

  // Every agent's panel shows exactly AGENTS' strings: the command (or the EarnKit link), then the after command.
  for (const a of AGENTS) {
    const p = renderToStaticMarkup(React.createElement(AgentPanel, { agent: a }));
    assert.deepEqual(codes(p), [a.code ?? MCP_URL, ...(a.afterCode ? [a.afterCode] : [])], a.name);
    if (a.after) assert.ok(text(p).includes(a.after), a.name);
  }
  const claude = AGENTS.find((a) => a.name === 'Claude Code')!;
  assert.deepEqual(codes(renderToStaticMarkup(React.createElement(AgentPanel, { agent: claude }))), [claude.code]);
  // Install fixes: Claude (claude.ai) shows its note, its five steps numbered, then the EarnKit link to paste.
  const chat = AGENTS.find((a) => a.name === 'Claude')!;
  const cp = renderToStaticMarkup(React.createElement(AgentPanel, { agent: chat }));
  assert.ok(text(cp).startsWith(chat.note!), text(cp));
  assert.equal((cp.match(/<li>/g) ?? []).length, 5);
  assert.deepEqual(codes(cp), [MCP_URL]);
  // Cursor's single step still reads "Add" (no deep link above it on the docs).
  assert.ok(text(renderToStaticMarkup(React.createElement(AgentPanel, { agent: AGENTS.find((a) => a.name === 'Cursor')! }))).startsWith('Add this to'));
  // No command text written outside AGENTS.
  for (const f of ['app/docs/InstallCard.tsx', 'app/docs/DocsView.tsx', 'lib/earnkit/docs-copy.ts']) assert.doesNotMatch(read(f), /mcp add|mcp login|mcp\.json|earnkit\.com\/mcp|--transport/, f);
});

test('(b2) install fixes: "No GitHub yet?" on the install card: Lovable and Bolt confirmed steps, the v0 note, no Replit', () => {
  for (const raising of [false, true]) {
    const h = docs(raising);
    const install = h.match(/<section [^>]*id="install"[^>]*>([\s\S]*)<\/section>\s*<div class="grid/)?.[1] ?? '';
    const help = install.match(/<section [^>]*id="github"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';
    assert.match(help, /<h2[^>]*>No GitHub yet\?<\/h2>/);
    assert.deepEqual([...help.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1]), ['Lovable', 'Bolt']);
    const t = text(help);
    for (const [, steps] of DOCS_GITHUB.tools) assert.ok(t.includes(steps), steps);
    assert.ok(t.endsWith('v0 saves to a working branch; Publish merges it to main, which is what EarnKit reads.'), t);
    assert.doesNotMatch(t, /Replit/);
    assert.doesNotMatch(t, /\u2014/);
  }
  // The research doc's confirmed button names, as written there.
  for (const label of ['"Add connection"', '"Install & Authorize"', '"Connect"']) assert.ok(DOCS_GITHUB.tools[0][1].includes(label), label);
  for (const label of ['"Log in to GitHub"', '"Authorize"', '"Install the GitHub App"', '"Create repository"']) assert.ok(DOCS_GITHUB.tools[1][1].includes(label), label);
  // The v0 note is true: the score reads the default branch's history.
  assert.match(readFileSync(join(import.meta.dirname, 'person-github.ts'), 'utf8'), /defaultBranchRef \{ name target \{ \.\.\. on Commit \{ history\(/);
});

test('(c) "A live product adds 10." uses LIVE_BONUS; raising off: no Backing, the nav label "Programs"; raising on: the Backing sentence', () => {
  assert.equal(LIVE_BONUS, 10);
  assert.match(read('lib/earnkit/docs-copy.ts'), /\$\{LIVE_BONUS\}/);
  // Task 11: the 12 is SHIPPING_WEEKS, not a literal.
  assert.equal(SHIPPING_WEEKS, 12);
  assert.match(read('lib/earnkit/docs-copy.ts'), /over \$\{SHIPPING_WEEKS\} weeks/);
  const off = text(docs(false).split('<footer')[0]);
  assert.ok(off.includes('0 to 100 over 12 weeks. Weeks with real code count, not commit volume. A live product adds 10.'));
  assert.ok(off.includes('Ship during the week. Monday, EarnKit writes your update from the commits and emails it. One tap posts it.'));
  assert.ok(off.includes('Your agent drafts applications from your Activity.'));
  assert.doesNotMatch(off, /Backing|coin/i);
  const offNav = docs(false).match(/<nav [^>]*aria-label="Docs"[^>]*>([\s\S]*?)<\/nav>/)![1];
  assert.match(offNav, /href="#money"[^>]*>Programs<\/a>/);

  const onHtml = docs(true);
  const on = text(onHtml);
  assert.ok(on.includes('Your agent drafts applications from your Activity. Backing lets people buy your coin; you keep 40% of fees.'));
  assert.match(onHtml.match(/<nav [^>]*aria-label="Docs"[^>]*>([\s\S]*?)<\/nav>/)![1], /href="#money"[^>]*>Programs and Backing<\/a>/);
  assert.match(onHtml, /<h2[^>]*>Programs and Backing<\/h2>/);
});

test('(d) the selectors card shows the JSON URL; no "points", no em dash, under 250 words', () => {
  for (const raising of [false, true]) {
    const h = docs(raising);
    const sel = h.match(/<section [^>]*id="selectors"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';
    assert.match(sel, /<h2[^>]*>For selectors<\/h2>/);
    assert.ok(text(sel).includes("Every builder's standing as JSON."));
    // Task 11: the URL breaks only after a "/" on a phone (a <wbr> after each), never inside a word.
    const code = sel.match(/<code[^>]*bg-s-inset22[^>]*>([\s\S]*?)<\/code>/)!;
    assert.doesNotMatch(code[0], /break-all|overflow-wrap:anywhere/);
    assert.equal(decode(code[1].replace(/<wbr\/>/g, '')), DOCS_SELECTORS.url);
    assert.equal(code[1].split('/<wbr/>').length, DOCS_SELECTORS.url.split('/').length, 'a <wbr> after every "/"');
    const t = text(h);
    assert.doesNotMatch(t, /points/i);
    assert.doesNotMatch(t, /—/);
    assert.doesNotMatch(t, /\b(undefined|null|NaN)\b/);
    const words = t.split(' ').length;
    assert.ok(words < 250, `${words} words`);
  }
  // Colours only from tokens: no raw hex in the new files.
  for (const f of ['app/docs/InstallCard.tsx', 'app/docs/DocsView.tsx', 'app/not-found.tsx']) assert.doesNotMatch(read(f), /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/, f);
});

test('(e) 404: "404", "Nothing shipped here.", one link "Back home" to /, and the full footer', () => {
  const h = renderToStaticMarkup(React.createElement(NotFound));
  const [main, foot] = [h.split('<footer')[0], h.slice(h.indexOf('<footer'))];
  // The <title> (QA item 13) goes to <head>, not the card: read the card's words without it.
  const card = main.replace(/<title>[^<]*<\/title>/, '');
  assert.ok(text(card).startsWith(`${NOT_FOUND_BIG} ${NOT_FOUND_TEXT} ${NOT_FOUND_HOME}`), text(card));
  assert.match(main, new RegExp(`<h1[^>]*>${NOT_FOUND_TEXT.replace('.', '\\.')}</h1>`));
  assert.match(main, /class="[^"]*\bbg-s-rust\b/);
  assert.match(main, /class="[^"]*\btext-s-rust-on\b[^"]*"[^>]*>404</);
  const links = [...main.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [['/', NOT_FOUND_HOME]]);
  // The full footer: the painting and the CTA (the minimal one has neither).
  assert.match(foot, /foot-panini/);
  assert.match(foot, /<button/);
});

test('(f) the guide and terms pages sit on the 1200px column with Kaftan titles; terms keeps the risk disclosure with Backing off and on', () => {
  for (const page of [fullGuide, upcomingGuide]) {
    const h = renderToStaticMarkup(React.createElement(GuideView, { page }));
    assert.match(h, /max-w-\[1200px\]/);
    assert.doesNotMatch(h, /max-w-\[1120px\]/);
    assert.match(h, /<h1 class="[^"]*\bek-serif\b/);
    for (const h2 of h.match(/<h2 [^>]*>/g) ?? []) assert.match(h2, /\bek-serif\b/);
  }
  for (const raising of [false, true]) {
    const h = withRaising(raising, () => renderToStaticMarkup(React.createElement(TermsPage)));
    assert.match(h, /max-w-\[1200px\]/);
    assert.match(h, /<h1 class="[^"]*\bek-serif\b[^"]*">Terms<\/h1>/);
    assert.match(h, /id="risk-disclosure"/);
    assert.match(h, /href="#risk-disclosure"/);
  }
});

test('(g) Task 11: the install tabs wrap on a phone, rove with the arrow keys, and a failed copy says so', () => {
  const h = docs();
  const rail = h.match(/<div [^>]*role="tablist"[^>]*>/)![0];
  assert.match(rail, /flex-wrap/);
  assert.doesNotMatch(rail, /overflow-x-auto/, 'every agent shows: no sideways scroll');
  // Roving tabIndex: only the chosen tab is in the Tab order.
  const idx = [...h.matchAll(/<button [^>]*role="tab"[^>]*>/g)].map((m) => /tabindex="(-?\d)"/i.exec(m[0])?.[1]);
  assert.deepEqual(idx, AGENTS.map((_, i) => (i === 0 ? '0' : '-1')));
  const n = AGENTS.length;
  assert.equal(tabKeyTarget('ArrowRight', 0, n), 1);
  assert.equal(tabKeyTarget('ArrowRight', n - 1, n), 0);
  assert.equal(tabKeyTarget('ArrowLeft', 0, n), n - 1);
  assert.equal(tabKeyTarget('Home', 3, n), 0);
  assert.equal(tabKeyTarget('End', 0, n), n - 1);
  assert.equal(tabKeyTarget('Enter', 0, n), null);
  assert.deepEqual(COPY_SAID, { idle: '', copied: 'Copied', failed: 'Copy failed' });
  // Install fixes: both agent rails (docs card, install sheet) wrap; the link rails (leaderboard filters, feed weeks) still scroll in one row.
  for (const tone of ['light', 'sheet'] as const) {
    assert.match(segRail(tone), /(^| )flex-wrap( |$)/, tone);
    assert.doesNotMatch(segRail(tone), /overflow-x-auto|mask-image/, tone);
  }
  for (const tone of ['panel', 'step'] as const) assert.match(segRail(tone), /overflow-x-auto/, tone);
});

test('(QA 8) a rail that scrolls fades its cut edge: RAIL_FADE on the scrolling tones only, one mask per data-fade, FadeNav on SegTabs', () => {
  for (const tone of ['panel', 'step'] as const) assert.ok(segRail(tone).endsWith(RAIL_FADE), tone);
  for (const tone of ['light', 'sheet'] as const) assert.ok(!segRail(tone).includes('mask-image'), `${tone}: the agent rail wraps, nothing to fade`);
  for (const at of ['end', 'start', 'both']) assert.match(RAIL_FADE, new RegExp(`data-\\[fade=${at}\\]:\\[mask-image:linear-gradient\\(90deg,`), at);
  // Server markup carries no data-fade: only the browser knows whether the rail overflows.
  const rail = renderToStaticMarkup(React.createElement(SegTabs, { label: 'Weeks', tone: 'step', items: [{ label: 'Week of Oct 12', href: '/feed', on: true }] }));
  assert.match(rail, /^<nav aria-label="Weeks" class="[^"]*data-\[fade=end\]:\[mask-image/);
  assert.doesNotMatch(rail, /data-fade/);
  // Install fixes: the sheet's agent rail wraps, so it no longer carries the edge fade.
  assert.doesNotMatch(read('app/components/sections/AddToAgent.tsx'), /useEdgeFade|FadeRail/);
});

test('(h) Task 11: terms section headings are Kaftan; every inline link is 44px tall on a phone', () => {
  for (const raising of [false, true]) {
    const h = withRaising(raising, () => renderToStaticMarkup(React.createElement(TermsPage)));
    const h2s = h.match(/<h2 [^>]*>/g) ?? [];
    assert.ok(h2s.length >= 8, `${h2s.length} section headings`);
    for (const h2 of h2s) assert.match(h2, /\bek-serif\b/, h2);
    // The prose links (mailto, X, the Safe on basescan): padded to 44px below md, the padding cancelled by margin.
    const prose = (h.split('<footer')[0].match(/<a [^>]*>/g) ?? []).filter((a) => /href="(mailto:|https:\/\/(x\.com|basescan))/.test(a));
    assert.ok(prose.length >= 5, `${prose.length} prose links`);
    for (const a of prose) {
      const cls = /class="([^"]*)"/.exec(a)![1].split(' ');
      for (const c of ['-my-3', 'py-3', 'md:my-0', 'md:py-0']) assert.ok(cls.includes(c), `${c} on ${a}`);
      // Final fix 5: the padding is the phone's hit area; the invisible box is md only, so neighbouring links never overlap.
      assert.ok(!cls.some((c) => c.startsWith('after:')), `no phone after: box on ${a}`);
      assert.ok(cls.includes('md:after:-inset-y-3'), `the md box on ${a}`);
    }
  }
});
