import { BaseError, UserRejectedRequestError } from 'viem';

/**
 * Turns a wallet/viem error into a short, readable message for the fund/award pages. `viem`'s
 * `BaseError.message` is a multi-line block ("Request Arguments:", "Docs:", "Version:", …);
 * `shortMessage` is the one-line summary meant for people. A rejection in the wallet (the user
 * clicked "Reject", or any cause in the chain carries RPC error code 4001) gets a plain, specific
 * message instead of viem's generic one.
 */
export function walletErrorMessage(err: unknown): string {
  if (err instanceof BaseError) {
    const rejected = err.walk(
      (e) =>
        e instanceof UserRejectedRequestError ||
        (e as { code?: unknown }).code === 4001,
    );
    if (rejected) return 'You cancelled in your wallet.';
    return err.shortMessage;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
