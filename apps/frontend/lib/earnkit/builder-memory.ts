import { z } from 'zod';
import { githubRepo } from './campaigns';
import { CHAINS, type Chain } from './chains';
import { sql, type Db } from './db';
import { repoKey } from './answer-bank';
import { reportedChains, reportedUrl } from './match-projects';
import { outcomeEvent, saveSelfReport, type OutcomeEventInput } from './outcomes';
import { NotFoundError } from './programs';

/**
 * v2.9 A3: builder memory. What the builder told EarnKit through tell_earnkit, about programs
 * (applied outside EarnKit, not interested, and their own outcomes) and repos (mainnet or testnet
 * chains, a live link, users, not theirs). Read once per list_programs (readMemory). A statement
 * that lowers eligibility always wins; one that raises it is a claim (match.ts applyBuilderFacts).
 */

const ITEMS = 20;

/** Chains as an agent passes them (`"arc"`, `"Base Sepolia"`, 8453, `{ chain, mainnet }`); unknown ones dropped. */
const Chains = z
  .array(z.unknown())
  .max(ITEMS)
  .transform((items) => reportedChains(items));

/**
 * What the builder says about a program. v3 Stage 2: `accepted`, `funded` and `rejected` are an application's outcome,
 * stored as `applied` is (builder_program_status, hidden as applied is); a self-report, never public, never on a page.
 * `won`, `placed` and `lost` are an entry's outcome (entry_outcomes).
 */
