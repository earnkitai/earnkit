import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';

// v2.11 T12 (plan 12.3): the owner-run redaction script, run as the owner runs it (a child process)
// against the test database. Rows are test-local: their own logins, wallets and dedupe keys.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const root = join(import.meta.dirname, '../../../..');
const script = join(import.meta.dirname, '../../scripts/events-redact.mts');

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd: root, env: process.env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tag = () => `${process.pid.toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hex = (s: string) => Buffer.from(s).toString('hex').padEnd(40, '0').slice(0, 40);

type Row = { dedupe_key: string; github_login: string | null; wallet: string | null; repo_key: string | null; proof_url: string | null; detail: Record<string, unknown> };
const rows = (keys: string[]) =>
  sql()<Row[]>`SELECT dedupe_key, github_login, wallet, repo_key, proof_url, detail FROM builder_events
    WHERE dedupe_key = ANY(${keys}::text[]) ORDER BY dedupe_key`;

async function seed() {
  const t = tag();
  const login = `rd-${t}`;
  const wallet = `0x${hex(t)}`;
  const other = `ot-${t}`;
  const keys = [`deployed:rd-${t}`, `hosted:rd-${t}`, `entered:rd-${t}`, `built:rd-${t}`];
  const db = sql();
  await db`
    INSERT INTO builder_events (type, github_login, login_basis, wallet, repo_key, proof_url, detail, dedupe_key) VALUES
      ('deployed', ${login}, 'proof_line', ${wallet}, ${`${login}/tipjar`}, NULL, ${db.json({ address: '0x' + '1'.repeat(40), block: 7 })}, ${keys[0]}),
      ('hosted', ${login}, 'signin', NULL, ${`${login}/tipjar`}, ${`https://tipjar-${login}.earnkit.app`}, ${db.json({ host: 'earnkit' })}, ${keys[1]}),
      ('entered', NULL, NULL, ${wallet.toUpperCase().replace('0X', '0x')}, ${`${login}/tipjar`}, 'https://earnkit.com/p/1', '{}', ${keys[2]}),
      ('built', ${other}, 'proof_line', NULL, ${`${other}/jar`}, NULL, ${db.json({ twist: 'tips for cats' })}, ${keys[3]})`;
  // Another table that holds the login: listed, never changed.
  // (github_users, a GitHub facts cache: no stats or board reads it.)
  await db`INSERT INTO github_users (login, created_at) VALUES (${login}, now() - interval '2 years')`;
  return { login, wallet, other, keys };
}

test('12.3 a dry run lists the matching rows and changes nothing; the other tables are listed only', dbTest, async () => {
  const s = await seed();
  const before = await rows(s.keys);
  const r = run('--login', s.login.toUpperCase(), '--wallet', s.wallet);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /builder_events: 3 row\(s\) match login rd-/);
  assert.match(r.out, /deployed [0-9-]{10}: login, wallet\n/);
  assert.match(r.out, /hosted [0-9-]{10}: login\n/);
  assert.match(r.out, /entered [0-9-]{10}: wallet\n/);
  assert.match(r.out, /Dry run: nothing changed\. Add --apply/);
  assert.match(r.out, /github_users\.login: 1\n/);
  assert.match(r.out, /contract_deploys\.owner_wallet: 0\n/);
  assert.deepEqual(await rows(s.keys), before);
  assert.equal((await sql()`SELECT 1 FROM github_users WHERE login = ${s.login}`).length, 1);
});

test('12.3 --apply nulls login and wallet and drops the twist in one transaction; the trigger is back on after', dbTest, async () => {
  const s = await seed();
  // The other builder's row carries a twist; one of this builder's rows gets one too.
  const twistKey = `built:rd2-${tag()}`;
  await sql()`INSERT INTO builder_events (type, github_login, login_basis, repo_key, detail, dedupe_key)
    VALUES ('built', ${s.login}, 'proof_line', ${`${s.login}/tipjar`}, ${sql().json({ twist: 'a tip jar for my band', basis: 'proof_line' })}, ${twistKey})`;
  const r = run('--login', s.login, '--wallet', s.wallet, '--apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /builder_events: redacted 4 row\(s\) for login rd-/);
  assert.match(r.out, /Rows still matching: 0\. The table is append-only again\./);
  assert.match(r.out, /Kept as they are: 4 builder_events row\(s\) whose repo or link may still name rd-/);
  assert.match(r.out, /github_users\.login: 1\n/);

  const by = new Map((await rows([...s.keys, twistKey])).map((x) => [x.dedupe_key, x]));
  for (const k of [s.keys[0], s.keys[1], s.keys[2], twistKey]) {
    assert.equal(by.get(k)!.github_login, null, k);
    assert.equal(by.get(k)!.wallet, null, k);
    assert.equal(by.get(k)!.repo_key, `${s.login}/tipjar`, `${k}: the repo stays`);
  }
  assert.deepEqual(by.get(s.keys[0])!.detail, { address: '0x' + '1'.repeat(40), block: 7 });
  assert.equal(by.get(s.keys[1])!.proof_url, `https://tipjar-${s.login}.earnkit.app`);
  assert.deepEqual(by.get(twistKey)!.detail, { basis: 'proof_line' });
  // The other builder is untouched, twist included.
  assert.equal(by.get(s.keys[3])!.github_login, s.other);
  assert.deepEqual(by.get(s.keys[3])!.detail, { twist: 'tips for cats' });
  // Other tables are never changed.
  assert.equal((await sql()`SELECT 1 FROM github_users WHERE login = ${s.login}`).length, 1);
  // Append-only again: a following UPDATE (and DELETE) throws.
  await assert.rejects(sql()`UPDATE builder_events SET github_login = NULL WHERE dedupe_key = ${s.keys[3]}`, /append-only/);
  await assert.rejects(sql()`DELETE FROM builder_events WHERE dedupe_key = ${s.keys[0]}`, /append-only/);
  // A rerun finds nothing.
  const again = run('--login', s.login, '--wallet', s.wallet, '--apply');
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /redacted 0 row\(s\)/);
});

