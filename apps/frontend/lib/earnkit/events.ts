import { createPublicClient, http, isAddress, toEventSelector, toHex, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { githubRepo } from './campaigns';
import type { Chain } from './chains';
import { sql, type Db } from './db';
import { hasCode, rpcFor, txCount, type CheckDeps } from './verify';

/**
 * v2.11 spec 6: the builder event log. Append-only (a trigger refuses UPDATE, DELETE and TRUNCATE;
 * see db/schema.sql), idempotent by dedupe_key, and never in the way: a failed write is logged by
 * error class only and the builder's step goes on.
 *
 * Off until EARNKIT_EVENT_LOG=on. The owner turns it on only after the /terms "What EarnKit
 * records" section is live (v2.11 T12), so no row is written in production before it is disclosed.
 */
export const EVENT_LOG_FLAG = 'EARNKIT_EVENT_LOG';
export const eventLogEnabled = () => process.env[EVENT_LOG_FLAG] === 'on';

export const EVENT_TYPES = ['built', 'deployed', 'hosted', 'entered', 'submitted', 'won', 'lost', 'usage_check'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const LOGIN_BASES = ['signin', 'app', 'proof_line', 'repo_owner'] as const;
export type LoginBasis = (typeof LOGIN_BASES)[number];

/** detail over this many bytes of JSON is stored as { truncated: true }. */
export const DETAIL_MAX_BYTES = 2048;

const text = (max: number) => z.string().min(1).max(max);
const int4 = z.number().int().min(1).max(2147483647);
const Event = z.strictObject({
  type: z.enum(EVENT_TYPES),
  dedupe_key: text(2100), // hosted:gh:<url> holds a whole URL; still under the btree limit
  github_login: text(100).optional(),
  login_basis: z.enum(LOGIN_BASES).optional(),
  installation_id: int4.optional(),
  wallet: text(100).optional(),
  repo_key: text(300).optional(),
  program_id: text(200).optional(),
  project_id: int4.optional(),
  chain: text(50).optional(),
  proof_tx: text(200).optional(),
  proof_url: text(2048).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
  /** When it happened, for the backfill (spec 6); a live write leaves it out and gets now(). */
  at: z.date().optional(),
});
export type BuilderEvent = z.infer<typeof Event>;

const errName = (err: unknown) => (err instanceof Error ? err.name : 'error');

/** Writes one event. True when a row was written; false when off, a duplicate, invalid or failed. */
export async function recordEvent(e: BuilderEvent, db?: Db): Promise<boolean> {
  if (!eventLogEnabled()) return false;
  const parsed = Event.safeParse(e);
  if (!parsed.success) {
    const type = EVENT_TYPES.includes(e?.type as EventType) ? e.type : 'invalid';
    console.error(`[events] ${type} ZodError`);
    return false;
  }
  const v = parsed.data;
  let detail: Record<string, unknown> = v.detail ?? {};
  try {
    if (Buffer.byteLength(JSON.stringify(detail), 'utf8') > DETAIL_MAX_BYTES) detail = { truncated: true };
  } catch {
    detail = { truncated: true }; // not serializable (a cycle or a bigint)
  }
  const low = (s: string | undefined) => (s === undefined ? null : s.toLowerCase());
  try {
    const q = db ?? sql();
    const rows = await q`
      INSERT INTO builder_events (at, type, github_login, login_basis, installation_id, wallet, repo_key, program_id,
        project_id, chain, proof_tx, proof_url, detail, dedupe_key)
      VALUES (coalesce(${v.at ?? null}::timestamptz, now()), ${v.type}, ${low(v.github_login)}, ${v.login_basis ?? null}, ${v.installation_id ?? null}, ${low(v.wallet)},
        ${low(v.repo_key)}, ${v.program_id ?? null}, ${v.project_id ?? null}, ${v.chain ?? null}, ${v.proof_tx ?? null},
        ${v.proof_url ?? null}, ${q.json(detail as Parameters<typeof q.json>[0])}, ${v.dedupe_key})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id`;
    return rows.length === 1;
  } catch (err) {
    console.error(`[events] ${v.type} ${errName(err)}`);
    return false;
  }
}

/** The event log's repo key ("owner/repo", lowercase) of a GitHub link, or undefined. Pure. */
export function eventRepoKey(url: string | null | undefined): string | undefined {
  const gh = url ? githubRepo(url) : null;
  return gh ? `${gh.owner}/${gh.repo}`.toLowerCase() : undefined;
}

/**
 * v2.11 T3 review M7: a link the builder gave, as the log keeps it: no query string and no
 * fragment (a form's response-edit token can ride there). Undefined when it isn't an http(s) link. Pure.
 */
export function proofLink(url: string | null | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  u.search = '';
  u.hash = '';
  u.username = '';
  u.password = '';
  return u.toString();
}

/** How long a step waits on its event before it answers; a slower write finishes in the background. */
export const EVENT_WAIT_MS = 1000;

let testDb: Db | null = null;
/** Test seam (v2.11 T3, 3.6): noteEvent writes go to `db` (a failing fake, say); null restores sql(). */
export function eventDbForTests(db: Db | null) {
  testDb = db;
}

/**
 * v2.11 T3: a shipped step's event. `build` runs only while the log is on (so an off log costs no
 * read), and may return null (nothing to write). Never throws and never holds the step up for more
 * than EVENT_WAIT_MS: a failure, building or writing, logs `[events] <type> <ErrorName>` only.
 */
export async function noteEvent(type: EventType, build: () => Promise<BuilderEvent | null> | BuilderEvent | null): Promise<void> {
  if (!eventLogEnabled()) return;
  const write = (async () => {
    const e = await build();
    if (e) await recordEvent(e, testDb ?? undefined);
  })().catch((err: unknown) => console.error(`[events] ${type} ${errName(err)}`));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, EVENT_WAIT_MS);
    timer.unref?.();
  });
  await Promise.race([write, wait]);
  clearTimeout(timer);
}

