import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  http,
  isAddress,
  isHex,
  WaitForTransactionReceiptTimeoutError,
  type Abi,
  type Address,
  type Chain as ViemChain,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { CHAIN_NAMES } from './chains';
import { privateKeyProblem } from './cli';
import { sql } from './db';
import { shortWallet } from './entry-text';
import { FREE_CAPS, giveBackFreeTier, takeFreeTier } from './free-tier';
import { llamaPrice } from './prices';
import { RateLimitError, enforce } from './rate-limit';
import { repoOwnershipPasses, type OwnershipDeps } from './token-gate';
import { markDeployed, rpcFor } from './verify';

/**
 * v2.10 item 13: EarnKit deploys the builder's own compiled contract on Arc or Base from its own
 * deployer key (DEPLOYER_PRIVATE_KEY, a hot key holding about $5 of gas per chain), with the builder
 * as the owner. Off until the key is set. The key signs only these deploys (value 0, no recipient)
 * and one transferOwnership(builder); it never sends money to anyone. Every cap is enforced before
 * the send, atomically: 1 deploy per builder per chain per day (rate_windows), 3 per builder per 30
 * days (a count over contract_deploys under a lock, Pre-flight P16), 20 a day in total and $10 of
 * gas a month (free_tier_usage, R18: the upper bound is reserved, the unused part given back).
 */

export const DEPLOY_CAPS = {
  initcodeBytes: 49_152,
  runtimeBytes: 24_576,
  perDeployUsd: 0.25,
  monthMicroUsd: 10_000_000,
  dayTotal: 20,
  perBuilderChainDay: 1,
  perBuilder30d: 3,
} as const;

/** ERC-20 transfer, approve and totalSupply: bytecode PUSH4-ing all three is a token (refused). */
export const ERC20_SELECTORS = ['a9059cbb', '095ea7b3', '18160ddd'] as const;

export type DeployChainName = 'arc' | 'base';
export type DeployInput = { chain: DeployChainName; bytecode: `0x${string}`; abi: Abi; constructor_args?: unknown[] };

export const DEPLOY_LINES = {
  off: 'Deploys are off right now.',
  high: 'Deploy costs are high right now; try tomorrow.',
  paused: 'Deploys are paused until next month.',
  limit: 'You can deploy once a day per chain, 3 times a month.',
  notYours: 'I can only deploy a repo you proved is yours.',
  token: "I can't deploy token contracts.",
  payable: "I can't deploy a contract that takes money on deploy.",
  tooBig: 'That contract is too big to deploy.',
  failed: "The deploy didn't go through. Nothing was charged to you.",
  dayFull: 'Deploys are paused until tomorrow.',
  lowBalance: 'Deploys are paused right now.',
} as const;

/** The deploy was sent but its receipt didn't come within the call (10.9). */
export const DEPLOY_PENDING = 'The deploy is still going. It can take a few minutes.';

export const deployedLine = (name: string, chain: DeployChainName, address: string, owner: boolean) =>
  `${name} is deployed on ${CHAIN_NAMES[chain]}: ${shortWallet(address)}.${owner ? " You're the owner." : ''}`;

/** The $0.25 per-deploy cap in micro-USD. */
const PER_DEPLOY_MICRO = BigInt(Math.round(DEPLOY_CAPS.perDeployUsd * 1_000_000));
/** How long one call waits for the deploy's receipt (and the transfer's) before answering "still going". */
const RECEIPT_MS = 30_000;
/**
 * Both native gas tokens have 18 decimals: ETH on Base; USDC on Arc, whose native balance (and so
 * gas) uses 18 decimals while its ERC-20 interface uses 6 (Arc docs, "USDC as gas").
 */
const NATIVE_DECIMALS = 18n;

/**
 * The initcode: the bytecode plus the ABI-encoded constructor args. JSON has no bigints, so an
 * integer argument given as a decimal string is read as one. Throws when the args don't fit. Pure.
 */
