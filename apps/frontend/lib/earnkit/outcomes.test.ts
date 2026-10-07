import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { readStats } from './stats';
import {
  OutcomeFile,
  ReportOutcome,
  matchOutcome,
  matchOutcomeAll,
  outcomeQuestion,
  syncOutcomeFile,
  winLine,
  type EntryRef,
} from './outcomes';

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const entries: EntryRef[] = [
  { id: 1, repo_url: 'https://github.com/a/tipjar.git', name: 'TipJar', live_url: 'https://www.tipjar.example/app/' },
  { id: 2, repo_url: 'https://github.com/b/nanocrawl', name: 'NanoCrawl', live_url: null },
  { id: 3, repo_url: null, name: 'Twin', live_url: null },
  { id: 4, repo_url: null, name: 'twin ', live_url: null },
];

test('matchOutcome: a repo matches in any form (normalized)', () => {
  assert.equal(matchOutcome({ repo: 'github.com/A/TipJar' }, entries), 1);
  assert.equal(matchOutcome({ repo: 'https://github.com/a/tipjar/' }, entries), 1);
  assert.equal(matchOutcome({ repo: 'github.com/x/unknown' }, entries), null);
});

test('matchOutcome: a live link matches by host and path, ignoring www. and a trailing slash', () => {
  assert.equal(matchOutcome({ live_url: 'tipjar.example/app' }, entries), 1);
  assert.equal(matchOutcome({ live_url: 'https://TipJar.example/app' }, entries), 1);
  assert.equal(matchOutcome({ live_url: 'https://tipjar.example/other' }, entries), null);
});

test('matchOutcome: a name matches case-insensitively only when exactly one entry has it', () => {
  assert.equal(matchOutcome({ name: 'nanocrawl' }, entries), 2);
  assert.equal(matchOutcome({ name: '  NANOCRAWL ' }, entries), 2);
  assert.equal(matchOutcome({ name: 'Twin' }, entries), null, 'two entries share the name, no other key');
  assert.equal(matchOutcome({ name: 'Nobody' }, entries), null);
});

test('matchOutcome: the repo wins over the name when both are given and disagree', () => {
  assert.equal(matchOutcome({ repo: 'github.com/b/nanocrawl', name: 'TipJar' }, entries), 2);
  // A repo that matches nothing is no match, even if the name would match.
  assert.equal(matchOutcome({ repo: 'github.com/z/z', name: 'TipJar' }, entries), null);
  // A live link that misses falls back to the name.
  assert.equal(matchOutcome({ live_url: 'https://nope.example', name: 'TipJar' }, entries), 1);
});

test('winLine: money first with the prize; without one, the name and the program', () => {
  assert.equal(winLine({ prize_usd: 500, program_title: 'Arc Microgrants', name: 'TipJar' }), 'you won $500 in Arc Microgrants with TipJar');
  assert.equal(winLine({ prize_usd: 10000, program_title: 'Avalanche Team1 Mini Grants', name: 'TipJar' }), 'you won $10,000 in Avalanche Team1 Mini Grants with TipJar');
  assert.equal(winLine({ prize_usd: null, program_title: 'Arc Microgrants', name: 'TipJar' }), 'TipJar won in Arc Microgrants');
});

test('outcomeQuestion is the spec\'s question', () => {
  assert.equal(outcomeQuestion('TipJar', 'Arc Microgrants'), 'Did TipJar win anything in Arc Microgrants?');
});

const file = {
  program_id: 'arc-microgrants',
  round_label: 'Arc Microgrants 2026',
  source_url: 'https://community.arc.io/x',
  captured_at: '2026-10-22',
  complete: true,
  entries_until: '2026-10-14',
  results: [{ repo: 'github.com/a/tipjar', result: 'won', prize_usd: 500 }],
};

