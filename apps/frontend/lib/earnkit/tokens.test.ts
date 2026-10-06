import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARNINGS_LINE,
  LaunchError,
  decodeImage,
  outcomeOf,
  xProfileUrl,
} from './tokens';

test('X handle in any common form becomes a profile URL', () => {
  for (const v of [
    'earnkit_ai',
    '@earnkit_ai',
    'https://x.com/earnkit_ai',
    'https://twitter.com/earnkit_ai/',
    'x.com/earnkit_ai?s=20'.replace(/^/, 'https://'),
  ]) {
    assert.equal(xProfileUrl(v), 'https://x.com/earnkit_ai');
  }
});

test('non-handles are rejected', () => {
  for (const v of [
    'not a handle!',
    '',
    'https://example.com/me',
    'waytoolonghandle_1234',
  ]) {
    assert.throws(() => xProfileUrl(v), LaunchError);
  }
});

test('token images: allowed types with matching bytes, up to 1 MB', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(20),
  ]);
  const ok = decodeImage(`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(ok.type, 'image/png');
  assert.equal(ok.bytes.length, png.length);
  assert.throws(
    () => decodeImage(`data:image/jpeg;base64,${png.toString('base64')}`),
    LaunchError,
  ); // bytes don't match type
  assert.throws(
    () => decodeImage(`data:image/svg+xml;base64,PHN2Zz4=`),
    LaunchError,
  ); // svg not allowed
  assert.throws(() => decodeImage('https://example.com/a.png'), LaunchError);
  const big = Buffer.concat([png, Buffer.alloc(1_000_001)]);
  assert.throws(
    () => decodeImage(`data:image/png;base64,${big.toString('base64')}`),
    LaunchError,
  );
});

test('deploy outcomes: success, refusal (released), rate limit, no answer (kept pending)', () => {
  const ok = outcomeOf(
    { ok: true, status: 200 },
    {
      success: true,
      tokenAddress: '0xabc',
      txHash: '0xt',
      urls: { tokensfun: 'https://tokens.fun/coin/0xabc' },
    },
    'base',
  );
  assert.equal(ok.status, 'launched');
  assert.equal(ok.tokens_fun, 'https://tokens.fun/coin/0xabc');

  const refused = outcomeOf(
    { ok: false, status: 400 },
    { error: 'Token symbol must be 10 characters or less' },
    'base',
  );
  assert.equal(refused.status, 'failed');
  assert.equal(refused.release, true);
  assert.match(refused.note!, /symbol/);

  const limited = outcomeOf({ ok: false, status: 429 }, { error: 'Daily limit' }, 'base');
  assert.equal(limited.status, 'failed');
  assert.equal(limited.release, true);
  assert.equal(limited.note, "tokens.fun's launch limit was reached (Daily limit). Say 'launch the token' later.");
  // tokens.fun's own words and retryAfter, when it sends them.
  const timed = outcomeOf({ ok: false, status: 429 }, { message: '5 launches an hour', retryAfter: 1800 }, 'base');
  assert.equal(timed.release, true);
  assert.equal(timed.note, "tokens.fun's launch limit was reached (5 launches an hour). Say 'launch the token' in 30 minutes.");

  const lost = outcomeOf(null, null, 'base');
  assert.equal(lost.status, 'pending');
  assert.equal(lost.release, false);
  assert.match(lost.note!, /check tokens\.fun/);
});

test("deploy outcomes: unminted-or-unknown responses stay pending, not released", () => {
  // 502 "status unknown" after a deploy-tx timeout: tokens.fun itself can't confirm.
  const statusUnknown = outcomeOf(
    { ok: false, status: 502 },
    { error: 'Deployment status unknown' },
    'base',
  );
  assert.equal(statusUnknown.status, 'pending');
  assert.equal(statusUnknown.release, false);
  assert.match(statusUnknown.note!, /check tokens\.fun/);

  // A 500 whose body didn't parse.
  const serverErrorNoBody = outcomeOf({ ok: false, status: 500 }, null, 'base');
  assert.equal(serverErrorNoBody.status, 'pending');
  assert.equal(serverErrorNoBody.release, false);

  // A 200 that didn't actually confirm success.
  const okEmptyBody = outcomeOf({ ok: true, status: 200 }, {}, 'base');
  assert.equal(okEmptyBody.status, 'pending');
  assert.equal(okEmptyBody.release, false);

  // A 200 whose body didn't parse at all.
  const okNoBody = outcomeOf({ ok: true, status: 200 }, null, 'base');
  assert.equal(okNoBody.status, 'pending');
  assert.equal(okNoBody.release, false);

  // A 4xx with a parsed body IS released: auth refusals happen before minting too.
  const unauthorized = outcomeOf(
    { ok: false, status: 401 },
    { error: 'Unauthorized' },
    'base',
  );
  assert.equal(unauthorized.status, 'failed');
  assert.equal(unauthorized.release, true);
  assert.match(unauthorized.note!, /Unauthorized/);
});

test('earnings line is the spec text (v2.7 Ruling 18: no launch protocol named)', () => {
  assert.equal(EARNINGS_LINE('0xW'), 'You earn 40% of trading fees, paid in WETH to 0xW. tokens.fun pays the gas.');
});
