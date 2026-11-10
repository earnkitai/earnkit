/**
 * The track tool: validates the input, writes the ledger (or, for started, the claim), and answers
 * with one line for the builder, one for the agent, and the updated ledger.
 */
import { z } from 'zod';
import { getRecord, ownerKey, takeUnlinkedNotice, unlinkedReason } from '../v6/builders';
import { DELETED_NOTICE } from '../v6/reply-words';
import { claim } from '../v6/claims';
import { HAD_CLOSED, NIGHT_LIMIT, REQUIRED_MISSING, STEP_AWAY, outsideApproval, readyAtSend, requiredLeftOut, storedRecordContext, storedSide } from '../v6/find-record';
import { prefill, unvouchedRequired } from './prefill';
import { cachedRepoFacts, reportOnlyFacts } from './repo-facts';
import { forgetGap, lastGaps, lastProjectKey, unmarkNightFind } from './installations';
import { PROJECT_DESCRIPTION, ProjectArg, nameKeyOf, parseProject, projectKeyOf, type Project } from './project-input';
import { getProgram, isOpen, listOpenPrograms, programByName, unknownProgramLine } from './programs';
import { dayOf, doneItems, record, reportOf, resolvedKey, summary, titleOf, type Ledger, type Status } from './ledger';
import { clock } from './reply';
import { codeChecked, itemKey } from './eligibility';
import { eligibilityOf } from './program-file';
import { sql } from './db';
import { inputDetail, readLoosely, type LooseRules } from './tool-input';

/** The most field keys a send keeps (v6.1.13, B6); the rest are dropped, never refused. */
export const FIELDS_KEPT = 200;
/** The most characters of a send's note the ledger keeps (L13-3, v6.1.14). */
export const NOTE_KEPT = 280;

export const TrackInput = z
  .object({
    program_id: z.string().min(1).max(80),
    status: z.enum(['started', 'applied', 'won', 'rejected', 'no_result', 'skipped', 'unskip', 'gap_done']),
    /** L13-5 (v6.1.14): no ceiling here; the ledger answers a win over the program's pay with its own line. */
    amount_usd: z.number().finite().min(0).optional(),
    /** L13-3 (v6.1.14): the form already went out, so a long note is cut to NOTE_KEPT characters, never refused. */
    note: z.string().transform((x) => x.slice(0, NOTE_KEPT)).optional(),
    item: z.string().max(80).optional(),
    project_id: z.string().max(40).optional(),
    submitted_by: z.enum(['agent', 'builder']).optional(),
    /** B6 (v6.1.13): the form already went out, so a long list is never refused: the first FIELDS_KEPT keys, each cut to 60. */
    fields_used: z.array(z.string()).transform((xs) => xs.slice(0, FIELDS_KEPT).map((x) => x.slice(0, 60))).optional(),
    /** The project find was called with (v6.1.10 L1c-1), find's own schema (v6.1.14 T5), read by find's parser and limits (v6.1.13 B5): cut and dropped, never refused. */
    project: ProjectArg.loose().describe(PROJECT_DESCRIPTION).optional(),
  })
  .strict();

/** `application_id` (L13-1, v6.1.14): on a send recorded, the application's own id; a program's screen matches its outcome by it. */
type Result = { show_to_builder: string; agent_note: string; ledger: Ledger; already_started?: true; application_id?: string };
/** The track input with its project parsed as find parses it (`parseProject`, partial: v6.1.13 B5). */
type TrackIn = Omit<z.infer<typeof TrackInput>, 'project'> & { project?: Project };

/** Whether a project key (projectKeyOf) names no repo: a name alone, or no project. Pure. */
const repoLess = (key: string) => key === '' || key.startsWith('name:');
/** A passed project fact as text, or null. Pure. */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** True when the owner's row for the program is an application already sent (applied or with a result). */
async function sentHere(owner: string, programId: string): Promise<boolean> {
  const [r] = await sql()<{ status: string }[]>`SELECT status FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
  return r !== undefined && r.status !== 'started' && r.status !== 'skipped';
}

/** The sent application's own id (L13-1, v6.1.14), as the reply field; none for a row without one. */
async function applicationIdOf(owner: string, programId: string): Promise<{ application_id?: string }> {
  const [r] = await sql()<{ application_id: string | null }[]>`SELECT application_id FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
  return r?.application_id ? { application_id: r.application_id } : {};
}

/** The program's rules the owner has not confirmed yet. */
async function rulesLeft(owner: string, programId: string, projectKey: string): Promise<number> {
  const program = await getProgram(programId);
  if (!program) return 0;
  const done = await doneItems(owner, programId, projectKey);
  return [...new Set(eligibilityOf(program.file).filter((x) => x.kind === 'rule').map(itemKey))].filter((k) => !done.has(k)).length;
}