test('OutcomeFile: parses a valid file; refuses a result naming nothing, a non-https source, an unknown result', () => {
  assert.ok(OutcomeFile.safeParse(file).success);
  const noKey = OutcomeFile.safeParse({ ...file, results: [{ result: 'won' }] });
  assert.ok(!noKey.success);
  assert.ok(noKey.error.issues.some((i) => i.message === 'each result names a repo, name or live link'));
  assert.ok(!OutcomeFile.safeParse({ ...file, source_url: 'http://community.arc.io/x' }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, results: [{ name: 'X', result: 'champion' }] }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, results: [] }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, captured_at: 'Oct 22' }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, results: [{ name: 'X', result: 'won', prize_usd: -1 }] }).success);
  // Ruling C22: complete is required (the routine says whether every winner is named).
  const { complete: _c, ...noComplete } = file;
  void _c;
  assert.ok(!OutcomeFile.safeParse(noComplete).success);
  // Final review I4: a complete file names its round's window (entries_until); a partial one may not.
  const { entries_until: _u, ...noUntil } = file;
  void _u;
  const refused = OutcomeFile.safeParse(noUntil);
  assert.ok(!refused.success);
  assert.ok(refused.error.issues.some((i) => i.path.join('.') === 'entries_until'));
  assert.ok(OutcomeFile.safeParse({ ...noUntil, complete: false }).success);
  assert.ok(OutcomeFile.safeParse({ ...file, entries_from: '2026-09-15' }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, entries_from: '2026-10-15' }).success, 'from after until');
  assert.ok(!OutcomeFile.safeParse({ ...file, entries_until: 'Oct 14' }).success);
});

test('ReportOutcome: the builder reports won, placed, finalist or not_selected; never unknown', () => {
  assert.ok(ReportOutcome.safeParse({ project_id: 1, result: 'won', prize_usd: 500 }).success);
  assert.ok(!ReportOutcome.safeParse({ project_id: 1, result: 'unknown' }).success);
  assert.ok(!ReportOutcome.safeParse({ project_id: 0, result: 'won' }).success);
  assert.ok(!ReportOutcome.safeParse({ project_id: 1, result: 'won', basis: 'announcement' }).success);
});

