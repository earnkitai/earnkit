import { archiveFlag } from './builder-score-flag';
import { sql } from './db';
import { SafeFetchError, safeFetchText } from './safe-fetch';
import {
  UNVERIFIED,
  earnkitTxtNames,
  earnkitTxtUrl,
  sponsorHost,
  trackRecordOf,
  type SponsorIdentity,
  type TrackRow,
} from './sponsor-identity';

/**
 * Sponsor domain verification (v2.2 §3): EarnKit fetches https://<host>/.well-known/earnkit.txt
 * (SSRF-safe, safe-fetch.ts) and looks for `earnkit-sponsor: <sponsor_wallet>`. Results are cached
 * per (host, wallet) in `sponsor_verifications`: a pass for 24 h, a failure for 1 h (so a slow or
 * hostile host can't make every page load wait on it). It fetches at create, on the sponsor's
 * status, on page loads and in `pnpm campaign sync`; list_programs and get_program read the cache
 * only and queue a fire-and-forget refresh of missing or stale entries. Only funded campaigns
 * show an identity to builders (`sponsorIdentity`).
 */

export const VERIFIED_TTL_MS = 24 * 3_600_000;
export const NOT_VERIFIED_TTL_MS = 3_600_000;

export type Verification = { verified: boolean; note: string | null };

/** Whether a cached result is still good at `now`. Pure; exported for tests. */
export const verificationIsFresh = (
  c: { verified: boolean; checked_at: Date },
  now: Date,
  /** Recheck a failure older than this (the sponsor's own agent after fixing the file). */
  retryFailureAfterMs = NOT_VERIFIED_TTL_MS,
) => {
  const age = now.getTime() - c.checked_at.getTime();
  return age >= 0 && age < (c.verified ? VERIFIED_TTL_MS : retryFailureAfterMs);
};

/** Why a fetched earnkit.txt doesn't verify the wallet. */
const notListed = (host: string, wallet: string) =>
  `${earnkitTxtUrl(host)} doesn't contain "earnkit-sponsor: ${wallet}".`;

// One fetch per (host, wallet) at a time in this process.
const inFlight = new Map<string, Promise<Verification>>();

/** Fetches and checks earnkit.txt now. `fetchText` is injectable for tests. */
export async function checkEarnkitTxt(
  host: string,
  wallet: string,
  fetchText: (url: string) => Promise<string> = safeFetchText,
): Promise<Verification> {
  try {
    const body = await fetchText(earnkitTxtUrl(host));
    return earnkitTxtNames(body, wallet)
      ? { verified: true, note: null }
      : { verified: false, note: notListed(host, wallet) };
  } catch (err) {
    if (!(err instanceof SafeFetchError))
      console.error('[sponsor-verify] unexpected error:', err);
    const why = err instanceof SafeFetchError ? err.message : 'fetch failed';
    return {
      verified: false,
      note: `EarnKit couldn't read ${earnkitTxtUrl(host)}: ${why}.`,
    };
  }
}

