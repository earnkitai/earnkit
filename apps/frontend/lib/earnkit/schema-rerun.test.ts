import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

/**
 * v2.12.2: db-migrate reruns all of schema.sql before every deploy. A CHECK dropped and re-added
 * twice must allow the same values both times: an earlier, shorter list fails on rows the later
 * list let in, and the deploy stops (production, 2026-10-15: builder_events_type_check).
 */
const SCHEMA = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');

function checkValues(body: string): string[] {
  return [...body.replace(/--[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

test('every CHECK the schema re-adds more than once allows the same values each time', () => {
  const adds = new Map<string, string[][]>();
  for (const m of SCHEMA.matchAll(/ADD CONSTRAINT (\w+)\s+CHECK \(([\s\S]*?)\)\);/g)) {
    adds.set(m[1], [...(adds.get(m[1]) ?? []), checkValues(m[2])]);
  }
  const repeated = [...adds].filter(([, lists]) => lists.length > 1);
  assert.ok(repeated.some(([name]) => name === 'builder_events_type_check'), 'the parser still sees the repeated adds');
  for (const [name, lists] of repeated) {
    for (const list of lists) assert.deepEqual(list, lists.at(-1), `${name}: every add allows the last add's values`);
  }
});
