import { sql } from './db';
import { cachedWethUsd, wethToUsd } from './fees';

const WEEK_MS = 7 * 86_400_000;

/**
 * v4.0 Task 7 (approved copy 5): what the builder's community sent them in the week from `weekStart` and in the week
 * before: the creator fees claimed to their token's wallet (fee_claims role 'creator', owner the builder_tokens wallet,
 * matched case-insensitively), never past `now`, priced with the cached WETH price. No token or no wallet: 0. No price:
 * 0, logged (never a wrong number). `price`: tests replace the price read. Throws on a database error.
 */
export async function weekCommunityUsd(
  builderId: number, weekStart: Date, now: Date, price: () => Promise<number | null> = () => cachedWethUsd(),
): Promise<{ usd: number; lastWeekUsd: number }> {
  const start = weekStart.getTime();
  const end = new Date(Math.min(start + WEEK_MS, now.getTime()));
  const [r] = await sql()<{ week: string | null; before: string | null }[]>`
    SELECT
      (SELECT sum(c.weth)::text FROM fee_claims c WHERE c.role = 'creator' AND lower(c.owner) = lower(t.wallet)
        AND c.at >= ${new Date(start)} AND c.at < ${end}) AS week,
      (SELECT sum(c.weth)::text FROM fee_claims c WHERE c.role = 'creator' AND lower(c.owner) = lower(t.wallet)
        AND c.at >= ${new Date(start - WEEK_MS)} AND c.at < ${new Date(Math.min(start, now.getTime()))}) AS before
    FROM builder_tokens t WHERE t.builder_id = ${builderId} AND t.wallet IS NOT NULL`;
  const week = BigInt(r?.week?.split('.')[0] ?? '0');
  const before = BigInt(r?.before?.split('.')[0] ?? '0');
  if (week === 0n && before === 0n) return { usd: 0, lastWeekUsd: 0 };
  const usd = await price();
  if (usd === null || !Number.isFinite(usd) || usd <= 0) {
    console.error('[community] no WETH price');
    return { usd: 0, lastWeekUsd: 0 };
  }
  return { usd: wethToUsd(week, usd), lastWeekUsd: wethToUsd(before, usd) };
}

/**
 * v4.0 Task 9: every creator fee ever claimed to the builder's token wallet (the same rows as weekCommunityUsd, all
 * time), priced with the cached WETH price: the Token card's "earned by <first>". No token, no wallet or no price: 0
 * (no price is logged; never a wrong number). Throws on a database error.
 */
export async function allTimeCommunityUsd(builderId: number, price: () => Promise<number | null> = () => cachedWethUsd()): Promise<number> {
  const [r] = await sql()<{ weth: string | null }[]>`
    SELECT (SELECT sum(c.weth)::text FROM fee_claims c WHERE c.role = 'creator' AND lower(c.owner) = lower(t.wallet)) AS weth
    FROM builder_tokens t WHERE t.builder_id = ${builderId} AND t.wallet IS NOT NULL`;
  const weth = BigInt(r?.weth?.split('.')[0] ?? '0');
  if (weth === 0n) return 0;
  const usd = await price();
  if (usd === null || !Number.isFinite(usd) || usd <= 0) {
    console.error('[community] no WETH price');
    return 0;
  }
  return wethToUsd(weth, usd);
}
