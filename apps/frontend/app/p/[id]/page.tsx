import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectPage } from '@/lib/earnkit/leaderboard';

export const dynamic = 'force-dynamic';

const count = (n: string | number) =>
  new Intl.NumberFormat('en-US').format(Number(n));
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="text-ek-white underline underline-offset-4"
  >
    {children}
  </a>
);

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  const p = Number.isInteger(id) ? await getProjectPage(id) : null;
  if (!p) notFound();
  const c = p.campaign;

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
          <div>
            <dt className="text-sm text-ek-blue-soft">Rank</dt>
            <dd className="mt-1 text-2xl text-ek-white">
              #{p.rank} of {p.entries}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ek-blue-soft">Unique wallets</dt>
            <dd className="mt-1 text-2xl tabular-nums text-ek-white">
              {p.score ?? '–'}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ek-blue-soft">Prize</dt>
            <dd className="mt-1 text-2xl text-ek-white">
              {p.prize_tx
                ? `Won ${count(c.amount_each)} ${c.prize.symbol}`
                : (p.score ?? 0) >= c.min_score
                  ? 'Eligible'
                  : 'Building'}
            </dd>
          </div>
        </dl>

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
          {p.token_url && p.token_url !== 'pending' ? (
            <li>
              Token: <A href={p.token_url}>tokens.fun</A>
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
        {p.scored_at ? (
          <p className="mt-6 font-funnel-sans text-sm font-light text-ek-blue-soft">
            Scored {p.scored_at.toUTCString()}
          </p>
        ) : null}
      </section>
    </div>
  );
}
