/**
 * The data /me renders: the signed-in builder's record as blocks of editable fields in builder words,
 * the answers waiting for approval, their ledger and linked agents, and the day's csrf token
 * (an HMAC of the builder id, the session and the UTC day, accepted today and the day after). Reads only this builder's rows.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../v5/db';
import { ANSWER_KINDS, PROGRAM_CATEGORIES } from '../v5/program-file';
import { cleanClientName } from '../v5/installations';
import { ME_BLOCKS, ME_LABELS, ME_LINK_PARTS, ME_STATUS, ME_TEAM, monthDay } from '../v5/site-copy';
import { type Builder, getRecord } from './builders';
import { ALREADY_LINKED, EXPIRED, INVALID, OTHER, codeShaped, linkedBy, liveCode } from './link-routes';
import { APPROVABLE, type BuilderRecord, isApproved, KIND_WORDS } from './record';

export type FieldKind = 'text' | 'long' | 'url' | 'bool' | 'number' | 'choice';
export type BlockKey = 'person' | 'team' | 'projects' | 'company' | 'docs' | 'traction' | 'answers' | 'policy';
export type MeField = {
  path: string; label: string; value: string; kind: FieldKind; options?: string[];
  set_by: 'builder' | 'agent' | null; approvable: boolean; approved: boolean;
  /** "Nov 6" when approved. */
  approved_on: string | null;
  /** The approval's set_at as rendered ('' without one): approve is refused when it moved since. */
  seen: string;
  /** An answer's short form, shown under it and approved with it (v6.1.8 B16). */
  short?: string;
};
export type MeData = {
  login: string; name: string | null; csrf: string;
  blocks: { key: BlockKey; title: string; fields: MeField[] }[];
  pending_approvals: { path: string; label: string; text: string; seen: string; short?: string }[];
  /** The title only, never the slug (v6.1.8, lane 5). */
  ledger: { title: string; status: string; at: string }[];
  installations: { id: number; client_name: string | null; linked_at: string }[];
  /**
   * After sign-in from /link/<code>: the code to confirm and the banner text; code null when it is no longer live.
   * `parts`: the text split around the agent's own name, which the page shows isolated (v6.1.7 C1); null without one.
   */
  link: { code: string | null; text: string; parts: [string, string, string] | null } | null;
};

const DAY = 86_400_000;
/** The UTC day of a time, YYYY-MM-DD. Pure. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export function authSecret(): string {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

/**
 * base64url HMAC-SHA256 of "me-csrf:<builder>:<session token>:<YYYY-MM-DD>": bound to the session cookie's
 * value, so a token leaked from one session's page fails under any other (security L4). Pure.
 */
export const csrfToken = (builderId: number, day: string, secret: string, sessionToken: string): string =>
  createHmac('sha256', secret).update(`me-csrf:${builderId}:${sessionToken}:${day}`).digest('base64url');

const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Today's or yesterday's token for this builder and this session, compared in constant time. Pure. */
export function verifyCsrf(token: string, builderId: number, now: Date, secret: string, sessionToken: string): boolean {
  if (!token || !sessionToken) return false;
  const ok = [0, 1].map((n) => same(token, csrfToken(builderId, utcDay(new Date(now.getTime() - n * DAY)), secret, sessionToken)));
  return ok.some(Boolean);
}

/**
 * A /me line's signature over its key (problem or note), the builder it was written for and the UTC day, so /me shows
 * only lines its own handlers wrote for this builder, as the kind they were written as, today or yesterday (never a
 * crafted link's text, never another builder's line, never a link kept for later). Pure.
 */
export const problemSig = (key: 'problem' | 'note', line: string, builderId: number, day: string, secret: string): string =>
  createHmac('sha256', secret).update(`me-${key}:${builderId}:${day}:${line}`).digest('base64url').slice(0, 22);
