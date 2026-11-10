/**
 * The words of a find reply: `replyText` (what the builder sees, design section 4) and
 * `agentNote` (what the agent does next). In-person programs get their own block after ready and
 * gaps, with their setup, and are never in the count to apply to. Linked, the record's blocks follow. Pure.
 */
import { EVIDENCE_NOT_READ, isConfirmWhat, listWords, signInSentence } from '../v6/reply-words';
import { rulesOnly, type Gap } from './eligibility';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import { READS_PAUSED, type RepoNote } from './repo-facts';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;

/** How the agent drafts the fields EarnKit did not fill (find and one program alike). */
export const AGENT_FIELDS =
  "'agent' fields you draft from the repo, the field's sources and what you already know about the builder; 'builder' fields you ask once, all together. Never invent a personal fact, an amount or a number.";
const NEEDS_SHOWN = 3;

/** The agent note line for rule gaps (v6.1.6, R18a): EarnKit shows them, the builder confirms each once. */
export const RULE_NOTE =
  'A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again. Their yes stands: when the program comes back ready, draft and submit it without asking again.';
/** A program rule as the builder reads it; the note keeps its own capitals and gets the full stop. Pure. */
export const ruleSentence = (note: string): string => `Their rule: ${note}.`;
/** Each rule as its own sentence, each with its leading space, or ''. Pure. */
const ruleSentences = (rules: string[]): string => rules.map((r) => ` ${ruleSentence(r)}`).join('');

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

