import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { benchRows, benchCardFacts, parseBenchFilter, profileData } from './bench-data';
import { chainPools } from './bench-rank';
import { benchReply, confirmingLine, confirmingSlowLine, type BenchView as View } from './bench-reply';
import { carouselCards, feedWeeks, rankFeed } from './feed';
import { PROOF_NOTE, SIGN_IN_OWNER_NOTE, mainProjectOf, pickMainProject, proofFor, setMainProject } from './main-project';
import { RAISE_LINES, pillOf, raiseAsk, setRaising } from './raising';
import { coinLine, raiseLine } from './coin-moments';
import { UPDATE_LIMIT_NOTE, UPDATE_POSTS_PER_DAY, postUpdate } from './updates';
import { raisingEnabled } from './builder-score-flag';
import { TELL_DESCRIPTION_BENCH, TELL_DESCRIPTION_BENCH_NO_RAISING, toolDescriptions } from './mcp';
import BenchView, { FILTER_RAISING } from '../../app/bench/BenchView';
import BenchTop from '../../app/components/sections/BenchTop';
import { GET as llms } from '../../app/llms.txt/route';

/**
 * v2.13 final fix wave (final-review.md I1, I2, I3, M1, M2, M4, M7 and the EARNKIT_RAISING ruling).
 * Every row this file writes carries a per-run key and goes in `after`.
 */
process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
process.env.EARNKIT_AUTH_SECRET ||= 'v213-final-fix-secret';
(globalThis as { React?: typeof React }).React = React;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = randomBytes(3).toString('hex');
const NOW = new Date('2026-10-21T12:00:00Z'); // a Wednesday; the last finished week is 2026-10-12
const made: number[] = [];

after(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    if (made.length) {
      const db = sql();
      await db`DELETE FROM project_updates WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM projects WHERE installation_id IN ${db(made)}`;
      // source_readings is append-only: its rows stay (keyed by source id only).
      await db`DELETE FROM builder_sources WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM builder_projects WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM builder_live WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM proof_line_issues WHERE installation_id IN ${db(made)}`;
      await db`DELETE FROM github_verify_nonces WHERE installation_id IN ${db(made)}`;
      await db`DELETE FROM builder_profiles WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM installations WHERE id IN ${db(made)}`;
    }
  } finally {
    await sql().end();
  }
});

/** Runs `fn` with EARNKIT_RAISING on or off, then puts it back. */
async function withRaising<T>(on: boolean, fn: () => Promise<T> | T): Promise<T> {
  const saved = process.env.EARNKIT_RAISING;
  if (on) process.env.EARNKIT_RAISING = 'on';
  else delete process.env.EARNKIT_RAISING;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = saved;
  }
}

async function installation(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-fix-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  made.push(id);
  return id;
}

/**
 * One listed, ranked builder whose one project is the repo `key`, confirmed by its own proof line
 * (a verified repo source). `name` is the project's stored name; `public` adds today's public reading.
 */
async function listed(o: { name?: string; public?: boolean; chains?: string[]; raising?: boolean; update?: boolean; score?: number } = {}) {
  const id = await installation();
  const key = `fx${RUN}/repo${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v213fx-${id}`}, ${key}, ${`fxx${id}`}, ${`fx${RUN}${id}`}, 'Maya')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${o.score ?? 50}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-launch', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains) VALUES (${id}, ${key}, ${o.name ?? `repo${id}`}, 'app', true, true, ${o.chains ?? []})`;
  const [{ sid }] = await sql()<{ sid: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent') RETURNING id::int AS sid`;
  if (o.public) await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${new Date().toISOString().slice(0, 10)}, '{"private": false}'::jsonb, true)`;
  if (o.raising)
    await sql()`INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at)
      VALUES ('earnkit-coin', 'Recipe planner', ${`https://github.com/${key}`}, ${`github.com/${key}`}, ${id}, 'RECIPE', 'launched', ${`https://tokens.fun/c/${id}`}, now())`;
  if (o.update) await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, '2026-10-12', 'Went live.', '{"went_live": true}'::jsonb)`;
  return { id, key, sid };
}

// ---- I1: a private repo's name never reaches the Bench, the feed or the landing carousel ----------

