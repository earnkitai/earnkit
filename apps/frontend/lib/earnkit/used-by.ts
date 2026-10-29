import { sql } from './db';
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { AlchemyNetworkOff, AlchemyReverted, alchemyCall, alchemyOn, contractSends, fundedBy, isToken, logNetworkOff, type AlchemyCall } from './alchemy';
import { BUILDER_CODE } from './builder-code';
import { ScoreDeadline } from './campaigns';
import { benchConfirmedSql } from './main-project';
import { hit } from './rate-limit';
import { githubFileHref } from './site-data';
import { WALLET_CHAINS, explorerHref, walletChain } from './wallet-chains';
import { isoWeekOf } from './weeks';

/**
 * v3.1 Used by (2026-10-27, design v3.1-used-by.md; owner: "agreed and go"): how many real people used what a builder
 * built in the last 30 days, read once a UTC day by the cron from two free sources and kept in app_usage (one row per
 * builder, source and day). Highlights (site-data.ts usedByOf) shows the larger of the two from USED_MIN people.
 * - contracts: the distinct outside senders to the builder's own counted contracts on every WALLET_CHAINS chain
 *   (Alchemy's free key), never counting the builder's proven wallets, a contract's deployer, or a wallet a proven
 *   wallet sent ETH to (anti-farming).
 * - builder_code: the distinct senders of Base transactions carrying a Builder Code Base's registry pays to a wallet the
 *   builder proved by signature (candidates: the codes in their App-proven repos and one they name through tell; the
 *   CDP SQL API: one query a day for every builder together, within its 1,000-a-month free tier).
 * Never a wallet address on the page; a read that fails stores nothing and is asked again the next day.
 */
export const USED_DAYS = 30;
/** Pages of 1000 transfers read per contract (Alchemy's free throughput); a contract past them reads "N+". */
export const USED_PAGES = 5;
/** The newest counted contracts read per builder. */
export const USED_CONTRACTS = 10;
/** Builders whose contracts are read per cron run (each at most once a UTC day). */
export const USED_PER_RUN = 20;
const DAY_MS = 86_400_000;
const WALLET = /^0x[0-9a-f]{40}$/;

/** One source's numbers for a builder on a day (app_usage's row). */
export type Usage = { users: number; returning: number; capped: boolean; href: string | null; chains: string[] };

/**
 * Users and returning users from senders' active weeks: `weeks` per wallet (ISO weeks it sent in); returning is 2 or
 * more distinct weeks. Pure.
 */
const tally = (weeks: Map<string, Set<string>>) => ({ users: weeks.size, returning: [...weeks.values()].filter((w) => w.size >= 2).length });

export type Contract = { chain: string; address: string; deployer: string | null; counted: boolean; at: Date | null };

/**
 * The contracts read for the builder: their wallet_contracts rows with counts (a proven wallet's own creations, not a
 * token and used) and their verified contract sources ("<chain>:0x...") on a WALLET_CHAINS chain, one row per contract
 * (a counted one wins), newest first (creation time, else when the source was verified).
 */
export async function contractsOf(builderId: number): Promise<Contract[]> {
  const rows = await sql()<Contract[]>`
    SELECT c.chain, c.address, c.wallet AS deployer, true AS counted, c.created_at AS at
    FROM wallet_contracts c JOIN person_wallets w ON w.wallet = c.wallet
    WHERE w.builder_id = ${builderId} AND c.counts
    UNION ALL
    SELECT split_part(lower(s.ref), ':', 1), split_part(lower(s.ref), ':', 2), lower(s.deployer), false, COALESCE(s.deployed_at, s.verified_at, s.created_at)
    FROM builder_sources s
    WHERE s.builder_id = ${builderId} AND s.kind = 'contract' AND s.state = 'verified'`;
  const byKey = new Map<string, Contract>();
  for (const r of rows) {
    if (!walletChain(r.chain) || !WALLET.test(r.address)) continue;
    const k = `${r.chain}:${r.address}`;
    const had = byKey.get(k);
    if (!had || (r.counted && !had.counted)) byKey.set(k, { ...r, deployer: r.deployer ?? had?.deployer ?? null });
  }
  const time = (c: Contract) => (c.at ? new Date(c.at).getTime() : -Infinity);
  return [...byKey.values()].sort((a, b) => time(b) - time(a) || a.address.localeCompare(b.address));
}

