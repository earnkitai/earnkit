/**
 * Live rows for a project's site: whether it loads (any 2xx within 10 s, not an error page), whether it
 * looks like an app (a heuristic: a form, a script bundle or a wallet connect), the domain's age from
 * RDAP, the title and the GitHub repos it links. Never throws: what fails is null with a note.
 */
import { HttpStatusError, safeProbePage, visibleText } from '../v5/safe-fetch';
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

/** The registration date from rdap.org (redirected to the registry). Throws when it cannot be read. */
export const rdapOrg: Rdap = async (domain) => {
  const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    headers: { Accept: 'application/rdap+json, application/json' },
    signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rdap ${res.status}`);
  const body = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
  const at = body.events?.find((e) => e.eventAction === 'registration')?.eventDate ?? null;
  return { registered_at: at && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null };
};

const isShared = (host: string) => SHARED.some((s) => host === s || host.endsWith(`.${s}`));

/** Reads the live rows for `url`. Never throws. */
export async function readLive(url: string | null, o: { probe?: typeof safeProbePage; rdap?: Rdap; now: Date }): Promise<LiveRows> {
  const rows: LiveRows = {
    url: null, url_ok: null, status: null, is_app: null, domain: null, domain_age_days: null, title: null, github_links: [], note: null,
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
      rows.title = visibleText(html).title || null;
      rows.github_links = githubLinks(html);
    } else notes.push('the page is not HTML');
  } catch (e) {
    rows.url_ok = false;
    if (e instanceof HttpStatusError) {
      rows.status = e.status;
      notes.push(`site answered ${e.status}`);
    } else if (e instanceof Error && e.name === 'ErrorPageError') notes.push('site shows an error page');
    else notes.push(`site did not load: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
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
