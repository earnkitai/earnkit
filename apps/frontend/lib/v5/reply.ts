/**
 * The words of a find reply: `replyText` (what the builder sees, design section 4) and
 * `agentNote` (what the agent does next). In-person programs get their own block after ready and
 * gaps, with their setup, and are never in the count to apply to. Linked, the record's blocks follow. Pure.
 */
import { EARNKIT_CUT_NOTE } from './prefill';
import { EVIDENCE_NOT_READ, NO_RECORD_PROJECT, confirmBar, isConfirmWhat, isProofReadingWhat, listWords, lowerFirst, shortTitle, signInCheck, signInThen, type ProofBar } from '../v6/reply-words';
import { NEEDS_CODE, rulesOnly, type Gap } from './eligibility';
import { MANIFEST_LINE } from './funding-manifest';
import { chainName } from './chains';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import { EARLIER_WIN, applicationsLine } from './ledger';
import { closesWords, dayWords } from './deadline';
import { READS_PAUSED, type RepoNote } from './repo-facts';
import { isChainKept } from './project-input';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;

/** How the agent drafts the fields EarnKit did not fill (find and one program alike). */
/** C42 (v6.1.8): a record value over its field's cap is never sent as given. */
export const CUT_NOTE = "except a field marked fit 'cut', which you cut to its max_chars as its fit_note says";
export const AGENT_FIELDS =
  "'agent' fields you draft using the repo, the field's sources and what you already know about the builder; 'builder' fields you ask once, all together. Never invent a personal fact, an amount or a number.";
const NEEDS_SHOWN = 3;

/** The agent note line for rule gaps (v6.1.6, R18a): EarnKit shows them, the builder confirms each once. */
export const RULE_NOTE =
  'A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again; with several rules on one row, one gap_done with the first rule item confirms every rule that row listed. Draft it and show the builder; submit only on a yes to the draft.';

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

/** L46-6 (v6.1.20): the most things a Say or a Before line asks by name; the rest come one at a time after the yes. */
export const ASKED_AT_ONCE = 2;

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
  // L38-1 (v6.1.18 Task 11): EarnKit writes the funding manifest into the repo before it applies.
  const writes = p.agent_step ? ` ${MANIFEST_LINE}` : '';
  return `${head}.${youGive(waits ? [] : own)}${first}${writes}${held}`;
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
/** L38-30 (v6.1.18): a ready program's setup steps the builder takes (never a thing to have), in the program's order. Pure. */
export const ownSteps = (p: Pick<ReadyProgram, 'setup' | 'in_person'>): string[] => (p.in_person ? [] : p.setup.filter((x) => !THING.test(x)));
/** A step as a sentence's first word. Pure. */
const upperStep = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

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
    // L38-28 (v6.1.18): a list of things reads each field's own to-do ("the batch you want"), never its need word.
    const todo = (x: string) => (p.todos ? p.todos[p.need_you.indexOf(x)] ?? x : x);
    const all = [...p.setup, ...own.map(todo)];
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
/** L36-5 (v6.1.18): the rules still to confirm on a gap row. Pure. */
export const ruleCount = (g: GapProgram): number => [g.gap, ...g.also].filter((x) => x.kind === 'rule').length;
/** L36-5 (v6.1.18): the one-program ask when the row lists several rules. */
export const RULES_ACTION = 'Say yes if all of that is you and I draft it.';
/** O2 (v6.1.10): an in-person program that needs only its rule confirmed is listed in the In person block. L38 big 3
 *  (v6.1.18 Task 10): every in-person program with gaps is, never under the step headings (the Monad Blitz bug: only
 *  rule-only ones moved); the default list lists only the rule-only ones (find). Pure. */
export const attendGap = (g: Pick<GapProgram, 'in_person'>): boolean => g.in_person;

/** L38 big 2 (v6.1.18 Task 10): the figure a money phrase starts with ("$500,000" of "$500,000 investment", "up to
 *  $250,000" of "up to $250,000 investment or $10,000 grant"); a phrase with no figure is kept whole. Pure. */
export const moneyFigure = (money: string): string => /^((?:up to )?\$[\d,.]+[KMB]?(?: to \$[\d,.]+[KMB]?)?)(?=[\s,.]|$)/i.exec(money)?.[1] ?? money;

/** The unlinked tier gap ("proof of real users"); its sign-in is asked once, in the closing (v6.1.14). */
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
  real.length > 1 ? 'make both changes' : named ? (real[0].do ?? real[0].what) : (DO_VERB[real[0].kind] ?? 'make the change');
/** The users question ("real users"): a yes, not work (the same gap the agent note names). Pure. */
const usersQuestion = (x: Gap) => x.kind === 'users' && x.effort === 'hours';
/**
 * L38-3 (v6.1.18): `canDo` with the users question as a yes the same Say carries: EarnKit can make every other real
 * gap, there is at least one change and the users question is among them. Pure.
 */
export const canDoWithUsers = (real: Gap[]): boolean =>
  real.some((x) => x.agent_can) && real.some(usersQuestion) && real.every((x) => x.agent_can || usersQuestion(x));
/** L38-3 (v6.1.18): the first remote step program whose one yes is the users answer and EarnKit's change (no rule, no
 *  setup, likely here and ready for this repo), with what the yes makes ("add Base Builder Codes"); null when none. Pure. */
export function doUsersOf(gaps: GapProgram[]): { program: GapProgram; verb: string } | null {
  for (const g of gaps) {
    if (g.in_person || g.public_first || g.unlikely || g.setup.length > 0) continue;
    const all = [g.gap, ...g.also];
    if (all.some((x) => x.kind === 'rule')) continue;
    if (!canDoWithUsers(all)) continue;
    const made = all.filter((x) => x.agent_can);
    const verb = made.length > 1 ? 'make both changes' : made[0].kind === 'builder_codes' ? 'add Base Builder Codes' : (made[0].do ?? made[0].what);
    // Final fix (I2): a change with its own verb ("add an MIT license file") says it, never "I a license file".
    return { program: g, verb };
  }
  return null;
}
/** L38-3 (v6.1.18): the closing that answers the users question and makes the change in one yes. Pure. */
export const doUsersClosing = (verb: string, title: string): string =>
  `Nothing is ready yet. Do real people use it? Say yes and I ${verb}, then apply to ${title}.`;
/** Fix round 1 (M3): whether a Say is that closing, so the agent note names it only then. Pure. */
export const isDoUsersSay = (say: string): boolean => /Do real people use it\? Say yes and I .+, then apply to /.test(say);
/** L38-3 (v6.1.18): the agent's part of that yes. */
export const DO_USERS_NOTE = "When the closing offers a change with the users question, a yes is both: make that change, push, call track with gap_done and the gap's item, then call find again with users: true.";
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
  // L36-13 (v6.1.18): a demo video is a link the builder sends.
  if (x.kind === 'demo_video') return DEMO_CLOSING;
  if (x.setup && telling(x.setup)) return `T${x.setup.slice(1)} and I look again.`;
  return `Tell me when ${stepClause(x) ?? 'that is done'} and I look again.`;
}

/** L36-13 (v6.1.18): the closing on a demo video step. */
export const DEMO_CLOSING = 'Send me the demo video link and I fill it in.';
/** L36-13 (v6.1.18): how the agent passes the demo video link. */
export const DEMO_NOTE = 'A demo video gap takes a link: when the builder sends it, pass it as project.demo_url and call find again.';

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
  // L36-5 (v6.1.18): several rules on the row are one ask.
  if (ruleOnlyGap(g)) return { action: ruleCount(g) > 1 ? RULES_ACTION : 'Say yes if that is you and I draft it.' };
  const all = [g.gap, ...g.also];
  // L38 big 1 (v6.1.18 Task 10): unlinked, the proof waits on the sign-in: it comes first in the action's own sentence
  // (`signIn` is that clause, `signInCheck`); the proof as the only step left is the sign-in, then a look again.
  if (signIn && hasProof(all)) {
    const left = all.filter((x) => !confirmGap(x));
    if (left.length === 0) return { action: signInThen(signIn, 'I look again.') };
    const rest = gapActionOf({ ...g, gap: left[0], also: left.slice(1) }, null, draftOnly);
    return { action: signInThen(signIn, rest.action ?? 'I look again.'), ...(rest.step ? { step: rest.step } : {}) };
  }
  const real = all.filter((x) => x.kind !== 'rule');
  if (real.every((x) => x.kind === 'tier' && isProofReadingWhat(x.what))) return { action: null };
  // v6.1.20: no quoted commands.
  if (canDo(real)) return { action: `Say do and I ${doVerb(real, true)} first.` };
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
export const notFitLine = (title: string, money: string, reason: string): string => `${title} (${money}). Not a fit: ${reason}.`;

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
 * L38 big 3 (v6.1.18 Task 10): what a step row asks, in order: its real gaps (the change, the users question, the
 * proof), the program's setup steps, then each rule still to confirm. A rule-only row is one ask (L36-5), so one step.
 * Pure.
 */
export function stepItems(g: GapProgram): string[] {
  const all = [g.gap, ...g.also];
  const real = all.filter((x) => x.kind !== 'rule');
  const listed = [...real.filter((x) => !readingGap(x)), ...real.filter(readingGap)].map((x) => x.what);
  return [...listed, ...g.setup, ...all.filter((x) => x.kind === 'rule').map((x) => x.what)];
}
/** L38 big 3: one step means one step: a rule-only row with no setup step (one yes), or a row whose only item is one
 *  gap or one setup step. L1l-3 (v6.1.19): a setup step beside a rule is two things to do, so More to do first. Pure. */
