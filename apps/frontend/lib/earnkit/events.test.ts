import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {
  ARC_LOG_CHUNK,
  ARC_LOG_MAX_CHUNKS,
  EVENT_LOG_FLAG,
  EVENT_WAIT_MS,
  STARTER_USAGE_EVENTS,
  USAGE_LIMIT,
  eventLogEnabled,
  eventRepoKey,
  logChunks,
  logSender,
  noteEvent,
  proofLink,
  recordEvent,
  usageChecks,
  usageTopic,
  type BuilderEvent,
} from './events';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sql, type Db } from './db';

// v2.11 Task 2: the builder event log. The DB cases run against the local database when configured.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const flagBefore = process.env[EVENT_LOG_FLAG];
beforeEach(() => {
  process.env[EVENT_LOG_FLAG] = 'on';
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[EVENT_LOG_FLAG];
  else process.env[EVENT_LOG_FLAG] = flagBefore;
});

const stamp = () => `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const W = '0x' + 'AbC'.repeat(13) + 'd';

/** Captures console.error lines while fn runs. */
async function errors(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

/** A tagged-template fake that records whether it was called and fails like a dead pool would. */
function failingDb(message: string) {
  let calls = 0;
  const db = Object.assign(
    () => {
      calls++;
      const err = new Error(message);
      err.name = 'PostgresError';
      return Promise.reject(err);
    },
    { json: (v: unknown) => v },
  ) as unknown as Db;
  return { db, calls: () => calls };
}

test('the log is off unless EARNKIT_EVENT_LOG=on, and off it writes nothing and never touches the DB', async () => {
  for (const value of [undefined, '', '1', 'true', 'ON ', 'off']) {
    if (value === undefined) delete process.env[EVENT_LOG_FLAG];
    else process.env[EVENT_LOG_FLAG] = value;
    assert.equal(eventLogEnabled(), false, `flag ${JSON.stringify(value)}`);
    const fake = failingDb('x');
    assert.equal(await recordEvent({ type: 'built', dedupe_key: 'k' }, fake.db), false);
    assert.equal(fake.calls(), 0);
  }
  process.env[EVENT_LOG_FLAG] = 'on';
  assert.equal(eventLogEnabled(), true);
});

test('2.4 a DB error returns false, never throws, and logs only the type and error class', async () => {
  const fake = failingDb(`insert failed for ${W} alice/tipjar`);
  let wrote: boolean | undefined;
  const lines = await errors(async () => {
    wrote = await recordEvent(
      { type: 'deployed', dedupe_key: 'deployed:1', github_login: 'Alice', wallet: W, repo_key: 'Alice/TipJar', detail: { twist: 'secret' } },
      fake.db,
    );
  });
  assert.equal(wrote, false);
  assert.equal(fake.calls(), 1);
  assert.deepEqual(lines, ['[events] deployed PostgresError']);
  for (const value of ['alice', W.toLowerCase(), 'tipjar', 'secret', 'deployed:1']) {
    assert.ok(!lines.join('\n').toLowerCase().includes(value.toLowerCase()), `log line leaks ${value}`);
  }
});

test('2.4 an invalid event is refused before the DB, logged without its values', async () => {
  const fake = failingDb('x');
  let wrote: boolean | undefined;
  const lines = await errors(async () => {
    wrote = await recordEvent({ type: 'hacked', dedupe_key: 'x' } as unknown as BuilderEvent, fake.db);
  });
  assert.equal(wrote, false);
  assert.equal(fake.calls(), 0);
  assert.deepEqual(lines, ['[events] invalid ZodError']);
  const empty = await errors(async () => {
    wrote = await recordEvent({ type: 'built', dedupe_key: '' }, fake.db);
  });
  assert.equal(wrote, false);
  assert.deepEqual(empty, ['[events] built ZodError']);
});

test('2.1 recordEvent writes one row with lowercased login, wallet and repo key; the same key again is a no-op', dbTest, async () => {
  const key = `built:t2-${stamp()}`;
  const e: BuilderEvent = {
    type: 'built',
    dedupe_key: key,
    github_login: 'Alice',
    login_basis: 'proof_line',
    installation_id: 99999,
    wallet: W,
    repo_key: 'Alice/TipJar',
    program_id: 'arc-microgrants',
    chain: 'arc',
    proof_url: 'https://github.com/Alice/TipJar',
    detail: { twist: 'tips for Alice' },
  };
  assert.equal(await recordEvent(e), true);
  assert.equal(await recordEvent({ ...e, detail: { twist: 'changed' } }), false);
  const rows = await sql()<
    { github_login: string; wallet: string; repo_key: string; login_basis: string; installation_id: number; proof_url: string; detail: unknown }[]
  >`SELECT github_login, wallet, repo_key, login_basis, installation_id, proof_url, detail FROM builder_events WHERE dedupe_key = ${key}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].github_login, 'alice');
  assert.equal(rows[0].wallet, W.toLowerCase());
  assert.equal(rows[0].repo_key, 'alice/tipjar');
  assert.equal(rows[0].login_basis, 'proof_line');
  assert.equal(rows[0].installation_id, 99999, 'no FK: an installation id that does not exist is kept');
  assert.equal(rows[0].proof_url, 'https://github.com/Alice/TipJar', 'the proof URL is kept as given');
  assert.deepEqual(rows[0].detail, { twist: 'tips for Alice' }, 'the first write wins');
});