export function initcode(i: DeployInput): Hex {
  const ctor = i.abi.find((x) => x.type === 'constructor') as { inputs?: readonly { type: string }[] } | undefined;
  const args = (i.constructor_args ?? []).map((v, n) =>
    typeof v === 'string' && /^u?int\d*$/.test(ctor?.inputs?.[n]?.type ?? '') && /^-?\d+$/.test(v) ? BigInt(v) : v,
  );
  return encodeDeployData({ abi: i.abi, bytecode: i.bytecode, args } as Parameters<typeof encodeDeployData>[0]);
}

/** Why EarnKit won't deploy this artifact (builder text), or null. Pure. */
export function deployRefusal(i: DeployInput): string | null {
  const ctor = i.abi.find((x) => x.type === 'constructor') as { stateMutability?: string } | undefined;
  if (ctor?.stateMutability === 'payable') return DEPLOY_LINES.payable;
  if (!isHex(i.bytecode, { strict: true }) || i.bytecode.length < 4 || i.bytecode.length % 2 !== 0) return DEPLOY_LINES.failed;
  const code = i.bytecode.toLowerCase().slice(2);
  if (ERC20_SELECTORS.every((s) => code.includes(`63${s}`))) return DEPLOY_LINES.token;
  let data: Hex;
  try {
    data = initcode(i);
  } catch {
    return DEPLOY_LINES.failed;
  }
  if ((data.length - 2) / 2 > DEPLOY_CAPS.initcodeBytes) return DEPLOY_LINES.tooBig;
  return null;
}

/**
 * The deployer account (DEPLOYER_PRIVATE_KEY, 64 hex with or without 0x), or null when unset (the
 * feature is off). A malformed key throws, naming its shape only, never its value.
 */
export function deployerAccount(env: Record<string, string | undefined> = process.env): LocalAccount | null {
  const raw = env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
  const shape = `${raw.length} characters${raw.startsWith('0x') ? ', 0x prefix' : ''}`;
  if (privateKeyProblem('DEPLOYER_PRIVATE_KEY', key))
    throw new Error(`DEPLOYER_PRIVATE_KEY must be 64 hex characters, with or without 0x (got ${shape}).`);
  try {
    return privateKeyToAccount(key as Hex);
  } catch {
    throw new Error(`DEPLOYER_PRIVATE_KEY is not a valid private key: out of range (${shape}).`);
  }
}

const KEY_NAMES = ['CAMPAIGN_PAYOUT_PRIVATE_KEY', 'PAYOUT_PRIVATE_KEY', 'OPERATOR_PRIVATE_KEY', 'GUARDIAN_PRIVATE_KEY'] as const;

/**
 * v2.10 item 13: the deployer is never the payout, operator or guardian wallet. (The operator and
 * guardian keys live only in the owner's local shell, so on the server this checks the payout key;
 * the runbook says to keep them apart, Pre-flight P16.)
 */
export function keySeparate(deployer: Address, env: Record<string, string | undefined> = process.env): boolean {
  return KEY_NAMES.every((n) => {
    const raw = env[n]?.trim();
    if (!raw) return true;
    try {
      return privateKeyToAccount((/^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw) as Hex).address.toLowerCase() !== deployer.toLowerCase();
    } catch {
      return true; // a malformed other key is that feature's error, not a match
    }
  });
}

let warned = false;
/** Deploys are on: a well-formed deployer key that is none of the other keys. Never throws. */
export function deployEnabled(env: Record<string, string | undefined> = process.env): boolean {
  let account: LocalAccount | null;
  try {
    account = deployerAccount(env);
  } catch (err) {
    if (!warned) console.error('[deploy] off:', err instanceof Error ? err.message : 'bad key');
    warned = true;
    return false;
  }
  if (!account) return false;
  if (keySeparate(account.address, env)) return true;
  if (!warned) console.error('[deploy] off: DEPLOYER_PRIVATE_KEY must be a key of its own, not a payout, operator or guardian key.');
  warned = true;
  return false;
}

