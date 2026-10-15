import { CHAIN_LABEL, type BenchChain } from '../../../lib/earnkit/rank';

/** v2.13 R14: a chain as its logo, the name as alt text and tooltip. The owner's brand files replace the SVGs at the same paths. */
export default function ChainLogo({ chain, size = 20 }: { chain: BenchChain; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- a local SVG
  return <img src={`/images/chains/${chain}.svg`} alt={CHAIN_LABEL[chain]} title={CHAIN_LABEL[chain]} width={size} height={size} className="inline-block shrink-0 rounded-[6px]" />;
}
