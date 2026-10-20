import ChainLogo from '../components/ui/ChainLogo';
import { H2, ROWS } from '../components/common/Panel';
import { TEXT_LINK } from '../components/common/Button';
import type { ProjectTabData } from '../../lib/earnkit/bench-data';
import { NOTHING_YET, programLabel } from '../../lib/earnkit/page-data';

export const FUNDS_TITLE = 'Ways to get funded';
export const LIVE_LINK = 'Live site';
export const CODE_LINK = 'Code';

const LINE = 'border-t border-ek-line py-4 font-funnel-sans text-base md:py-5';
const EMPTY = 'border-b border-t border-ek-line py-4 font-funnel-sans text-base text-ek-body md:py-5';

/**
 * v2.13 spec "Project tab", v3 Stage 3 (spec 5.8, as rows): the name, what it is, the live link and the code, its
 * chain logos, the coin with its tokens.fun link, programs entered and won, then "Ways to get funded".
 * v2.13.1 O3: until the project is confirmed, its name and what it is, plainly. Pure.
 */
export default function ProjectTab({
  project,
}: {
  project: ProjectTabData | null;
}) {
  if (!project) return <p className={EMPTY}>{NOTHING_YET}</p>;
  const p = project;
  const head = (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className={`min-w-0 break-words ${H2}`}>{p.name}</h2>
        {p.confirmed && p.chains.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            {p.chains.map((c) => (
              <ChainLogo key={c} chain={c} size={22} />
            ))}
          </span>
        ) : null}
      </div>
      {p.what ? (
        <p className="mt-2 max-w-[36rem] break-words font-funnel-sans text-base text-ek-body md:text-lg">
          {p.what}
        </p>
      ) : null}
    </div>
  );
  // Fix round 1: until it's confirmed (it may be someone else's repo), no links and no numbers.
  // v2.13.1 O3: its name and what it is, plainly.
  if (!p.confirmed) return head;
  return (
    <div>
      {head}
      {p.live || p.repo || p.coin ? (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1">
          {p.live ? (
            <a href={p.live} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
              {LIVE_LINK}
            </a>
          ) : null}
          {p.repo ? (
            <a href={p.repo} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
              {CODE_LINK}
            </a>
          ) : null}
          {p.coin ? (
            <a href={p.coin.url} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>{`$${p.coin.symbol} on tokens.fun`}</a>
          ) : null}
        </div>
      ) : null}

      {p.programs.length > 0 ? (
        <ul className={`mt-8 ${ROWS}`}>
          {p.programs.map((g) => {
            // v3 Stage 2: "Won X" (announced), else "Applied to X"; a self-reported acceptance never changes it.
            const label = programLabel(g);
            return label ? (
              <li
                key={g.title}
                className={`break-words ${LINE} ${g.won ? 'font-medium text-ek-text' : 'text-ek-body'}`}
              >
                {label}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}

      {p.funds.length > 0 ? (
        <section aria-label={FUNDS_TITLE} className="mt-10 md:mt-12">
          <h3 className={H2}>{FUNDS_TITLE}</h3>
          <ul className={`mt-4 ${ROWS} md:mt-5`}>
            {p.funds.map((f) => (
              <li key={f} className={`${LINE} text-ek-body`}>
                {f}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
