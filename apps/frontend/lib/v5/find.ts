/**
 * The find tool: what a project can earn now (ready, pre-filled), what is one change away, what
 * moved since the last find, and the ledger; or one program's details; or, with no project, the
 * open list. Linked, it also reads the builder's record (lib/v6/find-record.ts). EarnKit writes no prose.
 */
import { z } from 'zod';
import { cleanText, quoteName } from './controls';
import { getBuilder, getRecord, ownerKey, takeUnlinkedNotice, unlinkedReason, withRecord } from '../v6/builders';
import { appliedOvernight, CLAIM_HOURS, releaseStale, type Released } from '../v6/claims';
import { readEvidence, type Evidence, type Subject } from '../v6/evidence';
import { blockersOf, gateFor, notNever, missingFor, recordSide, sharedRepoProjects, storedRecordContext, type Blocker, type RecordSide } from '../v6/find-record';
import { EMPTY_RECORD, unapprovedSince } from '../v6/record';
import { signInLink } from '../v6/record-tool';
import { DELETED_NOTICE, NO_RECORD_PROJECT, linkedNoticeLine, signInLine, signInSentence, unlinkedNoticeLine } from '../v6/reply-words';
import { closeDay, closesWords, dayWords, programZone } from './deadline';
import { evaluate, keywordHit, lookedAgain, rulesOnly, unlikely, type Gap, type Verdict } from './eligibility';
import { guideLines, guideText, type Guide } from './guide';
import { clearPromised, lastFindAt, lastList, lastListIds, lastOfferOf, lastProjectKey, listHash, markFind, markFindAuto, markList, markNextNeeds, markOffer, markPromised, newlyLinkedLogin, promisedOf, rememberProject, stableNumbers, type Promised } from './installations';
import { ALREADY_SENT_REPO, applicationsLine, applicationsOf, type ApplicationItem, askOutcome, autoSentSince, claimed, codeDoneAt, doneOn, excluded, heldUnder, joinDecision, joinRows, markAsked, NOT_YOUR_REPO, sentForRepo, CANT_CONFIRM_REPO, SIGN_IN_FIRST_LINK, SIGN_IN_FIRST_SAY, outcomeAsksDue, rekeyByRepoId, rekeyProject, repoKeyOf, reportOf, resolvedKey, resultOf, resultWords, resultsDateOf, saveReport, sentOf, summary, type Ledger, type OutcomeDue } from './ledger';
import { EARNKIT_CUT_NOTE, prefill, type Field, type RecordContext } from './prefill';
import { PROGRAM_CATEGORIES, categoryOf, eligibilityOf, ruleNotes, type Category, type Program } from './program-file';
import { closedAt, getProgram, isOpenAt, statusAt, listOpenPrograms, listRef, programByName, unknownProgramLine, type ProgramRow } from './programs';
import { moneyAt, moneyOf as tileMoney } from './programs-read';
import { ProjectArg, SHORT_LINK_NOTE, isShortener, nameKeyOf, parseProject, projectKeyOf, type Project } from './project-input';
import { inputError, readLoosely, refuse, type LooseRules } from './tool-input';
import { offChain, rankGaps, rankReady, shownGapsOf } from './rank';
import { sql } from './db';
import { cachedRepoFacts, cachedRepoId, cachedRepoLink, cachedRepoParent, repoEvidence, repoFacts, repoTie, reportOnlyFacts, type RepoFacts, type RepoNote } from './repo-facts';
import { FULL_RULE_SAY, sendableOf, AGENT_FIELDS, CONTRACT_NOTE, SAME_PROJECT, CUT_NOTE, NO_PROJECT_NOTE, standingNote, STANDING_ONE, STOP_NOTE, contractLookedAgain, droppedNote, RULE_NOTE, reportLines, sinceLine, agentNote, canDo, closingLine, gapAction, gapActionStep, gapLine, inPersonLine, notFitLine, numbered, readyLine, replyParts, ruleSentence, hasProof, signInOnly, tonightOf, yesStands, type OfferKind } from './reply';
import { since, type Since } from './since';

/**
 * find as agents see it (v6.1.14 T5: track's project schema), registered leniently (L13-4): `find` reads the arguments
 * with FIND_LOOSE, then FindInput.
 */
export const FindArgs = z.object({
  project: ProjectArg.optional(),
  program_id: z.string().max(100).optional().describe("One program's id or its name: its details, rules and form instead of the match"),
  project_id: z.string().max(40).optional().describe("The record's project to match and fill from; omit to pick by the repo"),
  ask: z.string().max(40).optional().describe("With program_id: 'rules' when the builder asks for the program's rules"),
  filter: z
    .object({
      category: z.enum(PROGRAM_CATEGORIES).optional(),
      all: z.boolean().optional().describe('true for every program, including the ones that do not fit, with the reason'),
    })
    .optional(),
});

/** L13-4 (v6.1.14): a null or string project, a numeric or over-long id, a string filter.all read as plain input. */
const FIND_LOOSE: LooseRules = {
  text: ['program_id', 'project_id', 'ask'],
  cut: { program_id: 100, project_id: 40, ask: 40 },
  objects: ['project', 'filter'],
  booleans: ['filter.all'],
  enums: { 'filter.category': PROGRAM_CATEGORIES },
};

/** The arguments as find reads them: FIND_LOOSE, then any field FindInput still refuses dropped and named. Pure. */
export function findInputOf(input: unknown): { i: z.infer<typeof FindInput>; unread: string[]; error?: string } {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  // L1i-1 (v6.1.16.1, L29-12, L29-14): an unknown top-level key, or a project with no name, is an input error: no builder
  // text, isError true, the note naming the field. A project fact passed beside project stays a problems line (below).
  const unknown = Object.keys(raw).filter((k) => !Object.hasOwn(FindArgs.shape, k) && !Object.hasOwn(ProjectArg.shape, k));
  if (unknown.length > 0)
    return { i: {}, unread: [], error: `${unknown.map((k) => cleanText(k, 40)).join(', ')}: not a find argument (find takes project, program_id, project_id, ask and filter)` };
  const p = raw.project;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const named = parseProject(p);
    if (!named.ok && named.problem.startsWith('name: ')) return { i: {}, unread: [], error: `project.name: ${named.problem.slice('name: '.length)} (the project name is required)` };
  }
  const read = readLoosely(input, FIND_LOOSE);
  const { args } = read;
  // L29-13 (v6.1.16 Task 15): an unknown category is named with the four it can be.
  const category = (raw.filter as { category?: unknown } | undefined)?.category;
  const problems = read.problems.map((p) =>
    p.startsWith('filter.category dropped') ? `category ${JSON.stringify(cleanText(String(category), 40))} was not read: use ${PROGRAM_CATEGORIES.slice(0, -1).join(', ')} or ${PROGRAM_CATEGORIES.at(-1)}` : p);
  // L29-14 (v6.1.16 Task 15): a project fact passed beside project, never read there, is named.
  for (const k of Object.keys(raw)) if (k !== 'project' && Object.hasOwn(ProjectArg.shape, k)) problems.push(`${k} belongs inside project`);
  let r = FindInput.safeParse(args);
  if (!r.success) {
    for (const k of new Set(r.error.issues.map((x) => String(x.path[0] ?? '')))) {
      delete args[k];
      problems.push(`${k || 'input'} dropped: ${k === 'filter' ? 'not read' : 'not text'}`);
    }
    r = FindInput.safeParse(args);
  }
  return { i: r.success ? r.data : {}, unread: problems };
}

