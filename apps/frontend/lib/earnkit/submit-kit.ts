import type { ProgramRow } from './programs';
import type { SubmissionRequirement } from './program-file';
import { todoOf } from './entry-text';
import { multiChoiceParts } from './submission';
import {
  ENTRY_LINK_HOSTS,
  HOST_MODES,
  apiPlatformOf,
  baseModeOf,
  isNoAgentHost,
  prefillKindOf,
  urlHost,
  type SubmitMode,
} from './submit-hosts';

export { ENTRY_LINK_HOSTS, HOST_MODES, type SubmitMode };

/**
 * v2.8 Part E (spec) and Rulings 7, 8, 27-28 (plan): the hand-off to the program's own form. Returned
 * ONLY by confirm_entry, after the builder passed the confirmation (the owner's ordering rule).
 * Four modes, by the form's host: a prefilled link (Google Forms, Airtable, Tally), the agent filling
 * the form in the builder's own browser, a paste list, or the platform's agent API with the
 * builder's own key. EarnKit never holds credentials, never solves a captcha and never submits:
 * the builder always clicks submit. Pure.
 */

/** `missing`: a required answer still to fill (`answer` is ''), shown as a marked blank. */
export type KitField = { key: string; label: string; answer: string; missing?: true };
export type SubmitKit = {
  mode: SubmitMode;
  /** The program's submission_url. */
  url: string;
  /** prefilled_link: the form with every answer that fits in its URL. */
  prefilled_url?: string;
  /** Every answer, in form order. */
  fields: KitField[];
  /** The fields the builder enters by hand (or, agent_fills, adds or uploads themselves), in form order. */
  paste: KitField[];
  /**
   * Ruling C19: what the builder does on the form before the answers, first in their own list
   * (a Google form with verified email collection: GOOGLE_EMAIL_SIGN_IN).
   */
  builder_steps?: string[];
  /** agent_fills: AGENT_FILL_STEPS. */
  agent_steps?: string[];
  /** api: the answers by requirement key, sent with the builder's own agent key (never in the kit). */
  api?: { platform: 'superteam' | 'karma'; payload: Record<string, string> };
  proof: { kind: 'entry_link' | 'confirmation'; ask: string };
  /** v2.8 Ruling C9: the required answers still missing, as short to-dos (todoOf), in form order. */
  missing: string[];
  show_to_builder: string;
};

/** Ruling C9: how a required answer still missing shows in the paste list. */
export const STILL_NEEDED = '(still needed)';

/**
 * Ruling 8 (plan): a public form's field ids, read once at listing from the public form and stored
 * in the program file (never fetched at request time). `fields` maps requirement keys to the form's
 * own parameter: `entry.<n>` (Google), the field name (Airtable), the URL parameter (Tally).
 * `sign_in` (Ruling C19): `false` (no sign-in), `'email_only'` (Google sign-in only to collect a
 * verified email, no file question: the prefilled link stays, and the builder signs in and ticks
 * the email box first) or `true` (a file question or another sign-in cause: filled in the
 * builder's browser instead). `read_at`: the day the ids were read (YYYY-MM-DD).
 */
export type FormSignIn = boolean | 'email_only';
export type ProgramForm = { url: string; fields: Record<string, string>; sign_in: FormSignIn; read_at: string };
/** The brief's name for ProgramForm (module scope; the DOM FormData is never used here). */
export type FormData = ProgramForm;

export type KitProgram = Pick<ProgramRow, 'submission_url' | 'submission_requirements' | 'title'> & {
  submit_host?: string | null;
  submit_api?: boolean;
  form?: ProgramForm | null;
  /** v2.8.1 §C14: an investment program (a16z speedrun): its form goes on past what EarnKit lists. */
  investment?: boolean;
  organizer?: string;
};

/**
 * v2.8.1 §C14: an investment program's public form is only its first step (a16z speedrun: the
 * email); the rest of the application isn't public, so the kit says where it goes on: "After the
 * email step, the application continues on a16z's site." Null for every other program. Pure.
 */
