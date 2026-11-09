/**
 * Pre-fill for a program's form, in order: the builder's record (facts and approved answers, when
 * linked), the repo facts, the agent (prose with sources), the builder (files, consents, handles).
 * EarnKit writes no prose. `facts_from_repo` counts only values the code read gave, never anything the agent passed. Pure.
 */
import { STYLE_CONTRACT } from '../v6/answer-brief';
import { answerFor, isApproved, type BuilderRecord } from '../v6/record';
import { chainName } from './chains';
import { ANSWER_KINDS, type SubmissionRequirement } from './program-file';
import type { ProgramRow } from './programs';
import type { Basis, RepoFacts } from './repo-facts';

export type Field = {
  key: string;
  label: string;
  type: SubmissionRequirement['type'];
  required: boolean;
  kind: SubmissionRequirement['kind'];
  value: string | null;
  from: 'earnkit' | 'record' | 'agent' | 'builder';
  sources?: string[];
  /** On a prose field filled from the record: how to fit it (cut, never add). */
  style?: string;
  options?: string[];
  max_chars?: number;
  guidance?: string;
  form_id?: string;
};

/** Only what nobody but the builder can produce. */
const BUILDER_KINDS: ReadonlySet<string> = new Set(['demo_video']);
/** Facts about the builder's work and money: linked or not, the agent never writes these, it asks once. */
const PERSONAL_KINDS: ReadonlySet<string> = new Set(['traction', 'raised']);
const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const fieldWords = (r: SubmissionRequirement): string[] => [...words(r.key), ...words(r.label)];
/** A personal fact, a consent or an amount, by its key or label ("age" whole word only, so "usage" is not one). */
const PERSONAL = /^(amounts?|budgets?|consents?|birth.*|phones?|age|ages|citizen.*|gender.*|ethnic.*)$/;
const isPersonal = (r: SubmissionRequirement) => PERSONAL_KINDS.has(r.kind) || fieldWords(r).some((w) => PERSONAL.test(w));

/**
 * Which URL a links field takes, by its key and label: the live or the repo URL only; 'any' (a generic link: live, else repo);
 * 'both' (a text field labelled only "links" or "relevant links"); or null, the builder's.
 */
type LinkPick = 'live' | 'repo' | 'any' | 'both' | null;
const NOT_OURS = /^(x|twitter|linkedin|farcaster|discord|telegram|deck|pitch|other|store|hunt|explorer)$/;
const LIVE = /^(site|website|live|product|app)$/;
const REPO = /^(repo|repository|github|code|source)$/;
function linkPick(r: SubmissionRequirement): LinkPick {
  const all = fieldWords(r);
  if (all.some((w) => NOT_OURS.test(w))) return null;
  // R1a: repo words beat live words ("App repository", "Link to the app's source code").
  if (all.some((w) => REPO.test(w))) return 'repo';
  if (all.some((w) => LIVE.test(w))) return 'live';
  const label = words(r.label).join(' ');
  if (label === 'url') return 'live';
  if (label === 'link' || label === 'links' || label === 'relevant links') return r.type === 'text' ? 'both' : 'any';
  return null;
}
/** The value a links field takes from a live and a repo URL, and which of them it is. A url field never gets two. */
function pickLinks(r: SubmissionRequirement, live: string | null | undefined, repo: string | null | undefined): { value: string; which: 'live' | 'repo' | 'both' } | null {
  const pick = linkPick(r);
  if (pick === 'both' && live && repo) return { value: `${live} ${repo}`, which: 'both' };
  if ((pick === 'live' || pick === 'any' || pick === 'both') && live) return { value: live, which: 'live' };
  if ((pick === 'repo' || pick === 'any' || pick === 'both') && repo) return { value: repo, which: 'repo' };
  return null;
}

/** A filled value and whether the public code read gave it (not the agent's report). */
type Filled = { value: string; repo: boolean } | null;
const filledBy = (facts: RepoFacts, value: string | null, basis: Basis | null | undefined): Filled =>
  value ? { value, repo: !facts.as_reported && basis === 'code' } : null;
const fromText = (value: string | null): Filled => (value ? { value, repo: false } : null);

function projectValue(r: SubmissionRequirement, facts: RepoFacts): Filled {
  switch (r.project_field) {
    case 'name': return fromText(facts.name);
    case 'description': return fromText(facts.description);
    case 'repo_url': return filledBy(facts, facts.repo_url, facts.repo_url_basis);
    case 'live_url': return filledBy(facts, facts.live_url, facts.live_url_basis);
    case 'demo_url': return filledBy(facts, facts.demo_url, facts.demo_url_basis);
    default: return null;
  }
}

function optionMatches(option: string, facts: RepoFacts): boolean {
  const desc = new Set(words(facts.description));
  const ow = words(option);
  if (ow.length > 0 && ow.every((w) => desc.has(w))) return true;
  const lower = option.trim().toLowerCase();
  return facts.chains.some((c) => chainName(c.chain).toLowerCase() === lower);
}

