import { BASE_GRANTS_ID } from './builder-code';
import { appProvenRepo, builderCodesKnown, builderCodesWords, refreshBuilderCodes } from './builder-codes-check';
import { EntryError, githubRepo } from './campaigns';
import { NotFoundError, type ProgramRow } from './programs';
import { shipLogBlock, shipLogFacts, type ShipLogFacts } from './ship-log-facts';
import { prepareSubmission, type ProjectInfo } from './submission';
import { draftKit, schemeless } from './submit-kit';
import type { SubmissionRequirement } from './program-file';
import type { ToolContext } from './tools';

/**
 * v3.1 (spec 3.2), "Apply with this page": prepare for a curated program drafts the application from the ship log and
 * never submits. The first call (no answers, a project answer still to draft) hands the agent the requirements; the
 * second shows the draft: the ship log block, Base's Builder Codes line, every field, and how to send it (Base: one
 * prefilled Google Form link; every other form: copy and paste). It ends with SENT_ASK; a yes is `tell program_status`
 * applied. Nothing is recorded here.
 */

export const DRAFT_FIRST_NOTE =
  "Draft an answer for each requirement you can from the repo in this folder and ship_log (never a personal detail such as a name, email or Telegram, never a number you don't know), then call prepare again with program_id, project and answers. Show nothing until then. Don't show this note.";
export const DRAFT_NOTE =
  "Show show_to_builder as written. Never submit the form for the builder. When they say they sent it, call tell with program_status: [{ program_id, status: 'applied' }]. Don't show this note.";
/** The builder's page in the first free-text answer. */
export const PAGE_IN_ANSWER = (page: string) => `Weekly ship log: ${page}`;

/** R13: how long the draft waits for a Builder Codes check before it goes on without one. */
export const BUILDER_CODES_WAIT_MS = 8_000;

type Reply = Record<string, unknown>;
type DraftInput = { program_id: string; project?: ProjectInfo; answers?: Record<string, string> };

/** The ship log facts off a shared client (its installation serves many builders); a failed read is none. */
async function shipLog(ctx: ToolContext): Promise<ShipLogFacts | null> {
  if (ctx.sharedClient) return null;
  return shipLogFacts(ctx.installationId, new Date()).catch((err: unknown) => {
    console.error('[draft] ship log', err instanceof Error ? err.name : 'error');
    return null;
  });
}

/**
 * The page link added to the first answered free-text answer (type text, never a contact field), once: only when the
 * answer doesn't hold it already and the result stays within max_chars. Pure.
 */
export function withPageLink(reqs: SubmissionRequirement[], values: Record<string, string>, page: string): Record<string, string> {
  const r = reqs.find((x) => x.type === 'text' && x.kind !== 'contact' && values[x.key]?.trim());
  if (!r) return values;
  const answer = values[r.key].trim();
  if (answer.toLowerCase().includes(schemeless(page).toLowerCase())) return values;
  const next = `${answer}${/[.!?]$/.test(answer) ? '' : '.'} ${PAGE_IN_ANSWER(page)}`;
  if (r.max_chars !== undefined && next.length > r.max_chars) return values;
  return { ...values, [r.key]: next };
}

/**
 * Task 9 fix round 1 (security): "owner/repo" from the given GitHub link only when this builder proved that repo through
 * the read-only App, else null (no stored answer read, no check started).
 */
async function provenKey(ctx: ToolContext, url: string | undefined): Promise<string | null> {
  const gh = url ? githubRepo(url) : null;
  if (!gh) return null;
  const key = `${gh.owner}/${gh.repo}`.toLowerCase();
  return (await appProvenRepo(ctx.installationId, key)) ? key : null;
}

/**
 * R13: whether the repo carries Builder Codes: the stored answer when under a day old, else the check (one per repo
 * a day), awaited up to BUILDER_CODES_WAIT_MS; past it, or when the read fails, the stored answer or null (nothing is
 * said). Never throws.
 */
async function builderCodes(ctx: ToolContext, key: string): Promise<boolean | null> {
  const now = new Date();
  const known = await builderCodesKnown(key, now);
  const check = refreshBuilderCodes(ctx.installationId, key, known, now, ctx.codesFetch);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), BUILDER_CODES_WAIT_MS);
  });
  try {
    const found = check ? await Promise.race([check, late]) : null;
    return found ?? known?.found ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export async function draftApplication(input: DraftInput, ctx: ToolContext, program: ProgramRow): Promise<Reply> {
  // R15: an unlisted program is gone, as an unknown id; a closed one says so, an upcoming one too (never "closed").
  if (program.status === 'unlisted') throw new NotFoundError(`No program with id "${program.id}". Call find for current ids.`);
  if (program.status === 'upcoming' && !(program.ends_at && program.ends_at <= new Date())) throw new EntryError('This program is not open yet.');
  if (program.status !== 'active' || (program.ends_at && program.ends_at <= new Date())) throw new EntryError('This program is closed.');
  const { program_id } = input;
  const reqs = program.submission_requirements;
  const project = input.project ?? {};
  const log = await shipLog(ctx);

  // The first call: the agent drafts the project's answers from the repo and the ship log, then calls again.
  const toDraft = reqs.some((r) => r.from === 'project' && !(r.project_field && project[r.project_field]?.trim()));
  if (input.answers === undefined && toDraft)
    return {
      program_id,
      show_to_builder: '',
      requirements: reqs.map((r) => ({
        key: r.key,
        label: r.label,
        ...(r.description && { description: r.description }),
        ...(r.options && { options: r.options }),
        ...(r.max_chars !== undefined && { max_chars: r.max_chars }),
        from: r.from,
      })),
      ship_log: log,
      agent_note: DRAFT_FIRST_NOTE,
    };

  const prep = prepareSubmission(reqs, { project, answers: input.answers ?? {} });
  const filled = Object.fromEntries(prep.complete.map((c) => [c.key, c.value]));
  const values = log ? withPageLink(reqs, filled, `https://${schemeless(log.page)}`) : filled;
  const problems = prep.missing.filter((m) => m.problem).map((m) => m.key);
  const kit = draftKit(program, values, { problems });

  const repo = program.id === BASE_GRANTS_ID ? await provenKey(ctx, project.repo_url ?? input.answers?.repo_url) : null;
  const codes = repo ? await builderCodes(ctx, repo) : null;
  // D7: the block's live site without its scheme too, so the form link is the reply's one https link.
  const shown = [
    log ? shipLogBlock(log).map(schemeless).join('\n') : null,
    repo ? builderCodesWords(repo, codes) : null,
    kit.show_to_builder,
  ].filter((x): x is string => Boolean(x));
  return {
    program_id,
    show_to_builder: shown.join('\n\n'),
    draft: { mode: kit.mode, url: kit.url, ...(kit.prefilled_url && { prefilled_url: kit.prefilled_url }), fields: kit.fields },
    ...(log && { ship_log: log }),
    ...(program.id === BASE_GRANTS_ID && { builder_codes: codes }),
    agent_note: DRAFT_NOTE,
  };
}
