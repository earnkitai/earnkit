import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { EVENT_LOG_FLAG } from './events';
import { factChips, hasFacts, startedChips, startedLine, upsertWeekFacts, weekFactsFor, weeklyFactsStep } from './week-facts';
import { mainConfirmed } from './main-project';
import { personInputsV2, rescorePerson } from './person-score';
import { isoWeekOf, mondayOf } from './weeks';
import { randomBytes } from 'node:crypto';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';

process.env[EVENT_LOG_FLAG] = 'on';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms(); // Task 17: this file's program copies never outlive the run
  await sql().end();
});
const DAY = 86_400_000;
const T = 2_131_400_000 + (process.pid % 1000) * 20;
const NOW = new Date();
const wk = (daysAgo: number) => isoWeekOf(new Date(NOW.getTime() - daysAgo * DAY));
/** A copy of a committed program under a fresh id (the shared DB may not have run programs:sync). */
async function program(name: string): Promise<{ id: string; title: string }> {
  const p = { ...committedProgram(name), id: `v213-${name}-${process.pid}-${randomBytes(3).toString('hex')}`, status: 'active' };
  await upsertProgram(ProgramFile.parse(p));
  return { id: p.id, title: p.title };
}

async function clear(id: number) {
  await sql()`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
  await sql()`DELETE FROM source_readings WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
  for (const t of ['builder_profiles', 'builder_sources', 'builder_live', 'builder_projects', 'project_updates']) await sql()`DELETE FROM ${sql()(t)} WHERE builder_id = ${id}`;
  await sql()`DELETE FROM projects WHERE installation_id = ${id}`;
  await sql()`DELETE FROM contract_deploys WHERE installation_id = ${id}`;
  await sql()`DELETE FROM installations WHERE id = ${id}`;
}
/** A person whose main project `key` has a verified repo with these commit counts, read today. */
async function person(id: number, key: string, counts: Record<string, number>, o: { confirmed?: boolean; other?: string } = {}) {
  await clear(id);
  await sql()`INSERT INTO installations (id, token_hash) VALUES (${id}, ${`v213-wf-${id}`})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, ring) VALUES (${id}, ${`v213wf-${id}`}, ${key}, ${sql().json({ ring: [], ringOwner: [] })})`;
  const state = o.confirmed === false ? 'proposed' : 'verified';
  const [{ sid }] = await sql()<{ sid: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'repo', ${key}, ${key}, ${state}, ${state === 'verified' ? 'proof_line' : null}, 'agent') RETURNING id::int AS sid`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${sid}, ${sql().json({
    owner: key.split('/')[0], owner_type: 'User', created_at: null, fork: false, template: false, stargazers: [], forkers: [], issue_authors: [], contributors: [],
    commit_weeks: Object.keys(counts), commit_counts: counts, partial: false, private: false,
  } as never)}, true, now())`;
  if (o.other)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
      VALUES (${id}, 'site', ${o.other}, ${o.other}, 'verified', 'earnkit_hosted', 'server')`;
}

test('4.1 the chips, in the order the card shows them, in plain words: shipping facts only (no people, money or community round)', () => {
  assert.deepEqual(
    factChips({ shipped_code: { n: 12 }, went_live: true, users_up: { n: 31 }, earned: { usd: 120 }, won: [{ title: 'Base Builder Grants' }], streak: { w: 6 } }),
    ['Went live', 'Won Base Builder Grants', '12 commits', '6 weeks in a row'],
  );
  assert.deepEqual(factChips({ shipped_code: { n: 1 }, users_up: { n: 1 } }), ['1 commit']);
  assert.equal(hasFacts({ users_up: { n: 3 }, earned: { usd: 50 } }), false, 'people or money alone is not a card');
  assert.deepEqual(factChips({ streak: { w: 1 } }), [], 'a streak of one is not a chip');
  assert.equal(startedLine('Recipe planner'), 'Started tracking Recipe planner.');
  assert.deepEqual(startedChips({ live: true, weeks: 6, people: 31 }), ['Live', '6 weeks shipping']);
  assert.deepEqual(startedChips({ live: false, weeks: 1, people: 1 }), ['1 week shipping']);
  assert.deepEqual(startedChips({ live: false, weeks: 0, people: 0 }), []);
});

test('4.2 a fact is shipped code, going live, new people, money or a win; a streak or the start alone is not', () => {
  assert.equal(hasFacts({ shipped_code: { n: 1 } }), true);
  assert.equal(hasFacts({ won: [] }), false);
  assert.equal(hasFacts({ streak: { w: 4 } }), false);
  assert.equal(hasFacts({ started: { live: true, weeks: 3, people: 2 } }), false);
  assert.equal(hasFacts({ checked: true }), false);
});

test('4.3 the rescore scores the one project, stores its streak, weeks shipping, shipping weeks and chains, and writes the Started row once', dbTest, async () => {
  const id = T + 1;
  const key = `maya${T}/recipes`;
  await person(id, key, { [wk(14)]: 2, [wk(7)]: 5, [wk(0)]: 3, [wk(35)]: 1 }, { other: `https://other${T}.example.com` });
  // An EarnKit deploy on Base for the project, and an entry in a program on Arc.
  await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, address, status, cost_micro_usd)
    VALUES (${id}, ${`k${id}`}, ${key}, 'base', ${`0x${'a'.repeat(64)}`}, ${`0x${'b'.repeat(40)}`}, 'deployed', 1)`;
  const arc = await program('arc-microgrants');
  await sql()`INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id) VALUES (${arc.id}, 'R', ${`https://github.com/${key}`}, ${key}, ${id})`;
  await rescorePerson(id, NOW);
  const [p] = await sql()<{ streak: number; weeks_shipping: number; ship_weeks: string[]; chains: string[] }[]>`
    SELECT streak, weeks_shipping, ship_weeks, chains FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`;
  assert.equal(p.streak, 3);
  assert.equal(p.weeks_shipping, 4);
  assert.deepEqual(new Set(p.ship_weeks), new Set([wk(35), wk(14), wk(7), wk(0)]));
  assert.deepEqual([...p.chains].sort(), ['arc', 'base']);
  const [live] = await sql()<{ ranked: boolean }[]>`SELECT ranked FROM builder_live WHERE builder_id = ${id}`;
  assert.equal(live.ranked, true, 'confirmed is enough under the flag (B5)');
  const started = await sql()<{ week: string; facts: { started?: unknown } }[]>`SELECT week::text, facts FROM project_updates WHERE builder_id = ${id}`;
  assert.equal(started.length, 1);
  assert.equal(started[0].week, mondayOf(NOW));
  assert.ok(started[0].facts.started);
  await rescorePerson(id, new Date(NOW.getTime() + 8 * DAY));
  assert.equal((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${id} AND facts ? 'started'`).length, 1, 'never twice');
});

