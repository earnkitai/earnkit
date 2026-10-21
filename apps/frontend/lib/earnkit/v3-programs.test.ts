import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { connectInstallation, saveInstallation } from './installations';
import { rescorePerson } from './person-score';
import { isoWeekOf } from './weeks';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { listPrograms, openProgramFacts, upsertProgram } from './programs';
import { byRelevance, landingFrom, readGuidePage } from './landing';
import { openCurated, openMoneyUsd, openMoneyWords, openGrantsText } from './pool';
import { profileData } from './bench-data';
import { earnPrize } from './stand-view';
import { guideText } from './guide';
import type { Card, RepoFit } from './present';
import { productOdds, productScore, traction, type Detection } from './match';
import { fileCards } from './fixtures/fresh-build';
import type { PublicStats } from './stats';
import GuideView from '../../app/programs/[id]/GuideView';
import AskAgent from '../../app/programs/[id]/AskAgent';
import HomeView from '../../app/HomeView';
import { unsign } from './fixtures/page-words';

(globalThis as { React?: typeof React }).React = React;
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v3-programs-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const NOTE = 'Cohort 9 is not announced yet. Four weekly ship logs in a row come before an interview.';

/** An upcoming program, cloned from a committed file under a test id. */
function upcomingFile(id: string, o: Record<string, unknown> = {}) {
  const base = committedProgram('base-builder-grants');
  return ProgramFile.parse({
    ...base,
    id,
    title: `Upcoming ${id}`,
    status: 'upcoming',
    opens_note: NOTE,
    submission_url: base.source_url,
    submission_requirements: [],
    form: undefined,
    ...o,
  });
}

const stats = { open_money_usd: 0, open_money_text: null, open_pools_usd: 0, open_pools_plus: false, programs_open: 0, bonus_programs_open: 0, coins_launched: 0, fees_to_safe_eth: 0, bonus_paid_eth: 0, bonus_pools_eth: 0, installs: 0, installs_used: 0, builders: 0, activated: 0, weekly_active: 0, shared: 0, labelled_entries: 0, entries_won: 0, builders_won_usd: 0, points_total: 0, applications: 0, accepted: 0 } as PublicStats;
const now = new Date('2026-10-20T12:00:00Z');
const card = (id: string, o: Partial<Card> = {}): Card => ({ id, title: id, summary: 'up to $5,000 · rolling', tag: null, each_time: [], ends_at: null, max_award_usd: 5000, reward: 'Up to $5,000', status: 'active', chains: ['arc'], ...o });

test('(a) an upcoming program is listed with "not open yet", never a fit, never in the total', db, async () => {
  const id = `v3-upcoming-${RUN}`;
  // The schema: upcoming needs its note, allows no requirements and the source as the submission link.
  assert.equal(ProgramFile.safeParse({ ...upcomingFile(id), opens_note: undefined }).success, false);
  assert.equal(ProgramFile.safeParse({ ...committedProgram('base-builder-grants'), submission_requirements: [] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...committedProgram('base-builder-grants'), opens_note: NOTE }).success, false, 'opens_note only with upcoming');
  assert.equal(ProgramFile.safeParse({ ...upcomingFile(id), opens_note: 'see https://x.com/a' }).success, false, 'no links');
  await upsertProgram(upcomingFile(id, { max_award_usd: 100000, investment: true }));
  const cards = await listPrograms();
  const c = cards.find((x) => x.id === id);
  assert.ok(c, 'listed');
  assert.equal(c.status, 'upcoming');
  assert.equal(c.opens_note, NOTE);
  const tile = landingFrom(cards, stats, new Date()).tiles.find((t) => t.id === id);
  assert.equal(tile?.days_left, 'not open yet');
  assert.equal(tile?.status, 'upcoming');
  assert.ok(!(await openProgramFacts()).some((p) => p.id === id), 'never a fit');
  assert.equal(openMoneyUsd([c]), 0, 'never in the total');
  // v3.1 W2: the tile says "Not open yet" and the landing's cards leave it out (open programs only).
  assert.equal(tile?.when, 'Not open yet');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(HomeView, { landing: { ...landingFrom(cards, stats, new Date()), tiles: [tile!] } })), new RegExp(`href="/programs/${id}"`));
});