export const oneStep = (g: GapProgram): boolean => (ruleOnlyGap(g) && g.setup.length === 0) || stepItems(g).length === 1;
/** L38 big 3 (v6.1.18 Task 10): a row under "More to do first": the first thing to do, then how many more:
 *  "2. Colosseum Eternal, $25,000 award: a demo video link (...), then 4 more steps." L1l-2 (v6.1.19): the row always
 *  names its first step, even when the closing repeats it. The one-program reply keeps the whole line. Pure. */
export function moreStepsLine(g: GapProgram): string {
  const [head, ...rest] = stepItems(g);
  const money = `${g.money}${g.closes_in ? `, closes ${g.closes_in}` : ''}`;
  const more = rest.length === 0 ? '' : `, then ${rest.length} more ${rest.length === 1 ? 'step' : 'steps'}`;
  return `${g.n}. ${g.title}, ${money}: ${head}${more}.`;
}
/** L38 big 3: the default view's step headings, and the full list's one heading for every row not ready. */
export const ONE_STEP_HEAD = 'One step away';
export const MORE_STEPS_HEAD = 'More to do first';
export const NOT_READY_HEAD = 'Not ready yet';

/**
 * What waits on the builder from the time since this agent's last find (C48) and what was sent under standing
 * approval meanwhile; a find with no project carries them too (v6.1.8 fix round 1). Pure.
 */
export function reportLines(r: Pick<R, 'approvals_again' | 'applied_overnight'>): string[] {
  const out: string[] = [];
  if (r.approvals_again)
    out.push(r.approvals_again === 1
      ? 'One answer you changed waits for your approval at earnkit.com/me.'
      // L38-25 (v6.1.18): "again" said why: the builder changed the answer.
      : `${r.approvals_again} answers you changed wait for your approval at earnkit.com/me.`);
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
  // L36-11 (v6.1.18): a program another agent of the builder's holds is left out; this agent sends nothing for it.
  const claimedIds = new Set(r.ready.filter((p) => p.claimed_since).map((p) => p.program_id));
  for (const b of remote) {
    if (!b.sign_in && !b.needs_click) continue;
    if (claimedIds.has(b.program_id)) continue;
    const words = b.sign_in ? `${signInWords(b.sign_in)}${b.needs_click ? ' and press submit yourself on' : ' for'}` : 'you press submit yourself on';
    groups.set(words, [...(groups.get(words) ?? []), ...titlesOf(r, [b])]);
  }
  const clauses = [...groups].filter(([, t]) => t.length > 0).map(([words, t]) => `${words} ${listWords(t, t.length)}`);
  // What these programs' forms need (v6.1.9); record get names everything the record lacks. Fix round 1 (M1, L29-17
  // over F5): a need the Say names (`said`) is said there only.
  const lacks = r.record_missing.filter((m) => !said.some((n) => sameNeed(n, m)));
  // L29-18 (v6.1.16 Task 15, fix round 1 M2): one label; what waits under standing approval and what the record lacks
  // are clauses of it.
  // L46-6 (v6.1.20): what the record lacks, two by name at most; record get and the agent note keep the whole list.
  const all = [...clauses, ...(waiting ? [waiting] : []), ...(lacks.length > 0 ? [joinAnd(lacks.slice(0, ASKED_AT_ONCE))] : [])];
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

/** Task 11 fix round 1 (M1): the closing when every ready program is held by the builder. L38-14 (v6.1.18): the
 *  heading says it is on hold, so the closing is the Say alone. */
export const HOLD_CLOSING = 'Say go and I apply.';

/** The closing when nothing fits (v6.1.14): EarnKit never writes first, so the builder asks again. */
export const NOTHING_FITS = 'Nothing fits yet. Ask again any time and I show what is new.';

/** The closing with nothing ready and no step to name (L1j-6, v6.1.17: then the sign-in is the reply's last line). */
export const NOTHING_READY = 'Nothing is ready yet.';
/** O2 (v6.1.10): the closing when in-person programs are listed and nothing remote is ready. */
export const IN_PERSON_CLOSING = 'Nothing remote is ready yet. Say yes and I start the in-person applications.';
/** v6.1.20 polish (5): with only in-person programs listed, the yes drafts them for the builder to send. Pure. */
export const inPersonDraft = (n: number): string => `Nothing remote is ready yet. Say yes and I draft ${n === 1 ? 'it' : 'them'} for you to send.`;

/** L29-28 (v6.1.16 Task 15): the rule question's Say. L38-2 (v6.1.18): it names the program the yes drafts. Pure. */
export const ruleSay = (n: number, many = false, title?: string): string =>
  // v6.1.20: the bare number, no quotes; the rule named by its program.
  `Say ${n} if ${title ? `the ${title} rule${many ? 's fit' : ' fits'} you` : many ? 'all of that is you' : 'that rule fits you'} and I draft it.`;
/** L29-34 (v6.1.16 Task 15): the users question, unlinked. */
export const USERS_UNLINKED = 'Do real people use it? Say yes, sign in, and I check.';
/** v6.1.20 polish (3): the same when the yes makes the program ready. */
export const USERS_UNLINKED_APPLY = 'Do real people use it? Say yes, sign in, and I apply.';
/** L1i-3 (v6.1.16.1): the users question with the sign-in link in it, the reply's one sign-in sentence. Pure. */
export const usersUnlinkedAt = (link: string, then: 'check' | 'apply' = 'check'): string => `Do real people use it? Say yes, sign in at ${link}, and I ${then}.`;
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
  /** L36-5 (v6.1.18): the program the rule Say names lists several rules, so the yes covers all of them. */
  ruleMany?: boolean;
  /** L38-3 (v6.1.18): a step program with a stated amount whose one yes is the users answer and EarnKit's change,
   *  preferred over a rule of a program with no stated amount. */
  doUsers?: { verb: string; title: string } | null;
  /** L38-30 (v6.1.18): the one ready program's own setup steps, which the builder takes before the yes. */
  setupFirst?: string[];
  /** L38-2 (v6.1.18): the title of the program the rule Say names. */
  ruleTitle?: string;
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
      // L46-6 (v6.1.20): two things by name at most.
      ...waits.map((w) => `${w.title} needs your ${joinAnd(w.needs.map(bare).slice(0, ASKED_AT_ONCE))}; then ${w.draft ? 'I draft it for you to send' : 'I apply'}.`),
    ].join(' ');
    const left = o.ready - stands.length - drafts.length - waits.length;
    if (left > 0) return { text: `${said} ${closingLine({ ...o, ready: left, yesStands: [], draftStands: [], yesWaits: [] }).text}`, offer: 'apply' };
    // v6.1.16 Task 11 N2 (v6.1.17): every ready one is covered, so a gap EarnKit can make is still offered, last.
    return { text: o.doOffer ? `${said.replace(/\.$/, '')}, or say do ${o.doOffer.n} and I ${o.doOffer.verb} first.` : said, offer: 'apply' };
  }
  const { ready, draftOnly } = o;
  // v6.1.20: no quoted commands.
  const doPart = o.doOffer ? `say do ${o.doOffer.n} and I ${o.doOffer.verb}` : null;
  if (ready >= 1) {
    const mixed = o.drafts ?? [];
    const k = ready - mixed.length;
    // L29-17 (v6.1.16 Task 15): "Say yes and tell me your email and the problem, and I apply to all 5."
    // L46-6 (v6.1.20): at most two things asked by name; the rest come after the yes, one at a time (the agent note).
    const say = o.yesNeeds && o.yesNeeds.length > 0 && mixed.length === 0 ? `Say yes and tell me ${joinAnd(o.yesNeeds.slice(0, ASKED_AT_ONCE))}, and` : 'Say yes and';
    // L16-11 (v6.1.16): one ready program is named; "all {n}" only for several, "ready" when other blocks are listed.
    const yes = draftOnly
      ? ready === 1 ? (o.others && o.title ? `${say} I draft ${o.title} for you to send` : `${say} I draft it for you to send`) : `${say} I draft all ${ready} for you to send`
      : mixed.length > 0 && k > 0
        ? `Say yes and I apply to ${k === 1 && o.applyTitle ? o.applyTitle : k} and draft ${listWords(mixed, mixed.length)} for you to send`
        : ready === 1
          ? o.overLimit && o.title ? `${o.title} is over your limit. ${say} I apply` : o.title ? `${say} I apply to ${o.title}` : `${say} I apply`
          : `${say} I apply to all ${ready}`;
    // L38-30 (v6.1.18): a setup step of the builder's own comes first, so the yes never meets a skipped step.
    if (ready === 1 && mixed.length === 0 && !o.overLimit && o.setupFirst && o.setupFirst.length > 0) {
      const then = draftOnly ? 'I draft it for you to send' : 'I apply';
      const sayNeeds = say === 'Say yes and' ? 'say yes and' : `s${say.slice(1)}`;
      // The program is named when other blocks are listed, as the plain yes names it (L16-11).
      const to = !draftOnly && o.others && o.title ? ` to ${o.title}` : '';
      return { text: `${upperStep(joinAnd(o.setupFirst))} first, then ${sayNeeds} ${then}${to}${doPart ? `, or ${doPart} first` : ''}.`, offer: 'apply' };
    }
    // L29-27 (v6.1.16 Task 15): one action; a number skips through the agent note.
    if (doPart) return { text: `${yes}, or ${doPart} first.`, offer: 'apply' };
    return { text: `${yes}.`, offer: 'apply' };
  }
  // v6.1.20: one ask: a change EarnKit makes is the closing, and the builder's own step stays that row's sentence.
  const withDo = (c: Closing): Closing => (c.offer === null && doPart ? { text: `${/^Nothing (remote )?is ready yet\./.test(c.text) ? 'Nothing is ready yet. ' : ''}S${doPart.slice(1)}.`, offer: 'do' } : c);
  // Ready programs held by another agent are listed as ready, so the reply never says nothing is ready (I1).
  // v6.1.14: no promise to write first.
  // Task 11 fix round 1 (M1): every ready program is on hold: the reply closes on lifting it.
  if (o.held === 0 && (o.onHold ?? 0) > 0) return { text: HOLD_CLOSING, offer: 'apply' };
  if (o.held > 0) return withDo({ text: 'Your other agent is handling these.', offer: null });
  if (o.gaps > 0) {
    // L38-3 (v6.1.18): the users answer and EarnKit's change in one yes, ahead of a rule with no stated amount.
    // Fix round 1 (I1): signed out, no apply is promised: the users question asks for the sign-in that checks it.
    if (o.doUsers && o.linked === false) return { text: `Nothing is ready yet. ${USERS_UNLINKED}`, offer: 'look_again' };
    if (o.doUsers) return { text: doUsersClosing(o.doUsers.verb, o.doUsers.title), offer: 'apply' };
    // L29-28 (v6.1.16 Task 15): the rule Say says what the yes does.
    if (o.firstRule !== null) return { text: `Nothing is ready yet. ${ruleSay(o.firstRule, o.ruleMany, o.ruleTitle)}`, offer: 'rule' };
    // I2 (v6.1.9 final): the only step program shown carries a rule beside its change: the rule is asked first.
    if (o.stepRule != null) return { text: `Nothing is ready yet. ${ruleSay(o.stepRule, o.ruleMany, o.ruleTitle)}`, offer: 'rule' };
    const step = o.firstStep ?? null;
    // L29-34 (v6.1.16 Task 15): unlinked, the one ask holds the sign-in that checks it.
    // v6.1.20 polish (3): "and I apply" when the yes makes the program ready; "and I check" only when a check follows.
    if (step?.users && o.linked === false) return step.more ? { text: `Nothing is ready yet. ${USERS_UNLINKED}`, offer: 'look_again' } : { text: `Nothing is ready yet. ${USERS_UNLINKED_APPLY}`, offer: 'apply' };
    if (step?.users) return step.more ? { text: 'Nothing is ready yet. Do real people use it? Say yes and I check.', offer: 'look_again' } : { text: 'Nothing is ready yet. Do real people use it? Say yes and I apply.', offer: 'apply' };
    // I3 (v6.1.9 final): "First:" reads as a sentence for a noun or a verb phrase.
    // O3 (v6.1.10): the started question is asked as one.
    if (step && !step.users && step.started) return withDo({ text: `Nothing is ready yet. ${STARTED_CLOSING}`, offer: null });
    // L1g-5 (v6.1.16): one closing shape for every single step, the gap line names the gap.
    if (step && !step.users) return withDo({ text: `Nothing is ready yet. ${step.gap ? singleStepClosing(step.gap) : `Tell me when ${step.what} is done and I look again.`}`, offer: null });
    // A reply that lists in-person programs never ends on the bare line (O2, v6.1.10).
    // v6.1.20: a change EarnKit makes on a remote program comes before the in-person applications' long odds.
    return o.inPerson > 0 && !doPart ? { text: inPersonDraft(o.inPerson), offer: 'draft' } : withDo({ text: NOTHING_READY, offer: null });
  }
  if (o.inPerson > 0) return { text: inPersonDraft(o.inPerson), offer: 'draft' };
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

