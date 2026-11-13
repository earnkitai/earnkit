// The repro pack: shared helpers. Local only: the base URL and database come from the environment (`target.ts`:
// REPRO_BASE_URL, REPRO_DATABASE_URL, REPRO_AUTH_SECRET; defaults http://localhost:4600 and earnkit_journeys), and a
// target that is not this machine is refused. Every row is `l33-`, every address 10.33.x.y, every repo `lane33/...`.
// No token, code, cookie or link URL is ever written to disk or printed.
import { reproTarget } from './target.ts';
// The app modules read DATABASE_URL at their first query, after this line (run.sh exports the same values).
const T = reproTarget();
process.env.DATABASE_URL = T.database;
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { programFixture } from '../../lib/v5/fixtures/program.ts';
import { upsertProgram } from '../../lib/v5/programs.ts';
import { upsertBuilder, linkInstallation, deleteBuilder } from '../../lib/v6/builders.ts';
import { createSession } from '../../lib/v6/sessions.ts';
import { csrfToken } from '../../lib/v6/me-view.ts';
import { sql as appSql } from '../../lib/v5/db.ts';

export const O = T.base;
export const db = postgres(T.database, { max: 3, onnotice: () => {} });
const SECRET = T.authSecret;
const b64 = (b: Buffer) => b.toString('base64url');
const DAY = 86_400_000;
export const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();

// ---- redaction: nothing secret reaches stdout ----
const secrets: string[] = [];
export const red = (s: unknown) => {
  let t = String(s);
  for (const x of secrets) if (x) t = t.split(x).join('<secret>');
  return t.replace(/\/link\/[A-Za-z0-9_%-]{6,}/g, '/link/<code>').replace(/link=[A-Za-z0-9_%-]+/g, 'link=<code>')
    .replace(/code=[A-Za-z0-9_%-]+/g, 'code=<code>').replace(/sig=[A-Za-z0-9_-]+/g, 'sig=<sig>')
    .replace(/ek_[a-z0-9_]*=[A-Za-z0-9_-]+/g, 'ek=<cookie>').replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer <token>');
};
const oneLine = (s: string) => red(s).replace(/\s*\n\s*/g, ' / ').replace(/[\u0000-\u001f‪-‮⁦-⁩​-‏﻿]/g, (c) => `<U+${c.charCodeAt(0).toString(16).padStart(4, '0')}>`).slice(0, 600);
export const short = (s: unknown, n = 160) => oneLine(String(s ?? '')).slice(0, n);

// ---- one script = one Break ----
export type Ctx = { id: string; tag: string; octet: number; ip: (n: number) => string; repo: (n: string) => string; pid: (n: string) => string; nonce: string };
let CTX: Ctx;
export function ctx(id: string, octet: number): Ctx {
  const tag = `l33-${id.toLowerCase()}`;
  const nonce = randomBytes(3).toString('hex');
  CTX = { id, tag, octet, nonce, ip: (n) => `10.33.${octet}.${n}`, repo: (n) => `lane33/${id.toLowerCase()}-${n}`, pid: (n) => `${tag}-${n}` };
  return CTX;
}
/** Runs the repro, prints exactly one line, cleans up its own rows, exits 0 on PASS and 1 on FAIL (FR-4, v6.1.18). */
export async function run(id: string, octet: number, body: (c: Ctx) => Promise<{ pass: boolean; actual: string }>) {
  const c = ctx(id, octet);
  let line: string;
  try {
    await cleanup(c); // a crashed earlier run leaves nothing behind
    const r = await body(c);
    line = r.pass ? `PASS ${id}` : `FAIL ${id}: ${oneLine(r.actual)}`;
  } catch (e: any) {
    line = `FAIL ${id}: script error ${oneLine(e?.message ?? String(e)).slice(0, 300)}`;
  }
  try { await cleanup(c); } catch (e: any) { line += ` (cleanup error: ${oneLine(e?.message ?? e).slice(0, 120)})`; }
  console.log(line);
  await db.end({ timeout: 1 }).catch(() => {});
  await appSql().end({ timeout: 1 }).catch(() => {});
  process.exit(line.startsWith('PASS ') ? 0 : 1);
}

