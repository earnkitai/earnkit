import { createPublicClient, erc20Abi, formatUnits, http, type Hex } from 'viem';
import { base } from 'viem/chains';
import { payoutAccount, type PayoutTerms } from './payout';

/** A successful balance read is reused this long (public page views share it). */
export const FUNDS_TTL_MS = 60_000;
/** A failed read is remembered this long, so a down RPC isn't hit on every view. */
export const FUNDS_FAIL_TTL_MS = 15_000;

export type Funds = { wallet: string; balance: string; symbol: string } | null;
type BalanceRead = (token: Hex, wallet: Hex) => Promise<bigint>;

/** Its own client, short and without retries: the payout cron and the sanctions screen share BASE_RPC_URL. */
const rpcBalance: BalanceRead = (token, wallet) =>
  createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL, { timeout: 3_000, retryCount: 0 }) })
    .readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] });

/** token:wallet (lowercase) -> the read in flight or done, and when it expires (undefined while in flight). */
const memo = new Map<string, { value: Promise<Funds>; until?: number }>();

/** Tests: forget every cached read. */
export const clearFundsMemo = () => memo.clear();

/**
 * Proof of funds (v2.4 §3): the payout wallet and its prize balance under `c`'s token, or null
 * when no payout key is set (or it is malformed) or the read fails. Memoized per token and wallet
 * (60 s, a failure 15 s) with one read in flight shared by concurrent views; `fresh` (the owner's
 * review page) reads now, and its failure never replaces a cached read that is still valid.
 */
export async function prizeFunds(
  c: Pick<PayoutTerms, 'prize'>,
  opts: { fresh?: boolean; read?: BalanceRead; now?: () => number } = {},
): Promise<Funds> {
  let account: ReturnType<typeof payoutAccount>;
  try {
    account = payoutAccount();
  } catch (err) {
    // A malformed key must not break the public campaign page (M3); the cron reports it.
    console.error('[funds]', err instanceof Error ? err.message : err);
    return null;
  }
  if (!account) return null;
  const now = opts.now ?? Date.now;
  const key = `${c.prize.token}:${account.address}`.toLowerCase();
  const hit = memo.get(key);
  if (!opts.fresh && hit && (hit.until === undefined || hit.until > now())) return hit.value;
  const entry: { value: Promise<Funds>; until?: number } = { value: Promise.resolve(null) };
  entry.value = (opts.read ?? rpcBalance)(c.prize.token as Hex, account.address)
    .then((balance) => {
      entry.until = now() + FUNDS_TTL_MS;
      return { wallet: account.address, balance: formatUnits(balance, c.prize.decimals), symbol: c.prize.symbol };
    })
    .catch((err) => {
      console.error('[funds]', err instanceof Error ? err.message.split('\n')[0] : err);
      entry.until = now() + FUNDS_FAIL_TTL_MS;
      return null;
    });
  // M2: an owner's fresh read replaces the memo only when it succeeds, or when what is cached has
  // expired; a failure leaves a still-valid cached read for the public page.
  if (opts.fresh && hit && (hit.until === undefined || hit.until > now())) {
    const value = await entry.value;
    if (value) memo.set(key, entry);
    return value;
  }
  memo.set(key, entry);
  return entry.value;
}