function choiceValue(r: SubmissionRequirement, facts: RepoFacts): string | null {
  const hits = (r.options ?? []).filter((o) => optionMatches(o, facts));
  if (r.type === 'choice') return hits.length === 1 ? hits[0] : null;
  return hits.length > 0 ? hits.join('; ') : null;
}

function valueOf(r: SubmissionRequirement, program: ProgramRow['file'], facts: RepoFacts): Filled {
  const fromField = projectValue(r, facts);
  if (fromField) return fromField;
  if (/contract/.test(r.key)) {
    const chain = program.chains[0] ?? facts.contracts[0]?.chain;
    const c = facts.contracts.find((x) => x.chain === chain);
    return filledBy(facts, c?.address ?? null, c?.basis);
  }
  if (/chain/.test(r.key)) {
    const mainnet = facts.chains.filter((c) => c.mainnet).map((c) => c.chain);
    const slug = program.chains.find((c) => mainnet.includes(c)) ?? (program.any_chain ? mainnet[0] : undefined);
    if (slug) return filledBy(facts, chainName(slug), facts.chains.find((c) => c.chain === slug)?.basis);
  }
  if (r.type === 'choice' || r.type === 'multi_choice') return fromText(choiceValue(r, facts));
  if (r.type === 'file') return null;
  if (r.kind === 'name') return fromText(facts.name);
  if (r.kind === 'one_liner') return fromText(facts.description);
  // A links field: project_field decides when set (tried above); otherwise the key and label pick one URL.
  if (r.kind === 'links' && r.project_field === undefined) {
    const p = pickLinks(r, facts.live_url, facts.repo_url);
    if (!p) return null;
    const read =
      p.which === 'live' ? facts.live_url_basis === 'code'
      : p.which === 'repo' ? facts.repo_url_basis === 'code'
      : facts.live_url_basis === 'code' || facts.repo_url_basis === 'code';
    return filledBy(facts, p.value, read ? 'code' : 'reported');
  }
  return null;
}

