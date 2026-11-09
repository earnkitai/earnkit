/**
 * The find tool: what a project can earn now (ready, pre-filled), what is one change away, what
 * moved since the last find, and the ledger; or one program's details; or, with no project, the
 * open list. Linked, it also reads the builder's record (lib/v6/find-record.ts). EarnKit writes no prose.
 */
import { z } from 'zod';
import { ownerKey } from '../v6/builders';
import { appliedOvernight, releaseStale } from '../v6/claims';
import { readEvidence, type Evidence, type Subject } from '../v6/evidence';
import { blockersOf, notNever, missingFor, provisionalGate, provisionalTier, recordSide, storedRecordContext, tierGate, type Blocker, type RecordSide } from '../v6/find-record';
import { EMPTY_RECORD } from '../v6/record';
import { signInLink } from '../v6/record-tool';
import { signInLine } from '../v6/reply-words';
import { timeLeftWords } from './deadline';
import { evaluate, type Gap, type Verdict } from './eligibility';
import { guideLines, guideText, type Guide } from './guide';
import { lastFindAt, markFind } from './installations';
import { askOutcome, claimed, doneByProgram, doneItems, excluded, markAsked, summary, type Ledger } from './ledger';
import { prefill, type Field } from './prefill';
import { PROGRAM_CATEGORIES, categoryOf, type Category, type Program } from './program-file';
import { getProgram, isOpen, listOpenPrograms, type ProgramRow } from './programs';
import { parseProject, type Project } from './project-input';
import { rankGaps, rankReady } from './rank';
import { repoFacts, type RepoFacts } from './repo-facts';
import { AGENT_FIELDS, agentNote, numbered, replyText } from './reply';
import { since, type Since } from './since';

