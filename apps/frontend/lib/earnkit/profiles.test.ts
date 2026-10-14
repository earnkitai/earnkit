import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import {
  CONSENT_LINE, X_NOT_LISTED_NOTE, X_TAKEN_NOTE, baseSlug, clearXHandle, consentOnce, xHandleConflicts, ensureProfile, mergeProfiles, nextFreeSlug, profileOf, randomSlug,
  slugOwner, setFallback, setHidden, setXHandle, shownName, walletSlug,
} from './profiles';

/** Final review I4: a profile is public only once the consent line was shown; these tests are about other rules. */
async function shownProfile(...a: Parameters<typeof ensureProfile>) {
  const made = await ensureProfile(...a);
  await sql()`UPDATE builder_profiles SET consent_shown_at = now() WHERE builder_id = ${a[0]} AND consent_shown_at IS NULL`;
  return made;
}

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const W = '0xAbCd' + '0'.repeat(32) + '1234';
const T = 2_100_004_000 + (process.pid % 900) * 20;
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await sql()`DELETE FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM discovery_queue WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_ranks WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_profiles WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM profile_slug_history WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM x_handle_conflicts WHERE holder BETWEEN ${T} AND ${T + 19} OR claimant BETWEEN ${T} AND ${T + 19}`;
  await sql().end();
});
const fresh = async (...ids: number[]) => {
  await sql()`DELETE FROM builder_profiles WHERE builder_id IN ${sql()(ids)}`;
  await sql()`DELETE FROM profile_slug_history WHERE builder_id IN ${sql()(ids)}`;
  await sql()`DELETE FROM discovery_queue WHERE builder_id IN ${sql()(ids)}`;
  await sql()`DELETE FROM builder_ranks WHERE builder_id IN ${sql()(ids)}`;
  await sql()`DELETE FROM x_handle_conflicts WHERE holder IN ${sql()(ids)} OR claimant IN ${sql()(ids)}`;
};
/** A wallet whose short slug is unique to this run: 0x<4 hex of T> ... <last4>. */
const runWallet = (last4: string, mid = '0') => `0x${(T % 65536).toString(16).padStart(4, '0')}${mid.repeat(32)}${last4}`;

test('7.1 slug rules: X handle lowercased, else the proven login, else the short wallet, else random', () => {
  assert.equal(baseSlug({ x_handle: 'Lee_Builds', github_login: 'lee' }), 'lee_builds');
  assert.equal(baseSlug({ github_login: 'Lee-Dev' }), 'lee-dev');
  assert.equal(baseSlug({ wallet: W }), '0xabcd1234');
  assert.equal(walletSlug(W), '0xabcd1234');
  assert.equal(baseSlug({}), null);
  assert.match(randomSlug(), /^b-[a-z2-9]{8}$/);
  assert.equal(shownName({ x_handle: 'Lee_Builds', fallback_handle: 'lee', slug: 'lee_builds' }), '@Lee_Builds');
  assert.equal(shownName({ x_handle: null, fallback_handle: '0xabcd…1234', slug: '0xabcd1234' }), '0xabcd…1234');
  assert.equal(shownName({ x_handle: null, fallback_handle: null, slug: 'b-x7k2m9qa' }), 'Builder b-x7k2m9qa');
  assert.equal(CONSENT_LINE('lee'), 'Your public work gets a public score at earnkit.com/b/lee. Say hide anytime.');
});

test('7.2 a taken slug gets -2, then -3 (taken includes other people\'s history)', () => {
  const taken = new Set(['bob', 'bob-2']);
  assert.equal(nextFreeSlug('bob', (s) => taken.has(s)), 'bob-3');
  assert.equal(nextFreeSlug('ann', (s) => taken.has(s)), 'ann');
});

