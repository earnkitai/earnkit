/**
 * The screen tool, for a program's reviewer: with applicants, queue a job; with job_id, progress and
 * results (public rows only); with job_id and outcomes, the program's decisions. Only a linked builder
 * the owner marked a reviewer of the program may call it; every refusal is one line and writes nothing.
 */
import { z } from 'zod';
import { inputDetail } from '../v5/tool-input';
import { FURTHER_PAYMENT_REFUSED, winCapOf } from '../v5/ledger';
import { getProgram } from '../v5/programs';
import { SHORT_LINK_NOTE } from '../v5/project-input';
import { LIMITS, hit } from '../v5/rate-limit';
import { listWords, signInLink } from './record-tool';
import { reviewerPrograms } from './reviewers';
import { badRequeues, createJob, jobResults, jobStatus, NOT_PASSED, type Outcome, PAGE_SIZE, OUTCOME_NOTES, OWN_APPLICATION, queuedAhead, recordOutcomes, REF_MAX, ScreenApplicant, type ScreenResults } from './screen-jobs';
import { SCREEN_BATCH } from './screen-worker';
import { DEFAULT_THRESHOLDS, RATIO_THRESHOLDS, TIERS, type Thresholds } from './tiers';

export const ScreenInput = z
  .object({
    program_id: z.string().max(100).optional().describe('The program you review; omit when you review one'),
    applicants: z.array(ScreenApplicant).optional().describe('The list to screen, each { ref (required), name, repo_url, live_url, contracts: [{ chain, address }], pitch, applied_at, application_id, requeue: { job_id, ref } of the earlier row it replaces }'),
    thresholds: z.record(z.string(), z.number()).optional().describe('Tier thresholds to override, by name'),
    job_id: z.string().max(40).optional().describe('A queued screen: its progress and results'),
    page: z.number().int().min(1).max(1000).optional().describe('With job_id: the page of results, 25 applicants each, from 1; next_page names the next, null on the last'),
    outcomes: z
      .array(
        z.object({
          ref: z.string().max(REF_MAX), outcome: z.enum(['won', 'rejected', 'shortlisted']), amount_usd: z.number().finite().optional(),
          // L15-15 (v6.1.14): an amount in any currency, cents allowed, as a number or text ("2,500.50", "2000 EUR").
          amount: z.union([z.number().finite(), z.string().trim().max(40)]).optional(),
          currency: z.string().trim().max(10).optional(),
          payment: z.object({ key: z.string().trim().min(1).max(80) }).strict().optional(),
        }).strict(),
      )
      .optional()
      .describe('With job_id: the decisions, by ref; a win\'s amount as amount_usd, or amount with a currency code (cents allowed; US dollars are rounded down to whole dollars for the builder\'s ledger, other currencies kept as given and not converted); a further payment of a win already posted: won with that amount and payment: { key }, a key of your own'),
  })
  .strict();
/** The most applicants or outcomes one call reads (C2, v6.1.13); 200 is read, 201 refused. */
export const SCREEN_MAX = 200;
export type ScreenReply = { show_to_builder: string; agent_note: string; job_id?: string; results?: ScreenResults; next_page?: number | null; recorded?: number };

