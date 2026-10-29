import { sql } from './db';
import type { Mailer } from './digest';
import { cachedWethUsd, wethToUsd } from './fees';
import { ownerMail, ownerMailEnabled } from './owner-mail';
import { SAFE_ADDRESS } from './policy';

/**
 * v4.0 Task 12: one email to the owner when EarnKit's Safe on Base holds SAFE_ALERT_USD or more (its WETH and ETH,
 * priced with cachedWethUsd), so the owner swaps to USDC and sends it to their bank. Once per crossing: owner_alerts
 * 'safe_5k' is 'sent' until a run sees it below again ('below' re-arms it). A cron step (cron.ts safe_watch).
 */
export const SAFE_ALERT_USD = 5000;
export const SAFE_SWAP_URL = `https://app.safe.global/swap?safe=base:${SAFE_ADDRESS}`;
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const KIND = 'safe_5k';

export type SafeWatchDeps = {
  /** The Safe's WETH and ETH (wei). Default: Base over BASE_RPC_URL (bonus-ledger.ts bonusRpc). */
  balances?: () => Promise<{ weth: bigint; eth: bigint }>;
  /** USD per WETH, or null when unknown. Default fees.ts cachedWethUsd. */
  price?: () => Promise<number | null>;
  mail?: Mailer;
  log?: (...a: unknown[]) => void;
};

const defaultBalances = async () => {
  const { bonusRpc } = await import('./bonus-ledger');
  const rpc = bonusRpc();
  const [weth, eth] = await Promise.all([rpc.balanceOf(BASE_WETH, SAFE_ADDRESS), rpc.ethBalance(SAFE_ADDRESS)]);
  return { weth, eth };
};

const eth2 = (wei: bigint) => (Number(wei) / 1e18).toFixed(2);
const dollars = (usd: number) => `$${Math.floor(usd).toLocaleString('en-US')}`;

/** The email. Pure. */
export function safeMail(usd: number, weth: bigint, eth: bigint) {
  return {
    subject: `Your Safe holds ${dollars(usd)}`,
    text: [
      `EarnKit's Safe on Base holds ${dollars(usd)} (${eth2(weth)} WETH and ${eth2(eth)} ETH).`,
      '',
      `Swap to USDC in your Safe: ${SAFE_SWAP_URL}`,
      '',
      'Then send the USDC to your Coinbase account.',
    ].join('\n'),
  };
}

/**
 * 'sent' (mailed now), 'below' (under SAFE_ALERT_USD; re-armed), 'already' (mailed for this crossing) or 'skipped'
 * (no price, a failed read, no RESEND_API_KEY or a failed send: nothing changes, the next run tries again). Never throws
 * for a read or a send.
 */
export async function safeWatch(now: Date, deps: SafeWatchDeps = {}): Promise<'sent' | 'below' | 'already' | 'skipped'> {
  const log = deps.log ?? console.error;
  let weth: bigint, eth: bigint;
  try {
    ({ weth, eth } = await (deps.balances ?? defaultBalances)());
  } catch (err) {
    log('[safe-watch] balance read', err instanceof Error ? err.name : 'error');
    return 'skipped';
  }
  let price: number | null;
  try {
    price = await (deps.price ?? (() => cachedWethUsd()))();
  } catch (err) {
    log('[safe-watch] price read', err instanceof Error ? err.name : 'error');
    return 'skipped';
  }
  if (price === null || !Number.isFinite(price) || price <= 0) {
    log('[safe-watch] no WETH price; skipped');
    return 'skipped';
  }
  const usd = wethToUsd(weth + eth, price);
  if (usd < SAFE_ALERT_USD) {
    await sql()`INSERT INTO owner_alerts (kind, state, at) VALUES (${KIND}, 'below', ${now})
      ON CONFLICT (kind) DO UPDATE SET state = 'below', at = EXCLUDED.at WHERE owner_alerts.state IS DISTINCT FROM 'below'`;
    return 'below';
  }
  if (!ownerMailEnabled()) {
    log('[safe-watch] RESEND_API_KEY unset; the Safe email waits');
    return 'skipped';
  }
  // Claim the crossing first (a concurrent run gets 'already'); a failed send gives it back.
  const [prev] = await sql()<{ state: string | null }[]>`SELECT state FROM owner_alerts WHERE kind = ${KIND}`;
  const [claimed] = await sql()<{ kind: string }[]>`
    INSERT INTO owner_alerts (kind, state, at) VALUES (${KIND}, 'sent', ${now})
    ON CONFLICT (kind) DO UPDATE SET state = 'sent', at = EXCLUDED.at WHERE owner_alerts.state IS DISTINCT FROM 'sent'
    RETURNING kind`;
  if (!claimed) return 'already';
  const m = safeMail(usd, weth, eth);
  try {
    await ownerMail(m.subject, m.text, `${KIND}:${now.toISOString().slice(0, 10)}`, deps.mail);
  } catch (err) {
    log('[safe-watch] send', err instanceof Error ? err.name : 'error');
    if (prev) await sql()`UPDATE owner_alerts SET state = ${prev.state} WHERE kind = ${KIND} AND state = 'sent'`;
    else await sql()`DELETE FROM owner_alerts WHERE kind = ${KIND} AND state = 'sent'`;
    return 'skipped';
  }
  return 'sent';
}