// ---- v2.11 T11 (spec 7, plan S12): usage checks at 30 and 90 days, inside the daily cron.

/** The windows, in days after the deploy. */
export const USAGE_WINDOWS = [30, 90] as const;
/** At most this many checks a cron run (spec 7). */
export const USAGE_LIMIT = 20;
/**
 * Blocks per eth_getLogs call on Arc. rpc.mainnet.arc.io (2026-10-10, T11 run): a 10,000-block range
 * (from and to inclusive) is answered, 10,001 is refused with -32012 "requested range too large".
 * No rate limit is stated in docs.arc.io; the calls go one at a time, never retried within a run.
 */
export const ARC_LOG_CHUNK = 10_000n;
/**
 * Chunks one check may read (S12). Arc makes about 2 blocks a second (1,000,000 blocks took 507,649 s
 * on 2026-10-10), so 50 chunks cover about the first 2.9 days after the deploy; a check whose range
 * goes past that writes `partial: true` with the blocks it did read.
 */
export const ARC_LOG_MAX_CHUNKS = 50;
/**
 * The event that counts as use, per starter (spec 2 `usage_event`). From the chain-kits
 * `arc/example/src/UsdcTipJar.sol`: `event Tipped(address indexed from, uint256 amount, string note)`.
 * T5's STARTERS registry carries the same field; a deploy names its starter in `detail.starter`.
 */
export const STARTER_USAGE_EVENTS: Record<string, string> = { 'arc-tipjar': 'Tipped(address,uint256,string)' };

/** An event signature's topic 0. Pure. */
export const usageTopic = (signature: string): Hex => toEventSelector(signature);

/**
 * The eth_getLogs ranges from `from` to `head` (both inclusive), ARC_LOG_CHUNK blocks each, at most
 * ARC_LOG_MAX_CHUNKS; `partial` when blocks are left over. Pure.
 */
export function logChunks(from: bigint, head: bigint, size = ARC_LOG_CHUNK, max = ARC_LOG_MAX_CHUNKS) {
  const ranges: [bigint, bigint][] = [];
  let start = from;
  while (start <= head && ranges.length < max) {
    const end = start + size - 1n < head ? start + size - 1n : head;
    ranges.push([start, end]);
    start = end + 1n;
  }
  return { ranges, partial: start <= head };
}

