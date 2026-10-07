import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { projectKey, readBank, saveBank } from './answer-bank';
import { sql } from './db';
import type { SubmissionRequirement } from './program-file';

// Against the local database when configured.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const reqs: SubmissionRequirement[] = [
  { key: 'traction', label: 'Traction', type: 'text', required: true, from: 'builder', kind: 'traction' },
  { key: 'why', label: 'Why you', type: 'text', required: true, from: 'builder', kind: 'why_you' },
  { key: 'track', label: 'Track', type: 'text', required: true, from: 'project', kind: 'other' },
];

test('projectKey: the normalized repo, else name:<lowercased trimmed name>', () => {
  assert.equal(projectKey({ repo_url: 'https://github.com/A/TipJar.git', name: 'x' }), 'github.com/a/tipjar');
  assert.equal(projectKey({ name: 'TipJar' }), 'name:tipjar');
  assert.equal(projectKey({ name: 'tipjar ' }), 'name:tipjar');
  assert.equal(projectKey({ repo_url: '  ', name: 'TipJar' }), 'name:tipjar');
});

test('9.8 Ruling 6: keyed by project, never across installations; the latest save wins; other is not stored', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const inst = async (tag: string) =>
    (await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t9-bank-${tag}-${stamp}`}) RETURNING id`)[0].id;
  const a = await inst('a');
  const b = await inst('b');
  const repoKey = projectKey({ repo_url: `https://github.com/a/tipjar-${stamp}`, name: 'TipJar' });
  const nameKey = projectKey({ name: 'TipJar' });
  assert.equal(projectKey({ name: 'tipjar ' }), nameKey);
  assert.equal(nameKey, 'name:tipjar');

  await saveBank(a, repoKey, 'prog-1', reqs, { traction: '40 users', why: 'I shipped two apps', track: 'Consumer' });
  await saveBank(a, nameKey, 'prog-1', reqs, { traction: '7 users' });
  await saveBank(a, projectKey({ name: 'tipjar ' }), 'prog-2', reqs, { why: 'Name-only why' });

  const byRepo = await readBank(a, repoKey);
  assert.deepEqual(Object.fromEntries(byRepo), { traction: '40 users', why_you: 'I shipped two apps' });
  // "TipJar" and "tipjar " are one project; separate from the repo-keyed one.
  assert.deepEqual(Object.fromEntries(await readBank(a, nameKey)), { traction: '7 users', why_you: 'Name-only why' });
  // Another installation sees none of it.
  assert.equal((await readBank(b, repoKey)).size, 0);
  assert.equal((await readBank(b, nameKey)).size, 0);
  // The latest save per kind wins, and it records the program.
  await saveBank(a, repoKey, 'prog-3', reqs, { traction: '120 users' });
  assert.equal((await readBank(a, repoKey)).get('traction'), '120 users');
  assert.equal((await readBank(a, repoKey)).get('why_you'), 'I shipped two apps');
  const rows = await sql()<{ kind: string; program_id: string }[]>`
    SELECT kind, program_id FROM answer_bank WHERE installation_id = ${a} AND project_key = ${repoKey} ORDER BY kind`;
  assert.deepEqual(rows.map((r) => [r.kind, r.program_id]), [['traction', 'prog-3'], ['why_you', 'prog-1']]);
  // other is never stored, for any project.
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM answer_bank WHERE installation_id = ${a} AND kind = 'other'`;
  assert.equal(n, 0);
  // An answer over the limit is left out, never an error.
  await saveBank(a, repoKey, 'prog-4', reqs, { traction: 'x'.repeat(5000) });
  assert.equal((await readBank(a, repoKey)).get('traction'), '120 users');
});
