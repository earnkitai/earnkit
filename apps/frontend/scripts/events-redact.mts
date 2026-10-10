import './env.mts';
import { parseArgs } from 'node:util';
import { sql } from '../lib/earnkit/db';

/**
 * v2.11 T12 (spec 9, owner decision 6): removes one builder's GitHub login and wallet from the
 * builder event log, on that builder's email request. Owner-run only, never from predeploy or the cron:
 *
 *   pnpm exec tsx apps/frontend/scripts/events-redact.mts --login <github login> [--wallet <0x...>]
 *   pnpm exec tsx apps/frontend/scripts/events-redact.mts --wallet <0x...> --apply
 *
 * A dry run by default: it lists the matching builder_events rows in a read-only transaction and
 * changes nothing. --apply redacts them in one transaction: github_login and wallet become NULL and
 * detail loses its twist. That transaction sets earnkit.events_redact to 'on:' || txid_current(),
 * the only value the append-only trigger accepts, and only for those changes (db/schema.sql). The
 * setting ends with the transaction, so the table is append-only again right after.
 *
 * The repo, the program, the proofs and every other column stay (the trigger refuses any other
 * change). The output says how many kept rows still name the login in their repo or link.
 *
 * Every other table that holds the login or wallet is listed with its row count and never changed:
 * the owner decides what to do with those.
 */

const USAGE = 'Usage: events-redact.mts --login <github login> and/or --wallet <0x address> [--apply]';
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;
const WALLET = /^0x[0-9a-f]{40}$/;

/** Columns outside builder_events that hold a builder's login or wallet. Read only, never changed. */
const LOGIN_COLUMNS: [table: string, column: string][] = [
  ['installations', 'github_user'],
  ['github_verifications', 'login'],
  ['github_verify_nonces', 'login'],
  ['github_users', 'login'],
  ['builder_program_status', 'login'],
  ['builder_repo_facts', 'login'],
  ['token_declines', 'login'],
  ['digest_subscriptions', 'login'],
  ['hosted_sites', 'login'],
  ['host_deploys', 'login'],
  ['host_upload_tokens', 'login'],
  ['contract_deploys', 'login'],
  ['bonus_commits', 'login'],
];
const WALLET_COLUMNS: [table: string, column: string][] = [
  ['installations', 'payout_wallet'],
  ['installation_wallets', 'wallet'],
  ['projects', 'payout_wallet'],
  ['projects', 'creator_wallet'],
  ['entry_wallets', 'wallet'],
  ['github_verifications', 'wallet'],
  ['github_verify_nonces', 'wallet'],
  ['token_offers', 'offered_wallet'],
  ['contract_deploys', 'owner_wallet'],
  ['token_fees', 'wallet'],
  ['fee_claims', 'owner'],
  ['bonus_payouts', 'wallet'],
  ['bonus_sweeps', 'to_wallet'],
  ['sponsor_verifications', 'wallet'],
  ['sponsor_campaigns', 'sponsor_wallet'],
];
/** text[] columns that can hold the wallet. */
const WALLET_ARRAYS: [string, string][] = [['projects', 'deployers']];
/** jsonb columns that can hold the login or the wallet as a JSON string value. */
const JSON_COLUMNS: [string, string][] = [
  ['installations', 'build'],
  ['installations', 'pickup'],
  ['projects', 'fee_recipients'],
  ['sponsor_campaigns', 'fallback_plan'],
];

const { values } = (() => {
  try {
    return parseArgs({ options: { login: { type: 'string' }, wallet: { type: 'string' }, apply: { type: 'boolean', default: false } }, strict: true });
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : err}\n${USAGE}`);
    process.exit(2);
  }
})();
const login = values.login?.trim().toLowerCase() || null;
const wallet = values.wallet?.trim().toLowerCase() || null;
if (!login && !wallet) {
  console.error(USAGE);
  process.exit(2);
}
if (login && !LOGIN.test(login)) {
  console.error(`Not a GitHub login: ${values.login}\n${USAGE}`);
  process.exit(2);
}
if (wallet && !WALLET.test(wallet)) {
  console.error(`Not a wallet address: ${values.wallet}\n${USAGE}`);
  process.exit(2);
}

const db = sql();
const who = [login && `login ${login}`, wallet && `wallet ${wallet}`].filter(Boolean).join(', ');
const match = db`(${login ? db`lower(github_login) = ${login}` : db`false`} OR ${wallet ? db`lower(wallet) = ${wallet}` : db`false`})`;

type Row = { id: string; type: string; at: Date; github_login: string | null; wallet: string | null; twist: boolean };
const listRows = (q: typeof db | Parameters<Parameters<typeof db.begin>[0]>[0]) => q<Row[]>`
  SELECT id::text, type, at, github_login, wallet, detail ? 'twist' AS twist
  FROM builder_events WHERE ${match} ORDER BY id`;
const show = (r: Row) =>
  `  #${r.id} ${r.type} ${r.at.toISOString().slice(0, 10)}: ${[r.github_login && 'login', r.wallet && 'wallet', r.twist && 'twist'].filter(Boolean).join(', ')}`;

try {
  let rows: Row[];
  if (!values.apply) {
    rows = await db.begin('read only', (tx) => listRows(tx));
    console.log(`builder_events: ${rows.length} row(s) match ${who}`);
    for (const r of rows) console.log(show(r));
    console.log('Dry run: nothing changed. Add --apply to redact these rows.');
  } else {
    rows = await db.begin(async (tx) => {
      await tx`SELECT set_config('earnkit.events_redact', 'on:' || txid_current(), true)`;
      const found = await listRows(tx);
      const done = await tx`
        UPDATE builder_events SET github_login = NULL, wallet = NULL, detail = detail - 'twist'
        WHERE ${match} RETURNING id`;
      if (done.length !== found.length) throw new Error(`redacted ${done.length} of ${found.length} rows; rolled back`);
      return found;
    });
    console.log(`builder_events: redacted ${rows.length} row(s) for ${who} at ${new Date().toISOString()}`);
    for (const r of rows) console.log(show(r));
    const [left] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE ${match}`;
    console.log(`Rows still matching: ${left.n}. The table is append-only again.`);
  }

  if (login) {
    const [named] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM builder_events
      WHERE split_part(repo_key, '/', 1) = ${login} OR lower(proof_url) LIKE ${`%${login}%`}`;
    console.log(`Kept as they are: ${named.n} builder_events row(s) whose repo or link may still name ${login}.`);
  }

  console.log('Other tables (listed only, never changed here; the owner decides):');
  const count = async (label: string, where: ReturnType<typeof db>, table: string) => {
    const [r] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM ${db(table)} WHERE ${where}`;
    console.log(`  ${label}: ${r.n}`);
  };
  for (const [t, c] of LOGIN_COLUMNS)
    await count(`${t}.${c}`, login ? db`lower(${db(c)}) = ${login}` : db`false`, t);
  for (const [t, c] of WALLET_COLUMNS)
    await count(`${t}.${c}`, wallet ? db`lower(${db(c)}) = ${wallet}` : db`false`, t);
  for (const [t, c] of WALLET_ARRAYS)
    await count(`${t}.${c}`, wallet ? db`EXISTS (SELECT 1 FROM unnest(${db(c)}) v WHERE lower(v) = ${wallet})` : db`false`, t);
  const quoted = [login, wallet].filter((x): x is string => x !== null).map((x) => `%"${x}"%`);
  for (const [t, c] of JSON_COLUMNS) await count(`${t}.${c}`, db`lower(${db(c)}::text) LIKE ANY(${quoted}::text[])`, t);
} finally {
  await db.end();
}
