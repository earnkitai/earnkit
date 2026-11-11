import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LLMS_TEXT } from './llms';
import { FIND_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION, SERVER_INSTRUCTIONS, SESSION_START, TRACK_DESCRIPTION } from './tool-text';
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
