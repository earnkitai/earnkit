import type { FieldKind, Judging, SubmissionRequirement } from './program-file';

/**
 * v2.8 Part D: the application coach. Pure: no DB, no network, no LLM. The agent writes every
 * answer; the coach picks the few questions only the builder can answer (Ruling 26 (plan)), gives
 * the agent each field's guidance, fills from the answer bank, and checks the draft before the
 * builder submits (never blocking). Builder text here never names a tool, field or file.
 */

export type Guidance = { judges: string; questions: string[]; pattern: string; limit_words: number | null };

/** Ruling 9 (plan): the built-in guidance for every field kind. For the agent; the builder never reads it. */
export const DEFAULT_GUIDANCE: Record<FieldKind, Guidance> = {
  name: {
    judges: 'A name that is easy to remember and matches the live product.',
    questions: [],
    pattern: 'The product name exactly as the app shows it. No tagline.',
    limit_words: null,
  },
  one_liner: {
    judges: 'What it does and for whom, understood in one read.',
    questions: [],
    pattern: 'Who it is for, what it does, and the chain it runs on. One sentence, up to 20 words.',
    limit_words: 20,
  },
  problem: {
    judges: 'A real, specific pain that someone has today.',
    questions: ['What problem does it solve, and for whom?'],
    pattern: 'Name the user and the pain, then what it costs them today. Up to 60 words.',
    limit_words: 60,
  },
  solution: {
    judges: 'A working product that fixes the problem, live now.',
    questions: [],
    pattern: 'What it does, who uses it, and why on this chain. Link the live app. Up to 60 words.',
    limit_words: 60,
  },
  how_it_works: {
    judges: 'Technical credibility: real contracts and integrations that work.',
    questions: [],
    pattern: 'The flow in 2 or 3 steps, the contracts and tools used, and one proof link. Up to 80 words.',
    limit_words: 80,
  },
  traction: {
    judges: 'Real use, shown with numbers.',
    questions: ['Who has used it so far?', 'What number shows it is growing?'],
    pattern: 'Lead with the user and the number. One sentence of how. One proof link.',
    limit_words: 60,
  },
  team: {
    judges: 'A team that can ship this.',
    questions: ['Who is building it with you?'],
    pattern: 'Each person: their role and one thing they shipped before. Up to 50 words.',
    limit_words: 50,
  },
  why_you: {
    judges: 'An edge: a skill, access, or proof you already shipped.',
    questions: ['Why are you the one to build this?'],
    pattern: 'One concrete reason, then the proof (what you shipped, who you reach). Up to 50 words.',
    limit_words: 50,
  },
  use_of_funds: {
    judges: 'A small, concrete next step that the grant pays for.',
    questions: ['What would you build next with the grant?'],
    pattern: 'What you will ship with the money, with amounts and a date. Up to 60 words.',
    limit_words: 60,
  },
  milestones: {
    judges: 'Dated deliverables a reviewer can check.',
    questions: ['What will you ship in the next 3 months?'],
    pattern: '2 or 3 milestones, each with a date and a number to check. Up to 60 words.',
    limit_words: 60,
  },
  demo_video: {
    judges: 'The live product working, fast.',
    questions: [],
    pattern: 'A link to a short video of the live product in use, under 3 minutes.',
    limit_words: null,
  },
  links: {
    judges: 'Links that open and prove the product is real.',
    questions: [],
    pattern: 'The exact link the field asks for: the live app, the repo or the contract on an explorer.',
    limit_words: null,
  },
  contact: {
    judges: 'A way to reach the builder.',
    questions: [],
    pattern: 'Exactly what the builder gave. Never guess an email or a handle.',
    limit_words: null,
  },
  other: {
    judges: 'Exactly what the form asks for.',
    questions: [],
    pattern: "Answer what the form asks, from the repo and the builder's answers. Never invent a fact.",
    limit_words: null,
  },
};

/** Ruling 26 (plan): the order the few builder questions are picked in; other kinds follow in form order. */
export const QUESTION_ORDER: FieldKind[] = ['traction', 'why_you', 'use_of_funds', 'milestones', 'team', 'problem', 'contact'];
export const MAX_FIRST_QUESTIONS = 3;
/** Ruling 26: one round for a later program; C17 renders it as at most MAX_BULLETS short bullets. */
export const MAX_LATER_QUESTIONS = 1;
/** C17: never more than 4 bullets, and no question over 25 words. */
export const MAX_BULLETS = 4;
export const MAX_QUESTION_WORDS = 25;
export const MAX_FIXES = 3;

