import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClaimPage, checkHandoff, checkLeaderboard, checkReply, claimCodeIn, claimFormOf, requestAllowed } from './v2121-prod-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A recorded first reply for a target user (a few small apps, little GitHub, no traction), as whereYouStand prints it.
const GOLDEN_TARGET_REPLY = `Where you stand
You've shipped 2 apps with AI: a recipe planner and a tip jar.
Claim your page with X: earnkit.com/claim/abcdefghijkl

Ways to earn right now
Your tip jar fits Avalanche Team1 mini grants: up to $500, closes Oct 29. I can prepare the entry.

How to move up
Your tip jar has a payment side people could use. Want me to make it count the people who pay you? You won't have to do anything.`;

test('13.1 a recorded reply is checked the way the runbook checks production', () => {
  assert.deepEqual(checkReply(GOLDEN_TARGET_REPLY, ['Avalanche Team1 mini grants']), []);
  assert.deepEqual(checkReply('Where you stand\nYou: score 41, top 22%. earnkit.com/b/lee', []), ['missing: Ways to earn right now or How to move up', 'v2.12 line']);
  assert.ok(checkReply('How to move up\nWant this? And this?', []).includes('more than one question'));
});

test('13.2 each problem is named: order, banned words, glued period, flag off', () => {
  const swapped = GOLDEN_TARGET_REPLY.replace('Ways to earn right now', 'TMP').replace('How to move up', 'Ways to earn right now').replace('TMP', 'How to move up');
  assert.ok(checkReply(swapped, ['Avalanche Team1 mini grants']).includes('headings out of order'));
  const arc = GOLDEN_TARGET_REPLY.replace('Avalanche Team1 mini grants', 'Arc Microgrants');
  assert.ok(checkReply(arc, []).some((p) => p.startsWith('banned word')), 'a chain name in a program title is banned unless exempt');
  assert.deepEqual(checkReply(arc, ['Arc Microgrants']), []);
  assert.ok(checkReply(GOLDEN_TARGET_REPLY.replace('abcdefghijkl', 'abcdefghijkl.'), ['Avalanche Team1 mini grants']).includes('period glued to a link'));
  assert.ok(checkReply(GOLDEN_TARGET_REPLY.replace('Your tip jar has', 'Your contract has'), ['Avalanche Team1 mini grants']).some((p) => p.includes('banned')));
  // Flag off: a v2.11 reply has none of the three headings.
  assert.deepEqual(checkReply('You have 2 projects. Want to enter a program?', []), ['missing: Where you stand or Ways to earn right now or How to move up']);
  // A link's query mark is not a question; a real sentence is.
  assert.deepEqual(checkReply(GOLDEN_TARGET_REPLY + ' earnkit.com/x?a=1', ['Avalanche Team1 mini grants']), []);
});

test('13.3 the claim, handoff and leaderboard checks', () => {
  assert.equal(claimCodeIn(GOLDEN_TARGET_REPLY), 'abcdefghijkl');
  assert.equal(claimCodeIn('earnkit.com/claim/ABCDEFGHIJKL'), null);
  const csrf = 'a'.repeat(43);
  const cookie = `__Host-ekx-${'0'.repeat(16)}=${csrf}`;
  assert.deepEqual(claimFormOf(`<input type="hidden" name="csrf" value="${csrf}">`, `${cookie}; Path=/; HttpOnly`), { csrf, cookie });
  assert.equal(claimFormOf('<p>no form</p>', cookie), null);
  assert.deepEqual(checkClaimPage('Claim your EarnKit page ... "hide my page" ... Continue with X'), []);
  assert.equal(checkClaimPage('Not found').length, 3);
  const ok = 'https://x.com/i/oauth2/authorize?response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fearnkit.com%2Fx%2Fcallback&state=s&code_challenge=h&code_challenge_method=S256';
  assert.deepEqual(checkHandoff(303, ok, 'https://earnkit.com'), []);
  assert.ok(checkHandoff(303, ok.replace('S256', 'plain'), 'https://earnkit.com').length > 0);
  assert.ok(checkHandoff(303, ok.replace('x.com', 'evil.example'), 'https://earnkit.com').length > 0);
  assert.ok(checkHandoff(200, null, 'https://earnkit.com').length > 0);
  assert.deepEqual(checkLeaderboard('<ol><li>#1 @lee</li></ol>'), []);
  assert.deepEqual(checkLeaderboard('<select><option>Base</option></select>'), ['leaderboard: filter markup']);
});

test('13.4 (final fix wave) the script\'s method allow-list: GET always, POST only to a claim button with --handoff, nothing else', () => {
  for (const p of ['/', '/leaderboard', '/claim/abcdefghijkl', '/x/callback']) {
    assert.equal(requestAllowed('GET', p, false), true, p);
    assert.equal(requestAllowed('GET', p, true), true, p);
  }
  assert.equal(requestAllowed('POST', '/claim/abcdefghijkl', true), true);
  assert.equal(requestAllowed('POST', '/claim/abcdefghijkl', false), false, 'no --handoff');
  for (const p of ['/claim/abcdefghijk', '/claim/abcdefghijklm', '/claim/ABCDEFGHIJKL', '/claim/abcdefghijk1', '/claim/wallet', '/claim/abcdefghijkl/x', '/x/callback', '/api/cron', '/claim/abcdefghijkl?x=1'])
    assert.equal(requestAllowed('POST', p, true), false, p);
  for (const m of ['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'post', 'get'])
    assert.equal(requestAllowed(m, '/claim/abcdefghijkl', true), false, m);
  // The script goes out only through request(), which asks requestAllowed first.
  const script = readFileSync(join(import.meta.dirname, '../../scripts/v2121-prod-check.mts'), 'utf8');
  assert.equal(script.match(/\bfetch\(/g)?.length, 1);
  assert.match(script, /if \(!requestAllowed\(method, path, values\.handoff === true\)\) throw/);
});