/** "09:14 UTC" for today (UTC), "Nov 5, 22:10 UTC" for another day; "earlier today" when the time does not read. Pure. */
export const clock = (iso: string, now: Date) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'earlier today';
  const hm = `${d.toISOString().slice(11, 16)} UTC`;
  if (d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return hm;
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d)}, ${hm}`;
};

/** "$25,000". Pure. */
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

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

/** "3. " before a list line; nothing on the one-program reply (`alone`, v6.1.8 1b), which shows the line alone. Pure. */
const num = (n: number, alone: boolean) => (alone ? '' : `${n}. `);

/** A ready program's line; `alone` leaves out the list number (the one-program reply). Pure. */
export function readyLine(p: ReadyProgram, linked: boolean, now: Date, alone = false): string {
  let head = `${num(p.n, alone)}${p.title}, ${p.money}`;
  if (p.closes_in) head += `, closes ${p.closes_in}`;
  // The long odds are their own sentence after the head, never a label on the money.
  if (p.long_shot) head += `. Long odds: ${p.long_shot}`;
  const fromRecord = linked ? recordDrafted(p) : null;
  // Setup items are steps ("sign in to ..."), the rest are things ("a Loom demo"): each reads its own way.
  const steps = p.needs.filter((x) => p.setup.includes(x));
  // Linked, the k that need the builder are already named.
  const needs = fromRecord ? [] : p.needs.filter((x) => !p.setup.includes(x)).map(bare);
  const shown = needs.length > NEEDS_SHOWN ? [...needs.slice(0, NEEDS_SHOWN), `${needs.length - NEEDS_SHOWN} more`] : needs;
  const first = steps.length > 0 ? ` First: ${steps.join('; ')}.` : '';
  // Another agent of the builder's holds it: still numbered, so the builder can name it, but not in the yes count.
  const held = p.claimed_since ? ` Being handled by your other agent since ${clock(p.claimed_since, now)}.` : '';
  return `${head}.${fromRecord ? ` ${fromRecord}` : drafted(p, linked, needs.length, shown)}${first}${held}`;
}

/**
 * R2c: n answers from the repo (or record), k the agent drafts, b only the builder gives, over the required total.
 * The agent drafts its fields itself and asks only for the b. Each sentence comes with its leading space, or ''. Pure.
 */
function drafted(p: ReadyProgram, linked: boolean, b: number, shown: string[]): string {
  const total = p.total;
  const n = Math.min(p.repo_required + (linked ? p.from_record : 0), total);
  const k = Math.max(total - n - b, 0);
  const needsYour = b > 0 ? ` Needs your ${joinAnd(shown)}.` : '';
  if (total > 0 && n === total) return total === 1 ? ' Drafted: the one answer from the repo.' : ` Drafted: all ${total} answers from the repo.`;
  if (n > 0) {
    const head = ` Drafted: ${n} of ${total} answers from the repo`;
    if (k > 0) return b > 0 ? `${head}, ${k} more by your agent.${needsYour}` : `${head}, the rest by your agent.`;
    return `${head}.${needsYour}`;
  }
  if (k > 0) {
    if (b > 0) return ` Your agent drafts ${k} ${k === 1 ? 'answer' : 'answers'}.${needsYour}`;
    return total === 1 ? ' Your agent drafts the one answer.' : ` Your agent drafts all ${total} answers.`;
  }
  return needsYour;
}

/**
 * What attending takes, as one sentence with its leading space (R21): "Needs a YC account ..." when the first setup
 * item is a thing (a, an, the, your), "First: apply to attend ..." when it is a step; several joined with "; ".
 * An in-person program with no setup still says so: "Attend in person.". Pure.
 */
const attendSentence = (setup: string[]): string => {
  if (setup.length === 0) return ' Attend in person.';
  const s = setup.join('; ');
  return THING.test(setup[0]) ? ` Needs ${s}.` : ` First: ${s}.`;
};
/** A setup item that is a thing to have, not a step to take. */
const THING = /^(a|an|the|your)\s/i;

/**
 * An in-person program: the money, the close, the odds, what attending takes, then what it needs from the builder.
 * When attending takes things (a YC account), those and the builder's needs are one "Needs" sentence (v6.1.8). Pure.
 */
export function inPersonLine(p: ReadyProgram, alone = false): string {
  const odds = p.long_shot ? ` Long odds: ${p.long_shot}.` : '';
  const head = `${num(p.n, alone)}${p.title}, ${p.money}${p.closes_in ? `, closes ${p.closes_in}` : ''}.${odds}`;
  const own = p.needs.filter((x) => !p.setup.includes(x));
  const things = p.setup.length > 0 && THING.test(p.setup[0]);
  if (things && own.length > 0) {
    const all = [...p.setup, ...own];
    const shown = all.length > NEEDS_SHOWN + 1 ? [...all.slice(0, NEEDS_SHOWN), `${all.length - NEEDS_SHOWN} more`] : all;
    return `${head} Needs ${joinAnd(shown)}.`;
  }
  const needs = own.map(bare);
  const shown = needs.length > NEEDS_SHOWN ? [...needs.slice(0, NEEDS_SHOWN), `${needs.length - NEEDS_SHOWN} more`] : needs;
  const needsYour = shown.length > 0 ? ` Needs your ${joinAnd(shown)}.` : '';
  return `${head}${attendSentence(p.setup)}${needsYour}`;
}

/** A gap program whose gaps are only rules to confirm (R18a). Pure. */
export const ruleOnlyGap = (g: GapProgram) => rulesOnly([g.gap, ...g.also]);

/** The unlinked tier gap ("Sign in once so EarnKit can confirm ..."): its own sentence, never after the colon (C57). */
const confirmGap = (x: Gap) => x.kind === 'tier' && isConfirmWhat(x.what);
/** What EarnKit does on "do n", by the gap's kind (v6.1.8, 1a). A contract deploy is never EarnKit's: it needs the
 *  builder's keys and gas, so chain gaps are not agent_can. */
const DO_VERB: Partial<Record<Gap['kind'], string>> = { builder_codes: 'add them', integration: 'add it' };
/** Whether EarnKit can make every real gap of the program, so its line offers "do n". Pure. */
export const canDo = (real: Gap[]) => real.length > 0 && real.every((x) => x.agent_can);
/** ' Say "do n" and I ...' when EarnKit can make every real gap of the program, else ''. Pure. */
function doSentence(n: number, real: Gap[]): string {
  if (!canDo(real)) return '';
  return ` Say "do ${n}" and I ${doVerb(real, false)}.`;
}
/** What "do" makes: in a list line the short verb ("add them"); on the one-program reply, where no list names the
 *  change twice, the change itself ("add Base Builder Codes to the app"). Pure. */
const doVerb = (real: Gap[], named: boolean): string =>
  real.length > 1 ? 'make both changes' : named ? real[0].what : (DO_VERB[real[0].kind] ?? 'make the change');
/** The "tell me if real people use it" question: a yes, not work (the same gap the agent note names). Pure. */
const usersQuestion = (x: Gap) => x.kind === 'users' && x.effort === 'hours';

/**
 * The one action under a one-program gap line (v6.1.8, 1b), or null: rules only, a yes that drafts; EarnKit can make
 * every real gap, "do" and it makes that change first; the users question, a yes; else the builder makes the change
 * and says when. In person: none, the line already says to attend. Pure.
 */
export function gapAction(g: GapProgram): string | null {
  if (g.in_person) return null;
  if (ruleOnlyGap(g)) return 'Say yes if that is you and I draft it.';
  const real = [g.gap, ...g.also].filter((x) => x.kind !== 'rule');
  if (canDo(real)) return `Say "do" and I ${doVerb(real, true)} first.`;
  if (real.every(usersQuestion)) return 'Say yes if they do and I draft it.';
  return 'Tell me when that is done and I apply.';
}

/** A program that does not fit, on the one-program reply (v6.1.8, 1b). Pure. */
export const notFitLine = (title: string, money: string, reason: string): string => `${title}, ${money}. Not a fit: ${reason}.`;

/**
 * The real gaps after the colon, with "do n" only when EarnKit can make all of them (v6.1.8, 1a); the unlinked tier
 * gap as its own sentence (C57); then one "Their rule" sentence per rule to confirm. Rules only: the rules, then
 * 'Say "yes n" if that is you.', except on the program the closing line already names (`ruleInClosing`). In person,
 * the attend sentence follows the rules (R18d), so an in-person program always says so. `alone` (the one-program reply,
 * v6.1.8 1b): no number and no "do n" or "yes n", since `gapAction` gives the action on its own line.
 */
export function gapLine(g: GapProgram, ruleInClosing: number | null = null, alone = false): string {
  const all = [g.gap, ...g.also];
  const rules = ruleSentences(all.filter((x) => x.kind === 'rule').map((x) => x.what));
  const attend = g.in_person ? attendSentence(g.setup) : '';
  if (ruleOnlyGap(g)) return `${num(g.n, alone)}${g.title}, ${g.money}.${rules}${attend}${alone || g.n === ruleInClosing ? '' : ` Say "yes ${g.n}" if that is you.`}`;
  const real = all.filter((x) => x.kind !== 'rule');
  const listed = real.filter((x) => !confirmGap(x));
  const confirm = real.filter(confirmGap).map((x) => ` ${x.what}.`).join('');
  const head = `${num(g.n, alone)}${g.title}, ${g.money}${listed.length > 0 ? `: ${joinAnd(listed.map((x) => x.what))}` : ''}.`;
  return `${head}${alone ? '' : doSentence(g.n, real)}${confirm}${rules}${attend}`;
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

/** "you sign in to Google on your agent's computer", "you sign in by email". Pure. */
function signInWords(kind: string): string {
  if (kind === 'google' || kind === 'github') return `you sign in to ${kind === 'google' ? 'Google' : 'GitHub'} on your agent's computer`;
  if (kind === 'email') return 'you sign in by email';
  return `you sign in to ${kind}`;
}

