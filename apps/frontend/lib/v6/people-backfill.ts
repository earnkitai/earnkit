/**
 * The people backfill (scripts/people-backfill.mts): gives every installation without a person one, from what is known:
 * its linked builder (proven GitHub), else the v4 `builder_profiles` row keyed by the installation's id (the legacy
 * root; X sign-in data carried over), else the owner of the repo its last find named (a claimed, unproven GitHub
 * login), else nothing (and why). Dry run by default: the plan is made inside a READ ONLY transaction that is rolled
 * back, so nothing is written; `apply` writes the same plan in one transaction and is idempotent (a second run finds
 * nothing left). Output never holds a token hash. v6.1.21: `--reflag` re-evaluates every person's reason (the env lists
 * reach people that already exist, I1) and `--unflag <person key>` clears one by hand (I2). The env lists are read from
 * the environment of the shell that runs the script, never from Railway's: export them first.
 */
import { type Db, sql } from '../v5/db';
import { type TestFlag, UNFLAGGED, clientNameReason, envListReason, reasonRank } from './people';

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
    // M4 (v6.1.21): the env lists see proven identities only (the builder's login, a legacy X sign-in), never a claimed
    // repo owner or a legacy unproven GitHub login. I2: a builder's person takes no client-name reason.
    g.flag ??= envListReason({ githubLogin: i.login, xHandle: prof?.x_user_id ? prof.x_handle : null, installationId: i.id }, env) ?? (i.builder_id == null ? clientNameReason(i.client_name) : null);
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
    if (g.flag) await tx`UPDATE people SET test_reason = ${g.flag.reason}, test_reason_source = ${g.flag.source} WHERE id = ${id} AND test_reason IS NULL AND test_reason_source IS DISTINCT FROM ${UNFLAGGED}`;
    await tx`UPDATE installations SET person_id = ${id} WHERE id = ANY(${g.installs}) AND person_id IS NULL`;
  }
}

class DryRun extends Error {}

export type Reflag = { person: number; person_key: string; from: string | null; to: string; source: string };

/**
 * I1 (v6.1.21): what every person's `test_reason` would be from the env lists and the client-name patterns now. The env
 * lists see proven identities only (the builder's login, a legacy X sign-in) and every installation id; client names
 * count only for a person without a builder. A reason is never cleared here and only a stronger one replaces it (owner
 * over dogfood over test, persona and repro); a person unflagged by hand is left alone. Reads only.
 */
export async function reflagPlan(db: Db, env: Record<string, string | undefined> = process.env): Promise<Reflag[]> {
  const rows = await db<{ id: number; builder_id: number | null; test_reason: string | null; test_reason_source: string | null; login: string | null; x_handle: string | null; x_user_id: string | null; ids: number[]; names: (string | null)[] }[]>`
    SELECT p.id, p.builder_id, p.test_reason, p.test_reason_source, b.login, p.x_handle, p.x_user_id,
      COALESCE(array_agg(i.id ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), ARRAY[]::int[]) AS ids,
      COALESCE(array_agg(i.client_name ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), ARRAY[]::text[]) AS names
    FROM people p LEFT JOIN builders b ON b.id = p.builder_id LEFT JOIN installations i ON i.person_id = p.id
    GROUP BY p.id, b.login ORDER BY p.id`;
  const out: Reflag[] = [];
  for (const r of rows) {
    if (r.test_reason_source === UNFLAGGED) continue;
    const flag: TestFlag | null =
      envListReason({ githubLogin: r.login, xHandle: r.x_user_id ? r.x_handle : null, installationIds: r.ids }, env) ??
      (r.builder_id == null ? (r.names.map(clientNameReason).find(Boolean) ?? null) : null);
    if (!flag || reasonRank(flag.reason) <= reasonRank(r.test_reason)) continue;
    out.push({ person: r.id, person_key: r.builder_id != null ? `b:${r.builder_id}` : r.ids.length ? `i:${r.ids[0]}` : `p:${r.id}`, from: r.test_reason, to: flag.reason, source: flag.source });
  }
  return out;
}

