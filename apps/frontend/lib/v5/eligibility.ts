/**
 * Eligibility and gaps: a project's repo facts against a program's eligibility items. Each unmet
 * item is a gap with its effort and whether the agent can do it. Pure: no I/O, time only via `now`.
 */
import { createHash } from 'node:crypto';
import { integrationDocs, integrationLabel } from '../v6/integrations';
import { CHAIN_REGISTRY, chainName } from './chains';
import { categoryOf, eligibilityOf, ruleNotes, type EligibilityItem, type EligibilityKind } from './program-file';
import type { ProgramRow } from './programs';
import type { RepoFacts } from './repo-facts';

/**
 * A rule (v6.1.6, R18a) is a confirmation gap: EarnKit cannot check it, so the builder confirms it once
 * (track gap_done with its item). It never counts toward MAX_GAPS or the weeks refusal.
 */
export type GapKind = EligibilityKind;
export type Effort = 'minutes' | 'hours' | 'days' | 'weeks';
export type Gap = {
  /** 'tier': the program's min_tier is above the project's tier (set by find, never by evaluate). */
  kind: GapKind | 'tier' | 'repo';
  item: string;
  what: string;
  effort: Effort;
  agent_can: boolean;
  /** v6.1.14 (L1f-1, L1f-3): the step that closes the gap, said after "First:" on its line and in the closing. */
  setup?: string;
  details?: { chain?: string; rpc?: string | null; explorer?: string | null; docs?: string | null; tier?: string; min_tier?: string };
};
export type Verdict = {
  program_id: string;
  status: 'ready' | 'gap' | 'no';
  gaps: Gap[];
  reason: string | null;
  long_shot: string | null;
  /** The notes of all the program's `rule` items, in file order, confirmed or not. */
  rules: string[];
};

const EFFORT: Record<GapKind, Effort> = {
  builder_codes: 'minutes', live_product: 'hours', chain: 'hours', contract_on: 'hours', demo_video: 'hours',
  feature: 'days', integration: 'days', users: 'weeks', new_work_after: 'weeks', in_person: 'weeks', rule: 'hours',
};
const MAX_GAPS = 2;

/** A rule's item is 'rule:' and the first 8 hex of the sha256 of its note: stable while the note is. */
export const ruleItem = (note: string) => `rule:${createHash('sha256').update(note).digest('hex').slice(0, 8)}`;
export const itemKey = (i: EligibilityItem) => (i.kind === 'rule' ? ruleItem(i.note ?? '') : i.value ? `${i.kind}:${i.value}` : i.kind);
const chainDetails = (chain: string) => {
  const c = CHAIN_REGISTRY[chain];
  return { chain, rpc: c?.rpc ?? null, explorer: c?.explorer ?? null };
};

function gapOf(i: EligibilityItem): Gap {
  const base = { kind: i.kind, item: itemKey(i), effort: EFFORT[i.kind], agent_can: false };
  const v = i.value ?? '';
  switch (i.kind) {
    case 'chain': return { ...base, what: `deploy the contract on ${chainName(v)}`, details: chainDetails(v) };
    case 'contract_on': return { ...base, what: `a contract on ${chainName(v)}`, details: chainDetails(v) };
    case 'builder_codes': return { ...base, what: 'add Base Builder Codes to the app', agent_can: true };
    case 'live_product': return { ...base, what: 'put a live link up' };
    case 'demo_video': return { ...base, what: 'a demo video' };
    case 'integration': return { ...base, what: `add ${integrationLabel(v) ?? v}`, agent_can: true, details: { docs: integrationDocs(v) } };
    case 'feature': return { ...base, what: v || i.note || 'a feature the program asks for' };
    case 'rule': return { ...base, what: i.note ?? '' };
    default: return { ...base, what: 'real users first' };
  }
}

/**
 * N-5 (v6.1.9): items the code or the project report settles, so a builder's "done" is re-checked, not taken: the
 * item is noted, and while the read still misses it the find says so once after that program's line. Every other item
 * (a demo video, users, a feature, a rule) is the builder's word and counts done.
 */
const CODE_CHECKED = new Set<string>(['chain', 'contract_on', 'builder_codes', 'live_product', 'integration', 'repo']);
export const codeChecked = (item: string): boolean => CODE_CHECKED.has(item.split(':')[0]);

