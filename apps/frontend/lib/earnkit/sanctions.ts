import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

/**
 * Sanctions screening (v2.2 §5, audit M6) with Chainalysis's free onchain oracle. It exists on Base
 * mainnet only; a payment on any other chain skips the screen with a logged note. Screened: payout
 * wallets at entry, the sponsor wallet at create, every winner of an award plan (sponsor's or the
 * operator's fallback, at propose and execute) and of EarnKit's own campaign payout.
 *
 * For a Base mainnet payment the RPC (BASE_RPC_URL) must itself be chain 8453. In production a
 * mismatched or failing RPC refuses (fails closed: "Can't check this wallet right now"); outside
 * production it is logged and skipped (the local e2e has no Base RPC). Clean results are cached for
 * 10 minutes per wallet; listed ones never are. The oracle is injectable (`setSanctionsOracle`) so
 * tests never call it.
 */

export const SANCTIONS_ORACLE = '0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B';
export const BASE_MAINNET = 8453;
export const CLEAN_TTL_MS = 10 * 60_000;

/** Plain and non-accusatory: EarnKit doesn't say why. */
export const CANT_RECEIVE = "This wallet can't receive prizes on EarnKit.";
export const CANT_FUND = "This wallet can't fund campaigns on EarnKit.";
export const SCREEN_UNAVAILABLE =
  "Can't check this wallet right now; try again shortly.";

export class SanctionsError extends Error {}

/** The RPC's chain id, and whether `wallet` is on the list. Both throw when unreadable. */
export type SanctionsOracle = {
  chainId: () => Promise<number>;
  isSanctioned: (wallet: string) => Promise<boolean>;
};

const oracleAbi = [
  {
    type: 'function',
    name: 'isSanctioned',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const client = () =>
  createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

/** Chainalysis over BASE_RPC_URL. */
const chainalysis: SanctionsOracle = {
  chainId: () => client().getChainId(),
  isSanctioned: (wallet) =>
    client().readContract({
      address: SANCTIONS_ORACLE,
      abi: oracleAbi,
      functionName: 'isSanctioned',
      args: [wallet as `0x${string}`],
    }),
};

let oracle: SanctionsOracle = chainalysis;
/** Wallet (lowercase) -> when its clean result expires. */
const clean = new Map<string, number>();
/** Tests: replace the oracle (null restores Chainalysis); clears the clean cache. */
export const setSanctionsOracle = (o: SanctionsOracle | null) => {
  oracle = o ?? chainalysis;
  clean.clear();
};

const noted = new Set<string>();
function skipNote(why: string) {
  if (noted.has(why)) return;
  noted.add(why);
  console.info(`[sanctions] screening skipped: ${why}`);
}

/** Production refuses; elsewhere the screen is skipped with a logged note. */
function unavailable(why: string, err?: unknown): string[] {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[sanctions] ${why}`, err ?? '');
    throw new SanctionsError(SCREEN_UNAVAILABLE);
  }
  skipNote(err ? `${why} (${String(err).slice(0, 120)})` : why);
  return [];
}

/**
 * The wallets in `wallets` the oracle lists (lowercase), for a payment on `chainId`. Skipped (none)
 * with a logged note off Base mainnet. On Base mainnet, an RPC that isn't chain 8453 or can't be
 * read throws SanctionsError (SCREEN_UNAVAILABLE) in production, and is skipped elsewhere.
 */
export async function sanctionedWallets(
  wallets: string[],
  chainId: number,
  now = Date.now(),
): Promise<string[]> {
  if (chainId !== BASE_MAINNET) {
    skipNote(
      `chain ${chainId} has no Chainalysis oracle (Base mainnet ${BASE_MAINNET} only)`,
    );
    return [];
  }
  const todo = [...new Set(wallets.map((w) => w.toLowerCase()))].filter(
    (w) => !((clean.get(w) ?? 0) > now),
  );
  if (todo.length === 0) return [];
  let rpcChain: number;
  try {
    rpcChain = await oracle.chainId();
  } catch (err) {
    return unavailable('the Base RPC could not be read', err);
  }
  if (rpcChain !== BASE_MAINNET)
    return unavailable(
      `BASE_RPC_URL is chain ${rpcChain}, not Base mainnet ${BASE_MAINNET}`,
    );
  const hits: string[] = [];
  for (const w of todo) {
    let listed: boolean;
    try {
      listed = await oracle.isSanctioned(w);
    } catch (err) {
      return unavailable('the sanctions oracle could not be read', err);
    }
    if (listed) hits.push(w);
    else clean.set(w, now + CLEAN_TTL_MS);
  }
  return hits;
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
 * Every winner of an award plan or payout: throws SanctionsError naming the first entry whose
 * payout wallet is listed.
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