export const PROGRAM_STATUSES = ['applied', 'not_interested', 'accepted', 'funded', 'rejected', 'won', 'placed', 'lost'] as const;
/** The statuses kept in builder_program_status (the builder's memory), as its CHECK allows. */
export const MEMORY_STATUSES = ['applied', 'not_interested', 'accepted', 'funded', 'rejected'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
const isMemory = (s: string): s is MemoryStatus => (MEMORY_STATUSES as readonly string[]).includes(s);

const ProgramStatus = z
  .object({
    program_id: z.string().trim().min(1).max(100),
    status: z.enum(PROGRAM_STATUSES),
    /** For won, placed and lost: the entry; else the installation's newest entry in the program. */
    project_id: z.number().int().positive().optional(),
    prize_usd: z.number().nonnegative().optional(),
    /**
     * v3.1 one-tap posts (owner ruling 3): for accepted, funded or won, the public page the agent checked that shows it
     * (post-moments.ts proofUrlOk decides; never stored in the builder's memory).
     */
    proof_url: z.string().max(2048).optional(),
  })
  .strict();

const RepoFact = z
  .object({
    /** "owner/repo", a github.com link, or the repo's name. */
    repo: z.string().trim().min(1).max(300),
    mainnet_chains: Chains.optional(),
    testnet_chains: Chains.optional(),
    /** A placeholder or unreadable link is dropped (match-projects.ts reportedUrl), never an error. */
    live_url: z
      .string()
      .max(300)
      .optional()
      .transform((u) => reportedUrl(u)),
    has_users: z.boolean().optional(),
    not_mine: z.boolean().optional(),
  })
  .strict();

/** v2.9 A3 (plan Ruling 3): tell_earnkit's input. */
export const TellInput = z
  .object({
    program_status: z.array(ProgramStatus).max(ITEMS).optional(),
    repo_facts: z.array(RepoFact).max(ITEMS).optional(),
    /** v2.9 E19 (Ruling 13): the answer to the weekly email question, and the address if they gave one. */
    weekly_email: z
      .object({
        answer: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['yes', 'no'])),
        email: z.string().max(320).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((i) => (i.program_status?.length ?? 0) + (i.repo_facts?.length ?? 0) > 0 || i.weekly_email !== undefined, {
    message: 'Pass at least one program_status, repo_facts or weekly_email item.',
  });
export type TellInput = z.input<typeof TellInput>;

/** What the builder said about one repo. */
export type SaidRepo = { mainnet: Chain[]; testnet: Chain[]; live_url: string | null; has_users: boolean | null; not_mine: boolean };

export type BuilderMemory = {
  programs: Map<string, { status: MemoryStatus; round_label: string | null; at: Date }>;
  /** By repo key (answer-bank.ts repoKey: owner/repo or name:<name>). */
  repos: Map<string, SaidRepo>;
};

export const emptyMemory = (): BuilderMemory => ({ programs: new Map(), repos: new Map() });

/**
 * Whose memory: the installation, and the login within it ('' for the installation's own memory; a
 * GitHub-verified login on a shared client).
 */
export type MemoryKey = { installationId: number; login: string };

/**
 * Ruling G6: whose memory a call reads and writes. An installation's own; on a shared (hosted)
 * client, where one installation serves many builders, none, so nothing one builder says reaches
 * another (v2.14 final fix: the pasted GitHub sign-in code that named a login there is gone; rows
 * stored under a login stay as history).
 */
export function memoryKey(ctx: { installationId: number; sharedClient?: boolean }): MemoryKey | null {
  return ctx.sharedClient ? null : { installationId: ctx.installationId, login: '' };
}

/** An installation id is its own memory (login ''). Pure. */
const keyOf = (k: number | MemoryKey): MemoryKey => (typeof k === 'number' ? { installationId: k, login: '' } : k);

/** Ruling G6: a shared client's outcome must name its entry (the newest entry may be another builder's). */
export const OUTCOME_NEEDS_ENTRY = "Pass the entry's project_id (from ask_outcome) with won, placed or lost.";

/** A program's current round: `<starts_at ISO or ''>|<ends_at ISO or ''>` (plan Ruling 3). Pure. */
export function roundLabel(p: { starts_at: Date | null; ends_at: Date | null }): string {
  return `${p.starts_at?.toISOString() ?? ''}|${p.ends_at?.toISOString() ?? ''}`;
}

/**
 * The programs to leave out of everything the builder is shown: not interested, for good; applied
 * outside EarnKit (v3 Stage 2: or accepted, funded or rejected), until the program's round changes (its window moves, or it opened again after the
 * statement). Pure.
 */
export function hiddenPrograms(
  m: BuilderMemory,
  programs: { id: string; starts_at: Date | null; ends_at: Date | null; opened_at: Date | null }[],
): { notInterested: Set<string>; applied: Set<string> } {
  const notInterested = new Set<string>();
  const applied = new Set<string>();
  for (const p of programs) {
    const s = m.programs.get(p.id);
    if (!s) continue;
    if (s.status === 'not_interested') notInterested.add(p.id);
    else if (s.round_label === roundLabel(p) && !(p.opened_at && p.opened_at > s.at)) applied.add(p.id);
  }
  return { notInterested, applied };
}

/** Both sets as one: what the builder never sees in tables, offers or Also qualifies. Pure. */
export const hiddenIds = (h: { notInterested: Set<string>; applied: Set<string> }) => new Set([...h.notInterested, ...h.applied]);

/** The repo key a statement names: owner/repo for a GitHub repo, else name:<name>. Pure; exported for tests. */
export function saidKey(repo: string): string {
  const t = repo.trim();
  const gh = githubRepo(/^[\w.-]+\/[\w.-]+$/.test(t) ? `github.com/${t}` : t);
  return gh ? repoKey({ url: `https://github.com/${gh.owner}/${gh.repo}`, name: gh.repo }) : repoKey({ name: t });
}

const known = (chains: string[]): Chain[] => chains.filter((c): c is Chain => (CHAINS as readonly string[]).includes(c));

/** This installation's (or, on a shared client, this verified login's) memory: two reads on the tables' primary keys. */
export async function readMemory(key: number | MemoryKey): Promise<BuilderMemory> {
  const { installationId, login } = keyOf(key);
  const db = sql();
  const [programs, repos] = await Promise.all([
    db<{ program_id: string; status: MemoryStatus; round_label: string | null; at: Date }[]>`
      SELECT program_id, status, round_label, at FROM builder_program_status WHERE installation_id = ${installationId} AND login = ${login}`,
    db<{ repo_key: string; mainnet_chains: string[]; testnet_chains: string[]; live_url: string | null; has_users: boolean | null; not_mine: boolean }[]>`
      SELECT repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine
      FROM builder_repo_facts WHERE installation_id = ${installationId} AND login = ${login}`,
  ]);
  return {
    programs: new Map(programs.map((p) => [p.program_id, { status: p.status, round_label: p.round_label, at: p.at }])),
    repos: new Map(
      repos.map((r) => [
        r.repo_key,
        { mainnet: known(r.mainnet_chains), testnet: known(r.testnet_chains), live_url: r.live_url, has_users: r.has_users, not_mine: r.not_mine },
      ]),
    ),
  };
}

type Parsed = z.output<typeof TellInput>;
type ParsedRepo = NonNullable<Parsed['repo_facts']>[number];

/**
 * One statement over what was said before about the same repo: the latest statement about a chain
 * wins; within one statement, testnet wins over mainnet (lowering wins). Fields not given keep their
 * value. Pure; exported for tests.
 */
export function mergeSaid(old: SaidRepo | null, f: ParsedRepo): SaidRepo {
  const mainnet = new Set(old?.mainnet ?? []);
  const testnet = new Set(old?.testnet ?? []);
  const saysMainnet = (f.mainnet_chains ?? []).filter((c) => c.mainnet).map((c) => c.chain);
  const saysTestnet = [...(f.testnet_chains ?? []), ...(f.mainnet_chains ?? []).filter((c) => !c.mainnet)].map((c) => c.chain);
  for (const c of saysMainnet) {
    mainnet.add(c);
    testnet.delete(c);
  }
  for (const c of saysTestnet) {
    testnet.add(c);
    mainnet.delete(c);
  }
  return {
    mainnet: [...mainnet],
    testnet: [...testnet],
    live_url: f.live_url ?? old?.live_url ?? null,
    has_users: f.has_users ?? old?.has_users ?? null,
    not_mine: f.not_mine ?? old?.not_mine ?? false,
  };
}

/** What one repo statement saved, in short words for the agent. Pure. */
function repoWords(key: string, f: ParsedRepo): string {
  const parts = [
    f.mainnet_chains?.length ? `mainnet ${f.mainnet_chains.map((c) => c.chain).join(', ')}` : null,
    f.testnet_chains?.length ? `testnet ${f.testnet_chains.map((c) => c.chain).join(', ')}` : null,
    f.live_url ? `live link ${f.live_url}` : null,
    f.has_users === undefined ? null : f.has_users ? 'has users' : 'no users yet',
    f.not_mine === undefined ? null : f.not_mine ? 'not theirs' : 'theirs',
  ].filter(Boolean);
  return `${key}: ${parts.length ? parts.join('; ') : 'nothing new'}`;
}

const RESULT = { won: 'won', placed: 'placed', lost: 'not_selected' } as const;

/**
 * Stores what the builder said, all or nothing. Every program is checked first, and every outcome's
 * entry (the project_id given, else this installation's newest entry in that program): an unknown
 * program, or an entry that isn't this installation's, is a NotFoundError and nothing is stored.
 * Outcomes are self-reports (`lost` is `not_selected`): never public, never counted. `memory`
 * (memoryKey) null, Ruling G6: program and repo statements are not stored, and an outcome needs its
 * project_id. v2.9 B9: a verified login's key on a shared client stores them under that login (an
 * outcome still needs its project_id). `outcomes`: how many outcomes were stored.
 */
export async function tell(
  installationId: number,
  input: TellInput,
  now = new Date(),
  memoryArg: number | MemoryKey | null = installationId,
): Promise<{ saved: string[]; outcomes: number }> {
  const memory = memoryArg === null ? null : keyOf(memoryArg);
  const parsed = TellInput.parse(input);
  const statuses = parsed.program_status ?? [];
  const db = sql();
  const ids = [...new Set(statuses.map((s) => s.program_id))];
  const programs = ids.length
    ? await db<{ id: string; starts_at: Date | null; ends_at: Date | null }[]>`
        SELECT id, starts_at, ends_at FROM programs WHERE id = ANY(${ids})`
    : [];
  const byId = new Map(programs.map((p) => [p.id, p]));
  const outcomes: { program_id: string; project_id: number; status: keyof typeof RESULT; prize_usd?: number }[] = [];
  for (const s of statuses) {
    if (!byId.has(s.program_id)) throw new NotFoundError(`No program with id "${s.program_id}". Call find for current ids.`);
    if (isMemory(s.status)) continue;
    // A shared client (no key, or a verified login's key) names the entry: the newest may be another builder's.
    if ((memory === null || memory.login !== '') && !s.project_id) throw new NotFoundError(OUTCOME_NEEDS_ENTRY);
    const [entry] = s.project_id
      ? await db<{ id: number }[]>`
          SELECT id FROM projects WHERE id = ${s.project_id} AND installation_id = ${installationId} AND program_id = ${s.program_id}`
      : await db<{ id: number }[]>`
          SELECT id FROM projects WHERE installation_id = ${installationId} AND program_id = ${s.program_id}
          ORDER BY submitted_at DESC, id DESC LIMIT 1`;
    if (!entry)
      throw new NotFoundError(
        s.project_id ? `No entry ${s.project_id} in ${s.program_id} for this agent.` : `No entry in ${s.program_id} for this agent.`,
      );
    outcomes.push({ program_id: s.program_id, project_id: entry.id, status: s.status, prize_usd: s.prize_usd });
  }

  const saved: string[] = [];
  // v2.11 T3 review I1: the self-reports' events, written only after the transaction commits.
  const events: OutcomeEventInput[] = [];
  await db.begin(async (tx: Db) => {
    for (const s of memory === null ? [] : statuses) {
      if (!isMemory(s.status)) continue;
      const label = s.status === 'not_interested' ? null : roundLabel(byId.get(s.program_id)!);
      await tx`
        INSERT INTO builder_program_status (installation_id, login, program_id, status, round_label, at)
        VALUES (${memory!.installationId}, ${memory!.login}, ${s.program_id}, ${s.status}, ${label}, ${now})
        ON CONFLICT (installation_id, login, program_id) DO UPDATE SET
          status = EXCLUDED.status, round_label = EXCLUDED.round_label, at = EXCLUDED.at`;
      saved.push(`${s.program_id}: ${s.status === 'applied' ? 'applied outside EarnKit' : s.status === 'not_interested' ? 'not interested' : `${s.status} (their own report)`}`);
    }
    for (const o of outcomes) {
      events.push(await saveSelfReport(installationId, { project_id: o.project_id, result: RESULT[o.status], prize_usd: o.prize_usd }, tx));
      saved.push(`${o.program_id}: ${o.status} (their own report)`);
    }
    for (const f of memory === null ? [] : (parsed.repo_facts ?? [])) {
      const key = saidKey(f.repo);
      const [old] = await tx<{ mainnet_chains: string[]; testnet_chains: string[]; live_url: string | null; has_users: boolean | null; not_mine: boolean }[]>`
        SELECT mainnet_chains, testnet_chains, live_url, has_users, not_mine FROM builder_repo_facts
        WHERE installation_id = ${memory!.installationId} AND login = ${memory!.login} AND repo_key = ${key} FOR UPDATE`;
      const said = mergeSaid(
        old
          ? { mainnet: known(old.mainnet_chains), testnet: known(old.testnet_chains), live_url: old.live_url, has_users: old.has_users, not_mine: old.not_mine }
          : null,
        f,
      );
      await tx`
        INSERT INTO builder_repo_facts (installation_id, login, repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine, at)
        VALUES (${memory!.installationId}, ${memory!.login}, ${key}, ${said.mainnet}, ${said.testnet}, ${said.live_url}, ${said.has_users}, ${said.not_mine}, ${now})
        ON CONFLICT (installation_id, login, repo_key) DO UPDATE SET
          mainnet_chains = EXCLUDED.mainnet_chains, testnet_chains = EXCLUDED.testnet_chains, live_url = EXCLUDED.live_url,
          has_users = EXCLUDED.has_users, not_mine = EXCLUDED.not_mine, at = EXCLUDED.at`;
      saved.push(repoWords(key, f));
    }
  });
  for (const e of events) await outcomeEvent(e);
  return { saved, outcomes: outcomes.length };
}