test('Final follow-ups 1: the stored streak is commit weeks in a row (the grid), never a deploy week', dbTest, async () => {
  const id = T + 9;
  const key = `streak${T}/app`;
  // Commits last week and three weeks ago; EarnKit deploys this week and two weeks ago fill the gaps in ship weeks.
  await person(id, key, { [wk(7)]: 2, [wk(21)]: 1 });
  for (const [n, ago] of [[1, 0], [2, 14]] as const)
    await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, address, status, cost_micro_usd, created_at)
      VALUES (${id}, ${`k${id}`}, ${key}, 'base', ${`0x${String(n).repeat(64)}`}, ${`0x${String(n).repeat(40)}`}, 'deployed', 1, ${new Date(NOW.getTime() - ago * DAY)})`;
  await rescorePerson(id, NOW);
  const [p] = await sql()<{ streak: number; ship_weeks: string[]; commit_weeks: string[] }[]>`
    SELECT streak, ship_weeks, commit_weeks FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`;
  assert.deepEqual(new Set(p.ship_weeks), new Set([wk(0), wk(7), wk(14), wk(21)]), 'four ship weeks in a row');
  assert.deepEqual(new Set(p.commit_weeks), new Set([wk(7), wk(21)]));
  assert.equal(p.streak, 1, 'one commit week in a row, so "Shipping every week" (4) never shows it');
});

test('4.4 an unconfirmed main project is not ranked, though another confirmed project would have been (B5)', dbTest, async () => {
  const id = T + 2;
  await person(id, `nope${T}/theirs`, { [wk(0)]: 1 }, { confirmed: false, other: `https://mine${T}.example.com` });
  await rescorePerson(id, NOW);
  const [live] = await sql()<{ ranked: boolean }[]>`SELECT ranked FROM builder_live WHERE builder_id = ${id}`;
  assert.equal(live.ranked, false);
});