export type TrackContext = { installationId: number; builderId: number | null; now: Date };

/** The statuses a ledger row may take after its program left the catalog. */
const RESULT_STATUSES: readonly string[] = ['won', 'rejected', 'no_result'];

/** L12-4, L13-4 (v6.1.14): how track reads wrong-typed arguments before TrackInput (`readLoosely`). */
const TRACK_LOOSE: LooseRules = { text: ['program_id', 'project_id', 'item'], objects: ['project'] };

export const TRACK_UNREAD = 'I could not read that. Send the program, a status, and for a win the amount.';

/**
 * The project this track is about (projectKeyOf, v6.1.10 L1c-1): the project passed, else the record project named by
 * project_id, else the installation's last find with a project. `given` is false for the last find's. A name key whose
 * report names a repo is that repo's key (`resolvedKey`, W1 final round), as find reads it.
 */
async function projectOf(ctx: TrackContext, i: { project?: Project; project_id?: string }): Promise<{ key: string; given: boolean }> {
  const p = await givenProjectOf(ctx, i);
  return { ...p, key: await resolvedKey(ownerKey(ctx.installationId, ctx.builderId), p.key) };
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
  return { ...r, show_to_builder: `${DELETED_NOTICE} ${r.show_to_builder}` };
}

async function answer(ctx: TrackContext, input: unknown): Promise<Result> {
  const owner = ownerKey(ctx.installationId, ctx.builderId);
  const programs = await listOpenPrograms(ctx.now);
  const refuse = async (note: string, agentNote = 'Nothing was recorded.'): Promise<Result> => ({
    show_to_builder: note,
    agent_note: agentNote,
    ledger: await summary(owner, programs, ctx.now),
  });
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  // L12-4, L13-4 (v6.1.14): read leniently first, as find reads its arguments: a null project is no project (the
  // last find's), a string one is dropped and named, a numeric id is its text.
  const loose = readLoosely(input, TRACK_LOOSE);
  const parsed = TrackInput.safeParse(loose.args);
  if (!parsed.success) return refuse(TRACK_UNREAD, `Nothing was recorded. ${inputDetail(parsed.error)}`);
  // F4 (v6.1.12): the program by what the builder calls it, as find takes it. A name that is no one program records
  // nothing, except a result on an id the ledger holds as sent, whose program may have left the catalog since.
  // Final fix (v6.1.12, Task 2 I1): a result on an id the ledger holds as sent is that one, before any matching.
  // B5 (v6.1.13): the project as find reads it, with find's limits: a long name is cut, a long link dropped, never refused.
  const read = parsed.data.project === undefined ? null : parseProject(parsed.data.project, ctx.now, { partial: true });
  const projectProblems = read?.ok ? read.problems : [];
  const given: TrackIn = { ...parsed.data, project: read?.ok ? read.project : undefined };
  const raw = given.program_id;
  const held = RESULT_STATUSES.includes(given.status) && (await sentHere(owner, raw));
  const { row, suggest } = held ? { row: null, suggest: [] } : await programByName(raw, ctx.now);
  const data = row ? { ...given, program_id: row.id } : given;
  // An unknown project_id is dropped, and named for the agent (v6.1.7, C17).
  const { project_id, ...rest } = data;
  const known = project_id === undefined || (await knownProject(ctx.builderId, project_id));
  const acted = !row && !held
    ? await refuse(unknownProgramLine(suggest))
    : await act(ctx, owner, programs, refuse, known ? data : rest);
  // Final fix (v6.1.12, I2): matched by another name, the first line says which program it was.
  const r = row && row.id !== raw
    ? { ...acted, show_to_builder: namedFirst(acted.show_to_builder, row.file.title), agent_note: `Matched ${row.id}. ${acted.agent_note}` }
    : acted;
  const p0 = projectProblems.length > 0 ? { ...r, agent_note: `${r.agent_note} Project: ${projectProblems.join('; ')}.`.trim() } : r;
  const p = loose.problems.length > 0 ? { ...p0, agent_note: `${p0.agent_note} Some arguments were not read: ${loose.problems.join('; ')}.` } : p0;
  return known ? p : { ...p, agent_note: `${p.agent_note} project_id ${project_id} is not known; ignored.`.trim() };
}

/**
 * The builder line with the program named in its first sentence, when it does not name it already: "Started." reads
 * "Started: {title}.", "Tracked." "Tracked: {title}." Pure.
 */
