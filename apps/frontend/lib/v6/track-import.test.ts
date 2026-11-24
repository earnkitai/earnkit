/**
 * v3.8 E10: the track import from the Jenil AI ledger export (fixture with the stale-row cases): a dry run writes
 * nothing, --apply writes the plan once (a second run is all unchanged), the hard rows land as the plan says, and a
 * grant with no program and no link is unresolved until --map names it.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { upsertProgram } from '../v5/programs';
import { programFixture } from '../v5/fixtures/program';
import { main, targetOf } from './track-import';
import { listTracked } from './track-states';
import { privatePrograms } from './private-programs';

after(() => sql().end());

const NOW = new Date('2026-11-24T09:00:00Z');
const FILE = join(__dirname, 'fixtures', 'jenil-ai-export.json');
const quiet = () => {};

async function owner() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'imp-' + Math.random()}) RETURNING id`;
  return `i:${r.id}`;
}
const count = async (o: string) => (await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${o}`)[0].n as number;

test('dry run by default: a plan and no writes; --apply writes it once; a second run is unchanged', async () => {
  await upsertProgram(programFixture({ id: 'ti-catalog', title: 'Catalog Grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'ti-linked', title: 'Linked Grant', submission_url: 'https://ti-link.example/apply' }), 'file', NOW);
  const o = await owner();
  const dry = await main(['--file', FILE, '--owner', o], quiet, NOW);
  assert.equal(await count(o), 0);
  assert.equal((await privatePrograms(o)).length, 0);
  assert.deepEqual(
    { grants: dry.summary.grants, create: dry.summary.create, not_imported: dry.summary.not_imported, unresolved: dry.summary.unresolved, hard: dry.summary.hard_rows },
    { grants: 10, create: 9, not_imported: 1, unresolved: 2, hard: 7 },
  );
  assert.equal(dry.lines.find((l) => l.grant === 'ti-catalog')?.program_id, 'ti-catalog');
  assert.equal(dry.lines.find((l) => l.grant === 'some-other-id')?.program_id, 'ti-linked', 'matched by its link');
  assert.equal(dry.lines.find((l) => l.grant === 'dup-of-catalog')?.action, 'not_imported');
  assert.deepEqual(dry.lines.filter((l) => l.action === 'unresolved').map((l) => l.grant).sort(), ['delphi', 'ship-or-die']);

  const applied = await main(['--file', FILE, '--owner', o, '--apply'], quiet, NOW);
  assert.equal(applied.summary.create, 9);
  assert.equal(await count(o), 9);
  assert.equal((await privatePrograms(o)).length, 7);
  const again = await main(['--file', FILE, '--owner', o, '--apply'], quiet, NOW);
  assert.equal(again.summary.unchanged, 9);
  assert.equal(again.summary.create + again.summary.update, 0);
  assert.equal(await count(o), 9);
});

test('the hard rows land as the plan says; credits keep no dollar amount', async () => {
  const o = await owner();
  await main(['--file', FILE, '--owner', o, '--apply', '--map', 'delphi=https://delphi.example/grants', '--map', 'ship-or-die=https://shipordie.example'], quiet, NOW);
  const page = await listTracked(o, null, { limit: 200 }, NOW);
  assert.ok(!('error' in page));
  const by = (title: string) => page.items.find((x) => x.title === title);
  assert.equal(by('Fe Builders Challenge')?.state, 'skipped');
  assert.equal(by('Delphi')?.state, 'skipped');
  assert.equal(by('PayPal AI Hackathon (Allowance)')?.state, 'applied');
  assert.equal(by('PayPal AI Hackathon (Allowance)')?.sent_at, '2026-11-12T00:00:00.000Z');
  assert.equal(by('Tavily for Startups')?.state, 'applied');
  assert.equal(by('Aiven for Startups')?.state, 'interview');
  assert.equal(by('soonami Venturethon 11')?.state, 'interview');
  assert.equal(by('Ship or Die')?.state, 'applied');
  assert.equal(by('Stellar SCF #46 Build Award')?.state, 'held');
  assert.equal(by('Cloud Credits')?.state, 'won');
  assert.equal(by('Cloud Credits')?.amount_usd, undefined);
  const [tavily] = await sql()`SELECT note FROM applications WHERE owner = ${o} AND title = 'Tavily for Startups'`;
  assert.match(tavily.note, /Kind: credits, not cash/);
  const [fe] = await sql()`SELECT note, sent_at FROM applications WHERE owner = ${o} AND title = 'Fe Builders Challenge'`;
  assert.match(fe.note, /never submitted; skipped by Jenil on Nov 24/);
});

test('a date-only deadline is never stored as an instant; an unknown --owner or --map is refused', async () => {
  const t = targetOf({ id: 'x', name: 'X', stage: 'held', deadline: '2026-11-24', kind: 'cash' });
  assert.match(t!.note, /Deadline 2026-11-24 \(date only, zone not given\)/);
  await assert.rejects(main(['--file', FILE, '--owner', 'jenil'], quiet, NOW), /--owner/);
  await assert.rejects(main(['--file', FILE, '--owner', 'i:1', '--map', 'delphi'], quiet, NOW), /--map/);
});
