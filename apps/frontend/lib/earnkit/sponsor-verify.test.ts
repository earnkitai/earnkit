import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeFetchError } from './safe-fetch';
import { checkEarnkitTxt, verificationIsFresh } from './sponsor-verify';

const W = '0x1111111111111111111111111111111111111111';

test('checkEarnkitTxt: fetches the well-known file on the host', async () => {
  const urls: string[] = [];
  const v = await checkEarnkitTxt('acme.dev', W, async (url) => {
    urls.push(url);
    return `earnkit-sponsor: ${W}\n`;
  });
  assert.deepEqual(v, { verified: true, note: null });
  assert.deepEqual(urls, ['https://acme.dev/.well-known/earnkit.txt']);
});

test('checkEarnkitTxt: a file without the wallet, or a refused fetch, is unverified with a reason', async () => {
  assert.deepEqual(
    await checkEarnkitTxt('acme.dev', W, async () => 'earnkit-sponsor: 0x12'),
    {
      verified: false,
      note: `https://acme.dev/.well-known/earnkit.txt doesn't contain "earnkit-sponsor: ${W}".`,
    },
  );
  assert.deepEqual(
    await checkEarnkitTxt('acme.dev', W, async () => {
      throw new SafeFetchError("redirects aren't followed (301)");
    }),
    {
      verified: false,
      note: "EarnKit couldn't read https://acme.dev/.well-known/earnkit.txt: redirects aren't followed (301).",
    },
  );
});

test('verificationIsFresh: a pass for 24 h, a failure for 1 h (or the retry window)', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const H = 3_600_000;
  assert.equal(
    verificationIsFresh({ verified: true, checked_at: ago(23 * H) }, now),
    true,
  );
  assert.equal(
    verificationIsFresh({ verified: true, checked_at: ago(24 * H) }, now),
    false,
  );
  assert.equal(
    verificationIsFresh({ verified: false, checked_at: ago(59 * 60_000) }, now),
    true,
  );
  assert.equal(
    verificationIsFresh({ verified: false, checked_at: ago(H) }, now),
    false,
  );
  assert.equal(
    verificationIsFresh(
      { verified: false, checked_at: ago(2 * 60_000) },
      now,
      60_000,
    ),
    false,
  );
  // A row from the future (clock skew) is never trusted.
  assert.equal(
    verificationIsFresh({ verified: true, checked_at: ago(-60_000) }, now),
    false,
  );
});