/** The (cached) verification of `wallet` on `host`. */
export async function verifySponsor(
  host: string,
  wallet: string,
  { retryFailureAfterMs }: { retryFailureAfterMs?: number } = {},
): Promise<Verification> {
  const w = wallet.toLowerCase();
  const [cached] = await sql()<
    { verified: boolean; checked_at: Date; note: string | null }[]
  >`SELECT verified, checked_at, note FROM sponsor_verifications WHERE host = ${host} AND wallet = ${w}`;
  if (cached && verificationIsFresh(cached, new Date(), retryFailureAfterMs))
    return { verified: cached.verified, note: cached.note };
  const key = `${host} ${w}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const v = await checkEarnkitTxt(host, w);
      // v2.12 spec 9: sponsor_verifications is archived; no writes while the flag is off (verdict uncached).
      if (archiveFlag('SPONSOR_CAMPAIGNS'))
        await sql()`
          INSERT INTO sponsor_verifications (host, wallet, verified, checked_at, note)
          VALUES (${host}, ${w}, ${v.verified}, now(), ${v.note})
          ON CONFLICT (host, wallet) DO UPDATE
            SET verified = EXCLUDED.verified, checked_at = EXCLUDED.checked_at, note = EXCLUDED.note`;
      return v;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** States in which the bound wallet has signed the deposit itself, so its identity can be shown. */
export const FUNDED_STATES = ['live', 'awarded', 'refunded', 'taken_down'];
export const isFunded = (state: string) => FUNDED_STATES.includes(state);

type IdentityRow = {
  sponsor_url: string | null;
  sponsor_wallet: string | null;
};

/**
 * Checks (cached, fetching when stale) whether `row`'s domain names its wallet, whatever the
 * state: for create and the sponsor's own status, where the result is a preview for the sponsor.
 * Never throws: a failure is unverified.
 */
export async function domainCheck(
  row: IdentityRow,
  opts?: { retryFailureAfterMs?: number },
): Promise<SponsorIdentity & { note: string | null }> {
  const host = sponsorHost(row.sponsor_url);
  if (!host || !row.sponsor_wallet) return { ...UNVERIFIED, note: null };
  try {
    const v = await verifySponsor(host, row.sponsor_wallet, opts);
    return { verified: v.verified, host, note: v.note };
  } catch (err) {
    console.error('[sponsor-verify] verification failed:', err);
    return { verified: false, host, note: null };
  }
}

/**
 * A sponsor campaign's identity as builders see it (pages, `pnpm campaign sync`): only a funded
 * campaign has one, because only funding proves the bound wallet is the sponsor's (a draft can
 * bind anyone's wallet, e.g. a brand's published one). Re-verified when the cache is stale.
 */
export async function sponsorIdentity(
  row: IdentityRow & { state: string },
): Promise<SponsorIdentity & { note: string | null }> {
  if (!isFunded(row.state)) return { ...UNVERIFIED, note: null };
  return domainCheck(row);
}

/**
 * Identities from the cache only, never fetching (list_programs, get_program): verified when a
 * fresh pass is cached for a funded campaign's (host, wallet). One query for all rows.
 */
export async function cachedIdentities(
  rows: (IdentityRow & { state: string | null })[],
): Promise<SponsorIdentity[]> {
  const keys = rows.map((r) =>
    r.state && isFunded(r.state) && r.sponsor_wallet
      ? {
          host: sponsorHost(r.sponsor_url),
          wallet: r.sponsor_wallet.toLowerCase(),
        }
      : { host: null, wallet: '' },
  );
  const hosts = [...new Set(keys.flatMap((k) => (k.host ? [k.host] : [])))];
  if (hosts.length === 0) return rows.map(() => UNVERIFIED);
  const cached = await sql()<
    { host: string; wallet: string; verified: boolean; checked_at: Date }[]
  >`SELECT host, wallet, verified, checked_at FROM sponsor_verifications
    WHERE host IN ${sql()(hosts)} AND wallet IN ${sql()(keys.map((k) => k.wallet))}`;
  const now = new Date();
  // Missing or stale entries are re-checked in the background; this request never waits on it.
  for (const k of staleKeys(keys, cached, now))
    refreshInBackground(k.host, k.wallet);
  return keys.map(({ host, wallet }) => {
    const c = cached.find((x) => x.host === host && x.wallet === wallet);
    return c?.verified && verificationIsFresh(c, now)
      ? { verified: true, host }
      : { verified: false, host };
  });
}

/**
 * The funded (host, wallet) pairs whose cache entry is missing or stale (a pass after 24 h, a
 * failure after 1 h), each once. Pure; exported for tests.
 */
export function staleKeys(
  keys: { host: string | null; wallet: string }[],
  cached: {
    host: string;
    wallet: string;
    verified: boolean;
    checked_at: Date;
  }[],
  now: Date,
) {
  const seen = new Set<string>();
  return keys.flatMap(({ host, wallet }) => {
    if (!host || !wallet || seen.has(`${host} ${wallet}`)) return [];
    seen.add(`${host} ${wallet}`);
    const c = cached.find((x) => x.host === host && x.wallet === wallet);
    return c && verificationIsFresh(c, now) ? [] : [{ host, wallet }];
  });
}

/** At most this many background refreshes run at once in this process. */
const BACKGROUND_LIMIT = 4;
let backgroundRunning = 0;

/**
 * Fire-and-forget re-verification of (host, wallet), deduped per pair by verifySponsor's in-flight
 * map. Never awaited by the request; skipped while BACKGROUND_LIMIT refreshes are running (a later
 * request retries). The counter goes up synchronously, before any await, so one listing can't
 * start more than the cap. Errors are logged, never thrown.
 */
function refreshInBackground(host: string, wallet: string) {
  if (
    inFlight.has(`${host} ${wallet}`) ||
    backgroundRunning >= BACKGROUND_LIMIT
  )
    return;
  backgroundRunning++;
  void verifySponsor(host, wallet)
    .catch((err) =>
      console.error('[sponsor-verify] background refresh failed:', err),
    )
    .finally(() => backgroundRunning--);
}

/** The track record of a sponsor wallet (see trackRecordOf). */
export async function trackRecord(wallet: string | null) {
  if (!wallet) return trackRecordOf([], null);
  const rows = await sql()<TrackRow[]>`
    SELECT state, amount, token_symbol, award_source, fallback_plan,
      COALESCE(award_winners, ARRAY(
        SELECT lower(p.payout_wallet) FROM projects p
        WHERE p.program_id = sc.program_id AND p.prize_tx IS NOT NULL)) AS winners
    FROM sponsor_campaigns sc
    WHERE sponsor_wallet = ${wallet.toLowerCase()}
      AND state IN ('live', 'awarded', 'refunded', 'taken_down')`;
  return trackRecordOf(rows, wallet);
}

/** The sponsor row behind a published program (null for curated programs). */
export async function sponsorOfProgram(programId: string) {
  const [row] = await sql()<
    (IdentityRow & { state: string })[]
  >`SELECT sponsor_url, sponsor_wallet, state FROM sponsor_campaigns WHERE program_id = ${programId}`;
  return row ?? null;
}
