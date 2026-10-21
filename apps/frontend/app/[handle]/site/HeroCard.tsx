import type { ProfileData } from '../../../lib/earnkit/bench-data';
import type { ProfileSite, StandingPill } from '../../../lib/earnkit/site-data';
import { CARD_BLUE, METAL, phoneRadius } from '../../components/site/ui';
import Avatar from '../Avatar';
import ShareButton from '../ShareButton';

/** The round icon buttons on blue (X, GitHub): 44px, a white wash that brightens on hover. */
const ICON_BTN =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-s-blue-button text-s-on-blue hover:bg-s-blue-button-hover motion-safe:transition-colors motion-safe:duration-150';
const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The metal "Top N%" pill beside the name; its title is the place ("#3 of 42 builders on Base"). */
function Standing({ s }: { s: StandingPill }) {
  return (
    <span data-ek-standing="" title={s.title} className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-3 pr-3.5 text-[14px] font-bold ${METAL[s.tier]}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" />
      </svg>
      {s.label}
    </span>
  );
}

/** EarnKit's mark (the board's 29x28 drawing), blue on a white 56px tile. */
function EarnKitMark() {
  return (
    <span data-ek-mark="earnkit" aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-s-light text-s-blue">
      <svg width="29" height="28" viewBox="0 0 29 28">
        <path fill="currentColor" d="M14.5258 6.97539C10.6587 6.97539 7.52377 10.1103 7.52377 13.9774H0.548389C0.548389 6.25789 6.80628 0 14.5258 0C22.2453 0 28.5032 6.25789 28.5032 13.9774H21.5278C21.5278 10.1103 18.3929 6.97539 14.5258 6.97539Z" />
        <path fill="currentColor" d="M7.54423 13.9775C7.54423 17.8695 4.38911 21.0246 0.49707 21.0246V28C8.24151 28 14.5196 21.7219 14.5196 13.9775H7.54423Z" />
        <path fill="currentColor" d="M28.495 20.965C24.6358 20.965 21.5074 17.8366 21.5074 13.9774H14.532C14.532 21.689 20.7834 27.9404 28.495 27.9404V20.965Z" />
      </svg>
    </span>
  );
}

/** Base's official blue square in a 20px white tile. */
function BaseTile() {
  return (
    <span role="img" aria-label="Built on Base" title="Built on Base" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-s-light text-s-base-blue">
      <svg width="11" height="11" viewBox="0 0 1280 1280" aria-hidden="true">
        <path
          fill="currentColor"
          d="M0,101.12c0-34.64,0-51.95,6.53-65.28,6.25-12.76,16.56-23.07,29.32-29.32C49.17,0,66.48,0,101.12,0h1077.76c34.63,0,51.96,0,65.28,6.53,12.75,6.25,23.06,16.56,29.32,29.32,6.52,13.32,6.52,30.64,6.52,65.28v1077.76c0,34.63,0,51.96-6.52,65.28-6.26,12.75-16.57,23.06-29.32,29.32-13.32,6.52-30.65,6.52-65.28,6.52H101.12c-34.64,0-51.95,0-65.28-6.52-12.76-6.26-23.07-16.57-29.32-29.32-6.53-13.32-6.53-30.65-6.53-65.28V101.12Z"
        />
      </svg>
    </span>
  );
}

/** The inset project panel: the logo tile, the name with the Base tile, the about line and the link; or one calm line. */
function ProjectPanel({ project, line }: { project: ProfileSite['project']; line: string | null }) {
  return (
    <div className="mt-auto flex items-start gap-[18px] rounded-[26px] bg-s-inset p-[22px]">
      {line || !project ? (
        <p className="min-w-0 text-[15px] leading-[1.5] text-s-on-blue-soft">{line}</p>
      ) : (
        <>
          {project.earnkit ? (
            <EarnKitMark />
          ) : (
            <span
              data-ek-mark="letter"
              aria-hidden="true"
              className="ek-serif flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[30px] leading-none text-s-text"
              style={{ background: project.color }}
            >
              {project.letter}
            </span>
          )}
          <div className="flex min-w-0 flex-auto flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="ek-serif min-w-0 break-words text-[28px] leading-none md:text-[34px]">{project.name}</span>
              {project.onBase ? <BaseTile /> : null}
            </div>
            {project.about ? (
              <p data-ek-about="" className="text-[15px] leading-[1.5] text-s-on-blue-soft [overflow-wrap:anywhere]">
                {project.about}
              </p>
            ) : null}
            {project.link ? (
              <a
                href={project.link.href}
                {...EXTERNAL}
                className="-my-[13px] inline-flex min-h-11 max-w-full items-center gap-1.5 self-start text-[14px] text-s-on-blue-soft hover:text-s-on-blue md:my-0 md:min-h-0 motion-safe:transition-colors"
              >
                <span className="truncate">{project.link.text}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                  <path d="M7 7h10v10" />
                  <path d="M7 17 17 7" />
                </svg>
              </a>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The blue hero (Profile board): the photo, the name in Kaftan Serif with the standing pill (only from RANK_MIN_POOL
 * ranked builders: site.standing), the @handle, the X and GitHub buttons and Share; then the inset project panel.
 * `line` replaces the panel's project (no project, or confirming).
 */
export default function HeroCard({ data, site, line }: { data: ProfileData; site: ProfileSite; line: string | null }) {
  // No project or Confirming: one calm line and no repo link (the project is not counted yet).
  const repo = line ? null : (site.project?.repo ?? null);
  return (
    <div data-ek-hero="" className={`${phoneRadius(CARD_BLUE)} flex min-w-0 flex-[3_1_460px] flex-col gap-7 p-6 md:p-9`}>
      <div className="flex flex-wrap items-center gap-[18px]">
        <Avatar src={data.avatar} handle={data.handle} tone="blue" className="h-16 w-16 text-[34px] md:h-[76px] md:w-[76px] md:text-[40px]" />
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="ek-serif min-w-0 break-words text-[44px] leading-none tracking-[-0.01em] md:text-[60px]">{data.name}</h1>
            {site.standing ? <Standing s={site.standing} /> : null}
          </div>
          <span className="break-words text-[15px] text-s-on-blue-soft">@{data.handle}</span>
        </div>
        <div className="flex gap-2">
          <a href={`https://x.com/${encodeURIComponent(data.handle)}`} {...EXTERNAL} aria-label="X profile" className={ICON_BTN}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
              />
            </svg>
          </a>
          {repo ? (
            <a href={repo} {...EXTERNAL} aria-label="GitHub" className={ICON_BTN}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                />
              </svg>
            </a>
          ) : null}
          <ShareButton handle={data.handle} />
        </div>
      </div>
      <ProjectPanel project={site.project} line={line} />
    </div>
  );
}
