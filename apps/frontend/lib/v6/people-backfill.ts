/**
 * The people backfill (scripts/people-backfill.mts): gives every installation without a person one, from what is known:
 * its linked builder (proven GitHub), else the v4 `builder_profiles` row keyed by the installation's id (the legacy
 * root; X sign-in data carried over), else the owner of the repo its last find named (a claimed, unproven GitHub
 * login), else nothing (and why). Dry run by default: the plan is made inside a READ ONLY transaction that is rolled
 * back, so nothing is written; `apply` writes the same plan in one transaction and is idempotent (a second run finds
 * nothing left). Output never holds a token hash.
 */
import { type Db, sql } from '../v5/db';
import { type TestFlag, testReasonFor } from './people';

type Source = 'github_signin' | 'x_signin_legacy' | 'github_claimed' | 'none';
type Legacy = { builder_id: number; x_handle: string | null; x_user_id: string | null; x_name: string | null; x_avatar_url: string | null; x_created_at: Date | null; x_followers: number | null; github_login: string | null };
type Group = { key: string; builderId: number | null; legacy: Legacy | null; claimed: string | null; existing: number | null; flag: TestFlag | null; installs: number[] };
export type Line = { id: number; created_at: string; client_name: string | null; person: string; identity: Source; test_reason: string | null; none_reason?: string };
type Counts = { installations: number; would_create_people: number; would_link_to_builder: number; identity: Record<Source, number>; none_reasons: Record<string, number>; test: Record<string, number> };
export type Summary = Counts & { already_with_person: number; since: Counts & { from: string } };
export type Plan = { summary: Summary; lines: Line[]; groups: Group[] };

const DEFAULT_SINCE = '2026-10-24';
const NO_REPO = 'anonymous install, never linked, no repo seen';
const NO_FIND = 'never called find';
const GH_REPO = /^https:\/\/github\.com\/([^/]+)\/[^/]+$/;
const LEGACY_COLS = ['x_handle', 'x_user_id', 'x_name', 'x_avatar_url', 'x_created_at', 'x_followers', 'github_login'] as const;

const empty = (): Counts => ({ installations: 0, would_create_people: 0, would_link_to_builder: 0, identity: { github_signin: 0, x_signin_legacy: 0, github_claimed: 0, none: 0 }, none_reasons: {}, test: {} });

/** The legacy profiles by id, reading only the columns that exist; {} when the table is gone. */
async function legacyProfiles(db: Db): Promise<Map<number, Legacy>> {
  const [t] = await db<{ r: string | null }[]>`SELECT to_regclass('builder_profiles')::text AS r`;
  if (!t?.r) return new Map();
  const have = new Set((await db<{ c: string }[]>`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'builder_profiles'`).map((r) => r.c));
  const cols = LEGACY_COLS.filter((c) => have.has(c));
  const sel = LEGACY_COLS.map((c) => (cols.includes(c) ? c : `NULL AS ${c}`)).join(', ');
  const rows = await db.unsafe<Legacy[]>(`SELECT builder_id, ${sel} FROM builder_profiles`);
  return new Map(rows.map((r) => [r.builder_id, r]));
}

