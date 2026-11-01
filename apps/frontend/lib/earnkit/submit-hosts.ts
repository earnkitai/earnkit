/**
 * v2.8 Part E (spec), Rulings 27-28 (plan): the submit platforms by host. The same for every program
 * on a host. Pure, no imports, so the program file schema (program-file.ts) and the kit
 * (submit-kit.ts) share it without a cycle.
 */

export type SubmitMode = 'prefilled_link' | 'agent_fills' | 'copy_paste' | 'api';

/**
 * Ruling 27 (plan). DoraHacks and Questbook (any `*.questbook.app`, see `baseModeOf`) are copy_paste
 * because their terms ban automated use; that changes only if the platform approves in writing.
 */
export const HOST_MODES: Record<string, SubmitMode> = {
  'docs.google.com': 'prefilled_link',
  'forms.gle': 'prefilled_link',
  'airtable.com': 'prefilled_link',
  'tally.so': 'prefilled_link',
  'ethglobal.com': 'agent_fills',
  'devfolio.co': 'agent_fills',
  'colosseum.com': 'agent_fills',
  'arena.colosseum.org': 'agent_fills',
  'hackathon.monad.xyz': 'agent_fills',
  'app.akindo.io': 'agent_fills',
  'taikai.network': 'agent_fills',
  'dorahacks.io': 'copy_paste',
  'superteam.fun': 'api',
  'earn.superteam.fun': 'api',
  'gap.karmahq.xyz': 'api',
};

/** Ruling 28 (plan): hosts that give each entry a public page, so the proof is its link. */
export const ENTRY_LINK_HOSTS: string[] = [
  'dorahacks.io',
  'ethglobal.com',
  'devfolio.co',
  'colosseum.com',
  'arena.colosseum.org',
  'app.akindo.io',
  'taikai.network',
  'gap.karmahq.xyz',
];

/** Hosts whose terms ban an agent filling the form: never agent_fills, whatever a file says. */
export const NO_AGENT_HOSTS = ['dorahacks.io'];
export const isNoAgentHost = (host: string) => NO_AGENT_HOSTS.includes(host) || host === 'questbook.app' || host.endsWith('.questbook.app');

/** A URL's host, lowercased, without `www.`; '' when it doesn't parse. Pure. */
export function urlHost(url: string): string {
  return URL.canParse(url) ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : '';
}

/** The registry's mode for a host, before the per-program overrides; unknown hosts are copy_paste. Pure. */
export function baseModeOf(host: string): SubmitMode {
  if (isNoAgentHost(host)) return 'copy_paste';
  return HOST_MODES[host] ?? 'copy_paste';
}

/** Which prefill format a host's form uses, or null. Pure. */
export function prefillKindOf(host: string): 'google' | 'airtable' | 'tally' | null {
  if (host === 'docs.google.com' || host === 'forms.gle') return 'google';
  if (host === 'airtable.com') return 'airtable';
  if (host === 'tally.so') return 'tally';
  return null;
}

/** The agent-API platform on a host, for the builder's line and the kit's `api.platform`. */
export function apiPlatformOf(host: string): { platform: 'superteam' | 'karma'; name: string } | null {
  if (host === 'superteam.fun' || host === 'earn.superteam.fun') return { platform: 'superteam', name: 'Superteam Earn' };
  if (host === 'gap.karmahq.xyz') return { platform: 'karma', name: 'Karma GAP' };
  return null;
}

/**
 * Fix round (owner ruling 3, security): hosts where anyone can publish a page, so a page there never proves an outcome,
 * even when the program is listed there (a hackathon on DoraHacks, a grant on Questbook).
 */
export const SHARED_HOSTS = [
  'github.io', 'github.com', 'dorahacks.io', 'questbook.app', 'forms.gle', 'docs.google.com', 'vercel.app', 'netlify.app', 'notion.site',
  'notion.so', 'medium.com', 'mirror.xyz', 'paragraph.xyz', 'substack.com', 'gitbook.io', 'pages.dev', 'x.com', 'twitter.com',
] as const;
/** Public suffixes of more than one label (a proof host must have a name of its own under them). */
export const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.in', 'co.kr',
  'com.br', 'com.cn', 'com.sg', 'com.mx', 'com.tr', 'co.za', 'com.hk', 'com.tw', 'co.il', 'com.ar', 'co.id', 'com.my', 'com.ph',
]);
/**
 * Final review 1: whether `host` may be a program's proof host: not a public suffix, not earnkit.com, and not a shared
 * host or a subdomain of one (anyone can publish a page there). Pure.
 */
