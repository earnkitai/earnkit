/**
 * Pre-fill for a program's form: fact fields EarnKit can fill from repo facts, prose fields
 * handed to the agent with sources, personal fields left to the builder. EarnKit writes no prose.
 * Pure: no I/O.
 */
import { chainName } from './chains';
import type { SubmissionRequirement } from './program-file';
import type { ProgramRow } from './programs';
import type { RepoFacts } from './repo-facts';

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

const BUILDER_KINDS: ReadonlySet<string> = new Set(['team', 'contact', 'raised', 'demo_video']);
const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function projectValue(r: SubmissionRequirement, facts: RepoFacts): string | null {
  switch (r.project_field) {
    case 'name': return facts.name || null;
    case 'description': return facts.description || null;
    case 'repo_url': return facts.repo_url;
    case 'live_url': return facts.live_url;
    case 'demo_url': return facts.demo_url;
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

function valueOf(r: SubmissionRequirement, program: ProgramRow['file'], facts: RepoFacts): string | null {
  const fromField = projectValue(r, facts);
  if (fromField) return fromField;
  if (/contract/.test(r.key)) {
    const chain = program.chains[0] ?? facts.contracts[0]?.chain;
    return facts.contracts.find((c) => c.chain === chain)?.address ?? null;
  }
  if (/chain/.test(r.key)) {
    const mainnet = facts.chains.filter((c) => c.mainnet).map((c) => c.chain);
    const slug = program.chains.find((c) => mainnet.includes(c)) ?? (program.any_chain ? mainnet[0] : undefined);
    if (slug) return chainName(slug);
  }
  if (r.type === 'choice' || r.type === 'multi_choice') return choiceValue(r, facts);
  if (r.type === 'file') return null;
  if (r.kind === 'name') return facts.name || null;
  if (r.kind === 'one_liner') return facts.description || null;
  if (r.kind === 'links') {
    const links = [facts.live_url, facts.repo_url].filter((x): x is string => !!x);
    return links.length > 0 ? links.join(' ') : null;
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

export function prefill(program: ProgramRow, facts: RepoFacts): { fields: Field[]; filled: number; total: number } {
  const file = program.file;
  const fields = file.submission_requirements.map((r): Field => {
    const guidance = guidanceOf(r);
    const base = {
      key: r.key, label: r.label, type: r.type, required: r.required, kind: r.kind,
      ...(r.options ? { options: r.options } : {}),
      ...(r.max_chars ? { max_chars: r.max_chars } : {}),
      ...(guidance ? { guidance } : {}),
      ...(file.form?.fields?.[r.key] ? { form_id: file.form.fields[r.key] } : {}),
    };
    const value = valueOf(r, file, facts);
    if (value !== null) return { ...base, value, from: 'earnkit' };
    if (r.type === 'file' || BUILDER_KINDS.has(r.kind) || /contract/.test(r.key))
      return { ...base, value: null, from: 'builder' };
    if (r.type === 'choice' || r.type === 'multi_choice')
      return { ...base, value: null, from: 'agent', sources: ['the options', 'the description'] };
    return { ...base, value: null, from: 'agent', sources: sourcesOf(facts, guidance) };
  });
  return { fields, filled: fields.filter((f) => f.from === 'earnkit').length, total: fields.filter((f) => f.required).length };
}
