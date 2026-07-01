import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { randomBytes } from 'crypto';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const truncateAddress = (
  address: string,
  { prefix = 8, suffix = 4 }: { prefix?: number; suffix?: number } = {},
) => {
  return `${address.slice(0, prefix)}•••${address.slice(-suffix)}`;
};

export const getRpId = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (error) {
    console.error('Invalid URL:', error);
    return null;
  }
};

export function formatDate(dateString: string): string {
  const date = new Date(dateString);

  // Get day with ordinal suffix (1st, 2nd, 3rd, etc.)
  const day = date.getDate();
  const suffix = getDaySuffix(day);

  // Format the date
  return date
    .toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .replace(/\d+/, day + suffix);
}

function getDaySuffix(day: number): string {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * Generates a secure API key with the format: ek_[32 random hex characters]
 * @returns A secure API key string
 */
export function generateApiKey(): string {
  const randomHex = randomBytes(16).toString('hex');
  return `ek_${randomHex}`;
}

/**
 * Extracts the user ID from a Privy user ID by removing the did:privy: prefix
 * @param privyUserId - The full Privy user ID (e.g., "did:privy:cmfqj7sc6007aii0crjvqnqcc")
 * @returns The user ID without the prefix (e.g., "cmfqj7sc6007aii0crjvqnqcc")
 */
export function extractUserId(privyUserId: string): string {
  return privyUserId.split(':').pop() || privyUserId;
}

/**
 * Formats a raw on-chain token amount (base units) into a human-readable
 * decimal string. Shared across the dashboard so the same raw amount renders
 * identically everywhere. Fractional part is shown to up to 6 significant
 * decimal places with trailing zeros trimmed.
 * @param raw - The raw token amount in base units (as a string)
 * @param decimals - The token's decimals
 * @returns A formatted decimal string, or the original input if parsing fails
 */
export function formatRawTokenAmount(raw: string, decimals: number): string {
  try {
    const v = BigInt(raw);
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = v / divisor;
    const frac = v % divisor;
    const fracStr = frac
      .toString()
      .padStart(decimals, '0')
      .slice(0, 6)
      .replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return raw;
  }
}
