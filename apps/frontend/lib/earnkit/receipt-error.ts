import { TransactionReceiptNotFoundError } from 'viem';

/**
 * Viem throws `TransactionReceiptNotFoundError` when a hash hasn't been confirmed yet (or is
 * wrong). The `sponsor_campaign` tool and the `/api/sponsor/[ref]/confirm` route both need the
 * same readable message for that case, so it lives here instead of being duplicated.
 *
 * Returns the message when `err` is that error, otherwise `null` (so callers can fall through to
 * their normal error handling for anything else).
 */
export function receiptNotFoundMessage(err: unknown): string | null {
  return err instanceof TransactionReceiptNotFoundError
    ? "That transaction isn't confirmed yet (or the hash is wrong). Try again in a minute."
    : null;
}