// ---- agents over real OAuth ----
export type Ag = { tok: string; id: number; name: string; ip: string };
export type Reg = { status: number; ag?: Ag; step?: string; body?: string };
export async function tryAgent(name: string, ip: string): Promise<Reg> {
  const redirect = 'http://localhost:9876/callback';
  const H = { 'x-forwarded-for': ip };
  const r1 = await fetch(O + '/oauth/register', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }) });
  const b1 = await r1.text(); if (r1.status !== 201) return { status: r1.status, step: 'register', body: b1 };
  const reg = JSON.parse(b1);
  const v = b64(randomBytes(32)); const ch = b64(createHash('sha256').update(v).digest());
  const u = new URL(O + '/oauth/authorize');
  for (const [k, val] of Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: ch, code_challenge_method: 'S256', state: 's' })) u.searchParams.set(k, val);
  const r2 = await fetch(u, { redirect: 'manual', headers: H });
  if (r2.status !== 302) return { status: r2.status, step: 'authorize', body: await r2.text() };
  const code = new URL(r2.headers.get('location')!).searchParams.get('code')!; secrets.push(code);
  const r3 = await fetch(O + '/oauth/token', { method: 'POST', headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: v, client_id: reg.client_id, redirect_uri: redirect }).toString() });
  const b3 = await r3.text(); if (r3.status !== 200) return { status: r3.status, step: 'token', body: b3 };
  const tok = JSON.parse(b3).access_token as string; secrets.push(tok);
  const [row] = await db`SELECT id FROM installations WHERE token_hash = ${createHash('sha256').update(tok).digest('hex')}`;
  return { status: 200, ag: { tok, id: row.id as number, name, ip } };
}
export async function agent(name: string, ip: string): Promise<Ag> {
  const r = await tryAgent(name, ip);
  if (!r.ag) throw new Error(`agent ${r.step} ${r.status} ${short(r.body)}`);
  return r.ag;
}

