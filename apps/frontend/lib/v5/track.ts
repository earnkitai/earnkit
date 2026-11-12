/**
 * The track tool: validates the input, writes the ledger (or, for started, the claim), and answers
 * with one line for the builder, one for the agent, and the updated ledger.
 */
import { z } from 'zod';
import { getBuilder, getRecord, ownerKey, takeUnlinkedNotice, unlinkedReason, withRecord } from '../v6/builders';
import { DELETED_NOTICE } from '../v6/reply-words';
import { CLAIM_HOURS, UNLINKED_MEANWHILE, UNLINKED_SEND_NOTE, claim } from '../v6/claims';
import { APPROVAL_OFF, HAD_CLOSED, NIGHT_LIMIT, NOT_OPENED, REQUIRED_MISSING, STEP_AWAY, outsideApproval, readyAtSend, requiredLeftOut, storedRecordContext, storedSide } from '../v6/find-record';
import { prefill, unvouchedRequired } from './prefill';
import { cachedRepoFacts, cachedRepoId, cachedRepoLink, cachedRepoParent, repoEvidence, repoTie, reportOnlyFacts, type RepoTie } from './repo-facts';
import { findAutoWas, forgetGap, lastGaps, lastListIds, lastProjectKey, unmarkNightFind } from './installations';
import { PROJECT_DESCRIPTION, ProjectArg, identityOf, nameKeyOf, parseProject, projectKeyOf, unknownProjectKeys, type Project } from './project-input';
import { closedAt, isOpenAt, statusAt, getProgram, listOpenPrograms, LIST_GONE, listHole, listRef, looksLikeListRef, programByName, unknownProgramLine } from './programs';
import { closeDay, dayWords } from './deadline';
import { ALREADY_SENT_PROJECT, ALREADY_SENT_REPO, ALREADY_SENT_UNLINKED, CANT_CONFIRM_NAME_NOTE, COFOUNDER_CLAIM_NOTE, COFOUNDER_SENT_NOTE, COFOUNDER_STARTED, HELD_SENT_NOTE, OFF_HOST_SENT_NOTE, KEPT_APART, NAME_ONLY_NOTE, NAME_ONLY_SENT_NOTE, NOT_YOUR_REPO, OTHER_CLAIM_NOTE, CANT_CONFIRM_REPO, SENT_TWICE, SIGN_IN_FIRST, claimed, doneItems, heldUnder, joinRows, pickRow, projectWords, rekeyByRepoId, repoKeyOf, record, reportOf, saveJoinDecision, saveReport, resolvedKey, resultOf, summary, titleOf, type Ledger, type ParentRepo, type Status } from './ledger';
import { clock, unreadNote } from './reply';
import { codeChecked, itemKey } from './eligibility';
import { eligibilityOf } from './program-file';
import { sql } from './db';
import { inputDetail, inputError, readLoosely, refuse as refused, type LooseRules } from './tool-input';
import { AMOUNT_DOT, AMOUNT_UNREAD, readAmount } from './amount';
import { amountsText, moneyAt, moneyOf as tileMoney, moneyText } from './programs-read';
import { cleanText, quoteName } from './controls';

/** The most field keys a send keeps (v6.1.13, B6); the rest are dropped, never refused. */
export const FIELDS_KEPT = 200;
/** The most characters of a send's note the ledger keeps (L13-3, v6.1.14). */
export const NOTE_KEPT = 280;

export const TrackInput = z
  .object({
    // Fix round 1 (N3): `join` with gap_done and item join:{name} is the builder's yes to find's join question.
    program_id: z.string().min(1).max(80).describe("The program's id or name; join with gap_done and item join:{name} for the yes to the join question"),
    status: z.enum(['started', 'applied', 'won', 'rejected', 'no_result', 'skipped', 'unskip', 'gap_done', 'held']),
    /** L13-5 (v6.1.14): no ceiling here; the ledger answers a win over the program's pay with its own line. L22-6
     *  (v6.1.16): US dollars, cents kept; an alias of `amount` with currency USD. */
    // L29-3 (v6.1.16 Task 15): the schema words.
    amount_usd: z.number().finite().min(0).optional().describe('dollars as a number (5000 or 1234.56)'),
    /** L22-2, L22-6 (v6.1.16): won only: the amount as a number or text ("5k", "$2,500.50", "2000 EUR", "€2000"). */
    amount: z.union([z.number().finite(), z.string().trim().max(40)]).optional(),
    /** L22-2 (v6.1.16): won only: the amount's three-letter currency code, default USD (or the win's own currency). */
    currency: z.string().trim().max(10).optional(),
    /** T8-F1 (v6.1.14): won only: a further payment of a win already recorded, with the caller's own key (a repeat adds nothing). */
    payment: z.object({ key: z.string().trim().min(1).max(80) }).strict().optional(),
    /** L13-3 (v6.1.14): the form already went out, so a long note is cut to NOTE_KEPT characters, never refused. */
    // L25-24 (v6.1.16): described, and kept on started too.
    // L24-7 (v6.1.16 Task 11): cleaned like every other written text.
    note: z.string().transform((x) => cleanText(x, NOTE_KEPT)).optional().describe('What you want remembered about this send.'),
    item: z.string().max(80).optional(),
    project_id: z.string().max(40).optional(),
    /** L29-23 (v6.1.16 Task 15): agent when left out. */
    submitted_by: z.enum(['agent', 'builder']).optional().describe('Who pressed submit: agent (the default) or builder'),
    /** B6 (v6.1.13): the form already went out, so a long list is never refused: the first FIELDS_KEPT keys, each cut to 60. */
    fields_used: z.array(z.string()).transform((xs) => xs.slice(0, FIELDS_KEPT).map((x) => x.slice(0, 60))).optional(),
    /** The project find was called with (v6.1.10 L1c-1), find's own schema (v6.1.14 T5), read by find's parser and limits (v6.1.13 B5): cut and dropped, never refused. */
    project: ProjectArg.loose().describe(PROJECT_DESCRIPTION).meta({ required: ['name'] }).optional(),
  })
  .strict();

/** `application_id` (L13-1, T5-F1 v6.1.14): on a claim and on a send recorded, the application's own id; a program's screen matches its outcome by it. */
type Result = { show_to_builder: string; agent_note: string; ledger: Ledger; already_started?: true; application_id?: string; refused?: true; next?: NextReady };
/** L36-12 (v6.1.18): the next ready program after a send, so the next started needs no find. */
type NextReady = { program_id: string; title: string; money: string; draft: boolean; fields: { key: string; from: string; value: string | null; required: boolean }[] };
/** The track input with its project parsed as find parses it (`parseProject`, partial: v6.1.13 B5). */
type TrackIn = Omit<z.infer<typeof TrackInput>, 'project'> & { project?: Project };

