import { GTM_ONE_LINE, closeWords, hoursLeft, isGtm, programName } from './conversation';
import { BUILDER_CODES_GUIDE } from './bench-reply';
import { investorWorth, longShotWorth, type ReadyProgram } from './ready-set';
import { timeLeftWords } from './deadline';
import { usdCompact } from './pool';
import { CHAIN_NAMES, type Chain } from './chains';

/*
 * v4.10 Task 3 (R5, R6, R7): the ready set's words, from the owner-approved target conversation (section A). Pure
 * copy: Task 4 wires it into find. Nothing here says a program was sent or submitted; "sent" is the builder's word.
 */
/** The one ask at the end of the opener (the gate's easyReply takes it as an easy reply). */
export const READY_ASK = 'Reply yes and I\'ll finish and open each one for you to submit, or tell me the numbers to skip.';

/**
 * v4.10 Task 4 (R4): find's note on the opener (exact). The agent drafts every program's answers before showing it.
 */
export const READY_NOTE =
  'Before you show this, write each program\'s remaining answers from the record in this result. Never invent facts. Keep them for the builder\'s yes; on yes call prepare for each program with those answers. Show show_to_builder only after that.';
/**
 * v4.10.2 Task 1 (owner answer 2): how an ask the builder answers in one line (one_line: the 3-month plan) becomes the
 * form's answer: the agent writes it out from that line and the record only.
 */
const EXPAND = "is the builder's one line: write the form's full answer from that line and the record only, adding no facts, and show it for them to check.";
export const ONE_LINE_NOTE = `An answer marked one_line (expand) ${EXPAND}`;
/** v4.10.2 Task 1 fix round 1: the same instruction on the path's draft, whose GTM blank is GTM_ONE_LINE. */
export const PLAN_ONE_LINE_NOTE = `Their 3-month plan ${EXPAND}`;
/** v4.10 Task 4 (R8): how the opener's ask is answered (never shown). */
export const READY_ASK_NOTE =
  "A yes, a no or the numbers to skip: call tell with move_up: { kind: 'ready', project_key, answer: 'yes' } (a no: answer 'no'; numbers: answer 'skip' with skip: [the numbers], 1-based). If they also give what the set asks of them (ready.programs[].asks, each asked once across the set, at most 4), split their words by field into answers: { [kind]: their words } (contact: { [slot]: their words } for the slots it lists); blanks only when they can't be split. If they ask to start a program in ready.also_open, call prepare with its id. Don't show this note.";
/** v4.10 Task 4 (decision a): the yes's note, with ready.open (exact). The server never writes the free-text answers. */
export const READY_YES_NOTE =
  `Call prepare for each program in ready.open with the answers you drafted and its prefilled answers as given, then show each kit's link and paste-ready answers under show_to_builder. ${ONE_LINE_NOTE.replace(' (expand)', ' (its expand list)')}`;
/** v4.10 Task 4: the note once the pages are open: "sent" is the builder's word, for some or all of them. */
export const READY_SENT_NOTE =
  "Only when they say an application is in (\"sent\", \"submitted\"), call tell with move_up: { kind: 'ready', project_key, answer: 'sent' } (only some: add sent_ids with those program ids). A plain ok or yes is not sent. Don't show this note.";
/**
 * v4.10 Task 4 (R5): the note while programs wait on what only the builder can give. Final fix (I1): their one reply,
 * split by field (ready.need.asks), answers every program that asks it.
 */
export const READY_NEEDS_NOTE =
  "Their answers to what the programs need (only theirs, never yours): split their one reply by field (ready.need.asks) and call tell with move_up: { kind: 'ready', project_key, answer: 'yes', answers: { [kind]: their words for it } } (contact: { [slot]: their words } for the slots it lists); blanks: their whole reply, only when it can't be split. Don't show this note.";
