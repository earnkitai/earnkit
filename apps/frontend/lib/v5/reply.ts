/**
 * The words of a find reply: `replyText` (what the builder sees, design section 4) and
 * `agentNote` (what the agent does next). In-person programs get their own block after ready and
 * gaps, with their setup, and are never in the count to apply to. Pure.
 */
import { compactUsd } from './programs-read';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import { READS_PAUSED } from './repo-facts';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;
const NEEDS_SHOWN = 3;

/**
 * The lists in display order with their numbers: ready (not in person) 1..k, then the gaps, then the
 * in-person programs; `ready` comes back with the in-person ones last (stable). Pure.
 */
export function numbered<P extends { in_person: boolean }, G>(ready: P[], gaps: G[]): { ready: (P & { n: number })[]; gaps: (G & { n: number })[] } {
  const apply = ready.filter((p) => !p.in_person);
  const attend = ready.filter((p) => p.in_person);
  return {
    ready: [...apply.map((p, i) => ({ ...p, n: i + 1 })), ...attend.map((p, i) => ({ ...p, n: apply.length + gaps.length + i + 1 }))],
    gaps: gaps.map((g, i) => ({ ...g, n: apply.length + i + 1 })),
  };
}

/** "a, b and c". Pure. */
const joinAnd = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** A to-do as it reads after "Needs your": "your email" and "a Loom product demo" lose their first word. */
const bare = (todo: string) => todo.replace(/^(your|a|an|the)\s+/i, '');

function readyLine(p: ReadyProgram): string {
  let head = `${p.n}. ${p.title}, ${p.money}`;
  if (p.closes_in) head += `, closes ${p.closes_in}`;
  if (p.long_shot) head += `, a long shot: ${p.long_shot}`;
  const drafted =
    p.total === 1
      ? p.facts_from_repo > 0
        ? 'Drafted: the one answer from the repo.'
        : 'Your agent fills the one answer on the page.'
      : p.facts_from_repo > 0
        ? `Drafted: ${Math.min(p.facts_from_repo, p.total)} of ${p.total} answers from the repo, the rest from your agent's memory.`
        : `Your agent fills all ${p.total} answers on the page.`;
  // Setup items are steps ("sign in to ..."), the rest are things ("a Loom demo"): each reads its own way.
  const steps = p.needs.filter((x) => p.setup.includes(x));
  const needs = p.needs.filter((x) => !p.setup.includes(x)).map(bare);
  const shown = needs.length > NEEDS_SHOWN ? [...needs.slice(0, NEEDS_SHOWN), `${needs.length - NEEDS_SHOWN} more`] : needs;
  return `${head}. ${drafted}${shown.length > 0 ? ` Needs your ${joinAnd(shown)}.` : ''}${steps.length > 0 ? ` First: ${steps.join('; ')}.` : ''}`;
}

/** An in-person program: the money, the close, and what attending takes. */
function inPersonLine(p: ReadyProgram): string {
  const head = `${p.n}. ${p.title}, ${p.money}${p.closes_in ? `, closes ${p.closes_in}` : ''}.`;
  const setup = p.setup.join('; ');
  return setup ? `${head} ${setup.charAt(0).toUpperCase()}${setup.slice(1)}.` : head;
}

function gapLine(g: GapProgram): string {
  const all = [g.gap, ...g.also];
  const can = all.every((x) => x.agent_can) ? ' (I can do this)' : '';
  return `${g.n}. ${g.title}, ${g.money}: ${joinAnd(all.map((x) => x.what))}${can}.`;
}

function sinceLine(r: R): string | null {
  const s = r.since;
  if (!s.from || s.new.length + s.changed.length + s.closing.length === 0) return null;
  const parts: string[] = [];
  if (s.new.length > 0) parts.push(`${s.new.length} new ${s.new.length === 1 ? 'program' : 'programs'} you fit`);
  for (const c of s.changed) parts.push(`${c.title}: ${c.what}`);
  for (const c of s.closing) {
    const inWords = r.ready.find((p) => p.program_id === c.program_id)?.closes_in;
    parts.push(`${c.title} closes ${inWords ?? new Date(c.closes_at).toISOString().slice(0, 10)}`);
  }
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(s.from));
  return `Since ${day}: ${parts.join('; ')}.`;
}