test('4.5 a finished week\'s facts: commits, going live once, a win; R16b: no money fact; nothing for an unconfirmed project', dbTest, async () => {
  const id = T + 3;
  const key = `ann${T}/shop`;
  const monday = mondayOf(new Date(NOW.getTime() - 7 * DAY));
  const inWeek = new Date(Date.parse(`${monday}T12:00:00Z`) + DAY);
  await person(id, key, { [isoWeekOf(inWeek)]: 12 });
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, ship_weeks, commit_weeks) VALUES (${id}, ${key}, 'Shop', 'app', true, true, ${[isoWeekOf(new Date(inWeek.getTime() - 7 * DAY)), isoWeekOf(inWeek)]}, ${[isoWeekOf(new Date(inWeek.getTime() - 7 * DAY))]})`;
  await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, address, status, cost_micro_usd, created_at)
    VALUES (${id}, ${`k${id}`}, ${key}, 'base', ${`0x${'c'.repeat(64)}`}, ${`0x${'d'.repeat(40)}`}, 'deployed', 1, ${inWeek})`;
  // F13: a wallet of this run only, so reruns in the same week never add earlier claims.
  const wallet = `0x${'e'.repeat(4)}${randomBytes(18).toString('hex')}`;
  const base = await program('base-builder-grants');
  const [{ pid }] = await sql()<{ pid: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id, creator_wallet, coin_address, token_status, token_url)
    VALUES (${base.id}, 'Shop', ${`https://github.com/${key}`}, ${key}, ${id}, ${wallet}, ${`0x${(T % 1e9).toString(16).padStart(40, '0')}`}, 'launched', 'https://tokens.fun/x') RETURNING id AS pid`;
  await sql()`INSERT INTO token_fees (wallet, weth, usd, read_at) VALUES (${wallet}, '1000000000000000000', 3000, now()) ON CONFLICT (wallet) DO UPDATE SET weth = EXCLUDED.weth, usd = EXCLUDED.usd`;
  await sql()`INSERT INTO fee_claims (tx_hash, owner, role, weth, gas_wei, at) VALUES (${`0x${randomBytes(32).toString('hex')}`}, ${wallet}, 'creator', '40000000000000000', 0, ${inWeek})
    ON CONFLICT (tx_hash) DO NOTHING`;
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, captured_at) VALUES (${pid}, ${base.id}, 'r1', 'won', 500, 'announcement', ${inWeek})`;
  const f = await weekFactsFor(id, monday, NOW);
  assert.deepEqual(f.shipped_code, { n: 12 });
  assert.equal(f.went_live, true);
  assert.equal(f.earned, undefined, 'R16b: creator fees and prizes are no longer a money fact');
  assert.deepEqual(f.won?.map((w) => w.title), [base.title]);
  assert.deepEqual(f.streak, { w: 2 });
  await sql()`UPDATE builder_projects SET confirmed = false WHERE builder_id = ${id}`;
  assert.deepEqual(await weekFactsFor(id, monday, NOW), {});
});