test('2.1 detail over 2 KB of JSON is stored as { truncated: true }; none is {}', dbTest, async () => {
  const big = `entered:t2-big-${stamp()}`;
  const none = `entered:t2-none-${stamp()}`;
  assert.equal(await recordEvent({ type: 'entered', dedupe_key: big, detail: { twist: 'x'.repeat(2048) } }), true);
  assert.equal(await recordEvent({ type: 'entered', dedupe_key: none }), true);
  const rows = await sql()<{ dedupe_key: string; detail: unknown }[]>`
    SELECT dedupe_key, detail FROM builder_events WHERE dedupe_key IN (${big}, ${none})`;
  const by = new Map(rows.map((r) => [r.dedupe_key, r.detail]));
  assert.deepEqual(by.get(big), { truncated: true });
  assert.deepEqual(by.get(none), {});
});

test('2.2 UPDATE, DELETE and TRUNCATE on builder_events all throw', dbTest, async () => {
  const key = `hosted:t2-${stamp()}`;
  assert.equal(await recordEvent({ type: 'hosted', dedupe_key: key, github_login: 'bob' }), true);
  const db = sql();
  await assert.rejects(db`UPDATE builder_events SET github_login = NULL WHERE dedupe_key = ${key}`, /append-only/);
  await assert.rejects(db`DELETE FROM builder_events WHERE dedupe_key = ${key}`, /append-only/);
  await assert.rejects(db`TRUNCATE builder_events`, /append-only/);
  // A setting other than 'on' never opens it.
  await assert.rejects(
    db.begin(async (tx) => {
      await tx`SELECT set_config('earnkit.events_redact', 'yes', true)`;
      await tx`UPDATE builder_events SET github_login = NULL WHERE dedupe_key = ${key}`;
    }),
    /append-only/,
  );
  const [row] = await db<{ github_login: string | null }[]>`SELECT github_login FROM builder_events WHERE dedupe_key = ${key}`;
  assert.equal(row.github_login, 'bob');
});

/** Opens redaction the way the T12 script will: bound to this transaction's id. */
const openRedaction = (tx: postgres.TransactionSql) =>
  tx`SELECT set_config('earnkit.events_redact', 'on:' || txid_current(), true)`;

