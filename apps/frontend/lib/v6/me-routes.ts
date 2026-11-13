/**
 * /me's handlers: the session gate (no session: 302 to /docs#record) and the form posts. Every post needs
 * a web form under 64 KB, a session and today's csrf token for that session, else 415, 413 or 403 with no change. Past
 * the session every refusal comes back to /me with a signed line (v6.1.7 C5), and a form with any bad value saves
 * nothing (B1). Edits merge as the builder through the record's row lock; approvals only here. No path is shown to the builder.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isKnownChain } from '../v5/chains';
import { readBody } from '../v5/http';
import { publicOrigin } from '../v5/oauth';
import { displayName } from '../v5/installations';
import { record as recordStatus } from '../v5/ledger';
import { sql } from '../v5/db';
import {
  ME_ALREADY_UNLINKED, ME_BLOCKS, ME_ERRORS, ME_LABELS, ME_LINK_DENIED, ME_LINK_DONE, ME_NOTHING, ME_PICK_CATEGORY, ME_PRESS_SUBMIT_FIRST, ME_SAVED, ME_SAVED_APPROVED, ME_SENT,
  ME_HELD_SENT, ME_UNLINKED_AGENT, ME_UNLINK_NOT_YOURS, ME_VALUE_WORDS, UNKNOWN_CODE,
} from '../v5/site-copy';
import { SENT } from '../v5/stats';
import { type Builder, deleteBuilder, getRecord, unlinkInstallation, withRecord } from './builders';
import { ALREADY_LINKED, OTHER, codeShaped, codeState, consumeLinkCode, deniedCode, denyLinkCode, linkedBy, liveCode } from './link-routes';
import { type MeField, agentList, authSecret, isAnswerPath, pendingApprovals, problemSig, recordBlocks, seenOf, utcDay, verifyCsrf } from './me-view';
import { APPROVABLE, type BuilderRecord, approvePath, fieldSchema, mergeRecord, onceEach, unapprovePath } from './record';
import { type Draft, anySessionCookie, clearCookies, clearDraft, endSession, saveDraft, sessionBuilder, sessionState, sessionToken } from './sessions';

type Deps = { now?: Date };
const MAX_BODY = 64 * 1024;

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const back = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
/** A 303 that expires every session cookie name (L31-6, v6.1.16 Task 17: the old ek_me too, for one release). */
const signedOut = (location: string) => {
  const res = back(location);
  for (const c of clearCookies()) res.headers.append('Set-Cookie', c);
  return res;
};
/** Who a line is for and when it was written. */
type For = { builder: { id: number }; now: Date };
/**
 * The line signed for this builder, this key and today only: a link carrying it shows on no other builder's page (it
 * can hold an agent's name), never as the other kind of line, and only on the day it was written and the next (final review M1).
 */
const signed = (key: 'problem' | 'note', who: For, line: string, place = '') =>
  back(`/me?${key}=${encodeURIComponent(line)}&sig=${problemSig(key, line, who.builder.id, utcDay(who.now), authSecret())}${place}`);
/**
 * Where a line about a card or an open answer shows (`at`, unsigned: it only places a signed line) and the anchor
 * (L27-9, v6.1.16). L43-5 (v6.1.19): a line about the open answer itself shows inside it, at `#a-{path}`.
 */
const placeOf = (section: string, open: string | null, inAnswer: boolean) =>
  inAnswer && open ? `${openPart(open)}&at=${encodeURIComponent(open)}#a-${open}` : `${openPart(open)}&at=${section}#${section}`;
/**
 * Back to /me with a refusal line; several lines (one per bad field) are joined by line breaks. `section`: the card the
 * line is about; `inAnswer` (L43-5): the line is about the open answer alone.
 */
const problemAt = (who: For, line: string, section?: string, open: string | null = null, inAnswer = false) =>
  signed('problem', who, line, section ? placeOf(section, open, inAnswer) : '');
