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

/** Ruling 26 (plan): the order the few builder questions are picked in. */
export const QUESTION_ORDER: FieldKind[] = ['traction', 'why_you', 'use_of_funds', 'milestones', 'team', 'problem', 'contact'];
export const MAX_FIRST_QUESTIONS = 3;
export const MAX_LATER_QUESTIONS = 1;
export const MAX_FIXES = 3;

const DIGIT = /\d/;
const LINK = /https:\/\/\S+/;
const CLAIM = /\b(users?|customers?|revenue|volume|growth|transactions|downloads|installs)\b/i;
const NUMBER_KINDS: FieldKind[] = ['traction', 'use_of_funds', 'milestones'];
/** Kinds the agent drafts from the repo and onchain data: never asked. */
const AGENT_DRAFTS: FieldKind[] = ['name', 'one_liner', 'solution', 'how_it_works', 'links', 'demo_video', 'other'];
/** Kinds whose answers aren't prose (no "add a number" claim check); `other` is often a choice. */
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

const PROPER = /^(Telegram|Discord|Farcaster|Twitter|Warpcast|GitHub|LinkedIn)\b/;
/** "Full name" reads "full name" mid-sentence; "X (Twitter) handle", "GitHub" and "Telegram" keep their case. */
const lowerFirst = (s: string) => (PROPER.test(s) ? s : s.replace(/^(\p{Lu})(\p{Ll}+)(?![\p{L}])/u, (_m, a: string, b: string) => a.toLowerCase() + b));

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
 * project's contact details and links are banked per slot, as a JSON object, not as one answer.
 */