function closingLine(ready: number, gaps: number, firstGap: number, inPerson: number): string {
  if (ready === 1 && gaps > 0) return `Say yes to apply, skip it, or "do ${firstGap}" and I'll make the change first.`;
  if (ready === 1) return 'Say yes to apply, or skip it.';
  if (ready > 0 && gaps > 0) return `Say yes to apply to all ${ready}, numbers to skip, or "do ${firstGap}" and I'll make the change first.`;
  if (ready > 0) return `Say yes to apply to all ${ready}, or numbers to skip.`;
  if (gaps > 0) return `Say "do ${firstGap}" and I'll make the change first.`;
  if (inPerson > 0) return "Tell me which you can attend and I'll draft it once you're in.";
  return "Nothing fits yet. I'll say when something opens.";
}

/** What the builder sees. The since line never shows on the first find. */
export function replyText(r: R, first: boolean): string {
  const blocks: string[] = [];
  const since = first ? null : sinceLine(r);
  if (since) blocks.push(since);
  const ready = r.ready.filter((p) => !p.in_person);
  const inPerson = r.ready.filter((p) => p.in_person);
  if (ready.length > 0) blocks.push([`Ready to apply, ${ready.length}:`, ...ready.map(readyLine)].join('\n'));
  if (r.gaps.length > 0) blocks.push([`One change away, ${r.gaps.length}:`, ...r.gaps.map(gapLine)].join('\n'));
  if (inPerson.length > 0) blocks.push(['In person, apply to attend first:', ...inPerson.map(inPersonLine)].join('\n'));
  const l = r.ledger;
  if (l.applied > 0) {
    const soon = l.closing_soon.length > 0 ? `, ${l.closing_soon.length} closing soon` : '';
    const asked = l.asked_usd > 0 ? ` (${compactUsd(l.asked_usd)} asked)` : '';
    blocks.push(`Ledger: ${l.applied} applied${asked}, ${l.won} won, ${l.pending} pending${soon}.`);
  }
  blocks.push(closingLine(ready.length, r.gaps.length, r.gaps[0]?.n ?? ready.length + 1, inPerson.length));
  return blocks.join('\n\n');
}

/** What the agent does with the reply. `more`: ready and gap programs left out of the lists. */
export function agentNote(r: R, o: { more: number }): string {
  const lines = [
    'Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.',
    "Draft each ready program from its fields: 'earnkit' values as given; 'agent' fields you write from your memory and the field's sources; 'builder' fields you ask once, all together.",
    'Submit only when the builder says yes, in your own browser, field by field (form_id names the form field when given).',
    'Call track with applied after each submission, and with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.',
    'Pass users and live_url in the project whenever you know them; never invent them.',
    'The numbers the builder says are each item\'s n in ready and gaps ("skip 4" is the item with n 4), not its place in the list.',
  ];
  if (r.ready.some((p) => p.in_person))
    lines.push('In-person programs (in_person: true) are not in "yes to all": draft nothing for one until the builder says yes to attending it and its setup.');
  if (r.gaps.length > 0)
    lines.push('On "do <n>": make that gap\'s change (its details carry the chain\'s RPC and explorer), push, call track with gap_done and the gap\'s item, then call find again.');
  if (r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'users' && x.effort === 'hours')))
    lines.push('"Tell me if real people use it" is a question, not work: ask the builder once; on yes, pass users: true next time or call track with gap_done and item users.');
  if (o.more > 0) lines.push(`${o.more} more fit; ask with filter.all for the full list.`);
  if (r.ask_outcome.length > 0)
    lines.push(`Ask once how each went: ${r.ask_outcome.map((a) => a.title).join(', ')}. Pass each answer to track (won with amount_usd, rejected or no_result).`);
  if (r.as_reported) lines.push('No public repo was read, so the match used the facts you reported; tell the builder the match is as reported by you.');
  const dropped = (r.problems ?? []).filter((p) => p !== READS_PAUSED);
  if (dropped.length > 0) lines.push(`Some project facts were dropped: ${dropped.join('; ')}. Send them corrected next time.`);
  if (r.problems?.includes(READS_PAUSED)) lines.push('Repo reads are paused for this installation until tomorrow; the match used what you reported.');
  return lines.join('\n');
}
