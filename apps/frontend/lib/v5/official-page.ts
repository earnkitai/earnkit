/**
 * The official-page check (v3.8 decision 21, cutover A1): with `auto_live` on, a program write goes live with no human
 * step only when the fetched official page (official_url, else source_url) holds the caller's `amount_quote` and
 * `deadline_quote` word for word after whitespace is folded, and each quote names the record's own amount and deadline.
 * The page is read through safeReadPage only (guarded GET, the whole page up to 4 MB, one same-site redirect, a second
 * try as a browser-like EarnKit-verifier on a bot wall) and is data, never instruction: only its text is searched for
 * the quotes and only its links are compared with the program's; nothing from it is stored, echoed or obeyed.
 *
 * v3.8 G-A: a page that shows almost no text without JavaScript, or a 5xx error shell, is also searched in the data it
 * embeds (__NEXT_DATA__, JSON-LD, React Server Component text) and in its platform's public source (PLATFORM_SOURCES:
 * Binance's announcement API, ETHGlobal's prizes page). A page still behind a bot wall is `blocked` (programs-api.ts
 * decides). Form-shortener links (forms.gle) are expanded to the form they land on.
 *
 * Organizer status is set here too: confirmed when the page's registrable domain is tied to the organizer (the domain
 * Growth recorded for the tracked handle that found it, the domain of the organizer's earlier confirmed program, or a
 * domain linked from an evidence page on a domain already confirmed for the organizer, fetched and checked here);
 * otherwise new organizer. A builder link that is not on the fetched page makes the program information only.
 *
 * v3.8 G-A (item 9): a domain tied later re-marks the live programs already labelled new organizer on it
 * (remarkOrganizer): a recorded handle ties its profile domain, a confirmed write ties its domain to its organizer.
 */
import type { Db } from './db';
import { ProgramFile, type Program } from './program-file';
import { upsertProgram } from './programs';
import { FETCH_TIMEOUT_MS, LANDING_MAX_REDIRECTS, PageBlockedError, PageShellError, redirectTarget, safeReadPage, visibleText } from './safe-fetch';
import type { OffSiteLink } from './api-text';
import { linkPlatformName, normalHost, registrableDomain, shortLinkLands } from './submit-hosts';

/** The longest quote a write may send. */
export const QUOTE_MAX = 300;
/** The longest found_by_query / found_by_source a write may send. */
export const FOUND_BY_MAX = 300;

/**
 * Reads a page (its HTML, or the raw text when `json`); throws when it does not load: PageBlockedError behind a bot
 * wall, PageShellError on a 5xx (with what it sent).
 */
export type PageReader = (url: string, opts?: { json?: boolean }) => Promise<string>;
export const readOfficialPage: PageReader = (url, opts) => safeReadPage(url, opts?.json ? { accept: 'application/json' } : {});

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** Whitespace folded to one space and trimmed (NBSP and every other Unicode space included). Pure. */
export const foldSpace = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The page's visible text (hidden elements dropped, so a quote hidden from people never counts), entities decoded, folded. Pure. */
export function pageText(html: string): string {
  const { text } = visibleText(html, { dropHidden: true, joinInline: true });
  return foldSpace(
    text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }),
  );
}

/** Every https link on the page, absolute, without its fragment. Pure. */
export function pageLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&').trim();
    if (!URL.canParse(raw, base)) continue;
    const u = new URL(raw, base);
    if (u.protocol !== 'https:') continue;
    u.hash = '';
    out.push(u.href);
  }
  return out;
}