export function continuesLine(p: Pick<KitProgram, 'investment' | 'organizer' | 'submission_requirements'>): string | null {
  // v3 Stage 2: an upcoming program has no form steps yet, so nothing continues.
  if (!p.investment || p.submission_requirements.length === 0) return null;
  const org = p.organizer?.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const steps = p.submission_requirements.filter((r) => r.required);
  const step = steps.length === 1 ? `the ${steps[0].label.trim().replace(/[?:.]+$/, '').toLowerCase()} step` : 'these steps';
  return `After ${step}, the application continues on ${org ? `${org}'s` : 'their'} site.`;
}

/**
 * v3.1 cold read (owner-approved): an investment whose application is on its own site, where EarnKit's part is one email
 * step (continuesLine): "a16z speedrun's application is on their site and starts with your email: <link>" (the round's
 * code, "SR008", left out of the name). Null for every other program. Pure.
 */
export function siteFormLine(p: Pick<KitProgram, 'investment' | 'organizer' | 'submission_requirements' | 'title' | 'submission_url'>, todo: string | null): string | null {
  if (!continuesLine(p) || p.submission_requirements.filter((r) => r.required).length !== 1) return null;
  const name = p.title.trim().replace(/\s+[A-Z]{2,5}\d{1,4}$/, '');
  const what = (todo ?? 'your email').replace(/\s*\(check it\)$/, '');
  return `${name}'s application is on their site and starts with ${what}: ${p.submission_url}`;
}

/** Ruling 27 (plan): a prefilled URL never goes past this; answers that don't fit are pasted. */
export const MAX_PREFILL_URL = 8000;

/** Ruling C19: the builder's first item on a Google form that collects a verified email. */
export const GOOGLE_EMAIL_SIGN_IN = 'Sign in to Google and tick Record my email address.';
/** One heading for the builder's own list, whatever is in it (answers to paste, boxes to tick, files). */
export const OWN_LIST_HEADING = 'You add these yourself:';

export const ENTRY_LINK_ASK = 'After you submit, paste your entry link here.';
export const CONFIRMATION_ASK = 'After you submit, send me the confirmation screenshot or email.';

/**
 * Ruling 7 (plan): what an agent with a browser does. Agent text (kit.agent_steps), never shown.
 * It stops for the builder at every login, captcha, wallet signature and file upload, and never
 * clicks submit.
 */
export const AGENT_FILL_STEPS: string[] = [
  "Open kit.url in the builder's own logged-in browser, through your browser tool on their machine. Never a separate or cloud browser.",
  'Fill each field in kit.fields with its answer, matching the form label. Leave a field marked missing empty.',
  'Stop and ask the builder at any login, captcha, wallet signature or file upload. Never type a password, code or key, and never solve a captcha.',
  'Never click submit.',
  'Tell the builder the form is filled and ready for them to check and submit.',
];

/** The form's host ("dorahacks.io"), from submit_host or submission_url; '' when unknown. Pure. */
export function hostOf(p: Pick<KitProgram, 'submission_url' | 'submit_host'>): string {
  const own = p.submit_host?.trim().toLowerCase().replace(/^www\./, '');
  return own || urlHost(p.submission_url);
}
/** Task 8's name for hostOf. */
export const submitHost = hostOf;

/** Ruling 28 (plan): how the builder proves the entry once submitted. Pure. */
export function proofFor(host: string): SubmitKit['proof'] {
  return ENTRY_LINK_HOSTS.includes(host) ? { kind: 'entry_link', ask: ENTRY_LINK_ASK } : { kind: 'confirmation', ask: CONFIRMATION_ASK };
}

/**
 * Ruling 27 (plan): the mode for this program and this agent. The host's registry mode, then:
 * a Google form that needs sign-in is filled in the browser; a prefilled link without form data is
 * pasted; `api` only when the file confirms the listing allows agents (`submit_api`), else the
 * browser; no browser means paste. DoraHacks and Questbook are always pasted. Pure.
 */