export const SCREEN_TEXT = {
  unlinked: (link: string) => `Sign in once at ${link} so EarnKit knows which program you review for.`,
  unlinkedNoLink: 'Screening is for program reviewers.',
  notReviewer: 'Screening is for program reviewers, and you do not review that program.',
  noProgram: 'You review no program yet.',
  limit: 'You can queue ten screens a day.',
  whichProgram: 'Name the program you are screening for.',
  empty: 'Hand me at least one applicant.',
  noJob: "I don't have that screen.",
  expired: 'That screen has expired; queue the list again.',
  nothing: 'Give me an applicant list, or the screen you queued.',
  unread: "I could not read that. Send the applicant list, or a screen's id for its results.",
  /** C2 (v6.1.13): over SCREEN_MAX applicants or outcomes in one call. */
  overMax: 'At most 200 at a time; send the rest in another call.',
  queuedNote: 'Call screen with job_id for progress and results. Tell the builder what each tier means: used, live, building, unverified, flagged.',
  /** L15-13 (v6.1.14): the results promise when the whole list fits the next daily run. */
  promise: 'Results come in daily runs; the first by tomorrow morning.',
  /** L15-15 (v6.1.14): a win whose amount cannot be read, owner-shaped; only those applicants are not recorded. */
  amountFor: (refs: string) => `Tell me the amount for ${refs}.`,
  /** L16-14 (v6.1.16): a dot-thousands amount ("2.500"), shown once; the refs are in the agent note. */
  amountDot: 'Amount not read: use a dot only for cents, no thousands separator.',
  /** L15-16 (v6.1.14): a win over what the program pays; only those applicants are not recorded. */
  overCapFor: (refs: string) => `That is more than this program pays for ${refs}; check the amount.`,
  /** L15-10 (v6.1.14): a share threshold is a ratio, a count threshold a whole number. */
  ratio: 'That threshold is a share from 0 to 1, for example 0.2 for a fifth.',
  count: 'That threshold is a whole number, 0 or more.',
  sortNote: 'Sort: used, then live, then building; flagged last with the rule named.',
  pendingNote: 'Call screen with job_id again later for the rest.',
  stopNote: 'Show this line and stop.',
  /** L15-3 (v6.1.14): the last line of a page with more to come. */
  nextPage: (n: number) => `Ask for page ${n} for the rest.`,
  /** L16-12 (v6.1.16): a results page past the last. */
  noMore: 'No more results.',
  /** Fix round 1 (C1): an outcome a builder's ledger did not take; the refs are in the agent note. */
  builderStands: "Not passed on; the builder's record stands.",
  /** L16-16 (v6.1.16): every outcome of the call was already recorded. */
  nothingNew: 'Already recorded; nothing new.',
  /** Task 8 security follow-up (v6.1.14): a requeue that names no earlier row of the program with the same EarnKit id. */
  badRequeue: (refs: string) => `Not queued: the earlier row named for ${refs} is not in this program's screens with the same EarnKit id.`,
} as const;

const line = (show: string, agent_note: string = SCREEN_TEXT.stopNote): ScreenReply => ({ show_to_builder: show, agent_note });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "412 applicants: 31 used, 88 live, 190 building, 74 unverified, 29 flagged; 0 pending." Pure. */
export function totalsLine(r: ScreenResults): string {
  const unread = r.total - r.totals.pending - TIERS.reduce((s, t) => s + r.totals[t], 0);
  const tiers = TIERS.map((t) => `${r.totals[t]} ${t}`).join(', ');
  return `${plural(r.total, 'applicant')}: ${tiers}; ${r.totals.pending} pending${unread > 0 ? `; ${unread} could not be read` : ''}.`;
}

/**
 * Known threshold names only (v6.1.7 C39), each in its own range (L15-10, v6.1.14): a share from 0 to 1, a count or a
 * number of days a whole number from 0 up. The first that is not is the refusal: the line and the agent's note. Pure.
 */
function thresholdsOf(given: Record<string, number> | undefined): Partial<Thresholds> | { show: string; note: string } {
  if (!given) return {};
  for (const [k, v] of Object.entries(given)) {
    // FR-10 (final fix): the caller's key is echoed only as a plain name (letters, digits, underscores, hyphens), cut to 40.
    if (!Object.hasOwn(DEFAULT_THRESHOLDS, k))
      return { show: `Unknown threshold${/^[A-Za-z0-9_-]+$/.test(k) ? ` ${k.slice(0, 40)}` : ''}. Known: ${Object.keys(DEFAULT_THRESHOLDS).join(', ')}.`, note: SCREEN_TEXT.stopNote };
    const ratio = (RATIO_THRESHOLDS as readonly string[]).includes(k);
    if (ratio && !(v >= 0 && v <= 1)) return { show: SCREEN_TEXT.ratio, note: `Nothing was queued. ${k} is a share from 0 to 1 (${v} given; for 20% send 0.2).` };
    if (!ratio && !(Number.isInteger(v) && v >= 0)) return { show: SCREEN_TEXT.count, note: `Nothing was queued. ${k} is a whole number from 0 up (${v} given).` };
  }
  return given as Partial<Thresholds>;
}