test('4.6 the weekly step runs on Mondays from 15:00 UTC, once per project and week, and writes dated events once', dbTest, async () => {
  const id = T + 4;
  const key = `bo${T}/app`;
  const monday = new Date('2026-10-19T15:30:00Z');
  await person(id, key, { '2026-W42': 4 });
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'App', 'code', true, false)`;
  assert.deepEqual(await weeklyFactsStep(new Date('2026-10-19T14:59:00Z'), { deadline: Date.now() + 10_000, only: [id] }), { step: 'skipped' });
  assert.deepEqual(await weeklyFactsStep(new Date('2026-10-20T15:30:00Z'), { deadline: Date.now() + 10_000, only: [id] }), { step: 'skipped' });
  const r = await weeklyFactsStep(monday, { deadline: Date.now() + 10_000, only: [id] });
  assert.deepEqual(r, { people: 1, rows: 1 });
  const [row] = await sql()<{ facts: Record<string, unknown> }[]>`SELECT facts FROM project_updates WHERE builder_id = ${id} AND week = '2026-10-12'`;
  assert.deepEqual(row.facts.shipped_code, { n: 4 });
  assert.equal(row.facts.checked, true);
  assert.deepEqual(await weeklyFactsStep(new Date('2026-10-19T16:30:00Z'), { deadline: Date.now() + 10_000, only: [id] }), { people: 0, rows: 0 });
  const ev = await sql()`SELECT 1 FROM builder_events WHERE type = 'shipped_code' AND dedupe_key = ${`shipped_code:${key}:2026-W42`}`;
  assert.equal(ev.length, 1);
});

test('4.7 a builder who names someone else\'s repo writes no ship-log row; the confirmed owner gets the Started row and the week\'s facts', dbTest, async () => {
  const claimant = T + 5;
  const owner = T + 6;
  const key = `own${T}/real`;
  await person(claimant, key, { '2026-W42': 3 }, { confirmed: false });
  await person(owner, key, { '2026-W42': 3 });
  await sql()`DELETE FROM project_updates WHERE lower(project_key) = lower(${key})`;
  // The claimant first: were it to write, its rows would block the owner's.
  await rescorePerson(claimant, NOW);
  await rescorePerson(owner, NOW);
  const step = await weeklyFactsStep(new Date('2026-10-19T15:30:00Z'), { deadline: Date.now() + 10_000, only: [claimant, owner] });
  assert.deepEqual(step, { people: 1, rows: 1 });
  assert.equal((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${claimant}`).length, 0, 'the claimant writes nothing');
  const rows = await sql()<{ week: string; facts: Record<string, unknown> }[]>`
    SELECT week::text, facts FROM project_updates WHERE builder_id = ${owner} ORDER BY week`;
  assert.equal(rows.filter((r) => r.facts.started).length, 1, 'the owner\'s Started row');
  const week = rows.find((r) => r.week === '2026-10-12');
  assert.deepEqual(week?.facts.shipped_code, { n: 3 });
  assert.equal(week?.facts.checked, true);
});

test('4.9 R16b: no new-people fact; the scope keeps other projects\' ships out of the score', dbTest, async () => {
  const id = T + 7;
  const key = `cy${T}/dapp`;
  await person(id, key, { [wk(0)]: 1 }, { other: `https://side${T}.example.com` });
  const addr = `0x${(T + 7).toString(16).padStart(40, '0')}`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'contract', ${`base:${addr}`}, ${key}, 'verified', 'deployer', 'server')`;
  // An old reading's callers (before R16b) count nothing.
  const callers = Array.from({ length: 40 }, (_, i) => ({
    id: `wallet:0x${(T * 100 + i).toString(16).padStart(40, '0')}`, at: new Date(NOW.getTime() - 2 * DAY - i * 60_000).toISOString(),
    value_usd: 100, codes: [], first_tx_at: '2024-01-01T00:00:00Z',
  }));
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at)
    SELECT id, ${sql().json({ callers, partial: false } as never)}, true, now() FROM builder_sources WHERE builder_id = ${id} AND kind = 'contract'`;
  const mine = await personInputsV2(id, NOW, sql(), { scope: key });
  assert.deepEqual(mine.input.ships.map((x) => x.key), [`contract:base:${addr}`], 'the confirmed contract is a live ship');
  assert.deepEqual(mine.input.commitWeeks, [wk(0)]);
  const other = await personInputsV2(id, NOW, sql(), { scope: `https://side${T}.example.com` });
  assert.deepEqual([other.input.ships, other.input.commitWeeks], [[], []], 'another project in scope: this one stays out of the score');
  assert.ok(other.projects.some((p) => p.key === key), 'the rows are built for every project');
  await rescorePerson(id, NOW);
  const f = await weekFactsFor(id, mondayOf(NOW), NOW);
  assert.deepEqual(f.shipped_code, { n: 1 }, 'the week is read');
  assert.equal(f.users_up, undefined, 'no new-people fact');
});