/** The one sentence for each thing the builder is told about the repo read (v6.1.8, B20 and C59); a repo link not read gets exactly one of the first four.
 *  L38-7, L38-8 (v6.1.18): the four read notes end "so this is from what you told me."; the fork says why it matters. */
export const REPO_NOTE: Record<RepoNote, string> = {
  /** L26-8 (v6.1.16 Task 12): the read passed its time budget. */
  slow: 'GitHub was slow, so this is from what you told me. I read it again next time.',
  paused: 'Repo reads are paused until tomorrow, so this is from what you told me.',
  private: 'The repo is private, so this is from what you told me.',
  other_host: 'I read GitHub repos only, so this is from what you told me.',
  unread: 'I could not read the repo, so this is from what you told me.',
  fork: 'This repo is a fork, and programs fund the original.',
  archived: 'This repo is archived; programs want active work.',
  empty: 'The repo is empty, so this is from what you told me.',
  no_builder_codes: 'The repo does not send Builder Codes yet.',
};

/** F9 (v6.1.12): the empty repo and the missing Builder Codes, when both apply, as one sentence. */
export const EMPTY_NO_CODES = 'The repo is empty and does not send Builder Codes yet, so this is from what you told me.';
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
 * started-not-sent line, (3) the sent ask (L36-2, v6.1.18 Task 4), (4) the record sign-in line, (5) the closing.
 */
export const ONE_SAY_ORDER = ['not_sent', 'started_not_sent', 'sent_ask', 'record_sign_in', 'closing'] as const;
/** A sentence that asks the builder to say something ("Say yes ...", "Or say the numbers ..."; L38-30, v6.1.18: "Publish
 *  X first, then say yes ..."). */
const SAY_SENTENCE = /^(Or )?[Ss]ay\b|, then say\b/;
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
/** L23-7 (v6.1.16): a claim left unsent for 24 hours, one line per program (at most three, the rest counted). L41-11
 *  (v6.1.19): a program the builder sends themselves is asked in the one sent question (`sentLines`), never here. Pure. */
export function startedNotSentLines(r: Pick<R, 'released'>, now: Date): string[] {
  const unsent = r.released.filter((p) => !p.ask);
  const shown = unsent.slice(0, RELEASED_SHOWN).map((p) => `${p.title}: started ${dayWords(new Date(p.started_at), now)}, nothing sent. Say yes to apply or say skip.`);
  const rest = unsent.length - shown.length;
  return rest > 0 ? [...shown, `And ${rest} more started, nothing sent.`] : shown;
}

/** L41-2 (v6.1.19): a draft this agent started under an hour ago for the builder to send. L47-S2 (v6.1.22): one line,
 *  three named, then "and {k} more". Pure. */
export const draftedLines = (r: Pick<R, 'drafted'>): string[] => {
  const t = (r.drafted ?? []).map((d) => d.title);
  if (t.length === 0) return [];
  if (t.length === 1) return [`${t[0]}: drafted, waiting for you to send.`];
  const named = t.length > 3 ? [...t.slice(0, 3), `${t.length - 3} more`] : t;
  return [`Drafted, waiting for you to send: ${named.slice(0, -1).join(', ')} and ${named.at(-1)}.`];
};

/** L18-4 (v6.1.18 Task 4): the Say of the question whether a form the builder sends themselves went out. */
const SENT_SAY = 'Say sent and I note it.';
/** L41-11 (v6.1.19): the Say of the one question about several forms. */
const SENT_MANY_SAY = 'Say which you sent and I note them.';
/** L41-11 (v6.1.19): whether a line ends on a sent question's Say (it offers nothing to apply). Pure. */
export const endsOnSentSay = (line: string): boolean => line.endsWith(SENT_SAY) || line.endsWith(SENT_MANY_SAY);
/** L41-11 (v6.1.19): every form the builder sends themselves and the reply asks about: the sent asks, then the
 *  released rows that ask. Pure. */
export const sentTitles = (r: Pick<R, 'ask_sent'> & { released?: R['released'] }): string[] =>
  [...(r.ask_sent ?? []), ...(r.released ?? []).filter((p) => p.ask)].map((a) => a.title);
/** L41-11 (v6.1.19): the one sent question, without its Say: "Did you send A and B?" (three named, then the count);
 *  null when none. Pure. */
export function sentQuestion(titles: string[]): string | null {
  return titles.length === 0 ? null : `Did you send ${listWords(titles)}?`;
}
/** Fix round 1 (v6.1.19 Task 3): the one sent question a reply asks and the programs it names (three at most, the rest
 *  counted), as `replyText` builds it, so find marks exactly the named ones. Pure. */
export function sentAskOf(r: Pick<R, 'ask_sent' | 'released' | 'not_sent'>): { question: string | null; named: string[] } {
  const notSentIds = new Set((r.not_sent?.programs ?? []).map((p) => p.program_id));
  const items = [...(r.ask_sent ?? []), ...r.released.filter((p) => p.ask && !notSentIds.has(p.program_id))];
  return { question: sentQuestion(items.map((x) => x.title)), named: items.slice(0, 3).map((x) => x.program_id) };
}
/** L41-11 (v6.1.19): the sent question's Say for this many forms. Pure. */
export const sentSay = (n: number): string => (n === 1 ? SENT_SAY : SENT_MANY_SAY);
/** L18-4, L36-1 (v6.1.18 Task 4); L41-11 (v6.1.19): one line for every sent question in the reply:
 *  "Did you send Codegeist 2026 and Kiroween 2026? Say which you sent and I note them." Pure. */
export function sentLines(r: Pick<R, 'ask_sent'> & { released?: R['released'] }): string[] {
  const titles = sentTitles(r);
  const q = sentQuestion(titles);
  return q ? [`${q} ${sentSay(titles.length)}`] : [];
}
/** L18-4 (v6.1.18 Task 4): the agent note for the sent questions (the ask lines and the release lines that ask); null when none. Pure. */
export function sentNote(r: Pick<R, 'ask_sent' | 'released'>): string | null {
  const titles = [...(r.ask_sent ?? []), ...r.released.filter((p) => p.ask)].map((a) => a.title);
  return titles.length > 0 ? `The reply asks whether each was sent: ${titles.join(', ')}. "sent" is track applied with submitted_by builder; "not yet" needs no call.` : null;
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
  /** Fix round 1 (M6): the project has a repo link, so a sign-in checks "the repo" (default); else the proof's bar. */
  repo?: boolean;
  /** L18-1 (v6.1.18): the rows the rank cap left out of the default view, and those of them closing within 7 days. */
  hidden?: { count: number; closing: ClosingHidden[] };
  /** v6.1.20: the project's name, for the opening sentence. */
  name?: string | null;
  /** v6.1.20: catalog short titles by program id (`short_title`). */
  shorts?: Map<string, string>;
};

