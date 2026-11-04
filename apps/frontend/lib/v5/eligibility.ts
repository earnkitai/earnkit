/**
 * Eligibility and gaps: a project's repo facts against a program's eligibility items. Each unmet
 * item is a gap with its effort and whether the agent can do it. Pure: no I/O, time only via `now`.
 */
import { CHAIN_REGISTRY, chainName } from './chains';
import { ELIGIBILITY_KINDS, categoryOf, eligibilityOf, type EligibilityItem } from './program-file';
import type { ProgramRow } from './programs';
import type { RepoFacts } from './repo-facts';

export type GapKind = (typeof ELIGIBILITY_KINDS)[number];
export type Effort = 'minutes' | 'hours' | 'days' | 'weeks';
export type Gap = {
  kind: GapKind;
  item: string;
  what: string;
  effort: Effort;
  agent_can: boolean;
  details?: { chain?: string; rpc?: string | null; explorer?: string | null };
};
export type Verdict = {
  program_id: string;
  status: 'ready' | 'gap' | 'no';
  gaps: Gap[];
  reason: string | null;
  long_shot: string | null;
};

const EFFORT: Record<GapKind, Effort> = {
  builder_codes: 'minutes', live_product: 'hours', chain: 'hours', contract_on: 'hours', demo_video: 'hours',
  feature: 'days', users: 'weeks', new_work_after: 'weeks', in_person: 'weeks',
};
const MAX_GAPS = 2;

const itemKey = (i: EligibilityItem) => (i.value ? `${i.kind}:${i.value}` : i.kind);
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
    case 'feature': return { ...base, what: v || i.note || 'a feature the program asks for' };
    default: return { ...base, what: 'real users first' };
  }
}

const date = (s: string) => s.slice(0, 10);

/** The program against the facts: ready, a short list of gaps, or no. `done` holds items the builder says are done. */
export function evaluate(program: ProgramRow, facts: RepoFacts, done: Set<string>, now: Date): Verdict {
  const p = program.file;
  const long_shot =
    p.tag === 'long shot' ? 'few prizes for many entries'
    : categoryOf(p) === 'investment' && p.max_award_usd == null ? 'an investment program with no stated amount'
    : null;
  const out = (status: Verdict['status'], gaps: Gap[], reason: string | null): Verdict => ({ program_id: program.id, status, gaps, reason, long_shot });

  if (p.status !== 'active') return out('no', [], 'not open');
  if (p.ends_at && Date.parse(p.ends_at) <= now.getTime()) return out('no', [], 'closed');

  const items = eligibilityOf(p);
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
      case 'builder_codes': if (!facts.builder_codes) gaps.push(gapOf(i)); break;
      case 'users': if (!facts.users && !done.has(itemKey(i))) gaps.push(gapOf(i)); break;
      case 'new_work_after': {
        const first = facts.first_commit_at ? Date.parse(facts.first_commit_at) : NaN;
        if (!(first >= Date.parse(v))) return out('no', [], `needs work started after ${date(v)}`);
        break;
      }
      case 'in_person': inPerson = true; break;
      case 'demo_video':
      case 'feature': if (!done.has(itemKey(i))) gaps.push(gapOf(i)); break;
    }
  }

  const reason = inPerson ? 'in person' : null;
  if (gaps.length === 0) return out('ready', [], reason);
  if (gaps.length > MAX_GAPS || gaps.some((g) => g.effort === 'weeks')) {
    return out('no', gaps, `needs ${gaps.map((g) => g.what).join(', ')}`);
  }
  return out('gap', gaps, reason);
}
