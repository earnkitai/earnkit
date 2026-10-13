import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardRedirect, programOfRound } from './bonus-rounds';

const ROOT = join(import.meta.dirname, '../../../..');
const manifest = (feature: string) =>
  readFileSync(join(ROOT, 'archive', feature, 'MANIFEST.txt'), 'utf8').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);

// Each archived feature and its own flag (spec 9). program-leaderboards and tool-aliases join at their move (their READMEs).
const ARCHIVED: Record<string, string> = { 'sponsor-campaigns': 'EARNKIT_SPONSOR_CAMPAIGNS', starters: 'EARNKIT_STARTER_REGISTRY' };
for (const [feature, flag] of Object.entries(ARCHIVED)) {
  test(`13.1 ${feature}: every manifest path is in the archive and gone from the live tree; README names the flag`, () => {
    const paths = manifest(feature);
    assert.ok(paths.length > 0);
    for (const p of paths) {
      assert.ok(existsSync(join(ROOT, 'archive', feature, 'files', p)), `archived: ${p}`);
      assert.ok(!existsSync(join(ROOT, p)), `still live: ${p}`);
    }
    const readme = readFileSync(join(ROOT, 'archive', feature, 'README.md'), 'utf8');
    assert.match(readme, new RegExp(`${flag}=on`));
    assert.match(readme, /## What it did/);
    assert.match(readme, /## Restore/);
    assert.ok(existsSync(join(ROOT, 'archive', feature, 'TABLES.md')));
  });
}

test('13.2 with the flag off: no sponsor_campaign tool, no /fund, /award or check route, and nothing live imports an archived file', () => {
  for (const dir of ['apps/frontend/app/fund', 'apps/frontend/app/award', 'apps/frontend/app/api/sponsor']) assert.ok(!existsSync(join(ROOT, dir)), dir);
  const live = ['cron.ts', 'tools.ts', 'mcp.ts', 'bonus-ledger.ts'].map((f) => readFileSync(join(import.meta.dirname, f), 'utf8'));
  // The tool's name as code (a quoted name or an object key), not prose: mcp.ts:365's comment
  // "(as sponsor_campaign with escrow)" stays and must not fail this.
  for (const src of live) assert.doesNotMatch(src, /from '\.\/sponsor'|from '\.\/sponsor-text'|'sponsor_campaign'|\bsponsor_campaign:/);
});

test('13.3 the tables stay, commented, and receive no writes', () => {
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  for (const t of ['sponsor_campaigns', 'sponsor_verifications', 'chain_checks']) assert.match(schema, new RegExp(`COMMENT ON TABLE ${t} IS 'archived v2.12'`));
  assert.doesNotMatch(schema, /DROP TABLE/i);
  const identity = readFileSync(join(import.meta.dirname, 'identity.ts'), 'utf8');
  assert.match(identity, /archiveFlag\('SPONSOR_CAMPAIGNS'\)[\s\S]{0,200}UPDATE sponsor_campaigns/);
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('13.4 flag off: a sponsor program is absent from listPrograms and getProgram throws NotFound', dbTest, async () => {
  const { sql } = await import('./db');
  const { ProgramFile } = await import('./program-file');
  const { NotFoundError, getProgram, listPrograms, upsertProgram } = await import('./programs');
  const { committedProgram } = await import('./fixtures/program-file');
  const f = committedProgram('arc-microgrants');
  f.id = 't13-sponsor-row';
  await upsertProgram(ProgramFile.parse(f));
  try {
    assert.ok((await listPrograms()).some((p) => p.id === 't13-sponsor-row'), 'a curated row lists');
    await sql()`UPDATE programs SET campaign = '{"kind":"sponsor"}'::jsonb WHERE id = 't13-sponsor-row'`;
    assert.ok(!(await listPrograms()).some((p) => p.id === 't13-sponsor-row'));
    await assert.rejects(getProgram('t13-sponsor-row'), NotFoundError);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 't13-sponsor-row'`;
  }
});

test('13.5 flag off: verifySponsor returns its verdict and writes no sponsor_verifications row', dbTest, async () => {
  const { sql } = await import('./db');
  const { verifySponsor } = await import('./sponsor-verify');
  const wallet = '0x' + '7'.repeat(40);
  const host = 't13-no-such-host.invalid';
  const v = await verifySponsor(host, wallet);
  assert.equal(v.verified, false);
  const rows = await sql()`SELECT 1 FROM sponsor_verifications WHERE host = ${host}`;
  assert.equal(rows.length, 0);
});

test('13.6 flag off: pnpm campaign refund and fallback refuse in one line; other commands and the flag-on case pass', async () => {
  const { sponsorCommandBlock } = await import('./sponsor-cli');
  for (const c of ['refund', 'fallback']) {
    const m = sponsorCommandBlock(c, {});
    assert.ok(m && !m.includes('\n') && m.includes('EARNKIT_SPONSOR_CAMPAIGNS=on'), c);
    assert.equal(sponsorCommandBlock(c, { EARNKIT_SPONSOR_CAMPAIGNS: 'on' }), null);
  }
  for (const c of ['golive', 'rank', 'payout', 'sync', 'veto-link']) assert.equal(sponsorCommandBlock(c, {}), null, c);
});

test('13.7 the agent-facing docs do not offer the sponsor tool', () => {
  assert.doesNotMatch(readFileSync(join(ROOT, 'apps/frontend/public/llms.txt'), 'utf8'), /sponsor_campaign/);
  assert.doesNotMatch(readFileSync(join(ROOT, 'README.md'), 'utf8'), /`sponsor_campaign`/);
});

test('14.1 boards: v2.11 with the score flag off; on, a round in review stays public (D1) and every other board moves to /leaderboard?program=<id>', () => {
  assert.equal(programOfRound('arc-microgrants:2026-09-16'), 'arc-microgrants');
  assert.equal(programOfRound('base-builder-grants:2026-10'), 'base-builder-grants');
  assert.equal(programOfRound('no-date-here'), null);
  const on = { EARNKIT_BUILDER_SCORE: 'on' };
  assert.equal(boardRedirect({ program: 'arc-microgrants', inReview: false }, {}), null, 'flag off: v2.11');
  assert.equal(boardRedirect({ program: 'arc-microgrants', inReview: true }, on), null, 'in review: the board stays public');
  assert.equal(boardRedirect({ program: 'arc-microgrants', inReview: false }, on), '/leaderboard?program=arc-microgrants');
  assert.equal(boardRedirect({ program: null, inReview: false }, on), null, 'no program: the page answers as today');
  assert.equal(boardRedirect({ program: 'arc-microgrants', inReview: false }, { ...on, EARNKIT_PROGRAM_LEADERBOARDS: 'on' }), null, 'boards restored');
  for (const f of ['app/bonus/[round]/page.tsx', 'app/campaigns/[slug]/page.tsx']) {
    const src = readFileSync(join(ROOT, 'apps/frontend', f), 'utf8');
    assert.match(src, /boardRedirect\(/, f);
    assert.match(src, /permanentRedirect\(/, f);
  }
  const readme = readFileSync(join(ROOT, 'archive/program-leaderboards/README.md'), 'utf8');
  assert.match(readme, /EARNKIT_PROGRAM_LEADERBOARDS=on/);
  assert.match(readme, /## The move, at go-live/);
});

test('14.5 archive-restore names each feature\'s own flag, read from its README', async () => {
  const { flagOf } = await import('../../scripts/archive-restore.mjs');
  for (const [feature, flag] of Object.entries(ARCHIVED)) assert.equal(flagOf(feature, ROOT), flag, feature);
  assert.equal(flagOf('program-leaderboards', ROOT), 'EARNKIT_PROGRAM_LEADERBOARDS');
  assert.equal(flagOf('tool-aliases', ROOT), 'EARNKIT_TOOL_ALIASES');
});

test('14.2 the traction scorer, bonus payouts and the round board stay live (R20, D1)', () => {
  for (const f of ['traction.ts', 'bonus-payout.ts', 'bonus-ledger.ts', 'bonus-rounds.ts', 'bonus-board.ts']) assert.ok(existsSync(join(import.meta.dirname, f)), f);
  assert.ok(existsSync(join(ROOT, 'apps/frontend/app/bonus/[round]/BoardView.tsx')));
});

after(async () => {
  if (process.env.DATABASE_URL) await (await import('./db')).sql().end();
});