export const FindInput = z.object({
  project: z.unknown().optional(),
  program_id: z.string().max(100).optional(),
  project_id: z.string().max(40).optional(),
  /** 'rules': the builder asked for the program's rules, so the one-program reply shows the list (v6.1.8, 1b). Any
   *  other value is ignored. */
  ask: z.string().max(40).optional(),
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
  /** The notes of all the program's rules; a ready program has confirmed them, so its line shows none (v6.1.6). */
  rules: string[];
  /** The number the builder sees (and says) for it. */
  n: number;
  /** Set while another agent of the builder's holds a claim on it (track started). */
  claimed_since?: string;
  /** L24-4 (v6.1.16 Task 11): the builder held it (track held): listed on hold, never sent until a started lifts it. */
  held?: true;
  /** The builder confirmed its rules (track gap_done) or, F3 (v6.1.10), said real people use it: that yes stands, so
   *  the closing asks for no second one (v6.1.9). */
  rule_yes?: true;
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
  /** The notes of all the program's rules; the unconfirmed ones are rule gaps in `gap`/`also` (v6.1.6). */
  rules: string[];
  in_person: boolean;
  /** What taking part needs before applying; in person, its attend sentence is in the gap line (R18d). */
  setup: string[];
  /** The number the builder sees (and says) for it. */
  n: number;
  /** N-5 (v6.1.9): what the builder marked done that the read still does not find, each said once after the line. */
  looked_again?: string[];
  /** O1 (v6.1.10): set when it closes within 14 days ("in 2 days"; L1e-6, v6.1.13: every kind of line), said on its line. */
  closes_in?: string;
  /** L1e-5 (v6.1.13): its rule's keywords are in the project's words, so the closing's rule question names it first. */
  keyword_hit?: true;
  /** L1g-8b (v6.1.16): its gaps hold the public repo: not ready for this repo, so its rule is never the closing's question. */
  public_first?: true;
  /** L1g-8b (v6.1.16): its keyword rule is named nowhere in the project (full list only), so its rule is asked only when no step is shown. */
  unlikely?: true;
};
export type FindReply = {
  show_to_builder: string;
  /** Linked: answers an agent's change took back from approval since this agent's last find (v6.1.8 C48). */
  approvals_again?: number;
  agent_note: string;
  since: Since;
  ready: ReadyProgram[];
  gaps: GapProgram[];
  not_fit?: { program_id: string; title: string; reason: string }[];
  ledger: Ledger;
  /** L29-1 (v6.1.16 Task 15): every application by name, newest first; the builder's line names five. */
  applications?: ApplicationItem[];
  /** L29-7 (v6.1.16 Task 15): in the JSON, `ready` is what the agent may send; these two are the ready programs the
   *  builder applies to in person, and the ones the builder presses submit on (or that need their click). */
  in_person?: ReadyProgram[];
  you_send?: ReadyProgram[];
  /** L29-26 (v6.1.16 Task 15): the default view left programs or lines out ("say more" is filter.all). */
  more?: boolean;
  /** L23-4 (v6.1.16): applied programs past their results date with no result, that this installation has not asked
   *  about today; the builder text asks each. */
  ask_outcome: OutcomeDue[];
  as_reported: boolean;
  problems?: string[];
  /** What the builder is told about the repo read, one sentence each (v6.1.8, B20 and C59). */
  repo_notes?: RepoNote[];
  linked: boolean;
  record_missing: string[];
  blockers: Blocker[];
  evidence_summary: { tier: string | null; line: string } | null;
  applied_overnight: { program_id: string; title: string }[];
  /** Claims left unsent for 24 hours, released by this find (L23-7, v6.1.16: with their titles and start times). */
  released: Released[];
  /** L23-1 (v6.1.16): programs a standing-approval line named over 24 hours ago with nothing recorded since, and when. */
  not_sent?: { programs: Promised[]; since: string };
  /** L23-16 (v6.1.16): the shown list is the same as at the last project find, which was at this time (ISO). */
  nothing_new_since?: string;
  auto_apply: boolean;
  /** With auto_apply: the most the agent applies to in one night. */
  max_per_night?: number;
  /** With auto_apply: the sends under standing approval in the last 24 hours, which tonight's list leaves room for (v6.1.9 N1). */
  auto_sent_today?: number;
  /** With auto_apply (L13-9, v6.1.14): what the agent sends alone tonight, over every ready program, not only the shown
   *  ones; `limit_used`: there were some to send and the night's limit left no room. */
  tonight?: { programs: { program_id: string; title: string }[]; limit_used: boolean };
  /** Unlinked with sign-in configured: the link that links this installation to a builder. */
  sign_in?: string;
  /** The first find after a link: the GitHub account it linked to, as the closing block's last sentence (security M2);
   *  after an unlink on /me: that it was unlinked, with the sign-in link (v6.1.7 B10). */
  linked_notice: string | null;
};
export type ProgramReply = {
  refused?: true;
  show_to_builder: string; agent_note: string; program: Omit<Program, 'reviewers_contact'> | null; fields: Field[]; guide: Guide | null; verdict?: Verdict;
  /** The program's rules EarnKit cannot check, each its own "Their rule" line (v6.1.6). */
  rules: string[];
  /** Unlinked, when signing in is the one step left: the sign-in link its action line gives (v6.1.8 fix round 1). */
  sign_in?: string;
  /** Whether the installation is linked, as the default find says it (v6.1.14 fix round 1, F3). */
  linked: boolean;
  /** L24-29 (v6.1.16 Task 11): what the project report had dropped or cut, as the list reply names them. */
  problems?: string[];
};
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
/** Fix round 1 (M4, v6.1.16 Task 15): the open list (no project) names this many programs, then the count. */
const OPEN_SHOWN = 5;

/** O1 (v6.1.10): a program closing within this many days is always in the default reply, ahead of the caps. */
const SOON_DAYS = 7;
/** Whether the program closes within SOON_DAYS of `now` (and is not closed). Pure. */
export const closingSoon = (p: Pick<Program, 'ends_at'>, now: Date): boolean => {
  const left = p.ends_at ? Date.parse(p.ends_at) - now.getTime() : NaN;
  return left > 0 && left <= SOON_DAYS * 86_400_000;
};

/** L1e-6 (v6.1.13): a list line says when it closes from this many days out, whatever the program's kind. */
const DATE_DAYS = 14;
/** Whether the program closes in DATE_DAYS whole days or fewer (the "in N days" the line says; not closed). Pure. */
const closesWithinDate = (p: Pick<Program, 'ends_at'>, now: Date): boolean => {
  const left = p.ends_at ? Date.parse(p.ends_at) - now.getTime() : NaN;
  return left > 0 && left < (DATE_DAYS + 1) * 86_400_000;
};

/** The first `n` of `xs` in order, plus every one closing soon (O1, v6.1.10) wherever it is. Pure. */
export function cappedOf<T>(xs: T[], n: number, soon: (v: T) => boolean = () => false): T[] {
  const kept: T[] = [];
  for (const v of xs) if (soon(v) || kept.length < n) kept.push(v);
  return kept;
}

/** The ready list shown: all of it when `all`, else the first MAX_READY remote then the first MAX_IN_PERSON in person,
 * each in input (rank) order, plus any closing soon (`soon`, O1) past the caps. Zero remote leaves only the in-person
 * slots. */
export function shownReadyOf<T>(readyV: T[], all: boolean, inPerson: (v: T) => boolean, soon: (v: T) => boolean = () => false): T[] {
  if (all) return readyV;
  const remoteV = readyV.filter((v) => !inPerson(v));
  const attendV = readyV.filter(inPerson);
  return [...cappedOf(remoteV, MAX_READY, soon), ...cappedOf(attendV, MAX_IN_PERSON, soon)];
}

/**
 * L29-7 (v6.1.16 Task 15): the reply's JSON lists: `ready` is what the agent may send; `in_person` the ready programs
 * the builder attends; `you_send` the ones the builder presses submit on. Each keeps its number. Pure.
 */
function jsonLists<T extends Omit<FindReply, 'show_to_builder' | 'agent_note'>>(r: T): T & Pick<FindReply, 'in_person' | 'you_send'> {
  const click = new Set(r.blockers.filter((b) => b.needs_click).map((b) => b.program_id));
  return {
    ...r,
    ready: r.ready.filter((p) => !p.in_person && !click.has(p.program_id)),
    in_person: r.ready.filter((p) => p.in_person),
    you_send: r.ready.filter((p) => !p.in_person && click.has(p.program_id)),
  };
}

/** Whose ledger this find reads: the builder's once linked, else the installation's. Pure. */
const ownerOf = (ctx: FindContext) => ownerKey(ctx.installationId, ctx.builderId);

/** The money as the tile and the guide show it (`moneyOf` in programs-read), lowercase mid-sentence (#12, I2,
 *  v6.1.15): one reader, so a reply, a tile and a guide never disagree. Pure. */
export const moneyOf = (p: Program): string => moneyAt(tileMoney(p), 'mid');
/** The closes wording without "closes " (L23-9, v6.1.16): "in under an hour", "today", "tomorrow", "in 5 days", "Nov 20". */
const closesIn = (p: Program, now: Date) => (p.ends_at && Date.parse(p.ends_at) > now.getTime() ? closesWords(p.ends_at, now, programZone(p)).replace(/^closes /, '') : null);
const EMPTY_FACTS: RepoFacts = {
  name: '', description: '', repo_url: null, repo_url_basis: null, live_url_basis: null, demo_url_basis: null, public: false, as_reported: true, live_url: null, demo_url: null, chains: [], contracts: [],
  builder_codes: false, integrations: [], users: null, first_commit_at: null, last_commit_at: null, readme_excerpt: null, homepage: null,
};

/** A read that fails is the agent's report alone (repoFacts falls back the same way when GitHub fails). A code change
 *  the builder marked done since the cached read makes the read check for a push (v6.1.9 S4). */
async function factsOf(project: Project, ctx: FindContext, key: string): Promise<RepoFacts> {
  try {
    const staleAfter = await codeDoneAt(ownerOf(ctx), key);
    return await repoFacts(project, { gh: ctx.gh, now: ctx.now, installationId: ctx.installationId, staleAfter });
  } catch {
    // v6.1.14 (L1f-1): the report alone, never marked private for a failed read (a private repo is a step from open source programs).
    return reportOnlyFacts(project);
  }
}

/** F3 (v6.1.10): the builder said real people use it to a program that asks (its own users item, or a used bar on a
 *  chainless project): that yes stands as a rule's does. Only the builder's own yes, relayed as gap_done users (final
 *  round, I2): a users: true the agent passed still settles the users item, but it is no yes to send. Pure. */
const usersYes = (p: Program, facts: RepoFacts, done: Set<string>): boolean =>
  (eligibilityOf(p).some((i) => i.kind === 'users') || (p.min_tier === 'used' && facts.chains.length === 0)) && done.has('users');

function readyOf(row: ProgramRow, v: Verdict, facts: RepoFacts, now: Date, side: RecordContext | null, done: Set<string> = new Set()): Omit<ReadyProgram, 'n'> {
  const p = row.file;
  const rec = side ? { record: side.record, projectId: side.projectId, verifiedUsage: side.verifiedUsage } : null;
  const { fields, filled, facts_from_repo, repo_required, from_record, total, need_you } = prefill(row, facts, rec);
  return {
    program_id: row.id, title: p.title, money: moneyOf(p), max_award_usd: p.max_award_usd ?? null, category: categoryOf(p),
    closes_at: p.ends_at, closes_in: closesIn(p, now), long_shot: v.long_shot, in_person: p.in_person, submission_url: p.submission_url,
    ...(p.form ? { form: p.form } : {}),
    fields, filled, facts_from_repo, repo_required, from_record, need_you, total,
    // Lane 8 #8 (v6.1.10): the builder's answers are need_you itself, so the line and the count never disagree.
    needs: [...p.setup, ...need_you],
    setup: p.setup,
    rules: v.rules,
    ...((v.rules.length > 0 && [...done].some((k) => k.startsWith('rule:'))) || usersYes(p, facts, done) ? { rule_yes: true as const } : {}),
  };
}

const gapOf = (row: ProgramRow, v: Verdict, done: Set<string> = new Set(), now?: Date, hit = false, unlikelyHere = false): Omit<GapProgram, 'n'> => {
  const again = lookedAgain(v.gaps, done);
  const left = now && closesWithinDate(row.file, now) ? closesIn(row.file, now) : null;
  return {
    program_id: row.id, title: row.file.title, money: moneyOf(row.file), max_award_usd: row.file.max_award_usd ?? null,
    category: categoryOf(row.file), closes_at: row.file.ends_at, gap: v.gaps[0], also: v.gaps.slice(1), rules: v.rules,
    in_person: row.file.in_person, setup: row.file.setup, ...(again.length > 0 ? { looked_again: again } : {}),
    ...(left ? { closes_in: left } : {}),
    ...(hit ? { keyword_hit: true as const } : {}),
    ...(v.gaps.some((x) => x.item === 'repo:public') ? { public_first: true as const } : {}),
    ...(unlikelyHere ? { unlikely: true as const } : {}),
  };
};

/** L24-2 (v6.1.16 Task 11): the kind of the `Say` a one-program gap action offers, null when it offers none. Pure. */
const actionOffer = (action: string | null): OfferKind | null =>
  action === null ? null : /^Say "do"/.test(action) ? 'do' : /^Say yes if /.test(action) ? 'draft' : /^Say yes/.test(action) ? 'apply' : null;

/**
 * The verdict as the find list would render it, without the number, then its one action (v6.1.8, 1b): ready, yes and
 * EarnKit applies (or drafts, when the builder presses submit); a gap, its action (`gapAction`); not a fit or in
 * person, the line alone. The rules list only when asked (`withRules`), between the line and the action. With the
 * lines, the kind of the `Say` they offer (L24-2, v6.1.16 Task 11): "Your yes stands" only after an apply offer
 * (`lastOffer`); a program on the standing-approval list (`standing`, L24-13) closes on STANDING_ONE. Pure.
 */
function verdictText(row: ProgramRow, v: Verdict, ready: () => Omit<ReadyProgram, 'n'>, o: { linked: boolean; now: Date; draftOnly: boolean; rules: string[]; signIn: string | null; done: Set<string>; lastOffer: OfferKind | null; standing: boolean }): { lines: string[]; offer: OfferKind | null } {
  const p = row.file;
  if (v.status === 'no') return { lines: [notFitLine(p.title, moneyOf(p), v.reason ?? 'does not fit'), ...o.rules], offer: null };
  if (v.status === 'gap') {
    const g = { ...gapOf(row, v, o.done, o.now), n: 0 };
    // Review Focus 2 (v6.1.14): the proof gap's sign-in is asked once, last; when it is the only step it is the action.
    const signLast = o.signIn && !signInOnly([g.gap, ...g.also]) ? o.signIn : null;
    const action = gapAction(g, o.signIn);
    // FR-1 (final fix): the step the action closes on is said there only, as in the list reply.
    return { lines: [gapLine(g, true, gapActionStep(g, o.signIn)), ...o.rules, action, signLast].filter((l): l is string => l !== null), offer: actionOffer(action) };
  }
  const r = { ...ready(), n: 0 };
  if (r.in_person) return { lines: [inPersonLine(r, true), ...o.rules], offer: null };
  if (o.standing) return { lines: [readyLine(r, o.linked, o.now, true), ...o.rules, STANDING_ONE], offer: 'stop' };
  // Fix round 1 (v6.1.10): the yes stands only for a fully ready program, nothing left in need you. L1e-3 (v6.1.13): one
  // the builder submits too, in the draft wording. L24-2 (v6.1.16 Task 11): only after an apply offer.
  const said = r.rule_yes && yesStands(o.lastOffer);
  const stands = said && r.need_you.length === 0 ? [r.title] : [];
  const yesStandsFor = o.draftOnly ? [] : stands;
  const draftStands = o.draftOnly ? stands : [];
  // N3 (v6.1.12): the yes stands for one that still needs answers too; the closing names them, never a second yes.
  const yesWaits = said && r.need_you.length > 0 ? [{ title: r.title, needs: r.need_you, ...(o.draftOnly ? { draft: true as const } : {}) }] : [];
  // Review Focus 1 (v6.1.14): the closing names the needs of a yes that waits, so the line does not.
  const c = closingLine({ ready: 1, draftOnly: o.draftOnly, gaps: 0, firstRule: null, inPerson: 0, held: 0, yesStands: yesStandsFor, draftStands, yesWaits, title: r.title });
  return { lines: [readyLine(r, o.linked, o.now, true, () => false, yesWaits.length > 0), ...o.rules, c.text], offer: c.offer };
}

/** One program: its file, its fields (for the project, when given) and the verdict, said as the find line says it. */
async function oneProgram(ctx: FindContext, id: string, project: Project | null, projectId: string | undefined, ask: string | undefined, key: string, given: string[] = []): Promise<ProgramReply> {
  // v6.1.9: the id, or what the builder calls it ("yc", "Y Combinator"), when it names one program; F4 (v6.1.12): its
  // organizer too, and several are asked about. L35-6 (v6.1.16.1 Task 2): a list reference ("#3", "3.", "No. 3",
  // "three") is the last list's program; any other reference falls to the name lookup.
  const ref = (await getProgram(id)) ? null : listRef(id, await lastListIds(ctx.installationId));
  if (ref) id = ref;
  const { row, suggest } = await programByName(id, ctx.now);
  // L24-2 (v6.1.16 Task 11): the last offer this installation showed, read before this reply replaces it.
  const lastOffer = await lastOfferOf(ctx.installationId);
  await markOffer(ctx.installationId, null, ctx.now);
  // L29-9, L29-15 (v6.1.16 Task 15): a refusal (isError), a question for the builder and the way on for the agent.
  if (!row)
    return refuse({
      show_to_builder: unknownProgramLine(suggest),
      agent_note: 'program_id takes the id or the name; a list number maps to the id in the JSON. Call find with the project for the programs it fits.', program: null, fields: [], guide: null, rules: [], linked: ctx.builderId !== null,
    });
  // Final fix (v6.1.12, I2): matched by another name, the first line names the program (every line here leads with it).
  const renamed = row.id !== id;
  id = row.id;
  const p = row.file;
  // reviewers_contact is the owner's only: never in a tool reply (security M1).
  const { reviewers_contact: _owner, ...pub } = p;
  const facts = project ? await factsOf(project, ctx, key) : EMPTY_FACTS;
  // Linked: the record fills first, as in the match. With a project, the same record side the list reads (the
  // 24-hour rule), so the two gate on the same tier (v6.1.8 final fix, I3); with none, the stored record alone.
  const side = ctx.builderId !== null && project
    ? await recordSide({ builderId: ctx.builderId, now: ctx.now, projectId, facts, read: readerOf(ctx) })
    : null;
  const rec: RecordContext | null = side ?? (ctx.builderId === null ? null : await storedRecordContext(ctx.builderId, projectId, facts.repo_url, null));
  const { fields } = prefill(row, facts, rec);
  const fitted = fields.some((f) => f.from === 'record');
  // Done steps are the project's own (v6.1.10 L1c-1); a track after this one without a project marks them on it.
  if (project) await rememberProject(ctx.installationId, key);
  // L1e-4 (v6.1.13): a project item (users) done on any program of the project counts here; a yes said is this program's own.
  const doneHere = project ? await doneOn(ownerOf(ctx), key) : null;
  const done = doneHere?.of(id) ?? new Set<string>();
  const ownDone = doneHere?.own.get(id) ?? new Set<string>();
  const verdict = project ? gateFor(side, facts)(evaluate(row, facts, done, ctx.now), row) : undefined;
  // L24-29 (v6.1.16 Task 11): the project's problems, as the list reply carries them.
  const problems = project ? [...given, ...(facts.problems ?? []), ...(side?.problems ?? [])] : [];
  const left = closesIn(p, ctx.now);
  // L23-2 (v6.1.16): open or closed from the clock (`isOpenAt`, `closedAt`), whatever status the daily run last wrote.
  const open = isOpenAt(p, ctx.now);
  const closed = closedAt(p, ctx.now);
  // Fix round 1 (M1): an upcoming program past its start reads open, as isOpenAt says.
  const upcoming = statusAt(p, ctx.now) === 'upcoming';
  const when = closed ? 'closed' : upcoming ? null : left ? `closes ${left}` : 'rolling';
  const guide = guideText(row, ctx.now);
  // The rules list stays in guide.rules; the builder sees it only with no project (no verdict to give) or on asking.
  const guideRules = !project || ask === 'rules' ? guideLines(guide) : [];
  // Their rules: what the program requires that EarnKit cannot check, each its own line after the money (v6.1.6).
  const rules = ruleNotes(p);
  // L16-7 (v6.1.16): a program with a result shows the result, never a yes, a step or a sign-in.
  // L28-4 (v6.1.16 Task 14): this project's result only.
  const result = project ? await resultOf(ownerOf(ctx), id, key) : null;
  if (result) {
    const words = resultWords(result.status, result.amounts);
    return {
      show_to_builder: [`${p.title}, ${moneyOf(p)}.`, `${words[0].toUpperCase()}${words.slice(1)}.`].join('\n'),
      agent_note: 'This program already has a result; nothing to send.',
      program: pub, fields, guide, ...(verdict ? { verdict } : {}), rules, linked: ctx.builderId !== null,
    };
  }
  // An upcoming program opens with when it opens, and offers nowhere to apply yet (v6.1.7, C10).
  const opens = (p.opens_note ?? 'no date announced').trim().replace(/\.+$/, '');
  // The builder presses submit: yes drafts it for them to send (C44).
  const draftOnly = p.submit === 'builder' || rec?.record.policy.agent_may_submit === false;
  // Unlinked, with the proof among the gaps: the sign-in sentence with its link, once, as the list closes (v6.1.14); the
  // action itself when it is the one step left.
  const signStep = open && ctx.builderId === null && verdict?.status === 'gap' && !p.in_person && hasProof(verdict.gaps);
  const link = signStep ? await linkOf(ctx) : null;
  // Fix round 1 (v6.1.14, F2): with no link to give, the sign-in is still said, without one.
  const signIn = signStep ? signInSentence(link, !facts.as_reported && !(facts.notes ?? []).includes('empty'), true) : null;
  // L23-18 (v6.1.16): a closed program the builder sent says when, and when results come.
  const sent = closed ? await sentOf(ownerOf(ctx), id, key) : null;
  const due = sent ? resultsDateOf(row) : null;
  // L23-8 (v6.1.16): another agent of the builder's holds a live claim on it: that is said in place of the yes.
  const hold = open ? (await claimed(ownerOf(ctx), (x) => x === key || (x !== null && x === projectId))).get(id) : undefined;
  const heldSince = hold && !hold.held && hold.by !== ctx.installationId && Date.parse(hold.since) > ctx.now.getTime() - CLAIM_HOURS * 3_600_000 ? hold.since : null;
  // L24-13 (v6.1.16 Task 11): a ready program the standing approval sends alone (the list's tonightOf over this one).
  const policy = side?.record.policy ?? (ctx.builderId !== null ? rec?.record.policy : undefined);
  const standing = open && !heldSince && !hold?.held && verdict?.status === 'ready' && !p.in_person && policy?.auto_apply === true && rec !== null
    && tonightOf({
      auto_apply: true, max_per_night: policy.max_per_night,
      auto_sent_today: await autoSentSince(ownerOf(ctx), new Date(ctx.now.getTime() - 86_400_000)),
      ready: [{ ...readyOf(row, verdict, facts, ctx.now, rec, ownDone), n: 1 }], blockers: blockersOf([row], rec.record),
    }).list.length === 1;
  const said = !closed && !upcoming && verdict
    ? verdictText(row, verdict, () => readyOf(row, verdict, facts, ctx.now, rec, ownDone), { linked: ctx.builderId !== null, now: ctx.now, draftOnly, rules: guideRules, signIn, done, lastOffer, standing })
    : null;
  let offer: OfferKind | null = said?.offer ?? null;
  const show = closed
    // Low 20 (v6.1.13), L23-20 (v6.1.16): closed is said once, and a closed program's rules are not listed.
    ? sent
      ? [`${p.title}, ${moneyOf(p)}.`, `Closed. You applied ${dayWords(sent, ctx.now)}; results ${due ? dayWords(due, ctx.now) : 'not announced'}.`]
      : [`${p.title}, ${moneyOf(p)}, ${when}.`]
    : upcoming
      ? [`${p.title}, ${moneyOf(p)}. Not open yet: ${opens}.`, ...rules.map(ruleSentence), ...guideRules]
      : said
        ? said.lines
        : [`${p.title}, ${moneyOf(p)}${when ? `, ${when}` : ''}.`, ...rules.map(ruleSentence), ...guideRules];
  if (heldSince) {
    const heldLine = `Another agent of yours started this one on ${dayWords(new Date(heldSince), ctx.now)}.`;
    // The yes line (the ready closing, last) gives way to it; any other reply gets it as its last line.
    if (verdict?.status === 'ready' && !p.in_person) {
      show[show.length - 1] = heldLine;
      offer = null;
    } else show.push(heldLine);
  }
  const real = verdict?.status === 'gap' ? verdict.gaps.filter((g) => g.kind !== 'rule') : [];
  if (renamed && !show[0]?.includes(p.title)) show.unshift(`${p.title}.`);
  await markOffer(ctx.installationId, offer, ctx.now);
  const dropped = droppedNote(problems);
  return {
    show_to_builder: show.join('\n'),
    agent_note: (open
      ? !project
        ? ['Call find with the project for whether you fit.']
        : verdict?.status === 'no'
          ? ['It does not fit this project: draft nothing and submit nothing unless the builder asks again with a project it fits.']
          : [
              `Draft from fields: ${fitted ? `'record' and 'earnkit' values as given, ${CUT_NOTE}` : "'earnkit' values as given"}; ${AGENT_FIELDS}`,
              ...(fields.some((f) => f.from === 'earnkit' && f.fit === 'cut') ? [EARNKIT_CUT_NOTE] : []),
              ...(verdict?.gaps.some((g) => g.kind === 'rule') ? [RULE_NOTE] : []),
              ...(real.length === 0 && !verdict?.gaps.some((g) => g.kind === 'rule') ? [] : [SAME_PROJECT]),
              ...(link ? ['Show the sign-in link once as the reply gives it; once the builder has signed in, call find with program_id again.'] : []),
              ...(real.length === 0 || (link && signInOnly(real)) ? [] : canDo(real)
                ? ['On "do": make the gap\'s change (its details carry the docs), push, call track with gap_done and the gap\'s item, then call find with program_id again.']
                : ['The builder makes each change (never deploy a contract for them); when they say it is done, call track with gap_done and the gap\'s item, then call find with program_id again.']),
              ...(fitted ? ['Fit approved answers by cutting, never by adding; the style contract travels on each field.'] : []),
              ...(side?.problems.includes(NO_RECORD_PROJECT) ? [NO_PROJECT_NOTE] : []),
              ...(verdict?.status === 'gap' && contractLookedAgain(gapOf(row, verdict, done)) ? [CONTRACT_NOTE] : []),
              ...(ask === 'rules' ? [] : ["The program's rules are in guide.rules; show them only when the builder asks, or call again with ask 'rules'."]),
              ...(standing ? [standingNote([id]), STOP_NOTE] : []),
              ...(dropped ? [dropped] : []),
            ]
      : ['It takes no entries now: draft nothing and submit nothing. Call find with the project for what is open.']
    ).concat(heldSince ? ["Claimed by another of the builder's agents: do not submit it."] : []).join('\n'),
    program: pub,
    fields,
    guide,
    ...(verdict ? { verdict } : {}),
    rules,
    ...(problems.length > 0 ? { problems } : {}),
    ...(link ? { sign_in: link } : {}),
    linked: ctx.builderId !== null,
  };
}

/** L1i-6 (v6.1.16.1): a names-and-money line: "{title}, {money}, closes Dec 6, in person." (the close only when it has
 *  one, `closesWords`). Pure. */
export const openLine = (p: Program, now: Date): string => {
  const closes = closesIn(p, now) && closeDay(p, now) ? closesWords(p.ends_at!, now, programZone(p)) : null;
  return `${p.title}, ${moneyOf(p)}${closes ? `, ${closes}` : ''}${p.in_person ? ', in person' : ''}.`;
};

/** L1i-5 (v6.1.16.1): the agent line beside the full list's number ask. */
export const FULL_NUMBER_NOTE = "When the builder says a number from the full list, call find with that item's program_id.";
/** The open programs as a list, for a find with no project. `name` (L1g-2, v6.1.15): the name a project that could not
 *  be read still gave, so the closing asks for what it does by that name. */
async function openList(ctx: FindContext, problem: string | null, name: string | null = null, all = false): Promise<FindReply> {
  const programs = await listOpenPrograms(ctx.now);
  // Fix round 1 (M4, L29-26 v6.1.16 Task 15): within the 10-line budget: the first OPEN_SHOWN, then the count (template
  // row 12, v6.1.15: its own sentence). L1i-4 (v6.1.16.1): filter.all lists every open program, no cap. L1i-6: each line
  // keeps its close and in person.
  const shown = all ? programs : programs.slice(0, OPEN_SHOWN);
  const lines = shown.map((r) => openLine(r.file, ctx.now));
  if (programs.length > shown.length) lines.push(`And ${programs.length - shown.length} more.`);
  const ledger = await summary(ownerOf(ctx), programs, ctx.now);
  // L29-1, L29-2 (v6.1.16 Task 15): the applications by name whenever there are any, project or not; then the ask for
  // the project is one line, in place of the open list.
  const applications = await applicationsOf(ownerOf(ctx));
  const appsLine = applicationsLine(applications, ctx.now);
  const link = ctx.builderId === null ? await linkOf(ctx) : null;
  const notice = await linkedNotice(ctx, link);
  const ask = name ? `Tell me what ${name} does in a line, or its repo link, and I match it.` : 'Tell me which project and I match it.';
  const list = appsLine ? `${appsLine}\n${ask}` : programs.length > 0 ? `Open now:\n${lines.join('\n')}\n${ask}` : 'Nothing is open right now. Ask again any time and I show what is new.';
  // After an unlink the notice carries the link, in place of the plain sign-in line.
  const unlinkedNow = ctx.builderId === null && notice !== null;
  // Linked, the report a project find would give from this agent's last find (fix round 1): what moved, the answers
  // that wait again (C48) and what was sent under standing approval, in the closing block, since this find stamps.
  const report = ctx.builderId === null ? null : await linkedReport(ctx, programs);
  const closing = report ? [sinceLine(report, ctx.now), ...reportLines(report), notice].filter(Boolean).join(' ') : '';
  const reply = {
    // One line each, no blank lines (fix round 1, M4).
    show_to_builder: unlinkedNow
      ? `${list}\n${notice}`
      : report
        ? (closing ? `${list}\n${closing}` : list)
        : [list, link ? signInLine(link) : null, notice].filter(Boolean).join('\n'),
    agent_note: [
      ...(problem ? [`The project was not read: ${problem}.`] : []),
      'Pass the project next time (name, description, repo_url, chains, live_url) so EarnKit can match it and pre-fill each form.',
    ].join('\n'),
    since: report?.since ?? { from: null, new: [], changed: [], closing: [] },
    ready: [], gaps: [], ledger, applications, ask_outcome: [], as_reported: false, ...unlinkedPart(), linked: ctx.builderId !== null,
    ...(report ? { applied_overnight: report.applied_overnight, ...(report.approvals_again ? { approvals_again: report.approvals_again } : {}) } : {}),
    ...(link && notice !== DELETED_NOTICE ? { sign_in: link } : {}), linked_notice: notice,
  };
  // A find with no project is a find too (v6.1.8 C47): the linked notice shows once. The gaps stay as they were.
  await markFind(ctx.installationId, ctx.now);
  await noticeTaken(ctx, notice);
  return reply;
}

/** A linked open list's report from this agent's last find: since, the overnight sends and the answers waiting again. */
async function linkedReport(ctx: FindContext, programs: ProgramRow[]) {
  const owner = ownerOf(ctx);
  const last = await lastFindAt(ctx.installationId);
  const record = await getRecord(ctx.builderId!);
  return {
    since: await since(owner, last, programs, [], ctx.now),
    ready: [] as ReadyProgram[],
    applied_overnight: await appliedOvernight(owner, last),
    approvals_again: unapprovedSince(record, last),
  };
}

/**
 * Linked since the last find: the sentence that says to which GitHub account. Unlinked on /me since (v6.1.7 B10):
 * the unlinked line with `link`; the account deleted since: DELETED_NOTICE (v6.1.8 C51); each shown once: `noticeTaken` clears it after the reply is built, so a throw on the way
 * keeps it for the next find. Else null. Read before markFind.
 */
const linkedNotice = async (ctx: FindContext, link: string | null) => {
  if (ctx.builderId === null) {
    // The account was deleted (v6.1.8 C51): that line alone; unlinked on /me: the line with the sign-in link.
    const why = await unlinkedReason(ctx.installationId);
    return why === 'deleted' ? DELETED_NOTICE : why === 'unlinked' ? unlinkedNoticeLine(link) : null;
  }
  const login = await newlyLinkedLogin(ctx.installationId);
  return login ? linkedNoticeLine(login) : null;
};

/** Clears the unlinked mark once its line is in a built reply (final round, task 6 review). */
const noticeTaken = async (ctx: FindContext, notice: string | null) => {
  if (ctx.builderId === null && notice !== null) await takeUnlinkedNotice(ctx.installationId);
};

/** The builder's own evidence reader: the context's, else the live read. */
const readerOf = (ctx: FindContext) => ctx.evidence ?? ((s: Subject) => readEvidence(s, { now: ctx.now, ...(ctx.gh ? { gh: ctx.gh } : {}) }));

/** The unlinked installation's sign-in link, or null (never a failure). */
const linkOf = (ctx: FindContext) => (ctx.linkUrl ?? (() => signInLink(ctx.installationId, ctx.now)))().catch(() => null);

/** An unlinked find: every record field empty (find adds the blockers the empty record has). */
const unlinkedPart = (): Pick<FindReply, 'linked' | 'record_missing' | 'blockers' | 'evidence_summary' | 'applied_overnight' | 'released' | 'auto_apply'> & { released: Released[] } => ({
  linked: false, record_missing: [], blockers: [], evidence_summary: null, applied_overnight: [], released: [], auto_apply: false,
});

/** The record's part of the reply, for a linked find. */
function linkedPart(side: RecordSide, rows: ProgramRow[], released: Released[], overnight: FindReply['applied_overnight'], sentToday: number, repoPassed: boolean) {
  const policy = side.record.policy;
  return {
    linked: true,
    record_missing: missingFor(rows, side.record, side.verifiedUsage !== null, repoPassed),
    blockers: blockersOf(rows, side.record),
    evidence_summary: side.summary,
    applied_overnight: overnight,
    released,
    auto_apply: policy.auto_apply,
    ...(policy.auto_apply ? { max_per_night: policy.max_per_night, auto_sent_today: sentToday } : {}),
  };
}

/** The name a project report gave, as text and cut to 80 characters, or null (L1g-2, v6.1.15). Pure. */
function rawName(project: unknown): string | null {
  const name = project && typeof project === 'object' ? (project as { name?: unknown }).name : undefined;
  const t = typeof name === 'string' ? cleanText(name, 80) : '';
  return t || null;
}

/** The agent's line for arguments find could not read (L13-4, v6.1.14), or ''. Pure. */
/** Fix round 1 (N6, v6.1.16 Task 15): an item that says itself what was not read (L29-13, L29-14) is its own sentence. */
const OWN_SENTENCE = / was not read: | belongs inside project$/;
const unreadNote = (unread: string[]) => {
  const own = unread.filter((u) => OWN_SENTENCE.test(u));
  const rest = unread.filter((u) => !OWN_SENTENCE.test(u));
  return [...(rest.length > 0 ? [`Some arguments were not read: ${rest.join('; ')}.`] : []), ...own.map((u) => `${u}.`)].join(' ');
};

/** Whether the project report gives a shortened link in any link field (L16-8, v6.1.16). Pure. */
function shortLinkIn(project: unknown): boolean {
  if (!project || typeof project !== 'object') return false;
  const o = project as Record<string, unknown>;
  return ['repo_url', 'live_url', 'demo_url'].some((k) => isShortener(o[k]));
}

/** L28-5 (v6.1.16 Task 14): a name-only project with sends or steps meets a repo by that name: asked, never merged. */
export const JOIN_QUESTION = (name: string, repo: string): string => `Is ${quoteName(name)} the same as ${repo}? Say yes and I join them.`;
/** L28-5: the agent note beside JOIN_QUESTION. */
export const JOIN_NOTE = (name: string) =>
  `Until the builder says yes the two stay apart. On yes, call track with program_id join, status gap_done, item join:${name} and this project, then call find again.`;
/** L28-7 (v6.1.16 Task 14): two record projects share the repo and no project_id was passed. */
export const WHICH_PROJECT = (a: string, b: string): string => `Which project: ${quoteName(a)} or ${quoteName(b)}?`;
export const WHICH_PROJECT_NOTE = 'Two record projects share this repo, so nothing was filled from either. Ask which, then call find with its project_id.';
/** L28-3 (v6.1.16 Task 14): the agent note when the signed-in login has no public tie to the repo. */
export const NOT_YOUR_REPO_NOTE = 'The signed-in GitHub account is not the repo owner, in its org, or among its committers: do not apply with this repo.';
/**
 * FR-1, M1 (fix round 1): a builder line that offers an apply (a yes that EarnKit sends on, or a standing-approval send):
 * the line that gives way when the repo is not shown to be the builder's. A draft for the builder to send, a rule or a
 * users question stays.
 */
export const APPLY_OFFER = /^(Say yes\b.*\bI (also )?apply\b|Say yes again and I apply|Applying now to |Under your standing approval|Say stop and I hold)/;
/** An apply offer closing a line that says something first ("X needs your amount; then I apply. Say yes and I apply."). */
const TAIL_OFFER = / Say yes\b.*\bI (also )?apply\b.*$/;
/** Whether the builder text offers an apply anywhere. Pure. */
const offersApply = (text: string): boolean => text.split('\n').some((l) => APPLY_OFFER.test(l) || TAIL_OFFER.test(l));
/** The builder lines with every apply offer taken out (a whole line, or a line's closing sentence). Pure. */
const withoutApply = (text: string): string[] =>
  text.split('\n').filter((l) => l && !APPLY_OFFER.test(l)).map((l) => l.replace(TAIL_OFFER, ''));
/** FR-1 (fix round 1): the agent note when sign-in must come before any claim or send with the repo. */
export const SIGN_IN_FIRST_NOTE = 'Sign-in comes before any claim or send with this repo: show the sign-in link, then call find again once the builder has signed in.';
/** Fix round 1 (M1): the one action when the repo is not the builder's. */
export const SAY_WHICH_REPO = 'Say which repo is yours.';
/** Fix round 1 (M1): the agent note when the builder's tie to the repo could not be confirmed (no evidence either way). */
export const CANT_CONFIRM_NOTE = "EarnKit could not confirm the builder's GitHub login on this repo: do not apply with it; ask for the login, or let the builder send it.";

/** What find asks or says before any send (L28-3, L28-5, L28-7, v6.1.16 Task 14), filled while the reply is built. */
type BeforeSend = { join: string | null };

/**
 * L28-6 (v6.1.16 Task 14): a repo read under a new link whose GitHub id the owner's applications hold under an old one
 * (a rename or a transfer): those rows, steps and rules move to the new key, and a record project on the old link takes
 * the new link and the id. Reads only the cache (no fetch).
 */
async function followRename(ctx: FindContext, project: Project | null): Promise<void> {
  const to = project ? projectKeyOf(project) : '';
  if (!repoKeyOf(to)) return;
  // Fix round 2 (C4): only for a signed-in builder whose tie to the repo is shown (cache only here; the reply's own check
  // reads the repo when it must).
  if (ctx.builderId === null) return;
  const login = (await getBuilder(ctx.builderId))?.login ?? null;
  const facts = (await cachedRepoFacts(project!)) ?? { repo_url: to };
  if ((await repoTie(login, facts, { repoUrl: to, noFetch: true })) === null) return;
  // Fix round 1 (M3): only from the cached read's own (current) link, with the record projects that keep the id.
  if ((await cachedRepoLink(to)) !== to) return;
  const id = await cachedRepoId(to);
  if (id === null) return;
  const kept = ctx.builderId === null ? [] : (await getRecord(ctx.builderId)).projects.filter((p) => p.repo_id === id && p.repo_url).map((p) => projectKeyOf({ repo_url: p.repo_url }));
  const moved = await rekeyByRepoId(ownerOf(ctx), id, to, kept.filter(Boolean));
  if (ctx.builderId === null) return;
  await withRecord(ctx.builderId, ctx.now, (cur) => {
    let changed = false;
    for (const p of cur.projects) {
      const k = p.repo_url ? projectKeyOf({ repo_url: p.repo_url }) : '';
      if (k && moved.includes(k)) {
        p.repo_url = `https://github.com/${to.slice('https://github.com/'.length)}`;
        changed = true;
      }
      if (k && (k === to || moved.includes(k)) && p.repo_id !== id) {
        p.repo_id = id;
        changed = true;
      }
    }
    return { record: changed ? cur : null, result: null };
  });
}

export async function find(ctx: FindContext, input: unknown): Promise<FindReply | ProgramReply> {
  const { i, unread, error } = findInputOf(input);
  if (error) return inputError(error) as unknown as FindReply;
  const parsed = i.project === undefined ? null : parseProject(i.project, ctx.now);
  const given = parsed?.ok ? parsed.project : null;
  await followRename(ctx, given);
  const pre: BeforeSend = { join: null };
  const r0 = await findWith(ctx, i, unread, pre);
  await followRename(ctx, given);
  const r = await beforeSend(ctx, i.project_id, given, pre, r0);
  // The one-program and open-list replies take the line here; the match's agent note has it in place.
  const withUnread = unread.length > 0 && !r.agent_note.includes(unreadNote(unread)) ? { ...r, agent_note: [r.agent_note, unreadNote(unread)].join('\n') } : r;
  // L16-8 (v6.1.16): a shortened link was dropped: the agent hears to send the real one, on every reply kind.
  const noted = shortLinkIn(i.project) && !withUnread.agent_note.includes(SHORT_LINK_NOTE) ? { ...withUnread, agent_note: [withUnread.agent_note, SHORT_LINK_NOTE].filter(Boolean).join('\n') } : withUnread;
  // L26-4 (v6.1.16 Task 12): every reply under its cap.
  return 'program' in noted ? findReplyCap(noted, FIND_CAP_ONE) : findReplyCap(i.filter?.all === true ? slimLists(noted) : noted, FIND_CAP_ALL);
}

/** L26-4 (v6.1.16 Task 12): a find reply's caps, serialized: the list (full or default) and one program. */
export const FIND_CAP_ALL = 30_720;
export const FIND_CAP_ONE = 20_480;
/** L26-4: the agent line when a list reply dropped field details to fit. */
export const MORE_THAN_FITS = 'More programs than fit here; ask for one by name for its details.';
/** L26-4: the agent line when a one-program reply dropped field details to fit. */
export const FIELDS_CUT_NOTE = (id: string) => `Some field details were left out to fit; the full form is on https://earnkit.com/programs/${id}.`;
/** L26-4: how many guide rules a one-program reply carries; the rest are on the guide page. */
export const GUIDE_RULES_SHOWN = 2;
export const RULES_REST_NOTE = (id: string) => `The rest of the rules are on https://earnkit.com/programs/${id}.`;

type ListKey = 'ready' | 'in_person' | 'you_send' | 'gaps';
const LIST_KEYS: ListKey[] = ['ready', 'in_person', 'you_send', 'gaps'];
/** A field as the full list carries it (L26-4): its key, label, value and source, no descriptions or sources. Pure. */
const slimField = (f: Field): Field => ({ key: f.key, label: f.label, value: f.value, from: f.from } as Field);

/** L26-4: the full list's programs keep their money and gap; each field only its key, label, value and source. Pure. */
export function slimLists(r: FindReply): FindReply {
  const out = { ...r };
  const lists = out as unknown as Record<ListKey, { fields?: Field[] }[] | undefined>;
  for (const k of LIST_KEYS) {
    const list = lists[k];
    if (Array.isArray(list)) lists[k] = list.map((p) => (p.fields ? { ...p, fields: p.fields.map(slimField) } : p));
  }
  return out;
}

const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/**
 * L26-4 (v6.1.16 Task 12): a find reply under `cap` bytes serialized (show_to_builder, agent_note and data). A list
 * reply over it drops the field details of its lowest-ranked programs first (the highest number), never a program's
 * money or gap, and adds MORE_THAN_FITS to the agent note. A one-program reply carries the first GUIDE_RULES_SHOWN
 * guide rules (the rest on its guide page); over the cap it cuts long sources, the copies of its form (the program
 * file's to EarnKit's hints, the guide's), then its fields' sources and descriptions, the last fields first, never a
 * select's options, and names the guide page. Pure.
 */
export function findReplyCap<T extends FindReply | ProgramReply>(reply: T, cap: number): T {
  if ('program' in reply) return programCap(reply, cap) as T;
  if (size(reply) <= cap) return reply;
  const out = { ...reply } as FindReply;
  const lists = out as unknown as Record<ListKey, { n: number; fields?: Field[] }[] | undefined>;
  const programs = LIST_KEYS.flatMap((k) => (lists[k] ?? []).map((p, at) => ({ k, at, n: p.n }))).sort((a, b) => b.n - a.n);
  for (const k of LIST_KEYS) if (lists[k]) lists[k] = lists[k]!.map((p) => ({ ...p }));
  const room = () => size(out) + Buffer.byteLength(`\n${MORE_THAN_FITS}`) <= cap;
  type Row = { fields?: Field[]; also?: unknown[]; rules?: unknown[]; setup?: unknown[]; needs?: unknown[]; gap?: Record<string, unknown> };
  // The lowest-ranked first, each step only as far as it must go: the fields, then the details past the money and the
  // first gap (its other gaps, rules, setup and needs, and the gap's own docs).
  const steps: ((row: Row) => void)[] = [
    (row) => { if (row.fields && row.fields.length > 0) row.fields = []; },
    (row) => {
      for (const k of ['also', 'rules', 'setup', 'needs'] as const) if (Array.isArray(row[k]) && row[k]!.length > 0) row[k] = [];
      if (row.gap) row.gap = Object.fromEntries(Object.entries(row.gap).filter(([k]) => ['kind', 'item', 'what', 'effort', 'agent_can'].includes(k)));
    },
  ];
  for (const step of steps) {
    for (const p of programs) {
      if (room()) break;
      step(lists[p.k]![p.at] as Row);
    }
    if (room()) break;
  }
  out.agent_note = [out.agent_note, MORE_THAN_FITS].filter(Boolean).join('\n');
  return out as T;
}

function programCap(reply: ProgramReply, cap: number): ProgramReply {
  let out: ProgramReply = reply;
  const id = reply.program?.id;
  if (reply.guide && reply.guide.rules.length > GUIDE_RULES_SHOWN && id) {
    const told = reply.agent_note.includes('guide.rules');
    out = { ...out, guide: { ...reply.guide, rules: reply.guide.rules.slice(0, GUIDE_RULES_SHOWN) }, ...(told ? { agent_note: [out.agent_note, RULES_REST_NOTE(id)].join('\n') } : {}) };
  }
  if (size(out) <= cap || !id) return out;
  const note = FIELDS_CUT_NOTE(id);
  const room = () => size(out) + Buffer.byteLength(`\n${note}`) <= cap;
  const fields = out.fields.map((f) => ({ ...f }));
  out = { ...out, fields };
  // The last fields first, each step only as far as it must go: long sources cut, the program file's copy of the
  // form cut to EarnKit's hints, the guide's copy of the form dropped, then sources, then descriptions; never options.
  const eachField = (step: (f: Field) => void) => () => {
    for (let k = fields.length - 1; k >= 0 && !room(); k--) step(fields[k]);
  };
  const steps: (() => void)[] = [
    eachField((f) => { if (f.sources) f.sources = f.sources.map((s) => (s.length > 280 ? `${s.slice(0, 277)}...` : s)); }),
    // The fields carry the form; the program file's copy keeps only EarnKit's own hint for each (`todo`, `need`).
    () => {
      if (out.program) {
        const slim = out.program.submission_requirements.map((r) => ({ key: r.key, ...(r.todo ? { todo: r.todo } : {}), ...(r.need ? { need: r.need } : {}) }));
        out = { ...out, program: { ...out.program, submission_requirements: slim as typeof out.program.submission_requirements } };
      }
    },
    // Fix round 1 (M1): the guide's copy of the form goes before anything a field needs; a select's options never go.
    () => { if (out.guide) out = { ...out, guide: { ...out.guide, fields: [] } }; },
    eachField((f) => { delete f.sources; }),
    eachField((f) => { delete f.guidance; delete f.style; }),
  ];
  for (const step of steps) {
    if (room()) break;
    step();
  }
  return { ...out, agent_note: [out.agent_note, note].filter(Boolean).join('\n') };
}

/**
 * L28-7, L28-5, L28-3 (v6.1.16 Task 14), in that order: two record projects on the repo with no project_id ask which
 * (nothing was filled from either); a name-only project with sends or steps meeting a repo by its name asks to join
 * (only when signed in and the repo is the builder's); a linked builder whose login has no public tie to the repo hears so
 * first. A question replaces the builder text and offers no apply yes.
 */
async function beforeSend<T extends FindReply | ProgramReply>(ctx: FindContext, projectId: string | undefined, project: Project | null, pre: BeforeSend, r: T): Promise<T> {
  const key = project ? projectKeyOf(project) : '';
  if (!repoKeyOf(key)) return r;
  const ask = async (line: string, note: string): Promise<T> => {
    await markOffer(ctx.installationId, null, ctx.now);
    return { ...r, show_to_builder: line, agent_note: [note, r.agent_note].filter(Boolean).join('\n') };
  };
  if (ctx.builderId !== null) {
    const shared = sharedRepoProjects(await getRecord(ctx.builderId), projectId, project!.repo_url ?? null);
    if (shared.length >= 2) return ask(WHICH_PROJECT(shared[0], shared[1]), WHICH_PROJECT_NOTE);
  }
  if (ctx.builderId === null) {
    // FR-1 (fix round 1): signed out with a repo, sign-in comes first: no apply offer until linked.
    if (!offersApply(r.show_to_builder)) return r;
    await markOffer(ctx.installationId, null, ctx.now);
    // Fix round 2 (N5): one sign-in line: the reply's own sign-in sentence gives way to this one, its link kept.
    // Fix round 3 (N5a): the closing always carries the sign-in link when one can be made, a proof gap or not.
    // Never after the record was deleted (final review M8: that reply offers no link).
    const link = (r as { sign_in?: string }).sign_in ?? (r.show_to_builder.includes(DELETED_NOTICE) ? null : await linkOf(ctx));
    // N5b: one sign-in sentence: the unlink notice keeps only its first sentence, and the closing carries the link.
    const kept = withoutApply(r.show_to_builder).filter((l) => !/^Sign in once\b/.test(l))
      .map((l) => l.replace(/ Sign in once at \S+ to link it again\.$/, ''));
    return {
      ...r,
      show_to_builder: [...kept, link ? SIGN_IN_FIRST_LINK(link) : SIGN_IN_FIRST_SAY].join('\n'),
      ...(link ? { sign_in: link } : {}),
      agent_note: [r.agent_note, SIGN_IN_FIRST_NOTE].filter(Boolean).join('\n'),
    };
  }
  const login = (await getBuilder(ctx.builderId))?.login ?? null;
  const facts = await cachedRepoFacts(project!);
  // Fix round 1 (M1): a GitHub repo with no contributor list cached is read first (`repoTie` reads it), so find and
  // track judge the same evidence.
  const { tie, against } = await repoEvidence(login, facts ?? { repo_url: key }, { repoUrl: key, ...(ctx.gh ? { gh: ctx.gh } : {}) });
  if (pre.join && tie !== null) return ask(pre.join, JOIN_NOTE(project!.name));
  if (tie !== null) return sentByAnother(ctx, key, tie, r);
  // Not shown to be theirs: no apply yes. Evidence against them says so; none says it could not confirm, never "not yours".
  if (!against && !offersApply(r.show_to_builder)) return r;
  await markOffer(ctx.installationId, null, ctx.now);
  const kept = withoutApply(r.show_to_builder).filter((l) => !(against && /^Say /.test(l)));
  return {
    ...r,
    show_to_builder: (against ? [NOT_YOUR_REPO, ...kept, SAY_WHICH_REPO] : [...kept, CANT_CONFIRM_REPO]).join('\n'),
    agent_note: [r.agent_note, against ? NOT_YOUR_REPO_NOTE : CANT_CONFIRM_NOTE].filter(Boolean).join('\n'),
  };
}

/**
 * L35-10 (v6.1.16.1 Task 2): a one-program reply for a repo another builder already sent to that program (and this
 * builder has not): L28-1's line in place of everything after the program's first line, and no apply offer. The login
 * only on a strong tie and a match by this repo's key (L35-20). Any other reply is unchanged.
 */
async function sentByAnother<T extends FindReply | ProgramReply>(ctx: FindContext, key: string, tie: NonNullable<Awaited<ReturnType<typeof repoTie>>>, r: T): Promise<T> {
  const id = 'program' in r ? (r.program as { id?: string } | null)?.id : undefined;
  if (!id) return r;
  const owner = ownerOf(ctx);
  if ((await sentOf(owner, id, key)) || (await resultOf(owner, id, key))) return r;
  const other = await sentForRepo(sql(), id, key, owner, await cachedRepoId(key), await cachedRepoParent(key));
  if (!other) return r;
  await markOffer(ctx.installationId, null, ctx.now);
  const login = (tie === 'owner' || tie === 'committer') && other.by === 'key' ? other.login : null;
  return {
    ...r,
    show_to_builder: [r.show_to_builder.split('\n')[0], ALREADY_SENT_REPO(dayWords(other.at, ctx.now), login)].join('\n'),
    agent_note: ['Do not submit this one: another EarnKit account already sent this repo to the program.', r.agent_note].filter(Boolean).join('\n'),
  };
}

/** L35-1 (v6.1.16.1 Task 2): the builder's answer to the join question for this name and this repo: the one kept with
 *  the name's report, else the record project with this repo's; null while undecided. Fix round 1 (I1): an answer
 *  given for another repo is no answer here. */
async function joinDecided(ctx: FindContext, fromName: string, toRepo: string): Promise<'joined' | 'kept_apart' | null> {
  const kept = await joinDecision(ownerOf(ctx), fromName, toRepo);
  if (kept || ctx.builderId === null) return kept;
  const p = (await getRecord(ctx.builderId)).projects.find((x) => x.repo_url && projectKeyOf({ repo_url: x.repo_url }) === toRepo);
  return p?.join ?? null;
}

/**
 * Fix round 1 (I1): after a joined answer for this repo, new rows under the name move onto it only through the gate a
 * send takes: the signed-in builder's tie to the repo (cache only, as `followRename`), then `joinRows` with its locks
 * and the cross-builder check. Nothing else moves sends in find; a refusal is silent (no login, nothing written).
 */
async function joinAgain(ctx: FindContext, fromName: string, toRepo: string, project: Project): Promise<void> {
  if (ctx.builderId === null) return;
  const login = (await getBuilder(ctx.builderId))?.login ?? null;
  const facts = (await cachedRepoFacts(project)) ?? { repo_url: toRepo };
  if ((await repoTie(login, facts, { repoUrl: toRepo, noFetch: true })) === null) return;
  await joinRows(ownerOf(ctx), fromName, toRepo, await cachedRepoId(toRepo), await cachedRepoParent(toRepo));
}

async function findWith(ctx: FindContext, i: z.infer<typeof FindInput>, unread: string[], pre: BeforeSend = { join: null }): Promise<FindReply | ProgramReply> {
  const parsed = i.project === undefined ? null : parseProject(i.project, ctx.now);
  const project = parsed?.ok ? parsed.project : null;
  const problems = parsed?.ok ? [...parsed.problems] : [];
  // B4 (v6.1.13): the first find that adds the repo to a project found by name moves its steps and claims to the repo key.
  // L28-5 (v6.1.16 Task 14): only when the name holds no send or step; else the builder is asked, and both stay.
  const fromName = project ? nameKeyOf(project) : '';
  const toRepo = project ? projectKeyOf(project) : '';
  // L35-1 (v6.1.16.1 Task 2): asked only while the builder has not answered; kept apart, nothing moves.
  if (project?.repo_url && fromName && toRepo !== fromName) {
    const decided = await joinDecided(ctx, fromName, toRepo);
    const held = await heldUnder(ownerOf(ctx), fromName);
    if (decided === 'kept_apart') {
      // The builder said yes and another builder holds the repo: the name keeps its sends.
    } else if (decided === 'joined') {
      // Fix round 1 (I1): rows under the name since the yes move only through the send's tie gate.
      if (held) await joinAgain(ctx, fromName, toRepo, project);
    } else if (held) pre.join = JOIN_QUESTION(project.name, toRepo.replace(/^https:\/\//, ''));
    // The name holds nothing: only its report moves (the B4 silent re-key).
    else await rekeyProject(ownerOf(ctx), fromName, toRepo);
  }
  // W2 (final round): a project by name alone whose report names a repo is read under that repo's key (steps, claims, report).
  const key = project ? await resolvedKey(ownerOf(ctx), projectKeyOf(project)) : '';
  // The report as parsed, so a send on this project is judged on no less (v6.1.13, Task 1 review I1).
  // Fix round 1 (I1): with a repo, under its name key too, so a name-only send reads it. A name-only find of a project
  // known by its repo keeps that repo link in the report, so the name keeps resolving.
  if (project) {
    const report = key !== projectKeyOf(project) && !project.repo_url ? { ...project, repo_url: (await reportOf(ownerOf(ctx), nameKeyOf(project)))?.repo_url } : project;
    // L28-5: a name awaiting the join question keeps its own report, so it never resolves to the repo meanwhile.
    for (const k of new Set([key, projectKeyOf(project), ...(pre.join ? [] : [nameKeyOf(project)])])) await saveReport(ownerOf(ctx), k, report as Project, ctx.now);
  }
  if (i.program_id) return oneProgram(ctx, i.program_id, project, i.project_id, i.ask, key, problems);
  // L24-2 (v6.1.16 Task 11): the open list offers no yes.
  if (!project) await markOffer(ctx.installationId, null, ctx.now);
  if (!project) return openList(ctx, parsed && !parsed.ok ? parsed.problem : null, rawName(i.project), i.filter?.all === true);

  const facts = await factsOf(project, ctx, key);
  problems.push(...(facts.problems ?? []));
  const open = await listOpenPrograms(ctx.now);
  const owner = ownerOf(ctx);
  // The record is read only for a linked installation.
  const side = ctx.builderId === null ? null : await recordSide({ builderId: ctx.builderId, now: ctx.now, projectId: i.project_id, facts, read: readerOf(ctx) });
  if (side) problems.push(...side.problems);
  // A project_id the record does not hold is named, and the match goes on by the repo (v6.1.7, C17).
  if (i.project_id !== undefined && !side?.record.projects.some((p) => p.id === i.project_id)) problems.push('project_id not known; matched without it');
  // L23-7, L23-19 (v6.1.16): stale claims are released on every project find, linked or not, and said by title.
  const released = await releaseStale(owner, ctx.now);
  // L28-4 (v6.1.16 Task 14): a send leaves only its own project's list (`here`, below).
  const skip = await excluded(owner, (p) => p === key || p === i.project_id || p === side?.projectId);
  const all = i.filter?.all === true;
  // The never list is the only policy that hides a program; the approval's limits only stop the agent sending alone.
  const listed = side ? notNever(side.record) : () => true;
  const programs = open.filter((r) => !skip.has(r.id) && listed(r) && (!i.filter?.category || categoryOf(r.file) === i.filter.category));
  const byId = new Map(programs.map((r) => [r.id, r]));
  const done = await doneOn(owner, key);
  // The builder's own tier when one was read; else (unlinked, or linked before any read: R3c) the tier the public code
  // read alone supports; not read, the tier the report supports (B20, v6.1.8), none for nothing reported, where no
  // program with a bar fits. Bars apply only to a project with a chain (B20b). The provisional tier is never shown as evidence.
  const gate = gateFor(side, facts);
  const verdicts = programs
    .map((r) => evaluate(r, facts, done.of(r.id), ctx.now))
    .map((v) => gate(v, byId.get(v.program_id)!));

  const readyV = rankReady(verdicts.filter((v) => v.status === 'ready'), byId);
  const mainnets = new Set(facts.chains.filter((c) => c.mainnet).map((c) => c.chain));
  // The project's own chains: the reported ones in order, then the ones the code read found (fix round 3, N-4).
  const projectChains = [...new Set([...(project.chains ?? []).map((c) => c.chain), ...facts.chains.map((c) => c.chain)])];
  // R18e tie-break (v6.1.7): the chain the agent reported first, not the repo's first read. N-4 (v6.1.9): a program on
  // the project's own chain ranks first.
  // N1 (v6.1.12): a rule-bearing program whose rule keyword the project names competes as a rule-free step.
  const hit = (v: Verdict) => keywordHit(byId.get(v.program_id)!, facts, v.gaps);
  const gapV = rankGaps(verdicts.filter((v) => v.status === 'gap'), byId, mainnets, project.chains?.[0]?.chain, projectChains, hit);
  // N-3 (v6.1.9): a program the builder acted on (a step marked done, or a live claim of theirs) heads its group in the
  // default list until it is applied or skipped (both leave the list).
  // L1d-1 (v6.1.11): only a claim on this project counts, by its stored project (the record id or the project key).
  const here = (p: string | null) => p !== null && (p === key || p === i.project_id || p === side?.projectId);
  const allClaims = await claimed(owner, here);
  const claims = new Map([...allClaims].filter(([, h]) => here(h.project)));
  const live = [...claims].filter(([, h]) => Date.parse(h.since) > ctx.now.getTime() - CLAIM_HOURS * 3_600_000).map(([id]) => id);
  const acted = new Set([...done.own.keys(), ...live]);
  const pinned = (v: Verdict) => acted.has(v.program_id);
  // Remote and in-person ready programs are capped apart, each in rank order (acted-on first), so the default list
  // always leads with something the builder can apply to now.
  // O1 (v6.1.10): a program closing within 7 days that the project fits is always listed, ahead of the caps.
  const soon = (v: Verdict) => closingSoon(byId.get(v.program_id)!.file, ctx.now);
  const attending = (v: Verdict) => byId.get(v.program_id)!.file.in_person;
  // L1c-2 (v6.1.10): a rule the project names none of the keywords of is unlikely: the full list only.
  const unlikelyV = (v: Verdict) => unlikely(byId.get(v.program_id)!, facts, v.gaps);
  const attendRule = (v: Verdict) => attending(v) && rulesOnly(v.gaps);
  /** What the list shows, by default or (`every`) in the full list: one function for both (fix round 1, M1). */
  const selectionOf = (every: boolean) => {
    const readyOrder = every ? readyV : [...readyV.filter(pinned), ...readyV.filter((v) => !pinned(v))];
    const shownReady = shownReadyOf(readyOrder, every, attending, soon);
  // Acted-on programs first, then those closing soon, then real changes and at most one rule-bearing program by default
  // (R18b): the one on the project's chains if any (R18e, fix round 3) in its rank place (L1c-3), else the first, in
  // the last slot only (N-2); a keyword hit takes its own slot in rank order (N1, v6.1.12). In-person programs are
  // never in the default step list (R18d, R18f); `more` counts them.
  // L12-7 (v6.1.14): a project with a chain never sees a deploy on another chain by default; filter.all shows it.
    const stepGaps = shownGapsOf(gapV, every, MAX_GAPS, attending, projectChains,
      (v, chain) => byId.get(v.program_id)!.file.chains.includes(chain), pinned,
      { unlikely: unlikelyV, soon, hit, offChain: (v) => offChain(v, byId, projectChains) });
    // O2 (v6.1.10): an in-person program that needs only a rule to confirm lists in the In person block, in the slots
    // the in-person ready ones leave (all of them with filter.all), each closing soon past the cap.
    const attendV = gapV.filter((v) => attendRule(v) && (every || !unlikelyV(v)));
    const attendShown = every ? attendV : cappedOf(attendV, Math.max(0, MAX_IN_PERSON - shownReady.filter(attending).length), soon);
    return { shownReady, shownGaps: [...stepGaps.filter((v) => !attendRule(v)), ...attendShown] };
  };
  const { shownReady, shownGaps } = selectionOf(all);
  const more = readyV.length - shownReady.length + gapV.length - shownGaps.length;
  /** L1i-5 (v6.1.16.1): the programs the default view lists (for the full list's closing Say). */
  const defaultIdsOf = (): Set<string> => {
    const d = selectionOf(false);
    return new Set([...d.shownReady, ...d.shownGaps].map((v) => v.program_id));
  };
  // In display order with the numbers the builder sees: ready, gaps, then in person.
  // Only another installation's claim marks a program: this agent's own claim is its to send. A claim on another
  // project marks it too, by that project's name (C1, v6.1.13), never pinning it (L1d-1); a claim with no project holds
  // it on every project's list, by default and in the full list (L13-8, L12-1, v6.1.14).
  // L24-1 (v6.1.16 Task 11): never another project's name (ruling 12). L24-4: a claim the builder held is theirs, not
  // another agent's: it is marked `held`, from any installation.
  const holds = side
    ? new Map([...allClaims].filter(([, h]) => h.by !== ctx.installationId && !h.held))
    : new Map<string, { since: string; project: string | null }>();
  const builderHeld = new Set([...allClaims].filter(([, h]) => h.held).map(([id]) => id));
  const marked = (id: string, r: Omit<ReadyProgram, 'n'>): Omit<ReadyProgram, 'n'> => {
    const hold = holds.get(id);
    return hold ? { ...r, claimed_since: hold.since } : builderHeld.has(id) ? { ...r, held: true } : r;
  };
  const { ready, gaps } = numbered(
    shownReady.map((v) => marked(v.program_id, readyOf(byId.get(v.program_id)!, v, facts, ctx.now, side, done.own.get(v.program_id)))),
    shownGaps.map((v) => gapOf(byId.get(v.program_id)!, v, done.of(v.program_id), ctx.now, hit(v), all && unlikelyV(v))),
    (g) => g.in_person && rulesOnly([g.gap, ...g.also]),
  );

  /** Every ready program in `order` as the list would show it (the shown one when it is shown), held ones marked. */
  const tonightAll = (side: RecordSide, given: Verdict[], shown: ReadyProgram[]) => {
    // L23-9 (v6.1.16): a program closing within 24 hours goes first; one closing within the hour is never left out.
    const day = (v: Verdict) => {
      const e = byId.get(v.program_id)!.file.ends_at;
      return e !== null && Date.parse(e) - ctx.now.getTime() <= 86_400_000;
    };
    const order = [...given.filter(day), ...given.filter((v) => !day(v))];
    const rows = order.map((v) => byId.get(v.program_id)!);
    const every = order.map((v) => {
      const own = shown.find((p) => p.program_id === v.program_id);
      if (own) return own;
      return { ...marked(v.program_id, readyOf(byId.get(v.program_id)!, v, facts, ctx.now, side, done.own.get(v.program_id))), n: 0 };
    });
    const t = tonightOf({ auto_apply: true, max_per_night: side.record.policy.max_per_night, auto_sent_today: sentToday, ready: every, blockers: blockersOf(rows, side.record) });
    return { programs: t.list.map((p) => ({ program_id: p.program_id, title: p.title })), limit_used: t.limitUsed };
  };
  const last = await lastFindAt(ctx.installationId);
  const link = side ? null : await linkOf(ctx);
  const notice = await linkedNotice(ctx, link);
  const overnight = side ? await appliedOvernight(owner, last) : [];
  const sentToday = side?.record.policy.auto_apply ? await autoSentSince(owner, new Date(ctx.now.getTime() - 86_400_000)) : 0;
  // L13-9 (v6.1.14): tonight's list is one computation over every ready program (acted-on first), the same by default
  // and in filter.all: the cap of what is shown never decides what goes.
  const tonight = side?.record.policy.auto_apply ? tonightAll(side, [...readyV.filter(pinned), ...readyV.filter((v) => !pinned(v))], ready) : undefined;
  const again = side ? unapprovedSince(side.record, last) : 0;
  const moved = await since(owner, last, open, ready.map((r) => r.program_id), ctx.now, gaps.map((g) => g.program_id));
  const ledger = await summary(owner, open, ctx.now);
  // L23-4 (v6.1.16): every applied program past its results date with no result, asked once a day by each installation.
  const ask = await outcomeAsksDue(ctx.installationId, owner, await askOutcome(owner, open, ctx.now), ctx.now);
  await markAsked(owner, ask.map((a) => a.program_id), ctx.now);
  // L23-1 (v6.1.16): a standing-approval line over 24 hours old whose programs have no application since: said once.
  const promise = side ? await promisedOf(ctx.installationId) : null;
  const promiseDue = promise !== null && ctx.now.getTime() - promise.at.getTime() > 86_400_000;
  const sentSince = promiseDue ? await excluded(owner, here) : new Set<string>();
  const notSent = promiseDue ? promise.programs.filter((p) => !sentSince.has(p.program_id)) : [];
  if (promiseDue) await clearPromised(ctx.installationId);
  // L23-16 (v6.1.16): the shown list's hash against the last project find's.
  const shownIds = [...ready.map((p) => p.program_id), ...gaps.map((g) => g.program_id)];
  const hash = listHash(shownIds);
  const prevList = await lastList(ctx.installationId);

  const r0: Omit<FindReply, 'show_to_builder' | 'agent_note'> = {
    since: moved, ready, gaps,
    ...(all ? { not_fit: verdicts.filter((v) => v.status === 'no').map((v) => ({ program_id: v.program_id, title: byId.get(v.program_id)!.file.title, reason: v.reason ?? 'does not fit' })) } : {}),
    ledger, applications: await applicationsOf(owner), ask_outcome: ask, as_reported: facts.as_reported,
    ...(again > 0 ? { approvals_again: again } : {}),
    ...(problems.length > 0 ? { problems } : {}),
    ...(facts.notes && facts.notes.length > 0 ? { repo_notes: facts.notes } : {}),
    ...(side
      ? linkedPart(side, ready.map((p) => byId.get(p.program_id)!), released, overnight, sentToday, Boolean(project.repo_url || project.live_url))
      : { ...unlinkedPart(), blockers: blockersOf(ready.map((p) => byId.get(p.program_id)!), EMPTY_RECORD), ...(link && notice !== DELETED_NOTICE ? { sign_in: link } : {}) }),
    linked_notice: notice,
    ...(tonight ? { tonight } : {}),
    ...(notSent.length > 0 ? { not_sent: { programs: notSent, since: promise!.at.toISOString() } } : {}),
    ...(prevList && prevList.hash === hash ? { nothing_new_since: prevList.at.toISOString() } : {}),
  };
  // L1i-2, L1i-5 (v6.1.16.1); fix round 1 (I4 ruling): the numbers the builder sees are the numbers the JSON and track
  // read. The default view numbers its shown rows 1, 2, 3 (the rest after them). The full list keeps the numbers the
  // last reply of this project gave (`last_list`, cleared when another project is found) and numbers new ones on.
  // Passes: `laid` lays the default view out once for its shown order; `defaultSay` (full list only) writes the
  // default view's Say; `said` writes the reply from the final numbers.
  const lastOffer = await lastOfferOf(ctx.installationId);
  const byN = [...r0.ready, ...r0.gaps].sort((a, b) => a.n - b.n).map((x) => x.program_id);
  const laid = all ? [] : replyParts(r0, last === null, ctx.now, lastOffer).shown;
  const prevIds = all && (await lastProjectKey(ctx.installationId)) === key ? await lastListIds(ctx.installationId) : [];
  const stable = stableNumbers(prevIds, [...laid, ...byN.filter((id) => !laid.includes(id))]);
  const renum = <X extends { program_id: string; n: number }>(x: X): X => ({ ...x, n: stable.get(x.program_id)! });
  const r: Omit<FindReply, 'show_to_builder' | 'agent_note'> = { ...r0, ready: r0.ready.map(renum), gaps: r0.gaps.map(renum) };
  // L1i-5: the full list closes on the default view's Say, from the programs the default view lists.
  const defaultSay = all ? (() => {
    const ids = defaultIdsOf();
    return replyParts({ ...r, ready: r.ready.filter((p) => ids.has(p.program_id)), gaps: r.gaps.filter((g) => ids.has(g.program_id)) }, last === null, ctx.now, lastOffer, { asShown: true }).say;
  })() : undefined;
  // Every gap of this find (not only the shown ones), in rank order, so track started can say what is still missing.
  // An unfiltered find and filter.all write them; a category filter sees only part of the list and leaves them (v6.1.7, C24a).
  const remembered = i.filter?.category === undefined
    ? Object.fromEntries(gapV.slice(0, MAX_REMEMBERED_GAPS).map((v) => [v.program_id, { what: v.gaps[0].what, kind: v.gaps[0].kind, item: v.gaps[0].item }]))
    : undefined;
  // C58: a description left out is the README's first sentence, or nothing when the README was not read.
  const description = project.description ? null : facts.description ? 'readme' : 'none';
  // L24-2 (v6.1.16 Task 11): read the last offer, then keep this reply's.
  // L1i-6 (v6.1.16.1): the full list says every close, beyond the gap lines' own window (the JSON keeps closes_at).
  const closes = all ? new Map(shownGaps.map((v) => [v.program_id, closesIn(byId.get(v.program_id)!.file, ctx.now) && closeDay(byId.get(v.program_id)!.file, ctx.now) ? closesIn(byId.get(v.program_id)!.file, ctx.now)! : ''])) : undefined;
  const said = replyParts(r, last === null, ctx.now, lastOffer, { all, ...(defaultSay ? { defaultSay } : {}), ...(closes ? { closes } : {}) });
  await markOffer(ctx.installationId, said.offer, ctx.now);
  // L29-26 (v6.1.16 Task 15): what the default view left out goes to the agent, and `more` says so.
  const reply = {
    show_to_builder: said.text,
    agent_note: [agentNote(r, { more, description, hidden: said.hidden, all }), said.say.includes(FULL_RULE_SAY) ? FULL_NUMBER_NOTE : '', unreadNote(unread)].filter(Boolean).join('\n'),
    ...jsonLists(r),
    more: more > 0 || said.hidden.length > 0,
  };
  await markFind(ctx.installationId, ctx.now, remembered, key);
  // L29-15 (v6.1.16 Task 15): the numbers the builder sees, so track takes "3" for the program numbered 3.
  const byNumber: string[] = [];
  for (const p of [...r.ready, ...r.gaps]) byNumber[p.n - 1] = p.program_id;
  await markList(ctx.installationId, hash, ctx.now, Array.from(byNumber, (x) => x ?? ''));
  // L29-11 (v6.1.16 Task 15): what the next send needs from the builder, for record's note (an unfiltered linked find).
  if (side && i.filter?.category === undefined) await markNextNeeds(ctx.installationId, (sendableOf(r)[0]?.need_you ?? []));
  // L23-1 (v6.1.16): the programs the standing-approval line named, kept with the first time a still-open promise was made.
  if (tonight && tonight.programs.length > 0) {
    const kept = promise && !promiseDue ? promise : null;
    const merged = [...(kept?.programs ?? []), ...tonight.programs.filter((p) => !kept?.programs.some((k) => k.program_id === p.program_id))];
    await markPromised(ctx.installationId, merged.map((p) => ({ program_id: p.program_id, title: p.title })), kept?.at ?? ctx.now);
  }
  // L13-7 (v6.1.14): whether standing approval was on, so a send after it is turned off says so.
  if (side) await markFindAuto(ctx.installationId, side.record.policy.auto_apply);
  await noticeTaken(ctx, notice);
  return reply;
}