const titlesOf = (r: R, bs: R['blockers']) =>
  bs.map((b) => r.ready.find((p) => p.program_id === b.program_id)?.title).filter((t): t is string => !!t);

/**
 * "Before applying: ..." ("Before tonight (nothing is sent until these are in): ..." when the agent sends tonight, C45):
 * one clause per thing the builder does, each naming its programs ("you sign in by email and press submit yourself on
 * X; you press submit yourself on Y", v6.1.8 3.4 and 3.5), then the standing approval and what the record lacks; null
 * when there is nothing. Pure.
 */
function beforeTonight(r: R, tonight: boolean): string | null {
  // R21: an in-person program's line already says what attending takes, so its sign-in and submit are not repeated;
  // nor is it outside the standing approval, which never sends one (C46).
  const inPerson = new Set(r.ready.filter((p) => p.in_person).map((p) => p.program_id));
  const remote = r.blockers.filter((b) => !inPerson.has(b.program_id));
  const groups = new Map<string, string[]>();
  for (const b of remote) {
    if (!b.sign_in && !b.needs_click) continue;
    const words = b.sign_in ? `${signInWords(b.sign_in)}${b.needs_click ? ' and press submit yourself on' : ' for'}` : 'you press submit yourself on';
    groups.set(words, [...(groups.get(words) ?? []), ...titlesOf(r, [b])]);
  }
  const clauses = [...groups].filter(([, t]) => t.length > 0).map(([words, t]) => `${words} ${listWords(t, t.length)}`);
  const parts = clauses.length > 0 ? [`${clauses.join('; ')}.`] : [];
  // Named once: a program the builder submits is not named again here.
  const outside = titlesOf(r, remote.filter((b) => b.outside_approval && !b.needs_click));
  if (outside.length > 0) parts.push(`Outside your standing approval, you say yes yourself: ${listWords(outside, outside.length)}.`);
  if (r.record_missing.length > 0) parts.push(`Still missing from your record: ${listWords(r.record_missing)}.`);
  if (parts.length === 0) return null;
  return `${tonight ? 'Before tonight (nothing is sent until these are in)' : 'Before applying'}: ${parts.join(' ')}`;
}