/**
 * The contracts source for one builder: the newest USED_CONTRACTS of their contracts (a verified source that is a
 * token, alchemy.ts isToken, never counts; wallet_contracts already left tokens out), every outside sender in the last
 * USED_DAYS (alchemy.ts contractSends, USED_PAGES pages each). Excluded on every chain: the builder's proven wallets,
 * each contract's deployer, and every wallet a proven wallet sent ETH to (fundedBy, one page per chain). Chains side by
 * side, one call at a time within a chain; a network not enabled in Alchemy is skipped (as alchemyWalletContracts
 * does), any other failure fails the read (nothing is stored, the next day asks again), the deadline propagates.
 * `href`: the busiest contract (most counted senders) on its explorer; `chains`: where senders were counted. Null
 * without a contract on an enabled chain.
 */
export async function contractsUsage(builderId: number, now: Date, callFor: (network: string) => AlchemyCall): Promise<Usage | null> {
  const all = await contractsOf(builderId);
  if (all.length === 0) return null;
  const proven = await provenWallets(builderId);
  const since = now.getTime() - USED_DAYS * DAY_MS;
  // Each chain on its own: a network not enabled is skipped, any other failure fails the whole read.
  const perChain = <T>(f: (chain: string, call: AlchemyCall) => Promise<T>) =>
    Promise.all(WALLET_CHAINS.map(async ({ chain, network }) => {
      if (!all.some((c) => c.chain === chain)) return null;
      try {
        return await f(chain, callFor(network));
      } catch (err) {
        if (!(err instanceof AlchemyNetworkOff)) throw err;
        logNetworkOff(network);
        return null;
      }
    }));
  // 1. Per chain, its newest contracts that are not tokens (at most USED_CONTRACTS each), and who the proven wallets funded.
  const firsts = await perChain(async (chain, call) => {
    const kept = await keptOn(all, chain, call);
    const funded = kept.length > 0 ? await fundedOf(proven, call) : new Set<string>();
    return { chain, kept, funded };
  });
  const on = firsts.filter((r): r is NonNullable<typeof r> => r !== null);
  // 2. USED_CONTRACTS per builder: the newest across chains (all is newest first, so its order decides).
  const chosen = newestChosen(all, on.map((r) => r.kept));
  if (chosen.length === 0) return null;
  // 3. Their senders in the last USED_DAYS, one contract at a time within a chain.
  const reads = (await perChain(async (chain, call) => {
    const out: { c: Contract; sends: { from: string; at: number }[]; capped: boolean }[] = [];
    for (const c of chosen.filter((x) => x.chain === chain)) out.push({ c, ...(await contractSends(c.address, call, since, USED_PAGES)) });
    return out;
  })).flatMap((r) => r ?? []);
  const weeks = new Map<string, Set<string>>();
  const perContract: { chain: string; address: string; n: number }[] = [];
  let capped = false;
  // Anti-farming, across chains (one person, one address everywhere): proven wallets, deployers, wallets they funded.
  const excluded = excludedOf(proven, on.map((r) => r.funded), chosen);
  for (const { c, sends, capped: cut } of reads) {
    if (cut) capped = true;
    const who = new Set<string>();
    for (const s of sends) {
      if (excluded.has(s.from)) continue;
      who.add(s.from);
      weeks.set(s.from, (weeks.get(s.from) ?? new Set<string>()).add(isoWeekOf(new Date(s.at))));
    }
    perContract.push({ chain: c.chain, address: c.address, n: who.size });
  }
  if (reads.length === 0) return null;
  const used = perContract.filter((p) => p.n > 0);
  const busiest = [...used].sort((a, b) => b.n - a.n)[0] ?? null;
  return { ...tally(weeks), capped, href: busiest ? explorerHref(busiest.chain, busiest.address) : null, chains: [...new Set(used.map((p) => p.chain))] };
}

/**
 * v4.5 (shared by contractsUsage and revenue.ts contractsRevenue, so the two reads count the same contracts and
 * exclude the same wallets): the builder's proven wallets (person_wallets), lowercase.
 */
