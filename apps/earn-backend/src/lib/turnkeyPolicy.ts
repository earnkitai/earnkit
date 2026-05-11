import { toFunctionSelector } from 'viem';
import {
  SPLIT_NATIVE_TOKEN_ADDRESS,
  SPLIT_WAREHOUSE_ADDRESS,
} from './splitsWarehouse';
import { UNISWAP_V3_SWAP_ROUTER_02 } from './uniswap';
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
  erc20Transfer: toFunctionSelector('transfer(address,uint256)'),
  erc20Approve: toFunctionSelector('approve(address,uint256)'),
  tokenBurn: toFunctionSelector('burn(uint256)'),
} as const;

export interface BuybackPolicyParams {
  // The user-configured ERC-20 the buyback ultimately purchases & burns.
  userTokenAddress: `0x${string}`;
  // The addresses on the swap input side we ever expect: ETH (sentinel) + every
  // SUPPORTED_TOKEN we accept as a payment asset. Used so the policy permits
  // approve() calls for those tokens to the SwapRouter.
  allowedSwapInputTokens: readonly `0x${string}`[];
  // EOA the recovery flow is permitted to sweep funds to. Set at config-time
  // = the user's connected dev wallet. The policy whitelists transfer(this, _)
  // for both the user's burn token AND every allowed swap-input token (ETH is
  // the only odd one out — sweeping ETH uses a plain native transfer).
  recoveryAddress: `0x${string}`;
  // Platform treasury address for fee collection (shared-split buyback only).
  // When set, the policy additionally permits transfer(treasury, _) on all
  // input tokens and a plain ETH transfer to treasury — used to deduct the
  // swap fee before executing the buyback.
  treasuryAddress?: `0x${string}`;
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
 *   - To the Uniswap V3 SwapRouter: only `exactInput*` calls
 *   - To one of the allowed swap-input tokens: only `approve(SwapRouter, _)`
 *   - To the user's chosen burn token: only `transfer(0xdEaD, _)` or `burn(_)`
 *
 * Any other contract / function selector is denied. Even if our delegated API
 * key is leaked, an attacker cannot drain the wallet — they can only execute
 * the buyback flow we already authorized.
 */
export function buildBuybackPolicy(params: BuybackPolicyParams): {
  policyName: string;
  effect: 'EFFECT_ALLOW';
  consensus: string;
  condition: string;
  notes: string;
} {
  const { userTokenAddress, allowedSwapInputTokens, recoveryAddress, treasuryAddress, parentAdminUserId, coSignerUserId } = params;

  const lower = (s: string) => s.toLowerCase();
  const userToken = lower(userTokenAddress);
  const warehouse = lower(SPLIT_WAREHOUSE_ADDRESS);
  const router = lower(UNISWAP_V3_SWAP_ROUTER_02);
  const dead = lower(DEAD_ADDRESS);
  const recovery = lower(recoveryAddress);
  const allowedInputsLower = allowedSwapInputTokens
    .map(lower)
    .filter((a) => a !== lower(SPLIT_NATIVE_TOKEN_ADDRESS));
  // ERC-20s the recovery sweep is permitted to call transfer(recoveryAddress, _) on:
  // every payment-input token PLUS the user's burn token (in case they want to
  // pull tokens that already got swapped but never burned, e.g. burn step failed).
  const recoverableTokens = Array.from(
    new Set([...allowedInputsLower, userToken]),
  );

  // Selector helpers — Turnkey gives us eth.tx.data as bytes; substring(0, 10) = "0x" + 4 bytes.
  const sel = (name: keyof typeof SELECTORS) => SELECTORS[name].toLowerCase();

  const inSet = (key: string, values: string[]) =>
    `${key} in [${values.map((v) => `'${v}'`).join(', ')}]`;

  // Condition tree (CEL):
  //   (to == Warehouse && selector == withdraw)
  //   || (to == SwapRouter && selector in [exactInput, exactInputSingle])
  //   || (to in allowed_input_tokens && selector == approve && first_arg == SwapRouter)
  //   || (to == userToken && selector == transfer && first_arg == 0xdEaD)
  //   || (to == userToken && selector == burn)
  const selector = 'eth.tx.function_signature';
  const firstArgAddress = 'eth.tx.data[34..74]'; // address sits in bytes 4..36, lowercased hex

  const conditions: string[] = [
    `(${inSet('eth.tx.to', [warehouse])} && ${selector} == '${sel('warehouseWithdraw')}')`,
    `(${inSet('eth.tx.to', [router])} && ${inSet(selector, [sel('uniswapExactInput'), sel('uniswapExactInputSingle')])})`,
  ];
  if (allowedInputsLower.length > 0) {
    conditions.push(
      `(${inSet('eth.tx.to', allowedInputsLower)} && ${selector} == '${sel('erc20Approve')}' && ${firstArgAddress} == '${router.slice(2)}')`,
    );
  }
  conditions.push(
    `(${inSet('eth.tx.to', [userToken])} && ${selector} == '${sel('erc20Transfer')}' && ${firstArgAddress} == '${dead.slice(2)}')`,
    `(${inSet('eth.tx.to', [userToken])} && ${selector} == '${sel('tokenBurn')}')`,
    // Recovery: transfer of any whitelisted token TO the recoveryAddress.
    `(${inSet('eth.tx.to', recoverableTokens)} && ${selector} == '${sel('erc20Transfer')}' && ${firstArgAddress} == '${recovery.slice(2)}')`,
    // Recovery: native ETH sweep — plain value transfer to recoveryAddress with empty data.
    `(${inSet('eth.tx.to', [recovery])} && (eth.tx.data == '0x' || eth.tx.data == ''))`,
  );

  // Fee collection: permitted only when a treasury address is configured
  // (shared-split buyback). Allows transfer of any input token or the user
  // token to the treasury — used to deduct the platform fee before swapping.
  if (treasuryAddress) {
    const treasury = lower(treasuryAddress);
    conditions.push(
      `(${inSet('eth.tx.to', recoverableTokens)} && ${selector} == '${sel('erc20Transfer')}' && ${firstArgAddress} == '${treasury.slice(2)}')`,
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
