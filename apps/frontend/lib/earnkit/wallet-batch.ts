/**
 * Whether a wallet's EIP-5792 capabilities for one chain (viem's getCapabilities with a chainId)
 * allow an atomic batch: `atomic.status` "supported", or "ready" (the wallet can upgrade the
 * account, e.g. EIP-7702, when the batch is sent). Anything else, including no answer, means the
 * page sends the transactions one by one. Pure; used by the fund page.
 */
export function atomicBatching(capabilities: unknown): boolean {
  if (typeof capabilities !== 'object' || capabilities === null) return false;
  const atomic = (capabilities as { atomic?: unknown }).atomic;
  if (typeof atomic !== 'object' || atomic === null) return false;
  const status = (atomic as { status?: unknown }).status;
  return status === 'supported' || status === 'ready';
}