export async function provenWallets(builderId: number): Promise<string[]> {
  return (await sql()<{ wallet: string }[]>`SELECT wallet FROM person_wallets WHERE builder_id = ${builderId}`).map((r) => r.wallet.toLowerCase());
}

/**
 * v4.5 shared: `chain`'s newest contracts of `all` (contractsOf, newest first) that are not tokens (a counted
 * wallet_contracts row already left tokens out; a verified source is asked, alchemy.ts isToken), at most USED_CONTRACTS.
 */
export async function keptOn(all: Contract[], chain: string, call: AlchemyCall): Promise<Contract[]> {
  const kept: Contract[] = [];
  for (const c of all.filter((x) => x.chain === chain)) {
    if (kept.length >= USED_CONTRACTS) break;
    if (c.counted || !(await isToken(c.address, call))) kept.push(c);
  }
  return kept;
}

/** v4.5 shared: the wallets the proven wallets sent ETH to on one chain (alchemy.ts fundedBy, one page each). */
export async function fundedOf(proven: string[], call: AlchemyCall): Promise<Set<string>> {
  const funded = new Set<string>();
  for (const w of proven) for (const a of await fundedBy(w, call)) funded.add(a);
  return funded;
}

/** v4.5 shared: the newest USED_CONTRACTS across chains of the per-chain `kept` lists (`all`'s order decides). Pure. */
export function newestChosen(all: Contract[], kept: Contract[][]): Contract[] {
  return all.filter((c) => kept.some((k) => k.includes(c))).slice(0, USED_CONTRACTS);
}

/** v4.5 shared, anti-farming: the proven wallets, every wallet they funded, and each chosen contract's deployer. Pure. */
export function excludedOf(proven: string[], funded: Iterable<string>[], chosen: Contract[]): Set<string> {
  const excluded = new Set([...proven, ...funded.flatMap((f) => [...f])]);
  for (const c of chosen) if (c.deployer) excluded.add(c.deployer.toLowerCase());
  return excluded;
}

/** Stores one source's numbers for the builder's UTC day (a second read the same day replaces them). */
async function store(builderId: number, source: 'contracts' | 'builder_code', now: Date, u: Usage) {
  const returning = Math.min(u.returning, u.users);
  await sql()`
    INSERT INTO app_usage (builder_id, source, day, users, "returning", capped, href, chains)
    VALUES (${builderId}, ${source}, ${now.toISOString().slice(0, 10)}, ${u.users}, ${returning}, ${u.capped}, ${u.href}, ${u.chains}::text[])
    ON CONFLICT (builder_id, source, day) DO UPDATE SET users = EXCLUDED.users, "returning" = EXCLUDED."returning",
      capped = EXCLUDED.capped, href = EXCLUDED.href, chains = EXCLUDED.chains`;
}

/** Bench-confirmed builders (their one project confirmed, main-project.ts benchConfirmedSql), `only` limiting them. */
export const confirmedSql = (only?: number[]) => {
  const db = sql();
  return db`
    SELECT p.builder_id FROM builder_profiles p
    JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
    ${only ? db`WHERE p.builder_id IN ${db(only)}` : db``}`;
};

/**
 * Bench-confirmed builders with a contract to read (a counted wallet_contracts row or a verified contract source) and
 * no contracts row for today: never read first, then the oldest read; at most `limit`.
 */
export async function contractsDue(now: Date, o: { limit?: number; only?: number[] } = {}): Promise<number[]> {
  const db = sql();
  const chains = WALLET_CHAINS.map((c) => c.chain);
  const rows = await db<{ builder_id: number }[]>`
    SELECT k.builder_id FROM (${confirmedSql(o.only)}) k
    LEFT JOIN LATERAL (SELECT max(u.day) AS day FROM app_usage u WHERE u.builder_id = k.builder_id AND u.source = 'contracts') u ON true
    WHERE (u.day IS NULL OR u.day < ${now.toISOString().slice(0, 10)}::date)
      AND (EXISTS (SELECT 1 FROM wallet_contracts c JOIN person_wallets w ON w.wallet = c.wallet WHERE w.builder_id = k.builder_id AND c.counts)
        OR EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = k.builder_id AND s.kind = 'contract' AND s.state = 'verified'
          AND split_part(lower(s.ref), ':', 1) = ANY(${chains}::text[])))
    ORDER BY u.day NULLS FIRST, k.builder_id LIMIT ${o.limit ?? USED_PER_RUN}`;
  return rows.map((r) => r.builder_id);
}

