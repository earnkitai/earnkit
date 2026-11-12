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
import {
  ME_BLOCKS, ME_ERRORS, ME_LABELS, ME_LINK_DONE, ME_LINK_NOT, ME_PICK_CATEGORY, ME_PRESS_SUBMIT_FIRST, ME_SAVED, ME_UNLINKED, ME_UNLINK_NOT_YOURS, ME_VALUE_WORDS, UNKNOWN_CODE,
} from '../v5/site-copy';
import { type Builder, deleteBuilder, getRecord, unlinkInstallation, withRecord } from './builders';
import { ALREADY_LINKED, OTHER, codeShaped, codeState, consumeLinkCode, deniedCode, denyLinkCode, linkedBy, liveCode } from './link-routes';
import { type MeField, agentList, authSecret, isAnswerPath, pendingApprovals, problemSig, recordBlocks, seenOf, utcDay, verifyCsrf } from './me-view';
import { APPROVABLE, type BuilderRecord, approvePath, fieldSchema, mergeRecord, onceEach, unapprovePath } from './record';
import { clearCookies, currentName, endSession, sessionBuilder, sessionToken } from './sessions';

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
 * Back to /me with a refusal line; several lines (one per bad field) are joined by line breaks. `section` (L27-9,
 * v6.1.16): the card the line is about, where it shows (`at`, unsigned: it only places the signed line) and the anchor.
 */
const problemAt = (who: For, line: string, section?: string, open: string | null = null) =>
  signed('problem', who, line, section ? `${openPart(open)}&at=${section}#${section}` : '');
