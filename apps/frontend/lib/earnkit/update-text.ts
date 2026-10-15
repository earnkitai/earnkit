import { SEED_WORDS } from './hosting';
import { UntrustedTextError, cleanText } from './untrusted-text';

/**
 * v2.13 spec "The text": one paragraph, at most 280 characters, plain words; links only to the
 * project's own live URL or repo; the same link, entity, mention, number and secret checks as other
 * single-line agent text (untrusted-text.ts cleanText). Each refusal names its own reason. Pure.
 */
export const UPDATE_MAX = 280;
export const UPDATE_EMPTY_NOTE = "Write one plain paragraph about what shipped this week, then call tell with update: { text }. Don't show this note.";
export const UPDATE_LINK_NOTE = "Links are allowed only to the project's own live site or its GitHub repo. Remove the others and send it again. Don't show this note.";
export const UPDATE_MENTION_NOTE = "The update can't mention people with @. Name them in plain words or leave them out, and send it again. Don't show this note.";
export const UPDATE_NUMBER_NOTE = "The update can't hold a run of 7 or more digits (a phone number or an id). Leave it out and send it again. Don't show this note.";
export const UPDATE_SECRET_NOTE = "The update looks like it holds a key, a token, a seed phrase or an address. Never post those; write it again in plain words. Don't show this note.";
export const updateLongNote = (n: number) => `The update is ${n} characters; keep it to one plain paragraph of at most ${UPDATE_MAX}. Send it again with tell update. Don't show this note.`;
export type UpdateCheck = { ok: true; text: string } | { ok: false; note: string };

const SECRET = /\b0x[0-9a-f]{40,}\b|\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
/**
 * A link with a scheme, or a github.com link without one (not a subdomain such as gist.github.com).
 * Anything else that looks like a domain is cleanText's to refuse.
 */
const LINK = /\b(?:[a-z][a-z0-9+.-]*:\/\/\S+|(?<![\w.-])(?:www\.)?github\.com\/\S+)/gi;
const TRAILING = /[).,;:!?'"]+$/;

/** The link points at the project's own live origin, or inside its own GitHub repo. */
function ownLink(raw: string, own: { live: string | null; repo: string | null }): boolean {
  const u = URL.canParse(raw) ? new URL(raw) : URL.canParse(`https://${raw}`) ? new URL(`https://${raw}`) : null;
  if (!u || u.username || u.password || u.port || u.protocol !== 'https:') return false;
  if (own.live && URL.canParse(own.live) && u.origin === new URL(own.live).origin) return true;
  if (!own.repo || !/^(www\.)?github\.com$/i.test(u.hostname)) return false;
  const path = u.pathname.toLowerCase();
  const repo = `/${own.repo.toLowerCase()}`;
  return path === repo || path.startsWith(`${repo}/`);
}

/** cleanText's refusal, as the note that names its reason (F16). */
function noteFor(err: UntrustedTextError, n: number): string {
  if (/@ signs/.test(err.message)) return UPDATE_MENTION_NOTE;
  if (/digits/.test(err.message)) return UPDATE_NUMBER_NOTE;
  if (/at most \d+ characters/.test(err.message)) return updateLongNote(n);
  return UPDATE_LINK_NOTE;
}

export function checkUpdate(raw: unknown, own: { live: string | null; repo: string | null }): UpdateCheck {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, note: UPDATE_EMPTY_NOTE };
  if (SECRET.test(raw) || SEED_WORDS.test(raw)) return { ok: false, note: UPDATE_SECRET_NOTE };
  const links: string[] = [];
  let bad = false;
  // Own links are set aside as letters-and-digits placeholders, so cleanText checks only the words around them.
  const masked = raw.replace(LINK, (m) => {
    const tail = TRAILING.exec(m)?.[0] ?? '';
    const link = m.slice(0, m.length - tail.length);
    if (!ownLink(link, own)) bad = true;
    links.push(link);
    return `ekupdlink${links.length - 1}${tail}`;
  });
  if (bad) return { ok: false, note: UPDATE_LINK_NOTE };
  let text: string;
  try {
    text = cleanText(masked.replace(/\s*[–—]\s*/g, ', '), { max: 4 * UPDATE_MAX, singleLine: true, field: 'update' });
  } catch (err) {
    if (err instanceof UntrustedTextError) return { ok: false, note: noteFor(err, [...raw].length) };
    throw err;
  }
  text = text.replace(/ekupdlink(\d+)/g, (_, i: string) => links[Number(i)] ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, note: UPDATE_EMPTY_NOTE };
  const n = [...text].length;
  return n > UPDATE_MAX ? { ok: false, note: updateLongNote(n) } : { ok: true, text };
}