/** What the read looked for, as a thing ("the contract on Base"), for each code-checked gap the builder marked done. Pure. */
export function lookedAgain(gaps: Gap[], done: Set<string>): string[] {
  return gaps.filter((g) => codeChecked(g.kind) && done.has(g.item)).map((g) => {
    const chain = chainName(g.details?.chain ?? '');
    switch (g.kind) {
      case 'chain': return `the contract on ${chain}`;
      case 'contract_on': return `a contract on ${chain}`;
      case 'builder_codes': return 'Base Builder Codes in the app';
      case 'live_product': return 'a live link';
      case 'repo': return g.item === 'repo' ? 'code in a repo' : g.what;
      default: return g.what.replace(/^add /, '');
    }
  });
}

const date = (s: string) => s.slice(0, 10);
/** O3 (v6.1.10): a new-work program with no first-commit date: a question only the builder answers, in minutes. */
const startedQuestion = (i: EligibilityItem): Gap => ({ kind: 'new_work_after', item: itemKey(i), what: 'tell me when you started this', effort: 'minutes', agent_can: false });
/** T3-R1 (v6.1.13): code in a repo, the step a needs_repo grant for existing code is from an idea or an empty repo. */
export const NEEDS_CODE: Gap = { kind: 'repo', item: 'repo', what: 'code in a repo', effort: 'days', agent_can: false };
/** L1f-1 (v6.1.14): an open source program and a private repo: the repo made public, re-checked by the next report or read. */
export const PUBLIC_REPO: Gap = { kind: 'repo', item: 'repo:public', what: 'a public repo', setup: 'make the repo public', effort: 'minutes', agent_can: false };
/** L1f-3 (v6.1.14): an archived repo, for a program that wants the code or its users: the live repo, never the users question. */
export const ARCHIVED_REPO: Gap = { kind: 'repo', item: 'repo:archived', what: 'the repo is archived', setup: 'tell me the live repo', effort: 'minutes', agent_can: false };
/** Users not reported: a question only the builder answers, not weeks of work. */
const USERS_UNKNOWN: Gap = { kind: 'users', item: 'users', what: 'tell me if real people use it', effort: 'hours', agent_can: false };

/**
 * B20d (v6.1.9, fix round 2): whether the project exists for the users question: a repo read that holds code (not
 * empty), a live link, a private repo, or a repo whose read was paused for the day (the repo likely exists; the
 * builder's word stands, marked as reported), or a contract on a mainnet (reported or read; v6.1.9 final I4). A repo
 * link that was not read (a 404, a failed read), an empty repo or no repo at all is not. Pure.
 */
export const exists = (facts: RepoFacts): boolean => {
  const notes = facts.notes ?? [];
  if (facts.live_url) return true;
  if (facts.contracts.some((c) => facts.chains.some((x) => x.chain === c.chain && x.mainnet))) return true;
  if (notes.includes('private') || notes.includes('paused')) return true;
  return facts.public && !facts.as_reported && !notes.includes('empty');
};

/** Gaps that are all rules to confirm (R18a): one answer away, no change to make. False for none. Pure. */
export const rulesOnly = (gaps: Gap[]): boolean => gaps.length > 0 && gaps.every((g) => g.kind === 'rule');

/** A hackathon for the odds (v6.1.8, 3.3): a prize pool, or a reward paid in prizes. Pure. */
const prizes = (p: ProgramRow['file']) => p.pool_usd != null || /\bprizes?\b/i.test(p.reward);

/** L1e-6 (v6.1.13): a program that funds code already written: existing work allowed, not a hackathon, not in person. Pure. */
export const forExistingCode = (p: ProgramRow['file']): boolean => p.existing_work === 'allowed' && categoryOf(p) !== 'hackathon' && !p.in_person;

