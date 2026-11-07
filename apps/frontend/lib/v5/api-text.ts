/**
 * The programs write API's text and link rules. A bot writes from open-web pages and its programs
 * reach agents, so every free-text field is plain visible text with no links or markup, and every
 * URL is plain, normalized https on a domain name; builders are sent only to the program's own
 * site or a known submit platform. Pure.
 */
import { isIP } from 'node:net';
import { ProgramFile, SubmissionRequirement, type Program } from './program-file';
import { apiSubmitHostAllowed, normalHost, sourceSiteName } from './submit-hosts';
import { RAW_CAP, UntrustedTextError, cleanText } from './untrusted-text';

/** Fields the API never writes: the owner adds them by file. */
export const NOT_WRITABLE = ['logo', 'reviewers_contact'] as const;

/** Text caps beyond the schema's (titles and names are quoted inside EarnKit's sentences). */
export const API_TITLE_MAX = 120;
export const API_ORGANIZER_MAX = 80;
const URL_MAX = 2048;

const notWritable = (field: string) => `${field}: the API can't set ${field}; the owner adds it by file`;
const unknown = (field: string) => `${field}: not a program field`;

/** The top-level and requirement keys of a raw program that the API refuses: `logo`, and any key the record has not. Pure. */
export function notWritableFields(raw: Record<string, unknown>): string[] {
  const fields = Object.keys(ProgramFile.shape);
  const top = Object.keys(raw).flatMap((k) =>
    (NOT_WRITABLE as readonly string[]).includes(k) ? [notWritable(k)] : fields.includes(k) ? [] : [unknown(k)],
  );
  const reqFields = Object.keys(SubmissionRequirement.shape);
  const reqs = Array.isArray(raw.submission_requirements) ? raw.submission_requirements : [];
  const inner = reqs.flatMap((r, i) =>
    r && typeof r === 'object' && !Array.isArray(r)
      ? Object.keys(r).filter((k) => !reqFields.includes(k)).map((k) => unknown(`submission_requirements.${i}.${k}`))
      : [],
  );
  return [...top, ...inner];
}

const MARKDOWN_LINK = /!?\[[^\]\n]{0,500}\]\s{0,3}\(|^\s{0,3}\[[^\]\n]{1,200}\]:\s/m;
// Invisible characters an agent reads but a person doesn't see: controls but newline and tab,
// format characters (bidi, zero-width, tags), private use and unassigned.
const HIDDEN = /[^\P{Cc}\n\t]|\p{Cf}|\p{Co}|\p{Cn}/u;
// Invisible letters and marks: Hangul fillers, the combining grapheme joiner, Mongolian free
// variation selectors, Khmer invisible vowels, the Braille blank, line and paragraph separators.
const INVISIBLE = /[\u115F\u1160\u3164\uFFA0\u034F\u180B-\u180F\u17B4\u17B5\u2800\u2028\u2029]/u;
// Variation selectors: only U+FE0E or U+FE0F right after an emoji or pictograph.
const STRAY_VS = /[\uFE00-\uFE0D\u{E0100}-\u{E01EF}]|(?<!\p{Extended_Pictographic})[\uFE0E\uFE0F]/u;
// A lone surrogate (not well-formed UTF-16), which Postgres would store as U+FFFD.
const LONE_SURROGATE = /\p{Cs}/u;
const codePoint = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** Hidden characters, malformed UTF-16 and text that isn't NFKC-normalized, or null. */
export function hiddenTextProblem(field: string, value: string): string | null {
  const lone = LONE_SURROGATE.exec(value);
  if (lone) return `${field}: not well-formed text (a lone surrogate ${codePoint(lone[0])}); send valid UTF-8`;
  const hidden = HIDDEN.exec(value) ?? INVISIBLE.exec(value) ?? STRAY_VS.exec(value);
  if (hidden) return `${field}: no hidden, control or format characters (${codePoint(hidden[0])}); plain visible text only`;
  if (value.normalize('NFKC') !== value) return `${field}: send plain normalized text (NFKC); no full-width or compatibility characters`;
  return null;
}