/** After a section's Save (L27-10, v6.1.16): `Saved.` beside that section's button. */
const savedSection = (section: string, open: string | null = null) => back(`/me?saved=${section}${openPart(open)}#${section}`);
/** The answer the form kept open (L35-24, v6.1.17 Task 4), an answer's path or null. Pure. */
const openOf = (form: URLSearchParams): string | null => {
  const v = form.get('open');
  return v && isAnswerPath(v) ? v : null;
};
const openPart = (open: string | null) => (open ? `&open=${encodeURIComponent(open)}` : '');
/** Back to /me with a plain line that is not a refusal (v6.1.7 C2). */
const noteAt = (who: For, line: string) => signed('note', who, line);
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
  const builder = await sessionBuilder(cookie, deps.now ?? new Date());
  if (!builder) {
    const code = new URL(request.url).searchParams.get('link') ?? '';
    const expired = sessionToken(cookie) !== null;
    // The proxy needs an absolute Location, on the public origin (the request URL can be the internal one).
    const to = codeShaped(code) ? `/link/${code}` : expired ? '/docs?expired=1#record' : '/docs#record';
    const headers = new Headers({ Location: `${publicOrigin(request)}${to}`, 'Cache-Control': 'no-store' });
    // Task 17: both cookie names are cleared while the old one is still read.
    if (expired) for (const c of clearCookies()) headers.append('Set-Cookie', c);
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

/**
 * The checks every post shares; on success the builder, the form and the time. `oldName`: a session held only under
 * the old cookie name passes (sign-out only, so a builder can always end it).
 */
async function guard(request: Request, deps: Deps, oldName = false): Promise<Response | { builder: Builder; form: URLSearchParams; now: Date }> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return text(415, ME_ERRORS.form);
  // A body slower than 5 s is a 408 with the page's line (v6.1.16 Task 5 fix round 1, I2).
  const body = await readBody(request, MAX_BODY, () => text(408, ME_ERRORS.slow));
  if (body instanceof Response) return body;
  if (body === null) return text(413, ME_ERRORS.large);
  const now = deps.now ?? new Date();
  // L31-3 (v6.1.16 Task 17): a same-origin Origin, or with none a same-origin Referer, before the session and csrf.
  if (!sameOrigin(request)) return text(403, ME_ERRORS.notFromUs);
  // L35-17 (v6.1.17 Task 4): a session held only under the old cookie name reads the page but writes nothing; the
  // builder signs in again, which sets the new name.
  if (!oldName && !currentName(request.headers.get('cookie'))) return text(403, ME_ERRORS.signin);
  const builder = await sessionBuilder(request.headers.get('cookie'), now);
  if (!builder) return text(403, ME_ERRORS.signin);
  const form = new URLSearchParams(body);
  const session = sessionToken(request.headers.get('cookie')) ?? '';
  if (!verifyCsrf(form.get('csrf') ?? '', builder.id, now, authSecret(), session)) return problemAt({ builder, now }, ME_ERRORS.expired);
  return { builder, form, now };
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

/** "<path>: <issue>" from the merge, in the field's words, one sentence. Pure. */
const problemWords = (label: string, line: string) => {
  const issue = line.slice(line.indexOf(': ') + 2).trim();
  return `${label}: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}${/[.!?]$/.test(issue) ? '' : '.'}`;
};

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
  if (i.code === 'too_big' && i.origin === 'string') return ME_VALUE_WORDS.under(Number(i.maximum));
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
    return { record: m.problems.length === 0 && m.changed.length > 0 ? m.record : null, result: m.problems };
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
 * the answer is `/me?saved={section}#{section}`.
 */
async function sectionPost(g: { builder: Builder; form: URLSearchParams; now: Date }, section: string): Promise<Response> {
  const block = recordBlocks(await getRecord(g.builder.id)).find((b) => b.key === section);
  // Standing approval saves through /me/policy.
  if (!block || block.key === 'policy') return problemAt(g, ME_ERRORS.field);
  const changes: { f: MeField; value: unknown }[] = [];
  const refused: string[] = [];
  /** "Not saved: LinkedIn: a link starting with https://." from "LinkedIn: a link starting with https://." */
  const notSaved = (line: string) => `Not saved: ${line}`;
  for (const f of block.fields) {
    const raw = g.form.get(f.path);
    if (raw === null || sameValue(raw, f.value)) continue;
    const v = valueOf(f, raw);
    if (!v.ok) {
      refused.push(notSaved(v.problem.replace(/^Not a known chain/, `${f.label}: not a known chain`)));
      continue;
    }
    const words = wordsOf(f.path, v.value);
    if (words) refused.push(notSaved(`${f.label}: ${words}.`));
    else changes.push({ f, value: v.value });
  }
  const at = (c: { f: MeField }) => (/^team\.\d+\./.test(c.f.path) ? Number(c.f.path.split('.')[1]) : -1);
  changes.sort((a, b) => at(b) - at(a));
  let saved = 0;
  if (changes.length > 0) {
    const out = await withRecord(g.builder.id, g.now, (current) => {
      let record = current;
      let changed = 0;
      let kept = 0;
      const lines: string[] = [];
      for (const c of changes) {
        const m = mergeRecord(record, patchOf(c.f.path, c.value, record), 'builder', g.now);
        if (m.problems.length > 0) lines.push(...m.problems.map((l) => notSaved(problemWords(c.f.label, l))));
        else {
          record = m.record;
          changed += m.changed.length;
          kept++;
        }
      }
      return { record: changed > 0 ? record : null, result: { lines, kept } };
    });
    if (out.broken) return problemAt(g, ME_ERRORS.broken, section, openOf(g.form));
    refused.push(...out.result.lines);
    saved = out.result.kept;
  }
  const open = openOf(g.form);
  if (refused.length === 0) return savedSection(section, open);
  const lines = [...new Set(refused)];
  return problemAt(g, (saved > 0 ? [ME_SAVED, ...lines] : lines).join('\n'), section, open);
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
  if (!v.ok) return problemAt(g, v.problem);
  const words = wordsOf(path, v.value);
  // An unknown chain is named on its own (v6.1.8 C53): "Not a known chain: solanaa."
  if (words?.startsWith('not a known chain')) return problemAt(g, `N${words.slice(1)}.`);
  if (words) return problemAt(g, `${f.label}: ${words}.`);
  return merge(g.builder, g.now, (current: BuilderRecord) => patchOf(path, v.value, current), f.label, block.key, path);
}

/** POST /me/approve: csrf, path (approvable), action approve or unapprove; approve needs `seen`, the set_at shown. */
export async function approvePost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const path = g.form.get('path') ?? '';
  const action = g.form.get('action');
  if (!APPROVABLE(path) || (action !== 'approve' && action !== 'unapprove')) return problemAt(g, ME_ERRORS.field);
  const seen = g.form.get('seen') ?? '';
  const out = await withRecord(g.builder.id, g.now, (current) => {
    // An agent write since the page was rendered: the builder has not read this text.
    if (action === 'approve' && seenOf(current, path) !== seen) return { record: null, result: false };
    const next = action === 'approve' ? approvePath(current, path, g.now) : unapprovePath(current, path);
    return { record: next === current ? null : next, result: true };
  });
  if (out.broken) return problemAt(g, ME_ERRORS.broken);
  if (!out.result) return problemAt(g, ME_ERRORS.changed);
  // L35-24 (v6.1.17 Task 4): an approved answer opens the next one waiting, so they are read one at a time.
  if (action === 'approve' && isAnswerPath(path)) {
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
    const words = wordsOf(`policy.${k}`, v);
    return words ? [`${labels[`policy.${k}`]}: ${words}.`] : [];
  });
  // On with nothing ticked would be off in effect while the page shows it on (v6.1.8 C43).
  if (policy.auto_apply && policy.categories.length === 0) problems.push(ME_PICK_CATEGORY);
  // L24-15 (v6.1.16 Task 11): on with Press submit off would only draft: refused, nothing saved.
  if (policy.auto_apply && !policy.agent_may_submit) problems.push(ME_PRESS_SUBMIT_FIRST);
  if (problems.length > 0) return problemAt(g, problems.join('\n'), 'policy');
  const saved = await merge(g.builder, g.now, { policy }, ME_BLOCKS.policy, 'policy', 'policy');
  // L27-10 (v6.1.16): a saved policy is `/me?saved=policy#policy`; a refusal stays the signed line, beside the form.
  const loc = saved.headers.get('location') ?? '';
  if (loc.includes('problem=')) return back(`${loc.replace(/#.*$/, '')}&at=policy#policy`);
  return savedSection('policy');
}

