/**
 * The record tool: on a linked installation, get the builder's record, set facts into it (merged
 * by the agent, never approved) or get the brief behind one answer kind; unlinked, the sign-in link.
 * Only the linked installation's calls read the record. Approval happens on /me only.
 */
import { z } from 'zod';
import { looksSecret, MAX_ARG_DEPTH } from '../v5/secrets';
import { inputDetail, inputError, refuse } from '../v5/tool-input';
import { nextNeedsOf, type NextNeed } from '../v5/installations';
import { recordValue } from '../v5/prefill';
import { ANSWER_KINDS, type AnswerKind } from '../v5/program-file';
import { getProgram, listOpenPrograms } from '../v5/programs';
import { answerBrief } from './answer-brief';
import { LinkRefused, readStoredRecord, takeUnlinkedNotice, unlinkedReason, withRecord } from './builders';
import { oauthConfigured } from './github-auth';
import { createLinkCode } from './link-routes';
import { DELETED_NOTICE, listWords } from './reply-words';

export { listWords };
import { APPROVABLE, type Answer, type BuilderRecord, EMPTY, KIND_WORDS, allowedKey, heldWords, isApproved, mergeRecord, recordItems } from './record';
import { cleanText, quoteName } from '../v5/controls';
import { ME_VALUE_WORDS } from '../v5/site-copy';

export const RecordInput = z
  .object({
    set: z.unknown().optional().describe('A partial record to merge: person, team, company, docs, traction, answers, and projects as a list of { id (a lowercase slug), name, repo_url, live_url, answers }, merged by id'),
    // L26-2 (v6.1.16 Task 12): true reads the summary (facts, and each answer kind's length and start); a kind reads that kind in full.
    // L45-19 (v6.1.19): a get that is neither names what it takes.
    get: z.union([z.boolean(), z.enum(ANSWER_KINDS)], { error: `true, or one answer kind: ${ANSWER_KINDS.join(', ')}` }).optional().describe('true for the record\'s facts and each answer kind\'s length and start; an answer kind for that kind\'s answers in full'),
    brief: z.enum(ANSWER_KINDS).optional().describe('One answer kind: the question, the facts to use, the length and the style'),
    // Fix round 1 (I2): one kind's answers come in whole answers, a page at a time.
    page: z.number().int().min(1).max(100).optional().describe('With get and an answer kind: the page of that kind\'s answers, from 1'),
  })
  .strict();

const text = (what?: string) => (what ? z.string().describe(what) : z.string());
const AnswerText = z.object({ text: z.string() });
const AnswersSet = z.object(Object.fromEntries(ANSWER_KINDS.map((k) => [k, AnswerText.optional()]))).describe('Answers keyed by kind, each { text }');
/**
 * L29-24 (v6.1.16 Task 15): `set` as agents see it, typed (person, team, company, traction, docs, answers, projects);
 * `policy` is not in it: standing approval is set on earnkit.com/me only. The record's own merge still reads the value
 * (RecordInput keeps it open), naming any part it refuses.
 */
const RecordSet = z.object({
  person: z.object({
    name: text(), email: text(), x: text('X handle'), linkedin: text(), location: text(), timezone: text('An IANA time zone'), phone: text(), bio: text(),
    technical: z.boolean(), based_country: text('Two capital letters, like US'),
  }).partial(),
  team: z.array(z.object({ name: z.string(), role: z.string().optional(), github: z.string().optional(), x: z.string().optional(), email: z.string().optional() })),
  company: z.object({
    name: text(), incorporated: z.boolean(), jurisdiction: text(), raised_usd: z.number().describe('dollars as a number (5000 or 1234.56)'), raised_from: text(),
    stage: z.enum(['idea', 'building', 'pre_launch', 'launched']), launch_date: text('YYYY-MM-DD'),
  }).partial(),
  traction: z.object({ line_pre_launch: text(), waitlist: z.number().int(), revenue_usd_claim: z.number(), notes: text() }).partial(),
  docs: z.object({ resume_url: text(), deck_url: text(), founder_video_url: text(), demo_video_url: text() }).partial(),
  answers: AnswersSet,
  projects: z.array(z.object({
    id: text('A lowercase slug; projects merge by id'), name: text(), one_liner: text(), description: text(), repo_url: text(), live_url: text(), demo_url: text(),
    chains_claimed: z.array(z.string()), answers: AnswersSet,
  }).partial().required({ id: true })),
}).partial();
/** The record tool's schema as agents see it (registered leniently from this; RecordInput reads the call). */
export const RecordAdvertised = RecordInput.extend({
  set: RecordSet.optional().describe('A partial record to merge. Standing approval (policy) is set on earnkit.com/me only, never here.'),
});

