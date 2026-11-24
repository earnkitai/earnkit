import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LLMS_TEXT } from './llms';
import { FIND_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION, SERVER_INSTRUCTIONS, SESSION_START, SHOW_REPLY, TRACK_DESCRIPTION } from './tool-text';
import { APPROVAL_LINE } from './site-copy';

test('#2 (v6.1.15): llms.txt carries the session order and each tool description byte for byte from the server', () => {
  assert.ok(SERVER_INSTRUCTIONS.startsWith(SESSION_START));
  // L25-7 (v6.1.16): llms.txt's first step is its own sentence, find first and record once signed in; the server
  // instructions keep SESSION_START.
  assert.ok(LLMS_TEXT.includes('1. The agent calls find with the project it is in; once signed in, record with get. EarnKit reads the public repo; for a private repo it uses what the agent reports.'));
  assert.ok(!LLMS_TEXT.includes(SESSION_START));
  // L25-8, L25-11 (v6.1.16): the approval sentence and the results promise.
  assert.ok(LLMS_TEXT.includes(APPROVAL_LINE));
  assert.ok(LLMS_TEXT.includes('Results come once a day, within\n24 hours,'));
  assert.ok(LLMS_TEXT.includes(`- find: ${FIND_DESCRIPTION}\n`));
  assert.ok(LLMS_TEXT.includes(`- track: ${TRACK_DESCRIPTION}\n`));
  assert.ok(LLMS_TEXT.includes(`- record: ${RECORD_DESCRIPTION}\n`));
  assert.ok(LLMS_TEXT.includes(`- screen: ${SCREEN_DESCRIPTION}\n`));
  assert.ok(LLMS_TEXT.includes('Their agent calls screen with the applicant list, as its description above says.'));
  for (const old of ['calls record with get, then find', 'and standing approval.', '(name, repo, site, contracts, pitch)'])
    assert.ok(!LLMS_TEXT.includes(old), `llms.txt still says "${old}"`);
});

test('the mcp module re-exports the tool text unchanged', async () => {
  const mcp = await import('./mcp');
  assert.equal(mcp.SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS);
  assert.equal(mcp.FIND_DESCRIPTION, FIND_DESCRIPTION);
  assert.equal(mcp.TRACK_DESCRIPTION, TRACK_DESCRIPTION);
  assert.equal(mcp.RECORD_DESCRIPTION, RECORD_DESCRIPTION);
  assert.equal(mcp.SCREEN_DESCRIPTION, SCREEN_DESCRIPTION);
});

test('L46-11 (v6.1.22): the instructions let the agent translate, and llms.txt says the same words', () => {
  const show = "Show find's reply as given, in the builder's language when they write in another (names, money and links unchanged); shorten if you must, keep money first and the last action.";
  assert.equal(SHOW_REPLY, show);
  assert.ok(SERVER_INSTRUCTIONS.startsWith(`${SESSION_START} ${show} `));
  assert.match(SERVER_INSTRUCTIONS, /in the builder's language when they write in another/);
  assert.ok(LLMS_TEXT.includes(`what is one change away. The agent's rule: ${show}\n`));
});

test('v3.8 E16 (plan L8): a new builder installs from llms.txt alone: the server, one way per client, what happens next, what EarnKit sees, how to delete', async () => {
  const { AGENTS, MCP_URL } = await import('./agents');
  const { DOCS_DELETE, DOCS_NEXT, DOCS_SEES } = await import('./site-copy');
  assert.ok(LLMS_TEXT.includes(`EarnKit is an MCP server: ${MCP_URL}`));
  for (const a of AGENTS) assert.ok(LLMS_TEXT.includes(`- ${a.name}:`), `no install line for ${a.name}`);
  assert.ok(LLMS_TEXT.includes(`- Any other MCP client: add ${MCP_URL} as a remote server`));
  assert.ok(LLMS_TEXT.includes('Then ask your agent: "What can I earn?"'));
  // The same words as the /docs install section, so the two never disagree.
  assert.ok(LLMS_TEXT.includes(`## What happens next\n\n${DOCS_NEXT.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n`));
  assert.equal(DOCS_NEXT.lines.length, 3);
  assert.ok(LLMS_TEXT.includes(`${DOCS_SEES.can}\n${DOCS_SEES.cannot}`));
  assert.ok(LLMS_TEXT.includes(DOCS_DELETE.text));
  assert.match(DOCS_DELETE.text, /earnkit\.com\/me/);
});