/**
 * The one action (v6.1.8, 1a): yes to the ready ones ("I draft ... for you to send" when the builder presses submit
 * on every one, C44), or with none ready and gaps shown "Nothing is ready yet." and the first rule-only gap's
 * "yes r". The gap lines carry their own "do n" and "yes n". Pure.
 */
export function closingLine(o: { ready: number; draftOnly: boolean; gaps: number; firstRule: number | null; inPerson: number; held: number }): string {
  const { ready, draftOnly } = o;
  if (ready === 1) return draftOnly ? 'Say yes and I draft it for you to send.' : 'Say yes and I apply.';
  if (ready > 1) return `${draftOnly ? `Say yes and I draft all ${ready} for you to send.` : `Say yes and I apply to all ${ready}.`} Or say the numbers to skip.`;
  if (o.gaps > 0) return o.firstRule !== null ? `Nothing is ready yet. Say "yes ${o.firstRule}" if that rule fits you.` : 'Nothing is ready yet.';
  if (o.inPerson > 0) return "Tell me which you can attend and I'll draft it once you're in.";
  if (o.held > 0) return "Your other agent is handling these; I'll say when something new opens.";
  return "Nothing fits yet. I'll say when something opens.";
}

/** Ready programs (not in person) an agent can send alone: no click, no sign-in, within the standing approval, no claim held by an agent. Pure. */
function agentCanApply(r: R): ReadyProgram[] {
  const blocked = new Set(r.blockers.filter((b) => b.needs_click || b.sign_in || b.outside_approval).map((b) => b.program_id));
  return r.ready.filter((p) => !p.in_person && !blocked.has(p.program_id) && !p.claimed_since);
}

/** The one sentence for each thing the builder is told about the repo read (v6.1.8, B20 and C59); a repo link not read gets exactly one of the first three. */
export const REPO_NOTE: Record<RepoNote, string> = {
  paused: 'Repo reads are paused until tomorrow; matched on what you told me.',
  private: 'Private repo: matched on what you told me.',
  unread: 'I could not read the repo; matched on what you told me.',
  fork: 'This repo is a fork; programs judge the original.',
  archived: 'This repo is archived; programs want active work.',
  empty: 'The repo is empty, so I matched on what you told me.',
};

