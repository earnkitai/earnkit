import { formatUnits } from 'viem';

/**
 * Formats token units for display, exactly — no float rounding. `Number(u) / 10 ** decimals`
 * followed by `toLocaleString()` rounds to 3 fraction digits by default, which can show a
 * different amount than the one actually signed onchain. `viem`'s `formatUnits` is exact; this
 * only adds thousands separators to the integer part, leaving the fraction untouched.
 */
export function formatExact(units: bigint, decimals: number): string {
  const [int, frac] = formatUnits(units, decimals).split('.');
  const grouped = BigInt(int).toLocaleString('en-US');
  return frac ? `${grouped}.${frac}` : grouped;
}