/** A verified contract `base:<addr>` on `key` with `n` long-lived callers, first calls spread over three days (the spread rule). */
async function callersOn(id: number, key: string, n: number, seed: number) {
  const addr = `0x${(T * 10 + seed).toString(16).padStart(40, '0')}`;
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'contract', ${`base:${addr}`}, ${key}, 'verified', 'deployer', 'server') RETURNING id::int AS sid`;
  const callers = Array.from({ length: n }, (_, i) => [9 + (i % 3), 2].map((d) => ({
    id: `wallet:0x${(T * 1000 + seed * 1000 + i).toString(16).padStart(40, '0')}`, at: new Date(NOW.getTime() - d * DAY - i * 60_000).toISOString(),
    value_usd: 100, codes: [], first_tx_at: '2024-01-01T00:00:00Z',
  }))).flat();
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${sid}, ${sql().json({ callers, partial: false } as never)}, true, now())`;
  return sid;
}

test('4.10 R16b: callers on the one project or a side project never hold the score', dbTest, async () => {
  const id = T + 8;
  const key = `dee${T}/main`;
  await person(id, key, { [wk(0)]: 2 });
  await callersOn(id, key, 30, 1);
  await callersOn(id, key, 30, 2);
  await callersOn(id, `dee${T}/side`, 400, 3);
  const r = await rescorePerson(id, NOW);
  assert.equal(r.held, false);
});

test('4.11 a proposed site\'s days up add no shipping week; a confirmed one does', dbTest, async () => {
  const id = T + 9;
  const key = `eve${T}/site`;
  const origin = `https://eve${T}.example.com`;
  await person(id, key, { [wk(0)]: 1 });
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'site', ${origin}, ${key}, 'proposed', null, 'agent') RETURNING id::int AS sid`;
  for (const d of [21, 1])
    await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${new Date(NOW.getTime() - d * DAY).toISOString().slice(0, 10)}, ${sql().json({ up: true } as never)}, true)`;
  const weeks = async () => (await sql()<{ ship_weeks: string[] }[]>`SELECT ship_weeks FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`)[0].ship_weeks;
  await rescorePerson(id, NOW);
  assert.equal((await weeks()).includes(wk(21)), false, 'proposed: not a shipping week');
  await sql()`UPDATE builder_sources SET state = 'verified', proof = 'repo_link' WHERE id = ${sid}`;
  await rescorePerson(id, new Date(NOW.getTime() + 60_000));
  assert.equal((await weeks()).includes(wk(21)), true, 'confirmed: its first day up is a shipping week');
});

