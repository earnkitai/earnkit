import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { padPool } from './fixtures/rank-pool';
import { RANK_MIN_POOL } from './rank';
import { REPLY_WAIT_MS } from './reply-wait';
import { isoWeekOf, last52 } from './weeks';
import { gateFailures, type Reply as Turn } from './fixtures/converse';
import type { ReaderDeps } from './source-readers';

/**
 * v4.10.1 Task 3 (finding 4, ruling R5): one score per session. On a Monday, find's refresh lit the new week and
 * rescored after find's REPLY_WAIT_MS wait, so find said "69, 6 weeks" and score said "83, 7 weeks" seconds later.
 * A reply whose refresh is still running says no score, rank or week count, only that they are updating; the next
 * reply has the fresh numbers. A fast refresh: find and score say the same numbers.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v4101-score-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// A pinned Monday (every new Date() here and in the code under test): 2026-11-02 09:00 UTC opens ISO week 2026-W45.
const MONDAY = Date.parse('2026-11-02T09:00:00Z');
mock.timers.enable({ apis: ['Date'], now: MONDAY });
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const THIS_WEEK = isoWeekOf(new Date(MONDAY));
/** The six weeks ending last week (2026-W39 to W44): a 6-week streak while this week has no commits yet. */
const SIX = last52(new Date(MONDAY)).slice(45, 51);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const NUMBERS = /\bScore \d+|\bscore \d+|\b\d+ weeks?\b|#\d+ of \d+|Top [\d.]+%|Shipping \d+/;

/**
 * A reader every call of which waits for `open()` and then fails (no network): the refresh it serves is still
 * running when find's wait ends. `calls` names what was asked.
 */
function slowReader() {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const calls: string[] = [];
  const wait = async (what: string): Promise<never> => {
    calls.push(what);
    await gate;
    throw new Error('v4101: not served');
  };
  const reader = {
    now: new Date(MONDAY),
    gh: (p: string) => wait(`gh ${p}`),
    ghGraphql: () => wait('graphql'),
    ghFetch: (() => wait('fetch')) as never,
    probe: () => wait('probe'),
    fetchText: () => wait('text'),
    json: () => wait('json'),
    contractOrigin: () => wait('origin'),
    walletCreations: () => wait('wallet'),
  } as unknown as ReaderDeps;
  return { reader, open, calls };
}

/**
 * A ranked, listed builder on 69 with a 6-week streak ending last week (the finding's "69 and 6 weeks"), their
 * last read an hour ago (so this call's refresh claims the read), on the pinned Monday.
 */
async function monday69(tag: string) {
  await padPool(RANK_MIN_POOL);
  const key = `${tag}${RUN}${randomBytes(2).toString('hex')}/app`;
  const id = await person({
    main: key, claimed: `${tag}${RUN}`.slice(0, 15), ranked: true, score: 69,
    seen: { connect_done: '2026-09-01T00:00:00.000Z', declined: { [`qualify:${key}`]: new Date(MONDAY).toISOString() } },
    projects: [{ key, name: 'App', confirmed: true, streak: 6, commit_weeks: SIX }],
  });
  await sql()`UPDATE builder_live SET parts = ${sql().json({ shipping: { points: 69, raw: { mask: 1, live_ships: 0 } } } as never)},
    read_at = ${new Date(MONDAY - 3_600_000)}, computed_at = ${new Date(MONDAY - 3_600_000)} WHERE builder_id = ${id}`;
  return { id, key };
}

/**
 * What the refresh reads when it lands: the repo reading with this week's commits (2026-W45) on top of the six weeks
 * before it. Its own rescore (person-score.ts rescorePerson) then writes the new score and the 7-week streak.
 */
async function landRefresh(id: number) {
  // Today's reading (source_readings: the failed live read the fake reader ends in never replaces it).
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok)
    SELECT id, '2026-11-02', ${sql().json({ commit_weeks: [...SIX, THIS_WEEK], commit_counts: Object.fromEntries([...SIX, THIS_WEEK].map((w) => [w, 3])), pushes_checked: true } as never)}, true
    FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo'`;
}

const ctxOf = (id: number, reader: ReaderDeps) =>
  ({ installationId: id, ownInstallationId: id, sharedClient: false, readerDeps: reader, matchProjects: (async () => ({ checked: 1, scored: 0, fits: [] })) as never }) as never;

