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
  "A yes, a no or the numbers to skip: call tell with move_up: { kind: 'ready', project_key, answer: 'yes' } (a no: answer 'no'; numbers: answer 'skip' with skip: [the numbers], 1-based). Builder-only answers they give go in blanks. Don't show this note.";
/** v4.10 Task 4 (decision a): the yes's note, with ready.open (exact). The server never writes the free-text answers. */
export const READY_YES_NOTE =
  "Call prepare for each program in ready.open with the answers you drafted, then show each kit's link and paste-ready answers under show_to_builder.";
/** v4.10 Task 4: the note once the pages are open: "sent" is the builder's word, for some or all of them. */
export const READY_SENT_NOTE =
  "Only when they say an application is in (\"sent\", \"submitted\"), call tell with move_up: { kind: 'ready', project_key, answer: 'sent' } (only some: add sent_ids with those program ids). A plain ok or yes is not sent. Don't show this note.";
/** v4.10 Task 4 (R5): the note while a program waits on what only the builder can give. */
export const READY_NEEDS_NOTE =
  "Their answer to what the program needs (only theirs, never yours): call tell with move_up: { kind: 'ready', project_key, answer: 'yes', blanks: their words }. Don't show this note.";
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
  const words = (r.todo ?? r.label).trim().replace(/[.?:]+$/, '').replace(/^(?:a|an|the|your)\s+/i, '');
  return `your ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
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
export function readyOpener(o: { name: string | null; set: ReadyProgram[]; worth: string | null; page: string; hosted: boolean; now: Date }): string {
  const n = o.set.length;
  const head = `${o.name ? `${o.name}, I've` : "I've"} got ${n === 1 ? '1 application' : `${n} applications`} ready for you${o.worth ? `, worth up to ${o.worth}` : ''}:`;
  const lines = o.set.map((p, i) => readyLine(p, i + 1, o.hosted, o.now));
  return `${head}\n\n${lines.join('\n')}\n\nEvery answer is filled from your commits and your profile at ${o.page}.\n${READY_ASK}`;
}

/**
 * A yes: while a step waits (`waiting`, "Builder Codes") the agent does it first; once the pages are open (`opened`),
 * each link, then the "sent" ask (the builder says when they have submitted).
 */
export function readyYesReply(o: { set: readonly Pick<ReadyProgram, 'title'>[]; opened: readonly { title: string; link: string }[]; waiting: readonly string[] }): string {
  const n = o.set.length;
  if (o.waiting.length > 0) return `Adding ${list(o.waiting)} now, then I'll open ${n === 1 ? 'it' : n === 2 ? 'both' : `all ${countWord(n)}`}.`;
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
/** v4.10 Task 4 (R5): the one easy reply while a program waits on what only the builder can give (the gate's blanks ask). */
export const readyNeedsAsk = (title: string, needs: string, count = 1) =>
  `${shortName(title)} needs ${needs} first. Reply with ${count > 1 ? 'both' : 'it'} and I'll finish it.`;
/** v4.10 Task 4 (R8): a no parks the whole set. Pure. */
export const readyNoLine = (names: readonly string[]) => `No problem, I'll set ${list(names)} aside.`;
/** v4.10 Task 4: "sent" for more than one page (conversation.ts TRACK_ACK for one). Pure. */
export const readyTrackLead = (n: number) => (n === 1 ? "Nice, I'm tracking it." : "Nice, I'm tracking them.");

/** A number skips that program and keeps the rest. */
export function skipReply(skipped: string[], rest: string[]): string {
  const done = `Done, ${list(skipped)} ${skipped.length === 1 ? 'is' : 'are'} skipped.`;
  return rest.length > 0 ? `${done} I'll finish ${list(rest)} now.` : done;
}
