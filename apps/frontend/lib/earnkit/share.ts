import { sql } from './db';
import { HIDDEN_LINE } from './profiles';
import { pagePath } from './reserved-routes';
import { signInLink } from './x-link';

/**
 * v2.12.1 spec 5 "They share": sharing is one yes once the person signed in with X. EarnKit never
 * posts: the share is an X intent link the builder opens, through /<handle>/share (card-response.tsx,
 * which records card_shared). The card's words and the intent live in page-data.ts (cardHeadline,
 * shareIntent).
 */

/**
 * The card's Cache-Control. Never immutable, never kept by the viewer's browser; a shared cache may
 * keep it 60 seconds. A hide or an X handle change shows at the origin at once (the card route
 * checks the live row), at the edge within a minute.
 */
export const CARD_CACHE = 'public, max-age=0, s-maxage=60, must-revalidate';

export const SKIPPED_LINE = 'Skipped.';

/** v2.12.1 T8: the share link of a claimed page (the share route records card_shared, then opens X). */
export const POST_LINE = (handle: string) => `Post it: https://earnkit.com${pagePath(handle)}/share`;
export const signInFirstLine = (link: string) => `Sign in with X first: ${link}`;

/**
 * v2.12.1 T8 (spec 5): a yes to "Want a card to share it?". A page signed in with X gets its share link at
 * once; someone who never signed in gets the X sign-in link first (v2.14 T5, for their own installation `own`).
 * Hidden: the hidden line. No page to share: nothing shown, an agent note.
 */
export async function cardYes(builderId: number, own: number = builderId): Promise<{ show_to_builder: string; agent_note?: string }> {
  const [p] = await sql()<{ hidden: boolean; x_user_id: string | null; x_handle: string | null }[]>`
    SELECT hidden, x_user_id, x_handle FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p) return { show_to_builder: '', agent_note: 'There is no page to share yet.' };
  if (p.hidden) return { show_to_builder: HIDDEN_LINE };
  if (p.x_user_id && p.x_handle) return { show_to_builder: POST_LINE(p.x_handle) };
  const link = await signInLink(own, new Date());
  return link ? { show_to_builder: signInFirstLine(link) } : { show_to_builder: '', agent_note: 'There is no page to share yet.' };
}