/** The CDP SQL API (2026-10-27): POST, Bearer CDP_CLIENT_API_KEY, body {"sql": "..."}. */
export const CDP_SQL_URL = 'https://api.cdp.coinbase.com/platform/v2/data/query/run';
export const cdpOn = (env: Record<string, string | undefined> = process.env) => Boolean(env.CDP_CLIENT_API_KEY?.trim());

/** ClickHouse's DateTime literal for `d` (UTC, seconds). Pure. */
const chTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * The one CDP SQL query for every code (ClickHouse SQL): per code, the distinct senders (lowercase) of its last
 * USED_DAYS of attributed transactions with action = 1, the union of EOA senders (base.transaction_attributions joined
 * to base.transactions on transaction_hash) and smart-account senders (base.decoded_user_operations, success only,
 * each of its builder_codes), less each code's `exclude` wallets (its builder's proven wallets); `returning_users` are
 * those active in 2 or more ISO weeks (distinct Mondays, toMonday). Only BUILDER_CODE codes and 0x wallets go in: any
 * other string is dropped, never escaped (no user text in SQL). Null when no code is left. Pure.
 */
export function usageSql(codes: string[], exclude: [code: string, wallet: string][], since: Date): string | null {
  const ok = [...new Set(codes)].filter((c) => BUILDER_CODE.test(c)).sort();
  if (ok.length === 0) return null;
  const list = ok.map((c) => `'${c}'`).join(', ');
  const pairs = exclude.filter(([c, w]) => ok.includes(c) && WALLET.test(w)).map(([c, w]) => `('${c}', '${w}')`);
  const t = `toDateTime('${chTime(since)}', 'UTC')`;
  return [
    'SELECT code, count() AS users, countIf(weeks >= 2) AS returning_users',
    'FROM (',
    '  SELECT code, wallet, uniqExact(toMonday(ts)) AS weeks',
    '  FROM (',
    '    SELECT a.builder_code AS code, lower(t.from_address) AS wallet, a.block_timestamp AS ts',
    '    FROM base.transaction_attributions a',
    '    INNER JOIN base.transactions t ON t.transaction_hash = a.transaction_hash',
    `    WHERE a.action = 1 AND t.action = 1 AND a.block_timestamp >= ${t} AND a.builder_code IN (${list})`,
    '    UNION ALL',
    '    SELECT code, lower(o.sender) AS wallet, o.block_timestamp AS ts',
    '    FROM base.decoded_user_operations o',
    '    ARRAY JOIN o.builder_codes AS code',
    `    WHERE o.action = 1 AND o.success = 'success' AND o.block_timestamp >= ${t} AND code IN (${list})`,
    '  )',
    ...(pairs.length ? [`  WHERE (code, wallet) NOT IN (${pairs.join(', ')})`] : []),
    '  GROUP BY code, wallet',
    ')',
    'GROUP BY code',
    'ORDER BY code',
  ].join('\n');
}

type CdpAnswer = { metadata?: { rowCount?: unknown }; result?: { code?: unknown; users?: unknown; returning_users?: unknown }[] };

/** One CDP SQL call (30s at most, never past `deadline`); the answer's rows, or a throw on an HTTP error. */
async function cdpQuery(query: string, f: typeof fetch, deadline: number): Promise<CdpAnswer> {
  const left = deadline - Date.now();
  if (left <= 0) throw new ScoreDeadline();
  const res = await f(CDP_SQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CDP_CLIENT_API_KEY?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: query }),
    signal: AbortSignal.timeout(Math.min(30_000, left)),
  });
  if (!res.ok) throw new Error(`CDP SQL returned ${res.status}`);
  return (await res.json()) as CdpAnswer;
}

/**
 * v3.1 Used by, security review (2026-10-27, binding): Base's Builder Codes registry on Base mainnet (ERC-721,
 * github.com/base/builder-codes). ownerOf is Base's custodian, so a code's owner is its payout address:
 * payoutAddress(string code) view returns (address), reverting Unregistered for an unknown code.
 */