/** v6.1.20: the reply's titles as the builder reads them (`shortTitle`), every list the text names. Pure. */
export function shortened<X extends Partial<Pick<R, 'ready' | 'gaps' | 'ask_sent' | 'released' | 'not_sent' | 'applied_overnight' | 'drafted' | 'tonight'>>>(r: X, shorts?: Map<string, string>): X {
  const st = <T extends { title: string; program_id?: string }>(x: T): T => ({ ...x, title: shortTitle(x.title, x.program_id ? shorts?.get(x.program_id) : undefined) });
  return {
    ...r,
    ...(r.ready ? { ready: r.ready.map(st) } : {}),
    ...(r.gaps ? { gaps: r.gaps.map(st) } : {}),
    ...(r.ask_sent ? { ask_sent: r.ask_sent.map(st) } : {}),
    ...(r.released ? { released: r.released.map(st) } : {}),
    ...(r.not_sent ? { not_sent: { ...r.not_sent, programs: r.not_sent.programs.map(st) } } : {}),
    ...(r.applied_overnight ? { applied_overnight: r.applied_overnight.map(st) } : {}),
    ...(r.drafted ? { drafted: r.drafted.map(st) } : {}),
    ...(r.tonight ? { tonight: { ...r.tonight, programs: r.tonight.programs.map(st) } } : {}),
  };
}

/** Fix round 1 (I1): a line that carries a link. */
const LINK = /https?:\/\/\S+/;

/** L18-1 (v6.1.18): how many named on the more line at most. */
const CLOSING_NAMED = 2;
/** L18-1: a closing program's words on the more line: "3 days", "tomorrow", "today", "under an hour". Pure. */
const closingWords = (c: ClosingHidden, now: Date): string =>
  (c.closes_in ?? closesWords(c.closes_at, now, 'UTC').replace(/^closes /, '')).replace(/^in /, '');

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
/** v6.1.20: a numbered block of the default view: its rows in order (no heading; the opening says the state), at most
 *  `cap` shown; `hide` is a row as the agent's lines say it when the builder text leaves it out. */
type Block = { ids: string[]; line: (i: number) => string; hide: (i: number) => string; order?: number[]; cap?: number };
/** Lines a block takes at most. Pure. */
const blockMax = (b: Block): number => Math.min(b.ids.length, b.cap ?? b.ids.length);
/** How many rows a block shows in `k` lines. Pure. */
const blockRows = (b: Block, k: number): number => Math.max(0, Math.min(blockMax(b), k));
/** The lines a block uses for `rows` shown rows. Pure. */
const blockUses = (_b: Block, rows: number): number => rows;

/**
 * The builder text and the kind of the one `Say` it offers (L24-2, v6.1.16 Task 11), for find to keep. L29-26 (v6.1.16
 * Task 15): the default view (`defaultView`) is at most DEFAULT_LINES lines, the Say last; `all` (filter.all, "say
 * more") is the full view (`fullView`): names and money only, one per line. Pure.
 */
