import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { install } from './fixtures/find';
import { ensureProfile } from './profiles';
import { bindX } from './x-install';
import { WALLET_TXS, githubAgesStep, peopleSignals, walletSignalsFrom, walletSignalsStep, type TxList } from './people-signals';

/**
 * v3.1 owner people view: the X facts kept at sign-in, the daily GitHub-age and wallet-history steps, and the
 * owner_people view (one row per profile; recipient wallet first; funded_by_slug only for another profile's wallet).
 */
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const hex = (n: number) => randomBytes(n).toString('hex');
const wallet = () => `0x${hex(20)}`;
const W = '0x' + 'ab'.repeat(20);
const F = '0x' + 'cd'.repeat(20);

test('walletSignalsFrom: the earliest tx time; the funder only from the earliest tx sent TO the wallet', () => {
  const out = { timeStamp: '1700000000', from: W.toUpperCase().replace('0X', '0x'), to: F };
  const inLater = { timeStamp: '1700000500', from: '0x' + '11'.repeat(20), to: W };
  const inFirst = { timeStamp: '1700000100', from: F.toUpperCase().replace('0X', '0x'), to: W.toUpperCase().replace('0X', '0x') };
  assert.deepEqual(walletSignalsFrom(W, { status: '1', result: [inLater, out, inFirst] }), { firstTxAt: new Date(1700000000_000).toISOString(), funder: F });
  assert.deepEqual(walletSignalsFrom(W, { status: '1', result: [out] }), { firstTxAt: new Date(1700000000_000).toISOString(), funder: null }, 'outgoing only: no funder');
  assert.deepEqual(walletSignalsFrom(W, { status: '0', result: 'No transactions found' }), { firstTxAt: null, funder: null });
  assert.deepEqual(walletSignalsFrom(W, { status: '1', result: [] }), { firstTxAt: null, funder: null });
  assert.deepEqual(walletSignalsFrom(W, null), { firstTxAt: null, funder: null });
  assert.deepEqual(walletSignalsFrom(W, { result: [{ timeStamp: 'x', from: F, to: W }, { timeStamp: '0', from: F, to: W }] }), { firstTxAt: null, funder: null }, 'no valid time: ignored');
  assert.equal(walletSignalsFrom(W, { result: [{ timeStamp: '5', from: 'nope', to: W }] }).funder, null, 'a sender that is not an address');
});

test('sign-in keeps the X account age and followers; a sign-in without them keeps the stored ones', db, async () => {
  const id = await install();
  await ensureProfile(id, new Date());
  const user = { id: `9${Date.now() % 1e9}${Math.floor(Math.random() * 1e6)}`, username: `ps_${hex(4)}`, name: 'P', avatar: null };
  assert.ok((await bindX(id, { ...user, createdAt: '2024-01-02T03:04:05.000Z', followers: 42 }, new Date())).ok);
  const read = async () =>
    (await sql()<{ x_created_at: Date | null; x_followers: number | null; x_checked_at: Date | null }[]>`
      SELECT x_created_at, x_followers, x_checked_at FROM builder_profiles WHERE builder_id = ${id}`)[0];
  const r = await read();
  assert.equal(r.x_created_at?.toISOString(), '2024-01-02T03:04:05.000Z');
  assert.equal(r.x_followers, 42);
  assert.ok(r.x_checked_at);
  assert.ok((await bindX(id, user, new Date())).ok);
  assert.deepEqual(await read(), r, 'nothing new: kept');
});

