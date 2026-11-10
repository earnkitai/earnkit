/**
 * The builder's record: one strict schema, a merge that drops a bad leaf (never the whole patch)
 * and stamps who set each path, approvals the builder grants on /me, the answer bank lookups and
 * what the record still lacks, in builder words. Pure; the row lives in builders.record.
 */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { isKnownChain } from '../v5/chains';
import { dropControls } from '../v5/controls';
import { ANSWER_KINDS, PROGRAM_CATEGORIES, type AnswerKind, type FieldKind } from '../v5/program-file';

/** Each value once, in first order (F10, v6.1.12): the one de-duplication /me and the record tool share. Pure. */
export const onceEach = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Newlines and tabs are fine in prose; other control characters are not. */
const CONTROL_PROSE = /[\u0000-\u0008\u000b-\u001f\u007f]/;
/**
 * One line as saved (v6.1.7 S4): tabs and line breaks become a plain space, every other control or format character
 * (bidi overrides, zero-width marks) is dropped, and runs of spaces collapse to one. Pure.
 */
export const cleanLine = (s: string): string => dropControls(s);
const line = (max: number) => z.string().overwrite(cleanLine).max(max);
const prose = (max: number) => z.string().max(max).refine((s) => !CONTROL_PROSE.test(s), 'no control characters');
const https = line(500).pipe(z.url({ protocol: /^https$/ }));
const githubRepo = line(300).regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/, 'must be an https://github.com/<owner>/<repo> link');
const email = line(200).pipe(z.email());
const isoDate = line(10).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}, 'must be YYYY-MM-DD');
const iso = line(40).pipe(z.iso.datetime({ offset: true }));
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const Person = z.object({
  name: line(80), email, x: line(40), linkedin: https, location: line(80),
  timezone: line(64).refine(isTimeZone, 'must be an IANA time zone'), phone: line(30), bio: prose(280),
  technical: z.boolean(), based_country: line(2).regex(/^[A-Z]{2}$/, 'two capital letters, like US'),
}).partial().strip();
const TeamMember = z.object({ name: line(80), role: line(80).optional(), github: line(40).optional(), x: line(40).optional(), email: email.optional() }).strip();
const Company = z.object({
  name: line(120), incorporated: z.boolean(), jurisdiction: line(80), raised_usd: z.number().min(0).max(1e9), raised_from: prose(280),
  stage: z.enum(['idea', 'building', 'pre_launch', 'launched']), launch_date: isoDate,
}).partial().strip();
export const Answer = z.object({
  text: prose(2000).min(1), short: line(280).optional(), written_by: z.enum(['builder', 'agent']), voice_notes: line(120).optional(),
}).strip();
export type Answer = z.infer<typeof Answer>;
const Answers = z.object(Object.fromEntries(ANSWER_KINDS.map((k) => [k, Answer.optional()])) as { [K in AnswerKind]: z.ZodOptional<typeof Answer> }).strip();
const Project = z.object({
  id: line(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a lowercase slug'),
  name: line(80).optional(), one_liner: line(140).optional(), description: prose(600).optional(), goals: prose(600).optional(),
  repo_url: githubRepo.nullable().optional(), live_url: https.optional(), demo_url: https.optional(), category: line(40).optional(),
  // The bad one is named (v6.1.8 C53).
  // Each chain saved once, in first order, on every write path (F10, v6.1.12; final fix: the record tool too).
  chains_claimed: z.array(line(40).refine(isKnownChain, { error: (i) => `not a known chain: ${String(i.input)}` })).max(20).transform(onceEach).optional(),
  answers: Answers.prefault({}),
  /** EarnKit only (find): when the evidence was last read, the tier then and its verified usage line. */
  evidence_read_at: iso.optional(),
  last_tier: z.object({ tier: line(40), line: line(280), read_at: line(40), usage: line(280).optional() }).strip().optional(),
}).strip();
export type Project = z.infer<typeof Project>;
const Docs = z.object({
  resume_url: https.optional(), deck_url: https.optional(), founder_video_url: https.optional(), demo_video_url: https.optional(),
  other: z.array(z.object({ label: line(40), url: https }).strip()).max(10).default([]),
}).strip();
const Traction = z.object({
  line_pre_launch: line(280), waitlist: z.number().int().min(0).max(1e7), revenue_usd_claim: z.number().min(0).max(1e9), notes: prose(280),
}).partial().strip();
const Policy = z.object({
  auto_apply: z.boolean().default(false), max_per_night: z.number().int().min(1).max(20).default(5),
  categories: z.array(z.enum(PROGRAM_CATEGORIES)).max(PROGRAM_CATEGORIES.length).transform((c) => [...new Set(c)]).default([...PROGRAM_CATEGORIES]), max_ask_usd: z.number().min(0).optional(),
  never: z.array(line(100)).max(50).default([]), agent_may_submit: z.boolean().default(true),
}).strip();
const LEAF_BLOCKS: Record<string, z.ZodObject> = { person: Person, company: Company, docs: Docs, traction: Traction, policy: Policy };
/** The schema of one editable leaf, by its /me path (an answer's is its text's), or null. Pure. */
export function fieldSchema(path: string): z.ZodType | null {
  const [block, a, b] = path.split('.');
  if (block === 'answers' || (block === 'projects' && b === 'answers')) return Answer.shape.text;
  // A team member's name or role, by its place in the list (v6.1.8 B19).
  if (block === 'team') return /^\d+$/.test(a ?? '') && (b === 'name' || b === 'role') ? TeamMember.shape.name : null;
  const shape: z.ZodRawShape | undefined = block === 'projects' ? Project.shape : LEAF_BLOCKS[block]?.shape;
  const key = block === 'projects' ? b : a;
  return shape && key !== undefined && Object.hasOwn(shape, key) ? (shape[key] as z.ZodType) : null;
}
/** unapproved_at: when an agent's change dropped an approval the builder had given (v6.1.8 C48); cleared on approval. */
const Meta = z.object({ set_by: z.enum(['builder', 'agent']), set_at: line(40), approved_at: line(40).optional(), unapproved_at: line(40).optional() }).strip();
export type Meta = z.infer<typeof Meta>;

export const BuilderRecord = z.object({
  person: Person.prefault({}),
  team: z.array(TeamMember).max(10).default([]),
  company: Company.prefault({}),
  projects: z.array(Project).max(10).default([]),
  docs: Docs.prefault({}),
  traction: Traction.prefault({}),
  answers: Answers.prefault({}),
  policy: Policy.prefault({}),
  meta: z.record(line(200), Meta).default({}),
}).strip();
export type BuilderRecord = z.infer<typeof BuilderRecord>;
export const EMPTY_RECORD: BuilderRecord = BuilderRecord.parse({});

/** A stored row; `broken`: it did not parse and reads as EMPTY_RECORD (logged by builder id only), so it must not be saved over. */
export function readRecord(v: unknown, builderId?: number): { record: BuilderRecord; broken: boolean } {
  const r = BuilderRecord.safeParse(v ?? {});
  if (r.success) return { record: r.data, broken: false };
  console.error('[record] stored record does not parse; read as empty', builderId ?? 'unknown');
  return { record: structuredClone(EMPTY_RECORD), broken: true };
}

/** A stored row: an invalid value reads as EMPTY_RECORD. */
export const parseRecord = (v: unknown, builderId?: number): BuilderRecord => readRecord(v, builderId).record;

/** Paths a reviewer would read; an agent's change to one waits for the builder's approval on /me. */
export const APPROVABLE = (path: string): boolean =>
  /^answers\.[a-z_]+$/.test(path) || /^projects\.[^.]+\.answers\.[a-z_]+$/.test(path) || path === 'traction.line_pre_launch' || path === 'company.raised';

type By = 'builder' | 'agent';
type Merge = { record: BuilderRecord; problems: string[]; changed: string[] };
const isObj = (v: unknown): v is { [k: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A problem line, "<path>: <issue>", the path cut to 60 characters (a patch's keys are the agent's). */
const bad = (path: string, what: string) => `${path.slice(0, 60)}: ${what}`;
const issue = (path: string, err: z.ZodError) => {
  const i = err.issues[0];
  return bad(i.path.length ? `${path}.${i.path.join('.')}` : path, i.message);
};
const EARNKIT_ONLY = new Set(['evidence_read_at', 'last_tier']);
/** company.raised_usd and raised_from share one path. */
const metaPath = (path: string) => (path === 'company.raised_usd' || path === 'company.raised_from' ? 'company.raised' : path);

/** Merges one object block's keys into `cur` by its shape; null clears a key. Returns the changed leaf paths. */
function mergeFields(cur: { [k: string]: unknown }, patch: unknown, shape: z.ZodRawShape, prefix: string, problems: string[], skip: Set<string> = new Set()): string[] {
  if (!isObj(patch)) {
    problems.push(bad(prefix, 'not an object'));
    return [];
  }
  const changed: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const path = `${prefix}.${key}`;
    if (skip.has(key)) continue;
    if (EARNKIT_ONLY.has(key)) {
      problems.push(bad(path, 'set by EarnKit only'));
      continue;
    }
    // Own keys only: an inherited name (__proto__, constructor, toString) is not a field (security L1).
    const schema = Object.hasOwn(shape, key) ? (shape[key] as z.ZodType) : undefined;
    if (!schema) {
      problems.push(bad(path, 'not a field'));
      continue;
    }
    let next: unknown;
    if (value === null && !schema.safeParse(null).success) next = undefined;
    else {
      const r = schema.safeParse(value);
      if (!r.success) {
        problems.push(issue(path, r.error));
        continue;
      }
      next = r.data;
    }
    if (isDeepStrictEqual(cur[key], next)) continue;
    if (next === undefined) delete cur[key];
    else cur[key] = next;
    changed.push(path);
  }
  return changed;
}

/** Merges an answers map; each answer is merged over the current one; written_by is `by` (a builder may pass either). */
function mergeAnswers(cur: { [k: string]: unknown }, patch: unknown, prefix: string, by: By, problems: string[]): string[] {
  if (!isObj(patch)) {
    problems.push(bad(prefix, 'not an object'));
    return [];
  }
  const changed: string[] = [];
  for (const [kind, value] of Object.entries(patch)) {
    const path = `${prefix}.${kind}`;
    if (!(ANSWER_KINDS as readonly string[]).includes(kind)) {
      problems.push(bad(path, 'not a field'));
      continue;
    }
    let next: Answer | undefined;
    if (value !== null) {
      if (!isObj(value)) {
        problems.push(bad(path, 'not an object'));
        continue;
      }
      const { short: oldShort, ...prev } = (cur[kind] ?? {}) as { [k: string]: unknown };
      // An agent's text is the agent's, whatever it claims; a builder may say either.
      const writtenBy = by === 'agent' || !('written_by' in value) ? by : value.written_by;
      // A new text drops the old short form unless a new one comes with it: the short is a cut of the text, and a
      // builder's edit on /me must leave no approved short behind (v6.1.8 B17). The agent redrafts it from the brief.
      const newText = 'text' in value && value.text !== prev.text;
      const r = Answer.safeParse({ ...prev, ...(newText || oldShort === undefined ? {} : { short: oldShort }), ...value, written_by: writtenBy });
      if (!r.success) {
        problems.push(issue(path, r.error));
        continue;
      }
      next = r.data;
    }
    if (isDeepStrictEqual(cur[kind], next)) continue;
    if (next === undefined) delete cur[kind];
    else cur[kind] = next;
    changed.push(path);
  }
  return changed;
}

function mergeProjects(rec: BuilderRecord, patch: unknown, by: By, problems: string[]): string[] {
  if (!Array.isArray(patch)) {
    problems.push(bad('projects', 'not a list'));
    return [];
  }
  const changed: string[] = [];
  const idSchema = Project.shape.id;
  for (const entry of patch) {
    if (!isObj(entry)) {
      problems.push(bad('projects', 'an entry is not an object'));
      continue;
    }
    const id = idSchema.safeParse(entry.id);
    if (!id.success) {
      problems.push(issue('projects.id', id.error));
      continue;
    }
    const prefix = `projects.${id.data}`;
    let project = rec.projects.find((p) => p.id === id.data);
    const isNew = !project;
    if (!project) {
      if (rec.projects.length >= 10) {
        problems.push(bad(prefix, 'at most 10 projects'));
        continue;
      }
      project = Project.parse({ id: id.data });
    }
    const fields = project as unknown as { [k: string]: unknown };
    const here = mergeFields(fields, entry, Project.shape, prefix, problems, new Set(['id', 'answers']));
    if ('answers' in entry) here.push(...mergeAnswers(project.answers as { [k: string]: unknown }, entry.answers, `${prefix}.answers`, by, problems));
    if (isNew) {
      rec.projects.push(project);
      here.unshift(prefix);
    }
    changed.push(...here);
  }
  return changed;
}

const BLOCKS = { person: Person, company: Company, docs: Docs, traction: Traction, policy: Policy } as const;

/**
 * Deep-merges a patch into the record: objects merged, arrays replaced whole, projects merged by id.
 * Each changed path is stamped `{ set_by, set_at }`; an agent's change to an approvable path drops
 * its approval (a builder's keeps it); policy is the builder's only. Every bad leaf is dropped with a "<path>: <issue>" line.
 */
export function mergeRecord(current: BuilderRecord, patch: unknown, by: By, now: Date): Merge {
  const problems: string[] = [];
  if (!isObj(patch)) return { record: current, problems: ['set: not an object'], changed: [] };
  const rec = structuredClone(current);
  const leaves: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'meta' || key === 'evidence_read_at') problems.push(bad(key, 'set by EarnKit only'));
    // Standing approval and its limits are the builder's consent, given on /me only.
    else if (key === 'policy' && by === 'agent') problems.push(bad('policy', 'set by the builder on earnkit.com/me only'));
    else if (Object.hasOwn(BLOCKS, key)) {
      const block = BLOCKS[key as keyof typeof BLOCKS];
      leaves.push(...mergeFields(rec[key as keyof typeof BLOCKS] as { [k: string]: unknown }, value, block.shape, key, problems));
    } else if (key === 'team') {
      const r = BuilderRecord.shape.team.safeParse(value);
      if (!r.success) problems.push(issue('team', r.error));
      else if (!isDeepStrictEqual(rec.team, r.data)) {
        rec.team = r.data;
        leaves.push('team');
      }
    } else if (key === 'answers') leaves.push(...mergeAnswers(rec.answers as { [k: string]: unknown }, value, 'answers', by, problems));
    else if (key === 'projects') leaves.push(...mergeProjects(rec, value, by, problems));
    else problems.push(bad(key, 'not a field'));
  }
  // Defaults (policy) refill after a clear; every leaf was checked, so this parse holds.
  const out = BuilderRecord.safeParse(rec);
  if (!out.success) return { record: current, problems: [...problems, issue('set', out.error)], changed: [] };
  const record = out.data;
  // Compared after the fill, so a null sent to a field already at its default is no change.
  const changed = [...new Set(leaves.filter((p) => !isDeepStrictEqual(leafAt(current, p), leafAt(record, p))).map(metaPath))];
  for (const path of changed) {
    const prev = record.meta[path];
    const keep = by === 'builder' && prev?.approved_at ? { approved_at: prev.approved_at } : {};
    // An agent's change to an approved text: when the approval dropped, so the builder's other agents can say so (C48).
    const unapproved = by === 'agent' && APPROVABLE(path) && prev?.approved_at ? now.toISOString() : keep.approved_at ? undefined : prev?.unapproved_at;
    record.meta[path] = { set_by: by, set_at: now.toISOString(), ...keep, ...(unapproved ? { unapproved_at: unapproved } : {}) };
  }
  return { record: changed.length > 0 ? record : current, problems, changed };
}