export const proofHostAllowed = (raw: string) => {
  const host = normalHost(raw);
  return !MULTI_SUFFIXES.has(host) && ![...SHARED_HOSTS, 'earnkit.com'].some((h) => host === h || host.endsWith(`.${h}`));
};

/**
 * v4.9 Task 2 fix (security review): a hostname as host checks compare it: lowercase, trailing dots stripped, so
 * "Optimism.IO." can't pass as another host. Pure.
 */
export const normalHost = (host: string) => host.toLowerCase().replace(/\.+$/, '');

/**
 * v4.9 Task 2 fix 1 (security review): a host's registrable domain: its last two labels, or three when the last two are
 * a known public suffix of more than one label (MULTI_SUFFIXES, "co.uk"). Normalized first. Pure.
 */
export function registrableDomain(host: string): string {
  const labels = normalHost(host).split('.');
  const two = labels.slice(-2).join('.');
  return MULTI_SUFFIXES.has(two) ? labels.slice(-3).join('.') : two;
}

/**
 * v4.9 Task 2 fix 1: the submit platforms an API program may send builders to on another domain than its source
 * (subdomains count). docs.google.com only under /forms.
 */
export const API_SUBMIT_HOSTS = [
  'docs.google.com', 'forms.gle', 'typeform.com', 'tally.so', 'dorahacks.io', 'questbook.app', 'devfolio.co', 'ethglobal.com',
  'hackquest.io',
] as const;

/**
 * Whether an API program may submit at `host` (with `path` when the link has one): the source's registrable domain, or
 * an API_SUBMIT_HOSTS platform (docs.google.com only under /forms; a bare host has no path to check). Pure.
 */
export function apiSubmitHostAllowed(host: string, sourceHost: string, path?: string): boolean {
  const h = normalHost(host);
  const s = normalHost(sourceHost);
  // Fix round 2: a shared domain (anyone's site under it) counts only for the exact host, and never for a host whose
  // owners differ by path (github.com/org vs github.com/attacker).
  if (registrableDomain(h) === registrableDomain(s)) {
    if (!onSharedSite(registrableDomain(h))) return true;
    if (h === s && !onPathOwned(h)) return true;
  }
  const platform = API_SUBMIT_HOSTS.find((p) => h === p || h.endsWith(`.${p}`));
  if (!platform) return false;
  if (platform === 'docs.google.com' && path !== undefined) return path === '/forms' || path.startsWith('/forms/');
  return true;
}

/**
 * v4.9 Task 2 fix round 2: domains where anyone can have a site, so sharing the registrable domain never ties a
 * submission to the program's source: SHARED_HOSTS plus the hosting platforms (subdomains count).
 */
export const API_SHARED_SITES = [
  ...SHARED_HOSTS,
  'github.io', 'github.com', 'vercel.app', 'pages.dev', 'netlify.app', 'herokuapp.com', 'notion.site', 'notion.so',
  'medium.com', 'x.com', 'twitter.com', 'substack.com', 'google.com',
] as const;
/** Of those, the hosts where one host name serves many owners by path (github.com/<owner>, sites.google.com/<site>). */
export const API_PATH_OWNED = [
  'github.com', 'x.com', 'twitter.com', 'medium.com', 'notion.so', 'google.com', 'forms.gle', 'dorahacks.io', 'mirror.xyz',
  'paragraph.xyz',
] as const;
const under = (host: string, list: readonly string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
/** Whether `host` (normalized) is on or under a shared site. Pure. */
export const onSharedSite = (host: string) => under(normalHost(host), API_SHARED_SITES);
const onPathOwned = (host: string) => under(host, API_PATH_OWNED);

/** How a submission problem names the source's site: its exact host on a shared site, else its registrable domain. Pure. */
export const sourceSiteName = (sourceHost: string) =>
  onSharedSite(registrableDomain(sourceHost)) ? normalHost(sourceHost) : registrableDomain(sourceHost);
