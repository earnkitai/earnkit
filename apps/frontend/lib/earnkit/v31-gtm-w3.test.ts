import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { padPool } from './fixtures/rank-pool';
import { onBaseKnown } from './base-qualify';
import { reportedName } from './project-name';

// v3.1 GTM W3 (credibility): the DB halves of the Base step and the builder-given name.
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('a project known on Base (its chains or a reported Base contract) skips "Put your app on Base"', db, async () => {
  const [a, b, c] = await padPool(3);
  const keyOf = async (id: number) => (await sql()<{ k: string }[]>`SELECT main_project_key AS k FROM builder_profiles WHERE builder_id = ${id}`)[0].k;
  await sql()`UPDATE builder_projects SET chains = '{base}' WHERE builder_id = ${a}`;
  const kb = await keyOf(b);
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by) VALUES (${b}, 'contract', 'base:0x7a1f0e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7', ${kb}, 'proposed', 'agent')`;
  assert.equal(await onBaseKnown(a, await keyOf(a)), true);
  assert.equal(await onBaseKnown(b, kb), true);
  assert.equal(await onBaseKnown(c, await keyOf(c)), false);
});

test('the builder-given name is read from the stored identity, matched loosely', db, async () => {
  const [id] = await padPool(1);
  await sql()`UPDATE builder_profiles SET identity = ${sql().json({ projects: [{ name: 'MealMate', live_url: 'https://mealmate.lovable.app' }] } as never)} WHERE builder_id = ${id}`;
  assert.equal(await reportedName(id, 'https://mealmate.lovable.app/'), 'MealMate');
  assert.equal(await reportedName(id, 'someone/else'), null);
});