// ---- MCP tool calls ----
let rid = 1;
export type Res = { status: number; isError: boolean; j: any; sb: string; note: string; text: string; bytes: number };
/** `args` may be a raw JSON string (for keys like __proto__ that JSON.stringify drops). */
export async function call(ag: { tok: string; ip: string }, name: string, args: unknown): Promise<Res> {
  const a = typeof args === 'string' ? args : JSON.stringify(args);
  const body = `{"jsonrpc":"2.0","id":${rid++},"method":"tools/call","params":{"name":${JSON.stringify(name)},"arguments":${a}}}`;
  const r = await fetch(O + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': ag.ip, authorization: `Bearer ${ag.tok}` }, body });
  let txt = await r.text(); const status = r.status;
  const m = /^data: (.*)$/m.exec(txt); if (m) txt = m[1];
  let j: any = null; let isError = false; let text = '';
  try {
    const env = JSON.parse(txt); const res = env.result;
    if (res) { isError = res.isError ?? false; text = res.content?.[0]?.text ?? ''; try { j = JSON.parse(text); } catch { j = { text }; } if (res.structuredContent) j = { ...(j ?? {}), structured: res.structuredContent }; }
    else j = { rpcError: env.error ?? env };
  } catch { j = { raw: txt.slice(0, 500) }; }
  return { status, isError, j, sb: String(j?.show_to_builder ?? j?.text ?? ''), note: String(j?.agent_note ?? ''), text, bytes: Buffer.byteLength(text) };
}

// ---- builders, sessions, /me ----
let gid = 99330000 + Math.floor(Math.random() * 600000);
export type B = { id: number; login: string; token: string; csrf: string };
export async function builder(login: string): Promise<B> {
  const b = await upsertBuilder({ github_id: gid++, login, name: login, avatar_url: null } as any, new Date());
  const s = await createSession(b.id, new Date()); secrets.push(s.token);
  const csrf = csrfToken(b.id, new Date().toISOString().slice(0, 10), SECRET, s.token); secrets.push(csrf);
  return { id: b.id, login, token: s.token, csrf };
}
export const link = (ag: Ag, b: B) => linkInstallation(ag.id, b.id, new Date());
export async function meGet(b: B, path = '/me', ip = CTX.ip(250)) {
  const r = await fetch(O + path, { redirect: 'manual', headers: { cookie: `ek_me=${b.token}`, 'x-forwarded-for': ip } });
  return { status: r.status, loc: r.headers.get('location'), html: await r.text() };
}
export async function mePost(b: B, path: string, form: Record<string, string | string[]>, ip = CTX.ip(250)) {
  const p = new URLSearchParams(); p.set('csrf', b.csrf);
  for (const [k, v] of Object.entries(form)) for (const x of [v].flat()) p.append(k, x);
  const r = await fetch(O + path, { method: 'POST', redirect: 'manual', headers: { cookie: `ek_me=${b.token}`, 'content-type': 'application/x-www-form-urlencoded', origin: O, referer: O + '/me', 'x-forwarded-for': ip }, body: p.toString() });
  return { status: r.status, loc: r.headers.get('location') };
}
/** Standing approval on, through the builder's own /me form. */
export const standingOn = (b: B, over: Record<string, string | string[]> = {}) =>
  mePost(b, '/me/policy', { auto_apply: 'on', max_per_night: '5', 'categories[]': ['grant'], agent_may_submit: 'on', ...over });

// ---- programs and repos ----
export const F = (key: string, label: string, kind: string, todo: string, over: any = {}) => ({ key, label, type: 'text', required: true, from: kind === 'contact' ? 'builder' : 'project', kind, todo, ...over });
export const easy = [F('project_name', 'Project name', 'name', 'a project name'), F('email', 'Contact email', 'contact', 'your email', { type: 'email' })];
export const M = (n: number) => ({ max_award_usd: n, reward: `Up to $${n.toLocaleString('en-US')}`, summary: `Up to $${n.toLocaleString('en-US')} · lane33 test` });
export async function program(id: string, title: string, over: any = {}) {
  const f = programFixture({
    id, title: `L33 ${title}`, organizer: 'L33 Org', source_url: `${O}/lane33/${id}`, submission_url: `${O}/lane33/${id}/apply`,
    ...M(5000), needs_repo: false, any_chain: true, chains: [], verified_at: new Date().toISOString().slice(0, 10),
    ends_at: iso(30), eligibility: [], submission_requirements: easy, category: 'grant', ...over,
  } as any);
  await upsertProgram(f, 'file');
  return f;
}
/** A fresh repo_cache row: the server reads it as the public code read, no network. */
export async function seedRepo(key: string, facts: any = {}) {
  const f = { chains: [], contracts: [], builder_codes: false, integrations: [], first_commit_at: '2026-06-01T00:00:00Z', last_commit_at: new Date().toISOString(), readme_excerpt: null, homepage: null, html_url: `https://github.com/${key}`, pushed_at: new Date().toISOString(), fork: false, archived: false, empty: false, readme_lead: `${key.split('/')[1]} does a thing.`, ...facts };
  await db`INSERT INTO repo_cache (repo, facts, fetched_at, pushed_at) VALUES (${key}, ${db.json(f)}, now(), now()) ON CONFLICT (repo) DO UPDATE SET facts = EXCLUDED.facts, fetched_at = now(), pushed_at = now()`;
}
export const appsOf = async (owners: string[], programId?: string) =>
  db`SELECT owner, program_id, status, amount_usd, project_id, note, application_id FROM applications WHERE owner = ANY(${owners}) ${programId ? db`AND program_id = ${programId}` : db``} ORDER BY at`;
export const line = (sb: string, re: RegExp) => sb.split('\n').find((l) => re.test(l)) ?? '';

// ---- cleanup: every row this script made ----
export async function cleanup(c: Ctx) {
  const like = `${c.tag}-%`;
  const bids = (await db`SELECT id FROM builders WHERE login LIKE ${like} OR login = ${c.tag}`).map((r: any) => r.id as number);
  const instBefore = (await db`SELECT id FROM installations WHERE client_name LIKE ${like} OR client_name = ${c.tag}`).map((r: any) => r.id as number);
  // M6 (v6.1.21): the people these installations and builders made, read before deleteBuilder clears people.builder_id.
  const pids = (await db`SELECT id FROM people WHERE builder_id = ANY(${bids}) UNION SELECT person_id FROM installations WHERE id = ANY(${instBefore}) AND person_id IS NOT NULL`).map((r: any) => r.id as number);
  for (const b of bids) await deleteBuilder(b, new Date());
  const inst = (await db`SELECT id FROM installations WHERE client_name LIKE ${like} OR client_name = ${c.tag}`).map((r: any) => r.id as number);
  const owners = [...inst.map((i) => `i:${i}`), ...bids.map((b) => `b:${b}`)];
  const jobs = (await db`SELECT id FROM screen_jobs WHERE program_id LIKE ${like} OR installation_id = ANY(${inst})`).map((r: any) => r.id);
  await db`DELETE FROM screen_outcomes WHERE job_id = ANY(${jobs})`;
  await db`DELETE FROM screen_applicants WHERE job_id = ANY(${jobs})`;
  await db`DELETE FROM screen_jobs WHERE id = ANY(${jobs})`;
  await db`DELETE FROM program_reviewers WHERE program_id LIKE ${like} OR builder_id = ANY(${bids})`;
  await db`DELETE FROM applications WHERE owner = ANY(${owners}) OR program_id LIKE ${like} OR installation_id = ANY(${inst})`;
  await db`DELETE FROM application_history WHERE owner = ANY(${owners}) OR program_id LIKE ${like}`;
  await db`DELETE FROM gaps_done WHERE owner = ANY(${owners}) OR program_id LIKE ${like}`;
  await db`DELETE FROM project_reports WHERE owner = ANY(${owners})`;
  await db`DELETE FROM link_codes WHERE installation_id = ANY(${inst})`;
  await db`DELETE FROM installations WHERE id = ANY(${inst})`;
  // M6: their people, once no installation or builder holds them.
  await db`DELETE FROM people p WHERE p.id = ANY(${pids}) AND p.builder_id IS NULL AND NOT EXISTS (SELECT 1 FROM installations i WHERE i.person_id = p.id)`;
  // L37-2 (v6.1.18): the agents' registrations too.
  await db`DELETE FROM oauth_clients WHERE client_name LIKE ${like} OR client_name = ${c.tag}`;
  await db`DELETE FROM sessions WHERE builder_id = ANY(${bids})`;
  await db`DELETE FROM program_changes WHERE program_id LIKE ${like}`;
  await db`DELETE FROM program_health WHERE program_id LIKE ${like}`;
  await db`DELETE FROM programs WHERE id LIKE ${like}`;
  await db`DELETE FROM repo_cache WHERE repo LIKE ${'lane33/' + c.id.toLowerCase() + '-%'}`;
  await db`DELETE FROM evidence_cache WHERE key LIKE ${'%lane33/' + c.id.toLowerCase() + '-%'}`;
  await db`DELETE FROM rate_windows WHERE key LIKE ${'%10.33.' + c.octet + '.%'} OR key = ANY(${inst.flatMap((i) => [`repoRead:${i}`, `mcp:${i}`])}) OR key = ANY(${bids.map((b) => 'screenJobs:b:' + b)})`;
}
