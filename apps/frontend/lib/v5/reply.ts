/**
 * The words of a find reply: `replyText` (what the builder sees, design section 4) and
 * `agentNote` (what the agent does next). In-person programs get their own block after ready and
 * gaps, with their setup, and are never in the count to apply to. Linked, the record's blocks follow. Pure.
 */
import { EARNKIT_CUT_NOTE } from './prefill';
import { EVIDENCE_NOT_READ, NO_RECORD_PROJECT, confirmBar, isConfirmWhat, isProofReadingWhat, listWords, signInSentence, type ProofBar } from '../v6/reply-words';
import { NEEDS_CODE, rulesOnly, type Gap } from './eligibility';
import { chainName } from './chains';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import { applicationsLine } from './ledger';
import { closesWords, dayWords } from './deadline';
import { READS_PAUSED, type RepoNote } from './repo-facts';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;

/** How the agent drafts the fields EarnKit did not fill (find and one program alike). */
/** C42 (v6.1.8): a record value over its field's cap is never sent as given. */
export const CUT_NOTE = "except a field marked fit 'cut', which you cut to its max_chars as its fit_note says";
export const AGENT_FIELDS =
  "'agent' fields you draft using the repo, the field's sources and what you already know about the builder; 'builder' fields you ask once, all together. Never invent a personal fact, an amount or a number.";
const NEEDS_SHOWN = 3;

/** The agent note line for rule gaps (v6.1.6, R18a): EarnKit shows them, the builder confirms each once. */
export const RULE_NOTE =
  'A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again. Draft it and show the builder; submit only on a yes to the draft.';

/**
 * L24-2 (v6.1.16 Task 11): the kind of the one `Say` a reply offered, kept per installation (`installations.last_offer`):
 * apply (a yes sends, or drafts a builder-submit program), look_again (a question whose yes only looks again), draft (a
 * question whose yes drafts), rule (a rule question), do (EarnKit makes a change), stop (the standing-approval hold).
 */
