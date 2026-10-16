import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  http,
  isAddress,
  isHex,
  keccak256,
  WaitForTransactionReceiptTimeoutError,
  type Abi,
  type Address,
  type Chain as ViemChain,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { estimateL1Fee } from 'viem/op-stack';
import { CHAIN_NAMES } from './chains';
import { privateKeyProblem } from './cli';
import { sql } from './db';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { FREE_CAPS, forceFreeTier, giveBackFreeTier, takeFreeTier } from './free-tier';
import { loginBasisFor, provenOwnerLogin } from './github-verify';
import { llamaPrice } from './prices';
import { RateLimitError, enforce } from './rate-limit';
import { proofLineOwner, repoOwnershipPasses, repoSignedIn, type OwnershipDeps } from './token-gate';
import { markDeployed, rpcFor } from './verify';
import { benchEnabled } from './builder-score-flag';

/**
 * v2.10 item 13: EarnKit deploys the builder's own compiled contract on Arc or Base from its own
 * deployer key (DEPLOYER_PRIVATE_KEY, a hot key holding about $5 of gas per chain), with the builder
 * as the owner. Off until the key is set. The key signs only these deploys (value 0, no recipient)
 * and one transferOwnership(builder); it never sends money to anyone. Every cap is enforced before
 * the send, atomically: 1 deploy per builder per chain per day (rate_windows), 3 per builder per 30
 * days (a count over contract_deploys under a lock, Pre-flight P16), 20 a day in total and $10 of
 * gas a month (free_tier_usage, R18: the upper bound of the deploy plus one capped transfer, with
 * Base's L1 data fee, is reserved; the unused part given back, any overage always counted). A
 * builder is their verified GitHub login, else their installation (a shared client without a login:
 * the repo key).
 */

export const DEPLOY_CAPS = {
  initcodeBytes: 49_152,
  runtimeBytes: 24_576,
  perDeployUsd: 0.25,
  monthMicroUsd: 10_000_000,
  dayTotal: 20,
  perBuilderChainDay: 1,
  perBuilder30d: 3,
  /** v2.11 T9 security fix N2: per repo, loose enough that no one prover locks the owner out. */
  perRepoChainDay: 3,
  perRepo30d: 10,
} as const;

/** v2.11 T9 security fix R3: the agent's note when a proof-line-only deploy has no proven owner login (final fix M5: a fresh push, as BUILD_OWNER_NOTE asks). */
export const OWNER_PROOF_NOTE =
  "EarnKit deploys from the earnkit.txt line only for the repo owner's own account: the owner's own push of the line (not a merge, " +
  "a bot or a collaborator), the builder's GitHub username passed to find, and an account at least 30 days old with a public repo. " +
  "A push from before the line was shown never counts: make a fresh commit (any small change, earnkit.txt kept) and push it now from the builder's own account to a repo they own, " +
  'never a force push, then call this again; or sign in with GitHub where that is offered. If it is still refused, tell the builder in one short line.';

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
  factory: "I can't deploy a contract that creates other contracts.",
  blocked: "I can't deploy for you any more.",
} as const;

/** The deploy was sent but its receipt didn't come within the call (10.9). */
export const DEPLOY_PENDING = 'The deploy is still going. It can take a few minutes.';
/** Fix round 1 (M1): the send threw, so it may or may not be on chain. */
export const DEPLOY_UNCONFIRMED = "I couldn't confirm the deploy. EarnKit is checking it.";

export const deployedLine = (name: string, chain: DeployChainName, address: string, owner: boolean) =>
  `${name} is deployed on ${CHAIN_NAMES[chain]}: ${shortWallet(address)}.${owner ? " You're the owner." : ''}`;

/** The $0.25 per-deploy cap in micro-USD. */
const PER_DEPLOY_MICRO = BigInt(Math.round(DEPLOY_CAPS.perDeployUsd * 1_000_000));
/**
 * Fix round 1 (C1): the gas cap on the one transferOwnership(builder) call. Its cost at the deploy's
 * fee cap is reserved with the deploy, before anything is sent.
 */
export const TRANSFER_GAS = 100_000n;
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

/**
 * Fix round 1 (I4): the opcodes of `code`, PUSH data skipped and Solidity's trailing CBOR metadata
 * (its length in the last 2 bytes) left out. Pure.
 */