/** POST /me/unlink: csrf, installation_id; only the builder's own. Its ledger rows stay with the builder; its next find says it was unlinked (B10). */
export async function unlinkPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const raw = g.form.get('installation_id') ?? '';
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0;
  if (id < 1 || id > MAX_ID) return problemAt(g, ME_ERRORS.field);
  // L21-7, L21-15 (v6.1.16): the agent named as /me shows it; one that is not the builder's says so.
  const agent = (await agentList(g.builder.id, g.now)).find((a) => a.id === id);
  if (!agent || !(await unlinkInstallation(id, g.builder.id, g.now))) return problemAt(g, ME_UNLINK_NOT_YOURS);
  // M1 (fix round 1): mid-sentence an unnamed agent's label starts lower case; a name stays as written.
  return noteAt(g, ME_UNLINKED(agent.client_name ? agent.label : agent.label.charAt(0).toLowerCase() + agent.label.slice(1)));
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
    return noteAt(g, ME_LINK_NOT);
  }
  const live = await liveCode(code, g.now);
  const out = await consumeLinkCode(code, g.builder.id, g.now);
  if (out === 'other') return problemAt(g, OTHER);
  if (out === 'dead')
    return (await linkedBy(code, g.builder.id)) ? noteAt(g, ALREADY_LINKED)
      : (await deniedCode(code)) ? noteAt(g, ME_LINK_NOT)
      : problemAt(g, (await codeState(code, g.now)) === 'unknown' ? UNKNOWN_CODE : ME_ERRORS.linkExpired);
  return noteAt(g, ME_LINK_DONE(displayName(live?.client_name)));
}

/** POST /me/delete: csrf, confirm (the GitHub login). Removes everything theirs and the cookie. */
export async function deletePost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  // L27-9 (v6.1.16): a refused delete comes back to the delete card with its line beside the form.
  if ((g.form.get('confirm') ?? '').trim().toLowerCase() !== g.builder.login.toLowerCase()) return problemAt(g, ME_ERRORS.confirm, 'delete');
  await deleteBuilder(g.builder.id, g.now);
  // L31-6 (v6.1.16 Task 17): and the session behind any other cookie the request carries; both names expire.
  await endSession(request.headers.get('cookie'));
  // L21-9 (v6.1.16): the home page says the account is deleted.
  return signedOut('/?deleted=1');
}

/** POST /me/signout: csrf; ends this session. */
export async function signoutPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps, true);
  if (g instanceof Response) return g;
  await endSession(request.headers.get('cookie'));
  return signedOut('/');
}