/** A URL compared as the same link: host normalized (no www), no fragment, no trailing slash. Pure. */
function sameLink(a: string, b: string): boolean {
  if (!URL.canParse(a) || !URL.canParse(b)) return false;
  const key = (s: string) => {
    const u = new URL(s);
    return `${normalHost(u.hostname)}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  };
  return key(a) === key(b);
}

/** The page the check reads. Pure. */
export const officialPageOf = (p: Pick<Program, 'official_url' | 'source_url'>): string => p.official_url ?? p.source_url;

/** The amounts a quote states, in dollars: "$50,000", "50k", "$1.5M", "USD 2,000", "10 thousand". Pure. */
export function quoteAmounts(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|mm|million|thousand|bn|billion)?\b/gi)) {
    const n = Number(m[1]!.replace(/,/g, ''));
    const unit = (m[2] ?? '').toLowerCase();
    const times = unit === 'k' || unit === 'thousand' ? 1e3 : unit === 'm' || unit === 'mm' || unit === 'million' ? 1e6 : unit === 'bn' || unit === 'billion' ? 1e9 : 1;
    if (Number.isFinite(n)) out.push(Math.round(n * times));
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Words that say a program has no deadline. */
const ROLLING = /\b(rolling|ongoing|no deadline|until (?:funds|the pool)|any ?time|continuous(?:ly)?|year-round|open until)\b/i;

/**
 * Whether a deadline quote names `endsAt`'s day: its ISO date, or its month (name or three-letter abbreviation) and day
 * number, the day before or after allowed (a deadline in a zone west or east of UTC). A rolling program's quote must
 * say it is rolling. Pure.
 */
export function quoteNamesDeadline(quote: string, endsAt: string | null): boolean {
  if (endsAt === null) return ROLLING.test(quote);
  const t = Date.parse(endsAt);
  if (!Number.isFinite(t)) return false;
  const lower = quote.toLowerCase();
  return [-1, 0, 1].some((shift) => {
    const d = new Date(t + shift * 86_400_000);
    if (quote.includes(d.toISOString().slice(0, 10))) return true;
    const month = MONTHS[d.getUTCMonth()]!;
    const day = d.getUTCDate();
    const hasMonth = new RegExp(`\\b(${month}|${month.slice(0, 3)})\\b\\.?`).test(lower);
    const hasDay = new RegExp(`(^|[^\\d])0?${day}(st|nd|rd|th)?([^\\d]|$)`).test(lower);
    return hasMonth && hasDay;
  });
}

export type Quotes = { amount_quote: string; deadline_quote: string };

/**
 * Why the quotes fail against the page text and the record, or [] when both pass: each quote is on the page verbatim
 * after whitespace folding (case kept), the amount quote states one of the record's amounts (pool_usd, max_award_usd,
 * min_award_usd), and the deadline quote names ends_at's day (or says rolling). Pure.
 */
export function quoteProblems(p: Pick<Program, 'pool_usd' | 'max_award_usd' | 'min_award_usd' | 'ends_at'>, q: Quotes, text: string): string[] {
  const problems: string[] = [];
  const amount = foldSpace(q.amount_quote);
  const deadline = foldSpace(q.deadline_quote);
  if (!text.includes(amount)) problems.push('amount_quote: not on the official page word for word');
  else {
    const want = [p.pool_usd, p.max_award_usd, p.min_award_usd].filter((n): n is number => n !== undefined);
    if (want.length > 0 && !quoteAmounts(amount).some((n) => want.includes(n)))
      problems.push(`amount_quote: does not state the program's amount (${want.map((n) => `$${n.toLocaleString('en-US')}`).join(' or ')})`);
  }
  if (!text.includes(deadline)) problems.push('deadline_quote: not on the official page word for word');
  else if (!quoteNamesDeadline(deadline, p.ends_at))
    problems.push(p.ends_at ? `deadline_quote: does not name the deadline (${p.ends_at.slice(0, 10)})` : 'deadline_quote: ends_at is null, so the quote must say the program is rolling');
  return problems;
}

/** The builder links (submission_url, form.url) that are not on the fetched page: the page itself counts as on it. Pure. */
export function linksOffPage(p: Pick<Program, 'submission_url' | 'form'>, pageUrl: string, links: string[]): string[] {
  const builder = [p.submission_url, ...(p.form?.url ? [p.form.url] : [])];
  return builder.filter((u) => !sameLink(u, pageUrl) && !links.some((l) => sameLink(l, u)));
}

/**
 * v3.8 G-A (item 6): of the builder links off the source's site and the platform list (`offSiteLinks`), the refusals
 * for those the official page does not vouch for: the page must link that exact URL (`sameLink`), and the page must be
 * on the organizer's own site, not a submit, hosting or shared platform where other people's text and links appear
 * (`linkPlatformName`). A linked one is allowed and, being on the page, is not information only either. Pure.
 */
