import { closeWords, programName } from './conversation';
import { BUILDER_CODES_GUIDE } from './bench-reply';
import type { ReadyProgram } from './ready-set';

/*
 * v4.10 Task 3 (R5, R6, R7): the ready set's words, from the owner-approved target conversation (section A). Pure
 * copy: Task 4 wires it into find. Nothing here says a program was sent or submitted; "sent" is the builder's word.
 */
/** The one ask at the end of the opener (the gate's easyReply takes it as an easy reply). */
export const READY_ASK = 'Reply yes and I\'ll finish and open each one for you to submit, or tell me the numbers to skip.';

/** "Base", "a16z", "Circle": the first word of the program's name. */
export const shortName = (title: string): string => programName(title).split(/\s+/)[0];

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
/** "A", "A and B", "A, B and C". */
const list = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const third = (verb: string) => (verb === 'have' ? 'has' : /(?:s|x|ch|sh)$/.test(verb) ? `${verb}es` : `${verb}s`);

/** A long shot's line: the fit-cell reason ("they look for apps on Arc") with the program named, else a bare long shot. */
function longShotLine(p: ReadyProgram): string {
  if (!p.why) return 'Ready, but it\'s a long shot.';
  const why = p.why.replace(/^they (\w+)/i, (_, verb: string) => `${shortName(p.title)} ${third(verb.toLowerCase())}`);
  return `Ready, but ${why}, so it's a long shot.`;
}

/** What a program's line says after its money: ready, ready once a step is done, or what the builder must bring. */
function stateOf(p: ReadyProgram, hosted: boolean): string {
  if (p.kind === 'long_shot') return longShotLine(p);
  if (p.kind !== 'one_step') return 'Ready.';
  if (p.step === 'codes') return hosted ? `Ready once you add Builder Codes (https://${BUILDER_CODES_GUIDE}).` : 'Ready once I add Builder Codes (10 minutes, I\'ll do it).';
  return p.needs ? `Needs ${p.needs} first.` : 'Ready.';
}

/** One numbered line of the opener: "1. Base Builder Grant: up to $5,000. Ready once I add Builder Codes (...)." */
export function readyLine(p: ReadyProgram, n: number, hosted: boolean, now: Date): string {
  const name = programName(p.title);
  if (p.kind === 'investor') {
    const money = p.amount ? `${p.amount} investment` : 'investment';
    const closes = p.ends_at ? `, closes ${closeWords(p.ends_at, p.zone, now)}` : '';
    return `${n}. ${name}: ${money}${closes}. ${stateOf(p, hosted)}`;
  }
  return `${n}. ${name}: ${p.amount ? `${p.amount}. ` : ''}${stateOf(p, hosted)}`;
}

/** The session opener: what is ready, what it is worth, where the answers came from, then READY_ASK as the last line. */
export function readyOpener(o: { name: string; set: ReadyProgram[]; worth: string | null; page: string; hosted: boolean; now: Date }): string {
  const n = o.set.length;
  const head = `${o.name}, I've got ${n === 1 ? '1 application' : `${n} applications`} ready for you${o.worth ? `, worth up to ${o.worth}` : ''}:`;
  const lines = o.set.map((p, i) => readyLine(p, i + 1, o.hosted, o.now));
  return `${head}\n\n${lines.join('\n')}\n\nEvery answer is filled from your commits and your profile at ${o.page}.\n${READY_ASK}`;
}

/**
 * A yes: while a step waits (`waiting`, "Builder Codes") the agent does it first; once the pages are open (`opened`),
 * each link, then the "sent" ask (the builder says when they have submitted).
 */
export function readyYesReply(o: { set: ReadyProgram[]; opened: { title: string; link: string }[]; waiting: string[] }): string {
  const n = o.set.length;
  if (o.waiting.length > 0) return `Adding ${list(o.waiting)} now, then I'll open ${n === 1 ? 'it' : n === 2 ? 'both' : `all ${countWord(n)}`}.`;
  const all = o.opened.length === n;
  const head = all ? (n === 1 ? 'It is open' : `${n === 2 ? 'Both' : `All ${countWord(n)}`} are open`) : `${o.opened.length} of ${n} are open`;
  const links = o.opened.map((p) => `- ${shortName(p.title)}: ${p.link}`).join('\n');
  return `${head} with every answer in place:\n${links}\n\nReply "sent" once ${o.opened.length === 1 ? "it's" : "they're"} in, and I'll track ${o.opened.length === 1 ? 'it' : 'them'} for you.`;
}

/** A number skips that program and keeps the rest. */
export function skipReply(skipped: string[], rest: string[]): string {
  const done = `Done, ${list(skipped)} ${skipped.length === 1 ? 'is' : 'are'} skipped.`;
  return rest.length > 0 ? `${done} I'll finish ${list(rest)} now.` : done;
}
