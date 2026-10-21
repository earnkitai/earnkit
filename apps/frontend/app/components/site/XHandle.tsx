/** Text tones: s-card-handle on neutral cards, s-muted on panels and the page, s-on-blue-soft on blue, s-rust-sub on rust. */
const TONES = {
  card: 'text-s-card-handle',
  muted: 'text-s-muted',
  blue: 'text-s-on-blue-soft',
  rust: 'text-s-rust-sub',
} as const;

/** The X glyph (11px) and @handle, linking to the builder's X profile. Long handles truncate, never widen the row. */
export default function XHandle({ handle, tone = 'card', className = '' }: { handle: string; tone?: keyof typeof TONES; className?: string }) {
  const h = handle.replace(/^@/, '');
  return (
    <a
      href={`https://x.com/${encodeURIComponent(h)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-w-0 max-w-full items-center gap-[5px] text-[13px] transition-colors hover:text-s-text ${TONES[tone]} ${className}`.trim()}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
        <path
          fill="currentColor"
          d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
        />
      </svg>
      <span className="truncate">@{h}</span>
    </a>
  );
}