const DIGIT = /\d/;
const LINK = /https:\/\/\S+/;
const CLAIM = /\b(users?|customers?|revenue|volume|growth|transactions|downloads|installs)\b/i;
/** A date or a time frame: a year, a month, a quarter, "6 weeks", "week 3". */
const DATE =
  /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\bq[1-4]\b|\b\d+\s*(days?|weeks?|months?)\b|\b(week|month|day)\s*\d+\b/i;
/** Kinds whose answer needs a date (a milestone), not a user count. */
const DATE_KINDS: FieldKind[] = ['use_of_funds', 'milestones'];
/** Kinds the agent drafts from the repo and onchain data: never asked, unless only the builder can answer. */
const AGENT_DRAFTS: FieldKind[] = ['name', 'one_liner', 'solution', 'how_it_works', 'links', 'demo_video', 'other'];
/** Kinds whose answers aren't prose (no claim check); `other` is often a choice. */
const NOT_PROSE: FieldKind[] = ['name', 'links', 'demo_video', 'contact', 'other'];
const PROOF_KINDS: FieldKind[] = ['links', 'demo_video', 'how_it_works'];

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const kindOf = (r: SubmissionRequirement): FieldKind => r.kind ?? 'other';

/** A form label, short: no trailing "(...)" or punctuation, at most 40 characters at a word boundary. Pure. */
export function shortLabel(label: string): string {
  const s = label.replace(/\s*\([^)]*\)\s*$/, '').replace(/[?:.]\s*$/, '').trim();
  if (s.length <= 40) return s;
  const cut = s.slice(0, 40).replace(/\s+\S*$/, '');
  return `${cut || s.slice(0, 40)}…`;
}

const PROPER = /^(Telegram|Discord|Farcaster|Twitter|Warpcast|GitHub|LinkedIn|Base|Arc|USD|USDC)\b/;
/**
 * "Full name" reads "full name" mid-sentence; "X Profile" reads "X profile"; "X (Twitter) handle",
 * "GitHub" and "Telegram" keep their case.
 */
const lowerFirst = (s: string) => {
  if (PROPER.test(s)) return s;
  const x = s.match(/^X (\p{Lu})(\p{Ll}+)(?![\p{L}])/u);
  if (x) return `X ${x[1].toLowerCase()}${x[2]}${s.slice(x[0].length)}`;
  return s.replace(/^(\p{Lu})(\p{Ll}+)(?![\p{L}])/u, (_m, a: string, b: string) => a.toLowerCase() + b);
};
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));

/** A field's guidance: the program's own (Ruling 9 (plan)) over the kind's default. Pure. */
export function guidanceFor(r: SubmissionRequirement): Guidance & { kind: FieldKind; source_url: string | null } {
  const kind = kindOf(r);
  const d = DEFAULT_GUIDANCE[kind];
  const g = r.guidance;
  return {
    kind,
    judges: g?.judges ?? d.judges,
    questions: g?.questions ?? d.questions,
    pattern: g?.pattern ?? d.pattern,
    limit_words: g?.limit_words ?? d.limit_words,
    source_url: g?.source_url ?? null,
  };
}

/** What the agent drafts each field with: kind, what judges look for, the pattern and the limit. Pure. */
export function coachFields(reqs: SubmissionRequirement[]) {
  return reqs.map((r) => {
    const g = guidanceFor(r);
    return {
      key: r.key,
      label: r.label,
      kind: g.kind,
      required: r.required,
      ...(r.from === 'builder' && { builder_only: true }),
      judges: g.judges,
      pattern: g.pattern,
      limit_words: g.limit_words,
      ...(r.max_chars && { max_chars: r.max_chars }),
      ...(g.source_url && { source_url: g.source_url }),
    };
  });
}

/**
 * Kinds whose fields are told apart by what they hold (an email, an X handle, a live link), so one
 * project's contact details and links are banked per slot, as a JSON object, not as one answer. A
 * field whose label says none of these is its own slot (its key), so it is never reused elsewhere.
 */
const SLOT_KINDS: FieldKind[] = ['contact', 'links'];
const SLOTS: [string, RegExp][] = [
  ['email', /e-?mail/],
  ['telegram', /telegram/],
  ['discord', /discord/],
  ['farcaster', /farcaster|warpcast/],
  ['x', /(^|[^a-z])x([^a-z]|$)|twitter/],
  ['github', /github|repo\b|repository|source code/],
  ['demo', /demo|video|loom/],
  ['live', /\blive\b|website|\bproduct\b/],
  ['name', /\bname\b/],
  ['profile', /profile/],
];
/** Matched on the label only (the form's words), never on a key like `additional_url`. */
const slotOf = (r: SubmissionRequirement) => {
  const t = r.label.toLowerCase();
  return SLOTS.find(([, re]) => re.test(t))?.[0] ?? `key:${r.key}`;
};
const slotsOf = (text: string | undefined): Record<string, string> => {
  if (!text) return {};
  try {
    const o: unknown = JSON.parse(text);
    return o && typeof o === 'object' && !Array.isArray(o)
      ? Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {};
  } catch {
    return {};
  }
};

