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

/**
 * v3.1 Task 7: Base Builder Grants' first step is Builder Codes (ERC-8021,
 * docs.base.org/base-chain/builder-codes/builder-codes). The ERC-8021 marker every data suffix ends with.
 */
export const BUILDER_CODES_SUFFIX = '80218021802180218021802180218021';
const SUFFIX_LITERAL = new RegExp(`0x[0-9a-f]*${BUILDER_CODES_SUFFIX}\\b`, 'i');
/**
 * True when source text carries Builder Codes: the ox/erc8021 import, Attribution.toDataSuffix, a `dataSuffix:` in a
 * viem or wagmi call, or a hex literal ending in the ERC-8021 marker. Pure.
 */
export function builderCodesIn(text: string): boolean {
  return text.includes('ox/erc8021') || text.includes('Attribution.toDataSuffix') || /\bdataSuffix\s*:/.test(text) || SUFFIX_LITERAL.test(text);
}
/** The program whose Best fit line carries the Builder Codes sentence. */
export const BASE_GRANTS_ID = 'base-builder-grants';
export const builderCodesFound = (repo: string) => `Builder Codes found in ${repo}.`;
export const BUILDER_CODES_FIRST = 'First step for Base: add Builder Codes. Guide: docs.base.org/base-chain/builder-codes/builder-codes';
