import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARNINGS_LINE,
  LAUNCH_STUCK,
  LaunchError,
  NOT_LAUNCHED_YET,
  decodeImage,
  outcomeOf,
  retryAtOf,
  tryAgainAfter,
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

  // v2.8.1 §A4: the limit says when to retry, never "later" and never tokens.fun's raw words.
  const limited = outcomeOf({ ok: false, status: 429 }, { error: 'Daily limit' }, 'base');
  assert.equal(limited.status, 'failed');
  assert.equal(limited.release, true);
  assert.equal(limited.note, "Your token didn't launch: this wallet reached today's launch limit. Try again in a few hours.");
  const timed = outcomeOf({ ok: false, status: 429 }, { message: '10/day' }, 'base', new Date('2026-10-08T14:19:30Z'));
  assert.equal(timed.release, true);
  assert.equal(timed.note, "Your token didn't launch: this wallet reached today's launch limit. Try again after 14:20 UTC.");

  const lost = outcomeOf(null, null, 'base');
  assert.equal(lost.status, 'pending');
  assert.equal(lost.release, false);
  assert.equal(lost.note, LAUNCH_STUCK);
  assert.match(lost.agent_note!, /No answer from tokens\.fun\. The launch may have happened, so it is never retried/);
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
  assert.equal(statusUnknown.note, LAUNCH_STUCK);
  assert.match(statusUnknown.agent_note!, /it returned 502/);

  // tokens.fun's catch-all 500 can be thrown after a broadcast: kept.
  const catchAll = outcomeOf({ ok: false, status: 500 }, { error: 'Internal server error', message: 'An unexpected error occurred.' }, 'base');
  assert.equal(catchAll.status, 'pending');
  assert.equal(catchAll.release, false);
  // An edge proxy's 503 (no JSON error from tokens.fun) is kept.
  assert.equal(outcomeOf({ ok: false, status: 503 }, null, 'base').release, false);
  assert.equal(outcomeOf({ ok: false, status: 503 }, {}, 'base').release, false);
  // Any tx hash or token address: never released, whatever the status.
  for (const [status, body] of [
    [503, { error: 'Pending transactions detected.', txHash: '0xt' }],
    [500, { error: 'Deployment failed', message: 'Contract execution reverted.', tokenAddress: '0xabc' }],
    [400, { error: 'bad', txHash: '0xt' }],
    [500, { minted: false, txHash: '0xt' }],
  ] as const) {
    const o = outcomeOf({ ok: false, status }, body, 'base');
    assert.equal(o.release, false, JSON.stringify(body));
    assert.equal(o.status, 'pending');
  }

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

test('v2.8.1 §A1: tokens.fun said nothing was minted: released, retried once, and the builder says go', () => {
  for (const [status, body] of [
    [503, { error: 'Pending transactions detected. Try again in a few minutes.' }],
    [503, { error: "EarnKit fee split isn't configured" }],
    [500, { error: 'Deployment failed', message: 'Contract execution reverted. Please try again or contact support.' }],
    [502, { error: 'x', minted: false }],
  ] as const) {
    const o = outcomeOf({ ok: false, status }, body, 'base');
    assert.equal(o.status, 'failed', JSON.stringify(body));
    assert.equal(o.release, true);
    assert.equal(o.retry, true);
    assert.equal(o.note, NOT_LAUNCHED_YET);
  }
  assert.equal(NOT_LAUNCHED_YET, "Your token didn't launch yet; say 'launch the token' to try again.");
  // A 4xx is the builder's or the limit's: released, never retried at once.
  assert.equal(outcomeOf({ ok: false, status: 400 }, { error: 'bad' }, 'base').retry, undefined);
});

test('v2.8.1 §A4: retryAtOf reads retry_after (ISO or seconds), retry_after_seconds, retryAfter, then Retry-After', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  const iso = '2026-10-08T14:20:00.000Z';
  assert.equal(retryAtOf({ retry_after: iso }, null, now)?.toISOString(), iso);
  assert.equal(retryAtOf({ retry_after: 600 }, null, now)?.toISOString(), '2026-10-08T10:10:00.000Z');
  assert.equal(retryAtOf({ retry_after: '600' }, null, now)?.toISOString(), '2026-10-08T10:10:00.000Z');
  assert.equal(retryAtOf({ retry_after_seconds: 60 }, null, now)?.toISOString(), '2026-10-08T10:01:00.000Z');
  assert.equal(retryAtOf({ retryAfter: 3600 }, null, now)?.toISOString(), '2026-10-08T11:00:00.000Z');
  assert.equal(retryAtOf(null, '120', now)?.toISOString(), '2026-10-08T10:02:00.000Z');
  assert.equal(retryAtOf(null, 'Thu, 08 Oct 2026 15:00:00 GMT', now)?.toISOString(), '2026-10-08T15:00:00.000Z');
  // The JSON field wins over the header; junk and past times are ignored.
  assert.equal(retryAtOf({ retry_after: iso }, '5', now)?.toISOString(), iso);
  assert.equal(retryAtOf({ retry_after: 'soon' }, null, now), null);
  assert.equal(retryAtOf({ retry_after: '2026-10-07T00:00:00Z' }, null, now), null);
  assert.equal(retryAtOf({ retry_after: -5 }, '', now), null);
  assert.equal(tryAgainAfter(new Date('2026-10-08T14:20:00Z')), 'Try again after 14:20 UTC.');
  assert.equal(tryAgainAfter(new Date('2026-10-08T14:19:01Z')), 'Try again after 14:20 UTC.');
  assert.equal(tryAgainAfter(new Date('2026-10-09T00:00:00Z')), 'Try again after 00:00 UTC.');
  assert.equal(tryAgainAfter(null), 'Try again in a few hours.');
});

test('earnings line is the spec text (v2.7 Ruling 18: no launch protocol named)', () => {
  assert.equal(EARNINGS_LINE('0xW'), 'You earn 40% of trading fees, paid in WETH to 0xW. tokens.fun pays the gas.');
});