export function offSiteUnlinked(off: OffSiteLink[], pageUrl: string, links: string[]): string[] {
  const platform = linkPlatformName(new URL(pageUrl).hostname);
  return off
    .filter((l) => platform !== null || !links.some((x) => sameLink(x, l.url)))
    .map((l) => (platform !== null ? `${l.problem}; the official page is on ${platform}, so its links do not vouch for it` : `${l.problem}, and the official page does not link it`));
}

/** A page with scripts whose visible text is shorter than this is thin: drawn by JavaScript, so its embedded data is searched too. */
export const THIN_TEXT = 1_000;

/** A React Server Component reference ("$L29", "$Sreact.fragment", "$@1", "$1"), not text; "$5,000" is text. */
const RSC_REFERENCE = /^\$(?:[A-Za-z@]|\d+$)/;

/** Every string in a JSON value, depth first. */
function jsonStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) jsonStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) jsonStrings(x, out);
}

/**
 * v3.8 G-A: the text a client-rendered page carries as data: the strings of its __NEXT_DATA__ and JSON-LD scripts and of
 * its React Server Component payload (`self.__next_f.push([1, "…"])`, what a Next.js app sends even in a 500 error
 * shell), tags removed, whitespace folded. Read only when the visible page is thin or a 5xx shell. Pure.
 */
export function embeddedText(html: string): string {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bid\s*=\s*["']?__NEXT_DATA__\b|\btype\s*=\s*["']?application\/ld\+json\b/i.test(m[1]!)) continue;
    try {
      jsonStrings(JSON.parse(m[2]!), out);
    } catch {
      // Not JSON: nothing read from it.
    }
  }
  let rsc = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      rsc += JSON.parse(m[1]!) as string;
    } catch {
      // A cut chunk: skipped.
    }
  }
  for (const m of rsc.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      // Not a string literal.
    }
  }
  return foldSpace(out.filter((x) => !RSC_REFERENCE.test(x) && /[\p{L}\p{N}]/u.test(x)).map((x) => x.replace(/<[^>]*>/g, ' ')).join(' '));
}

/** A platform's public source for a page that its wall or its JavaScript hides: the URL to read, and its text and links. */
type PlatformSource = {
  name: string;
  /** The source to read for official page `u`, or null when this platform does not cover it. */
  at: (u: URL) => string | null;
  json?: boolean;
  /** The source's text (folded) and links; throws when it is not the expected shape. */
  read: (body: string, at: string) => { text: string; links: string[] };
};

/** The text and links of a Binance CMS article (the API answers `{ data: { title, body } }`, body a JSON node tree). */
function binanceArticle(body: string): { text: string; links: string[] } {
  const data = (JSON.parse(body) as { data?: { title?: unknown; body?: unknown } }).data;
  if (!data || typeof data.title !== 'string' || typeof data.body !== 'string') throw new Error('not a Binance article');
  const texts: string[] = [data.title];
  const links: string[] = [];
  const walk = (n: { text?: unknown; attr?: { href?: unknown }; child?: unknown }) => {
    if (typeof n.text === 'string') texts.push(n.text);
    if (typeof n.attr?.href === 'string' && URL.canParse(n.attr.href) && n.attr.href.startsWith('https://')) links.push(n.attr.href);
    if (Array.isArray(n.child)) for (const c of n.child) if (c && typeof c === 'object') walk(c);
  };
  walk(JSON.parse(data.body) as object);
  return { text: foldSpace(texts.join(' ')), links };
}

/**
 * v3.8 G-A: platforms whose official pages a reader cannot read but whose public source says the same, read through the
 * same guarded reader. Add a platform with one row.
 */
export const PLATFORM_SOURCES: readonly PlatformSource[] = [
  {
    // An announcement page is behind an AWS WAF challenge (202); the public CMS API serves the same article.
    name: "Binance's announcement API",
    at: (u) => {
      const code = registrableDomain(u.hostname) === 'binance.com' ? u.pathname.match(/\/support\/announcement\/detail\/([0-9a-f]{32})\/?$/)?.[1] : undefined;
      return code ? `https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode=${code}` : null;
    },
    json: true,
    read: binanceArticle,
  },
  {
    // An event page can answer 500 with a Next error shell; its prizes page is server-rendered.
    name: "ETHGlobal's prizes page",
    at: (u) => {
      const slug = normalHost(u.hostname) === 'ethglobal.com' ? u.pathname.match(/^\/events\/([a-z0-9-]+)\/?$/)?.[1] : undefined;
      return slug ? `https://ethglobal.com/events/${slug}/prizes` : null;
    },
    read: (html, at) => ({ text: pageText(html), links: pageLinks(html, at) }),
  },
];