test('4.11b owner batch: a site proven by earnkit.txt counts toward Shipping (its first day up, the live bonus); an agent-typed one never does', dbTest, async () => {
  for (const [n, proof] of [[15, 'earnkit_txt']] as const) {
    const id = T + n;
    const key = `site${n}${T}/app`;
    await person(id, key, { [wk(0)]: 1 });
    const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
      VALUES (${id}, 'site', ${`https://site${n}${T}.example.com`}, ${key}, 'proposed', null, 'agent') RETURNING id::int AS sid`;
    for (const d of [21, 1])
      await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${new Date(NOW.getTime() - d * DAY).toISOString().slice(0, 10)}, ${sql().json({ up: true } as never)}, true)`;
    const project = async () => (await sql()<{ ship_weeks: string[] }[]>`SELECT ship_weeks FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`)[0];
    const typed = await rescorePerson(id, NOW);
    assert.equal((await project()).ship_weeks.includes(wk(21)), false, `${proof}: typed, unverified: no shipping week`);
    await sql()`UPDATE builder_sources SET state = 'verified', proof = ${proof} WHERE id = ${sid}`;
    const proven = await rescorePerson(id, new Date(NOW.getTime() + 60_000));
    assert.equal((await project()).ship_weeks.includes(wk(21)), true, `${proof}: its first day up is a shipping week`);
    assert.ok(proven.score > typed.score, `${proof}: the live site adds to the score (${typed.score} -> ${proven.score})`);
  }
  // Fix round: nothing re-checks a DNS record, so a dns_txt site adds nothing.
  const id = T + 16;
  const key = `site16${T}/app`;
  await person(id, key, { [wk(0)]: 1 });
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'site', ${`https://site16${T}.example.com`}, ${key}, 'verified', 'dns_txt', 'agent') RETURNING id::int AS sid`;
  for (const d of [21, 1])
    await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${new Date(NOW.getTime() - d * DAY).toISOString().slice(0, 10)}, ${sql().json({ up: true } as never)}, true)`;
  await rescorePerson(id, NOW);
  const [p] = await sql()<{ ship_weeks: string[] }[]>`SELECT ship_weeks FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`;
  assert.equal(p.ship_weeks.includes(wk(21)), false, 'dns_txt: no shipping week');
});

