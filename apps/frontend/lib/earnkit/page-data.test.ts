import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProfileView from '../../app/[handle]/ProfileView';
import ProjectCards from '../../app/[handle]/ProjectCards';
import { sql } from './db';
import {
  NONE_CONFIRMED, NOT_CONFIRMED, NOT_TRACKED, SOURCES_LINE, avatarUrl, cardHeadline, pageCards, pageHead, peopleLine, shareIntent, topLine,
  type PageCard, type PageHead,
} from './page-data';

/** v2.12.1 T11: the page's words and data (page-data.ts) and its pure views. */

process.env.EARNKIT_BUILDER_SCORE = 'on';
(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

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

const HEAD: PageHead = { handle: 'lee', name: 'Lee', avatar: null, topLine: 'Lee has shipped 3 apps with AI.', rank: null, peopleLine: null, score: null };

test('11.0 the words: top line, people line, one place for every public sentence', () => {
  assert.equal(topLine('Lee', 3, 'apps'), 'Lee has shipped 3 apps with AI.');
  assert.equal(peopleLine(0), null);
  assert.equal(peopleLine(1), '1 of them has people using it.');
  assert.equal(peopleLine(2), '2 of them have people using them.');
  assert.equal(NOT_CONFIRMED, 'Not yet confirmed');
  assert.equal(NOT_TRACKED, 'Not tracked right now');
  assert.match(SOURCES_LINE, /^Numbers come from public data EarnKit can check/);
  // Only X's own image host, over https, at the larger size; anything else draws the letter.
  assert.equal(avatarUrl('https://pbs.twimg.com/profile_images/1/a_normal.jpg'), 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg');
  for (const bad of [null, '', 'http://pbs.twimg.com/a.jpg', 'https://evil.example/a.jpg', 'javascript:alert(1)', 'https://pbs.twimg.com.evil.com/a.jpg'])
    assert.equal(avatarUrl(bad), null, String(bad));
  const u = new URL(shareIntent('lee', 'Shipped 3 apps with AI'));
  assert.equal(u.origin + u.pathname, 'https://x.com/intent/post');
  assert.equal(u.searchParams.get('text'), 'Shipped 3 apps with AI on EarnKit.');
  assert.equal(u.searchParams.get('url'), 'https://earnkit.com/lee');
  assert.equal(new URL(shareIntent('terms', 'x')).searchParams.get('url'), 'https://earnkit.com/b/terms');
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

test('11.2 project cards: most used first then newest; not yet confirmed and not tracked marked quietly', dbTest, async () => {
  // The traction seed: tokens.fun (140 people) and TipJar (a few people) confirmed; Recipes (newer) and Budget agent-only, no people.
  const cards = await pageCards((await seededTraction()).id);
  assert.deepEqual(cards.map((c) => [c.name, c.confirmed]).filter(([n]) => n !== 'tokens.fun').slice(0, 3), [['TipJar', true], ['Recipes', false], ['Budget', false]]);
  assert.equal(cards[0].name, 'tokens.fun');
  assert.equal(cards[0].people, 140);
  assert.equal(cards[0].money, '$1.2k');
  assert.equal(cards[0].what, 'Launch a coin in one tap');
  const html = renderToStaticMarkup(React.createElement(ProjectCards, { cards }));
  assert.match(html, />Not yet confirmed</);
  assert.equal((html.match(/>Not yet confirmed</g) ?? []).length, cards.filter((c) => !c.confirmed).length);
  assert.doesNotMatch(html, /uppercase|tracking-\[|0\/100/);
  assert.ok(!text(html).includes(NONE_CONFIRMED), 'mixed: the label on each unconfirmed card');
  // T11 fix round 1: every card not yet confirmed (the target user): one quiet line, no label on each.
  const all = await pageCards(await seededTargetUser());
  const allHtml = renderToStaticMarkup(React.createElement(ProjectCards, { cards: all }));
  assert.equal(all.length, 3);
  assert.doesNotMatch(allHtml, />Not yet confirmed</);
  assert.equal(text(allHtml).split(NONE_CONFIRMED.replace(/'/g, "'")).length - 1, 1);
});

test('11.2b cards: no people or money while a rescore is held; a private repo is never named; untracked go last', dbTest, async () => {
  const id = newId();
  await person(id, { held: true });
  await live(id, 30, { pending: true, people: 1 });
  await project(id, { key: `lee${id}/secret-plan`, name: 'secret-plan', what: 'From the private description', link: null, confirmed: true, people: 50, money: 300, daysAgo: 1 });
  await project(id, { key: `https://old-${id}.example.com`, name: 'Old site', confirmed: false, tracked: false, daysAgo: 0 });
  const cards = await pageCards(id);
  assert.equal(cards.length, 2);
  assert.deepEqual([cards[0].people, cards[0].money], [null, null], 'held: the numbers wait for the review');
  assert.equal(cards[0].name, 'Private project');
  assert.equal(cards[0].what, null);
  assert.doesNotMatch(JSON.stringify(cards), /secret-plan|private description/);
  assert.deepEqual([cards[1].name, cards[1].tracked], ['Old site', false]);
  // A hidden repo's GitHub page or Pages site would name it: no link.
  await sql()`UPDATE builder_projects SET link = ${`https://lee${id}.github.io/secret-plan`} WHERE builder_id = ${id} AND project_key = ${`lee${id}/secret-plan`}`;
  assert.equal((await pageCards(id))[0].link, null);
  // A repo read public in the last week is named.
  const sid = await sql()<{ id: string }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'repo', ${`lee${id}/secret-plan`}, ${`lee${id}/secret-plan`}, 'verified', 'repo_owner', 'server') RETURNING id`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${sid[0].id}, '{"private": false}'::jsonb, true, now())`;
  assert.equal((await pageCards(id))[0].name, 'secret-plan');
  assert.equal((await pageCards(id))[0].link, `https://lee${id}.github.io/secret-plan`, 'public again: the link too');
  await sql()`UPDATE source_live SET ok = false, read_at = now() WHERE source_id = ${sid[0].id}`;
  assert.equal((await pageCards(id))[0].name, 'Private project', 'a failed newest read: unnamed at once');
  await sql()`DELETE FROM source_live WHERE source_id = ${sid[0].id}`;
});

test('11.2c cards: programs entered and won, coin entries left out', dbTest, async () => {
  const id = newId();
  await person(id);
  await project(id, { key: `lee${id}/tipjar`, name: 'TipJar', confirmed: true, people: 3, daysAgo: 1 });
  const tag = `t11-${id}`;
  await sql()`INSERT INTO installations (id, token_hash, builder_id) VALUES (${id}, ${tag}, ${id})`;
  const prog = (pid: string, title: string, status = 'active') => sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${pid}, 'o', ${title}, 'd', 'https://x', 'https://x', 'r', 's', ${status}, 'allowed') ON CONFLICT (id) DO NOTHING`;
  await prog(`${tag}-a`, 'Tip Grants');
  await prog(`${tag}-b`, 'Small Apps Cup');
  try {
    const entry = async (program: string, won: boolean) => {
      const [p] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id, repo_url, repo_key)
        VALUES (${program}, 'TipJar', ${id}, ${`https://github.com/lee${id}/tipjar`}, ${`lee${id}/tipjar`}) RETURNING id`;
      if (won) await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis) VALUES (${p.id}, ${program}, 'r1', 'won', 'announcement')`;
    };
    await entry(`${tag}-a`, true);
    await entry(`${tag}-b`, false);
    await entry('earnkit-coin', false);
    const [card] = await pageCards(id);
    assert.deepEqual(card.programs, [{ title: 'Tip Grants', won: true }, { title: 'Small Apps Cup', won: false }]);
    const t = text(html(React.createElement(ProjectCards, { cards: [card] })));
    assert.match(t, /Won Tip Grants/);
    assert.match(t, /Entered Small Apps Cup/);
  } finally {
    await sql()`DELETE FROM projects WHERE installation_id = ${id}`;
    await sql()`DELETE FROM programs WHERE id IN ${sql()([`${tag}-a`, `${tag}-b`])}`;
    await sql()`DELETE FROM installations WHERE id = ${id}`;
  }
});

test('11.3 the page renders the header at once and skeletons while the cards load', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileView, { head: HEAD, cards: null }));
  assert.match(html, /Lee has shipped 3 apps with AI\./);
  assert.match(html, /data-skeleton="card"/);
  assert.equal((html.match(/data-skeleton="card"/g) ?? []).length, 3);
  assert.match(html, /motion-reduce:animate-none/);
  // No ring and no rank without a rank that reads well; one h1; the quiet sources line.
  assert.doesNotMatch(html.split('<footer')[0], /role="img"|of 100/);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.ok(text(html).includes(SOURCES_LINE));
});

const CARDS: PageCard[] = [
  { key: 'a', name: 'tokens.fun', what: 'Launch a coin in one tap', link: 'https://tokens.fun/', people: 140, money: '$1.2k', programs: [{ title: 'Arc Microgrants', won: true }], confirmed: true, tracked: true },
  { key: 'b', name: 'Recipes', what: null, link: null, people: null, money: null, programs: [], confirmed: false, tracked: true },
];

test('11.3b the full page: ring and rank beside each other, people line, cards; sentence case, no jargon, no badges', () => {
  const head: PageHead = { ...HEAD, rank: '#3 of 40 builders on EarnKit', peopleLine: '2 of them have people using them.', score: 41 };
  const h = renderToStaticMarkup(React.createElement(ProfileView, { head, cards: CARDS }));
  const t = text(h.split('<footer')[0]);
  assert.match(h, /role="img" aria-label="Score 41 of 100"/);
  assert.match(t, /#3 of 40 builders on EarnKit/);
  assert.match(t, /2 of them have people using them\./);
  assert.match(t, /140 people use it/);
  assert.match(t, /\$1\.2k earned/);
  assert.match(t, /tokens\.fun/);
  assert.match(h, /href="https:\/\/tokens\.fun\/"[^>]*rel="noopener noreferrer/);
  assert.doesNotMatch(h.split('<footer')[0], /uppercase|tracking-\[0\.|—|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(t, /\boutcomes?\b|percentile|\brepos?\b|\bcommits?\b|onchain|\bcontracts?\b|verified/i);
  // A claimed page with nothing yet: a plain line, never an empty grid.
  const empty = text(renderToStaticMarkup(React.createElement(ProfileView, { head: { ...HEAD, topLine: 'Lee is building with AI.' }, cards: [] })));
  assert.match(empty, /Lee is building with AI\./);
  assert.match(empty, /Projects show here once they are live\./);
});

test('11.4 the card headline fits the moment', () => {
  assert.equal(cardHeadline({ moment: 'shipped', shipped: 3, noun: 'apps', best: null, rank: null }), 'Shipped 3 apps with AI');
  assert.equal(cardHeadline({ moment: 'people', shipped: 6, noun: 'projects', best: { name: 'tokens.fun', people: 140 }, rank: null }), '140 people use tokens.fun');
  assert.equal(cardHeadline({ moment: 'rank', shipped: 6, noun: 'projects', best: null, rank: '#3 of 40 builders on EarnKit' }), '#3 of 40 builders on EarnKit');
  assert.equal(cardHeadline({ moment: 'rank', shipped: 6, noun: 'projects', best: null, rank: null }), 'Shipped 6 projects with AI');
  assert.equal(cardHeadline({ moment: 'people', shipped: 1, noun: 'app', best: { name: 'TipJar', people: 1 }, rank: null }), '1 person uses TipJar');
  assert.equal(cardHeadline({ moment: null, shipped: 0, noun: 'projects', best: null, rank: null }), 'Building with AI');
});