test('2.2 the owner redaction path: bound to the transaction, it may only null login and wallet and change detail', dbTest, async () => {
  const key = `submitted:t2-${stamp()}`;
  assert.equal(
    await recordEvent({ type: 'submitted', dedupe_key: key, github_login: 'carol', wallet: W, detail: { twist: 'carol tips' } }),
    true,
  );
  const db = sql();
  await db.begin(async (tx) => {
    await openRedaction(tx);
    await tx`UPDATE builder_events SET github_login = NULL, wallet = NULL, detail = '{}'::jsonb WHERE dedupe_key = ${key}`;
    // Every other change is refused, even with redaction open.
    for (const change of [
      `UPDATE builder_events SET type = 'won' WHERE dedupe_key = $1`,
      `UPDATE builder_events SET dedupe_key = 'rewritten' WHERE dedupe_key = $1`,
      `UPDATE builder_events SET at = now() - interval '1 day' WHERE dedupe_key = $1`,
      `UPDATE builder_events SET proof_url = 'https://x.example' WHERE dedupe_key = $1`,
      `UPDATE builder_events SET github_login = 'mallory' WHERE dedupe_key = $1`,
      `UPDATE builder_events SET wallet = '0x${'1'.repeat(40)}' WHERE dedupe_key = $1`,
      `DELETE FROM builder_events WHERE dedupe_key = $1`,
      `TRUNCATE builder_events`,
    ]) {
      const params = change.includes('$1') ? [key] : [];
      await assert.rejects(tx.savepoint((sp) => sp.unsafe(change, params)), /append-only/, change);
    }
  });
  const [row] = await db<{ type: string; dedupe_key: string; github_login: string | null; wallet: string | null; detail: unknown }[]>`
    SELECT type, dedupe_key, github_login, wallet, detail FROM builder_events WHERE dedupe_key = ${key}`;
  assert.deepEqual({ ...row }, { type: 'submitted', dedupe_key: key, github_login: null, wallet: null, detail: {} });
  // The value was bound to that transaction: the next statement is append-only again.
  await assert.rejects(db`UPDATE builder_events SET detail = '{}'::jsonb WHERE dedupe_key = ${key}`, /append-only/);
});

test('2.2 a session-level SET, a stale txid value or a connection option never opens the table', dbTest, async () => {
  const key = `entered:t2-leak-${stamp()}`;
  assert.equal(await recordEvent({ type: 'entered', dedupe_key: key, github_login: 'erin' }), true);
  const db = sql();
  await db.reserve().then(async (conn) => {
    try {
      // Session scope, plain 'on': refused.
      await conn`SET earnkit.events_redact = 'on'`;
      await assert.rejects(conn`UPDATE builder_events SET github_login = NULL WHERE dedupe_key = ${key}`, /append-only/);
      await assert.rejects(conn`DELETE FROM builder_events WHERE dedupe_key = ${key}`, /append-only/);
      // A value bound to an earlier transaction, left at session scope: stale in every later one.
      const [{ v }] = await conn<{ v: string }[]>`SELECT set_config('earnkit.events_redact', 'on:' || txid_current(), false) AS v`;
      assert.match(v, /^on:\d+$/);
      await assert.rejects(conn`UPDATE builder_events SET github_login = NULL WHERE dedupe_key = ${key}`, /append-only/);
      await conn`RESET earnkit.events_redact`;
    } finally {
      conn.release();
    }
  });
  // A connection option ('-c earnkit.events_redact=on').
  const opened = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {}, connection: { 'earnkit.events_redact': 'on' } });
  try {
    const [{ v }] = await opened<{ v: string }[]>`SELECT current_setting('earnkit.events_redact', true) AS v`;
    assert.equal(v, 'on', 'the option reached the server');
    await assert.rejects(opened`UPDATE builder_events SET github_login = NULL WHERE dedupe_key = ${key}`, /append-only/);
    await assert.rejects(opened`DELETE FROM builder_events WHERE dedupe_key = ${key}`, /append-only/);
  } finally {
    await opened.end();
  }
  const [row] = await db<{ github_login: string | null }[]>`SELECT github_login FROM builder_events WHERE dedupe_key = ${key}`;
  assert.equal(row.github_login, 'erin');
});

test('I2 a given at is kept (the backfill); without one the row gets now()', dbTest, async () => {
  const old = `deployed:t2-at-${stamp()}`;
  const fresh = `deployed:t2-now-${stamp()}`;
  const AT = new Date('2026-09-01T12:34:56.000Z');
  const before = Date.now();
  assert.equal(await recordEvent({ type: 'deployed', dedupe_key: old, at: AT }), true);
  assert.equal(await recordEvent({ type: 'deployed', dedupe_key: fresh }), true);
  const rows = await sql()<{ dedupe_key: string; at: Date }[]>`SELECT dedupe_key, at FROM builder_events WHERE dedupe_key IN (${old}, ${fresh})`;
  const by = new Map(rows.map((r) => [r.dedupe_key, r.at]));
  assert.equal(by.get(old)?.toISOString(), AT.toISOString());
  assert.ok(by.get(fresh)!.getTime() >= before - 5000, 'a live write is stamped now');
});

