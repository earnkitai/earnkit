import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { formatUnits } from 'viem';
import { sql } from '@/lib/earnkit/db';
import { formatDeadline } from '@/lib/earnkit/dates';
import { placesFor, roundRows, type BonusTerms } from '@/lib/earnkit/bonus-payout';
import { RateLimitError, clientIp, enforce } from '@/lib/earnkit/rate-limit';
import { UNVERIFIED_PAGE_FLAG, type Signals } from '@/lib/earnkit/traction';
import { VETO_ERRORS, bonusVetoKey } from '@/lib/earnkit/veto';
import { secretMatches } from '@/lib/earnkit/http';
import { shownUrl } from '@/lib/earnkit/untrusted-text';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/** How a frozen flag reads on the review page. Pure. */
const flagText = (f: string) =>
  f === 'single_commit_streak'
    ? 'single-commit streak (7+ days)'
    : f === UNVERIFIED_PAGE_FLAG
      ? 'unverified page: the program site blocked EarnKit; the builder confirmed it'
      : f.startsWith('failed:')
      ? `failed source: ${f.slice('failed:'.length)} (last value kept)`
      : f;

/**
 * v2.6 Ruling 4 (plan): how the entry's submission counted. A v2.5 row (no basis) counted on its
 * checked page. Pure.
 */
const submissionText = (basis: string | null) =>
  basis === 'unverified_page' ? 'unverified page' : basis === 'confirmed' ? 'builder confirmed' : 'page checked';

const weth = (wei: bigint | string | null) => (wei === null ? '–' : `${formatUnits(BigInt(wei), 18)} WETH`);

/**
 * The owner's review of a builder bonus round (v2.5 §3, Ruling 17): the frozen pool and amounts,
 * any pause note, and the frozen ranking with each entry's signals, its flags (scheduled-commit
 * pattern, sources that failed after the 24 h escape, an unverified entry page), how its
 * submission counted (v2.6 Ruling 4 (plan): page checked, unverified page, builder confirmed), the place and amount it takes, and a remove
 * button during the 48 h review. Opening it (GET) only shows, and counts against the veto rate
 * limit per IP; removing is a POST with the round's key. A wrong key is a 404.
 */