export function replyParts(r: R, first: boolean, now: Date = new Date(), lastOffer: OfferKind | null = null, o: ReplyOptions = {}): ReplyParts {
  // v6.1.20: every title the builder reads is the program's short title.
  r = shortened(r, o.shorts);
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
  // O2 (v6.1.10): a rule-only in-person program is in the In person block, after the ready ones. L38 big 3 (v6.1.18
  // Task 10): every in-person program with gaps is (the full list lists them all), never under the step headings.
  const steps = r.gaps.filter((g) => !attendGap(g));
  const attendRules = r.gaps.filter(attendGap);
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
  // L1m-2 (v6.1.22): the rule Say names only a row whose one item is its rule (one step away); a row with a setup step
  // beside its rule is never the closing's yes.
  const askable = steps.filter((g) => ruleOnlyGap(g) && g.setup.length === 0 && [g.gap, ...g.also].every((x) => !x.setup) && !(g.unlikely && firstStep !== null));
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
  // L38-3 (v6.1.18): a step program with a stated amount, whose yes is the users answer and EarnKit's change, closes
  // ahead of the rule of a program with no stated amount, and ahead of its own change step.
  const doUsersFound = doUsersOf(steps);
  const ruleTarget = steps.find((g) => g.n === (firstRule ?? stepRule));
  const doUsers = doUsersFound && doUsersFound.program.max_award_usd !== null &&
    (ruleTarget ? ruleTarget.max_award_usd === null : firstStep?.program_id === doUsersFound.program.program_id)
    ? doUsersFound : null;
  // L38-30 (v6.1.18): the one ready program's own setup steps go in the closing (not with a yes that already stands).
  const stepsFirst = tonight === 0 && unsaid.length === 1 && free.length === 1 && !mixed ? ownSteps(unsaid[0]) : [];
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
            // L36-5 (v6.1.18): the rule Say covers every rule its row lists.
            ruleMany: (() => { const row = steps.find((g) => g.n === (firstRule ?? stepRule)); return row ? ruleCount(row) > 1 : false; })(),
            // L38-2 (v6.1.18): and names the program it drafts.
            ruleTitle: steps.find((g) => g.n === (firstRule ?? stepRule))?.title,
            // L16-11 (v6.1.16): the one ready program left to say yes to, by name.
            ...(unsaid.length === 1 ? { title: unsaid[0].title } : {}),
            ...(doUsers ? { doUsers: { verb: doUsers.verb, title: doUsers.program.title } } : {}),
            // L38-30 (v6.1.18): and its own setup steps, said first.
            ...(stepsFirst.length > 0 ? { setupFirst: stepsFirst } : {}),
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
  // L1g-5 (v6.1.16): a shown line that reads the archive says it, so the archived note is left out.
  // L38-6 (v6.1.18): so is the private note when a shown line asks for the public repo, and the empty note when one
  // asks for code in a repo.
  const shownItem = (item: string) => r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.item === item));
  const namedByGap: Partial<Record<RepoNote, string>> = { archived: 'repo:archived', private: 'repo:public', empty: 'repo' };
  const allNotes = [...new Set(r.repo_notes ?? [])];
  const notes = allNotes.filter((n) => !(namedByGap[n] && shownItem(namedByGap[n]!)));
  // L1i-3 (v6.1.16.1): one sign-in sentence per reply. L38 big 1 (v6.1.18 Task 10): a sign-in is said only when the
  // reply's one action needs it, and then inside the Say line, first: the unlinked users question (its own sign-in, with
  // the link), the rule Say of the only step program whose change is the proof ("Sign in at {link} so I can check the
  // repo, then say "yes n" ..."), or, with no other action, the proof itself ("..., then I look again."). Any other reply
  // has no sign-in line; the link stays in the JSON for the agent, and a send with a repo is gated by find (`signInFirst`).
  // Fix round 1 (I2): judged on the Say the reply ends on; the full view ends on the default view's.
  const endsOn = o.all && o.defaultSay !== undefined ? o.defaultSay : closingOf.text;
  const asksSignIn = !r.linked && /Do real people use it\? Say yes, sign in\b/.test(endsOn);
  // Fix round 1 (I1): only when the closing keeps the reply's Say (no not-sent, started or sent line says it first).
  const notSent = notSentLine(r, now);
  // v6.1.16 Task 9 N4 (v6.1.17): a program the not-sent line names gets no started line too.
  const notSentIds = new Set((r.not_sent?.programs ?? []).map((p) => p.program_id));
  const started = startedNotSentLines({ released: r.released.filter((p) => !notSentIds.has(p.program_id)) }, now);
  // L18-4 (v6.1.18 Task 4): the sent question after the started lines (ONE_SAY_ORDER).
  // L41-11 (v6.1.19): every sent question in one line, the released rows that ask included.
  const sent = sentLines({ ask_sent: r.ask_sent, released: r.released.filter((p) => !notSentIds.has(p.program_id)) });
  const sayFirst = [notSent, ...started, ...sent].some((x) => x !== null && carriesSay(x));
  const proofWaits = !r.linked && !asksSignIn && tonight === 0 && closingOf.offer !== 'apply' && !sayFirst;
  const proofCheck = signInCheck(r.sign_in ?? null, o.repo ?? true, proofBarOf(r.gaps.flatMap((g) => [g.gap, ...g.also])) ?? 'used');
  const stepRuleRow = stepRule !== null && firstRule === null ? steps.find((g) => g.n === stepRule) : undefined;
  const proofRow = proofWaits && closingOf.offer === 'rule' && stepRuleRow && signInOnly([stepRuleRow.gap, ...stepRuleRow.also]) ? stepRuleRow : undefined;
  const proofAlone = proofWaits && closingOf.text === NOTHING_READY && showsProof(steps);
  if (proofRow) closingOf.text = `${NOTHING_READY} ${signInThen(proofCheck, closingOf.text.replace(/^Nothing is ready yet\. /, ''))}`;
  else if (proofAlone) closingOf.text = `${NOTHING_READY} ${signInThen(proofCheck, 'I look again.')}`;
  // Task 2 (v6.1.16.1, Task 1 leftover): with the unlinked notice too, the closing still carries the link and the
  // notice keeps only its first sentence, so the reply has one sign-in sentence.
  if (asksSignIn && r.sign_in) closingOf.text = closingOf.text.replace(/Say yes, sign in, and I (check|apply)\./, (_m, v: string) => usersUnlinkedAt(r.sign_in!, v as 'check' | 'apply').replace(/^Do real people use it\? /, ''));
  // L46-5 (v6.1.20): signed out, a rule yes carries the sign-in in one sentence, never a second sign-in line.
  const ruleSignIn = !r.linked && !proofRow && !asksSignIn && !sayFirst && tonight === 0 && closingOf.offer === 'rule' && !!r.sign_in;
  if (ruleSignIn) closingOf.text = `${NOTHING_READY} ${signInThen(`Sign in at ${r.sign_in}`, closingOf.text.replace(/^Nothing is ready yet\. /, ''))}`;
  const signsIn = asksSignIn || !!proofRow || proofAlone || ruleSignIn;
  // L46-2 (v6.1.20): with nothing ready, a closing that only names a step (or nothing) never dead-ends while an in-person
  // program with a form is on the screen: its draft is the one Say; the step stays that row's sentence.
  const draftable = inPerson.filter((p) => !p.claimed_since);
  // v6.1.20 polish (4): a step program on the screen keeps its step as the action; the draft is offered beside it.
  if (!signsIn && ready.length === 0 && tonight === 0 && closingOf.offer === null && draftable.length > 0 && !o.all) {
    const step = closingOf.text.replace(/^Nothing is ready yet\.\s*/, '');
    const draft = draftSay(draftable[0].n, draftable[0].title);
    Object.assign(closingOf, step === '' || carriesSay(step)
      ? { text: draft, offer: 'draft' as const }
      : { text: `${step.replace(/\.$/, '')}, or s${draft.slice(1)}`, offer: 'draft' as const });
  }
  // v6.1.20: the opening says nothing is ready, so the closing does not say it again.
  closingOf.text = closingAfterOpening(closingOf.text);
  const nothingAtAll = r.ready.length === 0 && r.gaps.length === 0;
  if (nothingAtAll && closingOf.text === NOTHING_FITS) Object.assign(closingOf, { text: '', offer: null });
  const notice = signsIn && r.sign_in && r.linked_notice ? r.linked_notice.replace(/ Sign in once at \S+ to link it again\.$/, '') : r.linked_notice;

  // ONE_SAY_ORDER (L23-21): the first line through it that carries a Say keeps it, and (L29-33, v6.1.16 Task 15) goes
  // last; every other line keeps its fact sentence only.
  const sayers = [notSent, ...started, ...sent, closingOf.text].filter((x): x is string => x !== null && x !== '');
  const sayLine = sayers.find(carriesSay) ?? closingOf.text;
  const early = sayLine !== closingOf.text;
  const plain = (x: string | null) => (x === null || x === sayLine ? null : carriesSay(x) ? withoutSay(x) || null : x);
  // L18-4: a sent question offers nothing to apply.
  const offer = early ? (endsOnSentSay(sayLine) ? null : 'apply') : closingOf.offer;

  const after = [...(notes.length > 0 ? [repoNoteText(notes)] : []), ...(notice ? [notice] : [])];
  // L1i-5 (v6.1.16.1): the full view closes on the default view's Say, never on a rule it does not show.
  if (o.all) {
    const say = fullSay(o.defaultSay ?? sayLine);
    const blocks: [string, (ReadyProgram | GapProgram)[]][] = [
      ['Ready to apply', free], ['Being handled by your other agent', heldReady], ['On hold until you say go', onHold],
      // L38 big 3 (v6.1.18 Task 10): the full list heads every row not ready as one block.
      [NOT_READY_HEAD, steps], [IN_PERSON_HEAD, [...inPerson, ...attendRules]],
    ];
    // L1k-2 (v6.1.18): `shown` is the full view's rows in display order, which find numbers 1..N.
    const shown = blocks.flatMap(([, ps]) => [...ps].sort((a, b) => a.n - b.n).map((p) => p.program_id));
    return { text: fullView(blocks, after, say, o.closes, o.name), offer, hidden: [], shown, say, more: 0 };
  }

  // v6.1.20: the default view: the opening, the program sentences, the Also sentence, the other lines, the closing.
  // L38-30 (v6.1.18): a setup step the closing names is said there only.
  const unstep = (p: ReadyProgram): ReadyProgram => (stepsFirst.length > 0 && p.program_id === unsaid[0]?.program_id ? { ...p, needs: p.needs.filter((x) => !stepsFirst.includes(x)) } : p);
  const readyLines = (ps: ReadyProgram[], strip = false) => ps.map((p) => readyLine(unstep(strip ? { ...p, claimed_since: undefined } : p), r.linked, now, false, named, namedInClosing.has(p.program_id)));
  const sentenceOpts = (p0: ReadyProgram) => {
    const p = unstep(p0);
    const own = namedInClosing.has(p.program_id) ? [] : r.linked ? p.need_you.filter((x) => !named(x)) : p.needs.filter((x) => !p.setup.includes(x));
    return { p, o: { click: click.has(p.program_id), needs: own, steps: p.needs.filter((x) => p.setup.includes(x)), standing: tonightList.some((t) => t.program_id === p.program_id), stands: yesd.includes(p0) } };
  };
  // v6.1.20 polish (1): the opening says the action once, the one most ready rows share; a row says its own only when
  // it differs.
  const sayable = [READY_APPLY, READY_DRAFT, MANIFEST_LINE, READY_STANDING];
  const acts = free.map((p) => { const x = sentenceOpts(p); return readyAction(x.p, x.o); }).filter((a) => sayable.includes(a));
  const readyAct = acts.length === 0 ? null : acts.every((a) => a === acts[0]) ? acts[0] : acts.includes(READY_APPLY) ? READY_APPLY : null;
  const readySentences = (ps: ReadyProgram[]) => ps.map((p0) => {
    const { p, o: opts } = sentenceOpts(p0);
    return readySentence(p, { ...opts, quiet: readyAct });
  });
  const inPersonLines = [...inPerson.map((p) => inPersonLine(p, false, now)), ...attendRules.map((g) => gapLine(g))];
  const readyOf = (ps: ReadyProgram[], strip = false): Block => {
    const said = readySentences(ps);
    const agent = readyLines(ps, strip);
    return { ids: ps.map((p) => p.program_id), line: (i) => said[i], hide: (i) => agent[i], cap: READY_SHOWN };
  };
  const readyBlock: Block | null = free.length > 0 ? readyOf(free) : heldReady.length > 0 ? readyOf(heldReady, true) : onHold.length > 0 ? readyOf(onHold) : null;
  // L1h-8 (v6.1.16 Task 15): the gap line the closing speaks to (its do offer, its rule, its step), else the first.
  const closed = tonight > 0 ? null : closingSetup({ ready: free.length, held: ready.length - free.length + heldInPerson, gaps: steps.length, firstRule, stepRule, firstStep });
  const target = free.length > 0 ? doOffer?.n : (doUsers?.program.n ?? firstRule ?? stepRule ?? undefined);
  const gapShown = steps.find((g) => g.n === target) ?? steps.find((g) => g.program_id === firstStep?.program_id)
    ?? steps.find((g) => g.n === doOffer?.n) ?? steps[0];
  // The row a rule Say names says its every step and its rule, so the rule the Say asks about is on screen.
  const ruleNamed = closingOf.offer === 'rule' ? steps.find((g) => g.n === (firstRule ?? stepRule)) : undefined;
  const stepAgent = (g: GapProgram): string => (oneStep(g) || g === ruleNamed ? gapLine(g, false, closed) : moreStepsLine(g));
  const stepBlock = (gs: GapProgram[]): Block | null => {
    if (gs.length === 0) return null;
    const said = gs.map((g) => gapSentence(g, { whole: g === ruleNamed, closed }));
    const agent = gs.map(stepAgent);
    const at = gs.indexOf(gapShown);
    return { ids: gs.map((g) => g.program_id), line: (i) => said[i], hide: (i) => agent[i], order: at < 0 ? gs.map((_, i) => i) : [at, ...gs.map((_, i) => i).filter((i) => i !== at)] };
  };
  const oneSteps = steps.filter(oneStep);
  const moreSteps = steps.filter((g) => !oneStep(g));
  const oneBlock = stepBlock(oneSteps);
  const moreBlock = stepBlock(moreSteps);
  // The More block keeps one row at the step rank only when it holds the row the closing speaks to.
  const shownInMore = moreSteps.includes(gapShown);
  const l = r.ledger;
  // L29-1 (v6.1.16 Task 15): the applications by name; the counts and totals are /me's and the JSON's.
  // Task 2 (v6.1.22): a program whose row says its earlier-round win leaves that win out of this line (said once).
  // Fix round 1 (I1): only a row the 10-line cap keeps on screen, so the line is settled after the fit (`appsAfter`).
  const earlierOnRow = new Set([...ready, ...steps].filter((p) => p.earlier_win !== undefined).map((p) => p.program_id));
  const apps = applicationsLine(r.applications ?? [], now);
  const appsAfter = (shownIds: string[]): string | null =>
    applicationsLine((r.applications ?? []).filter((a) => !(a.status === 'won' && earlierOnRow.has(a.program_id) && shownIds.includes(a.program_id))), now);
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
    // L38 big 3 (v6.1.18 Task 10): the one-step rows, then those with more to do; only the block holding the row the
    // closing speaks to keeps a row at rank 2.
    { block: oneBlock, lines: [], ...(shownInMore ? { rank: 5.7 } : { rank: 2, min: 1, grow: 5.7 }) },
    { block: moreBlock, lines: [], ...(shownInMore ? { rank: 2, min: 1, grow: 5.85 } : { rank: 5.85 }) },
    { lines: apps ? [apps] : [], rank: 3 },
    { lines: [plain(notSent)].filter((x): x is string => !!x), rank: 4 },
    { lines: started.map(plain).filter((x): x is string => !!x), rank: 5 },
    // L41-2 (v6.1.19): this agent's own fresh draft of a form the builder sends, at the started lines' rank.
    { lines: draftedLines(r), rank: 5 },
    { lines: [since ?? nothingNew].filter((x): x is string => !!x), rank: 6 },
    // L1i-2 (v6.1.16.1): the results question is asked once a day, so it stays ahead of what moved since.
    { lines: outcomeLines(r, now), rank: 5.8 },
    // L18-4 (v6.1.18 Task 4): the sent question beside the results question; its Say only when it is the reply's one.
    { lines: sent.map(plain).filter((x): x is string => !!x), rank: 5.8 },
    { lines: reportLines(r), rank: 5.5 },
    { lines: before ? [before] : [], rank: 5.55 },
    { lines: r.evidence_summary ? [r.evidence_summary.line] : [], rank: 13 },
    { lines: (l.results_soon ?? []).length > 0 ? [`Results due soon: ${listWords(l.results_soon!.map((x) => x.title), l.results_soon!.length)}.`] : [], rank: 14 },
    { lines: notes.length > 0 ? [repoNoteText(notes)] : [], rank: 8 },
    // v6.1.17: the line carrying the reply's only link (the unlink notice) outranks every line but the Say.
    { lines: notice ? [notice] : [], rank: notice && LINK.test(notice) ? 0 : 5.6 },
    // L46-9 (v6.1.20): when another line keeps the Say, the closing is a plain fact with no ask of its own.
    { lines: early ? [plainClosing(closingOf.text)].filter((x) => x !== '') : [], rank: 15 },
  ];
  // Every other block the full view lists, for the agent: the other ready blocks and the in-person lines.
  const rest = [
    ...(free.length > 0 && heldReady.length > 0 ? readyLines(heldReady, true) : []),
    ...((free.length > 0 || heldReady.length > 0) && onHold.length > 0 ? readyLines(onHold) : []),
    ...inPersonLines,
  ];
  // v6.1.20: the in-person programs are said in the Also sentence (no numbers), with the count the full list holds.
  const attendRows = [
    ...inPerson.map((p) => ({ ...p })),
    ...attendRules.map((g) => ({ ...g, long_shot: (g as { long_shot?: string | null }).long_shot ?? null, ...(ruleOnlyGap(g) ? { rule: [g.gap, ...g.also].map((x) => midSentence(x.what)).join('; ') } : {}) })),
  ];
  const attendIds = attendRows.map((x) => x.program_id);
  const readyIds = r.ready.map((p) => p.program_id);
  const stepIds = r.gaps.map((g) => g.program_id);
  const hiddenOf = (sh: string[]) => {
    const d = defaultRows(readyIds, stepIds, [...sh, ...attendIds]);
    return d.readyHidden + d.stepHidden;
  };
  // L18-1 (v6.1.18): the rows the rank cap left out are added once; the Also sentence names two closing this week.
  const capHidden = Math.max(0, o.hidden?.count ?? 0);
  const opening = openingSentence({ name: o.name, ready: free.length, held: heldReady.length, onHold: onHold.length, steps: steps.length, inPerson: attendCount, act: readyAct });
  const room = DEFAULT_LINES - (sayLine ? 1 : 0) - 1 - (attendRows.length > 0 ? 1 : 0);
  const once = fit(slots, room);
  const fitted = attendRows.length === 0 && hiddenOf(once.shown) + capHidden > 0 ? fit(slots, room - 1) : once;
  const { hidden, shown, rows } = fitted;
  // Fix round 1 (I1): the applications line drops an earlier-round win only when its row is shown; a line left empty goes.
  const settled = apps ? appsAfter(shown) : null;
  const kept = apps && settled !== apps ? fitted.kept.flatMap((l) => (l === apps ? (settled ? [settled] : []) : [l])) : fitted.kept;
  const left = hiddenOf(shown) + capHidden;
  // Task 7 (v6.1.18): by id, never by title (two programs may share one).
  const closingHidden = (o.hidden?.closing ?? []).filter((c) => !shown.includes(c.program_id) && !attendIds.includes(c.program_id)).map((c) => ({ ...c, title: shortTitle(c.title, o.shorts?.get(c.program_id)) }));
  const alsoLine = alsoSentence(attendRows, left, closingHidden, now);
  const text = paragraphs(opening, kept.slice(0, rows), alsoLine, kept.slice(rows), sayLine);
  return { text, offer, hidden: [...rest, ...hidden], shown: [...shown, ...attendIds], say: sayLine, more: left };
}

