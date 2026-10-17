import { createHash } from 'node:crypto';
import type { ReportedRepo } from './match';
import type { FitRepo } from './alerts';
import { isWalletAddress, normalizeRepoUrl } from './campaigns';
import { builderScoreEnabled } from './builder-score-flag';
import { sql } from './db';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const warnedTestIds = new Set<string>();

/**
 * v2.6 §5, Ruling 6 (plan): the owner's test installations, from EARNKIT_TEST_INSTALLATIONS
 * (comma-separated ids). Excluded from /api/stats, never ranked, never paid. A malformed part is
 * ignored; one warning per distinct value names its positions only, never its text.
 */
export function testInstallationIds(
  env: Record<string, string | undefined> = process.env,
  warn: (line: string) => void = console.warn,
): number[] {
  const raw = env.EARNKIT_TEST_INSTALLATIONS ?? '';
  const ids = new Set<number>();
  const bad: number[] = [];
  raw.split(',').forEach((part, i) => {
    const s = part.trim();
    if (s === '') return;
    const n = /^\d{1,10}$/.test(s) ? Number(s) : NaN;
    if (Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647) ids.add(n);
    else bad.push(i + 1);
  });
  if (bad.length > 0 && !warnedTestIds.has(raw)) {
    warnedTestIds.add(raw);
    warn(`[earnkit] EARNKIT_TEST_INSTALLATIONS: ignored ${bad.length} malformed id${bad.length === 1 ? '' : 's'} (position ${bad.join(', ')})`);
  }
  return [...ids].sort((a, b) => a - b);
}

/** v2.9 A7: at most this many fit repos are remembered per installation. */
export const MAX_FIT_REPOS = 5;

/** v2.9 A7: the repos worth remembering: owned, project tier or better, the highest score first, at most 5. Pure. */
export const bestFitRepos = (repos: FitRepo[]): FitRepo[] =>
  repos
    .filter((r) => r.product.tier !== 'noise' && !r.product.missing.includes('owned'))
    .sort((a, b) => b.product.score - a.product.score)
    .slice(0, MAX_FIT_REPOS);

/**
 * v2.9 A7: the builder's best owned repos as they last matched (bestFitRepos: owned,
 * project tier or better, the highest score first, at most 5), written by list_programs after
 * matching. New program alerts read them and make no GitHub call. Replaces v2.8's fit_chains.
 */
export async function setFitRepos(installationId: number, repos: FitRepo[]): Promise<void> {
  const best = bestFitRepos(repos);
  await sql()`UPDATE installations SET fit_repos = ${sql().json(best as never)} WHERE id = ${installationId}`;
}

/**
 * v2.11 T7: the first time find showed this installation the fresh-build lead (the v2.11 metric's
 * start). Set once: a later lead never moves it.
 */
export async function markFreshOffer(installationId: number, at: Date): Promise<void> {
  await sql()`UPDATE installations SET fresh_offer_at = ${at} WHERE id = ${installationId} AND fresh_offer_at IS NULL`;
}

/**
 * v2.11 plan S6: the one build in progress (installations.build): the program and its starter from
 * build.start, then the wallet and the fields the agent wrote from the builder's twist, once they
 * pass the build checks. A new build.start replaces it. Never on a shared client (no build path).
 */
export type StoredBuild = {
  program_id: string;
  starter_id: string;
  started_at: string;
  wallet?: string;
  twist?: string;
  name?: string;
  description?: string;
  feature?: string;
  for_whom?: string;
  repo_url?: string;
  /** v2.13.1 O2 (B4): when the agent sent the build's live link (the build is no longer in progress). */
  done_at?: string;
};

export async function readBuild(installationId: number): Promise<StoredBuild | null> {
  const [row] = await sql()<{ build: StoredBuild | null }[]>`SELECT build FROM installations WHERE id = ${installationId}`;
  return row?.build ?? null;
}

export async function saveBuild(installationId: number, build: StoredBuild): Promise<void> {
  await sql()`UPDATE installations SET build = ${sql().json(build as never)} WHERE id = ${installationId}`;
}

/** v2.9 T12 (G15 M1): the builder's best owned repos as they last matched (setFitRepos). */
export async function readFitRepos(installationId: number): Promise<FitRepo[]> {
  const [row] = await sql()<{ fit_repos: FitRepo[] | null }[]>`SELECT fit_repos FROM installations WHERE id = ${installationId}`;
  return row?.fit_repos ?? [];
}

/** True when this token, or (v2.4) this OAuth client, already has an installation. */
export async function installationExists(token: string, clientKey?: string) {
  const [row] = await sql()`
    SELECT 1 FROM installations
    WHERE token_hash = ${hash(token)} OR (${clientKey ?? null}::text IS NOT NULL AND client_key = ${clientKey ?? null})`;
  return Boolean(row);
}