/** The value at a leaf path as the merge names it (projects by id). */
function leafAt(record: BuilderRecord, path: string): unknown {
  const parts = path.split('.');
  let at: unknown = record;
  if (parts[0] === 'projects') {
    at = record.projects.find((p) => p.id === parts[1]);
    parts.splice(0, 2);
  }
  for (const k of parts) at = isObj(at) ? at[k] : undefined;
  return at;
}

/** The value at an approvable path, or undefined. */
function valueAt(record: BuilderRecord, path: string): unknown {
  if (path === 'company.raised') return record.company.raised_usd ?? record.company.raised_from;
  if (path === 'traction.line_pre_launch') return record.traction.line_pre_launch;
  const a = /^answers\.([a-z_]+)$/.exec(path);
  if (a) return (record.answers as { [k: string]: unknown })[a[1]];
  const p = /^projects\.([^.]+)\.answers\.([a-z_]+)$/.exec(path);
  if (p) return (record.projects.find((x) => x.id === p[1])?.answers as { [k: string]: unknown } | undefined)?.[p[2]];
  return undefined;
}

/** Approves an approvable path that holds a value (only /me calls this); otherwise the record unchanged. */
export function approvePath(record: BuilderRecord, path: string, now: Date): BuilderRecord {
  if (!APPROVABLE(path) || valueAt(record, path) === undefined) return record;
  const { unapproved_at: _, ...prev } = record.meta[path] ?? { set_by: 'builder' as const, set_at: now.toISOString() };
  return { ...record, meta: { ...record.meta, [path]: { ...prev, approved_at: now.toISOString() } } };
}

