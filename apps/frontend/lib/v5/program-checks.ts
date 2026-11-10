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
  if (Date.parse(`${q.verified_at}T00:00:00Z`) > now.getTime()) problems.push(`verified_at: ${q.verified_at} is in the future`);
  return problems;
}
