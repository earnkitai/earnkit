import { createPublicClient, http, isAddress, toEventSelector, toHex, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { githubRepo } from './campaigns';
import type { Chain } from './chains';
import { sql, type Db } from './db';
import { STARTERS, type Starter } from './starters';
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

export const EVENT_TYPES = [
  'built', 'deployed', 'hosted', 'entered', 'submitted', 'won', 'lost', 'usage_check',
  // v2.12 spec 10: the builder score's steps.
  'source_proposed', 'source_verified', 'source_rejected', 'reading_taken', 'score_computed', 'score_held',
  'profile_empty', 'profile_hidden', 'profile_shown', 'card_offered', 'x_added', 'card_shared', 'score_viewed',
  // v2.12 T7 review: a shown X handle released (GitHub no longer lists it, or the owner cleared it).
  'x_cleared',
  // v2.12.1: identity given at find, the X claim and renames, proven wallets, on-demand refresh,
  // step 3 (use made countable, builder codes), step 3b (coin offered, answered), messages.
  'identity_given', 'page_claimed', 'x_renamed', 'wallet_proven', 'refreshed', 'use_tracked', 'builder_code_issued',
  'coin_offered', 'coin_answered', 'page_ready_shown', 'news_shown',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const LOGIN_BASES = ['signin', 'app', 'proof_line', 'repo_owner', 'x_match'] as const;
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

// ---- v2.11 T11 (spec 7, plan S12): usage checks at 30 and 90 days, inside the existing hourly cron
// (.github/workflows/earnkit-cron.yml, `15 * * * *`; no new schedule).

/** The windows, in days after the deploy. */
export const USAGE_WINDOWS = [30, 90] as const;
/** At most this many checks a cron run (spec 7). Checks, not reads: an Arc check makes up to 53 RPC calls (getCode, the view, head, 50 getLogs; a view_total starter usually 2), bounded by the cron's deadline. */
export const USAGE_LIMIT = 20;
/**
 * Blocks per eth_getLogs call on Arc. rpc.mainnet.arc.io (2026-10-10, T11 run): a 10,000-block range
 * (from and to inclusive) is answered, 10,001 is refused with -32012 "requested range too large".
 * No rate limit is stated in docs.arc.io; the calls go one at a time, never retried within a run.
 */
export const ARC_LOG_CHUNK = 10_000n;
/**
 * Chunks one Arc check reads (S12). Arc makes about 2 blocks a second (1,000,000 blocks took 507,649 s
 * on 2026-10-10), so 50 chunks are the last ~2.9 days before the check.
 */
export const ARC_LOG_MAX_CHUNKS = 50;

/**
 * How a deploy's use is read comes from its starter (`detail.starter`, starters.ts STARTERS):
 * - `view_total`: one eth_call of the starter's running-total view (`usage_view`; the arc-tipjar's
 *   `stats()`), exact since the deploy. A view that answers nothing (a builder who dropped it) falls
 *   back to the recent logs.
 * - `recent_logs`: a whole 30 or 90 days of Arc blocks is 510 to 1,530 eth_getLogs calls, so the check
 *   counts the usage event over the RECENT window (ARC_LOG_MAX_CHUNKS chunks ending at the head) and
 *   records it as `recent: { window: 'recent', blocks, tips, unique }`: "is it still used", never a
 *   30 or 90 day total.
 */
const starterOf = (id: unknown, starters: Record<string, Starter>): Starter | undefined =>
  typeof id === 'string' && Object.hasOwn(starters, id) ? starters[id] : undefined;

/**
 * A view's answer as its named uint256 words, exact (decimal strings), or null when it is shorter
 * than `words` (no such view) or not hex. Pure.
 */
export function viewTotals(data: Hex, words: readonly string[]): Record<string, string> | null {
  const hex = data.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length < 64 * words.length) return null;
  return Object.fromEntries(words.map((w, i) => [w, BigInt(`0x${hex.slice(64 * i, 64 * (i + 1))}`).toString()]));
}

/**
 * Review I1: an eth_call error that is the contract reverting (no such function, or a require),
 * never the transport. Walks viem's error causes: ContractFunctionRevertedError, a
 * CallExecutionError or RPC error that says "revert", or JSON-RPC code 3 (execution reverted).
 * HttpRequestError, TimeoutError and the rest are not reverts. Pure.
 */
export function isRevert(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    const x = e as { name?: string; message?: string; shortMessage?: string; details?: string; code?: number };
    if (x.name === 'HttpRequestError' || x.name === 'TimeoutError' || x.name === 'WebSocketRequestError') return false;
    if (x.name === 'ContractFunctionRevertedError' || x.name === 'ExecutionRevertedError') return true;
    if (x.code === 3) return true;
    const text = `${x.shortMessage ?? ''} ${x.details ?? ''} ${x.message ?? ''}`;
    if ((x.name === 'CallExecutionError' || x.code === -32000 || x.name === 'RpcRequestError') && /revert/i.test(text)) return true;
  }
  return false;
}

