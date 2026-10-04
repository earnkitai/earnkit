import { Attribution } from 'ox/erc8021';

/**
 * EarnKit's Base Builder Code (ERC-8021), registered once by the owner at base.dev (v2.4 §7). The
 * campaign starter appends it to every transaction; the review shows the share of a top entry's
 * transactions carrying it (supporting evidence only: scoring never depends on it). Confirm the
 * exact string with the owner before launch; EARNKIT_BUILDER_CODE overrides it.
 */
export const EARNKIT_BUILDER_CODE = process.env.EARNKIT_BUILDER_CODE?.trim() || 'earnkit';

/** The ERC-8021 codes at the end of a transaction's input, or [] (none, or unreadable). Pure; exported for tests. */
export function codesIn(input: string | null | undefined): string[] {
  if (!input || !/^0x[0-9a-fA-F]*$/.test(input) || input.length < 2 + 2 * 18) return [];
  try {
    const a = Attribution.fromData(input as `0x${string}`) as
      | { codes?: readonly string[]; appCode?: string }
      | undefined;
    return a?.codes ? [...a.codes] : a?.appCode ? [a.appCode] : [];
  } catch {
    return [];
  }
}