/**
 * Records the installation for a newly issued token. With a client key (v2.4 §5) there is one
 * installation per OAuth client: a new token for a known client replaces its token (the old one
 * stops working), so entries, wins and memory carry over. Idempotent for replayed codes.
 */
export async function saveInstallation(token: string, clientKey?: string, shared = false, clientName: string | null = null) {
  // v2.8.1 §E17: `shared` (a hosted agent client) is kept once set: a re-authorization never clears it.
  // v2.13.4 R6: the client's registered name (cleaned), kept for the R1 claim page.
  if (!clientKey) {
    await sql()`
      INSERT INTO installations (token_hash, shared_client, client_name) VALUES (${hash(token)}, ${shared}, ${clientName})
      ON CONFLICT (token_hash) DO UPDATE SET shared_client = installations.shared_client OR EXCLUDED.shared_client,
        client_name = COALESCE(EXCLUDED.client_name, installations.client_name)`;
    return;
  }
  await sql()`
    INSERT INTO installations (token_hash, client_key, shared_client, client_name) VALUES (${hash(token)}, ${clientKey}, ${shared}, ${clientName})
    ON CONFLICT (client_key) WHERE client_key IS NOT NULL
    DO UPDATE SET token_hash = EXCLUDED.token_hash, shared_client = installations.shared_client OR EXCLUDED.shared_client,
      client_name = COALESCE(EXCLUDED.client_name, installations.client_name)`;
}

/**
 * Remembers wallets this installation used (lowercase; anything that isn't a 0x address is
 * ignored). Its wins and token fees show for them too (v2.4 §5).
 */
export async function rememberWallets(
  installationId: number,
  wallets: (string | null | undefined)[],
) {
  const list = [
    ...new Set(
      wallets
        .filter((w): w is string => !!w && /^0x[0-9a-fA-F]{40}$/.test(w))
        .map((w) => w.toLowerCase()),
    ),
  ];
  if (list.length === 0) return;
  const added = await sql()<{ wallet: string }[]>`
    INSERT INTO installation_wallets ${sql()(list.map((wallet) => ({ installation_id: installationId, wallet })))}
    ON CONFLICT DO NOTHING RETURNING wallet`;
  // v2.12 spec 3: a wallet not seen before (given at deploy, or with an entry) is a new discovery clue.
  if (added.length > 0 && builderScoreEnabled()) await (await import('./discovery')).enqueueClue(installationId, 'wallet');
}

/** The wallets this installation has used (lowercase). */
export async function installationWallets(installationId: number) {
  const rows = await sql()<{ wallet: string }[]>`
    SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId} ORDER BY first_seen_at`;
  return rows.map((r) => r.wallet);
}

export type Memory = {
  /** When this installation last listed programs (null the first time). */
  lastCheck: Date | null;
  github_user: string | null;
  repos: string[] | null;
  local_repos: ReportedRepo[] | null;
  working_on: string[];
};

/**
 * Starts a list_programs check: records now as the check time, saves the GitHub user/repos when
 * given, and returns what the installation had before (so later calls can omit them).
 */
export async function checkPrograms(
  installationId: number,
  given: {
    github_user?: string;
    repos?: string[];
    local_repos?: ReportedRepo[];
  } = {},
): Promise<Memory> {
  const db = sql();
  const saving = Boolean(given.github_user || given.repos?.length);
  const savingLocal = Boolean(given.local_repos?.length);
  const [row] = await db<
    {
      prev: Date | null;
      github_user: string | null;
      repos: string[] | null;
      local_repos: ReportedRepo[] | null;
      working_on: string[];
    }[]
  >`
    UPDATE installations i SET programs_checked_at = now(),
      local_repos = CASE WHEN ${savingLocal} THEN ${savingLocal ? db.json(given.local_repos!) : null} ELSE i.local_repos END,
      github_user = CASE WHEN ${saving} THEN ${given.github_user ?? null} ELSE i.github_user END,
      repos = CASE WHEN ${saving} THEN ${given.repos?.length ? given.repos : null}::text[] ELSE i.repos END
    FROM (SELECT id, programs_checked_at AS prev FROM installations WHERE id = ${installationId}) o
    WHERE i.id = o.id RETURNING o.prev, i.github_user, i.repos, i.local_repos, i.working_on`;
  return {
    lastCheck: row?.prev ?? null,
    github_user: row?.github_user ?? null,
    repos: row?.repos ?? null,
    local_repos: row?.local_repos ?? null,
    working_on: row?.working_on ?? [],
  };
}