test('2.3 ten parallel recordEvent calls with one key write one row', dbTest, async () => {
  const key = `deployed:t2-race-${stamp()}`;
  const results = await Promise.all(Array.from({ length: 10 }, () => recordEvent({ type: 'deployed', dedupe_key: key, proof_tx: '0xabc' })));
  assert.equal(results.filter(Boolean).length, 1);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE dedupe_key = ${key}`;
  assert.equal(n, 1);
});

test('2.4 a closed pool returns false and does not throw', dbTest, async () => {
  const closed = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await closed.end();
  let wrote: boolean | undefined;
  const lines = await errors(async () => {
    wrote = await recordEvent({ type: 'won', dedupe_key: `outcome:t2-${stamp()}`, github_login: 'dave' }, closed);
  });
  assert.equal(wrote, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[events\] won \w+$/);
  assert.ok(!lines[0].includes('dave'));
});

test('2.5 a type outside the list is refused by the CHECK; so is an unknown login basis', dbTest, async () => {
  const db = sql();
  await assert.rejects(db`INSERT INTO builder_events (type, dedupe_key) VALUES ('scored', ${`t2-bad-${stamp()}`})`, /check/i);
  await assert.rejects(
    db`INSERT INTO builder_events (type, login_basis, dedupe_key) VALUES ('built', 'guess', ${`t2-bad-${stamp()}`})`,
    /check/i,
  );
});

test('no app code updates, deletes or alters builder events, drops their triggers, or sets the redaction setting', () => {
  const root = join(import.meta.dirname, '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p);
    }
  };
  for (const dir of ['lib', 'app']) walk(join(root, dir));
  assert.ok(files.some((f) => f.endsWith(join('earnkit', 'events.ts'))), 'the walk reaches lib/earnkit');
  const bad = files.filter((f) =>
    /(update\s+builder_events|delete\s+from\s+builder_events|truncate\s+(table\s+)?builder_events|earnkit\.events_redact|(drop|disable)\s+trigger\s+builder_events_|alter\s+table\s+(if\s+exists\s+)?builder_events|session_replication_role)/i.test(
      readFileSync(f, 'utf8'),
    ),
  );
  assert.deepEqual(bad, []);
});

test('a detail that cannot be serialized (a cycle or a bigint) is stored as { truncated: true }', async () => {
  const seen: unknown[] = [];
  const db = Object.assign(() => Promise.resolve([{ id: 1 }]), { json: (v: unknown) => (seen.push(v), v) }) as unknown as Db;
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.equal(await recordEvent({ type: 'built', dedupe_key: 'k1', detail: cycle }, db), true);
  assert.equal(await recordEvent({ type: 'built', dedupe_key: 'k2', detail: { n: 1n } }, db), true);
  assert.deepEqual(seen, [{ truncated: true }, { truncated: true }]);
});

test('ids outside the integer column range, an invalid at and an over-long key are refused by zod, before the DB', async () => {
  for (const bad of [
    { type: 'built', dedupe_key: 'k', installation_id: 2147483648 },
    { type: 'built', dedupe_key: 'k', project_id: 0 },
    { type: 'built', dedupe_key: 'k', at: new Date('nope') },
    { type: 'built', dedupe_key: 'x'.repeat(2101) },
  ] as BuilderEvent[]) {
    const fake = failingDb('x');
    const lines = await errors(async () => assert.equal(await recordEvent(bad, fake.db), false));
    assert.deepEqual(lines, ['[events] built ZodError']);
    assert.equal(fake.calls(), 0);
  }
  const fake = failingDb('x');
  await errors(async () => recordEvent({ type: 'hosted', dedupe_key: 'hosted:gh:https://a.github.io/' + 'p'.repeat(1900) }, fake.db));
  assert.equal(fake.calls(), 1, 'a long GitHub Pages key reaches the DB');
});

// ---- v2.11 T3: noteEvent, the steps' writer

test('3.x noteEvent: off, the event is never built; a build that throws logs the type and error class only and never throws', async () => {
  delete process.env[EVENT_LOG_FLAG];
  let built = 0;
  await noteEvent('deployed', () => {
    built++;
    return null;
  });
  assert.equal(built, 0, 'no read happens while the log is off');
  process.env[EVENT_LOG_FLAG] = 'on';
  const lines = await errors(() =>
    noteEvent('hosted', async () => {
      const err = new Error(`secret ${W}`);
      err.name = 'PostgresError';
      throw err;
    }),
  );
  assert.deepEqual(lines, ['[events] hosted PostgresError']);
  await noteEvent('entered', () => null);
});

test('3.6 noteEvent never holds a step up for more than EVENT_WAIT_MS', async () => {
  let release!: () => void;
  const hang = new Promise<null>((r) => (release = () => r(null)));
  const t0 = Date.now();
  await noteEvent('submitted', () => hang);
  const took = Date.now() - t0;
  assert.ok(took >= EVENT_WAIT_MS - 50 && took < EVENT_WAIT_MS + 500, `${took} ms`);
  release();
});

test('eventRepoKey: owner/repo, lowercase, from any GitHub link; undefined otherwise', () => {
  assert.equal(eventRepoKey('https://github.com/Alice/TipJar.git'), 'alice/tipjar');
  assert.equal(eventRepoKey('github.com/alice/tipjar/tree/main'), 'alice/tipjar');
  assert.equal(eventRepoKey('https://gitlab.com/alice/tipjar'), undefined);
  assert.equal(eventRepoKey(null), undefined);
});

test('proofLink (review M7): the link without its query, fragment or credentials; not a web link, undefined', () => {
  assert.equal(proofLink('https://docs.google.com/forms/d/e/x/viewform?edit2=2_ABC#r'), 'https://docs.google.com/forms/d/e/x/viewform');
  assert.equal(proofLink('https://u:p@dorahacks.io/buidl/1'), 'https://dorahacks.io/buidl/1');
  assert.equal(proofLink('javascript:alert(1)'), undefined);
  assert.equal(proofLink('not a url'), undefined);
  assert.equal(proofLink(undefined), undefined);
});

// ---- v2.11 T11: usage checks at 30 and 90 days (spec 7, plan S12)

const DAY = 86_400_000;
const addr = () => `0x${Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}`;

/** Seeds one deployed event `ageDays` before `now`; returns its id (as text, like postgres.js bigints). */
async function seedDeployed(now: Date, ageDays: number, o: { chain?: string; detail?: Record<string, unknown>; proof_tx?: string } = {}) {
  const key = `deployed:t11-${stamp()}`;
  const address = addr();
  assert.equal(
    await recordEvent({
      type: 'deployed',
      dedupe_key: key,
      at: new Date(now.getTime() - ageDays * DAY),
      chain: o.chain ?? 'base',
      installation_id: 99911,
      repo_key: 'alice/tipjar',
      wallet: W,
      proof_tx: o.proof_tx ?? `0x${'ab'.repeat(32)}`,
      detail: { address, owner_ok: true, ...o.detail },
    }),
    true,
  );
  const [row] = await sql()<{ id: string }[]>`SELECT id::text FROM builder_events WHERE dedupe_key = ${key}`;
  return { id: row.id, address };
}

const usageOf = async (id: string) => [
  ...(await sql()<{ dedupe_key: string; detail: Record<string, unknown>; chain: string | null; installation_id: number | null }[]>`
    SELECT dedupe_key, detail, chain, installation_id FROM builder_events
    WHERE type = 'usage_check' AND dedupe_key LIKE ${`usage:${id}:%`} ORDER BY id`),
];

const codeOk = async () => '0x6080';

test('11.0 logChunks: ranges of ARC_LOG_CHUNK blocks from the deploy block to the head, at most ARC_LOG_MAX_CHUNKS; more is partial', () => {
  assert.equal(ARC_LOG_CHUNK, 10_000n, 'rpc.mainnet.arc.io accepts 10,000 blocks per eth_getLogs (10,001 is refused)');
  assert.equal(ARC_LOG_MAX_CHUNKS, 50);
  assert.deepEqual(logChunks(100n, 25_099n), {
    ranges: [
      [100n, 10_099n],
      [10_100n, 20_099n],
      [20_100n, 25_099n],
    ],
    partial: false,
  });
  assert.deepEqual(logChunks(5n, 5n), { ranges: [[5n, 5n]], partial: false });
  assert.deepEqual(logChunks(9n, 5n), { ranges: [], partial: false }, 'a head behind the start reads nothing');
  const big = logChunks(1n, 1n + 50n * 10_000n);
  assert.equal(big.ranges.length, 50);
  assert.deepEqual(big.ranges[49], [490_001n, 500_000n]);
  assert.equal(big.partial, true);
  assert.equal(logChunks(1n, 50n * 10_000n).partial, false, 'exactly 50 chunks is whole');
});

test('11.0 the usage event topic is the starter contract\'s Tipped(address indexed, uint256, string)', () => {
  assert.equal(STARTER_USAGE_EVENTS['arc-tipjar'], 'Tipped(address,uint256,string)');
  assert.equal(usageTopic('Tipped(address,uint256,string)'), '0x4f629a5f1c8e7fc616770a8d34896b447f3457037c40a23347478746309d73c2');
});

test('11.0 usageChecks with the log off reads nothing and writes nothing', async () => {
  delete process.env[EVENT_LOG_FLAG];
  let reads = 0;
  const out = await usageChecks(new Date(), {
    getCode: async () => (reads++, '0x'),
    blockscout: async () => (reads++, { transactions_count: '1' }),
  });
  assert.deepEqual(out, { checked: 0, failed: 0 });
  assert.equal(reads, 0);
});

test('11.1 a 31-day-old Base deploy gets one 30-day check (Blockscout count, code); a second run writes none', dbTest, async () => {
  const now = new Date();
  const d = await seedDeployed(now, 31);
  const urls: string[] = [];
  const deps = {
    only: [d.id],
    getCode: async (chain: string, a: string) => (urls.push(`code:${chain}:${a}`), '0x6080'),
    blockscout: async (url: string) => (urls.push(url), { transactions_count: '7' }),
  };
  assert.deepEqual(await usageChecks(now, deps), { checked: 1, failed: 0 });
  const rows = await usageOf(d.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dedupe_key, `usage:${d.id}:30`);
  assert.equal(rows[0].chain, 'base');
  assert.equal(rows[0].installation_id, 99911);
  assert.deepEqual(rows[0].detail, { window: 30, deployed_event: Number(d.id), address: d.address, tx_count: 7, code: true, source: 'blockscout' });
  assert.deepEqual(urls, [`code:base:${d.address}`, `https://base.blockscout.com/api/v2/addresses/${d.address}/counters`]);
  assert.deepEqual(await usageChecks(now, deps), { checked: 0, failed: 0 });
  assert.equal((await usageOf(d.id)).length, 1);
  assert.equal(urls.length, 2, 'a done check reads nothing again');
});

