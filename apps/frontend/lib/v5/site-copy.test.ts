import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as copy from './site-copy';
import { LLMS_TEXT } from './llms';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

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
  assert.equal(copy.heroChipText(105_000), '$105K in grants and prizes open now');
  assert.equal(copy.heroChipText(35_000), '$35K in grants and prizes open now');
  assert.equal(copy.monthDay(new Date('2026-11-04T12:00:00Z')), 'Nov 4');
  assert.equal(copy.ROLLING, 'Rolling, apply anytime');
  assert.equal(copy.programKind({ in_person: true }), 'hackathon');
  assert.equal(copy.programKind({ investment: true }), 'investment');
  assert.equal(copy.programKind({ reward: 'Up to 500 USDC' }), 'grant, in USDC');
  assert.equal(copy.programKind({}), 'grant');
});

test('the docs say the six sections and stay short', () => {
  assert.deepEqual(copy.DOCS_NAV.map(([, label]) => label), ['Install', 'How a session goes', 'Your record', 'Screening, for programs', 'How programs are checked', 'Terms']);
  assert.deepEqual(copy.DOCS_NAV.map(([href]) => href).slice(2, 4), ['#record', '#screening']);
  const words = [copy.DOCS_INSTALL_TITLE, copy.DOCS_SESSION.title, copy.DOCS_SESSION.text, copy.DOCS_RECORD.title, copy.DOCS_RECORD.text, copy.DOCS_SCREEN.title, copy.DOCS_SCREEN.text, copy.DOCS_CHECKED.title, copy.DOCS_CHECKED.text, copy.DOCS_TERMS.title, copy.DOCS_TERMS.text]
    .join(' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words < 220, `docs copy is ${words} words`);
  assert.equal(copy.DOCS_RECORD.text, 'Sign in once with GitHub and your agents share one record: your facts, links, documents and the answers you approved. Once you are signed in, nothing is sent that you did not approve. Delete it any time.');
  assert.equal(copy.DOCS_SCREEN.text, "Hand your applicant list to your agent and EarnKit returns it in five tiers with public evidence: used, live, building, unverified, flagged. We read the repo, the chain and the site. We never show a builder's record, another program's name or another applicant's text.");
  assert.equal(copy.DOCS_SESSION.text.split(/(?<=\.)\s+/).length, 3);
});

test('the terms are five sections', () => {
  assert.deepEqual(copy.TERMS_SECTIONS.map((s) => s.title), ['What EarnKit reads', 'What it stores', 'What it never does', 'Your record', 'Programs']);
  const rec = copy.TERMS_SECTIONS[3].lines.join(' ');
  for (const w of ['private', '/me', 'delete']) assert.ok(rec.toLowerCase().includes(w), w);
  assert.ok(rec.includes('Once you are signed in, an answer your agent wrote is never sent until you approve it on /me. Before that, your agent acts on what you tell it in the chat.'), rec);
  const never = copy.TERMS_SECTIONS[2].lines.join(' ');
  for (const w of ['submit', 'hold a wallet', 'launch a token', 'sell data', 'email builders']) assert.ok(never.includes(w), w);
});

test('the llms text names the connect line, the tools and the API', () => {
  assert.match(LLMS_TEXT, /https:\/\/earnkit\.com\/mcp/);
  assert.match(LLMS_TEXT, /claude mcp add/);
  assert.match(LLMS_TEXT, /\bfind\b/);
  assert.match(LLMS_TEXT, /\btrack\b/);
  assert.match(LLMS_TEXT, /\brecord\b/);
  assert.match(LLMS_TEXT, /\bscreen\b/);
  assert.match(LLMS_TEXT, /four tools/i);
  assert.ok(!/two tools/i.test(LLMS_TEXT));
  assert.match(LLMS_TEXT, /https:\/\/earnkit\.com\/api\/programs/);
  assert.match(LLMS_TEXT, /https:\/\/earnkit\.com\/programs\/</);
});

test('the OpenClaw and Claude connect steps match their docs', async () => {
  const { AGENTS, MCP_URL } = await import('./agents');
  const open = AGENTS.find((a) => a.name === 'OpenClaw')!;
  assert.deepEqual(open.steps, ['Stop the gateway, then add and approve it where OpenClaw runs:']);
  assert.equal(open.code, ['openclaw gateway stop', `openclaw mcp add earnkit --url ${MCP_URL} --transport streamable-http --auth oauth`, 'openclaw mcp login earnkit', 'openclaw gateway start'].join('\n'));
  assert.equal(open.after, undefined);
  assert.equal(open.afterCode, undefined);
  assert.equal(open.last, 'On a server with no browser, run the --code command the login prints.');
  const claude = AGENTS.find((a) => a.name === 'Claude')!;
  assert.deepEqual(claude.steps, [
    'In claude.ai or the desktop app, open "Customize", then "Connectors".',
    'Choose "+ Add", then "Add custom connector".',
    'Name it EarnKit, paste the EarnKit link, choose "Continue".',
    'Keep the connection settings it detected and choose "Continue" again. If it asks for an OAuth client, choose "Register automatically".',
    'Choose "Add". It connects at once. No account needed.',
    'In a chat, choose "+", then "Connectors", and turn EarnKit on.',
  ]);
});

test('every copy of the connect steps carries the approve and reload steps', () => {
  for (const [name, text] of [['llms', LLMS_TEXT], ['README', readFileSync(join(ROOT, 'README.md'), 'utf8')]] as const) {
    assert.ok(/\/mcp`?, pick earnkit,[^\n]*Authenticate/.test(text), `${name}: Claude Code /mcp then Authenticate`);
    assert.ok(text.includes('/reload-mcp'), `${name}: Hermes /reload-mcp`);
    const seq = ['openclaw gateway stop', 'openclaw mcp add earnkit --url https://earnkit.com/mcp --transport streamable-http --auth oauth', 'openclaw mcp login earnkit', 'openclaw gateway start'];
    let at = -1;
    for (const line of seq) {
      const i = text.indexOf(line, at + 1);
      assert.ok(i > at, `${name}: OpenClaw "${line}" in order`);
      at = i;
    }
  }
});

test('no install copy mentions signing in, X, GitHub or a wallet', async () => {
  const { AGENTS, GROK_BOT_PROMPT, MUSE_MESSAGE } = await import('./agents');
  const BAD = /sign in|sign-in|x\.com|github|wallet/i;
  const all = [...AGENTS.flatMap((a) => strings(a.name, [a.note, a.installNote, a.stepsLead, a.message, a.code, a.after, a.afterCode, a.last, a.steps])), ...strings('docs', copy.DOCS_STEPS), ['prompt', GROK_BOT_PROMPT] as [string, string], ['muse', MUSE_MESSAGE] as [string, string]];
  assert.ok(all.length > 20);
  for (const [name, s] of all) assert.ok(!BAD.test(s), `${name}: "${s}"`);
  assert.equal(copy.DOCS_STEPS[1], 'It connects on its own');
  // R6: the authorize endpoint approves at once (a 302 with the code), so no copy asks the builder to approve a page.
  for (const [name, s] of all) assert.ok(!s.includes('Approve it when the page opens'), `${name}: "${s}"`);
  assert.equal(all.filter(([, s]) => s.includes('It connects at once. No account needed.')).length, 3);
});

test('the /me words: verbatim lines, sentences end with a full stop, no path in a label', () => {
  assert.equal(copy.ME_TITLE, 'Your record');
  assert.equal(copy.ME_PENDING_LINE, 'Read these, then approve each: an unapproved answer is never sent.');
  assert.equal(copy.ME_DELETE_LINE, 'This removes your record, your ledger and your sign-ins. Your agents keep working as new, anonymous installations.');
  assert.equal(copy.ME_APPROVED('Nov 7'), 'Approved Nov 7.');
  assert.equal(copy.ME_LINKED('Nov 7'), 'Linked Nov 7.');
  assert.equal(copy.ME_ERRORS.changed, 'This text changed since you opened the page. Read it again.');
  const sentences = [copy.ME_DESCRIPTION, copy.ME_APPROVED('Nov 7'), copy.ME_LINKED('Nov 7'), ...Object.values(copy.ME_ERRORS).filter((e) => /^[A-Z]/.test(e)), ...Object.values(copy.ME_HINTS), copy.ME_PENDING_LINE, copy.ME_DELETE_LINE, copy.ME_DELETE_HINT, copy.ME_NO_PROJECTS, copy.ME_LEDGER_EMPTY, copy.ME_AGENTS_EMPTY, copy.ME_POLICY_LINE, copy.DOCS_RECORD.text, copy.DOCS_SCREEN.text, ...copy.TERMS_SECTIONS.flatMap((s) => s.lines)];
  for (const s of sentences) assert.match(s, /\.$/, s);
  for (const [name, s] of [...strings('ME_BLOCKS', copy.ME_BLOCKS), ...strings('ME_LABELS', copy.ME_LABELS)]) {
    assert.ok(!/[._]/.test(s), `${name}: "${s}"`);
    assert.equal(s[0], s[0].toUpperCase(), `${name}: sentence case "${s}"`);
    assert.ok(!/\s[A-Z][a-z]/.test(s.replace(/\b(USD|X|LinkedIn)\b/g, '')), `${name}: sentence case "${s}"`);
  }
});
