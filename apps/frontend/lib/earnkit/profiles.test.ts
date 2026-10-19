import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import {
  HIDDEN_LINE, SHOWN_LINE, clearXHandle, xHandleConflicts, ensureProfile, mergeProfiles, profileOf, randomSlug,
  resolveHandle, resolveSlug, setFallback, setHidden,
} from './profiles';

/**
 * v2.12.1 T12: the v2.12 slug rules (X, login, wallet), setXHandle and the consent line are gone. A
 * page is public only once claimed with X (x-install.ts bindX; here its effect is written directly: the
 * X user id, the handle and the slug).
 */
const shownProfile = ensureProfile;
const claim = (id: number, handle: string) =>
  sql()`UPDATE builder_profiles SET x_user_id = ${`x${id}`}, x_handle = ${handle}, slug = ${handle.toLowerCase()}, claimed_at = now() WHERE builder_id = ${id}`;

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
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
/** A wallet unique to this run: 0x<4 hex of T> ... <last4>. */
const runWallet = (last4: string, mid = '0') => `0x${(T % 65536).toString(16).padStart(4, '0')}${mid.repeat(32)}${last4}`;

test('7.1 (v2.12.1) a profile starts on a random internal slug; hide and show lines are plain', () => {
  assert.match(randomSlug(), /^b-[a-z2-9]{8}$/);
  assert.equal(HIDDEN_LINE, 'Your page is hidden. Say show my page to list it again.');
  assert.equal(SHOWN_LINE('Lee_Builds'), 'Your page is public again: earnkit.com/Lee_Builds');
  assert.equal(SHOWN_LINE('terms'), 'Your page is public again: earnkit.com/b/terms', 'a reserved handle lives under /b/');
  assert.equal(SHOWN_LINE(null), 'Your page is no longer hidden.');
});

test('7.3 (v2.12.1 T12) the slug no longer follows a proven login or a wallet; one login is still one person', dbTest, async () => {
  const [b, c] = [T, T + 1];
  await fresh(b, c);
  const first = (await shownProfile(b, new Date()))!.profile.slug;
  await setFallback(b, { wallet: runWallet('1234') });
  await setFallback(b, { github_login: `bob${T}` });
  const p = (await profileOf(b))!;
  assert.deepEqual([p.slug, p.github_login], [first, `bob${T}`], 'the slug is an internal key');
  const [h] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM profile_slug_history WHERE builder_id = ${b}`;
  assert.equal(h.n, 0, 'no history row: nothing moved');
  assert.equal(await resolveSlug(`bob${T}`), null, 'a login is never a public address');
  await shownProfile(c, new Date());
  await setFallback(c, { github_login: `BOB${T}` });
  assert.equal((await profileOf(c))!.github_login, null, "C can't take B's login");
});

test('7.5 hide and show: a hidden page does not resolve (404) but keeps its row; show brings it back', dbTest, async () => {
  await fresh(T + 4);
  await shownProfile(T + 4, new Date());
  assert.equal(await setHidden(T + 4, false), 'Your page is no longer hidden.', 'unclaimed: no page to name');
  const handle = `Hd${T % 100000}`;
  await claim(T + 4, handle);
  assert.equal(await setHidden(T + 4, true), HIDDEN_LINE);
  assert.equal(await resolveHandle(handle), null);
  assert.equal(await resolveSlug(handle.toLowerCase()), null);
  assert.ok(await profileOf(T + 4), 'the row stays');
  assert.equal(await setHidden(T + 4, false), `Your page is public again: earnkit.com/${handle}`);
  assert.deepEqual(await resolveHandle(handle), { builderId: T + 4, handle });
});

test('7.6 linking merges profiles: one profile, sources moved once, the other slug moves to the root\'s page once claimed', dbTest, async () => {
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
  assert.equal(await resolveSlug(otherSlug), null, 'no public page before the claim');
  await claim(root, `Mg${T % 100000}`);
  assert.equal((await resolveSlug(otherSlug))?.builderId, root);
});

test('7.7 a shared group never gets a profile', dbTest, async () => {
  const [row] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${`v212-shared-${T}-${Date.now()}`}, true) RETURNING id`;
  assert.equal(await shownProfile(row.id, new Date()), null);
  assert.equal(await profileOf(row.id), null);
});

