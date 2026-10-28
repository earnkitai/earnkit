import { sql } from './db';
import { STUCK_LAUNCH_MS, outcomeOf, retryAtOf, xProfileUrl } from './tokens';
import { cleanTokenName, tickerCandidates, tickerProblem, tokensFunTickerCheck, type TickerCheck } from './token-proposal';
import { provenWallet } from './wallet-proof';
import { siteUrl } from './entry-text';

/**
 * v4 (2026-10-28): one token per builder, keyed by their X account. Default opt-in: it launches the moment the
 * builder's first reward wallet is proven (setup step 3), unless they said no; a no is kept forever. tokens.fun
 * mints it on Base (Safe 60 / builder 40, WETH). Only while EARNKIT_BUILDER_TOKENS is 'on'.
 *
 * Never a second token: the row is the claim (one per builder and per X account, both unique). It is deleted again
 * only when tokens.fun said it stopped before minting (outcomeOf release); any unclear answer leaves it 'unknown' for
 * the owner to settle (runCron lists it in needs_owner, as it does a launch stuck 'launching'), and nothing retries it.
 */
export type BuilderTokenStatus = 'declined' | 'launching' | 'launched' | 'unknown';
export type BuilderToken = {
  status: BuilderTokenStatus;
  symbol: string | null;
  coin_address: string | null;
  wallet: string | null;
};

/** v4.0 Task 9: where to trade a builder's token (Uniswap on Base). Pure. */
export const tradeUrl = (coin: string) => `https://app.uniswap.org/swap?chain=base&outputCurrency=${coin.toLowerCase()}`;

export const builderTokensOn = () => process.env.EARNKIT_BUILDER_TOKENS === 'on';

/** The builder's token row, or null (never offered or released). */
export async function builderToken(builderId: number): Promise<BuilderToken | null> {
  const [t] = await sql()<BuilderToken[]>`
    SELECT status, symbol, coin_address, wallet FROM builder_tokens WHERE builder_id = ${builderId}`;
  return t ?? null;
}

/**
 * The builder said no: kept forever. A token already launching or launched is unchanged (its status is returned).
 * 'x_taken': the X account is held by another builder's row, so nothing was written for this builder.
 */
