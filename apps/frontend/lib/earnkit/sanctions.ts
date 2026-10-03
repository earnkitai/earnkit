import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

/**
 * Sanctions screening (v2.2 §5, audit M6) with Chainalysis's free onchain oracle. It exists on Base
 * mainnet only; on any other chain the screen is skipped with a logged note. Screened: payout
 * wallets at entry, the sponsor wallet at create, every winner of an award plan (sponsor's or the
 * operator's fallback). The oracle is injectable (`setSanctionsOracle`) so tests never call it.
 */

export const SANCTIONS_ORACLE = '0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B';
export const BASE_MAINNET = 8453;

/** Plain and non-accusatory: EarnKit doesn't say why. */
export const CANT_RECEIVE = "This wallet can't receive prizes on EarnKit.";
export const CANT_FUND = "This wallet can't fund campaigns on EarnKit.";
export const SCREEN_UNAVAILABLE =
  "EarnKit couldn't screen the wallet right now; try again in a minute.";

export class SanctionsError extends Error {}

/** Whether `wallet` is on the oracle's list. Throws when the oracle can't be read. */
export type SanctionsOracle = (wallet: string) => Promise<boolean>;

const oracleAbi = [
  {
    type: 'function',
    name: 'isSanctioned',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

let rpcChain: Promise<number> | null = null;
const client = () =>
  createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

/** Reads the Chainalysis oracle over BASE_RPC_URL (Base mainnet), or null when that RPC isn't Base mainnet. */
async function chainalysis(wallet: string): Promise<boolean | null> {
  const c = client();
  rpcChain ??= c.getChainId().catch((err) => {
    rpcChain = null;
    throw err;
  });
  if ((await rpcChain) !== BASE_MAINNET) return null;
  return c.readContract({
    address: SANCTIONS_ORACLE,
    abi: oracleAbi,
    functionName: 'isSanctioned',
    args: [wallet as `0x${string}`],
  });
}

let injected: SanctionsOracle | null = null;
/** Tests: replace the oracle (null restores Chainalysis). */
export const setSanctionsOracle = (o: SanctionsOracle | null) => {
  injected = o;
};

const noted = new Set<string>();
function skipNote(why: string) {
  if (noted.has(why)) return;
  noted.add(why);
  console.warn(`[sanctions] screening skipped: ${why}`);
}

/**
 * The wallets in `wallets` the oracle lists (lowercase), for a payment on `chainId`. Skipped (none)
 * with a logged note off Base mainnet. Throws SanctionsError
 * (SCREEN_UNAVAILABLE) when the oracle can't be read: screening fails closed.
 */
export async function sanctionedWallets(
  wallets: string[],
  chainId: number,
): Promise<string[]> {
  if (chainId !== BASE_MAINNET) {
    skipNote(
      `chain ${chainId} has no Chainalysis oracle (Base mainnet ${BASE_MAINNET} only)`,
    );
    return [];
  }
  const unique = [...new Set(wallets.map((w) => w.toLowerCase()))];
  try {
    const hits: string[] = [];
    for (const w of unique) {
      const listed = injected ? await injected(w) : await chainalysis(w);
      if (listed === null) {
        skipNote('BASE_RPC_URL is not Base mainnet');
        return [];
      }
      if (listed) hits.push(w);
    }
    return hits;
  } catch (err) {
    console.error('[sanctions] oracle read failed:', err);
    throw new SanctionsError(SCREEN_UNAVAILABLE);
  }
}

/** Throws SanctionsError(`message`) when `wallet` is listed. */
export async function screenWallet(
  wallet: string,
  chainId: number,
  message: string = CANT_RECEIVE,
) {
  if ((await sanctionedWallets([wallet], chainId)).length > 0)
    throw new SanctionsError(message);
}

/**
 * Every winner of an award plan (the sponsor's or the operator's fallback): throws SanctionsError
 * naming the first entry whose payout wallet is listed.
 */
export async function screenWinners(
  plan: { entry_id: number; wallet: string }[],
  chainId: number,
) {
  const hits = new Set(
    await sanctionedWallets(
      plan.map((p) => p.wallet),
      chainId,
    ),
  );
  const hit = plan.find((p) => hits.has(p.wallet.toLowerCase()));
  if (hit)
    throw new SanctionsError(
      `winners: entry ${hit.entry_id}'s payout wallet can't receive prizes on EarnKit. Pick another entry.`,
    );
}