export const BUILDER_CODES_REGISTRY = '0x000000bc7e6457e610fe52dcc0ca5b3ce59c8e80';
const PAYOUT_ABI = parseAbi(['function payoutAddress(string code) view returns (address)']);
/** A verdict is read again after a day (the payout address can change). */
export const CODE_VERIFY_MS = DAY_MS;
/** Candidates verified per cron run (one eth_call each). */
export const CODES_VERIFIED_PER_RUN = 100;
/**
 * Security review 2 (2026-10-27): an owned verdict older than this no longer counts (ownedCodes), so a code whose
 * payout moved never keeps counting while its re-check waits; and a builder keeps at most TOLD_MAX told codes (the
 * newest), so naming codes in bulk can't push other builders' re-checks out of a run.
 */
export const OWNED_MAX_MS = 3 * DAY_MS;
export const TOLD_MAX = 3;

/** The registry's payout address for `code` (lowercase), null when it reverts (unregistered); any other failure throws. */
export async function payoutOf(code: string, call: AlchemyCall): Promise<string | null> {
  const data = encodeFunctionData({ abi: PAYOUT_ABI, functionName: 'payoutAddress', args: [code] });
  try {
    const out = await call<string>('eth_call', [{ to: BUILDER_CODES_REGISTRY, data }, 'latest']);
    const a = decodeFunctionResult({ abi: PAYOUT_ABI, functionName: 'payoutAddress', data: out as `0x${string}` }).toLowerCase();
    if (!WALLET.test(a)) throw new Error('registry answer is not an address');
    return a === `0x${'0'.repeat(40)}` ? null : a;
  } catch (err) {
    if (err instanceof AlchemyReverted) return null;
    throw err;
  }
}

/**
 * Stores a code the builder named (tell builder_code) as a candidate, verified like the repo's at the next daily step.
 * `id` is an installation or its group root: the claim is the builder's (person_wallets is keyed by builder). At most
 * TOLD_MAX told codes per builder: the newest named stays, the oldest unowned told ones beyond it go. False for
 * anything but BUILDER_CODE (nothing stored).
 */
export async function tellBuilderCode(id: number, code: string): Promise<boolean> {
  if (!BUILDER_CODE.test(code)) return false;
  const db = sql();
  const [r] = await db<{ b: number }[]>`SELECT COALESCE(i.builder_id, i.id) AS b FROM installations i WHERE i.id = ${id}`;
  const builderId = r?.b ?? id;
  await db.begin(async (tx) => {
    await tx`
      INSERT INTO builder_code_claims (code, builder_id, told, created_at) VALUES (${code}, ${builderId}, true, now())
      ON CONFLICT (code, builder_id) DO UPDATE SET told = true, created_at = now()`;
    await tx`
      DELETE FROM builder_code_claims WHERE builder_id = ${builderId} AND told AND NOT owned AND code <> ${code}
        AND code NOT IN (SELECT code FROM builder_code_claims WHERE builder_id = ${builderId} AND told ORDER BY created_at DESC, code LIMIT ${TOLD_MAX})`;
  });
  return true;
}

/**
 * The daily registry check (before the usage query): every repo-scan code (repo_builder_codes.codes of a repo the
 * builder proved through the App) becomes a candidate, then the Bench-confirmed builders' candidates not verified
 * within CODE_VERIFY_MS (owned ones first, so a held verdict is re-checked before any new candidate; then never
 * verified first; at most CODES_VERIFIED_PER_RUN) are read one at a time: owned when the
 * payout address is one of that builder's signature-proven wallets (person_wallets). Unregistered (a revert) is not
 * owned. A failed read stores nothing: the previous verdict stands and none is ever granted on a failure. Two
 * builders can name one code; only the one whose proven wallet the registry pays can own it (a wallet belongs to one
 * builder). The deadline propagates.
 */