/**
 * The answer bank's fill (Ruling 6 (plan)). A given answer is never overwritten; `other` is never
 * filled. When a form has two fields of one kind, only the first is filled (the agent writes a
 * distinct answer for the second). Contact details are never filled silently (C16): they come back
 * as `suggested`, for the contact question to confirm ("Use a@b.co again?"). Pure.
 */
export function bankFill(
  reqs: SubmissionRequirement[],
  answers: Record<string, string>,
  bank: Map<FieldKind, string>,
  opts: { confirmAll?: boolean } = {},
): { answers: Record<string, string>; from_bank: Record<string, string>; suggested: Record<string, string> } {
  // v2.8.1 §E17: on a hosted agent (shared_client) nothing is filled silently: every banked answer
  // the coach asks about comes back as `suggested`, for a yes/no that names it; the rest (what the
  // agent drafts) is left out, so the agent drafts it fresh.
  if (opts.confirmAll) {
    const askable = new Set(askableKeys(reqs, answers));
    const plain = bankFill(reqs, answers, bank);
    const suggested = Object.fromEntries(
      Object.entries({ ...plain.from_bank, ...plain.suggested }).filter(([k]) => askable.has(k)),
    );
    return { answers: { ...answers }, from_bank: {} as Record<string, string>, suggested };
  }
  const out = { ...answers };
  const from_bank: Record<string, string> = {};
  const suggested: Record<string, string> = {};
  const seen = new Set<FieldKind>();
  for (const r of reqs) {
    const k = kindOf(r);
    const firstOfKind = !seen.has(k);
    seen.add(k);
    if (k === 'other' || out[r.key]?.trim()) continue;
    if (SLOT_KINDS.includes(k)) {
      const banked = slotsOf(bank.get(k))[slotOf(r)];
      if (!banked?.trim()) continue;
      if (k === 'contact') suggested[r.key] = banked;
      else out[r.key] = from_bank[r.key] = banked;
    } else if (firstOfKind) {
      const banked = bank.get(k);
      if (banked?.trim()) out[r.key] = from_bank[r.key] = banked;
    }
  }
  return { answers: out, from_bank, suggested };
}

/** The bank's longest answer, as projects.ts SUBMISSION_VALUE_MAX and the table's CHECK. */
export const BANK_ANSWER_MAX = 4096;

/**
 * What to bank from confirmed answers, one per kind (Ruling 6 (plan)): never `other`; for a kind with
 * several fields in the form, the first field's answer; contact details and links merge into the
 * kind's slots, over what `existing` holds. An answer over BANK_ANSWER_MAX is left out. Pure.
 */
export function bankEntries(reqs: SubmissionRequirement[], answers: Record<string, string>, existing: Map<FieldKind, string> = new Map()) {
  const plain = new Map<FieldKind, string>();
  const slots = new Map<FieldKind, Record<string, string>>();
  for (const r of reqs) {
    const k = kindOf(r);
    const v = answers[r.key]?.trim();
    if (k === 'other' || !v) continue;
    if (SLOT_KINDS.includes(k)) {
      const s = slots.get(k) ?? { ...slotsOf(existing.get(k)) };
      s[slotOf(r)] = v;
      slots.set(k, s);
    } else if (!plain.has(k)) plain.set(k, v);
  }
  const out = new Map<FieldKind, string>(plain);
  for (const [k, s] of slots) out.set(k, JSON.stringify(s));
  for (const [k, v] of out) if (v.length > BANK_ANSWER_MAX) out.delete(k);
  return out;
}

/**
 * v2.8.1 §C11: the answer key the coach's wallet question goes under (prepare_submission reads it
 * as the wallet given, and shows it on the offer's wallet line).
 */
export const WALLET_KEY = 'payout_wallet';
/** v2.8.1 §C11: the wallet question, asked once, in the coach's round. Pure. */
export const walletAsk = (hasBonus: boolean) => `The wallet for your token's fees${hasBonus ? ' and any bonus' : ''} (0x…)?`;
const WALLET_HINT = 'No wallet yet? Make one at keys.coinbase.com.';

