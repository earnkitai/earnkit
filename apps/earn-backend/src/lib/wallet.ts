/**
 * Wallet-address normalization helpers.
 *
 * An Ethereum address is a 20-byte (40 hex char) value. The mixed-casing you
 * see in user input ("EIP-55 checksum encoding") is purely a self-check
 * derived from keccak256(lowercase); the underlying bytes are identical.
 *
 * Throughout the backend we store + index addresses in lowercase form so
 * lookups are case-insensitive in practice without needing citext/ILIKE.
 * Use these helpers at every trust boundary (route handlers, service
 * methods that accept untrusted input, workers consuming external data)
 * to keep that invariant intact.
 *
 * Database-level CHECK constraints (see migration
 * `20260520000000_wallet_address_lowercase_check`) enforce this from the
 * other side — any write that bypasses these helpers will fail with a
 * Postgres 23514 check_violation, surfacing the bug loudly rather than
 * silently corrupting credit balances.
 */

import { AppError } from '../middleware/errorHandler';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export class InvalidWalletAddressError extends Error {
  constructor(value: unknown) {
    super(
      `Invalid wallet address: ${
        typeof value === 'string' ? JSON.stringify(value) : String(value)
      }`,
    );
    this.name = 'InvalidWalletAddressError';
  }
}

/**
 * Validate + lowercase an address. Throws InvalidWalletAddressError if the
 * input is not a 0x-prefixed 40-char hex string. Use this at every place
 * external input enters the system.
 */
export function normalizeWallet(address: unknown): string {
  if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
    throw new InvalidWalletAddressError(address);
  }
  return address.toLowerCase();
}

/**
 * Same as normalizeWallet but treats null/undefined/empty as "no address"
 * (returns undefined). Use for optional fields like
 * PaymentIntent.customerWalletAddress where the column itself is nullable.
 */
export function normalizeWalletOptional(
  address: unknown,
): string | undefined {
  if (address === null || address === undefined || address === '') {
    return undefined;
  }
  return normalizeWallet(address);
}

/**
 * Predicate-style check. Does NOT throw. Useful in conditional branches
 * (e.g. "is this string an address?" without committing to a value).
 */
export function isValidWalletAddress(address: unknown): address is string {
  return typeof address === 'string' && ADDRESS_RE.test(address);
}

/**
 * Route-handler convenience: validates+normalizes, throwing AppError(400)
 * (which the error-handler middleware turns into a structured JSON response)
 * instead of a bare InvalidWalletAddressError. Use this in Express handlers
 * so the failure mode matches the rest of the request-validation code path.
 *
 * `fieldName` shows up in the client-facing error message — pass the body /
 * query field name so the caller knows which field is wrong.
 */
export function requireWalletAddress(
  address: unknown,
  fieldName: string,
): string {
  if (!isValidWalletAddress(address)) {
    throw new AppError(
      `${fieldName} must be a 0x-prefixed 40-char hex address`,
      400,
    );
  }
  return address.toLowerCase();
}

export function optionalWalletAddress(
  address: unknown,
  fieldName: string,
): string | undefined {
  if (address === null || address === undefined || address === '') {
    return undefined;
  }
  return requireWalletAddress(address, fieldName);
}