/** The person a key names: `b:<builder id>`, `i:<installation id>` (that installation's person) or `p:<people id>`. */
export async function personOfKey(db: Db, key: string): Promise<number | null> {
  const m = /^([bip]):(\d+)$/.exec(key.trim());
  if (!m) throw new Error('--unflag takes a person key: b:<builder id>, i:<installation id> or p:<person id>');
  const n = Number(m[2]);
  const [r] =
    m[1] === 'b' ? await db<{ id: number }[]>`SELECT id FROM people WHERE builder_id = ${n}`
    : m[1] === 'i' ? await db<{ id: number }[]>`SELECT person_id AS id FROM installations WHERE id = ${n} AND person_id IS NOT NULL`
    : await db<{ id: number }[]>`SELECT id FROM people WHERE id = ${n}`;
  return r?.id ?? null;
}

/** Runs `fn` in a transaction that writes only with `apply`; a dry run is READ ONLY and rolled back. */
async function inMode<T>(apply: boolean, fn: (tx: Db) => Promise<T>): Promise<T> {
  let result!: T;
  if (apply) {
    await sql().begin(async (tx) => {
      result = await fn(tx);
    });
    return result;
  }
  await sql().begin('read only', async (tx) => {
    result = await fn(tx);
    throw new DryRun();
  }).catch((e) => {
    if (!(e instanceof DryRun)) throw e;
  });
  return result;
}

/** Which env lists the running shell has (names and entry counts only): the backfill never sees Railway's variables. */
const listsSet = (env: Record<string, string | undefined>) =>
  Object.fromEntries(['EARNKIT_OWNER_LOGINS', 'EARNKIT_DOGFOOD_LOGINS', 'EARNKIT_TEST_INSTALLATIONS'].map((k) => [k, (env[k] ?? '').split(',').filter((s) => s.trim()).length]));

/**
 * The CLI: `[--apply] [--since YYYY-MM-DD]` backfills; `--reflag [--apply]` re-evaluates every person's reason (I1);
 * `--unflag <person key> [--apply]` clears one person's reason by hand (I2). Dry run unless --apply. The env lists are
 * read from this process's environment: export them in the shell that runs the script.
 */
export async function main(argv: string[], out: (s: string) => void = console.log, env: Record<string, string | undefined> = process.env): Promise<unknown> {
  const apply = argv.includes('--apply');
  const mode = apply ? 'apply' : 'dry-run';
  if (argv.includes('--reflag')) {
    const changes = await inMode(apply, async (tx) => {
      const c = await reflagPlan(tx, env);
      if (apply) for (const r of c) await tx`UPDATE people SET test_reason = ${r.to}, test_reason_source = ${r.source} WHERE id = ${r.person}`;
      return c;
    });
    out(JSON.stringify({ mode, reflag: changes.length, env_lists: listsSet(env) }, null, 2));
    for (const c of changes) out(JSON.stringify(c));
    return changes;
  }
  const u = argv.indexOf('--unflag');
  if (u >= 0) {
    const key = argv[u + 1] ?? '';
    const person = await inMode(apply, async (tx) => {
      const id = await personOfKey(tx, key);
      if (apply && id != null) await tx`UPDATE people SET test_reason = NULL, test_reason_source = ${UNFLAGGED} WHERE id = ${id}`;
      return id;
    });
    if (person == null) throw new Error(`no person for ${key}`);
    out(JSON.stringify({ mode, unflag: key, person }));
    return { person };
  }
  return run(argv, out, env);
}

/** The backfill: `[--apply] [--since YYYY-MM-DD]`. Prints the JSON summary and one line per installation (in the report's range). */
export async function run(argv: string[], out: (s: string) => void = console.log, env: Record<string, string | undefined> = process.env): Promise<Plan> {
  const apply = argv.includes('--apply');
  const at = argv.indexOf('--since');
  const since = at >= 0 ? argv[at + 1] : undefined;
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since takes a date, YYYY-MM-DD');
  // A dry run is READ ONLY, then rolled back: it can never write.
  const result = await inMode(apply, async (tx) => {
    const p = await plan(tx, since, env);
    if (apply) await applyPlan(tx, p);
    return p;
  });
  out(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', env_lists: listsSet(env), ...result.summary }, null, 2));
  const from = since ? new Date(since) : null;
  for (const l of result.lines) if (!from || new Date(l.created_at) >= from) out(JSON.stringify(l));
  return result;
}
