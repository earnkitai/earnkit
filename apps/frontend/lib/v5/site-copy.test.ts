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
  assert.equal(copy.HERO_SUB, 'Your agent finds the grants and prizes you fit and fills the forms. Free.');
  assert.equal(copy.CTA_INSTALL, 'Add EarnKit to your agent');
  assert.deepEqual(copy.STEPS, ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?', 'Say yes. It fills the form and sends it, or hands you the draft to send.']);
  // #13 (v6.1.15): one first ask and one install label, everywhere.
  assert.equal(copy.NAV_INSTALL, copy.CTA_INSTALL);
  assert.deepEqual(copy.DOCS_STEPS, ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?']);
  assert.equal(copy.DOCS_SESSION.text, 'Ask your agent: What can I earn? It drafts every fit with the facts from the repo. Say yes. It fills the form and sends it, or hands you the draft to send. It tracks the result.');
  assert.ok(!('STEPS_TITLE' in copy));
  assert.equal(copy.EARN_TITLE, 'Open now');
  // v6.1.14: no bounty is listed, ten investments are.
  assert.equal(copy.PROGRAMS_DESCRIPTION, 'Every grant, hackathon and investment EarnKit lists, with the money and the close date.');
  assert.equal(copy.EARN_ALL(45), 'See all 45 programs');
  assert.equal(copy.FOOT_CTA, 'Ask your agent: What can I earn?');
  assert.equal(copy.PROGRAMS_TITLE, 'Programs');
});

test('formatters', () => {
  // Lane 22 (v6.1.15): the hero alone rounds, down, to one decimal; under a million it is the full figure.
  assert.equal('compactUsd' in copy, false);
  assert.equal(copy.heroUsdText(3_159_600), '$3.1M');
  assert.equal(copy.heroUsdText(1_999_999), '$1.9M');
  assert.equal(copy.heroUsdText(2_000_000), '$2M');
  assert.equal(copy.heroUsdText(950_000), '$950,000');
  assert.equal(copy.heroUsdText(750), '$750');
  // M4: under a million it is usdFull's figure, rounded down to the dollar.
  assert.equal(copy.heroUsdText(950_000.9), '$950,000');
  assert.equal(copy.heroChipText(0), null);
  assert.equal(copy.heroChipText(3_159_600), '$3.1M in grants and prizes open now');
  assert.equal(copy.heroChipText(105_000), '$105,000 in grants and prizes open now');
  assert.equal(copy.heroChipText(35_000), '$35,000 in grants and prizes open now');
  assert.equal(copy.monthDay(new Date('2026-11-04T12:00:00Z')), 'Nov 4');
  assert.equal(copy.ROLLING, 'Rolling');
  assert.equal(copy.programKind({ in_person: true }), 'hackathon');
  assert.equal(copy.programKind({ investment: true }), 'investment');
  assert.equal(copy.programKind({ reward: 'Up to 500 USDC' }), 'grant, in USDC');
  assert.equal(copy.programKind({}), 'grant');
});

