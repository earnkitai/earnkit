import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notNever } from './find-record';
import { EMPTY_RECORD } from './record';
import type { ProgramRow } from '../v5/programs';

const row = (id: string, title: string) => ({ id, file: { title } }) as unknown as ProgramRow;

test('programs to skip match the title or the slug, any case, with spaces trimmed (lane 5, 3.27)', () => {
  const rec = { ...EMPTY_RECORD, policy: { ...EMPTY_RECORD.policy, never: ['  base builder grants ', 'Z-FELLOWS'] } };
  const keep = notNever(rec);
  assert.equal(keep(row('base-builder-grants', 'Base Builder Grants')), false);
  assert.equal(keep(row('z-fellows', 'Z Fellows')), false);
  assert.equal(keep(row('thiel-fellowship', 'Thiel Fellowship')), true);
  assert.equal(notNever({ ...EMPTY_RECORD, policy: { ...EMPTY_RECORD.policy, never: [''] } })(row('a', 'A')), true);
});
