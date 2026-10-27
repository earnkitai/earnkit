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

/**
 * v3.1 Used by (2026-10-27): the only Builder Code strings EarnKit ever reads, stores or puts into the CDP SQL query
 * (used-by.ts): lowercase letters, digits and underscores, 1 to 64 long. Anything else is dropped, never escaped.
 */
export const BUILDER_CODE = /^[a-z0-9_]{1,64}$/;
const SUFFIX_LITERALS = new RegExp(`0x[0-9a-f]*${BUILDER_CODES_SUFFIX}\\b`, 'gi');
const CODES_ARRAY = /\bcodes\s*:\s*\[([^\]]{0,2000})\]/g;
const QUOTED = /(['"`])([^'"`\n]{1,200})\1/g;
/**
 * v3.1 Used by: the Builder Code strings written in source text, in first-seen order without repeats: each hex
 * data-suffix literal decoded (codesIn), and each string in a `codes: ['...']` or `codes: ["..."]` array
 * (Attribution.toDataSuffix's input). Only BUILDER_CODE strings are kept; a code read from an env var or built at
 * runtime is invisible here (documented limit: that builder gets no Builder Code number). Pure.
 */
export function codesFromText(text: string): string[] {
  const out: string[] = [];
  const add = (c: string) => {
    if (BUILDER_CODE.test(c) && !out.includes(c)) out.push(c);
  };
  for (const m of text.matchAll(SUFFIX_LITERALS)) codesIn(m[0].toLowerCase()).forEach(add);
  for (const m of text.matchAll(CODES_ARRAY)) for (const q of m[1].matchAll(QUOTED)) add(q[2]);
  return out;
}
/** The program whose Best fit line carries the Builder Codes sentence. */
export const BASE_GRANTS_ID = 'base-builder-grants';
export const builderCodesFound = (repo: string) => `Builder Codes found in ${repo}.`;
/** v3.1 cold read round 2: the approved Builder Code wording; the guide as a plain path (the draft's form link is its one link). */
export const BUILDER_CODES_FIRST = "Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic (guide: docs.base.org/base-chain/builder-codes/builder-codes).";
