/**
 * The record tool: on a linked installation, get the builder's record, set facts into it (merged
 * by the agent, never approved) or get the brief behind one answer kind; unlinked, the sign-in link.
 * Only the linked installation's calls read the record. Approval happens on /me only.
 */
import { z } from 'zod';
import { looksSecret, MAX_ARG_DEPTH } from '../v5/secrets';
import { inputDetail } from '../v5/tool-input';
import { ANSWER_KINDS, type AnswerKind } from '../v5/program-file';
import { listOpenPrograms } from '../v5/programs';
import { answerBrief } from './answer-brief';
import { LinkRefused, readStoredRecord, withRecord } from './builders';
import { oauthConfigured } from './github-auth';
import { createLinkCode } from './link-routes';
import { listWords, signInLine } from './reply-words';

export { listWords, signInLine };
import { APPROVABLE, type BuilderRecord, KIND_WORDS, mergeRecord, recordMissing } from './record';

export const RecordInput = z
  .object({
    set: z.unknown().optional().describe('A partial record to merge: person, team, company, projects (by id), docs, traction, answers'),
    get: z.boolean().optional().describe('true to read the record and what it still lacks'),
    brief: z.enum(ANSWER_KINDS).optional().describe('One answer kind: the question, the facts to use, the length and the style'),
  })
  .strict();

export type RecordReply = {
  show_to_builder: string;
  agent_note: string;
  linked: boolean;
  sign_in?: string;
  record?: BuilderRecord;
  missing?: string[];
  problems?: string[];
  brief?: ReturnType<typeof answerBrief>;
};

const SIGN_IN_NOTE = 'Show the link once. Ask for personal facts once, all together, when a form needs them; nothing is saved until the builder has signed in. Call record with get afterwards.';
const NOT_READY = "I can't save that yet, so I keep it for this chat.";
const APPROVAL_NOTE = 'Approved answers come from earnkit.com/me, where the builder reads and approves each one; an unapproved answer is never used in a form.';
const BROKEN = 'Your record could not be read; nothing was saved.';
const BROKEN_NOTE = 'Tell the builder to open earnkit.com/me; the owner can inspect the stored row.';
const BRIEF_NOTE = 'Draft the answer from the brief and save it with record set; the builder approves it on earnkit.com/me before any form uses it.';

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
async function unlinked(installationId: number, now: Date, setting: boolean): Promise<RecordReply> {
  const link = await signInLink(installationId, now);
  if (!link) return { show_to_builder: NOT_READY, agent_note: SIGN_IN_NOTE, linked: false };
  const show = setting ? `Not saved. Sign in once at ${link}, then tell me again.` : signInLine(link);
  return { show_to_builder: show, agent_note: SIGN_IN_NOTE, linked: false, sign_in: link };
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

export const RECORD_UNREAD = 'I could not read that. Send the facts to save, or ask for the record.';

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
  revenue_usd_claim: 'revenue claim', launch_date: 'launch date', max_per_night: 'most per night', max_ask_usd: 'top amount',
  auto_apply: 'apply without asking', agent_may_submit: 'agent may submit', x: 'X handle',
};
export function refusedWords(problem: string): string {
  const cut = problem.indexOf(': ');
  const path = cut < 0 ? problem : problem.slice(0, cut);
  const why = cut < 0 ? '' : problem.slice(cut + 2);
  const parts = path.split('.');
  const answer = /(^|\.)answers\.([a-z_]+)/.exec(path)?.[2];
  const leaf = parts.filter((x) => x !== 'text' && !/^\d+$/.test(x)).at(-1) ?? path;
  const what =
    path === 'set' ? 'what was sent'
    : answer && Object.hasOwn(KIND_WORDS, answer) ? `the answer on ${KIND_WORDS[answer as keyof typeof KIND_WORDS]}`
    : `${parts[0] === 'projects' && leaf !== 'projects' ? 'project ' : ''}${LEAF_WORDS[leaf] ?? leaf.replace(/_/g, ' ')}`;
  if (why === 'not a field') return `${what} is not something I keep`;
  if (why.startsWith('set by EarnKit')) return `${what} is set by EarnKit only`;
  if (why.startsWith('set by the builder')) return `${what} is yours to set on earnkit.com/me`;
  return `${what} was not valid`;
}

/** "Saved 2.", "Saved 1; 1 not saved: email was not valid.", "Nothing saved: ...", "Nothing new to save." (C29). Pure. */
export function savedLine(saved: number, problems: string[], secrets: number): string {
  const reasons = [...problems.map(refusedWords), ...(secrets > 0 ? [secrets === 1 ? 'one looked like a secret' : `${secrets} looked like secrets`] : [])];
  const refused = problems.length + secrets;
  if (saved > 0) return refused > 0 ? `Saved ${saved}; ${refused} not saved: ${listWords(reasons)}.` : `Saved ${saved}.`;
  return refused > 0 ? `Nothing saved: ${listWords(reasons)}.` : 'Nothing new to save.';
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
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  const parsed = RecordInput.safeParse(input);
  if (!parsed.success)
    return { show_to_builder: RECORD_UNREAD, agent_note: `Nothing was saved. ${inputDetail(parsed.error)}`, linked: ctx.builderId !== null };
  const i = parsed.data;
  if (ctx.builderId === null) return unlinked(ctx.installationId, ctx.now, i.set !== undefined);
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

  const missing = recordMissing(record, asks);
  if (m) {
    // Facts saved: a new project counts by its facts, not once more for itself.
    const facts = m.changed.filter((p) => !m!.changed.some((q) => q.startsWith(`${p}.`)));
    const head = savedLine(facts.length, m.problems, secrets);
    return {
      show_to_builder: [head, missingLine(missing)].filter(Boolean).join(' '),
      agent_note: [m.changed.some(APPROVABLE) ? APPROVAL_NOTE : brief ? BRIEF_NOTE : '', answerShapeNote(m.problems)].filter(Boolean).join(' '),
      linked: true,
      missing,
      ...(m.problems.length > 0 ? { problems: m.problems } : {}),
      ...(i.get || brief ? { record } : {}),
      ...(brief ? { brief } : {}),
    };
  }

  // One sentence (v6.1.8): what is missing, named, or that nothing is.
  return {
    show_to_builder: missing.length > 0 ? `Your record is missing: ${listWords(missing)}.` : 'Your record has nothing missing.',
    agent_note: brief ? BRIEF_NOTE : '',
    linked: true,
    record,
    missing,
    ...(problems.length > 0 ? { problems } : {}),
    ...(brief ? { brief } : {}),
  };
}