/** ISO 4217-style code: three letters, upper case. */
const CODE = /^[A-Za-z]{3}$/;
const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };
/**
 * L15-15 (v6.1.14): a win's amount as the owner gave it: a number or text with cents, thousands commas, a symbol or a
 * three-letter code ("2,500.50", "$2,500.50", "2000 EUR"); `amount_usd` is US dollars. The amount and its upper-case
 * currency, null when no amount was given, 'ambiguous' for a dot used as a thousands separator ("2.500", L16-14,
 * v6.1.16), 'bad' when it cannot be read otherwise or is not above 0. Pure.
 */
export function amountOf(o: { amount_usd?: number; amount?: number | string; currency?: string }): { value: number; currency: string } | null | 'bad' | 'ambiguous' {
  if (o.amount_usd != null && o.amount != null) return 'bad';
  const given = o.currency?.trim().toUpperCase() || null;
  if (given && !CODE.test(given)) return 'bad';
  if (o.amount_usd != null) return given && given !== 'USD' ? 'bad' : o.amount_usd > 0 ? { value: o.amount_usd, currency: 'USD' } : 'bad';
  if (o.amount == null) return given ? 'bad' : null;
  let value: number;
  let code = given;
  if (typeof o.amount === 'number') value = o.amount;
  else {
    let t = o.amount.trim().toUpperCase();
    const sym = Object.keys(SYMBOLS).find((x) => t.startsWith(x));
    if (sym) {
      if (code && code !== SYMBOLS[sym]) return 'bad';
      code = SYMBOLS[sym];
      t = t.slice(sym.length).trim();
    }
    // M3 (fix round 1): "2.500" may be 2,500 written with a European separator: ambiguous, so refused.
    if (/^(?:[A-Z]{3}\s*)?\d{1,3}(?:\.\d{3})+(?:\s*[A-Z]{3})?$/.test(t)) return 'ambiguous';
    const m = /^(?:([A-Z]{3})\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*([A-Z]{3}))?$/.exec(t);
    if (!m || (m[1] && m[4])) return 'bad';
    const word = m[1] ?? m[4];
    if (word) {
      if (code && code !== word) return 'bad';
      code = word;
    }
    value = Number(`${m[2].replace(/,/g, '')}${m[3] ?? ''}`);
  }
  if (!(Number.isFinite(value) && value > 0)) return 'bad';
  return { value, currency: code ?? 'USD' };
}
const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
const given = (v: number, code: string) => `${v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} ${code}`;

/**
 * When the results come (v6.1.7 B14): the daily run reads SCREEN_BATCH applicants, oldest job first, so the job
 * is done in the next run when it fits after the queue ahead of it; else in as many daily runs as the two need. Pure.
 */
export function promiseLine(ahead: number, total: number): string {
  const days = Math.ceil((ahead + total) / SCREEN_BATCH);
  return days <= 1 ? SCREEN_TEXT.promise : `Results come in daily runs; ${plural(ahead, 'applicant')} ahead of yours, all within ${days} days.`;
}

/** The applicant fields ScreenApplicant reads; `repo` reads as repo_url when that is not given (T6). */
const KNOWN_FIELDS = new Set(Object.keys(ScreenApplicant.shape));
/**
 * L15-4 (v6.1.14): the applicant keys the list carried that the screen does not read, once each, in order. M4 (fix
 * round 1): only names of letters, digits, underscores and hyphens are echoed, each cut to 40 characters, at most 10;
 * any other key is left out, so no caller text reaches the agent note. Pure.
 */
export function ignoredFields(list: unknown[]): string[] {
  const out: string[] = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    for (const k of Object.keys(a)) {
      const read = KNOWN_FIELDS.has(k) || (k === 'repo' && !('repo_url' in a));
      if (read || !/^[A-Za-z0-9_-]+$/.test(k)) continue;
      const name = k.slice(0, 40);
      if (!out.includes(name)) out.push(name);
      if (out.length >= 10) return out;
    }
  }
  return out;
}