test('(b) tile order: active first; Base, then any chain, then the rest; grants before investments; dated before rolling', () => {
  const cards = [
    card('arc-dated', { ends_at: new Date('2026-10-25T00:00:00Z'), max_award_usd: 90000 }),
    card('base-rolling', { chains: ['base'], max_award_usd: 5000 }),
    card('upcoming-base', { chains: ['base'], status: 'upcoming', max_award_usd: 100000 }),
    card('any-dated', { chains: [], any_chain: true, ends_at: new Date('2026-11-02T07:59:59Z'), max_award_usd: 1000000, investment: true }),
    card('base-dated', { chains: ['base'], ends_at: new Date('2026-11-18T00:00:00Z'), max_award_usd: 400000 }),
    card('base-rolling-big', { chains: ['base'], max_award_usd: 10000 }),
    card('arc-rolling', {}),
  ];
  assert.deepEqual(
    [...cards].sort(byRelevance).map((c) => c.id),
    ['base-dated', 'base-rolling-big', 'base-rolling', 'any-dated', 'arc-dated', 'arc-rolling', 'upcoming-base'],
  );
  assert.deepEqual(landingFrom(cards, stats, now).tiles.map((t) => t.id), [...cards].sort(byRelevance).map((c) => c.id));
  // Within a group, a grant before an investment, whatever the deadline.
  const any = [
    card('any-inv', { chains: [], any_chain: true, investment: true, ends_at: new Date('2026-11-01T00:00:00Z') }),
    card('any-grant', { chains: [], any_chain: true, ends_at: new Date('2026-11-07T00:00:00Z') }),
  ];
  assert.deepEqual([...any].sort(byRelevance).map((c) => c.id), ['any-grant', 'any-inv']);
  // v3 Stage 2 final review: the committed set on Oct 20 (open or upcoming), as the landing lists it.
  const listed = fileCards().filter((c) => c.status === 'upcoming' || openCurated(c, now));
  assert.deepEqual(landingFrom(listed, stats, now).tiles.map((t) => t.id), [
    'base-builder-grants', 'ethglobal-mumbai', 'a16z-speedrun', 'alliance-all19', 'circle-developer-grants', 'avalanche-team1-mini-grants',
    'base-batches-005', 'monad-nitro',
  ]);
});