/**
 * What the official page says, as the check reads it (v3.8 G-A). `page`: its text (visible text; for a thin page or a
 * 5xx shell also its embedded data and its platform's public source) and links; `thin` names why the page itself said
 * little (a 5xx shell, or no text without JavaScript), null for a normal page. `blocked`: a bot wall stayed and no
 * platform source covers the page.
 */
export type OfficialRead =
  | { kind: 'page'; text: string; links: string[]; thin: string | null }
  | { kind: 'blocked'; status: number; wall: string };

/**
 * Reads the official page for the check. Throws (as `read` does) when the page does not load for any other reason than
 * a bot wall or a 5xx shell.
 */
export async function readOfficial(url: string, read: PageReader): Promise<OfficialRead> {
  let html = '';
  let thin: string | null = null;
  let blocked: PageBlockedError | null = null;
  try {
    html = await read(url);
  } catch (err) {
    if (err instanceof PageBlockedError) blocked = err;
    else if (err instanceof PageShellError) {
      html = err.html;
      thin = `answered ${err.status} with an error shell`;
    } else throw err;
  }
  const visible = pageText(html);
  const links = pageLinks(html, url);
  // A short page with no script is simply short; only one drawn by JavaScript (or a shell, or a wall) is searched further.
  if (!blocked && !thin && (visible.length >= THIN_TEXT || !/<script\b/i.test(html))) return { kind: 'page', text: visible, links, thin: null };
  thin ??= blocked ? `blocked our reader (${blocked.wall})` : 'shows almost no text without JavaScript';
  const parts = [visible, embeddedText(html)];
  const source = PLATFORM_SOURCES.map((s) => ({ s, at: s.at(new URL(url)) })).find((x) => x.at !== null);
  let sourced = false;
  if (source) {
    try {
      const got = source.s.read(await read(source.at!, { json: source.s.json }), source.at!);
      parts.push(got.text);
      links.push(...got.links);
      sourced = got.text.length > 0;
    } catch {
      // The platform's source did not load either: the page is judged on what it showed.
    }
  }
  if (blocked && !sourced) return { kind: 'blocked', status: blocked.status, wall: blocked.wall ?? `answered ${blocked.status}` };
  return { kind: 'page', text: foldSpace(parts.join(' ')), links, thin };
}

/** Reads one redirect: the absolute Location a link answers with (default redirectTarget, a guarded GET). */
export type RedirectReader = (url: string) => Promise<string>;
export const readRedirect: RedirectReader = (url) => redirectTarget(url, { timeoutMs: FETCH_TIMEOUT_MS });

/**
 * v3.8 G-A: a form-shortener link (forms.gle, submit-hosts SHORT_LINKS) as the form it lands on: its redirects followed
 * one guarded GET at a time (at most LANDING_MAX_REDIRECTS, the landing page itself never requested) while they stay on
 * the shortener, and accepted only when the landing is that shortener's form host (docs.google.com/forms/…); its
 * `usp` tracking parameter is dropped. Any other link comes back unchanged. Throws when the link does not land on a
 * form.
 */
export async function expandShortLink(url: string, next: RedirectReader): Promise<string> {
  if (!URL.canParse(url)) return url;
  const short = normalHost(new URL(url).hostname);
  if (shortLinkLands(short, new URL(url)) === null) return url;
  let at = url;
  for (let hop = 0; hop < LANDING_MAX_REDIRECTS && normalHost(new URL(at).hostname) === short; hop++) at = await next(at);
  const landed = new URL(at);
  if (shortLinkLands(short, landed) !== true) throw new Error(`${short} link does not lead to a form (it goes to ${normalHost(landed.hostname)})`);
  landed.searchParams.delete('usp');
  landed.hash = '';
  return landed.href;
}

