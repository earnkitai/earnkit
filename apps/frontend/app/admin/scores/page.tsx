import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { publicScore, scoresAdminKey } from '@/lib/earnkit/builder-score';
import { sql } from '@/lib/earnkit/db';
import { oneParam, secretMatches } from '@/lib/earnkit/http';
import { RateLimitError, clientIp, enforce } from '@/lib/earnkit/rate-limit';
import type { Parts } from '@/lib/earnkit/score';
import { VETO_ERRORS } from '@/lib/earnkit/veto';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

type Held = { builder_id: number; slug: string; day: string; score: number; parts: Parts; top_outcome: Record<string, unknown> };

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
  // Each held person's newest held day not yet released.
  const held = await sql()<Held[]>`
    SELECT p.builder_id, p.slug, s.day::text AS day, s.score, s.parts, s.top_outcome
    FROM builder_profiles p
    JOIN LATERAL (
      SELECT day, score, parts, top_outcome FROM builder_scores s
      WHERE s.builder_id = p.builder_id AND s.held
        AND NOT EXISTS (SELECT 1 FROM score_releases x WHERE x.builder_id = s.builder_id AND x.day = s.day)
      ORDER BY s.day DESC LIMIT 1) s ON true
    WHERE p.held ORDER BY s.day, p.builder_id`;
  const shown = await Promise.all(held.map((h) => publicScore(h.builder_id)));
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
            {held.map((h, i) => (
              <tr key={h.builder_id} className="border-t border-ek-navy align-top">
                <td className="py-2">{h.slug} (#{h.builder_id})</td>
                <td className="py-2">{h.score} on {h.day}</td>
                <td className="py-2">{shown[i] ? `${shown[i]!.score} on ${shown[i]!.day}` : 'none yet'}</td>
                <td className="py-2 text-xs">
                  {(Object.entries(h.parts ?? {}) as [string, Parts[keyof Parts]][]).map(([name, part]) => (
                    <div key={name}>
                      {name}: {num(part?.points)} ({Object.entries(part?.raw ?? {}).map(([k, v]) => `${k} ${num(v)}`).join(', ')})
                    </div>
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
                    <button type="submit" className="underline">Release</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