test('(c) the money total excludes investments, pool-only and in-person programs; words name them', () => {
  const a16z = card('a16z', { chains: [], any_chain: true, investment: true, max_award_usd: 1000000 });
  const circle = card('circle', { max_award_usd: 100000 });
  const eth = card('ethglobal', { chains: [], any_chain: true, max_award_usd: null, pool_usd: 141000, ends_at: new Date('2026-11-07T03:30:00Z') });
  assert.equal(openMoneyUsd([a16z, circle, eth], now), 100000);
  assert.equal(openMoneyWords([a16z, circle, eth], now), 'Plus 1 accelerator and 1 hackathon.');
  assert.equal(openMoneyWords([a16z, { ...a16z, id: 'b' }, circle], now), 'Plus 2 accelerators.');
  assert.equal(openMoneyWords([circle], now), null);
  assert.equal(openGrantsText(openMoneyUsd([a16z], now)), '$0 in grants and prizes open');
  assert.equal(openGrantsText(115000), '$115K in grants and prizes open');
  // v3 Stage 2 final review, the hackathon rule: in person, or a stated prize text with no amount, is named, not counted.
  const inPerson = card('in-person', { chains: [], any_chain: true, max_award_usd: null, in_person: true });
  const textOnly = card('text-only', { max_award_usd: null, pool_usd: null, reward: 'Partner prizes, amounts to be announced' });
  assert.equal(openMoneyWords([inPerson], now), 'Plus 1 hackathon.');
  assert.equal(openMoneyWords([textOnly, inPerson], now), 'Plus 2 hackathons.');
  assert.equal(openMoneyWords([{ ...textOnly, reward: '' }], now), null, 'no amount and no prize text: nothing to name');
  assert.equal(openMoneyUsd([inPerson, textOnly], now), 0);
  // The committed files on Oct 20: Avalanche, Base and Circle count ($115K); a16z speedrun and Alliance (accelerators)
  // and ETHGlobal Mumbai (in person, no stated per-winner amount) are named, not counted.
  const files = fileCards();
  assert.equal(openMoneyUsd(files, now), 115000);
  assert.equal(openMoneyWords(files, now), 'Plus 2 accelerators and 1 hackathon.');
  assert.equal(landingFrom(files, stats, now).open_text, '$115K in grants and prizes open');
  assert.equal(landingFrom(files, stats, now).open_more, 'Plus 2 accelerators and 1 hackathon.');
  assert.equal(committedProgram('ethglobal-mumbai').max_award_usd, undefined, 'no per-winner amount the source does not state');
  const landing = landingFrom([a16z, circle, eth], stats, now);
  assert.equal(landing.open_text, '$100K in grants and prizes open');
  assert.equal(landing.open_more, 'Plus 1 accelerator and 1 hackathon.');
  assert.equal(landingFrom([], stats, now).open_text, null, 'nothing open: no line');
  // v3.1 Task 6: the landing shows the hero chip (open_chip, the same figure), never "open right now".
  const t = unsign(renderToStaticMarkup(React.createElement(HomeView, { landing }))).replace(/<[^>]+>/g, ' ');
  assert.ok(landing.open_chip && t.includes(landing.open_chip) && landing.open_chip.startsWith('$100K '), t.slice(0, 300));
  assert.doesNotMatch(t, /open right now/);
});

test('(d) programs:check passes on the committed JSON files', () => {
  const root = join(import.meta.dirname, '..', '..', '..', '..');
  const out = execFileSync('npx', ['tsx', 'apps/frontend/scripts/programs-sync.mts', '--check'], { cwd: root, encoding: 'utf8' });
  for (const f of ['alliance-all19.json', 'ethglobal-mumbai.json', 'monad-nitro.json', 'base-batches-005.json', 'a16z-speedrun.json'])
    assert.match(out, new RegExp(`Valid: ${f.replace('.', '\\.')}`));
});