test('11.1 a 29-day-old deploy is not due; a code_differs deploy and one without an address are never checked', dbTest, async () => {
  const now = new Date();
  const young = await seedDeployed(now, 29);
  const differs = await seedDeployed(now, 40, { detail: { code_differs: true } });
  const out = await usageChecks(now, { only: [young.id, differs.id], getCode: codeOk, blockscout: async () => ({ transactions_count: '1' }) });
  assert.deepEqual(out, { checked: 0, failed: 0 });
});

test('11.2 an Arc arc-tipjar deploy counts Tipped logs in 10,000-block chunks from detail.block, with unique senders', dbTest, async () => {
  const now = new Date();
  const d = await seedDeployed(now, 31, { chain: 'arc', detail: { block: 1000, starter: 'arc-tipjar' } });
  const calls: [string, string, bigint, bigint][] = [];
  const A = '0x' + '11'.repeat(20);
  const B = '0x' + '22'.repeat(20);
  const out = await usageChecks(now, {
    only: [d.id],
    getCode: codeOk,
    arcHead: async () => 25_000n,
    arcLogs: async (a, topic, from, to) => {
      calls.push([a, topic, from, to]);
      return from === 1000n ? { count: 2, senders: [A, B] } : { count: 1, senders: [A.toUpperCase().replace('0X', '0x')] };
    },
    receiptBlock: async () => {
      throw new Error('the block is known; no receipt read');
    },
  });
  assert.deepEqual(out, { checked: 1, failed: 0 });
  const topic = usageTopic('Tipped(address,uint256,string)');
  assert.deepEqual(calls, [
    [d.address, topic, 1000n, 10_999n],
    [d.address, topic, 11_000n, 20_999n],
    [d.address, topic, 21_000n, 25_000n],
  ]);
  const [row] = await usageOf(d.id);
  assert.deepEqual(row.detail, {
    window: 30,
    deployed_event: Number(d.id),
    address: d.address,
    events: 4,
    senders: 2,
    from_block: 1000,
    to_block: 25_000,
    code: true,
    source: 'rpc_logs',
  });
});

