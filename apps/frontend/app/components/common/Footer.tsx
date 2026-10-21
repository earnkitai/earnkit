import Link from 'next/link';
import InstallButton from './InstallButton';
import { Wordmark } from '../ui/Logo';
import FooterLight from '../site/FooterLight';
import { FOOTER_COLUMNS } from '../../../lib/earnkit/footer-links';
import { ART_CREDIT, CTA_INSTALL, FOOT_CTA, FOOT_GET_PAGE } from '../../../lib/earnkit/site-copy';

const LINK = 'inline-flex min-h-11 items-center text-s-foot-link motion-safe:transition-colors duration-200 hover:text-s-text';

/** The X glyph (14px) in a round button: 44px on a phone, 36px from md (Foot board). */
function XButton({ href, label, fill }: { href: string; label: string; fill: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-s-text motion-safe:transition-colors duration-200 hover:bg-s-line-hover md:h-9 md:w-9 ${fill}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
        />
      </svg>
    </a>
  );
}

function HomeMark() {
  return (
    <Link href="/" aria-label="EarnKit home" className="inline-flex min-h-11 items-center text-s-text">
      <Wordmark decorative width={96} height={18} />
    </Link>
  );
}

function CompanyLine() {
  return (
    <p className="mt-4 text-[12px] text-s-dim">
      EarnKit is a product of Tokenfi Inc. &copy; {new Date().getFullYear()} Tokenfi Inc. All rights reserved.
    </p>
  );
}

/** The bar under the CTA (full) or alone (minimal): the wordmark, the links, the X button; wraps on a phone. */
const BAR = 'flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t pt-[22px] text-[14px]';

/**
 * v3.1 (Foot board). Full (default): a rounded card over Panini's Pantheon (pre-sized JPEGs, lazy), the
 * pointer light (FooterLight), a bottom fade; the CTA line in Kaftan Serif and the white pill that opens
 * the install sheet; then the bar: wordmark, Leaderboard, Feed, Docs, Terms (S16), the art credit and
 * EarnKit's X (S17). Minimal (profile): the bar only, with "Get your page" and Leaderboard. Both end with
 * the company line.
 */
export default function Footer({ variant = 'full' }: { variant?: 'full' | 'minimal' }) {
  const links = FOOTER_COLUMNS.flatMap((c) => c.links);
  const x = links.find((l) => l.icon === 'x')!;

  if (variant === 'minimal')
    return (
      <footer className="mt-14 px-4 pb-8 md:mt-[72px] md:px-6">
        <div className="mx-auto max-w-[1152px] text-s-text">
          <div className={`${BAR} border-s-step-line pb-2`}>
            <HomeMark />
            <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6">
              <Link href="/docs" className={LINK}>
                {FOOT_GET_PAGE}
              </Link>
              <Link href="/leaderboard" className={LINK}>
                Leaderboard
              </Link>
            </nav>
            <XButton href={x.href} label={x.label} fill="bg-s-chip" />
          </div>
          <CompanyLine />
        </div>
      </footer>
    );

  return (
    <footer className="mt-14 px-4 pb-8 md:mt-24 md:px-6">
      <div className="relative isolate mx-auto flex min-h-[420px] max-w-[1192px] flex-col justify-between gap-10 overflow-hidden rounded-[32px] bg-s-deep p-6 text-s-text md:min-h-[480px] md:rounded-[48px] md:p-12">
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized variants, no image optimizer (plan cost rule) */}
        <img
          src="/art/foot-panini-1400.jpg"
          srcSet="/art/foot-panini-700.jpg 700w, /art/foot-panini-1400.jpg 1400w, /art/foot-panini-2800.jpg 2800w"
          sizes="(min-width: 1240px) 1192px, calc(100vw - 32px)"
          loading="lazy"
          decoding="async"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 z-[-3] h-full w-full object-cover object-[50%_18%] brightness-[0.72] saturate-[0.95]"
        />
        <FooterLight />
        <div aria-hidden="true" className="absolute inset-0 z-[-2] bg-[linear-gradient(180deg,transparent_40%,var(--ek-s-foot-fade)_100%)]" />

        <div className="flex flex-col items-center gap-[22px] pt-10 text-center">
          <span className="ek-serif text-balance text-[40px] leading-none [text-shadow:0_4px_40px_var(--ek-s-scrim)] md:text-[64px]">{FOOT_CTA}</span>
          <InstallButton
            label={CTA_INSTALL}
            className="inline-flex h-[52px] items-center rounded-full bg-s-light px-7 text-[15px] font-bold text-s-ink motion-safe:transition-shadow duration-200 hover:shadow-[0_0_0_6px_var(--ek-s-foot-button),0_18px_60px_var(--ek-s-foot-cta-glow)]"
          />
        </div>

        <div className={`${BAR} border-s-foot-line`}>
          <HomeMark />
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6">
            {links
              .filter((l) => !l.icon)
              .map((l) => (
                <Link key={l.href} href={l.href} className={LINK}>
                  {l.label}
                </Link>
              ))}
            <span className="text-[12px] text-s-card-meta">{ART_CREDIT}</span>
          </nav>
          <XButton href={x.href} label={x.label} fill="bg-s-foot-button" />
        </div>
      </div>
      <div className="mx-auto max-w-[1192px]">
        <CompanyLine />
      </div>
    </footer>
  );
}