export function unapprovePath(record: BuilderRecord, path: string): BuilderRecord {
  const prev = record.meta[path];
  if (!prev?.approved_at) return record;
  const { approved_at: _, ...rest } = prev;
  return { ...record, meta: { ...record.meta, [path]: rest } };
}

/**
 * Answers an agent's change took back from approval after `since` (any time when null) and still waiting: what the
 * builder's other agents say on their next find (v6.1.8 C48). Pure.
 */
export function unapprovedSince(record: BuilderRecord, since: Date | null): number {
  return Object.entries(record.meta).filter(
    ([path, m]) => m.unapproved_at && (!since || Date.parse(m.unapproved_at) > since.getTime()) && !isApproved(record, path) && valueAt(record, path) !== undefined,
  ).length;
}

export const isApproved = (record: BuilderRecord, path: string): boolean =>
  APPROVABLE(path) && Boolean(record.meta[path]?.approved_at) && valueAt(record, path) !== undefined;

/** The answer kind a field kind reads from the bank: how_it_works reads solution; fact kinds none. */
const answerKindOf = (kind: FieldKind | AnswerKind): AnswerKind | null =>
  kind === 'how_it_works' ? 'solution' : (ANSWER_KINDS as readonly string[]).includes(kind) ? (kind as AnswerKind) : null;

