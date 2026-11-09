/**
 * Eligibility and gaps: a project's repo facts against a program's eligibility items. Each unmet
 * item is a gap with its effort and whether the agent can do it. Pure: no I/O, time only via `now`.
 */
import { integrationDocs, integrationLabel } from '../v6/integrations';
import { CHAIN_REGISTRY, chainName } from './chains';
import { categoryOf, eligibilityOf, ruleNotes, type EligibilityItem, type EligibilityKind } from './program-file';
import type { ProgramRow } from './programs';
import type { RepoFacts } from './repo-facts';

/** A rule is never a gap: EarnKit cannot check it, so it is shown, not gated. */
export type GapKind = Exclude<EligibilityKind, 'rule'>;
export type Effort = 'minutes' | 'hours' | 'days' | 'weeks';
export type Gap = {
  /** 'tier': the program's min_tier is above the project's tier (set by find, never by evaluate). */
  kind: GapKind | 'tier';
  item: string;
  what: string;
  effort: Effort;
  agent_can: boolean;
  details?: { chain?: string; rpc?: string | null; explorer?: string | null; docs?: string | null; tier?: string; min_tier?: string };
};
export type Verdict = {
  program_id: string;
  status: 'ready' | 'gap' | 'no';
  gaps: Gap[];
  reason: string | null;
  long_shot: string | null;
  /** The notes of the program's `rule` items, in file order: shown to the builder as "Their rule", never a gap. */
  rules: string[];
};

const EFFORT: Record<GapKind, Effort> = {
  builder_codes: 'minutes', live_product: 'hours', chain: 'hours', contract_on: 'hours', demo_video: 'hours',
  feature: 'days', integration: 'days', users: 'weeks', new_work_after: 'weeks', in_person: 'weeks',
};
const MAX_GAPS = 2;

const itemKey = (i: EligibilityItem) => (i.value ? `${i.kind}:${i.value}` : i.kind);
const chainDetails = (chain: string) => {
  const c = CHAIN_REGISTRY[chain];
  return { chain, rpc: c?.rpc ?? null, explorer: c?.explorer ?? null };
};

/** Never called with a rule (evaluate skips them), so the kind is a GapKind. */
function gapOf(i: EligibilityItem): Gap {
  const kind = i.kind as GapKind;
  const base = { kind, item: itemKey(i), effort: EFFORT[kind], agent_can: false };
  const v = i.value ?? '';
  switch (i.kind) {
    case 'chain': return { ...base, what: `deploy the contract on ${chainName(v)}`, details: chainDetails(v) };
    case 'contract_on': return { ...base, what: `a contract on ${chainName(v)}`, details: chainDetails(v) };
    case 'builder_codes': return { ...base, what: 'add Base Builder Codes to the app', agent_can: true };
    case 'live_product': return { ...base, what: 'put a live link up' };
    case 'demo_video': return { ...base, what: 'a demo video' };
    case 'integration': return { ...base, what: `add ${integrationLabel(v) ?? v}`, agent_can: true, details: { docs: integrationDocs(v) } };
    case 'feature': return { ...base, what: v || i.note || 'a feature the program asks for' };
    default: return { ...base, what: 'real users first' };
  }
}

const date = (s: string) => s.slice(0, 10);
/** Users not reported: a question only the builder answers, not weeks of work. */
const USERS_UNKNOWN: Gap = { kind: 'users', item: 'users', what: 'tell me if real people use it', effort: 'hours', agent_can: false };

/** The program against the facts: ready, a short list of gaps, or no. `done` holds items the builder says are done. */
export function evaluate(program: ProgramRow, facts: RepoFacts, done: Set<string>, now: Date): Verdict {
  const p = program.file;
  const long_shot =
    p.tag === 'long shot' ? 'few prizes for many entries'
    : categoryOf(p) === 'investment' && p.max_award_usd == null ? 'an investment program with no stated amount'
    : null;
  const items = eligibilityOf(p);
  const rules = ruleNotes(p);
  const out = (status: Verdict['status'], gaps: Gap[], reason: string | null): Verdict => ({ program_id: program.id, status, gaps, reason, long_shot, rules });

  if (p.status !== 'active') return out('no', [], 'not open');
  if (p.ends_at && Date.parse(p.ends_at) <= now.getTime()) return out('no', [], 'closed');

  const gaps: Gap[] = [];
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
        else if (facts.users !== true && !done.has(itemKey(i))) gaps.push(USERS_UNKNOWN);
        break;
      case 'new_work_after': {
        const first = facts.first_commit_at ? Date.parse(facts.first_commit_at) : NaN;
        if (!(first >= Date.parse(v))) return out('no', [], `needs work started after ${date(v)}`);
        break;
      }
      case 'in_person': inPerson = true; break;
      case 'demo_video':
      case 'feature': if (!done.has(itemKey(i))) gaps.push(gapOf(i)); break;
      case 'rule': break;
    }
  }

  const reason = inPerson ? 'in person' : null;
  if (gaps.length === 0) return out('ready', [], reason);
  if (gaps.length > MAX_GAPS || gaps.some((g) => g.effort === 'weeks')) {
    return out('no', gaps, `needs ${gaps.map((g) => g.what).join(', ')}`);
  }
  return out('gap', gaps, reason);
}
