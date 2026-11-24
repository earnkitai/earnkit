import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { connectInstallation, saveInstallation } from '../v5/installations';
import { upsertProgram } from '../v5/programs';
import { upsertBuilder } from './builders';
import type { Row } from './evidence';
import { evidence } from './fixtures/evidence-builder';
import { ORDINAL_FLOOR, ordinals, standing } from './ordinal';
import { linksRepo, packageNames, pyprojectName, readPackages } from './packages';
import { createJob, jobResults } from './screen-jobs';
import { markdownReport, type ScreenRow } from './screen-report';
import { place, REVIEW_ORDER, type Tier } from './tiers';

after(() => sql().end());
const FLAGS = process.env.EARNKIT_FLAGS;
afterEach(() => {
  if (FLAGS === undefined) delete process.env.EARNKIT_FLAGS;
  else process.env.EARNKIT_FLAGS = FLAGS;
});

const NOW = new Date('2026-11-06T12:00:00Z');
const row = (key: string, value: Row['value']): Row => ({ key, value, basis: 'github', read_at: NOW.toISOString(), note: null });
const weeks = (n: number) => [row('code.active_weeks_90d', n)];

test('standing: verified rows only, log-scaled, the top three reasons; an uncounted contract adds nothing', () => {
  const s = standing([
    row('code.active_weeks_90d', 12), row('code.commits_60d', 40), row('code.has_tests', true), row('team.contributors', 3), row('code.releases', 0),
    row('onchain[0].counted', false), row('onchain[0].mainnet', true), row('onchain[0].funded_senders_90d', 5000),
  ]);
  assert.deepEqual(s.reasons, ['active 12 of 13 weeks', '40 commits in 60 days', '3 contributors']);
  const counted = standing([row('onchain[0].counted', true), row('onchain[0].mainnet', true), row('onchain[0].funded_senders_90d', 30)]);
  assert.deepEqual(counted.reasons, ['30 senders the deployer did not fund in 90 days']);
  // Ten times the senders is not ten times the points.
  const more = standing([row('onchain[0].counted', true), row('onchain[0].mainnet', true), row('onchain[0].funded_senders_90d', 300)]);
  assert.ok(more.points > counted.points && more.points < 2 * counted.points);
});

const items = (verified: number, extra: { tier: Tier | null; rows: Row[] }[] = []) => [
  ...[...Array(verified)].map((_, i) => ({ ref: `v${String(i).padStart(2, '0')}`, tier: 'live' as Tier, rows: weeks(i) })),
  ...extra.map((x, i) => ({ ref: `x${i}`, ...x })),
];

test(`no ordinal below ${ORDINAL_FLOOR} verified applicants, however many are placed; at the floor, every placed one has one`, () => {
  assert.equal(ORDINAL_FLOOR, 10);
  const many = Array(20).fill({ tier: 'unverified', rows: [] });
  assert.equal(ordinals(items(9, [...many, { tier: 'flagged', rows: [] }])).size, 0);
  const at = ordinals(items(10, [{ tier: 'flagged', rows: [] }, { tier: null, rows: [] }]));
  assert.equal(at.size, 11);
  // More points first inside the tier; the tier's size is named.
  assert.deepEqual(at.get('v09'), { ordinal: 1, of: 10, reasons: ['active 9 of 13 weeks'] });
  assert.equal(at.get('v00')?.ordinal, 10);
  assert.deepEqual(at.get('x0'), { ordinal: 1, of: 1, reasons: [] });
});

const screenRow = (ref: string, tier: 'live' | 'unverified'): ScreenRow => {
  const e = tier === 'live' ? evidence({ live: { ...evidence().live, url: 'https://x.example/', url_ok: true } }) : evidence();
  return { applicant: { ref, name: ref, repo_url: null, live_url: null, contracts: [], pitch: null, problems: [] } as unknown as ScreenRow['applicant'], evidence: e, placement: place(e, { identical_pitch: 0, shared_contributors: 0 }, undefined, NOW), line: `${ref} line` };
};

test('the report renders no order below the floor, and the order in tier at it', () => {
  const nine = [...Array(9)].map((_, i) => screenRow(`r${i}`, 'live'));
  const below = markdownReport('p', nine, NOW, ordinals(nine.map((r) => ({ ref: r.applicant.ref, tier: r.placement.tier, rows: [] }))));
  assert.doesNotMatch(below, /order in|\brank|\bordinal/i);
  assert.equal(below, markdownReport('p', nine, NOW));
  const ten = [...nine, screenRow('r9', 'live')];
  const at = markdownReport('p', ten, NOW, ordinals(ten.map((r) => ({ ref: r.applicant.ref, tier: r.placement.tier, rows: [] }))));
  assert.match(at, /- order in live: 1 of 10\n/);
});

test('one review order: flagged before unverified, in the report and (screen_v2) in the results', () => {
  assert.deepEqual(REVIEW_ORDER, ['used', 'live', 'building', 'flagged', 'unverified']);
});

test('builderRules still bans rank and score words in builder copy', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'v5', 'fixtures', 'builder-rules.ts'), 'utf8');
  assert.match(src, /\(score\|rank\|/);
});

