import { toFunctionSelector } from 'viem';
import { SPLIT_WAREHOUSE_ADDRESS } from './splitsWarehouse';
import { UNISWAP_V3_SWAP_ROUTER_02 } from './uniswap';
import { UNIVERSAL_ROUTER_BASE, PERMIT2_BASE } from './uniswapV4';
import { DEAD_ADDRESS } from './tokenSafety';

// Selectors the buyback flow ever needs the delegated key to sign.
const SELECTORS = {
  warehouseWithdraw: toFunctionSelector('withdraw(address,address)'),
  uniswapExactInput: toFunctionSelector(
    'exactInput((bytes,address,uint256,uint256))',
  ),
  uniswapExactInputSingle: toFunctionSelector(
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
  ),
  // Uniswap V4 UniversalRouter — used for Doppler tokens.
  universalRouterExecute: toFunctionSelector('execute(bytes,bytes[],uint256)'),
  // Permit2.approve(token, spender, uint160 amount, uint48 expiration) — V4 swaps
  // route their ERC-20 spend through Permit2 instead of approving the router
  // directly.
  permit2Approve: toFunctionSelector('approve(address,address,uint160,uint48)'),
  erc20Transfer: toFunctionSelector('transfer(address,uint256)'),
  erc20Approve: toFunctionSelector('approve(address,uint256)'),
  tokenBurn: toFunctionSelector('burn(uint256)'),
} as const;

export interface BuybackPolicyParams {
  // The user-configured ERC-20 the buyback ultimately purchases & burns.
  userTokenAddress: `0x${string}`;
  // DEPRECATED / IGNORED. The policy is now token-agnostic — revenue can arrive
  // as any ERC-20, so approve()/transfer() are constrained by spender/recipient
  // (router, permit2, dead, treasury, recovery) rather than by token address.
  // Kept only so existing callers compile; the value is no longer read.
  allowedSwapInputTokens?: readonly `0x${string}`[];
  // EOA the recovery flow is permitted to sweep funds to. Set at config-time
  // = the user's connected dev wallet. The policy permits transfer(this, _) on
  // ANY token (ETH sweeps use a plain native transfer to this address).
  recoveryAddress: `0x${string}`;
  // Platform treasury address for fee collection (shared-split buyback only).
  // When set, the policy additionally permits transfer(treasury, _) on all
  // input tokens and a plain ETH transfer to treasury — used to deduct the
  // swap fee before executing the buyback.
  treasuryAddress?: `0x${string}`;
  // Swap venue — defaults to V3 for backward compatibility. When 'UNISWAP_V4'
  // the policy additionally authorizes UniversalRouter.execute() and Permit2
  // approvals (Doppler tokens trade on V4 multicurve and require Permit2).
  swapVenue?: 'UNISWAP_V3' | 'UNISWAP_V4';
  // Parent-org user IDs of the two stampers required for every signing activity.
  // Both must approve before Turnkey executes the activity. parentAdminUserId
  // is the Railway-side admin (TURNKEY_PARENT_ADMIN_USER_ID); coSignerUserId
  // is the off-Railway co-signer (TURNKEY_COSIGNER_USER_ID), held in a separate
  // cloud account (Cloudflare Worker / AWS Lambda / etc.) so a Railway breach
  // alone cannot satisfy consensus.
  parentAdminUserId: string;
  coSignerUserId: string;
}

/**
 * Build the CEL conditions Turnkey evaluates per signing activity for our
 * delegated API key. The policy permits *only* the buyback flow's calls and
 * rejects anything else.
 *
 * The conditions translate to:
 *   - To the Splits Warehouse: only `withdraw(address,address)`
 *   - To the Uniswap SwapRouter / UniversalRouter: only swap calls
 *   - `approve(SwapRouter|Permit2, _)` on ANY token (revenue is arbitrary)
 *   - `transfer(_, _)` only when the recipient is 0xdEaD, the treasury, or the
 *     recovery EOA — the token can be anything, the destination cannot
 *   - To the user's chosen burn token: also `burn(_)`
 *
 * The policy is token-agnostic by design (revenue arrives as any ERC-20), so
 * security rests on the fixed set of permitted destinations, not a token
 * allowlist. Any other contract / function selector — or a transfer to any
 * other recipient — is denied. Even if our delegated API key is leaked, an
 * attacker cannot drain the wallet to an address they control; they can only
 * execute the buyback / recovery flow we already authorized.
 */
