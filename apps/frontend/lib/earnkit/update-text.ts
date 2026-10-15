import { english as BIP39_ENGLISH } from 'viem/accounts';
import { SEED_WORDS } from './hosting';
import { UntrustedTextError, cleanText, hasDomain } from './untrusted-text';

/**
 * v2.13 spec "The text": one paragraph, at most 280 characters, plain words; links only to the
 * project's own sites or repo; the same link, entity, mention, number and secret checks as other
 * single-line agent text (untrusted-text.ts cleanText). Each refusal names its own reason.
 * Secrets are looked for in the text as written, as NFKC with hidden characters dropped, and in
 * the cleaned result. An own link is held to a strict URL alphabet and stored as its parsed href.
 * Pure but for the per-call placeholder nonce.
 */
export const UPDATE_MAX = 280;
export const UPDATE_EMPTY_NOTE = "Write one plain paragraph about what shipped this week, then call tell with update: { text }. Don't show this note.";
export const UPDATE_LINK_NOTE = "Links are allowed only to the project's own live site or its GitHub repo. Remove the others and send it again. Don't show this note.";
export const UPDATE_MENTION_NOTE = "The update can't mention people with @. Name them in plain words or leave them out, and send it again. Don't show this note.";
export const UPDATE_NUMBER_NOTE = "The update can't hold a run of 7 or more digits (a phone number or an id). Leave it out and send it again. Don't show this note.";
export const UPDATE_SECRET_NOTE = "The update looks like it holds a key, a token, a seed phrase or an address. Never post those; write it again in plain words. Don't show this note.";
export const updateLongNote = (n: number) => `The update is ${n} characters; keep it to one plain paragraph of at most ${UPDATE_MAX}. Send it again with tell update. Don't show this note.`;
export type UpdateCheck = { ok: true; text: string } | { ok: false; note: string };
/** The origins of the project's proven sites, and its confirmed GitHub repo (owner/repo), if any. */
export type OwnLinks = { sites: string[]; repo: string | null };