/** Whether a project key (projectKeyOf) names no repo: a name alone, or no project. Pure. */
const repoLess = (key: string) => key === '' || key.startsWith('name:');
/** A passed project fact as text, or null. Pure. */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The owner's row for the program and project key (L28-4, v6.1.16 Task 14: `pickRow`; `anyProject` for a result). */
async function rowsHere(owner: string, programId: string) {
  return sql()<{ project_id: string | null; off_repo: string | null; status: string; application_id: string | null; claimed_by: number | null; claimed_at: Date | null }[]>`
    SELECT project_id, off_repo, status, application_id, claimed_by, claimed_at FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
}
async function rowHere(owner: string, programId: string, key: string, anyProject = false) {
  return pickRow(await rowsHere(owner, programId), key, anyProject);
}

/** True when the owner's row for the program and project is an application already sent (applied or with a result). */
async function sentHere(owner: string, programId: string, key: string, anyProject = false): Promise<boolean> {
  const r = await rowHere(owner, programId, key, anyProject);
  return r !== undefined && r.status !== 'started' && r.status !== 'skipped';
}

/** L28-3 (v6.1.16 Task 14): the linked builder's GitHub login, or null. */
const loginOf = async (builderId: number): Promise<string | null> => (await getBuilder(builderId))?.login ?? null;

/**
 * L28-3 (v6.1.16 Task 14): whether a project key is a repo that is not the builder's: no login (unlinked), or no
 * public tie by the cached read (`ownsRepo`). A key that names no repo is never "not theirs".
 */
async function repoNotMine(ctx: TrackContext, key: string): Promise<boolean> {
  return repoKeyOf(key) !== null && (await tieOf(ctx, key)) === null;
}

/** L28-3 (v6.1.16 Task 14, controller ruling: fails closed): the builder's tie to the repo a project key names, or null. */
async function tieOf(ctx: TrackContext, key: string): Promise<RepoTie> {
  const repo = repoKeyOf(key);
  if (!repo || ctx.builderId === null) return null;
  const login = await loginOf(ctx.builderId);
  const facts = (await cachedRepoFacts({ name: '', description: '', repo_url: repo } as Project)) ?? { repo_url: repo };
  return repoTie(login, facts, { repoUrl: repo });
}
/** L28-1 (controller ruling): the other builder's login is said only on the caller's strong tie (owner or committer). */
const strong = (t: RepoTie) => t === 'owner' || t === 'committer';

/** L28-3 (fix round 1, M1): the builder's tie to the repo a key names and whether the evidence is against them. */
async function evidenceOf(ctx: TrackContext, key: string) {
  const repo = repoKeyOf(key);
  if (!repo) return { tie: null, against: false };
  const login = ctx.builderId === null ? null : await loginOf(ctx.builderId);
  const facts = (await cachedRepoFacts({ name: '', description: '', repo_url: repo } as Project)) ?? { repo_url: repo };
  return repoEvidence(login, facts, { repoUrl: repo });
}

/**
 * Fix round 1 (M3): when `key` is the current link of a cached GitHub read with a repo id, the owner's rows, steps,
 * confirmed rules and report under the repo's old links move to it (`rekeyByRepoId`, with the record projects that
 * keep that id).
 */
async function followRepoId(ctx: TrackContext, owner: string, key: string): Promise<void> {
  const repo = repoKeyOf(key);
  if (!repo || (await cachedRepoLink(repo)) !== repo) return;
  const id = await cachedRepoId(repo);
  if (id === null) return;
  const kept = ctx.builderId === null ? [] : (await getRecord(ctx.builderId)).projects.filter((p) => p.repo_id === id && p.repo_url).map((p) => projectKeyOf({ repo_url: p.repo_url }));
  await rekeyByRepoId(owner, id, repo, kept.filter(Boolean));
}

/** L28-5 (v6.1.16 Task 14): the item a builder's yes to the join question is tracked with: `join:` and the name. */
export const JOIN_ITEM = /^join:(.+)$/s;
/** L28-5: the builder line after a join. L35-1 (v6.1.16.1 Task 2): said only when something moved. */
export const JOINED = (name: string, repo: string): string => `Joined ${quoteName(name)} with ${repo}.`;
/** L35-1 (v6.1.16.1 Task 2): a yes to the join question when the name holds nothing apart from the repo. */
export const ALREADY_JOINED = (name: string, repo: string): string => `${quoteName(name)} and ${repo} are already one project.`;

/**
 * L28-5 (v6.1.16 Task 14): the builder's yes to the join question: the name-only project's sends, steps and confirmed
 * rules move to the repo's key, and the name reads as the repo from now on. Never for a repo that is not the
 * builder's; the program id is not read. L35-1 (v6.1.16.1 Task 2): in one transaction under the locks (`joinRows`):
 * when another builder already sent the repo, nothing moves and the send stays under its name (`KEPT_APART`); either
 * way the answer is kept with the project for this repo (its report, and the record project with this repo), so the
 * question is not asked again for this repo (fix round 1, I1: another repo is undecided).
 */
async function joinProject(ctx: TrackContext, owner: string, name: string, project: Project | undefined, refuse: (note: string, agentNote?: string) => Promise<Result>, programs: Awaited<ReturnType<typeof listOpenPrograms>>): Promise<Result> {
  const passed = projectKeyOf(project);
  const to = repoKeyOf(passed) ? passed : await lastProjectKey(ctx.installationId);
  const from = nameKeyOf({ name });
  if (!repoKeyOf(to) || !from) return refuse('Tell me the repo link and I join them.', 'Nothing was joined. Call track with program_id join, status gap_done, item join:<name> and the project with its repo_url.');
  if (await repoNotMine(ctx, to)) return refuse(NOT_YOUR_REPO, 'Nothing was joined: the repo is not the builder\'s.');
  const repo = to.replace(/^https:\/\//, '');
  const res = await joinRows(owner, from, to, await repoIdOf(to), await parentOf(to));
  const decision = 'taken' in res ? 'kept_apart' as const : 'joined' as const;
  if (decision === 'joined') {
    const report = await reportOf(owner, to);
    if (report) await saveReport(owner, from, report, ctx.now);
  }
  // Fix round 1 (I1): the answer is this name's for this repo only.
  await saveJoinDecision(owner, from, to, name, decision, ctx.now);
  if (ctx.builderId !== null)
    await withRecord(ctx.builderId, ctx.now, (cur) => {
      // Fix round 2 (M3): the record project with this repo and this name.
      const p = cur.projects.find((x) => x.repo_url && projectKeyOf({ repo_url: x.repo_url }) === to && nameKeyOf(x) === from);
      if (!p || p.join === decision) return { record: null, result: null };
      p.join = decision;
      return { record: cur, result: null };
    });
  const ledger = await summary(owner, programs, ctx.now);
  if ('taken' in res)
    return refused({ show_to_builder: KEPT_APART(dayWords(res.taken, ctx.now), name), agent_note: 'Nothing was joined: another EarnKit account already sent this repo. The send stays under its name; do not ask again.', ledger });
  return { show_to_builder: res.moved > 0 ? JOINED(name, repo) : ALREADY_JOINED(name, repo), agent_note: 'Call find again with the project.', ledger };
}

/** L28-6 (v6.1.16 Task 14): the GitHub id of the project's repo from its cached read (no fetch), or null. */
const repoIdOf = async (key: string): Promise<number | null> => (repoKeyOf(key) ? await cachedRepoId(key) : null);
/** L35-3 (v6.1.16.1 Task 2): a fork's parent from the project's cached read (no fetch), or null. */
const parentOf = async (key: string): Promise<ParentRepo | null> => (repoKeyOf(key) ? await cachedRepoParent(key) : null);

/** T5-F1 (v6.1.14): the agent note a claim adds, so the id goes in the form. */
export const APPLICATION_ID_NOTE = "If the form has a reference field, put application_id in it, so the program's result reaches these applications.";

/** The sent application's own id (L13-1, v6.1.14), as the reply field; none for a row without one. */
async function applicationIdOf(owner: string, programId: string, key: string): Promise<{ application_id?: string }> {
  const r = await rowHere(owner, programId, key);
  return r?.application_id ? { application_id: r.application_id } : {};
}

/** The program's rules the owner has not confirmed yet on this project, by item key with its note. */
async function openRules(owner: string, programId: string, projectKey: string): Promise<{ item: string; note: string }[]> {
  const program = await getProgram(programId);
  if (!program) return [];
  const done = await doneItems(owner, programId, projectKey);
  const out: { item: string; note: string }[] = [];
  for (const x of eligibilityOf(program.file).filter((y) => y.kind === 'rule')) {
    const item = itemKey(x);
    if (!done.has(item) && !out.some((o) => o.item === item)) out.push({ item, note: x.note ?? item });
  }
  return out;
}

/** The program's rules the owner has not confirmed yet. */
async function rulesLeft(owner: string, programId: string, projectKey: string): Promise<number> {
  return (await openRules(owner, programId, projectKey)).length;
}

export type TrackContext = { installationId: number; builderId: number | null; now: Date };

/** The statuses a ledger row may take after its program left the catalog. */
const RESULT_STATUSES: readonly string[] = ['won', 'rejected', 'no_result'];

/** L12-4, L13-4 (v6.1.14): how track reads wrong-typed arguments before TrackInput (`readLoosely`). */
const TRACK_LOOSE: LooseRules = { text: ['program_id', 'project_id', 'item'], objects: ['project'] };
/** L29-21 (v6.1.16 Task 15): status and submitted_by read in any case ("Applied", "APPLIED", "Agent"); any other
 *  value stays as given, so the strict check refuses it. */
function caseFolded(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const k of ['status', 'submitted_by']) if (typeof out[k] === 'string') out[k] = (out[k] as string).trim().toLowerCase();
  return out;
}

/** L24-3 (v6.1.16 Task 11), L29-15 (Task 15): a name that is no one program by the strict lookup; nothing is written. */
export const WHICH_PROGRAM = unknownProgramLine([]);
/** L29-15 (v6.1.16 Task 15): the agent note beside WHICH_PROGRAM. */
export const WHICH_PROGRAM_NOTE = 'Nothing was recorded. program_id takes the id or the name; a list number maps to the id in the JSON.';
/** L29-23 (v6.1.16 Task 15): an applied with no fields_used is accepted, and the agent hears it. */
export const NO_FIELDS_NOTE = 'Pass fields_used next time; nothing was checked against your record.';
/** L29-7 (v6.1.16 Task 15): an agent's applied on an in-person program. */
export const IN_PERSON_SEND = (title: string) => `${title} is applied for in person; nothing to send.`;
/** L29-8 (v6.1.16 Task 15): a started or an agent's applied on a program whose rule is not confirmed for this project. */
export const CONFIRM_RULE = (rule: string) => `Confirm the rule first: ${rule}. Say yes if that is you.`;
/** L36-5 (v6.1.18): several rules still to confirm are one ask. */
export const CONFIRM_RULES = (rules: string[]) =>
  rules.length === 1 ? CONFIRM_RULE(rules[0]) : `Confirm the rules first: ${rules.join('; ')}. Say yes if all of that is you.`;
/** L36-5 (v6.1.18): a gap_done on a row's first rule item confirmed every rule that row listed. */
export const RULES_CONFIRMED = 'Tracked. Those rules count as confirmed.';
/** L29-3 (v6.1.16 Task 15): a win on a program with no application here, recorded as the builder's own send. */
export const OUTSIDE_WIN = (title: string, money: string) => `Recorded: ${title} won, ${money}. Noted as sent by you outside EarnKit.`;
/** L29-27 (v6.1.16 Task 15): the agent note wherever the builder hears "Say bring it back". */
export const BRING_BACK_NOTE = 'On "bring it back", call track with unskip.';
/** L24-17 (v6.1.16 Task 11): gap_done with no item on a program whose open items are all rules. */
export const WHICH_RULE = 'Which rule fits you? Say the program.';
/** L24-4 (v6.1.16 Task 11): the agent note after track held. */
export const HELD_NOTE = 'Held: do not send it. When the builder says go, call track started and then send.';
/** L24-27 (v6.1.16 Task 11): the claim's 24 hours, in the agent note only. */
export const CLAIM_HOURS_NOTE = 'Other agents of this builder leave it alone for 24 hours.';
export { AMOUNT_DOT, AMOUNT_UNREAD };

/**
 * A win's amount for the ledger (L22-2, L22-6, v6.1.16): read by the shared reader, its currency left out when the
 * builder named none (so the win's own currency is kept). Pure.
 */
export function trackAmount(i: { amount_usd?: number; amount?: number | string; currency?: string }): { value: number; currency?: string } | null | 'bad' | 'ambiguous' {
  const a = readAmount(i);
  if (a === null || a === 'bad' || a === 'ambiguous') return a;
  const named = i.currency !== undefined || i.amount_usd !== undefined || (typeof i.amount === 'string' && /[$€£]|[A-Za-z]{3}/.test(i.amount));
  return named ? a : { value: a.value };
}

/**
 * The project this track is about (projectKeyOf, v6.1.10 L1c-1): the project passed, else the record project named by
 * project_id, else the installation's last find with a project. `given` is false for the last find's. A name key whose
 * report names a repo is that repo's key (`resolvedKey`, W1 final round), as find reads it.
 */
async function projectOf(ctx: TrackContext, i: { project?: Project; project_id?: string }): Promise<{ key: string; given: boolean }> {
  const p = await givenProjectOf(ctx, i);
  return { ...p, key: await currentLink(await resolvedKey(ownerKey(ctx.installationId, ctx.builderId), p.key)) };
}

/**
 * Fix round 1 (M1): a repo key whose cached read now answers with another link (GitHub renamed or moved it, same id) is
 * that link, so a send by the name alone or with no project after a rename finds the renamed row, find or no find.
 * Cache only; any other key is itself.
 */
async function currentLink(key: string): Promise<string> {
  if (!repoKeyOf(key)) return key;
  const now = await cachedRepoLink(key);
  return now && now !== key && (await cachedRepoId(now)) !== null ? now : key;
}

async function givenProjectOf(ctx: TrackContext, i: { project?: Project; project_id?: string }): Promise<{ key: string; given: boolean }> {
  const passed = projectKeyOf(i.project);
  if (passed) return { key: passed, given: true };
  if (i.project_id !== undefined && ctx.builderId !== null) {
    const p = (await getRecord(ctx.builderId)).projects.find((x) => x.id === i.project_id);
    const key = projectKeyOf(p);
    if (key) return { key, given: true };
  }
  return { key: await lastProjectKey(ctx.installationId), given: false };
}

/** Whether `projectId` is one of the linked builder's record projects (an unlinked installation has none). */
async function knownProject(builderId: number | null, projectId: string): Promise<boolean> {
  return builderId !== null && (await getRecord(builderId)).projects.some((p) => p.id === projectId);
}

/**
 * A gap_done refused for its item (v6.1.8, 3.10): with no item on a program whose open items are all rules, the
 * builder is asked which rule fits (L24-17, v6.1.16 Task 11) and the note names the rule item; else the change. The
 * item keys go to the agent only.
 */
async function gapItemRefusal(owner: string, i: TrackIn, projectKey: string, note: string, items: string[], refuse: (note: string, agentNote?: string) => Promise<Result>): Promise<Result> {
  const program = i.item === undefined ? await getProgram(i.program_id) : null;
  if (program) {
    const done = await doneItems(owner, program.id, projectKey);
    const open = eligibilityOf(program.file).filter((x) => !done.has(itemKey(x)));
    const rules = [...new Set(open.filter((x) => x.kind === 'rule').map(itemKey))];
    if (rules.length > 0 && open.every((x) => x.kind === 'rule'))
      return refuse(WHICH_RULE, `${rules.length === 1 ? `The rule item is ${rules[0]}.` : `The rule items are ${rules.join(', ')}.`} Call track gap_done with it once the builder names the program.`);
  }
  return refuse(note, `Items for this program: ${items.join(', ')}. Call track gap_done with one of them.`);
}

/** The agent's next step on a program the builder presses submit on (in person, or builder-only; v6.1.9). */
export const BUILDER_SUBMITS = 'The builder presses submit; prepare the answers and hand them over.';
/** After track started: fill and submit, or (`builderSubmits`) fill and hand over. */
const sendNote = (builderSubmits: boolean) =>
  builderSubmits
    ? `Fill the form from the fields. ${BUILDER_SUBMITS} Once it is sent, call track with applied, submitted_by builder and fields_used.`
    : 'Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used.';

export async function track(ctx: TrackContext, input: unknown): Promise<Result> {
  // v6.1.9: a send tracked as the first call after the account was deleted writes nothing; the notice alone answers.
  const sending = (input as { status?: unknown } | null)?.status === 'applied';
  if (sending && ctx.builderId === null && (await unlinkedReason(ctx.installationId)) === 'deleted') {
    const owner = ownerKey(ctx.installationId, null);
    const r: Result = {
      show_to_builder: DELETED_NOTICE,
      agent_note: 'Nothing was recorded: the builder deleted their record and this agent is unlinked. Ask the builder before you track this send again.',
      ledger: await summary(owner, await listOpenPrograms(ctx.now), ctx.now),
    };
    if (await takeUnlinkedNotice(ctx.installationId)) return r;
  }
  const r = await answer(ctx, input);
  // C51 (v6.1.9): the first call after the account was deleted carries the notice, track as well as find and record;
  // taken once the reply is built, so a throw keeps it for the next call.
  if (ctx.builderId !== null || (await unlinkedReason(ctx.installationId)) !== 'deleted' || !(await takeUnlinkedNotice(ctx.installationId))) return r;
  return { ...r, show_to_builder: r.show_to_builder ? `${DELETED_NOTICE} ${r.show_to_builder}` : DELETED_NOTICE };
}

async function answer(ctx: TrackContext, input: unknown): Promise<Result> {
  const owner = ownerKey(ctx.installationId, ctx.builderId);
  const programs = await listOpenPrograms(ctx.now);
  // L29-9 (v6.1.16 Task 15): every refusal is marked, so the MCP layer answers isError true.
  const refuse = async (note: string, agentNote = 'Nothing was recorded.'): Promise<Result> => refused({
    show_to_builder: note,
    agent_note: agentNote,
    ledger: await summary(owner, programs, ctx.now),
  });
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  // L12-4, L13-4 (v6.1.14): read leniently first, as find reads its arguments: a null project is no project (the
  // last find's), a string one is dropped and named, a numeric id is its text.
  const loose = readLoosely(input, TRACK_LOOSE);
  const parsed = TrackInput.safeParse(caseFolded(loose.args));
  if (!parsed.success) {
    // L31-5 (v6.1.16 Task 17): a win whose only unread arguments are its amount gets the one bad-amount line.
    const amountOnly = caseFolded(loose.args).status === 'won' && parsed.error.issues.every((x) => ['amount_usd', 'amount', 'currency'].includes(String(x.path[0])));
    if (amountOnly) return refuse(AMOUNT_UNREAD, `Nothing was recorded. ${inputDetail(parsed.error)} Convert words like 5k to 5000.`);
    // L29-10 (v6.1.16 Task 15): an input error has no builder text; the note says what to fix.
    const dropped = loose.problems.length > 0 ? ` ${loose.problems.join('; ')}.` : '';
    return { ...inputError(`Nothing was recorded. ${inputDetail(parsed.error)}${dropped}`), ledger: await summary(owner, programs, ctx.now) };
  }
  // F4 (v6.1.12): the program by what the builder calls it, as find takes it. A name that is no one program records
  // nothing, except a result on an id the ledger holds as sent, whose program may have left the catalog since.
  // Final fix (v6.1.12, Task 2 I1): a result on an id the ledger holds as sent is that one, before any matching.
  // B5 (v6.1.13): the project as find reads it, with find's limits: a long name is cut, a long link dropped, never refused.
  const read = parsed.data.project === undefined ? null : parseProject(parsed.data.project, ctx.now, { partial: true });
  const projectProblems = read?.ok ? read.problems : [];
  const given: TrackIn = { ...parsed.data, project: read?.ok ? read.project : undefined };
  // L29-15 (v6.1.16 Task 15): a number from this installation's last find list is that program's id.
  // L28-5 (v6.1.16 Task 14): the yes to the join question names no program.
  const joining = given.status === 'gap_done' ? JOIN_ITEM.exec(given.item ?? '') : null;
  if (joining) return joinProject(ctx, owner, cleanText(joining[1], 80), given.project, refuse, programs);
  // L35-6 (v6.1.16.1 Task 2): "#3", "3.", "No. 3" and "three" too (`listRef`); a token shaped like a list number that is
  // not one of the last list's is never matched against titles (only an exact id), so it never writes by a title word.
  const listed = (await getProgram(given.program_id)) ? null : listRef(given.program_id, await lastListIds(ctx.installationId));
  if (listed) given.program_id = listed;
  const raw = given.program_id;
  const numberish = !listed && looksLikeListRef(raw);
  const sentRow = RESULT_STATUSES.includes(given.status) && (await sentHere(owner, raw, '', true));
  // L24-3 (v6.1.16 Task 11): the strict lookup: an exact id or title, or title words with one that is not a common word.
  const { row, suggest } = sentRow ? { row: null, suggest: [] }
    : numberish ? { row: await getProgram(raw), suggest: [] as string[] }
    : await programByName(raw, ctx.now, { strict: true });
  const data = row ? { ...given, program_id: row.id } : given;
  // An unknown project_id is dropped, and named for the agent (v6.1.7, C17).
  const { project_id, ...rest } = data;
  const known = project_id === undefined || (await knownProject(ctx.builderId, project_id));
  // L36-10 (v6.1.18): a number whose program left the last list says so.
  const hole = !row && !sentRow && numberish ? listHole(raw, await lastListIds(ctx.installationId)) : null;
  const acted = !row && !sentRow
    ? await refuse(hole !== null ? LIST_GONE(hole) : unknownProgramLine(suggest, raw), WHICH_PROGRAM_NOTE)
    : await act(ctx, owner, programs, refuse, known ? data : rest);
  // Final fix (v6.1.12, I2): matched by another name, the first line says which program it was.
  const r = row && row.id !== raw
    ? { ...acted, show_to_builder: namedFirst(acted.show_to_builder, row.file.title), agent_note: `Matched ${row.id}. ${acted.agent_note}` }
    : listed ? { ...acted, agent_note: `Matched list number ${parsed.data.program_id.trim()} to ${listed}. ${acted.agent_note}` } : acted;
  const p0 = projectProblems.length > 0 ? { ...r, agent_note: `${r.agent_note} Project: ${projectProblems.join('; ')}.`.trim() } : r;
  // L31-4 (v6.1.16 Task 17): an id with any non-ASCII character was matched after NFKC folding; the problems line names it.
  const problems = row && /[^\x00-\x7f]/.test(raw) ? [...loose.problems, `program id read as ${row.id}`] : loose.problems;
  // L1j-5 (v6.1.17): a key inside project that is no project field is named, as find names it.
  const unread = [...problems, ...unknownProjectKeys(input && typeof input === 'object' ? (input as { project?: unknown }).project : undefined)];
  const p = unread.length > 0 ? { ...p0, agent_note: `${p0.agent_note} ${unreadNote(unread)}` } : p0;
  return known ? p : { ...p, agent_note: `${p.agent_note} project_id ${project_id} is not known; ignored.`.trim() };
}

/**
 * The builder line with the program named in its first sentence, when it does not name it already: "Started." reads
 * "Started: {title}.", "Tracked." "Tracked: {title}." Pure.
 */
export function namedFirst(show: string, title: string): string {
  // L29-32 (v6.1.16 Task 15): started has no builder text, and stays so.
  if (show === '' || show.includes(title)) return show;
  const named = show
    // L38-18 (v6.1.18): "Tracked: that rule fits you." names the program before its colon.
    .replace(/^Tracked: /, `Tracked for ${title}: `)
    .replace(/^(Started|Tracked)\./, `$1: ${title}.`)
    .replace(/^Already (skipped|tracked)\./, `Already $1: ${title}.`)
    .replace(/^You skipped that one\./, `You skipped ${title}.`)
    .replace(/^Sent, but /, `Sent ${title}, but `);
  return named === show ? `${title}: ${show}` : named;
}

type ProgramRowOf = NonNullable<Awaited<ReturnType<typeof getProgram>>>;

/** Chains of two reports as one list: each chain, network and contract once, the earlier report's first. Pure. */
const chainsOf = (...lists: (Project['chains'] | undefined)[]): Project['chains'] => {
  const out: NonNullable<Project['chains']> = [];
  for (const c of lists.flatMap((l) => l ?? []))
    if (!out.some((x) => x.chain === c.chain && x.mainnet === c.mainnet && (x.contract ?? '').toLowerCase() === (c.contract ?? '').toLowerCase())) out.push(c);
  return out.length > 0 ? out : undefined;
};

/**
 * What a send under standing approval is judged on, built as find builds its facts (v6.1.13, Task 1 review I1 and I2):
 * the project the owner's last find reported on this project key, then the send's own project (parsed as find parses
 * it, B5) on top, its chains added to the find's, never removing one; the name and links fall back to the record
 * project's, else the last find's project key. Then the repo's cached read merged in as find had it (I3, v6.1.10
 * final: no fetch), and with no cached read the report alone, merged as find merges it (`reportOnlyFacts`).
 */
async function sendFacts(ctx: TrackContext, i: TrackIn, projectKey: string) {
  const passed: Partial<Project> = i.project ?? {};
  const last = !passed.name && !passed.repo_url ? await lastProjectKey(ctx.installationId) : '';
  const fromKey = last.startsWith('name:') ? { name: last.slice(5) } : last ? { repo_url: last } : {};
  // Fix round 1 (I1): the send's own key first, then its name key (a find by name, a send with the repo).
  const reporter = ownerKey(ctx.installationId, ctx.builderId);
  const nameKey = nameKeyOf(i.project);
  const kept = (await reportOf(reporter, projectKey)) ?? (nameKey && nameKey !== projectKey ? await reportOf(reporter, nameKey) : null);
  const repo = str(passed.repo_url) ?? (fromKey as { repo_url?: string }).repo_url ?? null;
  const name = str(passed.name) ?? (fromKey as { name?: string }).name ?? null;
  const rec = await storedRecordContext(ctx.builderId!, i.project_id, repo ?? kept?.repo_url ?? null, name ?? kept?.name ?? null);
  const stored = rec.record.projects.find((p) => p.id === rec.projectId);
  const given = Object.fromEntries(Object.entries(passed).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<Project>;
  const link = (v: string | null | undefined) => (v ? v : undefined);
  const project: Project = {
    ...(kept ?? {}),
    ...given,
    name: str(passed.name) ?? kept?.name ?? name ?? stored?.name ?? '',
    description: str(passed.description) ?? kept?.description ?? '',
    repo_url: link(repo ?? kept?.repo_url ?? stored?.repo_url),
    live_url: link(str(passed.live_url) ?? kept?.live_url ?? stored?.live_url),
    demo_url: link(str(passed.demo_url) ?? kept?.demo_url),
    chains: chainsOf(kept?.chains, passed.chains),
    users: passed.users ?? kept?.users ?? null,
  };
  for (const k of ['repo_url', 'live_url', 'demo_url', 'chains'] as const) if (project[k] === undefined) delete project[k];
  const facts = (await cachedRepoFacts(project)) ?? reportOnlyFacts(project);
  return { facts, rec };
}

/**
 * The send-time check find's tonight list would make (M2, v6.1.13: production and the tests share this path): the facts,
 * the record context, and the required fields EarnKit cannot vouch for (`unvouchedRequired`). `projectKey` defaults to
 * the send's project (`projectOf`).
 */
async function sendCheck(ctx: TrackContext, i: TrackIn, row: ProgramRowOf, projectKey?: string) {
  const key = projectKey ?? (await projectOf(ctx, i)).key;
  const { facts, rec } = await sendFacts(ctx, i, key);
  return { facts, rec, key, unvouched: unvouchedRequired(prefill(row, facts, rec).fields).map((f) => f.key) };
}

/** The required fields a send under standing approval cannot vouch for (`sendCheck`). */
export async function unvouchedAtSend(ctx: TrackContext, i: TrackIn, row: ProgramRowOf): Promise<string[]> {
  return (await sendCheck(ctx, i, row)).unvouched;
}

/**
 * Why a send under standing approval is not one, from what EarnKit knows at send time (null: it is one): a required
 * answer it cannot vouch for, else (B2, v6.1.13) a verdict for this project that is not ready, by the same `evaluate`
 * and gate find uses, with the owner's done steps and confirmed rules on this project and the stored tier. A program
 * that closed is judged as it stood at its close: the ledger says whether the send came too late.
 */
async function notApprovedAtSend(ctx: TrackContext, owner: string, i: TrackIn, row: ProgramRowOf, projectKey: string): Promise<string | null> {
  const { facts, rec, unvouched } = await sendCheck(ctx, i, row, projectKey);
  if (requiredLeftOut(row, i.fields_used).length > 0 || unvouched.length > 0) return REQUIRED_MISSING;
  const ends = row.file.ends_at ? Date.parse(row.file.ends_at) : null;
  const at = ends !== null && ends <= ctx.now.getTime() ? new Date(ends - 1) : ctx.now;
  const done = await doneItems(owner, row.id, projectKey);
  return readyAtSend(row, facts, done, storedSide(rec), at) ? null : STEP_AWAY;
}

async function act(
  ctx: TrackContext,
  owner: string,
  programs: Awaited<ReturnType<typeof listOpenPrograms>>,
  refuse: (note: string, agentNote?: string) => Promise<Result>,
  i: TrackIn,
): Promise<Result> {
  const project = await projectOf(ctx, i);
  // L28-4 (v6.1.16 Task 14): the application's project key: the record project's named by project_id, else the project's.
  const recorded = i.project_id !== undefined && ctx.builderId !== null ? projectKeyOf((await getRecord(ctx.builderId)).projects.find((x) => x.id === i.project_id)) : '';
  let appKey = recorded ? await currentLink(await resolvedKey(owner, recorded)) : project.key;
  // Fix round 1 (M3): a renamed or transferred repo, read under its current link, takes its old keys' rows, steps and
  // confirmed rules first (only the cached read's own link, so an old link never pulls them back). Fix round 2 (C4):
  // only once this builder's tie to the repo is shown, so a refused call moves nothing.
  if (repoKeyOf(appKey) && !(await repoNotMine(ctx, appKey))) await followRepoId(ctx, owner, appKey);
  /** L28-3 (v6.1.16 Task 14): the application's repo is not this builder's (no login, or no public evidence of theirs). */
  const notMine = (): Promise<boolean> => repoNotMine(ctx, appKey);
  /** L28-3: the refusal. Fix round 1 (M1): "not yours" only on evidence against the builder; with none, "could not
   *  confirm". Unlinked, it carries the sign-in sentence (the builder signs in first). */
  const notYours = async (): Promise<Result> => {
    // FR-1 (fix round 1): signed out, sign-in comes first, never "not yours".
    if (ctx.builderId === null) return refuse(SIGN_IN_FIRST, 'Nothing was recorded. Show the builder the sign-in link from find; once signed in, call find again, then track.');
    const against = (await evidenceOf(ctx, appKey)).against;
    return refuse(against ? NOT_YOUR_REPO : CANT_CONFIRM_REPO(appKey),
      against ? 'Nothing was recorded. Do not submit this one with this repo: apply only with a repo the builder owns or commits to.'
        : 'Nothing was recorded. EarnKit could not read this repo to check it is the builder\'s: let the builder send it, then call track applied with submitted_by builder.');
  };
  /** L28-1, L28-3: the project's name key, for a builder-submitted send kept under the name only. */
  const nameKey = async (): Promise<string> => {
    const named = nameKeyOf(i.project);
    if (named) return named;
    const rec = i.project_id !== undefined && ctx.builderId !== null ? (await getRecord(ctx.builderId)).projects.find((x) => x.id === i.project_id) : undefined;
    return nameKeyOf(rec) || nameKeyOf(await reportOf(owner, appKey));
  };
  /** L35-2 (v6.1.16.1 Task 2): the application's identity: the record project's repo id (by its repo, else its name),
   *  else the cached read's (its name agreeing with the key), else the key. A send kept off its repo is its name's. */
  const identityHere = async (): Promise<string> => {
    const repo = repoKeyOf(appKey);
    const rec = ctx.builderId === null ? null : await getRecord(ctx.builderId);
    const named = i.project?.name ?? (i.project_id !== undefined ? rec?.projects.find((x) => x.id === i.project_id)?.name : undefined);
    const id = repo ? await cachedRepoId(repo) : null;
    return identityOf(repo ? { name: named, repo_url: repo } : appKey.startsWith('name:') ? { name: appKey.slice(5) } : null, rec, { repo_id: id }) || appKey;
  };
  /** L35-2 (v6.1.16.1 Task 2): a claim or send recorded with the repo and a name keeps the name pointing at the repo
   *  (the name key's report), so a later send by the name alone is this project's; never over a name that holds its
   *  own rows or already names another repo. */
  const rememberName = async (): Promise<void> => {
    const name = nameKeyOf(i.project);
    const repo = repoKeyOf(appKey);
    if (!name || !repo) return;
    if ((await reportOf(owner, name))?.repo_url || (await heldUnder(owner, name))) return;
    await saveReport(owner, name, { name: i.project!.name, description: i.project!.description ?? '', repo_url: repo } as Project, ctx.now);
  };
  let nameOnly: string | null = null;
  // The last find's gaps are its project's: another project passed here is not that one.
  const sameAsLast = !project.given || project.key === (await lastProjectKey(ctx.installationId));
  // L29-23 (v6.1.16 Task 15): an applied with no submitted_by is the agent's.
  const sender = i.submitted_by ?? 'agent';
  /** L29-8 (v6.1.16 Task 15): a rule not confirmed on this project (the last find's when none is passed) stops a claim
   *  and an agent's send; nothing is written. */
  const ruleFirst = async (): Promise<Result | null> => {
    const rules = await openRules(owner, i.program_id, project.key);
    // L36-5 (v6.1.18): one gap_done with the first item confirms them all.
    return rules.length === 0 ? null : refuse(CONFIRM_RULES(rules.map((r) => r.note)),
      `Nothing was recorded. If the builder says yes, call track gap_done with item ${rules[0].item}${rules.length > 1 ? ' (it confirms every rule named)' : ''}, then track ${i.status} again.`);
  };
  if (i.status === 'started') {
    const program = await getProgram(i.program_id);
    if (!program) return refuse(WHICH_PROGRAM, WHICH_PROGRAM_NOTE);
    // L29-9 (v6.1.16 Task 15): already sent is a refusal (isError), its text unchanged.
    // L28-4 (v6.1.16 Task 14): the line names the project it was sent for.
    const sentAlready = {
      show_to_builder: appKey ? ALREADY_SENT_PROJECT(program.file.title, projectWords(appKey, i.project?.name)) : `${program.file.title} was already sent.`,
      agent_note: 'Do not submit this one; it was already sent.',
      refused: true as const,
    };
    // The same open list find reads (active, not past its close, not stale): a program not in it is never claimed.
    // An application already sent says so first, even when its program has since closed (v6.1.7).
    if (!programs.some((p) => p.id === program.id) && (await sentHere(owner, program.id, appKey)))
      return { ...sentAlready, ledger: await summary(owner, programs, ctx.now), already_started: true };
    if (!programs.some((p) => p.id === program.id))
      return refuse(`${program.file.title} is not open; nothing to start.`, 'Do not submit this one; call find for what is open.');
    if (!(await sentHere(owner, program.id, appKey))) {
      const rule = await ruleFirst();
      if (rule) return rule;
    }
    // L28-3 (v6.1.16 Task 14; fix round 1, C1): a claim keyed by a repo that is not the builder's is never written,
    // whatever this project's row says.
    if (await notMine()) return notYours();
    // L1d-1 (v6.1.11): with no project_id the claim stores the project key, so find pins it on that project only.
    // L28-4 (v6.1.16 Task 14): the claim is keyed by the project key, always.
    // Fix round 3 (M4): the tie was shown just above, so the builder's own keyless row is taken over.
    const c = await claim(owner, i.program_id, appKey || null, ctx.installationId, ctx.now, i.note ?? null, { repoId: await repoIdOf(appKey), tied: repoKeyOf(appKey) !== null, identity: await identityHere(), parentRepo: await parentOf(appKey) });
    if (!c.ok && 'unlinked' in c) return refuse(UNLINKED_MEANWHILE);
    // L28-1 (v6.1.16 Task 14): another account sent this repo; L28-10: the builder this agent was linked to sent it.
    if (!c.ok && 'repo' in c) return refuse(ALREADY_SENT_REPO(dayWords(c.repo.at, ctx.now), strong(await tieOf(ctx, appKey)) ? c.repo.login : null), 'Nothing was recorded. Do not submit this one: another EarnKit account already sent this repo to the program.');
    if (!c.ok && 'former' in c) return refuse(ALREADY_SENT_UNLINKED, 'Nothing was recorded. Do not submit this one; the builder already sent it.');
    // L35-4 (v6.1.16.1 Task 2): another builder tied to the repo is filling this form now.
    if (!c.ok && 'cofounder' in c) return refuse(COFOUNDER_STARTED(dayWords(c.cofounder.at, ctx.now)), "Nothing was recorded. Do not submit this one: a co-founder's agent is filling it now.");
    // L29-27 (v6.1.16 Task 15): the builder's words, not the status name.
    if (!c.ok && 'skipped' in c)
      return refused({
        show_to_builder: 'You skipped that one. Say bring it back and I list it again.',
        agent_note: `Do not submit this one. ${BRING_BACK_NOTE}`,
        ledger: await summary(owner, programs, ctx.now),
      });
    if (!c.ok)
      return refused({
        ...(c.already.sent
          ? sentAlready
          : {
              // L24-1 (v6.1.16 Task 11): another agent's own name through quoteName.
              // L38-19 (v6.1.18): who has it, then when it started.
              show_to_builder: `${c.already.by ? `Your agent ${quoteName(c.already.by)}` : 'Another of your agents'} started ${program.file.title} ${atClock(c.already.since, ctx.now)} and has it.`,
              agent_note: 'Do not submit this one; call find again later.',
            }),
        ledger: await summary(owner, programs, ctx.now),
        already_started: true as const,
      });
    await rememberName();
    // T5-F1 (v6.1.14): the claim carries the application's own id, for the form's reference field.
    const id = await applicationIdOf(owner, program.id, appKey);
    // L24-27 (v6.1.16 Task 11): the 24-hour rule is the agent's to know, linked only.
    const hours = ctx.builderId === null ? '' : ` ${CLAIM_HOURS_NOTE}`;
    const started = (r: Result): Result => {
      const s = { ...r, agent_note: `${r.agent_note}${hours}` };
      return id.application_id ? { ...s, ...id, agent_note: `${s.agent_note} ${APPLICATION_ID_NOTE}` } : s;
    };
    // L29-32 (v6.1.16 Task 15): started has no builder text; the agent note carries what to do.
    // The last find called this one a gap: the agent hears what was still missing, so it is fixed before the form goes
    // in. Not when the builder (through any of their agents) has since closed that item (v6.1.7, C23). A rule gap never
    // reaches here (`ruleFirst`).
    const builderSubmits = program.file.in_person || program.file.submit === 'builder';
    const gap = sameAsLast ? (await lastGaps(ctx.installationId))[program.id] : undefined;
    if (gap && gap.kind !== 'rule' && !(gap.item && (await doneItems(owner, program.id, project.key)).has(gap.item)))
      return started({
        show_to_builder: '',
        agent_note: `Started ${program.file.title}. When EarnKit last looked it was still one change away: ${gap.what}. Tell the builder; make the change before you submit, or call find again to check it. ${builderSubmits ? sendNote(true) : 'Then fill the form from the fields, submit, and call track with applied, submitted_by and fields_used.'}`,
        ledger: await summary(owner, programs, ctx.now),
      });
    return started({
      show_to_builder: '',
      agent_note: `Started ${program.file.title}. ${sendNote(builderSubmits)}`,
      ledger: await summary(owner, programs, ctx.now),
    });
  }
  // Sent under standing approval: the builder's policy at this moment (never for an unlinked installation), and only
  // an agent's own submission; a form the builder sent is never one. With the policy on, the send counts as approved
  // only within every limit (v6.1.8 B18): `outside` says why not; the nightly count is the ledger's, under its lock.
  const row = i.status === 'applied' ? await getProgram(i.program_id) : null;
  if (i.status === 'applied' && sender === 'agent' && row && !(await sentHere(owner, row.id, appKey))) {
    // L29-7 (v6.1.16 Task 15): an in-person program is the builder's to apply to; an agent has nothing to send.
    if (row.file.in_person)
      return refuse(IN_PERSON_SEND(row.file.title), 'Nothing was recorded. When the builder has applied in person, call track applied with submitted_by builder.');
    const rule = await ruleFirst();
    if (rule) return rule;
  }
  // L28-3 (v6.1.16 Task 14; fix round 1, C1): an agent never sends, and nobody holds, with a repo that is not the
  // builder's, whatever this project's row says. FR-4: a send over this agent's own live claim on this project was
  // checked at the start, so it is recorded (the form went out) whatever a read now answers.
  // Fix round 2 (C3): this project's own claim only, by an exact key match (a keyless claim never unlocks a repo send).
  const own = i.status === 'applied' ? (await rowsHere(owner, i.program_id)).find((r) => (r.project_id ?? '') === appKey) : undefined;
  const ownClaim = own?.status === 'started' && own.claimed_by === ctx.installationId && own.claimed_at !== null
    && own.claimed_at.getTime() > ctx.now.getTime() - CLAIM_HOURS * 3_600_000;
  if (((i.status === 'applied' && sender === 'agent' && !ownClaim) || i.status === 'held') && (await notMine())) return notYours();
  // L28-3: a send the builder made with a repo that is not theirs is kept (L23-3), under the project's name only, so it
  // never matches a screen row for that repo and never takes the repo's place.
  let offRepo: string | null = null;
  // Controller ruling: a win recorded with no application here never reserves a repo that is not shown to be theirs.
  if (i.status === 'won' && (await notMine())) {
    offRepo = repoKeyOf(appKey);
    appKey = (await nameKey()) || appKey.replace(/^https:\/\//, 'name:');
  }
  if (i.status === 'applied' && sender === 'builder' && !ownClaim && (await notMine())) {
    // L35-11 (v6.1.16.1 Task 2): "not yours" only on evidence against the builder; with none, "could not confirm".
    const against = (await evidenceOf(ctx, appKey)).against;
    offRepo = repoKeyOf(appKey);
    appKey = await nameKey();
    nameOnly = against ? NAME_ONLY_NOTE : CANT_CONFIRM_NAME_NOTE;
  }
  const policy = i.status === 'applied' && sender === 'agent' && ctx.builderId !== null ? await getRecord(ctx.builderId) : null;
  const standing = policy?.policy.auto_apply === true;
  // S6 (v6.1.9): within the limits, a send under standing approval also needs every required answer.
  // F1 (v6.1.10, fix round 2): and every required field must be one EarnKit vouches for (`unvouchedRequired`, the rule
  // find holds the tonight list on), over the program prefilled with the stored record and the send's project, whatever
  // keys fields_used names.
  // B2 (v6.1.13): and the program's verdict for this project must be ready, as find would list it now.
  // L13-6 (v6.1.14): a program that has not opened is never sent under it. L13-7: an agent's send after the builder
  // turned it off since this agent's last find (which saw it on) says it was off.
  let outside = standing && row
    ? (statusAt(row.file, ctx.now) === 'upcoming' ? NOT_OPENED : (outsideApproval(policy!, row) ?? (await notApprovedAtSend(ctx, owner, i, row, project.key))))
    : policy && row && (await findAutoWas(ctx.installationId)) ? APPROVAL_OFF : null;
  // FR-3 (final fix): a send with no project_id keeps the project key, as a claim does, so a screen can match it.
  // L36-8 (v6.1.18): keys the form does not have are dropped (fields_used is the record of what was sent), and named.
  const formKeys = row && !row.file.in_person && row.file.submission_requirements.length > 0 ? new Set(row.file.submission_requirements.map((r) => r.key)) : null;
  const unknownFields = i.status === 'applied' && formKeys && i.fields_used ? [...new Set(i.fields_used.filter((k) => !formKeys.has(k)))] : [];
  const fieldsKept = unknownFields.length > 0 ? i.fields_used!.filter((k) => formKeys!.has(k)) : i.fields_used;
  const applied = i.status === 'applied'
    ? { submitted_by: sender, fields_used: fieldsKept, autoApplied: standing && outside === null, ...(standing ? { maxPerNight: policy!.policy.max_per_night } : {}), repoId: await repoIdOf(appKey), offRepo }
    : {};
  // L28-1 (controller ruling): a refusal names the other builder only on this builder's strong tie to the repo.
  const showLogin = (i.status === 'applied' || i.status === 'won') && repoKeyOf(appKey) !== null && strong(await tieOf(ctx, appKey));
  // L17-1 (v6.1.16): a skip's checks (already sent, already skipped, another agent's live claim) run in record, under
  // the per-program lock, so parallel skips write one row. L17-8: the payment key is the caller's, one space per application.
  // L22-6 (v6.1.16): a win's amount through the shared reader; any other status ignores it, as before.
  const amount = i.status === 'won' ? trackAmount(i) : null;
  if (amount === 'bad') return refuse(AMOUNT_UNREAD, 'Nothing was recorded. Send amount_usd as a number (5000 or 1234.56; convert 5k to 5000), or amount with currency for another currency.');
  if (amount === 'ambiguous') return refuse(AMOUNT_DOT, 'Nothing was recorded. Send 5000 or 5,000; a dot is for cents only.');
  // L29-3 (v6.1.16 Task 15): a win with no application here is recorded as the builder's own send, then the win.
  // L28-4 (v6.1.16 Task 14): every status names its project key (FR-3: the key, never the record id).
  // Fix round 3 (M4): the builder's tie to the repo key this row is written under, shown by the gate.
  const tied = repoKeyOf(appKey) !== null && (i.status === 'applied' || i.status === 'held') && !(await repoNotMine(ctx, appKey));
  // L35-2, L35-3 (v6.1.16.1 Task 2): the identity the row is kept under, and a fork's parent.
  const identity = i.status === 'gap_done' ? undefined : offRepo ? appKey || null : await identityHere();
  const parentRepo = repoKeyOf(appKey) ? await parentOf(appKey) : null;
  let res = await record(owner, i.program_id, i.status as Status, { installationId: ctx.installationId, ...(amount && { amount }), note: i.note, item: i.item, projectKey: project.key, project_id: i.status === 'gap_done' ? undefined : appKey, now: ctx.now, ...applied, showLogin, tied, identity, parentRepo,
    ...(i.status === 'won' ? { outsideWin: true as const, offRepo } : {}),
    ...(i.status === 'won' && i.payment ? { payment: { key: i.payment.key } } : {}) });
  // L28-1 (v6.1.16 Task 14): a send the builder made of a repo another account sent is kept under the name only.
  let sentTwice: { day: string; login: string | null } | null = null;
  if (!res.ok && res.repo_taken && sender === 'builder' && i.status === 'applied' && !nameOnly) {
    sentTwice = res.taken ?? null;
    const taken = repoKeyOf(appKey);
    appKey = await nameKey();
    nameOnly = NAME_ONLY_SENT_NOTE;
    res = await record(owner, i.program_id, 'applied', { installationId: ctx.installationId, note: i.note, projectKey: project.key, project_id: appKey, now: ctx.now, ...applied, repoId: null, offRepo: taken, identity: appKey || null });
  }
  // A second skip says so (v6.1.9, lane 8 simplify).
  if (res.ok && i.status === 'skipped' && 'repeated' in res)
    return { show_to_builder: 'Already skipped.', agent_note: 'Call find again for the updated applications.', ledger: await summary(owner, programs, ctx.now) };
  // L17-9 (v6.1.16): a send refused as unlinked already went out; the agent tells the builder to keep a note.
  if (!res.ok && i.status === 'applied' && res.note === UNLINKED_MEANWHILE) return refuse(UNLINKED_MEANWHILE, UNLINKED_SEND_NOTE);
  if (res.ok && 'night' in res) outside = NIGHT_LIMIT;
  if (res.ok && 'closed' in res) outside = HAD_CLOSED;
  // The find before a send under standing approval was the night routine's: it leaves the overnight report (v6.1.9).
  if (res.ok && i.status === 'applied' && standing && outside === null) await unmarkNightFind(ctx.installationId);
  if (!res.ok)
    return res.items ? await gapItemRefusal(owner, i, project.key, res.note, res.items, refuse)
      : res.agent_note ? refuse(res.note, `Nothing was recorded. ${res.agent_note}`)
      : res.repo_taken ? refuse(res.note, 'Nothing was recorded. Another EarnKit account already sent this repo to the program; tell the builder.')
      : refuse(res.note);
  if (i.status === 'applied') await rememberName();
  if (i.status === 'gap_done' && sameAsLast) await forgetGap(ctx.installationId, i.program_id);
  if (i.status === 'gap_done') {
    // A repeat says so (v6.1.7, C26); a rule is confirmed, not re-read from the repo (m3).
    // N2 (v6.1.8): the program comes back ready only when no other rule of it is left to confirm.
    // N-5 (v6.1.9): what the code or the report settles is re-checked on the next find; the builder's word counts done.
    // L36-5 (v6.1.18): the row and its one ask list every open rule, so the first rule item confirms them all.
    let also = 0;
    if (i.item!.startsWith('rule:') && !('repeated' in res))
      for (const r of await openRules(owner, i.program_id, project.key)) {
        const more = await record(owner, i.program_id, 'gap_done', { installationId: ctx.installationId, item: r.item, projectKey: project.key, now: ctx.now });
        if (more.ok) also++;
      }
    const left = i.item!.startsWith('rule:') && !('repeated' in res) ? await rulesLeft(owner, i.program_id, project.key) : 0;
    const [show, note] = 'repeated' in res
      ? ['Already tracked.', 'Call find again for the updated applications.']
      : i.item!.startsWith('rule:')
        // L38-18 (v6.1.18): the builder's words, not EarnKit's bookkeeping.
        ? [also > 0 ? RULES_CONFIRMED : 'Tracked: that rule fits you.', left === 0 ? 'Call find again; the program comes back ready.' : `Call find again; ${left === 1 ? 'one rule is' : `${left} rules are`} left.`]
        : codeChecked(i.item!) && !repoLess(project.key)
          ? ['Tracked. I check the repo on the next look.', 'Call find again so the repo is re-read.']
          : codeChecked(i.item!)
            // F6 (v6.1.12): no repo to check; the builder says when it is up.
            ? ['Tracked. Tell me when it is live and I look again.', 'When the builder says it is live, call find again with its repo or live link.']
          : ['Tracked.', 'Call find again; that step counts as done.'];
    return { show_to_builder: show, agent_note: note, ledger: await summary(owner, programs, ctx.now) };
  }
  const title = await titleOf(owner, i.program_id);
  // The win as the ledger now holds it (its currency resolved there); a further payment names its own currency.
  // L28-4 (v6.1.16 Task 14): the row just written, read back by its own project key.
  const rowKey = (await rowHere(owner, i.program_id, appKey, RESULT_STATUSES.includes(i.status)))?.project_id ?? appKey;
  const kept = i.status === 'won' ? (await resultOf(owner, i.program_id, rowKey))?.amounts ?? null : null;
  const wonText = kept ? amountsText(kept) : amount ? moneyText(amount.value, amount.currency) : '';
  const wonCurrency = (total: Record<string, number>) =>
    amount && amount.currency ? amount.currency : Object.keys(total).length === 1 ? Object.keys(total)[0] : 'USD';
  const lines: Record<Exclude<Status, 'started' | 'gap_done'>, string> = {
    // L24-4 (v6.1.16 Task 11): the builder's hold; started again lifts it.
    held: `Held ${title}. Say go when you want it sent.`,
    // #8 (v6.1.15): one verb, Tracked, wherever a fact is saved for the builder.
    // L29-32 (v6.1.16 Task 15): the send, by name.
    applied: `Sent ${title}.`,
    // L15-17, T8-F1 (v6.1.14): a further payment adds and the line reads the total; an unmarked other amount corrects.
    // L22-7 (v6.1.16): the money in the one format, in the win's own currency (L22-2: assumed when none was named).
    won: 'outside' in res
      ? OUTSIDE_WIN(title, wonText)
      : 'total' in res && res.total !== undefined
      ? `Tracked: ${moneyText(amount ? amount.value : 0, wonCurrency(res.total))} more from ${title}, ${amountsText(res.total)} in total.`
      : 'replaced' in res && res.replaced !== undefined
        ? `Tracked: ${wonText} from ${title}. Replaced the earlier amount.`
        : `Tracked: ${wonText} from ${title}.`,
    // L38-16 (v6.1.18): the next ready program follows, as after a send (NEXT_LINE); none, the line ends here.
    rejected: 'Tracked.',
    no_result: 'Tracked.',
    // L24-4 (v6.1.16 Task 11): a skip is for good, and says so.
    // L29-27 (v6.1.16 Task 15): the builder's words, never the status name.
    skipped: `Skipped ${title} for good. Say bring it back and I list it again.`,
    // L38-17 (v6.1.18): it is back, said as a fact.
    unskip: `${title} is back in your list.`,
  };
  // v6.1.9: a send after the program closed is still recorded, and says so. L23-2 (v6.1.16): closed from the clock.
  const closedDay = i.status === 'applied' && row && closedAt(row.file, ctx.now) && row.file.ends_at && Date.parse(row.file.ends_at) <= ctx.now.getTime()
    // v6.1.16 Task 16 (ruling 40): the day in the program's zone, as its Closes line says it, through dayWords (L23-11).
    ? closeDay(row.file, ctx.now) ?? dayWords(new Date(row.file.ends_at), ctx.now)
    : null;
  const closed = closedDay ? `${row!.file.title} closed on ${closedDay}; recorded anyway.` : null;
  // L23-3 (v6.1.16): a send over another agent's live claim is recorded; the agent hears to tell the builder.
  const otherClaim = res.ok && 'other_claim' in res;
  // L24-4 (v6.1.16 Task 11): a send on a held program is recorded; the agent tells the builder.
  const heldSent = res.ok && 'held' in res;
  // L35-4 (v6.1.16.1 Task 2): a co-founder on the same repo: a claim cleared, or a send that went out twice.
  const cofounder = [
    ...(res.ok && 'cofounder_sent' in res ? [COFOUNDER_SENT_NOTE] : res.ok && 'cofounder_claim' in res ? [COFOUNDER_CLAIM_NOTE] : []),
    // L35-11, controller ruling: advisory only.
    ...(res.ok && 'off_host_sent' in res ? [OFF_HOST_SENT_NOTE] : []),
  ].join(' ') || null;
  // L29-9 (v6.1.16 Task 15): a send outside the standing approval is recorded, and answered as a refusal (isError).
  if (i.status === 'applied' && outside)
    return refused({
      ...(await applicationIdOf(owner, i.program_id, rowKey)),
      // L23-20 (v6.1.16): one closed sentence, never two.
      show_to_builder: outside === HAD_CLOSED && closedDay
        ? `${row!.file.title} closed on ${closedDay}; recorded anyway, not under your standing approval.`
        : [closed, `Sent, but outside your standing approval: ${outside}.`].filter(Boolean).join(' '),
      agent_note: [...(nameOnly ? [nameOnly] : []), ...(cofounder ? [cofounder] : []), ...(otherClaim ? [OTHER_CLAIM_NOTE] : []), ...(heldSent ? [HELD_SENT_NOTE] : []), 'Recorded as applied, not under standing approval. Send nothing else alone that falls outside the limits; ask the builder first. Call find again for the updated applications.', ...(unknownFields.length > 0 ? [droppedFieldsNote(unknownFields)] : [])].join(' '),
      ledger: await summary(owner, programs, ctx.now),
    });
  // I1 (v6.1.9 final): after a send under standing approval the agent does not find again, so the morning report stays.
  const done: Result = {
    ...(i.status === 'applied' ? await applicationIdOf(owner, i.program_id, rowKey) : {}),
    // L36-9 (v6.1.18): a send of a repo another builder sent says the program may see two.
    show_to_builder: closed ?? (i.status === 'applied' && res.ok && sentTwice ? SENT_TWICE(title, sentTwice.day, sentTwice.login) : lines[i.status]),
    agent_note: cofounder
      ? cofounder
      : otherClaim
      ? OTHER_CLAIM_NOTE
      : heldSent
        ? HELD_SENT_NOTE
      : i.status === 'held'
        ? ('repeated' in res ? `Already held. ${HELD_NOTE}` : HELD_NOTE)
      : i.status === 'applied' && standing && outside === null
        // L23-1 (v6.1.16): no night is promised.
        ? "Done for now. The builder's next find reports it; do not call find again until they ask."
        : i.status === 'skipped' ? `Call find again for the updated applications. ${BRING_BACK_NOTE}`
        // L35-22 (v6.1.17): an in-person program has no form fields to name.
        : i.status === 'applied' && !i.fields_used && !row?.file.in_person ? `Call find again for the updated applications. ${NO_FIELDS_NOTE}`
        : 'Call find again for the updated applications.',
    ledger: await summary(owner, programs, ctx.now),
  };
  // L36-8 (v6.1.18): the dropped keys are named last.
  const base: Result = unknownFields.length > 0 ? { ...done, agent_note: `${done.agent_note} ${droppedFieldsNote(unknownFields)}` } : done;
  // L36-12 (v6.1.18): a plain send names the next ready program and its one ask; its id and fields go to the agent.
  // L38-16 (v6.1.18): a rejection names the next ready program the same way.
  const plain = (i.status === 'applied' && !closed && !cofounder && !otherClaim && !heldSent && !(standing && outside === null) && !sentTwice)
    || (i.status === 'rejected' && res.ok && !('repeated' in res));
  const next = plain ? await nextReady(ctx, owner, i, project.key, i.program_id) : null;
  const withNext: Result = next
    ? {
      ...base,
      show_to_builder: `${base.show_to_builder} ${NEXT_LINE(next)}`,
      agent_note: [NEXT_NOTE(next), base.agent_note.replace(/^Call find again for the updated applications\.\s*/, '')].filter(Boolean).join(' '),
      next,
    }
    : base;
  // L28-1, L28-3 (v6.1.16 Task 14): a send kept under the project's name only says so to the agent first.
  return nameOnly ? { ...withNext, agent_note: `${nameOnly} ${withNext.agent_note}` } : withNext;
}

/** L36-8 (v6.1.18): the agent note naming fields_used keys the form does not have (at most 5 named). Pure. */
export function droppedFieldsNote(keys: string[]): string {
  const named = keys.slice(0, 5).map((k) => cleanText(k, 60)).join(', ');
  const more = keys.length > 5 ? ` and ${keys.length - 5} more` : '';
  return keys.length === 1 ? `fields_used: ${named} is not this form's field; dropped.` : `fields_used: ${named}${more} are not this form's fields; dropped.`;
}

/** L38-19 (v6.1.18): "at 09:14 UTC", "at Nov 10, 09:14 UTC", or "earlier today" when the time is unreadable. Pure. */
const atClock = (iso: string, now: Date): string => {
  const c = clock(iso, now);
  return c === 'earlier today' ? c : `at ${c}`;
};

/** L36-12 (v6.1.18): the builder's line for the next ready program. Pure. */
export const NEXT_LINE = (n: Pick<NextReady, 'title' | 'money' | 'draft'>): string =>
  `Next: ${n.title}, ${n.money}. Say yes and I ${n.draft ? 'draft it for you to send' : 'apply'}.`;
/** L36-12 (v6.1.18): the agent's way to the next send without a find. Pure. */
export const NEXT_NOTE = (n: NextReady): string =>
  `Next ready: program_id ${n.program_id}. On the builder's yes, call track started with that program_id and fill the form from next.fields (keys: ${n.fields.map((f) => `${f.key} (${f.from})`).join(', ')}); no find needed.`;

/**
 * L36-12 (v6.1.18): the first program of this installation's last find list for this project, after the one just sent,
 * that is open, remote, ready for the project now (find's gate), not sent, skipped or held, not claimed by another
 * agent, and needs nothing from the builder. Linked only. Null when none.
 */
async function nextReady(ctx: TrackContext, owner: string, i: TrackIn, projectKey: string, sentId: string): Promise<NextReady | null> {
  if (ctx.builderId === null || !projectKey || (await lastProjectKey(ctx.installationId)) !== projectKey) return null;
  const ids = [...new Set((await lastListIds(ctx.installationId)).filter((x) => x && x !== sentId))];
  if (ids.length === 0) return null;
  const { facts, rec } = await sendFacts(ctx, i, projectKey);
  const claims = await claimed(owner);
  const stale = ctx.now.getTime() - CLAIM_HOURS * 3_600_000;
  for (const id of ids) {
    const row = await getProgram(id);
    if (!row || row.file.in_person || !isOpenAt(row.file, ctx.now)) continue;
    const here = await rowHere(owner, id, projectKey);
    if (here && here.status !== 'started') continue;
    const c = claims.get(id);
    if (c && (c.held || (c.by !== ctx.installationId && Date.parse(c.since) > stale))) continue;
    if (!readyAtSend(row, facts, await doneItems(owner, id, projectKey), storedSide(rec), ctx.now)) continue;
    const filled = prefill(row, facts, rec);
    if (filled.need_you.length > 0) continue;
    return {
      program_id: id, title: row.file.title, money: moneyAt(tileMoney(row.file), 'mid'),
      draft: row.file.submit === 'builder' || rec.record.policy.agent_may_submit === false,
      fields: filled.fields.map((f) => ({ key: f.key, from: f.from, value: f.value, required: f.required })),
    };
  }
  return null;
}
