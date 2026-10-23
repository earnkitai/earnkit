import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReply, withFormattedReply } from './reply-format';

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
