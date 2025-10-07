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