export type RecordReply = {
  show_to_builder: string;
  refused?: true;
  agent_note: string;
  linked: boolean;
  sign_in?: string;
  /** L26-2 (v6.1.16 Task 12): `get` with no kind: the facts, and per answer kind its length and first 120 characters. */
  summary?: RecordSummary;
  /** L26-2: `get` with a kind: that kind's answers in full, the record's first, then each project's. */
  answers?: KindAnswer[];
  /** Fix round 1 (I2): the page of the kind's answers and how many there are. */
  page?: number;
  pages?: number;
  missing?: string[];
  problems?: string[];
  brief?: ReturnType<typeof answerBrief>;
};

/** The facts of a record: everything but the answers (and the answers' approval rows). */
export type RecordFacts = Omit<BuilderRecord, 'answers' | 'projects'> & { projects: Omit<BuilderRecord['projects'][number], 'answers'>[] };
export type RecordSummary = { facts: RecordFacts; answers: { kind: string; length: number; start: string; approved: boolean }[] };
export type KindAnswer = { kind: string; project: string | null; text: string; short: string | null; approved: boolean };

/** L26-2: the cap on every record reply, serialized (v6.1.16 Task 12). */
export const RECORD_REPLY_CAP = 20_480;
/** L26-2: the agent line when a record reply was cut to its cap. */
export const RECORD_CUT_NOTE = 'Ask for one kind at a time for the rest.';

const answerPath = (path: string) => /^answers\.[a-z_]+$/.test(path) || /^projects\.[^.]+\.answers\.[a-z_]+$/.test(path);

/** Every saved answer of the record: its kind, its project (null for the record's own) and its path. Pure. */
function answersOf(record: BuilderRecord): { kind: AnswerKind; project: string | null; path: string; answer: Answer }[] {
  const out: { kind: AnswerKind; project: string | null; path: string; answer: Answer }[] = [];
  for (const k of ANSWER_KINDS) {
    const a = record.answers[k];
    if (a) out.push({ kind: k, project: null, path: `answers.${k}`, answer: a });
    for (const p of record.projects) {
      const b = p.answers[k];
      if (b) out.push({ kind: k, project: p.id, path: `projects.${p.id}.answers.${k}`, answer: b });
    }
  }
  return out;
}

/**
 * L26-2 (v6.1.16 Task 12): the record's summary: its facts (the answers' approval rows left out), and one line per
 * answer kind: the record's own answer, else the first project's, as its length in characters (code points, L35-15) and first
 * 120 characters. Pure.
 */
export function recordSummary(record: BuilderRecord): RecordSummary {
  const { answers: _a, projects, meta, ...rest } = record;
  const facts: RecordFacts = {
    ...rest,
    projects: projects.map(({ answers: _p, ...p }) => p),
    meta: Object.fromEntries(Object.entries(meta).filter(([path]) => !answerPath(path))),
  };
  const all = answersOf(record);
  const answers = ANSWER_KINDS.flatMap((k) => {
    const a = all.find((x) => x.kind === k);
    return a ? [{ kind: k, length: Array.from(a.answer.text).length, start: cleanText(a.answer.text, 120), approved: isApproved(record, a.path) }] : [];
  });
  return { facts, answers };
}

/** L26-2: one kind's answers in full, the record's own first. Pure. */
export const kindAnswers = (record: BuilderRecord, kind: AnswerKind): KindAnswer[] =>
  answersOf(record).filter((a) => a.kind === kind).map((a) => ({ kind, project: a.project, text: a.answer.text, short: a.answer.short ?? null, approved: isApproved(record, a.path) }));

/** Answers saved with no approval yet (L26-7). Pure. */
export const waitingAnswers = (record: BuilderRecord): number => answersOf(record).filter((a) => !isApproved(record, a.path)).length;

