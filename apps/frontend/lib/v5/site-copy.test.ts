import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as copy from './site-copy';
import { LLMS_TEXT } from './llms';

const EMOJI = /\p{Extended_Pictographic}/u;
const BANNED = /\b(coins?|points?|scores?|scored|ranks?|ranked|ranking|streaks?|tokens?|leaderboards?|profiles?)\b/i;

/** Every string an export holds, with the name of the export it came from. */
function strings(name: string, v: unknown, out: [string, string][] = []): [string, string][] {
  if (typeof v === 'string') out.push([name, v]);
  else if (Array.isArray(v)) for (const x of v) strings(name, x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(name, x, out);
  return out;
}

const ALL = [...Object.entries(copy).flatMap(([k, v]) => strings(k, v)), ['LLMS_TEXT', LLMS_TEXT] as [string, string]];

test('copy rules: no emoji, no em dash, none of the banned words', () => {
  assert.ok(ALL.length > 30);
  for (const [name, s] of ALL) {
    assert.ok(!EMOJI.test(s), `${name}: emoji in "${s}"`);
    assert.ok(!s.includes('—'), `${name}: em dash in "${s}"`);
    // The terms page alone may say "launch a token".
    const text = name.startsWith('TERMS_') ? s.replaceAll('launch a token', '') : s;
    assert.ok(!BANNED.test(text), `${name}: banned word in "${s}"`);
  }
  assert.ok(ALL.some(([n, s]) => n.startsWith('TERMS_') && s.includes('launch a token')));
});

test('the hero and the steps are verbatim', () => {
  assert.equal(copy.HERO_TITLE, 'Get funded for what you ship.');
  assert.equal(copy.HERO_SUB, 'Your agent finds the programs your repo fits and drafts every application. Free.');
  assert.equal(copy.CTA_INSTALL, 'Add EarnKit to your agent');
  assert.deepEqual(copy.STEPS, [
    ['Connect', 'Add EarnKit to the agent you already use. Nothing to sign up for.'],
    ['Ask', 'Your agent asks what this repo can earn and gets every fit, pre-filled.'],
    ['Say yes', 'Your agent submits in its own browser and tracks the result.'],
  ]);
  assert.equal(copy.EARN_TITLE, 'Open programs');
});

test('formatters', () => {
  assert.equal(copy.compactUsd(750), '$750');
  assert.equal(copy.compactUsd(5000), '$5K');
  assert.equal(copy.compactUsd(105_000), '$105K');
  assert.equal(copy.compactUsd(1_300_000), '$1.3M');
  assert.equal(copy.heroChipText(0), null);
  assert.equal(copy.heroChipText(105_000), '$105K in grants open now');
  assert.equal(copy.monthDay(new Date('2026-11-04T12:00:00Z')), 'Nov 4');
  assert.equal(copy.ROLLING, 'Rolling, apply anytime');
  assert.equal(copy.programKind({ in_person: true }), 'hackathon');
  assert.equal(copy.programKind({ investment: true }), 'investment');
  assert.equal(copy.programKind({ reward: 'Up to 500 USDC' }), 'grant, in USDC');
  assert.equal(copy.programKind({}), 'grant');
});

test('the docs say the four sections and stay short', () => {
  assert.deepEqual(copy.DOCS_NAV.map(([, label]) => label), ['Install', 'How a session goes', 'How programs are checked', 'Terms']);
  const words = [copy.DOCS_INSTALL_TITLE, copy.DOCS_SESSION.title, copy.DOCS_SESSION.text, copy.DOCS_CHECKED.title, copy.DOCS_CHECKED.text, copy.DOCS_TERMS.title, copy.DOCS_TERMS.text]
    .join(' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words < 150, `docs copy is ${words} words`);
  assert.equal(copy.DOCS_SESSION.text.split(/(?<=\.)\s+/).length, 3);
});

test('the terms are three sections', () => {
  assert.deepEqual(copy.TERMS_SECTIONS.map((s) => s.title), ['What EarnKit reads', 'What it stores', 'What it never does']);
  const never = copy.TERMS_SECTIONS[2].lines.join(' ');
  for (const w of ['submit', 'hold a wallet', 'launch a token', 'sell data', 'email builders']) assert.ok(never.includes(w), w);
});

test('the llms text names the connect line, the tools and the API', () => {
  assert.match(LLMS_TEXT, /https:\/\/earnkit\.com\/mcp/);
  assert.match(LLMS_TEXT, /claude mcp add/);
  assert.match(LLMS_TEXT, /\bfind\b/);
  assert.match(LLMS_TEXT, /\btrack\b/);
  assert.match(LLMS_TEXT, /https:\/\/earnkit\.com\/api\/programs/);
  assert.match(LLMS_TEXT, /https:\/\/earnkit\.com\/programs\/</);
});
