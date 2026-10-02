import { BaseError, UserRejectedRequestError } from 'viem';

/**
 * Walks `err`'s `cause` chain (not just `BaseError`'s own chain, so this also sees through a
 * plain `Error` wrapper) looking for a user rejection:
 * either viem's `UserRejectedRequestError`, or any cause carrying RPC error code 4001.
 */
function isRejection(err: unknown): boolean {
  let cur: unknown = err;
  while (cur) {
    if (cur instanceof UserRejectedRequestError) return true;
    if (
      typeof cur === 'object' &&
      'code' in cur &&
      (cur as { code?: unknown }).code === 4001
    )
      return true;
    cur =
      typeof cur === 'object' && cur !== null && 'cause' in cur
        ? (cur as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

/**
 * Turns a wallet/viem error into a short, readable message for the fund/award pages. `viem`'s
 * `BaseError.message` is a multi-line block ("Request Arguments:", "Docs:", "Version:", …);
 * `shortMessage` is the one-line summary meant for people. A rejection in the wallet (the user
 * clicked "Reject", anywhere in the cause chain) gets a plain, specific message instead of
 * viem's generic one or a wrapping error's own message.
 */
export function walletErrorMessage(err: unknown): string {
  if (isRejection(err)) return 'You cancelled in your wallet.';
  if (err instanceof BaseError) return err.shortMessage;
  if (err instanceof Error) return err.message;
  return String(err);
}