test('the docs say the seven sections and stay short', () => {
  assert.deepEqual(copy.DOCS_NAV.map(([, label]) => label), ['Install', 'How a session goes', 'Your record', 'Screening, for programs', 'For program owners', 'How programs are checked', 'Terms']);
  assert.deepEqual(copy.DOCS_NAV.map(([href]) => href).slice(2, 4), ['#record', '#screening']);
  const words = [copy.DOCS_INSTALL_TITLE, copy.DOCS_SESSION.title, copy.DOCS_SESSION.text, copy.DOCS_RECORD.title, copy.DOCS_RECORD.text, copy.DOCS_SCREEN.title, copy.DOCS_SCREEN.text, copy.DOCS_CHECKED.title, copy.DOCS_CHECKED.text, copy.DOCS_TERMS.title, copy.DOCS_TERMS.text]
    .join(' ').split(/\s+/).filter(Boolean).length;
  // #15 (v6.1.15): the ruled tier glosses add 36 words to the screening text (223 now); the cap moves from 220 to 230.
  assert.ok(words < 230, `docs copy is ${words} words`);
  assert.equal(copy.DOCS_RECORD.text, 'Sign in once with GitHub and your agents share one record: your facts, links, documents and the answers you approved. Once you are signed in, nothing is sent that you did not approve. Delete it any time. Ask your agent for your sign-in link.');
  assert.equal(copy.DOCS_SCREEN.text, "Hand your applicant list to your agent and EarnKit sorts it into five tiers with public evidence: used (people outside the team use it), live (a site that loads, or a contract in use), building (recent code), unverified (nothing public we could check) and flagged (looks copied, or most of its users are wallets the team funded itself). We read the repo, the chain and the site. We never show a builder's record, another program's name, screens or results, or another applicant's text. A program's reviewers share its screens, and they stay with the program when a reviewer leaves.");
  // #4 (v6.1.15): the session sentence is landing step 3, word for word.
  assert.ok(copy.DOCS_SESSION.text.includes(` ${copy.STEPS[2]} `));
  assert.equal(copy.DOCS_SESSION.text.split(/(?<=\.)\s+/).length, 4);
});

test('L15-20 (v6.1.14): the program owners section says the five things, in plain sentences', () => {
  assert.equal(copy.DOCS_PROGRAMS.title, 'For program owners');
  assert.deepEqual([...copy.DOCS_PROGRAMS.items], [
    "Sign in once with GitHub and ask EarnKit to mark you as your program's reviewer. Your team is marked the same way and shares your screens.",
    "A screen reads only public evidence: the repo, the chain and the site. It never reads a builder's record or another applicant's text.",
    "Tell your agent who won. A result reaches a builder only through the EarnKit id on their application, and never from your own application.",
    'Other programs see nothing of your screens, results or decisions.',
    'Results come in daily runs, the first by the next morning, and are kept 180 days with your decisions.',
  ]);
  for (const t of copy.DOCS_PROGRAMS.items) {
    assert.match(t, /\.$/, t);
    assert.doesNotMatch(t, /\u2014|\u2013|[_{}]|\b(score|rank|grade|points?|coins?|tokens?|streaks?)\b/i, t);
    assert.doesNotMatch(t, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, t);
  }
  assert.ok(copy.DOCS_NAV.some(([href, label]) => href === '#programs' && label === 'For program owners'));
});