/** After a section's Save (L27-10, v6.1.16): `Saved.` beside that section's button, or inside the open answer (L43-5). */
const savedSection = (section: string, open: string | null = null, inAnswer = false) =>
  back(`/me?saved=${section}${inAnswer && open ? `${openPart(open)}&at=${encodeURIComponent(open)}#a-${open}` : `${openPart(open)}#${section}`}`);
/** The answer the form kept open (L35-24, v6.1.17 Task 4), an answer's path or null. Pure. */
const openOf = (form: URLSearchParams): string | null => {
  const v = form.get('open');
  return v && isAnswerPath(v) ? v : null;
};
const openPart = (open: string | null) => (open ? `&open=${encodeURIComponent(open)}` : '');
/** Back to /me with a plain line that is not a refusal (v6.1.7 C2); `place` puts it beside a control. */
const noteAt = (who: For, line: string, place = '') => signed('note', who, line, place);
/**
 * `Saved.` beside the control that saved (L21-11, v6.1.16): the field's path in `at` (only where the line shows, so
 * not signed) and the block's anchor.
 */
const savedAt = (who: For, path: string, anchor: string) => signed('note', who, ME_SAVED, `&at=${encodeURIComponent(path)}#${anchor}`);
/** The largest id a Postgres integer holds (v6.1.7 B3). */
const MAX_ID = 2_147_483_647;

/**
 * GET /me (the proxy): no live session is a 302 to /docs#record with no body; with one the page renders. L21-14
 * (v6.1.16): signed out, a code-shaped `?link=` goes to /link/<code>, which signs in and comes back to the code. L23-15
 * (v6.1.16): an `ek_me` cookie whose session is gone goes to /docs?expired=1#record (the docs say the sign-in expired)
 * and the dead cookie is cleared.
 */
export async function meGet(request: Request, deps: Deps = {}): Promise<Response> {
  const cookie = request.headers.get('cookie');
  const now = deps.now ?? new Date();
  const builder = await sessionBuilder(cookie, now);
  if (!builder) {
    const code = new URL(request.url).searchParams.get('link') ?? '';
    // L43-12 (v6.1.19): the expired line only for a session that existed and ended; a cookie that never was one
    // (garbage, forged, signed out) is asked to sign in from the agent's link. L43-3: an old ek_me alone in production
    // is no session at all (`none`), and is cleared.
    const state = await sessionState(cookie, now);
    // The proxy needs an absolute Location, on the public origin (the request URL can be the internal one).
    const to = codeShaped(code) ? `/link/${code}` : state === 'expired' ? '/docs?expired=1#record' : state === 'none' ? '/docs#record' : '/docs?signin=1#record';
    const headers = new Headers({ Location: `${publicOrigin(request)}${to}`, 'Cache-Control': 'no-store' });
    // Both cookie names are cleared whenever either is present, and any session behind them is ended.
    if (anySessionCookie(cookie)) {
      await endSession(cookie);
      for (const c of clearCookies()) headers.append('Set-Cookie', c);
    }
    return new Response(null, { status: 302, headers });
  }
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * Whether a /me post came from EarnKit's own page (L31-3, v6.1.16 Task 17): its Origin is the public origin, or it
 * has no Origin and its Referer's origin is. Neither header, or an unreadable Referer, is false.
 */
export function sameOrigin(request: Request): boolean {
  const us = publicOrigin(request);
  const from = request.headers.get('origin');
  if (from !== null) return from === us;
  try {
    return new URL(request.headers.get('referer') ?? '').origin === us;
  } catch {
    return false;
  }
}

type Guarded = { builder: Builder; form: URLSearchParams; now: Date; cookie: string | null };
/** The block keys a section form may name (the page's cards). */
const SECTIONS = new Set(['person', 'team', 'projects', 'company', 'docs', 'traction', 'answers']);
/** A form field that names a record path (`person.name`, `projects.kit.answers.risks`), never a control. Pure. */
const PATH_NAME = /^[a-z_]+(?:\.[a-z0-9_-]+)+$/;
/**
 * What the builder typed into a form, as the page's draft (L43-4, v6.1.19): the policy form's fields under `policy.`
 * (an unticked box is off), the delete box as `delete.confirm`, any other form's record fields by their path. Pure.
 */
function draftFrom(form: URLSearchParams, route: string): Draft {
  if (route === '/me/policy')
    return {
      'policy.auto_apply': String(on(form.get('auto_apply'))), 'policy.max_per_night': form.get('max_per_night') ?? '',
      'policy.max_ask_usd': form.get('max_ask_usd') ?? '', 'policy.categories': [...form.getAll('categories[]'), ...form.getAll('categories')].join(', '),
      'policy.agent_may_submit': String(on(form.get('agent_may_submit'))), ...(form.has('never') ? { 'policy.never': form.get('never') ?? '' } : {}),
    };
  if (route === '/me/delete') return { 'delete.confirm': form.get('confirm') ?? '' };
  const out: Draft = {};
  // The single-field post (`path` and `value`) of a page from before v6.1.16.
  const single = form.get('path');
  if (single && PATH_NAME.test(single) && form.has('value')) out[single] = form.get('value') ?? '';
  for (const [k, v] of form) if (PATH_NAME.test(k)) out[k] = v;
  return out;
}

/** The checks every post shares; on success the builder, the form, the time and the request's cookie header. */
async function guard(request: Request, deps: Deps): Promise<Response | Guarded> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return text(415, ME_ERRORS.form);
  // A body slower than 5 s is a 408 with the page's line (v6.1.16 Task 5 fix round 1, I2).
  const body = await readBody(request, MAX_BODY, () => text(408, ME_ERRORS.slow));
  if (body instanceof Response) return body;
  if (body === null) return text(413, ME_ERRORS.large);
  const now = deps.now ?? new Date();
  // L31-3 (v6.1.16 Task 17): a same-origin Origin, or with none a same-origin Referer, before the session and csrf.
  if (!sameOrigin(request)) return text(403, ME_ERRORS.notFromUs);
  // L43-3 (v6.1.19): only the current cookie name is a session (the old ek_me is never read in production).
  const cookie = request.headers.get('cookie');
  const builder = await sessionBuilder(cookie, now);
  if (!builder) return text(403, ME_ERRORS.signin);
  const form = new URLSearchParams(body);
  const session = sessionToken(cookie) ?? '';
  if (!verifyCsrf(form.get('csrf') ?? '', builder.id, now, authSecret(), session)) {
    // L43-4 (v6.1.19): the page expired, but what was typed is kept, and the line shows where the form was.
    const route = new URL(request.url).pathname;
    await saveDraft(cookie, draftFrom(form, route), now);
    const section = form.get('section');
    const place = route === '/me/policy' ? 'policy' : route === '/me/delete' ? 'delete' : section && SECTIONS.has(section) ? section : undefined;
    return problemAt({ builder, now }, ME_ERRORS.expired, place, place && SECTIONS.has(place) ? openOf(form) : null);
  }
  return { builder, form, now, cookie };
}

const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
/** A list field (chains, categories): one per line or comma separated (L13-14, v6.1.14). Pure. */
const list = (v: string) => v.split(/[,\n]/).map((l) => l.trim()).filter(Boolean);

/** A form value as the field's stored value; an empty one clears (null). Pure. */
function valueOf(f: MeField, raw: string): { ok: true; value: unknown } | { ok: false; problem: string } {
  const v = raw.replace(/\r\n?/g, '\n').trim();
  const leaf = f.path.split('.').pop();
  if (v === '') return { ok: true, value: f.path === 'docs.other' || f.path === 'policy.never' ? [] : null };
  if (f.kind === 'bool') {
    if (v === 'on' || v === 'true') return { ok: true, value: true };
    if (v === 'off' || v === 'false') return { ok: true, value: false };
    return { ok: false, problem: `${f.label}: ${ME_ERRORS.yesNo}` };
  }
  // Not a number reads as NaN: wordsOf names what the field takes.
  if (f.kind === 'number') return { ok: true, value: Number(v.replace(/[$,\s]/g, '')) };
  if (f.path === 'docs.other')
    return { ok: true, value: lines(v).map((l) => { const at = l.lastIndexOf(' '); return at < 0 ? { label: 'Link', url: l } : { label: l.slice(0, at).trim(), url: l.slice(at + 1) }; }) };
  if (f.path === 'policy.never') return { ok: true, value: lines(v) };
  if (leaf === 'chains_claimed') {
    // Any case matches; every unknown one is named (v6.1.9 N8); each chain is saved once, in first order (F10, v6.1.12).
    const given = list(v);
    const bad = given.filter((c) => !isKnownChain(c.toLowerCase()));
    if (bad.length > 0) return { ok: false, problem: `Not a known chain: ${bad.join(', ')}.` };
    return { ok: true, value: onceEach(given.map((c) => c.toLowerCase())) };
  }
  if (f.path === 'policy.categories') return { ok: true, value: list(v) };
  if (/(^|\.)answers\.[a-z_]+$/.test(f.path)) return { ok: true, value: { text: v } };
  return { ok: true, value: v };
}

/** Two member names, ignoring case and spacing. Pure. */
const sameName = (a: unknown, b: unknown): boolean => {
  const key = (x: unknown) => String(x ?? '').toLowerCase().replace(/\s+/g, '');
  return key(a) === key(b);
};

/**
 * The one-leaf patch mergeRecord takes for a field path, from the record as it is under the lock. A team member's
 * field replaces the list (it is kept whole): an empty name removes that member, a name past the end adds one, an
 * empty role clears it (v6.1.8 B19). Pure.
 */
function patchOf(path: string, value: unknown, current: BuilderRecord): unknown {
  const [block, ...rest] = path.split('.');
  if (block === 'team') {
    const at = Number(rest[0]);
    const team = current.team.map((m) => ({ ...m }));
    if (rest[1] === 'name' && value === null) team.splice(at, 1);
    else if (at < team.length) {
      const m = team[at] as Record<string, unknown>;
      // A new name is a new person: the old one's github, x and email do not carry over (v6.1.9 N7). A fix of case or
      // spacing is the same person (final review M10).
      if (rest[1] === 'name' && !sameName(value, m.name)) for (const k of ['github', 'x', 'email']) delete m[k];
      if (value === null) delete m[rest[1]];
      else m[rest[1]] = value;
    } else if (rest[1] === 'name' && at === team.length) team.push({ name: value as string });
    return { team };
  }
  if (block === 'projects') {
    const [id, key, kind] = rest;
    return { projects: [key === 'answers' ? { id, answers: { [kind]: value } } : { id, [key]: value }] };
  }
  return { [block]: { [rest[0]]: value } };
}

/**
 * The issue part of a merge problem line, one sentence starting lower case: "too long." from "answers.problem: Too
 * long" (fix round 1, M8: never a slice that assumes the prefix's shape). A line with no "<path>: " is all issue. Pure.
 */
const issueOf = (line: string): string => {
  const at = line.indexOf(': ');
  const issue = (at < 0 ? line : line.slice(at + 2)).trim();
  return `${issue.charAt(0).toLowerCase()}${issue.slice(1)}${/[.!?]$/.test(issue) ? '' : '.'}`;
};
/** "<label>: <issue>" from the merge, in the field's words, one sentence. Pure. */
const problemWords = (label: string, line: string) => `${label}: ${issueOf(line)}`;

type Wrapped = z.ZodType & { unwrap?: () => z.ZodType };
/** The schema under optional, nullable and default wrappers (an array stays an array). Pure. */
function inner(schema: z.ZodType): z.ZodType {
  let s = schema as Wrapped;
  while (!(s instanceof z.ZodArray) && typeof s.unwrap === 'function') s = s.unwrap() as Wrapped;
  return s;
}
const bound = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * What the field takes, in plain words (v6.1.7 C4), when `value` does not fit the leaf at `path`; null when it fits
 * (or clears). An answer's value is checked as its text. Pure.
 */
export function wordsOf(path: string, value: unknown): string | null {
  const schema = fieldSchema(path);
  if (!schema || value === null) return null;
  const v = typeof value === 'object' && !Array.isArray(value) && 'text' in value ? (value as { text: unknown }).text : value;
  const r = schema.safeParse(v);
  if (r.success) return null;
  // A field's own pattern words (Country: two capital letters) say more than its length cap.
  const i = r.error.issues.find((x) => x.code === 'invalid_format' && x.format === 'regex') ?? r.error.issues[0];
  const num = inner(schema);
  if (num instanceof z.ZodNumber) return ME_VALUE_WORDS.range(bound(num.minValue), bound(num.maxValue), Boolean(num.isInt));
  // L43-4 (v6.1.19): an over-long text says what was typed, in characters as people count them.
  if (i.code === 'too_big' && i.origin === 'string')
    return typeof v === 'string' ? ME_VALUE_WORDS.typed(Array.from(v).length, Number(i.maximum)) : ME_VALUE_WORDS.under(Number(i.maximum));
  if (i.code === 'too_big' && i.origin === 'array') return ME_VALUE_WORDS.atMost(Number(i.maximum));
  if (i.code === 'invalid_value') return ME_VALUE_WORDS.option;
  if (i.code === 'invalid_format' && i.format === 'url') return ME_VALUE_WORDS.https;
  if (i.code === 'invalid_format' && i.format === 'email') return ME_VALUE_WORDS.email;
  const m = i.message.replace(/\.$/, '');
  return `${m.charAt(0).toLowerCase()}${m.slice(1)}`;
}

/**
 * Merges `patch` as the builder under the row lock, all or nothing (v6.1.7 B1): any problem saves nothing and
 * comes back as a 303 to /me?problem=, one line per bad field.
 */
async function merge(builder: Builder, now: Date, patch: unknown | ((current: BuilderRecord) => unknown), label: string, anchor: string, path: string): Promise<Response> {
  const out = await withRecord(builder.id, now, (current) => {
    const m = mergeRecord(current, typeof patch === 'function' ? patch(current) : patch, 'builder', now);
    // L43-15 (v6.1.19): an answer the builder writes is approved by that save.
    const rec = m.changed.length > 0 && isAnswerPath(path) ? approvePath(m.record, path, now) : m.record;
    return { record: m.problems.length === 0 && m.changed.length > 0 ? rec : null, result: m.problems };
  });
  if (out.broken) return problemAt({ builder, now }, ME_ERRORS.broken);
  if (out.result.length > 0) return problemAt({ builder, now }, [...new Set(out.result.map((l) => problemWords(label, l)))].join('\n'));
  return savedAt({ builder, now }, path, anchor);
}

/** A form value and a shown value compared as the page shows them (line breaks and outer spaces aside). Pure. */
const sameValue = (raw: string, shown: string) => raw.replace(/\r\n?/g, '\n').trim() === shown.trim();

/**
 * One section's form (L27-8, v6.1.16): every field of the card, named by its path. Only the fields whose value differs
 * from the page's are written, so an untouched field keeps who set it. Each is checked as a single edit is. The valid
 * ones save and a refused one is named beside the section's Save (fix round 1, M1): `Saved.`, then one
 * `Not saved: {field}: {reason}.` line per refused field; with none valid, only those lines. A team member removed
 * (an empty name) goes last, from the highest row down, so the other rows keep their numbers. With nothing refused
 * the answer is `/me?saved={section}#{section}`. v6.1.19: an answer the builder saves is approved by it (L43-15); a
 * refusal keeps what was typed (L43-4, the session's draft); a line about the open answer alone shows inside it, with
 * no label (L43-5); nothing changed and nothing refused is `Nothing to save.` (L43-6).
 */
type Change = { f: MeField; value: unknown };
type Refusal = { path: string; line: string };
/**
 * A refusal line for a card's field: "Not saved: LinkedIn: a link starting with https://."; the open answer's own line
 * carries no label (it shows inside the answer, under its name). Pure.
 */
const notSavedFor = (open: string | null) => (f: MeField, line: string): Refusal => ({ path: f.path, line: `Not saved: ${f.path === open ? line.slice(f.label.length + 2) : line}` });

/**
 * The card's fields the form changed, each checked as a single edit is (a field whose value equals the page's is
 * left alone); `skip` is left out (the answer an Approve handles itself). Pure.
 */
function cardChanges(fields: MeField[], form: URLSearchParams, open: string | null, skip: string | null = null): { changes: Change[]; refused: Refusal[] } {
  const notSaved = notSavedFor(open);
  const changes: Change[] = [];
  const refused: Refusal[] = [];
  for (const f of fields) {
    if (f.path === skip) continue;
    const raw = form.get(f.path);
    if (raw === null || sameValue(raw, f.value)) continue;
    const v = valueOf(f, raw);
    if (!v.ok) {
      refused.push(notSaved(f, v.problem.replace(/^Not a known chain/, `${f.label}: not a known chain`)));
      continue;
    }
    const words = wordsOf(f.path, v.value);
    if (words) refused.push(notSaved(f, `${f.label}: ${words}.`));
    else changes.push({ f, value: v.value });
  }
  // A team member removed (an empty name) goes last, from the highest row down, so the other rows keep their numbers.
  const at = (c: Change) => (/^team\.\d+\./.test(c.f.path) ? Number(c.f.path.split('.')[1]) : -1);
  changes.sort((a, b) => at(b) - at(a));
  return { changes, refused };
}

/**
 * Merges the changes as the builder, one by one, onto `record` (under the caller's row lock): an answer the builder
 * writes is approved by it (L43-15). Returns the record, how many leaves changed and saved, and the merge's refusals.
 * Pure.
 */
function applyChanges(record: BuilderRecord, changes: Change[], now: Date, open: string | null): { record: BuilderRecord; changed: number; kept: number; lines: Refusal[] } {
  const notSaved = notSavedFor(open);
  let changed = 0;
  let kept = 0;
  const lines: Refusal[] = [];
  for (const c of changes) {
    const m = mergeRecord(record, patchOf(c.f.path, c.value, record), 'builder', now);
    if (m.problems.length > 0) lines.push(...m.problems.map((l) => notSaved(c.f, problemWords(c.f.label, l))));
    else {
      record = m.changed.length > 0 && isAnswerPath(c.f.path) ? approvePath(m.record, c.f.path, now) : m.record;
      changed += m.changed.length;
      kept++;
    }
  }
  return { record, changed, kept, lines };
}

/** Every field of the card the form carried, as typed: the draft a refusal keeps (L43-4). Pure. */
const cardDraft = (fields: MeField[], form: URLSearchParams): Draft =>
  Object.fromEntries(fields.filter((f) => form.has(f.path)).map((f) => [f.path, form.get(f.path) ?? '']));

async function sectionPost(g: Guarded, section: string): Promise<Response> {
  const block = recordBlocks(await getRecord(g.builder.id)).find((b) => b.key === section);
  // Standing approval saves through /me/policy.
  if (!block || block.key === 'policy') return problemAt(g, ME_ERRORS.field);
  const open = openOf(g.form);
  const { changes, refused } = cardChanges(block.fields, g.form, open);
  // L43-4 (v6.1.19): every field the form carried is kept, so the page shows the typed values again.
  const keep = async (r: Response) => {
    await saveDraft(g.cookie, cardDraft(block.fields, g.form), g.now);
    return r;
  };
  let saved = 0;
  if (changes.length > 0) {
    const out = await withRecord(g.builder.id, g.now, (current) => {
      const a = applyChanges(current, changes, g.now, open);
      return { record: a.changed > 0 ? a.record : null, result: { lines: a.lines, kept: a.kept } };
    });
    // Fix round 1 (M7): a record that cannot be read saves nothing and keeps what was typed.
    if (out.broken) return keep(problemAt(g, ME_ERRORS.broken, section, open));
    refused.push(...out.result.lines);
    saved = out.result.kept;
  }
  // The line is the open answer's own when every field it is about is that answer.
  const about = [...changes.map((c) => c.f.path), ...refused.map((r) => r.path)];
  const inAnswer = open !== null && about.length > 0 && about.every((p) => p === open);
  if (refused.length === 0) {
    await clearDraft(g.cookie);
    if (changes.length === 0) return noteAt(g, ME_NOTHING, placeOf(section, open, false));
    return savedSection(section, open, inAnswer);
  }
  const lines = [...new Set(refused.map((r) => r.line))];
  return keep(problemAt(g, (saved > 0 ? [ME_SAVED, ...lines] : lines).join('\n'), section, open, inAnswer));
}

/**
 * POST /me/edit: csrf and `section` with the section's fields (the page's forms, L27-8 v6.1.16); or csrf, path (an
 * editable field /me lists) and value, one field (a page from before v6.1.16, and the skip list).
 */
export async function editPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const section = g.form.get('section');
  if (section !== null) return sectionPost(g, section);
  const path = g.form.get('path') ?? '';
  const blocks = recordBlocks(await getRecord(g.builder.id), g.now);
  const block = blocks.find((b) => b.fields.some((f) => f.path === path));
  const f = block?.fields.find((x) => x.path === path);
  // Standing approval changes only through /me/policy; the skip list is its one edit row.
  if (!block || !f || (path.startsWith('policy.') && path !== 'policy.never')) return problemAt(g, ME_ERRORS.field);
  const v = valueOf(f, g.form.get('value') ?? '');
  // L43-4 (v6.1.19): a refusal keeps what was typed.
  const keep = async (r: Response) => {
    await saveDraft(g.cookie, { [path]: g.form.get('value') ?? '' }, g.now);
    return r;
  };
  if (!v.ok) return keep(problemAt(g, v.problem));
  const words = wordsOf(path, v.value);
  // An unknown chain is named on its own (v6.1.8 C53): "Not a known chain: solanaa."
  if (words?.startsWith('not a known chain')) return keep(problemAt(g, `N${words.slice(1)}.`));
  if (words) return keep(problemAt(g, `${f.label}: ${words}.`));
  const r = await merge(g.builder, g.now, (current: BuilderRecord) => patchOf(path, v.value, current), f.label, block.key, path);
  if ((r.headers.get('location') ?? '').includes('problem=')) return keep(r);
  await clearDraft(g.cookie);
  return r;
}

