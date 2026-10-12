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
 * detail loses its twist and its slug (the slug is <project>-<login>). That transaction sets earnkit.events_redact to 'on:' || txid_current(),
 * the only value the append-only trigger accepts, and only for those changes (db/schema.sql). The
 * setting ends with the transaction, so the table is append-only again right after.
 *
 * The repo, the program, the proofs and every other column stay (the trigger refuses any other
 * change). The output says how many kept rows still name the login in their repo or link.
 *
 * The main other tables that hold the login or wallet (as a column, in a repo key, link, slug or
 * jsonb, or as part of a rate-limit or cache key) are listed with their row counts and never
 * changed: the owner decides what to do with those. Redacted rows keep installation_id and
 * project_id, which still join to those tables.
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
  // v2.12: the builder score's profile (proven login, X handle, fallback handle: a login or a short wallet).
  ['builder_profiles', 'github_login'],
  ['builder_profiles', 'x_handle'],
  ['builder_profiles', 'fallback_handle'],
  ['builder_program_status', 'login'],
  ['builder_repo_facts', 'login'],
  ['token_declines', 'login'],
  ['digest_subscriptions', 'login'],
  ['hosted_sites', 'login'],
  ['host_deploys', 'login'],
  ['host_upload_tokens', 'login'],
  ['contract_deploys', 'login'],
  ['contract_deploys', 'builder_key'],
  // v2.11 T9 security fix (I1): who GitHub says pushed the earnkit.txt line.
  ['contract_deploys', 'line_owner'],
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
const WALLET_ARRAYS: [string, string][] = [
  ['projects', 'deployers'],
  ['sponsor_campaigns', 'award_winners'],
];
/** jsonb columns that can hold the login or the wallet (a JSON string value, a repo or a link). */
const JSON_COLUMNS: [string, string][] = [
  ['installations', 'build'],
  ['installations', 'pickup'],
  ['installations', 'local_repos'],
  ['installations', 'fit_repos'],
  ['projects', 'fee_recipients'],
  ['sponsor_campaigns', 'fallback_plan'],
  ['sponsor_campaigns', 'award_plan'],
  ['sponsor_campaigns', 'award_onchain'],
];
/** Keys made of ':'-separated parts, one of which can be the login or wallet (short-lived). */
const KEY_COLUMNS: [string, string][] = [
  ['rate_windows', 'key'],
  ['url_checks', 'key'],
];
/** Repo keys, repo URLs, hosted slugs and links whose owner part can be the login. */
const NAMED_COLUMNS: [string, string][] = [
  ['projects', 'repo_url'],
  ['projects', 'repo_key'],
  ['projects', 'bonus_repo_key'],
  ['projects', 'token_repo_key'],
  ['projects', 'live_key'],
  ['answer_bank', 'project_key'],
  ['token_offers', 'entry_key'],
  ['builder_repo_facts', 'repo_key'],
  ['match_shown', 'repo_key'],
  ['token_declines', 'repo_key'],
  ['github_repo_facts', 'full_name'],
  ['repo_public_reads', 'repo_key'],
  ['github_verifications', 'repo_key'],
  ['github_verify_nonces', 'repo_key'],
  ['contract_deploys', 'repo_key'],
  // v2.11 T9 R4: when an installation was first shown a repo's earnkit.txt line.
  ['proof_line_issues', 'repo_key'],
  ['hosted_sites', 'repo_key'],
  ['hosted_sites', 'slug'],
  ['host_deploys', 'repo_key'],
  ['host_deploys', 'slug'],
  ['host_upload_tokens', 'repo_key'],
  ['host_upload_tokens', 'slug'],
  // v2.12: a profile's slug (the X handle or login), its history, and the sources' repo, site and project keys.
  ['builder_profiles', 'slug'],
  ['profile_slug_history', 'old_slug'],
  ['builder_sources', 'ref'],
  ['builder_sources', 'project_key'],
];
const NAMED_ARRAYS: [string, string][] = [['installations', 'repos']];

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
/**
 * A repo key, URL, slug or link that names the login: owner/..., github.com/<login>/...,
 * <project>-<login> (a hosted slug or link) or <login>.github.io. The login is [a-z0-9-] only.
 */
const named = login ? `(^|/)${login}(/|$)|-${login}(\\.|$)|(^|/)${login}\\.github\\.io` : null;
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
        UPDATE builder_events SET github_login = NULL, wallet = NULL, detail = detail - 'twist' - 'slug'
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
    const [kept] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM builder_events
      WHERE lower(repo_key) ~ ${named} OR lower(proof_url) ~ ${named}`;
    console.log(`Kept as they are: ${kept.n} builder_events row(s) whose repo or link may still name ${login}.`);
  }

  console.log('Other tables (listed only, never changed here; the owner decides).');
  console.log('Columns holding the login or wallet:');
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
  for (const [t, c] of JSON_COLUMNS)
    await count(`${t}.${c}`, db`(lower(${db(c)}::text) LIKE ANY(${quoted}::text[]) OR ${named ? db`lower(${db(c)}::text) ~ ${named}` : db`false`})`, t);
  const parts = [login, wallet].filter((x): x is string => x !== null);
  for (const [t, c] of KEY_COLUMNS) await count(`${t}.${c}`, db`string_to_array(lower(${db(c)}), ':') && ${parts}::text[]`, t);
  console.log(`Repos, links and slugs that name the login${login ? '' : ' (no --login: none checked)'}:`);
  for (const [t, c] of NAMED_COLUMNS) await count(`${t}.${c}`, named ? db`lower(${db(c)}) ~ ${named}` : db`false`, t);
  for (const [t, c] of NAMED_ARRAYS)
    await count(`${t}.${c}`, named ? db`EXISTS (SELECT 1 FROM unnest(${db(c)}) v WHERE lower(v) ~ ${named})` : db`false`, t);
} finally {
  await db.end();
}
