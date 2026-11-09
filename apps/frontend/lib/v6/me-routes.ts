/**
 * /me's handlers: the session gate (no session: 302 to /docs#record) and the form posts. Every post needs
 * a web form under 64 KB, a session and today's csrf token, else 415, 413 or 403 with no change. Edits
 * merge as the builder through the record's row lock; approvals only here. No path is shown to the builder.
 */
import { NextResponse } from 'next/server';
import { sql } from '../v5/db';
import { readCapped } from '../v5/http';
import { publicOrigin } from '../v5/oauth';
import { ME_ERRORS } from '../v5/site-copy';
import { type Builder, deleteBuilder, getRecord, withRecord } from './builders';
import { OTHER, consumeLinkCode, denyLinkCode } from './link-routes';
import { type MeField, authSecret, problemSig, recordBlocks, seenOf, verifyCsrf } from './me-view';
import { APPROVABLE, approvePath, mergeRecord, unapprovePath } from './record';
import { clearCookie, endSession, sessionBuilder } from './sessions';

type Deps = { now?: Date };
const MAX_BODY = 64 * 1024;

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const back = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
const problemAt = (line: string) => back(`/me?problem=${encodeURIComponent(line)}&sig=${problemSig(line, authSecret())}`);

/** GET /me (the proxy): no live session is a 302 to /docs#record with no body; with one the page renders. */
export async function meGet(request: Request, deps: Deps = {}): Promise<Response> {
  const builder = await sessionBuilder(request.headers.get('cookie'), deps.now ?? new Date());
  // The proxy needs an absolute Location, on the public origin (the request URL can be the internal one).
  if (!builder) return new Response(null, { status: 302, headers: { Location: `${publicOrigin(request)}/docs#record`, 'Cache-Control': 'no-store' } });
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** The checks every post shares; on success the builder, the form and the time. */
async function guard(request: Request, deps: Deps): Promise<Response | { builder: Builder; form: URLSearchParams; now: Date }> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return text(415, ME_ERRORS.form);
  const body = await readCapped(request, MAX_BODY);
  if (body === null) return text(413, ME_ERRORS.large);
  const now = deps.now ?? new Date();
  const from = request.headers.get('origin');
  if (from && from !== publicOrigin(request)) return text(403, ME_ERRORS.expired);
  const builder = await sessionBuilder(request.headers.get('cookie'), now);
  if (!builder) return text(403, ME_ERRORS.signin);
  const form = new URLSearchParams(body);
  if (!verifyCsrf(form.get('csrf') ?? '', builder.id, now, authSecret())) return text(403, ME_ERRORS.expired);
  return { builder, form, now };
}

const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
const list = (v: string) => v.split(',').map((l) => l.trim()).filter(Boolean);

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
  if (f.kind === 'number') {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, problem: `${f.label}: ${ME_ERRORS.number}` };
  }
  if (f.path === 'docs.other')
    return { ok: true, value: lines(v).map((l) => { const at = l.lastIndexOf(' '); return at < 0 ? { label: 'Link', url: l } : { label: l.slice(0, at).trim(), url: l.slice(at + 1) }; }) };
  if (f.path === 'policy.never') return { ok: true, value: lines(v) };
  if (leaf === 'chains_claimed' || f.path === 'policy.categories') return { ok: true, value: list(v) };
  if (/(^|\.)answers\.[a-z_]+$/.test(f.path)) return { ok: true, value: { text: v } };
  return { ok: true, value: v };
}

/** The one-leaf patch mergeRecord takes for a field path. Pure. */
function patchOf(path: string, value: unknown): unknown {
  const [block, ...rest] = path.split('.');
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

/** Merges `patch` as the builder under the row lock; a problem comes back as a 303 to /me?problem=. */
async function merge(builder: Builder, now: Date, patch: unknown, label: string, anchor: string): Promise<Response> {
  const out = await withRecord(builder.id, now, (current) => {
    const m = mergeRecord(current, patch, 'builder', now);
    return { record: m.changed.length > 0 ? m.record : null, result: m.problems };
  });
  if (out.broken) return problemAt(ME_ERRORS.broken);
  if (out.result.length > 0) return problemAt(problemWords(label, out.result[0]));
  return back(`/me#${anchor}`);
}

/** POST /me/edit: csrf, path (an editable field /me lists), value. */
export async function editPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const path = g.form.get('path') ?? '';
  const blocks = recordBlocks(await getRecord(g.builder.id));
  const block = blocks.find((b) => b.fields.some((f) => f.path === path));
  const f = block?.fields.find((x) => x.path === path);
  // Standing approval changes only through /me/policy; the skip list is its one edit row.
  if (!block || !f || (path.startsWith('policy.') && path !== 'policy.never')) return text(400, ME_ERRORS.field);
  const v = valueOf(f, g.form.get('value') ?? '');
  if (!v.ok) return problemAt(v.problem);
  return merge(g.builder, g.now, patchOf(path, v.value), f.label, block.key);
}