/**
 * POST /me/approve: csrf, path (approvable), action approve or unapprove; approve needs `seen`, the set_at shown.
 * L43-1 (v6.1.19): an open answer's Approve is a button of its section's form (`approve={path}`, the box `{path}`):
 * when the box differs from the stored text, one write saves the box as the builder's and approves it (`Saved and
 * approved.`, inside the answer); an unchanged box approves the stored text. A stale `seen` is refused with the answer
 * kept open and the box's text kept (the draft).
 */
export async function approvePost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const path = g.form.get('path') ?? g.form.get('approve') ?? '';
  const action = g.form.get('action') ?? (g.form.has('approve') ? 'approve' : null);
  if (!APPROVABLE(path) || (action !== 'approve' && action !== 'unapprove')) return problemAt(g, ME_ERRORS.field);
  const seen = g.form.get('seen') ?? '';
  const answer = isAnswerPath(path);
  const typed = action === 'approve' && answer ? g.form.get(path) : null;
  const section = path.startsWith('projects.') ? 'projects' : 'answers';
  const open = answer ? path : null;
  const block = typed !== null ? recordBlocks(await getRecord(g.builder.id), g.now).find((b) => b.fields.some((x) => x.path === path)) : undefined;
  // Fix round 1 (M5): the Approve submits the whole card, so every field it carried is kept on a refusal.
  const keep = async (r: Response) => {
    if (typed !== null) await saveDraft(g.cookie, { ...(block ? cardDraft(block.fields, g.form) : {}), [path]: typed }, g.now);
    return r;
  };
  // The box's text as the stored value, checked as a Save checks it.
  let edit: { value: unknown } | null = null;
  const f = block?.fields.find((x) => x.path === path);
  if (typed !== null && f && !sameValue(typed, f.value)) {
    const v = valueOf(f, typed);
    const words = v.ok ? wordsOf(path, v.value) : v.problem;
    if (!v.ok || words) return keep(problemAt(g, `Not saved: ${v.ok ? `${words}.` : v.problem}`, section, open, true));
    if (v.value === null) return keep(problemAt(g, ME_ERRORS.field, section, open, true));
    edit = { value: v.value };
  }
  // Fix round 1 (M5): the card's other changed fields save with the approval, or the whole Approve is refused with
  // their lines beside the card (nothing saved, everything typed kept); never dropped.
  const others = block && typed !== null ? cardChanges(block.fields, g.form, open, path) : { changes: [], refused: [] };
  if (others.refused.length > 0) return keep(problemAt(g, [...new Set(others.refused.map((r) => r.line))].join('\n'), section, open));
  const out = await withRecord<'changed' | 'ok' | 'saved' | { lines: string[] }>(g.builder.id, g.now, (current) => {
    // An agent write since the page was rendered: the builder has not read this text.
    if (action === 'approve' && seenOf(current, path) !== seen) return { record: null, result: 'changed' as const };
    if (edit || others.changes.length > 0) {
      const a = applyChanges(current, others.changes, g.now, open);
      if (a.lines.length > 0) return { record: null, result: { lines: a.lines.map((l) => l.line) } };
      let rec = a.record;
      if (edit) {
        const m = mergeRecord(rec, patchOf(path, edit.value, rec), 'builder', g.now);
        if (m.problems.length > 0) return { record: null, result: { lines: [`Not saved: ${m.problems.map(issueOf).join(' ')}`] } };
        rec = m.record;
      }
      return { record: approvePath(rec, path, g.now), result: 'saved' as const };
    }
    const next = action === 'approve' ? approvePath(current, path, g.now) : unapprovePath(current, path);
    return { record: next === current ? null : next, result: 'ok' as const };
  });
  if (out.broken) return keep(problemAt(g, ME_ERRORS.broken, answer ? section : undefined, open, answer));
  // L43-5 (v6.1.19): the refusal keeps the answer open, its line inside it.
  if (out.result === 'changed') return keep(problemAt(g, ME_ERRORS.changed, answer ? section : undefined, open, answer));
  if (typeof out.result === 'object') return keep(problemAt(g, [...new Set(out.result.lines)].join('\n'), section, open, others.changes.length === 0));
  if (typed !== null) await clearDraft(g.cookie);
  if (out.result === 'saved') return noteAt(g, ME_SAVED_APPROVED, `${openPart(path)}&at=${encodeURIComponent(path)}#a-${path}`);
  // L35-24 (v6.1.17 Task 4): an approved answer opens the next one waiting, so they are read one at a time.
  if (action === 'approve' && answer) {
    const next = pendingApprovals(await getRecord(g.builder.id)).find((p) => isAnswerPath(p.path))?.path;
    if (next) return back(`/me?open=${encodeURIComponent(next)}#a-${next}`);
  }
  return back('/me#approvals');
}