export function submitModeFor(p: KitProgram, agent: { browser: boolean }): SubmitMode {
  const host = hostOf(p);
  let mode = baseModeOf(host);
  if (mode === 'prefilled_link' && !p.form) mode = 'copy_paste';
  // Ruling C19: a sign-in only to collect a verified email keeps the link; any other needs the browser.
  if (mode === 'prefilled_link' && p.form?.sign_in === true) mode = 'agent_fills';
  if (mode === 'api' && !p.submit_api) mode = 'agent_fills';
  if (mode === 'agent_fills' && !agent.browser) mode = 'copy_paste';
  if (isNoAgentHost(host)) mode = 'copy_paste';
  return mode;
}

const enc = encodeURIComponent;

/**
 * Adds each param's `param=value` pairs (v3.1: a multi_choice repeats the param once per option)
 * while the URL stays within MAX_PREFILL_URL; a param that doesn't fit whole goes to `over`.
 */
function prefill(base: string, sep: '?' | '&', pairs: [string, string[]][], over: string[]): string {
  let url = base;
  let s: string = sep;
  for (const [param, values] of pairs) {
    const next = `${url}${s}${values.map((v) => `${param}=${enc(v)}`).join('&')}`;
    if (next.length > MAX_PREFILL_URL) {
      over.push(param);
      continue;
    }
    url = next;
    s = '&';
  }
  return url;
}

/**
 * Rulings 8, 27 (plan): which answers can ride in the URL; the rest are pasted. A key the form
 * doesn't know (a stale form), a choice that isn't exactly one of its options, and a file can't.
 * v3.1: a multi_choice rides as one pair per option (`multi`: Google's checkbox prefill) when every
 * part is one of its options; otherwise, or on a form without `multi`, it is pasted.
 */
function fillable(form: ProgramForm, reqs: SubmissionRequirement[], answers: Record<string, string>, multi: boolean) {
  const pairs: [string, string, string[]][] = []; // [key, param, values]
  const left: string[] = [];
  for (const r of reqs) {
    const v = answers[r.key]?.trim();
    if (!v) continue;
    const param = form.fields[r.key];
    const parts = r.type === 'multi_choice' ? multiChoiceParts(v) : [v];
    const badChoice =
      (r.type === 'choice' || r.type === 'multi_choice') && (parts.length === 0 || !parts.every((x) => (r.options ?? []).includes(x)));
    if (!param || badChoice || r.type === 'file' || (r.type === 'multi_choice' && !multi)) left.push(r.key);
    else pairs.push([r.key, param, parts]);
  }
  return { pairs, left };
}