test('the terms are five sections', () => {
  assert.deepEqual(copy.TERMS_SECTIONS.map((s) => s.title), ['What EarnKit reads', 'What it stores', 'What it never does', 'Your record', 'Programs']);
  const rec = copy.TERMS_SECTIONS[3].lines.join(' ');
  for (const w of ['private', 'delete']) assert.ok(rec.toLowerCase().includes(w), w);
  assert.deepEqual(copy.TERMS_SECTIONS[3].lines.slice(1), [
    'Only you and your linked agents see it. Nothing your agent wrote is sent until you approve it.',
    'You can edit or delete it any time on your record page.',
  ]);
  assert.deepEqual(copy.TERMS_LINKS, [['your record page', '/me']]);
  assert.ok(copy.TERMS_SECTIONS[3].lines.some((l) => l.includes(copy.TERMS_LINKS[0][0])));
  assert.deepEqual(copy.TERMS_SECTIONS[0].lines[0], 'Public repos, as anyone on GitHub can.');
  // No path, no ledger and no second copy of the delete line on the terms (lane 5, 2 and 3.29 to 3.30).
  const all = copy.TERMS_SECTIONS.flatMap((s) => s.lines).join(' ');
  assert.ok(!/\/me\b|ledger|Delete removes|own GitHub access|own linked/.test(all), all);
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
    'Choose Sign in now.',
    'Choose "Add".',
    'In a chat, choose "+", then "Connectors", and turn EarnKit on.',
  ]);
  // v6.1.15 Task 14: claude.ai signs in with its client document, so no copy asks the builder to register a client.
  for (const [name, text] of [['llms', LLMS_TEXT], ['README', readFileSync(join(ROOT, 'README.md'), 'utf8')]] as const) {
    assert.ok(!/Register automatically|OAuth client/i.test(text), `${name}: no OAuth client step`);
  }
  assert.ok(LLMS_TEXT.includes(`- Claude: ${claude.steps.join(' ')}`), 'llms: the Claude block is the tab\'s steps');
  assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes('Continue, Sign in now, Add'), 'README: the Claude row');
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
  // v6.1.15 Task 14: Claude's own button label, Sign in now, is the one exception (its client document signs in); no
  // other line asks the builder to sign in.
  const claudeButton = ([name, s]: [string, string]) => name === 'Claude' && s === 'Choose Sign in now.';
  assert.equal(all.filter(claudeButton).length, 1);
  for (const [name, s] of all.filter((x) => !claudeButton(x))) assert.ok(!BAD.test(s), `${name}: "${s}"`);
  // R6: the authorize endpoint approves at once (a 302 with the code), so no copy asks the builder to approve a page.
  for (const [name, s] of all) assert.ok(!s.includes('Approve it when the page opens'), `${name}: "${s}"`);
  // Said once, in the intro line above the tabs, never again in a tab (lane 5, 2).
  assert.equal(all.filter(([, s]) => s.includes('connects at once') || s.includes('needs no account')).length, 0);
  const { CONNECTOR_LINE } = await import('./agents');
  assert.equal(CONNECTOR_LINE, 'A connector lets your AI use EarnKit. It connects at once. The connect prompt needs no account.');
  const grok = AGENTS.find((a) => a.name === 'Grok Bot')!;
  assert.equal(grok.installNote, 'Press Enter, then "Add it" and "Authorize".');
  assert.equal(grok.steps[1], `Server URL https://earnkit.com/mcp, "Save", then "Authenticate".`);
  assert.deepEqual(copy.DOCS_STEPS, ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?']);
});