test('the daily steps and owner_people: one row per profile, the recipient wallet, funded_by_slug, points, last seen', db, async () => {
  const a = await install();
  const member = await install();
  const b = await install();
  await sql()`UPDATE installations SET builder_id = ${a}, last_seen_at = now() + interval '1 hour' WHERE id = ${member}`;
  const pa = (await ensureProfile(a, new Date()))!.profile;
  const pb = (await ensureProfile(b, new Date()))!.profile;
  const login = `ps-${hex(4)}`;
  await sql()`UPDATE builder_profiles SET github_login = ${login.toUpperCase()}, x_handle = ${`pa_${hex(3)}`}, x_followers = 7 WHERE builder_id = ${a}`;
  const [wa, wNewer, wb] = [wallet(), wallet(), wallet()];
  await sql()`INSERT INTO person_wallets (wallet, builder_id, proven_at, recipient_at) VALUES
    (${wa}, ${a}, now() - interval '2 days', now() - interval '2 days'), (${wNewer}, ${a}, now(), NULL), (${wb}, ${b}, now() - interval '3 days', now() - interval '3 days')`;
  await sql()`INSERT INTO builder_points (builder_id, week, points, via) VALUES (${a}, '2026-10-05', 3, 'share'), (${a}, '2026-10-12', 4, 'share')`;

  // GitHub: the login (lowercased) is read once and kept; a failed read stores nothing.
  const asked: string[] = [];
  const gh = await githubAgesStep(new Date(), { only: [a, b], user: async (l) => (asked.push(l), { type: 'User', created_at: '2026-09-01T00:00:00Z', public_repos: 1 }) });
  assert.deepEqual(asked, [login]);
  assert.deepEqual(gh, { due: 1, dated: 1 });
  assert.deepEqual(await githubAgesStep(new Date(), { only: [a, b], user: async () => assert.fail('read again') }), { due: 0, dated: 0 });

  // Wallets: wa first funded by b's wallet; wNewer has no tx (re-read after 7 days); wb's read fails (nothing stored).
  const paths: string[] = [];
  const read = async (path: string): Promise<TxList> => {
    paths.push(path);
    if (path.includes(wb)) throw new Error('down');
    if (path.includes(wNewer)) return { status: '0', result: [] };
    return { status: '1', result: [{ timeStamp: '1760000000', from: wa, to: wb }, { timeStamp: '1760000100', from: wb, to: wa }] };
  };
  const now = new Date();
  assert.deepEqual(await walletSignalsStep(now, { only: [a, b], read }), { due: 3, read: 2 });
  assert.ok(paths.every((p) => p.endsWith(`&sort=asc&page=1&offset=${WALLET_TXS}`) && p.startsWith('/api?module=account&action=txlist&address=0x')));
  const sig = await sql()<{ wallet: string; first_tx_at: Date | null; funder: string | null; checked: boolean }[]>`
    SELECT wallet, first_tx_at, funder, signals_checked_at IS NOT NULL AS checked FROM person_wallets WHERE builder_id IN (${a}, ${b}) ORDER BY wallet`;
  const by = Object.fromEntries(sig.map((s) => [s.wallet, s]));
  assert.equal(by[wa].first_tx_at?.toISOString(), new Date(1760000000_000).toISOString());
  assert.equal(by[wa].funder, wb);
  assert.deepEqual([by[wNewer].first_tx_at, by[wNewer].funder, by[wNewer].checked], [null, null, true]);
  assert.equal(by[wb].checked, false, 'a failed read is asked again');
  // Only wb is due now; a week on, wNewer (still no tx) is due again, wa never.
  const due = async (at: Date) => {
    const seen: string[] = [];
    await walletSignalsStep(at, { only: [a, b], read: async (p) => (seen.push(p), { result: [] }) });
    return seen.map((p) => /address=(0x[0-9a-f]{40})/.exec(p)![1]).sort();
  };
  assert.deepEqual(await due(now), [wb]);
  assert.deepEqual(await due(new Date(now.getTime() + 8 * 86_400_000)), [wNewer, wb].sort());

  const [ra] = await sql()<Record<string, unknown>[]>`SELECT * FROM owner_people WHERE builder_id = ${a}`;
  const [rb] = await sql()<Record<string, unknown>[]>`SELECT * FROM owner_people WHERE builder_id = ${b}`;
  assert.deepEqual(ra.installation_ids, [a, member].sort((x, y) => x - y));
  assert.equal(ra.slug, pa.slug);
  assert.equal(ra.x_proven, false);
  assert.equal(ra.x_followers, 7);
  assert.equal(ra.github_login, login.toUpperCase());
  assert.equal((ra.gh_created_at as Date).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(ra.wallet, wa, 'the recipient, not the newer proven wallet');
  assert.equal(ra.wallet_recipient, true);
  assert.equal(ra.wallet_funder, wb);
  assert.equal(ra.funded_by_slug, pb.slug);
  assert.deepEqual([ra.points_total, ra.points_weeks], [7, 2]);
  assert.equal(String(ra.last_points_week).length > 0, true);
  const [seen] = await sql()<{ m: Date }[]>`SELECT last_seen_at AS m FROM installations WHERE id = ${member}`;
  assert.equal((ra.last_seen_at as Date).getTime(), seen.m.getTime(), 'the newest of the group');
  assert.equal(rb.funded_by_slug, null);
  assert.deepEqual([rb.points_total, rb.points_weeks, rb.last_points_week], [0, 0, null]);
  assert.equal(rb.gh_created_at, null);
  // A wallet funded by the profile's own other wallet is no one else's.
  await sql()`UPDATE person_wallets SET funder = ${wNewer} WHERE wallet = ${wa}`;
  assert.equal((await sql()`SELECT funded_by_slug FROM owner_people WHERE builder_id = ${a}`)[0].funded_by_slug, null);
  // Only the owner's columns (no emails, tokens or IPs).
  assert.deepEqual(Object.keys(ra), [
    'builder_id', 'slug', 'hidden', 'installation_ids', 'x_handle', 'x_proven', 'x_created_at', 'x_followers', 'github_login', 'gh_created_at',
    'wallet', 'wallet_recipient', 'wallet_proven_at', 'wallet_first_tx_at', 'wallet_funder', 'funded_by_slug',
    'points_total', 'points_weeks', 'last_points_week', 'joined_at', 'last_seen_at', 'referred_installs',
    // v3.1 owner tracker (owner-tracker.test.ts), appended after.
    'x_name', 'x_avatar_url', 'main_project_key', 'project_name', 'main_repo', 'repo_private', 'site_url',
    'shipping_score', 'shipping_rank', 'rank_total', 'streak_weeks', 'commit_weeks_12', 'last_commit_week', 'last_approved_week',
    'last_activity_at', 'coin_symbol', 'coin_url', 'coin_address', 'coin_backers', 'creator_fees_eth',
    'programs_applied', 'programs_accepted', 'programs_won', 'checkin_on', 'email_opted_in',
  ]);
});

test('peopleSignals runs once a UTC day', db, async () => {
  const day = new Date('2031-05-06T10:00:00Z');
  const first = await peopleSignals(day, Date.now() + 5_000);
  assert.notDeepEqual(first, { step: 'skipped' });
  assert.deepEqual(await peopleSignals(new Date('2031-05-06T23:00:00Z'), Date.now() + 5_000), { step: 'skipped' });
});
