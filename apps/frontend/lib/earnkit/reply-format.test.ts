import './fixtures/no-network-checks';
import { appEnv } from './fixtures/app-install';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReply, surfaceOf, withFormattedReply } from './reply-format';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';

test('formatReply: each line its own paragraph (Grok Bot markdown joins single newlines), bare URLs kept', () => {
  assert.equal(
    formatReply("You're in, @maya.\nBase pays up to $5,000 for apps on Base.\nStep 2 of 2: connect GitHub: https://earnkit.com/github/verify?n=x\nDone?"),
    "You're in, @maya.\n\nBase pays up to $5,000 for apps on Base.\n\nStep 2 of 2: connect GitHub: https://earnkit.com/github/verify?n=x\n\nDone?",
  );
});

test('formatReply: list items and table rows stay one block; extra blank lines collapse; nothing else changes', () => {
  assert.equal(
    formatReply('4 steps to start building on Base:\n1. Build it.\n2. Put it on Base.\n\n\nWant help with step 1 now?'),
    '4 steps to start building on Base:\n\n1. Build it.\n2. Put it on Base.\n\nWant help with step 1 now?',
  );
  assert.equal(formatReply('Programs:\n| A | $5K |\n| B | $1K |\nPick one?'), 'Programs:\n\n| A | $5K |\n| B | $1K |\n\nPick one?');
  assert.equal(formatReply('One line only?'), 'One line only?');
  assert.equal(formatReply('Your post for X:\n"Streakr, week 5: shipped reminders."\nPost it: https://earnkit.com/r/post/x'), 'Your post for X:\n\n"Streakr, week 5: shipped reminders."\n\nPost it: https://earnkit.com/r/post/x');
  // No markdown emphasis is ever added (WhatsApp and Telegram show it raw).
  assert.doesNotMatch(formatReply('A\nB'), /[*_`#]/);
});

test('withFormattedReply: only show_to_builder changes; other results pass through', () => {
  const r = withFormattedReply({ show_to_builder: 'A\nB', agent_note: 'x\ny', streak: 2 });
  assert.deepEqual(r, { show_to_builder: 'A\n\nB', agent_note: 'x\ny', streak: 2 });
  assert.equal(withFormattedReply(null), null);
  assert.deepEqual(withFormattedReply([1]), [1]);
  assert.deepEqual(withFormattedReply({ status: 'ok' }), { status: 'ok' });
});

appEnv();
const TABLE = '| Program | Up to | Closes |\n|---|---|---|\n| Base Builder Grants | $5,000 | Rolling |\n| Arc Builders | $10,000 | Nov 15 |';

test('rich keeps table rows together and **bold**', () => {
  assert.equal(formatReply(`**Hi**\n${TABLE}`, 'rich'), `**Hi**\n\n${TABLE}`);
  assert.equal(formatReply(`**Hi**\n${TABLE}`), formatReply(`**Hi**\n${TABLE}`, 'rich'));
});

test('plain: Label: value lines, no header or separator rows, no bold, lists kept', () => {
  assert.equal(formatReply('**Week 5**\n| | This week |\n|---|---|\n| Shipping score | 82, up 4 |', 'plain'), 'Week 5\n\nShipping score: 82, up 4');
  assert.equal(formatReply(TABLE, 'plain'), 'Base Builder Grants: $5,000, Rolling\n\nArc Builders: $10,000, Nov 15');
  assert.equal(formatReply('Setup:\n1. **Sign in** with X\n2. Connect your code\nDone?', 'plain'), 'Setup:\n\n1. Sign in with X\n2. Connect your code\n\nDone?');
  assert.deepEqual(withFormattedReply({ show_to_builder: '**A**\nB' }, 'plain'), { show_to_builder: 'A\n\nB' });
});

test('surfaceOf: Grok Bot is rich, WhatsApp-style agents are plain, unknown is rich', () => {
  assert.equal(surfaceOf('Grok Bot'), 'rich');
  assert.equal(surfaceOf('Muse'), 'plain');
  assert.equal(surfaceOf('Hermes Agent'), 'plain');
  assert.equal(surfaceOf('Claude Code'), 'rich');
  assert.equal(surfaceOf(null), 'rich');
});

process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v4-t6-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

test('mcpCall: a Muse installation gets no | and no ** in its setup reply; Grok Bot keeps them', db, async () => {
  // v4.8 Task 4: with programs open, the signed-out reply is target B's opener (no bold); this test is about the setup
  // block's formatting, so nothing is open to number while it runs.
  const open = await sql()<{ id: string }[]>`UPDATE programs SET status = 'closed' WHERE status = 'active' RETURNING id`;
  try {
    await setupReplies();
  } finally {
    await sql()`UPDATE programs SET status = 'active' WHERE id = ANY(${open.map((r) => r.id)}::text[])`;
  }
});
async function setupReplies() {
  for (const [name, plain] of [['Muse', true], ['Grok Bot', false]] as const) {
    const t = `ek_v4t6_${name.replace(/\W/g, '')}_${process.pid}_${Math.random().toString(36).slice(2)}`;
    await saveInstallation(t, undefined, false, name);
    const c = (await connectInstallation(t))!;
    const r = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never, 'find', { agent_can_build: false }, { format: true });
    const text = String(r.reply?.show_to_builder ?? '');
    assert.ok(text.length > 0, r.text);
    assert.match(text, /Setup takes about a minute/, text);
    if (plain) assert.doesNotMatch(text, /[|]|\*\*/, text);
    else assert.match(text, /\*\*/, text);
  }
}

test('plain: a URL with __ survives; an empty rest cell is just the first cell', () => {
  assert.equal(formatReply('Open https://earnkit.com/r/foo__bar__baz now', 'plain'), 'Open https://earnkit.com/r/foo__bar__baz now');
  assert.equal(formatReply('| Program | Up to |\n|---|---|\n| Solo | |', 'plain'), 'Solo');
});
