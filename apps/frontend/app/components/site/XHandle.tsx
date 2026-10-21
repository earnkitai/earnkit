/** Text tones: s-card-handle on neutral cards, s-muted on panels and the page, s-on-blue-soft on blue, s-on-navy-soft on navy, s-rust-sub on rust. */
const TONES = {
  card: 'text-s-card-handle',
  muted: 'text-s-muted',
  blue: 'text-s-on-blue-soft',
  navy: 'text-s-on-navy-soft',
  rust: 'text-s-rust-sub',
} as const;

export type XHandleTone = keyof typeof TONES;

/**
 * The X glyph (11px) and @handle, linking to the builder's X profile. Long handles truncate, never widen the row.
 * `link={false}`: the same glyph and handle as text, for inside another link (a leaderboard row links to the profile).
 */
export default function XHandle({ handle, tone = 'card', link = true, className = '' }: { handle: string; tone?: XHandleTone; link?: boolean; className?: string }) {
  const h = handle.replace(/^@/, '');
  const glyph = (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="currentColor"
        d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
      />
    </svg>
  );
  if (!link)
    return (
      <span className={`inline-flex min-w-0 max-w-full items-center gap-[5px] text-[13px] ${TONES[tone]} ${className}`.trim()}>
        {glyph}
        <span className="truncate">@{h}</span>
      </span>
    );
  return (
    <a
      href={`https://x.com/${encodeURIComponent(h)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-w-0 max-w-full items-center gap-[5px] text-[13px] hover:text-s-text motion-safe:transition-colors ${TONES[tone]} ${className}`.trim()}
    >
      {glyph}
      <span className="truncate">@{h}</span>
    </a>
  );
}