test('finding 4 on a Monday: find\'s refresh still running past its wait says no number, only that they are updating; score then has the fresh 73 and 7 weeks', db, async () => {
  const b = await monday69('fsc');
  const slow = slowReader();
  const ctx = ctxOf(b.id, slow.reader);
  const t0 = performance.now();
  const f = await mcpCall(ctx, 'find', {});
  assert.ok(performance.now() - t0 >= REPLY_WAIT_MS - 50, 'find waited its REPLY_WAIT_MS for the refresh');
  assert.ok(slow.calls.length > 0, 'the refresh asked the reader (it is still waiting)');
  // No score, rank or week count, in what the builder sees or in any fact the agent could say.
  assert.doesNotMatch(show(f), NUMBERS, show(f));
  assert.match(show(f), /Your score and weeks are updating\. I'll show the new numbers in my next reply\./);
  const reply = f.reply ?? {};
  assert.equal(reply.streak, undefined, 'no streak fact');
  assert.equal(reply.rank_lines, undefined, 'no rank lines');
  assert.doesNotMatch(String(reply.standing ?? ''), NUMBERS);
  const facts = (reply.facts ?? {}) as { rank?: unknown; streak?: unknown };
  assert.equal(facts.rank, undefined, 'no rank fact');
  assert.equal(facts.streak, undefined, 'no streak fact');
  assert.equal(reply.numbers_updating, true);
  // The one easy reply stays last, and the updating line is never it.
  assert.doesNotMatch(show(f).split('\n\n').at(-1)!, /updating/);
  // Copy rules.
  assert.doesNotMatch(show(f), /—|\bcoins?\b|\bpoints?\b/i);

  // The refresh lands (this week's commits, the rescore), then score: the fresh numbers, said as the page says them.
  await landRefresh(b.id);
  slow.open();
  const s = await mcpCall(ctx, 'score', {});
  assert.match(String(s.reply?.standing), /^Score 73 · [^.]+\. 7 weeks shipping in a row\./, String(s.reply?.standing));
  assert.equal(s.reply?.streak, 7);
  assert.equal(s.reply?.numbers_updating, undefined);
  assert.doesNotMatch(show(s), /updating/);
  assert.doesNotMatch(show(s), /\b69\b|\b6 weeks\b/);
});

test('a slow refresh that is still running when score is asked: score says updating too, never the old numbers', db, async () => {
  const b = await monday69('fsw');
  const slow = slowReader();
  const ctx = ctxOf(b.id, slow.reader);
  const f = await mcpCall(ctx, 'find', {});
  assert.doesNotMatch(show(f), NUMBERS);
  // score seconds later: find's refresh is still running (score's own claim is spent), so no number yet.
  const s = await mcpCall(ctx, 'score', {});
  assert.doesNotMatch(show(s), NUMBERS, show(s));
  assert.doesNotMatch(String(s.reply?.standing ?? ''), NUMBERS);
  assert.equal(s.reply?.numbers_updating, true);
  // Said once a session: the second reply has no number and does not repeat the line.
  assert.doesNotMatch(show(s), /updating/, show(s));
  await landRefresh(b.id);
  slow.open();
  const again = await mcpCall(ctx, 'score', {});
  assert.match(String(again.reply?.standing), /^Score 73 · [^.]+\. 7 weeks shipping in a row\./);
});

test('a fast refresh: find shows the same numbers score shows', db, async () => {
  const b = await monday69('fsf');
  // The refresh lands at once: the reader's first call writes the refresh's result, then every read fails.
  let landed: Promise<void> | null = null;
  const fail = async (): Promise<never> => {
    landed ??= landRefresh(b.id);
    await landed;
    throw new Error('v4101: not served');
  };
  const reader = { now: new Date(MONDAY), gh: fail, ghGraphql: fail, ghFetch: fail as never, probe: fail, fetchText: fail, json: fail, contractOrigin: fail, walletCreations: fail } as unknown as ReaderDeps;
  const ctx = ctxOf(b.id, reader);
  const f = await mcpCall(ctx, 'find', {});
  const s = await mcpCall(ctx, 'score', {});
  assert.equal(f.reply?.numbers_updating, undefined);
  assert.equal(s.reply?.numbers_updating, undefined);
  assert.match(String(f.reply?.standing), /^Score 73 · [^.]+\. 7 weeks shipping in a row\./, 'find has the refreshed numbers');
  assert.equal(f.reply?.standing, s.reply?.standing, 'one standing');
  assert.equal(f.reply?.streak, s.reply?.streak);
  assert.ok(typeof f.reply?.streak === 'number');
  const scoreOf = (r: R) => (r.reply?.facts as { rank?: { score?: number } } | undefined)?.rank?.score;
  assert.equal(scoreOf(f), scoreOf(s));
  assert.doesNotMatch(show(f), /updating/);
});

test('the merge gate: a session opening on the updating reply, then the fresh one, passes (proof rule included)', db, async () => {
  const b = await monday69('fsg');
  const slow = slowReader();
  const ctx = ctxOf(b.id, slow.reader);
  const { conversation } = await import('./fixtures/converse');
  const turn = conversation(ctx);
  const first = (await turn({ find: {} }))!;
  assert.match(first.show, /updating/);
  await landRefresh(b.id);
  slow.open();
  const second = (await turn({ find: {} }))!;
  assert.doesNotMatch(second.show, /updating/);
  const replies: Turn[] = [first, second];
  assert.deepEqual(gateFailures(replies, { names: ['App'] }), []);
});

test('the merge gate: an updating opener with no other fact passes; a hook after it still needs a proof', () => {
  const reply = (o: Partial<Turn>): Turn => ({ turn: 0, session: 0, first: true, hook: false, tool: 'find', input: {}, show: '', said: [], reply: null, ...o }) as Turn;
  const opener = reply({ show: "Your score and weeks are updating. I'll show the new numbers in my next reply.\n\nWant me to draft it?", said: ['updating'] });
  assert.deepEqual(gateFailures([opener]), []);
  assert.deepEqual(gateFailures([{ ...opener, said: [] }]).map((f) => f.rule), ['proof'], 'without the updating part it is an opener with no fact');
  const hook = reply({ turn: 1, first: false, hook: true, show: 'Base pays up to $5K.\n\nWant me to draft it?', said: ['hook:base'] });
  assert.deepEqual(gateFailures([opener, hook]).map((f) => f.rule), ['proof']);
});
