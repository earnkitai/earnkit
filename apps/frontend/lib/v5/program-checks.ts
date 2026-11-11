/**
 * Every problem with a program, for `pnpm programs:check`, the sync and the programs write API.
 * The schema's rules first (to-dos on required items, a kind on every item, known chains), then
 * the checks that read text or the clock: the reward states the pool, verified_at is not ahead.
 */
import { ProgramFile, type Program } from './program-file';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "$1.3M", "$840K", "$500": one decimal at most, rounded down. */
function usdCompact(n: number): string {
  const down = (x: number) => Math.floor(x * 10) / 10;
  if (n >= 1_000_000) return `$${down(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${down(n / 1_000)}K`;
  return `$${Math.floor(n)}`;
}

/** The text after `n` where `text` states it ("$840,000", "$840K", "10,000 USDC"), or null. */
function amountAfter(n: number, text: string): string | null {
  const full = n.toLocaleString('en-US');
  const forms = [
    new RegExp(`${escape(full)}\\s*USDC\\b\\+?`),
    new RegExp(`\\$${escape(full)}(?![\\d,])\\+?`),
    new RegExp(`${escape(usdCompact(n))}(?![\\d.])\\+?`, 'i'),
  ];
  for (const re of forms) {
    const m = text.match(re);
    if (m) return text.slice((m.index ?? 0) + m[0].length);
  }
  return null;
}

const POOL_WORDS = /^\s*(?:usd\s+)?(?:in prizes|prize pool|pool|available|total|in total)\b/i;

/** Whether `text` states `n` at all. Pure. */
export const amountStated = (n: number, text: string): boolean => amountAfter(n, text) !== null;

/** Whether `text` states `pool` as a pool: the amount followed by a pool word. Pure. */
export function poolStated(pool: number, text: string): boolean {
  const after = amountAfter(pool, text);
  return after !== null && POOL_WORDS.test(after);
}

/** A sentence that says the program takes entries now (L21-2, v6.1.16): wrong on a closed program. */
export const OPEN_WINDOW: RegExp = /\b(applications?|registration|submissions?|entries)\s+(are|is)\s+(now\s+)?open\b|\bapply\s+(now|by)\b|\bopen\s+(until|through)\b/i;

/** A sentence that says the program reviews entries with no end (fix round 1, v6.1.16): wrong on a closed program
 *  unless it is in the past ("Proposals were reviewed on a rolling basis."). */
export const ROLLING_WINDOW: RegExp = /\brolling\b|\bno fixed deadline\b/i;
const PAST = /\b(was|were|ran|had)\b/i;

/** The sentences of `text`, split after a full stop, question or exclamation mark. Pure. */
export const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean);

/** `text` without its open-window sentences (L21-2, v6.1.16). Pure. */
export const withoutOpenWindow = (text: string): string => sentencesOf(text).filter((t) => !OPEN_WINDOW.test(t)).join(' ');

/** L24-25 (v6.1.16 Task 11): the copy rule's banned words, as whole words (plurals too). */
const COPY_BANNED = /\b(score|rank|grade|points?|coins?|tokens?|streaks?)(s|d|ing)?\b/i;

/** A K or M money figure ("$100K", "$325k", "2M ARB", "$1.5M"): the catalog writes full figures (lane 22, L1h-1). */
const KM = /\d(?:\.\d+)?\s?[KkMm]\b/;

