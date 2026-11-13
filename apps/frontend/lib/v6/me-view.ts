/**
 * The data /me renders: the signed-in builder's record as blocks of editable fields in builder words,
 * the answers waiting for approval, their ledger and linked agents, and the day's csrf token
 * (an HMAC of the builder id, the session and the UTC day, accepted today and the day after). Reads only this builder's rows.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../v5/db';
import { amountsOf, earlierAmounts, EARLIER_WIN, type EarlierWin, ledgerCounts, projectLabel, projectNames, summary } from '../v5/ledger';
import { ANSWER_KINDS, PROGRAM_CATEGORIES } from '../v5/program-file';
import { nameKeyOf, projectKeyOf } from '../v5/project-input';
import { amountsText, moneyText, usdFull, type Amounts } from '../v5/programs-read';
import { cleanClientName, displayName } from '../v5/installations';
import { cleanText } from '../v5/controls';
import {
  LINK_ASK_PARTS, LINK_FIRST_SEEN, ME_AN_AGENT, ME_BLOCKS, ME_HELD_ROW, ME_LABELS, ME_LINK_NOT, ME_PROJECT_SEEN, ME_REVIEWS, ME_STATUS,
  ME_CHOICES, ME_TEAM, dayWords, mePolicyStatus,
} from '../v5/site-copy';
import { SENT_ASK_AFTER_HOURS } from '../v5/ledger';
import { CLAIM_HOURS } from './claims';
import { type Builder, getRecord } from './builders';
import { LINK_STATES, OTHER, codeShaped, codeState, deniedCode, linkedBy, liveCode } from './link-routes';
import type { Draft } from './sessions';
import { reviewerPrograms } from './reviewers';
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
  /** L43-4 (v6.1.19): what the builder typed here before a refusal (the session's draft), shown in place of `value`. */
  typed?: string;
};
export type MeData = {
  login: string; name: string | null; csrf: string;
  blocks: { key: BlockKey; title: string; fields: MeField[] }[];
  pending_approvals: { path: string; label: string; text: string; seen: string; short?: string }[];
  /**
   * The title only, never the slug (v6.1.8, lane 5). `words` is the row's result as a sentence (L21-1, v6.1.16):
   * "Won $5,000, Nov 11.", "Won $3,500 in all, Nov 11." after a further payment; `money` the win's full figure or null.
   */
  ledger: {
    title: string; status: string; at: string; money: string | null; words: string;
    /** L47-12 (v6.1.22): the project the row is for, when the rows name more than one: the agent's words, cut at 60 and
     *  shown after the title in <bdi> (Task 3 review), else null. */
    project: string | null;
    /** L43-9 (v6.1.19): a started row the builder may say they sent (`I sent it`): its program and project key. */
    send: { program_id: string; project_id: string } | null;
  }[];
  /** "6 sent, 3 won ($12,000), 1 rejected, 2 waiting.": the find reply's counts, word for word (Review Focus 9); null with none sent. */
  ledger_line: string | null;
  /** `label`: the agent's own name, else "An agent linked Nov 6" (L21-10, v6.1.16); never a client id. */
  installations: { id: number; client_name: string | null; label: string; linked_at: string }[];
  /** "You review {program}. Results come through your agent.", one per program the builder reviews (L21-13). */
  reviews: string[];
  /** Projects the applications and claims name that the record does not hold, read-only (L21-12, v6.1.16). */
  projects_seen: { key: string; label: string; count: number; line: string }[];
  /**
   * After sign-in from /link/<code>: the banner's title per state (L21-6, v6.1.16), the code to confirm and the
   * banner text ('' when the title says it all); code null when it is no longer live. `parts`: the text split around
   * the agent's own name, which the page shows isolated (v6.1.7 C1); null without one.
   */
  link: { title: string; code: string | null; text: string; parts: [string, string, string] | null } | null;
  /**
   * L43-4 (v6.1.19): what the builder typed into a form that was refused, by field path (the policy form's own names
   * under `policy.`, the delete box under `delete.confirm`), kept 15 minutes; null without one. Rendered escaped as
   * every value is.
   */
  draft: Draft | null;
  /** L24-14 (v6.1.16 Task 11): the standing approval's state in words, then what was sent under it. */
  policy_status: string[];
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
    // Its ISO time here; `recordBlocks` writes it as dayWords at its `now` (L23-11, v6.1.16).
    approved_on: approved && meta?.approved_at ? meta.approved_at : null,
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
export function recordBlocks(record: BuilderRecord, now: Date = new Date()): MeData['blocks'] {
  return blocksOf(record).map((b) => ({ ...b, fields: b.fields.map((f) => (f.approved_on ? { ...f, approved_on: dayWords(new Date(f.approved_on), now) } : f)) }));
}

function blocksOf(record: BuilderRecord): MeData['blocks'] {
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


/** An answer's path on /me: `answers.{kind}` or `projects.{id}.answers.{kind}`. Pure. */
export const isAnswerPath = (path: string): boolean => /^(?:projects\.[a-z0-9]+(?:-[a-z0-9]+)*\.)?answers\.[a-z_]+$/.test(path);

/**
 * An answer collapsed to its first line (L35-24, v6.1.17 Task 4): the first line with text, cut at a word to `max`
 * characters (code points) with an ellipsis. Pure.
 */
export function firstLineOf(text: string, max = 60): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

/** Approvable paths holding a value the builder has not approved, with the text they would approve. Pure. */
export function pendingApprovals(record: BuilderRecord): MeData['pending_approvals'] {
  const out: MeData['pending_approvals'] = [];
  const add = (path: string, labelText: string, text: string | undefined, short?: string) => {
    if (text && APPROVABLE(path) && !isApproved(record, path)) out.push({ path, label: labelText, text, seen: seenOf(record, path), ...(short ? { short } : {}) });
  };
  // L43-7 (v6.1.19): in page order (recordBlocks: the projects card before Your answers), so Open the first one opens
  // the first waiting answer on the page.
  for (const p of record.projects)
    for (const k of ANSWER_KINDS) add(`projects.${p.id}.answers.${k}`, `${p.name ?? p.id}: ${KIND_WORDS[k]}`, p.answers[k]?.text, p.answers[k]?.short);
  for (const k of ANSWER_KINDS) add(`answers.${k}`, answerLabel(k), record.answers[k]?.text, record.answers[k]?.short);
  add('traction.line_pre_launch', label('traction.line_pre_launch'), record.traction.line_pre_launch);
  const { raised_usd: n, raised_from: from } = record.company;
  const raised = [n !== undefined ? usdFull(n) : '', from ? `from ${from}` : ''].filter(Boolean).join(' ');
  add('company.raised', label('company.raised'), raised || undefined);
  return out;
}

/**
 * The link banner for /me?link=<code>, its title per state (L21-6, L21-17, v6.1.16), one sentence each from the
 * LINK_STATES /link reads (L43-17, v6.1.19): live asks `Link "{name}" to your GitHub account?` (buttons) with its one
 * line; used by this builder `Linked.`; answered Not me `Not linked. If it was you, ask your agent for a new link.`;
 * another account's agent `Not linked.` with OTHER (no buttons: the post would answer that); expired `This link has
 * expired.`; a code EarnKit never made, or malformed, `This link is not one of ours.`
 */
async function linkBanner(code: string | null | undefined, builderId: number, now: Date): Promise<MeData['link']> {
  if (code === null || code === undefined) return null;
  const dead = (st: { title: string; line: string }) => ({ title: st.title, code: null, text: st.line, parts: null });
  if (!codeShaped(code)) return dead(LINK_STATES.unknown);
  const live = await liveCode(code, now);
  if (!live) {
    if (await linkedBy(code, builderId)) return dead(LINK_STATES.used);
    // Low 16 (v6.1.13): a code the builder said Not me to says what they chose.
    if (await deniedCode(code)) return dead(LINK_STATES.denied);
    return (await codeState(code, now)) === 'unknown' ? dead(LINK_STATES.unknown) : dead(LINK_STATES.expired);
  }
  if (live.builder_id !== null && Number(live.builder_id) !== builderId) return dead({ title: ME_LINK_NOT, line: OTHER });
  // L25-1 (v6.1.16): the shown name drops a trailing "(earnkit)"; the title names it, isolated on the page (`parts`).
  const name = displayName(live.client_name);
  const parts = LINK_ASK_PARTS(name);
  return { title: parts.join(''), code, text: LINK_FIRST_SEEN(dayWords(live.created_at, now)), parts: name ? parts : null };
}

/**
 * A ledger row's result as a sentence (L21-1, L21-19, v6.1.16): "Won $5,000, Nov 11.", "Won $3,500 in all, Nov 11."
 * when the win holds a further payment, "Won, amount not given, Nov 11.", "Applied, Nov 11.", "Rejected, Nov 11.".
 * A corrected win shows the current amount (the row holds it). Money through the one format (L22-7, v6.1.16: cents
 * and currencies kept, "Won $1,000 and EUR 500 in all, Nov 11."); a number is US dollars. Pure.
 */
export function ledgerRowWords(status: string, amounts: Amounts | number | string | null, paid_more: boolean, day: string): string {
  if (status === 'won') {
    const a = amounts === null || typeof amounts === 'object' ? amounts : amountsOf({ amount_usd: amounts });
    if (a === null) return `Won, amount not given, ${day}.`;
    return `Won ${amountsText(a)}${paid_more ? ' in all' : ''}, ${day}.`;
  }
  return `${ME_STATUS[status] ?? cap(status.replaceAll('_', ' '))}, ${day}.`;
}

/**
 * The builder's agents with the words /me shows for each (L21-10, v6.1.16): the agent's own name, else
 * "An agent linked Nov 6", a second unnamed one linked the same day " (2)" and so on, oldest first. Never a client id.
 */
export async function agentList(builderId: number, now: Date = new Date()): Promise<MeData['installations']> {
  const rows = await sql()<{ id: number; client_name: string | null; linked_at: Date | null }[]>`
    SELECT id, client_name, linked_at FROM installations WHERE builder_id = ${builderId} ORDER BY linked_at DESC NULLS LAST, id`;
  const seen = new Map<string, number>();
  const labels = new Map<number, string>();
  // Numbered in the order they were linked, so the later one of a day carries the (2).
  for (const r of [...rows].reverse()) {
    const name = displayName(r.client_name);
    if (name) {
      labels.set(r.id, name);
      continue;
    }
    const base = ME_AN_AGENT(r.linked_at ? dayWords(r.linked_at, now) : null);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    labels.set(r.id, n > 1 ? `${base} (${n})` : base);
  }
  return rows.map((r) => ({ id: r.id, client_name: cleanClientName(r.client_name), label: labels.get(r.id)!, linked_at: r.linked_at ? dayWords(r.linked_at, now) : '' }));
}

/**
 * Projects the owner's sent applications name (`project_id`) that the record does not hold (L21-12, v6.1.16; N1 ruling:
 * a claim is not counted, the count is what was sent): with the count, read-only. A record project matches by its id or
 * its project key. L46-16 (v6.1.22): labelled by the name the agent passed (`names`, projectNames), else the key's short
 * label (a repo's last segment, a name key's name), never the full repo link. Pure.
 */
export function projectsSeen(record: BuilderRecord, rows: { project_id: string; n: number }[], names: Map<string, string> = new Map()): MeData['projects_seen'] {
  const held = new Set(record.projects.flatMap((p) => [p.id, projectKeyOf(p), nameKeyOf(p)].filter(Boolean)));
  return rows
    .filter((r) => r.project_id && !held.has(r.project_id))
    .flatMap((r) => {
      // Task 3 review (v6.1.22): a key with no label is left out, so a repo link or a raw key never shows.
      const label = projectLabel(r.project_id, names);
      return label ? [{ key: r.project_id, label, count: r.n, line: ME_PROJECT_SEEN(label, r.n) }] : [];
    });
}

/** The page's data for this builder only; `session` is the request's session cookie value (the csrf binds to it); `link` is the ?link= code, if any. */
export async function meData(builder: Builder, now: Date, session: string, link?: string | null, draft: Draft | null = null): Promise<MeData> {
  const record = await getRecord(builder.id);
  const owner = `b:${builder.id}`;
  // L21-1 (v6.1.16): the current amount (a correction replaced it; a further payment added to it) and whether a further
  // payment came after the last correction, so the row reads "in all".
  const ledger = await sql()<{ title: string | null; program_id: string; project_id: string | null; status: string; at: Date; claimed_at: Date | null; held_at: Date | null; submit: string | null; amount_usd: string | null; amounts: unknown; paid_more: boolean; earlier_win: EarlierWin | null }[]>`
    SELECT COALESCE(p.file->>'title', a.title) AS title, a.program_id, a.project_id, a.status, a.at, a.claimed_at, a.held_at, p.file->>'submit' AS submit, a.amount_usd, a.amounts,
      a.earlier_win,
      EXISTS (SELECT 1 FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.payment_key IS NOT NULL
        AND h.at >= COALESCE((SELECT max(c.at) FROM application_history c WHERE c.owner = a.owner AND c.program_id = a.program_id AND COALESCE(c.project_id, '') = COALESCE(a.project_id, '') AND c.corrected), '-infinity'::timestamptz)) AS paid_more
    FROM applications a LEFT JOIN programs p ON p.id = a.program_id
    WHERE a.owner = ${owner} ORDER BY a.at DESC LIMIT 100`;
  const seen = await sql()<{ project_id: string; n: number }[]>`
    SELECT project_id, count(*)::int AS n FROM applications WHERE owner = ${owner} AND project_id IS NOT NULL AND status <> ALL(${['skipped', 'started']})
    GROUP BY project_id ORDER BY project_id`;
  const counts = await summary(owner, [], now);
  const reviews = await reviewerPrograms(builder.id);
  const titles = reviews.length === 0 ? [] : await sql()<{ id: string; title: string | null }[]>`SELECT id, file->>'title' AS title FROM programs WHERE id = ANY(${reviews})`;
  const titleOf = new Map(titles.map((t) => [t.id, t.title ?? t.id]));
  const names = await projectNames(owner);
  // L47-12 (v6.1.22): when the rows name more than one project, each row with a project names it after the title.
  const many = new Set(ledger.flatMap((r) => (r.project_id ? [r.project_id] : []))).size > 1;
  // Task 3 review (v6.1.22): cut at 60, as the /link agent name is; MeView isolates it in <bdi>.
  const projectOf = (key: string | null): string | null => {
    const label = many && key ? projectLabel(key, names) : null;
    return label ? cleanText(label, 60) || null : null;
  };
  return {
    login: builder.login,
    name: builder.name,
    csrf: csrfToken(builder.id, utcDay(now), authSecret(), session),
    blocks: recordBlocks(record, now),
    pending_approvals: pendingApprovals(record),
    ledger: ledger.map((r) => {
      const started = (r.claimed_at ?? r.at).getTime();
      // L43-2 (v6.1.19): a claim the builder held reads as held, from the hold's day, never as an unfinished send.
      const held = r.status === 'started' && r.held_at !== null;
      // L23-7 (v6.1.16): a claim older than CLAIM_HOURS with no send reads "Started, not sent", until a find releases it.
      const lapsed = r.status === 'started' && !held && started <= now.getTime() - CLAIM_HOURS * 3_600_000;
      const status = held ? 'on_hold' : lapsed ? 'started_not_sent' : r.status;
      // L43-9 (v6.1.19): a lapsed claim, or one the sent ask is about (the builder presses submit, an hour on), may be
      // said sent here.
      const asked = r.status === 'started' && !held && r.submit === 'builder' && started <= now.getTime() - SENT_ASK_AFTER_HOURS * 3_600_000;
      // L47-6 (v6.1.22): a win kept from an earlier round reads as that; once a new round started, the row reads as
      // itself and the earlier win follows.
      const earlier = r.earlier_win;
      const earlierWords = earlier ? EARLIER_WIN(amountsText(earlierAmounts(earlier)) || null) : '';
      const words = held ? ME_HELD_ROW(dayWords(r.held_at!, now))
        : ledgerRowWords(status, r.status === 'won' ? amountsOf(r) : null, r.paid_more, dayWords(lapsed ? (r.claimed_at ?? r.at) : r.at, now));
      return {
        title: r.title ?? r.program_id,
        project: projectOf(r.project_id),
        status: ME_STATUS[status] ?? cap(status.replaceAll('_', ' ')),
        at: dayWords(r.at, now),
        money: r.status === 'won' ? amountsText(amountsOf(r)) || null : null,
        words: earlier?.moved ? `${words} ${earlierWords}` : earlier && r.status === 'won' ? earlierWords : words,
        send: lapsed || asked ? { program_id: r.program_id, project_id: r.project_id ?? '' } : null,
      };
    }),
    ledger_line: counts.applied > 0 ? ledgerCounts(counts) : null,
    installations: await agentList(builder.id, now),
    reviews: reviews.map((id) => ME_REVIEWS(titleOf.get(id) ?? id)),
    projects_seen: projectsSeen(record, seen, names),
    link: await linkBanner(link, builder.id, now),
    draft,
    policy_status: mePolicyStatus(
      {
        on: record.policy.auto_apply, perDay: record.policy.max_per_night,
        kinds: (record.policy.categories.length > 0 ? record.policy.categories : [...PROGRAM_CATEGORIES]).map((c) => (ME_CHOICES[c] ?? c).toLowerCase()),
        cap: record.policy.max_ask_usd !== undefined && record.policy.max_ask_usd !== null ? moneyText(record.policy.max_ask_usd) : null,
      },
      (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner} AND auto_applied`)[0].n,
    ),
  };
}