test('7.9 merge, the other has a login and a v2.12 X handle: the root keeps its page and takes both; hidden stays hidden; the other\'s rank goes', dbTest, async () => {
  const [root, other] = [T + 7, T + 8];
  await fresh(root, other);
  const rootSlug = (await shownProfile(root, new Date()))!.profile.slug;
  await shownProfile(other, new Date());
  await setFallback(other, { github_login: `mx${T}` });
  await sql()`UPDATE builder_profiles SET x_handle = ${`Mx${T % 1000}`} WHERE builder_id = ${other}`; // written by v2.12's setXHandle
  await setHidden(root, true);
  await sql()`INSERT INTO builder_ranks (builder_id, score, percentile, computed_at) VALUES (${other}, 40, 50, now())`;
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const p = (await profileOf(root))!;
  assert.deepEqual([p.github_login, p.x_handle, p.slug, p.hidden], [`mx${T}`, `Mx${T % 1000}`, rootSlug, true], 'login and handle kept; hidden stays hidden');
  assert.equal(await profileOf(other), null);
  assert.equal(await resolveHandle(`Mx${T % 1000}`), null, 'a v2.12 handle is never a page without the claim');
  const [rank] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_ranks WHERE builder_id = ${other}`;
  assert.equal(rank.n, 0, 'the merged-away id stops counting');
  const [q] = await sql()<{ reason: string }[]>`SELECT reason FROM discovery_queue WHERE builder_id = ${root}`;
  assert.equal(q?.reason, 'signin', 'rediscovered with both groups\' clues');
});

test('7.10 merge, the root wins: the other\'s login moves to it (no unique clash); the slug stays the root\'s', dbTest, async () => {
  const [root, other] = [T + 9, T + 10];
  await fresh(root, other);
  const rootSlug = (await shownProfile(root, new Date()))!.profile.slug;
  await shownProfile(other, new Date());
  await setFallback(other, { github_login: `ml${T}` });
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const p = (await profileOf(root))!;
  assert.deepEqual([p.github_login, p.fallback_handle, p.slug], [`ml${T}`, `ml${T}`, rootSlug]);
  const [q] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM discovery_queue WHERE builder_id = ${root}`;
  assert.equal(q.n, 1, 'the merged person is queued for discovery');
});

test('7.11 merge with no profile on either side writes nothing', dbTest, async () => {
  const [root, other] = [T + 11, T + 12];
  await fresh(root, other);
  await sql().begin((tx) => mergeProfiles(tx, root, other));
  const [q] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM discovery_queue WHERE builder_id IN (${root}, ${other})`;
  assert.equal(q.n, 0);
  assert.equal(await profileOf(root), null);
});

test('7.13 (v2.12.1: no new writes) the owner still sees a v2.12 X handle conflict while the holder shows the handle', dbTest, async () => {
  const [a, b] = [T + 13, T + 14];
  await fresh(a, b);
  const handle = `twin${T % 100000}`;
  await shownProfile(a, new Date());
  await shownProfile(b, new Date());
  await sql()`UPDATE builder_profiles SET x_handle = ${handle} WHERE builder_id = ${a}`;
  await sql()`INSERT INTO x_handle_conflicts (handle, holder, claimant) VALUES (${handle}, ${a}, ${b})`;
  assert.deepEqual((await xHandleConflicts([a, b])).map((c) => c.line), [`x_handle conflict: @${handle} (builder ids ${a}, ${b})`]);
});

test('7.15 the owner clears a handle, claimed or not; GitHub never clears a claimed one; an event; the conflict closes; the page is gone', dbTest, async () => {
  const [a, b] = [T + 13, T + 14]; // from 7.13
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    assert.equal(await clearXHandle(a, 'owner'), true);
    assert.equal(await clearXHandle(a, 'owner'), false, 'nothing left to clear');
  } finally {
    delete process.env.EARNKIT_EVENT_LOG;
  }
  assert.equal((await profileOf(a))!.x_handle, null);
  const [ev] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'x_cleared' AND installation_id = ${a} AND detail->>'by' = 'owner'`;
  assert.equal(ev.n, 1);
  assert.deepEqual(await xHandleConflicts([a, b]), []);
  const handle = `Cl${T % 100000}`;
  await claim(b, handle);
  assert.equal(await clearXHandle(b, 'github'), false, 'a claimed handle is never GitHub\'s to clear');
  assert.equal(await clearXHandle(b, 'owner'), true);
  assert.equal(await resolveHandle(handle), null);
  assert.equal(await resolveSlug(handle.toLowerCase()), null);
});

test('7.16 with no login, the first remembered wallet (earliest) is the fallback name; the slug stays', dbTest, async () => {
  const [row] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v212-t7-wallet-${T}-${Date.now()}`}) RETURNING id`;
  const [early, late] = [runWallet('aaaa'), runWallet('bbbb')];
  await sql()`INSERT INTO installation_wallets (installation_id, wallet, first_seen_at) VALUES
    (${row.id}, ${late}, now()), (${row.id}, ${early}, now() - interval '1 day')`;
  const slug = (await shownProfile(row.id, new Date()))!.profile.slug;
  await setFallback(row.id, { wallet: late });
  const p = (await profileOf(row.id))!;
  assert.deepEqual([p.slug, p.fallback_handle], [slug, `${early.slice(0, 6)}…${early.slice(-4)}`]);
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

test('7.14 a new random slug is never someone else\'s old slug (it would take over their redirect)', dbTest, async () => {
  const [old, next] = [T + 15, T + 16];
  await fresh(old, next);
  const pick = 'abcdefghijkmnpqrstuvwxyz23456789';
  // Slugs only this run makes: two letters from T, then fixed tails.
  const head = `${pick[T % 32]}${pick[Math.floor(T / 32) % 32]}${pick[Math.floor(T / 1024) % 32]}`;
  const taken = `${head}aaaaa`;
  const free = `${head}zzzzz`;
  await sql()`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${`b-${taken}`}, ${old})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle) VALUES (${old}, ${`now${old}`}, ${`x${old}`}, ${`Now${old % 100000}`})`;
  const seq = [...taken, ...taken, ...free];
  let i = 0;
  const made = (await shownProfile(next, new Date(), { rand: () => pick.indexOf(seq[i++]) }))!;
  assert.equal(made.profile.slug, `b-${free}`);
  assert.deepEqual(await resolveSlug(`b-${taken}`), { builderId: old, redirect: `now${old}`, handle: `Now${old % 100000}` });
});
