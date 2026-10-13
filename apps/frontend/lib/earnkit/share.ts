import { publicScore } from './builder-score';
import { sql } from './db';
import { enqueueDiscovery } from './discovery';
import { noteEvent } from './events';
import { HIDDEN_LINE, profileOf } from './profiles';
import type { ProfileData } from './profile-data';
import { topPercent } from './score';

/**
 * v2.12 spec 7 "Share card", "The offer": the card's words, the once-only offer, the X ask. EarnKit
 * never posts: the share is an X intent link the builder opens, through /b/<slug>/share (which
 * records card_shared). Only here is X asked; the handle shown is only ever the one the person's
 * proven GitHub profile lists (profiles.ts setXHandle, plan R5).
 */
export type CardModel = { score: number; top: string; outcome: string; handle: string };

/** How a project's title reads inside a sentence: the unnamed fallbacks get an article. Pure. */
const titleInWords = (t: string) => (t === 'Private project' ? 'a private project' : t === 'Open source' ? 'their open source work' : t);

/**
 * The card's words from the public profile (profile-data.ts: same privacy rules, so never a private
 * repo, a wallet as the name or anything self-reported). The top project's verified users, else its
 * money, in plain words; the name (X, else GitHub login, else "Builder"). Never a chain. Pure.
 */
export function cardModel(p: ProfileData): CardModel {
  const best = p.projects[0];
  const users = best?.numbers.map((n) => /^([\d,]+) users?$/.exec(n)).find(Boolean);
  const usd = best?.numbers.find((n) => /^\$/.test(n));
  const title = best ? titleInWords(best.title) : '';
  const outcome = !best
    ? 'Verified builder'
    : users
      ? `${users[1]} ${users[1] === '1' ? 'person' : 'people'} used ${title}`
      : usd
        ? `${usd} through ${title}`
        : `Shipped ${title}`;
  return { score: p.score, top: `Top ${p.top_percent}% of builders`, outcome, handle: p.name };
}

/**
 * The card's Cache-Control. Never immutable, never kept by the viewer's browser; a shared cache may
 * keep it 60 seconds. A hide or an X handle change shows at the origin at once (the card route
 * checks the live row; profileChanged() expires the PROFILE_TAG read), at the edge within a minute.
 * A repo gone private follows the profile page's own window (the 10-minute cached read).
 */
export const CARD_CACHE = 'public, max-age=0, s-maxage=60, must-revalidate';

export const cardOffer = (top: number) => `You're top ${top}%. Want your card to post on X?`;
/** find's reply keeps two lines (spec 7): there the offer rides on the score line it already has. Pure. */
export const findOfferLine = (scoreLine: string) => `${scoreLine}. Want your card to post on X?`;
export const xAsk = (prefill: string | null) => (prefill ? `Use @${prefill}?` : 'Add your X handle to your GitHub profile, then say done.');
export const CARD_OFFER_NOTE = 'On a yes, call tell with card: "yes"; on skip or no, card: "skip". Ask nothing else about it.';
const SHARE_URL = (slug: string) => `https://earnkit.com/b/${slug}/share`;
export const SHARE_LINE = (slug: string) => `Post it: ${SHARE_URL(slug)}`;
export const SKIPPED_LINE = 'Skipped.';

/** The X intent (https://x.com/intent/post) with the card's words and the public profile URL; nothing else. Pure. */
export function intentUrl(slug: string, m: CardModel): string {
  const u = new URL('https://x.com/intent/post');
  u.searchParams.set('text', `${m.top} on EarnKit. ${m.outcome}.`);
  u.searchParams.set('url', `https://earnkit.com/b/${slug}`);
  return u.toString();
}

/**
 * The offer, once per person: only with a public score above 0 on a listed profile, and never while
 * the reply already asks something (plan R14: it waits for a reply that asks nothing). Marks
 * card_offered_at as it is made. Null when not made.
 */
export async function offerCard(builderId: number, lineOneAsks: boolean): Promise<string | null> {
  if (lineOneAsks) return null;
  const s = await publicScore(builderId);
  if (!s || s.score <= 0) return null;
  const [p] = await sql()<{ builder_id: number }[]>`
    UPDATE builder_profiles SET card_offered_at = now() WHERE builder_id = ${builderId} AND card_offered_at IS NULL AND NOT hidden RETURNING builder_id`;
  if (!p) return null;
  await noteEvent('card_offered', () => ({ type: 'card_offered', dedupe_key: `card_offered:${builderId}`, installation_id: builderId }));
  return cardOffer(topPercent(s.percentile));
}

/**
 * A yes to the offer. X shown: the share link. Else, with a proven GitHub login, the X ask once:
 * "Use @name?" with GitHub's prefill, or (none listed) add it there and say done, after which
 * GitHub is read again within the hour. Asked before, or no login (a handle could never be
 * shown): the share link as the card is.
 */
export async function cardYes(builderId: number): Promise<{ show_to_builder: string; agent_note?: string }> {
  const p = await profileOf(builderId);
  if (!p) return { show_to_builder: '' };
  if (p.hidden) return { show_to_builder: HIDDEN_LINE };
  const s = await publicScore(builderId);
  if (!s || s.score <= 0) return { show_to_builder: '', agent_note: 'There is no verified score to share yet.' };
  if (p.x_handle || !p.github_login) return { show_to_builder: SHARE_LINE(p.slug) };
  if (p.twitter_prefill) {
    await sql()`UPDATE builder_profiles SET x_asked_at = COALESCE(x_asked_at, now()) WHERE builder_id = ${builderId}`;
    return {
      show_to_builder: xAsk(p.twitter_prefill),
      agent_note: `On a yes, call tell with x_handle: "yes". On a no, show them ${SHARE_LINE(p.slug)}`,
    };
  }
  if (p.x_asked_at) return { show_to_builder: SHARE_LINE(p.slug) };
  await sql()`UPDATE builder_profiles SET x_asked_at = now() WHERE builder_id = ${builderId}`;
  await enqueueDiscovery(builderId, 'signin');
  return {
    show_to_builder: xAsk(null),
    agent_note: `When they say done, EarnKit reads their GitHub profile within the hour; then call tell with card: "yes" again. If they'd rather not, show them ${SHARE_LINE(p.slug)}`,
  };
}
