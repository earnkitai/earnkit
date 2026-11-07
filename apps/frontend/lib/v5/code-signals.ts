/**
 * Signals read from source text that more than one reader shares: token contracts that are never
 * a builder's own, and Builder Codes (ERC-8021). Pure.
 */

/** Well-known token contracts (USDC, EURC, WETH, USDT) that config names but that are never the builder's own. */
export const KNOWN_TOKEN_ADDRESSES: ReadonlySet<string> = new Set(
  [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    '0x3600000000000000000000000000000000000000',
    '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
    '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD',
    '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    '0x4200000000000000000000000000000000000006',
    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  ].map((a) => a.toLowerCase()),
);

const SUFFIX_LITERAL = /0x[0-9a-f]*80218021802180218021802180218021\b/i;
/** True when source text carries Builder Codes (ERC-8021): the ox import, toDataSuffix, a dataSuffix key or the suffix literal. Pure. */
export function builderCodesIn(text: string): boolean {
  return text.includes('ox/erc8021') || text.includes('Attribution.toDataSuffix') || /\bdataSuffix\s*:/.test(text) || SUFFIX_LITERAL.test(text);
}
