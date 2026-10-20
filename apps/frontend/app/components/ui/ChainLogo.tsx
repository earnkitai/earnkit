import { CHAIN_LABEL, type BenchChain } from '../../../lib/earnkit/rank';

/**
 * v2.13 R14, v3 Stage 3 Task 7: a chain as its mark, the name as alt text and tooltip. Every mark is a circle (Base's
 * solid blue disc; Arc and Robinhood as monograms until the owner supplies their files at the same paths), so the
 * image is clipped round at every size.
 */
export default function ChainLogo({ chain, size = 20 }: { chain: BenchChain; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- a local SVG
  return <img src={`/images/chains/${chain}.svg`} alt={CHAIN_LABEL[chain]} title={CHAIN_LABEL[chain]} width={size} height={size} className="inline-block shrink-0 rounded-full" />;
}