export type OfferKind = 'apply' | 'look_again' | 'draft' | 'rule' | 'do' | 'stop';
/** L24-2: "Your yes stands" only when the last offer this installation showed was apply. Pure. */
export const yesStands = (last: OfferKind | null | undefined): boolean => last === 'apply';
/** L24-11, L24-4 (v6.1.16 Task 11): the agent note's hold rule whenever the standing-approval line shows. */
export const STOP_NOTE = 'On stop, call track with status held for each program named.';
/** L24-4: the agent note for a program the builder held. */
export const HELD_READY_NOTE = 'A ready program with held: true is held by the builder: send nothing for it until they say go; then call track started and send.';
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
export function numbered<P extends { in_person: boolean; claimed_since?: string; held?: true }, G>(ready: P[], gaps: G[], inBlock: (g: G) => boolean = () => false): { ready: (P & { n: number })[]; gaps: (G & { n: number })[] } {
  // L17-6 (v6.1.16): the ones this agent can send first, then those another agent holds (their own block), numbered on;
  // L24-4 (v6.1.16 Task 11): then the ones the builder held (their own block).
  const apply = [
    ...ready.filter((p) => !p.in_person && !p.claimed_since && !p.held),
    ...ready.filter((p) => !p.in_person && p.claimed_since),
    ...ready.filter((p) => !p.in_person && !p.claimed_since && p.held),
  ];
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

/** "09:14 UTC" for today (UTC), "Nov 5, 22:10 UTC" for another day (the day through `dayWords`, L23-11: "Nov 5, 2025,
 *  22:10 UTC" in another year); "earlier today" when the time does not read. Pure. */
export const clock = (iso: string, now: Date) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'earlier today';
  const hm = `${d.toISOString().slice(11, 16)} UTC`;
  if (d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return hm;
  return `${dayWords(d, now)}, ${hm}`;
};

/** "$25,000". Pure. */

/** "a, b and c". Pure. */
const joinAnd = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/**
 * Gap phrases joined (L1h-3, v6.1.16): with `, and ` before the last when any phrase already holds ` and ` ("deploy the
 * contract on Solana, and use Mobile Wallet Adapter and Seed Vault in an Android app"), else as `joinAnd`. Pure.
 */
const joinGaps = (xs: string[]): string => (xs.length > 1 && xs.some((x) => x.includes(' and ')) ? `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}` : joinAnd(xs));

/** At most NEEDS_SHOWN needs, then "{n} more" (fix round 1, v6.1.12): the ready line and the N3 closing. Pure. */
const capped = (needs: string[]): string[] => (needs.length > NEEDS_SHOWN ? [...needs.slice(0, NEEDS_SHOWN), `${needs.length - NEEDS_SHOWN} more`] : needs);

/** A to-do as it reads after "Needs your": "your email" and "a Loom product demo" lose their first word. */
const bare = (todo: string) => todo.replace(/^(your|a|an|the)\s+/i, '');

/** Whether another block of the reply already names a need (F5, v6.1.12: the missing email in the Before block). */
type Named = (need: string) => boolean;
/** The builder's own email as a need ("your email"), as the record names it missing (lib/v6/record.ts). */
const EMAIL_NEED = /^(your |the )?email( address)?$/i;
/** F5 (v6.1.12): the Before block names the missing email ("Before applying: your email"), so the
 *  reply's other blocks do not. Pure. */
export const namedBefore = (r: Pick<R, 'record_missing'>): Named =>
  r.record_missing.some((m) => EMAIL_NEED.test(m)) ? (need) => EMAIL_NEED.test(need) : () => false;
/** Whether two need words name one need (the same words, or both the builder's email). Pure. */
const sameNeed = (a: string, b: string): boolean => a === b || (EMAIL_NEED.test(a) && EMAIL_NEED.test(b));

/** "3. " before a list line; nothing on the one-program reply (`alone`, v6.1.8 1b), which shows the line alone. Pure. */
const num = (n: number, alone: boolean) => (alone ? '' : `${n}. `);

/** A ready program's line; `alone` leaves out the list number (the one-program reply). `waits` (v6.1.14): the closing
 *  names this program's needs ("X needs your ...; then I apply."), so the line does not. Pure. */
export function readyLine(p: ReadyProgram, linked: boolean, _now: Date, alone = false, named: Named = () => false, waits = false): string {
  let head = `${num(p.n, alone)}${p.title}, ${p.money}`;
  if (p.closes_in) head += `, closes ${p.closes_in}`;
  // The long odds are their own sentence after the head, never a label on the money.
  if (p.long_shot) head += `. Long odds: ${p.long_shot}`;
  // Setup items are steps ("sign in to ..."), the rest are things ("a Loom demo"): each reads its own way.
  const steps = p.needs.filter((x) => p.setup.includes(x));
  // L29-18 (v6.1.16 Task 15): "You give: {fields}." (the builder's answers, need_you, as words), linked and unlinked;
  // F5: one another block names is not named again; `waits`: the closing names them. The counts stay in the JSON.
  const own = linked ? p.need_you.filter((x) => !named(x)) : p.needs.filter((x) => !p.setup.includes(x));
  const first = steps.length > 0 ? ` First: ${steps.join('; ')}.` : '';
  // Another agent of the builder's holds it: still numbered, so the builder can name it, but not in the yes count.
  // C1 (v6.1.13), ruling 12 (v6.1.16 Task 11, L24-1): no project name and no time, one sentence.
  const held = p.claimed_since ? ' Being handled by your other agent.' : '';
  return `${head}.${youGive(waits ? [] : own)}${first}${held}`;
}

/** L29-18 (v6.1.16 Task 15): " You give: your email and the problem." (at most NEEDS_SHOWN, then "{n} more"), or ''. Pure. */
const youGive = (needs: string[]): string => (needs.length > 0 ? ` You give: ${joinAnd(capped(needs))}.` : '');

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
export function inPersonLine(p: ReadyProgram, alone = false, _now?: Date): string {
  const line = attendLine(p, alone);
  // C1 (v6.1.13), ruling 12 (v6.1.16 Task 11, L24-1): held by another agent, one sentence with no project and no time.
  return p.claimed_since ? `${line} Being handled by your other agent.` : line;
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
/** L1j-6 (v6.1.17): the bar the first unlinked proof gap names, so the sign-in says what it checks; null with none. Pure. */
export const proofBarOf = (gaps: Gap[]): ProofBar | null => {
  const g = gaps.find(confirmGap);
  return g ? confirmBar(g.what) : null;
};
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
/**
 * L24-8 (v6.1.16 Task 11): the do offer the closing carries for the first shown gap EarnKit can make: its number and the
 * verb ("add the codes" for Builder Codes, else the change itself, "make both changes" for two). Null when none. Pure.
 */
export function doOfferOf(gaps: (GapProgram & { n: number })[]): { n: number; verb: string } | null {
  for (const g of gaps) {
    if (g.in_person) continue;
    const real = [g.gap, ...g.also].filter((x) => x.kind !== 'rule');
    if (!canDo(real)) continue;
    return { n: g.n, verb: real.length === 1 && real[0].kind === 'builder_codes' ? 'add the codes' : doVerb(real, true) };
  }
  return null;
}
/** What "do" makes: in a list line the short verb ("add them"); on the one-program reply, where no list names the
 *  change twice, the change itself ("add Base Builder Codes to the app"). Pure. */
const doVerb = (real: Gap[], named: boolean): string =>
  real.length > 1 ? 'make both changes' : named ? real[0].what : (DO_VERB[real[0].kind] ?? 'make the change');
/** The "tell me if real people use it" question: a yes, not work (the same gap the agent note names). Pure. */
const usersQuestion = (x: Gap) => x.kind === 'users' && x.effort === 'hours';
/** T3-R1 (v6.1.13): the code-in-a-repo step of a grant for existing code (eligibility's NEEDS_CODE). Pure. */
const needsCode = (x: Gap) => x.kind === 'repo' && x.item === 'repo';
/** A step the builder takes by telling (the live repo): asked as one (L1f-3, v6.1.14). Pure. */
const telling = (step: string) => /^tell me /.test(step);
/** O3 (v6.1.10): the "tell me when you started this" question: a date the builder gives, not work. Pure. */
export const startedQuestion = (x: Gap) => x.kind === 'new_work_after' && x.effort === 'minutes';

/**
 * L1g-5 (v6.1.16): the step a gap closes on, as the clause after "Tell me when": the code in a repo, the repo public,
 * the contract on a chain, the live link, the demo video; fix round 1 (I1): a below-bar tier gap ("people outside the
 * team use it live"), a feature ("{feature} is in"), a users gap of weeks ("it has been live for {n} weeks"); a gap's
 * own setup step (not a telling one) as "you {setup}"; else null. Pure.
 */
export function stepClause(x: Gap): string | null {
  if (x.item === 'repo') return x.what === 'code in a public repo' ? 'the code is in a public repo' : 'the code is in a repo';
  if (x.item === 'repo:public') return 'the repo is public';
  if (x.kind === 'chain' || x.kind === 'contract_on')
    return `the contract is on ${chainName(x.details?.chain ?? x.item.split(':')[1] ?? '')}${/\bmainnet\b/.test(x.what) ? ' mainnet' : ''}`;
  if (x.kind === 'live_product') return 'the live link is up';
  if (x.kind === 'demo_video') return 'the demo video is ready';
  if (x.setup && !telling(x.setup)) return `you ${x.setup}`;
  // Fix round 1 (I1): the three kinds with no clause get their own, so the one shape holds everywhere.
  if (x.kind === 'tier' && !ownSentenceGap(x)) return 'people outside the team use it live';
  // L1h-3 (v6.1.16): a note that opens with its verb ("use ...") gives way to the feature's own name (its value).
  if (x.kind === 'feature') return `${/^(use|add) /.test(x.what) && x.item.startsWith('feature:') ? x.item.slice(8) : x.what} is in`;
  if (x.kind === 'users' && x.effort === 'weeks') {
    const n = weeksOf(x);
    // Fix round 1 (M3, Task 1's nit): one week is singular.
    return n !== null ? `it has been live for ${n} week${n === 1 ? '' : 's'}` : 'real people use it';
  }
  // Fix round 1 (M3, Task 1's nits): the rare kinds that closed on "that is done" name their step.
  if (x.kind === 'users') return 'real people use it';
  if (x.kind === 'builder_codes') return 'the app sends Base Builder Codes';
  if (x.kind === 'integration') return `${x.what.replace(/^add /, '')} is in`;
  if (x.kind === 'new_work_after' && !startedQuestion(x)) return 'the new work has started';
  return null;
}
/** The weeks a users gap asks the product to have been live, when its words say ("4 weeks"), else null. Pure. */
const weeksOf = (x: Gap): number | null => {
  const m = /(\d+)\s*weeks?\b/.exec(x.what);
  return m ? Number(m[1]) : null;
};

/** L1g-5 (v6.1.16): the one closing shape for a single step: "Tell me when {step} and I look again."; a telling step
 *  ("tell me the live repo") takes the place of "when {step}". Pure. */
export function singleStepClosing(x: Gap): string {
  if (x.setup && telling(x.setup)) return `T${x.setup.slice(1)} and I look again.`;
  return `Tell me when ${stepClause(x) ?? 'that is done'} and I look again.`;
}

/** L1f-2 (v6.1.14): the closing when the step's only change is code in a repo: one action, no rule yes before the code exists. */
export const CODE_CLOSING = singleStepClosing(NEEDS_CODE);
/** The started question's closing (O3, v6.1.10; L1g-5). */
const STARTED_CLOSING = 'Tell me when you started and I check it.';

/**
 * The one action under a one-program gap line (v6.1.8, 1b), or null, with the gap whose step it closes on (L1g-5,
 * v6.1.16): rules only, a yes that drafts; EarnKit can make every real gap, "do" and it makes that change first; the
 * users question, a yes; the started question; one real step (code in a repo, the repo public, a single change),
 * `singleStepClosing`; else the builder makes the changes and says when, and EarnKit applies, or drafts it for the
 * builder to send when they press submit (`draftOnly`, L18-3 v6.1.18). Signing in is the only real step and there is
 * a link (`signIn`, fix round 1): the sign-in sentence with the link. In person: none. Pure.
 */
function gapActionOf(g: GapProgram, signIn: string | null, draftOnly = false): { action: string | null; step?: Gap } {
  if (g.in_person) return { action: null };
  if (ruleOnlyGap(g)) return { action: 'Say yes if that is you and I draft it.' };
  const real = [g.gap, ...g.also].filter((x) => x.kind !== 'rule');
  if (signIn && signInOnly([g.gap, ...g.also])) return { action: signIn };
  if (real.every((x) => x.kind === 'tier' && isProofReadingWhat(x.what))) return { action: null };
  if (canDo(real)) return { action: `Say "do" and I ${doVerb(real, true)} first.` };
  if (real.every(usersQuestion)) return { action: 'Say yes if they do and I draft it.' };
  if (real.every(startedQuestion)) return { action: STARTED_CLOSING };
  // L1f-1 (v6.1.14): a private repo for an open source program: the repo made public comes first, then a look again.
  // L18-2 (v6.1.18): with no code yet, the code is the step whatever else is left (the rest waits on it).
  const step = real.find(needsCode) ?? real.find((x) => x.item === 'repo:public') ?? (real.length === 1 ? real[0] : null);
  if (step) return { action: singleStepClosing(step), step };
  return { action: draftOnly ? 'Tell me when that is done and I draft it for you to send.' : 'Tell me when that is done and I apply.' };
}

/** The one action under a one-program gap line, or null (see `gapActionOf`). Pure. */
export const gapAction = (g: GapProgram, signIn: string | null = null, draftOnly = false): string | null => gapActionOf(g, signIn, draftOnly).action;

/**
 * FR-1 (v6.1.14 final fix), L1g-5 (v6.1.16): the gap's own setup step that `gapAction` closes on (make the repo public,
 * a telling step, any setup step it names), so the one-program line leaves it out and the reply says it once. Else null. Pure.
 */
export function gapActionStep(g: GapProgram, signIn: string | null = null, draftOnly = false): string | null {
  return gapActionOf(g, signIn, draftOnly).step?.setup ?? null;
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
export function gapLine(g: GapProgram, alone = false, closed: string | null = null): string {
  const all = [g.gap, ...g.also];
  const rules = ruleSentences(all.filter((x) => x.kind === 'rule').map((x) => x.what));
  // v6.1.14 (L1f-1, L1f-3): a gap's own step (make the repo public, tell me the live repo) leads the setup steps;
  // fix round 1 (I1): the step the closing names (`closed`) is said there only.
  const own = all.flatMap((x) => (x.setup ? [x.setup] : []));
  const setup = [...own.filter((x) => x !== closed), ...g.setup];
  const attend = g.in_person ? attendSentence([...own, ...g.setup]) : '';
  // L1d-2 (v6.1.11): the setup steps (an account, a sprint) after the gaps and before the rules, as on a ready line;
  // in person, the attend sentence already says them.
  const first = !g.in_person && setup.length > 0 ? ` First: ${setup.join('; ')}.` : '';
  // O1 (v6.1.10): a program closing within 7 days says so after the money.
  const money = `${g.money}${g.closes_in ? `, closes ${g.closes_in}` : ''}`;
  if (ruleOnlyGap(g)) return `${num(g.n, alone)}${g.title}, ${money}.${first}${rules}${attend}`;
  const real = all.filter((x) => x.kind !== 'rule');
  // v6.1.14: the unlinked proof is listed with the other gaps; its sign-in is the closing's.
  const listed = real.filter((x) => !readingGap(x));
  const confirm = real.filter(readingGap).map((x) => ` ${x.what}.`).join('');
  const head = `${num(g.n, alone)}${g.title}, ${money}${listed.length > 0 ? `: ${joinGaps(listed.map((x) => x.what))}` : ''}.`;
  // L24-8 (v6.1.16 Task 11): the line carries no "do n"; the closing offers it (`doOfferOf`).
  return `${head}${confirm}${first}${rules}${attend}${lookedAgainSentences(g)}`;
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

export function sinceLine(r: Pick<R, 'since' | 'ready'> & Partial<Pick<R, 'gaps'>>, now: Date = new Date()): string | null {
  const s = r.since;
  // L13-17 (v6.1.14): a close a listed line already says ("closes in 3 days") is not repeated here.
  const onLine = new Set([...r.ready, ...(r.gaps ?? [])].filter((p) => p.closes_in).map((p) => p.program_id));
  const closing = s.closing.filter((c) => !onLine.has(c.program_id));
  if (!s.from || s.new.length + s.changed.length + closing.length === 0) return null;
  const parts: string[] = [];
  if (s.new.length > 0) parts.push(`${s.new.length} new ${s.new.length === 1 ? 'program' : 'programs'} you fit`);
  for (const c of s.changed) parts.push(`${c.title}: ${c.what}`);
  // L23-9, L23-11 (v6.1.16): the one closes wording and the one date formatter.
  for (const c of closing) parts.push(`${c.title} ${closesWords(c.closes_at, now, c.zone ?? 'UTC')}`);
  return `Since ${dayWords(new Date(s.from), now)}: ${parts.join('; ')}.`;
}

/** "you sign in to Google in your agent's browser" (#14, v6.1.15), "you sign in by email". Pure. */
function signInWords(kind: string): string {
  if (kind === 'google' || kind === 'github') return `you sign in to ${kind === 'google' ? 'Google' : 'GitHub'} in your agent's browser`;
  if (kind === 'email') return 'you sign in by email';
  return `you sign in to ${kind}`;
}

const titlesOf = (r: R, bs: R['blockers']) =>
  bs.map((b) => r.ready.find((p) => p.program_id === b.program_id)?.title).filter((t): t is string => !!t);

/**
 * "Before applying: ..." (C45): one clause per thing the builder does, each naming its programs ("you sign in by email
 * and press submit yourself on X; you press submit yourself on Y", v6.1.8 3.4 and 3.5), then what the record lacks;
 * null when there is nothing. L24-26, L24-28 (v6.1.16 Task 11): the standing approval is said once, by the closing (the
 * standing line, or "{title} is over your limit"), never here. Pure.
 */
function beforeLine(r: R, waiting: string | null = null, said: string[] = []): string | null {
  // R21: an in-person program's line already says what attending takes, so its sign-in and submit are not repeated.
  const inPerson = new Set(r.ready.filter((p) => p.in_person).map((p) => p.program_id));
  const remote = r.blockers.filter((b) => !inPerson.has(b.program_id));
  const groups = new Map<string, string[]>();
  for (const b of remote) {
    if (!b.sign_in && !b.needs_click) continue;
    const words = b.sign_in ? `${signInWords(b.sign_in)}${b.needs_click ? ' and press submit yourself on' : ' for'}` : 'you press submit yourself on';
    groups.set(words, [...(groups.get(words) ?? []), ...titlesOf(r, [b])]);
  }
  const clauses = [...groups].filter(([, t]) => t.length > 0).map(([words, t]) => `${words} ${listWords(t, t.length)}`);
  // What these programs' forms need (v6.1.9); record get names everything the record lacks. Fix round 1 (M1, L29-17
  // over F5): a need the Say names (`said`) is said there only.
  const lacks = r.record_missing.filter((m) => !said.some((n) => sameNeed(n, m)));
  // L29-18 (v6.1.16 Task 15, fix round 1 M2): one label; what waits under standing approval and what the record lacks
  // are clauses of it.
  const all = [...clauses, ...(waiting ? [waiting] : []), ...(lacks.length > 0 ? [listWords(lacks)] : [])];
  return all.length > 0 ? `Before applying: ${all.join('; ')}.` : null;
}

/** N3 (v6.1.12): a program the builder said yes to (a rule or the users question) that still needs these answers;
 *  `draft` (L1e-3, v6.1.13): the builder submits it, so EarnKit drafts it for them to send. */
export type YesWait = { title: string; needs: string[]; draft?: true };

/** The step the closing offers (M1, v6.1.9): the users question, or what to make. */
export type FirstStep = ({ users: true; more?: true } | { users: false; what: string; started?: true; code?: true; setup?: true; gap?: Gap }) & { program_id?: string };

/**
 * The first shown gap program's step the builder takes, for the closing when nothing is ready and no rule-only program
 * is shown (M1, v6.1.9): the users question when it is the program's only change (`more` when a setup step or a rule is left
 * beside it, so the yes is no send yet); else its first real change. A program
 * EarnKit makes ("do n" on its line), or whose step is its own sentence (sign in, add the project, the proof being
 * read), already says its action, so the next program is looked at. Null when none has such a step. Pure.
 */
export function firstStepOf(gaps: GapProgram[]): FirstStep | null {
  // L1g-8b (v6.1.16): a program whose rule the project names nowhere (`unlikely`, full list) closes only when no other does.
  const likely = gaps.filter((g) => !g.unlikely);
  return (likely.length < gaps.length ? stepOf(likely) : null) ?? stepOf(gaps);
}

function stepOf(gaps: GapProgram[]): FirstStep | null {
  const shown = gaps.filter((g) => !g.in_person && !ruleOnlyGap(g));
  const steps = shown.map((g) => [g.gap, ...g.also].filter((x) => x.kind !== 'rule'));
  // Fix round 1 (v6.1.12): the cheapest step shown closes the reply: a question (the users question, the started
  // question) before any change, whatever the line order.
  for (const [i, real] of steps.entries()) {
    // Final fix (v6.1.12, I1): the yes makes the program ready only with no setup step and no rule left beside it.
    const g = shown[i];
    const more = g.setup.length > 0 || [g.gap, ...g.also].some((x) => x.kind === 'rule');
    if (real.length > 0 && real.every(usersQuestion)) return more ? { users: true, more: true, program_id: g.program_id } : { users: true, program_id: g.program_id };
    const asked = real.length > 0 && real.every(startedQuestion) ? real[0] : null;
    if (asked) return { users: false, what: asked.what, started: true, program_id: g.program_id };
  }
  for (const [i, real] of steps.entries()) {
    if (canDo(real)) continue;
    const x = real.find((y) => !ownSentenceGap(y) && !usersQuestion(y));
    // v6.1.14 (L1f-1, L1f-3): a gap with its own step (make the repo public) closes on that step.
    // Fix round 1 (M3): code in a repo is flagged by its kind; a gap's own step (I1) is flagged so the lines leave it out.
    if (x)
      return {
        users: false, what: x.setup ?? x.what, gap: x, program_id: shown[i].program_id,
        ...(startedQuestion(x) ? { started: true as const } : {}), ...(needsCode(x) ? { code: true as const } : {}), ...(x.setup ? { setup: true as const } : {}),
      };
  }
  return null;
}

/** I2 (v6.1.9 final): the number of the only step program shown when it has an unconfirmed rule (not in person), else
 *  null. L1g-8b (v6.1.16): never a program not ready for this repo (`public_first`): its rule is no step yet. Pure. */
export const stepRuleOf = (gaps: GapProgram[]): number | null =>
  gaps.length === 1 && !gaps[0].in_person && !gaps[0].public_first && [gaps[0].gap, ...gaps[0].also].some((x) => x.kind === 'rule') &&
  // L1f-2 (v6.1.14): a rule yes cannot make a program with no code ready, so its code step closes instead.
  ![gaps[0].gap, ...gaps[0].also].filter((x) => x.kind !== 'rule').every(needsCode)
    ? gaps[0].n
    : null;

/** Fix round 1 (v6.1.14, I1): the gap's own step the closing names (closingLine's first-step branch), or null. Pure. */
export function closingSetup(o: { ready: number; held: number; gaps: number; firstRule: number | null; stepRule?: number | null; firstStep?: FirstStep | null }): string | null {
  const step = o.firstStep;
  if (!step || step.users || !step.setup) return null;
  return o.ready === 0 && o.held === 0 && o.gaps > 0 && o.firstRule === null && o.stepRule == null ? step.what : null;
}

/** Task 11 fix round 1 (M1): the closing when every ready program is held by the builder. */
export const HOLD_CLOSING = 'On hold until you say go. Say go and I apply.';

/** The closing when nothing fits (v6.1.14): EarnKit never writes first, so the builder asks again. */
export const NOTHING_FITS = 'Nothing fits yet. Ask again any time and I show what is new.';

/** The closing with nothing ready and no step to name (L1j-6, v6.1.17: then the sign-in is the reply's last line). */
export const NOTHING_READY = 'Nothing is ready yet.';
/** O2 (v6.1.10): the closing when in-person programs are listed and nothing remote is ready. */
export const IN_PERSON_CLOSING = 'Nothing remote is ready yet. Say yes and I start the in-person applications.';

/** L29-28 (v6.1.16 Task 15): the rule question's Say. Pure. */
export const ruleSay = (n: number): string => `Say "yes ${n}" if that rule fits you and I get it ready.`;
/** L29-34 (v6.1.16 Task 15): the users question, unlinked. */
export const USERS_UNLINKED = 'Do real people use it? Say yes, sign in once, and I check.';
/** L1i-3 (v6.1.16.1): the users question with the sign-in link in it, the reply's one sign-in sentence. Pure. */
export const usersUnlinkedAt = (link: string): string => `Do real people use it? Say yes, sign in once at ${link}, and I check.`;
/** L29-19 (v6.1.16 Task 15): one way to pass the users yes. */
export const USERS_NOTE = 'On yes, call find again with users: true.';
/** L29-27 (v6.1.16 Task 15): how a number skips, for the agent only. */
export const SKIP_NOTE = 'A number skips that program: call track skipped with its id.';

/** A closing's text and the kind of the `Say` it offers (L24-2, v6.1.16 Task 11), null when it offers none. */
export type Closing = { text: string; offer: OfferKind | null };

/**
 * The one action (v6.1.8, 1a): yes to the ready ones ("I draft ... for you to send" when the builder presses submit
 * on every one, C44); with none ready and remote steps shown "Nothing is ready yet." and the first rule-only gap's
 * "yes r", else the first step (M1, v6.1.9); with no remote step shown (or none of those to name) and in-person
 * programs listed, IN_PERSON_CLOSING (O2, fix round 1). No line asks its own yes (T3-R5). `inPerson`: the in-person
 * programs listed, ready or rule-only. v6.1.16 Task 11: the yes names what it covers whenever other blocks are listed
 * (`others`, L24-9: "to {title}", "to all {n} ready"); some ready the builder submits read "apply to {k} and draft {titles}
 * for you to send" (`drafts`, L24-10); the one ready program over the builder's limit reads "{title} is over your limit"
 * (`overLimit`, L24-28); a gap EarnKit can make is offered here, never on its line (`doOffer`, L24-8). The offer kind
 * goes with the text (L24-2). Pure.
 */
export function closingLine(o: {
  ready: number; draftOnly: boolean; gaps: number; firstRule: number | null; inPerson: number; held: number; firstStep?: FirstStep | null;
  yesStands?: string[]; draftStands?: string[]; yesWaits?: YesWait[]; stepRule?: number | null; title?: string;
  drafts?: string[]; applyTitle?: string; others?: boolean; overLimit?: boolean; doOffer?: { n: number; verb: string } | null;
  /** L29-17 (v6.1.16 Task 15): what the yes needs from the builder first, named in the Say. */
  yesNeeds?: string[];
  /** L29-34 (v6.1.16 Task 15): unlinked, the users question says the sign-in that checks it. */
  linked?: boolean;
  /** Task 11 fix round 1 (M1): ready programs the builder held; with none other ready, the reply closes on the hold. */
  onHold?: number;
  /** L35-8 (v6.1.17, fix round 1 I1): the default view hides ready rows; its And-more line says how many, and the yes
   *  says "ready" so it reads against the heading. */
  hidden?: boolean;
}): Closing {
  // v6.1.9: the builder's yes to a rule already stands for the program it made ready: no second yes is asked for it.
  // N3 (v6.1.12): nor for one that still needs answers: the closing names them instead. L1e-3 (v6.1.13): a program
  // the builder submits reads the same with the draft wording (`draftStands`, a wait's `draft`). L24-2 (v6.1.16): the
  // caller passes these only when the last offer was apply (`yesStands`).
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
    if (left > 0) return { text: `${said} ${closingLine({ ...o, ready: left, yesStands: [], draftStands: [], yesWaits: [] }).text}`, offer: 'apply' };
    // v6.1.16 Task 11 N2 (v6.1.17): every ready one is covered, so a gap EarnKit can make is still offered, last.
    return { text: o.doOffer ? `${said.replace(/\.$/, '')}, or "do ${o.doOffer.n}" and I ${o.doOffer.verb} first.` : said, offer: 'apply' };
  }
  const { ready, draftOnly } = o;
  const doPart = o.doOffer ? `"do ${o.doOffer.n}" and I ${o.doOffer.verb}` : null;
  if (ready >= 1) {
    const mixed = o.drafts ?? [];
    const k = ready - mixed.length;
    // L29-17 (v6.1.16 Task 15): "Say yes and tell me your email and the problem, and I apply to all 5."
    const say = o.yesNeeds && o.yesNeeds.length > 0 && mixed.length === 0 ? `Say yes and tell me ${listWords(o.yesNeeds)}, and` : 'Say yes and';
    // L16-11 (v6.1.16): one ready program is named; "all {n}" only for several, "ready" when other blocks are listed.
    const yes = draftOnly
      ? ready === 1 ? (o.others && o.title ? `${say} I draft ${o.title} for you to send` : `${say} I draft it for you to send`) : `${say} I draft all ${ready} for you to send`
      : mixed.length > 0 && k > 0
        ? `Say yes and I apply to ${k === 1 && o.applyTitle ? o.applyTitle : k} and draft ${listWords(mixed, mixed.length)} for you to send`
        : ready === 1
          ? o.overLimit && o.title ? `${o.title} is over your limit. ${say} I apply` : o.title ? `${say} I apply to ${o.title}` : `${say} I apply`
          : `${say} I apply to all ${ready}${o.others || o.hidden ? ' ready' : ''}`;
    // L29-27 (v6.1.16 Task 15): one action; a number skips through the agent note.
    if (doPart) return { text: `${yes}, or ${doPart} first.`, offer: 'apply' };
    return { text: `${yes}.`, offer: 'apply' };
  }
  const withDo = (c: Closing): Closing => (c.offer === null && doPart ? { text: `${c.text} Say ${doPart}.`, offer: 'do' } : c);
  // Ready programs held by another agent are listed as ready, so the reply never says nothing is ready (I1).
  // v6.1.14: no promise to write first.
  // Task 11 fix round 1 (M1): every ready program is on hold: the reply closes on lifting it.
  if (o.held === 0 && (o.onHold ?? 0) > 0) return { text: HOLD_CLOSING, offer: 'apply' };
  if (o.held > 0) return withDo({ text: 'Your other agent is handling these.', offer: null });
  if (o.gaps > 0) {
    // L29-28 (v6.1.16 Task 15): the rule Say says what the yes does.
    if (o.firstRule !== null) return { text: `Nothing is ready yet. ${ruleSay(o.firstRule)}`, offer: 'rule' };
    // I2 (v6.1.9 final): the only step program shown carries a rule beside its change: the rule is asked first.
    if (o.stepRule != null) return { text: `Nothing is ready yet. ${ruleSay(o.stepRule)}`, offer: 'rule' };
    const step = o.firstStep ?? null;
    // L29-34 (v6.1.16 Task 15): unlinked, the one ask holds the sign-in that checks it.
    if (step?.users && o.linked === false) return { text: `Nothing is ready yet. ${USERS_UNLINKED}`, offer: 'look_again' };
    if (step?.users) return { text: `Nothing is ready yet. Do real people use it? Say yes and ${step.more ? 'I look again' : 'I apply'}.`, offer: step.more ? 'look_again' : 'apply' };
    // I3 (v6.1.9 final): "First:" reads as a sentence for a noun or a verb phrase.
    // O3 (v6.1.10): the started question is asked as one.
    if (step && !step.users && step.started) return withDo({ text: `Nothing is ready yet. ${STARTED_CLOSING}`, offer: null });
    // L1g-5 (v6.1.16): one closing shape for every single step, the gap line names the gap.
    if (step && !step.users) return withDo({ text: `Nothing is ready yet. ${step.gap ? singleStepClosing(step.gap) : `Tell me when ${step.what} is done and I look again.`}`, offer: null });
    // A reply that lists in-person programs never ends on the bare line (O2, v6.1.10).
    return o.inPerson > 0 ? { text: IN_PERSON_CLOSING, offer: 'apply' } : withDo({ text: NOTHING_READY, offer: null });
  }
  if (o.inPerson > 0) return { text: IN_PERSON_CLOSING, offer: 'apply' };
  // v6.1.14: nothing is pushed to the builder, so nothing is promised.
  return withDo({ text: NOTHING_FITS, offer: null });
}

/** The required answers only the builder gives, still empty, as to-dos ("the problem"): `needs` past the setup steps. Pure. */
const emptyAnswers = (p: ReadyProgram): string[] => p.needs.filter((x) => !p.setup.includes(x));

/** Ready programs (not in person) with no click, no sign-in, within the standing approval, no claim held by an agent
 *  and not held by the builder (L24-4, v6.1.16 Task 11). Pure. */
export function sendableOf(r: Pick<R, 'ready' | 'blockers'>): ReadyProgram[] {
  const blocked = new Set(r.blockers.filter((b) => b.needs_click || b.sign_in || b.outside_approval).map((b) => b.program_id));
  return r.ready.filter((p) => !p.in_person && !blocked.has(p.program_id) && !p.claimed_since && !p.held);
}
/** Of those, the ones an agent can send alone: every required answer filled (v6.1.9 S6, fix round 1). Pure. */
const agentCanApply = (r: Pick<R, 'ready' | 'blockers'>): ReadyProgram[] => sendableOf(r).filter((p) => emptyAnswers(p).length === 0);

/** With standing approval: "your problem for A; ..." (L23-1; L29-18, v6.1.16 Task 15: a clause of "Before applying:")
 *  for the sendable programs that wait on a required answer, grouped by the same answers; null when none waits. Pure. */
function waitingClauses(r: R, said: string[] = []): string | null {
  if (!r.auto_apply) return null;
  // Fix round 1 (M1): what the Say asks for is said there only.
  const named = (x: string) => namedBefore(r)(x) || said.some((n) => sameNeed(n, x));
  const groups = new Map<string, string[]>();
  for (const p of sendableOf(r)) {
    // F5 (v6.1.12): the email the Before block names is not named again.
    const answers = emptyAnswers(p).filter((x) => !named(x));
    if (answers.length === 0) continue;
    const words = `your ${listWords(answers.map(bare))}`;
    groups.set(words, [...(groups.get(words) ?? []), p.title]);
  }
  if (groups.size === 0) return null;
  return [...groups].map(([w, t]) => `${w} for ${listWords(t, t.length)}`).join('; ');
}

/** The closing when the sends under standing approval in the last 24 hours already reached max_per_night (v6.1.9 N1;
 *  L23-1 v6.1.16: the 24 hours the server keeps, not a night). */
export const LIMIT_USED = 'Your daily limit is used; the next sends wait until 24 hours have passed.';

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

/** The one sentence for each thing the builder is told about the repo read (v6.1.8, B20 and C59); a repo link not read gets exactly one of the first four. */
export const REPO_NOTE: Record<RepoNote, string> = {
  /** L26-8 (v6.1.16 Task 12): the read passed its time budget. */
  slow: 'GitHub was slow; matched on what you told me. I read it again next time.',
  paused: 'Repo reads are paused until tomorrow; matched on what you told me.',
  private: 'Private repo: matched on what you told me.',
  other_host: 'I read GitHub repos only; matched on what you told me.',
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

/**
 * L24-11, L24-4 (v6.1.16 Task 11, ruling 10): the standing-approval closing, the one standing-approval line of the reply
 * (L24-26); no time is promised (L23-1). Ready programs outside the approval (`also`) take the yes; else the builder can
 * hold them. Pure.
 */
export const standingLine = (titles: string[], also: string[] = []): string =>
  `Applying now to ${listWords(titles, titles.length)} under your standing approval. ${also.length > 0 ? `Say yes and I also apply to ${listWords(also, also.length)}.` : 'Say stop and I hold any of them.'}`;

/**
 * One `Say` per reply (L23-21, v6.1.16): when a reply would carry more than one, only the first of these keeps its `Say`
 * sentence; the others keep their fact sentence and drop the `Say` one: (1) the not-sent-since-yes line, (2) the
 * started-not-sent line, (3) the record sign-in line, (4) the closing.
 */
export const ONE_SAY_ORDER = ['not_sent', 'started_not_sent', 'record_sign_in', 'closing'] as const;
/** A sentence that asks the builder to say something ("Say yes ...", "Or say the numbers ..."). */
const SAY_SENTENCE = /^(Or )?[Ss]ay\b/;
/** Whether a line carries a `Say` sentence. Pure. */
export const carriesSay = (line: string): boolean => line.split(/(?<=[.?!])\s+/).some((x) => SAY_SENTENCE.test(x));
/** The line without its `Say` sentences (ONE_SAY_ORDER), '' when nothing else is left. Pure. */
export const withoutSay = (line: string): string => line.split(/(?<=[.?!])\s+/).filter((x) => !SAY_SENTENCE.test(x)).join(' ');
/** A keeper of ONE_SAY_ORDER: the first line through it that carries a `Say` keeps it, every later one drops it. Pure. */
export function oneSay(): (line: string) => string {
  let said = false;
  return (line) => {
    if (!carriesSay(line)) return line;
    if (said) return withoutSay(line);
    said = true;
    return line;
  };
}

/** L23-1 (v6.1.16): a day after a yes with no send recorded, said once, first. Null when none. Pure. */
export function notSentLine(r: Pick<R, 'not_sent'>, now: Date): string | null {
  const n = r.not_sent;
  if (!n || n.programs.length === 0) return null;
  return `Nothing was sent for ${listWords(n.programs.map((p) => p.title), n.programs.length)} since you said yes on ${dayWords(new Date(n.since), now)}. Say yes again and I apply now.`;
}

/** L23-7 (v6.1.16): at most this many started-not-sent lines, the rest counted. */
const RELEASED_SHOWN = 3;
/** L23-7 (v6.1.16): a claim left unsent for 24 hours, one line per program (at most three, the rest counted). Pure. */
export function startedNotSentLines(r: Pick<R, 'released'>, now: Date): string[] {
  const shown = r.released.slice(0, RELEASED_SHOWN).map((p) => `${p.title}: started ${dayWords(new Date(p.started_at), now)}, nothing sent. Say yes to apply or say skip.`);
  const rest = r.released.length - shown.length;
  return rest > 0 ? [...shown, `And ${rest} more started, nothing sent.`] : shown;
}

/** L23-4 (v6.1.16): the results question for each program past its results date, shown once a day per installation. Pure. */
export const outcomeLines = (r: Pick<R, 'ask_outcome'>, now: Date): string[] =>
  r.ask_outcome.map((a) => `Results for ${a.title} were due ${dayWords(new Date(a.due_at), now)}. Did you hear back?`);

/** What the builder sees. The since line never shows on the first find; `now` reads the claim times. `lastOffer`: the
 *  kind of the last `Say` this installation showed (L24-2, v6.1.16 Task 11); "Your yes stands" only after apply. */
export function replyText(r: R, first: boolean, now: Date = new Date(), lastOffer: OfferKind | null = null, o: ReplyOptions = {}): string {
  return replyParts(r, first, now, lastOffer, o).text;
}

/** L29-26 (v6.1.16 Task 15): the most lines the default find's builder text holds, its one Say included. */
export const DEFAULT_LINES = 10;
/** L29-26: the most ready lines the default view shows; the heading keeps the whole count. */
const READY_SHOWN = 3;

/**
 * The builder text, the kind of the one `Say` it offers (L24-2) and (L29-26) the lines the default view left out.
 * L1i-2 (v6.1.16.1): `shown`, the program ids the builder text numbers, in that order (1, 2, 3 ...); `say`, its Say line.
 */
export type ReplyParts = Closing & { hidden: string[]; shown: string[]; say: string; more: number };
/** L18-1 (v6.1.18): a program closing this week that the default view leaves out; `closes_in` as find words it. */
export type ClosingHidden = { program_id: string; title: string; closes_at: string; closes_in?: string | null };
/**
 * `all`: the full view. `asShown` (L1i-2): the numbers are already the shown ones, so the default view is not
 * renumbered. `defaultSay` (L1i-5): the default view's Say, which the full view closes on.
 */
export type ReplyOptions = {
  all?: boolean; asShown?: boolean; defaultSay?: string; closes?: Map<string, string>;
  /** L18-1 (v6.1.18): the rows the rank cap left out of the default view, and those of them closing within 7 days. */
  hidden?: { count: number; closing: ClosingHidden[] };
};

/** Fix round 1 (I1): a line that carries a link. */
const LINK = /https?:\/\/\S+/;

/** L18-1 (v6.1.18): how many named on the more line at most. */
const CLOSING_NAMED = 2;
/** L18-1: a closing program's words on the more line: "3 days", "tomorrow", "today", "under an hour". Pure. */
const closingWords = (c: ClosingHidden, now: Date): string =>
  (c.closes_in ?? closesWords(c.closes_at, now, 'UTC').replace(/^closes /, '')).replace(/^in /, '');
/**
 * L1i-2 (v6.1.16.1): the line under a block whose rows the default view leaves out. L18-1 (v6.1.18): it names at most
 * two of those closing this week, in closing order. Pure.
 */
export const moreInFull = (n: number, closing: ClosingHidden[] = [], now: Date = new Date()): string => {
  const named = [...closing].sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at)).slice(0, CLOSING_NAMED);
  if (named.length === 0) return `And ${n} more in the full list.`;
  return `And ${n} more in the full list; closing this week: ${named.map((c) => `${c.title} (${closingWords(c, now)})`).join(' and ')}.`;
};

/**
 * L1j-3 (v6.1.17): what the default view shows and hides of the ready rows (every ready program, in person and held
 * ones too) and of the step rows, from the ids it numbers (`shown`).
 * `And {readyHidden + stepHidden} more in the full list.` follows when either is non-zero. Pure.
 */
export function defaultRows(ready: string[], steps: string[], shown: string[]): { readyShown: number; readyHidden: number; stepShown: number; stepHidden: number } {
  const on = new Set(shown);
  const readyShown = ready.filter((id) => on.has(id)).length;
  const stepShown = steps.filter((id) => on.has(id)).length;
  return { readyShown, readyHidden: ready.length - readyShown, stepShown, stepHidden: steps.length - stepShown };
}

/** L35-8 (v6.1.17): within a day of closing. Pure. */
const closesWithinDay = (p: Pick<ReadyProgram, 'closes_at'>, now: Date): boolean => {
  const left = p.closes_at ? Date.parse(p.closes_at) - now.getTime() : NaN;
  return left > 0 && left <= 86_400_000;
};
/** L35-8 (v6.1.17): the ready rows with those closing within a day first, soonest first; the rest in their order. Pure. */
export const soonFirst = <P extends Pick<ReadyProgram, 'closes_at'>>(ps: P[], now: Date): P[] => [
  ...ps.filter((p) => closesWithinDay(p, now)).sort((a, b) => Date.parse(a.closes_at!) - Date.parse(b.closes_at!)),
  ...ps.filter((p) => !closesWithinDay(p, now)),
];

/** L1i-2: a numbered block of the default view: its heading (the true count), its rows in order, at most `cap` shown.
 *  L1j-3 (v6.1.17): the rows any block leaves out are counted once, on the line before the Say (`defaultRows`). */
type Block = { head: string; ids: string[]; line: (i: number) => string; order?: number[]; cap?: number };
/** Lines a block takes at most. Pure. */
const blockMax = (b: Block): number => (b.ids.length === 0 ? 0 : 1 + Math.min(b.ids.length, b.cap ?? b.ids.length));
/** How many rows a block shows in `k` lines: all it may when they fit, else as many as fit under its heading. Pure. */
const blockRows = (b: Block, k: number): number => {
  const n = b.ids.length;
  if (n === 0 || k < 2) return 0;
  return Math.min(n, b.cap ?? n, k - 1);
};
/** The lines a block uses for `rows` shown rows. Pure. */
const blockUses = (rows: number): number => (rows === 0 ? 0 : 1 + rows);

/**
 * The builder text and the kind of the one `Say` it offers (L24-2, v6.1.16 Task 11), for find to keep. L29-26 (v6.1.16
 * Task 15): the default view (`defaultView`) is at most DEFAULT_LINES lines, the Say last; `all` (filter.all, "say
 * more") is the full view (`fullView`): names and money only, one per line. Pure.
 */
export function replyParts(r: R, first: boolean, now: Date = new Date(), lastOffer: OfferKind | null = null, o: ReplyOptions = {}): ReplyParts {
  // L1i-2 (v6.1.16.1): the default view numbers its rows 1, 2, 3 as shown; the Say's numbers are those. The rows are
  // laid out once, renumbered as shown (the rest after them), and the reply written from those numbers.
  if (!o.all && !o.asShown) {
    const laid = replyParts(r, first, now, lastOffer, { ...o, asShown: true });
    const every = [...r.ready, ...r.gaps].sort((a, b) => a.n - b.n).map((x) => x.program_id);
    const order = [...laid.shown, ...every.filter((id) => !laid.shown.includes(id))];
    const at = new Map(order.map((id, i) => [id, i + 1]));
    if (order.every((id, i) => [...r.ready, ...r.gaps].find((x) => x.program_id === id)!.n === i + 1)) return laid;
    const renum = <X extends { program_id: string; n: number }>(x: X): X => ({ ...x, n: at.get(x.program_id)! });
    return replyParts({ ...r, ready: r.ready.map(renum), gaps: r.gaps.map(renum) }, first, now, lastOffer, { ...o, asShown: true });
  }
  const ready = r.ready.filter((p) => !p.in_person);
  const inPerson = r.ready.filter((p) => p.in_person);
  // O2 (v6.1.10): a rule-only in-person program is in the In person block, after the ready ones.
  const steps = r.gaps.filter((g) => !attendRuleGap(g));
  const attendRules = r.gaps.filter(attendRuleGap);
  const attendCount = inPerson.length + attendRules.length;
  const heldInPerson = inPerson.filter((p) => p.claimed_since).length;
  // A program another agent holds leaves the count to say yes to (v6.1.7, C37); so does one the builder held (L24-4).
  // L35-8 (v6.1.17): one closing within a day is shown first.
  const free = soonFirst(ready.filter((p) => !p.claimed_since && !p.held), now);
  const onHold = ready.filter((p) => !p.claimed_since && p.held);
  const heldReady = ready.filter((p) => p.claimed_since);
  // With nothing ready to say yes to, the closing names a rule-only gap (1a): a keyword hit when one is listed (L1e-5,
  // v6.1.13: its words make the rule likely), else the first in list order.
  // L1g-8b (v6.1.16): a program not ready for this repo (`public_first`) never lends its rule; an unlikely one (full
  // list) only when no step is shown to close on.
  // A `public_first` program holds the public repo gap, so it is never rule-only: `stepRuleOf` is its guard.
  const firstStep = firstStepOf(steps);
  const askable = steps.filter((g) => ruleOnlyGap(g) && !(g.unlikely && firstStep !== null));
  const firstRule = (askable.find((g) => g.keyword_hit) ?? askable[0])?.n ?? null;
  const named = namedBefore(r);
  // One condition for the heading and the closing: the agent sends tonight (never unlinked, where auto_apply is false).
  const { list: tonightList, limitUsed } = tonightIn(r);
  const tonight = tonightList.length;
  const click = new Set(r.blockers.filter((b) => b.needs_click).map((b) => b.program_id));
  // The builder's yes stands for these (a rule or the users question): never asked again. L1e-3 (v6.1.13): a program
  // the builder submits too, its closing in the draft wording. L24-2 (v6.1.16 Task 11): only when the last offer this
  // installation showed was apply; after a question the apply offer is made afresh.
  const yesd = yesStands(lastOffer) ? free.filter((p) => p.rule_yes && !r.blockers.some((b) => b.program_id === p.program_id && b.sign_in)) : [];
  // C44: the builder presses submit on every ready one left to say yes to (their policy, or each program's own), so
  // the agent drafts.
  const unsaid = free.filter((p) => !yesd.includes(p));
  const draftOnly = unsaid.length > 0 && unsaid.every((p) => click.has(p.program_id));
  // Fix round 1 (v6.1.10): the yes stands only for a program fully ready, every required answer held (nothing in need you).
  const stands = yesd.filter((p) => p.need_you.length === 0);
  const waits = yesd.filter((p) => p.need_you.length > 0);
  // L24-11 (v6.1.16 Task 11): ready programs outside the standing approval take the standing line's yes.
  const outsideIds = new Set(r.blockers.filter((b) => b.outside_approval && !b.needs_click).map((b) => b.program_id));
  const also = free.filter((p) => outsideIds.has(p.program_id) && !tonightList.some((t) => t.program_id === p.program_id)).map((p) => p.title);
  // L24-10: some ready ones the builder submits: apply to the rest and draft those.
  const clicked = unsaid.filter((p) => click.has(p.program_id));
  const mixed = clicked.length > 0 && clicked.length < unsaid.length;
  const applyOnes = unsaid.filter((p) => !click.has(p.program_id));
  // L29-17 (v6.1.16 Task 15, fix round 1 M1: over F5): a yes that needs more from the builder names it in the Say,
  // so the ready lines and the Before line leave it out (the email still said once).
  const yesNeeds = tonight > 0 || mixed ? [] : [...new Set(unsaid.flatMap((p) => p.need_you))];
  // Review Focus 1 (v6.1.14): a program whose needs the closing names reads them there only (not on tonight's send).
  const namedInClosing = new Set(tonight > 0 ? [] : [...waits.map((p) => p.program_id), ...(yesNeeds.length > 0 ? unsaid.map((p) => p.program_id) : [])]);
  // L24-28: the one ready program, over the builder's limit.
  const overLimit = r.auto_apply && unsaid.length === 1 && r.blockers.some((b) => b.program_id === unsaid[0].program_id && b.outside_approval && b.over_limit_usd !== undefined);
  const stepRule = stepRuleOf(steps);
  const doOffer = doOfferOf(steps as (GapProgram & { n: number })[]);
  // L35-8 (v6.1.17, fix round 1 I1): the default view shows at most READY_SHOWN ready rows; the And-more line counts the
  // rest once, and the yes says "ready".
  const readyHidden = !o.all && free.length > READY_SHOWN;
  const closingOf: Closing =
    tonight > 0
      // L23-1 (v6.1.16): nothing runs at night; the agent applies the next time it checks.
      ? { text: standingLine(tonightList.map((p) => p.title), also), offer: also.length > 0 ? 'apply' : 'stop' }
      : (() => {
          const c = closingLine({
            // Fix round 1 (I2): an in-person program held for another project is listed, never a yes.
            ready: free.length, draftOnly, gaps: steps.length, firstRule, inPerson: attendCount - heldInPerson, held: ready.length - free.length - onHold.length + heldInPerson, firstStep, stepRule,
            // L16-11 (v6.1.16): the one ready program left to say yes to, by name.
            ...(unsaid.length === 1 ? { title: unsaid[0].title } : {}),
            yesStands: stands.filter((p) => !click.has(p.program_id)).map((p) => p.title),
            draftStands: stands.filter((p) => click.has(p.program_id)).map((p) => p.title),
            // N3 (v6.1.12): one that still needs answers names them (the email once, F5), never a second yes.
            yesWaits: waits.map((p) => {
              const own = p.need_you.filter((x) => !named(x));
              return { title: p.title, needs: own.length > 0 ? own : p.need_you, ...(click.has(p.program_id) ? { draft: true as const } : {}) };
            }),
            // L24-8 to L24-10, L24-28 (v6.1.16 Task 11).
            others: steps.length > 0 || attendCount > 0 || heldReady.length > 0 || onHold.length > 0,
            ...(mixed ? { drafts: clicked.map((p) => p.title), ...(applyOnes.length === 1 ? { applyTitle: applyOnes[0].title } : {}) } : {}),
            ...(overLimit ? { overLimit: true } : {}),
            doOffer,
            yesNeeds,
            linked: r.linked,
            onHold: onHold.length,
            ...(readyHidden ? { hidden: true } : {}),
          });
          // N1 (v6.1.9, fix round 1): the used limit takes the tonight list's place; the builder can still say yes.
          return { text: [...(limitUsed ? [LIMIT_USED] : []), c.text].join(' '), offer: c.offer };
        })();
  // R5a: unlinked with a link, signing in is its own line before the Say. The first find after a link names the
  // account it linked to (security M2); after an unlink the notice carries the sign-in link itself, so the sign-in
  // sentence is left out (v6.1.7 B10). An empty repo was read but gave nothing to prove: the sign-in promises only to
  // remember (C59). Fix round 1 (v6.1.14, F2): with a proof gap shown and no link to give, the sign-in is still said.
  // L1g-5 (v6.1.16): a shown line that reads the archive says it, so the archived note is left out.
  const archivedShown = r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.item === 'repo:archived'));
  const notes = [...new Set(r.repo_notes ?? [])].filter((n) => !(n === 'archived' && archivedShown));
  const read = !r.as_reported && !notes.includes('empty');
  const proof = showsProof(r.gaps) ? (proofBarOf(r.gaps.flatMap((g) => [g.gap, ...g.also])) ?? true) : false;
  // L1i-3 (v6.1.16.1): one sign-in sentence per reply. When the closing's Say already asks to sign in (the unlinked
  // users question), the link goes into it and (L1j-1, v6.1.17) no other line mentions signing in.
  // Fix round 1 (I2): judged on the Say the reply ends on; the full view ends on the default view's.
  const endsOn = o.all && o.defaultSay !== undefined ? o.defaultSay : closingOf.text;
  const asksSignIn = !r.linked && /Do real people use it\? Say yes, sign in once\b/.test(endsOn);
  // Task 2 (v6.1.16.1, Task 1 leftover): with the unlinked notice too, the closing still carries the link and the
  // notice keeps only its first sentence, so the reply has one sign-in sentence.
  if (asksSignIn && r.sign_in) closingOf.text = closingOf.text.replace(USERS_UNLINKED, usersUnlinkedAt(r.sign_in));
  const notice = asksSignIn && r.sign_in && r.linked_notice ? r.linked_notice.replace(/ Sign in once at \S+ to link it again\.$/, '') : r.linked_notice;
  const signIn = r.linked || asksSignIn
    ? null
    : r.sign_in
        ? (r.linked_notice ? null : signInSentence(r.sign_in, read, proof))
        : proof ? signInSentence(null, read, true) : null;

  // ONE_SAY_ORDER (L23-21): the first line through it that carries a Say keeps it, and (L29-33, v6.1.16 Task 15) goes
  // last; every other line keeps its fact sentence only.
  const notSent = notSentLine(r, now);
  // v6.1.16 Task 9 N4 (v6.1.17): a program the not-sent line names gets no started line too.
  const notSentIds = new Set((r.not_sent?.programs ?? []).map((p) => p.program_id));
  const started = startedNotSentLines({ released: r.released.filter((p) => !notSentIds.has(p.program_id)) }, now);
  const sayers = [notSent, ...started, closingOf.text].filter((x): x is string => x !== null);
  const sayLine = sayers.find(carriesSay) ?? closingOf.text;
  const early = sayLine !== closingOf.text;
  const plain = (x: string | null) => (x === null || x === sayLine ? null : carriesSay(x) ? withoutSay(x) || null : x);
  const offer = early ? 'apply' : closingOf.offer;

  const after = [...(notes.length > 0 ? [repoNoteText(notes)] : []), ...(signIn ? [signIn] : []), ...(notice ? [notice] : [])];
  // L1i-5 (v6.1.16.1): the full view closes on the default view's Say, never on a rule it does not show.
  // L35-9 (v6.1.17): in blocks under the default view's headings, each with its true count.
  if (o.all) {
    const say = fullSay(o.defaultSay ?? sayLine);
    const blocks: [string, (ReadyProgram | GapProgram)[]][] = [
      ['Ready to apply', free], ['Being handled by your other agent', heldReady], ['On hold until you say go', onHold],
      ['One step away', steps], [IN_PERSON_HEAD, [...inPerson, ...attendRules]],
    ];
    // L1k-2 (v6.1.18): `shown` is the full view's rows in display order, which find numbers 1..N.
    const shown = blocks.flatMap(([, ps]) => [...ps].sort((a, b) => a.n - b.n).map((p) => p.program_id));
    return { text: fullView(blocks, after, say, o.closes), offer, hidden: [], shown, say, more: 0 };
  }

  // L29-26 (v6.1.16 Task 15): the default view: the slots in display order, each with its priority (lower stays first
  // when lines must go). The ready slot is the first non-empty of: ready, held by another agent, on hold, in person.
  const readyLines = (ps: ReadyProgram[], strip = false) => ps.map((p) => readyLine(strip ? { ...p, claimed_since: undefined } : p, r.linked, now, false, named, namedInClosing.has(p.program_id)));
  const inPersonLines = [...inPerson.map((p) => inPersonLine(p, false, now)), ...attendRules.map((g) => gapLine(g))];
  const readyOf = (head: string, ps: ReadyProgram[], strip = false): Block => {
    const lines = readyLines(ps, strip);
    return { head, ids: ps.map((p) => p.program_id), line: (i) => lines[i], cap: READY_SHOWN };
  };
  const readyBlock: Block | null = free.length > 0 ? readyOf(`Ready to apply (${free.length}):`, free)
    : heldReady.length > 0 ? readyOf(`Being handled by your other agent (${heldReady.length}):`, heldReady, true)
    : onHold.length > 0 ? readyOf(`On hold until you say go (${onHold.length}):`, onHold)
    : null;
  // With nothing else ready, the in-person block takes the ready slot, after the step the closing names.
  const attendBlock: Block | null = !readyBlock && attendCount > 0
    ? { head: `In person (${attendCount}):`, ids: [...inPerson, ...attendRules].map((x) => x.program_id), line: (i) => inPersonLines[i], cap: READY_SHOWN }
    : null;
  // L1h-8 (v6.1.16 Task 15): the gap line the closing speaks to (its do offer, its rule, its step), else the first; a
  // step the closing names is said there only (`closingSetup`).
  const closed = tonight > 0 ? null : closingSetup({ ready: free.length, held: ready.length - free.length + heldInPerson, gaps: steps.length, firstRule, stepRule, firstStep });
  const target = free.length > 0 ? doOffer?.n : (firstRule ?? stepRule ?? undefined);
  const gapShown = steps.find((g) => g.n === target) ?? steps.find((g) => g.program_id === firstStep?.program_id)
    ?? steps.find((g) => g.n === doOffer?.n) ?? steps[0];
  // L1i-2 (v6.1.16.1): every step row the budget allows, the one the closing speaks to first; the heading keeps the
  // true count and a more line says what is left for the full list.
  const stepLines = steps.map((g) => gapLine(g, false, closed));
  const gapBlock: Block | null = steps.length > 0
    ? { head: `One step away (${steps.length}):`, ids: steps.map((g) => g.program_id), line: (i) => stepLines[i], order: [steps.indexOf(gapShown), ...steps.map((_, i) => i).filter((i) => steps[i] !== gapShown)] }
    : null;
  const l = r.ledger;
  // L1j-6 (v6.1.17): a closing that is only "Nothing is ready yet." asks nothing, so the sign-in after it is the action.
  const bare = sayLine === NOTHING_READY;
  const tail = bare ? [signIn, notice].filter((x): x is string => !!x) : [];
  // L29-1 (v6.1.16 Task 15): the applications by name; the counts and totals are /me's and the JSON's.
  const apps = applicationsLine(r.applications ?? [], now);
  const since = first ? null : sinceLine(r, now);
  // L23-16 (v6.1.16): the same list as the last find, and nothing else moved. L35-21 (v6.1.17): the same day reads "your
  // last look", never today's date.
  const lastLook = r.nothing_new_since ? new Date(r.nothing_new_since) : null;
  const nothingNew = !first && !since && lastLook
    ? (dayWords(lastLook, now) === dayWords(now, now) && now.getTime() - lastLook.getTime() < 86_400_000 ? 'Nothing new since your last look.' : `Nothing new since ${dayWords(lastLook, now)}.`)
    : null;
  const before = beforeLine(r, waitingClauses(r, yesNeeds), yesNeeds);
  const slots: Slot[] = [
    { block: readyBlock, lines: [], rank: 1 },
    // L1i-2: one step row (and its more line) right after the ready rows; the rest of the rows before the repo notes
    // and the sign-in.
    // Fix round 1 (I1): when lines are short, the since line gives way first, then the results question, then these.
    { block: gapBlock, lines: [], rank: 2, min: 2, grow: 5.7 },
    { block: attendBlock, lines: [], rank: 2 },
    { lines: apps ? [apps] : [], rank: 3 },
    { lines: [plain(notSent)].filter((x): x is string => !!x), rank: 4 },
    { lines: started.map(plain).filter((x): x is string => !!x), rank: 5 },
    { lines: [since ?? nothingNew].filter((x): x is string => !!x), rank: 6 },
    // L1i-2 (v6.1.16.1): the results question is asked once a day, so it stays ahead of what moved since.
    { lines: outcomeLines(r, now), rank: 5.8 },
    // What was sent under standing approval meanwhile is the applications' news: kept beside Task 9's lines.
    // Fix round 1 (I1): ahead of the step rows past the first, as the Before line.
    { lines: reportLines(r), rank: 5.5 },
    // L1i-2 (v6.1.16.1): what a send waits on stays ahead of the step rows past the first.
    // v6.1.17: its rank now matches that comment (5.55, ahead of the step rows' 5.7).
    { lines: before ? [before] : [], rank: 5.55 },
    { lines: r.evidence_summary ? [r.evidence_summary.line] : [], rank: 13 },
    { lines: (l.results_soon ?? []).length > 0 ? [`Results due soon: ${listWords(l.results_soon!.map((x) => x.title), l.results_soon!.length)}.`] : [], rank: 14 },
    { lines: notes.length > 0 ? [repoNoteText(notes)] : [], rank: 8 },
    // L29-33: before the Say.
    // L1i-3 (v6.1.16.1): the reply's one sign-in carries the link (or settles a proof gap), so it stays ahead of the
    // step rows past the first.
    // Fix round 1 (I1): the line carrying the reply's only link outranks every line but the Say; a linkless sign-in
    // still stays ahead of the step rows past the first.
    // L1j-6 (v6.1.17): the action is always last, so these sit before it whether or not it carries a Say; after a bare
    // "Nothing is ready yet." the sign-in is the action, so it follows (`tail`).
    { lines: signIn && !bare ? [signIn] : [], rank: signIn && LINK.test(signIn) ? 0 : 5.65 },
    // v6.1.17: the account notice is said once, so it stays ahead of the step rows past the first too.
    { lines: notice && !bare ? [notice] : [], rank: notice && LINK.test(notice) ? 0 : 5.6 },
    // The closing's fact sentence when another line keeps the Say ("Nothing is ready yet.").
    { lines: [plain(closingOf.text)].filter((x): x is string => !!x), rank: 15 },
  ];
  // Every other block the full view lists, for the agent: the other ready blocks and, without a ready block, the
  // in-person lines.
  const rest = [
    ...(free.length > 0 && heldReady.length > 0 ? readyLines(heldReady, true) : []),
    ...((free.length > 0 || heldReady.length > 0) && onHold.length > 0 ? readyLines(onHold) : []),
    ...(attendBlock ? [] : inPersonLines),
  ];
  // L1j-3 (v6.1.17): any ready or step row left out is counted on one line before the Say; it takes a line of its own.
  const readyIds = r.ready.map((p) => p.program_id);
  const stepIds = r.gaps.map((g) => g.program_id);
  const hiddenOf = (sh: string[]) => {
    const d = defaultRows(readyIds, stepIds, sh);
    return d.readyHidden + d.stepHidden;
  };
  // L18-1 (v6.1.18): the rows the rank cap left out are added once, and the line names those closing this week that the
  // default view does not show.
  const capHidden = Math.max(0, o.hidden?.count ?? 0);
  const room = DEFAULT_LINES - 1 - tail.length;
  const once = fit(slots, room);
  const { kept, hidden, shown, rows } = hiddenOf(once.shown) + capHidden > 0 ? fit(slots, room - 1) : once;
  const left = hiddenOf(shown) + capHidden;
  // Task 7 (v6.1.18): by id, never by title (two programs may share one); `moreInFull` names two of what is left.
  const closingHidden = (o.hidden?.closing ?? []).filter((c) => !shown.includes(c.program_id));
  // L1k-5 (v6.1.18): the more line follows the numbered blocks directly, ahead of the repo note and the rest.
  const moreLine = left > 0 ? [moreInFull(left, closingHidden, now)] : [];
  return { text: [...kept.slice(0, rows), ...moreLine, ...kept.slice(rows), sayLine, ...tail].join('\n'), offer, hidden: [...rest, ...hidden], shown, say: sayLine, more: left };
}

