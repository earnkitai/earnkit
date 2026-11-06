/**
 * The record tool: on a linked installation, get the builder's record, set facts into it (merged
 * by the agent, never approved) or get the brief behind one answer kind; unlinked, the sign-in link.
 * Only the linked installation's calls read the record. Approval happens on /me only.
 */
import { z } from 'zod';
import { ANSWER_KINDS, type AnswerKind } from '../v5/program-file';
import { listOpenPrograms } from '../v5/programs';
import { answerBrief } from './answer-brief';
import { LinkRefused, readStoredRecord, withRecord } from './builders';
import { oauthConfigured } from './github-auth';
import { createLinkCode } from './link-routes';
import { APPROVABLE, type BuilderRecord, completeness, mergeRecord, recordMissing } from './record';

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

const SIGN_IN_NOTE = 'Show the link and stop asking for personal facts until the builder has signed in. Call record with get afterwards.';
const NOT_READY = 'Sign-in is not ready yet; I will keep what you tell me in this session only.';
const APPROVAL_NOTE = 'Approved answers come from earnkit.com/me, where the builder reads and approves each one; an unapproved answer is never used in a form.';
const BROKEN = 'Your record could not be read; nothing was saved.';
const BROKEN_NOTE = 'Tell the builder to open earnkit.com/me; the owner can inspect the stored row.';
const BRIEF_NOTE = 'Draft the answer from the brief and save it with record set; the builder approves it on earnkit.com/me before any form uses it.';

const origin = () => (process.env.EARNKIT_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". Pure. */
export function listWords(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** The installation's sign-in link; null when sign-in is not configured or the installation is already linked. */
export async function signInLink(installationId: number, now: Date): Promise<string | null> {
  if (!oauthConfigured()) return null;
  try {
    return `${origin()}/link/${await createLinkCode(installationId, now)}`;
  } catch (err) {
    if (err instanceof LinkRefused) return null;
    throw err;
  }
}

/** The one line that offers the link. Pure. */
export const signInLine = (link: string) => `Sign in once at ${link} so I remember you across agents.`;

async function unlinked(installationId: number, now: Date): Promise<RecordReply> {
  const link = await signInLink(installationId, now);
  if (!link) return { show_to_builder: NOT_READY, agent_note: SIGN_IN_NOTE, linked: false };
  return { show_to_builder: signInLine(link), agent_note: SIGN_IN_NOTE, linked: false, sign_in: link };
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

export async function recordTool(ctx: { installationId: number; builderId: number | null; now: Date }, input: unknown): Promise<RecordReply> {
  const i = RecordInput.parse(input);
  if (ctx.builderId === null) return unlinked(ctx.installationId, ctx.now);
  const asks = await programAsks(ctx.now);
  let record: BuilderRecord;
  let m: ReturnType<typeof mergeRecord> | null = null;
  const problems: string[] = [];
  if (i.set !== undefined) {
    // Read, merge and save under the row's lock, so two agents' sets never lose one another.
    const set = i.set;
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

  if (m) {
    const missing = recordMissing(record, asks);
    const head = m.changed.length > 0 ? 'Saved.' : 'Nothing new to save.';
    return {
      show_to_builder: missing.length > 0 ? `${head} Still missing: ${listWords(missing)}.` : head,
      agent_note: m.changed.some(APPROVABLE) ? APPROVAL_NOTE : brief ? BRIEF_NOTE : '',
      linked: true,
      missing,
      ...(m.problems.length > 0 ? { problems: m.problems } : {}),
      ...(i.get || brief ? { record } : {}),
      ...(brief ? { brief } : {}),
    };
  }

  const blocks = completeness(record);
  const n = blocks.filled.length;
  return {
    show_to_builder: blocks.missing.length > 0 ? `Your record has ${n} of 6 blocks; missing: ${listWords(blocks.missing, 6)}.` : `Your record has ${n} of 6 blocks.`,
    agent_note: brief ? BRIEF_NOTE : '',
    linked: true,
    record,
    missing: recordMissing(record, asks),
    ...(problems.length > 0 ? { problems } : {}),
    ...(brief ? { brief } : {}),
  };
}
