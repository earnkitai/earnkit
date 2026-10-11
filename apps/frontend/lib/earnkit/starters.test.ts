import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_USAGE } from './events';
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

test('T5: arc-tipjar is the UsdcTipJar (owner is a constructor argument, Tipped counts as use); untested until T6 passes', () => {
  const s = STARTERS['arc-tipjar'];
  assert.equal(s.chain, 'arc');
  assert.equal(s.what, 'a USDC tip page on Arc');
  assert.deepEqual(s.contract, { artifact: 'UsdcTipJar', owner_arg: true });
  assert.equal(s.usage_event, 'Tipped(address,uint256,string)');
  // Ruling R-T6: view counters come with the T6 starter; until then the recent window of logs.
  assert.equal(s.usage_read, 'recent_logs');
  assert.equal(s.tested_at, null);
});

test('T5 (owner decision 4): base-checkin is not registered until a Base program qualifies and its test passes', () => {
  assert.ok(!('base-checkin' in STARTERS));
});

test('T5: the usage rule on STARTERS matches events.ts STARTER_USAGE until events.ts reads STARTERS', () => {
  for (const [id, u] of Object.entries(STARTER_USAGE)) {
    const s = STARTERS[id as keyof typeof STARTERS];
    assert.ok(s, `${id} is in STARTERS`);
    assert.equal(s.usage_event, u.usage_event, id);
    assert.equal(s.usage_read, u.usage_read, id);
  }
});