/** L29-26: a slot of the default view: plain lines, or (L1i-2) a numbered block, with its rank and, for the step block,
 *  the lines it takes at its rank (`min`) and the rank at which it takes the rest (`grow`). */
type Slot = { lines: string[]; rank: number; block?: Block | null; min?: number; grow?: number };

/**
 * L29-26: the slots that fit `room` lines, by rank (a slot cut to what is left), in display order; the rest. L1i-2
 * (v6.1.16.1): a block shows whole rows under its heading, numbered 1, 2, 3 in display order across the blocks; `shown`
 * is the ids those numbers name. Pure.
 */
function fit(slots: Slot[], room: number): { kept: string[]; hidden: string[]; shown: string[]; rows: number } {
  const take = new Map<number, number>();
  let left = room;
  const steps = slots.flatMap((s, i) => [{ i, rank: s.rank, grow: false }, ...(s.grow !== undefined ? [{ i, rank: s.grow, grow: true }] : [])]);
  for (const { i, grow } of steps.sort((a, b) => a.rank - b.rank)) {
    const s = slots[i];
    const had = take.get(i) ?? 0;
    if (s.block !== undefined) {
      const b = s.block;
      if (!b) continue;
      const want = grow ? blockMax(b) : Math.min(s.min ?? blockMax(b), blockMax(b));
      const rows = blockRows(b, Math.min(want, had + left));
      const uses = blockUses(rows);
      if (uses < had) continue;
      take.set(i, uses);
      left -= uses - had;
      continue;
    }
    const n = Math.min(s.lines.length, left);
    // A heading alone says nothing: a block keeps its heading only with a line under it.
    const k = n === 1 && s.lines.length > 1 && /:$/.test(s.lines[0]) ? 0 : n;
    take.set(i, k);
    left -= k;
  }
  const kept: string[] = [];
  const hidden: string[] = [];
  const shown: string[] = [];
  // L1k-5 (v6.1.18): where the numbered blocks' lines end (just past the last block line kept).
  let rows = 0;
  slots.forEach((s, i) => {
    const k = take.get(i) ?? 0;
    if (s.block !== undefined) {
      const b = s.block;
      if (!b) return;
      const order = b.order ?? b.ids.map((_, j) => j);
      const n = blockRows(b, k);
      const on = new Set(order.slice(0, n));
      const idx = b.ids.map((_, j) => j);
      if (n > 0) {
        kept.push(b.head, ...idx.filter((j) => on.has(j)).map((j) => b.line(j)));
        shown.push(...idx.filter((j) => on.has(j)).map((j) => b.ids[j]));
        rows = kept.length;
      }
      hidden.push(...idx.filter((j) => !on.has(j)).map((j) => b.line(j)));
      return;
    }
    kept.push(...s.lines.slice(0, k));
    hidden.push(...s.lines.slice(k).filter((x) => !/:$/.test(x)));
  });
  return { kept, hidden, shown, rows: shown.length > 0 ? rows : kept.length };
}

