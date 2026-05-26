import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  zeroAddress,
  type Abi,
} from 'viem';
import { getBasePublicClient, type BasePublicClient } from './splitsWarehouse';

/**
 * Uniswap V4 swap helpers for the buyback worker. Doppler tokens (created via
 * tokens.fun) trade on Uniswap V4 through the RehypeDopplerHook + multicurve
 * initializer; they have no V3 pool. This module mirrors the production swap
 * path that tokens.fun's client uses (lib/services/buybackService.ts), but
 * server-side and via Turnkey signing.
 *
 * Approval pattern (V4 requires Permit2 — direct ERC20 approve to
 * UniversalRouter does not work):
 *   1. token.approve(PERMIT2, MAX_UINT256)
 *   2. PERMIT2.approve(token, UNIVERSAL_ROUTER, MAX_UINT160, expiration)
 *
 * Swap encoding:
 *   UniversalRouter.execute(commands, inputs, deadline)
 *     commands = 0x10  (V4_SWAP)
 *     inputs[0] = V4Planner-encoded action stream:
 *       0x06 SWAP_EXACT_IN_SINGLE  { poolKey, zeroForOne, amountIn, amountOutMinimum, hookData }
 *       0x0b SETTLE_ALL            (inputCurrency, amountIn)
 *       0x0f TAKE_ALL              (outputCurrency, minAmountOut)
 */

export const UNIVERSAL_ROUTER_BASE =
  '0x6ff5693b99212da76ad316178a184ab56d299b43' as const;
export const PERMIT2_BASE =
  '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
export const STATE_VIEW_BASE =
  '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71' as const;
export const WETH_BASE_V4 =
  '0x4200000000000000000000000000000000000006' as const;

// V4Planner action codes (mirrors @uniswap/v4-sdk Actions enum).
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE = 0x0b;
const ACTION_TAKE_ALL = 0x0f;

// UniversalRouter command code for V4_SWAP
const COMMAND_V4_SWAP = 0x10;

const UNIVERSAL_ROUTER_ABI = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const satisfies Abi;

const PERMIT2_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    stateMutability: 'view',
  },
] as const satisfies Abi;

const STATE_VIEW_ABI = [
  {
    type: 'function',
    name: 'getSlot0',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
    stateMutability: 'view',
  },
] as const satisfies Abi;

export interface V4PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

export interface V4SwapPlan {
  poolKey: V4PoolKey;
  poolId: `0x${string}`;
  zeroForOne: boolean;
  inputCurrency: `0x${string}`;
  outputCurrency: `0x${string}`;
}

/**
 * Build the V4 pool key + poolId for a Doppler token given its hook address
 * and paired token (typically WETH). currency0 is always the lower address.
 */
export function buildV4SwapPlan(params: {
  tokenAddress: `0x${string}`;
  pairedToken: `0x${string}`;
  hook: `0x${string}`;
  fee: number;
  tickSpacing: number;
  // Which currency is the INPUT to the swap (e.g. WETH when buying tokenAddress).
  inputCurrency: `0x${string}`;
}): V4SwapPlan {
  const a = params.tokenAddress.toLowerCase();
  const b = params.pairedToken.toLowerCase();
  const currency0 = (a < b ? params.tokenAddress : params.pairedToken) as `0x${string}`;
  const currency1 = (a < b ? params.pairedToken : params.tokenAddress) as `0x${string}`;

  const poolId = keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [currency0, currency1, params.fee, params.tickSpacing, params.hook],
    ),
  );

  const zeroForOne = params.inputCurrency.toLowerCase() === currency0.toLowerCase();
  const outputCurrency = zeroForOne ? currency1 : currency0;

  return {
    poolKey: {
      currency0,
      currency1,
      fee: params.fee,
      tickSpacing: params.tickSpacing,
      hooks: params.hook,
    },
    poolId,
    zeroForOne,
    inputCurrency: params.inputCurrency,
    outputCurrency,
  };
}

/**
 * Estimate the swap output from the pool's current sqrtPriceX96 (StateView).
 * This is a worst-case "if-the-pool-doesn't-move" estimate — used as the
 * floor for slippage protection. Returns 0n if the pool isn't readable or
 * has no liquidity yet, in which case the caller MUST abort the swap to
 * avoid front-running.
 */
export async function estimateV4Output({
  plan,
  amountIn,
  client,
}: {
  plan: V4SwapPlan;
  amountIn: bigint;
  client?: BasePublicClient;
}): Promise<bigint> {
  const publicClient = client ?? getBasePublicClient();
  try {
    const slot0 = (await publicClient.readContract({
      address: STATE_VIEW_BASE,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [plan.poolId],
    })) as readonly [bigint, number, number, number];
    const sqrtPriceX96 = slot0[0];
    if (sqrtPriceX96 === BigInt(0)) return BigInt(0);
    const Q96 = BigInt(2) ** BigInt(96);
    if (plan.zeroForOne) {
      // selling currency0 for currency1: output ≈ in * sqrt^2 / Q96^2
      return ((amountIn * sqrtPriceX96) / Q96) * sqrtPriceX96 / Q96;
    } else {
      // selling currency1 for currency0: output ≈ in * Q96^2 / sqrt^2
      return ((amountIn * Q96) / sqrtPriceX96) * Q96 / sqrtPriceX96;
    }
  } catch {
    return BigInt(0);
  }
}