export type UsageDeps = {
  /** Checks a run (default USAGE_LIMIT). */
  limit?: number;
  /** Tests and the e2e: only these deployed event ids. */
  only?: string[];
  /** No new check starts after this time (ms; the cron's budget). */
  deadline?: number;
  /** Test seam: the selection and writes go here. */
  db?: Db;
  /** Blockscout counters read (verify.ts txCount's seam). */
  blockscout?: CheckDeps['blockscout'];
  /** eth_getCode on `chain`. */
  getCode?: (chain: Chain, address: string) => Promise<string>;
  /** Arc's latest block. */
  arcHead?: () => Promise<bigint>;
  /** One eth_getLogs chunk on Arc: how many logs, and each log's sender (its first indexed address). */
  arcLogs?: (address: string, topic: Hex, from: bigint, to: bigint) => Promise<{ count: number; senders: string[] }>;
  /** A pre-v2.11 deploy's block, from its transaction receipt (null when there is none). */
  receiptBlock?: (chain: Chain, tx: string) => Promise<bigint | null>;
};

/** A log's sender: its first indexed argument as an address (Tipped's `from`), or null. Pure. */
export function logSender(topics: readonly (string | null)[]): string | null {
  const t = topics[1];
  return t && /^0x0{24}[0-9a-fA-F]{40}$/.test(t) ? `0x${t.slice(26).toLowerCase()}` : null;
}

/** A read-only client on the chain's public RPC: no key, a 10 s timeout, no retry (spec 7: the next run retries). */
const readClient = (chain: Chain) => {
  const rpc = rpcFor(chain);
  if (!rpc) throw new Error(`no RPC for ${chain}`);
  return createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 0 }) });
};

const defaultReads: Required<Pick<UsageDeps, 'getCode' | 'arcHead' | 'arcLogs' | 'receiptBlock'>> = {
  getCode: async (chain, address) => (await readClient(chain).getCode({ address: address as Address })) ?? '0x',
  arcHead: () => readClient('arc').getBlockNumber({ cacheTime: 0 }),
  arcLogs: async (address, topic, from, to) => {
    const logs = await readClient('arc').request({
      method: 'eth_getLogs',
      params: [{ address: address as Address, topics: [topic], fromBlock: toHex(from), toBlock: toHex(to) }],
    });
    return { count: logs.length, senders: logs.map((l) => logSender(l.topics)).filter((a): a is string => a !== null) };
  },
  receiptBlock: async (chain, tx) => (await readClient(chain).getTransactionReceipt({ hash: tx as Hex })).blockNumber ?? null,
};

type DueDeploy = {
  id: string;
  win: number;
  /** The selection keeps arc and base only (the chains EarnKit deploys on). */
  chain: 'arc' | 'base';
  proof_tx: string | null;
  detail: Record<string, unknown>;
  installation_id: number | null;
  repo_key: string | null;
  wallet: string | null;
  github_login: string | null;
  login_basis: LoginBasis | null;
  program_id: string | null;
  project_id: number | null;
};

/** One check's detail, or throws when a read fails (nothing is written then). */
async function readUsage(d: DueDeploy, address: string, now: Date, deps: UsageDeps): Promise<Record<string, unknown>> {
  const chain = d.chain;
  const getCode = deps.getCode ?? defaultReads.getCode;
  const code = hasCode(await getCode(chain, address));
  const base = { window: d.win, deployed_event: Number(d.id), address };
  if (chain === 'base') {
    // v2.10's Blockscout counters (cached 24 h in url_checks); null is a failed read.
    const tx = await txCount('base', address, { now, ...(deps.blockscout && { blockscout: deps.blockscout }) });
    if (tx === null) throw new Error('no count');
    return { ...base, tx_count: tx, code, source: 'blockscout' };
  }
  const signature = chain === 'arc' && typeof d.detail.starter === 'string' ? STARTER_USAGE_EVENTS[d.detail.starter] : undefined;
  if (!signature) return { ...base, code, source: 'rpc_code' };
  // explorer.arc.io's API is behind a Cloudflare challenge: count the starter's logs over the public RPC.
  const known = d.detail.block;
  let from: bigint | null =
    typeof known === 'number' && Number.isSafeInteger(known) && known >= 0 ? BigInt(known) : null;
  if (from === null) {
    // Pre-v2.11 rows have no block: read it from the deploy's receipt.
    if (!d.proof_tx) throw new Error('no deploy tx');
    from = await (deps.receiptBlock ?? defaultReads.receiptBlock)(chain, d.proof_tx);
    if (from === null) throw new Error('no deploy block');
  }
  const head = await (deps.arcHead ?? defaultReads.arcHead)();
  const { ranges, partial } = logChunks(from, head);
  const topic = usageTopic(signature);
  const arcLogs = deps.arcLogs ?? defaultReads.arcLogs;
  let events = 0;
  const senders = new Set<string>();
  let read = 0;
  for (const [lo, hi] of ranges) {
    // Past the cron's deadline, the blocks read so far are written as a partial count.
    if (read > 0 && deps.deadline !== undefined && Date.now() >= deps.deadline) break;
    const r = await arcLogs(address, topic, lo, hi);
    events += r.count;
    for (const s of r.senders) senders.add(s.toLowerCase());
    read++;
  }
  const to = read > 0 ? ranges[read - 1][1] : head;
  return {
    ...base,
    events,
    senders: senders.size,
    from_block: Number(from),
    to_block: Number(to),
    ...((partial || read < ranges.length) && { partial: true }),
    code,
    source: 'rpc_logs',
  };
}

