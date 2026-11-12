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
    // L25-22 (v6.1.16): the terms drop "launch a token", so no exception remains.
    assert.ok(!BANNED.test(s), `${name}: banned word in "${s}"`);
  }
});

test('the hero and the steps are verbatim', () => {
  assert.equal(copy.HERO_TITLE, 'Get funded for what you ship.');
  // L25-2 (v6.1.16): one line everywhere.
  assert.equal(copy.ONE_LINE, 'Your agent finds the grants and prizes your repo fits and fills the forms. Free.');
  assert.equal(copy.HERO_SUB, copy.ONE_LINE);
  assert.equal(copy.CTA_INSTALL, 'Add EarnKit to your agent');
  assert.deepEqual(copy.STEPS, ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?', 'Say yes. It fills the form and sends it, or hands you the draft to send.']);
  // #13 (v6.1.15): one first ask and one install label, everywhere.
  assert.equal(copy.NAV_INSTALL, copy.CTA_INSTALL);
  assert.deepEqual(copy.DOCS_STEPS, ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?']);
  // L25-9 (v6.1.16): who submits, in one sentence.
  assert.equal(copy.DOCS_SESSION.text, 'Ask your agent: What can I earn? It drafts every fit with the facts from the repo. You say yes and it submits, or hands you the draft to send, and tracks the result.');
  assert.ok(!('STEPS_TITLE' in copy));
  assert.equal(copy.EARN_TITLE, 'Open now');
  // L25-19 (v6.1.16): grants, prizes and investments.
  assert.equal(copy.PROGRAMS_DESCRIPTION, 'Every grant, prize and investment EarnKit lists, with the money and the close date.');
  // L25-15 (v6.1.16): no count.
  assert.equal(copy.EARN_ALL, 'See all programs.');
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
  assert.equal(copy.dayWords(new Date('2026-11-04T12:00:00Z'), new Date('2026-11-04T12:00:00Z')), 'Nov 4');
  assert.equal(copy.dayWords(new Date('2025-11-06T12:00:00Z'), new Date('2026-11-04T12:00:00Z')), 'Nov 6, 2025');
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
  // L25-8 (v6.1.16): the approval sentence.
  assert.equal(copy.APPROVAL_LINE, 'Your agent sends nothing you did not say yes to, and saved answers wait for your approval on your record page.');
  assert.equal(copy.DOCS_RECORD.text, "Sign in once with GitHub from your agent's link, and your agents share one record: facts, links, documents and answers. Your agent sends nothing you did not say yes to, and saved answers wait for your approval on your record page. Delete it any time.");
  // L25-12 (v6.1.16): no weekly; how long a dead page stays listed.
  assert.equal(copy.DOCS_CHECKED.text, 'EarnKit and a research bot check every program. Links are probed daily; a program whose page stays down leaves the list within about two weeks.');
  assert.equal(copy.DOCS_SCREEN.text, "Hand your applicant list to your agent and EarnKit sorts it by public evidence into five groups: used (people outside the team use it), live (a site that loads, or a contract in use), building (recent code), unverified (nothing public we could check) and flagged (looks copied, or most of its users are wallets the team funded itself). We read the repo, the chain and the site. We never show a builder's record, another program's name, screens or results, or another applicant's text. A program's reviewers share its screens, and they stay with the program when a reviewer leaves.");
  assert.equal(copy.DOCS_SESSION.text.split(/(?<=[.?])\s+/).length, 3);
});

test('L15-20 (v6.1.14): the program owners section says the five things, in plain sentences', () => {
  assert.equal(copy.DOCS_PROGRAMS.title, 'For program owners');
  assert.deepEqual([...copy.DOCS_PROGRAMS.items], [
    'Sign in once with GitHub and message EarnKit on X (link below) for reviewer access. Your team is marked the same way and shares your screens.',
    "A screen reads only public evidence, never a builder's record or another applicant's text.",
    'Tell your agent who won; results reach builders only through the EarnKit id on their application, never through yours.',
    'Other programs never see your screens, results or decisions.',
    'Results come once a day, within 24 hours, and are kept 180 days with your decisions.',
  ]);
  // L25-10 (v6.1.16): the reviewer line, shared with the screen tool's words.
  assert.equal(copy.REVIEWER_ACCESS, 'Sign in once with GitHub and message EarnKit on X (link below) for reviewer access.');
  assert.ok(copy.DOCS_PROGRAMS.items[0].startsWith(copy.REVIEWER_ACCESS));
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
    'Only you and your linked agents see it. Your agent sends nothing you did not say yes to, and saved answers wait for your approval on your record page.',
    'You can edit or delete it any time on your record page.',
  ]);
  assert.deepEqual(copy.TERMS_LINKS, [['your record page', '/me']]);
  assert.ok(copy.TERMS_SECTIONS[3].lines.some((l) => l.includes(copy.TERMS_LINKS[0][0])));
  assert.deepEqual(copy.TERMS_SECTIONS[0].lines[0], 'Public repos, as anyone on GitHub can.');
  // No path, no ledger and no second copy of the delete line on the terms (lane 5, 2 and 3.29 to 3.30).
  const all = copy.TERMS_SECTIONS.flatMap((s) => s.lines).join(' ');
  assert.ok(!/\/me\b|ledger|Delete removes|own GitHub access|own linked/.test(all), all);
  // L25-2, L25-22 (v6.1.16): who submits, and no token clause.
  assert.deepEqual([...copy.TERMS_SECTIONS[2].lines], ['EarnKit never submits for you; your agent does, or you do. It never holds a wallet, sells data or emails builders.']);
  assert.ok(!/\btokens?\b/i.test(all), all);
  // L25-16 (v6.1.16): what it stores, in full.
  assert.deepEqual([...copy.TERMS_SECTIONS[1].lines], [
    'An anonymous installation for each connected agent.',
    "The agent's name, your GitHub login once you sign in, and your address for at most two days to stop abuse.",
    'The applications you tell it about.',
    'Program data.',
  ]);
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
  // L25-7, L25-8 (v6.1.16): find first, record once signed in; the approval sentence; VS Code through its tab.
  assert.ok(LLMS_TEXT.includes('1. The agent calls find with the project it is in; once signed in, record with get. EarnKit reads the public repo;'));
  assert.ok(LLMS_TEXT.includes(copy.APPROVAL_LINE));
  assert.ok(LLMS_TEXT.includes(`- VS Code:\n    code --add-mcp '{"name":"earnkit","type":"http","url":"https://earnkit.com/mcp"}'\n    Sign in when it asks.`));
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
  // L25-23 (v6.1.16): four steps; v6.1.15's client document signs in, so the third is Sign in now alone.
  assert.deepEqual(claude.steps, [
    'Customize, Connectors, Add, Add custom connector.',
    'Paste https://earnkit.com/mcp and press Continue.',
    'Choose Sign in now.',
    'In a chat, open Connectors and turn EarnKit on.',
  ]);
  assert.equal(claude.note, "Claude's Free plan allows one custom connector.");
  // L25-4 (v6.1.16): VS Code follows Cursor.
  const names = AGENTS.map((a) => a.name);
  assert.equal(names.indexOf('VS Code'), names.indexOf('Cursor') + 1);
  const vs = AGENTS.find((a) => a.name === 'VS Code')!;
  assert.deepEqual(vs.steps, ['Run this in your terminal:']);
  assert.equal(vs.code, `code --add-mcp '{"name":"earnkit","type":"http","url":"https://earnkit.com/mcp"}'`);
  assert.equal(vs.after, 'Sign in when it asks.');
  assert.equal(vs.icon, '/images/agents/vscode.svg');
  assert.ok(readFileSync(join(ROOT, 'apps/frontend/public/images/agents/vscode.svg'), 'utf8').startsWith('<svg'));
  assert.ok(!names.includes('ChatGPT' as never) && !names.includes('Windsurf' as never));
  // v6.1.15 Task 14: claude.ai signs in with its client document, so no copy asks the builder to register a client.
  for (const [name, text] of [['llms', LLMS_TEXT], ['README', readFileSync(join(ROOT, 'README.md'), 'utf8')]] as const) {
    assert.ok(!/Register automatically|OAuth client/i.test(text), `${name}: no OAuth client step`);
  }
  assert.ok(LLMS_TEXT.includes(`- Claude: ${claude.steps.join(' ')}`), 'llms: the Claude block is the tab\'s steps');
  // Fix round 1 (v6.1.16): the README rows follow the tabs: no final Add for Claude, and a VS Code row.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('| Claude | Customize, Connectors, Add, Add custom connector, paste the URL, Continue, Sign in now, then turn EarnKit on under Connectors in a chat |'), 'README: the Claude row');
  assert.ok(!readme.includes('Sign in now, Add'), 'README: no old final Add');
  assert.ok(readme.includes(`| VS Code | \`${vs.code}\`, then sign in when it asks |`), 'README: the VS Code row');
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
  const { AGENTS, GROK_BOT_PROMPT, MUSE_MESSAGE, OTHER_AGENT_LINE } = await import('./agents');
  const SIGN_IN = /sign in|sign-in/i;
  const BAD = /x\.com|github|wallet/i;
  const all = [...AGENTS.flatMap((a) => strings(a.name, [a.note, a.installNote, a.stepsLead, a.message, a.code, a.after, a.afterCode, a.last, a.steps])), ...strings('docs', copy.DOCS_STEPS), ['prompt', GROK_BOT_PROMPT] as [string, string], ['muse', MUSE_MESSAGE] as [string, string], ['other', OTHER_AGENT_LINE] as [string, string]];
  assert.ok(all.length > 20);
  // Ruling 7 (v6.1.16): sign-in words only in the three ruled lines, by exact text (Claude's button, VS Code's after
  // line, the other-agent line); X, GitHub and a wallet stay banned everywhere.
  const RULED = new Set(['Claude\0Choose Sign in now.', 'VS Code\0Sign in when it asks.', 'other\0Another agent? Add https://earnkit.com/mcp as a remote MCP server and sign in.']);
  const ruled = ([name, s]: [string, string]) => RULED.has(`${name}\0${s}`);
  assert.equal(all.filter(ruled).length, 3);
  for (const [name, s] of all.filter((x) => !ruled(x))) assert.ok(!SIGN_IN.test(s), `${name}: "${s}"`);
  for (const [name, s] of all) assert.ok(!BAD.test(s), `${name}: "${s}"`);
  // R6: the authorize endpoint approves at once (a 302 with the code), so no copy asks the builder to approve a page.
  for (const [name, s] of all) assert.ok(!s.includes('Approve it when the page opens'), `${name}: "${s}"`);
  // Said once, in the intro line above the tabs, never again in a tab (lane 5, 2).
  assert.equal(all.filter(([, s]) => s.includes('connects at once') || s.includes('needs no account')).length, 0);
  const { CONNECTOR_LINE } = await import('./agents');
  assert.equal(CONNECTOR_LINE, 'A connector lets your AI use EarnKit. It connects at once, with no account.');
  // L38-22 (v6.1.18): the prompt says "connect it", never "sign me in".
  assert.equal(GROK_BOT_PROMPT, 'Add a custom MCP server called EarnKit at https://earnkit.com/mcp, connect it, then ask EarnKit what I can earn.');
  const grok = AGENTS.find((a) => a.name === 'Grok Bot')!;
  assert.equal(grok.installNote, 'Press Enter, then "Add it" and "Authorize".');
  assert.equal(grok.steps[1], `Server URL https://earnkit.com/mcp, "Save", then "Authenticate".`);
  assert.deepEqual(copy.DOCS_STEPS, ['Add EarnKit to your agent.', 'Ask your agent: What can I earn?']);
});

