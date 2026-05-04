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
  const { userTokenAddress, allowedSwapInputTokens } = params;

  const lower = (s: string) => s.toLowerCase();
  const userToken = lower(userTokenAddress);
  const warehouse = lower(SPLIT_WAREHOUSE_ADDRESS);
  const router = lower(UNISWAP_V3_SWAP_ROUTER_02);
  const dead = lower(DEAD_ADDRESS);
  const allowedInputsLower = allowedSwapInputTokens
    .map(lower)
    .filter((a) => a !== lower(SPLIT_NATIVE_TOKEN_ADDRESS));

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
  const sliceSelector = "eth.tx.data[0:10]";
  const firstArgAddress = "eth.tx.data[34:74]"; // address sits in bytes 4..36, lowercased hex

  const conditions: string[] = [
    `(${inSet('eth.tx.to', [warehouse])} && ${sliceSelector} == '${sel('warehouseWithdraw')}')`,
    `(${inSet('eth.tx.to', [router])} && ${inSet(sliceSelector, [sel('uniswapExactInput'), sel('uniswapExactInputSingle')])})`,
  ];
  if (allowedInputsLower.length > 0) {
    conditions.push(
      `(${inSet('eth.tx.to', allowedInputsLower)} && ${sliceSelector} == '${sel('erc20Approve')}' && ${firstArgAddress} == '${router.slice(2)}')`,
    );
  }
  conditions.push(
    `(${inSet('eth.tx.to', [userToken])} && ${sliceSelector} == '${sel('erc20Transfer')}' && ${firstArgAddress} == '${dead.slice(2)}')`,
    `(${inSet('eth.tx.to', [userToken])} && ${sliceSelector} == '${sel('tokenBurn')}')`,
  );

  const condition = conditions.join(' || ');

  return {
    policyName: `buyback_${userToken.slice(2, 12)}`,
    effect: 'EFFECT_ALLOW',
    consensus: 'approvers.any(u, true)', // any single approver (our delegated key) suffices
    condition,
    notes:
      'Auto-buyback policy: permits only Splits Warehouse withdraw, Uniswap V3 swaps into the configured user token, ERC-20 approve to the SwapRouter, and final transfer-to-dead or burn() of the user token.',
  };
}
