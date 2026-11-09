import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankGaps, rankReady } from './rank';
import type { Gap, Verdict } from './eligibility';
import type { ProgramRow } from './programs';
import { programFixture } from './fixtures/program';

const row = (id: string, over: Record<string, unknown> = {}): ProgramRow => ({
  id, file: programFixture({ id, ...over }), source: 'file', created_at: new Date(0), updated_at: new Date(0), verified_at: null, stale_since: null,
});
const v = (id: string, over: Partial<Verdict> = {}): Verdict => ({ program_id: id, status: 'ready', gaps: [], reason: null, long_shot: null, rules: [], ...over });
const gap = (effort: Gap['effort']): Gap => ({ kind: 'feature', item: 'feature:x', what: 'x', effort, agent_can: false });

test('rankReady: not long shot first, then bigger award with unknown last, then sooner deadline', () => {
  const programs = new Map([
    row('small', { max_award_usd: 1000 }), row('big', { max_award_usd: 9000 }), row('none'),
    row('long', { max_award_usd: 50000 }),
    row('soon', { max_award_usd: 1000, ends_at: '2026-12-01T00:00:00Z' }),
  ].map((r) => [r.id, r]));
  const out = rankReady([v('none'), v('long', { long_shot: 'few prizes for many entries' }), v('small'), v('soon'), v('big')], programs);
  assert.deepEqual(out.map((x) => x.program_id), ['big', 'soon', 'small', 'none', 'long']);
});

test('rankGaps: fewest gaps, then lowest effort, then money', () => {
  const programs = new Map([row('a', { max_award_usd: 100 }), row('b', { max_award_usd: 900 }), row('c'), row('d')].map((r) => [r.id, r]));
  const out = rankGaps(
    [v('a', { status: 'gap', gaps: [gap('days')] }), v('b', { status: 'gap', gaps: [gap('days')] }),
     v('c', { status: 'gap', gaps: [gap('minutes'), gap('hours')] }), v('d', { status: 'gap', gaps: [gap('minutes')] })],
    programs,
  );
  assert.deepEqual(out.map((x) => x.program_id), ['d', 'b', 'a', 'c']);
});
