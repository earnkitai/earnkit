import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFunctionSelector } from 'viem';
import { EARNKIT_STARTER_NAMES } from './earnkit-orgs';
import { starterRepo } from './match-projects';
import { STARTERS, type Starter } from './starters';

test('5.3 every starter\'s "what" passes the copy rules: short, plain, no emoji, dash, coin, vault, Clanker or tool name', () => {
  for (const s of Object.values(STARTERS)) {
    assert.ok(s.what.length > 0 && s.what.split(/\s+/).length <= 8, `${s.id}: short`);
    assert.match(s.what, /^[a-z]/, `${s.id}: lower case, it sits mid-sentence ("A USDC tip page on Arc takes about an hour")`);
    assert.doesNotMatch(s.what, /\p{Extended_Pictographic}/u, s.id);
    assert.doesNotMatch(s.what, /[\u2013\u2014]/, s.id);
    assert.doesNotMatch(s.what, /\bcoins?\b|vault|clanker/i, s.id);
    assert.doesNotMatch(s.what, /\b(find|prepare|confirm|tell|list_programs|get_program|prepare_submission)\b/i, s.id);
    assert.doesNotMatch(s.what, /[.?!]$/, `${s.id}: a phrase, not a sentence`);
  }
});

test('T5: the registry is keyed by id, on a chain EarnKit deploys to, with a real event signature and an hour bar', () => {
  assert.ok(Object.keys(STARTERS).length >= 1);
  for (const [key, s] of Object.entries(STARTERS) as [string, Starter][]) {
    assert.equal(s.id, key);
    assert.ok(['arc', 'base'].includes(s.chain), s.id);
    assert.equal(s.minutes, 60);
    assert.match(s.repo, /^earnkitai\/[a-z0-9-]+(\/[a-z0-9-]+)*$/, `${s.id}: a degit path under earnkitai`);
    assert.match(s.usage_event, /^[A-Z][A-Za-z0-9]*\(([a-z0-9]+(,[a-z0-9]+)*)?\)$/, `${s.id}: a canonical event signature`);
    assert.ok(['recent_logs', 'view_total'].includes(s.usage_read), s.id);
    assert.match(s.contract.artifact, /^[A-Z][A-Za-z0-9]*$/);
    assert.ok(s.site_dir && !s.site_dir.startsWith('/') && !s.site_dir.includes('..'), `${s.id}: a relative site_dir`);
    assert.ok(s.test_cmd.length > 0);
    // tested_at: null until the starter's own test passes, else a YYYY-MM-DD date.
    if (s.tested_at !== null) assert.match(s.tested_at, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('T5/T6: arc-tipjar is chain-kits arc/tipjar (main 0f573a7): UsdcTipJar with the owner as constructor argument, tested 2026-10-11, use read from stats()', () => {
  const s = STARTERS['arc-tipjar'];
  assert.equal(s.chain, 'arc');
  assert.equal(s.repo, 'earnkitai/chain-kits/arc/tipjar');
  assert.equal(s.what, 'a USDC tip page on Arc');
  assert.deepEqual(s.contract, { artifact: 'UsdcTipJar', owner_arg: true });
  assert.equal(s.site_dir, 'site');
  assert.equal(s.test_cmd, 'bash scripts/e2e.sh');
  assert.equal(s.tested_at, '2026-10-11');
  assert.equal(s.usage_event, 'Tipped(address,uint256,string)');
  // Ruling R-T6: the T6 starter keeps running totals, so a usage check is one eth_call of stats().
  assert.equal(s.usage_read, 'view_total');
  assert.deepEqual(s.usage_view, { call: 'stats()', selector: '0xd80528ae', words: ['tips', 'total', 'tippers'] });
});

test('T6 follow-up: a view_total starter names its view, and the selector is the call\'s', () => {
  for (const s of Object.values(STARTERS) as Starter[]) {
    if (s.usage_read !== 'view_total') continue;
    assert.ok(s.usage_view, `${s.id}: view_total needs usage_view`);
    assert.equal(s.usage_view.selector, toFunctionSelector(s.usage_view.call), s.id);
    assert.ok(s.usage_view.words.length >= 1, s.id);
  }
});

test('T5 (owner decision 4): base-checkin is not registered until a Base program qualifies and its test passes', () => {
  assert.ok(!('base-checkin' in STARTERS));
});

test('T6 follow-up: an unchanged arc/tipjar copy is a starter (its package name or README heading), a renamed one is not', () => {
  assert.ok(EARNKIT_STARTER_NAMES.includes('earnkit-arc-tipjar-starter'));
  assert.ok(EARNKIT_STARTER_NAMES.includes('Arc tip jar starter (EarnKit)'));
  assert.equal(starterRepo({ packageName: 'earnkit-arc-tipjar-starter', heading: null }), true);
  assert.equal(starterRepo({ packageName: null, heading: 'Arc tip jar starter (EarnKit)' }), true);
  assert.equal(starterRepo({ packageName: 'podtips', heading: 'PodTips' }), false);
});
