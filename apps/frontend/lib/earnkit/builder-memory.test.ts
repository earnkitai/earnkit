import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { readStats } from './stats';
import { NotFoundError, upsertProgram } from './programs';
import { ProgramFile } from './program-file';
import { committedProgram } from './fixtures/program-file';
import {
  TellInput,
  emptyMemory,
  hiddenPrograms,
  memoryKey,
  mergeSaid,
  readMemory,
  roundLabel,
  saidKey,
  tell,
  type BuilderMemory,
} from './builder-memory';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const at = new Date('2026-10-08T12:00:00Z');
const arc = { id: 'arc-microgrants', starts_at: null, ends_at: new Date('2026-10-15T03:59:00Z'), opened_at: new Date('2026-09-01T00:00:00Z') };
const base = { id: 'base-builder-grants', starts_at: null, ends_at: null, opened_at: null };

const memory = (programs: [string, 'applied' | 'not_interested', string | null][]): BuilderMemory => ({
  ...emptyMemory(),
  programs: new Map(programs.map(([id, status, round_label]) => [id, { status, round_label, at }])),
});

test('3.5 hiddenPrograms: applied hides the current round only; not interested hides for good', () => {
  const m = memory([
    ['arc-microgrants', 'applied', roundLabel(arc)],
    ['base-builder-grants', 'not_interested', null],
  ]);
  const now = hiddenPrograms(m, [arc, base]);
  assert.deepEqual([...now.applied], ['arc-microgrants']);
  assert.deepEqual([...now.notInterested], ['base-builder-grants']);
  // A new round: the deadline moved.
  const moved = hiddenPrograms(m, [{ ...arc, ends_at: new Date('2026-11-15T03:59:00Z') }, base]);
  assert.equal(moved.applied.size, 0);
  // Or the program opened again after the statement.
  const reopened = hiddenPrograms(m, [{ ...arc, opened_at: new Date('2026-10-09T00:00:00Z') }, { ...base, opened_at: new Date('2027-01-01') }]);
  assert.equal(reopened.applied.size, 0);
  assert.deepEqual([...reopened.notInterested], ['base-builder-grants']);
  // A program no longer open is simply not there.
  assert.equal(hiddenPrograms(m, []).applied.size, 0);
  assert.equal(roundLabel(arc), '|2026-10-15T03:59:00.000Z');
  assert.equal(roundLabel(base), '|');
});

test('TellInput: strict, at most 20 items, chains read like local_repos, a placeholder link is dropped', () => {
  const p = TellInput.parse({ repo_facts: [{ repo: 'alice/tipjar', mainnet_chains: ['Base', 'monad'], testnet_chains: ['arc sepolia', 'nochain'], live_url: 'example.com' }] });
  assert.deepEqual(p.repo_facts![0].mainnet_chains, [{ chain: 'base', mainnet: true }, { chain: 'monad', mainnet: true }]);
  assert.deepEqual(p.repo_facts![0].testnet_chains!.map((c) => c.chain), ['arc']);
  assert.equal(p.repo_facts![0].live_url, undefined);
  assert.throws(() => TellInput.parse({}));
  assert.throws(() => TellInput.parse({ program_status: [{ program_id: 'x', status: 'won', extra: 1 }] }));
  assert.throws(() => TellInput.parse({ repo_facts: [{ repo: 'x'.repeat(301) }] }));
  assert.throws(() => TellInput.parse({ program_status: Array.from({ length: 21 }, () => ({ program_id: 'x', status: 'applied' })) }));
  assert.equal(saidKey('https://github.com/Alice/TipJar'), 'alice/tipjar');
  assert.equal(saidKey('alice/tipjar'), 'alice/tipjar');
  assert.equal(saidKey('TipJar'), 'name:tipjar');
  // The latest statement about a chain wins; testnet wins within one statement.
  const first = mergeSaid(null, TellInput.parse({ repo_facts: [{ repo: 'x', testnet_chains: ['arc'], has_users: true }] }).repo_facts![0]);
  const later = mergeSaid(first, TellInput.parse({ repo_facts: [{ repo: 'x', mainnet_chains: ['arc'] }] }).repo_facts![0]);
  assert.deepEqual([later.mainnet, later.testnet, later.has_users], [['arc'], [], true]);
  const both = mergeSaid(null, TellInput.parse({ repo_facts: [{ repo: 'x', mainnet_chains: ['arc'], testnet_chains: ['arc'] }] }).repo_facts![0]);
  assert.deepEqual([both.mainnet, both.testnet], [[], ['arc']]);
});