let gh = 960_000;
async function reviewer(programId: string) {
  await upsertProgram(programFixture({ id: programId, title: `${programId} title` }), 'file', NOW);
  const token = 'v2-' + Math.random();
  await saveInstallation(token, 'Program Agent');
  const inst = await connectInstallation(token);
  const b = await upsertBuilder({ github_id: ++gh, login: 'v2rev' + gh, name: null, avatar_url: null }, NOW);
  await sql()`INSERT INTO program_reviewers (program_id, builder_id) VALUES (${programId}, ${b.id}) ON CONFLICT DO NOTHING`;
  return { programId, builderId: b.id, installationId: inst!.id };
}
/** A job of `live` verified applicants (more active weeks for a later ref) plus one flagged and one unverified, all read. */
async function readJob(programId: string, live: number) {
  const r = await reviewer(programId);
  const refs = [...[...Array(live)].map((_, i) => `l${i}`), 'f', 'u'];
  const j = await createJob({ programId, builderId: r.builderId, installationId: r.installationId, applicants: refs.map((ref) => ({ ref, name: ref, live_url: `https://${ref}.example/` })), now: NOW });
  for (const [i, ref] of refs.entries()) {
    const tier = ref === 'f' ? 'flagged' : ref === 'u' ? 'unverified' : 'live';
    await sql()`UPDATE screen_applicants SET status = 'done', tier = ${tier}, read_at = ${NOW}, line = ${`${ref} line`},
      rows = ${sql().json(weeks(i) as never)} WHERE job_id = ${j.id!} AND ref = ${ref}`;
  }
  return (page = 1) => jobResults(j.id!, r.builderId, NOW, page);
}

test('screen_v2 on: no ordinal on any applicant of a job with 9 verified', async () => {
  process.env.EARNKIT_FLAGS = 'screen_v2';
  const res = (await (await readJob('v2-nine', 9))())!;
  assert.equal(res.applicants.length, 10);
  for (const a of res.applicants) assert.ok(!('ordinal' in a) && !('ordinal_of' in a) && !('ordinal_reasons' in a));
  assert.doesNotMatch(JSON.stringify(res), /ordinal|\brank/);
});

test('screen_v2 on, 10 verified: ordinals across the job, sorted inside the tier; flagged before unverified', async () => {
  process.env.EARNKIT_FLAGS = 'screen_v2';
  const results = await readJob('v2-ten', 10);
  const one = (await results(1))!;
  const two = (await results(2))!;
  const all = [...one.applicants, ...two.applicants];
  assert.equal(all.find((a) => a.ref === 'l9')?.ordinal, 1);
  assert.equal(all.find((a) => a.ref === 'l9')?.ordinal_of, 10);
  assert.deepEqual(all.find((a) => a.ref === 'l9')?.ordinal_reasons, ['active 9 of 13 weeks']);
  assert.deepEqual(one.applicants.map((a) => a.ref), ['l9', 'l8', 'l7', 'l6', 'l5', 'l4', 'l3', 'l2', 'l1', 'l0']);
  assert.deepEqual(two.applicants.map((a) => a.tier), ['flagged', 'unverified']);
});

test('screen_v2 off: main\'s results exactly, no ordinal, unverified before flagged, queue order inside a tier', async () => {
  delete process.env.EARNKIT_FLAGS;
  const results = await readJob('v2-off', 10);
  const one = (await results(1))!;
  const two = (await results(2))!;
  for (const a of [...one.applicants, ...two.applicants]) assert.ok(!('ordinal' in a));
  assert.deepEqual(one.applicants.map((a) => a.ref), ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9']);
  assert.deepEqual(two.applicants.map((a) => a.tier), ['unverified', 'flagged']);
});

const files = (pkg: object) => ({ files: [{ path: 'package.json', text: JSON.stringify(pkg) }], tree: [{ path: 'pyproject.toml', type: 'blob' }], repo: { default_branch: 'main' } }) as unknown as Parameters<typeof packageNames>[0];

test('package names: a public root package.json name and a pyproject [project] name; private or bad names none', () => {
  assert.deepEqual(packageNames(files({ name: '@acme/kit' })), { npm: '@acme/kit', pyproject: true, branch: 'main' });
  assert.equal(packageNames(files({ name: 'kit', private: true })).npm, null);
  assert.equal(packageNames(files({ name: '../../etc' })).npm, null);
  assert.equal(pyprojectName('[tool.poetry]\nname = "other"\n[project]\nversion = "1"\nname = "acme-kit"\n[tool.x]\nname = "no"\n'), 'acme-kit');
  assert.equal(pyprojectName('[tool.poetry]\nname = "other"\n'), null);
  assert.ok(linksRepo(['git+https://github.com/Acme/Kit.git'], 'acme/kit'));
  assert.ok(!linksRepo(['https://github.com/acme/kit-fork'], 'acme/kit'));
});

test('readPackages: downloads only for a package whose registry links this repo; a stranger\'s is named, not counted', async () => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    if (u === 'https://registry.npmjs.org/@acme%2Fkit') return Response.json({ name: '@acme/kit', repository: { url: 'git+https://github.com/acme/kit.git' } });
    if (u === 'https://api.npmjs.org/downloads/point/last-month/@acme/kit') return Response.json({ downloads: 1234 });
    if (u === 'https://pypi.org/pypi/acme-kit/json') return Response.json({ info: { name: 'acme-kit', project_urls: { Source: 'https://github.com/someone/else' } } });
    return new Response('no', { status: 404 });
  }) as typeof fetch;
  const gh = (async () => new Response('[project]\nname = "acme-kit"\n')) as unknown as typeof fetch;
  const r = await readPackages('acme/kit', { npm: '@acme/kit', pyproject: true, branch: 'main' }, { gh, f });
  assert.deepEqual(r, { npm: '@acme/kit', npm_downloads_30d: 1234, pypi: null, pypi_downloads_30d: null, note: 'PyPI package acme-kit does not link this repo' });
  assert.ok(!calls.some((u) => u.includes('pypistats')));
  const down = await readPackages('acme/kit', { npm: '@acme/kit', pyproject: false, branch: 'main' }, { gh, f: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
  assert.equal(down.note, 'npm not read: registry unreachable');
});