test('(e) a ranked builder with a 4-week streak and no fit sees one upcoming line, the money line (v3.1 F4: none beside a fit, v31-reply-trim.test.ts)', db, async () => {
  await upsertProgram(upcomingFile(`v3-upc-e-${RUN}`, { max_award_usd: 50000, chains: ['arc'] }));
  const t = `ek_v3p_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `97${RUN}4`, username: `vp${RUN}`.slice(0, 15), name: 'vp', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 0, fits: [] })) as never };
  const key = `vp${RUN}/app`;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'App', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: `vp${RUN}`, gh: fakeGitHub({ [key]: { id: 5091, owner: `vp${RUN}`, installation: 591 } }) });
  await rescorePerson(c.id, new Date());
  const weeks = [21, 14, 7, 0].map((d) => isoWeekOf(new Date(Date.now() - d * 86_400_000)));
  const streak = async (n: number) =>
    sql()`UPDATE builder_projects SET streak = ${n}, ship_weeks = ${weeks.slice(4 - n)}::text[] WHERE builder_id = ${c.id} AND lower(project_key) = ${key}`;
  await streak(4);
  const s = String((await mcpCall(ctx, 'find', {})).reply?.show_to_builder ?? '');
  const lines = s.split('\n');
  const upc = lines.filter((l) => / not open yet\. /.test(l));
  assert.equal(upc.length, 1, s);
  // The first upcoming program by the tile order, with its prize and note.
  const first = (await listPrograms()).filter((p) => p.status === 'upcoming').sort(byRelevance)[0];
  assert.ok(upc[0].startsWith(`${first.title}: `) && upc[0].endsWith(`, not open yet. ${first.opens_note}`), upc[0]);
  // Task 16: the money line, after the standing line, before the question; a statement, no link.
  assert.equal(lines.indexOf(upc[0]), 1, s);
  assert.doesNotMatch(upc[0], /https?:|\?/);
  // A streak under 4: no upcoming line.
  await streak(3);
  const s3 = String((await mcpCall(ctx, 'find', {})).reply?.show_to_builder ?? '');
  assert.doesNotMatch(s3, / not open yet\. /, s3);
});

test('(f) the guide page for an upcoming program shows not open yet, the note and no Ask button', db, async () => {
  const id = `v3-upc-f-${RUN}`;
  await upsertProgram(upcomingFile(id));
  const page = (await readGuidePage(id))!;
  assert.equal(page.upcoming, true);
  assert.equal(page.open, false);
  assert.match(page.guide.header, / · not open yet$/);
  assert.equal(page.guide.opens_note, NOTE);
  const h = renderToStaticMarkup(React.createElement(GuideView, { page }));
  assert.ok(h.includes(NOTE), 'the note under the header');
  assert.match(h.replace(/<[^>]+>/g, ''), /Not open yet/); // Task 7: the page capitalises each fact, as the row chips do; get_program keeps "not open yet"
  const all: React.ReactElement[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (React.isValidElement(n)) {
      all.push(n);
      walk((n.props as { children?: unknown }).children);
    }
  };
  walk(GuideView({ page }));
  assert.equal(all.filter((e) => e.type === AskAgent).length, 0, 'no Ask your agent');
  // The reply voice carries the same line.
  assert.ok(guideText(page.guide).split('\n').includes(NOTE));
});

test('(g) an in-person program is never a fit in a ranked reply; it stays on the program list', db, async () => {
  const t = `ek_v3g_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `96${RUN}7`, username: `vg${RUN}`.slice(0, 15), name: 'vg', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `vg${RUN}/kit`;
  // v3.1 Task 8: ETHGlobal Mumbai is unlisted, so an active copy stands in for an open in-person program.
  const mumbai = `ethglobal-mumbai-v3g-${process.pid}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('ethglobal-mumbai'), id: mumbai, status: 'active' }));
  // A product repo the matcher calls likely for ETHGlobal Mumbai (in person) and Base Builder Grants.
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: [mumbai, 'base-builder-grants'].map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: `vg${RUN}`, gh: fakeGitHub({ [key]: { id: 5092, owner: `vg${RUN}`, installation: 592 } }) });
  // find names its Best fit (Base: find's fits are this builder's verdicts); score reads every open program, so its Best
  // fit may be another one closing sooner. Neither ever names the in-person program.
  for (const tool of ['find', 'score'] as const) {
    const s = String((await mcpCall(ctx, tool, {})).reply?.show_to_builder ?? '');
    if (tool === 'find') assert.match(s, /Base Builder Grant Program/, `${tool}: ${s}`);
    assert.doesNotMatch(s, /ETHGlobal Mumbai/, `${tool}: ${s}`);
  }
  // v3 Stage 2 final review: nor on the profile's Ways to get funded.
  const funds = (await profileData(c.id, new Date()))!.project!.funds;
  assert.ok(funds.some((l) => l.startsWith('Base Builder Grant Program pays ')), JSON.stringify(funds));
  assert.ok(!funds.some((l) => /ETHGlobal/.test(l)), JSON.stringify(funds));
  const tile = landingFrom(await listPrograms(), stats, new Date()).tiles.find((x) => x.id === mumbai);
  assert.equal(tile?.in_person, true, 'still listed');
});

test('(h) an upcoming investment reads "investment", never as a prize', () => {
  // v3 Stage 2 final review: as pool.ts eachLine ("up to $500K investment").
  assert.equal(earnPrize({ max_award_usd: 500000, summary: 'up to $500K investment', investment: true }), 'up to $500K investment');
  assert.equal(earnPrize({ max_award_usd: 5000, summary: 'up to $5,000' }), 'up to $5K');
  const nitro = fileCards().find((c) => c.id === 'monad-nitro')!;
  assert.equal(earnPrize(nitro), 'up to $500K investment');
});