/** v4.10 Task 4: the second plain find in a session, while the opener's ask waits: its last sentence. */
export const READY_AGAIN_ASK = "Reply yes and I'll finish them.";
/** v4.10.1 Task 2: a set program as the repeat replies name it (bench-find.ts builds these from the live cards). */
export type AgainProgram = Pick<ReadyProgram, 'title' | 'amount' | 'ends_at' | 'zone' | 'kind'> & Partial<Pick<ReadyProgram, 'step' | 'needs'>>;
/**
 * v4.10.3 fix round 1 (2): an investor program's money as the ready replies say it, in the word the head's worth uses
 * (worthClause: "a $1M accelerator", pool.ts openMoneyWords' convention): "up to $1M, an accelerator"; no amount, "an
 * accelerator". Pure.
 */
const investorMoney = (amount: string | null) => (amount ? `${amount}, an accelerator` : 'an accelerator');
/** v4.10.1 Task 2: one program's line: "- a16z: up to $1M, an accelerator, closes in 19 hours." (the hours only under 48). */
function againLine(p: AgainProgram, now: Date, state: string | null): string {
  const money = p.kind === 'investor' ? investorMoney(p.amount) : p.amount;
  const hours = p.ends_at ? hoursLeft(p.ends_at, now) : null;
  const facts = [money, hours ? `closes ${hours}` : null].filter(Boolean).join(', ');
  return `- ${shortName(p.title)}${facts ? `: ${facts}` : ''}.${state ? ` ${state}` : ''}`;
}
/** v4.10.1 Task 2: what a program still owes in the repeat reply: what only the builder can give, a step, or ready. */
const againState = (p: AgainProgram, hosted: boolean) => (p.needs ? `Needs ${p.needs} first.` : p.step === 'codes' ? `${codesLine(hosted)}.` : 'Ready.');
/**
 * v4.10 Task 4: the ready status (a later plain find in the session never repeats the opener). v4.10.1 Task 2: each
 * open program on its own line, with its money, its hours left under 48 and what it still needs; "still ready" only
 * when none needs anything from the builder. Then READY_AGAIN_ASK. Pure.
 */
export function readyAgain(set: readonly AgainProgram[], now: Date, hosted = false): string {
  const n = set.length;
  const ready = set.every((p) => !p.needs);
  const head = ready ? (n === 1 ? 'Your application is still ready:' : `Your ${n} applications are still ready:`)
    : n === 1 ? "Here's where your application stands:" : `Here's where your ${n} applications stand:`;
  const lines = set.map((p) => againLine(p, now, againState(p, hosted)));
  return `${head}\n${lines.join('\n')}\n\n${n === 1 ? "Reply yes and I'll finish it." : READY_AGAIN_ASK}`;
}

/** "Base", "a16z", "Circle": the first word of the program's name. */
export const shortName = (title: string): string => programName(title).split(/\s+/)[0];

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
/** "A", "A and B", "A, B and C". */
const list = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** Final fix (I1): "your team list, usage numbers and demo video"; past `max`, "... and 2 more". Pure. */
export function needsList(phrases: readonly string[], max = 3): string {
  const own = phrases[0]?.startsWith('your ');
  const xs = phrases.map((p, i) => (i > 0 && own ? p.replace(/^your /, '') : p));
  return xs.length <= max ? list(xs) : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
}
const third = (verb: string) => (verb === 'have' ? 'has' : /(?:s|x|ch|sh)$/.test(verb) ? `${verb}es` : `${verb}s`);

/**
 * A long shot's line: the fit-cell reason ("they look for apps on Arc") with the program named, else a bare long shot.
 * v4.10 Task 4 (decision d): `lead` is the step's own words when one waits ("Ready once I add Builder Codes (...)").
 */
function longShotLine(p: ReadyProgram, lead = 'Ready', but = 'but'): string {
  if (!p.why) return `${lead}, ${but} it's a long shot.`;
  const why = p.why.replace(/^they (\w+)/i, (_, verb: string) => `${shortName(p.title)} ${third(verb.toLowerCase())}`);
  return `${lead}, ${but} ${why}, so it's a long shot.`;
}
const codesLine = (hosted: boolean) =>
  hosted ? `Ready once you add Builder Codes (https://${BUILDER_CODES_GUIDE})` : 'Ready once I add Builder Codes (10 minutes, I\'ll do it)';