test('the /me words: verbatim lines, sentences end with a full stop, no path in a label', () => {
  assert.equal(copy.ME_TITLE, 'Your record');
  assert.equal(copy.ME_PENDING_LINE, 'Read these, then approve each: an unapproved answer is never sent.');
  assert.equal(copy.ME_DELETE_LINE, 'This removes your record, your applications and your sign-ins. Screens you ran for a program stay with that program. Your agents keep working, unsigned.');
  assert.equal(copy.ME_LABELS['policy.auto_apply'], 'Apply overnight without asking, within these limits');
  assert.equal(copy.ME_LABELS['policy.agent_may_submit'], 'Press submit for me');
  assert.equal(copy.ME_LABELS['policy.max_ask_usd'], 'Skip awards above (USD)');
  assert.equal(copy.ME_LABELS['traction.line_pre_launch'], 'Your one line on traction');
  assert.equal(copy.ME_HINTS['policy.never'], 'One program per line, by its title (for example Base Builder Grants).');
  assert.equal(copy.ME_LINK_LINE(null, 'Nov 6'), 'Your agent, first seen Nov 6, asked for this link. If you did not ask your agent for this just now, choose Not me.');
  // No slug, path or file name in a /me hint (lane 5, 3.27).
  for (const s of Object.values(copy.ME_HINTS)) assert.ok(!/[a-z]+-[a-z]+-[a-z]+|\/me\b/.test(s), s);
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

test('/llms.txt keeps the label before a second command: "Then approve it:" sits above codex mcp login (m12)', () => {
  assert.ok(LLMS_TEXT.includes('    Then approve it:\n    codex mcp login earnkit'), LLMS_TEXT);
  assert.ok(LLMS_TEXT.includes('    Then approve it:\n    hermes mcp login earnkit'), LLMS_TEXT);
});

/**
 * Review Focus 2 (v6.1.15): every builder sentence ends in a full stop (or ? or !). Labels are listed by name; a line
 * that ends in a colon is a heading that introduces a list ("Ready to apply (3):", "Open now:", "Rules:") and is skipped.
 */
const LABELS = new Set([
  'CTA_INSTALL', 'NAV_INSTALL', 'EARN_TITLE', 'EARN_ALL', 'ROLLING', 'NOT_OPEN_YET', 'CLOSED', 'PROGRAMS_TITLE', 'ALL_PROGRAMS', 'ART_CREDIT',
  'GUIDE_FIELDS_TITLE', 'GUIDE_RULES_TITLE', 'GUIDE_ELIGIBILITY_TITLE', 'GUIDE_FOCUS_TITLE', 'GUIDE_ROUNDS_TITLE', 'GUIDE_BEST_BET_TITLE',
  'GUIDE_SOURCES_TITLE', 'NOT_FOUND_BIG', 'NOT_FOUND_HOME', 'NOT_FOUND_TITLE', 'NOT_FOUND_METADATA', 'DOCS_NAV', 'DOCS_INSTALL_TITLE',
  'DOCS_SESSION.title', 'DOCS_RECORD.title', 'DOCS_SCREEN.title', 'DOCS_PROGRAMS.title', 'DOCS_CHECKED.title', 'DOCS_TERMS.title', 'DOCS_TERMS.link',
  'TERMS_TITLE', 'TERMS_SECTIONS.title', 'TERMS_LINKS', 'ME_TITLE', 'ME_SIGN_OUT', 'ME_SAVE', 'ME_APPROVE', 'ME_UNAPPROVE', 'ME_BY_AGENT',
  'ME_PENDING_TITLE', 'ME_TEAM.name', 'ME_TEAM.role', 'ME_TEAM.add', 'ME_LEDGER_TITLE', 'ME_AGENTS_TITLE', 'ME_AN_AGENT', 'ME_UNLINK',
  'ME_LINK_PARTS', 'ME_LINK_YES', 'ME_LINK_NO', 'ME_DELETE_TITLE', 'ME_DELETE', 'ME_NOT_SET', 'ME_YES', 'ME_NO', 'ME_BLOCKS', 'ME_LABELS',
  'ME_CHOICES', 'ME_STATUS', 'ME_VALUE_WORDS', 'heroChipText', 'monthDay', 'heroUsdText', 'programKind',
]);
/** Sample arguments for the exported templates; a template not listed is called with none. */
const SAMPLES: Record<string, unknown[]> = {
  EARN_ALL: [45], GUIDE_ASK: ['Base Builder Grants'], ME_SIGNED_IN: ['ada'], ME_APPROVED: ['Nov 6'], ME_LINKED: ['Nov 6'],
  ME_LINK_PARTS: [null, 'Nov 6'], ME_LINK_LINE: [null, 'Nov 6'], ME_LINK_DONE: [null], 'ME_TEAM.name': [1], 'ME_TEAM.role': [1],
  heroChipText: [105_000], monthDay: [new Date('2026-11-04T12:00:00Z')], heroUsdText: [3_159_600], programKind: [{}],
  'ME_VALUE_WORDS.under': [300], 'ME_VALUE_WORDS.atMost': [5], 'ME_VALUE_WORDS.range': [1, 10, true],
};
/** Every string under an export, by its path ("DOCS_SESSION.text"), templates called with their samples. */
function texts(path: string, v: unknown, out: [string, string][] = []): [string, string][] {
  const top = path.split('.')[0];
  if (typeof v === 'string') out.push([path, v]);
  else if (typeof v === 'function') texts(path, (v as (...a: unknown[]) => unknown)(...(SAMPLES[path] ?? [])), out);
  else if (Array.isArray(v)) for (const x of v) texts(path, x, out);
  else if (v instanceof Date || v == null) return out;
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) texts(/^[A-Z_]+$/.test(top) && !Array.isArray(v) ? `${path}.${k}` : path, x, out);
  return out;
}
const isLabel = (path: string) => LABELS.has(path) || LABELS.has(path.split('.')[0]) || LABELS.has(path.split('.').slice(0, 2).join('.'));
/** The sentence lines of a text: every line but the blank ones and the headings that end in a colon. */
const sentenceLines = (s: string) => s.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.endsWith(':'));
const endsAsSentence = (l: string) => /[.?!]$/.test(l);

