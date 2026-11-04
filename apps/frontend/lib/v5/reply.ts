/**
 * The words of a find reply: `replyText` (what the builder sees, design section 4) and
 * `agentNote` (what the agent does next). Pure.
 */
import { compactUsd } from './programs-read';
import type { FindReply, GapProgram, ReadyProgram } from './find';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;
const NEEDS_SHOWN = 3;

/** "a, b and c". Pure. */
const joinAnd = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** A to-do as it reads after "Needs your": "your email" and "a Loom product demo" lose their first word. */
const bare = (todo: string) => todo.replace(/^(your|a|an|the)\s+/i, '');

function readyLine(p: ReadyProgram, n: number): string {
  let head = `${n}. ${p.title}, ${p.money}`;
  if (p.closes_in) head += `, closes ${p.closes_in}`;
  if (p.in_person) head += ', in person';
  if (p.long_shot) head += `, a long shot: ${p.long_shot}`;
  const drafted = p.filled > 0 ? `Drafted: ${p.filled} ${p.filled === 1 ? 'fact' : 'facts'} from the repo.` : 'Drafted.';
  const needs = p.needs.map(bare);
  const shown = needs.length > NEEDS_SHOWN ? [...needs.slice(0, NEEDS_SHOWN), `${needs.length - NEEDS_SHOWN} more`] : needs;
  return `${head}. ${drafted}${shown.length > 0 ? ` Needs your ${joinAnd(shown)}.` : ''}`;
}

function gapLine(g: GapProgram, n: number): string {
  const all = [g.gap, ...g.also];
  const can = all.every((x) => x.agent_can) ? ' (I can do this)' : '';
  return `${n}. ${g.title}, ${g.money}: ${joinAnd(all.map((x) => x.what))}${can}.`;
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

function closingLine(ready: number, gaps: number, firstGap: number): string {
  if (ready > 0 && gaps > 0) return `Say yes to apply to all ${ready}, numbers to skip, or "do ${firstGap}" and I'll make the change first.`;
  if (ready > 0) return `Say yes to apply to all ${ready}, or numbers to skip.`;
  if (gaps > 0) return `Say "do ${firstGap}" and I'll make the change first.`;
  return "Nothing fits yet. I'll say when something opens.";
}

/** What the builder sees. The since line never shows on the first find. */
export function replyText(r: R, first: boolean): string {
  const blocks: string[] = [];
  const since = first ? null : sinceLine(r);
  if (since) blocks.push(since);
  if (r.ready.length > 0) blocks.push([`Ready to apply, ${r.ready.length}:`, ...r.ready.map((p, i) => readyLine(p, i + 1))].join('\n'));
  if (r.gaps.length > 0)
    blocks.push([`One change away, ${r.gaps.length}:`, ...r.gaps.map((g, i) => gapLine(g, r.ready.length + i + 1))].join('\n'));
  const l = r.ledger;
  if (l.applied > 0) {
    const soon = l.closing_soon.length > 0 ? `, ${l.closing_soon.length} closing soon` : '';
    blocks.push(`Ledger: ${l.applied} applied (${compactUsd(l.asked_usd)} asked), ${l.won} won, ${l.pending} pending${soon}.`);
  }
  blocks.push(closingLine(r.ready.length, r.gaps.length, r.ready.length + 1));
  return blocks.join('\n\n');
}

/** What the agent does with the reply. `more`: ready and gap programs left out of the lists. */
export function agentNote(r: R, o: { more: number }): string {
  const lines = [
    'Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.',
    "Draft each ready program from its fields: 'earnkit' values as given; 'agent' fields you write from your memory and the field's sources; 'builder' fields you ask once, all together.",
    'Submit only when the builder says yes, in your own browser, field by field (form_id names the form field when given).',
    'Call track with applied after each submission, and with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.',
  ];
  if (r.gaps.length > 0)
    lines.push('On "do <n>": make that gap\'s change (its details carry the chain\'s RPC and explorer), push, call track with gap_done and the gap\'s item, then call find again.');
  if (o.more > 0) lines.push(`${o.more} more fit; ask with filter.all for the full list.`);
  if (r.ask_outcome.length > 0)
    lines.push(`Ask once how each went: ${r.ask_outcome.map((a) => a.title).join(', ')}. Pass each answer to track (won with amount_usd, rejected or no_result).`);
  if (r.as_reported) lines.push('No public repo was read, so the match used the facts you reported; tell the builder the match is as reported by you.');
  if (r.problems && r.problems.length > 0) lines.push(`Some project facts were dropped: ${r.problems.join('; ')}. Send them corrected next time.`);
  return lines.join('\n');
}