/** One question. `bullet`: shown as "- text" (C17: a later program's round, or the first program's leftovers). */
export type Question = { keys: string[]; kind: FieldKind; text: string; bullet?: true; suggested?: Record<string, string> };

/**
 * C15: a field the coach asks about: required, still empty, and only the builder can answer it
 * (`from: 'builder'`: consent, an amount, revenue, a handle) or its kind is not one the agent drafts.
 * Pure.
 */
export function askableKeys(reqs: SubmissionRequirement[], answers: Record<string, string>): string[] {
  return reqs
    .filter((r) => r.required && !answers[r.key]?.trim() && (r.from === 'builder' || !AGENT_DRAFTS.includes(kindOf(r))))
    .map((r) => r.key);
}

/** A contact label as the form means it, short: "X (Twitter) handle" reads "X", "Telegram username" "Telegram". */
const contactLabel = (r: SubmissionRequirement) =>
  lowerFirst(
    shortLabel(r.label)
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/^(your|the)\s+/i, '')
      .replace(/\s+(handle|username)$/i, '')
      .trim(),
  );

/**
 * C16, round 3: the contact question names exactly what the form wants, never "contact details".
 * Saved details are a yes/no and the rest are asked in the same bullet: "Use a@b.co and @alice
 * again? Plus your Telegram?"
 */
function contactText(reqs: SubmissionRequirement[], suggested: Record<string, string>, shared = false) {
  const saved = reqs.filter((r) => suggested[r.key]);
  const fresh = list(reqs.filter((r) => !suggested[r.key]).map(contactLabel));
  // Final fix wave (M4): on a hosted agent (shared_client) the yes/no names the kind, never the
  // value: "Use your saved email?" (a saved value there may be another user's).
  const use =
    saved.length === 0
      ? ''
      : shared
        ? `Use your saved ${list([...new Set(saved.map(contactLabel))])}?`
        : `Use ${list(saved.map((r) => suggested[r.key]))} again?`;
  if (use && fresh) return `${use} Plus your ${fresh}?`;
  return use || `Your ${fresh}?`;
}