/** The line when its signature was made for this key and builder today or yesterday; anything else is not shown. Pure. */
export function problemShown(key: 'problem' | 'note', line: string | undefined, sig: string | undefined, builderId: number, now: Date, secret: string): string | null {
  if (!line || !sig) return null;
  const ok = [0, 1].map((n) => same(sig, problemSig(key, line, builderId, utcDay(new Date(now.getTime() - n * DAY)), secret)));
  return ok.some(Boolean) ? line : null;
}

/** The set_at the builder sees for an approvable path ('' when it has no meta); approvePost checks it. Pure. */
export const seenOf = (record: BuilderRecord, path: string): string => record.meta[path]?.set_at ?? '';

/** The path an approval is stored under: the two raised fields share company.raised. Pure. */
export const approvalPathOf = (path: string): string => (path === 'company.raised_usd' || path === 'company.raised_from' ? 'company.raised' : path);

type Spec = { key: string; kind: FieldKind; options?: readonly string[] };
const PERSON: Spec[] = [
  { key: 'name', kind: 'text' }, { key: 'email', kind: 'text' }, { key: 'x', kind: 'text' }, { key: 'linkedin', kind: 'url' },
  { key: 'location', kind: 'text' }, { key: 'timezone', kind: 'text' }, { key: 'phone', kind: 'text' }, { key: 'bio', kind: 'long' },
  { key: 'technical', kind: 'bool' }, { key: 'based_country', kind: 'text' },
];
const PROJECT: Spec[] = [
  { key: 'name', kind: 'text' }, { key: 'one_liner', kind: 'text' }, { key: 'description', kind: 'long' }, { key: 'goals', kind: 'long' },
  { key: 'repo_url', kind: 'url' }, { key: 'live_url', kind: 'url' }, { key: 'demo_url', kind: 'url' }, { key: 'category', kind: 'text' },
  { key: 'chains_claimed', kind: 'text' },
];
const COMPANY: Spec[] = [
  { key: 'name', kind: 'text' }, { key: 'incorporated', kind: 'bool' }, { key: 'jurisdiction', kind: 'text' }, { key: 'raised_usd', kind: 'number' },
  { key: 'raised_from', kind: 'long' }, { key: 'stage', kind: 'choice', options: ['idea', 'building', 'pre_launch', 'launched'] },
  { key: 'launch_date', kind: 'text' },
];
const DOCS: Spec[] = [
  { key: 'resume_url', kind: 'url' }, { key: 'deck_url', kind: 'url' }, { key: 'founder_video_url', kind: 'url' },
  { key: 'demo_video_url', kind: 'url' }, { key: 'other', kind: 'long' },
];
const TRACTION: Spec[] = [
  { key: 'line_pre_launch', kind: 'text' }, { key: 'waitlist', kind: 'number' }, { key: 'revenue_usd_claim', kind: 'number' }, { key: 'notes', kind: 'long' },
];
const POLICY: Spec[] = [
  { key: 'auto_apply', kind: 'bool' }, { key: 'max_per_night', kind: 'number' }, { key: 'categories', kind: 'choice', options: PROGRAM_CATEGORIES },
  { key: 'max_ask_usd', kind: 'number' }, { key: 'never', kind: 'long' }, { key: 'agent_may_submit', kind: 'bool' },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (key: string) => (ME_LABELS as Record<string, string>)[key];

/** A stored value as the form shows it: lists comma or line separated, "other" links as "label url" lines. Pure. */
function shown(key: string, v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) {
    if (key === 'docs.other') return (v as { label: string; url: string }[]).map((o) => `${o.label} ${o.url}`).join('\n');
    return v.join(key === 'policy.never' ? '\n' : ', ');
  }
  if (typeof v === 'object') return (v as { text?: string }).text ?? '';
  return String(v);
}

