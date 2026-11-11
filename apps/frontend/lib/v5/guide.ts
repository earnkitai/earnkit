/**
 * A program's guide as the site and the find reply show it: money, close, who can apply in plain
 * words, the form's fields as to-dos, the rules, what they want, past rounds, best bet, sources.
 */
import { integrationLabel } from '../v6/integrations';
import { chainName } from './chains';
import { closeDay } from './deadline';
import { CLOSED, NOT_OPEN_YET, ROLLING } from './site-copy';
import { MIN_TIER, NEEDS, eligibilityOf, type EligibilityItem, type Program } from './program-file';
import { isOpen, type ProgramRow } from './programs';
import { moneyOf } from './programs-read';

export type Guide = {
  title: string;
  money: string;
  closes: string;
  rules: string[];
  eligibility: string[];
  fields: { label: string; todo: string }[];
  /** Who sends it, as a sentence: "Your agent sends it." or "You send it." (v6.1.15, #4). */
  submit: string | null;
  /** The program form's own login, as a sentence: "Form needs a Google account.", or null when it needs none (#14). */
  sign_in: string | null;
  /** Extra material, in words: "a founder video". */
  needs: string[];
  /** "Needs a live product.", or null when the program sets none. */
  bar: string | null;
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
    case 'integration': return `uses ${integrationLabel(v) ?? v}`;
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

const NEEDS_WORDS: Record<(typeof NEEDS)[number], string> = {
  founder_video: 'a founder video', demo_video: 'a demo video', resume: 'a resume', deck: 'a deck', pitch_pdf: 'a pitch PDF',
};
const BAR_WORDS: Record<(typeof MIN_TIER)[number], string> = {
  used: 'Needs a used product.', live: 'Needs a live product.', building: 'Needs a repo with recent commits.',
};
const SIGN_IN_WORDS: Record<'google' | 'github' | 'email', string> = {
  google: 'Form needs a Google account.', github: 'Form needs a GitHub account.', email: 'Form needs an email login.',
};

/** What the program's form needs to sign in, as a sentence (#14, template row 16, v6.1.15); null when it needs none. Pure. */
function signInOf(p: Program): string | null {
  if (p.sign_in === 'none') return null;
  if (p.sign_in !== 'platform') return SIGN_IN_WORDS[p.sign_in];
  const name = p.platform_name?.trim();
  return name ? `Form needs ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} account.` : "Form needs an account on the program's site.";
}

/** The pills under a guide's title, each a sentence (template row 7, v6.1.15): who sends it, the form's login, the
 *  extra material ("Needs a founder video.") and the bar. Pure. */
export function guidePills(g: Pick<Guide, 'submit' | 'sign_in' | 'needs' | 'bar'>): string[] {
  return [g.submit, g.sign_in, ...g.needs.map((n) => `Needs ${n}.`), g.bar].filter((t): t is string => Boolean(t));
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
  const closes = closesOf(p, now);
  return {
    title: p.title,
    money: moneyOf(p),
    closes,
    rules: p.rules,
    eligibility: eligibilityList(eligibilityOf(p)),
    fields: p.submission_requirements.map((r) => ({ label: r.label, todo: r.todo ?? (r.required ? r.label.toLowerCase() : 'optional') })),
    // A closed program takes no entries: no word on who submits (v6.1.7 C7); nor one not open yet (Low 21, v6.1.13).
    submit: closes === CLOSED || p.status === 'upcoming' ? null : p.submit === 'builder' ? 'You send it.' : 'Your agent sends it.',
    sign_in: signInOf(p),
    needs: p.needs.map((n) => NEEDS_WORDS[n]),
    bar: p.min_tier ? BAR_WORDS[p.min_tier] : null,
    focus: p.focus ? `${p.focus.ecosystem || (p.chains[0] ? chainName(p.chains[0]) : p.title)} wants ${p.focus.areas.join(', ')}` : null,
    past_rounds: p.past_rounds.map(roundLine),
    best_bet: p.best_bet ?? null,
    sources: sources.filter((s) => !seen.has(s.url) && seen.add(s.url)),
  };
}

/** The guide's rules as reply lines ("Rules:" then one per line); none without rules. */
export function guideLines(g: Pick<Guide, 'rules'>): string[] {
  return g.rules.length > 0 ? ['Rules:', ...g.rules.map((r) => `- ${r}`)] : [];
}
