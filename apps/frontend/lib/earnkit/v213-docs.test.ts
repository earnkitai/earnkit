import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('15.1 the guide, the map and the runbook name what v2.13 built', () => {
  const guide = read('docs/codebase-context/architecture-guide.md');
  assert.match(guide, /^## v2\.13 The Bench/m);
  for (const s of ['EARNKIT_BENCH', 'main_project_key', 'project_updates', 'weeklyFactsStep', 'feedRankStep', 'benchRank', 'feed:pin', 'raising_at', 'EARNKIT_SPLITS_BPS'])
    assert.ok(guide.includes(s), s);
  const map = read('docs/codebase-context/code-map.md');
  for (const f of ['weeks.ts', 'main-project.ts', 'week-facts.ts', 'update-text.ts', 'updates.ts', 'feed.ts', 'bench-rank.ts', 'bench-reply.ts', 'bench-find.ts', 'raising.ts', 'bench-data.ts', 'app/leaderboard', 'app/feed', 'scripts/feed.mts'])
    assert.ok(map.includes(f), f);
  const runbook = read('docs/design-docs-and-implementation-plans/v2.13-acceptance-runbook.md');
  for (let i = 1; i <= 7; i++) assert.match(runbook, new RegExp(`^## ${i}\\. `, 'm'), `section ${i}`);
  assert.doesNotMatch(runbook, /—/);
});