/** The full view's in-person block heading (without its count). */
const IN_PERSON_HEAD = 'In person';

/** L1i-5 (v6.1.16.1): the full view's Say: the default view's, unless that asks about a rule the full view does not
 *  show; then the agent shows that program's rules on its number. Pure. */
export const FULL_RULE_SAY = 'Say a number and I show what that program asks.';
const fullSay = (say: string): string => {
  const fact = withoutSay(say);
  return /Say "yes \d+" if that rule fits you/.test(say) ? [fact, FULL_RULE_SAY].filter(Boolean).join(' ') : say;
};

/**
 * L29-26 (v6.1.16 Task 15): the full view ("say more", filter.all): each listed program as its number, name, money and
 * (L1i-6, v6.1.16.1) close and, outside the In person block (L1k-3, v6.1.18), in person, one per line, then what the repo read was and the link notice (`after`), then
 * the Say. No rule is asked here (L1i-5). L35-9 (v6.1.17): the rows sit under the default view's block headings
 * (`Ready to apply (6):`), each with its true count, in number order within a block; an empty block is left out. Pure.
 */
export function fullView(blocks: [string, (ReadyProgram | GapProgram)[]][], after: string[], say: string, closes?: Map<string, string>): string {
  // L1k-3 (v6.1.18): a row under the In person heading leaves out ", in person"; the heading says it.
  const line = (p: ReadyProgram | GapProgram, underInPerson: boolean) => {
    const when = closes?.get(p.program_id) || p.closes_in;
    return `${p.n}. ${p.title}, ${p.money}${when ? `, closes ${when}` : ''}${p.in_person && !underInPerson ? ', in person' : ''}.`;
  };
  const rows = blocks.filter(([, ps]) => ps.length > 0).flatMap(([head, ps]) => [`${head} (${ps.length}):`, ...[...ps].sort((a, b) => a.n - b.n).map((p) => line(p, head === IN_PERSON_HEAD))]);
  return [...rows, ...after, say].join('\n');
}

