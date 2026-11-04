/**
 * The find tool: what a project can earn now (ready, pre-filled), what is one change away, what
 * moved since the last find, and the ledger; or one program's details; or, with no project, the
 * open list. EarnKit writes no prose: the agent drafts from the fields.
 */
import { z } from 'zod';
import { timeLeftWords } from './deadline';
import { evaluate, type Gap, type Verdict } from './eligibility';
import { guideLines, guideText, type Guide } from './guide';
import { lastFindAt, markFind } from './installations';
import { askOutcome, doneByProgram, doneItems, excluded, markAsked, summary, type Ledger } from './ledger';
import { prefill, type Field } from './prefill';
import { PROGRAM_CATEGORIES, categoryOf, type Category, type Program } from './program-file';
import { getProgram, listOpenPrograms, type ProgramRow } from './programs';
import { parseProject, type Project } from './project-input';
import { rankGaps, rankReady } from './rank';
import { repoFacts, type RepoFacts } from './repo-facts';
import { agentNote, replyText } from './reply';
import { since, type Since } from './since';

export const FindInput = z.object({
  project: z.unknown().optional(),
  program_id: z.string().max(100).optional(),
  filter: z.object({ category: z.enum(PROGRAM_CATEGORIES).optional(), all: z.boolean().optional() }).optional(),
});

export type ReadyProgram = {
  program_id: string;
  title: string;
  money: string;
  max_award_usd: number | null;
  category: Category;
  closes_at: string | null;
  closes_in: string | null;
  long_shot: string | null;
  in_person: boolean;
  submission_url: string;
  form?: Program['form'];
  fields: Field[];
  filled: number;
  total: number;
  /** The to-dos of the required fields only the builder can give. */
  needs: string[];
};
export type GapProgram = {
  program_id: string;
  title: string;
  money: string;
  max_award_usd: number | null;
  category: Category;
  closes_at: string | null;
  gap: Gap;
  /** Any second change the program needs. */
  also: Gap[];
};
export type FindReply = {
  show_to_builder: string;
  agent_note: string;
  since: Since;
  ready: ReadyProgram[];
  gaps: GapProgram[];
  not_fit?: { program_id: string; title: string; reason: string }[];
  ledger: Ledger;
  ask_outcome: { program_id: string; title: string }[];
  as_reported: boolean;
  problems?: string[];
};
export type ProgramReply = { show_to_builder: string; agent_note: string; program: Program | null; fields: Field[]; guide: Guide | null; verdict?: Verdict };
export type FindContext = { installationId: number; now: Date; gh?: typeof fetch };

const MAX_READY = 5;
const MAX_GAPS = 3;
const MAX_LISTED = 10;

/** The money in the program's own words: its summary's first part. Pure. */
export const moneyOf = (p: Program): string => p.summary.split(' · ')[0];
const closesIn = (p: Program, now: Date) => (p.ends_at ? timeLeftWords(p.ends_at, now) : null);
const EMPTY_FACTS: RepoFacts = {
  name: '', description: '', repo_url: null, public: false, as_reported: true, live_url: null, demo_url: null, chains: [], contracts: [],
  builder_codes: false, users: false, first_commit_at: null, last_commit_at: null, readme_excerpt: null, homepage: null,
};

/** A read that fails is the agent's report alone (repoFacts falls back the same way when GitHub fails). */
async function factsOf(project: Project, ctx: FindContext): Promise<RepoFacts> {
  try {
    return await repoFacts(project, { gh: ctx.gh, now: ctx.now });
  } catch {
    return repoFacts({ ...project, private: true }, { now: ctx.now });
  }
}

function readyOf(row: ProgramRow, v: Verdict, facts: RepoFacts, now: Date): ReadyProgram {
  const p = row.file;
  const { fields, filled, total } = prefill(row, facts);
  const todo = new Map(p.submission_requirements.map((r) => [r.key, r.todo]));
  return {
    program_id: row.id, title: p.title, money: moneyOf(p), max_award_usd: p.max_award_usd ?? null, category: categoryOf(p),
    closes_at: p.ends_at, closes_in: closesIn(p, now), long_shot: v.long_shot, in_person: p.in_person, submission_url: p.submission_url,
    ...(p.form ? { form: p.form } : {}),
    fields, filled, total,
    needs: fields.filter((f) => f.from === 'builder' && f.required).map((f) => todo.get(f.key) ?? f.label.toLowerCase()),
  };
}

const gapOf = (row: ProgramRow, v: Verdict): GapProgram => ({
  program_id: row.id, title: row.file.title, money: moneyOf(row.file), max_award_usd: row.file.max_award_usd ?? null,
  category: categoryOf(row.file), closes_at: row.file.ends_at, gap: v.gaps[0], also: v.gaps.slice(1),
});

