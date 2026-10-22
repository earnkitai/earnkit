import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/**
 * v3.1 one-tap posts, Task 4 (design 3): earnkit.com/<handle>/post/<code> (and /b/<handle>/post/<code>) counts the tap
 * and 302s to X's composer with the draft's text and the page link carrying ?m=<code>. The target is built from the
 * row only; run as Next runs it (every import is dynamic, after AsyncLocalStorage is set).
 */
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
const load = async () => ({
  ...(await import('./db')),
  ...(await import('./post-drafts')),
  post: (await import('../../app/[handle]/post/[code]/route')).GET,
  bPost: (await import('../../app/b/[slug]/post/[code]/route')).GET,
});
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await (await load()).sql().end();
});

/** A claimed person (handle `Pt<id>`) and one draft of theirs. */
async function withDraft(text = 'Recipes, week 6: added offline mode & fixed #3 at 100% (sync).', o: { handle?: string } = {}) {
  const { sql, createDraft } = await load();
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`pr-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const handle = o.handle ?? `Pt${id}`.slice(0, 15);
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle) VALUES (${id}, ${`pr-${id}`}, ${`prx${id}`}, ${handle})`;
  const d = await createDraft({ builderId: id, projectKey: 'k', moment: 'weekly', momentKey: `weekly:k:${id}`, shape: 'name_week', text, asked: false });
  assert.ok(d.ok);
  return { id, handle, code: d.draft.code };
}
const get = async (handle: string, code: string, query = '') =>
  (await load()).post(new Request(`http://x/${handle}/post/${code}${query}`), { params: Promise.resolve({ handle, code }) });

test('the tap: a 302 to X\'s composer with the draft\'s exact text and the page link with ?m=<code>, never a target from the request', dbTest, async () => {
  const { draftByCode } = await load();
  const text = 'Recipes, week 6: added offline mode & fixed #3 at 100% (sync).\nThen "search" + tags?';
  const { handle, code } = await withDraft(text);
  const res = await get(handle, code, '?next=https://evil.example&text=hacked&url=https://evil.example');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const location = res.headers.get('location')!;
  const u = new URL(location);
  assert.equal(u.origin + u.pathname, 'https://x.com/intent/post');
  assert.equal(u.searchParams.get('text'), text, 'every character comes back exactly (encoded on the way)');
  assert.equal(u.searchParams.get('url'), `https://earnkit.com/${handle}?m=${code}`);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['text', 'url']);
  assert.doesNotMatch(location, /evil|hacked/);
  assert.doesNotMatch(location, /[\s"]/, 'nothing raw in the header');
  assert.equal((await draftByCode(code))!.taps, 1);
  await get(handle, code);
  assert.equal((await draftByCode(code))!.taps, 2);
});

test('expired (14 days): a 302 to the page; the tap is not counted', dbTest, async () => {
  const { sql, draftByCode } = await load();
  const { handle, code } = await withDraft();
  await sql()`UPDATE post_drafts SET expires_at = now() - interval '1 minute' WHERE code = ${code}`;
  const res = await get(handle, code);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `/${handle}`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await draftByCode(code))!.taps, 0);
});

test('a hidden or unclaimed page, an unknown or malformed code, another builder\'s code: a no-store 404, nothing counted', dbTest, async () => {
  const { sql, draftByCode } = await load();
  const a = await withDraft();
  const b = await withDraft();
  for (const [h, c] of [[a.handle, b.code], [a.handle, 'zzzzzzzzzz'], [a.handle, 'NOT-A-CODE'], [a.handle, '..%2F..%2Fx'], ['nobody_here_x', a.code]]) {
    const res = await get(h, c);
    assert.deepEqual([res.status, res.headers.get('cache-control')], [404, 'no-store'], `${h} ${c}`);
  }
  assert.equal((await draftByCode(b.code))!.taps, 0, 'another builder\'s code is never counted');
  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${a.id}`;
  assert.equal((await get(a.handle, a.code)).status, 404);
  await sql()`UPDATE builder_profiles SET hidden = false, x_user_id = NULL WHERE builder_id = ${a.id}`;
  assert.equal((await get(a.handle, a.code)).status, 404);
  assert.equal((await draftByCode(a.code))!.taps, 0);
});

test('a renamed handle or another case: a 308 to the page\'s own post link (nothing counted there)', dbTest, async () => {
  const { sql, draftByCode } = await load();
  const { id, handle, code } = await withDraft();
  const lower = await get(handle.toLowerCase(), code);
  assert.deepEqual([lower.status, lower.headers.get('location')], [308, `/${handle}/post/${code}`]);
  const old = `old${id}`.slice(0, 15).toLowerCase();
  await sql()`INSERT INTO profile_slug_history (old_slug, builder_id, handle_rename, moved_at) VALUES (${old}, ${id}, true, now())`;
  const moved = await get(old, code);
  assert.deepEqual([moved.status, moved.headers.get('location'), moved.headers.get('cache-control')], [308, `/${handle}/post/${code}`, 'no-store']);
  assert.equal((await draftByCode(code))!.taps, 0);
});

test('the cap: past TAP_CAP taps the count stays and the tap still opens X', dbTest, async () => {
  const { sql, draftByCode, TAP_CAP } = await load();
  const { handle, code } = await withDraft();
  await sql()`UPDATE post_drafts SET taps = ${TAP_CAP} WHERE code = ${code}`;
  const res = await get(handle, code);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location')!, /^https:\/\/x\.com\/intent\/post\?/);
  assert.equal((await draftByCode(code))!.taps, TAP_CAP);
});

test('a reserved handle: /b/<handle>/post/<code> taps; /<handle>/post/<code> moves there; a v2.12 slug moves to the handle\'s link', dbTest, async () => {
  const { sql, bPost, draftByCode } = await load();
  await sql()`UPDATE builder_profiles SET x_handle = NULL, x_user_id = NULL WHERE lower(x_handle) = 'mcp'`;
  const r = await withDraft('Added search.', { handle: 'mcp' });
  try {
    const bGet = (slug: string, code: string) => bPost(new Request(`http://x/b/${slug}/post/${code}`), { params: Promise.resolve({ slug, code }) });
    const ok = await bGet('mcp', r.code);
    assert.equal(ok.status, 302);
    assert.equal(new URL(ok.headers.get('location')!).searchParams.get('url'), `https://earnkit.com/b/mcp?m=${r.code}`);
    assert.equal((await draftByCode(r.code))!.taps, 1);
    const root = await get('mcp', r.code);
    assert.deepEqual([root.status, root.headers.get('location')], [308, `/b/mcp/post/${r.code}`]);
    // A v2.12 slug of a claimed person moves to their handle's post link; an unknown slug or a bad code is a 404.
    const p = await withDraft();
    const slugMove = await bGet(`pr-${p.id}`, p.code);
    assert.deepEqual([slugMove.status, slugMove.headers.get('location')], [308, `/${p.handle}/post/${p.code}`]);
    assert.equal((await bGet('no-such-slug-here', p.code)).status, 404);
    assert.equal((await bGet(`pr-${p.id}`, 'bad"code')).status, 404);
  } finally {
    await sql()`UPDATE builder_profiles SET x_handle = NULL, x_user_id = NULL WHERE builder_id = ${r.id}`;
  }
});