export function namedFirst(show: string, title: string): string {
  if (show.includes(title)) return show;
  const named = show
    .replace(/^(Started|Tracked|Recorded|Noted)\./, `$1: ${title}.`)
    .replace(/^Already (skipped|noted)\./, `Already $1: ${title}.`)
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
  // The last find's gaps are its project's: another project passed here is not that one.
  const sameAsLast = !project.given || project.key === (await lastProjectKey(ctx.installationId));
  if (i.status === 'started') {
    const program = await getProgram(i.program_id);
    if (!program) return refuse("I don't know that program.");
    const sentAlready = {
      show_to_builder: `${program.file.title} was already sent.`,
      agent_note: 'Do not submit this one; it was already sent.',
    };
    // The same open list find reads (active, not past its close, not stale): a program not in it is never claimed.
    // An application already sent says so first, even when its program has since closed (v6.1.7).
    if (!programs.some((p) => p.id === program.id) && (await sentHere(owner, program.id)))
      return { ...sentAlready, ledger: await summary(owner, programs, ctx.now), already_started: true };
    if (!programs.some((p) => p.id === program.id))
      return refuse(`${program.file.title} is not open; nothing to start.`, 'Do not submit this one; call find for what is open.');
    // L1d-1 (v6.1.11): with no project_id the claim stores the project key, so find pins it on that project only.
    const c = await claim(owner, i.program_id, i.project_id ?? (project.key || null), ctx.installationId, ctx.now);
    if (!c.ok && 'skipped' in c)
      return {
        show_to_builder: 'You skipped that one. Say unskip to bring it back.',
        agent_note: 'Do not submit this one.',
        ledger: await summary(owner, programs, ctx.now),
      };
    if (!c.ok)
      return {
        ...(c.already.sent
          ? sentAlready
          : {
              show_to_builder: `${program.file.title} is already being handled since ${clock(c.already.since, ctx.now)} by ${c.already.by ?? 'another agent'}.`,
              agent_note: 'Do not submit this one; call find again later.',
            }),
        ledger: await summary(owner, programs, ctx.now),
        already_started: true,
      };
    // The last find called this one a gap: say what was still missing, so it is fixed before the form goes in. Not
    // when the builder (through any of their agents) has since closed that item (v6.1.7, C23).
    const builderSubmits = program.file.in_person || program.file.submit === 'builder';
    const gap = sameAsLast ? (await lastGaps(ctx.installationId))[program.id] : undefined;
    if (gap && !(gap.item && (await doneItems(owner, program.id, project.key)).has(gap.item)))
      return gap.kind === 'rule'
        ? {
            show_to_builder: `Started. When I last looked it still had a rule to confirm: ${gap.what}. Say yes if that is you.`,
            agent_note: "If the builder says the rule fits, call track gap_done with that gap's item, then find again. Otherwise skip the program.",
            ledger: await summary(owner, programs, ctx.now),
          }
        : {
            show_to_builder: `Started. When I last looked it was still one change away: ${gap.what}.`,
            agent_note: `Make the change before you submit, or call find again to check it. ${builderSubmits ? sendNote(true) : 'Then fill the form from the fields, submit, and call track with applied, submitted_by and fields_used.'}`,
            ledger: await summary(owner, programs, ctx.now),
          };
    return {
      // N11 (v6.1.9): an unlinked agent has no other agents to speak of.
      show_to_builder: ctx.builderId === null ? 'Started.' : 'Started. Your other agents leave this one alone for 24 hours.',
      agent_note: sendNote(builderSubmits),
      ledger: await summary(owner, programs, ctx.now),
    };
  }
  // Sent under standing approval: the builder's policy at this moment (never for an unlinked installation), and only
  // an agent's own submission; a form the builder sent is never one. With the policy on, the send counts as approved
  // only within every limit (v6.1.8 B18): `outside` says why not; the nightly count is the ledger's, under its lock.
  const policy = i.status === 'applied' && i.submitted_by === 'agent' && ctx.builderId !== null ? await getRecord(ctx.builderId) : null;
  const standing = policy?.policy.auto_apply === true;
  const row = i.status === 'applied' ? await getProgram(i.program_id) : null;
  // S6 (v6.1.9): within the limits, a send under standing approval also needs every required answer.
  // F1 (v6.1.10, fix round 2): and every required field must be one EarnKit vouches for (`unvouchedRequired`, the rule
  // find holds the tonight list on), over the program prefilled with the stored record and the send's project, whatever
  // keys fields_used names.
  // B2 (v6.1.13): and the program's verdict for this project must be ready, as find would list it now.
  let outside = standing && row ? (outsideApproval(policy!, row) ?? (await notApprovedAtSend(ctx, owner, i, row, project.key))) : null;
  const applied = i.status === 'applied'
    ? { submitted_by: i.submitted_by, fields_used: i.fields_used, project_id: i.project_id, autoApplied: standing && outside === null, ...(standing ? { maxPerNight: policy!.policy.max_per_night } : {}) }
    : {};
  // Low 17 (v6.1.13): a program sent and waiting on its result has nothing to skip (one with a result says so in the ledger).
  if (i.status === 'skipped' && (await sql()`SELECT 1 FROM applications WHERE owner = ${owner} AND program_id = ${i.program_id} AND status = 'applied'`).length > 0)
    return refuse('That one was already sent; nothing to skip.');
  // A second skip says so (v6.1.9, lane 8 simplify).
  if (i.status === 'skipped' && (await sql()`SELECT 1 FROM applications WHERE owner = ${owner} AND program_id = ${i.program_id} AND status = 'skipped'`).length > 0)
    return { show_to_builder: 'Already skipped.', agent_note: 'Call find again for the updated ledger.', ledger: await summary(owner, programs, ctx.now) };
  const res = await record(owner, i.program_id, i.status as Status, { installationId: ctx.installationId, amount_usd: i.amount_usd, note: i.note, item: i.item, projectKey: project.key, now: ctx.now, ...applied });
  if (res.ok && 'night' in res) outside = NIGHT_LIMIT;
  if (res.ok && 'closed' in res) outside = HAD_CLOSED;
  // The find before a send under standing approval was the night routine's: it leaves the overnight report (v6.1.9).
  if (res.ok && i.status === 'applied' && standing && outside === null) await unmarkNightFind(ctx.installationId);
  if (!res.ok)
    return res.items ? refuse(res.note, `Items for this program: ${res.items.join(', ')}. Call track gap_done with one of them.`) : refuse(res.note);
  if (i.status === 'gap_done' && sameAsLast) await forgetGap(ctx.installationId, i.program_id);
  if (i.status === 'gap_done') {
    // A repeat says so (v6.1.7, C26); a rule is confirmed, not re-read from the repo (m3).
    // N2 (v6.1.8): the program comes back ready only when no other rule of it is left to confirm.
    // N-5 (v6.1.9): what the code or the report settles is re-checked on the next find; the builder's word counts done.
    const left = i.item!.startsWith('rule:') && !('repeated' in res) ? await rulesLeft(owner, i.program_id, project.key) : 0;
    const [show, note] = 'repeated' in res
      ? ['Already noted.', 'Call find again for the updated ledger.']
      : i.item!.startsWith('rule:')
        ? ['Noted. That rule counts as confirmed.', left === 0 ? 'Call find again; the program comes back ready.' : `Call find again; ${left === 1 ? 'one rule is' : `${left} rules are`} left.`]
        : codeChecked(i.item!) && !repoLess(project.key)
          ? ['Noted. I check the repo on the next look.', 'Call find again so the repo is re-read.']
          : codeChecked(i.item!)
            // F6 (v6.1.12): no repo to check; the builder says when it is up.
            ? ['Noted. Tell me when it is live and I look again.', 'When the builder says it is live, call find again with its repo or live link.']
          : ['Noted.', 'Call find again; that step counts as done.'];
    return { show_to_builder: show, agent_note: note, ledger: await summary(owner, programs, ctx.now) };
  }
  const title = await titleOf(owner, i.program_id);
  const lines: Record<Exclude<Status, 'started' | 'gap_done'>, string> = {
    applied: "Tracked. I'll ask how it went when results are due.",
    won: `Recorded: ${usd(i.amount_usd ?? 0)} from ${title}.`,
    rejected: 'Recorded. On to the next one.',
    no_result: 'Recorded.',
    skipped: `Skipped ${title}. I won't bring it up again.`,
    unskip: `Unskipped ${title}. It can come back in the list.`,
  };
  // v6.1.9: a send after the program closed is still recorded, and says so.
  const closed = i.status === 'applied' && row && !isOpen(row.file, ctx.now) && row.file.ends_at && Date.parse(row.file.ends_at) <= ctx.now.getTime()
    ? `${row.file.title} closed on ${dayOf(new Date(row.file.ends_at))}; recorded anyway.`
    : null;
  if (i.status === 'applied' && outside)
    return {
      ...(await applicationIdOf(owner, i.program_id)),
      show_to_builder: [closed, `Sent, but outside your standing approval: ${outside}.`].filter(Boolean).join(' '),
      agent_note: 'Recorded as applied, not under standing approval. Send nothing else alone that falls outside the limits; ask the builder first. Call find again for the updated ledger.',
      ledger: await summary(owner, programs, ctx.now),
    };
  // I1 (v6.1.9 final): after a send under standing approval the agent does not find again, so the morning report stays.
  return {
    ...(i.status === 'applied' ? await applicationIdOf(owner, i.program_id) : {}),
    show_to_builder: closed ?? lines[i.status],
    agent_note: i.status === 'applied' && standing && outside === null
      ? "Done for tonight. The builder's next find reports it; do not call find again until they ask."
      : 'Call find again for the updated ledger.',
    ledger: await summary(owner, programs, ctx.now),
  };
}