const on = (v: string | null) => v === 'on' || v === 'true';

/** POST /me/policy: csrf, auto_apply, max_per_night, categories[], max_ask_usd, agent_may_submit (an unticked box is off). */
export async function policyPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  // L45-7 (v6.1.19): digits only (a dollar sign and spaces aside); a comma only between thousands groups, so a decimal
  // comma (`1,0`, `1,5`) is refused, never read as 10 or 15.
  const num = (k: string) => {
    const v = (g.form.get(k) ?? '').replace(/[$\s]/g, '');
    if (v === '') return null;
    if (/^\d{1,3}(,\d{3})+$/.test(v)) return Number(v.replace(/,/g, ''));
    return /^\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
  };
  const policy = {
    auto_apply: on(g.form.get('auto_apply')),
    max_per_night: num('max_per_night'),
    max_ask_usd: num('max_ask_usd'),
    categories: [...g.form.getAll('categories[]'), ...g.form.getAll('categories')],
    agent_may_submit: on(g.form.get('agent_may_submit')),
    // The skip list is in the same form since L27-8 (v6.1.16); a form without it leaves the list as it is.
    ...(g.form.has('never') ? { never: lines(g.form.get('never') ?? '') } : {}),
  };
  // All or nothing (v6.1.7 B1): one bad value saves none of the form; every bad field is named as the page shows it.
  const labels = ME_LABELS as Record<string, string>;
  const problems = Object.entries(policy).flatMap(([k, v]) => {
    // L43-19 (v6.1.19): the skip list says what it counts and which line is long.
    if (k === 'never') return neverWords(v as string[], g.form.get('never') ?? '').map((w) => `${labels['policy.never']}: ${w}.`);
    const words = wordsOf(`policy.${k}`, v);
    return words ? [`${labels[`policy.${k}`]}: ${words}.`] : [];
  });
  // On with nothing ticked would be off in effect while the page shows it on (v6.1.8 C43).
  if (policy.auto_apply && policy.categories.length === 0) problems.push(ME_PICK_CATEGORY);
  // L24-15 (v6.1.16 Task 11): on with Press submit off would only draft: refused, nothing saved.
  if (policy.auto_apply && !policy.agent_may_submit) problems.push(ME_PRESS_SUBMIT_FIRST);
  // L43-4 (v6.1.19): a refusal keeps what was typed.
  const keep = async (r: Response) => {
    await saveDraft(g.cookie, draftFrom(g.form, '/me/policy'), g.now);
    return r;
  };
  if (problems.length > 0) return keep(problemAt(g, problems.join('\n'), 'policy'));
  const saved = await merge(g.builder, g.now, { policy }, ME_BLOCKS.policy, 'policy', 'policy');
  // L27-10 (v6.1.16): a saved policy is `/me?saved=policy#policy`; a refusal stays the signed line, beside the form.
  const loc = saved.headers.get('location') ?? '';
  if (loc.includes('problem=')) return keep(back(`${loc.replace(/#.*$/, '')}&at=policy#policy`));
  await clearDraft(g.cookie);
  return savedSection('policy');
}