function opcodes(code: Hex): number[] {
  const bytes = Buffer.from(code.slice(2), 'hex');
  let end = bytes.length;
  if (end >= 2) {
    const meta = bytes.readUInt16BE(end - 2);
    if (meta > 0 && meta + 2 <= end && bytes[end - 2 - meta] >= 0xa0 && bytes[end - 2 - meta] <= 0xbf) end -= meta + 2;
  }
  const ops: number[] = [];
  for (let i = 0; i < end; i++) {
    const op = bytes[i];
    ops.push(op);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return ops;
}

/**
 * Fix round 1 (I4): why EarnKit won't deploy a contract whose runtime (from an eth_call of the
 * creation) is this, or null: over 24 KB (EIP-170), an ERC-20 (all three selectors PUSH4ed), or a
 * factory (CREATE or CREATE2 in its code). Proxies (DELEGATECALL) stay allowed: a risk the owner
 * accepted. Pure.
 */
export function runtimeRefusal(runtime: Hex): string | null {
  if (!isHex(runtime, { strict: true }) || runtime.length % 2 !== 0) return DEPLOY_LINES.failed;
  if ((runtime.length - 2) / 2 > DEPLOY_CAPS.runtimeBytes) return DEPLOY_LINES.tooBig;
  const code = runtime.toLowerCase().slice(2);
  if (ERC20_SELECTORS.every((s) => code.includes(`63${s}`))) return DEPLOY_LINES.token;
  if (opcodes(runtime).some((op) => op === 0xf0 || op === 0xf5)) return DEPLOY_LINES.factory;
  return null;
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

const DEPLOY_CHAIN_NAMES = ['arc', 'base'] as const satisfies readonly DeployChainName[];
let chainsWarned = false;
/**
 * v2.10.3: the chains EarnKit deploys on, from DEPLOY_CHAINS (comma-separated, any case, from arc and
 * base). Unset or blank: both. An entry that is neither is ignored and logged once, by the variable's
 * name only, never its value. Nothing valid left: no chain. Never throws.
 */
export function deployChains(env: Record<string, string | undefined> = process.env): DeployChainName[] {
  const raw = env.DEPLOY_CHAINS?.trim();
  if (!raw) return [...DEPLOY_CHAIN_NAMES];
  const asked = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (asked.some((e) => !(DEPLOY_CHAIN_NAMES as readonly string[]).includes(e)) && !chainsWarned) {
    console.error('[deploy] DEPLOY_CHAINS: ignored an entry that is not arc or base.');
    chainsWarned = true;
  }
  return DEPLOY_CHAIN_NAMES.filter((c) => asked.includes(c));
}

/** v2.10.3: deploys are on for `c`: deployEnabled and `c` in DEPLOY_CHAINS. Never throws. */
export function deployChainOn(c: DeployChainName, env: Record<string, string | undefined> = process.env): boolean {
  return deployChains(env).includes(c) && deployEnabled(env);
}

/** v2.10.3: the builder's line for a deploy on a chain EarnKit doesn't deploy on. */
export const deployOffLine = (c: DeployChainName) => `Deploys on ${CHAIN_NAMES[c]} are off right now.`;
/** v2.10.3: the agent's note with deployOffLine. */
export const deployOffNote = (c: DeployChainName) => `EarnKit doesn't deploy on ${CHAIN_NAMES[c]} right now. Don't retry it there.`;

/** The chain reads and the two writes a deploy needs; replaced in tests. */
export type DeployChain = {
  /**
   * The creation's gas limit, the fee cap, and on Base the L1 data fee (the creation plus one
   * transferOwnership; fix round 1 I2). Throws when the constructor reverts or the RPC is another chain.
   */
  estimate(a: { data: Hex; from: Address }): Promise<{ gas: bigint; maxFeePerGas: bigint; l1Fee?: bigint }>;
  /**
   * Fix round 1 (I4): an eth_call of the creation (no `to`): the runtime the chain would store. Fix
   * round 2 (N3): with the estimate's gas and fee cap, as the send will have them.
   */
  simulate(a: { data: Hex; from: Address; gas: bigint; maxFeePerGas: bigint }): Promise<Hex>;
  /** Fix round 2 (N2): an address's nonce (a contract's: 1 + the contracts it created, EIP-161). */
  nonce(a: Address): Promise<number>;
  balance(a: Address): Promise<bigint>;
  send(a: { data: Hex; gas: bigint; maxFeePerGas: bigint }): Promise<Hex>;
  receipt(
    hash: Hex,
    timeoutMs: number,
  ): Promise<{
    status: 'success' | 'reverted';
    contractAddress: Address | null;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    l1Fee?: bigint | null;
    /** v2.11 T3: the block it landed in (the deployed event's detail.block, where usage checks start). */
    blockNumber?: bigint;
  } | null>;
  code(a: Address): Promise<Hex>;
  /** A view call: its result; null when it reverts or returns nothing (no such function); throws on an RPC error. */
  read(a: { address: Address; abi: Abi; fn: string; args?: unknown[] }): Promise<unknown>;
  write(a: { address: Address; abi: Abi; fn: string; args: unknown[]; gas: bigint; maxFeePerGas: bigint }): Promise<Hex>;
};

export type DeployDeps = {
  chain?: (c: DeployChainName) => DeployChain | null;
  usdPerNative?: (c: DeployChainName) => Promise<number>;
  now?: Date;
  /** Test seam: the ownership proof's reads (token-gate.ts GateDeps). */
  gate?: OwnershipDeps;
  /** Test seam: how long to wait for a receipt (default 30 s). */
  receiptMs?: number;
  /** Test seam for tools.ts deployStep: the installation's verified login (github-verify.ts installationLogin). */
  installationLogin?: (installationId: number) => Promise<string | null>;
  /** Test seam for tools.ts deployStep on a shared client: the caller's verified login (github-verify.ts callerLogin). */
  callerLogin?: (installationId: number, signedIn: string | undefined) => Promise<string | null>;
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
const queued = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = sendQueue.then(fn);
  sendQueue = run.catch(() => undefined);
  return run;
};

/** A revert or an empty answer (no such function), as opposed to an RPC failure. */
const noSuchCall = (err: unknown) =>
  err instanceof BaseError &&
  err.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError) !== null;

/** The raw probes (fix round 1, I5): never the builder's ABI. */
export const OWNER_ABI = [{ type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' }] as const satisfies Abi;
export const HAS_ROLE_ABI = [
  { type: 'function', name: 'hasRole', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
] as const satisfies Abi;
export const TRANSFER_ABI = [
  { type: 'function', name: 'transferOwnership', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
] as const satisfies Abi;
const DEFAULT_ADMIN_ROLE = `0x${'00'.repeat(32)}` as Hex;

/** The viem DeployChain for `c`, or null (deploys off, `c` not in DEPLOY_CHAINS, or no RPC for the chain). */
export function viemDeployChain(c: DeployChainName): DeployChain | null {
  if (!deployChains().includes(c)) return null;
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
  const capTip = (maxFeePerGas: bigint) => (tip < maxFeePerGas ? tip : maxFeePerGas);
  return {
    estimate: async ({ data, from }) => {
      // Fix round 1 (M6): the RPC is the chain we price for, before anything else.
      const id = await pub.getChainId();
      if (id !== chain.id) throw new Error(`RPC chain id ${id}, expected ${chain.id}`);
      const [gas, fees] = await Promise.all([pub.estimateGas({ account: from, data }), pub.estimateFeesPerGas()]);
      tip = fees.maxPriorityFeePerGas ?? 0n;
      let l1Fee = 0n;
      if (c === 'base') {
        // Fix round 1 (I2): the OP Stack L1 data fee (GasPriceOracle.getL1Fee, a free eth_call) for
        // the creation and for one transferOwnership.
        const transfer = encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transferOwnership', args: [from] });
        const [a, b] = await Promise.all([
          estimateL1Fee(pub, { account: from, data, chain: base }),
          estimateL1Fee(pub, { account: from, to: from, data: transfer, chain: base }),
        ]);
        l1Fee = a + b;
      }
      // 20% over the estimate as the gas limit, so a small state change can't make it run out.
      return { gas: (gas * 12n) / 10n, maxFeePerGas: fees.maxFeePerGas ?? (await pub.getGasPrice()), l1Fee };
    },
    simulate: async ({ data, from, gas, maxFeePerGas }) =>
      (await pub.call({ account: from, data, gas, maxFeePerGas, maxPriorityFeePerGas: capTip(maxFeePerGas) })).data ?? '0x',
    nonce: (a) => pub.getTransactionCount({ address: a }),
    balance: (a) => pub.getBalance({ address: a }),
    // No `to` and no `value`: a contract creation that moves no money.
    send: ({ data, gas, maxFeePerGas }) =>
      queued(() => wallet.sendTransaction({ data, gas, maxFeePerGas, maxPriorityFeePerGas: capTip(maxFeePerGas) })),
    receipt: async (hash, timeoutMs) => {
      try {
        const r = await pub.waitForTransactionReceipt({ hash, timeout: timeoutMs });
        const l1Fee = (r as { l1Fee?: bigint | null }).l1Fee ?? null;
        return { status: r.status, contractAddress: r.contractAddress ?? null, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice, l1Fee, blockNumber: r.blockNumber };
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) return null;
        throw err;
      }
    },
    code: async (a) => (await pub.getCode({ address: a })) ?? '0x',
    read: async ({ address, abi, fn, args }) => {
      try {
        return await pub.readContract({ address, abi, functionName: fn, args });
      } catch (err) {
        if (noSuchCall(err)) return null;
        throw err;
      }
    },
    // Fix round 1 (C1): an explicit gas cap and fee cap, never viem's own estimate.
    write: ({ address, abi, fn, args, gas, maxFeePerGas }) =>
      queued(() => wallet.writeContract({ address, abi, functionName: fn, args, chain, account, gas, maxFeePerGas, maxPriorityFeePerGas: capTip(maxFeePerGas) })),
  };
}

/** Fix round 2 (N5): the ETH/USD prices a deploy trusts; anything outside is a bad read (refused, R18). */
export const ETH_USD_BAND = { min: 500, max: 20_000 } as const;

/**
 * USD per whole native token: ETH on Base from DefiLlama (throws when it can't say, or when the price
 * is outside ETH_USD_BAND), USDC on Arc at $1.
 */
export async function nativeUsd(c: DeployChainName, ethPrice: () => Promise<number> = async () => (await llamaPrice('coingecko:ethereum')).price): Promise<number> {
  if (c === 'arc') return 1;
  const price = await ethPrice();
  if (!(price >= ETH_USD_BAND.min && price <= ETH_USD_BAND.max)) throw new Error('ETH price outside the trusted band');
  return price;
}

/** `wei` of the native token in micro-USD, rounded up. Pure. */
export function weiToMicroUsd(wei: bigint, usd: number): bigint {
  if (!(usd > 0) || !Number.isFinite(usd)) throw new Error('no price');
  const microPerToken = BigInt(Math.ceil(usd * 1_000_000));
  const unit = 10n ** NATIVE_DECIMALS;
  return (wei * microPerToken + unit - 1n) / unit;
}

const sameAddr = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const errName = (err: unknown) => (err instanceof Error ? err.name : 'error');

/**
 * v2.10 item 13: deploys the builder's artifact on `input.chain` with the builder as owner, within
 * every cap, or says why not. Order (Review Focus 3): on; the artifact's guards; the repo is the
 * builder's (R19); the per-day limit (atomic, before any chain read, so a race passes once); the
 * 30-day count and the row's reservation under one lock; the day's total; the simulated runtime
 * (fix round 1 I4); the estimate (with Base's L1 fee) and price (a failed price read refuses, R18);
 * the $0.25 cap on the deploy plus one capped transfer (C1); the deployer's balance; the month's
 * reserve; the send. Never throws. Once the send was attempted nothing is given back (I3): a chain or
 * DB error after it is "unknown" and flagged for the owner, never retried by this call.
 *
 * `shared`: the call is from a shared client, and `login` is its caller's verified login (null:
 * none). Off a shared client `login` is the installation's verified login (or null) and keys the
 * limits only (fix round 1 I6).
 */
export async function deployForBuilder(
  a: {
    installationId: number;
    login: string | null;
    shared: boolean;
    repoKey: string;
    projectName: string;
    builderWallet: Address;
    input: DeployInput;
    /**
     * v2.11 T9 (ruling R-T6): the starter a build-path deploy came from, for its usage checks. The
     * deployed event names it only when the bytecode is exactly the starter's own (security fixes
     * M3, N1: keccak256 of `bytecode` equals `bytecode_hash`); else `starter: null`, so the checks
     * fall back.
     */
    starter?: { id: string; bytecode_hash: string | null };
    /**
     * v2.11 T9 security fix (I1): who pushed the earnkit.txt line (token-gate.ts proofLineOwner), when
     * the caller already read it; undefined: read here (off a shared client). Kept on the row, and a
     * cap key (I3) and the only way a proof-line login is ever recorded.
     */
    lineOwner?: string | null;
    /**
     * v2.11 T9 security fix (M4): runs once every cap has passed, just before the send (the build
     * path's `built` event). Never throws into the deploy.
     */
    beforeSend?: () => Promise<void>;
  },
  deps: DeployDeps = {},
): Promise<DeployOutcome> {
  const now = deps.now ?? new Date();
  const started = Date.now();
  const c = a.input.chain;
  const refused = (line: string) => ({ status: 'refused' as const, show_to_builder: line });
  const paused = (agent_note?: string): DeployOutcome => ({ status: 'unavailable', show_to_builder: DEPLOY_LINES.lowBalance, ...(agent_note && { agent_note }) });
  if (!deployEnabled() || (c !== 'arc' && c !== 'base')) return { status: 'unavailable', show_to_builder: DEPLOY_LINES.off };
  // v2.10.3: a chain left out of DEPLOY_CHAINS is refused here, before any read or reservation.
  const on = deployChains();
  if (!on.length) return { status: 'unavailable', show_to_builder: DEPLOY_LINES.off };
  if (!on.includes(c)) return { status: 'unavailable', show_to_builder: deployOffLine(c), agent_note: deployOffNote(c) };
  const chain = (deps.chain ?? viemDeployChain)(c);
  const deployer = deployerAccount()!.address;
  if (!chain) return { status: 'unavailable', show_to_builder: DEPLOY_LINES.off };
  const bad = deployRefusal(a.input);
  if (bad) return refused(bad);
  if (!isAddress(a.builderWallet, { strict: false })) return refused(DEPLOY_LINES.failed);
  // v2.13.1 O2 fix round 1 (fresh-build ruling): under the Bench a build's proof branch proves the repo (no line).
  const branchOwner = !a.shared && benchEnabled() ? await (await import('./proof-branch')).branchProvenOwner(a.installationId, a.repoKey, now) : null;
  const owns =
    branchOwner !== null ||
    (await repoOwnershipPasses(
      { installationId: a.installationId, repoUrl: `https://github.com/${a.repoKey}`, verifiedLogin: a.shared ? a.login : undefined },
      deps.gate,
    ));
  if (!owns) return refused(DEPLOY_LINES.notYours);
  const repoKey = a.repoKey.toLowerCase();
  // v2.11 T9 security fix R3: off a shared client with no sign-in or App proof of the repo, the
  // earnkit.txt line alone is push access, and installations, repos and wallets are free. So a deploy
  // there needs a proven login: GitHub's push record says the repo's owner wrote the line, the
  // builder said that login is theirs, it is a User, and it passes the host gate (30 days, 1 public
  // repo). Its caps are that login's. A sign-in or App proof keeps the v2.10 path unchanged.
  const signedIn = a.shared || (await repoSignedIn({ installationId: a.installationId, repoKey }, deps.gate));
  const lineOwner = a.shared ? null : a.lineOwner !== undefined ? a.lineOwner : branchOwner ?? (signedIn ? null : await proofLineOwner({ installationId: a.installationId, repoUrl: `https://github.com/${a.repoKey}` }, deps.gate));
  const owner = a.shared || !lineOwner ? null : await provenOwnerLogin(a.installationId, repoKey, lineOwner);
  if (!signedIn && !owner) return { ...refused(DEPLOY_LINES.notYours), agent_note: OWNER_PROOF_NOTE };
  const wallet = a.builderWallet.toLowerCase();
  // Final fix wave F1: the row names the starter only for its exact bytecode (as the deployed event does).
  const exactStarter =
    a.starter && a.starter.bytecode_hash !== null && keccak256(a.input.bytecode) === a.starter.bytecode_hash.toLowerCase() ? a.starter.id : null;
  // Fix round 1 (I6): the builder is their verified login, else their installation.
  const who = (a.login ? a.login : a.shared ? a.repoKey : `installation:${a.installationId}`).toLowerCase();
  try {
    await enforce('deployDay', `${who}:${c}`, DEPLOY_LINES.limit);
  } catch (err) {
    if (err instanceof RateLimitError) return refused(DEPLOY_LINES.limit);
    console.error('[deploy] day limit', errName(err));
    return paused();
  }
  // Pre-flight P16: the 30-day count and the reservation in one transaction, under a lock per builder.
  // v2.11 T9 security fixes (I3, R2, R3, N2): the same caps also hold per proven owner login (once a
  // day per chain, 3 in 30 days), and a looser per-repo cap stops farming one repo (3 a day per chain,
  // 10 in 30 days, so a collaborator can't lock the owner out). Never per wallet: a wallet is only
  // named, so a cap on it would let anyone block a victim's deploys. Each key is locked (sorted, so
  // two deploys never deadlock).
  let rowId: number | 'blocked' | null;
  try {
    rowId = await sql().begin(async (tx) => {
      const locks = [`contract-deploy:${who}`, `contract-deploy-repo:${repoKey}`, ...(owner ? [`contract-deploy-owner:${owner}`] : [])].sort();
      for (const k of locks) await tx`SELECT pg_advisory_xact_lock(hashtext(${k}))`;
      const [{ n }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM contract_deploys
        WHERE builder_key = ${who} AND created_at > now() - interval '30 days'`;
      if (n >= DEPLOY_CAPS.perBuilder30d) return null;
      const [o] = await tx<{ repo30: number; repoDay: number; owner30: number; ownerDay: number }[]>`
        SELECT
          count(*) FILTER (WHERE repo_key = ${repoKey})::int AS repo30,
          count(*) FILTER (WHERE repo_key = ${repoKey} AND chain = ${c} AND created_at > now() - interval '1 day')::int AS "repoDay",
          count(*) FILTER (WHERE line_owner = ${owner})::int AS owner30,
          count(*) FILTER (WHERE line_owner = ${owner} AND chain = ${c} AND created_at > now() - interval '1 day')::int AS "ownerDay"
        FROM contract_deploys
        WHERE created_at > now() - interval '30 days' AND (repo_key = ${repoKey} OR line_owner = ${owner})`;
      if (o.repo30 >= DEPLOY_CAPS.perRepo30d || o.owner30 >= DEPLOY_CAPS.perBuilder30d) return null;
      if (o.repoDay >= DEPLOY_CAPS.perRepoChainDay || o.ownerDay >= DEPLOY_CAPS.perBuilderChainDay) return null;
      // Fix round 2 (N2): a builder whose contract created contracts at deploy deploys no more.
      const [blocked] = await tx`SELECT 1 FROM contract_deploys WHERE builder_key = ${who} AND blocked LIMIT 1`;
      if (blocked) return 'blocked' as const;
      const [row] = await tx<{ id: number }[]>`
        INSERT INTO contract_deploys (installation_id, login, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, owner_wallet, line_owner, starter)
        VALUES (${a.installationId}, ${a.login?.toLowerCase() ?? null}, ${who}, ${repoKey}, ${c}, '', 'sent', 0,
          ${wallet}, ${owner}, ${exactStarter})
        RETURNING id`;
      return row.id;
    });
  } catch (err) {
    console.error('[deploy] reserve', errName(err));
    return paused();
  }
  if (rowId === null) return refused(DEPLOY_LINES.limit);
  if (rowId === 'blocked') return refused(DEPLOY_LINES.blocked);
  const id = rowId;
  let dayTaken = false;
  let reserved = 0;
  // Fix round 1 (I3): set just before the send; from then on nothing is given back or deleted.
  let sendAttempted = false;
  /** Nothing was sent: the reservation and the counters taken so far go back. */
  const release = async () => {
    if (sendAttempted) return;
    await sql()`DELETE FROM contract_deploys WHERE id = ${id} AND tx_hash = ''`.catch((err: unknown) => console.error('[deploy] release', errName(err)));
    if (dayTaken) await giveBackFreeTier('deploysDay', 1, now).catch(() => undefined);
    if (reserved > 0) await giveBackFreeTier('deployGasMonth', reserved, now).catch(() => undefined);
  };
  const stop = async (out: DeployOutcome) => {
    await release();
    return out;
  };
  const markUnknown = async (extra: { hash?: Hex; cost?: number } = {}) => {
    await sql()`
      UPDATE contract_deploys SET status = 'unknown'
        ${extra.hash ? sql()`, tx_hash = ${extra.hash}` : sql()``}
        ${extra.cost !== undefined ? sql()`, cost_micro_usd = ${extra.cost}` : sql()``}
      WHERE id = ${id}`.catch((err: unknown) => console.error('[deploy] mark unknown', errName(err)));
  };
  try {
    if (!(await takeFreeTier('deploysDay', 1, now))) return stop(refused(DEPLOY_LINES.dayFull));
    dayTaken = true;
    const data = initcode(a.input);
    // Fix round 1 (I4): what the chain would store, checked before anything is spent.
    let runtime: Hex;
    let est: { gas: bigint; maxFeePerGas: bigint; l1Fee?: bigint };
    try {
      est = await chain.estimate({ data, from: deployer });
      // Fix round 2 (N3): simulated with the gas and fee cap the send will carry.
      runtime = await chain.simulate({ data, from: deployer, gas: est.gas, maxFeePerGas: est.maxFeePerGas });
    } catch (err) {
      console.error('[deploy] estimate', errName(err));
      return stop({ status: 'failed', show_to_builder: DEPLOY_LINES.failed, agent_note: 'Estimating the deploy failed: the constructor reverts with these arguments, or the chain is unreachable. Check the arguments and try tomorrow.' });
    }
    const badRuntime = runtimeRefusal(runtime);
    if (badRuntime) return stop(refused(badRuntime));
    // Fix round 1 (C1, I2): the deploy, one capped transfer, and (Base) twice the L1 data fee estimate.
    const upperWei = est.gas * est.maxFeePerGas + TRANSFER_GAS * est.maxFeePerGas + 2n * (est.l1Fee ?? 0n);
    let usd: number;
    let upperMicro: bigint;
    try {
      usd = await (deps.usdPerNative ?? nativeUsd)(c);
      upperMicro = weiToMicroUsd(upperWei, usd);
    } catch (err) {
      // R18: no price, no deploy.
      console.error('[deploy] price', errName(err));
      return stop(paused("EarnKit couldn't price the gas right now. Try later."));
    }
    // Fix round 1 (M6): a price that can't be right (a big deploy for under 100 micro-USD) refuses.
    if (est.gas > 100_000n && upperMicro < 100n) return stop(paused("EarnKit couldn't price the gas right now. Try later."));
    if (upperMicro > PER_DEPLOY_MICRO) return stop(refused(DEPLOY_LINES.high));
    const balance = await chain.balance(deployer);
    if (balance < upperWei) return stop(paused(`The deployer wallet on ${CHAIN_NAMES[c]} needs a top-up; the owner is told.`));
    const upper = Number(upperMicro);
    if (upper > FREE_CAPS.deployGasMonth.cap || !(await takeFreeTier('deployGasMonth', upper, now))) return stop(refused(DEPLOY_LINES.paused));
    reserved = upper;
    let hash: Hex;
    await a.beforeSend?.().catch((err: unknown) => console.error('[deploy] before send', errName(err)));
    sendAttempted = true;
    try {
      // No `value`, no `to`: a contract creation.
      hash = await chain.send({ data, gas: est.gas, maxFeePerGas: est.maxFeePerGas });
    } catch (err) {
      // It may have reached the chain: keep every counter and flag it for the owner.
      console.error('[deploy] send', errName(err));
      await markUnknown({ cost: upper });
      return { status: 'failed', show_to_builder: DEPLOY_UNCONFIRMED, agent_note: 'Sending the deploy failed; the owner checks whether it went out. Do not retry today.' };
    }
    await sql()`UPDATE contract_deploys SET tx_hash = ${hash}, cost_micro_usd = ${upper} WHERE id = ${id}`;
    const left = () => Math.max(1, (deps.receiptMs ?? RECEIPT_MS) - (Date.now() - started));
    const receipt = await chain.receipt(hash, left()).catch((err: unknown) => {
      console.error('[deploy] receipt', errName(err));
      return null;
    });
    if (!receipt || (receipt.status === 'success' && !receipt.contractAddress)) {
      await markUnknown({ hash });
      return {
        status: 'failed',
        show_to_builder: DEPLOY_PENDING,
        agent_note: `The deploy was sent (transaction ${hash} on ${CHAIN_NAMES[c]}) but isn't confirmed yet. Read its receipt on the explorer for the contract address; do not deploy again.`,
      };
    }
    let spent = receipt.gasUsed * receipt.effectiveGasPrice + (receipt.l1Fee ?? 0n);
    const settle = async (status: 'deployed' | 'reverted', fields: { address?: string; owner_ok?: boolean | null; code_differs?: true }) => {
      const cost = Number(weiToMicroUsd(spent, usd));
      if (cost < reserved) await giveBackFreeTier('deployGasMonth', reserved - cost, now);
      // C1: an overage is always counted, even past the ceiling, so the next deploy stops.
      else if (cost > reserved) await forceFreeTier('deployGasMonth', cost - reserved, now);
      await sql()`
        UPDATE contract_deploys SET status = ${status}, address = ${fields.address ?? null},
          owner_ok = ${fields.owner_ok ?? null}, cost_micro_usd = ${cost},
          block = ${receipt.blockNumber !== undefined ? receipt.blockNumber.toString() : null}::bigint,
          code_differs = ${fields.code_differs === true}
        WHERE id = ${id}`;
    };
    // v2.11 T3: the row is `deployed`: its event, with the tx, the address, the block and the owner check.
    const deployedEvent = (address: string, ownerOk: boolean | null, codeDiffers = false) =>
      noteEvent('deployed', async () => {
        const who = await loginBasisFor(a.installationId, a.repoKey, a.shared ? { callerLogin: a.login } : { lineOwner: owner });
        return {
          type: 'deployed',
          dedupe_key: `deployed:${id}`,
          installation_id: a.installationId,
          repo_key: a.repoKey,
          chain: c,
          proof_tx: hash,
          wallet: a.builderWallet,
          ...(who && { github_login: who.login, login_basis: who.basis }),
          detail: {
            address,
            owner_ok: ownerOk,
            ...(receipt.blockNumber !== undefined && { block: Number(receipt.blockNumber) }),
            ...(a.starter && { starter: a.starter.bytecode_hash !== null && keccak256(a.input.bytecode) === a.starter.bytecode_hash.toLowerCase() ? a.starter.id : null }),
            // Review M1: the builder was told not to use it; usage checks and the metric leave it out.
            ...(codeDiffers && { code_differs: true }),
          },
        };
      });
    if (receipt.status === 'reverted') {
      await settle('reverted', {});
      return { status: 'failed', show_to_builder: DEPLOY_LINES.failed, agent_note: 'The deploy reverted on chain (the constructor failed).' };
    }
    const address = receipt.contractAddress!;
    const code = await chain.code(address).catch((err: unknown) => {
      console.error('[deploy] code', errName(err));
      return null;
    });
    if (code !== null && runtimeRefusal(code) !== null) {
      // The stored code isn't what the simulation said: deployed, never cached, flagged for the owner.
      await settle('deployed', { address: address.toLowerCase(), owner_ok: false, code_differs: true });
      await deployedEvent(address.toLowerCase(), false, true);
      return { status: 'failed', show_to_builder: runtimeRefusal(code)!, agent_note: 'The deployed code differs from the check; the owner is told. Do not use this address.' };
    }
    // Fix round 1 (I5): the owner step probes owner() and hasRole(DEFAULT_ADMIN_ROLE, deployer)
    // directly, whatever the builder's ABI says. One transferOwnership(builder), capped, only when the
    // deployer owns it. The deployer still owner or admin, or a probe that failed: owner_ok false.
    let ownerOk: boolean | null = null;
    try {
      const readOwner = () => chain.read({ address, abi: OWNER_ABI, fn: 'owner' });
      let owner = await readOwner();
      if (sameAddr(owner, deployer)) {
        try {
          const tx = await chain.write({ address, abi: TRANSFER_ABI, fn: 'transferOwnership', args: [a.builderWallet], gas: TRANSFER_GAS, maxFeePerGas: est.maxFeePerGas });
          const r = await chain.receipt(tx, left()).catch(() => null);
          // No receipt: count the transfer's whole cap (its share of the reserve stays taken).
          spent += r ? r.gasUsed * r.effectiveGasPrice + (r.l1Fee ?? 0n) : TRANSFER_GAS * est.maxFeePerGas;
          owner = await readOwner();
        } catch (err) {
          console.error('[deploy] transferOwnership', errName(err));
          spent += TRANSFER_GAS * est.maxFeePerGas;
        }
      }
      const admin = await chain.read({ address, abi: HAS_ROLE_ABI, fn: 'hasRole', args: [DEFAULT_ADMIN_ROLE, deployer] });
      if (admin === true || sameAddr(owner, deployer)) ownerOk = false;
      else if (owner !== null) ownerOk = sameAddr(owner, a.builderWallet);
      else if (admin !== null && admin !== false) ownerOk = false;
    } catch (err) {
      console.error('[deploy] owner probe', errName(err));
      ownerOk = false;
    }
    // Fix round 2 (N2): a nonce above 1 means the constructor created contracts (EIP-161): flagged,
    // never cached, and this builder deploys no more. A failed read can't confirm it: flagged.
    const nonce = await chain.nonce(address).catch((err: unknown) => {
      console.error('[deploy] nonce', errName(err));
      return null;
    });
    const children = nonce !== null && nonce > 1;
    if (children || nonce === null) ownerOk = false;
    if (code !== null && !children) await markDeployed(c, address).catch((err: unknown) => console.error('[deploy] cache', errName(err)));
    if (children) await sql()`UPDATE contract_deploys SET blocked = true WHERE id = ${id}`;
    await settle('deployed', { address: address.toLowerCase(), owner_ok: ownerOk });
    await deployedEvent(address.toLowerCase(), ownerOk);
    return { status: 'deployed', address, owner_ok: ownerOk, show_to_builder: deployedLine(a.projectName, c, address, ownerOk === true) };
  } catch (err) {
    console.error('[deploy]', errName(err));
    // I3: before the send, nothing went out; after it, the row is flagged and every counter kept.
    if (!sendAttempted) return stop({ status: 'failed', show_to_builder: DEPLOY_LINES.failed });
    await markUnknown();
    return { status: 'failed', show_to_builder: DEPLOY_PENDING };
  }
}

/**
 * Final fix M8: a build-path deploy whose receipt didn't come within its call (left `unknown`, with
 * its tx hash) is settled when the same call is made again; nothing is ever sent twice. Read-only:
 * the receipt, the code, owner() and hasRole and the nonce, read as deployForBuilder reads them, but
 * with no transferOwnership (the build's starter takes its owner in the constructor; a contract the
 * deployer still owns reads owner_ok false). Only a row the build path sent for this starter's exact
 * bytecode and this build wallet (F1). The row is settled once (a concurrent settle wins) and writes
 * its `deployed` event. Null: no such row, or deploys are off. F3 (accepted): the cost stays at the
 * reserved upper bound (over-counted, the safe side).
 */
export async function settlePendingDeploy(
  a: { installationId: number; repoKey: string; chain: DeployChainName; projectName: string; starterId: string; wallet: string },
  deps: DeployDeps = {},
): Promise<DeployOutcome | null> {
  if (!deployEnabled()) return null;
  const repoKey = a.repoKey.toLowerCase();
  const c = a.chain;
  // Final fix wave F1, F2: only a row this build path itself sent: the starter's exact bytecode
  // (contract_deploys.starter, set at reservation) for the build's current wallet. Any other
  // unconfirmed row is left alone (the normal path's day cap refuses a second deploy: fail closed).
  const [row] = await sql()<{ id: number; tx_hash: string; owner_wallet: string; line_owner: string | null; starter: string }[]>`
    SELECT id, tx_hash, owner_wallet, line_owner, starter FROM contract_deploys
    WHERE installation_id = ${a.installationId} AND repo_key = ${repoKey} AND chain = ${c} AND status = 'unknown' AND tx_hash <> ''
      AND starter = ${a.starterId} AND owner_wallet = ${a.wallet.toLowerCase()}
    ORDER BY id DESC LIMIT 1`;
  if (!row) return null;
  const chain = (deps.chain ?? viemDeployChain)(c);
  if (!chain) return null;
  const deployer = deployerAccount()!.address;
  const hash = row.tx_hash as Hex;
  const pending: DeployOutcome = {
    status: 'failed',
    show_to_builder: DEPLOY_PENDING,
    agent_note: `The deploy was sent (transaction ${hash} on ${CHAIN_NAMES[c]}) but isn't confirmed yet. Do not deploy again.`,
  };
  const receipt = await chain.receipt(hash, deps.receiptMs ?? RECEIPT_MS).catch((err: unknown) => {
    console.error('[deploy] settle receipt', errName(err));
    return null;
  });
  if (!receipt || (receipt.status === 'success' && !receipt.contractAddress)) return pending;
  const block = receipt.blockNumber !== undefined ? receipt.blockNumber.toString() : null;
  if (receipt.status === 'reverted') {
    await sql()`UPDATE contract_deploys SET status = 'reverted', block = ${block}::bigint WHERE id = ${row.id} AND status = 'unknown'`;
    return { status: 'failed', show_to_builder: DEPLOY_LINES.failed, agent_note: 'The deploy reverted on chain (the constructor failed).' };
  }
  const address = receipt.contractAddress!;
  const code = await chain.code(address).catch((err: unknown) => {
    console.error('[deploy] settle code', errName(err));
    return null;
  });
  if (code === null) return pending;
  const differs = runtimeRefusal(code) !== null;
  let ownerOk: boolean | null = false;
  if (!differs) {
    try {
      const owner = await chain.read({ address, abi: OWNER_ABI, fn: 'owner' });
      const admin = await chain.read({ address, abi: HAS_ROLE_ABI, fn: 'hasRole', args: [DEFAULT_ADMIN_ROLE, deployer] });
      if (admin === true || sameAddr(owner, deployer)) ownerOk = false;
      else if (owner !== null) ownerOk = sameAddr(owner, row.owner_wallet);
      else ownerOk = admin !== null && admin !== false ? false : null;
    } catch (err) {
      console.error('[deploy] settle owner probe', errName(err));
      ownerOk = false;
    }
  }
  const nonce = await chain.nonce(address).catch(() => null);
  const children = nonce !== null && nonce > 1;
  if (children || nonce === null) ownerOk = false;
  const lower = address.toLowerCase();
  const [settled] = await sql()<{ id: number }[]>`
    UPDATE contract_deploys SET status = 'deployed', address = ${lower}, owner_ok = ${ownerOk}, block = ${block}::bigint,
      code_differs = ${differs}, blocked = blocked OR ${children}
    WHERE id = ${row.id} AND status = 'unknown' RETURNING id`;
  if (settled) {
    if (!differs && !children) await markDeployed(c, address).catch((err: unknown) => console.error('[deploy] cache', errName(err)));
    await noteEvent('deployed', async () => {
      const who = await loginBasisFor(a.installationId, repoKey, { lineOwner: row.line_owner });
      return {
        type: 'deployed',
        dedupe_key: `deployed:${row.id}`,
        installation_id: a.installationId,
        repo_key: repoKey,
        chain: c,
        proof_tx: hash,
        wallet: row.owner_wallet,
        ...(who && { github_login: who.login, login_basis: who.basis }),
        detail: {
          address: lower,
          owner_ok: ownerOk,
          ...(block !== null && { block: Number(block) }),
          starter: row.starter, // the row's own label, set only on the exact bytecode (F1)
          ...(differs && { code_differs: true }),
          settled_later: true,
        },
      };
    });
  }
  if (differs) return { status: 'failed', show_to_builder: runtimeRefusal(code)!, agent_note: 'The deployed code differs from the check; the owner is told. Do not use this address.' };
  return { status: 'deployed', address, owner_ok: ownerOk, show_to_builder: deployedLine(a.projectName, c, address, ownerOk === true) };
}

/** The deployer's address while deploys are on, else null. */
export function deployerAddress(): Address | null {
  return deployEnabled() ? deployerAccount()!.address : null;
}