/** L26-7: `{n} answers wait for your approval.`; null at none. Pure. */
export const waitingLine = (n: number): string | null => (n === 0 ? null : n === 1 ? '1 answer waits for your approval.' : `${n} answers wait for your approval.`);
/** L38-15 (v6.1.18): what the next application needs (at most two named) and the one action. Pure. */
export const nextNeedsLine = (missing: string[]): string =>
  // L46-6 (v6.1.20): two named, never "and 5 more"; the rest are asked after these, one at a time.
  `The next application needs ${listWords(missing.slice(0, 2), 2)}${missing.length > 2 ? ' first' : ''}. Tell me ${missing.length === 1 ? 'it and I save it' : 'them and I save them'}.`;

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/**
 * L26-2 (v6.1.16 Task 12): a record reply under `cap` bytes serialized. Over it, the longest texts (past the builder and
 * agent lines) are cut to their first 120 characters, the longest first and, among equals, the last first, until it
 * fits; then the agent note gains RECORD_CUT_NOTE. Pure.
 */
export function recordReplyCap<T extends { agent_note: string }>(reply: T, cap = RECORD_REPLY_CAP): T {
  if (bytes(reply) <= cap) return reply;
  const out = structuredClone(reply) as T & Record<string, unknown>;
  const target = cap - Buffer.byteLength(` ${RECORD_CUT_NOTE}`);
  const leaves: { at: Record<string, unknown> | unknown[]; key: string | number; len: number; order: number }[] = [];
  const walk = (v: unknown, top: boolean) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (top && (k === 'show_to_builder' || k === 'agent_note')) continue;
      if (typeof x === 'string' && x.length > 120) leaves.push({ at: v as Record<string, unknown>, key: Array.isArray(v) ? Number(k) : k, len: Buffer.byteLength(x), order: leaves.length });
      else walk(x, false);
    }
  };
  walk(out, true);
  leaves.sort((a, b) => b.len - a.len || b.order - a.order);
  let size = bytes(out);
  for (const l of leaves) {
    if (size <= target) break;
    const at = l.at as Record<string | number, string>;
    const before = Buffer.byteLength(JSON.stringify(at[l.key]));
    at[l.key] = cleanText(at[l.key], 120);
    size -= before - Buffer.byteLength(JSON.stringify(at[l.key]));
  }
  out.agent_note = [out.agent_note, RECORD_CUT_NOTE].filter(Boolean).join(' ');
  return out;
}

const SIGN_IN_NOTE = 'Show the link once. Ask for a personal fact only when the next form needs it; nothing is saved until the builder has signed in. Call record with get afterwards.';
/** L29-20 (v6.1.16 Task 15): an unlinked record get. */
export const REMEMBER_YOU = 'Sign in once and I remember you.';
/** L29-20: an unlinked record get with its link (the record is what signing in keeps). Pure. */
const rememberYouAt = (link: string): string => `Sign in once at ${link} and I remember you.`;
/** L29-20: an unlinked policy set. */
export const NO_STANDING_HERE = 'There is no standing approval on this agent.';
/** L29-4 (v6.1.16 Task 15): a linked policy set, with no missing list. L35-14 (v6.1.17): by the approval's state: on, how
 *  to turn it off and hold one; off, where to turn it on. Pure. */
export const STANDING_YOURS = (on: boolean): string =>
  on ? 'Standing approval is yours to turn off at earnkit.com/me. Until then say stop for a program and I hold it.' : 'Standing approval is yours to turn on at earnkit.com/me.';
/** Fix round 1 (N2, v6.1.17): a policy set that saved other facts while standing approval is off. */
export const POLICY_OFF_SAVED_NOTE = 'Saved; standing approval is set on earnkit.com/me only.';
/** L35-16 (v6.1.17): the input errors of a record call whose read arguments do not go together. */
export const PAGE_WITHOUT_KIND = 'page: only with get and an answer kind';
export const GET_AND_BRIEF = 'get, brief: one of get or brief per call';
/** L35-16 (v6.1.17): the agent line for a page past the last of a kind's answers. */
export const PAGES_OF = (n: number, kind: string): string => `There ${n === 1 ? 'is 1 page' : `are ${n} pages`} of ${kind}.`;
/** L29-5: what stop is. */
export const STOP_HELD_NOTE = 'On stop, call track with status held for each program named.';
const NOT_READY = "I can't save that yet, so I keep it for this chat.";
const APPROVAL_NOTE = 'Approved answers come from earnkit.com/me, where the builder reads and approves each one; an unapproved answer is never used in a form.';
const BROKEN = 'Your record could not be read; nothing was saved.';
const BROKEN_NOTE = 'Tell the builder to open earnkit.com/me; the owner can inspect the stored row.';
const BRIEF_NOTE = 'Draft the answer from the brief and save it with record set; the builder approves it on earnkit.com/me before any form uses it.';
/** The kind's saved answer has a text but no short form (the builder rewrote it on /me, v6.1.8 B17): redraft the short. Pure. */
const shortNote = (kind: AnswerKind, record: BuilderRecord): string | null =>
  [record.answers[kind], ...record.projects.map((p) => p.answers[kind])].some((a) => a && !a.short)
    ? `This answer has no short form: draft one of at most 280 characters from its text and save it as the answer's short with record set (answers.${kind}.short); the builder approves text and short together on earnkit.com/me.`
    : null;