/**
 * Marks a program as being prepared by this installation (true) or done with (false). v2.10 item 3:
 * resolves true only when `on` added a program that wasn't there (the first prepare for it).
 */
export async function setWorkingOn(
  installationId: number,
  programId: string,
  on: boolean,
): Promise<boolean> {
  const [row] = await sql()<{ added: boolean }[]>`
    UPDATE installations i SET working_on = CASE WHEN ${on}
      THEN array_append(array_remove(i.working_on, ${programId}), ${programId})
      ELSE array_remove(i.working_on, ${programId}) END
    FROM (SELECT working_on AS before FROM installations WHERE id = ${installationId}) b
    WHERE i.id = ${installationId}
    RETURNING ${on} AND NOT (${programId} = ANY(coalesce(b.before, '{}'::text[]))) AS added`;
  return row?.added === true;
}

/** Who is calling: the installation the MCP tools act as, and the one the token belongs to. */
export type Caller = {
  /** v2.8.1 §E18: the group's root (the token's own installation when it isn't linked). */
  id: number;
  /** The token's own installation. */
  own: number;
  /** v2.8.1 §E17: an installation in the token's group came from a hosted agent client. */
  shared: boolean;
};

/**
 * The caller for this token (and marks its installation as seen), or null if unknown. v2.8.1 §E18:
 * a linked installation acts as its group's root, so entries, the answer bank, memory and alerts are
 * the group's.
 */
export async function connectInstallation(token: string): Promise<Caller | null> {
  // Final fix wave (C2): `shared` is the group's: true when any installation linked with this one
  // came from a hosted agent client, not only the token's own (as sharedGroup, which launchLimit reads).
  const [row] = await sql()<{ id: number; own: number; shared: boolean }[]>`
    WITH t AS (
      UPDATE installations SET last_seen_at = now()
      WHERE token_hash = ${hash(token)} RETURNING COALESCE(builder_id, id) AS id, id AS own, shared_client)
    SELECT t.id, t.own, (t.shared_client OR EXISTS (
      SELECT 1 FROM installations s WHERE (s.id = t.id OR s.builder_id = t.id) AND s.shared_client)) AS shared
    FROM t`;
  return row ?? null;
}

/** The installation id the tools act as for this token (connectInstallation's `id`), or null if unknown. */
export async function touchInstallation(token: string) {
  return (await connectInstallation(token))?.id ?? null;
}

/**
 * v2.8.1 §E17: whether any installation in this one's group came from a hosted agent client (the
 * per-agent launch floor is then tokenLaunchShared).
 */
export async function sharedGroup(installationId: number) {
  const [row] = await sql()<{ shared: boolean | null }[]>`
    SELECT bool_or(shared_client) AS shared FROM installations
    WHERE id = ${installationId} OR builder_id = ${installationId}`;
  return row?.shared ?? false;
}

/**
 * This installation's last wallet (lowercase), or null. v2.6 Ruling 10 (plan): written by every
 * entry that names a valid wallet and whenever the token flow keeps a creator wallet.
 */
export async function rememberedWallet(installationId: number) {
  const [row] = await sql()<{ payout_wallet: string | null }[]>`
    SELECT payout_wallet FROM installations WHERE id = ${installationId}`;
  return row?.payout_wallet ?? null;
}

/** The v2.4 name of rememberedWallet. */
export const rememberedPayoutWallet = rememberedWallet;

/** Remembers `wallet` as this installation's last wallet (Ruling 10); an invalid one is ignored. */
export async function rememberWallet(installationId: number, wallet: string) {
  if (!isWalletAddress(wallet)) return;
  const w = wallet.toLowerCase();
  await sql()`UPDATE installations SET payout_wallet = ${w} WHERE id = ${installationId}`;
  await rememberWallets(installationId, [w]);
}

/**
 * v2.9 A5 (Pre-flight P4): the contracts the agent reported in local_repos for this repo (by its
 * normalized GitHub link), lowercase, at most 2; [] when none or unreadable.
 */
export async function localRepoContracts(installationId: number, repoUrl: string | null | undefined): Promise<string[]> {
  if (!repoUrl) return [];
  const key = normalizeRepoUrl(repoUrl);
  const [row] = await sql()<{ local_repos: ReportedRepo[] | null }[]>`
    SELECT local_repos FROM installations WHERE id = ${installationId}`;
  const found = (row?.local_repos ?? [])
    .filter((r) => r.url && normalizeRepoUrl(r.url) === key)
    .flatMap((r) => r.contracts ?? []);
  return [...new Set(found.map((c) => c.toLowerCase()))].slice(0, 2);
}