/**
 * A URL field's problem, or null: at most 2,048 printable ASCII characters, already normalized
 * (equal to `new URL(v).href`), https, on a domain name (no IP, no trailing dot), with no
 * fragment, no username or password, and no markdown link or square brackets.
 */
export function apiUrlProblem(field: string, value: string): string | null {
  if (value.length > URL_MAX) return `${field}: at most ${URL_MAX.toLocaleString('en-US')} characters`;
  const hidden = hiddenTextProblem(field, value);
  if (hidden) return hidden;
  if (!/^[\x21-\x7E]+$/.test(value)) return `${field}: printable ASCII only, no spaces; percent-encode anything else`;
  if (MARKDOWN_LINK.test(value)) return `${field}: no markdown links; send the plain URL`;
  if (/[[\]]/.test(value)) return `${field}: no [ or ] characters; percent-encode them`;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return `${field}: not a valid URL`;
  }
  if (value.includes('#') || u.hash !== '') return `${field}: no fragment (#)`;
  if (u.username !== '' || u.password !== '') return `${field}: no username or password in the URL`;
  if (u.href !== value) return `${field}: send the normalized URL (${u.href})`;
  if (u.protocol !== 'https:') return `${field}: must be https`;
  const host = u.hostname.toLowerCase();
  if (host.endsWith('.')) return `${field}: no trailing dot in the host name`;
  if (isIP(host.replace(/^\[(.*)\]$/, '$1'))) return `${field}: use the program's domain name, not an IP address`;
  return null;
}

/** A line break, tab or other control character (one-line fields refuse them). */
const BREAKS = /[\p{Cc}\u0085\u2028\u2029]/u;

/**
 * Why one text value can't be written, or null: hidden characters first, then (on a one-line
 * field) line breaks and tabs, then < >, markdown links and links. One-line fields are quoted in
 * EarnKit's sentences and the owner's email, so a value can never start a line of its own.
 */
export function apiTextProblem(field: string, value: string, max: number = RAW_CAP, singleLine = false): string | null {
  const hidden = hiddenTextProblem(field, value);
  if (hidden) return hidden;
  if (singleLine && BREAKS.test(value)) return `${field}: one line only; no line breaks, tabs or control characters`;
  const v = value.normalize('NFKC');
  if (/[<>]/.test(v)) return `${field}: no < or > characters; plain words only`;
  if (MARKDOWN_LINK.test(v)) return `${field}: no markdown links; put links only in the URL fields`;
  try {
    cleanText(value, { max, field });
  } catch (err) {
    if (err instanceof UntrustedTextError) return err.message;
    throw err;
  }
  return null;
}

/** Text fields that may span lines; every other text field is one line. */
const MULTI_LINE = /^(description|rules\.\d+|submission_requirements\.\d+\.description)$/;

type Part = { field: string; value: string; max?: number };
const one = (field: string, value: string | undefined | null, max?: number): Part[] => (value ? [{ field, value, max }] : []);
const many = (field: string, values: readonly string[] | undefined): Part[] => (values ?? []).map((value, i) => ({ field: `${field}.${i}`, value }));