/**
 * v4.10 Task 4 (R5, decision f): what a builder-only field asks for, as a short noun phrase for "Needs {it} first."
 * ("your team list", "your pitch video"), from the field's kind, else its todo or label. Pure.
 */
export function needsPhrase(r: { key: string; label: string; kind?: string; todo?: string }): string {
  const byKind: Record<string, string> = {
    team: 'your team list', demo_video: 'your demo video', pitch_video: 'your pitch video', traction: 'your usage numbers', raised: "any money you've raised",
  };
  if (r.kind && byKind[r.kind]) return byKind[r.kind];
  // v4.10.2 Task 1 (R2, owner answer 2): the Builder Code is the builder's own, from base.dev; the plan is one line.
  if (/builder code/i.test(`${r.key.replace(/_/g, ' ')} ${r.label}`)) return 'your Base Builder Code (from base.dev)';
  if (isGtm(r)) return GTM_ONE_LINE;
  const raw = (r.todo ?? r.label).trim().replace(/[.?:]+$/, '');
  // v4.10.1 Task 1: a todo is already sentence case ("your Circle and Arc integrations"); a label's first letter is lowered.
  const lower = (x: string) => (r.todo ? x : `${x.charAt(0).toLowerCase()}${x.slice(1)}`);
  // v4.10.1 Task 1: "how it makes money today" and "the credits you want" read as they are, never "your how ...".
  if (/^(?:the|how|what|which|why|where|when|who)\s/i.test(raw)) return lower(raw);
  return `your ${lower(raw.replace(/^(?:a|an|your)\s+/i, ''))}`;
}

/** v4.10.1 Task 1 (R2): a contact slot's word (coach.ts slotOf), in the slots' order; else the field's own label. */
const SLOT_WORDS: [string, string][] = [
  ['name', 'name'], ['email', 'email'], ['telegram', 'Telegram'], ['discord', 'Discord'], ['farcaster', 'Farcaster'],
  ['x', 'X handle'], ['github', 'GitHub'], ['profile', 'profile link'], ['live', 'website'], ['demo', 'demo link'],
];
const slotRank = (slot: string) => {
  const i = SLOT_WORDS.findIndex(([s]) => s === slot);
  return i < 0 ? SLOT_WORDS.length : i;
};
/**
 * v4.10.1 Task 1 (R2): the contact details a set still needs, as one item that names them: one slot "your email";
 * more "your contact details (name, email and Telegram)", in the slots' order, each once. Pure.
 */
export function contactPhrase(slots: readonly { slot: string; label: string }[]): string {
  const seen = [...new Map(slots.map((s) => [s.slot, s])).values()].sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
  const words = seen.map((s) => SLOT_WORDS.find(([k]) => k === s.slot)?.[1] ?? s.label.trim().replace(/[.?:]+$/, '').toLowerCase());
  return words.length === 1 ? `your ${words[0]}` : `your contact details (${list(words)})`;
}

/** What a program's line says after its money: ready, ready once a step is done, or what the builder must bring. */
function stateOf(p: ReadyProgram, hosted: boolean): string {
  // v4.10 Task 4 (R5): what only the builder can give is named first; that program waits for it.
  // Fix 1 (M3): a long shot keeps its label and reason ("so it's a long shot").
  if (p.needs) return p.kind === 'long_shot' ? longShotLine(p, `Needs ${p.needs} first`, 'and') : `Needs ${p.needs} first.`;
  if (p.kind === 'long_shot') return longShotLine(p, p.step === 'codes' ? codesLine(hosted) : 'Ready');
  if (p.step === 'codes') return `${codesLine(hosted)}.`;
  return 'Ready.';
}