/**
 * v2.11 T11 (spec 7): for `deployed` events whose age has passed 30 (or 90) days with no usage_check
 * for that window yet, oldest first, at most `limit` a run, reads whether the contract is still
 * there and how much it was used, and writes one `usage_check` (dedupe_key
 * `usage:<deployed event id>:<window>`). A deploy past 90 days gets only its 90-day check. A
 * code_differs deploy (the builder was told not to use it) is never checked. Off with the log off
 * (no read, no write). A failed read writes nothing, counts as failed and is read again next run;
 * nothing here ever throws.
 */
export async function usageChecks(now: Date, deps: UsageDeps = {}): Promise<{ checked: number; failed: number }> {
  const out = { checked: 0, failed: 0 };
  if (!eventLogEnabled()) return out;
  const [w30, w90] = USAGE_WINDOWS;
  const limit = Math.max(0, Math.min(deps.limit ?? USAGE_LIMIT, USAGE_LIMIT));
  let due: DueDeploy[];
  try {
    const q = deps.db ?? sql();
    const t30 = new Date(now.getTime() - w30 * 86_400_000);
    const t90 = new Date(now.getTime() - w90 * 86_400_000);
    due = [
      ...(await q<DueDeploy[]>`
        SELECT d.id::text AS id, d.win, d.chain, d.proof_tx, d.detail, d.installation_id, d.repo_key, d.wallet,
          d.github_login, d.login_basis, d.program_id, d.project_id
        FROM (
          SELECT e.*, CASE WHEN e.at <= ${t90} THEN ${w90}::int ELSE ${w30}::int END AS win
          FROM builder_events e
          WHERE e.type = 'deployed' AND e.at <= ${t30} AND e.chain IN ('arc', 'base')
            AND e.detail ? 'address' AND coalesce(e.detail->>'code_differs', 'false') <> 'true'
            AND (${deps.only ?? null}::bigint[] IS NULL OR e.id = ANY(${deps.only ?? null}::bigint[]))
        ) d
        WHERE NOT EXISTS (SELECT 1 FROM builder_events u WHERE u.dedupe_key = 'usage:' || d.id || ':' || d.win)
        ORDER BY d.at, d.id
        LIMIT ${limit}`),
    ];
  } catch (err) {
    console.error(`[events] usage_check ${errName(err)}`);
    out.failed++;
    return out;
  }
  for (const d of due) {
    if (deps.deadline !== undefined && Date.now() >= deps.deadline) break;
    const address = typeof d.detail.address === 'string' ? d.detail.address.toLowerCase() : '';
    try {
      if (!isAddress(address, { strict: false })) throw new Error('not an address');
      const detail = await readUsage(d, address, now, deps);
      const wrote = await recordEvent(
        {
          type: 'usage_check',
          dedupe_key: `usage:${d.id}:${d.win}`,
          at: now,
          chain: d.chain,
          ...(d.installation_id !== null && { installation_id: d.installation_id }),
          ...(d.repo_key && { repo_key: d.repo_key }),
          ...(d.wallet && { wallet: d.wallet }),
          ...(d.github_login && d.login_basis && { github_login: d.github_login, login_basis: d.login_basis }),
          ...(d.program_id && { program_id: d.program_id }),
          ...(d.project_id !== null && { project_id: d.project_id }),
          detail,
        },
        deps.db,
      );
      if (wrote) out.checked++;
    } catch (err) {
      console.error(`[events] usage_check ${errName(err)}`);
      out.failed++;
    }
  }
  return out;
}