/** The program against the facts: ready, a short list of gaps, or no. `done` holds items the builder says are done. */
export function evaluate(program: ProgramRow, facts: RepoFacts, done: Set<string>, now: Date): Verdict {
  const p = program.file;
  const long_shot =
    p.tag === 'long shot' ? (prizes(p) ? 'few prizes for many entries' : 'many apply, few are taken')
    : categoryOf(p) === 'investment' && p.max_award_usd == null ? 'an investment program with no stated amount'
    : null;
  // B20b (v6.1.8): the tier bars are onchain evidence, so a project with no chain is never gated by one; its `used`
  // bar becomes the users question (the program's own users item, else an implied one, confirmed by a yes).
  const own = eligibilityOf(p);
  const items: EligibilityItem[] = p.min_tier === 'used' && facts.chains.length === 0 && !own.some((i) => i.kind === 'users')
    ? [...own, { kind: 'users' } as EligibilityItem]
    : own;
  const rules = ruleNotes(p);
  const out = (status: Verdict['status'], gaps: Gap[], reason: string | null): Verdict => ({ program_id: program.id, status, gaps, reason, long_shot, rules });

  if (p.status !== 'active') return out('no', [], 'not open');
  if (p.ends_at && Date.parse(p.ends_at) <= now.getTime()) return out('no', [], 'closed');
  // C54 (v6.1.8): a project with no chain reported and none in its code is not one change from a contract program.
  const onchain = items.find((i) => i.kind === 'chain' || i.kind === 'contract_on');
  if (onchain && facts.chains.length === 0) return out('no', [], `needs a contract on ${chainName(onchain.value ?? '')}`);
  // B20c (v6.1.9): a program that wants used software (a used bar or a users item) asks only a project that exists.
  if ((p.min_tier === 'used' || own.some((i) => i.kind === 'users')) && !exists(facts)) return out('no', [], 'needs a product people use');
  const gaps: Gap[] = [];
  // L1e-6 (v6.1.13, fix round 1 T3-R1): a grant for existing code (needs_repo, existing work welcome, not a hackathon or
  // an event) is one step from a project with nothing to show (no live link, and no repo link or a repo the read found
  // empty): code in a repo, a real change competing in the ordinary step slots. The read settles it.
  if (p.needs_repo && forExistingCode(p) && !facts.live_url && (!facts.repo_url || (facts.notes ?? []).includes('empty'))) gaps.push(NEEDS_CODE);
  // L1f-1 (v6.1.14): an open source program is never ready for a private repo (reported private, or a link not read
  // for being private): its step is making the repo public.
  if (p.open_source && (facts.private || (facts.notes ?? []).includes('private'))) gaps.push(PUBLIC_REPO);
  // L1f-3 (v6.1.14): an archived repo, for a program that wants the code or its users: the archive is the gap, and the
  // users question waits for the live repo.
  const archived = (facts.notes ?? []).includes('archived') && (p.needs_repo === true || p.min_tier === 'used' || own.some((i) => i.kind === 'users'));
  if (archived) gaps.push(ARCHIVED_REPO);
  let inPerson = false;
  const chainItems = items.filter((i) => i.kind === 'chain');
  const mainnets = new Set(facts.chains.filter((c) => c.mainnet).map((c) => c.chain));
  if (chainItems.length > 0 && !chainItems.some((i) => mainnets.has(i.value ?? ''))) gaps.push(gapOf(chainItems[0]));

  for (const i of items) {
    const v = i.value ?? '';
    switch (i.kind) {
      case 'chain': break;
      case 'live_product': if (!facts.live_url) gaps.push(gapOf(i)); break;
      case 'contract_on': if (!facts.contracts.some((c) => c.chain === v) || !mainnets.has(v)) gaps.push(gapOf(i)); break;
      case 'integration': if (!facts.integrations.includes(v)) gaps.push(gapOf(i)); break;
      case 'builder_codes': if (!facts.builder_codes) gaps.push(gapOf(i)); break;
      case 'users':
        if (facts.users === false) gaps.push(gapOf(i));
        else if (facts.users !== true && !done.has(itemKey(i)) && !archived) gaps.push(USERS_UNKNOWN);
        break;
      case 'new_work_after': {
        // O3 (v6.1.10): no first-commit date is a question, not a refusal; the builder's word (gap_done) settles it.
        const first = facts.first_commit_at ? Date.parse(facts.first_commit_at) : NaN;
        if (Number.isNaN(first)) {
          if (!done.has(itemKey(i))) gaps.push(startedQuestion(i));
        } else if (!(first >= Date.parse(v))) return out('no', [], `needs work started after ${date(v)}`);
        break;
      }
      case 'in_person': inPerson = true; break;
      case 'demo_video':
      case 'feature':
      case 'rule': if (!done.has(itemKey(i))) gaps.push(gapOf(i)); break;
    }
  }

  const reason = inPerson ? 'in person' : null;
  if (gaps.length === 0) return out('ready', [], reason);
  // Real gaps first, then the rules to confirm; only the real ones count toward the limits.
  const real = gaps.filter((g) => g.kind !== 'rule');
  const ordered = [...real, ...gaps.filter((g) => g.kind === 'rule')];
  // O3 (v6.1.10): the started question is asked, never a reason to refuse: it counts toward neither limit.
  const work = real.filter((g) => !(g.kind === 'new_work_after' && g.effort === 'minutes'));
  if (work.length > MAX_GAPS || work.some((g) => g.effort === 'weeks')) {
    return out('no', ordered, `needs ${work.map((g) => g.what).join(', ')}`);
  }
  return out('gap', ordered, reason);
}