/** One numbered line of the opener: "1. Base Builder Grant: up to $5,000. Ready once I add Builder Codes (...)." */
export function readyLine(p: ReadyProgram, n: number, hosted: boolean, now: Date): string {
  const name = programName(p.title);
  if (p.kind === 'investor') {
    // v4.10 Task 4 (decision g): no amount stated, the kind alone. v4.10.3 fix round 1 (2): the head's word, "accelerator".
    const money = investorMoney(p.amount);
    const closes = p.ends_at ? `, closes ${closeWords(p.ends_at, p.zone, now)}` : '';
    return `${n}. ${name}: ${money}${closes}. ${stateOf(p, hosted)}`;
  }
  return `${n}. ${name}: ${p.amount ? `${p.amount}. ` : ''}${stateOf(p, hosted)}`;
}

/**
 * v4.10.1 Task 2 (R3): the opener head's money: ", worth up to $1M, plus a $100K long shot" (`worth`: worthUpTo, long
 * shots left out). v4.10.3 Task 1 (R1): investor programs are left out of the worth too and said apart, by the kind the
 * money figure names them (pool.ts openMoneyWords: an investment is an accelerator): ", worth up to $5K, plus a $1M
 * accelerator and a $100K long shot". A set of those only: ", a $100K long shot" (", $150K in long shots"); no number
 * at all: nothing, never "$0". Pure.
 */
export function worthClause(set: readonly Pick<ReadyProgram, 'kind' | 'max_usd'>[], worth: string | null): string {
  const long = longShotWorth(set);
  const inv = investorWorth(set);
  const apart = [
    inv ? (inv.n === 1 ? `a ${inv.usd} accelerator` : `${inv.usd} in accelerators`) : null,
    long ? (long.n === 1 ? `a ${long.usd} long shot` : `${long.usd} in long shots`) : null,
  ].filter((x): x is string => Boolean(x));
  const said = list(apart);
  if (worth) return `, worth up to ${worth}${said ? `, plus ${said}` : ''}`;
  if (!said) return '';
  return set.every((p) => p.kind === 'long_shot' || p.kind === 'investor') ? `, ${said}` : `, including ${said}`;
}

/**
 * v4.10.3 Task 1 (R2): a grant total as the money line says it: in full under $100K ("$5,000", as a program's own
 * "up to $5,000"), else usdCompact ("$105.5K", rounded down so it never overstates). Pure.
 */
export const grantMoney = (usd: number) => (usd < 100_000 ? `$${Math.floor(usd).toLocaleString('en-US')}` : usdCompact(usd));
/** v4.10.3 Task 1 (R1): the investor program the money line names (ready-set.ts namedInvestor). */
export type NamedInvestor = { title: string; max_usd: number | null; ends_at: string };
/**
 * v4.10.3 Task 1 (R1, R2, owner answer 1): the also-open lead's money line, first: "Open for you now: up to $5,000 in
 * grants plus a $400K accelerator. Alliance closes in 15 days." `grantUsd` is the grant total the builder could pursue
 * (ready-set.ts grantTotal: never an investor program or a long shot); `investor` the one investor program closing
 * within INVESTOR_NAME_MS, with its own amount and kind ("an accelerator" with no number) and its close (deadline.ts
 * timeLeftWords: the hours under 48). No grant money: the investor clause alone; neither: null, never "$0". Pure.
 */
export function alsoMoneyLine(grantUsd: number, investor: NamedInvestor | null, now: Date): string | null {
  const when = investor ? timeLeftWords(investor.ends_at, now) : null;
  // Final fix (F8): "accelerator" is hardcoded because today's only investor program that can close within
  // INVESTOR_NAME_MS is an accelerator (Alliance). Deriving the kind word from the program (fund, accelerator, ...) is
  // carried to v4.10.4.
  const inv = investor && when ? (investor.max_usd && investor.max_usd > 0 ? `a ${usdCompact(investor.max_usd)} accelerator` : 'an accelerator') : null;
  const close = inv ? ` ${shortName(investor!.title)} closes ${when}.` : '';
  if (grantUsd > 0) return `Open for you now: up to ${grantMoney(grantUsd)} in grants${inv ? ` plus ${inv}` : ''}.${close}`;
  return inv ? `Open for you now: ${inv}.${close}` : null;
}