test('matchOutcomeAll: every entry of a named repo or live link (two entries of one repo both match)', () => {
  const twins: EntryRef[] = [...entries, { id: 5, repo_url: 'github.com/a/TipJar', name: 'TipJar test', live_url: null }];
  assert.deepEqual(matchOutcomeAll({ repo: 'github.com/a/tipjar' }, twins), [1, 5]);
  assert.equal(matchOutcome({ repo: 'github.com/a/tipjar' }, twins), 1);
  assert.deepEqual(matchOutcomeAll({ name: 'Twin' }, twins), []);
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('Ruling C22: a complete list labels every other submitted entry not_selected; a partial one, unknown (never counted)', dbTest, async () => {
  const tag = `outcomes-c22-${process.pid}-${Date.now()}`;
  const Rollback = new Error('rollback');
  try {
    await sql().begin('isolation level repeatable read', async (tx) => {
      const [{ id: inst }] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
      await tx`
        INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
        VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'allowed')`;
      const entry = async (name: string, repo: string | null, o: { confirmed?: boolean; at?: string } = {}) =>
        (await tx<{ id: number }[]>`
          INSERT INTO projects (program_id, name, installation_id, repo_url, confirmed_at, confirm_choice, submitted_at)
          VALUES (${tag}, ${name}, ${inst}, ${repo}, ${o.confirmed ? new Date() : null}, ${o.confirmed ? 'go' : null},
            ${o.at ?? '2026-10-10T00:00:00Z'}) RETURNING id`)[0].id;
      const winner = await entry('Winner', 'https://github.com/a/win');
      const winnerTwin = await entry('Winner again', 'https://github.com/a/win.git');
      const other = await entry('Other', 'https://github.com/a/other');
      const unsent = await entry('Unsent', 'https://github.com/a/unsent', { confirmed: true });
      const later = await entry('Later', 'https://github.com/a/later', { at: '2026-11-01T00:00:00Z' });
      const rows = async () =>
        new Map((await tx<{ project_id: number; result: string }[]>`
          SELECT project_id, result FROM entry_outcomes WHERE program_id = ${tag} AND basis = 'announcement'`).map((r) => [r.project_id, r.result]));
      const before = await readStats(new Date(), tx);
      const f = (complete: boolean, round: string) => ({
        program_id: tag, round_label: round, source_url: 'https://x.example/results', captured_at: '2026-10-22', complete,
        entries_until: '2026-10-22',
        results: [{ repo: 'github.com/a/win', result: 'won' as const, prize_usd: 500 }, { name: 'Nobody', result: 'won' as const }],
      });
      // Partial: the named winner (both entries of its repo) won; the other submitted entry is unknown.
      assert.deepEqual(await syncOutcomeFile(f(false, 'R1'), tx), { matched: 1, unmatched: 1, others: 1 });
      let r = await rows();
      assert.equal(r.get(winner), 'won');
      assert.equal(r.get(winnerTwin), 'won');
      assert.equal(r.get(other), 'unknown');
      assert.ok(!r.has(unsent), 'a confirmed entry never sent is not labelled');
      assert.ok(!r.has(later), 'an entry made after the announcement is not in this round');
      const mid = await readStats(new Date(), tx);
      assert.equal(mid.labelled_entries - before.labelled_entries, 2, 'unknown never counts');
      assert.equal(mid.entries_won - before.entries_won, 2);
      // Complete: the same round re-synced; the other entry is now not_selected and counts.
      assert.deepEqual(await syncOutcomeFile(f(true, 'R1'), tx), { matched: 1, unmatched: 1, others: 1 });
      r = await rows();
      assert.equal(r.get(other), 'not_selected');
      const end = await readStats(new Date(), tx);
      assert.equal(end.labelled_entries - before.labelled_entries, 3);
      assert.equal(end.entries_won - before.entries_won, 2);
      throw Rollback;
    });
  } catch (err) {
    if (err !== Rollback) throw err;
  }
});

test('final review I4: two rounds, one complete file each; a round-1 entry never gets a round-2 label, a round-2 entry never a round-1 one', dbTest, async () => {
  const tag = `outcomes-i4-${process.pid}-${Date.now()}`;
  const Rollback = new Error('rollback');
  try {
    await sql().begin('isolation level repeatable read', async (tx) => {
      const [{ id: inst }] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
      await tx`
        INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
        VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'allowed')`;
      const entry = async (name: string, at: string) =>
        (await tx<{ id: number }[]>`
          INSERT INTO projects (program_id, name, installation_id, repo_url, submitted_at)
          VALUES (${tag}, ${name}, ${inst}, ${`https://github.com/a/${name.toLowerCase()}`}, ${at}) RETURNING id`)[0].id;
      // Round 1 runs to Oct 14; an entry on Oct 20 is already in round 2 (a rolling program).
      const r1win = await entry('OneWin', '2026-10-01T00:00:00Z');
      const r1lost = await entry('OneLost', '2026-10-14T23:00:00Z');
      const r2early = await entry('TwoEarly', '2026-10-20T00:00:00Z');
      const r2win = await entry('TwoWin', '2026-11-05T00:00:00Z');
      const r2lost = await entry('TwoLost', '2026-11-10T00:00:00Z');
      const labels = async (round: string) =>
        new Map((await tx<{ project_id: number; result: string }[]>`
          SELECT project_id, result FROM entry_outcomes WHERE program_id = ${tag} AND basis = 'announcement' AND round_label = ${round}`).map((r) => [r.project_id, r.result]));
      const base = { program_id: tag, source_url: 'https://x.example/results', complete: true };
      // Round 1's file, captured after round 2's first entry.
      assert.deepEqual(
        await syncOutcomeFile({ ...base, round_label: 'R1', captured_at: '2026-10-22', entries_until: '2026-10-14', results: [{ repo: 'github.com/a/onewin', result: 'won' }] }, tx),
        { matched: 1, unmatched: 0, others: 1 },
      );
      const one = await labels('R1');
      assert.equal(one.get(r1win), 'won');
      assert.equal(one.get(r1lost), 'not_selected');
      assert.ok(!one.has(r2early), 'an entry made after round 1 closed is not labelled in round 1');
      // Round 2's file replaces round 1's (one file per program); its window starts after round 1.
      assert.deepEqual(
        await syncOutcomeFile({ ...base, round_label: 'R2', captured_at: '2026-11-30', entries_until: '2026-11-15', results: [{ repo: 'github.com/a/twowin', result: 'won' }] }, tx),
        { matched: 1, unmatched: 0, others: 2 },
      );
      const two = await labels('R2');
      assert.equal(two.get(r2win), 'won');
      assert.equal(two.get(r2lost), 'not_selected');
      assert.equal(two.get(r2early), 'not_selected');
      assert.ok(!two.has(r1win) && !two.has(r1lost), 'round-1 entries never get a round-2 label');
      // entries_from bounds the start explicitly too.
      await syncOutcomeFile({ ...base, round_label: 'R2b', captured_at: '2026-11-30', entries_from: '2026-11-01', entries_until: '2026-11-15', results: [{ repo: 'github.com/a/twowin', result: 'won' }] }, tx);
      assert.ok(!(await labels('R2b')).has(r2early), 'before entries_from');
      throw Rollback;
    });
  } catch (err) {
    if (err !== Rollback) throw err;
  }
});