export const domainOf = (url: string | undefined | null): string | null =>
  url && URL.canParse(url) ? registrableDomain(new URL(url).hostname) : null;

/** An organizer name as compared across programs: case and spacing folded. Pure. */
export const organizerKey = (name: string): string => foldSpace(name).toLowerCase();

/** The domains already confirmed for this organizer: its earlier confirmed programs' official pages, and its tracked handle's. */
async function confirmedDomains(db: Db, p: Pick<Program, 'id' | 'organizer'>, handle: string | null): Promise<Set<string>> {
  const rows = await db<{ official_url: string | null; source_url: string | null }[]>`
    SELECT file->>'official_url' AS official_url, file->>'source_url' AS source_url FROM programs
    WHERE id <> ${p.id} AND file IS NOT NULL AND lower(regexp_replace(btrim(file->>'organizer'), '\\s+', ' ', 'g')) = ${organizerKey(p.organizer)}
      AND NOT (file ? 'new_organizer')`;
  const out = new Set(rows.map((r) => domainOf(r.official_url ?? r.source_url)).filter((d): d is string => d !== null));
  if (handle) {
    const [h] = await db<{ profile_domain: string }[]>`SELECT profile_domain FROM tracked_handles WHERE handle = ${handleKey(handle)}`;
    if (h) out.add(registrableDomain(h.profile_domain));
  }
  return out;
}

/**
 * v3.8 G-A (item 9): whether a registrable domain can tie an organizer by itself: never a submit, hosting or shared
 * platform (github.io, devpost.com, dorahacks.io...), where anyone can publish. Pure.
 */
export const ownableDomain = (domain: string): boolean => domain.includes('.') && linkPlatformName(domain) === null;

/** v3.8 G-A (item 9): a tracked handle whose profile domain is `domain` (registrable), or null. */
async function handleOnDomain(db: Db, domain: string): Promise<string | null> {
  const rows = await db<{ handle: string; profile_domain: string }[]>`
    SELECT handle, profile_domain FROM tracked_handles WHERE profile_domain = ${domain} OR profile_domain LIKE ${`%.${domain}`} ORDER BY handle`;
  return rows.find((r) => registrableDomain(r.profile_domain) === domain)?.handle ?? null;
}

/** An X handle as stored: no @, lower case. Pure. */
export const handleKey = (handle: string): string => handle.trim().replace(/^@/, '').toLowerCase();

export type OrganizerCheck = { status: 'confirmed' | 'new'; why: string };

/**
 * Decision 21 step 2: confirmed when the official page's domain is the tracked handle's profile domain (v3.8 G-A item 9:
 * any tracked handle's, on a domain that is not a shared platform, so a program re-marked by remarkOrganizer stays
 * confirmed when it is written again), a domain of the organizer's earlier confirmed program, or linked from `evidenceUrl` when that page is itself on a domain confirmed for
 * the organizer (fetched here; Growth's word alone clears nothing); new organizer otherwise. The fourth rule (a host
 * platform page the tracked handle's own post links to) needs the post read from X and is not checked: such a page
 * stays new organizer. Never throws for a bad evidence page; it just does not confirm.
 */
export async function organizerStatus(
  db: Db,
  p: Pick<Program, 'id' | 'organizer' | 'official_url' | 'source_url'>,
  o: { handle: string | null; evidenceUrl: string | null; read: PageReader },
): Promise<OrganizerCheck> {
  const page = domainOf(officialPageOf(p));
  if (!page) return { status: 'new', why: 'the official page has no domain' };
  const known = await confirmedDomains(db, p, o.handle);
  if (known.has(page)) return { status: 'confirmed', why: `${page} is already tied to ${p.organizer}` };
  const tracked = ownableDomain(page) ? await handleOnDomain(db, page) : null;
  if (tracked) return { status: 'confirmed', why: `${page} is the profile domain of tracked @${tracked}` };
  const evidence = domainOf(o.evidenceUrl);
  if (o.evidenceUrl && evidence && known.has(evidence)) {
    try {
      const html = await o.read(o.evidenceUrl);
      if (pageLinks(html, o.evidenceUrl).some((l) => domainOf(l) === page))
        return { status: 'confirmed', why: `${evidence}, tied to ${p.organizer}, links to ${page}` };
    } catch {
      // An evidence page that does not load confirms nothing.
    }
  }
  return { status: 'new', why: `${page} is not yet tied to ${p.organizer}` };
}