test('12.3 a wallet alone redacts only the rows with that wallet', dbTest, async () => {
  const s = await seed();
  const r = run('--wallet', s.wallet, '--apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /redacted 2 row\(s\) for wallet 0x/);
  const by = new Map((await rows(s.keys)).map((x) => [x.dedupe_key, x]));
  assert.deepEqual([by.get(s.keys[0])!.github_login, by.get(s.keys[0])!.wallet], [null, null]);
  assert.equal(by.get(s.keys[2])!.wallet, null);
  assert.equal(by.get(s.keys[1])!.github_login, s.login, 'a row without the wallet keeps its login');
});

test('12.3 bad arguments write nothing and exit 2', () => {
  for (const args of [[], ['--apply'], ['--login', 'bad login'], ['--wallet', '0x123'], ['--login', 'a', '--nope']]) {
    const r = run(...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /Usage: events-redact\.mts/);
    assert.equal(r.out, '');
  }
});

test('12.3 every login or wallet column outside builder_events is listed', dbTest, async () => {
  const cols = await sql()<{ c: string }[]>`
    SELECT table_name || '.' || column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> 'builder_events'
      AND column_name ~ '(^|_)(login|wallet)$|^github_user$|^owner$|^deployers$'`;
  assert.ok(cols.length > 20, 'the schema is there');
  const r = run('--login', 'nobody-here', '--wallet', '0x' + 'f'.repeat(40));
  assert.equal(r.code, 0, r.err);
  for (const { c } of cols) assert.match(r.out, new RegExp(`\\n  ${c.replace('.', '\\.')}: \\d+\\n`), c);
});

test('12.3 owner-run only: no predeploy, cron or app code runs the script', () => {
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');
  assert.doesNotMatch(pkg, /events-redact/);
  const src = readFileSync(script, 'utf8');
  assert.match(src, /set_config\('earnkit\.events_redact', 'on:' \|\| txid_current\(\), true\)/);
  assert.match(src, /begin\('read only'/, 'the dry run is a read-only transaction');
});