export default async function BonusReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ round: string }>;
  searchParams: Promise<{ key?: string; removed?: string; error?: string }>;
}) {
  const raw = (await params).round;
  const { key, removed, error } = await searchParams;
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
  // After the rate limit: a malformed escape (URIError) is a plain 404.
  let round: string;
  try {
    round = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const expected = bonusVetoKey(round);
  if (expected === null || !secretMatches(key, expected)) notFound();
  const [r] = await sql()<
    { title: string; state: string; ends_at: Date; review_until: Date | null; note: string | null; terms: BonusTerms | null }[]
  >`
    SELECT p.title, b.state, b.ends_at, b.review_until, b.note, b.terms
    FROM bonus_rounds b JOIN programs p ON p.id = b.program_id WHERE b.round_key = ${round}`;
  if (!r) notFound();
  const rows = await roundRows(round);
  const ids = rows.map((x) => x.project_id);
  const facts = ids.length
    ? await sql()<
        { id: number; name: string; repo_url: string | null; live_url: string | null; submission_basis: string | null; signals: Signals | null }[]
      >`
        SELECT p.id, p.name, p.repo_url, p.live_url, p.submission_basis, (
          SELECT s.signals FROM bonus_scores s
          WHERE s.round_key = ${round} AND s.project_id = p.id AND s.through >= ${r.ends_at}
          ORDER BY s.day DESC LIMIT 1) AS signals
        FROM projects p WHERE p.id IN ${sql()(ids)}`
    : [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const amounts = (r.terms?.amounts ?? []).map(BigInt);
  const places = new Map(placesFor(rows, amounts).map((p) => [p.project_id, p]));
  const flagged = new Set(r.terms?.flagged ?? []);
  // The same rule as the veto itself: open while review_until is ahead.
  const open = r.state === 'review' && r.review_until !== null && r.review_until.getTime() > Date.now();
  const removedId = Number(removed);
  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 font-funnel-sans text-ek-blue-light md:px-16">
        <h1 className="font-funnel-display text-3xl text-ek-white">Builder bonus review: {r.title}</h1>
        <p className="mt-2 text-sm">
          Round {round}, {r.state}.{' '}
          {r.terms
            ? `Pool ${weth(r.terms.pool_wei)}, ${amounts.length} place${amounts.length === 1 ? '' : 's'} (amounts frozen when the review opened).`
            : 'Not frozen yet.'}
        </p>
        <p className="mt-2 text-xs">EarnKit isn&apos;t affiliated with or endorsed by the organizer.</p>
        {r.note ? <p className="mt-2 text-sm text-ek-white">{r.note}</p> : null}
        {flagged.size > 0 ? (
          <p className="mt-2 text-sm text-ek-white">
            {flagged.size} entr{flagged.size === 1 ? 'y has' : 'ies have'} a source that still failed 24 h after the end; their last values were used. Check them before the review closes.
          </p>
        ) : null}
        {error && Object.hasOwn(VETO_ERRORS, error) ? (
          <p className="mt-2 text-sm text-ek-white">{VETO_ERRORS[error as keyof typeof VETO_ERRORS]}</p>
        ) : null}
        <p className="mt-2 text-sm">
          {open && r.review_until
            ? `Open until ${formatDeadline(r.review_until)}. Removing an entry moves the next one up into the same amounts.`
            : r.state === 'review'
              ? 'The review has closed; the cron pays on its next run.'
              : `Removing is possible only during the 48-hour review (now: ${r.state}).`}
          {Number.isInteger(removedId) && removedId > 0 ? ` Removed entry #${removedId}.` : ''}
        </p>
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-ek-blue-soft">
              <th>Rank</th><th>Project</th><th>Score</th><th>Signals</th><th>Submission</th><th>Flags</th><th>Amount</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const f = byId.get(x.project_id);
              const s = f?.signals;
              const place = places.get(x.project_id);
              // Stored URLs are untrusted: https-only canonical, else no link at all.
              const live = shownUrl(f?.live_url);
              const repo = shownUrl(f?.repo_url);
              return (
                <tr key={x.id} className="border-t border-ek-navy align-top">
                  <td className="py-2">{x.rank}</td>
                  <td className="py-2">
                    {f?.name ?? 'entry'} (#{x.project_id})
                    {x.vetoed ? `: removed, ${x.veto_reason}` : ''}
                    {x.status === 'refused' ? ': refused (wallet screen or two reverts)' : ''}
                    {x.wallet ? null : ': no wallet, never paid'}
                    {x.tx_hash ? <div className="break-all text-xs">{x.status === 'paid' ? 'paid' : 'sending'} {x.tx_hash}</div> : null}
                    <div className="text-xs">
                      {live ? <a href={live} target="_blank" rel="noopener noreferrer" className="underline">live</a> : null}{' '}
                      {repo ? <a href={repo} target="_blank" rel="noopener noreferrer" className="underline">code</a> : null}
                    </div>
                  </td>
                  <td className="py-2">{x.score.toFixed(2)}</td>
                  <td className="py-2 text-xs">
                    {s
                      ? `users ${s.users}, live ${Math.round(s.liveRatio * 100)}%, commit days ${s.commitDays}, contributors ${s.contributors}, interest ${s.interest}, holders ${s.holders}`
                      : '–'}
                  </td>
                  <td className="py-2 text-xs">{f ? submissionText(f.submission_basis) : '–'}</td>
                  <td className="py-2 text-xs">{x.flags.length ? x.flags.map(flagText).join('; ') : '–'}</td>
                  <td className="py-2">{place ? `#${place.slot + 1}: ${weth(place.amount)}` : '–'}</td>
                  <td className="py-2">
                    {open && !x.vetoed && !x.tx_hash ? (
                      <form method="post" action="/api/admin/veto">
                        <input type="hidden" name="round" value={round} />
                        <input type="hidden" name="key" value={key} />
                        <input type="hidden" name="entry" value={x.project_id} />
                        <input name="reason" placeholder="reason (public)" maxLength={200} className="w-36 rounded bg-ek-navy px-2 py-1 text-ek-white" />
                        <button type="submit" className="ml-2 underline">Remove</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
