import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKIN_ASK, POST_ASK, SHIP_ASK, TOKEN_OFFER, askWhy, benchReply, qualifyLine, type BenchView } from './bench-reply';
import { fridayNudge } from './nudges';

/**
 * v4.7.1 Task 1 (money always shows), what stays after v4.8 Task 1: the reply shapes with no money line of their own
 * (wallet, token, new repo, the Monday block, a post) carry the fit line; the standing shown is v4.7's paragraph; a reply
 * with no question carries no why. v4.8 retired the "Open now:" paragraph, the check_fits rotation and the money-first
 * re-ask (the path, conversation.ts, names the money; v48-conversation.test.ts).
 */
const P = { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 6 };
const ranked = (o: Partial<BenchView> = {}): BenchView => ({
  state: 'ranked', variant: null, project: P, rank: '#3 of 40 builders', streak: 6, target: null, handle: 'maya', link: null,
  fund: [], due: [], ask: { kind: 'ship', project_key: P.key, line: SHIP_ASK }, held: null, standingShown: true, nagShown: true, ...o,
});

test('pure: the shapes with no money line of their own carry the fit line; a held question never does', () => {
  const fit = { kind: 'fits' as const, title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling' };
  const post = { head: 'Kit went live this week.', text: 'Kit is live.', link: 'https://earnkit.com/maya/post/abcdefghij' };
  const shapes: Partial<BenchView>[] = [
    { ask: { kind: 'wallet', project_key: P.key, line: 'Prove your Base wallet: https://earnkit.com/w\nDone?' } },
    { ask: { kind: 'token', project_key: null, line: TOKEN_OFFER } },
    { ask: { kind: 'new_repo', project_key: P.key, line: 'Working on something new? Connect that repo instead.' } },
    { ask: { kind: 'post', project_key: P.key, line: POST_ASK }, post },
  ];
  for (const o of shapes) {
    const s = benchReply(ranked({ fund: [fit], standingShown: false, ...o }));
    assert.ok(s.includes(qualifyLine(fit)), s);
    assert.doesNotMatch(s, /Open now|Ask me anytime/, s);
  }
  assert.doesNotMatch(benchReply(ranked({ fund: [fit], held: 'Did Kit win?' })), /Open now|Ask me anytime/);
  // The standing shown is the paragraph (standingText), never the old line; a reply with no question has no why.
  const st = benchReply(ranked({ ask: { kind: 'none', project_key: P.key, line: '' }, standingText: 'Score 77 · #3 of 40 builders. 6 weeks shipping in a row.' }));
  assert.match(st, /Score 77/);
  assert.equal(askWhy(ranked({ ask: { kind: 'none', project_key: P.key, line: '' } })), null);
  // A fit's line (in the standing paragraph) goes above the Friday nudge; the reply asks one question.
  for (const ask of [{ kind: 'ship' as const, project_key: P.key, line: SHIP_ASK }, { kind: 'checkin' as const, project_key: P.key, line: CHECKIN_ASK }]) {
    const s = benchReply(ranked({ fund: [fit], nudge: fridayNudge(6), standingText: 'Score 77 · #3 of 40 builders.', ask }));
    const ps = s.split('\n\n');
    assert.ok(ps[0].includes(qualifyLine(fit)) && ps[1] === fridayNudge(6), s);
    assert.equal((s.match(/\?/g) ?? []).length, 1, s);
  }
});