test('11.2 more than 50 chunks reads 50 and writes partial: true; a pre-v2.11 deploy reads its block from the receipt', dbTest, async () => {
  const now = new Date();
  const d = await seedDeployed(now, 31, { chain: 'arc', detail: { starter: 'arc-tipjar' }, proof_tx: `0x${'cd'.repeat(32)}` });
  let logReads = 0;
  const receipts: string[] = [];
  const out = await usageChecks(now, {
    only: [d.id],
    getCode: codeOk,
    arcHead: async () => 7n + 50n * 10_000n + 3n,
    arcLogs: async () => (logReads++, { count: 0, senders: [] }),
    receiptBlock: async (chain, tx) => (receipts.push(`${chain}:${tx}`), 7n),
  });
  assert.deepEqual(out, { checked: 1, failed: 0 });
  assert.equal(logReads, 50);
  assert.deepEqual(receipts, [`arc:0x${'cd'.repeat(32)}`]);
  const [row] = await usageOf(d.id);
  assert.equal(row.detail.partial, true);
  assert.equal(row.detail.from_block, 7);
  assert.equal(row.detail.to_block, 7 + 50 * 10_000 - 1);
  assert.equal(row.detail.events, 0);
  assert.equal(row.detail.senders, 0);
});

test('11.2 an Arc deploy with no known usage event gets eth_getCode only', dbTest, async () => {
  const now = new Date();
  const d = await seedDeployed(now, 31, { chain: 'arc', detail: { block: 5 } });
  let logReads = 0;
  const out = await usageChecks(now, {
    only: [d.id],
    getCode: async () => '0x',
    arcHead: async () => (logReads++, 10n),
    arcLogs: async () => (logReads++, { count: 0, senders: [] }),
  });
  assert.deepEqual(out, { checked: 1, failed: 0 });
  assert.equal(logReads, 0);
  const [row] = await usageOf(d.id);
  assert.deepEqual(row.detail, { window: 30, deployed_event: Number(d.id), address: d.address, code: false, source: 'rpc_code' });
});