function field(record: BuilderRecord, path: string, labelText: string, spec: { kind: FieldKind; options?: readonly string[] }, v: unknown, labelKey = path): MeField {
  // The two raised fields share one approval, shown on the amount unless only the source is set.
  const approvable = APPROVABLE(approvalPathOf(path)) && !(path === 'company.raised_from' && record.company.raised_usd !== undefined);
  // The team list is one path in the record: each member's fields show who set the list.
  const meta = record.meta[approvalPathOf(path)] ?? record.meta[path] ?? (path.startsWith('team.') ? record.meta.team : undefined);
  const approved = approvable && isApproved(record, approvalPathOf(path));
  const short = isObj(v) && typeof v.short === 'string' ? v.short : undefined;
  return {
    path, label: labelText, value: shown(labelKey, v), kind: spec.kind, ...(spec.options ? { options: [...spec.options] } : {}),
    set_by: meta?.set_by ?? null, approvable, approved,
    approved_on: approved && meta?.approved_at ? monthDay(new Date(meta.approved_at)) : null,
    seen: seenOf(record, approvalPathOf(path)),
    ...(short ? { short } : {}),
  };
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The team list as fields (v6.1.8 B19): each member's name and role, then an empty row to add one while there is room. Pure. */
function teamFields(record: BuilderRecord): MeField[] {
  const text = { kind: 'text' as const };
  const rows = record.team.flatMap((m, i) => [
    field(record, `team.${i}.name`, ME_TEAM.name(i + 1), text, m.name),
    field(record, `team.${i}.role`, ME_TEAM.role(i + 1), text, m.role),
  ]);
  return record.team.length < MAX_TEAM ? [...rows, { ...field(record, `team.${record.team.length}.name`, ME_TEAM.add, text, undefined), set_by: null }] : rows;
}
/** The most members the record keeps. */
export const MAX_TEAM = 10;

const obj = (o: object) => o as Record<string, unknown>;
const fromSpecs = (record: BuilderRecord, block: string, specs: Spec[]) =>
  specs.map((s) => field(record, `${block}.${s.key}`, label(`${block}.${s.key}`), s, valueAt(record, block, s.key)));
/** A leaf's stored value; an old record's empty category list with standing approval on reads as every category, as the server counts it (v6.1.9 N6). */
function valueAt(record: BuilderRecord, block: string, key: string): unknown {
  if (block === 'policy' && key === 'categories' && record.policy.auto_apply && record.policy.categories.length === 0) return [...PROGRAM_CATEGORIES];
  return obj(record[block as keyof BuilderRecord] as object)[key];
}
const answerLabel = (kind: string) => cap(KIND_WORDS[kind as keyof typeof KIND_WORDS]);

/** Every editable leaf of the record, by block, in display order, with its label in builder words. Pure. */
export function recordBlocks(record: BuilderRecord): MeData['blocks'] {
  const projects = record.projects.flatMap((p) => [
    ...PROJECT.map((s) => field(record, `projects.${p.id}.${s.key}`, label(`project.${s.key}`), s, obj(p)[s.key], `project.${s.key}`)),
    ...ANSWER_KINDS.filter((k) => p.answers[k]).map((k) => field(record, `projects.${p.id}.answers.${k}`, answerLabel(k), { kind: 'long' }, p.answers[k])),
  ]);
  return [
    { key: 'person', title: ME_BLOCKS.person, fields: fromSpecs(record, 'person', PERSON) },
    { key: 'team', title: ME_BLOCKS.team, fields: teamFields(record) },
    { key: 'projects', title: ME_BLOCKS.projects, fields: projects },
    { key: 'company', title: ME_BLOCKS.company, fields: fromSpecs(record, 'company', COMPANY) },
    { key: 'docs', title: ME_BLOCKS.docs, fields: fromSpecs(record, 'docs', DOCS) },
    { key: 'traction', title: ME_BLOCKS.traction, fields: fromSpecs(record, 'traction', TRACTION) },
    { key: 'answers', title: ME_BLOCKS.answers, fields: ANSWER_KINDS.map((k) => field(record, `answers.${k}`, answerLabel(k), { kind: 'long' }, record.answers[k])) },
    { key: 'policy', title: ME_BLOCKS.policy, fields: fromSpecs(record, 'policy', POLICY) },
  ];
}

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Approvable paths holding a value the builder has not approved, with the text they would approve. Pure. */
export function pendingApprovals(record: BuilderRecord): MeData['pending_approvals'] {
  const out: MeData['pending_approvals'] = [];
  const add = (path: string, labelText: string, text: string | undefined, short?: string) => {
    if (text && APPROVABLE(path) && !isApproved(record, path)) out.push({ path, label: labelText, text, seen: seenOf(record, path), ...(short ? { short } : {}) });
  };
  for (const k of ANSWER_KINDS) add(`answers.${k}`, answerLabel(k), record.answers[k]?.text, record.answers[k]?.short);
  for (const p of record.projects)
    for (const k of ANSWER_KINDS) add(`projects.${p.id}.answers.${k}`, `${p.name ?? p.id}: ${KIND_WORDS[k]}`, p.answers[k]?.text, p.answers[k]?.short);
  add('traction.line_pre_launch', label('traction.line_pre_launch'), record.traction.line_pre_launch);
  const { raised_usd: n, raised_from: from } = record.company;
  const raised = [n !== undefined ? usd(n) : '', from ? `from ${from}` : ''].filter(Boolean).join(' ');
  add('company.raised', label('company.raised'), raised || undefined);
  return out;
}

/**
 * The link banner for /me?link=<code>: the agent that asked; that it is already linked to another account (no
 * buttons: the post would answer that); that the link expired; or, for a code EarnKit never makes, that it is not valid.
 */
async function linkBanner(code: string | null | undefined, builderId: number, now: Date): Promise<MeData['link']> {
  if (code === null || code === undefined) return null;
  if (!codeShaped(code)) return { code: null, text: INVALID, parts: null };
  const live = await liveCode(code, now);
  if (!live) return { code: null, text: (await linkedBy(code, builderId)) ? ALREADY_LINKED : EXPIRED, parts: null };
  if (live.builder_id !== null && Number(live.builder_id) !== builderId) return { code: null, text: OTHER, parts: null };
  const name = cleanClientName(live.client_name);
  const parts = ME_LINK_PARTS(name, monthDay(live.created_at));
  return { code, text: parts.join(''), parts: name ? parts : null };
}

/** The page's data for this builder only; `session` is the request's session cookie value (the csrf binds to it); `link` is the ?link= code, if any. */
export async function meData(builder: Builder, now: Date, session: string, link?: string | null): Promise<MeData> {
  const record = await getRecord(builder.id);
  const owner = `b:${builder.id}`;
  const ledger = await sql()<{ title: string | null; program_id: string; status: string; at: Date }[]>`
    SELECT COALESCE(p.file->>'title', a.title) AS title, a.program_id, a.status, a.at FROM applications a LEFT JOIN programs p ON p.id = a.program_id
    WHERE a.owner = ${owner} ORDER BY a.at DESC LIMIT 100`;
  const agents = await sql()<{ id: number; client_name: string | null; linked_at: Date | null }[]>`
    SELECT id, client_name, linked_at FROM installations WHERE builder_id = ${builder.id} ORDER BY linked_at DESC NULLS LAST, id`;
  return {
    login: builder.login,
    name: builder.name,
    csrf: csrfToken(builder.id, utcDay(now), authSecret(), session),
    blocks: recordBlocks(record),
    pending_approvals: pendingApprovals(record),
    ledger: ledger.map((r) => ({ title: r.title ?? r.program_id, status: ME_STATUS[r.status] ?? cap(r.status.replaceAll('_', ' ')), at: monthDay(r.at) })),
    installations: agents.map((r) => ({ id: r.id, client_name: cleanClientName(r.client_name), linked_at: r.linked_at ? monthDay(r.linked_at) : '' })),
    link: await linkBanner(link, builder.id, now),
  };
}
