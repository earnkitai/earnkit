import ChainLogo from '../components/ui/ChainLogo';
import type { ProjectTabData } from '../../lib/earnkit/bench-data';
import { NOTHING_YET, programLabel } from '../../lib/earnkit/page-data';

export const FUNDS_TITLE = 'Ways to get funded';
export const LIVE_LINK = 'Live site';
export const CODE_LINK = 'Code';

const LINK =
  'group inline-flex h-11 items-center gap-1.5 rounded-full border border-ek-line-strong px-4 font-funnel-sans text-sm font-medium text-ek-body transition-colors hover:bg-ek-chip hover:text-ek-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ek-blue-soft md:h-10';

function Arrow() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      className="h-3 w-3 shrink-0 transition-transform group-hover:-translate-y-px group-hover:translate-x-px"
    >
      <path
        d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * v2.13 spec "Project tab": the name, what it is, the live link and the code, its chain logos,
 * the coin with its tokens.fun link, programs entered and won, then
 * "Ways to get funded". v2.13.1 O3: until the project is confirmed, its name and what it is, plainly.
 * Pure.
 */
export default function ProjectTab({
  project,
}: {
  project: ProjectTabData | null;
}) {
  if (!project)
    return (
      <p className="font-funnel-sans text-base font-light text-ek-body">
        {NOTHING_YET}
      </p>
    );
  const p = project;
  // Fix round 1: until it's confirmed (it may be someone else's repo), no links and no numbers.
  // v2.13.1 O3: its name and what it is, plainly.
  if (!p.confirmed)
    return (
      <div>
        <h2 className="min-w-0 break-words font-funnel-display text-2xl font-medium leading-tight text-ek-text md:text-[2rem]">
          {p.name}
        </h2>
        {p.what ? (
          <p className="mt-2 max-w-2xl break-words font-funnel-sans text-base font-light leading-relaxed text-ek-body md:text-lg">
            {p.what}
          </p>
        ) : null}
      </div>
    );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 break-words font-funnel-display text-2xl font-medium leading-tight text-ek-text md:text-[2rem]">
          {p.name}
        </h2>
        {p.chains.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            {p.chains.map((c) => (
              <ChainLogo key={c} chain={c} size={22} />
            ))}
          </span>
        ) : null}
      </div>
      {p.what ? (
        <p className="mt-2 max-w-2xl break-words font-funnel-sans text-base font-light leading-relaxed text-ek-body md:text-lg">
          {p.what}
        </p>
      ) : null}
      {p.live || p.repo ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {p.live ? (
            <a
              href={p.live}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              {LIVE_LINK}
              <Arrow />
            </a>
          ) : null}
          {p.repo ? (
            <a
              href={p.repo}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              {CODE_LINK}
              <Arrow />
            </a>
          ) : null}
        </div>
      ) : null}

      {p.coin ? (
        <p className="mt-6 font-funnel-sans text-base font-medium text-ek-score-orange">
          <a href={p.coin.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">{`$${p.coin.symbol} on tokens.fun`}</a>
        </p>
      ) : null}

      {p.programs.length > 0 ? (
        <ul className="mt-6 space-y-1.5 font-funnel-sans text-[15px]">
          {p.programs.map((g) => {
            // v3 Stage 2: "Won X" (announced), else "Applied to X"; a self-reported acceptance never changes it.
            const label = programLabel(g);
            return label ? (
              <li
                key={g.title}
                className={`break-words ${g.won ? 'font-medium text-ek-score-orange' : 'text-ek-body'}`}
              >
                {label}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}

      {p.funds.length > 0 ? (
        <div className="mt-8">
          <h3 className="font-funnel-display text-xl font-medium text-ek-text md:text-2xl">
            {FUNDS_TITLE}
          </h3>
          <ul className="mt-3">
            {p.funds.map((f) => (
              <li
                key={f}
                className="border-t border-ek-line py-3 font-funnel-sans text-base text-ek-body first:border-t-0"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
