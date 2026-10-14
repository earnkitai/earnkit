import { builderScoreEnabled } from '../../../../lib/earnkit/builder-score-flag';
import { noteEvent } from '../../../../lib/earnkit/events';
import { resolveSlug } from '../../../../lib/earnkit/profiles';
import { isReserved } from '../../../../lib/earnkit/reserved-routes';
import { shareResponse } from '../../../[handle]/card-response';
import { cardModel, intentUrl } from '../../../../lib/earnkit/share';
import { cachedProfile } from '../profile-load';

/**
 * v2.12 spec 7: the share link the builder opens. Records card_shared (once per person per day) and
 * 302s to the X intent built here from the public profile: the target is never read from the
 * request (no open redirect), and the URL carries only the public slug. EarnKit never posts.
 */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!builderScoreEnabled()) return new Response('Not found', { status: 404 });
  const raw = (await params).slug;
  // v2.12.1: a reserved handle's share link lives here (/b/<handle>/share).
  if (isReserved(raw)) return shareResponse(raw, `/b/${raw}`);
  const lower = raw.toLowerCase();
  // v2.12.1 T6: only a page claimed with X is public (resolveSlug), checked live before the cached read.
  if (!(await resolveSlug(lower))) return new Response('Not found', { status: 404 });
  const data = await cachedProfile(lower);
  if (!data) return new Response('Not found', { status: 404 });
  if ('redirect' in data) return new Response(null, { status: 308, headers: { Location: `/b/${encodeURIComponent(data.redirect)}/share`, 'Cache-Control': 'no-store' } });
  if (!('score' in data)) return new Response('Not found', { status: 404 });
  // The live row (never the cache): a profile hidden since the cached read is a 404 at once.
  const who = await resolveSlug(data.slug);
  if (!who || who.redirect) return new Response('Not found', { status: 404 });
  const day = new Date().toISOString().slice(0, 10);
  await noteEvent('card_shared', () => ({ type: 'card_shared', dedupe_key: `card_shared:${who.builderId}:${day}`, installation_id: who.builderId }));
  return new Response(null, { status: 302, headers: { Location: intentUrl(data.slug, cardModel(data)), 'Cache-Control': 'no-store' } });
}
