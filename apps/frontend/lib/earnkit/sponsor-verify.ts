import { sql } from './db';
import { SafeFetchError, safeFetchText } from './safe-fetch';
import {
  UNVERIFIED,
  earnkitTxtNames,
  earnkitTxtUrl,
  sponsorHost,
  trackRecordOf,
  type SponsorIdentity,
} from './sponsor-identity';

/**
 * Sponsor domain verification (v2.2 §3): EarnKit fetches https://<host>/.well-known/earnkit.txt
 * (SSRF-safe, safe-fetch.ts) and looks for `earnkit-sponsor: <sponsor_wallet>`. Results are cached
 * per (host, wallet) in `sponsor_verifications`: a pass for 24 h, a failure for 1 h (so a slow or
 * hostile host can't make every page load wait on it). Runs at create and lazily wherever a
 * label is shown.
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

/**
 * A sponsor campaign's identity: verified on its sponsor_url's host for its bound wallet, else
 * unverified (no link, no wallet, or the check failed). Never throws: a failure is unverified.
 */
export async function sponsorIdentity(
  row: { sponsor_url: string | null; sponsor_wallet: string | null },
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

/** The track record of a sponsor wallet (see trackRecordOf). */
export async function trackRecord(wallet: string | null) {
  if (!wallet) return trackRecordOf([]);
  const rows = await sql()<{ state: string; n: number }[]>`
    SELECT state, count(*)::int AS n FROM sponsor_campaigns
    WHERE sponsor_wallet = ${wallet.toLowerCase()} GROUP BY state`;
  return trackRecordOf(rows);
}

/** The sponsor row behind a published program (null for curated programs). */
export async function sponsorOfProgram(programId: string) {
  const [row] = await sql()<
    { sponsor_url: string | null; sponsor_wallet: string | null }[]
  >`SELECT sponsor_url, sponsor_wallet FROM sponsor_campaigns WHERE program_id = ${programId}`;
  return row ?? null;
}
