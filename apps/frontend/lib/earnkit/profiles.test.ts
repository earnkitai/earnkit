import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import {
  CONSENT_LINE, X_NOT_LISTED_NOTE, baseSlug, ensureProfile, mergeProfiles, nextFreeSlug, profileOf, randomSlug,
  resolveSlug, setFallback, setHidden, setXHandle, shownName, walletSlug,
} from './profiles';

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
  await sql().end();
});
const fresh = async (...ids: number[]) => {
  await sql()`DELETE FROM builder_profiles WHERE builder_id IN ${sql()(ids)}`;
  await sql()`DELETE FROM profile_slug_history WHERE builder_id IN ${sql()(ids)}`;
  await sql()`DELETE FROM discovery_queue WHERE builder_id IN ${sql()(ids)}`;
  await sql()`DELETE FROM builder_ranks WHERE builder_id IN ${sql()(ids)}`;
};
/** A wallet whose short slug is unique to this run: 0x<4 hex of T> ... <last4>. */
const runWallet = (last4: string) => `0x${(T % 65536).toString(16).padStart(4, '0')}${'0'.repeat(32)}${last4}`;

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
  await ensureProfile(b, new Date());
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
  assert.deepEqual(await resolveSlug(first), { builderId: b, redirect: now });
  assert.deepEqual(await resolveSlug(`bob${T}`), { builderId: b, redirect: now });
  // C's own wallet has the same short slug as B's old one: C gets the next free one.
  await ensureProfile(c, new Date());
  await setFallback(c, { wallet: runWallet('1234').replace(/0{32}/, '1'.repeat(32)) });
  assert.equal((await profileOf(c))!.slug, `${first}-2`);
  // One login, one person: C can't take B's login.
  await setFallback(c, { github_login: `BOB${T}` });
  assert.deepEqual([(await profileOf(c))!.github_login, (await profileOf(c))!.slug], [null, `${first}-2`]);
});

test('7.4 a typed handle that isn\'t on the proven GitHub profile is refused: nothing changes, no event', dbTest, async () => {
  await fresh(T + 2);
  await ensureProfile(T + 2, new Date());
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
  await ensureProfile(noLogin, new Date());
  assert.equal((await setXHandle(noLogin, 'yes')).ok, false, 'no proven login: no prefill to accept');
});

test('7.5 hide and show: a hidden profile does not resolve (404) but keeps its row; show brings it back', dbTest, async () => {
  await fresh(T + 4);
  const { profile } = (await ensureProfile(T + 4, new Date()))!;
  assert.equal(await setHidden(T + 4, true), 'Your profile is hidden. Say show to list it again.');
  assert.equal(await resolveSlug(profile.slug), null);
  assert.ok(await profileOf(T + 4), 'the row stays');
  assert.equal(await setHidden(T + 4, false), `Your profile is public again: earnkit.com/b/${profile.slug}`);
  assert.deepEqual(await resolveSlug(profile.slug), { builderId: T + 4, redirect: null });
});

test('7.6 linking merges profiles: one profile, sources moved once, the other slug redirects to the root', dbTest, async () => {
  const [root, other] = [T + 5, T + 6];
  await fresh(root, other);
  await sql()`DELETE FROM builder_sources WHERE builder_id IN (${root}, ${other})`;
  await ensureProfile(root, new Date());
  const otherSlug = (await ensureProfile(other, new Date()))!.profile.slug;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES
    (${root}, 'repo', 'lee/a', 'lee/a', 'agent'), (${other}, 'repo', 'lee/a', 'lee/a', 'agent'), (${other}, 'repo', 'lee/b', 'lee/b', 'agent')`;
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const live = await sql()<{ builder_id: number; ref: string; state: string }[]>`
    SELECT builder_id, ref, state FROM builder_sources WHERE builder_id IN (${root}, ${other}) ORDER BY ref, builder_id`;
  assert.deepEqual(live.filter((s) => s.state !== 'rejected').map((s) => `${s.builder_id}:${s.ref}`), [`${root}:lee/a`, `${root}:lee/b`]);
  assert.equal(await profileOf(other), null);
  assert.equal((await resolveSlug(otherSlug))?.builderId, root);
});

test('7.7 a shared group never gets a profile', dbTest, async () => {
  const [row] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${`v212-shared-${T}-${Date.now()}`}, true) RETURNING id`;
  assert.equal(await ensureProfile(row.id, new Date()), null);
  assert.equal(await profileOf(row.id), null);
});

test('7.9 merge, the other has the X handle: it wins, takes the root id, keeps login and handle; the root slug redirects; its rank goes', dbTest, async () => {
  const [root, other] = [T + 7, T + 8];
  await fresh(root, other);
  const rootSlug = (await ensureProfile(root, new Date()))!.profile.slug;
  await ensureProfile(other, new Date());
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
  assert.deepEqual(await resolveSlug(rootSlug), { builderId: root, redirect: `mx${T % 1000}` });
  assert.deepEqual(await resolveSlug(`mx${T}`), { builderId: root, redirect: `mx${T % 1000}` }, 'the moved history follows');
  const [rank] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_ranks WHERE builder_id = ${other}`;
  assert.equal(rank.n, 0, 'the merged-away id stops counting');
  const [q] = await sql()<{ reason: string }[]>`SELECT reason FROM discovery_queue WHERE builder_id = ${root}`;
  assert.equal(q?.reason, 'signin', 'rediscovered with both groups\' clues');
});

test('7.10 merge, the root wins: the other\'s login moves to it (no unique clash) and its slug follows the login', dbTest, async () => {
  const [root, other] = [T + 9, T + 10];
  await fresh(root, other);
  const rootSlug = (await ensureProfile(root, new Date()))!.profile.slug;
  await ensureProfile(other, new Date());
  await setFallback(other, { github_login: `ml${T}` });
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const p = (await profileOf(root))!;
  assert.deepEqual([p.github_login, p.fallback_handle, p.slug], [`ml${T}`, `ml${T}`, `ml${T}`]);
  assert.deepEqual(await resolveSlug(rootSlug), { builderId: root, redirect: `ml${T}` });
  assert.deepEqual(await resolveSlug(`ml${T}`), { builderId: root, redirect: null });
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
