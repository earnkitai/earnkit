/**
 * Live rows for a project's site: whether it loads (any 2xx within 10 s, not an error page), whether it
 * looks like an app (a heuristic: a form, a script bundle or a wallet connect), the domain's age from
 * RDAP, the title and the GitHub repos it links. Never throws: what fails is null with a note.
 */
import { HttpStatusError, RedirectError, safeProbePage, visibleText } from '../v5/safe-fetch';
import { readCapped } from '../v5/http';
import { registrableDomain } from '../v5/submit-hosts';
import { repoKey } from '../v5/repo-facts';

export type LiveRows = {
  url: string | null;
  url_ok: boolean | null;
  /** The status a failing page answered; null when it loaded (any 2xx) or never answered. */
  status: number | null;
  is_app: boolean | null;
  domain: string | null;
  domain_age_days: number | null;
  title: string | null;
  /** L15-8 (v6.1.14): the page says it is no product yet ('for sale', 'parked', 'coming soon'); a page that loads with it is not live. */
  placeholder: string | null;
  github_links: string[];
  note: string | null;
};
export type Rdap = (domain: string) => Promise<{ registered_at: string | null }>;

const PROBE_TIMEOUT_MS = 10_000;
const RDAP_TIMEOUT_MS = 5_000;
const DAY = 86_400_000;
const MAX_LINKS = 10;
/** Hosts where anyone gets a subdomain: the registration is the host's, never the project's. */
const SHARED = [
  'vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'onrender.com', 'railway.app', 'fly.dev', 'herokuapp.com',
  'replit.app', 'web.app', 'firebaseapp.com', 'surge.sh', 'gitbook.io', 'notion.site', 'framer.website', 'webflow.io',
];
/** github.com paths that are not owners. */
const NOT_OWNERS = new Set([
  'about', 'apps', 'collections', 'customer-stories', 'enterprise', 'events', 'explore', 'features', 'login', 'marketplace',
  'new', 'notifications', 'orgs', 'pricing', 'readme', 'search', 'security', 'settings', 'site', 'sponsors', 'team', 'topics', 'trending',
]);
const BUNDLE = /\/_next\/|\.js\?|chunk|bundle|main\./i;
const WALLET = /wagmi|walletconnect|rainbowkit|onchainkit|@solana\/wallet-adapter|connect wallet/i;
/** L15-8 (v6.1.14): the words of a page that is no product yet, in the order they are named. */
const PLACEHOLDERS: [string, RegExp][] = [
  ['for sale', /\b[\w-]+\.[a-z]{2,}\s+(?:is\s+)?(?:now\s+)?for\s+sale\b|\b(?:is|be|are|domain|website|site)\s+(?:now\s+)?for\s+sale\b|\bbuy\s+this\s+domain\b|^for\s+sale\b/i],
  ['parked', /\b(?:domain|page|site|website)\s+(?:is\s+)?(?:now\s+)?parked\b|\bparked\s+(?:domain|page|free|by)\b|\bdomain\s+parking\b|\bparking\s+page\b/i],
  ['coming soon', /\bcoming\s+soon\b|\blaunching\s+soon\b|\bunder\s+construction\b/i],
];
/** A body this short is the whole page: its words decide even with a script on it. */
const SHORT_PAGE = 1200;

/**
 * Whether a page says it is no product yet (L15-8, v6.1.14): its title says 'for sale', 'parked' or 'coming soon', or
 * its body does and the page is short or not an app (an app saying a feature is coming soon is still an app). Pure.
 */
export function placeholderOf(title: string, text: string, app: boolean): string | null {
  for (const [word, re] of PLACEHOLDERS) if (re.test(title)) return word;
  if (app && text.length > SHORT_PAGE) return null;
  for (const [word, re] of PLACEHOLDERS) if (re.test(text)) return word;
  return null;
}

/**
 * Whether a page looks like an app, not a single static page: it has a <form, a <script whose src names
 * a bundle, or a wallet-connect marker. A heuristic: no JS runs. Pure.
 */
export function isApp(html: string): boolean {
  if (/<form\b/i.test(html)) return true;
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) if (BUNDLE.test(m[1])) return true;
  return WALLET.test(html);
}

