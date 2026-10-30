import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
      ('hosted', ${login}, 'signin', NULL, ${`${login}/tipjar`}, ${`https://tipjar-${login}.earnkit.app`}, ${db.json({ host: 'earnkit', slug: `tipjar-${login}` })}, ${keys[1]}),
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
  assert.deepEqual(by.get(s.keys[1])!.detail, { host: 'earnkit' }, 'the slug (<project>-<login>) is dropped');
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

/**
 * Columns the loose name match finds that hold no login or wallet (reviewed by hand). Any other
 * match must be listed by the script, so a new column can't slip past unlisted.
 */
const NOT_IDENTIFYING = new Set([
  'chain_checks.award_scan_hi', // a block number
  'sponsor_campaigns.award_source', // 'onchain' | 'plan'
  'sponsor_campaigns.award_tx', // a transaction hash
  'digest_subscriptions.email', // found through digest_subscriptions.login
  'installations.client_key', // a hash of the OAuth client id
  'builder_profiles.github_basis', // v2.12.1: how the login was proven (signin, app, ...)
  'builder_sources.gh_owner_type', // v2.13.1: User or Organization
  'stripe_connections.sealed_key', // v4.6: ciphertext of a Stripe read key; holds no login or wallet, and the row is deleted with page data (BUILDER_TABLES); never printed
]);

test('12.3 every column whose name could hold a login, wallet, repo, link or key is listed (or reviewed as not identifying)', dbTest, async () => {
  const cols = await sql()<{ c: string }[]>`
    SELECT table_name || '.' || column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> 'builder_events' AND data_type IN ('text', 'ARRAY', 'jsonb')
      -- v3.1 owner people view: a view (owner_people) holds nothing of its own; its base columns are listed.
      AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
      AND column_name ~ '(login|wallet|github|owner|deployer|winner|recipient|creator|award|repo|slug|email|live_key|full_name|^key$|_key$)'
      AND column_name !~ '^round_key$'`;
  assert.ok(cols.length > 50, 'the schema is there');
  const r = run('--login', 'nobody-here', '--wallet', '0x' + 'f'.repeat(40));
  assert.equal(r.code, 0, r.err);
  for (const { c } of cols) {
    if (NOT_IDENTIFYING.has(c)) continue;
    assert.match(r.out, new RegExp(`\\n  ${c.replace('.', '\\.')}: \\d+\\n`), c);
  }
});

test('12.3 the listing finds the login and wallet in rate-limit keys, and the login as the owner of a repo (never a substring)', dbTest, async () => {
  const t = tag();
  const login = `nm-${t}`;
  const wallet = `0x${hex(`w${t}`)}`;
  const db = sql();
  await db`INSERT INTO rate_windows (key, window_start, count) VALUES (${`deployDay:${login}:arc`}, now(), 1), (${`tokenLaunchWallet:${wallet}`}, now(), 1)`;
  await db`INSERT INTO repo_public_reads (repo_key, read_at) VALUES (${`github.com/${login}/jar`}, now()), (${`github.com/x-${login}y/jar`}, now())`;
  const r = run('--login', login, '--wallet', wallet);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\n  rate_windows\.key: 2\n/);
  assert.match(r.out, /\n  repo_public_reads\.repo_key: 1\n/, 'an owner part only, never a substring');
});