/**
 * v3.8 G-A (item 9): drops `new_organizer` from the listed API programs labelled with it whose official page
 * (official_url, else source_url) is on registrable `domain`, now tied: by a recorded handle (every such program), or,
 * with `organizer`, by a confirmed write of that organizer (its programs only, compared as organizerKey). Never on a
 * shared platform domain (ownableDomain). Only the label changes: `submit` stays as the check left it (a new organizer's
 * write was stored as `submit: 'builder'` and the writer's own value was not kept, so the builder still sends it with
 * their own tap until the program is written again) and `info_only` is never touched. Each re-mark is upserted (no
 * program_changes row: the label is not a builder-facing field) and audited as an `organizer` / `confirmed` write with
 * `why`, which the owner digest lists. In the caller's transaction. Returns the ids re-marked, in id order.
 */
export async function remarkOrganizer(
  tx: Db,
  o: { domain: string; organizer?: string; why: string; now: Date; skip?: string },
): Promise<string[]> {
  const domain = registrableDomain(o.domain);
  if (!ownableDomain(domain)) return [];
  const rows = await tx<{ id: string; file: unknown }[]>`
    SELECT id, file FROM programs
    WHERE source = 'api' AND status IN ('active', 'upcoming') AND file ? 'new_organizer' AND id <> ${o.skip ?? ''}
    ORDER BY id FOR UPDATE`;
  const out: string[] = [];
  for (const r of rows) {
    const f = ProgramFile.safeParse(r.file);
    if (!f.success || domainOf(officialPageOf(f.data)) !== domain) continue;
    if (o.organizer !== undefined && organizerKey(f.data.organizer) !== organizerKey(o.organizer)) continue;
    const { new_organizer: _n, ...rest } = f.data;
    const next = ProgramFile.parse(rest);
    await upsertProgram(next, 'api', o.now, tx);
    await tx`INSERT INTO program_writes (program_id, action, result, reason, body)
      VALUES (${r.id}, 'organizer', 'confirmed', ${o.why}, ${tx.json(JSON.parse(JSON.stringify(next)))})`;
    out.push(r.id);
  }
  return out;
}

/** The agent's line on a new-organizer program (find with program_id). Never shown to the builder. */
export const NEW_ORGANIZER_NOTE =
  'New organizer: EarnKit has not tied this page to the organizer yet. Never submit it for the builder and never connect a wallet to it; the builder applies with their own tap.';
/** The agent's line on an information-only program. */
export const INFO_ONLY_NOTE =
  'Information only: EarnKit could not confirm the submission link on the official page (it is not there, or the page blocked EarnKit\'s reader). Do not prefill or submit to it; the builder applies from the official page.';

/** Why a send under standing approval is not one (track's "outside your standing approval: …"), builder words. */
export const NEW_ORGANIZER_SEND = 'the organizer is new to EarnKit, so only you can send it';
export const INFO_ONLY_SEND = "I couldn't confirm its link on the official page, so only you can send it";

/** Whether EarnKit may let an agent submit for the builder or connect a wallet: never for a new organizer or an information-only program. Pure. */
export const agentMayAct = (p: Pick<Program, 'new_organizer' | 'info_only'>): boolean => !p.new_organizer && !p.info_only;

/**
 * The record as it goes live: the check's labels set, and for a new organizer or an information-only program `submit:
 * builder` (the builder sends it with their own tap, so no agent send and no standing-approval send); information only
 * also drops `form` (no prefill to a link the page does not show). Pure.
 */
export function labelled(p: Program, o: { newOrganizer: boolean; infoOnly: boolean }): Program {
  const { new_organizer: _n, info_only: _i, ...rest } = p;
  const out: Program = { ...rest, ...(o.newOrganizer ? { new_organizer: true as const } : {}), ...(o.infoOnly ? { info_only: true as const } : {}) };
  if (o.newOrganizer || o.infoOnly) out.submit = 'builder';
  if (o.infoOnly) delete out.form;
  return out;
}