/** One program: its file, its fields (for the project, when given) and the verdict. */
async function oneProgram(ctx: FindContext, id: string, project: Project | null): Promise<ProgramReply> {
  const row = await getProgram(id);
  if (!row) return { show_to_builder: "I don't know that program.", agent_note: 'Call find with the project for the programs it fits.', program: null, fields: [], guide: null };
  const p = row.file;
  const facts = project ? await factsOf(project, ctx) : EMPTY_FACTS;
  const { fields } = prefill(row, facts);
  const verdict = project ? evaluate(row, facts, await doneItems(ctx.installationId, id), ctx.now) : undefined;
  const left = closesIn(p, ctx.now);
  const when = p.status === 'upcoming' ? (p.opens_note ?? 'not open yet') : p.status === 'closed' || (p.ends_at && !left) ? 'closed' : left ? `closes ${left}` : 'no deadline';
  const guide = guideText(row, ctx.now);
  const rules = guideLines(guide);
  return {
    show_to_builder: [`${p.title}, ${moneyOf(p)}, ${when}.`, ...(rules.length > 0 ? [`Apply at ${p.submission_url}.`, ...rules, 'Want me to draft it?'] : [`Apply at ${p.submission_url}. Want me to draft it?`])].join('\n'),
    agent_note: [
      project ? 'Draft from fields: earnkit values as given, agent fields from your memory and sources, builder fields asked once.' : 'Call again with the project so the fields come pre-filled.',
      'Submit only on a yes, in your own browser, then call track with applied.',
    ].join('\n'),
    program: p,
    fields,
    guide,
    ...(verdict ? { verdict } : {}),
  };
}

/** The open programs as a list, for a find with no project. */
async function openList(ctx: FindContext, problem: string | null): Promise<FindReply> {
  const programs = await listOpenPrograms(ctx.now);
  const lines = programs.slice(0, MAX_LISTED).map((r) => {
    const left = closesIn(r.file, ctx.now);
    return `${r.file.title}, ${moneyOf(r.file)}${left ? `, closes ${left}` : ''}`;
  });
  if (programs.length > MAX_LISTED) lines.push(`and ${programs.length - MAX_LISTED} more`);
  const ledger = await summary(ctx.installationId, programs, ctx.now);
  return {
    show_to_builder: programs.length > 0 ? `Open now:\n${lines.join('\n')}` : "Nothing is open right now. I'll say when something opens.",
    agent_note: [
      ...(problem ? [`The project was not read: ${problem}.`] : []),
      'Pass the project next time (name, description, repo_url, chains, live_url) so EarnKit can match it and pre-fill each form.',
    ].join('\n'),
    since: { from: null, new: [], changed: [], closing: [] },
    ready: [], gaps: [], ledger, ask_outcome: [], as_reported: false,
  };
}

export async function find(ctx: FindContext, input: unknown): Promise<FindReply | ProgramReply> {
  const i = FindInput.parse(input ?? {});
  const parsed = i.project === undefined ? null : parseProject(i.project);
  const project = parsed?.ok ? parsed.project : null;
  const problems = parsed?.ok ? parsed.problems : [];
  if (i.program_id) return oneProgram(ctx, i.program_id, project);
  if (!project) return openList(ctx, parsed && !parsed.ok ? parsed.problem : null);

  const facts = await factsOf(project, ctx);
  const open = await listOpenPrograms(ctx.now);
  const skip = await excluded(ctx.installationId);
  const all = i.filter?.all === true;
  const programs = open.filter((r) => !skip.has(r.id) && (!i.filter?.category || categoryOf(r.file) === i.filter.category));
  const byId = new Map(programs.map((r) => [r.id, r]));
  const done = await doneByProgram(ctx.installationId);
  const verdicts = programs.map((r) => evaluate(r, facts, done.get(r.id) ?? new Set<string>(), ctx.now));

  const readyV = rankReady(verdicts.filter((v) => v.status === 'ready'), byId);
  const gapV = rankGaps(verdicts.filter((v) => v.status === 'gap'), byId);
  const shownReady = all ? readyV : readyV.slice(0, MAX_READY);
  const shownGaps = all ? gapV : gapV.slice(0, MAX_GAPS);
  const more = readyV.length - shownReady.length + gapV.length - shownGaps.length;
  const ready = shownReady.map((v) => readyOf(byId.get(v.program_id)!, v, facts, ctx.now));
  const gaps = shownGaps.map((v) => gapOf(byId.get(v.program_id)!, v));

  const last = await lastFindAt(ctx.installationId);
  const moved = await since(ctx.installationId, last, open, ready.map((r) => r.program_id), ctx.now, gaps.map((g) => g.program_id));
  const ledger = await summary(ctx.installationId, open, ctx.now);
  const ask = await askOutcome(ctx.installationId, open, ctx.now);
  await markAsked(ctx.installationId, ask.map((a) => a.program_id), ctx.now);

  const r: Omit<FindReply, 'show_to_builder' | 'agent_note'> = {
    since: moved, ready, gaps,
    ...(all ? { not_fit: verdicts.filter((v) => v.status === 'no').map((v) => ({ program_id: v.program_id, title: byId.get(v.program_id)!.file.title, reason: v.reason ?? 'does not fit' })) } : {}),
    ledger, ask_outcome: ask, as_reported: facts.as_reported,
    ...(problems.length > 0 ? { problems } : {}),
  };
  await markFind(ctx.installationId, ctx.now);
  return { show_to_builder: replyText(r, last === null), agent_note: agentNote(r, { more }), ...r };
}