/** The longest saved answer a yes/no quotes in full; longer ones are cut at a word. */
const SAVED_SHOWN = 80;
const clip = (v: string) => {
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length <= SAVED_SHOWN) return t;
  const cut = t.slice(0, SAVED_SHOWN);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,.;:]+$/, '')}...`;
};
/** v2.8.1 §E17: a yes/no that names saved answers: 'Use "3 people" again?'. Pure. */
function savedText(saved: string[]) {
  return `Use ${list(saved.map((v) => `"${clip(v)}"`))} again?`;
}

/** One group's question: the kind's question, or the fields' own to-dos ("How it makes money today?"). */
function groupText(kind: FieldKind, reqs: SubmissionRequirement[], name: string | undefined) {
  const r0 = reqs[0];
  const g = guidanceFor(r0);
  if (kind !== 'other' && g.questions[0]) {
    // The project's name only in the built-in questions ("Who has used TipJar so far?").
    const own = Boolean(r0.guidance?.questions);
    return name && !own ? g.questions[0].replace(/\bit\b/, name) : g.questions[0];
  }
  return `${upperFirst(list(reqs.map((r) => r.todo ?? lowerFirst(shortLabel(r.label)))))}?`;
}

type Group = { kind: FieldKind; reqs: SubmissionRequirement[] };
/** Kinds whose questions are about the work (shipping plan, team, ...), in QUESTION_ORDER. */
const PROSE_ORDER = QUESTION_ORDER.filter((k) => k !== 'contact');

/**
 * Splits `xs` into at most `n` contiguous chunks, as even as possible, in order; the larger chunks
 * last, so the most important questions (first in order) stay on their own. Pure.
 */
const chunks = <T,>(xs: T[], n: number): T[][] => {
  const k = Math.min(n, xs.length);
  const out: T[][] = [];
  let i = 0;
  for (let c = 0; c < k; c++) {
    const size = Math.floor(xs.length / k) + (c >= k - (xs.length % k) ? 1 : 0);
    out.push(xs.slice(i, i + size));
    i += size;
  }
  return out;
};

/**
 * Ruling 26 (plan), C15, C17, round 3: the questions only the builder can answer, for the askable
 * fields (askableKeys) after the agent's draft and the bank fill. At most MAX_BULLETS items, one round:
 * - the work questions in QUESTION_ORDER (shipping plan, team, ...), each a plain question; past the
 *   limit the least important merge ("What will you ship next? And who is building it with you?");
 * - contact, always its own item, naming exactly what the form wants (a yes/no for `suggested`,
 *   the saved contact details, plus the rest);
 * - money and every other builder-only item, together in their own item, never joined onto contact.
 * A project's first program shows them as at most 3 numbered questions, a 4th as a bullet; a later
 * program's round (more than one item) as short bullets. No builder-only field is ever dropped.
 * `project` names the project in the built-in questions.
 * v2.8.1 §C11: `wallet` (the entry gets a token and no wallet is known yet): the wallet is asked in
 * this same round, never as a round of its own: joined to the contact item (personal details), else
 * its own item while there is room, else joined to the last one. Pure.
 */
export function questionsFor(a: {
  reqs: SubmissionRequirement[];
  answers: Record<string, string>;
  first: boolean;
  project?: string;
  suggested?: Record<string, string>;
  wallet?: { hasBonus: boolean } | null;
  /** On a hosted agent (shared_client): saved contact details are named by kind, never quoted. */
  shared?: boolean;
}): Question[] {
  const items = baseQuestions(a);
  // A form with its own wallet field (an EarnKit campaign) asks it there, never twice.
  if (!a.wallet || items.length === 0 || a.reqs.some((r) => r.key === WALLET_KEY)) return items;
  const ask = walletAsk(a.wallet.hasBonus);
  const fits = (t: string) => t.split(/\s+/).length <= MAX_QUESTION_WORDS;
  const join = (q: Question): Question => {
    const text = `${q.text} And ${lowerFirst(ask)}`;
    return { ...q, keys: [...q.keys, WALLET_KEY], text: fits(`${text} ${WALLET_HINT}`) ? `${text} ${WALLET_HINT}` : text };
  };
  const at = items.findIndex((q) => q.kind === 'contact');
  if (at >= 0) return items.map((q, i) => (i === at ? join(q) : q));
  if (items.length < MAX_BULLETS) {
    const own: Question = { keys: [WALLET_KEY], kind: 'contact', text: `${ask} ${WALLET_HINT}` };
    // The same numbering rule as the other items: past the 3 numbered, a bullet.
    const bullet = items.some((q) => q.bullet) || (a.first && items.length >= MAX_FIRST_QUESTIONS) || (!a.first && items.length >= MAX_LATER_QUESTIONS);
    if (!a.first && items.length === MAX_LATER_QUESTIONS && !items[0].bullet)
      return [...items.map((q) => ({ ...q, bullet: true as const })), { ...own, bullet: true as const }];
    return [...items, bullet ? { ...own, bullet: true as const } : own];
  }
  return items.map((q, i) => (i === items.length - 1 ? join(q) : q));
}

function baseQuestions(a: {
  reqs: SubmissionRequirement[];
  answers: Record<string, string>;
  first: boolean;
  project?: string;
  suggested?: Record<string, string>;
  shared?: boolean;
}): Question[] {
  const keys = new Set(askableKeys(a.reqs, a.answers));
  const empty = a.reqs.filter((r) => keys.has(r.key));
  const name = a.project?.trim();
  const suggested = a.suggested ?? {};
  const prose: Group[] = PROSE_ORDER.flatMap((kind) => {
    const reqs = empty.filter((r) => kindOf(r) === kind);
    return reqs.length > 0 ? [{ kind, reqs }] : [];
  });
  const contact = empty.filter((r) => kindOf(r) === 'contact');
  const rest = empty.filter((r) => !QUESTION_ORDER.includes(kindOf(r)));
  const make = (kind: FieldKind, reqs: SubmissionRequirement[], text: string): Question => {
    const sugg = Object.fromEntries(reqs.filter((r) => suggested[r.key]).map((r) => [r.key, suggested[r.key]]));
    return { keys: reqs.map((r) => r.key), kind, text, ...(Object.keys(sugg).length > 0 && { suggested: sugg }) };
  };
  /** v2.8.1 §E17: a work question with a saved answer is a yes/no that names it. */
  const workText = (g: Group) => {
    const saved = g.reqs.map((r) => suggested[r.key]).filter(Boolean);
    return saved.length > 0 ? savedText(saved) : groupText(g.kind, g.reqs, name);
  };
  const tail: Question[] = [
    ...(contact.length > 0 ? [make('contact', contact, contactText(contact, suggested, a.shared))] : []),
    ...(rest.length > 0
      ? [make(kindOf(rest[0]), rest, rest.some((r) => suggested[r.key]) ? `${savedText(rest.map((r) => suggested[r.key]).filter(Boolean))}${rest.some((r) => !suggested[r.key]) ? ` Plus: ${lowerFirst(groupText('other', rest.filter((r) => !suggested[r.key]), name))}` : ''}` : groupText('other', rest, name))]
      : []),
  ];
  const room = Math.max(1, MAX_BULLETS - tail.length);
  const work = chunks(prose, room).map((gs) =>
    make(
      gs[0].kind,
      gs.flatMap((g) => g.reqs),
      gs.map((g, i) => (i === 0 ? workText(g) : `And ${lowerFirst(workText(g))}`)).join(' '),
    ),
  );
  const items = [...work, ...tail];
  if (a.first) return items.map((q, i) => (i < MAX_FIRST_QUESTIONS ? q : { ...q, bullet: true as const }));
  if (items.length <= MAX_LATER_QUESTIONS) return items;
  return items.map((q) => ({ ...q, bullet: true as const }));
}

/**
 * The builder's screen while the coach has questions; null when it has none. Numbered questions as
 * "N quick questions", where N counts every item shown, the bullet after them included (Ruling
 * C25); a later program's bullets alone as "a few things only you know" (C17). Pure.
 */
export function coachIntro(title: string, questions: Question[]): string | null {
  const numbered = questions.filter((q) => !q.bullet);
  const bullets = questions.filter((q) => q.bullet);
  if (questions.length === 0) return null;
  const n = numbered.length === 0 ? 0 : questions.length;
  const head =
    n === 0
      ? `${title}: a few things only you know, then I'll write it.`
      : `${title}: ${n} quick question${n === 1 ? '' : 's'}, then I'll write your application.`;
  return [head, ...numbered.map((q, i) => `${i + 1}. ${q.text}`), ...bullets.map((q) => `- ${q.text}`)].join('\n');
}

