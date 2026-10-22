/**
 * v3.1 one-tap posts (design 2, Task 2): the post for X that EarnKit drafts for a moment. Deterministic and pure: no
 * model call, only the moment's own facts (the week's summary, the builder's note, the streak, the project's name, an
 * announced win and award, the coin's ticker once). Plain, past tense, the builder's voice; their note goes in verbatim
 * and wins over our wording. Shapes rotate so a builder's posts never read like a template: never one of their last 2
 * shapes and never the last post's opening word, relaxed to "not the last shape" when nothing else fits. A weekly with
 * nothing that fits is no post; an event (went live, a verified win, the coin intro, the builder's news) always gets
 * its first wording that passes the copy rules.
 *
 * Owner ruling 1 (2026-10-22): the coin gets one intro post that may name the ticker once ($SYM); no other shape ever
 * names it.
 */

export const POST_SHAPES = [
  'note', 'name_week', 'change', 'this_week', 'count', 'bare',
  'live', 'live_alt', 'won', 'won_alt', 'accepted', 'accepted_alt', 'funded', 'funded_alt', 'coin_intro',
] as const;
export type PostShape = (typeof POST_SHAPES)[number];
/** The post's ceiling in characters (X adds the page link). */
export const POST_MAX = 200;
/** Weeks in a row that make a milestone (folded into that week's post, never one of its own). */
export const MILESTONES = [4, 8, 12, 26, 52] as const;
export const isMilestone = (weeks: number) => (MILESTONES as readonly number[]).includes(weeks);
/** From this milestone the week may be the bare "Week <n>." (the card does the talking). */
const BARE_FROM = 12;

export type PostInput =
  /** `week`: weeks shipping in a row up to this week; `name`: the project's shown name (null for a private one). */
  | { moment: 'weekly'; name: string | null; week: number; summary: string | null; note: string | null }
  /** `weeks`: weeks from the first commit to going live. */
  | { moment: 'went_live'; name: string; weeks: number }
  /** `award`: written already ("$5,000"), or null. */
  | { moment: 'won' | 'accepted' | 'funded'; name: string; program: string; award: string | null }
  | { moment: 'news'; note: string }
  | { moment: 'coin_intro'; name: string; symbol: string; weeks: number };
export type Post = { shape: PostShape; text: string };
/** The person's recent drafts, newest first. */
export type PostHistory = { shape: string; text: string }[];

