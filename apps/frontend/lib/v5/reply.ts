/**
 * The words of a find reply: `replyText` (what the builder sees, design section 4) and
 * `agentNote` (what the agent does next). In-person programs get their own block after ready and
 * gaps, with their setup, and are never in the count to apply to. Linked, the record's blocks follow. Pure.
 */
import { EVIDENCE_NOT_READ, NO_RECORD_PROJECT, isConfirmWhat, isProofReadingWhat, listWords, signInSentence } from '../v6/reply-words';
import { rulesOnly, type Gap } from './eligibility';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import { READS_PAUSED, type RepoNote } from './repo-facts';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;

/** How the agent drafts the fields EarnKit did not fill (find and one program alike). */
/** C42 (v6.1.8): a record value over its field's cap is never sent as given. */
export const CUT_NOTE = "except a field marked fit 'cut', which you cut to its max_chars as its fit_note says";
export const AGENT_FIELDS =
  "'agent' fields you draft from the repo, the field's sources and what you already know about the builder; 'builder' fields you ask once, all together. Never invent a personal fact, an amount or a number.";
const NEEDS_SHOWN = 3;

/** The agent note line for rule gaps (v6.1.6, R18a): EarnKit shows them, the builder confirms each once. */
export const RULE_NOTE =
  'A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again. Their yes stands: when the program comes back ready, draft and submit it without asking again.';
/** A program rule as the builder reads it; the note keeps its own capitals and gets the full stop. Pure. */
export const ruleSentence = (note: string): string => `Their rule: ${note}.`;
/** L1e-6 (v6.1.13): the rules still to confirm as one sentence with its leading space ("Their rule: a." for one,
 *  "Their rules: a; b." for several), or ''. Pure. */
export const ruleSentences = (rules: string[]): string =>
  rules.length === 0 ? '' : rules.length === 1 ? ` ${ruleSentence(rules[0])}` : ` Their rules: ${rules.join('; ')}.`;

/**
 * The lists in display order with their numbers: ready (not in person) 1..k, then the gaps, then the in-person
 * programs: the ready ones, then the gaps `inBlock` puts in the In person block (O2, v6.1.10: rule-only in person);
 * `ready` comes back with the in-person ones last, `gaps` in input order (stable). Pure.
 */