/** L46-2 (v6.1.20): the draft Say of a program on the screen, by its number. Pure. */
export const draftSay = (n: number, title: string): string => `Say ${n} and I draft ${title} for you to send.`;
/** L46-9 (v6.1.20): the closing as a plain fact when another line keeps the reply's one Say: "Tell me when X and I look
 *  again." reads "When X, I look again."; an ask with nothing else in it is left out. Pure. */
export const plainClosing = (text: string): string => {
  const t = withoutSay(text).replace(/^(Nothing is ready yet|Nothing remote is ready yet)\.\s*/, '');
  const when = /^Tell me when (.+) and I look again\.$/.exec(t);
  if (when) return `When ${when[1]}, I look again.`;
  return /\?$/.test(t) || /^(Tell|Send) me\b/.test(t) ? '' : t;
};

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
      const uses = blockUses(b, rows);
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
        kept.push(...idx.filter((j) => on.has(j)).map((j) => b.line(j)));
        shown.push(...idx.filter((j) => on.has(j)).map((j) => b.ids[j]));
        rows = kept.length;
      }
      hidden.push(...idx.filter((j) => !on.has(j)).map((j) => b.hide(j)));
      return;
    }
    kept.push(...s.lines.slice(0, k));
    hidden.push(...s.lines.slice(k).filter((x) => !/:$/.test(x)));
  });
  return { kept, hidden, shown, rows: shown.length > 0 ? rows : 0 };
}

/** The full view's in-person block heading (without its count). */
const IN_PERSON_HEAD = 'In person';

/** L1i-5 (v6.1.16.1): the full view's Say: the default view's, unless that asks about a rule the full view does not
 *  show; then the agent shows that program's rules on its number. Pure. */
export const FULL_RULE_SAY = 'Say a number and I show what that program asks.';
const fullSay = (say: string): string => {
  const fact = withoutSay(say);
  return /[Ss]ay \d+ if /.test(say) ? [fact, FULL_RULE_SAY].filter(Boolean).join(' ') : say;
};

/**
 * L29-26 (v6.1.16 Task 15): the full view ("say more", filter.all): each listed program as its number, name, money and
 * (L1i-6, v6.1.16.1) close and, outside the In person block (L1k-3, v6.1.18), in person, one per line, then what the repo read was and the link notice (`after`), then
 * the Say. No rule is asked here (L1i-5). L35-9 (v6.1.17): the rows sit under the default view's block headings
 * (`Ready to apply (6):`), each with its true count, in number order within a block; an empty block is left out. Pure.
 */
export function fullView(blocks: [string, (ReadyProgram | GapProgram)[]][], after: string[], say: string, closes?: Map<string, string>, name?: string | null): string {
  // v6.1.20: one opening, then runs with one-line lead-ins and no counts; the held ones say so on their row.
  const clause: Record<string, string> = { 'Being handled by your other agent': HELD_BY_OTHER, 'On hold until you say go': ON_HOLD };
  const line = (p: ReadyProgram | GapProgram, head: string) => {
    const when = closes?.get(p.program_id) || p.closes_in;
    const inPerson = p.in_person && head !== IN_PERSON_HEAD;
    return `${p.n}. ${p.title} (${[p.money, ...(when ? [`closes ${when}`] : []), ...(inPerson ? ['in person'] : [])].join(', ')})${clause[head] ? `, ${clause[head]}` : ''}.${earlierTail(p)}`;
  };
  const lead: Record<string, string> = { [NOT_READY_HEAD]: 'Not ready yet:', [IN_PERSON_HEAD]: 'In person:' };
  const runs = new Map<string, string[]>();
  for (const [head, ps] of blocks) {
    if (ps.length === 0) continue;
    const at = lead[head] ?? 'Ready:';
    runs.set(at, [...(runs.get(at) ?? []), ...[...ps].sort((a, b) => a.n - b.n).map((p) => line(p, head))]);
  }
  return paragraphs(`Everything open${name ? ` for ${name}` : ''}, nearest first:`, ...[...runs].map(([at, rows]) => [at, ...rows]), after, say);
}

// ---------------------------------------------------------------------------------------------------------------
// v6.1.20: the reply reads like a person. One opening sentence that says the state, one full sentence per program,
// one "Also" sentence for in person and the long tail, then one closing; blocks apart by blank lines. Pure.
// ---------------------------------------------------------------------------------------------------------------

