import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOMENT_ADDED, mondayBlock } from './bench-reply';
import { gateFailures, type Reply } from './fixtures/converse';
import { ALSO_START_ASK, alsoAgainAsk, alsoLeadLine } from './ready-copy';

/*
 * v4.10.2 Task 5 (replay gate on the 2026-11-02 snapshot): the Monday block's question is a yes/no that names what the
 * yes does (it puts the week on the builder's page), and the also-open lead says its money with one easy reply.
 */
const reply = (show: string, o: Partial<Reply> = {}): Reply =>
  ({ turn: 0, session: 0, first: true, hook: false, tool: 'find', input: {}, show, said: ['proof:streak=6'], reply: { move_up: { kind: 'share', project_key: 'a/b' } }, ...o }) as Reply;

test('v4.10.3 Task 3 (R6): the Monday block asks nothing, says the week is on the page, and the program ask after it passes the gate', () => {
  assert.equal(MOMENT_ADDED, 'Last week is on your page.');
  const m = { week: 6, place: null, rank: 1, post: { text: 'x', link: 'https://earnkit.com/jenilt/post/abcdefghij' }, first: 'Jenil', score: 77, change: 7, community: { usd: 0, lastWeekUsd: 0 } };
  const block = mondayBlock({ ...m, added: true }, 'https://earnkit.com/jenilt');
  assert.match(block, /\n\nLast week is on your page\.$/, block);
  assert.ok(!block.includes('?'), block);
  // A failed add claims nothing.
  assert.doesNotMatch(mondayBlock({ ...m, added: false }, 'https://earnkit.com/jenilt'), /on your page/);
  const show = [block, alsoLeadLine('Base Builder Grant', 'up to $5,000', 11), ALSO_START_ASK].join('\n\n');
  assert.deepEqual(gateFailures([reply(show, { reply: { move_up: { kind: 'apply', project_key: 'a/b' } } })]), []);
});

test('v4.10.3 Task 3 fix round 1 (8): an apply reply carrying the block keeps the program\'s link and the block drops its own', async () => {
  const { withMonday } = await import('./bench-find');
  const m = { week: 6, place: null, rank: 1, post: { text: 'x', link: 'https://earnkit.com/jenilt/post/abcdefghij' }, first: 'Jenil', score: 77, change: 7, community: { usd: 0, lastWeekUsd: 0 }, added: true };
  const apply = 'Base Builder Grant closes Nov 18, up to $5,000. Form: https://base.org/apply\n\nWant me to draft it?';
  const show = withMonday([{ m, page: 'https://earnkit.com/jenilt' }], [], [apply]);
  assert.deepEqual(show.match(/https?:\/\/\S+/g), ['https://base.org/apply'], show);
  assert.ok(show.includes('\n\nLast week is on your page.\n\n'), show);
  assert.ok(show.endsWith(apply), show);
  assert.deepEqual(gateFailures([reply(show, { reply: { move_up: { kind: 'apply', project_key: 'a/b' } } })]), []);
  // With no link after it, the block keeps its post link (the reply's one link).
  const plain = withMonday([{ m, page: 'https://earnkit.com/jenilt' }], [], ['Want me to start it?']);
  assert.deepEqual(plain.match(/https?:\/\/\S+/g), ['https://earnkit.com/jenilt/post/abcdefghij'], plain);
});

test('v4.10.2 Task 5: the also-open lead and its repeat are money first, one yes/no each, and repeat as the pending ask', () => {
  assert.equal(alsoLeadLine('Base Builder Grant', 'up to $5,000', 11), 'Base Builder Grant pays up to $5,000 and needs 11 answers from you.');
  assert.equal(alsoLeadLine('Some Grant: Round 2', null, 1), 'Some Grant is open and needs 1 answer from you.');
  assert.equal(alsoAgainAsk('Base Builder Grant', 'up to $5,000', 11), 'Want me to start Base Builder Grant (up to $5,000, 11 answers from you)?');
  const ask = { reply: { move_up: { kind: 'apply', project_key: 'a/b' } } };
  const lead = reply(["You've shipped 6 weeks in a row.", alsoLeadLine('Base Builder Grant', 'up to $5,000', 11), ALSO_START_ASK].join('\n\n'), ask);
  const again = alsoAgainAsk('Base Builder Grant', 'up to $5,000', 11);
  const replies = [lead, ...[1, 2, 3].map((turn) => reply(again, { ...ask, turn, first: false, said: [] }))];
  assert.deepEqual(gateFailures(replies), []);
});

test('v4.10.3 Task 2 (R5): one score, so the standing never says "so far this week"', async () => {
  const { standingParagraph } = await import('./standing');
  const s = { score: 69, rank: null, streak: 6, wonUsd: 0, applied: 1, drafts: 0, next: null };
  assert.equal(standingParagraph(s), 'Score 69. 6 weeks shipping in a row. No grants won yet. 1 application in.');
  assert.equal(standingParagraph({ ...s, rank: '#1 of 40 builders' }), 'Score 69 · #1 of 40 builders. 6 weeks shipping in a row. No grants won yet. 1 application in.');
});

test('v4.10.2 final re-review: the path draft rounds name their noun ("4 more answers", "The last 3 answers")', async () => {
  const { roundAsk } = await import('./conversation');
  assert.equal(roundAsk(['a', 'b', 'c', 'd'], 4, 3), "Thanks. 4 more answers only you can give (3 after these): a, b, c, and d. Reply with them and I'll finish it.");
  assert.equal(roundAsk(['a', 'your contact details (name and Telegram)'], 3, 0), "Thanks. The last 3 answers only you can give: a, and your contact details (name and Telegram). Reply with them and I'll finish it.");
  assert.equal(roundAsk(['a'], 1, 0), "Thanks. The last answer only you can give: a. Reply with it and I'll finish it.");
});