/** An event signature's topic 0. Pure. */
export const usageTopic = (signature: string): Hex => toEventSelector(signature);

/** The last `max` eth_getLogs ranges of `size` blocks ending at `head` (inclusive), oldest first, never below block 0. Pure. (readUsage reads them newest first.) */
export function recentChunks(head: bigint, size = ARC_LOG_CHUNK, max = ARC_LOG_MAX_CHUNKS): [bigint, bigint][] {
  const span = size * BigInt(max);
  let start = head + 1n > span ? head + 1n - span : 0n;
  const ranges: [bigint, bigint][] = [];
  while (start <= head) {
    const end = start + size - 1n < head ? start + size - 1n : head;
    ranges.push([start, end]);
    start = end + 1n;
  }
  return ranges;
}

/**
 * Concern 4 and review I1: the cron is hourly, so a failing deploy is tried at most once per
 * USAGE_RETRY_HOURS (5 failures in a row span about 4 days, not 5 hours); after USAGE_SKIP_AFTER
 * failures in a row it sits out USAGE_SKIP_DAYS from its last failure.
 */
export const USAGE_RETRY_HOURS = 20;
export const USAGE_SKIP_AFTER = 5;
export const USAGE_SKIP_DAYS = 7;

export type UsageDeps = {
  /** Checks a run (default USAGE_LIMIT). */
  limit?: number;
  /** Tests and the e2e: only these deployed event ids. */
  only?: string[];
  /** No new check starts after this time (ms; the cron's budget). */
  deadline?: number;
  /**
   * Test seam: the selection, the failure counter and the usage_check write go here. Not the Base
   * count's 24 h cache: verify.ts txCount keeps it in url_checks through sql() (review M7).
   */
  db?: Db;
  /** Blockscout counters read (verify.ts txCount's seam). */
  blockscout?: CheckDeps['blockscout'];
  /** eth_getCode on `chain`. */
  getCode?: (chain: Chain, address: string) => Promise<string>;
  /** Arc's latest block. */
  arcHead?: () => Promise<bigint>;
  /** One eth_getLogs chunk on Arc: how many logs, and each log's sender (its first indexed address). */
  arcLogs?: (address: string, topic: Hex, from: bigint, to: bigint) => Promise<{ count: number; senders: string[] }>;
  /** One eth_call on `chain` (a view_total starter's view); the answer's data, '0x' when empty. */
  viewCall?: (chain: Chain, to: string, data: Hex) => Promise<Hex>;
  /** Test seam: the starter registry (starters.ts STARTERS). */
  starters?: Record<string, Starter>;
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

const defaultReads: Required<Pick<UsageDeps, 'getCode' | 'arcHead' | 'arcLogs' | 'viewCall'>> = {
  getCode: async (chain, address) => (await readClient(chain).getCode({ address: address as Address })) ?? '0x',
  arcHead: () => readClient('arc').getBlockNumber({ cacheTime: 0 }),
  arcLogs: async (address, topic, from, to) => {
    const logs = await readClient('arc').request({
      method: 'eth_getLogs',
      params: [{ address: address as Address, topics: [topic], fromBlock: toHex(from), toBlock: toHex(to) }],
    });
    return { count: logs.length, senders: logs.map((l) => logSender(l.topics)).filter((a): a is string => a !== null) };
  },
  viewCall: async (chain, to, data) => (await readClient(chain).call({ to: to as Address, data })).data ?? '0x',
};

type DueDeploy = {
  id: string;
  win: number;
  /** The selection keeps arc and base only (the chains EarnKit deploys on). */
  chain: 'arc' | 'base';
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
  // `window` is the due window (30 or 90, the dedupe key's); it says when the check ran, not what a
  // count covers (Base's tx_count is lifetime, Arc's `recent` is ~2.9 days). Review M3.
  const base = { window: d.win, deployed_event: Number(d.id), address };
  if (chain === 'base') {
    // v2.10's Blockscout counters (cached 24 h in url_checks); null is a failed read.
    const tx = await txCount('base', address, { now, ...(deps.blockscout && { blockscout: deps.blockscout }) });
    if (tx === null) throw new Error('no count');
    // Review M2: Blockscout's transactions_count is the address's lifetime count (deploy to check),
    // not a 30 or 90 day count; tx_scope says so.
    return { ...base, tx_count: tx, tx_scope: 'lifetime', code, source: 'blockscout' };
  }
  const starter = chain === 'arc' ? starterOf(d.detail.starter, deps.starters ?? STARTERS) : undefined;
  // Review I1: no code at the address means no use to count: one read, never a view or log read.
  if (!starter || !code) return { ...base, code, source: 'rpc_code' };
  // R-T6: the starter's own running totals, one eth_call, exact since the deploy. A revert (the
  // builder's contract has no such view) or an empty answer (a fallback() that returns nothing)
  // falls back to the recent logs; a transport error is a failed read, retried as any other.
  if (starter.usage_read === 'view_total' && starter.usage_view) {
    const v = starter.usage_view;
    let data: Hex = '0x';
    try {
      data = await (deps.viewCall ?? defaultReads.viewCall)(chain, address, v.selector);
    } catch (err) {
      if (!isRevert(err)) throw err;
    }
    const totals = viewTotals(data, v.words);
    if (totals) return { ...base, code, source: 'rpc_view', totals };
  }
  // explorer.arc.io's API is behind a Cloudflare challenge: count the starter's logs over the public
  // RPC, in the recent window only. Checks are 30+ days after the deploy, so the window never reaches
  // back past it and the deploy block isn't needed.
  const head = await (deps.arcHead ?? defaultReads.arcHead)();
  const ranges = recentChunks(head);
  const topic = usageTopic(starter.usage_event);
  const arcLogs = deps.arcLogs ?? defaultReads.arcLogs;
  let tips = 0;
  const senders = new Set<string>();
  let read = 0;
  // Newest first (review M1): past the cron's deadline, the latest blocks read so far are written,
  // marked partial.
  const newest = [...ranges].reverse();
  for (const [lo, hi] of newest) {
    if (read > 0 && deps.deadline !== undefined && Date.now() >= deps.deadline) break;
    const r = await arcLogs(address, topic, lo, hi);
    tips += r.count;
    for (const s of r.senders) senders.add(s.toLowerCase());
    read++;
  }
  const lo = newest[read - 1][0];
  const hi = newest[0][1];
  return {
    ...base,
    code,
    source: 'rpc_logs',
    recent: {
      window: 'recent',
      blocks: Number(hi - lo + 1n),
      from_block: Number(lo),
      to_block: Number(hi),
      tips,
      unique: senders.size,
      ...(read < ranges.length && { partial: true }),
    },
  };
}

/**
 * v2.11 T11 (spec 7): for `deployed` events whose age has passed 30 (or 90) days with no usage_check
 * for that window yet, oldest first, at most `limit` a run, reads whether the contract is still
 * there and how much it was used, and writes one `usage_check` (dedupe_key
 * `usage:<deployed event id>:<window>`). A deploy past 90 days gets only its 90-day check. A
 * code_differs deploy (the builder was told not to use it) or one whose address isn't an address is
 * never checked. A failing deploy
 * is tried at most once per USAGE_RETRY_HOURS, and after USAGE_SKIP_AFTER failures in a row
 * (usage_check_failures) sits out USAGE_SKIP_DAYS, so it never blocks newer ones; a pass clears its
 * count. Off with the log off
 * (no read, no write). A failed read writes nothing, counts as failed and is read again next run;
 * nothing here ever throws.
 */
export async function usageChecks(now: Date, deps: UsageDeps = {}): Promise<{ checked: number; failed: number }> {
  const out = { checked: 0, failed: 0 };
  if (!eventLogEnabled()) return out;
  const [w30, w90] = USAGE_WINDOWS;
  const limit = Math.max(0, Math.min(deps.limit ?? USAGE_LIMIT, USAGE_LIMIT));
  let due: DueDeploy[];
  let q: Db;
  try {
    q = deps.db ?? sql();
    const t30 = new Date(now.getTime() - w30 * 86_400_000);
    const t90 = new Date(now.getTime() - w90 * 86_400_000);
    due = [
      ...(await q<DueDeploy[]>`
        SELECT d.id::text AS id, d.win, d.chain, d.detail, d.installation_id, d.repo_key, d.wallet,
          d.github_login, d.login_basis, d.program_id, d.project_id
        FROM (
          SELECT e.*, CASE WHEN e.at <= ${t90} THEN ${w90}::int ELSE ${w30}::int END AS win
          FROM builder_events e
          WHERE e.type = 'deployed' AND e.at <= ${t30} AND e.chain IN ('arc', 'base')
            AND e.detail->>'address' ~* '^0x[0-9a-f]{40}$' AND coalesce(e.detail->>'code_differs', 'false') <> 'true'
            AND (${deps.only ?? null}::bigint[] IS NULL OR e.id = ANY(${deps.only ?? null}::bigint[]))
            AND NOT EXISTS (SELECT 1 FROM usage_check_failures f WHERE f.deployed_event_id = e.id
              AND (f.last_failed_at > ${new Date(now.getTime() - USAGE_RETRY_HOURS * 3_600_000)}
                OR (f.failures >= ${USAGE_SKIP_AFTER} AND f.last_failed_at > ${new Date(now.getTime() - USAGE_SKIP_DAYS * 86_400_000)})))
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
      else {
        // Review I2: recordEvent answers false for a duplicate and for a failed write alike. A row
        // that is there (another run wrote it) is done; one that isn't is a failure.
        const key = `usage:${d.id}:${d.win}`;
        const [there] = await q<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE dedupe_key = ${key}`;
        if (!there || there.n === 0) throw new Error('usage_check not written');
      }
      await q`DELETE FROM usage_check_failures WHERE deployed_event_id = ${d.id}`.catch((e: unknown) =>
        console.error(`[events] usage_check failures ${errName(e)}`),
      );
    } catch (err) {
      console.error(`[events] usage_check ${errName(err)}`);
      out.failed++;
      // Concern 4: count failures in a row, so a deploy that keeps failing steps aside for a while.
      await q`
        INSERT INTO usage_check_failures (deployed_event_id, failures, last_failed_at) VALUES (${d.id}, 1, ${now})
        ON CONFLICT (deployed_event_id) DO UPDATE SET failures = usage_check_failures.failures + 1, last_failed_at = ${now}`.catch(
        (e: unknown) => console.error(`[events] usage_check failures ${errName(e)}`),
      );
    }
  }
  return out;
}
