/**
 * Pre-fill for a program's form: fact fields EarnKit can fill from repo facts, prose fields
 * handed to the agent with sources, personal fields left to the builder. EarnKit writes no prose.
 * `facts_from_repo` counts only values the code read gave (a public read), never anything the agent passed. Pure.
 */
import { chainName } from './chains';
import type { SubmissionRequirement } from './program-file';
import type { ProgramRow } from './programs';
import type { Basis, RepoFacts } from './repo-facts';

export type Field = {
  key: string;
  label: string;
  type: SubmissionRequirement['type'];
  required: boolean;
  kind: SubmissionRequirement['kind'];
  value: string | null;
  from: 'earnkit' | 'agent' | 'builder';
  sources?: string[];
  options?: string[];
  max_chars?: number;
  guidance?: string;
  form_id?: string;
};

/** Only what nobody but the builder can produce; team, contacts and money raised come from the agent's memory. */
const BUILDER_KINDS: ReadonlySet<string> = new Set(['demo_video']);
const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

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
  if (r.kind === 'links') {
    const links = [facts.live_url, facts.repo_url].filter((x): x is string => !!x);
    const read = (facts.live_url && facts.live_url_basis === 'code') || (facts.repo_url && facts.repo_url_basis === 'code');
    return filledBy(facts, links.length > 0 ? links.join(' ') : null, read ? 'code' : 'reported');
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

export function prefill(program: ProgramRow, facts: RepoFacts): { fields: Field[]; filled: number; facts_from_repo: number; total: number } {
  const file = program.file;
  let facts_from_repo = 0;
  const fields = file.submission_requirements.map((r): Field => {
    const guidance = guidanceOf(r);
    const base = {
      key: r.key, label: r.label, type: r.type, required: r.required, kind: r.kind,
      ...(r.options ? { options: r.options } : {}),
      ...(r.max_chars ? { max_chars: r.max_chars } : {}),
      ...(guidance ? { guidance } : {}),
      ...(file.form?.fields?.[r.key] ? { form_id: file.form.fields[r.key] } : {}),
    };
    const filled = valueOf(r, file, facts);
    if (filled !== null) {
      if (filled.repo) facts_from_repo++;
      return { ...base, value: filled.value, from: 'earnkit' };
    }
    if (r.type === 'file' || BUILDER_KINDS.has(r.kind) || /contract/.test(r.key))
      return { ...base, value: null, from: 'builder' };
    if (r.type === 'choice' || r.type === 'multi_choice')
      return { ...base, value: null, from: 'agent', sources: ['the options', 'the description'] };
    return { ...base, value: null, from: 'agent', sources: sourcesOf(facts, guidance) };
  });
  return { fields, filled: fields.filter((f) => f.from === 'earnkit').length, facts_from_repo, total: fields.filter((f) => f.required).length };
}