/** Every free-text value of a program, with its field path. */
function textParts(p: Program): Part[] {
  return [
    ...one('title', p.title, API_TITLE_MAX),
    ...one('organizer', p.organizer, API_ORGANIZER_MAX),
    ...one('description', p.description),
    ...one('reward', p.reward),
    ...one('summary', p.summary),
    ...one('opens_note', p.opens_note),
    ...one('best_bet', p.best_bet),
    ...many('rules', p.rules),
    ...many('setup', p.setup),
    ...many('each_time', p.each_time),
    ...many('ideas', p.ideas),
    ...p.submission_requirements.flatMap((r, i) => [
      ...one(`submission_requirements.${i}.label`, r.label),
      ...one(`submission_requirements.${i}.description`, r.description),
      ...one(`submission_requirements.${i}.todo`, r.todo),
      ...many(`submission_requirements.${i}.options`, r.options),
      ...one(`submission_requirements.${i}.guidance.judges`, r.guidance?.judges),
      ...many(`submission_requirements.${i}.guidance.questions`, r.guidance?.questions),
      ...one(`submission_requirements.${i}.guidance.pattern`, r.guidance?.pattern),
    ]),
    ...(p.eligibility ?? []).flatMap((e, i) => [...one(`eligibility.${i}.value`, e.value), ...one(`eligibility.${i}.note`, e.note)]),
    ...p.past_rounds.flatMap((r, i) => [
      ...one(`past_rounds.${i}.label`, r.label),
      ...(r.themes ?? []).flatMap((t, j) => one(`past_rounds.${i}.themes.${j}.theme`, t.theme)),
      ...(r.examples ?? []).flatMap((x, j) => [
        ...one(`past_rounds.${i}.examples.${j}.name`, x.name),
        ...one(`past_rounds.${i}.examples.${j}.what`, x.what),
        ...one(`past_rounds.${i}.examples.${j}.why`, x.why),
      ]),
    ]),
    ...many('focus.areas', p.focus?.areas),
    ...one('focus.ecosystem', p.focus?.ecosystem),
    ...one('platform_name', p.platform_name),
    ...Object.entries(p.form?.fields ?? {}).flatMap(([k, v]) => one(`form.fields.${k}`, v)),
  ];
}

/** Every problem with a program's text (hidden characters, line breaks in one-line fields, links, markup, < or >, the caps). */
export const apiTextProblems = (p: Program): string[] =>
  textParts(p).flatMap(({ field, value, max }) => apiTextProblem(field, value, max, !MULTI_LINE.test(field)) ?? []);

/** Every URL of a program, with its field path, and whether builders are sent there (the submit-host rule). */
function urlParts(p: Program): { field: string; value: string; sends: boolean }[] {
  const u = (field: string, value: string | undefined, sends = false) => (value === undefined ? [] : [{ field, value, sends }]);
  return [
    ...u('source_url', p.source_url),
    ...u('submission_url', p.submission_url, true),
    ...u('official_url', p.official_url),
    ...u('pool_source_url', p.pool_source_url, true),
    ...u('form.url', p.form?.url, true),
    ...u('focus.source_url', p.focus?.source_url),
    ...p.submission_requirements.flatMap((r, i) => u(`submission_requirements.${i}.guidance.source_url`, r.guidance?.source_url)),
    ...p.past_rounds.flatMap((r, i) => [
      ...u(`past_rounds.${i}.source_url`, r.source_url),
      ...(r.examples ?? []).flatMap((x, j) => u(`past_rounds.${i}.examples.${j}.source_url`, x.source_url)),
    ]),
  ];
}

/**
 * Every problem with a program's links: each URL's hygiene (apiUrlProblem), then, once source_url
 * is clean, every link builders are sent to (submission_url, pool_source_url, form.url) is on the
 * source's site or a known submit platform.
 */
export function apiUrlProblems(p: Program): string[] {
  const parts = urlParts(p);
  const problems = parts.flatMap(({ field, value }) => apiUrlProblem(field, value) ?? []);
  if (problems.some((x) => x.startsWith('source_url:'))) return problems;
  const source = new URL(p.source_url).hostname;
  for (const { field, value, sends } of parts) {
    if (!sends || problems.some((x) => x.startsWith(`${field}:`))) continue;
    const u = new URL(value);
    if (!apiSubmitHostAllowed(u.hostname, source, u.pathname))
      problems.push(`${field}: ${normalHost(u.hostname)} is neither on ${sourceSiteName(source)} (the source's domain) nor a known submit platform`);
  }
  return problems;
}
