/**
 * After `sendAll` (app/components/wallet.ts) fails partway through a sequence of transactions,
 * decides whether it's safe to offer a fresh send or whether the only safe option is to retry
 * confirming a hash that already is — or might be — onchain.
 *
 * Only the LAST transaction in a sequence moves money or creates state (`createCampaign`,
 * `award`); earlier steps (e.g. an ERC-20 `approve`) are idempotent, so resending the whole
 * sequence is always safe when the last step was never submitted.
 *
 * - The last step's hash was submitted and its outcome isn't a *confirmed* revert (unknown, or
 *   it actually succeeded) → the only safe option is to retry confirming that hash.
 * - The last step was never submitted (an earlier step failed, or the last step's own send never
 *   produced a hash), or the last step is a confirmed revert → a fresh send is safe.
 */
export type RetryDecision =
  | { action: 'confirm'; hash: `0x${string}` }
  | { action: 'fresh' };

export function decideRetry(
  sent: readonly `0x${string}`[],
  totalSteps: number,
  lastReverted: boolean,
): RetryDecision {
  const finalHash = sent.length === totalSteps ? sent[sent.length - 1] : null;
  if (finalHash && !lastReverted) return { action: 'confirm', hash: finalHash };
  return { action: 'fresh' };
}
