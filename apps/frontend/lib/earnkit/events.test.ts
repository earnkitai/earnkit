import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { EVENT_LOG_FLAG, EVENT_WAIT_MS, eventLogEnabled, eventRepoKey, noteEvent, proofLink, recordEvent, type BuilderEvent } from './events';
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
