/**
 * The words of a find reply: `replyText` (what the builder sees, design section 4) and
 * `agentNote` (what the agent does next). In-person programs get their own block after ready and
 * gaps, with their setup, and are never in the count to apply to. Linked, the record's blocks follow. Pure.
 */
import { EVIDENCE_NOT_READ, listWords, signInLine } from '../v6/reply-words';
import { compactUsd } from './programs-read';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import { READS_PAUSED } from './repo-facts';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;

/** How the agent drafts the fields EarnKit did not fill (find and one program alike). */
export const AGENT_FIELDS =
  "'agent' fields you draft from the repo, the field's sources and what you already know about the builder; 'builder' fields you ask once, all together. Never invent a personal fact, an amount or a number.";
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

/** Linked: "n from your record, m from the repo, k need you: a, b and c.", all over required fields; null when all are zero. Pure. */
function recordDrafted(p: ReadyProgram): string | null {
  const k = p.need_you.length;
  if (p.from_record + p.repo_required + k === 0) return null;
  const head = `${p.from_record} from your record, ${p.repo_required} from the repo`;
  return k > 0 ? `${head}, ${k} ${k === 1 ? 'needs' : 'need'} you: ${listWords(p.need_you)}.` : `${head}.`;
}

function readyLine(p: ReadyProgram, linked: boolean): string {
  let head = `${p.n}. ${p.title}, ${p.money}`;
  if (p.closes_in) head += `, closes ${p.closes_in}`;
  if (p.long_shot) head += `, a long shot: ${p.long_shot}`;
  const fromRecord = linked ? recordDrafted(p) : null;
  // Setup items are steps ("sign in to ..."), the rest are things ("a Loom demo"): each reads its own way.
  const steps = p.needs.filter((x) => p.setup.includes(x));
  // Linked, the k that need the builder are already named.
  const needs = fromRecord ? [] : p.needs.filter((x) => !p.setup.includes(x)).map(bare);
  const shown = needs.length > NEEDS_SHOWN ? [...needs.slice(0, NEEDS_SHOWN), `${needs.length - NEEDS_SHOWN} more`] : needs;
  const needsYour = shown.length > 0 ? `Needs your ${joinAnd(shown)}.` : '';
  const first = steps.length > 0 ? ` First: ${steps.join('; ')}.` : '';
  // R2b: nothing from the repo and some answers only the builder gives: the agent drafts the rest, never "all".
  if (!fromRecord && p.facts_from_repo === 0 && needs.length > 0) {
    const k = Math.max(p.total - needs.length, 0);
    const drafts = k > 0 ? `Your agent drafts ${k} ${k === 1 ? 'answer' : 'answers'}; needs your ${joinAnd(shown)}.` : needsYour;
    return `${head}. ${drafts}${first}`;
  }
  const drafted =
    fromRecord ??
    (p.total === 1
      ? p.facts_from_repo > 0
        ? 'Drafted: the one answer from the repo.'
        : 'Your agent fills the one answer on the page.'
      : p.facts_from_repo > 0
        ? `Drafted: ${Math.min(p.facts_from_repo, p.total)} of ${p.total} answers from the repo, the rest your agent asks you once.`
        : `Your agent fills all ${p.total} answers on the page.`);
  return `${head}. ${drafted}${needsYour ? ` ${needsYour}` : ''}${first}`;
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

/** "Sign in once to Google on your agent's computer for 2 of them". Pure. */
function signInWords(kind: string, n: number): string {
  const tail = `for ${n} of them`;
  if (kind === 'google' || kind === 'github') return `Sign in once to ${kind === 'google' ? 'Google' : 'GitHub'} on your agent's computer ${tail}`;
  if (kind === 'email') return `Sign in once by email ${tail}`;
  return `Sign in once to ${kind} ${tail}`;
}

const titlesOf = (r: R, bs: R['blockers']) =>
  bs.map((b) => r.ready.find((p) => p.program_id === b.program_id)?.title).filter((t): t is string => !!t);

/** "Before tonight: ..." with the sign-ins grouped, the clicks and what the record lacks; null when there is nothing. Pure. */
function beforeTonight(r: R): string | null {
  const counts = new Map<string, number>();
  for (const b of r.blockers) if (b.sign_in) counts.set(b.sign_in, (counts.get(b.sign_in) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => `${signInWords(kind, n)}.`);
  const clicks = titlesOf(r, r.blockers.filter((b) => b.needs_click));
  if (clicks.length > 0) parts.push(`Needs your click: ${listWords(clicks, clicks.length)}.`);
  // Named once: a program that already needs the builder's click is not named again here.
  const outside = titlesOf(r, r.blockers.filter((b) => b.outside_approval && !b.needs_click));
  if (outside.length > 0) parts.push(`Outside your standing approval, you say yes yourself: ${listWords(outside, outside.length)}.`);
  if (r.record_missing.length > 0) parts.push(`Still missing from your record: ${listWords(r.record_missing)}.`);
  return parts.length > 0 ? `Before tonight: ${parts.join(' ')}` : null;
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

/** Ready programs (not in person) an agent can send alone: no click, no sign-in, within the standing approval, no claim held by an agent. Pure. */
function agentCanApply(r: R): ReadyProgram[] {
  const blocked = new Set(r.blockers.filter((b) => b.needs_click || b.sign_in || b.outside_approval).map((b) => b.program_id));
  return r.ready.filter((p) => !p.in_person && !blocked.has(p.program_id) && !p.claimed_since);
}

/** What the builder sees. The since line never shows on the first find. */
export function replyText(r: R, first: boolean): string {
  const blocks: string[] = [];
  const since = first ? null : sinceLine(r);
  if (since) blocks.push(since);
  const ready = r.ready.filter((p) => !p.in_person);
  const inPerson = r.ready.filter((p) => p.in_person);
  if (ready.length > 0) blocks.push([`Ready to apply, ${ready.length}:`, ...ready.map((p) => readyLine(p, r.linked))].join('\n'));
  if (r.gaps.length > 0) blocks.push([`One change away, ${r.gaps.length}:`, ...r.gaps.map(gapLine)].join('\n'));
  if (inPerson.length > 0) blocks.push(['In person, apply to attend first:', ...inPerson.map(inPersonLine)].join('\n'));
  const l = r.ledger;
  if (l.applied > 0) {
    const soon = l.closing_soon.length > 0 ? `, ${l.closing_soon.length} closing soon` : '';
    const asked = l.asked_usd > 0 ? ` (${compactUsd(l.asked_usd)} asked)` : '';
    blocks.push(`Ledger: ${l.applied} applied${asked}, ${l.won} won, ${l.pending} pending${soon}.`);
  }
  const before = beforeTonight(r);
  if (before) blocks.push(before);
  if (r.applied_overnight.length > 0) blocks.push(`Applied under your standing approval: ${r.applied_overnight.map((a) => a.title).join(', ')}.`);
  if (r.evidence_summary) blocks.push(r.evidence_summary.line);
  const tonight = r.auto_apply ? Math.min(agentCanApply(r).length, r.max_per_night ?? ready.length) : 0;
  // R5: unlinked with a link, the sign-in is the one call to action, in place of the closing line.
  if (r.sign_in && !r.linked) blocks.push(signInLine(r.sign_in));
  else blocks.push(tonight > 0 ? `Applying tonight to ${tonight}; say stop to hold any.` : closingLine(ready.length, r.gaps.length, r.gaps[0]?.n ?? ready.length + 1, inPerson.length));
  return blocks.join('\n\n');
}

/** What the agent does with the reply. `more`: ready and gap programs left out of the lists. */
export function agentNote(r: R, o: { more: number }): string {
  const standing =
    'Standing approval is on: for each ready program within the limits, call track started, fill from fields, submit where the program allows an agent, then track applied with submitted_by agent and fields_used. Stop at max_per_night. Never submit where blockers say needs_click, outside_approval or a sign-in you do not have.';
  const lines = [
    'Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.',
    r.linked
      ? `Draft each ready program from its fields: 'record' and 'earnkit' values as given; ${AGENT_FIELDS}`
      : `Draft each ready program from its fields: 'earnkit' values as given; ${AGENT_FIELDS}`,
    // With standing approval the agent does not wait for a yes; the limits replace it.
    r.auto_apply ? standing : 'Submit only when the builder says yes, in your own browser, field by field (form_id names the form field when given).',
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
  if (r.linked) lines.push('Fit approved answers by cutting, never by adding; the style contract travels on each field.');
  if (r.blockers.length > 0) lines.push('Sign-ins and clicks the builder must do are in blockers; name them once, together.');
  if (r.record_missing.length > 0) lines.push('Ask for the missing record items once, all together, and save each with record.');
  if (r.ready.some((p) => p.claimed_since)) lines.push('A ready program with claimed_since is claimed by one of the builder\'s agents: submit it only if you made that claim.');
  if (r.released.length > 0) lines.push(`Claims left unsent for 24 hours were released: ${r.released.join(', ')}.`);
  if (r.as_reported) lines.push('No public repo was read, so the match used the facts you reported; tell the builder the match is as reported by you.');
  const dropped = (r.problems ?? []).filter((p) => p !== READS_PAUSED && p !== EVIDENCE_NOT_READ);
  if (dropped.length > 0) lines.push(`Some project facts were dropped: ${dropped.join('; ')}. Send them corrected next time.`);
  if (r.problems?.includes(READS_PAUSED)) lines.push('Repo reads are paused for this installation until tomorrow; the match used what you reported.');
  return lines.join('\n');
}