/** The most programs the skip list holds, and the most characters a line of it holds (record.ts). */
const NEVER_MAX = 50;
const NEVER_LINE = 100;
/**
 * L43-19 (v6.1.19): "at most 50 programs", "line 3 is over 100 characters" (the first long line, counted in the box as
 * typed, blank lines included). Pure.
 */
function neverWords(never: string[], typed: string): string[] {
  const long = typed.replace(/\r\n?/g, '\n').split('\n').findIndex((l) => Array.from(l.trim()).length > NEVER_LINE);
  return [
    ...(never.length > NEVER_MAX ? [ME_VALUE_WORDS.programs(NEVER_MAX)] : []),
    ...(long >= 0 ? [ME_VALUE_WORDS.longLine(long + 1, NEVER_LINE)] : []),
  ];
}

/** POST /me/unlink: csrf, installation_id; only the builder's own. Its ledger rows stay with the builder; its next find says it was unlinked (B10); the session's draft is wiped. */
export async function unlinkPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const raw = g.form.get('installation_id') ?? '';
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0;
  if (id < 1 || id > MAX_ID) return problemAt(g, ME_ERRORS.field);
  // L21-7, L21-15 (v6.1.16): the agent named as /me shows it; one that is not the builder's says so.
  const agent = (await agentList(g.builder.id, g.now)).find((a) => a.id === id);
  if (!agent || !(await unlinkInstallation(id, g.builder.id, g.now))) {
    // L43-10 (v6.1.19): an agent this builder already unlinked (a double click, the back button) says so, plainly.
    const [mine] = await sql()<{ one: number }[]>`SELECT 1 AS one FROM installations WHERE id = ${id} AND builder_id IS NULL AND former_builder_id = ${g.builder.id}`;
    return mine ? noteAt(g, ME_ALREADY_UNLINKED) : problemAt(g, ME_UNLINK_NOT_YOURS);
  }
  // Final fix round (M2): a refused form's draft is wiped on unlink, as on sign-out and delete.
  await clearDraft(g.cookie);
  // M1 (fix round 1): mid-sentence an unnamed agent's label starts lower case; L43-10: a name is quoted, as Linked is.
  return noteAt(g, ME_UNLINKED_AGENT(agent.client_name ? agent.label : null, agent.label));
}

