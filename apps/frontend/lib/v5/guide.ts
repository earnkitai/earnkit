/**
 * A program's guide as the site and the find reply show it: money, close, who can apply in plain
 * words, the form's fields as to-dos, the rules, what they want, past rounds, best bet, sources.
 */
import { chainName } from './chains';
import { closeDay } from './deadline';
import { CLOSED, NOT_OPEN_YET, ROLLING } from './site-copy';
import { eligibilityOf, type EligibilityItem, type Program } from './program-file';
import { isOpen, type ProgramRow } from './programs';
import { moneyOf } from './programs-read';

export type Guide = {
  title: string;
  money: string;
  closes: string;
  rules: string[];
  eligibility: string[];
  fields: { label: string; todo: string }[];
  focus: string | null;
  past_rounds: string[];
  best_bet: string | null;
  sources: { label: string; url: string }[];
};

/** One eligibility item in plain words. */
function eligibilityWords(i: EligibilityItem): string {
  const v = i.value ?? '';
  switch (i.kind) {
    case 'live_product': return 'a live product';
    case 'chain': return `on ${chainName(v)}`;
    case 'contract_on': return `a contract on ${chainName(v)}`;
    case 'builder_codes': return 'Base Builder Codes in the app';
    case 'users': return 'real users';
    case 'new_work_after': return `new work started after ${v.slice(0, 10)}`;
    case 'demo_video': return 'a demo video';
    case 'in_person': return 'in person';
    default: return v || i.note || 'a feature the program asks for';
  }
}

/** The items in plain words; the chains of a chain_required program are one item ("on Base or Tempo"). */
function eligibilityList(items: EligibilityItem[]): string[] {
  const chains = items.filter((i) => i.kind === 'chain').map((i) => chainName(i.value ?? ''));
  const out: string[] = [];
  let chainDone = false;
  for (const i of items) {
    if (i.kind !== 'chain') out.push(eligibilityWords(i));
    else if (!chainDone) {
      chainDone = true;
      out.push(`on ${chains.join(' or ')}`);
    }
  }
  return out;
}

/** "Round 1: 20 of about 400 entries won. payments (5), agents (2)". */
function roundLine(r: Program['past_rounds'][number]): string {
  const counts =
    r.winners && r.submissions ? `${r.winners} of about ${r.submissions} entries won`
    : r.winners ? `${r.winners} winners`
    : r.submissions ? `about ${r.submissions} entries`
    : null;
  const themes = [...(r.themes ?? [])].sort((a, b) => b.count - a.count).map((t) => `${t.theme} (${t.count})`).join(', ');
  const examples = (r.examples ?? []).map((e) => `${e.name}, ${e.what}`).join('; ');
  return [`${r.label}${counts ? `: ${counts}` : ''}`, themes, examples].filter(Boolean).join('. ');
}

/** When it closes, in words: a date in the program's own zone, rolling, not open yet or closed. */
function closesOf(p: Program, now: Date): string {
  if (p.status === 'upcoming') return NOT_OPEN_YET;
  if (p.status === 'closed' || !isOpen(p, now)) return CLOSED;
  const day = closeDay(p);
  return day ? `Closes ${day}` : ROLLING;
}

/** The guide of one program. Pure. */
export function guideText(row: ProgramRow, now: Date = new Date()): Guide {
  const p = row.file;
  const sources = [
    { label: 'program page', url: p.source_url },
    ...(p.pool_usd != null && p.pool_source_url ? [{ label: 'prize pool', url: p.pool_source_url }] : []),
    ...p.past_rounds.map((r, i) => ({ label: p.past_rounds.length > 1 ? `past winners ${i + 1}` : 'past winners', url: r.source_url })),
    ...(p.focus ? [{ label: 'priorities', url: p.focus.source_url }] : []),
  ];
  const seen = new Set<string>();
  return {
    title: p.title,
    money: moneyOf(p),
    closes: closesOf(p, now),
    rules: p.rules,
    eligibility: eligibilityList(eligibilityOf(p)),
    fields: p.submission_requirements.map((r) => ({ label: r.label, todo: r.todo ?? (r.required ? r.label.toLowerCase() : 'optional') })),
    focus: p.focus ? `${p.focus.ecosystem ?? chainName(p.chains[0] ?? '') ?? p.title} wants ${p.focus.areas.join(', ')}` : null,
    past_rounds: p.past_rounds.map(roundLine),
    best_bet: p.best_bet ?? null,
    sources: sources.filter((s) => !seen.has(s.url) && seen.add(s.url)),
  };
}

/** The guide's rules as reply lines ("Rules:" then one per line); none without rules. */
export function guideLines(g: Pick<Guide, 'rules'>): string[] {
  return g.rules.length > 0 ? ['Rules:', ...g.rules.map((r) => `- ${r}`)] : [];
}
