import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as React from 'react';

/**
 * v2.12 T11 security fix: the card route itself, run as Next runs it (its own process: Next's
 * request storage needs a real AsyncLocalStorage before any next module loads, so every import
 * here is dynamic, after it is set).
 */
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
(globalThis as { React?: typeof React }).React = React; // the route's JSX under tsx
const load = async () => ({
  ...(await import('./db')),
  ...(await import('./share')),
  ...(await import('./profiles')),
  ...(await import('../../app/b/[slug]/card.png/route')),
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await (await load()).sql().end();
});

async function scored() {
  const { sql, ensureProfile } = await load();
  const id = 2_140_000_000 + Math.floor(Math.random() * 7_000_000);
  await ensureProfile(id, new Date());
  await sql()`UPDATE builder_profiles SET slug = ${`card${id}`} WHERE builder_id = ${id}`;
  const parts = { users: { points: 10, raw: { U: 40 } }, money: { points: 0, raw: {} }, staying: { points: 0, raw: {} }, recency: { points: 0, raw: {} }, consistency: { points: 0, raw: {} } };
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, '2026-10-12', 41, 78, ${sql().json(parts)}, '{}', 'v1', 'v1-launch', false)`;
  return id;
}

test('11.11 the card follows the profile at once: hidden is a 404 (no-store), an old slug moves on, never an immutable or long cache', dbTest, async () => {
  const { sql, CARD_CACHE, setHidden, GET } = await load();
  // A real (Map-backed) Next data cache that nothing expires here (profileChanged() has no request
  // context in tests): the cached read stays stale after a hide, as a missed revalidation would.
  const store = new Map<string, unknown>();
  const g = globalThis as { __incrementalCache?: unknown };
  g.__incrementalCache = {
    generateCacheKey: async (k: string) => k,
    get: async (k: string) => (store.has(k) ? { value: store.get(k), isStale: false } : null),
    set: async (k: string, v: unknown) => void store.set(k, v),
  };
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  const get = (slug: string) => GET(new Request(`http://x/b/${slug}/card.png`), { params: Promise.resolve({ slug }) });
  try {
    const id = await scored();
    const slug = `card${id}`;
    const ok = await get(slug);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.equal(ok.headers.get('cache-control'), CARD_CACHE);
    assert.doesNotMatch(CARD_CACHE, /immutable/);
    assert.ok(Number(/s-maxage=(\d+)/.exec(CARD_CACHE)![1]) <= 600 && /max-age=0\b/.test(CARD_CACHE));

    // Hidden (through setHidden, as "hide" does): a 404 on the very next request, never stored.
    await setHidden(id, true);
    const hidden = await get(slug);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.headers.get('cache-control'), 'no-store');
    await setHidden(id, false);
    assert.equal((await get(slug)).status, 200);

    // A new slug (an X handle set or cleared): the old one moves on at once, never the old card.
    await sql()`UPDATE builder_profiles SET slug = ${`cardn${id}`} WHERE builder_id = ${id}`;
    await sql()`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${slug}, ${id})`;
    const moved = await get(slug);
    assert.equal(moved.status, 308);
    assert.equal(moved.headers.get('location'), `/b/cardn${id}/card.png`);
    assert.equal(moved.headers.get('cache-control'), 'no-store');

    assert.ok(store.size > 0, 'the cached read was really cached');
    delete process.env.EARNKIT_BUILDER_SCORE;
    assert.equal((await get(`cardn${id}`)).status, 404, 'flag off');
  } finally {
    delete g.__incrementalCache;
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});