/** The chain reads and the two writes a deploy needs; replaced in tests. */
export type DeployChain = {
  estimate(a: { data: Hex; from: Address }): Promise<{ gas: bigint; maxFeePerGas: bigint }>;
  balance(a: Address): Promise<bigint>;
  send(a: { data: Hex; gas: bigint; maxFeePerGas: bigint }): Promise<Hex>;
  receipt(
    hash: Hex,
    timeoutMs: number,
  ): Promise<{ status: 'success' | 'reverted'; contractAddress: Address | null; gasUsed: bigint; effectiveGasPrice: bigint } | null>;
  code(a: Address): Promise<Hex>;
  read(a: { address: Address; abi: Abi; fn: string }): Promise<unknown>;
  write(a: { address: Address; abi: Abi; fn: string; args: unknown[] }): Promise<Hex>;
};

export type DeployDeps = {
  chain?: (c: DeployChainName) => DeployChain | null;
  usdPerNative?: (c: DeployChainName) => Promise<number>;
  now?: Date;
  /** Test seam: the ownership proof's reads (token-gate.ts GateDeps). */
  gate?: OwnershipDeps;
  /** Test seam: how long to wait for a receipt (default 30 s). */
  receiptMs?: number;
};

export type DeployOutcome =
  | { status: 'deployed'; address: Address; owner_ok: boolean | null; show_to_builder: string }
  | { status: 'refused' | 'failed' | 'unavailable'; show_to_builder: string; agent_note?: string };

/** Arc mainnet (chain id 5042, match.ts); its gas token is USDC. */
const arcChain = (rpc: string) =>
  defineChain({
    id: 5042,
    name: 'Arc',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: Number(NATIVE_DECIMALS) },
    rpcUrls: { default: { http: [rpc] } },
  });

/** One send at a time from the deployer in this process, so two deploys never take one nonce. */
let sendQueue: Promise<unknown> = Promise.resolve();

/** The viem DeployChain for `c`, or null (deploys off, or no RPC for the chain). */
export function viemDeployChain(c: DeployChainName): DeployChain | null {
  let account: LocalAccount | null;
  try {
    account = deployerAccount();
  } catch {
    return null;
  }
  const rpc = rpcFor(c);
  if (!account || !rpc) return null;
  const chain: ViemChain = c === 'base' ? base : arcChain(rpc);
  const transport = http(rpc, { timeout: 10_000, retryCount: 1 });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  let tip = 0n;
  return {
    estimate: async ({ data, from }) => {
      const [gas, fees] = await Promise.all([pub.estimateGas({ account: from, data }), pub.estimateFeesPerGas()]);
      tip = fees.maxPriorityFeePerGas ?? 0n;
      // 20% over the estimate as the gas limit, so a small state change can't make it run out.
      return { gas: (gas * 12n) / 10n, maxFeePerGas: fees.maxFeePerGas ?? (await pub.getGasPrice()) };
    },
    balance: (a) => pub.getBalance({ address: a }),
    send: ({ data, gas, maxFeePerGas }) => {
      const run = sendQueue.then(() =>
        // No `to` and no `value`: a contract creation that moves no money.
        wallet.sendTransaction({ data, gas, maxFeePerGas, maxPriorityFeePerGas: tip < maxFeePerGas ? tip : maxFeePerGas }),
      );
      sendQueue = run.catch(() => undefined);
      return run;
    },
    receipt: async (hash, timeoutMs) => {
      try {
        const r = await pub.waitForTransactionReceipt({ hash, timeout: timeoutMs });
        return { status: r.status, contractAddress: r.contractAddress ?? null, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice };
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) return null;
        throw err;
      }
    },
    code: async (a) => (await pub.getCode({ address: a })) ?? '0x',
    read: ({ address, abi, fn }) => pub.readContract({ address, abi, functionName: fn }),
    write: ({ address, abi, fn, args }) => {
      const run = sendQueue.then(() => wallet.writeContract({ address, abi, functionName: fn, args, chain, account }));
      sendQueue = run.catch(() => undefined);
      return run;
    },
  };
}