async function builderTexts(): Promise<[string, string][]> {
  const reply = await import('./reply');
  const { guideText, guidePills } = await import('./guide');
  const { ProgramFile } = await import('./program-file');
  const { readdirSync } = await import('node:fs');
  const out: [string, string][] = Object.entries(copy).flatMap(([k, v]) => texts(k, v)).filter(([p]) => !isLabel(p));
  for (const k of ['NOTHING_FITS', 'IN_PERSON_CLOSING', 'CODE_CLOSING', 'LIMIT_USED', 'EMPTY_NO_CODES'] as const) out.push([k, reply[k]]);
  for (const [k, v] of Object.entries(reply.REPO_NOTE)) out.push([`REPO_NOTE.${k}`, v]);
  const dir = join(ROOT, 'programs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  // The catalog's size is read from the directory, so a new program file never fails a copy test (M6).
  assert.ok(files.length >= 52, `${files.length}`);
  for (const f of files) {
    const file = ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const g = guideText({ id: file.id, file, source: 'file', created_at: new Date(0), updated_at: new Date(0), verified_at: null, stale_since: null }, new Date('2026-11-11T12:00:00Z'));
    for (const pill of guidePills(g)) out.push([`${file.id} pill`, pill]);
    for (const [k, v] of [['sign_in', g.sign_in], ['bar', g.bar], ['submit', g.submit]] as const) if (v) out.push([`${file.id} ${k}`, v]);
  }
  return out;
}

test('Review Focus 2 (v6.1.15): every exported builder sentence, reply constant and guide pill ends in a full stop', async () => {
  const all = await builderTexts();
  assert.ok(all.length > 150, `${all.length}`);
  for (const [name, s] of all) for (const l of sentenceLines(s)) assert.ok(endsAsSentence(l), `${name}: "${l}"`);
  // The headings keep their colon.
  assert.deepEqual(sentenceLines('Ready to apply (3):\n1. A, $1K.\n\nOpen now:\nRules:'), ['1. A, $1K.']);
  assert.ok(isLabel('ROLLING') && isLabel('DOCS_TERMS.link') && !isLabel('DOCS_TERMS.text'));
});

test('row C (v6.1.15): builder text says result, Your applications and Rolling, never outcome, ledger or "Rolling,"', async () => {
  const all = [...(await builderTexts()), ...Object.entries(copy).flatMap(([k, v]) => texts(k, v))];
  for (const [name, s] of all) assert.ok(!/\boutcomes?\b|\bledger\b|Rolling,/i.test(s), `${name}: "${s}"`);
  assert.equal(copy.ROLLING, 'Rolling');
  assert.equal(copy.CTA_INSTALL, 'Add EarnKit to your agent');
  assert.equal(copy.ME_LEDGER_TITLE, 'Your applications');
});

test('S (v6.1.16): the page cache keys carry the build id, so a deploy never serves a page cached by the build before it', async () => {
  const { BUILD_ID, cacheKey } = await import('../../app/lib/cached');
  assert.equal(BUILD_ID, process.env.EK_BUILD_ID || 'dev');
  assert.deepEqual(cacheKey(['landing-v6.2']), ['landing-v6.2', BUILD_ID]);
  assert.equal(cacheKey(['landing-v6.2'], 'abc123').at(-1), 'abc123');
  assert.notDeepEqual(cacheKey(['landing-v6.2'], 'abc123'), cacheKey(['landing-v6.2'], 'def456'));
  const config = readFileSync(join(ROOT, 'apps/frontend/next.config.ts'), 'utf8');
  assert.match(config, /env: \{ EK_BUILD_ID: process\.env\.RAILWAY_GIT_COMMIT_SHA \|\| String\(Date\.now\(\)\) \}/);
});