/**
 * A pre-submit fix. Every text reads "<Field>: <the exact thing to add>." (C14). `for`: the builder
 * (shown, at most MAX_FIXES) or the agent (it fixes them itself; never shown).
 */
export type Fix = {
  key: string;
  /** 'unverified' (v2.9 A5): the live link didn't load, or no contract was found (tools.ts checkFix). */
  rule: 'empty' | 'no_number' | 'no_date' | 'no_proof_link' | 'criterion' | 'over_limit' | 'unverified' | 'not_plain';
  for: 'builder' | 'agent';
  text: string;
};

/** v2.10 item 11: the description fields that must read as plain words. */
export type PlainKind = 'name' | 'one_liner' | 'problem' | 'solution' | 'how_it_works';
const PLAIN_KINDS: readonly FieldKind[] = ['name', 'one_liner', 'problem', 'solution', 'how_it_works'] satisfies PlainKind[];
const isPlainKind = (k: FieldKind): k is PlainKind => PLAIN_KINDS.includes(k);
/** The agent fix for a field that isn't plain words (spec wording). */
export const PLAIN_FIX = (label: string) => `${label}: rewrite in plain words, no addresses or numbers lists.`;
/** The agent fix for a plain field over the form's limit, and only that (review fix round 1). */
export const PLAIN_LENGTH_FIX = (label: string, limit: number, unit: 'characters' | 'words') =>
  `${label}: keep it under ${limit} ${unit}, in plain words.`;
/** confirm_entry's note while a not_plain fix stands; the builder never sees it. */
export const PLAIN_NOTE = "Rewrite the agent_fixes answers in plain words, then call again with the new answers. Don't show this to the builder.";

const ADDRESS_RE = /\b0x[0-9a-fA-F]{40}\b/;
const HASH_RE = /\b0x[0-9a-fA-F]{64}\b/;
const HEX_RUN_RE = /\b[0-9a-fA-F]{16,}\b/;
const KEY_VALUE_RE = /(?:^|[,;\n])\s*[A-Za-z][\w ]{0,20}:\s*[\w$.%-]+\s*(?:[,;\n]\s*[A-Za-z][\w ]{0,20}:\s*[\w$.%-]+)+/;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const NUMBER_RE = /\d[\d,.]*/g;

/**
 * v2.10 item 11: why a description field isn't plain words (the reason, for the agent), or null.
 * Flags a raw address, hash or long hex run; a `key: value` list; 4 or more numbers in one
 * sentence; a link (how_it_works keeps one); and a text over the form's max_chars, else its
 * limit_words. With `linkAddresses`, an address inside a link is allowed. Returns 'too long' when
 * length is the only problem. Pure.
 */
