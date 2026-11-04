import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { track } from './track';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
async function ctx() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'track-' + Math.random()}) RETURNING id`;
  return { installationId: r.id as number, now: NOW };
}

test('the six replies', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-a', title: 'Alpha Grant', max_award_usd: 9000 }), 'file', NOW);
  const say = async (input: unknown) => (await track(c, input)).show_to_builder;
  assert.equal(await say({ program_id: 't6-a', status: 'applied' }), "Tracked. I'll ask how it went when results are due.");
  assert.equal(await say({ program_id: 't6-a', status: 'won', amount_usd: 5000 }), 'Recorded: $5,000 from Alpha Grant.');
  assert.equal(await say({ program_id: 't6-a', status: 'rejected' }), 'Recorded. On to the next one.');
  assert.equal(await say({ program_id: 't6-a', status: 'no_result' }), 'Recorded.');
  assert.equal(await say({ program_id: 't6-a', status: 'skipped' }), "Skipped Alpha Grant. I won't bring it up again.");
  assert.equal(await say({ program_id: 't6-a', status: 'gap_done', item: 'x' }), 'Noted. I\'ll re-check the repo on the next look.');
  const r = await track(c, { program_id: 't6-a', status: 'applied' });
  assert.equal(r.agent_note, 'Call find again for the updated ledger.');
  assert.equal(r.ledger.applied, 1);
});

test('refusals say so and record nothing', async () => {
  const c = await ctx();
  const r = await track(c, { program_id: 'nope-x', status: 'applied' });
  assert.equal(r.agent_note, 'Nothing was recorded.');
  assert.ok(r.show_to_builder.length > 0);
  const w = await track(c, { program_id: 'nope-x', status: 'won' });
  assert.equal(w.agent_note, 'Nothing was recorded.');
  const u = await track(c, { program_id: 'nope-x', status: 'applied', extra: 1 });
  assert.equal(u.agent_note, 'Nothing was recorded.');
  const long = await track(c, { program_id: 'nope-x', status: 'applied', note: 'x'.repeat(281) });
  assert.equal(long.agent_note, 'Nothing was recorded.');
  const n = (await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
});