/** The project's approved answer for the kind, else the record's; null when none is approved. */
export function answerFor(record: BuilderRecord, projectId: string | null, kind: FieldKind): { text: string; short: string | null } | null {
  const k = answerKindOf(kind);
  if (!k) return null;
  const pick = (path: string) => {
    const a = valueAt(record, path) as Answer | undefined;
    return a && isApproved(record, path) ? { text: a.text, short: a.short ?? null } : null;
  };
  return (projectId !== null ? pick(`projects.${projectId}.answers.${k}`) : null) ?? pick(`answers.${k}`);
}

export const KIND_WORDS: Record<AnswerKind, string> = {
  one_liner: 'the one-liner', problem: 'the problem', solution: 'the solution', traction: 'traction', team: 'the team', why_you: 'why you',
  milestones: 'milestones', use_of_funds: 'use of funds', competitors: 'competitors', risks: 'risks', ecosystem_fit: 'ecosystem fit',
  what_next: 'what is next', past_work: 'past work', help_needed: 'help needed',
};

/** A need's doc check and its builder words. pitch_pdf: an other[] link labelled with "pitch". */
const NEED_DOCS: { need: string; has: (r: BuilderRecord) => boolean; words: string }[] = [
  { need: 'founder_video', has: (r) => Boolean(r.docs.founder_video_url), words: 'your founder video link' },
  { need: 'demo_video', has: (r) => Boolean(r.docs.demo_video_url), words: 'your demo video link' },
  { need: 'resume', has: (r) => Boolean(r.docs.resume_url), words: 'your resume link' },
  { need: 'deck', has: (r) => Boolean(r.docs.deck_url), words: 'your deck link' },
  { need: 'pitch_pdf', has: (r) => r.docs.other.some((o) => /pitch/i.test(o.label)), words: 'your pitch PDF link' },
];