export function plainProblem(
  text: string,
  kind: PlainKind,
  limit: { max_chars?: number; limit_words?: number } = {},
  o: { linkAddresses?: boolean } = {},
): string | null {
  const t = text.trim();
  if (!t) return null;
  // A field a program's criterion asks to link (`linkAddresses`) may hold an explorer link: the
  // address in that URL is fine; one outside a URL still fails.
  const bare = o.linkAddresses ? t.replace(URL_RE, ' ') : t;
  if (HASH_RE.test(bare) || ADDRESS_RE.test(bare) || HEX_RUN_RE.test(bare)) return 'raw address or hash';
  if (KEY_VALUE_RE.test(t)) return 'key: value list';
  if (bare.split(/(?<=[.!?])\s+/).some((s) => (s.match(NUMBER_RE) ?? []).length >= 4)) return 'too many numbers in one sentence';
  const links = (t.match(URL_RE) ?? []).length;
  if (kind !== 'how_it_works' && links > 0) return 'link in a text field';
  if (kind === 'how_it_works' && links > 1) return 'more than one link';
  if (limit.max_chars ? t.length > limit.max_chars : limit.limit_words ? words(t) > limit.limit_words : false) return 'too long';
  return null;
}

const NEEDS: Record<'link' | 'number' | 'date', (v: string) => boolean> = {
  link: (v) => LINK.test(v),
  number: (v) => DIGIT.test(v),
  date: (v) => DATE.test(v),
};

/**
 * Part D.4: the check before submitting. Pure rules, never blocking, never throws.
 * Builder fixes, in this order, at most MAX_FIXES: empty (only the stored snapshot sees it, as
 * prepare_submission checks once ready), no_number, no_date, no_proof_link, criterion (only a
 * program's hand-written fix, C13). Agent fixes after them: over_limit (only a limit the program
 * states: max_chars or its own guidance.limit_words), not_plain (v2.10 item 11: a description
 * field that isn't plain words, `plainProblem`; it replaces that field's over_limit), and the
 * proof link when the agent knows one (`knownLinks`).
 */
export function preSubmitCheck(a: {
  reqs: SubmissionRequirement[];
  answers: Record<string, string>;
  judging: Judging | null;
  knownLinks?: string[];
}): Fix[] {
  const builder: Fix[] = [];
  const agent: Fix[] = [];
  const val = (r: SubmissionRequirement) => (typeof a.answers[r.key] === 'string' ? a.answers[r.key].trim() : '');
  const label = (r: SubmissionRequirement) => shortLabel(r.label);
  for (const r of a.reqs)
    if (r.required && !val(r)) builder.push({ key: r.key, rule: 'empty', for: 'builder', text: `${label(r)}: add the answer.` });
  for (const r of a.reqs) {
    const v = val(r);
    const k = kindOf(r);
    if (!v || r.type !== 'text') continue;
    if (k === 'traction' && !DIGIT.test(v))
      builder.push({ key: r.key, rule: 'no_number', for: 'builder', text: `${label(r)}: add how many people used it (e.g. 120 users, 900 payments).` });
    else if (DATE_KINDS.includes(k) && !DATE.test(v))
      builder.push({ key: r.key, rule: 'no_date', for: 'builder', text: `${label(r)}: name one milestone and a date.` });
    else if (!NOT_PROSE.includes(k) && !DATE_KINDS.includes(k) && k !== 'traction' && !DIGIT.test(v)) {
      const claim = v.match(CLAIM)?.[1];
      if (claim) builder.push({ key: r.key, rule: 'no_number', for: 'builder', text: `${label(r)}: put the number next to "${claim.toLowerCase()}".` });
    }
  }
  const all = a.reqs.map(val).join('\n');
  // v2.8.1 §C15: only a field that holds proof (a link, a demo, how it works) is ever asked for a
  // link; a form without one (a16z speedrun: just an email) gets no proof-link fix.
  const target = a.reqs.find((r) => PROOF_KINDS.includes(kindOf(r)));
  if (target && !LINK.test(all)) {
    const text = `${label(target)}: link the live app or the contract on the explorer.`;
    if (a.knownLinks?.some((l) => LINK.test(l))) agent.push({ key: target.key, rule: 'no_proof_link', for: 'agent', text });
    else builder.push({ key: target.key, rule: 'no_proof_link', for: 'builder', text });
  }
  for (const c of a.judging?.criteria ?? []) {
    if (!c.fix) continue;
    const r = a.reqs.find((x) => kindOf(x) === c.fix!.kind && val(x));
    if (r && !NEEDS[c.fix.needs](val(r))) builder.push({ key: r.key, rule: 'criterion', for: 'builder', text: `${label(r)}: ${c.fix.add}.` });
  }
  for (const r of a.reqs) {
    const v = val(r);
    if (!v) continue;
    // v2.10 item 11: a description field that isn't plain words; replaces its over_limit fix. A field
    // the program's own criterion asks to link keeps one link, as how_it_works does.
    const k = kindOf(r);
    const asksLink = a.judging?.criteria.some((c) => c.fix?.needs === 'link' && c.fix.kind === k) ?? false;
    const lim = { max_chars: r.max_chars, limit_words: r.guidance?.limit_words };
    const problem = isPlainKind(k) ? plainProblem(v, asksLink ? 'how_it_works' : k, lim, { linkAddresses: asksLink }) : null;
    if (problem) {
      const text =
        problem !== 'too long'
          ? PLAIN_FIX(label(r))
          : lim.max_chars
            ? PLAIN_LENGTH_FIX(label(r), lim.max_chars, 'characters')
            : PLAIN_LENGTH_FIX(label(r), lim.limit_words!, 'words');
      agent.push({ key: r.key, rule: 'not_plain', for: 'agent', text });
      continue;
    }
    const limit = r.guidance?.limit_words;
    if (limit && words(v) > limit)
      agent.push({ key: r.key, rule: 'over_limit', for: 'agent', text: `${label(r)}: trim it to ${limit} words (now ${words(v)}).` });
    else if (r.max_chars && v.length > r.max_chars)
      agent.push({ key: r.key, rule: 'over_limit', for: 'agent', text: `${label(r)}: trim it to ${r.max_chars} characters (now ${v.length}).` });
  }
  return [...builder.slice(0, MAX_FIXES), ...agent];
}