/**
 * POST /me/sent (L43-9, v6.1.19): csrf, program_id, project_id. The builder's own started row for that program and
 * project is recorded applied with submitted_by builder, through the ledger's one write path (the sent ask's yes takes
 * it too); `Sent {title}.`, or the ledger's own refusal line. Any other row, or none, is refused and nothing is written.
 */
export async function sentPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const programId = g.form.get('program_id') ?? '';
  const projectId = g.form.get('project_id') ?? '';
  const owner = `b:${g.builder.id}`;
  type Row = { status: string; installation_id: number; claimed_by: number | null; held_at: Date | null; project_id: string | null; title: string };
  const [row] = programId.length > 0 && programId.length <= 200 && projectId.length <= 500
    ? await sql()<Row[]>`
      SELECT a.status, a.installation_id, a.claimed_by, a.held_at, a.project_id, COALESCE(p.file->>'title', a.title, a.program_id) AS title
      FROM applications a LEFT JOIN programs p ON p.id = a.program_id
      WHERE a.owner = ${owner} AND a.program_id = ${programId} AND COALESCE(a.project_id, '') = ${projectId}`
    : [];
  if (!row) return problemAt(g, ME_ERRORS.field, 'ledger');
  const sent = noteAt(g, ME_SENT(row.title), '&at=ledger#ledger');
  // Fix round 1 (M2): a double press or a resubmitted form finds the row already sent and says so again.
  if (SENT.includes(row.status)) return sent;
  if (row.status !== 'started') return problemAt(g, ME_ERRORS.field, 'ledger');
  // Fix round 1 (M3): a claim the builder held waits for their go.
  if (row.held_at !== null) return problemAt(g, ME_HELD_SENT(row.title), 'ledger');
  // Fix round 1 (M1): written as the agent that claims it while that agent is still this builder's; with none still
  // linked, as the builder's own send (the ledger's link check is the agent's, not the builder's), with no sending agent
  // kept (final fix round, M1), so the owner's list names none.
  const ids = [...new Set([row.claimed_by, row.installation_id].filter((x): x is number => x !== null))];
  const [linked] = ids.length > 0
    ? await sql()<{ id: number }[]>`SELECT id FROM installations WHERE id = ANY(${ids}) AND builder_id = ${g.builder.id} ORDER BY array_position(${ids}::int[], id) LIMIT 1`
    : [];
  const out = await recordStatus(owner, programId, 'applied', {
    installationId: linked?.id ?? row.installation_id, submitted_by: 'builder', project_id: row.project_id ?? '', now: g.now,
    ...(linked ? {} : { builderOwn: true as const }),
  });
  if (!out.ok) return problemAt(g, out.note, 'ledger');
  return sent;
}