test('11.3 a 91-day-old deploy with its 30-day check done gets only the 90-day check; one never checked gets only the 90-day one', dbTest, async () => {
  const now = new Date();
  const done30 = await seedDeployed(now, 91);
  assert.equal(await recordEvent({ type: 'usage_check', dedupe_key: `usage:${done30.id}:30`, detail: { window: 30 } }), true);
  const never = await seedDeployed(now, 95);
  const deps = { only: [done30.id, never.id], getCode: codeOk, blockscout: async () => ({ transactions_count: '3' }) };
  assert.deepEqual(await usageChecks(now, deps), { checked: 2, failed: 0 });
  assert.deepEqual((await usageOf(done30.id)).map((r) => r.dedupe_key), [`usage:${done30.id}:30`, `usage:${done30.id}:90`]);
  assert.deepEqual((await usageOf(never.id)).map((r) => [r.dedupe_key, r.detail.window]), [[`usage:${never.id}:90`, 90]]);
  assert.deepEqual(await usageChecks(now, deps), { checked: 0, failed: 0 });
});

test('11.4 25 due deploys with limit 20: the 20 oldest are checked, and the next run takes the other 5', dbTest, async () => {
  const now = new Date();
  const seeded: { id: string; address: string }[] = [];
  for (let i = 0; i < 25; i++) seeded.push(await seedDeployed(now, 31 + i)); // seeded[24] is the oldest
  const only = seeded.map((s) => s.id);
  const read: string[] = [];
  const deps = { only, getCode: async (_c: string, a: string) => (read.push(a), '0x6080'), blockscout: async () => ({ transactions_count: '0' }) };
  assert.deepEqual(await usageChecks(now, deps), { checked: 20, failed: 0 });
  assert.deepEqual(read, seeded.slice(5).reverse().map((s) => s.address), 'oldest first');
  read.length = 0;
  assert.deepEqual(await usageChecks(now, deps), { checked: 5, failed: 0 });
  assert.deepEqual(read, seeded.slice(0, 5).reverse().map((s) => s.address));
  assert.equal(USAGE_LIMIT, 20);
  assert.deepEqual(await usageChecks(now, { ...deps, limit: 3 }), { checked: 0, failed: 0 });
});