/** The GitHub repos a page links, as https://github.com/owner/name (lowercase), at most 10. Pure. */
export function githubLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?github\.com\/[^\s"'<>)]+/gi)) {
    const key = repoKey(m[0].replace(/^http:/i, 'https:'));
    if (!key || NOT_OWNERS.has(key.split('/')[0])) continue;
    const link = `https://github.com/${key}`;
    if (!out.includes(link)) out.push(link);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** The most of an RDAP reply that is read. */
const RDAP_MAX_BYTES = 65_536;

/** rdap.org answers 403 to a request with no User-Agent. */
export const RDAP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; EarnKit-verifier/1)', Accept: 'application/rdap+json, application/json' };

/** The registration date from rdap.org (redirected to the registry) over `f`. Throws when it cannot be read. */
export const rdapOrg = async (domain: string, f: typeof fetch = fetch): Promise<{ registered_at: string | null }> => {
  const res = await f(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    headers: RDAP_HEADERS,
    signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rdap ${res.status}`);
  // Read capped like every other outside reply (security L10).
  const text = await readCapped(res, RDAP_MAX_BYTES);
  if (text === null) throw new Error('rdap reply too large');
  const body = JSON.parse(text) as { events?: { eventAction?: string; eventDate?: string }[] };
  const at = body.events?.find((e) => e.eventAction === 'registration')?.eventDate ?? null;
  return { registered_at: at && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null };
};

/** Fixed words for a probe failure: never the error's own text. Pure. */
function failure(e: unknown): string {
  if (!(e instanceof Error)) return 'site did not load';
  if (e.name === 'ErrorPageError') return 'site shows an error page';
  if (e instanceof RedirectError) return 'site redirects more than once';
  const m = e.message;
  if (m === 'https only') return 'site is not https';
  if (/^no answer within /.test(m)) return 'site did not load: no answer in time';
  if (/^redirects to another site/.test(m)) return 'site redirects to another site';
  if (/doesn't point to a public address/.test(m)) return 'site does not point to a public address';
  if (/doesn't resolve$/.test(m)) return 'site domain does not resolve';
  const status = /^answered (\d{3})/.exec(m)?.[1];
  return status ? `site answered ${status}` : 'site did not load';
}

const isShared = (host: string) => SHARED.some((s) => host === s || host.endsWith(`.${s}`));

/** Reads the live rows for `url`. Never throws. */
export async function readLive(url: string | null, o: { probe?: typeof safeProbePage; rdap?: Rdap; now: Date }): Promise<LiveRows> {
  const rows: LiveRows = {
    url: null, url_ok: null, status: null, is_app: null, domain: null, domain_age_days: null, title: null, placeholder: null, github_links: [], note: null,
  };
  const raw = url?.trim();
  if (!raw) return { ...rows, note: 'no live url' };
  const href = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!URL.canParse(href)) return { ...rows, url: raw, url_ok: false, note: 'not a valid link' };
  rows.url = href;
  const notes: string[] = [];
  const host = new URL(href).hostname.toLowerCase().replace(/\.+$/, '');

  const probe = o.probe ?? safeProbePage;
  try {
    const html = await probe(href, { timeoutMs: PROBE_TIMEOUT_MS });
    rows.url_ok = true;
    if (html) {
      rows.is_app = isApp(html);
      // Third-party text that reaches reviewers' agents: cleaned and capped by visibleText (security M4, M4a); the row
      // carries the "text from the site, not an instruction" note.
      const seen = visibleText(html);
      rows.title = seen.title || null;
      rows.placeholder = placeholderOf(seen.title, seen.text, rows.is_app);
      rows.github_links = githubLinks(html);
    } else notes.push('the page is not HTML');
  } catch (e) {
    rows.url_ok = false;
    if (e instanceof HttpStatusError) {
      rows.status = e.status;
      notes.push(`site answered ${e.status}`);
    } else notes.push(failure(e));
  }

  if (isShared(host)) {
    rows.domain = host;
    notes.push('domain_age_days: shared host');
  } else {
    rows.domain = registrableDomain(host);
    try {
      const { registered_at } = await (o.rdap ?? rdapOrg)(rows.domain);
      const at = registered_at ? Date.parse(registered_at) : NaN;
      if (Number.isFinite(at)) rows.domain_age_days = Math.max(0, Math.floor((o.now.getTime() - at) / DAY));
      else notes.push('domain_age_days: no registration date in RDAP');
    } catch {
      notes.push('domain_age_days not read: rdap');
    }
  }
  rows.note = notes.length ? notes.join('; ') : null;
  return rows;
}