/**
 * POST /me/link: csrf, code, action link or deny. Link marks the code used and links its agent to this builder;
 * deny ends the code. Every outcome is a 303 to /me with its line (v6.1.7 C2): linked, not linked, expired, not
 * valid, or linked to another account.
 */
export async function linkPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const code = g.form.get('code') ?? '';
  const action = g.form.get('action');
  if (action !== 'link' && action !== 'deny') return problemAt(g, ME_ERRORS.field);
  if (!codeShaped(code)) return problemAt(g, UNKNOWN_CODE);
  if (action === 'deny') {
    await denyLinkCode(code, g.now);
    // L43-17 (v6.1.19): one sentence with the next step.
    return noteAt(g, ME_LINK_DENIED);
  }
  const live = await liveCode(code, g.now);
  const out = await consumeLinkCode(code, g.builder.id, g.now);
  if (out === 'other') return problemAt(g, OTHER);
  if (out === 'dead')
    return (await linkedBy(code, g.builder.id)) ? noteAt(g, ALREADY_LINKED)
      : (await deniedCode(code)) ? noteAt(g, ME_LINK_DENIED)
      : problemAt(g, (await codeState(code, g.now)) === 'unknown' ? UNKNOWN_CODE : ME_ERRORS.linkExpired);
  return noteAt(g, ME_LINK_DONE(displayName(live?.client_name)));
}

/** POST /me/delete: csrf, confirm (the GitHub login). Removes everything theirs and the cookie. */
export async function deletePost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  // L27-9 (v6.1.16): a refused delete comes back to the delete card with its line beside the form.
  // L43-4, L43-11 (v6.1.19): and keeps what was typed, so the box still shows it.
  if ((g.form.get('confirm') ?? '').trim().toLowerCase() !== g.builder.login.toLowerCase()) {
    await saveDraft(g.cookie, draftFrom(g.form, '/me/delete'), g.now);
    return problemAt(g, ME_ERRORS.confirm, 'delete');
  }
  await deleteBuilder(g.builder.id, g.now);
  // L31-6 (v6.1.16 Task 17): and the session behind any other cookie the request carries; both names expire.
  await endSession(request.headers.get('cookie'));
  // L21-9 (v6.1.16): the home page says the account is deleted.
  return signedOut('/?deleted=1');
}

/** POST /me/signout: csrf; ends this session. */
export async function signoutPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  await endSession(request.headers.get('cookie'));
  return signedOut('/');
}
