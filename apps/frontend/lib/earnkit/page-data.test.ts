import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import {
  avatarUrl, pageHead, peopleLine, shareIntentText, topLine,
} from './page-data';

/** v2.12.1 T11: the page's words and data (page-data.ts). */


const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// builder_live rows count in every rank: this run's people are fresh ids, removed after.
const BASE = 2_131_000_000 + Math.floor(Math.random() * 300_000) * 50;
let next = 0;
const made: number[] = [];
const newId = () => {
  const id = BASE + next++;
  made.push(id);
  return id;
};
after(async () => {
  if (!process.env.DATABASE_URL) return;
  for (const t of ['builder_projects', 'builder_live', 'builder_sources', 'builder_profiles']) await sql()`DELETE FROM ${sql()(t)} WHERE builder_id IN ${sql()(made.length ? made : [-1])}`;
  await sql().end();
});

const handleOf = (id: number) => `p${id}`.slice(0, 15);
async function person(id: number, o: { name?: string | null; claimed?: boolean; hidden?: boolean; held?: boolean; avatar?: string | null } = {}) {
  const claimed = o.claimed ?? true;
  await sql()`
    INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, x_name, x_avatar_url, hidden, held, consent_shown_at)
    VALUES (${id}, ${`s${id}`}, ${claimed ? `9${id}` : null}, ${claimed ? handleOf(id) : null}, ${o.name === undefined ? 'Lee' : o.name},
      ${o.avatar ?? null}, ${o.hidden ?? false}, ${o.held ?? false}, now())`;
}
const live = (id: number, score: number, o: { people?: number; shipped?: number; ranked?: boolean; pending?: boolean } = {}) =>
  sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, pending, computed_at)
    VALUES (${id}, ${score}, '{}'::jsonb, ${o.ranked ?? true}, ${o.shipped ?? 1}, ${o.people ?? 0}, 'v2', 'v2', ${o.pending ? sql().json({ score: 99 } as never) : null}, now())`;
type P = { key: string; name: string; what?: string | null; link?: string | null; kind?: string; confirmed: boolean; shipped?: boolean; tracked?: boolean; people?: number; money?: number; daysAgo: number };
const project = (id: number, p: P) =>
  sql()`INSERT INTO builder_projects (builder_id, project_key, name, what, link, kind, confirmed, shipped, tracked, people, money_usd, last_active_at)
    VALUES (${id}, ${p.key}, ${p.name}, ${p.what ?? null}, ${p.link ?? null}, ${p.kind ?? 'app'}, ${p.confirmed}, ${p.shipped ?? true}, ${p.tracked ?? true},
      ${p.people ?? 0}, ${p.money ?? 0}, ${new Date(Date.now() - p.daysAgo * 86_400_000)})`;

/** The target user (plan S1): three live apps the agent reported, none confirmed yet, so not ranked. */
async function seededTargetUser() {
  const id = newId();
  await person(id);
  await project(id, { key: `https://recipes-${id}.example.com`, name: 'Recipe planner', what: 'Plans meals from what is in the fridge', link: `https://recipes-${id}.example.com`, confirmed: false, daysAgo: 3 });
  await project(id, { key: `https://budget-${id}.example.com`, name: 'Budget buddy', what: 'Tracks spending in plain words', link: `https://budget-${id}.example.com`, confirmed: false, daysAgo: 20 });
  await project(id, { key: `https://tips-${id}.example.com`, name: 'Tip jar', link: `https://tips-${id}.example.com`, confirmed: false, daysAgo: 40 });
  return id;
}

/** Traction: #3 of its own 40 ranked people; tokens.fun (140 people) and TipJar confirmed, Recipes and Budget agent-only. */
async function seededTraction() {
  const ids = Array.from({ length: 40 }, () => newId());
  for (const [i, x] of ids.entries()) {
    await person(x, { name: `Filler ${i}` });
    await live(x, 90 - i * 2);
  }
  const id = ids[2];
  await sql()`UPDATE builder_profiles SET x_name = 'Lee' WHERE builder_id = ${id}`;
  await sql()`UPDATE builder_live SET people = 2, shipped = 2 WHERE builder_id = ${id}`;
  await project(id, { key: 'https://tokens.fun', name: 'tokens.fun', what: 'Launch a coin in one tap', link: 'https://tokens.fun', confirmed: true, people: 140, money: 1234, daysAgo: 30 });
  await project(id, { key: 'https://tipjar.example.com', name: 'TipJar', link: 'https://tipjar.example.com', confirmed: true, people: 4, daysAgo: 60 });
  await project(id, { key: 'https://recipes.example.com', name: 'Recipes', confirmed: false, daysAgo: 2 });
  await project(id, { key: 'https://budget.example.com', name: 'Budget', confirmed: false, daysAgo: 50 });
  return { id, ids };
}