/** Whether the record holds the document a program needs (founder_video, deck, ...); unknown needs are held. Pure. */
export const hasDoc = (record: BuilderRecord, need: string): boolean => NEED_DOCS.find((d) => d.need === need)?.has(record) ?? true;

/** The record item for a project with a link (lane 8 #10, v6.1.10: never missing on a find that passed a repo). */
export const PROJECT_ITEM = 'a project with its repo or site';

type Asks = { needs: string[]; kinds: string[]; verifiedUsage?: boolean };

/**
 * The items the open programs ask of the record (`total`) and the ones it lacks, in builder words (`missing`). `needs`:
 * the programs' needs; `kinds`: the answer kinds their forms ask; `verifiedUsage`: usage numbers exist, so no traction
 * line is needed. A traction field reads the usage or the line, never the bank: traction is one item (v6.1.8 C49).
 */
export function recordItems(record: BuilderRecord, o: Asks): { total: number; missing: string[] } {
  const items: [boolean, string][] = [];
  // Two items, so a saved name is no longer named as missing (v6.1.7 C12).
  items.push([Boolean(record.person.name), 'your name'], [Boolean(record.person.email), 'your email']);
  items.push([record.projects.some((p) => p.repo_url || p.live_url), PROJECT_ITEM]);
  if (!o.verifiedUsage) items.push([isApproved(record, 'traction.line_pre_launch'), 'one approved line on traction']);
  const kinds = [...new Set(o.kinds.map((k) => answerKindOf(k as FieldKind)).filter((k): k is AnswerKind => k !== null && k !== 'traction'))];
  for (const k of ANSWER_KINDS.filter((x) => kinds.includes(x))) {
    const any = answerFor(record, null, k) ?? record.projects.map((p) => answerFor(record, p.id, k)).find(Boolean);
    items.push([Boolean(any), `an approved answer on ${KIND_WORDS[k]}`]);
  }
  for (const d of NEED_DOCS) if (o.needs.includes(d.need)) items.push([d.has(record), d.words]);
  return { total: items.length, missing: items.filter(([has]) => !has).map(([, words]) => words) };
}

/** What the record lacks for the open programs, in builder words (`recordItems`' missing). Pure. */
export const recordMissing = (record: BuilderRecord, o: Asks): string[] => recordItems(record, o).missing;

const filledObj = (o: object) => Object.values(o).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));
const BLOCK_WORDS: [string, (r: BuilderRecord) => boolean][] = [
  ['about you', (r) => filledObj(r.person)],
  ['a project', (r) => r.projects.length > 0],
  ['the company', (r) => filledObj(r.company)],
  ['your documents', (r) => filledObj(r.docs)],
  ['traction', (r) => filledObj(r.traction)],
  ['answers', (r) => filledObj(r.answers) || r.projects.some((p) => filledObj(p.answers))],
];

/** Which of the six blocks hold anything, in plain words. */
export function completeness(record: BuilderRecord): { filled: string[]; missing: string[] } {
  const filled: string[] = [];
  const missing: string[] = [];
  for (const [words, has] of BLOCK_WORDS) (has(record) ? filled : missing).push(words);
  return { filled, missing };
}
