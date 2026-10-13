import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { heldForReview, partLines, scoresAdminKey } from '@/lib/earnkit/builder-score';
import { oneParam, secretMatches } from '@/lib/earnkit/http';
import { xHandleConflicts } from '@/lib/earnkit/profiles';
import { RateLimitError, clientIp, enforce } from '@/lib/earnkit/rate-limit';
import { VETO_ERRORS } from '@/lib/earnkit/veto';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

/**
 * The owner's review of held builder scores (v2.12 spec 5): each held person's held day with its
 * parts (points and raw inputs) and top outcome beside the score the public still sees, and one
 * Release button (a POST with the key). Opening it only shows, and counts against the veto rate
 * limit per IP. A wrong key is a 404.
 */
export default async function ScoresReviewPage({ searchParams }: { searchParams: Promise<{ key?: string | string[] }> }) {
  // ?key=a&key=b is an array: never a key (a 404, not a crash).
  const key = oneParam((await searchParams).key);
  try {
    await enforce('veto', clientIp(await headers()), VETO_ERRORS['rate-limited']);
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    return (
      <div className="w-full pt-4">
        <p className="rounded-[40px] bg-ek-navy-deep px-6 py-12 font-funnel-sans text-ek-blue-light md:px-16">{VETO_ERRORS['rate-limited']}</p>
      </div>
    );
  }
  const expected = scoresAdminKey();
  if (expected === null || !secretMatches(key, expected)) notFound();
  // Each held person's newest held day not yet released, and the score the public sees now.
  const held = await heldForReview();
  // v2.12 T7 review: X handles two people's GitHub profiles list (self-declared): clear the holder's.
  const conflicts = await xHandleConflicts();
  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 font-funnel-sans text-ek-blue-light md:px-16">
        <h1 className="font-funnel-display text-3xl text-ek-white">Held scores</h1>
        <p className="mt-2 text-sm">
          A score that rose 30+ points in a day, or stands 60+ on one source, waits here. The public sees the last unheld score until you release it.
        </p>
        {held.length === 0 ? <p className="mt-6 text-sm text-ek-white">Nothing is held.</p> : null}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-ek-blue-soft">
              <th>Person</th><th>Held</th><th>Public</th><th>Parts</th><th>Top outcome</th><th />
            </tr>
          </thead>
          <tbody>
            {held.map((h) => (
              <tr key={`${h.formula}:${h.builder_id}`} className="border-t border-ek-navy align-top">
                <td className="py-2">{h.slug} (#{h.builder_id})</td>
                <td className="py-2">{h.score} on {h.day}</td>
                <td className="py-2">{h.shown ? `${h.shown.score} on ${h.shown.day}` : 'none yet'}</td>
                <td className="py-2 text-xs">
                  {partLines(h.parts).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </td>
                <td className="break-all py-2 text-xs">
                  {typeof h.top_outcome?.title === 'string' ? `${h.top_outcome.title}: ${num(h.top_outcome.users)} users, $${num(h.top_outcome.money_usd)}` : 'none'}
                </td>
                <td className="py-2">
                  <form method="post" action="/api/admin/scores">
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="builder" value={h.builder_id} />
                    <input type="hidden" name="day" value={h.day} />
                    {h.version ? <input type="hidden" name="version" value={h.version} /> : null}
                    <button type="submit" className="underline">Release</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 className="mt-10 font-funnel-display text-2xl text-ek-white">X handle conflicts</h2>
        <p className="mt-2 text-sm">
          Another person&apos;s GitHub profile lists the same X handle. Clearing it takes the handle off the holder&apos;s profile; their old link still redirects to them.
        </p>
        {conflicts.length === 0 ? <p className="mt-6 text-sm text-ek-white">No conflicts.</p> : null}
        <ul className="mt-6 text-sm">
          {conflicts.map((c) => (
            <li key={`${c.handle}:${c.holder}:${c.claimant}`} className="flex gap-4 border-t border-ek-navy py-2">
              <span>{c.line}</span>
              <form method="post" action="/api/admin/scores">
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="action" value="clear_x" />
                <input type="hidden" name="builder" value={c.holder} />
                <button type="submit" className="underline">Clear X handle</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