/** USD per whole native token: ETH on Base from DefiLlama (throws when it can't say), USDC on Arc at $1. */
export async function nativeUsd(c: DeployChainName): Promise<number> {
  return c === 'arc' ? 1 : (await llamaPrice('coingecko:ethereum')).price;
}

/** `wei` of the native token in micro-USD, rounded up. Pure. */
export function weiToMicroUsd(wei: bigint, usd: number): bigint {
  if (!(usd > 0) || !Number.isFinite(usd)) throw new Error('no price');
  const microPerToken = BigInt(Math.ceil(usd * 1_000_000));
  const unit = 10n ** NATIVE_DECIMALS;
  return (wei * microPerToken + unit - 1n) / unit;
}

const hasFn = (abi: Abi, name: string, inputs: number) =>
  abi.some((x) => x.type === 'function' && x.name === name && x.inputs.length === inputs);

const sameAddr = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const errName = (err: unknown) => (err instanceof Error ? err.name : 'error');

/**
 * v2.10 item 13: deploys the builder's artifact on `input.chain` with the builder as owner, within
 * every cap, or says why not. Order (Review Focus 3): on; the artifact's guards; the repo is the
 * builder's (R19); the per-day limit (atomic, before any chain read, so a race passes once); the
 * 30-day count and the row's reservation under one lock; the day's total; the estimate and price
 * (a failed price read refuses, R18); the $0.25 cap; the deployer's balance; the month's gas
 * reserve; the send. Never throws: a chain error after the send is "unknown" and flagged for the
 * owner (the cron's deploy-unknown), never retried by this call.
 */