/** POST /me/approve: csrf, path (approvable), action approve or unapprove; approve needs `seen`, the set_at shown. */
export async function approvePost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const path = g.form.get('path') ?? '';
  const action = g.form.get('action');
  if (!APPROVABLE(path) || (action !== 'approve' && action !== 'unapprove')) return text(400, ME_ERRORS.field);
  const seen = g.form.get('seen') ?? '';
  const out = await withRecord(g.builder.id, g.now, (current) => {
    // An agent write since the page was rendered: the builder has not read this text.
    if (action === 'approve' && seenOf(current, path) !== seen) return { record: null, result: false };
    const next = action === 'approve' ? approvePath(current, path, g.now) : unapprovePath(current, path);
    return { record: next === current ? null : next, result: true };
  });
  if (out.broken) return problemAt(ME_ERRORS.broken);
  if (!out.result) return problemAt(ME_ERRORS.changed);
  return back('/me#approvals');
}

const on = (v: string | null) => v === 'on' || v === 'true';

/** POST /me/policy: csrf, auto_apply, max_per_night, categories[], max_ask_usd, agent_may_submit (an unticked box is off). */
export async function policyPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const num = (k: string) => {
    const v = (g.form.get(k) ?? '').replace(/[$,\s]/g, '');
    return v === '' ? null : Number(v);
  };
  const nums = { max_per_night: num('max_per_night'), max_ask_usd: num('max_ask_usd') };
  if (Object.values(nums).some((n) => n !== null && !Number.isFinite(n))) return problemAt(`Limits: ${ME_ERRORS.number}`);
  const policy = {
    auto_apply: on(g.form.get('auto_apply')),
    ...nums,
    categories: [...g.form.getAll('categories[]'), ...g.form.getAll('categories')],
    agent_may_submit: on(g.form.get('agent_may_submit')),
  };
  return merge(g.builder, g.now, { policy }, 'Standing approval', 'policy');
}

/** POST /me/unlink: csrf, installation_id; only the builder's own. Its ledger rows stay with the builder. */
export async function unlinkPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const id = Number(g.form.get('installation_id'));
  if (!Number.isSafeInteger(id)) return text(400, ME_ERRORS.field);
  await sql()`UPDATE installations SET builder_id = NULL, linked_at = NULL WHERE id = ${id} AND builder_id = ${g.builder.id}`;
  return back('/me#agents');
}

/**
 * POST /me/link: csrf, code, action link or deny. Link marks the code used and links its agent to this builder;
 * deny ends the code. Both, and a dead code, are a 302 to /me; an agent linked to another account is a 400.
 */
export async function linkPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  const code = g.form.get('code') ?? '';
  const action = g.form.get('action');
  if (action !== 'link' && action !== 'deny') return text(400, ME_ERRORS.field);
  if (action === 'deny') await denyLinkCode(code, g.now);
  else if ((await consumeLinkCode(code, g.builder.id, g.now)) === 'other') return text(400, OTHER);
  return new Response(null, { status: 302, headers: { Location: '/me', 'Cache-Control': 'no-store' } });
}

/** POST /me/delete: csrf, confirm (the GitHub login). Removes everything theirs and the cookie. */
export async function deletePost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  if ((g.form.get('confirm') ?? '').trim().toLowerCase() !== g.builder.login.toLowerCase()) return text(400, ME_ERRORS.confirm);
  await deleteBuilder(g.builder.id);
  return back('/', { 'Set-Cookie': clearCookie() });
}

/** POST /me/signout: csrf; ends this session. */
export async function signoutPost(request: Request, deps: Deps = {}): Promise<Response> {
  const g = await guard(request, deps);
  if (g instanceof Response) return g;
  await endSession(request.headers.get('cookie'));
  return back('/', { 'Set-Cookie': clearCookie() });
}