function build(
  base: string,
  sep: '?' | '&',
  paramOf: (p: string) => string,
  form: ProgramForm,
  reqs: SubmissionRequirement[],
  answers: Record<string, string>,
  multi = false,
): { url: string; left: string[] } {
  const { pairs, left } = fillable(form, reqs, answers, multi);
  const over: string[] = [];
  const url = prefill(base, sep, pairs.map(([, p, v]) => [paramOf(p), v]), over);
  const overKeys = pairs.filter(([, p]) => over.includes(paramOf(p))).map(([k]) => k);
  const order = reqs.map((r) => r.key);
  return { url, left: [...left, ...overKeys].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}

/** Google Forms: `viewform?usp=pp_url&entry.<n>=<answer>`; a checkbox repeats `entry.<n>` per option. Pure. */
export const googlePrefill = (f: ProgramForm, reqs: SubmissionRequirement[], a: Record<string, string>) =>
  build(`${f.url}?usp=pp_url`, '&', (p) => p, f, reqs, a, true);
/** Airtable: `?prefill_<Field Name>=<answer>`. Pure. */
export const airtablePrefill = (f: ProgramForm, reqs: SubmissionRequirement[], a: Record<string, string>) =>
  build(f.url, '?', (p) => `prefill_${enc(p)}`, f, reqs, a);
/** Tally: `?<param>=<answer>`. Pure. */
export const tallyPrefill = (f: ProgramForm, reqs: SubmissionRequirement[], a: Record<string, string>) =>
  build(f.url, '?', (p) => enc(p), f, reqs, a);

const PREFILL = { google: googlePrefill, airtable: airtablePrefill, tally: tallyPrefill } as const;

const listOf = (fields: KitField[]) => fields.map((f) => `${f.label}\n${f.missing ? STILL_NEEDED : f.answer}`).join('\n\n');

/**
 * The kit for one confirmed entry. `answers`: every valid answer by requirement key (the agent's
 * answers plus what the project info fills in). Fields follow the form's own order and labels;
 * empty optional answers are left out. Ruling C9: a required answer that is empty (or, in
 * `opts.problems`, given but not valid) is never dropped: it is a marked blank, and the kit opens
 * with "Before you submit: …" naming each one. Every mode ends with the proof ask. Pure.
 */
export function submitKit(
  program: KitProgram,
  answers: Record<string, string>,
  agent: { browser: boolean },
  opts: { problems?: string[] } = {},
): SubmitKit {
  const problems = new Set(opts.problems ?? []);
  const reqs = program.submission_requirements;
  const missing: string[] = [];
  const fields: KitField[] = reqs.flatMap((r): KitField[] => {
    const answer = problems.has(r.key) ? '' : (answers[r.key]?.trim() ?? '');
    if (answer) return [{ key: r.key, label: r.label, answer }];
    // An empty optional answer is left out; one given but not valid is a blank to check.
    if (!r.required && !problems.has(r.key)) return [];
    missing.push(todoOf(r, problems.has(r.key)));
    return [{ key: r.key, label: r.label, answer: '', missing: true }];
  });
  const given = Object.fromEntries(fields.filter((f) => !f.missing).map((f) => [f.key, f.answer]));
  const host = hostOf(program);
  const proof = proofFor(host);
  const title = program.title;
  const before = missing.length ? [`Before you submit: ${missing.join(', ')}.\n`] : [];
  const continues = continuesLine(program);
  const done = (lines: string[]) => [...before, ...lines, ...(continues ? [`\n${continues}`] : []), `\n${proof.ask}`].join('\n');
  const base = { url: program.submission_url, fields, proof, missing };

  let mode = submitModeFor(program, agent);
  const kind = prefillKindOf(host);
  if (mode === 'prefilled_link' && program.form && kind) {
    const { url, left } = PREFILL[kind](program.form, reqs, given);
    const paste = fields.filter((f) => f.missing || left.includes(f.key));
    // Ruling C19: driven by the form data, never the program id.
    const builder_steps = kind === 'google' && program.form.sign_in === 'email_only' ? [GOOGLE_EMAIL_SIGN_IN] : [];
    const own = [...builder_steps, ...(paste.length ? [listOf(paste)] : [])];
    return {
      mode,
      ...base,
      prefilled_url: url,
      paste,
      ...(builder_steps.length > 0 && { builder_steps }),
      show_to_builder: done([
        missing.length
          ? `For ${title}, open this, check it, and click submit once the blanks are in:`
          : `Ready for ${title}. Open this, check it, and click submit:`,
        url,
        ...(own.length ? [`\n${OWN_LIST_HEADING}`, own.join('\n\n')] : []),
      ]),
    };
  }
  if (mode === 'prefilled_link') mode = 'copy_paste';

  if (mode === 'agent_fills') {
    // The builder uploads files and fills the blanks; the agent stops for them (AGENT_FILL_STEPS).
    const types = new Map(reqs.map((r) => [r.key, r.type]));
    const paste = fields.filter((f) => f.missing || types.get(f.key) === 'file');
    return {
      mode,
      ...base,
      paste,
      agent_steps: AGENT_FILL_STEPS,
      show_to_builder: done([
        missing.length
          ? `For ${title}, I'll fill the form in your browser. You log in, add the blanks, check it and click submit.`
          : `Ready for ${title}. I'll fill the form in your browser. You log in, check it and click submit.`,
        ...(paste.length ? [`\n${OWN_LIST_HEADING}`, listOf(paste)] : []),
      ]),
    };
  }

  const platform = mode === 'api' ? apiPlatformOf(host) : null;
  if (platform) {
    const paste = fields.filter((f) => f.missing);
    return {
      mode: 'api',
      ...base,
      paste,
      api: { platform: platform.platform, payload: given },
      show_to_builder: done([
        missing.length
          ? `For ${title}, once the blanks are in, I'll send it to ${platform.name} for you, then you confirm it there.`
          : `Ready for ${title}. I'll send it to ${platform.name} for you, then you confirm it there.`,
        ...(paste.length ? ['\nStill needed:', listOf(paste)] : []),
      ]),
    };
  }

  const list = listOf(fields);
  return {
    mode: 'copy_paste',
    ...base,
    paste: fields,
    show_to_builder: done([
      missing.length ? `For ${title}, paste each answer into the form:` : `Ready for ${title}. Paste each answer into the form:`,
      `Form: ${program.submission_url}`,
      ...(list ? [`\n${list}`] : []),
    ]),
  };
}

/**
 * The agent's instructions for this kit (agent_note; never shown to the builder). Pure.
 */
export function kitAgentNote(kit: SubmitKit, program: Pick<KitProgram, 'submission_url' | 'submit_host'>): string {
  const host = hostOf(program);
  switch (kit.mode) {
    case 'prefilled_link':
      return (
        'The builder opens kit.prefilled_url, does kit.builder_steps if any (a Google sign-in is theirs alone), adds kit.paste and clicks submit. ' +
        'Never submit the form for them.'
      );
    case 'agent_fills':
      return `Follow kit.agent_steps in order: ${AGENT_FILL_STEPS.join(' ')}`;
    case 'api':
      return (
        "Send the answers through the platform's own agent API with the builder's own agent key, only on a listing that allows agents. " +
        "kit.api.payload is keyed by EarnKit's requirement keys: map each answer to the platform's own submission fields first. " +
        'Never ask for the key here or put it in any EarnKit call. The builder confirms the entry on the platform.'
      );
    default:
      return isNoAgentHost(host)
        ? "This platform's terms ban automated use: never fill or submit its form for the builder, even with a browser tool. The builder pastes each answer."
        : 'The builder pastes each answer into the form and clicks submit. Never submit the form for them.';
  }
}

/**
 * v2.9 F25: the whole agent_note of confirm_entry's kit reply: the kit rules that left confirm_entry's
 * description (the kit only here, the mode's rules, the builder clicks submit, missing answers),
 * then record_submission. Pure.
 */
export function kitReplyNote(kit: SubmitKit, program: Pick<KitProgram, 'submission_url' | 'submit_host'>): string {
  return (
    'Show show_to_builder as written. The kit is only in this reply; never show a kit any other way. ' +
    `${kitAgentNote(kit, program)} ` +
    'The builder always clicks submit. If the kit lists answers still missing, fill them in with the builder before they submit. ' +
    'Once the builder has submitted, call tell with submitted: { program_id, project_id }' +
    (kit.proof.kind === 'entry_link' ? ' and their entry link as external_submission_url.' : '.')
  );
}

/** v3.1 (spec 3.2), Task 16 step 6: the one question after a drafted application; a yes records `applied`. */
export const SENT_ASK = 'Sent it?';
/** Task 16 step 6: "Your Base Builder Grant Program application is ready. I filled 6 of 16 answers from your work.". Pure. */
export const draftReadyLine = (title: string, filled: number, total: number) =>
  `Your ${title} application is ready. I filled ${filled} of ${total} ${total === 1 ? 'answer' : 'answers'} from your work.`;
/** Task 16 step 6: the prefilled form's open line. */
export const OPEN_PREFILLED = 'Open the form, your answers are already in it:';
/** Task 16 step 6: a prefilled draft's answers that didn't fit the link, above it. */
export const PASTE_LEFT = "These didn't fit the link, paste them in:";

/**
 * v3.1 (spec 3.2): a drafted application, before anything is recorded. `fields`: every answer in full (agent-facing);
 * `show_to_builder`: the builder's draft, where answers show without their scheme (D7) so the form link is the
 * reply's one https link.
 */
export type DraftKit = {
  mode: 'prefilled_link' | 'copy_paste';
  url: string;
  prefilled_url?: string;
  fields: KitField[];
  missing: string[];
  show_to_builder: string;
};

/** D7: an answer as the builder reads it in the draft, every link without its scheme. Pure. */
export const schemeless = (s: string) => s.replace(/https?:\/\//gi, '');
/**
 * Task 9 fix round 1: an agent-written answer as the builder reads it: links without their scheme (D7), a question mark
 * as a period and an em dash as a comma, so the reply keeps its one question and no em dash. Pure.
 */
export const shownAnswer = (s: string) => schemeless(s).replace(/\?/g, '.').replace(/\s*\u2014\s*/g, ', ');
/** Task 9 fix round 1: a copy-and-paste draft whose shown answers lost a scheme says so before the paste line. */
export const ADD_SCHEME_LINE = 'Add https:// to each link when you paste.';
/** A label as a draft heading: the form's own words without its question marks (a reply holds one question). Pure. */
const draftLabel = (label: string) => label.replace(/\s*\?/g, '').trim();

/**
 * v3.1 (spec 3.2), "Apply with this page", Task 16 step 6: the draft the builder sends themselves. Never submits and
 * records nothing. The mode as submitModeFor without a browser; an agent-filled or API form is copied and pasted.
 * `fields`: every field (required, or answered) with its answer, or missing. The builder reads: how many answers are
 * filled, what they add (`note`, the caller's one line, after it), where an investment's form goes on; a copy-and-paste
 * draft's answers (answers that don't fit a prefilled link too); then the one link and SENT_ASK. Pure.
 */
export function draftKit(program: KitProgram, answers: Record<string, string>, o: { problems?: string[]; note?: string | null } = {}): DraftKit {
  const problems = new Set(o.problems ?? []);
  const reqs = program.submission_requirements;
  const missing: string[] = [];
  const fields: KitField[] = reqs.flatMap((r): KitField[] => {
    const answer = problems.has(r.key) ? '' : (answers[r.key]?.trim() ?? '');
    if (answer) return [{ key: r.key, label: r.label, answer }];
    if (!r.required && !problems.has(r.key)) return [];
    missing.push(todoOf(r, problems.has(r.key)));
    return [{ key: r.key, label: r.label, answer: '', missing: true }];
  });
  const filled = fields.filter((f) => !f.missing);
  // v3.1 cold read (owner-approved): a program whose form lives on its own site and starts with only an email is never
  // "Your ... application is ready. I filled 0 of 1 answer": one line with the form link, and "Sent it?".
  const site = siteFormLine(program, missing[0] ?? null);
  if (site)
    return { mode: 'copy_paste', url: program.submission_url, fields, missing, show_to_builder: `${site}\n${SENT_ASK}` };
  const given = Object.fromEntries(filled.map((f) => [f.key, f.answer]));
  const kind = prefillKindOf(hostOf(program));
  const pre =
    submitModeFor(program, { browser: false }) === 'prefilled_link' && program.form && kind ? PREFILL[kind](program.form, reqs, given) : null;
  const block = (fs: KitField[]) => fs.map((f) => `${draftLabel(f.label)}\n${shownAnswer(f.answer)}`).join('\n\n');
  const left = pre ? filled.filter((f) => pre.left.includes(f.key)) : [];
  const answersShown = pre ? (left.length ? `${PASTE_LEFT}\n\n${block(left)}` : null) : filled.length ? block(filled) : null;
  const send = pre
    ? [`${OPEN_PREFILLED} ${pre.url}`, SENT_ASK]
    : [
        ...(filled.some((f) => schemeless(f.answer) !== f.answer) ? [ADD_SCHEME_LINE] : []),
        `Paste each answer into the form: ${program.submission_url}`,
        SENT_ASK,
      ];
  const explain = [
    draftReadyLine(program.title, filled.length, fields.length),
    ...(missing.length ? [`You add: ${missing.join(', ')}.`] : []),
    ...(o.note ? [o.note] : []),
    ...(continuesLine(program) ? [continuesLine(program)!] : []),
  ];
  return {
    mode: pre ? 'prefilled_link' : 'copy_paste',
    url: program.submission_url,
    ...(pre && { prefilled_url: pre.url }),
    fields,
    missing,
    show_to_builder: [explain.join('\n'), answersShown, send.join('\n')].filter((x): x is string => Boolean(x)).join('\n\n'),
  };
}
