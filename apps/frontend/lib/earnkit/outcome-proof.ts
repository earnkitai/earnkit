import { LARGE_PAGE_MAX_BYTES, safeFetchText, visibleText } from './safe-fetch';

/**
 * Proof ruling (security, 2026-10-23): an outcome proof link must name the builder. A web page on one of the program's
 * proof hosts is fetched (the guarded fetch, HTML allowed, LARGE_PAGE_MAX_BYTES) and must mention the builder's X
 * handle (with or without @) or the project's display name, case-insensitive and word-bounded. An X post is read through
 * X's public oEmbed endpoint (JSON): its author must be one of the program's X accounts and the post's own text must
 * mention the builder's handle or project name. Any fetch or parse failure fails closed.
 */
export type ProofFetch = (url: string, kind: 'html' | 'json') => Promise<string>;
export const OEMBED_MAX_BYTES = 65_536;
export const defaultProofFetch: ProofFetch = (url, kind) =>
  safeFetchText(url, kind === 'json' ? { maxBytes: OEMBED_MAX_BYTES, accept: 'application/json' } : { maxBytes: LARGE_PAGE_MAX_BYTES, accept: 'text/html' });

export const X_HOSTS: ReadonlySet<string> = new Set(['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com', 'www.x.com', 'www.twitter.com']);
/** The shortest project name a proof may be matched on (a two-letter name matches too much). */
const NAME_MIN = 3;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` names the builder: their X handle (with or without @) or the project's name, word-bounded. Pure. */
export function mentionsBuilder(text: string, who: { handle: string | null; name: string | null }): boolean {
  const t = text.normalize('NFKC');
  const handle = who.handle?.replace(/^@/, '').trim();
  if (handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) && new RegExp(`(?<![A-Za-z0-9_])@?${esc(handle)}(?![A-Za-z0-9_])`, 'i').test(t)) return true;
  const name = who.name?.replace(/\s+/g, ' ').trim();
  if (name && [...name].length >= NAME_MIN && new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, 'iu').test(t)) return true;
  return false;
}

/** The post's own words in an oEmbed blockquote (its first paragraph, never the "— Name (@handle)" attribution). Pure. */
function postText(html: string): string {
  const p = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  return visibleText(p).text.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
}

/**
 * Whether the proof link (already passed proofUrlOk) names the builder. `xHandles`: the program's own X accounts.
 * Never throws: any failure is false.
 */
export async function proofNamesBuilder(
  proofUrl: string, o: { xHandles: string[]; handle: string | null; name: string | null }, fetch: ProofFetch = defaultProofFetch,
): Promise<boolean> {
  try {
    const u = new URL(proofUrl);
    if (X_HOSTS.has(u.hostname.toLowerCase())) {
      const raw = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(u.toString())}&omit_script=1`, 'json');
      const j = JSON.parse(raw) as { author_url?: unknown; html?: unknown };
      const author = typeof j.author_url === 'string' && URL.canParse(j.author_url) ? new URL(j.author_url) : null;
      if (!author || author.protocol !== 'https:' || !X_HOSTS.has(author.hostname.toLowerCase())) return false;
      const by = author.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
      if (!o.xHandles.some((h) => h.toLowerCase() === by)) return false;
      return typeof j.html === 'string' && mentionsBuilder(postText(j.html), o);
    }
    const page = visibleText(await fetch(u.toString(), 'html'));
    return mentionsBuilder(`${page.title} ${page.text}`, o);
  } catch {
    return false;
  }
}
