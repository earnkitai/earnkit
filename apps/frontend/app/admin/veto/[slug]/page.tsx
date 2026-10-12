import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { oneParam } from '@/lib/earnkit/http';
import { sql } from '@/lib/earnkit/db';
import type { CampaignConfig } from '@/lib/earnkit/campaigns';
import { formatDeadline } from '@/lib/earnkit/dates';
import { payingCampaign, reviewRows } from '@/lib/earnkit/leaderboard';
import { prizeFunds } from '@/lib/earnkit/funds';
import type { FrozenTerms } from '@/lib/earnkit/payout';
import { RateLimitError, clientIp, enforce } from '@/lib/earnkit/rate-limit';
import { VETO_ERRORS, vetoKeyMatches } from '@/lib/earnkit/veto';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The owner's review of an EarnKit campaign (v2.4 §3): the payout wallet's live balance, any pause
 * note, and the ranked entries with their evidence and a remove button per entry. Opening it (GET)
 * only shows, and counts against the veto rate limit per IP (ruling 13); removing is a POST with
 * the key (Review Focus 4). A wrong key is a 404. Capped reads (score_partial) are flagged: they
 * still pay (ruling 20).
 */
export default async function VetoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ key?: string | string[]; removed?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { key: rawKey, removed, error } = await searchParams;
  const key = oneParam(rawKey);
  try {
    await enforce('veto', clientIp(await headers()), VETO_ERRORS['rate-limited']);
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    return (
      <div className="w-full pt-4">
        <p className="rounded-[40px] bg-ek-navy-deep px-6 py-12 font-funnel-sans text-ek-blue-light md:px-16">
          {VETO_ERRORS['rate-limited']}
        </p>
      </div>
    );
  }
  if (!vetoKeyMatches(slug, key)) notFound();
  const [program] = await sql()<{ title: string; campaign: CampaignConfig | null }[]>`
    SELECT title, campaign FROM programs WHERE id = ${slug}`;
  if (program?.campaign?.kind !== 'earnkit') notFound();
  const [run] = await sql()<
    { state: string; review_until: Date | null; note: string | null; terms: FrozenTerms | null }[]
  >`SELECT state, review_until, note, terms FROM campaign_runs WHERE program_id = ${slug}`;
  const paying = payingCampaign(program.campaign, run?.terms);
  const [{ ranked, picks, skipped }, funds] = await Promise.all([
    reviewRows(slug, program.campaign),
    // The owner reads the balance now, not the public page's cached one.
    prizeFunds(paying, { fresh: true }),
  ]);
  // The same rule as the veto itself: open while review_until is ahead.
  const open = run?.state === 'review' && run.review_until !== null && run.review_until.getTime() > Date.now();
  const removedId = Number(removed);
  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 font-funnel-sans text-ek-blue-light md:px-16">
        <Link href={`/campaigns/${slug}`} className="text-sm text-ek-blue-soft">← {program.title}</Link>
        <h1 className="mt-4 font-funnel-display text-3xl text-ek-white">Review</h1>
        <p className="mt-2 break-all text-sm">
          {funds
            ? `Prize wallet ${funds.wallet} holds ${Number(funds.balance).toLocaleString('en-US')} ${funds.symbol}; the cron pays ${paying.amount_each} ${paying.prize.symbol} each to ${picks.length} of ${paying.winners}.`
            : 'Prize wallet: not set up yet (CAMPAIGN_PAYOUT_PRIVATE_KEY), or its balance could not be read.'}
        </p>
        {run?.note ? <p className="mt-2 text-sm text-ek-white">{run.note}</p> : null}
        {error && Object.hasOwn(VETO_ERRORS, error) ? (
          <p className="mt-2 text-sm text-ek-white">{VETO_ERRORS[error as keyof typeof VETO_ERRORS]}</p>
        ) : null}
        <p className="mt-2 text-sm">
          {open && run?.review_until
            ? `Open until ${formatDeadline(run.review_until)}. Removing an entry moves the next one up.`
            : run?.state === 'review'
              ? 'The review has closed; the cron pays on its next run.'
              : `Removing is possible only during the 48-hour review (now: ${run?.state ?? 'running'}).`}
          {Number.isInteger(removedId) && removedId > 0 ? ` Removed entry #${removedId}.` : ''}
        </p>
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-ek-blue-soft">
              <th>#</th><th>Entry</th><th>Users</th><th>Shared</th><th>Code</th><th>Deployers</th><th />
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.id} className="border-t border-ek-navy align-top">
                <td className="py-2">{r.rank}{picks.some((p) => p.id === r.id) ? ' (wins)' : ''}</td>
                <td className="py-2">
                  {r.name} (#{r.id}){r.vetoed_at ? `: removed, ${r.veto_reason}` : ''}
                  {r.prize_tx ? <div className="text-xs">paid {r.prize_tx}</div> : null}
                  {r.score_error ? <div className="text-xs">score error: {r.score_error}</div> : null}
                  <div className="text-xs">
                    {r.live_url ? <a href={r.live_url} target="_blank" rel="noopener noreferrer" className="underline">live</a> : null}{' '}
                    {r.repo_url ? <a href={r.repo_url} target="_blank" rel="noopener noreferrer" className="underline">code</a> : null}
                  </div>
                </td>
                <td className="py-2">
                  {r.counted} ({r.smart} smart)
                  {r.score_partial ? (
                    <div className="text-xs text-ek-white">capped read: may be low; still pays</div>
                  ) : null}
                </td>
                <td className="py-2">{r.shared}</td>
                <td className="py-2">{r.code_share === null ? '–' : `${Math.round(r.code_share * 100)}%`}</td>
                <td className="break-all py-2 text-xs">{(r.deployers ?? []).join(', ')}</td>
                <td className="py-2">
                  {open && !r.vetoed_at && !r.prize_tx ? (
                    <form method="post" action="/api/admin/veto">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="entry" value={r.id} />
                      <input name="reason" placeholder="reason (public)" maxLength={200} className="w-36 rounded bg-ek-navy px-2 py-1 text-ek-white" />
                      <button type="submit" className="ml-2 underline">Remove</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {skipped.length ? (
          <ul className="mt-4 space-y-1 text-xs text-ek-blue-soft">
            {skipped.map((s) => (
              <li key={s.id}>Skipped #{s.id}: {s.reason}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