// --- Secrets ---------------------------------------------------------------------------------
const SECRET = /\b0x[0-9a-f]{40,}\b|\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const STRIPE = /\b(?:sk|rk|pk)_(?:live|test)_/i;
const HEX64 = /\b[0-9a-f]{64}\b/i;
const BASE58 = /(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/;
const LONG_RUN = /[A-Za-z0-9_-]{32,}/g;
const BIP39 = new Set(BIP39_ENGLISH);
const BIP39_RUN = 12;
/** Hidden characters NFKC keeps: format characters and blank fillers or selectors. */
const HIDDEN = /[\p{Cf}͏ᅟᅠㅤﾠ឴឵᠋-᠏︀-️]/gu;

/** An unbroken key-like run: 32 or more of [A-Za-z0-9_-] mixing letters and digits, or both cases. */
const keyLike = (s: string) => [...s.matchAll(LONG_RUN)].some(([m]) => (/\d/.test(m) && /[A-Za-z]/.test(m)) || (/[a-z]/.test(m) && /[A-Z]/.test(m)));
function seedWords(s: string): boolean {
  let run = 0;
  for (const w of s.toLowerCase().split(/[^a-z]+/)) {
    if (!w) continue;
    run = BIP39.has(w) ? run + 1 : 0;
    if (run >= BIP39_RUN) return true;
  }
  return false;
}
const secretIn = (s: string) =>
  SECRET.test(s) || SEED_WORDS.test(s) || STRIPE.test(s) || HEX64.test(s) || BASE58.test(s) || keyLike(s) || seedWords(s);
/** NFKC, hidden characters dropped: what cleanText would rebuild a split or full-width secret into. */
const unhidden = (s: string) => s.normalize('NFKC').replace(HIDDEN, '');

// --- Own links ---------------------------------------------------------------------------------
/**
 * A link with a scheme, or a github.com link without one (not after a letter, digit, mark, dot,
 * dash or underscore of any script, so not gist.github.com or a look-alike prefix).
 * Anything else that looks like a domain is cleanText's to refuse.
 */
const LINK = /\b(?:[a-z][a-z0-9+.-]*:\/\/\S+|(?<![\p{L}\p{N}\p{M}._-])(?:www\.)?github\.com\/\S+)/giu;
const TRAILING = /[).,;:!?'"]+$/;
const LINK_MAX = 200;
const TAIL_MAX = 120;
// untrusted-text.ts's builder-link alphabet, without @ (no mentions inside links either).
const LINK_CHARS = /^[A-Za-z0-9\-._~/:?#=&%+]+$/;
const PATH = /^(?:\/[A-Za-z0-9\-._~/]*)?$/;
const QUERY_FRAGMENT = /^(?:\?[A-Za-z0-9\-._~/=&%+]*)?(?:#[A-Za-z0-9\-._~/=&%+]*)?$/;
const DIGITS_IN_LINK = /\d(?:[.\-/_~]?\d){6}/;

/** The parsed href when the link is the project's own site or inside its own GitHub repo; else null. */
function ownLink(raw: string, own: OwnLinks): string | null {
  if (raw.length > LINK_MAX || !LINK_CHARS.test(raw)) return null;
  const scheme = /^https:\/\//i.exec(raw)?.[0];
  if (!scheme && !/^(?:www\.)?github\.com\//i.test(raw)) return null;
  const rest = raw.slice(scheme?.length ?? 0);
  if (rest.includes(':')) return null; // another scheme, or a port
  const cut = rest.search(/[/?#]/);
  const host = (cut < 0 ? rest : rest.slice(0, cut)).toLowerCase();
  const tail = cut < 0 ? '' : rest.slice(cut);
  const q = tail.search(/[?#]/);
  const path = q < 0 ? tail : tail.slice(0, q);
  const query = q < 0 ? '' : tail.slice(q);
  if (tail.length > TAIL_MAX || !PATH.test(path) || !QUERY_FRAGMENT.test(query) || /%2[ef]|%3a/i.test(query)) return null;
  if (DIGITS_IN_LINK.test(tail)) return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..')) return null;
  const u = URL.canParse(`https://${rest}`) ? new URL(`https://${rest}`) : null;
  if (!u || u.username || u.password || u.port || u.hostname !== host) return null;
  const words = (xs: string[]) => xs.some((w) => hasDomain(w));
  const queryWords = query.split(/[?#=&+/]/);
  if (own.sites.some((s) => URL.canParse(s) && new URL(s).origin === u.origin))
    return words(segments) || words(queryWords) ? null : u.href;
  if (!own.repo || !/^(?:www\.)?github\.com$/.test(host)) return null;
  const [owner, repo, ...more] = segments;
  if (`${owner}/${repo}`.toLowerCase() !== own.repo.toLowerCase()) return null;
  return words(more) || words(queryWords) ? null : u.href;
}

/** cleanText's refusal, as the note that names its reason (F16). */
function noteFor(err: UntrustedTextError, n: number): string {
  if (/@ signs/.test(err.message)) return UPDATE_MENTION_NOTE;
  if (/digits/.test(err.message)) return UPDATE_NUMBER_NOTE;
  if (/at most \d+ characters/.test(err.message)) return updateLongNote(n);
  return UPDATE_LINK_NOTE;
}

/** Why a link was refused: an @ or a number in its path, query or fragment gets its own note; user info in the host is a link trick. */
function linkNote(link: string): string {
  const tail = link.replace(/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/i, '');
  return tail.includes('@') ? UPDATE_MENTION_NOTE : DIGITS_IN_LINK.test(tail) ? UPDATE_NUMBER_NOTE : UPDATE_LINK_NOTE;
}

/** Lowercase letters only: survives cleanText, never a number run, and can't be guessed in advance. */
function nonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `ek${[...b].map((x) => String.fromCharCode(97 + (x % 26))).join('')}`;
}

export function checkUpdate(raw: unknown, own: OwnLinks): UpdateCheck {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, note: UPDATE_EMPTY_NOTE };
  if (secretIn(raw) || secretIn(unhidden(raw))) return { ok: false, note: UPDATE_SECRET_NOTE };
  const links: string[] = [];
  let bad: string | null = null;
  const mark = nonce();
  // Own links are set aside as placeholders, so cleanText checks only the words around them.
  const masked = raw.replace(LINK, (m) => {
    const tail = TRAILING.exec(m)?.[0] ?? '';
    const link = m.slice(0, m.length - tail.length);
    const href = ownLink(link, own);
    if (!href) bad ??= linkNote(link);
    links.push(href ?? '');
    return `${mark}${links.length - 1}${tail}`;
  });
  if (bad) return { ok: false, note: bad };
  let text: string;
  try {
    text = cleanText(masked.replace(/\s*[–—]\s*/g, ', '), { max: 4 * UPDATE_MAX, singleLine: true, field: 'update' });
  } catch (err) {
    if (err instanceof UntrustedTextError) return { ok: false, note: noteFor(err, [...raw].length) };
    throw err;
  }
  text = text.replace(new RegExp(`${mark}(\\d+)`, 'g'), (_, i: string) => links[Number(i)] ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, note: UPDATE_EMPTY_NOTE };
  if (secretIn(text)) return { ok: false, note: UPDATE_SECRET_NOTE };
  const n = [...text].length;
  return n > UPDATE_MAX ? { ok: false, note: updateLongNote(n) } : { ok: true, text };
}