const origin = () => (process.env.EARNKIT_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');


/** The installation's sign-in link; null when sign-in is not configured, the installation is linked, or anything fails (a reply never fails for the link). */
export async function signInLink(installationId: number, now: Date): Promise<string | null> {
  if (!oauthConfigured()) return null;
  try {
    return `${origin()}/link/${await createLinkCode(installationId, now)}`;
  } catch (err) {
    if (!(err instanceof LinkRefused)) console.error('[link] sign-in link failed', err instanceof Error ? err.name : typeof err);
    return null;
  }
}

/** Unlinked: the sign-in link; a set says plainly that nothing was saved and to tell it again after signing in (R8). */
async function unlinked(installationId: number, now: Date, setting: boolean, policy: boolean): Promise<RecordReply> {
  // The account this agent was linked to was deleted (v6.1.8 C51): said first, once, by whichever call comes next.
  const deleted = (await unlinkedReason(installationId)) === 'deleted' && (await takeUnlinkedNotice(installationId));
  const lead = (show: string) => (deleted ? `${DELETED_NOTICE} ${show}` : show);
  // L29-20 (v6.1.16 Task 15): a policy set has nothing to turn off here, said plainly; a refusal (L29-9).
  if (policy) return refuse({ show_to_builder: lead(NO_STANDING_HERE), agent_note: `Nothing was saved. ${STOP_HELD_NOTE}`, linked: false });
  const link = await signInLink(installationId, now);
  // L29-20: a get says what signing in does, with the link when there is one; a set saved nothing (a refusal).
  if (!setting) return { show_to_builder: lead(link ? rememberYouAt(link) : REMEMBER_YOU), agent_note: SIGN_IN_NOTE, linked: false, ...(link ? { sign_in: link } : {}) };
  if (!link) return refuse({ show_to_builder: lead(NOT_READY), agent_note: SIGN_IN_NOTE, linked: false });
  return refuse({ show_to_builder: lead(`Not saved. Sign in once at ${link}, then tell me again.`), agent_note: SIGN_IN_NOTE, linked: false, sign_in: link });
}

/** Whether a set carries a policy-shaped key anywhere at its top or one level down (L24-16, L29-4). Pure. */
function setsPolicy(set: unknown): boolean {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return false;
  return Object.keys(set).some((k) => /policy|auto_apply|max_per_night/i.test(k)
    || ((set as Record<string, unknown>)[k] && typeof (set as Record<string, unknown>)[k] === 'object' && Object.keys((set as Record<string, object>)[k]).some((j) => /policy|auto_apply/i.test(j))));
}

/** What the open programs ask: their needs, and the answer kinds their forms ask. */
async function programAsks(now: Date): Promise<{ needs: string[]; kinds: string[] }> {
  const needs = new Set<string>();
  const kinds = new Set<string>();
  for (const p of await listOpenPrograms(now)) {
    for (const n of p.file.needs) needs.add(n);
    for (const r of p.file.submission_requirements) {
      const k = r.kind === 'how_it_works' ? 'solution' : r.kind;
      if ((ANSWER_KINDS as readonly string[]).includes(k)) kinds.add(k);
    }
  }
  return { needs: [...needs], kinds: [...kinds] };
}

/** The brief for one kind, with the first project's links and chains as the repo facts (no commit date: the record holds none). */
function briefFor(kind: AnswerKind, record: BuilderRecord) {
  const p = record.projects[0];
  return answerBrief(kind, record, { repo_url: p?.repo_url ?? null, live_url: p?.live_url ?? null, chains: p?.chains_claimed ?? [], first_commit_at: null });
}

/** The one "missing" line of record get and record set (v6.1.7 C30); null when nothing is missing. Pure. */
export function missingLine(missing: string[]): string | null {
  return missing.length > 0 ? `Still missing: ${listWords(missing)}.` : null;
}

/**
 * One refused part of a set (a merge problem "path: why") in builder words: the leaf named plainly, never the path
 * (v6.1.7 C29). Pure.
 */
/** Record keys that read as field names, in the builder's words (v6.1.7 task 6 review). */
const LEAF_WORDS: Record<string, string> = {
  repo_url: 'repo link', live_url: 'live link', demo_url: 'demo link', resume_url: 'resume link', deck_url: 'deck link',
  founder_video_url: 'founder video link', demo_video_url: 'demo video link', line_pre_launch: 'pre-launch line', id: 'short name',
  one_liner: 'one line', chains_claimed: 'chains', based_country: 'country', raised_usd: 'money raised', raised_from: 'raised from',
  revenue_usd_claim: 'revenue claim', launch_date: 'launch date', max_per_night: 'most a day', max_ask_usd: 'top amount',
  auto_apply: 'apply without asking', agent_may_submit: 'agent may submit', x: 'X handle',
};
export function refusedWords(problem: string): string {
  const cut = problem.indexOf(': ');
  const path = cut < 0 ? problem : problem.slice(0, cut);
  const why = cut < 0 ? '' : problem.slice(cut + 2);
  const parts = path.split('.');
  const answer = /(^|\.)answers\.([a-z_]+)/.exec(path)?.[2];
  const leaf = parts.filter((x) => x !== 'text' && !/^\d+$/.test(x)).at(-1) ?? path;
  const project = parts[0] === 'projects' && leaf !== 'projects' ? 'project ' : '';
  const known = answer && allowedKey(KIND_WORDS, answer) ? KIND_WORDS[answer as keyof typeof KIND_WORDS] : null;
  const what =
    path === 'set' ? 'what was sent'
    : known ? `the answer on ${known}`
    // L24-5 (v6.1.16 Task 11): own keys only, so an inherited name never reads as JavaScript.
    : `${project}${allowedKey(LEAF_WORDS, leaf) ? LEAF_WORDS[leaf] : leaf.replace(/_/g, ' ')}`;
  // L36-14 (v6.1.18): a projects entry whose id is missing or not valid says what each project needs.
  if (path === 'projects.id') return 'each project needs an id (a short lowercase name)';
  // L24-5: a key EarnKit does not keep is named as sent, quoted and cleaned.
  if (why === 'not a field') return `${project}${quoteName(leaf)} is not something I keep`;
  // L24-21 (v6.1.16 Task 11): a refusal for length names the limit, in /me's words.
  const max = /^Too big: expected string to have <=(\d+) characters$/.exec(why)?.[1];
  if (max) return `${known ?? what} is ${ME_VALUE_WORDS.under(Number(max))}`;
  // L45-6 (v6.1.19): "Not saved: name was empty."
  if (why === EMPTY) return `${what} was empty`;
  if (why.startsWith('set by EarnKit')) return `${what} is set by EarnKit only`;
  if (why.startsWith('set by the builder')) return `${what} is yours to set on earnkit.com/me`;
  return `${what} was not valid`;
}

/** L24-16 (v6.1.16 Task 11): the one refusal for an agent setting standing approval, whatever the spelling. */
export const STANDING_APPROVAL_YOURS = 'standing approval is yours to set on earnkit.com/me';

/**
 * The save line (v6.1.16 Task 12, L26-7): "Saved 154 answers and 22 facts. Approve the answers at earnkit.com/me and
 * they go into drafts.", a zero part left out ("Saved 3 facts.", "Saved 154 answers."), the approval sentence only when
 * answers were saved; refused parts after a semicolon ("Saved 1 fact; 1 not saved: email was not valid."); "Not saved:
 * ..." only when nothing was (v6.1.8 N1); "Nothing new to save." (C29). Pure.
 */
export function savedLine(saved: { answers: number; facts: number }, problems: string[], secrets: number): string {
  // L24-16 (v6.1.16 Task 11): any policy-shaped key (policy, Policy, policy.auto_apply, a nested policy) is one line.
  const policyShaped = (p: string) => /policy/i.test(p.slice(0, Math.max(0, p.indexOf(': ')) || p.length));
  const policy = problems.some(policyShaped) ? [STANDING_APPROVAL_YOURS] : [];
  const reasons = [...policy, ...problems.filter((p) => !policyShaped(p)).map(refusedWords), ...(secrets > 0 ? [secrets === 1 ? 'one looked like a secret' : `${secrets} looked like secrets`] : [])];
  const refused = problems.length + secrets;
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  const parts = [saved.answers > 0 ? count(saved.answers, 'answer') : null, saved.facts > 0 ? count(saved.facts, 'fact') : null].filter(Boolean);
  if (parts.length === 0) return refused > 0 ? `Not saved: ${listWords(reasons)}.` : 'Nothing new to save.';
  const kept = `Saved ${parts.join(' and ')}`;
  const approve = saved.answers === 0 ? '' : saved.answers === 1 ? ' Approve the answer at earnkit.com/me and it goes into drafts.' : ' Approve the answers at earnkit.com/me and they go into drafts.';
  return `${refused > 0 ? `${kept}; ${refused} not saved: ${listWords(reasons)}.` : `${kept}.`}${approve}`;
}

/** An answer sent as plain text (C20): the shape the record takes, for the agent. */
const answerShapeNote = (problems: string[]): string | null => {
  const kind = problems.map((p) => /(?:^|\.)answers\.([a-z_]+): not an object$/.exec(p)?.[1]).find(Boolean);
  return kind
    ? `Send each answer as { kind, text }, keyed by its kind: answers: { ${kind}: { text: "..." } } (or under a project's answers). Kinds: ${ANSWER_KINDS.join(', ')}.`
    : null;
};

/**
 * `set` without any string that looks like a secret key (or the route's placeholder for one): such a field, or
 * list entry, is skipped, never stored (v6.1.7, B9). `skipped` counts them. The walk stops at MAX_ARG_DEPTH. Pure.
 */
export function withoutSecrets(value: unknown, depth = 0): { value: unknown; skipped: number } {
  if (depth >= MAX_ARG_DEPTH || !value || typeof value !== 'object') return { value, skipped: 0 };
  let skipped = 0;
  const keep = (v: unknown): { keep: boolean; value: unknown } => {
    if (typeof v === 'string' && looksSecret(v)) {
      skipped += 1;
      return { keep: false, value: v };
    }
    const r = withoutSecrets(v, depth + 1);
    skipped += r.skipped;
    return { keep: true, value: r.value };
  };
  if (Array.isArray(value)) {
    const out = value.map(keep).filter((x) => x.keep).map((x) => x.value);
    return { value: skipped ? out : value, skipped };
  }
  const out = Object.fromEntries(
    Object.entries(value)
      .map(([k, v]) => [k, keep(v)] as const)
      .filter(([, x]) => x.keep)
      .map(([k, x]) => [k, x.value]),
  );
  return { value: skipped ? out : value, skipped };
}

export async function recordTool(ctx: { installationId: number; builderId: number | null; now: Date }, input: unknown): Promise<RecordReply> {
  const r = await recordReply(ctx, input);
  const i = RecordInput.safeParse(input);
  const kind = i.success && typeof i.data.get === 'string' ? i.data.get : null;
  return recordReplyCap(kind && r.answers ? kindPage(r, kind, i.success ? (i.data.page ?? 1) : 1) : r);
}

/** Fix round 1 (I2): the agent line when a kind has more answers past this page. */
export const KIND_MORE = (kind: string, page: number) => `Ask for ${kind} page ${page} for the rest.`;

/**
 * Fix round 1 (I2): one kind's answers in whole answers, packed into pages that each fit RECORD_REPLY_CAP, so no
 * answer is ever cut; the agent note names the next page while more remain. Pure.
 */
export function kindPage(reply: RecordReply, kind: string, page: number, cap = RECORD_REPLY_CAP): RecordReply {
  const all = reply.answers ?? [];
  const base = { ...reply, answers: [] as KindAnswer[], page: 100, pages: 100 };
  const room = cap - bytes(base) - Buffer.byteLength(` ${KIND_MORE(kind, 100)}`);
  const pages: KindAnswer[][] = [[]];
  let used = 0;
  for (const a of all) {
    const n = bytes(a) + 1;
    if (pages.at(-1)!.length > 0 && used + n > room) {
      pages.push([]);
      used = 0;
    }
    pages.at(-1)!.push(a);
    used += n;
  }
  const at = Math.min(page, pages.length);
  const more = page < pages.length ? [KIND_MORE(kind, page + 1)] : [];
  // L35-16 (v6.1.17): a page past the last says how many there are.
  const past = page > pages.length ? [PAGES_OF(pages.length, kind)] : [];
  return { ...reply, answers: page > pages.length ? [] : pages[at - 1], page, pages: pages.length, agent_note: [...past, reply.agent_note, ...more].filter(Boolean).join(' ') };
}

/** L45-1 (v6.1.19): a record get once the record holds everything the next application asked for. */
export const NOTHING_MORE = 'Saved. The next application needs nothing more.';

/**
 * L45-1 (v6.1.19): the next send's needs the record does not hold yet, in their words: a need with its form field is
 * met when the record now fills that field (as find fills it); any need is met when its words are an item the record
 * holds (`heldWords`).
 */
async function stillNeeded(needs: NextNeed[], record: BuilderRecord): Promise<string[]> {
  const held = new Set(heldWords(record));
  const programs = new Map<string, Awaited<ReturnType<typeof getProgram>>>();
  const out: string[] = [];
  for (const n of needs) {
    if (held.has(n.words)) continue;
    if (n.key && n.program_id) {
      if (!programs.has(n.program_id)) programs.set(n.program_id, await getProgram(n.program_id));
      const field = programs.get(n.program_id)?.file.submission_requirements.find((r) => r.key === n.key);
      if (field && recordValue(field, { record, projectId: n.project_id ?? null, verifiedUsage: null }) !== null) continue;
    }
    out.push(n.words);
  }
  return out;
}

async function recordReply(ctx: { installationId: number; builderId: number | null; now: Date }, input: unknown): Promise<RecordReply> {
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  const parsed = RecordInput.safeParse(input);
  // L29-10 (v6.1.16 Task 15): an input error has no builder text.
  if (!parsed.success) return { ...inputError(`Nothing was saved. ${inputDetail(parsed.error)}`), linked: ctx.builderId !== null };
  const i = parsed.data;
  // L35-16 (v6.1.17): page reads one kind's answers, and one call reads either the record or a brief.
  if (i.page !== undefined && typeof i.get !== 'string') return { ...inputError(`Nothing was saved. ${PAGE_WITHOUT_KIND}.`), linked: ctx.builderId !== null };
  if (i.get !== undefined && i.get !== false && i.brief !== undefined) return { ...inputError(`Nothing was saved. ${GET_AND_BRIEF}.`), linked: ctx.builderId !== null };
  if (ctx.builderId === null) return unlinked(ctx.installationId, ctx.now, i.set !== undefined, i.set !== undefined && setsPolicy(i.set));
  const asks = await programAsks(ctx.now);
  let record: BuilderRecord;
  let m: ReturnType<typeof mergeRecord> | null = null;
  const problems: string[] = [];
  let secrets = 0;
  if (i.set !== undefined) {
    // Read, merge and save under the row's lock, so two agents' sets never lose one another.
    const clean = withoutSecrets(i.set);
    secrets = clean.skipped;
    const set = clean.value;
    const out = await withRecord(ctx.builderId, ctx.now, (current) => {
      const merged = mergeRecord(current, set, 'agent', ctx.now);
      return { record: merged.changed.length > 0 ? merged.record : null, result: merged };
    });
    if (out.broken) return { show_to_builder: BROKEN, agent_note: BROKEN_NOTE, linked: true };
    m = out.result;
    record = out.record;
  } else {
    const read = await readStoredRecord(ctx.builderId);
    record = read.record;
    if (read.broken) problems.push('stored record could not be read');
  }
  const brief = i.brief ? briefFor(i.brief, record) : undefined;
  // L26-2 (v6.1.16 Task 12): get reads the summary, get with a kind that kind in full; a brief carries no record.
  const read = i.get === true ? { summary: recordSummary(record) } : typeof i.get === 'string' ? { answers: kindAnswers(record, i.get) } : {};

  // L26-7: an answer saved and waiting for approval counts as there; only a kind with no answer at all is missing.
  const items = recordItems(record, { ...asks, anyAnswer: true });
  const answered = new Set(answersOf(record).map((a) => KIND_WORDS[a.kind]));
  const waiting = waitingAnswers(record);
  // L29-11 (v6.1.16 Task 15): what the next send needs (the last find's first ready program, at most two), never the
  // whole list; before any linked project find, nothing is asked yet.
  // L45-1 (v6.1.19): and never one the record holds now (a fact or an answer just saved), so the list drops it at once.
  const stored = await nextNeedsOf(ctx.installationId);
  const needs = stored === null ? null : (await stillNeeded(stored, record)).filter((n) => !answered.has(n));
  const missing = needs ?? [];
  /** L45-1: the next application asked for something and the record now holds all of it. */
  const allMet = stored !== null && stored.length > 0 && missing.length === 0;
  const briefNote = i.brief ? [BRIEF_NOTE, shortNote(i.brief, record)].filter(Boolean).join(' ') : '';
  // v6.1.9: every get and set says what to do next.
  const next = needs === null
    ? 'Call find with the project; it names what the next application needs.'
    : missing.length > 0
      ? `The next application needs ${listWords(missing, 2)}: ask the builder for ${missing.length === 1 ? 'it' : 'them'} and save with record set. Ask for nothing else now.`
      : 'Nothing more is needed for the next application; call find with the project for what it can apply to now.';
  if (m) {
    // Facts saved: a new project counts by its facts, not once more for itself.
    const facts = m.changed.filter((p) => !m!.changed.some((q) => q.startsWith(`${p}.`)));
    const answers = facts.filter(answerPath).length;
    const counts = { answers, facts: facts.length - answers };
    // L29-4 (v6.1.16 Task 15): a policy set is the one line, with no missing list; a refusal when nothing else was saved.
    const policy = m.problems.some((p) => /policy/i.test(p.slice(0, Math.max(0, p.indexOf(': ')) || p.length)));
    const others = m.problems.filter((p) => !/policy/i.test(p.slice(0, Math.max(0, p.indexOf(': ')) || p.length)));
    if (policy) {
      const head = facts.length > 0 || others.length > 0 || secrets > 0 ? `${savedLine(counts, others, secrets)} ` : '';
      const r: RecordReply = {
        show_to_builder: `${head}${STANDING_YOURS(record.policy.auto_apply === true)}`,
        // Fix round 1 (N2, v6.1.17): with approval off and facts saved, one line still says what happened.
        agent_note: record.policy.auto_apply === true ? `${facts.length > 0 ? '' : 'Nothing was saved. '}${STOP_HELD_NOTE}` : facts.length > 0 ? POLICY_OFF_SAVED_NOTE : 'Nothing was saved.',
        linked: true,
        problems: m.problems,
        ...read,
      };
      return facts.length > 0 ? r : refuse(r);
    }
    const head = savedLine(counts, m.problems, secrets);
    const r: RecordReply = {
      // L26-7: answers already waiting are named when this set saved none (its own line says to approve them).
      show_to_builder: [head, answers === 0 ? waitingLine(waiting) : null, missingLine(missing)].filter(Boolean).join(' '),
      agent_note: [m.changed.some(APPROVABLE) ? APPROVAL_NOTE : briefNote, answerShapeNote(m.problems), next].filter(Boolean).join(' '),
      linked: true,
      missing,
      ...(m.problems.length > 0 ? { problems: m.problems } : {}),
      ...read,
      ...(brief ? { brief } : {}),
    };
    // L29-9: a set that saved nothing and refused a part is a refusal.
    return facts.length === 0 && (m.problems.length > 0 || secrets > 0) ? refuse(r) : r;
  }

  // One sentence (v6.1.8): how much the record holds (C50), then (L29-11) what the next application needs, at most two.
  // L38-15 (v6.1.18): with something missing, no count: what the next application needs and the one action.
  const have = items.total - items.missing.length;
  const holds = [`Your record has ${have} of ${items.total} ${items.total === 1 ? 'item' : 'items'}.`, waitingLine(waiting)].filter(Boolean).join(' ');
  return {
    show_to_builder: !brief && missing.length > 0 ? [waitingLine(waiting), nextNeedsLine(missing)].filter(Boolean).join(' ')
      : !brief && allMet ? [waitingLine(waiting), NOTHING_MORE].filter(Boolean).join(' ') : holds,
    agent_note: briefNote || next,
    linked: true,
    ...(brief ? {} : i.get === undefined || i.get === false ? { summary: recordSummary(record) } : read),
    missing,
    ...(problems.length > 0 ? { problems } : {}),
    ...(brief ? { brief } : {}),
  };
}