test('F1 a private main repo shows the safe name on /bench, /feed and the carousel; a public one keeps its name', dbTest, async () => {
  const secret = await listed({ name: 'secret-plans', update: true, score: 60 });
  await sql()`UPDATE builder_projects SET name = ${secret.key.split('/')[1]} WHERE builder_id = ${secret.id}`;
  const open = await listed({ name: 'Open app', public: true, update: true, score: 40 });
  const only = [secret.id, open.id];
  const bench = await benchRows({ chain: null, raising: false, weekly: false }, { only });
  assert.deepEqual(bench.rows.map((r) => r.project), ['Private project', 'Open app']);
  await rankFeed(NOW);
  const feed = (await feedWeeks(NOW, { only })).flatMap((w) => w.cards);
  assert.deepEqual(feed.map((c) => c.project).sort(), ['Open app', 'Private project']);
  assert.ok(!JSON.stringify(feed).includes(secret.key.split('/')[1]), 'the repo name is nowhere in the feed');
  const carousel = await carouselCards(NOW, { only });
  assert.deepEqual(carousel.map((c) => c.project).sort(), ['Open app', 'Private project']);
  // The landing's top 10 is benchRows (landing.ts readBench): the same safe name.
  assert.ok(!JSON.stringify(bench.rows).includes(secret.key.split('/')[1]));
});

// ---- I2: the lazy pick takes only a Bench-confirmed project; the proof names its repo ------------

test('F2 the lazy pick: nothing Bench-confirmed leaves it unset; a confirmed row without the repo\'s own proof is never picked', dbTest, async () => {
  const id = await installation();
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v213fx-${id}`})`;
  const k = (s: string) => `pk${RUN}/${s}${id}`;
  // A coin or entry naming the repo: confirmed, but not the repo's own proof (benchConfirmedSql).
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${id}, ${k('named')}, 'n', 'app', true, true, 90)`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${id}, ${k('agent')}, 'a', 'app', false, true, 99)`;
  assert.equal(await pickMainProject(id, sql()), null);
  assert.equal(await mainProjectOf(id), null, 'left for the project the agent names next');
  // The agent names its folder's repo: that one is the one project.
  assert.deepEqual(await setMainProject(id, { name: 'Mine', what: null, repo: k('mine'), live_url: null, package: null, contracts: [] }), { key: k('mine'), set: true });

  const other = await installation();
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${other}, ${`v213fx-${other}`})`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${other}, ${k('busy')}, 'b', 'app', false, true, 500)`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${other}, ${k('proven')}, 'p', 'app', true, true, 3)`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${other}, 'repo', ${k('proven')}, ${k('proven')}, 'verified', 'proof_line', 'agent')`;
  assert.equal(await pickMainProject(other, sql()), k('proven'));
});

test('F3 the proof names the exact repo the line goes to, and the note tells the agent to use it', dbTest, async () => {
  const id = await installation();
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v213fx-${id}`})`;
  const key = `own${RUN}/app${id}`;
  await setMainProject(id, { name: 'App', what: null, repo: key, live_url: null, package: null, contracts: [] });
  const p = await proofFor(id, id, { canPush: true, now: new Date() });
  assert.ok(p && 'line' in p, JSON.stringify(p));
  assert.equal(p.repo, key);
  assert.equal(p.agent_note, PROOF_NOTE);
  assert.match(PROOF_NOTE, /proof\.repo/);
});

// ---- I3: a line that can't confirm the repo gets the sign-in link; no "a minute or two" forever ---

