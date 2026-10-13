import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../../..');
const manifest = (feature: string) =>
  readFileSync(join(ROOT, 'archive', feature, 'MANIFEST.txt'), 'utf8').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);

// Each archived feature and its own flag (spec 9). T14 adds 'starters'.
const ARCHIVED: Record<string, string> = { 'sponsor-campaigns': 'EARNKIT_SPONSOR_CAMPAIGNS' };
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

test('13.4 sponsor programs are filtered from the listing and getProgram while the flag is off', async () => {
  const programs = readFileSync(join(import.meta.dirname, 'programs.ts'), 'utf8');
  assert.match(programs, /archiveFlag\('SPONSOR_CAMPAIGNS'\)[\s\S]{0,120}IS DISTINCT FROM 'sponsor'/);
});