export async function declineBuilderToken(builderId: number): Promise<BuilderTokenStatus | 'no_x' | 'x_taken'> {
  const [p] = await sql()<{ x_user_id: string | null }[]>`SELECT x_user_id FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_user_id) return 'no_x';
  const [row] = await sql()<{ status: BuilderTokenStatus }[]>`
    INSERT INTO builder_tokens (builder_id, x_user_id, status) VALUES (${builderId}, ${p.x_user_id}, 'declined')
    ON CONFLICT DO NOTHING RETURNING status`;
  if (row) return row.status;
  return (await builderToken(builderId))?.status ?? 'x_taken';
}

/**
 * The ticker from the X handle (3 to 10 letters or digits), the first free and allowed one.
 * 'ticker_check_down': tokens.fun can't be asked now (try again later); 'no_ticker': none is free or allowed (lasting).
 */
export type TickerPick = { symbol: string } | { result: 'ticker_check_down' | 'no_ticker' };
export async function builderTicker(handle: string, check: TickerCheck = tokensFunTickerCheck): Promise<TickerPick> {
  for (const c of tickerCandidates(handle.replace(/_/g, ' '))) {
    if (tickerProblem(c)) continue;
    const free = await check(c);
    if (free === null) return { result: 'ticker_check_down' };
    if (free) return { symbol: c };
  }
  return { result: 'no_ticker' };
}

/**
 * v4 fix round 1: the builder ids whose token waits on the owner, oldest first: 'unknown' (tokens.fun's answer was
 * unclear; never retried), or 'launching' for over STUCK_LAUNCH_MS (the process stopped mid-launch, and the row
 * blocks any later launch). runCron lists each as a needs_owner line, like a stuck project launch.
 */
export async function stuckBuilderTokens(now: Date): Promise<number[]> {
  const rows = await sql()<{ builder_id: number }[]>`
    SELECT builder_id FROM builder_tokens
    WHERE status = 'unknown' OR (status = 'launching' AND updated_at < ${new Date(now.getTime() - STUCK_LAUNCH_MS)})
    ORDER BY updated_at, builder_id`;
  return rows.map((r) => r.builder_id);
}

export type LaunchResult =
  | { result: 'off' | 'not_ready' | 'no_ticker' | 'ticker_check_down' | 'busy' | 'x_taken' }
  | { result: 'exists'; status: BuilderTokenStatus }
  | { result: 'launched'; symbol: string; coin_address: string }
  | { result: 'released'; note: string }
  | { result: 'unknown' };

/**
 * Launch the builder's token now: needs EARNKIT_BUILDER_TOKENS on, a claimed X account, and a proven reward wallet.
 * Idempotent: an existing row (declined, launching, launched, unknown) is returned untouched. 'x_taken': the X account
 * is held by another builder's row (nothing written for this builder).
 */
export async function launchBuilderToken(
  builderId: number,
  deps: { fetch?: typeof fetch; check?: TickerCheck; now?: Date } = {},
): Promise<LaunchResult> {
  if (!builderTokensOn()) return { result: 'off' };
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const [p] = await sql()<{ x_user_id: string | null; x_handle: string | null; x_name: string | null; x_avatar_url: string | null }[]>`
    SELECT x_user_id, x_handle, x_name, x_avatar_url FROM builder_profiles WHERE builder_id = ${builderId}`;
  const wallet = await provenWallet(builderId);
  if (!key || !p?.x_user_id || !p.x_handle || !wallet) return { result: 'not_ready' };
  const existing = await builderToken(builderId);
  if (existing) return { result: 'exists', status: existing.status };

  const pick = await builderTicker(p.x_handle, deps.check);
  if (!('symbol' in pick)) return pick;
  const { symbol } = pick;
  const cleaned = cleanTokenName(p.x_name?.trim() || p.x_handle);
  const name = 'name' in cleaned ? cleaned.name : p.x_handle;

  // The claim: one row per builder and per X account. Losing either race means a token is already on its way.
  const [claimed] = await sql()<{ builder_id: number }[]>`
    INSERT INTO builder_tokens (builder_id, x_user_id, status, name, symbol, wallet)
    VALUES (${builderId}, ${p.x_user_id}, 'launching', ${name}, ${symbol}, ${wallet})
    ON CONFLICT DO NOTHING RETURNING builder_id`;
  if (!claimed) {
    const mine = await builderToken(builderId);
    return mine ? { result: 'exists', status: mine.status } : { result: 'x_taken' };
  }

  const page = `${siteUrl()}/${p.x_handle}`;
  const image = p.x_avatar_url && /^https:\/\//.test(p.x_avatar_url) ? p.x_avatar_url : `${siteUrl()}/logo.png`;
  let res: Response | null = null;
  let data: Parameters<typeof outcomeOf>[1] = null;
  try {
    res = await (deps.fetch ?? fetch)(`${(process.env.TOKENSFUN_API_URL ?? 'https://tokens.fun').replace(/\/$/, '')}/api/v1/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        name,
        symbol,
        creatorWallet: wallet,
        tokenURI: image,
        imageUrl: image,
        description: `${name} builds in public on EarnKit: ${page}`,
        website: page,
        twitter: xProfileUrl(p.x_handle),
        chainId: 8453,
        source: 'earnkit',
        tokenSource: 'external',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    data = await res.json().catch(() => null);
  } catch (err) {
    console.error('[builder token] deploy', err instanceof Error ? err.name : 'error');
    res = null;
  }
  const out = outcomeOf(res, data, 'base', res ? retryAtOf(data, res.headers.get('retry-after'), deps.now ?? new Date()) : null);
  if (out.status === 'launched' && out.token_address) {
    await sql()`UPDATE builder_tokens SET status = 'launched', coin_address = ${out.token_address.toLowerCase()},
      tx_hash = ${out.tx_hash ?? null}, updated_at = now() WHERE builder_id = ${builderId}`;
    return { result: 'launched', symbol, coin_address: out.token_address.toLowerCase() };
  }
  if (out.release) {
    // tokens.fun stopped before minting: the claim goes, so the next wallet proof or "launch my token" tries again.
    await sql()`DELETE FROM builder_tokens WHERE builder_id = ${builderId} AND status = 'launching'`;
    return out.busy ? { result: 'busy' } : { result: 'released', note: out.note ?? '' };
  }
  await sql()`UPDATE builder_tokens SET status = 'unknown', updated_at = now() WHERE builder_id = ${builderId}`;
  console.error('[builder token] launch outcome unknown for builder', builderId, '- never retried; owner settles it');
  return { result: 'unknown' };
}