test('F4 an agent that can push gets the sign-in link when the owner is not the builder\'s login, an organization, or the hour passed', dbTest, async () => {
  const saved = { id: process.env.GITHUB_OAUTH_CLIENT_ID, secret: process.env.GITHUB_OAUTH_CLIENT_SECRET };
  process.env.GITHUB_OAUTH_CLIENT_ID = 'fake-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'fake-secret';
  try {
    const now = new Date();
    const at = async (owner: string, githubUser: string | null, o: { issuedAgo?: number; type?: 'User' | 'Organization' } = {}) => {
      const id = await installation();
      await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v213fx-${id}`})`;
      const key = `${owner}/app${id}`;
      await setMainProject(id, { name: 'App', what: null, repo: key, live_url: null, package: null, contracts: [] });
      await sql()`UPDATE installations SET github_user = ${githubUser} WHERE id = ${id}`;
      if (o.type)
        await sql()`INSERT INTO url_checks (key, ok, checked_at, note) VALUES (${`ghuser:${owner}`}, true, now(), ${JSON.stringify({ type: o.type, created_at: '2020-01-01T00:00:00Z', public_repos: 2 })})
          ON CONFLICT (key) DO UPDATE SET ok = EXCLUDED.ok, checked_at = EXCLUDED.checked_at, note = EXCLUDED.note`;
      if (o.issuedAgo !== undefined) await sql()`INSERT INTO proof_line_issues (installation_id, repo_key, first_at) VALUES (${id}, ${key}, ${new Date(now.getTime() - o.issuedAgo)})`;
      return { key, p: await proofFor(id, id, { canPush: true, now }) };
    };
    const signIn = (r: Awaited<ReturnType<typeof at>>, why: string) => {
      assert.ok(r.p && 'sign_in' in r.p, `${why}: ${JSON.stringify(r.p)}`);
      assert.match(r.p.sign_in, /\/github\/verify\?n=/);
      assert.equal(r.p.agent_note, SIGN_IN_OWNER_NOTE);
      assert.equal(r.p.repo, r.key);
    };
    signIn(await at(`team${RUN}`, `maya${RUN}`, { type: 'User' }), 'reported login is not the owner');
    signIn(await at(`team${RUN}`, null, { type: 'User' }), 'no login matches the owner');
    signIn(await at(`org${RUN}`, `org${RUN}`, { type: 'Organization' }), 'an organization owns it');
    signIn(await at(`late${RUN}`, `late${RUN}`, { type: 'User', issuedAgo: 2 * 3_600_000 }), 'the hour passed');
    const fresh = await at(`maya${RUN}`, `maya${RUN}`, { type: 'User', issuedAgo: 5 * 60_000 });
    assert.ok(fresh.p && 'line' in fresh.p, 'the owner\'s own repo within the hour: the line');
    // With sign-in off there is no link: the line stays the way.
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    const off = await at(`org2${RUN}`, `org2${RUN}`, { type: 'Organization' });
    assert.ok(off.p && 'line' in off.p);
  } finally {
    for (const [k, v] of [['GITHUB_OAUTH_CLIENT_ID', saved.id], ['GITHUB_OAUTH_CLIENT_SECRET', saved.secret]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

test('F5 outside the hour of fast checks the reply promises no time; plain words, no em dash', () => {
  const v: View = { project: { key: 'a/b', name: 'Recipe planner', confirmed: false, live: false, weeks: 0 }, rank: null, claimed: true, handle: 'maya', claimLink: null, fund: [], ask: null };
  assert.equal(benchReply(v).split('\n')[1], confirmingLine('Recipe planner'));
  const slow = benchReply({ ...v, slow: true }).split('\n')[1];
  assert.equal(slow, confirmingSlowLine('Recipe planner'));
  assert.equal(slow, "Recipe planner joins the Bench once I've confirmed it's yours. I check again every day.");
  assert.ok(!slow.includes('minute') && !slow.includes('—'));
  assert.ok(benchReply({ ...v, slow: true, proofLink: 'https://earnkit.com/github/verify?n=x' }).includes("as soon as you show it's yours"));
});

// ---- M1: a project that stops being confirmed leaves the Bench, the chain pools and the feed at once

test('F6 the Bench gate is read now: a lost repo proof leaves /bench, the chain pool and the feed before the next rescore', dbTest, async () => {
  const a = await listed({ public: true, chains: ['base'], update: true });
  const b = await listed({ public: true, chains: ['base'], update: true });
  const only = [a.id, b.id];
  await rankFeed(NOW);
  assert.equal((await benchRows({ chain: null, raising: false, weekly: false }, { only })).count, 2);
  // The repo source is rejected; builder_live.ranked is still true (no rescore yet).
  await sql()`UPDATE builder_sources SET state = 'rejected' WHERE id = ${b.sid}`;
  const after = await benchRows({ chain: null, raising: false, weekly: false }, { only });
  assert.equal(after.count, 1);
  assert.deepEqual(after.rows.map((r) => r.rank), [1]);
  assert.equal((await chainPools({ only })).base, 1);
  const feed = (await feedWeeks(NOW, { only })).flatMap((w) => w.cards);
  assert.deepEqual(feed.map((c) => c.handle), [`fx${RUN}${a.id}`]);
});

// ---- M2: tell update has a per-person daily limit ------------------------------------------------

test('F7 tell update: at most 20 posts a person a day, then a plain note', dbTest, async () => {
  const id = await installation();
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v213fx-${id}`})`;
  const now = new Date();
  for (let i = 0; i < UPDATE_POSTS_PER_DAY; i++) assert.notEqual((await postUpdate(id, 'Shipped.', now)).agent_note, UPDATE_LIMIT_NOTE);
  const r = await postUpdate(id, 'Shipped.', now);
  assert.deepEqual(r, { show_to_builder: '', agent_note: UPDATE_LIMIT_NOTE });
  assert.ok(!UPDATE_LIMIT_NOTE.includes('—'));
});

// ---- EARNKIT_RAISING: off under the Bench, no raising anywhere; on, everything as built -----------

test('F8 the flag: on only with the Bench and EARNKIT_RAISING=on', () => {
  assert.equal(raisingEnabled({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on' }), false);
  assert.equal(raisingEnabled({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_RAISING: 'on' }), true);
  assert.equal(raisingEnabled({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_RAISING: 'on' }), false);
  assert.equal(raisingEnabled({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_RAISING: 'yes' }), false);
});

test('F9 raising off: no pill on the Bench, the profile or the card, no filter; on: the pill as pillOf gives it', dbTest, async () => {
  const p = await listed({ public: true, raising: true, update: true });
  const only = [p.id];
  await withRaising(false, async () => {
    assert.equal(await pillOf(p.id), null);
    assert.equal((await benchRows({ chain: null, raising: false, weekly: false }, { only })).rows[0].raising, null);
    assert.equal(parseBenchFilter({ raising: '1' }).raising, false, '?raising=1 is ignored');
    // A raising filter passed anyway filters nothing.
    assert.equal((await benchRows({ chain: null, raising: true, weekly: false }, { only })).rows.length, 1);
    const d = (await profileData(p.id, new Date('2026-10-14T00:00:00Z'), { only }))!;
    assert.equal(d.raising, null);
    assert.ok(!JSON.stringify(d.log).includes('Raising'), 'no Raising chip on the update cards');
    assert.equal((await benchCardFacts(p.id))!.raising, null);
  });
  await withRaising(true, async () => {
    const pill = await pillOf(p.id);
    assert.deepEqual(pill, { symbol: 'RECIPE', url: `https://tokens.fun/c/${p.id}` });
    const rows = await benchRows({ chain: null, raising: true, weekly: false }, { only });
    assert.deepEqual(rows.rows[0].raising, pill, 'the row\'s pill is pillOf\'s, in the same read');
    assert.equal(parseBenchFilter({ raising: '1' }).raising, true);
    const d = (await profileData(p.id, new Date('2026-10-14T00:00:00Z'), { only }))!;
    assert.deepEqual(d.raising, pill);
    assert.equal((await benchCardFacts(p.id))!.raising, 'RECIPE');
  });
});

test('F10 raising off: no raise ask, no raise line (the coin moment is v2.12.1\'s line), tell coin { raising } does nothing', dbTest, async () => {
  const p = await listed({ public: true });
  await sql()`INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url)
    VALUES ('earnkit-coin', 'Recipe planner', ${`https://github.com/${p.key}`}, ${`github.com/${p.key}`}, ${p.id}, 'RECIPE', 'launched', ${`https://tokens.fun/c/${p.id}`})`;
  const coin = { name: 'Recipe planner', symbol: 'RECIPE' };
  await withRaising(false, async () => {
    assert.equal(await raiseAsk(p.id, p.key, {}), null);
    assert.equal(coinLine('has_people', 'Recipe planner', null, coin), "Recipe planner has people using it. Want to launch a coin, $RECIPE (Recipe planner), for it? You'd get 40% of its trading fees.");
    assert.deepEqual(await setRaising(p.id, true), { show_to_builder: 'Okay.' });
    const [row] = await sql()<{ raising: boolean }[]>`SELECT raising_at IS NOT NULL AS raising FROM projects WHERE installation_id = ${p.id}`;
    assert.equal(row.raising, false);
  });
  await withRaising(true, async () => {
    assert.ok(await raiseAsk(p.id, p.key, {}));
    assert.equal(coinLine('has_people', 'Recipe planner', null, coin), raiseLine('Recipe planner', 'RECIPE', null));
    assert.deepEqual(await setRaising(p.id, true), { show_to_builder: RAISE_LINES.on('RECIPE') });
  });
});

test('F11 raising off: the Bench, the landing top 10, tell\'s description and llms.txt name no raising', async () => {
  const row = { rank: 1, line: '#1 of 2', handle: 'maya', name: 'Maya', avatar: null, raising: null, chains: [], project: 'Recipe planner', best: 'Live' };
  const filter = { chain: null, raising: false, weekly: false };
  const off = renderToStaticMarkup(React.createElement(BenchView, { rows: [row], count: 2, chips: [], filter, raising: false }));
  assert.ok(!off.includes(FILTER_RAISING) && !off.includes('raising=1'));
  const on = renderToStaticMarkup(React.createElement(BenchView, { rows: [row], count: 2, chips: [], filter, raising: true }));
  assert.ok(on.includes(FILTER_RAISING) && on.includes('raising=1'));
  assert.ok(!renderToStaticMarkup(React.createElement(BenchTop, { rows: [row], chips: [], raising: false })).includes(FILTER_RAISING));
  assert.ok(renderToStaticMarkup(React.createElement(BenchTop, { rows: [row], chips: [], raising: true })).includes(FILTER_RAISING));
  await withRaising(false, async () => {
    assert.equal(toolDescriptions(false).tell, TELL_DESCRIPTION_BENCH_NO_RAISING);
    assert.ok(!TELL_DESCRIPTION_BENCH_NO_RAISING.includes('raising'));
    const text = await (await llms()).text();
    assert.ok(!/raising/i.test(text), 'llms.txt');
    assert.ok(text.includes('with chain and weekly filters.'));
    assert.ok(text.includes('- A tokens.fun coin for the project: 40% of trading fees to the builder.'));
  });
  await withRaising(true, async () => {
    assert.equal(toolDescriptions(false).tell, TELL_DESCRIPTION_BENCH);
    assert.match(await (await llms()).text(), /chain, raising and weekly filters/);
  });
});
