import { LARGE_PAGE_MAX_BYTES, safeFetchText, visibleText } from './safe-fetch';

/**
 * Proof ruling (security, 2026-10-23; last fix wave A): an outcome proof link must name the builder by something only
 * they control. A web page on one of the program's proof hosts is fetched (the guarded fetch, HTML allowed,
 * LARGE_PAGE_MAX_BYTES); an X post is read through X's public oEmbed endpoint (JSON) and its author must be one of the
 * program's X accounts. The page, or the post's own words, must carry the builder's verified X handle as "@handle" (or
 * an x.com/<handle> link; at least 3 characters, never a word of the program's title or one of its X accounts), their
 * verified site's host, or their public repo's URL (github.com/owner/repo). Never the project's name. Any fetch or
 * parse failure fails closed.
 */
export type ProofFetch = (url: string, kind: 'html' | 'json') => Promise<string>;
export const OEMBED_MAX_BYTES = 65_536;
export const defaultProofFetch: ProofFetch = (url, kind) =>
  safeFetchText(url, kind === 'json' ? { maxBytes: OEMBED_MAX_BYTES, accept: 'application/json' } : { maxBytes: LARGE_PAGE_MAX_BYTES, accept: 'text/html' });

export const X_HOSTS: ReadonlySet<string> = new Set(['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com', 'www.x.com', 'www.twitter.com']);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Who a proof must name: the builder's verified X handle, verified site origins and public repo key; what it may not be. */
export type ProofWho = { handle: string | null; sites: string[]; repo: string | null; programTitle: string; xHandles: string[] };

/**
 * Whether a proof names the builder (`text`: its visible words; `html`: its markup, for links). The handle counts as
 * "@handle" or an x.com/twitter.com link to it, only at 3 characters or more and never when it is a word of the
 * program's title or one of the program's X accounts; a verified site's host or the public repo's URL count anywhere
 * on the page. Pure.
 */
export function namesBuilder(text: string, html: string, who: ProofWho): boolean {
  const t = text.normalize('NFKC');
  const all = `${t} ${html}`;
  const h = who.handle?.replace(/^@/, '').trim() ?? '';
  const titleWords = new Set(who.programTitle.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  const usable = /^[A-Za-z0-9_]{3,15}$/.test(h) && !titleWords.has(h.toLowerCase()) && !who.xHandles.some((x) => x.toLowerCase() === h.toLowerCase());
  if (usable) {
    if (new RegExp(`(?<![A-Za-z0-9_@])@${esc(h)}(?![A-Za-z0-9_])`, 'i').test(t)) return true;
    if (new RegExp(`(?<![\\w.-])(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/${esc(h)}(?![A-Za-z0-9_])`, 'i').test(all)) return true;
  }
  for (const site of who.sites) {
    const host = URL.canParse(site) ? new URL(site).hostname.toLowerCase().replace(/^www\./, '') : '';
    if (host.includes('.') && new RegExp(`(?<![\\w.-])(?:www\\.)?${esc(host)}(?![\\w-]|\\.[a-z0-9])`, 'i').test(all)) return true;
  }
  if (who.repo && /^[\w.-]+\/[\w.-]+$/.test(who.repo) && new RegExp(`(?<![\\w.-])github\\.com/${esc(who.repo)}(?![\\w.-])`, 'i').test(all)) return true;
  return false;
}

/** The post's own words in an oEmbed blockquote (its first paragraph, never the "— Name (@handle)" attribution), as text and markup. Pure. */
function postParts(html: string): { text: string; html: string } {
  const p = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  return { text: visibleText(p).text.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"'), html: p };
}

/**
 * Whether the proof link (already passed proofUrlOk, query and fragment dropped) names the builder (namesBuilder).
 * Never throws: any failure is false.
 */
export async function proofNamesBuilder(proofUrl: string, who: ProofWho, fetch: ProofFetch = defaultProofFetch): Promise<boolean> {
  try {
    const u = new URL(proofUrl);
    if (X_HOSTS.has(u.hostname.toLowerCase())) {
      const raw = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(u.toString())}&omit_script=1`, 'json');
      const j = JSON.parse(raw) as { author_url?: unknown; html?: unknown };
      const author = typeof j.author_url === 'string' && URL.canParse(j.author_url) ? new URL(j.author_url) : null;
      if (!author || author.protocol !== 'https:' || !X_HOSTS.has(author.hostname.toLowerCase())) return false;
      const by = author.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
      if (!who.xHandles.some((x) => x.toLowerCase() === by)) return false;
      if (typeof j.html !== 'string') return false;
      const post = postParts(j.html);
      return namesBuilder(post.text, post.html, who);
    }
    const html = await fetch(u.toString(), 'html');
    const page = visibleText(html);
    return namesBuilder(`${page.title} ${page.text}`, html, who);
  } catch {
    return false;
  }
}