export async function deployForBuilder(
  a: { installationId: number; login: string | null; repoKey: string; projectName: string; builderWallet: Address; input: DeployInput },
  deps: DeployDeps = {},
): Promise<DeployOutcome> {
  const now = deps.now ?? new Date();
  const started = Date.now();
  const c = a.input.chain;
  const refused = (line: string) => ({ status: 'refused' as const, show_to_builder: line });
  if (!deployEnabled() || (c !== 'arc' && c !== 'base')) return { status: 'unavailable', show_to_builder: DEPLOY_LINES.off };
  const chain = (deps.chain ?? viemDeployChain)(c);
  const deployer = deployerAccount()!.address;
  if (!chain) return { status: 'unavailable', show_to_builder: DEPLOY_LINES.off };
  const bad = deployRefusal(a.input);
  if (bad) return refused(bad);
  if (!isAddress(a.builderWallet, { strict: false })) return refused(DEPLOY_LINES.failed);
  const owns = await repoOwnershipPasses(
    { installationId: a.installationId, repoUrl: `https://github.com/${a.repoKey}`, verifiedLogin: a.login ?? undefined },
    deps.gate,
  );
  if (!owns) return refused(DEPLOY_LINES.notYours);
  const who = (a.login ?? a.repoKey).toLowerCase();
  try {
    await enforce('deployDay', `${who}:${c}`, DEPLOY_LINES.limit);
  } catch (err) {
    if (err instanceof RateLimitError) return refused(DEPLOY_LINES.limit);
    console.error('[deploy] day limit', errName(err));
    return { status: 'unavailable', show_to_builder: DEPLOY_LINES.lowBalance };
  }
  // Pre-flight P16: the 30-day count and the reservation in one transaction, under a lock per builder.
  let rowId: number | null;
  try {
    rowId = await sql().begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`contract-deploy:${who}`}))`;
      const [{ n }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM contract_deploys
        WHERE COALESCE(login, repo_key) = ${who} AND created_at > now() - interval '30 days'`;
      if (n >= DEPLOY_CAPS.perBuilder30d) return null;
      const [row] = await tx<{ id: number }[]>`
        INSERT INTO contract_deploys (installation_id, login, repo_key, chain, tx_hash, status, cost_micro_usd)
        VALUES (${a.installationId}, ${a.login?.toLowerCase() ?? null}, ${a.repoKey.toLowerCase()}, ${c}, '', 'sent', 0)
        RETURNING id`;
      return row.id;
    });
  } catch (err) {
    console.error('[deploy] reserve', errName(err));
    return { status: 'unavailable', show_to_builder: DEPLOY_LINES.lowBalance };
  }
  if (rowId === null) return refused(DEPLOY_LINES.limit);
  const id = rowId;
  let dayTaken = false;
  let reserved = 0;
  /** Nothing was sent: the reservation and the counters taken so far go back. */
  const release = async () => {
    await sql()`DELETE FROM contract_deploys WHERE id = ${id} AND tx_hash = ''`.catch((err: unknown) => console.error('[deploy] release', errName(err)));
    if (dayTaken) await giveBackFreeTier('deploysDay', 1, now).catch(() => undefined);
    if (reserved > 0) await giveBackFreeTier('deployGasMonth', reserved, now).catch(() => undefined);
  };
  const stop = async (out: DeployOutcome) => {
    await release();
    return out;
  };
  try {
    if (!(await takeFreeTier('deploysDay', 1, now))) return stop(refused(DEPLOY_LINES.dayFull));
    dayTaken = true;
    const data = initcode(a.input);
    let est: { gas: bigint; maxFeePerGas: bigint };
    try {
      est = await chain.estimate({ data, from: deployer });
    } catch (err) {
      console.error('[deploy] estimate', errName(err));
      return stop({ status: 'failed', show_to_builder: DEPLOY_LINES.failed, agent_note: 'Estimating the deploy failed: the constructor reverts with these arguments, or the chain is unreachable. Check the arguments and try tomorrow.' });
    }
    let usd: number;
    let upperMicro: bigint;
    try {
      usd = await (deps.usdPerNative ?? nativeUsd)(c);
      upperMicro = weiToMicroUsd(est.gas * est.maxFeePerGas, usd);
    } catch (err) {
      // R18: no price, no deploy.
      console.error('[deploy] price', errName(err));
      return stop({ status: 'unavailable', show_to_builder: DEPLOY_LINES.lowBalance, agent_note: "EarnKit couldn't price the gas right now. Try later." });
    }
    if (upperMicro > PER_DEPLOY_MICRO) return stop(refused(DEPLOY_LINES.high));
    const balance = await chain.balance(deployer);
    if (balance < est.gas * est.maxFeePerGas)
      return stop({
        status: 'unavailable',
        show_to_builder: DEPLOY_LINES.lowBalance,
        agent_note: `The deployer wallet on ${CHAIN_NAMES[c]} needs a top-up; the owner is told.`,
      });
    const upper = Number(upperMicro);
    if (upper > FREE_CAPS.deployGasMonth.cap || !(await takeFreeTier('deployGasMonth', upper, now))) return stop(refused(DEPLOY_LINES.paused));
    reserved = upper;
    let hash: Hex;
    try {
      // No `value`, no `to`: a contract creation.
      hash = await chain.send({ data, gas: est.gas, maxFeePerGas: est.maxFeePerGas });
    } catch (err) {
      // It may have reached the chain: keep every counter and flag it for the owner.
      console.error('[deploy] send', errName(err));
      await sql()`UPDATE contract_deploys SET status = 'unknown', cost_micro_usd = ${upper} WHERE id = ${id}`;
      return { status: 'failed', show_to_builder: DEPLOY_LINES.failed, agent_note: 'Sending the deploy failed; the owner checks whether it went out. Do not retry today.' };
    }
    await sql()`UPDATE contract_deploys SET tx_hash = ${hash}, cost_micro_usd = ${upper} WHERE id = ${id}`;
    const left = () => Math.max(1, (deps.receiptMs ?? RECEIPT_MS) - (Date.now() - started));
    const receipt = await chain.receipt(hash, left()).catch((err: unknown) => {
      console.error('[deploy] receipt', errName(err));
      return null;
    });
    if (!receipt || (receipt.status === 'success' && !receipt.contractAddress)) {
      await sql()`UPDATE contract_deploys SET status = 'unknown' WHERE id = ${id}`;
      return {
        status: 'failed',
        show_to_builder: DEPLOY_PENDING,
        agent_note: `The deploy was sent (transaction ${hash} on ${CHAIN_NAMES[c]}) but isn't confirmed yet. Read its receipt on the explorer for the contract address; do not deploy again.`,
      };
    }
    let spent = receipt.gasUsed * receipt.effectiveGasPrice;
    const settle = async (status: 'deployed' | 'reverted', fields: { address?: string; owner_ok?: boolean | null }) => {
      const cost = Number(weiToMicroUsd(spent, usd));
      if (cost < reserved) await giveBackFreeTier('deployGasMonth', reserved - cost, now);
      else if (cost > reserved && !(await takeFreeTier('deployGasMonth', cost - reserved, now)))
        console.error('[deploy] month counter: the transfer went over the reserve at the ceiling');
      await sql()`
        UPDATE contract_deploys SET status = ${status}, address = ${fields.address ?? null},
          owner_ok = ${fields.owner_ok ?? null}, cost_micro_usd = ${cost}
        WHERE id = ${id}`;
    };
    if (receipt.status === 'reverted') {
      await settle('reverted', {});
      return { status: 'failed', show_to_builder: DEPLOY_LINES.failed, agent_note: 'The deploy reverted on chain (the constructor failed).' };
    }
    const address = receipt.contractAddress!;
    const code = await chain.code(address).catch((err: unknown) => {
      console.error('[deploy] code', errName(err));
      return null;
    });
    if (code !== null && (code.length - 2) / 2 > DEPLOY_CAPS.runtimeBytes) {
      await settle('deployed', { address: address.toLowerCase(), owner_ok: false });
      return { status: 'failed', show_to_builder: DEPLOY_LINES.tooBig, agent_note: 'The deployed code is over 24 KB; the owner is told. Do not use this address.' };
    }
    // The owner step: the builder owns it, or one transferOwnership(builder) from the deployer.
    let ownerOk: boolean | null = null;
    if (hasFn(a.input.abi, 'owner', 0)) {
      const readOwner = () => chain.read({ address, abi: a.input.abi, fn: 'owner' }).catch(() => null);
      let owner = await readOwner();
      if (!sameAddr(owner, a.builderWallet) && sameAddr(owner, deployer) && hasFn(a.input.abi, 'transferOwnership', 1)) {
        try {
          const tx = await chain.write({ address, abi: a.input.abi, fn: 'transferOwnership', args: [a.builderWallet] });
          const r = await chain.receipt(tx, left()).catch(() => null);
          if (r) spent += r.gasUsed * r.effectiveGasPrice;
          owner = await readOwner();
        } catch (err) {
          console.error('[deploy] transferOwnership', errName(err));
        }
      }
      ownerOk = sameAddr(owner, a.builderWallet);
    }
    if (code !== null) await markDeployed(c, address).catch((err: unknown) => console.error('[deploy] cache', errName(err)));
    await settle('deployed', { address: address.toLowerCase(), owner_ok: ownerOk });
    return { status: 'deployed', address, owner_ok: ownerOk, show_to_builder: deployedLine(a.projectName, c, address, ownerOk === true) };
  } catch (err) {
    // A failure before the send: nothing went out. After it, the row keeps the hash for the owner.
    console.error('[deploy]', errName(err));
    const [row] = await sql()<{ tx_hash: string }[]>`SELECT tx_hash FROM contract_deploys WHERE id = ${id}`.catch(() => [{ tx_hash: 'x' }]);
    if (!row || row.tx_hash === '') return stop({ status: 'failed', show_to_builder: DEPLOY_LINES.failed });
    await sql()`UPDATE contract_deploys SET status = 'unknown' WHERE id = ${id} AND status = 'sent'`.catch(() => undefined);
    return { status: 'failed', show_to_builder: DEPLOY_PENDING };
  }
}

/** The deployer's address while deploys are on, else null. */
export function deployerAddress(): Address | null {
  return deployEnabled() ? deployerAccount()!.address : null;
}
