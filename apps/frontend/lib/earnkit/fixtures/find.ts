import { randomBytes } from 'node:crypto';
import { sql } from '../db';
import { ProgramFile } from '../program-file';
import { upsertProgram } from '../programs';
import { committedProgram } from './program-file';
import { tools } from '../tools';
import { dropPrograms } from './programs-cleanup';
import { last52 } from '../weeks';

/**
 * find's test helpers (moved from v2121-find.test.ts, v2.13 F19): the env switch, a bare
 * installation, a person as Task 4's rescore leaves them, a copy of Avalanche Team1 Mini Grants and
 * a matcher's fit for it, and find through the real tool.
 */

export const NOW = new Date();
export const DAY = 86_400_000;
export const X_ON = { X_CLIENT_ID: 'v2121-x-id', X_CLIENT_SECRET: 'v2121-x-secret' };

export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const was: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export async function install(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-find-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  return id;
}

export type Seed = {
  key: string; name: string; what?: string | null; kind?: string; shipped?: boolean; confirmed?: boolean; people?: number; sends_tx?: boolean; untracked?: string | null;
  /** v2.13 (T4's columns). */
  weeks_shipping?: number; streak?: number;
  /** v3.1 streak fix: streak.ts reads commit_weeks, not the streak cache; default: `streak` weeks ending last week. */
  commit_weeks?: string[];
};
/** The `n` week keys ending with last week (a run `streak.ts` counts as n, this week or not). */
export const weeksEndingLast = (n: number): string[] => last52(NOW).slice(51 - n, 51);
const REPO = /^[a-z0-9-]+\/[a-z0-9._-]+$/;

/**
 * A person as Task 4's rescore leaves them: a profile, a live row (refreshed just now) and their
 * projects. v2.13: `main` is the one project (main_project_key); `claimed` binds that X handle; a
 * confirmed project keyed by a GitHub repo also gets its verified repo source (the Bench's confirmed).
 */
export async function person(o: {
  projects: Seed[]; score?: number; ranked?: boolean; seen?: Record<string, unknown>; main?: string; claimed?: string;
  /** v3.1 wallet proof: true leaves the optional wallet step to be offered; by default it was offered already (wallet_asked). */
  walletStep?: boolean;
}): Promise<number> {
  const id = await install();
  const seen = { ...(o.walletStep ? {} : { wallet_asked: NOW.toISOString() }), ...(o.seen ?? {}) };
  await sql()`
    INSERT INTO builder_profiles (builder_id, slug, standing_seen, main_project_key, x_user_id, x_handle)
    VALUES (${id}, ${`v2121f-${id}`}, ${sql().json(seen as never)}, ${o.main ?? null}, ${o.claimed ? `x${id}` : null}, ${o.claimed ?? null})`;
  await sql()`
    INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
    VALUES (${id}, ${o.score ?? 0}, ${sql().json({ shipping: { points: o.score ?? 0, raw: { mask: 0, live_ships: 0 } } } as never)}, ${o.ranked ?? false},
      ${o.projects.filter((p) => p.shipped !== false).length}, 0, 'v2', 'v2-shipping', now(), now())`;
  for (const [i, p] of o.projects.entries()) {
    await sql()`
      INSERT INTO builder_projects (builder_id, project_key, name, what, link, kind, confirmed, shipped, people, sends_tx, untracked_contract, last_active_at, weeks_shipping, streak, commit_weeks)
      VALUES (${id}, ${p.key}, ${p.name}, ${p.what ?? null}, null, ${p.kind ?? 'app'}, ${p.confirmed ?? false}, ${p.shipped ?? true}, ${p.people ?? 0},
        ${p.sends_tx ?? false}, ${p.untracked ?? null}, ${new Date(NOW.getTime() - i * DAY)}, ${p.weeks_shipping ?? 0}, ${p.streak ?? 0}, ${p.commit_weeks ?? weeksEndingLast(p.streak ?? 0)})`;
    if (o.main && p.confirmed && REPO.test(p.key) && p.key === o.main)
      await sql()`
        INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
        VALUES (${id}, 'repo', ${p.key}, ${p.key}, 'proof_line', 'verified', 'agent', now())`;
  }
  return id;
}

export { dropPrograms, dropRunPrograms } from './programs-cleanup';

/** A program the target user's tip jar fits (a copy of Avalanche Team1 Mini Grants: up to $10K, rolling). Call dropAvalanche in the file's after hook. */
let program: { id: string; title: string } | null = null;
export async function avalanche() {
  if (program) return program;
  const p = { ...committedProgram('avalanche-team1-mini-grants'), id: `v2121-ava-${randomBytes(4).toString('hex')}`, status: 'active' };
  await upsertProgram(ProgramFile.parse(p));
  program = { id: p.id, title: p.title };
  return program;
}
/** Removes this file's avalanche() copy (fix round 1: copies never pile up across runs). */
export async function dropAvalanche(): Promise<void> {
  if (program) await dropPrograms([program.id]);
  program = null;
}
export const GOOD = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };
/** The matcher's one fit: `key`'s repo is likely for the program (v2.13: any repo key; lee/tipjar is "TipJar"). */
export const fitsFor = (programId: string, key = 'lee/tipjar') => [
  {
    repo: key === 'lee/tipjar' ? 'TipJar' : key.split('/')[1], repo_url: `https://github.com/${key}`, key,
    verdicts: [{ program_id: programId, program: programId, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }],
    product: GOOD,
  },
];

export type Found = {
  programs: { title: string }[]; show_to_builder: string; move_up?: { kind: string; project_key: string | null; agent_note?: string };
  lead?: { program_id: string }; note: string;
  proof?: { line?: string; sign_in?: string }; schedule_daily_check?: string; schedule_weekly_update?: string;
  build_offer?: { program_id: string; starter_id: string }; rank_lines?: string[]; streak?: number;
};
export const find = (id: number, input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  tools.find(input, { installationId: id, ...extra } as never) as Promise<Found>;

/**
 * A person signed in with X (a unique X account, as x-install.ts bindX writes it), for tests of what a page
 * signed in with X sees.
 */
export async function claimX(id: number): Promise<string> {
  const { bindX } = await import('../x-install');
  const { ensureProfile } = await import('../profiles');
  await ensureProfile(id, new Date());
  const tag = randomBytes(5).toString('hex');
  const r = await bindX(id, { id: `fx${tag}`, username: `fx_${tag}`, name: 'Builder', avatar: null }, new Date());
  if (!r.ok) throw new Error(`claimX: ${r.reason}`);
  return r.handle;
}