export async function screenTool(ctx: { installationId: number; builderId: number | null; now: Date }, raw: unknown): Promise<ScreenReply> {
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  // T6 (v6.1.14): an applicant's old `repo` key, as text, reads as `repo_url` when that is not given; any other `repo` is refused by its own key (F5).
  const r = raw as { applicants?: unknown } | null;
  const list: unknown[] = Array.isArray(r?.applicants) ? r.applicants : [];
  const badRepo = list.findIndex((a) => a && typeof a === 'object' && 'repo' in a && a.repo != null && typeof a.repo !== 'string' && !('repo_url' in a));
  if (badRepo >= 0) return line(SCREEN_TEXT.unread, `Nothing was queued. applicants.${badRepo}.repo: not text; send the repo link as text in repo_url.`);
  const aliased = list.length ? { ...r, applicants: list.map((a) => (a && typeof a === 'object' && 'repo' in a && typeof a.repo === 'string' && !('repo_url' in a) ? { ...a, repo_url: a.repo } : a)) } : raw;
  const parsed = ScreenInput.safeParse(aliased);
  // L13-5 (v6.1.14): the note says what was not written: outcomes are recorded, a list is queued.
  const nothing = r && typeof r === 'object' && 'outcomes' in r ? 'Nothing was recorded.' : 'Nothing was queued.';
  if (!parsed.success) return line(SCREEN_TEXT.unread, `${nothing} ${inputDetail(parsed.error)}`);
  const input = parsed.data;
  // C2 (v6.1.13): a list over SCREEN_MAX was read, it is only too long: one line, nothing written.
  if ((input.applicants?.length ?? 0) > SCREEN_MAX) return line(SCREEN_TEXT.overMax, 'Nothing was queued. Split the list and call screen once per part.');
  if ((input.outcomes?.length ?? 0) > SCREEN_MAX) return line(SCREEN_TEXT.overMax, 'Nothing was recorded. Split the outcomes and call screen once per part.');
  if (ctx.builderId === null) {
    // R7: the installation's sign-in link, as find and record give it; no link (not configured, or refused) keeps one plain line.
    const link = await signInLink(ctx.installationId, ctx.now);
    return line(link ? SCREEN_TEXT.unlinked(link) : SCREEN_TEXT.unlinkedNoLink);
  }
  const programs = await reviewerPrograms(ctx.builderId);

  if (input.job_id) {
    const s = await jobStatus(input.job_id, ctx.builderId, ctx.now);
    if (!s || !programs.includes(s.program_id)) return line(SCREEN_TEXT.noJob);
    if (s.expired) return line(SCREEN_TEXT.expired);
    if (input.outcomes) {
      // L15-15, L15-16 (v6.1.14): a win's amount is read per applicant (cents and a currency code allowed); one that
      // cannot be read, or a US dollar win over what the program pays, refuses only that applicant and names it, the
      // rest are recorded. US dollars go to the builder's ledger rounded down to whole dollars; another currency is
      // kept as given and reaches the ledger as a win with its amount not converted.
      const cap = winCapOf(await getProgram(s.program_id));
      const badAmount: string[] = [];
      const dotAmount: string[] = [];
      const overCapRefs: string[] = [];
      const rounded: string[] = [];
      const foreign: string[] = [];
      const take: Outcome[] = [];
      for (const o of input.outcomes) {
        const a = o.outcome === 'won' ? amountOf(o) : null;
        if (a === 'bad') {
          if (!badAmount.includes(o.ref)) badAmount.push(o.ref);
          continue;
        }
        if (a === 'ambiguous') {
          if (!dotAmount.includes(o.ref)) dotAmount.push(o.ref);
          continue;
        }
        const out: Outcome = { ref: o.ref, outcome: o.outcome, ...(o.payment && { payment: o.payment }) };
        if (a && a.currency === 'USD') {
          const whole = Math.floor(a.value);
          if (whole < 1) {
            if (!badAmount.includes(o.ref)) badAmount.push(o.ref);
            continue;
          }
          if (whole > cap) {
            if (!overCapRefs.includes(o.ref)) overCapRefs.push(o.ref);
            continue;
          }
          out.amount_usd = whole;
          if (whole !== a.value) {
            out.rounded = { from: a.value };
            rounded.push(`${o.ref} (${usd(a.value)} as ${usd(whole)})`);
          }
        } else if (a) {
          out.given = { amount: a.value, currency: a.currency };
          foreign.push(`${o.ref} (${given(a.value, a.currency)})`);
        }
        take.push(out);
      }
      const { recorded, notFound, notes, own, overCap, passed, reasons, notPassed, repeats, paymentRefused, stands } = await recordOutcomes(input.job_id, ctx.builderId, take, ctx.now);
      // L16-16 (v6.1.16): a call whose every outcome is a repeat says so alone.
      if (repeats.length > 0 && repeats.length === new Set(input.outcomes.map((o) => o.ref)).size)
        return { ...line(SCREEN_TEXT.nothingNew, OUTCOME_NOTES.repeats(repeats)), recorded: 0 };
      // The refs not in this screen are named (C19); L22-11 (v6.1.16): a recorded outcome that reached no builder's
      // ledger is named with why; L15-1 (v6.1.14): an outcome on the reviewer's own application is refused in one line.
      const counted = `Recorded ${plural(recorded, 'outcome')}${notPassed.length > 0 ? `; not passed to a builder: ${listWords(notPassed, 10)}` : ''}${notFound.length > 0 ? `; not found: ${listWords(notFound, 10)}` : ''}.`;
      // T8-F3 (v6.1.14): a further payment whose total is over the program's cap is named with the over-cap applicants.
      const over = [...overCapRefs, ...(overCap ?? []).filter((r) => !overCapRefs.includes(r))];
      const show = [
        counted, ...(own ? [OWN_APPLICATION] : []),
        ...(badAmount.length ? [SCREEN_TEXT.amountFor(listWords(badAmount, 10))] : []),
        ...(dotAmount.length ? [SCREEN_TEXT.amountDot] : []),
        ...(over.length ? [SCREEN_TEXT.overCapFor(listWords(over, 10))] : []),
        // L16-1 (v6.1.16): one sentence per kept result a further payment was refused over; the refs are in the agent note.
        ...[...new Set(paymentRefused.map((x) => x.status))].map(FURTHER_PAYMENT_REFUSED),
        // Fix round 1 (C1): a builder's ledger did not take it; no status, amount or reason reaches the reviewer.
        ...(stands ? [SCREEN_TEXT.builderStands] : []),
      ].join(' ');
      // L16-9, L22-10 (v6.1.16): the outcomes are recorded for the builder only when one reached a ledger.
      const missed = [
        ...reasons,
        ...[...badAmount, ...dotAmount].map((r) => `${r}: ${NOT_PASSED.badAmount}`),
        ...overCapRefs.map((r) => `${r}: ${NOT_PASSED.overCap}`),
      ];
      const note = passed > 0
        ? notFound.length > 0 ? 'Tell the builder the outcomes are recorded, and which refs this screen does not hold.' : 'Tell the builder the outcomes are recorded.'
        : missed.length > 0 ? `Nothing reached a builder: ${listWords(missed, 10)}.` : null;
      const amountNotes = [
        ...(badAmount.length ? [`Not recorded, the amount could not be read: ${listWords(badAmount, 10)}. Send amount_usd, or amount with a three-letter currency code, above 0.`] : []),
        ...(dotAmount.length ? [`Not recorded, a dot used as a thousands separator: ${listWords(dotAmount, 10)}. Send 2500 or 2,500; a dot is for cents only.`] : []),
        ...(overCapRefs.length ? [`Not recorded, over what this program pays: ${listWords(overCapRefs, 10)}.`] : []),
        ...(rounded.length ? [`Rounded down to whole dollars for the builder's ledger: ${listWords(rounded, 10)}.`] : []),
        ...(foreign.length ? [`Kept as given, not converted to US dollars: ${listWords(foreign, 10)}.`] : []),
      ];
      return { ...line(show, [...(note ? [note] : []), ...notes, ...amountNotes].join(' ')), recorded };
    }
    const results = await jobResults(input.job_id, ctx.builderId, ctx.now, input.page ?? 1);
    if (!results) return line(SCREEN_TEXT.expired);
    // L15-3 (v6.1.14): one page of 25; the last line asks for the next when there is one. L16-12 (v6.1.16): a page past
    // the last says so.
    const more = results.next_page !== null ? ` ${SCREEN_TEXT.nextPage(results.next_page)}`
      : results.page > 1 && results.applicants.length === 0 ? ` ${SCREEN_TEXT.noMore}` : '';
    // L21-27 (v6.1.16): with more than one page, a page that exists leads with where it is: "Page 2 of 3."
    const pages = Math.ceil(results.total / PAGE_SIZE);
    const at = pages > 1 && results.page <= pages ? `Page ${results.page} of ${pages}. ` : '';
    return {
      show_to_builder: `${at}${totalsLine(results)}${more}`,
      agent_note: [results.finished ? SCREEN_TEXT.sortNote : SCREEN_TEXT.pendingNote, ...(results.next_page !== null ? [`Call screen with job_id and page ${results.next_page} for the next 25.`] : [])].join(' '),
      job_id: results.job_id,
      results,
      next_page: results.next_page,
    };
  }

  // A builder who reviews no program and names none hears that in one line (v6.1.7 C18).
  if (!programs.length && !input.program_id) return line(SCREEN_TEXT.noProgram);
  if (!input.applicants) return line(programs.length ? SCREEN_TEXT.nothing : SCREEN_TEXT.notReviewer);
  const programId = input.program_id ?? (programs.length === 1 ? programs[0] : null);
  if (!programId) return line(programs.length ? SCREEN_TEXT.whichProgram : SCREEN_TEXT.notReviewer);
  if (!programs.includes(programId)) return line(SCREEN_TEXT.notReviewer);
  if (!input.applicants.length) return line(SCREEN_TEXT.empty);
  const thresholds = thresholdsOf(input.thresholds);
  if ('show' in thresholds && typeof thresholds.show === 'string') return line(thresholds.show, thresholds.note as string);
  const program = await getProgram(programId);
  if (!program) return line(SCREEN_TEXT.notReviewer);
  // Task 8 security follow-up (v6.1.14): a requeue must name an earlier row of this program carrying the same id.
  const bad = await badRequeues(programId, input.applicants);
  if (bad.length > 0) return line(SCREEN_TEXT.badRequeue(listWords(bad, 10)), 'Nothing was queued. Each requeue names { job_id, ref } of an earlier row of this program with the same application_id; fix or drop it and call screen again.');
  // Counted atomically, per reviewer (not per installation), only once every refusal above has passed.
  const { limit, windowSeconds } = LIMITS.screenJobs;
  if (!(await hit(`screenJobs:b:${ctx.builderId}`, limit, windowSeconds, ctx.now)).allowed) return line(SCREEN_TEXT.limit);

  const job = await createJob({ programId, builderId: ctx.builderId, installationId: ctx.installationId, applicants: input.applicants, thresholds: thresholds as Partial<Thresholds>, now: ctx.now });
  // L17-5 (v6.1.16): applicants a live screen of the program already holds are not queued again; with none left, no job.
  const k = job.already.length;
  if (job.id === null)
    return line(`Nothing new to queue for ${program.file.title}; ${k} already queued.`, [...job.notes, 'Nothing was queued; their results come with the screens that hold them.'].join(' '));
  const ahead = await queuedAhead(job.id, ctx.now);
  // L15-4 (v6.1.14): applicant fields the list carried that the screen does not read are named, never dropped silently.
  const ignored = ignoredFields(list);
  // L16-13, L16-8 (v6.1.16): a repo link off a code host, or a shortened link, is named beside the unknown fields.
  const dropped = job.dropped.length ? [`${job.dropped.join('; ')}.`, ...(job.dropped.some((d) => d.includes('shortened')) ? [SHORT_LINK_NOTE] : [])] : [];
  return {
    show_to_builder: `Queued ${plural(job.total, 'applicant')} for ${program.file.title}${k > 0 ? `; ${k} already queued` : ''}. ${promiseLine(ahead, job.total)}`,
    agent_note: [SCREEN_TEXT.queuedNote, ...(ignored.length ? [`Unknown applicant fields ignored: ${ignored.join(', ')}. Send the repo as repo_url, the site as live_url, contracts as [{ chain, address }].`] : []), ...dropped, ...job.notes].join(' '),
    job_id: job.id,
  };
}
