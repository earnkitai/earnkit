/**
 * v3.8 E10: the track import from the Jenil AI ledger export (fixture with the stale-row cases): a dry run writes
 * nothing, --apply writes the plan once (a second run is all unchanged), the hard rows land as the plan says, and a
 * grant with no catalog program is unresolved until --map names one (private rows with `private_rows` on:
 * private-programs.test.ts).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { flagsOn } from '../v5/flags';
import { upsertProgram } from '../v5/programs';
import { programFixture } from '../v5/fixtures/program';
import { main, targetOf } from './track-import';
import { listTracked } from './track-states';

after(() => sql().end());

const NOW = new Date('2026-11-24T09:00:00Z');
const FILE = join(__dirname, 'fixtures', 'jenil-ai-export.json');
const quiet = () => {};

async function owner() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'imp-' + Math.random()}) RETURNING id`;
  return `i:${r.id}`;
}
/** A catalog program for each fixture grant the hard-row test needs, matched by its link (`submission_url`). */
const LINKED: [string, string][] = [
  ['ti-fe', 'https://fe.example/challenge'], ['ti-paypal', 'https://paypal.example/hack'], ['ti-tavily', 'https://tavily.example/startups'],
  ['ti-aiven', 'https://aiven.example/startups'], ['ti-soonami', 'https://soonami.example/v11'], ['ti-stellar', 'https://stellar.example/scf'],
  ['ti-cloud', 'https://cloud.example/credits'], ['ti-delphi', 'https://delphi.example/grants'], ['ti-shipordie', 'https://shipordie.example'],
];
const count = async (o: string) => (await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${o}`)[0].n as number;

test('dry run by default: a plan and no writes; --apply writes it once; a second run is unchanged', async () => {
  // v3.8 flags-on suite: this plan is the private_rows-off one (unresolved until --map, no private fields; on is
  // private-programs.test.ts), so private_rows alone is turned off here; every other flag stays as the run set it.
  const saved = process.env.EARNKIT_FLAGS;
  process.env.EARNKIT_FLAGS = flagsOn().filter((f) => f !== 'private_rows').join(',');
  try {
    await upsertProgram(programFixture({ id: 'ti-catalog', title: 'Catalog Grant' }), 'file', NOW);
    await upsertProgram(programFixture({ id: 'ti-linked', title: 'Linked Grant', submission_url: 'https://ti-link.example/apply' }), 'file', NOW);
    const o = await owner();
    const dry = await main(['--file', FILE, '--owner', o], quiet, NOW);
    assert.equal(await count(o), 0);
    assert.deepEqual(
      { grants: dry.summary.grants, create: dry.summary.create, not_imported: dry.summary.not_imported, unresolved: dry.summary.unresolved, hard: dry.summary.hard_rows },
      { grants: 10, create: 2, not_imported: 1, unresolved: 9, hard: 7 },
    );
    assert.equal(dry.lines.find((l) => l.grant === 'ti-catalog')?.program_id, 'ti-catalog');
    assert.equal(dry.lines.find((l) => l.grant === 'some-other-id')?.program_id, 'ti-linked', 'matched by its link');
    assert.equal(dry.lines.find((l) => l.grant === 'dup-of-catalog')?.action, 'not_imported');
    assert.equal(dry.lines.find((l) => l.grant === 'stellar-scf-46')?.why, 'no catalog program: pass --map');
    // v3.8 E8: with private_rows off, no line or summary field speaks of private rows.
    assert.equal('private_rows' in dry.summary, false);
    assert.ok(dry.lines.every((l) => !('private' in l)));
    assert.ok(['delphi', 'ship-or-die'].every((g) => dry.lines.find((l) => l.grant === g)?.action === 'unresolved'));

    const applied = await main(['--file', FILE, '--owner', o, '--apply'], quiet, NOW);
    assert.equal(applied.summary.create, 2);
    assert.equal(await count(o), 2);
    const again = await main(['--file', FILE, '--owner', o, '--apply'], quiet, NOW);
    assert.equal(again.summary.unchanged, 2);
    assert.equal(again.summary.create + again.summary.update, 0);
    assert.equal(await count(o), 2);
  } finally {
    if (saved === undefined) delete process.env.EARNKIT_FLAGS;
    else process.env.EARNKIT_FLAGS = saved;
  }
});

test('the hard rows land as the plan says; credits keep no dollar amount', async () => {
  for (const [id, url] of LINKED) await upsertProgram(programFixture({ id, title: `Program ${id}`, submission_url: url }), 'file', NOW);
  const o = await owner();
  const r = await main(['--file', FILE, '--owner', o, '--apply', '--map', 'delphi=https://delphi.example/grants', '--map', 'ship-or-die=https://shipordie.example'], quiet, NOW);
  assert.equal(r.summary.unresolved, 0);
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