test('11.5 a failed read writes nothing, counts as failed, logs the class only, and is read once a run (retried next run)', dbTest, async () => {
  const now = new Date();
  const base = await seedDeployed(now, 31);
  const arc = await seedDeployed(now, 32, { chain: 'arc', detail: { block: 1, starter: 'arc-tipjar' } });
  const noCode = await seedDeployed(now, 33);
  let blockscoutReads = 0;
  let logReads = 0;
  const lines = await errors(async () => {
    const out = await usageChecks(now, {
      only: [base.id, arc.id, noCode.id],
      getCode: async (_c, a) => {
        if (a === noCode.address) throw Object.assign(new Error(`rpc down ${a}`), { name: 'HttpRequestError' });
        return '0x6080';
      },
      blockscout: async () => {
        blockscoutReads++;
        throw new Error('blockscout 503');
      },
      arcHead: async () => 30_000n,
      arcLogs: async (_a, _t, from) => {
        logReads++;
        if (from > 1n) throw Object.assign(new Error('requested range too large'), { name: 'RpcRequestError' });
        return { count: 1, senders: [W] };
      },
    });
    assert.deepEqual(out, { checked: 0, failed: 3 });
  });
  assert.equal(blockscoutReads, 1, 'no retry inside a run');
  assert.equal(logReads, 2, 'the check stops at its first failed chunk');
  for (const d of [base, arc, noCode]) assert.deepEqual(await usageOf(d.id), []);
  assert.ok(lines.length >= 3);
  for (const l of lines) {
    assert.match(l, /^\[(events|verify)\] /);
    for (const d of [base, arc, noCode]) assert.ok(!l.includes(d.address), 'no address in the log');
  }
  // Next run, the reads work: each is checked once.
  const out = await usageChecks(now, {
    only: [base.id, arc.id, noCode.id],
    getCode: codeOk,
    blockscout: async () => ({ transactions_count: '2' }),
    arcHead: async () => 30_000n,
    arcLogs: async () => ({ count: 0, senders: [] }),
  });
  assert.deepEqual(out, { checked: 3, failed: 0 });
});

test('11.5 a failed selection never throws: usageChecks answers failed 1', async () => {
  const lines = await errors(async () => assert.deepEqual(await usageChecks(new Date(), { db: failingDb('down').db }), { checked: 0, failed: 1 }));
  assert.deepEqual(lines, ['[events] usage_check PostgresError']);
});

test('11.0 logSender: the first indexed argument as a lowercase address; anything else is null', () => {
  const T0 = usageTopic('Tipped(address,uint256,string)');
  assert.equal(logSender([T0, `0x${'0'.repeat(24)}${'AB'.repeat(20)}`]), `0x${'ab'.repeat(20)}`);
  assert.equal(logSender([T0]), null);
  assert.equal(logSender([T0, `0x${'1'.repeat(64)}`]), null, 'not an address word');
});

test('11.4 no check starts after the cron deadline', dbTest, async () => {
  const now = new Date();
  const d = await seedDeployed(now, 31);
  let reads = 0;
  const out = await usageChecks(now, { only: [d.id], deadline: Date.now() - 1, getCode: async () => (reads++, '0x6080') });
  assert.deepEqual(out, { checked: 0, failed: 0 });
  assert.equal(reads, 0);
  assert.deepEqual(await usageOf(d.id), []);
});