const SLOT_KINDS: FieldKind[] = ['contact', 'links'];
const SLOTS: [string, RegExp][] = [
  ['email', /e-?mail/],
  ['telegram', /telegram/],
  ['discord', /discord/],
  ['farcaster', /farcaster|warpcast/],
  ['x', /(^|[^a-z])x([^a-z]|$)|twitter/],
  ['github', /github|repo|code/],
  ['demo', /demo|video|loom/],
  ['live', /live|deploy|website|product|url/],
  ['name', /name/],
  ['profile', /profile/],
];
const slotOf = (r: SubmissionRequirement) => {
  const t = `${r.key} ${r.label}`.toLowerCase();
  return SLOTS.find(([, re]) => re.test(t))?.[0] ?? r.key;
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
 * The answer bank's fill: every field still empty whose kind the bank holds gets the banked answer
 * (a given answer is never overwritten; `other` is program-specific and never filled). Pure.
 */
export function bankFill(reqs: SubmissionRequirement[], answers: Record<string, string>, bank: Map<FieldKind, string>) {
  const out = { ...answers };
  const from_bank: Record<string, string> = {};
  for (const r of reqs) {
    const k = kindOf(r);
    if (k === 'other' || out[r.key]?.trim()) continue;
    const banked = SLOT_KINDS.includes(k) ? slotsOf(bank.get(k))[slotOf(r)] : bank.get(k);
    if (banked?.trim()) out[r.key] = from_bank[r.key] = banked;
  }
  return { answers: out, from_bank };
}

/** The bank's longest answer, as projects.ts SUBMISSION_VALUE_MAX and the table's CHECK. */
export const BANK_ANSWER_MAX = 4096;

/**
 * What to bank from confirmed answers, one per kind (Ruling 6 (plan)): never `other`; several fields
 * of one kind join with a blank line; contact details and links merge into the kind's slots, over
 * what `existing` holds. An answer over BANK_ANSWER_MAX is left out. Pure.
 */
export function bankEntries(reqs: SubmissionRequirement[], answers: Record<string, string>, existing: Map<FieldKind, string> = new Map()) {
  const plain = new Map<FieldKind, string[]>();
  const slots = new Map<FieldKind, Record<string, string>>();
  for (const r of reqs) {
    const k = kindOf(r);
    const v = answers[r.key]?.trim();
    if (k === 'other' || !v) continue;
    if (SLOT_KINDS.includes(k)) {
      const s = slots.get(k) ?? { ...slotsOf(existing.get(k)) };
      s[slotOf(r)] = v;
      slots.set(k, s);
    } else plain.set(k, [...(plain.get(k) ?? []), v]);
  }
  const out = new Map<FieldKind, string>();
  for (const [k, vs] of plain) out.set(k, vs.join('\n\n'));
  for (const [k, s] of slots) out.set(k, JSON.stringify(s));
  for (const [k, v] of out) if (v.length > BANK_ANSWER_MAX) out.delete(k);
  return out;
}

export type Question = { keys: string[]; kind: FieldKind; text: string };

/**
 * Ruling 26 (plan): the few questions only the builder can answer, for required fields still empty
 * after the agent's draft and the bank fill, in QUESTION_ORDER; at most 3 for a project's first
 * program, 1 after. Every empty contact field folds into one question. `project` names the
 * project in "Who has used TipJar so far?". Pure.
 */
export function questionsFor(a: {
  reqs: SubmissionRequirement[];
  answers: Record<string, string>;
  first: boolean;
  project?: string;
}): Question[] {
  const empty = a.reqs.filter((r) => r.required && !a.answers[r.key]?.trim() && !AGENT_DRAFTS.includes(kindOf(r)));
  const name = a.project?.trim();
  const out: Question[] = [];
  for (const kind of QUESTION_ORDER) {
    const reqs = empty.filter((r) => kindOf(r) === kind);
    if (reqs.length === 0) continue;
    if (kind === 'contact') {
      const labels = reqs.map((r) => lowerFirst(shortLabel(r.label).replace(/^(your|the)\s+/i, '')));
      const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
      out.push({ keys: reqs.map((r) => r.key), kind, text: `Your ${list}?` });
    } else {
      const g = guidanceFor(reqs[0]);
      const text = g.questions[0] ?? `${shortLabel(reqs[0].label)}?`;
      out.push({ keys: reqs.map((r) => r.key), kind, text: name ? text.replace(/\bit\b/, name) : text });
    }
  }
  return out.slice(0, a.first ? MAX_FIRST_QUESTIONS : MAX_LATER_QUESTIONS);
}

/** The builder's screen while the coach has questions; null when it has none. Pure. */
export function coachIntro(title: string, questions: Question[]): string | null {
  const n = questions.length;
  if (n === 0) return null;
  return [
    `${title}: ${n} quick question${n === 1 ? '' : 's'}, then I'll write your application.`,
    ...questions.map((q, i) => `${i + 1}. ${q.text}`),
  ].join('\n');
}

export type Fix = { key: string; rule: 'empty' | 'over_limit' | 'no_number' | 'no_proof_link' | 'criterion'; text: string };

/**
 * Part D.4: the check before submitting. Pure rules, in this order, at most MAX_FIXES; never
 * blocking (the builder can submit with fixes open). Never throws.
 */
export function preSubmitCheck(a: { reqs: SubmissionRequirement[]; answers: Record<string, string>; judging: Judging | null }): Fix[] {
  const fixes: Fix[] = [];
  const val = (r: SubmissionRequirement) => (typeof a.answers[r.key] === 'string' ? a.answers[r.key].trim() : '');
  for (const r of a.reqs) if (r.required && !val(r)) fixes.push({ key: r.key, rule: 'empty', text: `${shortLabel(r.label)}: still empty.` });
  for (const r of a.reqs) {
    const v = val(r);
    if (!v) continue;
    const limit = guidanceFor(r).limit_words;
    if (limit && words(v) > limit)
      fixes.push({ key: r.key, rule: 'over_limit', text: `${shortLabel(r.label)}: ${words(v)} words; keep it to ${limit}.` });
    else if (r.max_chars && v.length > r.max_chars)
      fixes.push({ key: r.key, rule: 'over_limit', text: `${shortLabel(r.label)}: ${v.length} characters; keep it to ${r.max_chars}.` });
  }
  for (const r of a.reqs) {
    const v = val(r);
    const k = kindOf(r);
    if (!v || r.type !== 'text' || DIGIT.test(v)) continue;
    if (NUMBER_KINDS.includes(k) || (!NOT_PROSE.includes(k) && CLAIM.test(v)))
      fixes.push({ key: r.key, rule: 'no_number', text: `${shortLabel(r.label)}: add a number (users, volume or revenue).` });
  }
  const all = a.reqs.map(val).join('\n');
  if (a.reqs.length > 0 && !LINK.test(all)) {
    const target = a.reqs.find((r) => PROOF_KINDS.includes(kindOf(r))) ?? a.reqs[0];
    fixes.push({ key: target.key, rule: 'no_proof_link', text: 'Add one proof link (live app, demo or contract).' });
  }
  for (const c of a.judging?.criteria ?? []) {
    const hit = c.words.some((w) => new RegExp(`\\b${w.replace(/[^a-z]/g, '')}`, 'i').test(all));
    if (!hit) fixes.push({ key: '', rule: 'criterion', text: `No answer shows ${lowerFirst(c.text)} yet.` });
  }
  return fixes.slice(0, MAX_FIXES);
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

/** The check's fixes for the builder, numbered; null when there are none. Pure. */
export function fixesLine(fixes: Fix[]): string | null {
  const n = fixes.length;
  if (n === 0) return null;
  return [
    `Before you submit, ${n} quick fix${n === 1 ? '' : 'es'} would make it stronger:`,
    ...fixes.map((f, i) => `${i + 1}. ${f.text}`),
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