const DRAFT_CELL = 60;
/** At most this many rows; the rest are behind "show all". */
export const DRAFT_ROWS = 8;
/** Which rows a long form's draft keeps: what the coach writes first, contact details last. */
const DRAFT_PRIORITY: FieldKind[] = [
  'one_liner', 'problem', 'solution', 'how_it_works', 'traction', 'why_you', 'use_of_funds', 'milestones', 'team',
  'name', 'demo_video', 'links', 'other', 'contact',
];
const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();

/**
 * Part D: the draft as a short two-column table, in the form's order: at most DRAFT_ROWS rows (the
 * written answers first), each answer cut to 60 characters; the rest on "show all". Pure.
 */
export function draftTable(reqs: SubmissionRequirement[], answers: Record<string, string>): string {
  const shownReqs = reqs.filter((r) => r.required || cell(answers[r.key] ?? ''));
  const keep = new Set(
    [...shownReqs]
      .map((r, i) => ({ r, i, p: DRAFT_PRIORITY.indexOf(kindOf(r)) }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .slice(0, DRAFT_ROWS)
      .map((x) => x.r.key),
  );
  const hidden = shownReqs.length - keep.size;
  let cut = false;
  const rows: string[] = [];
  for (const r of shownReqs) {
    if (!keep.has(r.key)) continue;
    let shown = cell(answers[r.key] ?? '') || '(still needed)';
    if (shown.length > DRAFT_CELL) {
      shown = `${shown.slice(0, DRAFT_CELL).trimEnd()}…`;
      cut = true;
    }
    rows.push(`| ${cell(shortLabel(r.label))} | ${shown} |`);
  }
  const table = ['| Field | Answer |', '|---|---|', ...rows].join('\n');
  const more = hidden > 0 ? `${hidden} more answer${hidden === 1 ? '' : 's'}. ` : '';
  return cut || hidden > 0 ? `${table}\n\n${more}Say "show all" for the full text.` : table;
}

/** The check's builder fixes, numbered (agent fixes are never shown); null when there are none. Pure. */
export function fixesLine(fixes: Fix[]): string | null {
  const shown = fixes.filter((f) => f.for !== 'agent');
  const n = shown.length;
  if (n === 0) return null;
  return [
    `Before you submit, ${n} quick fix${n === 1 ? '' : 'es'} would make it stronger:`,
    ...shown.map((f, i) => `${i + 1}. ${f.text}`),
  ].join('\n');
}

/** Part D.5: the application stored on the entry at confirmation (projects.application). */
export type Application = { answers: Record<string, string>; kinds: Record<string, FieldKind>; fixes: Fix[]; at: string };

/** The snapshot confirm_entry stores. Pure. */
export function applicationOf(reqs: SubmissionRequirement[], answers: Record<string, string>, fixes: Fix[], at: Date): Application {
  return {
    answers,
    kinds: Object.fromEntries(reqs.map((r) => [r.key, kindOf(r)])),
    fixes,
    at: at.toISOString(),
  };
}