export const FindInput = z.object({
  project: z.unknown().optional(),
  program_id: z.string().max(100).optional(),
  project_id: z.string().max(40).optional(),
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
  /** EarnKit values: from the record and from the repo. */
  filled: number;
  /** Required fields filled from the builder's record (0 when not linked). */
  from_record: number;
  /** Required fields filled from the public code read. */
  repo_required: number;
  /** The to-dos of the required fields left to the builder or the agent. */
  need_you: string[];
  /** EarnKit values read from the repo (links, contract, chain), not the passed name or description. */
  facts_from_repo: number;
  total: number;
  /** The program's setup items, then the to-dos of the required fields only the builder can give. */
  needs: string[];
  /** What taking part needs before applying (in person: attending). */
  setup: string[];
  /** The number the builder sees (and says) for it. */
  n: number;
  /** Set while another agent of the builder's holds a claim on it (track started). */
  claimed_since?: string;
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
  /** The number the builder sees (and says) for it. */
  n: number;
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
  linked: boolean;
  record_missing: string[];
  blockers: Blocker[];
  evidence_summary: { tier: string | null; line: string } | null;
  applied_overnight: { program_id: string; title: string }[];
  released: string[];
  auto_apply: boolean;
  /** With auto_apply: the most the agent applies to in one night. */
  max_per_night?: number;
  /** Unlinked with sign-in configured: the link that links this installation to a builder. */
  sign_in?: string;
};
export type ProgramReply = { show_to_builder: string; agent_note: string; program: Program | null; fields: Field[]; guide: Guide | null; verdict?: Verdict };
export type FindContext = {
  installationId: number;
  builderId: number | null;
  now: Date;
  gh?: typeof fetch;
  /** The builder's own evidence read (default readEvidence). */
  evidence?: (s: Subject) => Promise<Evidence>;
  /** The sign-in link for an unlinked installation (default the record tool's; null when not configured). */
  linkUrl?: () => Promise<string | null>;
};

const MAX_READY = 5;
/** In-person ready programs get their own slots: they never take a remote one's (v6.1.4). */
const MAX_IN_PERSON = 2;
const MAX_GAPS = 3;

// The gaps markFind keeps for track started, at most this many, in rank order.
const MAX_REMEMBERED_GAPS = 60;
const MAX_LISTED = 10;

/** The ready list shown: all of it when `all`, else the first MAX_READY remote then the first MAX_IN_PERSON in person,
 * each in input (rank) order. Zero remote leaves only the in-person slots. */
export function shownReadyOf<T>(readyV: T[], all: boolean, inPerson: (v: T) => boolean): T[] {
  if (all) return readyV;
  const remoteV = readyV.filter((v) => !inPerson(v));
  const attendV = readyV.filter(inPerson);
  return [...remoteV.slice(0, MAX_READY), ...attendV.slice(0, MAX_IN_PERSON)];
}

/** Whose ledger this find reads: the builder's once linked, else the installation's. Pure. */
const ownerOf = (ctx: FindContext) => ownerKey(ctx.installationId, ctx.builderId);

/** The money in the program's own words: its summary's first part. Pure. */
export const moneyOf = (p: Program): string => p.summary.split(' · ')[0];
const closesIn = (p: Program, now: Date) => (p.ends_at ? timeLeftWords(p.ends_at, now) : null);
const EMPTY_FACTS: RepoFacts = {
  name: '', description: '', repo_url: null, repo_url_basis: null, live_url_basis: null, demo_url_basis: null, public: false, as_reported: true, live_url: null, demo_url: null, chains: [], contracts: [],
  builder_codes: false, integrations: [], users: null, first_commit_at: null, last_commit_at: null, readme_excerpt: null, homepage: null,
};

/** A read that fails is the agent's report alone (repoFacts falls back the same way when GitHub fails). */
async function factsOf(project: Project, ctx: FindContext): Promise<RepoFacts> {
  try {
    return await repoFacts(project, { gh: ctx.gh, now: ctx.now, installationId: ctx.installationId });
  } catch {
    return repoFacts({ ...project, private: true }, { now: ctx.now });
  }
}

function readyOf(row: ProgramRow, v: Verdict, facts: RepoFacts, now: Date, side: RecordSide | null): Omit<ReadyProgram, 'n'> {
  const p = row.file;
  const rec = side ? { record: side.record, projectId: side.projectId, verifiedUsage: side.verifiedUsage } : null;
  const { fields, filled, facts_from_repo, repo_required, from_record, total, need_you } = prefill(row, facts, rec);
  const todo = new Map(p.submission_requirements.map((r) => [r.key, r.todo]));
  return {
    program_id: row.id, title: p.title, money: moneyOf(p), max_award_usd: p.max_award_usd ?? null, category: categoryOf(p),
    closes_at: p.ends_at, closes_in: closesIn(p, now), long_shot: v.long_shot, in_person: p.in_person, submission_url: p.submission_url,
    ...(p.form ? { form: p.form } : {}),
    fields, filled, facts_from_repo, repo_required, from_record, need_you, total,
    needs: [...p.setup, ...fields.filter((f) => f.from === 'builder' && f.required).map((f) => todo.get(f.key) ?? f.label.toLowerCase())],
    setup: p.setup,
  };
}

const gapOf = (row: ProgramRow, v: Verdict): Omit<GapProgram, 'n'> => ({
  program_id: row.id, title: row.file.title, money: moneyOf(row.file), max_award_usd: row.file.max_award_usd ?? null,
  category: categoryOf(row.file), closes_at: row.file.ends_at, gap: v.gaps[0], also: v.gaps.slice(1),
});

/** One program: its file, its fields (for the project, when given) and the verdict. */
async function oneProgram(ctx: FindContext, id: string, project: Project | null, projectId?: string): Promise<ProgramReply> {
  const row = await getProgram(id);
  if (!row) return { show_to_builder: "I don't know that program.", agent_note: 'Call find with the project for the programs it fits.', program: null, fields: [], guide: null };
  const p = row.file;
  const facts = project ? await factsOf(project, ctx) : EMPTY_FACTS;
  // Linked: the record fills first, as in the match (no evidence read here: the stored usage line).
  const rec = ctx.builderId === null ? null : await storedRecordContext(ctx.builderId, projectId, facts.repo_url ?? project?.repo_url ?? null);
  const { fields } = prefill(row, facts, rec);
  const fitted = fields.some((f) => f.from === 'record');
  const verdict = project ? evaluate(row, facts, await doneItems(ownerOf(ctx), id), ctx.now) : undefined;
  const left = closesIn(p, ctx.now);
  const open = isOpen(p, ctx.now);
  const when = p.status === 'upcoming' ? null : !open ? 'closed' : left ? `closes ${left}` : 'no deadline';
  const ask = open ? 'Want me to draft it?' : p.status === 'upcoming' ? `Not open yet: ${p.opens_note ?? 'no date announced'}.` : 'This one is closed.';
  const guide = guideText(row, ctx.now);
  const rules = guideLines(guide);
  return {
    show_to_builder: [`${p.title}, ${moneyOf(p)}${when ? `, ${when}` : ''}.`, ...(rules.length > 0 ? [`Apply at ${p.submission_url}.`, ...rules, ask] : [`Apply at ${p.submission_url}. ${ask}`])].join('\n'),
    agent_note: (open
      ? [
          project ? `Draft from fields: ${fitted ? "'record' and 'earnkit'" : "'earnkit'"} values as given; ${AGENT_FIELDS}` : 'Call again with the project so the fields come pre-filled.',
          'Submit only on a yes, in your own browser, then call track with applied.',
          ...(fitted ? ['Fit approved answers by cutting, never by adding; the style contract travels on each field.'] : []),
        ]
      : ['It takes no entries now: draft nothing and submit nothing. Call find with the project for what is open.']
    ).join('\n'),
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
    return `${r.file.title}, ${moneyOf(r.file)}${left ? `, closes ${left}` : ''}.`;
  });
  if (programs.length > MAX_LISTED) lines.push(`and ${programs.length - MAX_LISTED} more.`);
  const ledger = await summary(ownerOf(ctx), programs, ctx.now);
  const link = ctx.builderId === null ? await linkOf(ctx) : null;
  const list = programs.length > 0 ? `Open now:\n${lines.join('\n')}\nTell me which project and I'll match it.` : "Nothing is open right now. I'll say when something opens.";
  return {
    show_to_builder: link ? `${list}\n\n${signInLine(link)}` : list,
    agent_note: [
      ...(problem ? [`The project was not read: ${problem}.`] : []),
      'Pass the project next time (name, description, repo_url, chains, live_url) so EarnKit can match it and pre-fill each form.',
    ].join('\n'),
    since: { from: null, new: [], changed: [], closing: [] },
    ready: [], gaps: [], ledger, ask_outcome: [], as_reported: false, ...unlinkedPart(), linked: ctx.builderId !== null,
    ...(link ? { sign_in: link } : {}),
  };
}