/**
 * v4.10.2 Task 1 (R1): a program left out of the set for the answers it needs, said as a statement (the set's ask stays
 * the one easy reply): "Also open: Base Builder Grant, up to $5,000, needs 11 answers from you. Say "start Base"
 * anytime." Null with none. Pure.
 */
export function readyAlsoLine(out: readonly { title: string; amount: string | null; answers: number }[]): string | null {
  if (out.length === 0) return null;
  const one = (p: (typeof out)[number]) => `${programName(p.title)}${p.amount ? `, ${p.amount},` : ''} needs ${p.answers} answer${p.answers === 1 ? '' : 's'} from you.`;
  const say = list(out.map((p) => `"start ${shortName(p.title)}"`));
  return `Also open: ${out.map(one).join(' ')} Say ${say} anytime.`;
}

/**
 * v4.10.2 Task 5: with no set (nothing fits one reply) and no path move, the quiet reply leads with the top program left
 * out (alsoLead*): its money and its answers, then ALSO_START_ASK (its yes is the path's draft stage). A repeat find this
 * session says ALSO_AGAIN_ASK alone, the same facts in the easy reply, so it repeats as the pending ask.
 * v4.10.3 Task 1 (R3, owner answer 3): both name the draft's first round (`round`: bench-find.ts pathRound's ask
 * phrases, at most 4 answers, `n` of them), and how many come after it, so a yes can carry those answers. Pure.
 */
const answersWords = (n: number) => `${n} answer${n === 1 ? '' : 's'} from you`;
/** v4.10.3 Task 1 (R3): the also-open lead's first round: its ask phrases and how many answers they are. */
export type LeadRound = { asks: readonly string[]; n: number };
const roundList = (r: LeadRound) => needsList(r.asks, r.asks.length);
export function alsoLeadLine(title: string, amount: string | null, answers: number, round?: LeadRound | null): string {
  const head = `${programName(title)} ${amount ? `pays ${amount}` : 'is open'} and needs ${answersWords(answers)}`;
  if (!round || round.asks.length === 0) return `${head}.`;
  const rest = answers - round.n;
  if (rest <= 0) return `${head}: ${roundList(round)}.`;
  return `${head}. The first${round.n === 1 ? '' : ` ${round.n}`}: ${roundList(round)}, and ${rest} more after these.`;
}
export const ALSO_START_ASK = 'Want me to start it?';
/**
 * v4.10.3 fix round 1 (6): a round phrase that would turn the yes/no into an open question or a choice ("how it makes
 * money today", "what ...", "... or ..."): the repeat then says the round's count instead of its asks. Pure.
 */
const OPEN_PHRASE = /^(?:how|what|which|who|why|where|when)\b|\bor\b/i;
export function alsoAgainAsk(title: string, amount: string | null, answers: number, round?: LeadRound | null): string {
  const facts = `${amount ? `${amount}, ` : ''}${answersWords(answers)}`;
  if (!round || round.asks.length === 0) return `Want me to start ${programName(title)} (${facts})?`;
  if (round.asks.some((a) => OPEN_PHRASE.test(a.replace(/^your\s+/i, '')))) {
    return `Want me to start ${programName(title)} (${amount ? `${amount}, ` : ''}${round.n} answer${round.n === 1 ? '' : 's'} to start)?`;
  }
  const rest = answers - round.n;
  return `Want me to start ${programName(title)} (${facts}${rest > 0 ? ', starting with' : ':'} ${roundList(round)})?`;
}

/**
 * v4.10.2 Task 2 (R3): the programs left out as not eligible (their rule requires a chain the project doesn't use), in
 * one plain statement, never a question (the set's ask stays the one easy reply): "Circle Developer Grants is only for
 * an app on Arc, so it doesn't fit EarnKit yet." Null with none. Pure.
 */