/** What the builder sees. The since line never shows on the first find; `now` reads the claim times. */
export function replyText(r: R, first: boolean, now: Date = new Date()): string {
  const blocks: string[] = [];
  const since = first ? null : sinceLine(r);
  if (since) blocks.push(since);
  const ready = r.ready.filter((p) => !p.in_person);
  const inPerson = r.ready.filter((p) => p.in_person);
  // A program another agent holds leaves the count to say yes to (v6.1.7, C37).
  const free = ready.filter((p) => !p.claimed_since);
  // With nothing ready to say yes to, the closing names the first rule-only gap, so its own line does not (1a).
  const firstRule = r.gaps.find(ruleOnlyGap)?.n ?? null;
  const ruleInClosing = free.length === 0 ? firstRule : null;
  // The headlines count with parentheses (C56, 3.21); "step" covers a change and a rule to confirm.
  if (ready.length > 0) blocks.push([`Ready to apply (${ready.length}):`, ...ready.map((p) => readyLine(p, r.linked, now))].join('\n'));
  if (r.gaps.length > 0) blocks.push([`One step away (${r.gaps.length}):`, ...r.gaps.map((g) => gapLine(g, ruleInClosing))].join('\n'));
  if (inPerson.length > 0) blocks.push([`In person (${inPerson.length}):`, ...inPerson.map((p) => inPersonLine(p))].join('\n'));
  const l = r.ledger;
  if (l.applied > 0) {
    const soon = l.closing_soon.length > 0 ? `, ${l.closing_soon.length} closing soon` : '';
    // What was won, never what was asked (v6.1.8, 3.6).
    const won = l.won > 0 && l.won_usd > 0 ? ` (${dollars(l.won_usd)})` : '';
    blocks.push(`Ledger: ${l.applied} applied, ${l.won} won${won}, ${l.pending} pending${soon}.`);
  }
  // One condition for the heading and the closing: the agent sends tonight (never unlinked, where auto_apply is false).
  const tonightList = r.auto_apply ? agentCanApply(r).slice(0, r.max_per_night ?? ready.length) : [];
  const tonight = tonightList.length;
  const before = beforeTonight(r, tonight > 0);
  if (before) blocks.push(before);
  if (r.applied_overnight.length > 0) blocks.push(`Applied under your standing approval: ${r.applied_overnight.map((a) => a.title).join(', ')}.`);
  if (r.evidence_summary) blocks.push(r.evidence_summary.line);
  // What the read was, once each, just before the closing (money first stays first).
  const notes = [...new Set(r.repo_notes ?? [])];
  if (notes.length > 0) blocks.push(notes.map((n) => REPO_NOTE[n]).join(' '));
  // C44: the builder presses submit on every ready one (their policy, or each program's own), so the agent drafts.
  const click = new Set(r.blockers.filter((b) => b.needs_click).map((b) => b.program_id));
  const draftOnly = free.length > 0 && free.every((p) => click.has(p.program_id));
  const closing =
    tonight > 0
      ? `Applying tonight to ${listWords(tonightList.map((p) => p.title), tonight)}. Say stop to hold any.`
      : closingLine({ ready: free.length, draftOnly, gaps: r.gaps.length, firstRule, inPerson: inPerson.length, held: ready.length - free.length });
  // R5a: saying yes is the one action; unlinked with a link, signing in is the closing block's second sentence.
  // The first find after a link names the account it linked to, last (security M2); after an unlink the notice
  // carries the sign-in link itself, so the sign-in sentence is left out (v6.1.7 B10).
  // An empty repo was read but gave nothing to prove: the sign-in promises only to remember (C59).
  const signIn = r.sign_in && !r.linked && !r.linked_notice ? signInSentence(r.sign_in, !r.as_reported && !notes.includes('empty')) : null;
  blocks.push([closing, signIn, r.linked_notice].filter(Boolean).join(' '));
  return blocks.join('\n\n');
}