/** Text as prose (C3, v6.1.13): links (http, https, www), fenced code blocks and inline code removed. Pure. */
export const proseOf = (text: string): string =>
  text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ');
/** An identifier, not a word of prose (L12-2, v6.1.14): a token holding `-`, `/`, `.` or `_`, or letters mixed with
 *  digits (`quest-cli`, `src/quest`, `quest.js`, `quest2`). Pure. */
const identifier = (t: string): boolean => /[-/._]/.test(t) || (/\p{L}/u.test(t) && /\p{N}/u.test(t));
/**
 * Prose with its identifiers dropped (L12-2, v6.1.14): each whitespace token, its outer punctuation aside, that reads as
 * an identifier is left out, unless the token (a hyphen as a space) is itself one of `keep` (the program's keywords and
 * their words), so `mini-app`, `web3`, `team1` and `v4` stay as prose while `npm i quest-cli` names no Quest. Pure.
 */
export const wordsOf = (text: string, keep: ReadonlySet<string>): string =>
  text.split(/\s+/).filter((tok) => {
    const core = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    return !identifier(core) || keep.has(core.replace(/-/g, ' '));
  }).join(' ');
/** What the project says about itself, lower-cased: its name, description and README excerpt as prose (links, code and
 *  identifiers dropped, L12-2), its topics (L1c-2), and its own chains, reported and read, by slug and name (T3-R3,
 *  v6.1.13: a project on Avalanche names Avalanche). `keep`: the keywords and their words an identifier may be. Pure. */
const projectWords = (facts: RepoFacts, keep: ReadonlySet<string>): string =>
  [...[facts.name, facts.description, facts.readme_excerpt ?? ''].map((t) => wordsOf(proseOf(t), keep)), ...(facts.topics ?? []),
    ...facts.chains.flatMap((c) => [c.chain, chainName(c.chain)])].join('\n').toLowerCase();
/** A hyphen reads as a space on both sides, so `mini app` matches "mini-app" (v6.1.10 final). Pure. */
const unhyphen = (s: string): string => s.replace(/-/g, ' ');
/** Whether `text` holds `phrase` as a whole word or phrase (letters and digits on neither side), any case. Pure. */
export const names = (text: string, phrase: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${unhyphen(phrase.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(unhyphen(text.toLowerCase()));

/**
 * L1c-2 (v6.1.10): whether the program's rule is unlikely to be the project's. True when a rule still to confirm (in
 * `gaps`) carries keywords and the project names none of the program's keywords in its name, description, README
 * excerpt or topics; such a program shows only in the full list. A program whose rules carry no keywords (a person or
 * licence rule), or whose keyword rules are all confirmed, is never unlikely. Pure.
 */
export function unlikely(program: ProgramRow, facts: RepoFacts, gaps: Gap[]): boolean {
  return keywordsNamed(program, facts, gaps) === false;
}

/** N1 (v6.1.12): a rule still to confirm carries keywords and the project names one of the program's keywords: the
 *  rule is likely the project's, so the program competes for a slot like a rule-free one (rank.ts). Pure. */
export const keywordHit = (program: ProgramRow, facts: RepoFacts, gaps: Gap[]): boolean => keywordsNamed(program, facts, gaps) === true;

/** null when no rule still to confirm carries keywords; else whether the project names one of the program's keywords. Pure. */
function keywordsNamed(program: ProgramRow, facts: RepoFacts, gaps: Gap[]): boolean | null {
  const pending = new Set(gaps.filter((g) => g.kind === 'rule').map((g) => g.item));
  const items = eligibilityOf(program.file).filter((i) => i.kind === 'rule');
  if (!items.some((i) => (i.keywords?.length ?? 0) > 0 && pending.has(itemKey(i)))) return null;
  const keywords = items.flatMap((i) => i.keywords ?? []);
  const keep = new Set(keywords.flatMap((k) => { const w = unhyphen(k.toLowerCase()); return [w, ...w.split(' ')]; }));
  const text = projectWords(facts, keep);
  return keywords.some((k) => names(text, k));
}