/** Fix round 1 (N6, v6.1.16 Task 15): an item that says itself what was not read (L29-13, L29-14; L1j-5, v6.1.17:
 *  "project.bogus was not read") is its own sentence. */
const OWN_SENTENCE = / was not read(: |$)| belongs inside project$/;
/** The agent's line for arguments find or track could not read (L13-4, v6.1.14), or ''. v6.1.16 Task 15 N6 (v6.1.17):
 *  the outer "Some arguments were not read:" only for the items that do not say it themselves. Pure. */
export const unreadNote = (unread: string[]): string => {
  const own = unread.filter((u) => OWN_SENTENCE.test(u));
  const rest = unread.filter((u) => !OWN_SENTENCE.test(u));
  return [...(rest.length > 0 ? [`Some arguments were not read: ${rest.join('; ')}.`] : []), ...own.map((u) => `${u}.`)].join(' ');
};

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
/** The agent note's standing-approval rule, on the list reply and (L24-13, v6.1.16 Task 11) the one-program reply. */
/** L29-6 (v6.1.16 Task 15): it names the programs it covers and says only these. Pure. */
export const standingNote = (ids: string[]): string =>
  `Standing approval is on for only these: ${ids.join(', ')}. For each, call track started, fill from fields, submit where the program allows an agent, then track applied with submitted_by agent and fields_used (the field keys). Every other ready program waits for the builder's yes. Never submit where blockers say needs_click, outside_approval or a sign-in you do not have; send only when every required answer is filled.`;