test('4.12 a chain only from a confirmed contract, an EarnKit deploy, a launched coin or a program entry; never what an agent says', dbTest, async () => {
  const id = T + 10;
  const key = `fay${T}/dapp`;
  await person(id, key, { [wk(0)]: 1 });
  await sql()`UPDATE builder_profiles SET identity = ${sql().json({ projects: [{ name: 'Dapp', repo: `https://github.com/${key}`, chain: 'base', contracts: [] }] } as never)} WHERE builder_id = ${id}`;
  await sql()`UPDATE installations SET fit_chains = ${['base', 'arc']} WHERE id = ${id}`;
  // A contract the agent proposed, and one verified on a proof that does not confirm: neither counts.
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES
    (${id}, 'contract', ${`base:0x${'1'.repeat(40)}`}, ${key}, 'proposed', null, 'agent'),
    (${id}, 'contract', ${`arc:0x${'2'.repeat(40)}`}, ${key}, 'verified', 'earnkit_txt', 'agent')`;
  await rescorePerson(id, NOW);
  const [p] = await sql()<{ chains: string[] }[]>`SELECT chains FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`;
  assert.deepEqual(p.chains, []);
});

test('4.13 another builder\'s week row for the key (checked or not) is left alone, and its owner-to-be is not due', dbTest, async () => {
  const id = T + 11;
  const key = `gus${T}/app`;
  await person(id, key, { '2026-W42': 2 });
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'App', 'code', true, false)`;
  // The first owner's row: a Started-only row, unchecked.
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${id + 1_000_000}, ${key}, '2026-10-12', '{"started": {"live": false, "weeks": 1, "people": 0}}'::jsonb)`;
  try {
    // Not due: no starving the run's slots with a second owner whose upsert would write nothing.
    assert.deepEqual(await weeklyFactsStep(new Date('2026-10-19T15:30:00Z'), { deadline: Date.now() + 10_000, only: [id] }), { people: 0, rows: 0 });
    assert.equal(await upsertWeekFacts(id, key, '2026-10-12', { checked: true }), false, 'nothing written over another builder\'s row');
    assert.equal((await sql()`SELECT 1 FROM builder_events WHERE dedupe_key = ${`shipped_code:${key}:2026-W42`}`).length, 0, 'no event for a log that is not theirs');
    await sql()`UPDATE project_updates SET facts = facts || '{"checked": true}'::jsonb WHERE builder_id = ${id + 1_000_000}`;
    assert.deepEqual(await weeklyFactsStep(new Date('2026-10-19T16:30:00Z'), { deadline: Date.now() + 10_000, only: [id] }), { people: 0, rows: 0 });
  } finally {
    await sql()`DELETE FROM project_updates WHERE builder_id = ${id + 1_000_000}`;
  }
});

test('4.14 a coin and an entry naming an unproven repo do not confirm it for the Bench: not ranked, no Started row, not due; its repo proof does', dbTest, async () => {
  const id = T + 12;
  const key = `hal${T}/coin`;
  await person(id, key, { '2026-W42': 2, [wk(0)]: 1 }, { confirmed: false });
  const base = await program('base-builder-grants');
  await sql()`INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id, creator_wallet, coin_address, token_status)
    VALUES (${base.id}, 'Coin', ${`https://github.com/${key}`}, ${key}, ${id}, ${`0x${randomBytes(20).toString('hex')}`}, ${`0x${randomBytes(20).toString('hex')}`}, 'launched')`;
  await rescorePerson(id, NOW);
  const [row] = await sql()<{ confirmed: boolean }[]>`SELECT confirmed FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`;
  assert.equal(row.confirmed, true, 'the coin makes the row confirmed (v2.12.1 rule, unchanged)');
  const ranked = async () => (await sql()<{ ranked: boolean }[]>`SELECT ranked FROM builder_live WHERE builder_id = ${id}`)[0].ranked;
  assert.equal(await ranked(), false);
  assert.equal(await mainConfirmed(id), false);
  assert.equal((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${id}`).length, 0, 'no Started row');
  assert.deepEqual(await weeklyFactsStep(new Date('2026-10-19T15:30:00Z'), { deadline: Date.now() + 10_000, only: [id] }), { people: 0, rows: 0 });
  await sql()`UPDATE builder_sources SET state = 'verified', proof = 'proof_line' WHERE builder_id = ${id} AND kind = 'repo'`;
  await rescorePerson(id, new Date(NOW.getTime() + 60_000));
  assert.equal(await ranked(), true);
  assert.equal(await mainConfirmed(id), true);
  assert.equal((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${id} AND facts ? 'started'`).length, 1);
});

test('4.15 a scoped npm package as the one project, confirmed through its package source, gets its Started row; R4: unranked without a repo reading', dbTest, async () => {
  const id = T + 13;
  const key = `@v213s${T}/pkg`;
  await clear(id);
  await sql()`INSERT INTO installations (id, token_hash) VALUES (${id}, ${`v213-wf-${id}`})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, ring) VALUES (${id}, ${`v213wf-${id}`}, ${key}, ${sql().json({ ring: [], ringOwner: [] })})`;
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'package_npm', ${key}, ${key}, 'verified', 'repo_link', 'server') RETURNING id::int AS sid`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${sid}, ${sql().json({ weekly: 500 } as never)}, true, now())`;
  await rescorePerson(id, NOW);
  const [live] = await sql()<{ ranked: boolean; score: number }[]>`SELECT ranked, score FROM builder_live WHERE builder_id = ${id}`;
  assert.deepEqual([live.ranked, live.score], [false, 10], 'the published package is a live ship (10); no repo reading, no rank');
  assert.equal((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${id} AND facts ? 'started'`).length, 1);
});

test('4.16 downloads of a package outside the one project add nothing to the score', dbTest, async () => {
  const id = T + 14;
  const key = `ivy${T}/main`;
  await person(id, key, { [wk(0)]: 1 });
  const [{ sid }] = await sql()<{ sid: number }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'package_npm', ${`ivy-side-${T}`}, ${`ivy-side-${T}`}, 'verified', 'repo_link', 'server') RETURNING id::int AS sid`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${sid}, ${sql().json({ weekly: 5000 } as never)}, true, now())`;
  const scoped = await personInputsV2(id, NOW, sql(), { scope: key });
  assert.deepEqual(scoped.input.ships, [], 'the side package is no live ship of the one project');
  const r = await rescorePerson(id, NOW);
  assert.equal(r.score, 14, 'this week\'s code only: no live bonus from outside the one project');
});
