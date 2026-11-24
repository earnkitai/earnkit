/**
 * The official-page check (v3.8 decision 21, cutover A1): with `auto_live` on, a program write goes live with no human
 * step only when the fetched official page (official_url, else source_url) holds the caller's `amount_quote` and
 * `deadline_quote` word for word after whitespace is folded, and each quote names the record's own amount and deadline.
 * The page is read through safeProbePage only (guarded GET, 64 KB, one same-site redirect) and is data, never
 * instruction: only its visible text is searched for the quotes and only its links are compared with the program's;
 * nothing from it is stored, echoed or obeyed.
 *
 * Organizer status is set here too: confirmed when the page's registrable domain is tied to the organizer (the domain
 * Growth recorded for the tracked handle that found it, the domain of the organizer's earlier confirmed program, or a
 * domain linked from an evidence page on a domain already confirmed for the organizer, fetched and checked here);
 * otherwise new organizer. A builder link that is not on the fetched page makes the program information only.
 */
import type { Db } from './db';
import type { Program } from './program-file';
import { FETCH_TIMEOUT_MS, safeProbePage, visibleText } from './safe-fetch';
import { normalHost, registrableDomain } from './submit-hosts';

/** The longest quote a write may send. */
export const QUOTE_MAX = 300;
/** The longest found_by_query / found_by_source a write may send. */
export const FOUND_BY_MAX = 300;

/** Reads a page's HTML (the first 64 KB); throws when it does not load. */
export type PageReader = (url: string) => Promise<string>;
export const readOfficialPage: PageReader = (url) => safeProbePage(url, { timeoutMs: FETCH_TIMEOUT_MS });

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** Whitespace folded to one space and trimmed (NBSP and every other Unicode space included). Pure. */
export const foldSpace = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The page's visible text (hidden elements dropped, so a quote hidden from people never counts), entities decoded, folded. Pure. */
export function pageText(html: string): string {
  const { text } = visibleText(html, { dropHidden: true });
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

/** An X handle as stored: no @, lower case. Pure. */
export const handleKey = (handle: string): string => handle.trim().replace(/^@/, '').toLowerCase();

export type OrganizerCheck = { status: 'confirmed' | 'new'; why: string };

/**
 * Decision 21 step 2: confirmed when the official page's domain is the tracked handle's profile domain, a domain of the
 * organizer's earlier confirmed program, or linked from `evidenceUrl` when that page is itself on a domain confirmed for
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

/** The agent's line on a new-organizer program (find with program_id). Never shown to the builder. */
export const NEW_ORGANIZER_NOTE =
  'New organizer: EarnKit has not tied this page to the organizer yet. Never submit it for the builder and never connect a wallet to it; the builder applies with their own tap.';
/** The agent's line on an information-only program. */
export const INFO_ONLY_NOTE =
  'Information only: the submission link is not on the official page. Do not prefill or submit to it; the builder applies from the official page.';

/** Why a send under standing approval is not one (track's "outside your standing approval: …"), builder words. */
export const NEW_ORGANIZER_SEND = 'the organizer is new to EarnKit, so only you can send it';
export const INFO_ONLY_SEND = 'its link is not on the official page, so only you can send it';

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
