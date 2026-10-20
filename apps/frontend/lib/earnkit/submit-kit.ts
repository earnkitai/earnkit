import type { ProgramRow } from './programs';
import type { SubmissionRequirement } from './program-file';
import { todoOf } from './entry-text';
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

/** Adds `param=value` pairs while the URL stays within MAX_PREFILL_URL; the rest go to `over`. */
function prefill(base: string, sep: '?' | '&', pairs: [string, string][], over: string[]): string {
  let url = base;
  let s: string = sep;
  for (const [param, value] of pairs) {
    const next = `${url}${s}${param}=${enc(value)}`;
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
 */
function fillable(form: ProgramForm, reqs: SubmissionRequirement[], answers: Record<string, string>) {
  const pairs: [string, string, string][] = []; // [key, param, value]
  const left: string[] = [];
  for (const r of reqs) {
    const v = answers[r.key]?.trim();
    if (!v) continue;
    const param = form.fields[r.key];
    const badChoice = r.type === 'choice' && !(r.options ?? []).includes(v);
    if (!param || badChoice || r.type === 'file') left.push(r.key);
    else pairs.push([r.key, param, v]);
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
): { url: string; left: string[] } {
  const { pairs, left } = fillable(form, reqs, answers);
  const over: string[] = [];
  const url = prefill(base, sep, pairs.map(([, p, v]) => [paramOf(p), v]), over);
  const overKeys = pairs.filter(([, p]) => over.includes(paramOf(p))).map(([k]) => k);
  const order = reqs.map((r) => r.key);
  return { url, left: [...left, ...overKeys].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}

/** Google Forms: `viewform?usp=pp_url&entry.<n>=<answer>`. Pure. */
export const googlePrefill = (f: ProgramForm, reqs: SubmissionRequirement[], a: Record<string, string>) =>
  build(`${f.url}?usp=pp_url`, '&', (p) => p, f, reqs, a);
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