/** Each problem as "<path or (program)>: <message>"; empty when the program may be written. */
export function programProblems(p: Program, now: Date = new Date()): string[] {
  const parsed = ProgramFile.safeParse(p);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.') || '(program)'}: ${i.message}`);
  const q = parsed.data;
  const problems: string[] = [];
  if (q.pool_usd !== undefined && !poolStated(q.pool_usd, q.reward))
    problems.push(`pool_usd: ${q.pool_usd} must be stated in reward as a pool (e.g. "$${q.pool_usd.toLocaleString('en-US')} in prizes")`);
  if (q.min_award_usd !== undefined && !amountStated(q.min_award_usd, q.reward))
    problems.push(`min_award_usd: ${q.min_award_usd} must be stated in reward`);
  // L1f-1 (v6.1.14): the flag says the program's rule is open source code; a rule (or a rules line) must say so.
  const OPEN = /open[ -]source|\bOSI\b|free\/libre|\bopen licen[cs]e/i;
  if (q.open_source && ![...q.rules, ...(q.eligibility ?? []).map((i) => i.note ?? '')].some((t) => OPEN.test(t)))
    problems.push('open_source: true needs a rule naming open source code or its license');
  // #12 (v6.1.15): the summary's money is a number or says "Amount not stated", never bare words.
  const piece = q.summary.split(' · ')[0];
  if (!/\d/.test(piece) && !/amount not stated/i.test(piece))
    problems.push(`summary: the money "${piece}" needs a number or "Amount not stated"`);
  // Lane 22 (v6.1.15): full figures on every surface, never K or M.
  if (KM.test(piece)) problems.push(`summary: the money "${piece}" must be in full figures ("$100,000", never "$100K" or "$1M")`);
  // FR-6 (v6.1.15): the rules the guide and the reply show are in full figures too. L1h-1 (v6.1.16): and the
  // description, the reward, every past round (label, themes, examples) and each requirement's `todo`, which the
  // guide, the lookup and the needs lists carry; a requirement's `label` is the program's own question and kept.
  const full = (path: string, text: string | undefined) => {
    if (text && KM.test(text)) problems.push(`${path}: money must be in full figures ("$100,000", never "$100K")`);
  };
  q.rules.forEach((r, i) => full(`rules.${i}`, r));
  (q.eligibility ?? []).forEach((e, i) => full(`eligibility.${i}.note`, e.note));
  full('description', q.description);
  full('reward', q.reward);
  q.past_rounds.forEach((r, i) => {
    full(`past_rounds.${i}.label`, r.label);
    (r.themes ?? []).forEach((t, j) => full(`past_rounds.${i}.themes.${j}`, t.theme));
    (r.examples ?? []).forEach((x, j) => {
      full(`past_rounds.${i}.examples.${j}.name`, x.name);
      full(`past_rounds.${i}.examples.${j}.what`, x.what);
    });
  });
  q.submission_requirements.forEach((r, i) => full(`submission_requirements.${i}.todo`, r.todo));
  // L21-2 (v6.1.16): a closed program says nothing that reads as still taking entries.
  if (q.status === 'closed')
    for (const t of [q.description, ...q.rules].flatMap(sentencesOf)) {
      if (OPEN_WINDOW.test(t)) problems.push(`status: a closed program carries no open-window sentence: "${t}"`);
      else if (ROLLING_WINDOW.test(t) && !PAST.test(t)) problems.push(`status: a closed program carries no rolling-window sentence: "${t}"`);
    }
  if (q.status === 'closed' && q.summary.split(' · ').slice(1).some((x) => ROLLING_WINDOW.test(x)))
    problems.push('summary: a closed program is not rolling');
  if (Date.parse(`${q.verified_at}T00:00:00Z`) > now.getTime()) problems.push(`verified_at: ${q.verified_at} is in the future`);
  // L24-25 (v6.1.16 Task 11): EarnKit's own files follow the copy rule in their labels, to-dos and rules; a third
  // party's wording is theirs and passes.
  if (q.organizer.trim().toLowerCase() === 'earnkit') {
    const said = (path: string, text: string | undefined) => {
      const hit = text ? COPY_BANNED.exec(text) : null;
      if (hit) problems.push(`${path}: EarnKit's own copy never says "${hit[0]}"`);
    };
    q.rules.forEach((r, i) => said(`rules.${i}`, r));
    (q.eligibility ?? []).forEach((e, i) => said(`eligibility.${i}.note`, e.note));
    q.submission_requirements.forEach((r, i) => {
      said(`submission_requirements.${i}.label`, r.label);
      said(`submission_requirements.${i}.todo`, r.todo);
    });
  }
  return problems;
}
