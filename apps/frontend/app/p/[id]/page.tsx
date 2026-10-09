import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectPage } from '@/lib/earnkit/leaderboard';
import { entryStatus } from '@/lib/earnkit/campaigns';
import { formatDeadline } from '@/lib/earnkit/dates';
import { TOKEN_TERMS } from '@/lib/earnkit/tokens';

export const dynamic = 'force-dynamic';
/** Builder-supplied links: only http(s) becomes a link (no javascript: or data: URLs). */
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={/^https?:\/\//i.test(href) ? href : undefined}
    target="_blank"
    rel="noopener noreferrer"
    className="text-ek-white underline underline-offset-4"
  >
    {children}
  </a>
);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  const p = Number.isInteger(id) ? await getProjectPage(id) : null;
  if (!p) notFound();
  const c = p.campaign;
  // EarnKit: a rank once this entry is scored. Sponsor campaigns are picked by the sponsor: no
  // rank until something is scored.
  const ranked = c.kind === 'earnkit' ? p.score !== null : p.any_scored;

  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 md:rounded-[56px] md:px-16 md:py-16">
        <Link
          href={`/campaigns/${p.program_id}`}
          className="font-funnel-sans text-sm text-ek-blue-soft hover:text-ek-white"
        >
          ← {p.program_title}
        </Link>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
          {p.name}
        </h1>
        {p.description ? (
          <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
            {p.description}
          </p>
        ) : null}

        <dl className="mt-8 grid gap-6 font-funnel-sans sm:grid-cols-3">
          {ranked ? (
            <>
              <div>
                <dt className="text-sm text-ek-blue-soft">Rank</dt>
                <dd className="mt-1 text-2xl text-ek-white">
                  #{p.rank} of {p.entries}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ek-blue-soft">
                  {c.kind === 'earnkit' ? 'Unique users' : 'Unique wallets'}
                </dt>
                <dd className="mt-1 text-2xl tabular-nums text-ek-white">
                  {p.score ?? '–'}
                </dd>
              </div>
            </>
          ) : null}
          <div>
            <dt className="text-sm text-ek-blue-soft">Status</dt>
            <dd className="mt-1 text-2xl text-ek-white">
              {capitalize(p.standing ?? entryStatus(c, p, p.sponsor_state))}
            </dd>
          </div>
        </dl>
        {p.prize_reason ? (
          <p className="mt-2 text-sm text-ek-blue-soft">{p.prize_reason}</p>
        ) : null}

        <ul className="mt-8 space-y-2 font-funnel-sans text-base text-ek-blue-light">
          {p.live_url ? (
            <li>
              Live: <A href={p.live_url}>{p.live_url}</A>
            </li>
          ) : null}
          {p.repo_url ? (
            <li>
              Code: <A href={p.repo_url}>{p.repo_url}</A>
            </li>
          ) : null}
          {/^https:\/\/(www\.)?tokens\.fun\//.test(p.token_url ?? '') ? (
            <li>
              Token: <A href={p.token_url!}>tokens.fun</A>
            </li>
          ) : null}
          {p.contracts.map((a) => (
            <li key={a}>
              Contract: <A href={`https://basescan.org/address/${a}`}>{a}</A>
            </li>
          ))}
          {p.prize_tx ? (
            <li>
              Prize paid:{' '}
              <A href={`https://basescan.org/tx/${p.prize_tx}`}>{p.prize_tx}</A>
            </li>
          ) : null}
        </ul>
        {/* v2.10 item 5: the token terms live here (and on tokens.fun), never in a reply. */}
        <p className="mt-6 font-funnel-sans text-sm font-light text-ek-blue-soft">
          Token terms: <A href={TOKEN_TERMS.agreement}>agreement</A> · <A href={TOKEN_TERMS.risks}>risks</A>
        </p>
        {p.scored_at ? (
          <p className="mt-6 font-funnel-sans text-sm font-light text-ek-blue-soft">
            Scored {formatDeadline(p.scored_at)}
          </p>
        ) : null}
      </section>
    </div>
  );
}
