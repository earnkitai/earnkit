import InstallButton from '../common/InstallButton';
import { AGENT_MARKS, AgentMark } from '../site/AgentMarks';
import HeroArt from './HeroArt';
import { CTA_INSTALL, HERO_SUB, HERO_TITLE } from '../../../lib/earnkit/site-copy';

/** The readability shade over the painting: light at the top, clear through the arches, deep under the words. */
const SHADE =
  'bg-[linear-gradient(180deg,var(--ek-s-hero-shade)_0%,var(--ek-s-hero-shade-clear)_22%,var(--ek-s-hero-shade-clear)_48%,var(--ek-s-hero-shade-deep)_72%,var(--ek-s-hero-shade-end)_100%)]';

/** The white CTA: a soft warm glow at rest; on hover a 1px lift (not under reduced motion) and a white ring. */
const CTA =
  'mt-1.5 inline-flex h-[52px] items-center rounded-full bg-s-light px-8 text-[16px] font-bold text-s-ink shadow-[0_18px_60px_var(--ek-s-cta-glow)] motion-safe:transition-[box-shadow,transform] motion-safe:duration-[240ms] motion-safe:ease-out hover:shadow-[0_0_0_6px_var(--ek-s-foot-button),0_18px_70px_var(--ek-s-cta-glow-hover)] motion-safe:hover:-translate-y-px md:h-14';

/**
 * The landing hero (Landing board): Eckersberg's painting with its arch light (HeroArt), the money chip
 * ("$105K in grants open now", to #earn; none when nothing is open), the title on one line, the sub line, the
 * install CTA and the four agent marks along the bottom. Words are bottom-aligned over the readability shade.
 */
export default function Hero({ chip }: { chip: string | null }) {
  return (
    <section
      aria-label="EarnKit"
      className="relative isolate flex h-[560px] flex-col items-center justify-end overflow-hidden rounded-[32px] bg-s-hero-base px-6 pb-[88px] text-center md:h-[776px] md:rounded-[48px] md:pb-[104px]"
    >
      <HeroArt />
      <div aria-hidden="true" className={`absolute inset-0 -z-[1] ${SHADE}`} />

      <div className="relative z-[1] flex flex-col items-center gap-[22px]">
        {chip ? (
          <a
            href="#earn"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-s-chip-line bg-s-chip px-4 text-[14px] text-s-chip-text backdrop-blur-md hover:bg-s-chip-line motion-safe:transition-colors motion-safe:duration-200 md:h-9"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-s-rust-light shadow-[0_0_10px_var(--ek-s-rust-light)]" />
            {chip}
          </a>
        ) : null}
        <h1 className="ek-serif whitespace-nowrap text-[clamp(36px,9.6vw,96px)] leading-none tracking-[-0.015em] text-s-text [text-shadow:0_6px_50px_var(--ek-s-hero-title-shadow)]">
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