test('the /me words: verbatim lines, sentences end with a full stop, no path in a label', () => {
  assert.equal(copy.ME_TITLE, 'Your record');
  assert.equal(copy.ME_PENDING_LINE, 'Read these, then approve each: an unapproved answer is never sent.');
  // L21-8 (v6.1.16).
  assert.equal(copy.ME_DELETE_LINE, 'Deleting your account unlinks your agents, ends your reviewer access and removes your applications. Programs keep what they already screened.');
  // L21-9, L21-19, L21-21, L21-26 (v6.1.16).
  // L27-11 (v6.1.16): the home page says the record is deleted.
  assert.equal(copy.ME_DELETED_LINE, 'Your record is deleted.');
  // L27-8, L27-16, L27-17, L27-31 (v6.1.16).
  assert.equal(copy.SKIP_LINK, 'Skip to content.');
  assert.equal(copy.NAV_RECORD, 'Your record');
  assert.equal(copy.NAV_INSTALL_SHORT, 'Add');
  assert.equal(copy.PROJECT_NAME_LIMIT, 'Project names are at most 80 characters.');
  assert.equal(copy.ME_HINTS['project.name'], copy.PROJECT_NAME_LIMIT);
  assert.equal(copy.ME_SAVED, 'Saved.');
  assert.equal(copy.ME_ERRORS.confirm, 'Type your GitHub login to delete.');
  assert.equal(copy.ME_LINK_NO, 'This is not me.');
  assert.equal(copy.ALL_PROGRAMS, 'See all programs.');
  assert.equal(copy.NOT_FOUND_HOME, 'Go home.');
  assert.equal(copy.NOT_FOUND_TITLE, 'Not found · EarnKit');
  // L21-10, L21-7, L21-15, L21-11, L21-13, L21-17 (v6.1.16).
  assert.equal(copy.ME_AN_AGENT('Nov 6'), 'An agent linked Nov 6');
  assert.equal(copy.ME_UNLINKED('an agent linked Nov 6'), 'Unlinked an agent linked Nov 6.');
  assert.equal(copy.ME_UNLINKED('Claude Code'), 'Unlinked Claude Code.');
  assert.equal(copy.ME_UNLINK_NOT_YOURS, 'That agent is not on your account.');
  assert.equal(copy.ME_SAVED, 'Saved.');
  assert.equal(copy.ME_REVIEWS('Base Builder Grants'), 'You review Base Builder Grants. Results come through your agent.');
  assert.equal(copy.UNKNOWN_CODE, 'This link is not one of ours.');
  assert.equal(copy.ME_ERRORS.linkExpired, 'This link has expired. Ask your agent for a new one.');
  assert.equal(copy.ME_LABELS['policy.auto_apply'], 'Apply without asking, within these limits');
  // L21-18 (v6.1.16, controller ruling): the label says when; the stored default stays on.
  assert.equal(copy.ME_LABELS['policy.agent_may_submit'], 'Press submit for me when I say yes.');
  assert.equal(copy.ME_LABELS['policy.max_ask_usd'], 'Ask me first above (USD)');
  assert.equal(copy.ME_LABELS['traction.line_pre_launch'], 'Your one line on traction');
  assert.equal(copy.ME_HINTS['policy.never'], 'One program per line, by its title (for example Base Builder Grants).');
  // L43-17 (v6.1.19): one question and one line for a live link.
  assert.equal(copy.LINK_ASK_PARTS('Codex').join(''), 'Link "Codex" to your GitHub account?');
  assert.equal(copy.LINK_ASK_PARTS(null).join(''), 'Link your agent to your GitHub account?');
  assert.equal(copy.LINK_FIRST_SEEN('Nov 6'), 'First seen Nov 6. If you did not just ask your agent for this, choose This is not me.');
  assert.equal(copy.ME_LINK_DENIED, 'Not linked. If it was you, ask your agent for a new link.');
  // v6.1.19 Task 2 (lane 43): the new /me lines, word for word.
  assert.equal(copy.ME_SAVED_APPROVED, 'Saved and approved.');
  assert.equal(copy.ME_HELD_ROW('Nov 11'), 'On hold since Nov 11; say go to your agent to send.');
  assert.equal(`Not saved: ${copy.ME_VALUE_WORDS.typed(2100, 2000)}.`, 'Not saved: 2,100 characters typed; at most 2,000.');
  assert.equal(copy.ME_NOTHING, 'Nothing to save.');
  assert.equal(copy.ME_SENT_IT, 'I sent it');
  assert.equal(copy.ME_SENT('Avalanche Team1 Mini Grants'), 'Sent Avalanche Team1 Mini Grants.');
  assert.equal(copy.ME_ALREADY_UNLINKED, 'Already unlinked.');
  assert.equal(copy.ME_HELD_SENT('Base Builder Grants'), 'Base Builder Grants is on hold; say go to your agent first.');
  assert.equal(copy.ME_UNLINKED_AGENT('Codex', 'Codex'), 'Unlinked "Codex".');
  assert.equal(copy.ME_UNLINKED_AGENT(null, 'An agent linked Nov 11'), 'Unlinked an agent linked Nov 11.');
  assert.equal(copy.ME_DELETE_HINT, 'Type your GitHub login to delete.');
  assert.equal(copy.SIGN_IN_FROM_LINK, 'Sign in from the link your agent gives you.');
  assert.equal(copy.ME_NOT_SET_YET(14), 'Not set yet: 14 answers.');
  assert.equal(`Programs to skip: ${copy.ME_VALUE_WORDS.programs(50)}.`, 'Programs to skip: at most 50 programs.');
  assert.equal(`Programs to skip: ${copy.ME_VALUE_WORDS.longLine(3, 100)}.`, 'Programs to skip: line 3 is over 100 characters.');
  // No slug, path or file name in a /me hint (lane 5, 3.27).
  for (const s of Object.values(copy.ME_HINTS)) assert.ok(!/[a-z]+-[a-z]+-[a-z]+|\/me\b/.test(s), s);
  assert.equal(copy.ME_APPROVED('Nov 7'), 'Approved Nov 7.');
  assert.equal(copy.ME_LINKED('Nov 7'), 'Linked Nov 7.');
  assert.equal(copy.ME_ERRORS.changed, 'This text changed since you opened the page. Read it again.');
  const sentences = [copy.ME_DESCRIPTION, copy.ME_APPROVED('Nov 7'), copy.ME_LINKED('Nov 7'), ...Object.values(copy.ME_ERRORS).filter((e) => /^[A-Z]/.test(e)), ...Object.values(copy.ME_HINTS), copy.ME_PENDING_LINE, copy.ME_DELETE_LINE, copy.ME_DELETE_HINT, copy.ME_NO_PROJECTS, copy.ME_LEDGER_EMPTY, copy.ME_AGENTS_EMPTY, copy.ME_POLICY_LINE, copy.DOCS_RECORD.text, copy.DOCS_SCREEN.text, ...copy.TERMS_SECTIONS.flatMap((s) => s.lines)];
  for (const s of sentences) assert.match(s, /\.$/, s);
  for (const [name, s] of [...strings('ME_BLOCKS', copy.ME_BLOCKS), ...strings('ME_LABELS', copy.ME_LABELS)]) {
    // A label may end as a sentence (L21-18, v6.1.16); no dot or underscore inside it, so no path.
    assert.ok(!/[._]/.test(s.replace(/\.$/, '')), `${name}: "${s}"`);
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
  'CTA_INSTALL', 'NAV_INSTALL', 'NAV_RECORD', 'NAV_INSTALL_SHORT', 'EARN_TITLE', 'EARN_ALL', 'ROLLING', 'NOT_OPEN_YET', 'CLOSED', 'PROGRAMS_TITLE', 'ART_CREDIT',
  'GUIDE_FIELDS_TITLE', 'GUIDE_RULES_TITLE', 'GUIDE_ELIGIBILITY_TITLE', 'GUIDE_FOCUS_TITLE', 'GUIDE_ROUNDS_TITLE', 'GUIDE_BEST_BET_TITLE',
  'GUIDE_SOURCES_TITLE', 'NOT_FOUND_BIG', 'NOT_FOUND_TITLE', 'NOT_FOUND_METADATA', 'DOCS_NAV', 'DOCS_INSTALL_TITLE',
  'DOCS_SESSION.title', 'DOCS_RECORD.title', 'DOCS_SCREEN.title', 'DOCS_PROGRAMS.title', 'DOCS_CHECKED.title', 'DOCS_TERMS.title', 'DOCS_TERMS.link',
  'TERMS_TITLE', 'TERMS_SECTIONS.title', 'TERMS_LINKS', 'ME_TITLE', 'ME_SIGN_OUT', 'ME_SAVE', 'ME_APPROVE', 'ME_UNAPPROVE', 'ME_BY_AGENT',
  'ME_PENDING_TITLE', 'ME_ANSWER_OPEN', 'ME_PENDING_FIRST', 'ME_TEAM.name', 'ME_TEAM.role', 'ME_TEAM.add', 'ME_LEDGER_TITLE', 'ME_AGENTS_TITLE', 'ME_AN_AGENT', 'ME_UNLINK',
  'LINK_ASK_PARTS', 'ME_SENT_IT', 'ME_LINK_YES', 'ME_DELETE_TITLE', 'ME_DELETE', 'ME_NOT_SET', 'ME_YES', 'ME_NO', 'ME_BLOCKS', 'ME_LABELS',
  'ME_CHOICES', 'ME_STATUS', 'ME_VALUE_WORDS', 'heroChipText', 'dayWords', 'heroUsdText', 'programKind',
]);
/** Sample arguments for the exported templates; a template not listed is called with none. */
const SAMPLES: Record<string, unknown[]> = {
  EARN_ALL: [45], GUIDE_ASK: ['Base Builder Grants'], ME_SIGNED_IN: ['ada'], ME_APPROVED: ['Nov 6'], ME_LINKED: ['Nov 6'],
  LINK_ASK_PARTS: ['Codex'], ME_AN_AGENT: ['Nov 6'], ME_REVIEWS: ['Base Builder Grants'], ME_UNLINKED: ['Claude Code'], ME_PROJECT_SEEN: ['github.com/ada/kit', 2], ME_LINK_DONE: [null], 'ME_TEAM.name': [1], 'ME_TEAM.role': [1],
  LINK_FIRST_SEEN: ['Nov 6'], ME_UNLINKED_AGENT: ['Codex', 'Codex'], ME_HELD_ROW: ['Nov 11'], ME_SENT: ['Base Builder Grants'], ME_HELD_SENT: ['Base Builder Grants'], ME_NOT_SET_YET: [14],
  'ME_VALUE_WORDS.typed': [2100, 2000], 'ME_VALUE_WORDS.programs': [50], 'ME_VALUE_WORDS.longLine': [3, 100],
  heroChipText: [105_000], dayWords: [new Date('2026-11-04T12:00:00Z'), new Date('2026-11-04T12:00:00Z')], heroUsdText: [3_159_600], programKind: [{}],
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

test('L27-18 (v6.1.16): mid-sentence lower-casing never touches a month or a currency code', async () => {
  const { moneyAt, lowerFirst } = await import('./programs-read');
  assert.equal(moneyAt('From EUR 50,000', 'mid'), 'from EUR 50,000');
  assert.equal(moneyAt('EUR 50,000 of work', 'mid'), 'EUR 50,000 of work');
  assert.equal(lowerFirst('Nov 12, then weekly'), 'Nov 12, then weekly');
  assert.equal(lowerFirst('December 1'), 'December 1');
  assert.equal(moneyAt('Up to $5,000', 'mid'), 'up to $5,000');
});

test('L24-12, L24-14 (v6.1.16 Task 11): the cap label asks first; the status line says on or off in words, by the day', async () => {
  const copy = await import('./site-copy');
  assert.equal(copy.ME_LABELS['policy.max_ask_usd'], 'Ask me first above (USD)');
  assert.equal(copy.ME_LABELS['policy.max_per_night'], 'Most a day');
  assert.deepEqual(copy.mePolicyStatus({ on: true, perDay: 1, kinds: ['grants'], cap: '$4,500' }, 2), ['On: up to 1 a day, grants, up to $4,500.', 'Sent under it: 2.']);
  assert.deepEqual(copy.mePolicyStatus({ on: true, perDay: 3, kinds: ['grants', 'hackathons', 'bounties'], cap: null }, 0), ['On: up to 3 a day, grants, hackathons and bounties.', 'Sent under it: 0.']);
  assert.deepEqual(copy.mePolicyStatus({ on: false, perDay: 3, kinds: [], cap: null }, 0), ['Off.', 'Sent under it: 0.']);
  for (const v of Object.values(copy.ME_LABELS)) assert.doesNotMatch(v, /night/i, v);
});