test('11.0 the words: top line, people line, one place for every public sentence', () => {
  assert.equal(topLine('Lee', 3, 'apps'), 'Lee has shipped 3 apps with AI.');
  assert.equal(peopleLine(0), null);
  assert.equal(peopleLine(1), '1 of them has people using it.');
  assert.equal(peopleLine(2), '2 of them have people using them.');
  // Only X's own image host, over https, at the larger size; anything else draws the letter.
  assert.equal(avatarUrl('https://pbs.twimg.com/profile_images/1/a_normal.jpg'), 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg');
  for (const bad of [null, '', 'http://pbs.twimg.com/a.jpg', 'https://evil.example/a.jpg', 'javascript:alert(1)', 'https://pbs.twimg.com.evil.com/a.jpg'])
    assert.equal(avatarUrl(bad), null, String(bad));
  const u = new URL(shareIntentText('lee', 'Shipped 3 apps with AI on EarnKit.'));
  assert.equal(u.origin + u.pathname, 'https://x.com/intent/post');
  assert.equal(u.searchParams.get('text'), 'Shipped 3 apps with AI on EarnKit.');
  assert.equal(u.searchParams.get('url'), 'https://earnkit.com/lee');
  assert.equal(new URL(shareIntentText('terms', 'x')).searchParams.get('url'), 'https://earnkit.com/b/terms');
});

test('11.1 the top line is what they made; rank and ring only when the rank reads well', dbTest, async () => {
  // The target user before any confirmation (plan S1): 3 live apps, none confirmed yet, so not ranked.
  // A confirmed live app would be a confirmed ship and rank them, so the seed confirms none.
  const a = await seededTargetUser();
  const h = await pageHead(a);
  assert.equal(h.topLine, 'Lee has shipped 3 apps with AI.');
  assert.equal(h.rank, null);
  assert.equal(h.score, null);
  assert.equal(h.peopleLine, null);
  assert.equal(h.handle, handleOf(a));
  const b = await seededTraction(); // { id, ids }: ranked #3 of its own 40, 2 projects used
  const t = await pageHead(b.id, { only: b.ids }); // the shared DB ranks other files' people too
  assert.equal(t.rank, '#3 of 40 builders on EarnKit');
  assert.equal(t.peopleLine, '2 of them have people using them.');
  assert.ok(t.score !== null);
  assert.equal(t.topLine, 'Lee has shipped 4 apps with AI.');
  // Low in its list (#30 of 40): no rank line, no ring.
  const low = await pageHead(b.ids[29], { only: b.ids });
  assert.deepEqual([low.rank, low.score, low.peopleLine], [null, null, null]);
});

test('11.1b the name and the noun: X name, else @handle, never a wallet; nothing shipped reads as building', dbTest, async () => {
  const id = newId();
  await person(id, { name: '0x52908400098527886E0F7030069857D2E4169EE7' });
  assert.equal((await pageHead(id)).topLine, `@${handleOf(id)} is building with AI.`);
  await project(id, { key: 'k1', name: 'Kit', kind: 'package', confirmed: false, daysAgo: 1 });
  assert.equal((await pageHead(id)).topLine, `@${handleOf(id)} has shipped 1 project with AI.`);
  await project(id, { key: 'k2', name: 'Draft', confirmed: false, shipped: false, daysAgo: 1 });
  assert.equal((await pageHead(id)).topLine, `@${handleOf(id)} has shipped 1 project with AI.`, 'only shipped projects count');
  const one = newId();
  await person(one, { name: '  Ana  ' });
  await project(one, { key: 'a1', name: 'Ana app', confirmed: false, daysAgo: 1 });
  assert.equal((await pageHead(one)).topLine, 'Ana has shipped 1 app with AI.');
});