/** v6.1.20: "1 program is" / "3 programs are". Pure. */
const programsAre = (n: number): string => `${n} program${n === 1 ? ' is' : 's are'}`;
/** v6.1.20: what a ready row's EarnKit does, its second sentence. */
export const READY_APPLY = 'I apply once you say yes.';
export const READY_DRAFT = 'I draft it for you to send.';
/** v6.1.20: a ready row the builder already said yes to. */
export const YES_STANDS = 'Your yes stands.';
/** v6.1.20: a ready row the standing approval sends. */
export const READY_STANDING = 'I send it under your standing approval.';
/** v6.1.20: the trailing clauses of a program someone else holds. */
export const HELD_BY_OTHER = 'started by your other agent';
export const ON_HOLD = 'on hold until you say go';
/** v6.1.20: the opening of the default find reply: the state, naming the project when a name was given. Pure. */
export function openingSentence(o: { name?: string | null; ready: number; held?: number; onHold?: number; steps: number; inPerson: number; act?: string | null }): string {
  const name = o.name?.trim() || null;
  const lead = (s: string) => (name ? `For ${name}, ${s}` : `${s.charAt(0).toUpperCase()}${s.slice(1)}`);
  // v6.1.20 polish (1): the action the rows share is said once, here.
  if (o.ready > 0) return lead(`${programsAre(o.ready)} ready to send now${o.act ? `; ${actFor(o.act, o.ready)}` : '.'}`);
  if ((o.held ?? 0) > 0) return lead(`${programsAre(o.held!)} ready, ${HELD_BY_OTHER}.`);
  if ((o.onHold ?? 0) > 0) return lead(`${programsAre(o.onHold!)} ready, ${ON_HOLD}.`);
  if (o.steps > 0) return `Nothing is ready to send${name ? ` for ${name}` : ''} yet. The closest:`;
  // v6.1.20 polish (5).
  if (o.inPerson > 0) return `Nothing you can send from here is ready${name ? ` for ${name}` : ''} yet.`;
  return nothingFits(name);
}
/** v6.1.20: the whole reply when nothing fits (no Say: EarnKit never writes first). Pure. */
export const nothingFits = (name?: string | null): string =>
  `Nothing fits${name ? ` ${name}` : ''} yet. Tell me more about it, or its repo link, and I look again.`;

/** v6.1.20: words that open a verb phrase: a step the builder takes reads "you to {step}". */
const VERB = /^(turn|set|commit|message|finalize|stake|sign|deploy|use|add|make|publish|open|sign|ship|build|move|put|get|run|tell|join|register|apply|submit|start|create|write|record|post|launch|integrate|send|attend|verify|host|list|enable|connect|fill|pick|choose|book|upload|share|link|complete|finish|have|give|be|keep|update|release|request|reach|form|file|pass|meet|show)\b/i;
/** v6.1.20: first words that read lower-case mid-sentence; a name (Base Builder Codes) keeps its capital. */
const COMMON = /^(A|An|The|Proof|Code|Real|Your|People|Public|Live|Users|Mainnet|At|One|Some|Applicant|Founders?|Teams?|Projects?|Open|Each|Every|No|Not|Only|Under|Over|Up|Built|New|Existing|Students?|Must|Is|Are|Will|Any|All|This|That|It|Its|Work|Funding|Must)\b/;
/** v6.1.20: a phrase as it reads mid-sentence: the first letter lowered when the first word is a common word. Pure. */
export const midSentence = (x: string): string => {
  const t = x.trim().replace(/\.+$/, '');
  return COMMON.test(t) || VERB.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
};
/**
 * v6.1.20: a gap or setup step as it reads after "needs": "real users", "the code in a public repo", "a demo video
 * link", "you to deploy the contract on Arc" (a verb phrase is the builder's to do). Pure.
 */
export function needWords(what: string): string {
  const t = midSentence(what);
  if (/^code in (a|a public) repo$/.test(t)) return `the ${t}`;
  return VERB.test(t) ? `you to ${t}` : t;
}
/** v6.1.20: the money in parentheses, with the close when the row carries one ("($25,000 award, closes in 6 days)"). Pure. */
export const moneyParen = (p: { money: string; closes_in?: string | null }, extra: string[] = []): string =>
  `(${[p.money, ...(p.closes_in ? [`closes ${p.closes_in}`] : []), ...extra].join(', ')})`;

/** v6.1.20: a ready program's sentence: "1. FLOSS/fund ($10,000 to $100,000). I apply once you say yes.". `click`: the
 *  builder presses submit; `needs`: answers the closing does not name; `steps`: setup steps the closing does not name. Pure. */
type ReadyOpts = { click?: boolean; needs?: string[]; steps?: string[]; alone?: boolean; standing?: boolean; stands?: boolean; quiet?: string | null };
/** v6.1.20: what EarnKit does for a ready row (the second sentence), as `readySentence` would say it. Pure. */
export function readyAction(p: ReadyProgram, o: ReadyOpts = {}): string {
  if (p.claimed_since || p.held) return '';
  if (o.stands) return YES_STANDS;
  if ((o.needs ?? []).length > 0 || (o.steps ?? []).length > 0) return 'once';
  return o.standing ? READY_STANDING : p.agent_step ? MANIFEST_LINE : o.click ? READY_DRAFT : READY_APPLY;
}
/** v6.1.20 polish (1): the opening's action for `n` ready rows ("I draft them for you to send."). Pure. */
const actFor = (act: string, n: number): string =>
  n === 1 ? act : act.replace('I draft it for you to send.', 'I draft them for you to send.').replace('I send it under', 'I send them under');
/** L47-6 (v6.1.22): a row's earlier-round win as its own sentence after the row, or nothing. Pure. */
const earlierTail = (p: { earlier_win?: string | null }): string => (p.earlier_win === undefined ? '' : ` ${EARLIER_WIN(p.earlier_win)}`);
export function readySentence(p: ReadyProgram, o: ReadyOpts = {}): string {
  return `${readyRow(p, o)}${earlierTail(p)}`;
}
function readyRow(p: ReadyProgram, o: ReadyOpts = {}): string {
  const head = `${o.alone ? '' : `${p.n}. `}${p.title} ${moneyParen(p)}`;
  if (p.claimed_since) return `${head}, ${HELD_BY_OTHER}.`;
  if (p.held) return `${head}, ${ON_HOLD}.`;
  // The builder already said yes to it: the closing says what follows.
  if (o.stands) return o.quiet === YES_STANDS ? `${head}.` : `${head}. ${YES_STANDS}`;
  const act = o.standing ? READY_STANDING : p.agent_step ? MANIFEST_LINE : o.click ? READY_DRAFT : READY_APPLY;
  if (o.quiet && o.quiet === act && (o.needs ?? []).length === 0 && (o.steps ?? []).length === 0) return `${head}.`;
  const needs = o.needs ?? [];
  const steps = o.steps ?? [];
  // L46-6 (v6.1.20): two answers named at most; the rest are asked after the yes.
  const before = [...steps.map((s) => `you ${midSentence(s)}`), ...(needs.length > 0 ? [`you give ${joinAnd(needs.slice(0, ASKED_AT_ONCE))}`] : [])];
  if (before.length === 0) return `${head}. ${act}`;
  return `${head}. Once ${joinAnd(before)}, ${lowerFirst(act.replace(/ once you say yes\.$/, ' on your yes.'))}`;
}

/** v6.1.20: what a gap row asks, in order, as words: real gaps, setup steps, then rules (rules apart). Pure. */
function askedOf(g: GapProgram, closed: string | null = null): { needs: string[]; rules: string[]; own: string[] } {
  const all = [g.gap, ...g.also];
  const real = all.filter((x) => x.kind !== 'rule');
  const own = real.filter(readingGap).map((x) => x.what);
  const gaps = real.filter((x) => !readingGap(x)).map((x) => needWords(x.what));
  const setup = [...all.flatMap((x) => (x.setup ? [x.setup] : [])).filter((x) => x !== closed), ...g.setup].map(needWords);
  return { needs: [...gaps, ...setup], rules: all.filter((x) => x.kind === 'rule').map((x) => midSentence(x.what)), own };
}
/** v6.1.20: the own sentences after a gap row: the proof still being read, a step looked for again. Pure. */
const afterGap = (g: GapProgram, own: string[]): string => `${own.map((x) => ` ${x.replace(/\.?$/, '.')}`).join('')}${lookedAgainSentences(g)}`;
/**
 * v6.1.20: a step row of the default view, one sentence: one rule ("needs one yes from you: {rule}."), one gap ("needs
 * {gap} first."), several ("needs {first}, then {k} more steps."); `whole`: the row the rule Say names, every step and
 * the rule on screen. Pure.
 */
export function gapSentence(g: GapProgram, o: { whole?: boolean; closed?: string | null } = {}): string {
  return `${gapRow(g, o)}${earlierTail(g)}`;
}
function gapRow(g: GapProgram, o: { whole?: boolean; closed?: string | null } = {}): string {
  const head = `${g.n}. ${g.title} ${moneyParen(g)}`;
  const { needs, rules, own } = askedOf(g, o.closed ?? null);
  const yes = rules.length > 0 ? `one yes from you: ${rules.join('; ')}` : '';
  if (needs.length === 0 && rules.length > 0) return `${head} needs ${yes}.${afterGap(g, own)}`;
  if (needs.length === 0) return `${head}.${afterGap(g, own)}`;
  if (o.whole && rules.length > 0) return `${head} needs ${joinGaps(needs)} first, and ${yes}.${afterGap(g, own)}`;
  const more = needs.length - 1 + rules.length;
  if (more === 0) return `${head} needs ${needs[0]} first.${afterGap(g, own)}`;
  return `${head} needs ${needs[0]}, then ${more} more step${more === 1 ? '' : 's'}.${afterGap(g, own)}`;
}
/** v6.1.20: the one-program reply's state sentence for a gap: "It needs {a}, {b} and your yes that {rule}.". Pure. */
export function gapState(g: GapProgram, closed: string | null = null): string {
  const { needs, rules, own } = askedOf(g, closed);
  const tail = afterGap(g, own);
  if (g.in_person) {
    const n = needs.length > 0 ? ` It needs ${joinGaps(needs)}.` : '';
    const r = rules.length > 0 ? ` It needs one yes from you: ${rules.join('; ')}.` : '';
    return `You attend in person.${n}${r}${tail}`;
  }
  if (needs.length === 0 && rules.length > 0) return `It needs one yes from you: ${rules.join('; ')}.${tail}`;
  if (needs.length === 0) return tail.trim();
  if (rules.length === 0 && needs.length === 1) return `It needs ${needs[0]} first.${tail}`;
  return `It needs ${joinGaps([...needs, ...rules.map((r) => `your yes that ${r}`)])}.${tail}`;
}
/** v6.1.20: the one-program reply's head: "{title} ({money}, closes ...)." Pure. */
export const oneHead = (title: string, money: string, when?: string | null): string => `${title} (${[money, ...(when ? [when] : [])].join(', ')}).`;
/** v6.1.22 (live check): the one-program reply for a ready program, one terse sentence: "{title} ({money}) is ready to
 *  send." (a plain apply, the standing approval), "{title} ({money}) is ready: {what EarnKit does}" (its own action: the
 *  funding file, a draft), "{title} ({money}) is ready, and your yes stands.". Pure. */