// --- The copy rules ----------------------------------------------------------------------------------------------------
/** Never in EarnKit-written text (design 2). Each entry: the reason it reports, the pattern. */
const HYPE: [string, RegExp][] = [
  ['excited', /\bexcit(?:ed|ing)\b/i], ['thrilled', /\bthrilled\b/i], ['proud to', /\bproud to\b/i], ['announce', /\bannounc/i],
  ['game changer', /\bgame[\s-]?chang/i], ['revolutioniz', /\brevolutioni[sz]/i], ['seamless', /\bseamless/i], ['empower', /\bempower/i],
  ['unlock', /\bunlock/i], ['journey', /\bjourney/i],
];
/** The shill words: never in our text, and a builder's note holding one is not used. */
const SHILL: [string, RegExp][] = [
  ['LFG', /\bLFG\b/i], ['WAGMI', /\bWAGMI\b/i], ['moon', /\bmoon(?:s|ing)?\b/i], ['gem', /\bgems?\b/i], ['alpha', /\balpha\b/i],
  ['100x', /\b100x\b/i], ['don\'t miss', /\bdon['’]?t miss\b/i], ['buy', /\bbuy(?:s|ing)?\b/i], ['back me', /\bback me\b/i],
  ['back the', /\bback the\b/i], ['ape', /\bap(?:e|es|ed|ing)\b/i], ['on EarnKit', /\bon EarnKit\b/i],
  ['hashtag', /(?:^|[^\p{L}\p{N}&])#[\p{L}\p{N}_]/u], ['cashtag', /\$[A-Za-z]/],
  // One link per post: the page X adds. Any other link or host name is a second one.
  ['link', /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|(?:^|[^\p{L}\p{N}@._-])(?:[\p{L}\p{N}-]+\.)+(?:com|net|org|io|dev|app|ai|xyz|co|me|sh|gg|so|fun|site|link|info|tech|cloud|page|ly|to|tv|us|uk|de|eth)\b/iu],
];
const MARKS: [string, RegExp][] = [['emoji', /\p{Extended_Pictographic}/u], ['em dash', /—/], ['exclamation', /!/]];
const JUST_SHIPPED = /\bjust shipped\b/i;

/**
 * What is wrong with `text` as an EarnKit-written post (none: []). `ticker`: the coin intro's one allowed $SYM;
 * `prev`: the person's last post (the same text again, or "just shipped" twice in a row, is refused).
 */
export function postProblems(text: string, o: { ticker?: string; prev?: string } = {}): string[] {
  const out: string[] = [];
  let t = text;
  if (o.ticker) t = t.replace(`$${o.ticker}`, 'TICKER');
  for (const [why, re] of [...HYPE, ...SHILL, ...MARKS]) if (re.test(t)) out.push(why);
  if (text.length > POST_MAX || text.trim().length === 0) out.push('length');
  if (o.prev !== undefined && o.prev.trim().toLowerCase() === text.trim().toLowerCase()) out.push('repeat');
  if (o.prev !== undefined && JUST_SHIPPED.test(text) && JUST_SHIPPED.test(o.prev)) out.push('just shipped twice');
  return out;
}
/** A builder's note may keep their own "!", emoji or dash; never a shill word, a hashtag, a cashtag or a link. */
const noteProblems = (note: string) => [...SHILL].filter(([, re]) => re.test(note)).map(([why]) => why);

/** The first word, lowercase, without punctuation. Pure. */
export const openingWord = (text: string) => (text.trim().split(/\s+/)[0] ?? '').replace(/[^\p{L}\p{N}$]/gu, '').toLowerCase();

// --- The shapes --------------------------------------------------------------------------------------------------------
/** The summary as a sentence: trimmed, ending in a period. */
const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return /[.?]$/.test(t) ? t : `${t}.`;
};
/** First letter lowered for an ordinary word ("Added" to "added"); an acronym or a brand ("CSV", "iOS") keeps its case. */
const lowered = (s: string) => (/^(?:A|[A-Z][a-z'’]+)(?=\s|$|[,.:;])/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const theProgram = (p: string) => (/^the\s/i.test(p) ? p : `the ${p}`);
const withAward = (award: string | null) => (award ? ` (${award})` : '');

function candidates(i: PostInput): Post[] {
  const out: Post[] = [];
  const add = (shape: PostShape, text: string | null | false | undefined) => {
    if (text) out.push({ shape, text });
  };
  switch (i.moment) {
    case 'weekly': {
      const s = i.summary?.trim() ? sentence(i.summary) : null;
      const milestone = isMilestone(i.week);
      if (i.note?.trim() && noteProblems(i.note).length === 0) add('note', i.note.trim());
      if (milestone) {
        add('count', s && i.name && `${i.week} weeks shipping ${i.name} without missing one. This week: ${lowered(s)}`);
        add('bare', i.week >= BARE_FROM && `Week ${i.week}.`);
      }
      add('name_week', s && i.name && i.week > 0 && `${i.name}, week ${i.week}: ${lowered(s)}`);
      add('change', s);
      add('this_week', s && !/^this week\b/i.test(s) && `This week: ${lowered(s)}`);
      break;
    }
    case 'went_live':
      if (!i.name) break;
      add('live', i.weeks >= 2 ? `${i.name} is live. ${i.weeks} weeks from first commit.` : `${i.name} is live.`);
      add('live_alt', i.weeks >= 2 && `${i.weeks} weeks from first commit, ${i.name} is live.`);
      break;
    case 'won':
      if (!i.name || !i.program) break;
      add('won', `${i.name} won ${theProgram(i.program)}${withAward(i.award)}.`);
      add('won_alt', `Won ${theProgram(i.program)}${withAward(i.award)} with ${i.name}.`);
      break;
    case 'accepted':
      if (!i.name || !i.program) break;
      add('accepted', `${i.name} was accepted into ${theProgram(i.program)}.`);
      add('accepted_alt', `Accepted into ${theProgram(i.program)} with ${i.name}.`);
      break;
    case 'funded':
      if (!i.name || !i.program) break;
      add('funded', `${i.name} was funded by ${theProgram(i.program)}${withAward(i.award)}.`);
      add('funded_alt', `Funded by ${theProgram(i.program)}${withAward(i.award)}, for ${i.name}.`);
      break;
    case 'news':
      if (i.note.trim() && noteProblems(i.note).length === 0) add('note', i.note.trim());
      break;
    case 'coin_intro': {
      const sym = i.symbol.trim().toUpperCase();
      if (!i.name || !/^[A-Z0-9]{1,12}$/.test(sym)) break;
      add('coin_intro', i.weeks >= 2 ? `${i.name} has a coin now, $${sym}. ${i.weeks} weeks shipping so far.` : `${i.name} has a coin now, $${sym}.`);
      break;
    }
  }
  return out;
}

/** The note shape and the coin intro carry the builder's words or the ticker; the rest are checked as ours. */
function passes(p: Post, i: PostInput, prev: string | undefined): boolean {
  if (p.text.length > POST_MAX) return false;
  if (p.shape === 'note') return !(prev !== undefined && prev.trim().toLowerCase() === p.text.toLowerCase());
  const ticker = i.moment === 'coin_intro' ? i.symbol.trim().toUpperCase() : undefined;
  return postProblems(p.text, { ticker, prev }).length === 0;
}

/**
 * The post for this moment, given the person's recent drafts (newest first); null when there is nothing worth posting
 * (a weekly with nothing new, or no shape that fits the rotation; a coin already introduced).
 */
export function writePost(i: PostInput, history: PostHistory): Post | null {
  if (i.moment === 'coin_intro' && history.some((h) => h.shape === 'coin_intro')) return null;
  const prev = history[0];
  const lastTwo = new Set(history.slice(0, 2).map((h) => h.shape));
  const lastOpen = prev ? openingWord(prev.text) : null;
  const ok = candidates(i).filter((p) => passes(p, i, prev?.text));
  const fresh = (p: Post) => openingWord(p.text) !== lastOpen;
  const pick =
    ok.find((p) => !lastTwo.has(p.shape) && fresh(p)) ??
    ok.find((p) => p.shape !== prev?.shape && fresh(p)) ??
    // An event is news once; it is drafted in its first wording that passes, whatever came before.
    (i.moment === 'weekly' ? undefined : ok[0]);
  return pick ?? null;
}
