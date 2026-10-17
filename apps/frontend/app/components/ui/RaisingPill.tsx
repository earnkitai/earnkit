/** v2.13 spec R8, owner ruling B (v2.13.3): "Community round $RECIPE", linking to the coin's tokens.fun page. Factual: the coin's name only. */
export default function RaisingPill({ symbol, url, size = 'md' }: { symbol: string; url: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-sm';
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-pill="raising"
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-ek-score-orange/60 bg-ek-navy-deep font-funnel-sans font-medium text-ek-score-orange ${box}`}
    >
      Community round ${symbol}
    </a>
  );
}
