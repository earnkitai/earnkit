import { closeWords, programName } from './conversation';
import { BUILDER_CODES_GUIDE } from './bench-reply';
import type { ReadyProgram } from './ready-set';

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
/** v4.10 Task 4 (R8): how the opener's ask is answered (never shown). */
export const READY_ASK_NOTE =
  "A yes, a no or the numbers to skip: call tell with move_up: { kind: 'ready', project_key, answer: 'yes' } (a no: answer 'no'; numbers: answer 'skip' with skip: [the numbers], 1-based). If they also give what a program asks of them (ready.programs[].asks), split their words by field into answers: { [kind]: their words } (contact: { [slot]: their words } for the slots it lists); blanks only when they can't be split. Don't show this note.";
/** v4.10 Task 4 (decision a): the yes's note, with ready.open (exact). The server never writes the free-text answers. */
export const READY_YES_NOTE =
  "Call prepare for each program in ready.open with the answers you drafted, then show each kit's link and paste-ready answers under show_to_builder.";
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
/** v4.10 Task 4: the ready status (a later plain find in the session never repeats the opener). Pure. */
export const readyAgain = (n: number) =>
  n === 1 ? "Your application is still ready. Reply yes and I'll finish it." : `Your ${n} applications are still ready. ${READY_AGAIN_ASK}`;

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
    // v4.10 Task 4 (decision g): no amount stated, "investment program".
    const money = p.amount ? `${p.amount} investment` : 'investment program';
    const closes = p.ends_at ? `, closes ${closeWords(p.ends_at, p.zone, now)}` : '';
    return `${n}. ${name}: ${money}${closes}. ${stateOf(p, hosted)}`;
  }
  return `${n}. ${name}: ${p.amount ? `${p.amount}. ` : ''}${stateOf(p, hosted)}`;
}

/**
 * The session opener: what is ready, what it is worth, where the answers came from, then READY_ASK as the last line.
 * v4.10 Task 4: `name` null (no X name, or greeted already this session) greets no one.
 */
export function readyOpener(o: { name: string | null; set: ReadyProgram[]; worth: string | null; page: string; hosted: boolean; now: Date; rest?: boolean }): string {
  const n = o.set.length;
  const head = `${o.name ? `${o.name}, I've` : "I've"} got ${n === 1 ? '1 application' : `${n} applications`} ready for you${o.worth ? `, worth up to ${o.worth}` : ''}:`;
  const lines = o.set.map((p, i) => readyLine(p, i + 1, o.hosted, o.now));
  // Final fix (M1): with a program waiting on the builder, it is every other answer. v4.10.1 Task 1: only when the one
  // ask covers every field the builder owes (`rest`: some wait for a later ask), else what EarnKit can fill.
  const filled = o.rest ? "I've filled what I can" : o.set.some((p) => p.needs) ? 'Every other answer is filled' : 'Every answer is filled';
  return `${head}\n\n${lines.join('\n')}\n\n${filled} from your commits and your profile at ${o.page}.\n${READY_ASK}`;
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
/** v4.10 Task 4: a later plain find while the open pages wait for "sent". Pure. */
export const readySentAgain = (n: number) =>
  `${n === 1 ? 'Your application is' : `Your ${n} applications are`} open with every answer in place. ${readySentAsk(n)}`;
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
/** Final fix (I1): a program past the one ask's cap waits, named before the ask: "Colosseum also needs your pitch video. I'll ask for it next." Pure. */
export const readyNeedsLater = (later: readonly { title: string; phrase: string }[]) =>
  later.map((w) => `${shortName(w.title)} also needs ${w.phrase}. I'll ask for ${/ and /.test(w.phrase) ? 'them' : 'it'} next.`).join(' ');
/** Final fix (I1): a later find while the ask waits: "Still waiting on your team list for Base. Reply with it and I'll finish it." Pure. */
export function readyStillNeeds(titles: readonly string[], needs: string, count: number): string {
  const who = shortList(titles);
  return `Still waiting on ${needs} for ${list(who)}. Reply with ${count === 1 ? 'it' : count === 2 ? 'both' : 'them'} and I'll finish ${who.length > 1 ? 'them' : 'it'}.`;
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