/**
 * V4 hook data — RehypeDopplerHook (the hook every Doppler-deployed token
 * uses) expects empty bytes. This matches the production swap path in
 * tokens.fun/app/lib/uniswap/baseSwap.ts:593 ("Doppler hooks use empty hook data").
 * Clanker-style hooks would want abi-encoded (address referrer, bytes data),
 * but our worker only ever swaps into tokens we deployed via Doppler, so
 * empty bytes is correct.
 */
export function noReferrerHookData(): `0x${string}` {
  // explicitly suppress unused import lint
  void zeroAddress;
  return '0x';
}

/**
 * Encode the V4 action stream: SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL.
 * Mirrors @uniswap/v4-sdk V4Planner.finalize() output.
 */
function encodeV4Actions(args: {
  plan: V4SwapPlan;
  amountIn: bigint;
  amountOutMinimum: bigint;
  hookData: `0x${string}`;
}): `0x${string}` {
  // SWAP_EXACT_IN_SINGLE params encoded as a tuple
  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          {
            type: 'tuple',
            name: 'poolKey',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [
      {
        poolKey: args.plan.poolKey,
        zeroForOne: args.plan.zeroForOne,
        amountIn: args.amountIn,
        amountOutMinimum: args.amountOutMinimum,
        hookData: args.hookData,
      },
    ],
  );

  // SETTLE: (currency, amount, payerIsUser).
  // payerIsUser=true because the buyback wallet (msg.sender) is paying via
  // Permit2-mediated transfer; the router pulls from us, not from itself.
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    [args.plan.inputCurrency, args.amountIn, true],
  );

  // TAKE_ALL: (currency, minAmount). Sends the full output delta to msg.sender
  // (the buyback wallet) — the worker then runs the burn step against that
  // balance in a separate tx.
  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [args.plan.outputCurrency, args.amountOutMinimum],
  );

  // V4Planner format: (bytes actions, bytes[] params)
  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8'],
    [ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE, ACTION_TAKE_ALL],
  );
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [actions, [swapParams, settleParams, takeParams]],
  );
}

/**
 * Encode the full UniversalRouter.execute() calldata for a V4 swap.
 */
export function encodeV4SwapCall(args: {
  plan: V4SwapPlan;
  amountIn: bigint;
  amountOutMinimum: bigint;
  hookData?: `0x${string}`;
  deadlineSec?: number;
}): { to: `0x${string}`; data: `0x${string}`; value: bigint } {
  const hookData = args.hookData ?? noReferrerHookData();
  const v4Actions = encodeV4Actions({
    plan: args.plan,
    amountIn: args.amountIn,
    amountOutMinimum: args.amountOutMinimum,
    hookData,
  });
  const commands = encodePacked(['uint8'], [COMMAND_V4_SWAP]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (args.deadlineSec ?? 3600));
  const data = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [commands, [v4Actions], deadline],
  });
  return { to: UNIVERSAL_ROUTER_BASE, data, value: BigInt(0) };
}

/**
 * Encode Permit2.approve(token, UniversalRouter, MAX_UINT160, expiration).
 * Required before the first V4 swap of any new input token from this wallet.
 */
export function encodePermit2Approve(args: {
  token: `0x${string}`;
  expirationSec?: number;
}): { to: `0x${string}`; data: `0x${string}`; value: bigint } {
  const MAX_UINT160 = (BigInt(1) << BigInt(160)) - BigInt(1);
  const expiration = Math.floor(Date.now() / 1000) + (args.expirationSec ?? 86400 * 30);
  const data = encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: 'approve',
    args: [args.token, UNIVERSAL_ROUTER_BASE, MAX_UINT160, expiration],
  });
  return { to: PERMIT2_BASE, data, value: BigInt(0) };
}

/**
 * Read Permit2 allowance — returns the (amount, expiration, nonce) tuple.
 */
export async function readPermit2Allowance(args: {
  owner: `0x${string}`;
  token: `0x${string}`;
  client?: BasePublicClient;
}): Promise<{ amount: bigint; expiration: number }> {
  const publicClient = args.client ?? getBasePublicClient();
  const r = (await publicClient.readContract({
    address: PERMIT2_BASE,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [args.owner, args.token, UNIVERSAL_ROUTER_BASE],
  })) as readonly [bigint, number, number];
  return { amount: r[0], expiration: r[1] };
}