/** Plans the person of every installation without one. Reads only. */
export async function plan(db: Db, sinceDate = DEFAULT_SINCE, env: Record<string, string | undefined> = process.env): Promise<Plan> {
  const since = new Date(sinceDate);
  const legacy = await legacyProfiles(db);
  const [{ n }] = await db<{ n: string }[]>`SELECT count(*) AS n FROM installations WHERE person_id IS NOT NULL`;
  const insts = await db<{ id: number; created_at: Date; client_name: string | null; builder_id: number | null; last_project_key: string | null; last_find_at: Date | null; login: string | null; builder_person: number | null; legacy_person: number | null }[]>`
    SELECT i.id, i.created_at, i.client_name, i.builder_id, i.last_project_key, i.last_find_at, b.login,
      (SELECT p.id FROM people p WHERE p.builder_id = i.builder_id) AS builder_person,
      (SELECT p.id FROM people p WHERE p.legacy_profile_id = i.id) AS legacy_person
    FROM installations i LEFT JOIN builders b ON b.id = i.builder_id WHERE i.person_id IS NULL ORDER BY i.id`;
  const total = Number(n) + insts.length;
  const groups = new Map<string, Group>();
  const per: { i: (typeof insts)[number]; g: Group; source: Source; why?: string }[] = [];
  for (const i of insts) {
    const prof = i.builder_id == null ? (legacy.get(i.id) ?? null) : null;
    const owner = GH_REPO.exec(i.last_project_key ?? '')?.[1] ?? null;
    const key = i.builder_id != null ? `b:${i.builder_id}` : prof ? `p:${prof.builder_id}` : `i:${i.id}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, builderId: i.builder_id, legacy: prof, claimed: i.builder_id == null && !prof?.github_login ? owner : null, existing: i.builder_person ?? i.legacy_person, flag: null, installs: [] }));
    g.installs.push(i.id);
    g.claimed ??= i.builder_id == null && !prof?.github_login ? owner : null;
    g.flag ??= testReasonFor({ clientName: i.client_name, githubLogin: i.login ?? prof?.github_login ?? g.claimed, xHandle: prof?.x_handle, installationId: i.id }, env);
    const source: Source = i.builder_id != null ? 'github_signin' : prof?.x_user_id ? 'x_signin_legacy' : prof?.github_login || g.claimed ? 'github_claimed' : 'none';
    per.push({ i, g, source, why: source === 'none' ? (i.last_find_at || i.last_project_key ? NO_REPO : NO_FIND) : undefined });
  }
  const summary: Summary = { ...empty(), already_with_person: Number(n), installations: total, since: { ...empty(), from: sinceDate } };
  const seen = new Set<Group>();
  const lines: Line[] = [];
  for (const { i, g, source, why } of per) {
    const firstOfGroup = !seen.has(g);
    seen.add(g);
    for (const c of i.created_at >= since ? [summary, summary.since] : [summary]) {
      if (firstOfGroup && g.existing == null) c.would_create_people++;
      if (i.builder_id != null) c.would_link_to_builder++;
      c.identity[source]++;
      if (why) c.none_reasons[why] = (c.none_reasons[why] ?? 0) + 1;
      if (g.flag) c.test[g.flag.reason] = (c.test[g.flag.reason] ?? 0) + 1;
    }
    lines.push({ id: i.id, created_at: i.created_at.toISOString(), client_name: i.client_name, person: g.existing != null ? `person ${g.existing}` : g.builderId != null ? `new person for builder ${g.builderId}` : `new person (${g.key})`, identity: source, test_reason: g.flag?.reason ?? null, ...(why && { none_reason: why }) });
  }
  // `installations` of the since subtotal counts every installation created since (planned or not).
  summary.since.installations = Number((await db<{ n: string }[]>`SELECT count(*) AS n FROM installations WHERE created_at >= ${since}`)[0].n);
  return { summary, lines, groups: [...groups.values()] };
}

/** Writes the plan: one person per group (the existing one reused), its installations pointed at it. */
export async function applyPlan(tx: Db, p: Plan): Promise<void> {
  for (const g of p.groups) {
    let id = g.existing;
    if (id == null) {
      const l = g.legacy;
      [{ id }] = await tx<{ id: number }[]>`
        INSERT INTO people (builder_id, x_handle, x_user_id, x_name, x_avatar_url, x_created_at, x_followers, github_login, legacy_profile_id)
        VALUES (${g.builderId}, ${l?.x_handle ?? null}, ${l?.x_user_id ?? null}, ${l?.x_name ?? null}, ${l?.x_avatar_url ?? null}, ${l?.x_created_at ?? null}, ${l?.x_followers ?? null},
          ${g.builderId == null ? (l?.github_login ?? g.claimed) : null}, ${l?.builder_id ?? null}) RETURNING id`;
    }
    if (g.flag) await tx`UPDATE people SET test_reason = ${g.flag.reason}, test_reason_source = ${g.flag.source} WHERE id = ${id} AND test_reason IS NULL`;
    await tx`UPDATE installations SET person_id = ${id} WHERE id = ANY(${g.installs}) AND person_id IS NULL`;
  }
}

class DryRun extends Error {}

/** The CLI: `[--apply] [--since YYYY-MM-DD]`. Prints the JSON summary and one line per installation (in the report's range). */
export async function run(argv: string[], out: (s: string) => void = console.log): Promise<Plan> {
  const apply = argv.includes('--apply');
  const at = argv.indexOf('--since');
  const since = at >= 0 ? argv[at + 1] : undefined;
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since takes a date, YYYY-MM-DD');
  let result!: Plan;
  if (apply) {
    await sql().begin(async (tx) => {
      result = await plan(tx, since);
      await applyPlan(tx, result);
    });
  } else {
    // READ ONLY, then rolled back: a dry run can never write.
    await sql().begin('read only', async (tx) => {
      result = await plan(tx, since);
      throw new DryRun();
    }).catch((e) => {
      if (!(e instanceof DryRun)) throw e;
    });
  }
  out(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result.summary }, null, 2));
  const from = since ? new Date(since) : null;
  for (const l of result.lines) if (!from || new Date(l.created_at) >= from) out(JSON.stringify(l));
  return result;
}
