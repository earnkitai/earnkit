/**
 * EIP-5792 helpers for the fund page's one-signature path. Pure; used by app/components/wallet.ts.
 */

/**
 * Whether a wallet's EIP-5792 capabilities (viem's getCapabilities without a chainId: a map from
 * chain id to capabilities, where 0 means every chain) allow an atomic batch on `chainId`. Only
 * `atomic.status` "supported" counts. "ready" means the wallet would upgrade the sponsor's account
 * (an EIP-7702 delegation) as part of the send, which the page doesn't disclose, so it gets the
 * sequential path like any other answer, including none.
 */
export function atomicBatching(
  capabilities: unknown,
  chainId: number,
): boolean {
  if (typeof capabilities !== 'object' || capabilities === null) return false;
  const byChain = capabilities as Record<number, unknown>;
  const status = (caps: unknown) => {
    if (typeof caps !== 'object' || caps === null) return undefined;
    const atomic = (caps as { atomic?: unknown }).atomic;
    if (typeof atomic !== 'object' || atomic === null) return undefined;
    return (atomic as { status?: unknown }).status;
  };
  // The chain's own answer wins over the all-chains (0) one.
  return (status(byChain[chainId]) ?? status(byChain[0])) === 'supported';
}

/** EIP-5792 errors meaning "this batch can't be sent atomically"; nothing was submitted. */
const BATCH_UNSUPPORTED = new Set([5700, 5710, 5720, 5760]);

/** Whether `err` (anywhere in its cause chain) says the wallet can't send this atomic batch. */
export function batchUnsupported(err: unknown): boolean {
  let cur: unknown = err;
  while (typeof cur === 'object' && cur !== null) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'number' && BATCH_UNSUPPORTED.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * What a finished batch's EIP-5792 status code means for the sponsor, or null when it succeeded
 * (or is unknown: EarnKit reads the outcome from the chain anyway). 4xx: the wallet never
 * included it; 5xx/6xx: it reverted (an atomic batch reverts whole).
 */
export function batchStatusProblem(
  statusCode: number | undefined,
): string | null {
  if (statusCode === undefined) return null;
  if (statusCode >= 400 && statusCode < 500)
    return "Your wallet didn't send it. Try again.";
  if (statusCode >= 500 && statusCode < 700)
    return 'It reverted onchain, so nothing was deposited. Try again.';
  return null;
}