/** "Arc", "Arc or Tempo": the chains as a builder reads them. Pure. */
const chainsOr = (xs: readonly string[]) => {
  const names = xs.map((c) => (Object.hasOwn(CHAIN_NAMES, c) ? CHAIN_NAMES[c as Chain] : c));
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
};
export function readyNotEligibleLine(out: readonly { title: string; chains: readonly string[] }[], project: string): string | null {
  if (out.length === 0) return null;
  const or = chainsOr;
  const parts = out.map((p, i) => `${programName(p.title)}${i === 0 ? ' is only' : ''} for an app on ${or(p.chains)}`);
  const said = parts.length < 2 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
  return `${said}, so ${out.length === 1 ? "it doesn't" : "they don't"} fit ${project} yet.`;
}

/**
 * v4.10.2 Task 2 fix round 1 (2): the builder picked a not-eligible program by name: why, in one plain statement, said
 * above the path's move: "Circle Developer Grants only takes an app on Arc, and EarnKit isn't one yet." Pure.
 */
export const notEligiblePickLine = (title: string, chains: readonly string[], project: string) =>
  `${programName(title)} only takes an app on ${chainsOr(chains)}, and ${project} isn't one yet.`;

/**
 * The session opener: what is ready, what it is worth, where the answers came from, then READY_ASK as the last line.
 * v4.10 Task 4: `name` null (no X name, or greeted already this session) greets no one. v4.10.2 Task 1 (R1): the head
 * counts what the set needs from the builder (`asks`, at most READY_ANSWERS_MAX: "I need 3 answers from you first"),
 * "ready" only when it needs none; `also`, the programs left out for their answers (readyAlsoLine). v4.10.2 Task 2 (R3):
 * `notEligible`, the readyNotEligibleLine, said after it.
 */
export function readyOpener(o: {
  name: string | null; set: ReadyProgram[]; worth: string | null; page: string; hosted: boolean; now: Date; asks?: number;
  also?: readonly { title: string; amount: string | null; answers: number }[]; notEligible?: string | null;
}): string {
  const n = o.set.length;
  const asks = o.asks ?? 0;
  const apps = n === 1 ? '1 application' : `${n} applications`;
  const who = o.name ? `${o.name}, I've` : "I've";
  const head = asks > 0
    ? `${who} started ${apps} for you${worthClause(o.set, o.worth)}. I need ${asks === 1 ? '1 answer' : `${asks} answers`} from you first:`
    : `${who} got ${apps} ready for you${worthClause(o.set, o.worth)}:`;
  const lines = o.set.map((p, i) => readyLine(p, i + 1, o.hosted, o.now));
  // Final fix (M1): with a program waiting on the builder, it is every other answer (v4.10.2: the set's asks are all of them).
  const filled = asks > 0 || o.set.some((p) => p.needs) ? 'Every other answer is filled' : 'Every answer is filled';
  const also = readyAlsoLine(o.also ?? []);
  const apart = [also, o.notEligible].filter(Boolean).map((x) => `${x}\n\n`).join('');
  return `${head}\n\n${lines.join('\n')}\n\n${apart}${filled} from your commits and your profile at ${o.page}.\n${READY_ASK}`;
}

/**
 * A yes: while a step waits (`waiting`, "Builder Codes") the agent does it first; once the pages are open (`opened`),
 * each link, then the "sent" ask (the builder says when they have submitted). Final fix (M2): the adding line names
 * the programs the step opens (`codes`), never more than it opens.
 */
export function readyYesReply(o: { set: readonly Pick<ReadyProgram, 'title'>[]; opened: readonly { title: string; link: string }[]; waiting: readonly string[]; codes?: readonly string[] }): string {
  const n = o.set.length;
  const them = o.codes?.length ? list([...new Set(o.codes.map(shortName))]) : n === 1 ? 'it' : n === 2 ? 'both' : `all ${countWord(n)}`;
  if (o.waiting.length > 0) return `Adding ${list(o.waiting)} now, then I'll open ${them}.`;
  return `${readyOpenList(o.set, o.opened)}\n\n${readySentAsk(o.opened.length)}`;
}
/**
 * v4.10 Task 4: the open pages, each with its link: "All three are open with every answer in place:" and a "- Base:
 * {link}" line each; fewer than the set, "1 of 2 is open ...". Pure.
 */