test('7.3 an X handle changes the slug; the old one redirects forever and is never given to anyone else', dbTest, async () => {
  const [b, c] = [T, T + 1];
  await fresh(b, c);
  await shownProfile(b, new Date());
  // B's first slug is its short wallet; then its proven login; then its X handle.
  await setFallback(b, { wallet: runWallet('1234') });
  const first = (await profileOf(b))!.slug;
  assert.equal(first, walletSlug(runWallet('1234')));
  await setFallback(b, { github_login: `bob${T}` });
  assert.equal((await profileOf(b))!.slug, `bob${T}`);
  await sql()`UPDATE builder_profiles SET twitter_prefill = ${`Bob${T % 1000}`} WHERE builder_id = ${b}`;
  const r = await setXHandle(b, 'yes');
  assert.ok(r.ok);
  const now = (await profileOf(b))!.slug;
  assert.equal(now, `bob${T % 1000}`);
  assert.deepEqual(await slugOwner(first), { builderId: b, redirect: now });
  assert.deepEqual(await slugOwner(`bob${T}`), { builderId: b, redirect: now });
  // C's own wallet has the same short slug as B's old one: C gets the next free one.
  await shownProfile(c, new Date());
  await setFallback(c, { wallet: runWallet('1234', '1') });
  assert.equal((await profileOf(c))!.slug, `${first}-2`);
  // One login, one person: C can't take B's login.
  await setFallback(c, { github_login: `BOB${T}` });
  assert.deepEqual([(await profileOf(c))!.github_login, (await profileOf(c))!.slug], [null, `${first}-2`]);
});

test('7.4 a typed handle that isn\'t on the proven GitHub profile is refused: nothing changes, no event', dbTest, async () => {
  await fresh(T + 2);
  await shownProfile(T + 2, new Date());
  await setFallback(T + 2, { github_login: `ann${T}` });
  await sql()`UPDATE builder_profiles SET twitter_prefill = 'ann_real' WHERE builder_id = ${T + 2}`;
  const slug = (await profileOf(T + 2))!.slug;
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    const r = await setXHandle(T + 2, 'elonmusk');
    assert.deepEqual(r, { ok: false, agent_note: X_NOT_LISTED_NOTE });
  } finally {
    delete process.env.EARNKIT_EVENT_LOG;
  }
  assert.deepEqual([(await profileOf(T + 2))!.x_handle, (await profileOf(T + 2))!.slug], [null, slug], 'no handle, no slug change');
  const [ev] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'x_added' AND installation_id = ${T + 2}`;
  assert.equal(ev.n, 0, 'no x_added event');
  const noLogin = T + 3;
  await fresh(noLogin);
  await shownProfile(noLogin, new Date());
  assert.equal((await setXHandle(noLogin, 'yes')).ok, false, 'no proven login: no prefill to accept');
});

test('7.5 hide and show: a hidden profile does not resolve (404) but keeps its row; show brings it back', dbTest, async () => {
  await fresh(T + 4);
  const { profile } = (await shownProfile(T + 4, new Date()))!;
  assert.equal(await setHidden(T + 4, true), 'Your profile is hidden. Say show to list it again.');
  assert.equal(await slugOwner(profile.slug), null);
  assert.ok(await profileOf(T + 4), 'the row stays');
  assert.equal(await setHidden(T + 4, false), `Your profile is public again: earnkit.com/b/${profile.slug}`);
  assert.deepEqual(await slugOwner(profile.slug), { builderId: T + 4, redirect: null });
});

test('7.6 linking merges profiles: one profile, sources moved once, the other slug redirects to the root', dbTest, async () => {
  const [root, other] = [T + 5, T + 6];
  await fresh(root, other);
  await sql()`DELETE FROM builder_sources WHERE builder_id IN (${root}, ${other})`;
  await shownProfile(root, new Date());
  const otherSlug = (await shownProfile(other, new Date()))!.profile.slug;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES
    (${root}, 'repo', 'lee/a', 'lee/a', 'agent'), (${other}, 'repo', 'lee/a', 'lee/a', 'agent'), (${other}, 'repo', 'lee/b', 'lee/b', 'agent')`;
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const live = await sql()<{ builder_id: number; ref: string; state: string }[]>`
    SELECT builder_id, ref, state FROM builder_sources WHERE builder_id IN (${root}, ${other}) ORDER BY ref, builder_id`;
  assert.deepEqual(live.filter((s) => s.state !== 'rejected').map((s) => `${s.builder_id}:${s.ref}`), [`${root}:lee/a`, `${root}:lee/b`]);
  assert.equal(await profileOf(other), null);
  assert.equal((await slugOwner(otherSlug))?.builderId, root);
});

