/** v2.13 spec R8, v3 Stage 2 (spec 5.3 Route 2): "Backing · $RECIPE", linking to the coin's tokens.fun page. Factual: the coin's name only. */
export default function RaisingPill({ symbol, url, size = 'md' }: { symbol: string; url: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-sm';
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-pill="backing"
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-ek-line-strong bg-ek-surface font-funnel-sans font-medium text-ek-accent ${box}`}
    >
      Backing · ${symbol}
    </a>
  );
}