/**
 * What the agent does with the reply. `more`: ready and gap programs left out of the lists. `description` (C58): the
 * project came with none, and the README's first sentence stood in ('readme') or nothing could (`none`).
 */
export function agentNote(r: R, o: { more: number; description?: 'readme' | 'none' | null }): string {
  const standing =
    'Standing approval is on: for each ready program within the limits, call track started, fill from fields, submit where the program allows an agent, then track applied with submitted_by agent and fields_used. Stop at max_per_night. Never submit where blockers say needs_click, outside_approval or a sign-in you do not have.';
  const lines = [
    'Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.',
    r.linked
      ? `Draft each ready program from its fields: 'record' and 'earnkit' values as given; ${AGENT_FIELDS}`
      : `Draft each ready program from its fields: 'earnkit' values as given; ${AGENT_FIELDS}`,
    ...(r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'rule')) ? [RULE_NOTE] : []),
    // With standing approval the agent does not wait for a yes; the limits replace it.
    // The submit rule itself is in the server instructions, once (v6.1.8); here only what this reply adds.
    ...(r.auto_apply ? [standing] : ['Fill field by field; form_id names the form field when given.']),
    'Call track with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.',
    'Pass users and live_url in the project whenever you know them; never invent them.',
    'The numbers the builder says are each item\'s n in ready and gaps ("skip 4" is the item with n 4), not its place in the list.',
  ];
  if (r.ready.some((p) => p.in_person))
    lines.push('In-person programs (in_person: true) are not in "yes to all": draft nothing for one until the builder says yes to attending it and its setup.');
  if (r.gaps.some((g) => !ruleOnlyGap(g)))
    lines.push(
      r.gaps.some((g) => canDo([g.gap, ...g.also].filter((x) => x.kind !== 'rule')))
        ? 'On "do <n>": make that gap\'s change (its details carry the docs), push, call track with gap_done and the gap\'s item, then call find again. Where a gap line offers no "do", the builder makes the change and tells you when it is done.'
        : 'The builder makes each change (never deploy a contract for them); when they say it is done, call track with gap_done and the gap\'s item, then call find again.',
    );
  if (r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'users' && x.effort === 'hours')))
    lines.push('"Tell me if real people use it" is a question, not work: ask the builder once; on yes, pass users: true next time or call track with gap_done and item users.');
  if (o.more > 0) lines.push(`${o.more} more left out: ready past the cap, gaps and in-person programs. Ask with filter.all for the full list.`);
  if (r.ask_outcome.length > 0)
    lines.push(`Ask once how each went: ${r.ask_outcome.map((a) => a.title).join(', ')}. Pass each answer to track (won with amount_usd, rejected or no_result).`);
  if (r.linked) lines.push('Fit approved answers by cutting, never by adding; the style contract travels on each field.');
  if (r.record_missing.length > 0) lines.push('Ask for the missing record items once, all together, and save each with record.');
  if (r.ready.some((p) => p.claimed_since)) lines.push('A ready program with claimed_since is claimed by another of the builder\'s agents: do not submit it.');
  if (r.released.length > 0) lines.push(`Claims left unsent for 24 hours were released: ${r.released.join(', ')}.`);
  const paused = r.problems?.includes(READS_PAUSED) === true;
  // One line per fact: reads paused says the match is as reported itself.
  if (r.as_reported && !paused) lines.push('No public repo was read, so the match used the facts you reported; tell the builder the match used what they reported, not a repo read.');
  if (o.description === 'readme') lines.push("No description was passed, so the README's first sentence stood in for it; pass one next time if it reads wrong.");
  if (o.description === 'none') lines.push('No description was passed and no README could stand in; pass one next time.');
  const dropped = (r.problems ?? []).filter((p) => p !== READS_PAUSED && p !== EVIDENCE_NOT_READ);
  if (dropped.length > 0) lines.push(`Some project facts were dropped: ${dropped.join('; ')}. Send them corrected next time.`);
  if (paused) lines.push('Repo reads are paused for this installation until tomorrow; the match used what you reported.');
  return lines.join('\n');
}