export function readyState(p: ReadyProgram, o: { click?: boolean; needs?: string[]; standing?: boolean; stands?: boolean } = {}): string {
  const head = oneHead(p.title, p.money, p.closes_in ? `closes ${p.closes_in}` : null).replace(/\.$/, '');
  // The builder already said yes: the closing says what follows.
  if (o.stands) return `${head} is ready, and your yes stands.`;
  // Review M2: under the standing approval the closing says what happens; the state is only that it is ready.
  if (o.standing) return `${head} is ready to send.`;
  const act = p.agent_step ? MANIFEST_LINE : o.click ? READY_DRAFT : null;
  const needs = (o.needs ?? []).map(bare);
  const give = needs.length > 0 ? ` You give your ${joinAnd(capped(needs))}.` : '';
  return act ? `${head} is ready: ${lowerFirst(act)}${give}` : `${head} is ready to send.${give}`;
}
/** v6.1.20: an in-person program's own reply: head, "You attend in person.", the odds, then what it needs. Pure. */
export function inPersonState(p: ReadyProgram): string {
  const line = attendLine({ ...p, n: 0 }, true);
  // The attend line's own sentences after its head: the odds and what it needs ("Needs ..." reads "It needs ...").
  const rest = line.slice(`${p.title}, ${p.money}${p.closes_in ? `, closes ${p.closes_in}` : ''}.`.length)
    .replace(/ Attend in person\./, '').replace(/ First: (\S+)/, (m, w: string) => (VERB.test(w) ? ` First, you ${w}` : m)).replace(/ Needs /g, ' It needs ');
  return `${oneHead(p.title, p.money, p.closes_in ? `closes ${p.closes_in}` : null)} You attend in person.${rest}${p.claimed_since ? ` It is ${HELD_BY_OTHER}.` : ''}`;
}

/** v6.1.20: an in-person row in the Also sentence: "Y Combinator Winter 2027 Batch ($500,000)". Pure. */
const alsoRow = (p: { title: string; money: string; closes_in?: string | null; claimed_since?: string }, rule?: string): string =>
  `${p.title} (${[moneyFigure(p.money), ...(p.closes_in ? [`closes ${p.closes_in}`] : []), ...(p.claimed_since ? [HELD_BY_OTHER] : []), ...(rule ? [`one yes from you: ${rule}`] : [])].join(', ')})`;
/**
 * v6.1.20: the one "Also" sentence: the in-person programs ("Also open: A ($x) and B ($y), in person with long odds"),
 * then the count left for the full list and what of it closes this week; "Also:" when only the count is left; null when
 * there is nothing to add. Pure.
 */
export function alsoSentence(attend: { title: string; money: string; closes_in?: string | null; claimed_since?: string; long_shot?: string | null; rule?: string }[], more: number, closing: ClosingHidden[] = [], now: Date = new Date()): string | null {
  // v6.1.20 polish (2): two short sentences: the in-person programs, then the tail and what of it closes this week.
  const named = [...closing].sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at)).slice(0, CLOSING_NAMED);
  const tail = more > 0 ? [`${more} more in the full list`, ...named.map((c) => `${c.title} closes ${closingIn(c, now)}`)].join('; ') : '';
  if (attend.length === 0) return tail ? `Also: ${tail}.` : null;
  const odds = attend.every((x) => !!x.long_shot) ? ' with long odds' : '';
  const head = `Also open: ${joinAnd(attend.map((x) => alsoRow(x, x.rule)))}, ${attend.length === 2 ? 'both ' : ''}in person${odds}.`;
  return tail ? `${head} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.` : head;
}
/** v6.1.20: "in 6 days", "tomorrow", "today", "in under an hour". Pure. */
const closingIn = (c: ClosingHidden, now: Date): string => {
  const w = closingWords(c, now);
  return /^(tomorrow|today)$/.test(w) || /^[A-Z]/.test(w) ? w : `in ${w}`;
};

/** v6.1.20: the opening and the closing say "nothing is ready", so the closing drops its own. Pure. */
export const closingAfterOpening = (text: string): string => {
  const t = text.replace(/^(Nothing is ready yet|Nothing remote is ready yet)\.\s*/, '');
  return t === '' ? FULL_RULE_SAY : t;
};
/** v6.1.20: lines joined with a blank line between groups, empty groups left out. Pure. */
export const paragraphs = (...groups: (string | null | undefined | string[])[]): string =>
  groups.map((g) => (Array.isArray(g) ? g.filter((x) => x != null).join('\n').replace(/^\n+|\n+$/g, '') : g ?? '')).filter((g) => g !== '').join('\n\n');
/** v6.1.20: the lines a reply counts against its budget: blank lines do not count. Pure. */
export const countedLines = (text: string): number => text.split('\n').filter((l) => l.trim() !== '').length;

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
  const all = (problems ?? []).filter((p) => p !== READS_PAUSED && p !== EVIDENCE_NOT_READ && p !== NO_RECORD_PROJECT);
  // L45-12 (v6.1.19): a chain no program asks for is said apart, with nothing to correct.
  const kept = all.filter(isChainKept);
  const dropped = all.filter((p) => !isChainKept(p));
  const lines = [...(dropped.length > 0 ? [`Some project facts were dropped: ${dropped.join('; ')}. Send them corrected next time.`] : []), ...(kept.length > 0 ? [`${kept.join('; ').replace(/^c/, 'C')}.`] : [])];
  return lines.length > 0 ? lines.join(' ') : null;
}

/** Fix round 1 (M2, v6.1.16 Task 12): the full list's style line. */
export const FULL_LIST_STYLE_NOTE = 'Fit approved answers by cutting, never by adding. Call find with program_id for a field\'s style before drafting it.';

export function agentNote(r: R, o: { more: number; description?: 'readme' | 'none' | null; hidden?: string[]; all?: boolean; say?: string }): string {
  // L29-29 (v6.1.16 Task 15): only the lines that apply; an empty reply has a one-line note.
  const sentAsked = sentNote(r);
  if (r.ready.length === 0 && r.gaps.length === 0)
    return ["Show find's reply as given. Nothing is listed for this project now; pass users, live_url and chains whenever you know them, and call find again when the builder asks.", ...(sentAsked ? [sentAsked] : [])].join('\n');
  const tonightIds = tonightIn(r).list.map((t) => t.program_id);
  const lines = [
    // Task 2 (v6.1.22, from Task 4): the same translate clause as the server instructions.
    "Show find's reply as given, translated into the builder's language when they write in another one; shorten if you must, keep money first and the last action. No emojis, no em dashes, no invented facts.",
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
  // L46-6 (v6.1.20): the builder text asks two things by name; the agent asks the rest after the yes, one at a time.
  const asks = [...new Set(sendableOf(r).flatMap((p) => p.need_you))];
  if (asks.length > ASKED_AT_ONCE) lines.push(`The yes asks for ${asks.slice(0, ASKED_AT_ONCE).join(' and ')} by name; after it, ask the builder for the rest one message at a time: ${asks.slice(ASKED_AT_ONCE).join('; ')}.`);
  if (r.ready.some((p) => p.in_person) || r.gaps.some(attendGap))
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
  // L36-13 (v6.1.18): the demo video link goes in the project.
  if (r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'demo_video'))) lines.push(DEMO_NOTE);
  // L29-19 (v6.1.16 Task 15): one way.
  if (r.gaps.some((g) => [g.gap, ...g.also].some((x) => x.kind === 'users' && x.effort === 'hours')))
    lines.push(`"Do real people use it" is a question, not work: ask the builder once. ${USERS_NOTE}${o.say !== undefined && isDoUsersSay(o.say) ? ` ${DO_USERS_NOTE}` : ''}`);
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
  // L18-4 (v6.1.18 Task 4): the sent question's answer is the agent's to record.
  if (sentAsked) lines.push(sentAsked);
  if (r.not_sent && r.not_sent.programs.length > 0)
    lines.push(`Nothing was sent for ${r.not_sent.programs.map((p) => p.title).join(', ')} after the standing-approval line named them; on the builder's yes, send them now within the limits.`);
  // Fix round 1 (M2): the full list's fields carry no style (L26-4); the program's own find has it.
  if (r.linked) lines.push(o.all ? FULL_LIST_STYLE_NOTE : 'Fit approved answers by cutting, never by adding; the style contract travels on each field.');
  if (r.record_missing.length > 0)
    lines.push('Ask for the missing record items once, all together, and save each with record. record_missing names only what these programs need; record get names everything the record lacks.');
  if (r.ready.some((p) => p.claimed_since)) lines.push('A ready program with claimed_since is claimed by another of the builder\'s agents: do not submit it.');
  // L23-7 (v6.1.16): by title, as the builder's lines name them.
  // L36-2 (v6.1.18 Task 4): a builder-sent program's claim is kept and asked about (sentNote), never released.
  const freed = r.released.filter((p) => !p.ask);
  if (freed.length > 0) lines.push(`Claims left unsent for 24 hours were released: ${freed.map((p) => p.title).join(', ')}.`);
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