test('fix round: the listing names a post draft\'s frozen card and its proof link', dbTest, async () => {
  const t = tag();
  const login = `pd-${t}`;
  const db = sql();
  const [{ id }] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`pd-${t}`}) RETURNING id`;
  await db`INSERT INTO post_drafts (code, builder_id, moment, moment_key, shape, text, card, asked, proof_url, expires_at)
    VALUES (${`a${t}`.replace(/[^a-z2-7]/g, 'a').padEnd(10, 'a').slice(0, 10)}, ${id}, 'won', 'won:x', 'won', 'Kit won the X.', ${db.json({ repo: `https://github.com/${login}/kit` } as never)}, false,
      ${`https://${login}.github.io/won`}, now() + interval '14 days')`;
  const r = run('--login', login);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\n  post_drafts\.card: 1\n/);
  assert.match(r.out, /\n  post_drafts\.proof_url: 1\n/);
});

test('12.3 owner-run only: no package script, predeploy, Railway config, cron or app code runs the script', () => {
  for (const f of ['package.json', 'apps/frontend/package.json', 'railway.toml', 'apps/frontend/railway.toml'])
    if (existsSync(join(root, f))) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /events-redact/, f);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx|mts)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : [],
    );
  const files = ['app', 'lib'].flatMap((d) => walk(join(root, 'apps/frontend', d)));
  assert.ok(files.length > 100, 'the walk reaches the app');
  // A quoted path or an import (a comment naming the script is fine).
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /['"`][^'"`\n]*events-redact[^'"`\n]*['"`]/, f);
  const src = readFileSync(script, 'utf8');
  assert.match(src, /set_config\('earnkit\.events_redact', 'on:' \|\| txid_current\(\), true\)/);
  assert.match(src, /begin\('read only'/, 'the dry run is a read-only transaction');
});

test('12.3 v2.12: a builder_profiles row naming the login is counted for --login', dbTest, async () => {
  const t = tag();
  const login = `bp-${t}`.toLowerCase().slice(0, 38);
  const id = 2_100_000_000 + Math.floor(Math.random() * 40_000_000);
  await sql()`INSERT INTO builder_profiles (builder_id, slug, github_login, x_handle, fallback_handle)
    VALUES (${id}, ${`s-${t}`.toLowerCase()}, ${login}, ${login.replace(/-/g, '_').slice(0, 15)}, ${login})`;
  const r = run('--login', login);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\n  builder_profiles\.github_login: 1\n/);
  assert.match(r.out, /\n  builder_profiles\.fallback_handle: 1\n/);
});

test('12.4 --login clears that person\'s page data (dry run says so first), another login and a --wallet-only run change nothing', dbTest, async () => {
  const t = tag();
  const t8 = t.slice(-8);
  const [X, Y] = [`px${t8}`, `py${t8}`];
  const wallet = `0x${hex(`pw${t}`)}`;
  const idX = 2_100_800_000 + Math.floor(Math.random() * 90_000);
  const idY = idX + 1;
  const db = sql();
  const seedPerson = async (id: number, login: string, w: string) => {
    await db`INSERT INTO builder_profiles (builder_id, slug, github_login, x_handle, fallback_handle, x_user_id, x_name, x_avatar_url,
        reported_github, base_builder_code, identity, github_basis)
      VALUES (${id}, ${`s-${login}`}, ${login}, ${login.replace(/-/g, '_')}, ${login}, ${`xu-${login}`}, 'N', 'https://a/b.png', ${login}, 'bc', ${db.json({ a: 1 })}, 'signin')`;
    await db`INSERT INTO claim_codes (code_hash, builder_id) VALUES (${`h-${login}`}, ${id})`;
    await db`INSERT INTO person_wallets (wallet, builder_id) VALUES (${w}, ${id})`;
    await db`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, 'k', 'P', 'app', true, true)`;
    await db`INSERT INTO x_oauth_states (state_hash, builder_id, code_verifier, csrf_hash, expires_at) VALUES (${`st-${login}`}, ${id}, 'v', 'c', now())`;
    await db`INSERT INTO coin_moments (builder_id, project_key, moment) VALUES (${id}, 'k', 'built_live')`;
    // v4.6 F1: the Stripe key (ciphertext) and the 30-day figure are page data, deleted with the builder.
    await db`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${id}, 'sealed-ciphertext', ${`acct_${login}-${t}`}, 'x.example')`;
    await db`INSERT INTO stripe_revenue (builder_id, day, net_usd, mrr_usd, payers, top_share, shown, capped) VALUES (${id}, current_date, 100, 0, 3, 0.3, true, false)`;
    // Scoring and clarity R3: the main project's Originality row; its nearest list names the other person's repo.
    const other = login === X ? Y : X;
    await db`INSERT INTO project_embeddings (project_key, builder_id, originality, nearest, checked_at)
      VALUES (${`${login}/app`}, ${id}, 50, ${db.json([{ kind: 'project', key: `${other}/app`, similarity: 0.6 }])}, now())`;
    const [inst] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, x_user_id) VALUES (${`th-${login}-${t}`}, ${`xu-${login}`}) RETURNING id`;
    // v2.14 T7: an X sign-in link of this person's installation (it keeps the X id and handle).
    await db`INSERT INTO x_signin_links (link_hash, installation_id, expires_at, x_user_id, x_handle)
      VALUES (${createHash('sha256').update(`lk-${login}-${t}`).digest('hex')}, ${inst.id}, now() + interval '1 day', ${`xu-${login}`}, ${login})`;
  };
  const links = async (login: string) => (await db`SELECT 1 FROM x_signin_links WHERE x_user_id = ${`xu-${login}`}`).length;
  const boundTo = async (login: string) => (await db`SELECT 1 FROM installations WHERE x_user_id = ${`xu-${login}`}`).length;
  await seedPerson(idX, X, wallet);
  await seedPerson(idY, Y, `0x${hex(`pz${t}`)}`);
  const profile = async (id: number) =>
    (await db<Record<string, unknown>[]>`SELECT x_user_id, x_name, x_avatar_url, reported_github, base_builder_code, github_basis, identity, x_handle, fallback_handle
      FROM builder_profiles WHERE builder_id = ${id}`)[0];
  const tables = ['claim_codes', 'person_wallets', 'builder_projects', 'x_oauth_states', 'coin_moments', 'project_embeddings', 'stripe_connections', 'stripe_revenue'];
  const count = async (id: number) => Promise.all(tables.map(async (tb) => (await db`SELECT 1 FROM ${db(tb)} WHERE builder_id = ${id}`).length));
  try {
    const dry = run('--login', X);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /Page data that --apply will clear or delete \(page profiles: 1, claim_codes: 1, person_wallets: 1, builder_projects: 1, x_oauth_states: 1, coin_moments: 1, project_updates: 0, project_embeddings: 1, post_drafts: 0, stripe_connections: 1, stripe_revenue: 1\)/);
    assert.deepEqual(await count(idX), [1, 1, 1, 1, 1, 1, 1, 1]);
    assert.equal((await profile(idX)).x_user_id, `xu-${X}`);

    const wOnly = run('--wallet', wallet, '--apply');
    assert.equal(wOnly.code, 0, wOnly.err);
    assert.doesNotMatch(wOnly.out, /Page data/);
    assert.deepEqual(await count(idX), [1, 1, 1, 1, 1, 1, 1, 1], 'a --wallet-only run deletes nothing');
    assert.equal((await profile(idX)).x_user_id, `xu-${X}`);
    assert.equal(await boundTo(X), 1);

    const r = run('--login', X, '--apply');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Page data cleared or deleted \(page profiles: 1, claim_codes: 1, person_wallets: 1, builder_projects: 1, x_oauth_states: 1, coin_moments: 1, project_updates: 0, project_embeddings: 1, post_drafts: 0, stripe_connections: 1, stripe_revenue: 1\)/);
    const px = await profile(idX);
    for (const k of ['x_user_id', 'x_name', 'x_avatar_url', 'reported_github', 'base_builder_code', 'github_basis', 'x_handle', 'fallback_handle']) assert.equal(px[k], null, k);
    assert.equal(await boundTo(X), 0, 'v2.14: its installations are unbound from the X account');
    assert.equal(await boundTo(Y), 1, "another person's binding stays");
    assert.equal(await links(X), 0, 'v2.14 T7: its X sign-in links are deleted');
    assert.equal(await links(Y), 1, "another person's link stays");
    assert.deepEqual(px.identity, {});
    assert.doesNotMatch(r.out + r.err, /sealed-ciphertext/, 'the sealed key is never printed');
    assert.deepEqual(await count(idX), [0, 0, 0, 0, 0, 0, 0, 0]);
    const py = await profile(idY);
    assert.equal(py.x_user_id, `xu-${Y}`);
    assert.deepEqual(py.identity, { a: 1 });
    assert.deepEqual(await count(idY), [1, 1, 1, 1, 1, 1, 1, 1]);
    // The other person's Originality nearest list no longer names X's repo.
    assert.deepEqual((await db<{ nearest: unknown }[]>`SELECT nearest FROM project_embeddings WHERE builder_id = ${idY}`)[0].nearest, []);
  } finally {
    for (const id of [idX, idY]) {
      for (const tb of tables) await db`DELETE FROM ${db(tb)} WHERE builder_id = ${id}`;
      await db`DELETE FROM builder_profiles WHERE builder_id = ${id}`;
    }
  }
});
