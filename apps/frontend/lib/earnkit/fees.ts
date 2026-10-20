import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { sql, type Db } from './db';
import { llamaPrice } from './prices';

/** Clanker's FeeLocker on Base: creator fees wait here until claimed (v2.4 §4). */
export const FEE_LOCKER = '0xf3622742b1e446d92e45e22923ef11c2fcd55d68';
export const WETH_BASE = '0x4200000000000000000000000000000000000006';
/** Fee alerts only from this much (spec: "above $100", to keep reads and noise down). */
export const FEE_ALERT_USD = 100;
export const FEE_TTL_MS = 6 * 3_600_000;

const feeLockerAbi = [
  {
    type: 'function',
    name: 'availableFees',
    stateMutability: 'view',
    inputs: [
      { name: 'feeOwner', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/** Where fee balances come from; replaced in tests and the e2e. */
export type FeeSource = {
  /** WETH (wei) waiting for `wallet` in the FeeLocker: fees already there, nothing else. */
  availableWeth: (wallet: string) => Promise<bigint>;
  wethUsd: () => Promise<number>;
};

const makeClient = () => createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
let client: ReturnType<typeof makeClient> | undefined;
/** One public client per process. */
const baseClient = () => (client ??= makeClient());

const chain: FeeSource = {
  availableWeth: (wallet) =>
    baseClient().readContract({
      address: FEE_LOCKER,
      abi: feeLockerAbi,
      functionName: 'availableFees',
      args: [wallet as `0x${string}`, WETH_BASE],
    }),
  wethUsd: async () => (await llamaPrice(`base:${WETH_BASE}`)).price,
};
let source: FeeSource = chain;
/** Tests and the e2e: replace the source (null restores the chain). */
export const setFeeSource = (s: FeeSource | null) => {
  source = s ?? chain;
  priceMemo = null;
  priceFailedAt = null;
};

/** v3 Stage 2 (earned.ts, stats.ts): the WETH price, read at most once per FEE_TTL_MS per process. */
let priceMemo: { usd: number; at: number } | null = null;
let priceFailedAt: number | null = null;
let priceRead: Promise<number | null> | null = null;
/** How long a reply waits on a fresh WETH price before it uses the last known one. */
export const PRICE_WAIT_MS = 1_500;

/**
 * v3 Stage 2: the WETH price in USD (the fee source's, as refreshFees reads it), cached FEE_TTL_MS per process. A
 * missing or stale price is read, waited on at most `waitMs`; past that, or after a failed read (not retried for
 * FEE_RETRY_MS), the price the token_fees cache implies (its newest row with WETH), else the last one read, else null.
 */
export async function cachedWethUsd(now = Date.now(), waitMs = PRICE_WAIT_MS, db: Db = sql()): Promise<number | null> {
  if (priceMemo && now - priceMemo.at < FEE_TTL_MS) return priceMemo.usd;
  if (priceFailedAt === null || now - priceFailedAt >= FEE_RETRY_MS) {
    priceRead ??= source
      .wethUsd()
      .then((usd) => {
        priceMemo = { usd, at: Date.now() };
        priceFailedAt = null;
        return usd;
      })
      .catch((err: unknown) => {
        console.error('[fees] weth price', err instanceof Error ? err.name : 'error');
        priceFailedAt = Date.now();
        return null;
      })
      .finally(() => {
        priceRead = null;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fresh = await Promise.race([priceRead, new Promise<null>((r) => (timer = setTimeout(() => r(null), waitMs)))]);
    clearTimeout(timer);
    if (fresh !== null) return fresh;
  }
  const [r] = await db<{ usd: number | null }[]>`
    SELECT (usd / (weth::numeric / 1e18))::float8 AS usd FROM token_fees WHERE CASE WHEN weth ~ '^[0-9]+$' THEN weth::numeric > 0 ELSE false END AND usd > 0 ORDER BY read_at DESC LIMIT 1`;
  return r?.usd ?? priceMemo?.usd ?? null;
}

/** WETH wei at a USD price. Pure; exported for tests. */
export const wethToUsd = (wei: bigint, price: number) => (Number(wei) / 1e18) * price;

/**
 * Whether to show fees now (v2.4 §4): from FEE_ALERT_USD, once per crossing, and again each time
 * they grow by another FEE_ALERT_USD; below it (claimed) the memory resets. Pure; exported for tests.
 */
export function feeAlert(usdNow: number, lastShown: number | null) {
  if (usdNow < FEE_ALERT_USD) return { show: false, next: null };
  if (lastShown === null || usdNow >= lastShown + FEE_ALERT_USD) return { show: true, next: usdNow };
  return { show: false, next: lastShown };
}

/** Reads and caches the fees waiting for these creator wallets; returns how many were read. */
export async function refreshFees(wallets: string[]) {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (list.length === 0) return 0;
  const price = await source.wethUsd();
  for (const w of list) {
    const weth = await source.availableWeth(w);
    await sql()`
      INSERT INTO token_fees (wallet, weth, usd, read_at)
      VALUES (${w}, ${weth.toString()}, ${wethToUsd(weth, price)}, now())
      ON CONFLICT (wallet) DO UPDATE SET weth = EXCLUDED.weth, usd = EXCLUDED.usd, read_at = EXCLUDED.read_at`;
  }
  return list.length;
}

const inflight = new Set<string>();
/** Wallets whose last background read failed, and when: not retried for FEE_RETRY_MS. */
const failedAt = new Map<string, number>();
export const FEE_RETRY_MS = 3_600_000;

/**
 * The cached fees (USD) waiting for these wallets, summed; null when none was ever read. Never
 * waits on a read: missing or stale (over 6 h) wallets are refreshed in the background, at most 4
 * at a time (on the pool, after this returns), so the next reply has them; a failed read is not retried for an hour (per process).
 */
export async function cachedFeesUsd(wallets: string[], now = Date.now(), db: Db = sql()) {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (list.length === 0) return null;
  const rows = await db<{ wallet: string; usd: string; read_at: Date }[]>`
    SELECT wallet, usd, read_at FROM token_fees WHERE wallet IN ${db(list)}`;
  const stale = list.filter((w) => {
    const r = rows.find((x) => x.wallet === w);
    const failed = failedAt.get(w);
    if (failed !== undefined && now - failed < FEE_RETRY_MS) return false;
    return !r || now - r.read_at.getTime() > FEE_TTL_MS;
  });
  const todo = stale.filter((w) => !inflight.has(w)).slice(0, Math.max(0, 4 - inflight.size));
  if (todo.length > 0) {
    todo.forEach((w) => inflight.add(w));
    void refreshFees(todo)
      .then(() => todo.forEach((w) => failedAt.delete(w)))
      .catch((err) => {
        console.error('[fees]', err);
        todo.forEach((w) => failedAt.set(w, Date.now()));
      })
      .finally(() => todo.forEach((w) => inflight.delete(w)));
  }
  return rows.length ? rows.reduce((sum, r) => sum + Number(r.usd), 0) : null;
}

/** Creator wallets of every token EarnKit launched (the cron refreshes them daily). */
export async function launchedCreatorWallets() {
  const rows = await sql()<{ wallet: string }[]>`
    SELECT DISTINCT lower(COALESCE(creator_wallet, payout_wallet)) AS wallet FROM projects
    WHERE token_url LIKE 'https://tokens.fun/coin/%' AND COALESCE(creator_wallet, payout_wallet) IS NOT NULL`;
  return rows.map((r) => r.wallet);
}

/**
 * v3 Stage 2 (earned.ts, stats.ts): a coin's creator wallet as SQL (the FeeLocker's fee owner for the creator slot):
 * the slot's recipient as read onchain (bonus-ledger.ts feeRecipients), else the wallet the launch used (creator_wallet,
 * else payout_wallet, as launchedCreatorWallets). `p` is a projects row.
 */
export const creatorWalletSql = (db: Db) => db`lower(COALESCE(p.fee_recipients->>'creator', p.creator_wallet, p.payout_wallet))`;