test('3.6 tell: outcomes are self-reports on the own newest entry (lost is not_selected); another installation\'s entry stores nothing; never in stats', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // A clone of Arc Microgrants under a test id (the real row is left alone).
  const arcId = `arc-microgrants-t3-${stamp}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('arc-microgrants'), id: arcId, status: 'active', ends_at: '2099-01-01T00:00:00Z' }));
  const inst = async (tag: string) =>
    (await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t3-${tag}-${stamp}`}) RETURNING id`)[0].id;
  const mine = await inst('a');
  const other = await inst('b');
  const none = await inst('c');
  const entry = async (installation: number, name: string, submitted: string) =>
    (await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, submitted_at)
      VALUES (${arcId}, ${name}, ${installation}, ${submitted}) RETURNING id`)[0].id;
  const older = await entry(mine, 'Old', '2026-09-01T00:00:00Z');
  const newest = await entry(mine, 'TipJar', '2026-10-01T00:00:00Z');
  const theirs = await entry(other, 'Theirs', '2026-10-02T00:00:00Z');
  const outcomes = (id: number) =>
    sql()<{ basis: string; result: string; prize_usd: string | null }[]>`
      SELECT basis, result, prize_usd::text FROM entry_outcomes WHERE project_id = ${id}`;
  try {
    const before = await readStats();
    const r = await tell(mine, { program_status: [{ program_id: arcId, status: 'won', prize_usd: 500 }] });
    assert.equal(r.saved.length, 1);
    assert.deepEqual([...(await outcomes(newest))], [{ basis: 'self_reported', result: 'won', prize_usd: '500' }]);
    assert.equal((await outcomes(older)).length, 0);
    await tell(mine, { program_status: [{ program_id: arcId, status: 'lost', project_id: older }] });
    assert.deepEqual([...(await outcomes(older))], [{ basis: 'self_reported', result: 'not_selected', prize_usd: null }]);
    // Another installation's entry: a plain NotFoundError, and nothing of the call is stored.
    await assert.rejects(
      tell(mine, {
        program_status: [
          { program_id: arcId, status: 'not_interested' },
          { program_id: arcId, status: 'won', project_id: theirs },
        ],
      }),
      NotFoundError,
    );
    assert.equal((await outcomes(theirs)).length, 0);
    assert.equal((await readMemory(mine)).programs.size, 0);
    // No entry at all in that program: the same error.
    await assert.rejects(tell(none, { program_status: [{ program_id: arcId, status: 'won' }] }), NotFoundError);
    // A self-report never counts in public figures.
    const afterStats = await readStats();
    assert.equal(afterStats.entries_won, before.entries_won);
    assert.equal(afterStats.labelled_entries, before.labelled_entries);

    // applied, not interested and repo facts are read back.
    await tell(mine, {
      program_status: [{ program_id: arcId, status: 'applied' }],
      repo_facts: [{ repo: 'https://github.com/alice/tipjar', testnet_chains: ['arc'], live_url: 'tipjar.xyz', has_users: true }],
    });
    const m = await readMemory(mine);
    const [row] = await sql()<{ starts_at: Date | null; ends_at: Date | null }[]>`SELECT starts_at, ends_at FROM programs WHERE id = ${arcId}`;
    assert.deepEqual({ ...m.programs.get(arcId), at: undefined }, { status: 'applied', round_label: roundLabel(row), at: undefined });
    assert.deepEqual(m.repos.get('alice/tipjar'), { mainnet: [], testnet: ['arc'], live_url: 'https://tipjar.xyz', has_users: true, not_mine: false });
    // A later statement keeps what it doesn't name.
    await tell(mine, { repo_facts: [{ repo: 'alice/tipjar', not_mine: true }] });
    assert.deepEqual((await readMemory(mine)).repos.get('alice/tipjar'), { mainnet: [], testnet: ['arc'], live_url: 'https://tipjar.xyz', has_users: true, not_mine: true });
    // An unknown program is refused.
    await assert.rejects(tell(mine, { program_status: [{ program_id: `nope-${stamp}`, status: 'applied' }] }), NotFoundError);
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${arcId}`;
    await sql()`DELETE FROM installations WHERE id IN (${mine}, ${other}, ${none})`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${arcId}`;
  }
});

test('Ruling G6: a shared client has no memory key; an installation of its own does', () => {
  assert.equal(memoryKey({ installationId: 7, sharedClient: true }), null);
  assert.equal(memoryKey({ installationId: 7 }), 7);
  assert.equal(memoryKey({ installationId: 7, sharedClient: false }), 7);
});
