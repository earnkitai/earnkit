import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notNever, pickProject } from './find-record';
import { EMPTY_RECORD, mergeRecord } from './record';
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

test('C41: the record project is picked by project_id, repo or name; another project is never stood in', () => {
  const r = mergeRecord(EMPTY_RECORD, { projects: [
    { id: 'one', name: 'Project One', repo_url: 'https://github.com/a/one' },
    { id: 'two', name: 'Project Two' },
  ] }, 'builder', new Date('2026-11-06T12:00:00Z')).record;
  assert.equal(pickProject(r, 'two', null)?.id, 'two');
  assert.equal(pickProject(r, undefined, 'https://github.com/A/one/')?.id, 'one');
  assert.equal(pickProject(r, undefined, null, ' project two ')?.id, 'two');
  assert.equal(pickProject(r, undefined, null, 'Project Three'), null);
  assert.equal(pickProject(r, undefined, null), null);
});