/** The unlinked installation's sign-in link, or null (never a failure). */
const linkOf = (ctx: FindContext) => (ctx.linkUrl ?? (() => signInLink(ctx.installationId, ctx.now)))().catch(() => null);

/** An unlinked find: every record field empty (find adds the blockers the empty record has). */
const unlinkedPart = (): Pick<FindReply, 'linked' | 'record_missing' | 'blockers' | 'evidence_summary' | 'applied_overnight' | 'released' | 'auto_apply'> => ({
  linked: false, record_missing: [], blockers: [], evidence_summary: null, applied_overnight: [], released: [], auto_apply: false,
});

/** The record's part of the reply, for a linked find. */
function linkedPart(side: RecordSide, rows: ProgramRow[], released: string[], overnight: FindReply['applied_overnight']) {
  const policy = side.record.policy;
  return {
    linked: true,
    record_missing: missingFor(rows, side.record, side.verifiedUsage !== null),
    blockers: blockersOf(rows, side.record),
    evidence_summary: side.summary,
    applied_overnight: overnight,
    released,
    auto_apply: policy.auto_apply,
    ...(policy.auto_apply ? { max_per_night: policy.max_per_night } : {}),
  };
}

export async function find(ctx: FindContext, input: unknown): Promise<FindReply | ProgramReply> {
  const i = FindInput.parse(input ?? {});
  const parsed = i.project === undefined ? null : parseProject(i.project);
  const project = parsed?.ok ? parsed.project : null;
  const problems = parsed?.ok ? [...parsed.problems] : [];
  if (i.program_id) return oneProgram(ctx, i.program_id, project, i.project_id);
  if (!project) return openList(ctx, parsed && !parsed.ok ? parsed.problem : null);

  const facts = await factsOf(project, ctx);
  problems.push(...(facts.problems ?? []));
  const open = await listOpenPrograms(ctx.now);
  const owner = ownerOf(ctx);
  // The record is read only for a linked installation.
  const side = ctx.builderId === null ? null : await recordSide({
    builderId: ctx.builderId, now: ctx.now, projectId: i.project_id, facts,
    read: ctx.evidence ?? ((s) => readEvidence(s, { now: ctx.now, ...(ctx.gh ? { gh: ctx.gh } : {}) })),
  });
  if (side) problems.push(...side.problems);
  const released = side ? await releaseStale(owner, ctx.now) : [];
  const skip = await excluded(owner);
  const all = i.filter?.all === true;
  // The never list is the only policy that hides a program; the approval's limits only stop the agent sending alone.
  const listed = side ? notNever(side.record) : () => true;
  const programs = open.filter((r) => !skip.has(r.id) && listed(r) && (!i.filter?.category || categoryOf(r.file) === i.filter.category));
  const byId = new Map(programs.map((r) => [r.id, r]));
  const done = await doneByProgram(owner);
  // The builder's own tier when one was read; else (unlinked, or linked before any read: R3c) the tier the public code
  // read alone supports, none when it was not read. The provisional tier is never shown as evidence.
  const provisional = provisionalTier(facts);
  const verdicts = programs
    .map((r) => evaluate(r, facts, done.get(r.id) ?? new Set<string>(), ctx.now))
    .map((v) => {
      const row = byId.get(v.program_id)!;
      return side?.tier ? tierGate(v, row, side.tier, side.summary?.line) : provisionalGate(v, row, provisional);
    });

  const readyV = rankReady(verdicts.filter((v) => v.status === 'ready'), byId);
  const gapV = rankGaps(verdicts.filter((v) => v.status === 'gap'), byId);
  // Remote and in-person ready programs are capped apart, each in rank order, so the default list always leads with
  // something the builder can apply to now.
  const shownReady = shownReadyOf(readyV, all, (v) => byId.get(v.program_id)!.file.in_person);
  const shownGaps = all ? gapV : gapV.slice(0, MAX_GAPS);
  const more = readyV.length - shownReady.length + gapV.length - shownGaps.length;
  // In display order with the numbers the builder sees: ready, gaps, then in person.
  const holds = side ? await claimed(owner) : new Map<string, { since: string }>();
  const { ready, gaps } = numbered(
    shownReady.map((v) => {
      const r = readyOf(byId.get(v.program_id)!, v, facts, ctx.now, side);
      const hold = holds.get(v.program_id);
      return hold ? { ...r, claimed_since: hold.since } : r;
    }),
    shownGaps.map((v) => gapOf(byId.get(v.program_id)!, v)),
  );

  const last = await lastFindAt(ctx.installationId);
  const overnight = side ? await appliedOvernight(owner, last) : [];
  const link = side ? null : await linkOf(ctx);
  const moved = await since(owner, last, open, ready.map((r) => r.program_id), ctx.now, gaps.map((g) => g.program_id));
  const ledger = await summary(owner, open, ctx.now);
  const ask = await askOutcome(owner, open, ctx.now);
  await markAsked(owner, ask.map((a) => a.program_id), ctx.now);

  const r: Omit<FindReply, 'show_to_builder' | 'agent_note'> = {
    since: moved, ready, gaps,
    ...(all ? { not_fit: verdicts.filter((v) => v.status === 'no').map((v) => ({ program_id: v.program_id, title: byId.get(v.program_id)!.file.title, reason: v.reason ?? 'does not fit' })) } : {}),
    ledger, ask_outcome: ask, as_reported: facts.as_reported,
    ...(problems.length > 0 ? { problems } : {}),
    ...(side
      ? linkedPart(side, ready.map((p) => byId.get(p.program_id)!), released, overnight)
      : { ...unlinkedPart(), blockers: blockersOf(ready.map((p) => byId.get(p.program_id)!), EMPTY_RECORD), ...(link ? { sign_in: link } : {}) }),
  };
  // Every gap of this find (not only the shown ones), in rank order, so track started can say what is still missing.
  await markFind(ctx.installationId, ctx.now, Object.fromEntries(gapV.slice(0, MAX_REMEMBERED_GAPS).map((v) => [v.program_id, v.gaps[0].what])));
  return { show_to_builder: replyText(r, last === null), agent_note: agentNote(r, { more }), ...r };
}