test('7.7 a shared group never gets a profile', dbTest, async () => {
  const [row] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${`v212-shared-${T}-${Date.now()}`}, true) RETURNING id`;
  assert.equal(await shownProfile(row.id, new Date()), null);
  assert.equal(await profileOf(row.id), null);
});

test('7.9 merge, the other has the X handle: it wins, takes the root id, keeps login and handle; the root slug redirects; its rank goes', dbTest, async () => {
  const [root, other] = [T + 7, T + 8];
  await fresh(root, other);
  const rootSlug = (await shownProfile(root, new Date()))!.profile.slug;
  await shownProfile(other, new Date());
  await setFallback(other, { github_login: `mx${T}` });
  await sql()`UPDATE builder_profiles SET twitter_prefill = ${`Mx${T % 1000}`} WHERE builder_id = ${other}`;
  assert.ok((await setXHandle(other, 'yes')).ok);
  await setHidden(root, true);
  await sql()`INSERT INTO builder_ranks (builder_id, score, percentile, computed_at) VALUES (${other}, 40, 50, now())`;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    await sql().begin((tx) => mergeProfiles(tx, root, other));
  } finally {
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
  const p = (await profileOf(root))!;
  assert.deepEqual([p.github_login, p.x_handle, p.slug, p.hidden], [`mx${T}`, `Mx${T % 1000}`, `mx${T % 1000}`, true], 'login and handle kept; hidden stays hidden');
  assert.equal(await profileOf(other), null);
  await setHidden(root, false);
  assert.deepEqual(await slugOwner(rootSlug), { builderId: root, redirect: `mx${T % 1000}` });
  assert.deepEqual(await slugOwner(`mx${T}`), { builderId: root, redirect: `mx${T % 1000}` }, 'the moved history follows');
  const [rank] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_ranks WHERE builder_id = ${other}`;
  assert.equal(rank.n, 0, 'the merged-away id stops counting');
  const [q] = await sql()<{ reason: string }[]>`SELECT reason FROM discovery_queue WHERE builder_id = ${root}`;
  assert.equal(q?.reason, 'signin', 'rediscovered with both groups\' clues');
});

test('7.10 merge, the root wins: the other\'s login moves to it (no unique clash) and its slug follows the login', dbTest, async () => {
  const [root, other] = [T + 9, T + 10];
  await fresh(root, other);
  const rootSlug = (await shownProfile(root, new Date()))!.profile.slug;
  await shownProfile(other, new Date());
  await setFallback(other, { github_login: `ml${T}` });
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const p = (await profileOf(root))!;
  assert.deepEqual([p.github_login, p.fallback_handle, p.slug], [`ml${T}`, `ml${T}`, `ml${T}`]);
  assert.deepEqual(await slugOwner(rootSlug), { builderId: root, redirect: `ml${T}` });
  assert.deepEqual(await slugOwner(`ml${T}`), { builderId: root, redirect: null });
  const [q] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM discovery_queue WHERE builder_id = ${root}`;
  assert.equal(q.n, 0, 'flag off: no queue write');
});

test('7.11 merge with no profile on either side writes nothing', dbTest, async () => {
  const [root, other] = [T + 11, T + 12];
  await fresh(root, other);
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    await sql().begin((tx) => mergeProfiles(tx, root, other));
  } finally {
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
  const [q] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM discovery_queue WHERE builder_id IN (${root}, ${other})`;
  assert.equal(q.n, 0);
  assert.equal(await profileOf(root), null);
});

test('7.13 no impersonation: an X handle another person already shows is refused, even when their GitHub lists it too', dbTest, async () => {
  const [a, b] = [T + 13, T + 14];
  await fresh(a, b);
  const handle = `Twin${T % 100000}`;
  for (const [id, login] of [[a, `twa${T}`], [b, `twb${T}`]] as const) {
    await shownProfile(id, new Date());
    await setFallback(id, { github_login: login });
    await sql()`UPDATE builder_profiles SET twitter_prefill = ${handle} WHERE builder_id = ${id}`;
  }
  assert.ok((await setXHandle(a, 'yes')).ok);
  const before = (await profileOf(b))!;
  assert.deepEqual(await setXHandle(b, handle.toLowerCase()), { ok: false, agent_note: X_TAKEN_NOTE }, 'a distinct note: adding it on GitHub would not help');
  const after = (await profileOf(b))!;
  assert.deepEqual([after.x_handle, after.slug], [null, before.slug]);
  // The owner sees the conflict (needs_owner and /admin/scores) while A still shows the handle.
  assert.deepEqual((await xHandleConflicts([a, b])).map((c) => c.line), [`x_handle conflict: @${handle.toLowerCase()} (builder ids ${a}, ${b})`]);
});

