import { after, test } from 'node:test';
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
    [503, { error: 'Server configuration error' }],
    [503, { error: 'Server wallet configuration incomplete (ADMIN_WALLET)' }],
    [503, { error: 'Cannot price USDC right now, so the launch tick cannot be set. Try again shortly.' }],
    // Ruling F3: tokens.fun's revert 500 with minted:false (tf route.ts, uncommitted F3 work).
    [500, { error: 'Deployment failed', message: 'Contract execution reverted. Please try again or contact support.', minted: false }],
    [502, { error: 'x', minted: false }],
  ] as const) {
    const o = outcomeOf({ ok: false, status }, body, 'base');
    assert.equal(o.status, 'failed', JSON.stringify(body));
    assert.equal(o.release, true);
    assert.equal(o.retry, true);
    assert.equal(o.note, NOT_LAUNCHED_YET);
  }
  assert.equal(NOT_LAUNCHED_YET, "Your token didn't launch yet; say 'launch the token' to try again.");
  // Fix round 1: only tokens.fun's exact pre-mint 503 texts, or minted:false. Any other 503, and a
  // revert without minted:false, are kept.
  for (const [status, body] of [
    [503, { error: 'Service Unavailable' }],
    [503, { error: 'Pending transactions detected' }],
    [503, { error: 'Pending transactions detected. Try again in a few minutes. (after broadcast)' }],
    [500, { error: 'Deployment failed', message: 'Contract execution reverted. Please try again or contact support.' }],
    [500, { error: 'x', minted: true }],
  ] as const) {
    const o = outcomeOf({ ok: false, status }, body, 'base');
    assert.equal(o.release, false, JSON.stringify(body));
    assert.equal(o.status, 'pending');
  }
  // A 4xx is the builder's or the limit's: released, never retried at once.
  assert.equal(outcomeOf({ ok: false, status: 400 }, { error: 'bad' }, 'base').retry, undefined);
});

test('v2.8.1 §A4: retryAtOf reads retry_after (ISO or seconds), retry_after_seconds, retryAfter, then Retry-After', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  const iso = '2026-10-08T14:20:00.000Z';
  assert.equal(retryAtOf({ retry_after: iso }, null, now)?.toISOString(), iso);
  // tokens.fun's T1 429 body (cc46fa2): retry_after { at, seconds }, at first.
  assert.equal(retryAtOf({ retry_after: { at: iso, seconds: 5 } }, '0', now)?.toISOString(), iso);
  assert.equal(retryAtOf({ retry_after: { seconds: 600 } }, null, now)?.toISOString(), '2026-10-08T10:10:00.000Z');
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

test('v2.9 T12: the tokens.fun host is read per call, so a mock set after the modules load is the one used', async () => {
  // The shared no-network fixture (and anything importing stats.ts) loads tokens.ts first; the
  // anvil e2e sets its mock tokens.fun only afterwards. A host frozen at import sent its deploy to
  // the real tokens.fun.
  await import('./fixtures/no-network-checks');
  const { tokensFunUrl } = await import('./tokens');
  const { tokensFunTickerCheck } = await import('./token-proposal');
  const saved = { url: process.env.TOKENSFUN_API_URL, key: process.env.TOKENSFUN_DEPLOY_API_KEY, fetch: globalThis.fetch };
  const seen: string[] = [];
  try {
    process.env.TOKENSFUN_API_URL = 'http://127.0.0.1:9/';
    process.env.TOKENSFUN_DEPLOY_API_KEY = 'k';
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      seen.push(String(u));
      return new Response('{"available":true}', { status: 200 });
    }) as typeof fetch;
    assert.equal(tokensFunUrl(), 'http://127.0.0.1:9');
    assert.equal(await tokensFunTickerCheck('TIP'), true);
    assert.deepEqual(seen, ['http://127.0.0.1:9/api/check-ticker?symbol=TIP']);
    delete process.env.TOKENSFUN_API_URL;
    assert.equal(tokensFunUrl(), 'https://tokens.fun');
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [['TOKENSFUN_API_URL', saved.url], ['TOKENSFUN_DEPLOY_API_KEY', saved.key]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await (await import('./db')).sql().end();
});

test('4.12 (R10) a private repo\'s entry sends tokens.fun the live link as website and never the repo URL', dbTest, async () => {
  const { sql } = await import('./db');
  const { deployToken } = await import('./tokens');
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  const tag = `t412-${process.pid}-${Date.now()}`;
  // deployToken logs each launch ("[launch] project N: launched ..."); kept out of the output.
  const log = console.log;
  console.log = () => {};
  const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${tag}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const entry = async (n: number, o: { live: string | null; repoPrivate: boolean }) => {
    const repo = `https://github.com/alice/${tag}-${n}`;
    const [p] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url, live_url, repo_private)
      VALUES (${tag}, ${`Tip Jar ${n}`}, ${inst.id}, ${repo}, ${o.live}, ${o.repoPrivate}) RETURNING id`;
    return { id: p.id, repo };
  };
  const launch = async (e: { id: number; repo: string }, live: string | null, repoPrivate?: boolean) => {
    let sent = '';
    const out = await deployToken(
      { projectId: e.id, installationId: inst.id, name: 'Tip Jar', symbol: 'TIPJ', creatorWallet: `0x${'1'.repeat(40)}`, image: null, repoUrl: e.repo, liveUrl: live, repoPrivate },
      { fetch: (async (_u: unknown, init?: RequestInit) => ((sent = String(init?.body)), Response.json({ success: true, tokenAddress: `0x${(await import('node:crypto')).randomBytes(20).toString('hex')}`, txHash: '0x1' }))) as typeof fetch },
    );
    assert.equal(out.status, 'launched');
    return { body: JSON.parse(sent) as Record<string, unknown>, raw: sent };
  };
  try {
    const priv = await entry(1, { live: 'https://tipjar.xyz', repoPrivate: true });
    const a = await launch(priv, 'https://tipjar.xyz');
    assert.equal(a.body.website, 'https://tipjar.xyz');
    assert.ok(!a.raw.includes(`${tag}-1`), 'no repo URL anywhere in the body');
    // No live link: no website at all.
    const bare = await entry(2, { live: null, repoPrivate: true });
    const b = await launch(bare, null);
    assert.equal('website' in b.body, false);
    assert.ok(!b.raw.includes(`${tag}-2`));
    // The gate read the repo through the App (Pre-flight P4): the claim marks the entry private too.
    const viaGate = await entry(3, { live: null, repoPrivate: false });
    const c = await launch(viaGate, null, true);
    assert.equal('website' in c.body, false);
    const [row] = await sql()<{ repo_private: boolean }[]>`SELECT repo_private FROM projects WHERE id = ${viaGate.id}`;
    assert.equal(row.repo_private, true);
    // A public repo keeps the v2.9 website (the repo URL when there is no live link).
    const pub = await entry(4, { live: null, repoPrivate: false });
    assert.equal((await launch(pub, null)).body.website, pub.repo);
  } finally {
    console.log = log;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
    await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
    await sql()`DELETE FROM programs WHERE id = ${tag}`;
    await sql()`DELETE FROM installations WHERE id = ${inst.id}`;
  }
});