function guidanceOf(r: SubmissionRequirement): string | undefined {
  const parts = [r.guidance?.judges, r.guidance?.pattern].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function sourcesOf(facts: RepoFacts, guidance: string | undefined): string[] {
  const s: string[] = [];
  if (facts.readme_excerpt) s.push(`README: ${facts.readme_excerpt}`);
  if (facts.chains.length > 0) s.push(`chains: ${facts.chains.map((c) => chainName(c.chain)).join(', ')}`);
  if (facts.live_url) s.push(`live: ${facts.live_url}`);
  if (facts.repo_url) s.push(`repo: ${facts.repo_url}`);
  if (facts.first_commit_at) s.push(`first commit: ${facts.first_commit_at.slice(0, 10)}`);
  if (facts.last_commit_at) s.push(`last commit: ${facts.last_commit_at.slice(0, 10)}`);
  if (guidance) s.push(`guidance: ${guidance}`);
  return s;
}

/** The linked builder's record, the project the find chose, and EarnKit's verified usage line. */
export type RecordContext = { record: BuilderRecord; projectId: string | null; verifiedUsage: string | null };
type FromRecord = { value: string; prose: boolean } | null;

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const isProse = (kind: string) => kind === 'how_it_works' || (ANSWER_KINDS as readonly string[]).includes(kind);

/** A contact field from the record's person: name (first, last or whole), email and X; other handles stay the builder's. */
function contactValue(r: SubmissionRequirement, person: BuilderRecord['person']): string | null {
  const label = `${r.label} ${r.key.replace(/_/g, ' ')}`;
  if (r.type === 'email' || /email/i.test(label)) return person.email ?? null;
  if (/\b(x|twitter)\b/i.test(label)) return person.x ?? null;
  if (/name/i.test(label) && person.name) {
    const [first, ...rest] = person.name.trim().split(/\s+/);
    if (/first/i.test(label)) return first;
    if (/last|sur/i.test(label)) return rest.length > 0 ? rest.join(' ') : null;
    return person.name;
  }
  return null;
}

/** The record's value for a field (step 1 of the order), or null. Unapproved answers are never used. */
function recordValue(r: SubmissionRequirement, rec: RecordContext): FromRecord {
  const { record, projectId } = rec;
  if (r.type === 'file' || r.type === 'choice' || r.type === 'multi_choice') return null;
  const project = record.projects.find((p) => p.id === projectId) ?? null;
  const fact = (value: string | null | undefined): FromRecord => (value ? { value, prose: false } : null);
  switch (r.kind) {
    case 'contact': return fact(contactValue(r, record.person));
    case 'links': {
      if (r.project_field === 'live_url') return fact(project?.live_url);
      if (r.project_field === 'repo_url') return fact(project?.repo_url);
      if (r.project_field !== undefined) return null;
      return fact(pickLinks(r, project?.live_url, project?.repo_url)?.value);
    }
    case 'demo_video': return fact(record.docs.demo_video_url);
    case 'raised': {
      if (!isApproved(record, 'company.raised')) return null;
      const { raised_usd, raised_from } = record.company;
      return fact([raised_usd !== undefined ? usd(raised_usd) : null, raised_from ? `from ${raised_from}` : null].filter(Boolean).join(' ') || null);
    }
    case 'traction':
      if (rec.verifiedUsage) return { value: rec.verifiedUsage, prose: false };
      return isApproved(record, 'traction.line_pre_launch') ? { value: record.traction.line_pre_launch!, prose: true } : null;
    case 'team': {
      const a = answerFor(record, projectId, 'team');
      if (a) return { value: pick(a, r), prose: true };
      if (r.type === 'text' && record.team.length > 0) return fact(record.team.map((m) => (m.role ? `${m.name} (${m.role})` : m.name)).join(', '));
      return null;
    }
  }
  const a = answerFor(record, projectId, r.kind);
  return a ? { value: pick(a, r), prose: true } : null;
}

/** The short answer when the field caps under 300 characters and one exists, else the full text. */
const pick = (a: { text: string; short: string | null }, r: SubmissionRequirement) =>
  r.max_chars !== undefined && r.max_chars < 300 && a.short ? a.short : a.text;

const CONTACT_SOURCES = ['git config and the environment', 'what the builder told you'];
const ASK_ONCE = 'the builder, once: store the answer with record before using it';

/**
 * `facts_from_repo`: every field the code read filled (v5's count); `repo_required`, `from_record` and
 * `need_you` are over the required fields only, so together they never exceed `total`.
 */
export function prefill(
  program: ProgramRow,
  facts: RepoFacts,
  rec: RecordContext | null = null,
): { fields: Field[]; filled: number; facts_from_repo: number; repo_required: number; from_record: number; total: number; need_you: string[] } {
  const file = program.file;
  let facts_from_repo = 0;
  let repo_required = 0;
  const fields = file.submission_requirements.map((r): Field => {
    const guidance = guidanceOf(r);
    const base = {
      key: r.key, label: r.label, type: r.type, required: r.required, kind: r.kind,
      ...(r.options ? { options: r.options } : {}),
      ...(r.max_chars ? { max_chars: r.max_chars } : {}),
      ...(guidance ? { guidance } : {}),
      ...(file.form?.fields?.[r.key] ? { form_id: file.form.fields[r.key] } : {}),
    };
    const fromRecord = rec ? recordValue(r, rec) : null;
    if (fromRecord) return { ...base, value: fromRecord.value, from: 'record', ...(fromRecord.prose ? { style: STYLE_CONTRACT } : {}) };
    // Linked or not, traction, money raised, consents, amounts and personal facts are the builder's: never guessed, never drafted.
    if (isPersonal(r)) return { ...base, value: null, from: 'builder' };
    // Contacts (R2a): linked, the record answers first and the rest are the builder's; unlinked, the agent knows who it
    // works for (never asks a stranger who they are, never invents).
    if (r.kind === 'contact') {
      if (rec) return { ...base, value: null, from: 'builder' };
      return { ...base, value: null, from: 'agent', sources: [...CONTACT_SOURCES, ...sourcesOf(facts, guidance)] };
    }
    const filled = valueOf(r, file, facts);
    if (filled !== null) {
      if (filled.repo) facts_from_repo++;
      if (filled.repo && r.required) repo_required++;
      return { ...base, value: filled.value, from: 'earnkit' };
    }
    if (r.type === 'file' || BUILDER_KINDS.has(r.kind) || r.kind === 'links' || /contract/.test(r.key))
      return { ...base, value: null, from: 'builder' };
    if (r.type === 'choice' || r.type === 'multi_choice')
      return { ...base, value: null, from: 'agent', sources: ['the options', 'the description'] };
    // The agent drafts only what the repo and the sources can carry: prose, a name or one-liner, and 'other' text.
    const draftable = isProse(r.kind) || r.kind === 'name' || r.kind === 'one_liner' || (r.kind === 'other' && r.type === 'text');
    if (!draftable) return { ...base, value: null, from: 'builder' };
    const sources = sourcesOf(facts, guidance);
    // An 'other' answer with nothing to draft from is the builder's, never the agent's with no sources (v6.1.6).
    if (r.kind === 'other' && sources.length === 0) return { ...base, value: null, from: 'builder' };
    return { ...base, value: null, from: 'agent', sources: rec && (isProse(r.kind) || r.kind === 'other') ? [...sources, ASK_ONCE] : sources };
  });
  const todo = new Map(file.submission_requirements.map((r) => [r.key, r.todo]));
  return {
    fields,
    filled: fields.filter((f) => f.from === 'earnkit' || f.from === 'record').length,
    facts_from_repo,
    repo_required,
    from_record: fields.filter((f) => f.required && f.from === 'record').length,
    total: fields.filter((f) => f.required).length,
    need_you: fields.filter((f) => f.required && (f.from === 'builder' || f.from === 'agent')).map((f) => todo.get(f.key) ?? f.label.toLowerCase()),
  };
}