/** L24-13 (v6.1.16 Task 11): the one-program closing for a program on the standing-approval list. */
export const STANDING_ONE = 'Under your standing approval; I apply when your agent next checks. Say stop and I hold it.';
/** L24-29 (v6.1.16 Task 11): the dropped project facts, said the same on the list and the one-program reply; null when none. Pure. */
export function droppedNote(problems: string[] | undefined): string | null {
  const dropped = (problems ?? []).filter((p) => p !== READS_PAUSED && p !== EVIDENCE_NOT_READ && p !== NO_RECORD_PROJECT);
  return dropped.length > 0 ? `Some project facts were dropped: ${dropped.join('; ')}. Send them corrected next time.` : null;
}

/** Fix round 1 (M2, v6.1.16 Task 12): the full list's style line. */
export const FULL_LIST_STYLE_NOTE = 'Fit approved answers by cutting, never by adding. Call find with program_id for a field\'s style before drafting it.';

export function agentNote(r: R, o: { more: number; description?: 'readme' | 'none' | null; hidden?: string[]; all?: boolean }): string {
  // L29-29 (v6.1.16 Task 15): only the lines that apply; an empty reply has a one-line note.
  if (r.ready.length === 0 && r.gaps.length === 0)
    return "Show find's reply as given. Nothing is listed for this project now; pass users, live_url and chains whenever you know them, and call find again when the builder asks.";
  const tonightIds = tonightIn(r).list.map((t) => t.program_id);
  const lines = [
    "Show find's reply as given; shorten if you must, keep money first and the last action. No emojis, no em dashes, no invented facts.",
    ...(r.ready.length === 0 ? [] : [r.linked
      ? `Draft each ready program from its fields: 'record' and 'earnkit' values as given, ${CUT_NOTE}; ${AGENT_FIELDS}`
      : `Draft each ready program from its fields: 'earnkit' values as given; ${AGENT_FIELDS}`]),
    // L24-6 (v6.1.16 Task 11): an EarnKit value was cut to its field.
    ...(r.ready.some((p) => p.fields.some((f) => f.from === 'earnkit' && f.fit === 'cut')) ? [EARNKIT_CUT_NOTE] : []),
    ...(r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'rule')) ? [RULE_NOTE] : []),
    // With standing approval the agent does not wait for a yes; the limits replace it. L29-6: only the programs named.
    // The submit rule itself is in the server instructions, once (v6.1.8); here only what this reply adds.
    ...(tonightIds.length > 0 ? [standingNote(tonightIds)] : r.ready.length > 0 ? ['Fill field by field; form_id names the form field when given.'] : []),
    ...(tonightIn(r).limitUsed ? ['The daily limit is used: send nothing alone until 24 hours after the last send under standing approval.'] : []),
    // L24-4, L24-11 (v6.1.16 Task 11), L29-5 (Task 15): the standing line's hold is the agent's to record.
    ...(tonightIds.length > 0 ? [STOP_NOTE] : []),
    ...(r.ready.some((p) => p.held) ? [HELD_READY_NOTE] : []),
    // L13-9 (v6.1.14): the standing-approval list is over every ready program, so it may name ones past the shown list.
    ...(tonightIn(r).list.some((t) => !r.ready.some((p) => p.program_id === t.program_id))
      ? ["The standing-approval list names programs past the shown list: call find with program_id for each one's fields before you send it."]
      : []),
    ...((r.applications ?? []).some((a) => a.status === 'waiting') ? ['Call track with won (amount_usd), rejected or no_result after each result.'] : []),
    'The numbers the builder says are each item\'s n in ready, in_person, you_send and gaps ("skip 4" is the item with n 4), not its place in the list.',
    // L29-27 (v6.1.16 Task 15): the skip by number is the agent's, never a second Say.
    ...(r.ready.length + r.gaps.length > 1 ? [SKIP_NOTE] : []),
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
  // L29-19 (v6.1.16 Task 15): one way.
  if (r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'users' && x.effort === 'hours')))
    lines.push(`"Do real people use it" is a question, not work: ask the builder once. ${USERS_NOTE}`);
  if (r.gaps.some((g) => [g.gap, ...g.also].some(startedQuestion)))
    lines.push('"Tell me when you started this" is a question, not work: ask the builder once; pass first_commit_at in the project next time, or, when they started after the program\'s start, call track with gap_done and that gap\'s item. Never invent the date.');
  // L29-26 (v6.1.16 Task 15): the default view's left-out lines, and what "say more" is.
  if ((o.hidden ?? []).length > 0) lines.push('Not shown to the builder:', ...o.hidden!);
  // L18-1 (v6.1.18): `more` is the count on the builder's more line (rank cap and line budget together).
  if (o.more > 0) lines.push(`The full list holds ${o.more} more; show it when the builder asks for all, more or the full list. Call find with filter.all for it.`);
  else if ((o.hidden ?? []).length > 0) lines.push('When the builder says more, call find with filter.all.');
  // L23-4 (v6.1.16): the builder text asks; the agent passes the answers on.
  if (r.ask_outcome.length > 0)
    lines.push(`The reply asks how each went: ${r.ask_outcome.map((a) => a.title).join(', ')}. Pass each answer to track (won with amount_usd, rejected or no_result).`);
  if (r.not_sent && r.not_sent.programs.length > 0)
    lines.push(`Nothing was sent for ${r.not_sent.programs.map((p) => p.title).join(', ')} after the standing-approval line named them; on the builder's yes, send them now within the limits.`);
  // Fix round 1 (M2): the full list's fields carry no style (L26-4); the program's own find has it.
  if (r.linked) lines.push(o.all ? FULL_LIST_STYLE_NOTE : 'Fit approved answers by cutting, never by adding; the style contract travels on each field.');
  if (r.record_missing.length > 0)
    lines.push('Ask for the missing record items once, all together, and save each with record. record_missing names only what these programs need; record get names everything the record lacks.');
  if (r.ready.some((p) => p.claimed_since)) lines.push('A ready program with claimed_since is claimed by another of the builder\'s agents: do not submit it.');
  // L23-7 (v6.1.16): by title, as the builder's lines name them.
  if (r.released.length > 0) lines.push(`Claims left unsent for 24 hours were released: ${r.released.map((p) => p.title).join(', ')}.`);
  // L23-14 (v6.1.16): the repo read failed; the stored tier and its date stood.
  if (r.problems?.includes(EVIDENCE_NOT_READ)) lines.push("The builder's repo could not be read today; the tier from the last read was used.");
  const paused = r.problems?.includes(READS_PAUSED) === true;
  // One line per fact: reads paused says the match is as reported itself.
  if (r.as_reported && !paused) lines.push('No public repo was read, so the match used the facts you reported; tell the builder the match used what they reported, not a repo read.');
  if (o.description === 'readme') lines.push("No description was passed, so the README's first sentence stood in for it; pass one next time if it reads wrong.");
  if (o.description === 'none') lines.push('No description was passed and no README could stand in; pass one next time.');
  // C41 (v6.1.8): no record project is this one, so only record-level answers were used.
  if (r.problems?.includes(NO_RECORD_PROJECT))
    lines.push(NO_PROJECT_NOTE);
  const dropped = droppedNote(r.problems);
  if (dropped) lines.push(dropped);
  if (paused) lines.push('Repo reads are paused for this installation until tomorrow; the match used what you reported.');
  return lines.join('\n');
}
