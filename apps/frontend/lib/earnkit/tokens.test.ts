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
  assert.match(limited.note!, /tomorrow|later/);

  const lost = outcomeOf(null, null, 'base');
  assert.equal(lost.status, 'pending');
  assert.equal(lost.release, false);
  assert.match(lost.note!, /check tokens\.fun/);
});

test('earnings line is the spec text', () => {
  assert.equal(
    EARNINGS_LINE('0xW'),
    "You keep 40% of trading fees (after Clanker's 20% protocol cut), paid in WETH to 0xW. tokens.fun pays the gas.",
  );
});
