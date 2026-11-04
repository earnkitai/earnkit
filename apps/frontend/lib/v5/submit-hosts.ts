/**
 * Hosts, for the programs write API's link rules: a host's registrable domain and site, the submit
 * platforms a program may send builders to off its own site, the shared hosts where anyone can
 * publish, and whether a submission link is on a curated program's site (linkChecksOut). Pure.
 */

/** Hosts where anyone can publish a page, so a page there never belongs to one program. */
const SHARED_HOSTS = [
  'github.io', 'github.com', 'dorahacks.io', 'questbook.app', 'forms.gle', 'docs.google.com', 'vercel.app', 'netlify.app', 'notion.site',
  'notion.so', 'medium.com', 'mirror.xyz', 'paragraph.xyz', 'substack.com', 'gitbook.io', 'pages.dev', 'x.com', 'twitter.com',
] as const;

/** Public suffixes of more than one label. */
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.in', 'co.kr',
  'com.br', 'com.cn', 'com.sg', 'com.mx', 'com.tr', 'co.za', 'com.hk', 'com.tw', 'co.il', 'com.ar', 'co.id', 'com.my', 'com.ph',
]);

/** A hostname as host checks compare it: lowercase, trailing dots stripped ("Base.ORG." is base.org). */
export const normalHost = (host: string): string => host.toLowerCase().replace(/\.+$/, '');

/** A host's registrable domain: its last two labels, or three under a MULTI_SUFFIXES suffix ("co.uk"). */
export function registrableDomain(host: string): string {
  const labels = normalHost(host).split('.');
  const two = labels.slice(-2).join('.');
  return MULTI_SUFFIXES.has(two) ? labels.slice(-3).join('.') : two;
}

/** The submit and form platforms a program may send builders to on another domain than its source (subdomains count). */
export const API_SUBMIT_HOSTS = [
  'docs.google.com', 'forms.gle', 'typeform.com', 'tally.so', 'airtable.com', 'dorahacks.io', 'questbook.app', 'devfolio.co',
  'ethglobal.com', 'hackquest.io', 'buidlbox.io', 'gitcoin.co', 'superteam.fun', 'karmahq.xyz', 'taikai.network', 'akindo.io',
] as const;

/** Domains where anyone can have a site, so sharing the registrable domain never ties two links together. */
const API_SHARED_SITES = [
  ...SHARED_HOSTS,
  'herokuapp.com', 'google.com', 'web.app', 'firebaseapp.com', 'webflow.io', 'framer.website', 'framer.app', 'onrender.com',
  'fly.dev', 'replit.app', 'repl.co', 'wixsite.com', 'carrd.co', 'blogspot.com', 'hashnode.dev', 'azurewebsites.net',
  'amazonaws.com', 'cloudfront.net', 'glitch.me', 'surge.sh', 'wordpress.com', 'gitlab.io', 'workers.dev', 'deno.dev',
  'railway.app', 'myshopify.com', 'bubbleapps.io', 'translate.goog', 'eth.limo', 'dweb.link', 'mypinata.cloud',
] as const;

/** Of those, the hosts where one host name serves many owners by path (github.com/<owner>). */
const API_PATH_OWNED = [
  'github.com', 'x.com', 'twitter.com', 'medium.com', 'notion.so', 'google.com', 'forms.gle', 'dorahacks.io', 'mirror.xyz',
  'paragraph.xyz',
] as const;

const under = (host: string, list: readonly string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
const onSharedSite = (host: string) => under(normalHost(host), API_SHARED_SITES);
const onPathOwned = (host: string) => under(host, API_PATH_OWNED);

/**
 * Whether a program may send builders to `host` (with `path` when the link has one): the source's
 * registrable domain (on a shared site, the exact host only, never a path-owned one), or an
 * API_SUBMIT_HOSTS platform (docs.google.com only under /forms).
 */
export function apiSubmitHostAllowed(host: string, sourceHost: string, path?: string): boolean {
  const h = normalHost(host);
  const s = normalHost(sourceHost);
  if (registrableDomain(h) === registrableDomain(s)) {
    if (!onSharedSite(registrableDomain(h))) return true;
    if (h === s && !onPathOwned(h)) return true;
  }
  const platform = API_SUBMIT_HOSTS.find((p) => h === p || h.endsWith(`.${p}`));
  if (!platform) return false;
  if (platform === 'docs.google.com' && path !== undefined) return path === '/forms' || path.startsWith('/forms/');
  return true;
}

/** How a problem names the source's site: its exact host on a shared site, else its registrable domain. */
export const sourceSiteName = (sourceHost: string): string =>
  onSharedSite(registrableDomain(sourceHost)) ? normalHost(sourceHost) : registrableDomain(sourceHost);

/** Display names for the platforms a builder knows by name; any other host is named by its domain. */
const PLATFORM_NAMES: Record<string, string> = {
  'forms.gle': 'Google Forms', 'docs.google.com': 'Google Docs', 'google.com': 'Google', 'typeform.com': 'Typeform',
  'tally.so': 'Tally', 'questbook.app': 'Questbook', 'airtable.com': 'Airtable', 'dorahacks.io': 'DoraHacks',
  'devfolio.co': 'Devfolio', 'hackquest.io': 'HackQuest', 'ethglobal.com': 'ETHGlobal', 'buidlbox.io': 'Buidlbox',
  'gitcoin.co': 'Gitcoin', 'superteam.fun': 'Superteam', 'karmahq.xyz': 'Karma GAP',
};

/**
 * Every submit, form, hosting and shared host: a link there never checks out on its own, an anchor
 * there never counts, and an official_url there is refused. Subdomains count.
 */
const LINK_PLATFORMS: readonly string[] = [
  ...new Set<string>([...API_SUBMIT_HOSTS, ...API_SHARED_SITES, 'colosseum.com', 'arena.colosseum.org', 'hackathon.monad.xyz']),
];

/** The platform a host is on, by name (else its platform domain), or null. */
export const linkPlatformName = (host: string): string | null => {
  const h = normalHost(host);
  const hit = LINK_PLATFORMS.filter((d) => h === d || h.endsWith(`.${d}`)).sort((a, b) => b.length - a.length)[0];
  if (!hit) return null;
  return PLATFORM_NAMES[hit] ?? PLATFORM_NAMES[registrableDomain(hit)] ?? hit;
};

/**
 * A two-label "<co|com|org|...>.<2 letters>" domain is treated as a country suffix the list lacks
 * ("co.ke"), so only the exact host matches there.
 */
const looksLikeSuffix = (domain: string) => /^(co|com|org|net|gov|edu|ac|or|ne|go)\.[a-z]{2}$/.test(domain);

/**
 * Whether `host` is on the same site as `site`: the same registrable domain (docs.base.org and
 * base.org; never base.org.evil.com), but on a shared site or a suffix-looking domain only the
 * exact host, and never a host whose owners differ by path.
 */
export function sameSite(host: string, site: string): boolean {
  const h = normalHost(host);
  const s = normalHost(site);
  const domain = registrableDomain(h);
  if (domain !== registrableDomain(s) || !domain.includes('.')) return false;
  if (!onSharedSite(domain) && !looksLikeSuffix(domain) && !MULTI_SUFFIXES.has(domain)) return true;
  return h === s && !onPathOwned(h);
}

/** Whether a host checks out: never on a platform, else on the same site as one of `anchors` (platform anchors never count). */
export const linkChecksOut = (host: string, anchors: readonly string[]): boolean =>
  linkPlatformName(host) === null && anchors.some((a) => linkPlatformName(a) === null && sameSite(host, a));
