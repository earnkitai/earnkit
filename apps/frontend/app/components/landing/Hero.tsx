import InstallButton from '../common/InstallButton';
import { AGENT_MARKS, AgentMark } from '../site/AgentMarks';
import HeroArt from './HeroArt';
import { CTA_INSTALL, HERO_SUB, HERO_TITLE } from '../../../lib/v5/site-copy';
import Money from '../site/Money';

/**
 * The readability shade, only behind the words (owner "option 1", 2026-10-22): a soft ellipse centred on the chip,
 * title, sub line and CTA, and a low band under the agent marks; the arches and their sky stay clear. On a phone the
 * words fill more of a 560px hero, so the ellipse is wider and a little higher.
 */
const SHADE =
  'bg-[radial-gradient(ellipse_86%_44%_at_50%_63%,var(--ek-s-hero-halo)_0%,var(--ek-s-hero-halo-mid)_55%,var(--ek-s-hero-shade-clear)_100%),linear-gradient(180deg,var(--ek-s-hero-shade-clear)_82%,var(--ek-s-hero-band)_100%)] md:bg-[radial-gradient(ellipse_44%_36%_at_50%_68%,var(--ek-s-hero-halo)_0%,var(--ek-s-hero-halo-mid)_55%,var(--ek-s-hero-shade-clear)_100%),linear-gradient(180deg,var(--ek-s-hero-shade-clear)_84%,var(--ek-s-hero-band)_100%)]';

/** The white CTA: a soft warm glow at rest; on hover a 1px lift (not under reduced motion) and a white ring. */
const CTA =
  'mt-1.5 inline-flex h-[52px] items-center rounded-full bg-s-light px-8 text-[16px] font-bold text-s-ink shadow-[0_18px_60px_var(--ek-s-cta-glow)] motion-safe:transition-[box-shadow,transform] motion-safe:duration-[240ms] motion-safe:ease-out hover:shadow-[0_0_0_6px_var(--ek-s-foot-button),0_18px_70px_var(--ek-s-cta-glow-hover)] motion-safe:hover:-translate-y-px md:h-14';

/**
 * The landing hero: the painting with its arch light, the money chip ("$5K in grants and prizes open now", to #earn;
 * none when nothing is open), the title, the sub line, the install link (to /docs#install, upgraded to the sheet) and
 * the agent marks.
 */
export default function Hero({ chip }: { chip: string | null }) {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate flex h-[560px] flex-col items-center justify-end overflow-hidden rounded-[32px] bg-s-hero-base px-6 pb-[88px] text-center md:h-[776px] md:rounded-[48px] md:pb-[104px]"
    >
      <HeroArt />
      <div aria-hidden="true" className={`absolute inset-0 -z-[1] ${SHADE}`} />

      <div className="relative z-[1] flex flex-col items-center gap-[22px]">
        {chip ? (
          <a
            href="#earn"
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[22px] border border-s-chip-line bg-s-hero-chip-phone px-4 py-2 text-[14px] leading-snug text-s-chip-text backdrop-blur-md hover:bg-s-chip-line motion-safe:transition-colors motion-safe:duration-200 md:min-h-9 md:rounded-full md:py-1.5 md:bg-s-chip"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-s-rust-light shadow-[0_0_10px_var(--ek-s-rust-light)]" />
            {/* One flex item: the chip's gap must not split the sign from its digits. */}
            <span className="text-balance">
              <Money text={chip} />
            </span>
          </a>
        ) : null}
        {/* L27-6 (v6.1.16): a plain h1 in the DOM, named by the section, never hidden from reader mode. */}
        <h1 id="hero-title" className="ek-serif whitespace-nowrap text-[clamp(28px,9.6vw,96px)] leading-none tracking-[-0.015em] text-s-text [text-shadow:0_6px_50px_var(--ek-s-hero-title-shadow)]">
          {HERO_TITLE}
        </h1>
        <p className="text-balance text-[17px] leading-normal text-s-hero-sub md:text-[19px]">{HERO_SUB}</p>
        <InstallButton label={CTA_INSTALL} className={CTA} />
      </div>

      <div className="absolute inset-x-0 bottom-9 z-[1] flex items-center justify-center gap-10">
        {AGENT_MARKS.map((m) => (
          <AgentMark key={m.name} mark={m} size={22} />
        ))}
      </div>
    </section>
  );
}