export function readyOpenList(set: readonly unknown[], opened: readonly { title: string; link: string }[]): string {
  const n = set.length;
  const all = opened.length === n;
  const head = all ? (n === 1 ? 'It is open' : `${n === 2 ? 'Both' : `All ${countWord(n)}`} are open`) : `${opened.length} of ${n} ${opened.length === 1 ? 'is' : 'are'} open`;
  return `${head} with every answer in place:\n${opened.map((p) => `- ${shortName(p.title)}: ${p.link}`).join('\n')}`;
}
/** v4.10 Task 4: the one easy reply once pages are open: "sent", for `n` of them. Pure. */
export const readySentAsk = (n: number) => `Reply "sent" once ${n === 1 ? "it's" : "they're"} in, and I'll track ${n === 1 ? 'it' : 'them'} for you.`;
/**
 * v4.10 Task 4: a later plain find while the open pages wait for "sent". v4.10.1 Task 2: each open page on its own line,
 * with its money and its hours left under 48. Pure.
 */
export function readySentAgain(set: readonly AgainProgram[], now: Date): string {
  const n = set.length;
  const head = n === 1 ? 'Your application is open with every answer in place:' : `Your ${n} applications are open with every answer in place:`;
  return `${head}\n${set.map((p) => againLine(p, now, null)).join('\n')}\n\n${readySentAsk(n)}`;
}
/** The short names of the programs, each once ("Base and a16z"). */
const shortList = (titles: readonly string[]) => [...new Set(titles.map(shortName))];
/**
 * v4.10 Task 4 (R5): the one easy reply while programs wait on what only the builder can give (the gate's blanks ask).
 * Final fix (I1): one ask for the whole set, `count` fields: "Base and a16z need your team list, usage numbers, demo
 * video and any money you've raised first. Reply with them and I'll finish them." Pure.
 */
export function readyNeedsAsk(titles: string | readonly string[], needs: string, count = 1): string {
  const who = shortList(typeof titles === 'string' ? [titles] : titles);
  const many = who.length > 1;
  return `${list(who)} ${many ? 'need' : 'needs'} ${needs} first. Reply with ${count === 1 ? 'it' : count === 2 ? 'both' : 'them'} and I'll finish ${many ? 'them' : 'it'}.`;
}
/** Final fix (I1): a later find while the ask waits: "Still waiting on your team list for Base. Reply with it and I'll finish it." Pure. */
export function readyStillNeeds(titles: readonly string[], needs: string, count: number): string {
  const who = shortList(titles);
  return `Still waiting on ${needs} for ${list(who)}. Reply with ${count === 1 ? 'it' : count === 2 ? 'both' : 'them'} and I'll finish ${who.length > 1 ? 'them' : 'it'}.`;
}
/**
 * Final fix 2 (I2): an answer turn that leaves only the codes says what waits on them, before PUSHED_ASK: "Base opens
 * once Builder Codes are in your repo." Pure.
 */
export function readyCodesWait(titles: readonly string[]): string {
  const who = shortList(titles);
  return `${list(who)} ${who.length > 1 ? 'open' : 'opens'} once Builder Codes are in your repo.`;
}
/** v4.10 Task 4 (R8): a no parks the whole set. Pure. */
export const readyNoLine = (names: readonly string[]) => `No problem, I'll set ${list(names)} aside.`;
/** v4.10 Task 4: "sent" for more than one page (conversation.ts TRACK_ACK for one). Pure. */
export const readyTrackLead = (n: number) => (n === 1 ? "Nice, I'm tracking it." : "Nice, I'm tracking them.");

/** A number skips that program and keeps the rest. */
export function skipReply(skipped: string[], rest: string[]): string {
  const done = `Done, ${list(skipped)} ${skipped.length === 1 ? 'is' : 'are'} skipped.`;
  return rest.length > 0 ? `${done} I'll finish ${list(rest)} now.` : done;
}