export async function verifyCodes(now: Date, call: AlchemyCall, o: { deadline: number; only?: number[]; limit?: number }): Promise<{ due: number; verified: number; owned: number; failed: number }> {
  const db = sql();
  await db`
    INSERT INTO builder_code_claims (code, builder_id)
    SELECT DISTINCT x.code, s.builder_id
    FROM repo_builder_codes c CROSS JOIN LATERAL unnest(c.codes) AS x(code)
    JOIN builder_sources s ON s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app'
      AND regexp_replace(regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', ''), '([.]git)?/*$', '') = c.repo_key
    WHERE c.found AND x.code ~ '^[a-z0-9_]{1,64}$' ${o.only ? db`AND s.builder_id IN ${db(o.only)}` : db``}
    ON CONFLICT (code, builder_id) DO NOTHING`;
  const due = await db<{ code: string; builder_id: number }[]>`
    SELECT c.code, c.builder_id FROM builder_code_claims c
    WHERE c.builder_id IN (${confirmedSql(o.only)}) AND (c.verified_at IS NULL OR c.verified_at <= ${new Date(now.getTime() - CODE_VERIFY_MS)})
    ORDER BY c.owned DESC, c.verified_at NULLS FIRST, c.code, c.builder_id LIMIT ${o.limit ?? CODES_VERIFIED_PER_RUN}`;
  let verified = 0;
  let owned = 0;
  let failed = 0;
  for (const d of due) {
    if (Date.now() >= o.deadline) break;
    let payout: string | null;
    try {
      payout = await payoutOf(d.code, call);
    } catch (err) {
      if (err instanceof ScoreDeadline) throw err;
      console.error('[used-by] registry', err instanceof Error ? err.name : 'error');
      failed++;
      continue;
    }
    const [{ mine }] = await db<{ mine: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM person_wallets WHERE builder_id = ${d.builder_id} AND lower(wallet) = ${payout ?? ''}) AS mine`;
    await db`UPDATE builder_code_claims SET payout = ${payout}, owned = ${mine}, verified_at = ${now} WHERE code = ${d.code} AND builder_id = ${d.builder_id}`;
    verified++;
    if (mine) owned++;
  }
  return { due: due.length, verified, owned, failed };
}

/**
 * The codes that count: owned (verifyCodes' verdict) by a Bench-confirmed builder (`only` limits them), each with the
 * file it is in when one of the builder's App-proven repos carries it (the link), else none. A verdict older than
 * OWNED_MAX_MS no longer counts (security review 2). Should two rows ever be
 * owned (a payout that moved while a read failed), the newest verdict wins.
 */
export async function ownedCodes(o: { only?: number[]; now?: Date } = {}): Promise<Map<string, { builder_id: number; repo: string | null; path: string | null }>> {
  const db = sql();
  const rows = await db<{ code: string; builder_id: number; repo: string | null; path: string | null }[]>`
    SELECT DISTINCT ON (c.code) c.code, c.builder_id, f.repo, f.path FROM builder_code_claims c
    LEFT JOIN LATERAL (
      SELECT r.repo_key AS repo, r.path FROM repo_builder_codes r
      JOIN builder_sources s ON s.builder_id = c.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app'
        AND regexp_replace(regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', ''), '([.]git)?/*$', '') = r.repo_key
      WHERE r.found AND c.code = ANY(r.codes) ORDER BY r.repo_key LIMIT 1) f ON true
    WHERE c.owned AND c.verified_at > ${new Date((o.now ?? new Date()).getTime() - OWNED_MAX_MS)} AND c.builder_id IN (${confirmedSql(o.only)})
    ORDER BY c.code, c.verified_at DESC NULLS LAST, c.builder_id`;
  return new Map(rows.filter((r) => BUILDER_CODE.test(r.code)).map((r) => [r.code, { builder_id: r.builder_id, repo: r.repo, path: r.path }]));
}

/**
 * The Builder Code source, at most once a UTC day for everyone (the rate window marks the day, as people-signals.ts
 * does): one usageSql query over every owned code (ownedCodes), each code's builder's proven wallets excluded. A
 * builder with several codes keeps the largest one's numbers (codes overlap; never summed). `href`: the repo file the
 * code is in, if a proven repo carries it (site-data.ts shows it only while that repo is the public main one). Off
 * without CDP_CLIENT_API_KEY, and
 * with no code nothing is asked (the day is not spent).
 */
export async function codesUsage(
  now: Date,
  o: { fetch?: typeof fetch; deadline: number; only?: number[] },
): Promise<{ step: 'off' | 'none' | 'done_today' } | { codes: number; builders: number }> {
  if (!cdpOn()) return { step: 'off' };
  const owners = await ownedCodes({ only: o.only, now });
  if (owners.size === 0) return { step: 'none' };
  if (!(await hit(`usedByCodes:${now.toISOString().slice(0, 10)}`, 1, 86_400, now)).allowed) return { step: 'done_today' };
  const ids = [...new Set([...owners.values()].map((v) => v.builder_id))];
  const wallets = await sql()<{ builder_id: number; wallet: string }[]>`SELECT builder_id, wallet FROM person_wallets WHERE builder_id IN ${sql()(ids)}`;
  const exclude: [string, string][] = [];
  for (const [code, v] of owners) for (const w of wallets) if (w.builder_id === v.builder_id) exclude.push([code, w.wallet.toLowerCase()]);
  const query = usageSql([...owners.keys()], exclude, new Date(now.getTime() - USED_DAYS * DAY_MS));
  if (!query) return { step: 'none' };
  const answer = await cdpQuery(query, o.fetch ?? fetch, o.deadline);
  const best = new Map<number, Usage>();
  for (const r of Array.isArray(answer.result) ? answer.result : []) {
    const code = typeof r?.code === 'string' ? r.code : '';
    const owner = owners.get(code);
    const users = Number(r?.users);
    const returning = Number(r?.returning_users);
    if (!owner || !Number.isInteger(users) || users < 0 || !Number.isInteger(returning) || returning < 0) continue;
    const had = best.get(owner.builder_id);
    if (had && had.users >= users) continue;
    const href = owner.repo && owner.path ? githubFileHref(owner.repo, null, owner.path) : null;
    best.set(owner.builder_id, { users, returning, capped: false, href, chains: ['base'] });
  }
  for (const [id, u] of best) await store(id, 'builder_code', now, u);
  return { codes: owners.size, builders: best.size };
}

/**
 * v3.1 Used by: the cron's daily step, inside its slice (`deadline`). First the registry check of Builder Code
 * candidates (verifyCodes, Alchemy on Base), then the one Builder Code query (codesUsage),
 * then the contracts source for the due builders (contractsDue), one at a time, each claimed for the UTC day before its
 * reads (so a failing one waits a day and never holds a slot), none started past the deadline. Off without
 * ALCHEMY_API_KEY unless `callFor` is given (tests). Each source fails on its own (logged, the other still runs).
 */
export async function runUsedBy(
  now: Date,
  o: { deadline: number; callFor?: (network: string) => AlchemyCall; fetch?: typeof fetch; only?: number[]; limit?: number },
): Promise<{
  registry: Awaited<ReturnType<typeof verifyCodes>> | { step: 'off' | 'error' };
  builder_code: Awaited<ReturnType<typeof codesUsage>> | { step: 'error' };
  contracts: { due: number; read: number } | { step: 'off' };
}> {
  const alchemy = Boolean(o.callFor) || alchemyOn();
  const callFor = o.callFor ?? ((network: string) => alchemyCall(o.deadline, network));
  // The registry check first (Base, Alchemy), so the usage query counts only codes a proven wallet is paid for.
  let registry: Awaited<ReturnType<typeof verifyCodes>> | { step: 'off' | 'error' } = { step: 'off' };
  if (alchemy)
    try {
      registry = await verifyCodes(now, callFor('base-mainnet'), o);
    } catch (err) {
      console.error('[used-by] registry', err instanceof Error ? err.name : 'error');
      registry = { step: 'error' };
    }
  let builder_code: Awaited<ReturnType<typeof codesUsage>> | { step: 'error' };
  try {
    builder_code = await codesUsage(now, o);
  } catch (err) {
    console.error('[used-by] builder code', err instanceof Error ? err.name : 'error');
    builder_code = { step: 'error' };
  }
  if (!alchemy) return { registry, builder_code, contracts: { step: 'off' } };
  const due = await contractsDue(now, o);
  let read = 0;
  for (const id of due) {
    if (Date.now() >= o.deadline) break;
    if (!(await hit(`usedByContracts:${id}:${now.toISOString().slice(0, 10)}`, 1, 86_400, now)).allowed) continue;
    try {
      const u = await contractsUsage(id, now, callFor);
      if (u) await store(id, 'contracts', now, u);
      read++;
    } catch (err) {
      if (err instanceof ScoreDeadline) break;
      console.error('[used-by] contracts', err instanceof Error ? err.name : 'error');
    }
  }
  return { registry, builder_code, contracts: { due: due.length, read } };
}