export function buildBuybackPolicy(params: BuybackPolicyParams): {
  policyName: string;
  effect: 'EFFECT_ALLOW';
  consensus: string;
  condition: string;
  notes: string;
} {
  const { userTokenAddress, recoveryAddress, treasuryAddress, swapVenue, parentAdminUserId, coSignerUserId } = params;
  const isV4 = swapVenue === 'UNISWAP_V4';

  const lower = (s: string) => s.toLowerCase();
  const userToken = lower(userTokenAddress);
  const warehouse = lower(SPLIT_WAREHOUSE_ADDRESS);
  const router = lower(UNISWAP_V3_SWAP_ROUTER_02);
  const universalRouter = lower(UNIVERSAL_ROUTER_BASE);
  const permit2 = lower(PERMIT2_BASE);
  const dead = lower(DEAD_ADDRESS);
  const recovery = lower(recoveryAddress);

  // Selector helpers — Turnkey gives us eth.tx.data as bytes; substring(0, 10) = "0x" + 4 bytes.
  const sel = (name: keyof typeof SELECTORS) => SELECTORS[name].toLowerCase();

  const inSet = (key: string, values: string[]) =>
    `${key} in [${values.map((v) => `'${v}'`).join(', ')}]`;

  // Token-AGNOSTIC condition tree. Revenue flows into the split/wallet as any
  // ERC-20 — WETH, USDC, or arbitrary tokens we can't enumerate at
  // provisioning time — so we deliberately do NOT whitelist token addresses.
  // Security instead comes from constraining the *destination* of every op to
  // a fixed, safe address:
  //   - approve  -> spender must be the SwapRouter (and Permit2 on V4)
  //   - transfer -> recipient must be 0xdEaD (burn), the treasury (fee), or the
  //                 recovery EOA — never an arbitrary address
  //   - swaps    -> only the SwapRouter / UniversalRouter
  //   - withdraw -> only the Splits Warehouse
  // A leaked delegated key therefore still cannot move funds to any
  // attacker-controlled address — it can only run the buyback / recovery flow.
  // This matches how the off-host co-signer validates (it never checks the
  // token address either, only selectors + spender/recipient args).
  const selector = 'eth.tx.function_signature';
  const firstArgAddress = 'eth.tx.data[34..74]'; // arg0 address (word 0, right-aligned), lowercased hex
  const secondArgAddress = 'eth.tx.data[98..138]'; // arg1 address (word 1, right-aligned), lowercased hex

  const conditions: string[] = [
    `(${inSet('eth.tx.to', [warehouse])} && ${selector} == '${sel('warehouseWithdraw')}')`,
    `(${inSet('eth.tx.to', [router])} && ${inSet(selector, [sel('uniswapExactInput'), sel('uniswapExactInputSingle')])})`,
    // approve(SwapRouter, _) on ANY token — required before a V3 swap.
    `(${selector} == '${sel('erc20Approve')}' && ${firstArgAddress} == '${router.slice(2)}')`,
  ];

  if (isV4) {
    conditions.push(
      // UniversalRouter.execute(commands, inputs, deadline) — Doppler V4 swap entry point.
      `(${inSet('eth.tx.to', [universalRouter])} && ${selector} == '${sel('universalRouterExecute')}')`,
      // Permit2.approve(token, UniversalRouter, max, expiration) — V4 routes
      // ERC-20 spend through Permit2 instead of approving the router directly.
      // Pin the SPENDER arg (word 1) to the UniversalRouter: without this a
      // compromised worker could approve an attacker as a Permit2 spender and
      // drain the wallet's ERC-20s out-of-band.
      `(${inSet('eth.tx.to', [permit2])} && ${selector} == '${sel('permit2Approve')}' && ${secondArgAddress} == '${universalRouter.slice(2)}')`,
      // approve(Permit2, _) on ANY token — one-time per token, instead of the V3 router.
      `(${selector} == '${sel('erc20Approve')}' && ${firstArgAddress} == '${permit2.slice(2)}')`,
    );
  }

  conditions.push(
    // Burn: only ever the user's chosen burn token, via dead-transfer or burn().
    `(${inSet('eth.tx.to', [userToken])} && ${selector} == '${sel('erc20Transfer')}' && ${firstArgAddress} == '${dead.slice(2)}')`,
    `(${inSet('eth.tx.to', [userToken])} && ${selector} == '${sel('tokenBurn')}')`,
    // Recovery: transfer(recoveryAddress, _) on ANY token.
    `(${selector} == '${sel('erc20Transfer')}' && ${firstArgAddress} == '${recovery.slice(2)}')`,
    // Recovery: native ETH sweep — plain value transfer to recoveryAddress with empty data.
    `(${inSet('eth.tx.to', [recovery])} && (eth.tx.data == '0x' || eth.tx.data == ''))`,
  );

  // Fee collection: permitted only when a treasury address is configured
  // (shared-split buyback). Allows transfer(treasury, _) on ANY token plus a
  // plain ETH transfer — used to deduct the platform fee before swapping.
  if (treasuryAddress) {
    const treasury = lower(treasuryAddress);
    conditions.push(
      `(${selector} == '${sel('erc20Transfer')}' && ${firstArgAddress} == '${treasury.slice(2)}')`,
      `(${inSet('eth.tx.to', [treasury])} && (eth.tx.data == '0x' || eth.tx.data == ''))`,
    );
  }

  const condition = conditions.join(' || ');

  // Two-stamper consensus: BOTH the parent-admin (Railway) and the co-signer
  // (off-Railway) must independently approve every signing activity. Compromise
  // of one without the other does not satisfy consensus and Turnkey rejects the
  // request before any signature is ever produced.
  const consensus =
    `approvers.any(user, user.id == '${parentAdminUserId}') ` +
    `&& approvers.any(user, user.id == '${coSignerUserId}')`;

  return {
    policyName: `buyback_${userToken.slice(2, 12)}`,
    effect: 'EFFECT_ALLOW',
    consensus,
    condition,
    notes:
      'Auto-buyback policy: requires consensus from BOTH the parent-admin stamper and the off-host co-signer stamper. Permits only Splits Warehouse withdraw, Uniswap V3 swaps into the configured user token, ERC-20 approve to the SwapRouter, and final transfer-to-dead or burn() of the user token.',
  };
}
