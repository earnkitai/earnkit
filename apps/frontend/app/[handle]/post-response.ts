import { CODE_PATTERN, draftByCode, tapDraft } from '../../lib/earnkit/post-drafts';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import { live } from './card-response';

/**
 * v3.1 one-tap posts (design 3, Task 4): the short link in the reply, earnkit.com/<handle>/post/<code> (or
 * /b/<handle>/post/<code> for a reserved handle). The page is checked live as the card is (hidden, unclaimed or unknown:
 * a no-store 404; another case or a renamed handle: a 308 to the page's own post link). The code must be this
 * person's: another builder's or an unknown one is a 404. An expired draft (14 days) goes to the page. Otherwise the tap
 * is counted (post-drafts.ts tapDraft: a number only) and the 302 opens X's composer with the draft's text and the page
 * link carrying ?m=<code> (the card of this post). The target is built from the stored row only, never the request.
 */
const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
const to = (location: string) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });

/** The X composer link for the draft: its text and the page link with ?m=<code>, each encoded. Pure. */
export function postIntent(handle: string, code: string, text: string): string {
  const page = new URL(`https://earnkit.com${pagePath(handle)}`);
  page.searchParams.set('m', code);
  const u = new URL('https://x.com/intent/post');
  u.searchParams.set('text', text);
  u.searchParams.set('url', page.toString());
  return u.toString();
}

export async function postResponse(handle: string, path: string, code: string, now: Date = new Date()): Promise<Response> {
  if (!CODE_PATTERN.test(code)) return notFound();
  const who = await live(handle, path, `post/${code}`);
  if (who instanceof Response) return who;
  const row = await draftByCode(code);
  if (!row || row.builder_id !== who.builderId) return notFound();
  if (row.expires_at.getTime() <= now.getTime()) return to(pagePath(who.handle));
  await tapDraft(code, who.builderId, now);
  return to(postIntent(who.handle, code, row.text));
}