test('7.15 the owner clears a held handle: the slug falls back to the login, the X slug still redirects, an event, the conflict closes; B can then claim it', dbTest, async () => {
  const [a, b] = [T + 13, T + 14]; // from 7.13
  const xSlug = (await profileOf(a))!.slug;
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    assert.equal(await clearXHandle(a, 'owner'), true);
    assert.equal(await clearXHandle(a, 'owner'), false, 'nothing left to clear');
  } finally {
    delete process.env.EARNKIT_EVENT_LOG;
  }
  const p = (await profileOf(a))!;
  assert.deepEqual([p.x_handle, p.slug], [null, `twa${T}`]);
  assert.deepEqual(await slugOwner(xSlug), { builderId: a, redirect: `twa${T}` }, 'the old X slug stays theirs');
  const [ev] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'x_cleared' AND installation_id = ${a} AND detail->>'by' = 'owner'`;
  assert.equal(ev.n, 1);
  assert.deepEqual(await xHandleConflicts([a, b]), []);
  const r = await setXHandle(b, 'yes');
  assert.ok(r.ok);
  assert.equal(r.slug, `twin${T % 100000}-2`, 'never the X slug A\'s history keeps');
});

test('7.16 with no login, the first remembered wallet (earliest) names the person', dbTest, async () => {
  const [row] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v212-t7-wallet-${T}-${Date.now()}`}) RETURNING id`;
  const [early, late] = [runWallet('aaaa'), runWallet('bbbb')];
  await sql()`INSERT INTO installation_wallets (installation_id, wallet, first_seen_at) VALUES
    (${row.id}, ${late}, now()), (${row.id}, ${early}, now() - interval '1 day')`;
  await shownProfile(row.id, new Date());
  await setFallback(row.id, { wallet: late });
  const p = (await profileOf(row.id))!;
  assert.deepEqual([p.slug, p.fallback_handle], [walletSlug(early), `${early.slice(0, 6)}…${early.slice(-4)}`]);
  await sql()`DELETE FROM builder_profiles WHERE builder_id = ${row.id}`;
  await sql()`DELETE FROM profile_slug_history WHERE builder_id = ${row.id}`;
});

test('7.17 merge: a prefill goes only with the login it came from', dbTest, async () => {
  const [root, other] = [T + 17, T + 18];
  await fresh(root, other);
  await shownProfile(root, new Date());
  await setFallback(root, { github_login: `pr${T}` });
  await shownProfile(other, new Date());
  await sql()`UPDATE builder_profiles SET twitter_prefill = 'stray' WHERE builder_id = ${other}`;
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const p = (await profileOf(root))!;
  assert.deepEqual([p.github_login, p.twitter_prefill], [`pr${T}`, null]);
});

test('7.18 the consent line: once, marked as the reply goes out', dbTest, async () => {
  await fresh(T + 19);
  const { profile } = (await ensureProfile(T + 19, new Date()))!;
  assert.equal(await slugOwner(profile.slug), null, 'final review I4: not public before the consent line');
  assert.equal(await consentOnce(T + 19), CONSENT_LINE(profile.slug));
  assert.deepEqual(await slugOwner(profile.slug), { builderId: T + 19, redirect: null });
  assert.equal(await consentOnce(T + 19), null);
});

test('7.14 a new random slug is never someone else\'s old slug (it would take over their redirect)', dbTest, async () => {
  const [old, next] = [T + 15, T + 16];
  await fresh(old, next);
  const pick = 'abcdefghijkmnpqrstuvwxyz23456789';
  // Slugs only this run makes: two letters from T, then fixed tails.
  const head = `${pick[T % 32]}${pick[Math.floor(T / 32) % 32]}${pick[Math.floor(T / 1024) % 32]}`;
  const taken = `${head}aaaaa`;
  const free = `${head}zzzzz`;
  await sql()`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${`b-${taken}`}, ${old})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, consent_shown_at) VALUES (${old}, ${`now${old}`}, now())`;
  const seq = [...taken, ...taken, ...free];
  let i = 0;
  const made = (await shownProfile(next, new Date(), { rand: () => pick.indexOf(seq[i++]) }))!;
  assert.equal(made.profile.slug, `b-${free}`);
  assert.deepEqual(await slugOwner(`b-${taken}`), { builderId: old, redirect: `now${old}` });
});