export function numbered<P extends { in_person: boolean }, G>(ready: P[], gaps: G[], inBlock: (g: G) => boolean = () => false): { ready: (P & { n: number })[]; gaps: (G & { n: number })[] } {
  const apply = ready.filter((p) => !p.in_person);
  const attend = ready.filter((p) => p.in_person);
  const steps = gaps.filter((g) => !inBlock(g));
  const at = new Map<G, number>();
  steps.forEach((g, i) => at.set(g, apply.length + i + 1));
  gaps.filter(inBlock).forEach((g, i) => at.set(g, apply.length + steps.length + attend.length + i + 1));
  return {
    ready: [...apply.map((p, i) => ({ ...p, n: i + 1 })), ...attend.map((p, i) => ({ ...p, n: apply.length + steps.length + i + 1 }))],
    gaps: gaps.map((g) => ({ ...g, n: at.get(g)! })),
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

/** At most NEEDS_SHOWN needs, then "{n} more" (fix round 1, v6.1.12): the ready line and the N3 closing. Pure. */
const capped = (needs: string[]): string[] => (needs.length > NEEDS_SHOWN ? [...needs.slice(0, NEEDS_SHOWN), `${needs.length - NEEDS_SHOWN} more`] : needs);

/** A to-do as it reads after "Needs your": "your email" and "a Loom product demo" lose their first word. */
const bare = (todo: string) => todo.replace(/^(your|a|an|the)\s+/i, '');

/**
 * Linked: "n from your record, m from the repo, a by your agent, k need you: a, b and c.", all over required fields;
 * the agent's part only when it drafts some (F2, v6.1.10: a told fact is its draft, never "need you"); null when the
 * record, the repo and the builder give none. Pure.
 */
function recordDrafted(p: ReadyProgram, named: Named): string | null {
  const k = p.need_you.length;
  if (p.from_record + p.repo_required + k === 0) return null;
  const a = Math.max(p.total - p.from_record - p.repo_required - k, 0);
  const head = `${p.from_record} from your record, ${p.repo_required} from the repo${a > 0 ? `, ${a} by your agent` : ''}`;
  // F5 (v6.1.12): an answer another block of the reply already names is not named again here.
  const own = p.need_you.filter((x) => !named(x));
  return own.length > 0 ? `${head}, ${own.length} ${own.length === 1 ? 'needs' : 'need'} you: ${listWords(own)}.` : `${head}.`;
}

/** Whether another block of the reply already names a need (F5, v6.1.12: the missing email in the Before block). */
type Named = (need: string) => boolean;
/** The builder's own email as a need ("your email"), as the record names it missing (lib/v6/record.ts). */
const EMAIL_NEED = /^(your |the )?email( address)?$/i;
/** F5 (v6.1.12): the Before block names the missing email ("Still missing for these programs: your email"), so the
 *  reply's other blocks do not. Pure. */
export const namedBefore = (r: Pick<R, 'record_missing'>): Named =>
  r.record_missing.some((m) => EMAIL_NEED.test(m)) ? (need) => EMAIL_NEED.test(need) : () => false;

/** "3. " before a list line; nothing on the one-program reply (`alone`, v6.1.8 1b), which shows the line alone. Pure. */
const num = (n: number, alone: boolean) => (alone ? '' : `${n}. `);

/** A ready program's line; `alone` leaves out the list number (the one-program reply). `waits` (v6.1.14): the closing
 *  names this program's needs ("X needs your ...; then I apply."), so the line does not. Pure. */
export function readyLine(p: ReadyProgram, linked: boolean, now: Date, alone = false, named: Named = () => false, waits = false): string {
  let head = `${num(p.n, alone)}${p.title}, ${p.money}`;
  if (p.closes_in) head += `, closes ${p.closes_in}`;
  // The long odds are their own sentence after the head, never a label on the money.
  if (p.long_shot) head += `. Long odds: ${p.long_shot}`;
  const fromRecord = linked ? recordDrafted(p, waits ? () => true : named) : null;
  // Setup items are steps ("sign in to ..."), the rest are things ("a Loom demo"): each reads its own way.
  const steps = p.needs.filter((x) => p.setup.includes(x));
  // Linked, the k that need the builder are already named.
  const needs = fromRecord ? [] : p.needs.filter((x) => !p.setup.includes(x)).map(bare);
  const shown = capped(needs);
  const first = steps.length > 0 ? ` First: ${steps.join('; ')}.` : '';
  // Another agent of the builder's holds it: still numbered, so the builder can name it, but not in the yes count.
  // C1 (v6.1.13): a claim for another project names it.
  const held = p.held_for ? ` Being handled by your other agent for ${p.held_for}.` : p.claimed_since ? ` Being handled by your other agent since ${clock(p.claimed_since, now)}.` : '';
  return `${head}.${fromRecord ? ` ${fromRecord}` : drafted(p, linked, needs.length, waits ? [] : shown)}${first}${held}`;
}

/**
 * R2c: n answers from the repo (or record), k the agent drafts, b only the builder gives, over the required total.
 * The agent drafts its fields itself and asks only for the b. Each sentence comes with its leading space, or ''. Pure.
 */
function drafted(p: ReadyProgram, linked: boolean, b: number, shown: string[]): string {
  const total = p.total;
  const n = Math.min(p.repo_required + (linked ? p.from_record : 0), total);
  const k = Math.max(total - n - b, 0);
  // `shown` is empty when the closing names the needs (v6.1.14): the counts stay, the names go.
  const needsYour = b > 0 && shown.length > 0 ? ` Needs your ${joinAnd(shown)}.` : '';
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
export function inPersonLine(p: ReadyProgram, alone = false, now?: Date): string {
  const line = attendLine(p, alone);
  // C1 (v6.1.13): held by another agent for another project, its line says so; L13-8 (v6.1.14): held with no project,
  // since when, as a ready line says it.
  if (p.held_for) return `${line} Being handled by your other agent for ${p.held_for}.`;
  return p.claimed_since && now ? `${line} Being handled by your other agent since ${clock(p.claimed_since, now)}.` : line;
}

/** The in-person line before any hold: head, odds, the attend step and the needs. Pure. */
function attendLine(p: ReadyProgram, alone: boolean): string {
  const odds = p.long_shot ? ` Long odds: ${p.long_shot}.` : '';
  const head = `${num(p.n, alone)}${p.title}, ${p.money}${p.closes_in ? `, closes ${p.closes_in}` : ''}.${odds}`;
  // A need the setup step already names ("open the application with the first founder's email") is said once.
  const own = p.needs.filter((x) => !p.setup.includes(x) && !p.setup.some((step) => step.includes(x)));
  const things = p.setup.length > 0 && THING.test(p.setup[0]);
  if (things && own.length > 0) {
    const all = [...p.setup, ...own];
    const shown = all.length > NEEDS_SHOWN + 1 ? [...all.slice(0, NEEDS_SHOWN), `${all.length - NEEDS_SHOWN} more`] : all;
    return `${head} Needs ${joinAnd(shown)}.`;
  }
  const needs = own.map(bare);
  const shown = capped(needs);
  const needsYour = shown.length > 0 ? ` Needs your ${joinAnd(shown)}.` : '';
  return `${head}${attendSentence(p.setup)}${needsYour}`;
}

/** A gap program whose gaps are only rules to confirm (R18a). Pure. */
export const ruleOnlyGap = (g: GapProgram) => rulesOnly([g.gap, ...g.also]);
/** O2 (v6.1.10): an in-person program that needs only its rule confirmed: listed in the In person block. Pure. */
export const attendRuleGap = (g: GapProgram) => g.in_person && ruleOnlyGap(g);

/** The unlinked tier gap ("proof that real people use it"); its sign-in is asked once, in the closing (v6.1.14). */
const confirmGap = (x: Gap) => x.kind === 'tier' && isConfirmWhat(x.what);
/** Whether a reply's gaps show the unlinked proof gap, so its closing says what signing in checks (v6.1.14). Pure. */
export const showsProof = (gaps: Pick<GapProgram, 'gap' | 'also'>[]): boolean => gaps.some((g) => hasProof([g.gap, ...g.also]));
/** Whether one program's gaps hold the unlinked proof. Pure. */
export const hasProof = (gaps: Gap[]): boolean => gaps.some(confirmGap);
/** A tier gap whose action is not a change the closing names: the unlinked proof (signing in, in the closing), or the
 *  linked "proof is still being read" (I2). */
const ownSentenceGap = (x: Gap) => confirmGap(x) || readingGap(x);
/** The linked "proof is still being read" (I2): its own sentence, never after the colon (C57). */
const readingGap = (x: Gap) => x.kind === 'tier' && isProofReadingWhat(x.what);
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
/** T3-R1 (v6.1.13): the code-in-a-repo step of a grant for existing code (eligibility's NEEDS_CODE). Pure. */
const needsCode = (x: Gap) => x.kind === 'repo' && x.item === 'repo';
/** L1f-2 (v6.1.14): the closing when the step's only change is code in a repo: one action, no rule yes before the code exists. */
export const CODE_CLOSING = 'Tell me when the code is in a repo and I look again.';
/** L1f-3 (v6.1.14): a step the builder takes by telling (the live repo): asked as one. Pure. */
const telling = (step: string) => /^tell me /.test(step);
/** O3 (v6.1.10): the "tell me when you started this" question: a date the builder gives, not work. Pure. */
export const startedQuestion = (x: Gap) => x.kind === 'new_work_after' && x.effort === 'minutes';

/**
 * The one action under a one-program gap line (v6.1.8, 1b), or null: rules only, a yes that drafts; EarnKit can make
 * every real gap, "do" and it makes that change first; the users question, a yes; else the builder makes the change
 * and says when. Signing in is the only real step and there is a link (`signIn`, fix round 1): the sign-in sentence
 * with the link. In person: none, the line already says to attend. Pure.
 */
export function gapAction(g: GapProgram, signIn: string | null = null): string | null {
  if (g.in_person) return null;
  if (ruleOnlyGap(g)) return 'Say yes if that is you and I draft it.';
  const real = [g.gap, ...g.also].filter((x) => x.kind !== 'rule');
  if (signIn && signInOnly([g.gap, ...g.also])) return signIn;
  if (real.every((x) => x.kind === 'tier' && isProofReadingWhat(x.what))) return null;
  if (canDo(real)) return `Say "do" and I ${doVerb(real, true)} first.`;
  if (real.every(usersQuestion)) return 'Say yes if they do and I draft it.';
  if (real.every(startedQuestion)) return 'Tell me when you started and I check it.';
  if (real.every(needsCode)) return CODE_CLOSING;
  // L1f-1 (v6.1.14): a private repo for an open source program: the repo made public comes first, then a look again.
  if (real.some((x) => x.item === 'repo:public')) return 'Tell me when the repo is public and I look again.';
  // L1f-3 (v6.1.14): a step that is telling (the live repo) is asked as one.
  if (real.length === 1 && real[0].setup && telling(real[0].setup)) return `T${real[0].setup.slice(1)} and I look again.`;
  return 'Tell me when that is done and I apply.';
}

/** Whether every real gap (rules aside) is the unlinked proof, settled by signing in. Pure. */
export const signInOnly = (gaps: Gap[]): boolean => {
  const real = gaps.filter((x) => x.kind !== 'rule');
  return real.length > 0 && real.every(confirmGap);
};

/** A program that does not fit, on the one-program reply (v6.1.8, 1b). Pure. */
export const notFitLine = (title: string, money: string, reason: string): string => `${title}, ${money}. Not a fit: ${reason}.`;

/** N-5 (v6.1.9): one sentence per step the builder marked done that the read still does not find, each with its
 *  leading space, or ''. Pure. */
export const lookedAgainSentences = (g: Pick<GapProgram, 'looked_again'>): string =>
  (g.looked_again ?? []).map((what) => ` I looked again and did not find ${what}; it stays a step.`).join('');

/**
 * The real gaps after the colon, with "do n" only when EarnKit can make all of them (v6.1.8, 1a); the unlinked tier
 * gap as its own sentence (C57); then the rules to confirm as one sentence (L1e-6, v6.1.13). A rule line never asks
 * its own yes (T3-R5, v6.1.13): the closing is the reply's one yes, and "yes n" still works for any numbered line. In person,
 * the attend sentence follows the rules (R18d), so an in-person program always says so; otherwise the setup steps
 * come as "First: ..." before the rules (L1d-2). `alone` (the one-program reply,
 * v6.1.8 1b): no number and no "do n", since `gapAction` gives the action on its own line.
 */
export function gapLine(g: GapProgram, alone = false): string {
  const all = [g.gap, ...g.also];
  const rules = ruleSentences(all.filter((x) => x.kind === 'rule').map((x) => x.what));
  const attend = g.in_person ? attendSentence(g.setup) : '';
  // L1d-2 (v6.1.11): the setup steps (an account, a sprint) after the gaps and before the rules, as on a ready line;
  // in person, the attend sentence already says them.
  const first = !g.in_person && g.setup.length > 0 ? ` First: ${g.setup.join('; ')}.` : '';
  // O1 (v6.1.10): a program closing within 7 days says so after the money.
  const money = `${g.money}${g.closes_in ? `, closes ${g.closes_in}` : ''}`;
  if (ruleOnlyGap(g)) return `${num(g.n, alone)}${g.title}, ${money}.${first}${rules}${attend}`;
  const real = all.filter((x) => x.kind !== 'rule');
  // v6.1.14: the unlinked proof is listed with the other gaps; its sign-in is the closing's.
  const listed = real.filter((x) => !readingGap(x));
  const confirm = real.filter(readingGap).map((x) => ` ${x.what}.`).join('');
  const head = `${num(g.n, alone)}${g.title}, ${money}${listed.length > 0 ? `: ${joinAnd(listed.map((x) => x.what))}` : ''}.`;
  return `${head}${alone ? '' : doSentence(g.n, real)}${confirm}${first}${rules}${attend}${lookedAgainSentences(g)}`;
}

/**
 * What waits on the builder from the time since this agent's last find (C48) and what was sent under standing
 * approval meanwhile; a find with no project carries them too (v6.1.8 fix round 1). Pure.
 */
export function reportLines(r: Pick<R, 'approvals_again' | 'applied_overnight'>): string[] {
  const out: string[] = [];
  if (r.approvals_again)
    out.push(r.approvals_again === 1
      ? 'One answer waits for your approval again at earnkit.com/me.'
      : `${r.approvals_again} answers wait for your approval again at earnkit.com/me.`);
  if (r.applied_overnight.length > 0) out.push(`Applied under your standing approval: ${r.applied_overnight.map((a) => a.title).join(', ')}.`);
  return out;
}

export function sinceLine(r: Pick<R, 'since' | 'ready'> & Partial<Pick<R, 'gaps'>>): string | null {
  const s = r.since;
  // L13-17 (v6.1.14): a close a listed line already says ("closes in 3 days") is not repeated here.
  const onLine = new Set([...r.ready, ...(r.gaps ?? [])].filter((p) => p.closes_in).map((p) => p.program_id));
  const closing = s.closing.filter((c) => !onLine.has(c.program_id));
  if (!s.from || s.new.length + s.changed.length + closing.length === 0) return null;
  const parts: string[] = [];
  if (s.new.length > 0) parts.push(`${s.new.length} new ${s.new.length === 1 ? 'program' : 'programs'} you fit`);
  for (const c of s.changed) parts.push(`${c.title}: ${c.what}`);
  for (const c of closing) parts.push(`${c.title} closes ${new Date(c.closes_at).toISOString().slice(0, 10)}`);
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
 * "Before applying: ..." (C45): one clause per thing the builder does, each naming its programs ("you sign in by email
 * and press submit yourself on X; you press submit yourself on Y", v6.1.8 3.4 and 3.5), then the standing approval and
 * what the record lacks; null when there is nothing. When the agent sends tonight, tonight waits on none of these: the
 * block says the send goes ahead and how many more the builder's steps would add (v6.1.9 N4). Pure.
 */
function beforeTonight(r: R, tonight: number): string | null {
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
  // Named once: a program the builder submits is not named again here.
  const outside = titlesOf(r, remote.filter((b) => b.outside_approval && !b.needs_click));
  // What these programs' forms need (v6.1.9); record get names everything the record lacks.
  const missing = r.record_missing.length > 0 ? `Still missing for these programs: ${listWords(r.record_missing)}.` : null;
  if (tonight > 0) {
    // L13-10 (v6.1.14): an ask over the builder's limit names the limit.
    const overBy = new Map<number, string[]>();
    const plainOutside: string[] = [];
    for (const b of remote.filter((x) => x.outside_approval && !x.needs_click)) {
      const t = titlesOf(r, [b]);
      if (b.over_limit_usd !== undefined) overBy.set(b.over_limit_usd, [...(overBy.get(b.over_limit_usd) ?? []), ...t]);
      else plainOutside.push(...t);
    }
    const yes = [
      ...(plainOutside.length > 0 ? [`you say yes yourself to ${listWords(plainOutside, plainOutside.length)}`] : []),
      ...[...overBy].filter(([, t]) => t.length > 0).map(([cap, t]) => `you say yes yourself to ${listWords(t, t.length)}, over your ${dollars(cap)} limit`),
    ];
    const steps = [...clauses, ...yes];
    const more = new Set([...groups.values(), outside].flat()).size;
    const head = tonight === 1 ? "Tonight's send goes ahead." : "Tonight's sends go ahead.";
    const add = steps.length > 0 ? `These would add ${more} more: ${steps.join('; ')}.` : null;
    return add || missing ? [head, add, missing].filter(Boolean).join(' ') : null;
  }
  const parts = clauses.length > 0 ? [`${clauses.join('; ')}.`] : [];
  if (outside.length > 0) parts.push(`Outside your standing approval, you say yes yourself: ${listWords(outside, outside.length)}.`);
  if (missing) parts.push(missing);
  if (parts.length === 0) return null;
  return `Before applying: ${parts.join(' ')}`;
}

/** N3 (v6.1.12): a program the builder said yes to (a rule or the users question) that still needs these answers;
 *  `draft` (L1e-3, v6.1.13): the builder submits it, so EarnKit drafts it for them to send. */
export type YesWait = { title: string; needs: string[]; draft?: true };

/** The step the closing offers (M1, v6.1.9): the users question, or what to make. */
export type FirstStep = { users: true; more?: true } | { users: false; what: string; started?: true };

/**
 * The first shown gap program's step the builder takes, for the closing when nothing is ready and no rule-only program
 * is shown (M1, v6.1.9): the users question when it is the program's only change (`more` when a setup step or a rule is left
 * beside it, so the yes is no send yet); else its first real change. A program
 * EarnKit makes ("do n" on its line), or whose step is its own sentence (sign in, add the project, the proof being
 * read), already says its action, so the next program is looked at. Null when none has such a step. Pure.
 */
export function firstStepOf(gaps: GapProgram[]): FirstStep | null {
  const shown = gaps.filter((g) => !g.in_person && !ruleOnlyGap(g));
  const steps = shown.map((g) => [g.gap, ...g.also].filter((x) => x.kind !== 'rule'));
  // Fix round 1 (v6.1.12): the cheapest step shown closes the reply: a question (the users question, the started
  // question) before any change, whatever the line order.
  for (const [i, real] of steps.entries()) {
    // Final fix (v6.1.12, I1): the yes makes the program ready only with no setup step and no rule left beside it.
    const g = shown[i];
    const more = g.setup.length > 0 || [g.gap, ...g.also].some((x) => x.kind === 'rule');
    if (real.length > 0 && real.every(usersQuestion)) return more ? { users: true, more: true } : { users: true };
    const asked = real.length > 0 && real.every(startedQuestion) ? real[0] : null;
    if (asked) return { users: false, what: asked.what, started: true };
  }
  for (const real of steps) {
    if (canDo(real)) continue;
    const x = real.find((y) => !ownSentenceGap(y) && !usersQuestion(y));
    // v6.1.14 (L1f-1, L1f-3): a gap with its own step (make the repo public) closes on that step.
    if (x) return { users: false, what: x.setup ?? x.what, ...(startedQuestion(x) ? { started: true as const } : {}) };
  }
  return null;
}

/** I2 (v6.1.9 final): the number of the only step program shown when it has an unconfirmed rule (not in person), else null. Pure. */
export const stepRuleOf = (gaps: GapProgram[]): number | null =>
  gaps.length === 1 && !gaps[0].in_person && [gaps[0].gap, ...gaps[0].also].some((x) => x.kind === 'rule') &&
  // L1f-2 (v6.1.14): a rule yes cannot make a program with no code ready, so its code step closes instead.
  ![gaps[0].gap, ...gaps[0].also].filter((x) => x.kind !== 'rule').every(needsCode)
    ? gaps[0].n
    : null;

/** The closing when nothing fits (v6.1.14): EarnKit never writes first, so the builder asks again. */
export const NOTHING_FITS = 'Nothing fits yet. Ask again any time and I show what is new.';

/** O2 (v6.1.10): the closing when in-person programs are listed and nothing remote is ready. */
export const IN_PERSON_CLOSING = 'Nothing remote is ready yet. Say yes and I start the in-person applications.';

/**
 * The one action (v6.1.8, 1a): yes to the ready ones ("I draft ... for you to send" when the builder presses submit
 * on every one, C44); with none ready and remote steps shown "Nothing is ready yet." and the first rule-only gap's
 * "yes r", else the first step (M1, v6.1.9); with no remote step shown (or none of those to name) and in-person
 * programs listed, IN_PERSON_CLOSING (O2, fix round 1). The gap lines carry their own "do n"; no line asks its own yes (T3-R5).
 * `inPerson`: the in-person programs listed, ready or rule-only. Pure.
 */
export function closingLine(o: { ready: number; draftOnly: boolean; gaps: number; firstRule: number | null; inPerson: number; held: number; firstStep?: FirstStep | null; yesStands?: string[]; draftStands?: string[]; yesWaits?: YesWait[]; stepRule?: number | null }): string {
  // v6.1.9: the builder's yes to a rule already stands for the program it made ready: no second yes is asked for it.
  // N3 (v6.1.12): nor for one that still needs answers: the closing names them instead. L1e-3 (v6.1.13): a program
  // the builder submits reads the same with the draft wording (`draftStands`, a wait's `draft`).
  const stands = o.yesStands ?? [];
  const drafts = o.draftStands ?? [];
  const waits = o.yesWaits ?? [];
  if (stands.length > 0 || drafts.length > 0 || waits.length > 0) {
    const said = [
      ...(stands.length > 0 ? [`Your yes stands for ${listWords(stands, stands.length)}: I apply now.`] : []),
      ...(drafts.length > 0 ? [`Your yes stands for ${listWords(drafts, drafts.length)}: I draft ${drafts.length === 1 ? 'it' : 'them'} for you to send.`] : []),
      ...waits.map((w) => `${w.title} needs your ${joinAnd(capped(w.needs.map(bare)))}; then ${w.draft ? 'I draft it for you to send' : 'I apply'}.`),
    ].join(' ');
    const left = o.ready - stands.length - drafts.length - waits.length;
    return left > 0 ? `${said} ${closingLine({ ...o, ready: left, yesStands: [], draftStands: [], yesWaits: [] })}` : said;
  }
  const { ready, draftOnly } = o;
  if (ready === 1) return draftOnly ? 'Say yes and I draft it for you to send.' : 'Say yes and I apply.';
  if (ready > 1) return `${draftOnly ? `Say yes and I draft all ${ready} for you to send.` : `Say yes and I apply to all ${ready}.`} Or say the numbers to skip.`;
  // Ready programs held by another agent are listed as ready, so the reply never says nothing is ready (I1).
  // v6.1.14: no promise to write first.
  if (o.held > 0) return 'Your other agent is handling these.';
  if (o.gaps > 0) {
    if (o.firstRule !== null) return `Nothing is ready yet. Say "yes ${o.firstRule}" if that rule fits you.`;
    // I2 (v6.1.9 final): the only step program shown carries a rule beside its change: the rule is asked first.
    if (o.stepRule != null) return `Nothing is ready yet. Say "yes ${o.stepRule}" if that rule fits you.`;
    const step = o.firstStep ?? null;
    if (step?.users) return `Nothing is ready yet. Do real people use it? Say yes and ${step.more ? 'I look again' : 'I apply'}.`;
    // I3 (v6.1.9 final): "First:" reads as a sentence for a noun or a verb phrase.
    // O3 (v6.1.10): the started question is asked as one.
    if (step && !step.users && step.started) return 'Nothing is ready yet. First: tell me when you started this, and I look again.';
    if (step && step.what === 'code in a repo') return `Nothing is ready yet. ${CODE_CLOSING}`;
    if (step && telling(step.what)) return `Nothing is ready yet. First: ${step.what}, and I look again.`;
    if (step) return `Nothing is ready yet. First: ${step.what}. Tell me when it is done and I look again.`;
    // A reply that lists in-person programs never ends on the bare line (O2, v6.1.10).
    return o.inPerson > 0 ? IN_PERSON_CLOSING : 'Nothing is ready yet.';
  }
  if (o.inPerson > 0) return IN_PERSON_CLOSING;
  // v6.1.14: nothing is pushed to the builder, so nothing is promised.
  return NOTHING_FITS;
}

/** The required answers only the builder gives, still empty, as to-dos ("the problem"): `needs` past the setup steps. Pure. */
const emptyAnswers = (p: ReadyProgram): string[] => p.needs.filter((x) => !p.setup.includes(x));

/** Ready programs (not in person) with no click, no sign-in, within the standing approval and no claim held by an agent. Pure. */
function sendable(r: Pick<R, 'ready' | 'blockers'>): ReadyProgram[] {
  const blocked = new Set(r.blockers.filter((b) => b.needs_click || b.sign_in || b.outside_approval).map((b) => b.program_id));
  return r.ready.filter((p) => !p.in_person && !blocked.has(p.program_id) && !p.claimed_since);
}
/** Of those, the ones an agent can send alone: every required answer filled (v6.1.9 S6, fix round 1). Pure. */
const agentCanApply = (r: Pick<R, 'ready' | 'blockers'>): ReadyProgram[] => sendable(r).filter((p) => emptyAnswers(p).length === 0);

/** With standing approval: "Before tonight (nothing is sent until these are in): your problem for A; ..." for the
 *  sendable programs that wait on a required answer, grouped by the same answers; null when none waits. Pure. */
function waitingLine(r: R): string | null {
  if (!r.auto_apply) return null;
  const named = namedBefore(r);
  const groups = new Map<string, string[]>();
  for (const p of sendable(r)) {
    // F5 (v6.1.12): the email the Before block names is not named again.
    const answers = emptyAnswers(p).filter((x) => !named(x));
    if (answers.length === 0) continue;
    const words = `your ${listWords(answers.map(bare))}`;
    groups.set(words, [...(groups.get(words) ?? []), p.title]);
  }
  if (groups.size === 0) return null;
  return `Before tonight (nothing is sent until these are in): ${[...groups].map(([w, t]) => `${w} for ${listWords(t, t.length)}`).join('; ')}.`;
}

/** The closing when tonight's sends under standing approval already reached max_per_night (v6.1.9 N1). */
export const LIMIT_USED = "Tonight's limit is used; the next sends wait until tomorrow.";

/**
 * What the agent sends alone tonight: the ready programs it can send, up to max_per_night less the sends under standing
 * approval in the last 24 hours (v6.1.9 N1). `limitUsed`: there were some to send and no room is left. Pure.
 */
export function tonightOf(r: Pick<R, 'auto_apply' | 'max_per_night' | 'auto_sent_today' | 'ready' | 'blockers'>): { list: ReadyProgram[]; limitUsed: boolean } {
  if (!r.auto_apply) return { list: [], limitUsed: false };
  const can = agentCanApply(r);
  const room = Math.max(0, (r.max_per_night ?? can.length) - (r.auto_sent_today ?? 0));
  return { list: can.slice(0, room), limitUsed: can.length > 0 && room === 0 };
}

/**
 * Tonight's list as the reply reads it (L13-9, v6.1.14): find's one computation over every ready program when the reply
 * carries it, else `tonightOf` over the listed ones. Pure.
 */
export function tonightIn(r: Pick<R, 'auto_apply' | 'max_per_night' | 'auto_sent_today' | 'ready' | 'blockers' | 'tonight'>): { list: { program_id: string; title: string }[]; limitUsed: boolean } {
  return r.tonight ? { list: r.tonight.programs, limitUsed: r.tonight.limit_used } : tonightOf(r);
}

/** The one sentence for each thing the builder is told about the repo read (v6.1.8, B20 and C59); a repo link not read gets exactly one of the first three. */
export const REPO_NOTE: Record<RepoNote, string> = {
  paused: 'Repo reads are paused until tomorrow; matched on what you told me.',
  private: 'Private repo: matched on what you told me.',
  unread: 'I could not read the repo; matched on what you told me.',
  fork: 'This repo is a fork; programs judge the original.',
  archived: 'This repo is archived; programs want active work.',
  empty: 'The repo is empty, so I matched on what you told me.',
  no_builder_codes: 'The repo does not send Builder Codes yet.',
};

/** F9 (v6.1.12): the empty repo and the missing Builder Codes, when both apply, as one sentence. */
export const EMPTY_NO_CODES = 'The repo is empty and does not send Builder Codes yet, so I matched on what you told me.';
/** The read's notes as the builder reads them, each once, the empty-repo and Builder Codes pair merged (F9). Pure. */
export function repoNoteText(notes: RepoNote[]): string {
  const both = notes.includes('empty') && notes.includes('no_builder_codes');
  return notes
    .filter((n) => !(both && n === 'no_builder_codes'))
    .map((n) => (both && n === 'empty' ? EMPTY_NO_CODES : REPO_NOTE[n]))
    .join(' ');
}

/** What the builder sees. The since line never shows on the first find; `now` reads the claim times. */
export function replyText(r: R, first: boolean, now: Date = new Date()): string {
  const blocks: string[] = [];
  const since = first ? null : sinceLine(r);
  if (since) blocks.push(since);
  const ready = r.ready.filter((p) => !p.in_person);
  const inPerson = r.ready.filter((p) => p.in_person);
  // O2 (v6.1.10): a rule-only in-person program is in the In person block, after the ready ones.
  const steps = r.gaps.filter((g) => !attendRuleGap(g));
  const attendRules = r.gaps.filter(attendRuleGap);
  const attendCount = inPerson.length + attendRules.length;
  const heldInPerson = inPerson.filter((p) => p.claimed_since).length;
  // A program another agent holds leaves the count to say yes to (v6.1.7, C37).
  const free = ready.filter((p) => !p.claimed_since);
  // With nothing ready to say yes to, the closing names a rule-only gap (1a): a keyword hit when one is listed (L1e-5,
  // v6.1.13: its words make the rule likely), else the first in list order.
  const firstRule = (steps.find((g) => ruleOnlyGap(g) && g.keyword_hit) ?? steps.find(ruleOnlyGap))?.n ?? null;
  const named = namedBefore(r);
  // One condition for the heading and the closing: the agent sends tonight (never unlinked, where auto_apply is false).
  const { list: tonightList, limitUsed } = tonightIn(r);
  const tonight = tonightList.length;
  const click = new Set(r.blockers.filter((b) => b.needs_click).map((b) => b.program_id));
  // The builder's yes stands for these (a rule or the users question): never asked again. L1e-3 (v6.1.13): a program
  // the builder submits too, its closing in the draft wording.
  const yesd = free.filter((p) => p.rule_yes && !r.blockers.some((b) => b.program_id === p.program_id && b.sign_in));
  // C44: the builder presses submit on every ready one left to say yes to (their policy, or each program's own), so
  // the agent drafts.
  const unsaid = free.filter((p) => !yesd.includes(p));
  const draftOnly = unsaid.length > 0 && unsaid.every((p) => click.has(p.program_id));
  // Fix round 1 (v6.1.10): the yes stands only for a program fully ready, every required answer held (nothing in need you).
  const stands = yesd.filter((p) => p.need_you.length === 0);
  const waits = yesd.filter((p) => p.need_you.length > 0);
  // The headlines count with parentheses (C56, 3.21); "step" covers a change and a rule to confirm.
  // Review Focus 1 (v6.1.14): a program whose needs the closing names reads them there only (not on tonight's send).
  const namedInClosing = new Set(tonight > 0 ? [] : waits.map((p) => p.program_id));
  if (ready.length > 0) blocks.push([`Ready to apply (${ready.length}):`, ...ready.map((p) => readyLine(p, r.linked, now, false, named, namedInClosing.has(p.program_id)))].join('\n'));
  if (steps.length > 0) blocks.push([`One step away (${steps.length}):`, ...steps.map((g) => gapLine(g))].join('\n'));
  if (attendCount > 0) blocks.push([`In person (${attendCount}):`, ...inPerson.map((p) => inPersonLine(p, false, now)), ...attendRules.map((g) => gapLine(g))].join('\n'));
  const l = r.ledger;
  if (l.applied > 0) {
    const soon = l.closing_soon.length > 0 ? `, ${l.closing_soon.length} closing soon` : '';
    // What was won, never what was asked (v6.1.8, 3.6).
    const won = l.won > 0 && l.won_usd > 0 ? ` (${dollars(l.won_usd)})` : '';
    // v6.1.14: the /me page's name for it, never the internal "ledger". L13-18: a rejection counts too; a count of
    // none is left out (waiting is said whenever any wait).
    const counts = [`${l.applied} sent`, ...(l.won > 0 ? [`${l.won} won${won}`] : []), ...(l.rejected > 0 ? [`${l.rejected} rejected`] : []), ...(l.pending > 0 ? [`${l.pending} waiting${soon}`] : [])];
    blocks.push(`Your applications: ${counts.join(', ')}.`);
  }
  const before = beforeTonight(r, tonight);
  if (before) blocks.push(before);
  const waiting = waitingLine(r);
  if (waiting) blocks.push(waiting);
  blocks.push(...reportLines(r));
  if (r.evidence_summary) blocks.push(r.evidence_summary.line);
  // What the read was, once each, just before the closing (money first stays first).
  const notes = [...new Set(r.repo_notes ?? [])];
  if (notes.length > 0) blocks.push(repoNoteText(notes));
  const closing =
    tonight > 0
      ? `Applying tonight to ${listWords(tonightList.map((p) => p.title), tonight)}. Say stop to hold any.`
      : [
          // N1 (v6.1.9, fix round 1): the used limit takes the tonight list's place; the builder can still say yes.
          ...(limitUsed ? [LIMIT_USED] : []),
          closingLine({
            // Fix round 1 (I2): an in-person program held for another project is listed, never a yes.
            ready: free.length, draftOnly, gaps: steps.length, firstRule, inPerson: attendCount - heldInPerson, held: ready.length - free.length + heldInPerson, firstStep: firstStepOf(steps), stepRule: stepRuleOf(steps),
            yesStands: stands.filter((p) => !click.has(p.program_id)).map((p) => p.title),
            draftStands: stands.filter((p) => click.has(p.program_id)).map((p) => p.title),
            // N3 (v6.1.12): one that still needs answers names them (the email once, F5), never a second yes.
            yesWaits: waits.map((p) => {
              const own = p.need_you.filter((x) => !named(x));
              return { title: p.title, needs: own.length > 0 ? own : p.need_you, ...(click.has(p.program_id) ? { draft: true as const } : {}) };
            }),
          }),
        ].join(' ');
  // R5a: saying yes is the one action; unlinked with a link, signing in is the closing block's second sentence.
  // The first find after a link names the account it linked to, last (security M2); after an unlink the notice
  // carries the sign-in link itself, so the sign-in sentence is left out (v6.1.7 B10).
  // An empty repo was read but gave nothing to prove: the sign-in promises only to remember (C59).
  // Fix round 1 (v6.1.14, F2): with a proof gap shown and no link to give (linkOf failed, or the account was deleted),
  // the sign-in is still the action, said once without a link.
  const read = !r.as_reported && !notes.includes('empty');
  const proof = showsProof(r.gaps);
  const signIn = r.linked
    ? null
    : r.sign_in
      ? (r.linked_notice ? null : signInSentence(r.sign_in, read, proof))
      : proof ? signInSentence(null, read, true) : null;
  blocks.push([closing, signIn, r.linked_notice].filter(Boolean).join(' '));
  return blocks.join('\n\n');
}

/** A contract the read still does not find may be on chain only (v6.1.9 fix round 1). */
export const CONTRACT_NOTE = 'Pass the contract address if it is on chain.';
/** Whether the gap's "looked again" names a contract. Pure. */
export const contractLookedAgain = (g: Pick<GapProgram, 'looked_again'>): boolean => (g.looked_again ?? []).some((w) => /contract on /.test(w));

/** v6.1.14 (L1f-1, L1f-3): the public repo and archive steps are settled by the next report, never by gap_done. */
export const REPO_STEP_NOTE =
  'A public repo or an archived repo is settled by the project you pass, not by gap_done: when the builder makes the repo public, pass private: false next time; for an archived repo, pass the live repo_url they give.';

/** C41 (v6.1.8): no record project matched, so only record-level answers were used; also on the one-program detail (N9, v6.1.9). */
export const NO_PROJECT_NOTE =
  "No project in the builder's record matched this one by project_id, repo or name, so no project answers were used; pass project_id (record get lists them) next time.";

/** Done steps belong to one project (v6.1.10 L1c-1): track carries the project find was called with. */
export const SAME_PROJECT = 'Pass the same project on track so its steps stay with it.';

/**
 * What the agent does with the reply. `more`: ready and gap programs left out of the lists. `description` (C58): the
 * project came with none, and the README's first sentence stood in ('readme') or nothing could (`none`).
 */
export function agentNote(r: R, o: { more: number; description?: 'readme' | 'none' | null }): string {
  const standing =
    'Standing approval is on: for each ready program within the limits, call track started, fill from fields, submit where the program allows an agent, then track applied with submitted_by agent and fields_used (the field keys). Stop at max_per_night. Never submit where blockers say needs_click, outside_approval or a sign-in you do not have. Under standing approval, send only when every required answer is filled; otherwise wait for the builder.';
  const lines = [
    'Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.',
    r.linked
      ? `Draft each ready program from its fields: 'record' and 'earnkit' values as given, ${CUT_NOTE}; ${AGENT_FIELDS}`
      : `Draft each ready program from its fields: 'earnkit' values as given; ${AGENT_FIELDS}`,
    ...(r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'rule')) ? [RULE_NOTE] : []),
    // With standing approval the agent does not wait for a yes; the limits replace it.
    // The submit rule itself is in the server instructions, once (v6.1.8); here only what this reply adds.
    ...(r.auto_apply ? [standing] : ['Fill field by field; form_id names the form field when given.']),
    ...(tonightIn(r).limitUsed ? ['Tonight\'s limit is used: send nothing alone until 24 hours after the last send under standing approval.'] : []),
    // L13-9 (v6.1.14): tonight's list is over every ready program, so it may name ones past the shown list.
    ...(tonightIn(r).list.some((t) => !r.ready.some((p) => p.program_id === t.program_id))
      ? ["Tonight's list names programs past the shown list: call find with program_id for each one's fields before you send it."]
      : []),
    'Call track with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.',
    'Pass users and live_url in the project whenever you know them; never invent them.',
    'The numbers the builder says are each item\'s n in ready and gaps ("skip 4" is the item with n 4), not its place in the list.',
  ];
  if (r.ready.some((p) => p.in_person) || r.gaps.some(attendRuleGap))
    lines.push('In-person programs (in_person: true) are not in "yes to all": draft nothing for one until the builder says yes to attending it and its setup. When the reply closes on starting the in-person applications, a yes is that yes for each one listed; for one with a rule (a "yes n" from the builder, or that closing yes), call track gap_done with its rule item first.');
  if (r.gaps.some((g) => !ruleOnlyGap(g)))
    lines.push(
      r.gaps.some((g) => canDo([g.gap, ...g.also].filter((x) => x.kind !== 'rule')))
        ? 'On "do <n>": make that gap\'s change (its details carry the docs), push, call track with gap_done and the gap\'s item, then call find again. Where a gap line offers no "do", the builder makes the change and tells you when it is done.'
        : 'The builder makes each change (never deploy a contract for them); when they say it is done, call track with gap_done and the gap\'s item, then call find again.',
    );
  if (r.gaps.length > 0) lines.push(SAME_PROJECT);
  if (r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.item === 'repo:public' || x.item === 'repo:archived')))
    lines.push(REPO_STEP_NOTE);
  if (r.gaps.some(contractLookedAgain)) lines.push(CONTRACT_NOTE);
  if (r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'users' && x.effort === 'hours')))
    lines.push('"Tell me if real people use it" is a question, not work: ask the builder once; on yes, pass users: true next time or call track with gap_done and item users.');
  if (r.gaps.some((g) => [g.gap, ...g.also].some(startedQuestion)))
    lines.push('"Tell me when you started this" is a question, not work: ask the builder once; pass first_commit_at in the project next time, or, when they started after the program\'s start, call track with gap_done and that gap\'s item. Never invent the date.');
  if (o.more > 0) lines.push(`${o.more} more left out: ready past the cap, gaps and in-person programs. Ask with filter.all for the full list.`);
  if (r.ask_outcome.length > 0)
    lines.push(`Ask once how each went: ${r.ask_outcome.map((a) => a.title).join(', ')}. Pass each answer to track (won with amount_usd, rejected or no_result).`);
  if (r.linked) lines.push('Fit approved answers by cutting, never by adding; the style contract travels on each field.');
  if (r.record_missing.length > 0)
    lines.push('Ask for the missing record items once, all together, and save each with record. record_missing names only what these programs need; record get names everything the record lacks.');
  if (r.ready.some((p) => p.claimed_since)) lines.push('A ready program with claimed_since is claimed by another of the builder\'s agents: do not submit it.');
  if (r.released.length > 0) lines.push(`Claims left unsent for 24 hours were released: ${r.released.join(', ')}.`);
  const paused = r.problems?.includes(READS_PAUSED) === true;
  // One line per fact: reads paused says the match is as reported itself.
  if (r.as_reported && !paused) lines.push('No public repo was read, so the match used the facts you reported; tell the builder the match used what they reported, not a repo read.');
  if (o.description === 'readme') lines.push("No description was passed, so the README's first sentence stood in for it; pass one next time if it reads wrong.");
  if (o.description === 'none') lines.push('No description was passed and no README could stand in; pass one next time.');
  // C41 (v6.1.8): no record project is this one, so only record-level answers were used.
  if (r.problems?.includes(NO_RECORD_PROJECT))
    lines.push(NO_PROJECT_NOTE);
  const dropped = (r.problems ?? []).filter((p) => p !== READS_PAUSED && p !== EVIDENCE_NOT_READ && p !== NO_RECORD_PROJECT);
  if (dropped.length > 0) lines.push(`Some project facts were dropped: ${dropped.join('; ')}. Send them corrected next time.`);
  if (paused) lines.push('Repo reads are paused for this installation until tomorrow; the match used what you reported.');
  return lines.join('\n');
}
