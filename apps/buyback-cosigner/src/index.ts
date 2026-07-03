/**
 * EarnKit buyback co-signer — Cloudflare Worker.
 *
 * This Worker holds the second of two stamper keys required by the Turnkey
 * sub-org policy attached to every buyback wallet. The first stamper lives
 * in the earn-backend (Railway). Both stamps are required for Turnkey to
 * execute any signing activity, so a Railway-only compromise cannot move
 * funds — the attacker would also need to compromise this Worker, deployed
 * in a separate Cloudflare account with its own credentials and audit trail.
 *
 * Deployed in a SEPARATE Cloudflare account from any other infrastructure
 * EarnKit operates. This is load-bearing for the security model.
 *
 * The Worker:
 *   1. Authenticates the caller via a shared-secret header.
 *   2. Re-fetches the activity from Turnkey by id, so we sign what Turnkey
 *      actually has, not what the caller claims.
 *   3. Validates the activity's intent matches a permitted shape:
 *        - sub-org's wallet must be in the live buyback-wallet whitelist
 *          (fetched from earn-backend, cached briefly).
 *        - destination + selector + first-arg constraints match the buyback
 *          flow OR the operator-gas drip flow (transfer ETH to a known
 *          buyback wallet).
 *   4. Calls Turnkey approveActivity with the co-signer's stamper key.
 */

import { Turnkey } from '@turnkey/sdk-server';
import {
  decodeAbiParameters,
  decodeFunctionData,
  toFunctionSelector,
  type Hex,
  parseTransaction,
} from 'viem';

interface Env {
  TURNKEY_API_PUBLIC_KEY: string;
  TURNKEY_API_PRIVATE_KEY: string;
  TURNKEY_PARENT_ORG_ID: string;
  TURNKEY_API_BASE_URL?: string;
  COSIGNER_SHARED_SECRET: string;
  BUYBACK_BACKEND_BASE_URL: string;
  BUYBACK_BACKEND_INTERNAL_KEY: string;
}

// Same canonical addresses the earn-backend uses. Hardcoded here so the
// Worker has no runtime dependency on the backend for what's permitted.
const SPLIT_WAREHOUSE_ADDRESS = '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8'.toLowerCase();
const UNISWAP_V3_SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481'.toLowerCase();
// Uniswap V4 (used by Doppler tokens — see lib/uniswapV4.ts in earn-backend).
const UNIVERSAL_ROUTER_BASE = '0x6ff5693b99212da76ad316178a184ab56d299b43'.toLowerCase();
const PERMIT2_BASE = '0x000000000022D473030F116dDEE9F6B43aC78BA3'.toLowerCase();
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD'.toLowerCase();

const SELECTORS = {
  warehouseWithdraw: toFunctionSelector('withdraw(address,address)'),
  uniswapExactInput: toFunctionSelector('exactInput((bytes,address,uint256,uint256))'),
  uniswapExactInputSingle: toFunctionSelector(
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
  ),
  universalRouterExecute: toFunctionSelector('execute(bytes,bytes[],uint256)'),
  permit2Approve: toFunctionSelector('approve(address,address,uint160,uint48)'),
  erc20Transfer: toFunctionSelector('transfer(address,uint256)'),
  erc20Approve: toFunctionSelector('approve(address,uint256)'),
  tokenBurn: toFunctionSelector('burn(uint256)'),
};

// Minimal ABIs to decode the SwapRouter02 recipient so we can pin swap output to
// the buyback wallet itself. A legitimate buyback always swaps into its own
// wallet; anything else is an exfiltration attempt.
const V3_SWAP_ABI = [
  {
    type: 'function',
    name: 'exactInput',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

// UniversalRouter.execute — decoded to verify the V4 swap command/action stream.
const UNIVERSAL_ROUTER_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// The exact stream the buyback worker emits (see earn-backend/src/lib/uniswapV4.ts):
//   commands = 0x10  (a single V4_SWAP command)
//   actions  = 0x06 0x0b 0x0f  (SWAP_EXACT_IN_SINGLE, SETTLE, TAKE_ALL)
// TAKE_ALL sends output to msg.sender with no recipient arg, so this pattern
// cannot redirect funds. Anything else is rejected.
const V4_ALLOWED_COMMANDS = '0x10';
const V4_ALLOWED_ACTIONS = '0x060b0f';

interface BuybackWalletEntry {
  walletAddress: string;
  tokenAddress: string;
  recoveryAddress: string;
}

interface OperatorWalletEntry {
  walletAddress: string;
}

interface WhitelistResponse {
  buybackWallets: BuybackWalletEntry[];
  operatorWallets: OperatorWalletEntry[];
  treasuryAddress: string | null;
}

// Cache the whitelist for 60s. Long enough to absorb the load of a normal
// scanner cycle, short enough that newly-provisioned wallets become spendable
// quickly. Per-Worker-isolate cache; global KV cache would be optional later.
let cachedWhitelist: { value: WhitelistResponse; expiresAt: number } | null = null;
const WHITELIST_CACHE_MS = 60_000;

async function fetchWhitelist(env: Env): Promise<WhitelistResponse> {
  const now = Date.now();
  if (cachedWhitelist && cachedWhitelist.expiresAt > now) {
    return cachedWhitelist.value;
  }
  const url = `${env.BUYBACK_BACKEND_BASE_URL.replace(/\/$/, '')}/api/internal/buyback-wallets`;
  const r = await fetch(url, {
    headers: { 'x-internal-secret': env.BUYBACK_BACKEND_INTERNAL_KEY },
  });
  if (!r.ok) {
    throw new Error(`Whitelist fetch failed: HTTP ${r.status}`);
  }
  const data = (await r.json()) as WhitelistResponse;
  cachedWhitelist = { value: data, expiresAt: now + WHITELIST_CACHE_MS };
  return data;
}

interface ValidationResult {
  ok: true;
  reason: 'buyback' | 'operator-gas';
}
interface ValidationFailure {
  ok: false;
  reason: string;
}

// Decode the unsigned tx hex and confirm it matches one of the permitted shapes:
//   (a) a buyback op (Warehouse withdraw, Uniswap swap to userToken, ERC20
//       transfer to dead, ERC20 approve to router, token.burn) signed by a
//       known buyback wallet, OR
//   (b) an operator-gas drip (plain ETH transfer with empty data) FROM a
//       known operator wallet TO a known buyback wallet.
function validateUnsignedTx(
  unsignedTxHex: string,
  fromAddress: string,
  whitelist: WhitelistResponse,
): ValidationResult | ValidationFailure {
  let parsed;
  try {
    parsed = parseTransaction(`0x${unsignedTxHex}` as Hex);
  } catch (e: any) {
    return { ok: false, reason: `Cannot parse unsigned tx: ${e?.message ?? e}` };
  }

  const to = parsed.to?.toLowerCase();
  const data = (parsed.data ?? '0x').toLowerCase();
  const valueHex = parsed.value?.toString(16) ?? '0';
  const value = parsed.value ?? BigInt(0);

  if (!to) return { ok: false, reason: 'Tx has no `to` address' };

  const fromLower = fromAddress.toLowerCase();
  const buyback = whitelist.buybackWallets.find(
    (w) => w.walletAddress.toLowerCase() === fromLower,
  );
  const operator = whitelist.operatorWallets.find(
    (w) => w.walletAddress.toLowerCase() === fromLower,
  );

  if (!buyback && !operator) {
    return { ok: false, reason: `from address ${fromAddress} is not whitelisted` };
  }

  // Operator-gas drip path
  if (operator) {
    if (data !== '0x') {
      return { ok: false, reason: 'Operator wallet may only send plain ETH transfers (data must be empty)' };
    }
    const targetIsBuyback = whitelist.buybackWallets.some(
      (w) => w.walletAddress.toLowerCase() === to,
    );
    if (!targetIsBuyback) {
      return { ok: false, reason: 'Operator drip target must be a known buyback wallet' };
    }
    // Hard cap drip size at 0.005 ETH per tx — Worker's belt-and-suspenders
    // on top of Turnkey's policy. ~$15 if ETH spikes; well above any reasonable drip.
    if (value > BigInt('5000000000000000')) {
      return { ok: false, reason: 'Operator drip value exceeds 0.005 ETH cap' };
    }
    return { ok: true, reason: 'operator-gas' };
  }

  // Buyback path — `from` is a known buyback wallet
  const userToken = buyback!.tokenAddress.toLowerCase();
  const selector = data.slice(0, 10);

  if (to === SPLIT_WAREHOUSE_ADDRESS && selector === SELECTORS.warehouseWithdraw) {
    return { ok: true, reason: 'buyback' };
  }
  if (
    to === UNISWAP_V3_SWAP_ROUTER_02 &&
    (selector === SELECTORS.uniswapExactInput || selector === SELECTORS.uniswapExactInputSingle)
  ) {
    // Pin the swap RECIPIENT to the buyback wallet. Selector+router alone is not
    // enough: exactInput/exactInputSingle carry a `recipient` field, and a
    // compromised backend could set it to an attacker to exfiltrate the swap
    // output. A real buyback always swaps into its own wallet.
    try {
      const decoded = decodeFunctionData({ abi: V3_SWAP_ABI, data: data as Hex });
      const recipient = (decoded.args[0] as { recipient: string }).recipient.toLowerCase();
      if (recipient !== fromAddress.toLowerCase()) {
        return { ok: false, reason: `swap recipient ${recipient} must be the buyback wallet` };
      }
      return { ok: true, reason: 'buyback' };
    } catch {
      return { ok: false, reason: 'Failed to decode swap recipient' };
    }
  }
  // Uniswap V4 UniversalRouter — entry point for Doppler-token buybacks.
  // Selector+router is NOT enough: execute(commands, inputs, deadline) can carry
  // SWEEP/TRANSFER commands (or a TAKE with an arbitrary recipient) that pull the
  // wallet's tokens — through its max Permit2 allowance — to an attacker. So we
  // decode the command + action stream and allow ONLY the exact pattern the
  // buyback worker emits: a single V4_SWAP command whose actions are
  // SWAP_EXACT_IN_SINGLE + SETTLE + TAKE_ALL. TAKE_ALL sends output to msg.sender
  // (the wallet) with no recipient field, so funds cannot be redirected.
  if (to === UNIVERSAL_ROUTER_BASE && selector === SELECTORS.universalRouterExecute) {
    try {
      const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: data as Hex });
      const commands = (decoded.args[0] as string).toLowerCase();
      const inputs = decoded.args[1] as readonly Hex[];
      if (commands !== V4_ALLOWED_COMMANDS) {
        return { ok: false, reason: `execute commands ${commands} != allowed V4_SWAP` };
      }
      if (inputs.length !== 1) {
        return { ok: false, reason: `execute must carry exactly one input` };
      }
      const [actions] = decodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes[]' }],
        inputs[0],
      ) as [string, unknown];
      if (actions.toLowerCase() !== V4_ALLOWED_ACTIONS) {
        return { ok: false, reason: `execute actions ${actions} != allowed swap pattern` };
      }
      return { ok: true, reason: 'buyback' };
    } catch {
      return { ok: false, reason: 'Failed to decode execute() V4 swap' };
    }
  }
  // Permit2.approve(token, UniversalRouter, max, expiration) — required
  // approval step before a V4 swap. Spender (2nd arg) is checked here.
  if (to === PERMIT2_BASE && selector === SELECTORS.permit2Approve) {
    try {
      // Permit2.approve args layout: token(32) + spender(32) + amount(32) + expiration(32)
      // Skip first 4 bytes (selector) + 32 (token padded) = 36; spender at 36..68 in bytes
      // i.e. data[2 + 8 + 64 .. 2 + 8 + 128] in hex chars
      const spender = `0x${data.slice(2 + 8 + 64 + 24, 2 + 8 + 128)}`;
      if (spender === UNIVERSAL_ROUTER_BASE) {
        return { ok: true, reason: 'buyback' };
      }
      return { ok: false, reason: `permit2 approve spender ${spender} is not the UniversalRouter` };
    } catch {
      return { ok: false, reason: 'Failed to decode permit2 approve args' };
    }
  }
  if (selector === SELECTORS.erc20Approve) {
    // Approve must target either the V3 SwapRouter (legacy flow) or Permit2
    // (V4 flow — Permit2 then mediates the spend to UniversalRouter).
    try {
      // first arg is the spender; bytes [4..36) of data
      const spender = `0x${data.slice(34, 74)}`;
      if (spender === UNISWAP_V3_SWAP_ROUTER_02 || spender === PERMIT2_BASE) {
        return { ok: true, reason: 'buyback' };
      }
      return { ok: false, reason: `approve spender ${spender} is not the SwapRouter or Permit2` };
    } catch {
      return { ok: false, reason: 'Failed to decode approve args' };
    }
  }
  if (to === userToken && selector === SELECTORS.erc20Transfer) {
    const recipient = `0x${data.slice(34, 74)}`;
    if (recipient === DEAD_ADDRESS) return { ok: true, reason: 'buyback' };
    return { ok: false, reason: `transfer recipient ${recipient} must be 0xdEaD` };
  }
  if (to === userToken && selector === SELECTORS.tokenBurn) {
    return { ok: true, reason: 'buyback' };
  }

  // Recovery sweep paths
  const recovery = buyback!.recoveryAddress.toLowerCase();
  // ERC-20 transfer to recoveryAddress on ANY token. The model is
  // token-agnostic by design (revenue arrives as arbitrary ERC-20s): security
  // comes from constraining the recipient, not from a token allowlist — both
  // here and in the Turnkey policy.
  if (selector === SELECTORS.erc20Transfer) {
    const recipient = `0x${data.slice(34, 74)}`;
    if (recipient === recovery) return { ok: true, reason: 'buyback' };
  }
  // Native ETH sweep: plain value transfer (empty data) to recoveryAddress.
  if (to === recovery && (data === '0x' || data === '')) {
    return { ok: true, reason: 'buyback' };
  }

  // Fee collection paths (shared-split buyback only)
  // ERC-20 fee transfer to treasury.
  if (whitelist.treasuryAddress && selector === SELECTORS.erc20Transfer) {
    const recipient = `0x${data.slice(34, 74)}`;
    if (recipient === whitelist.treasuryAddress.toLowerCase()) return { ok: true, reason: 'buyback' };
  }
  // Native ETH fee to treasury.
  if (whitelist.treasuryAddress && to === whitelist.treasuryAddress.toLowerCase() && (data === '0x' || data === '')) {
    return { ok: true, reason: 'buyback' };
  }

  return {
    ok: false,
    reason: `Tx (to=${to}, selector=${selector}) does not match any permitted buyback or operator-gas op`,
  };
}

interface CoSignRequest {
  kind: 'sign-transaction';
  subOrgId: string;
  activityId: string;
  fromAddress: string;
  unsignedTransaction: string;
}

async function handleCoSign(req: CoSignRequest, env: Env): Promise<Response> {
  const turnkey = new Turnkey({
    apiBaseUrl: env.TURNKEY_API_BASE_URL || 'https://api.turnkey.com',
    apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
    apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
    defaultOrganizationId: env.TURNKEY_PARENT_ORG_ID,
  });
  const client = turnkey.apiClient();

  // Re-fetch the activity so we co-sign Turnkey's view of it, not the caller's claim.
  const activityResp = await client.getActivity({
    organizationId: req.subOrgId,
    activityId: req.activityId,
  });
  const activity = activityResp.activity;
  const intent: any =
    (activity.intent as any).signTransactionIntentV2 ??
    (activity.intent as any).signTransactionIntent;
  if (!intent) {
    return new Response(
      JSON.stringify({ error: 'Activity is not a signTransaction intent' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (intent.signWith.toLowerCase() !== req.fromAddress.toLowerCase()) {
    return new Response(
      JSON.stringify({ error: 'Activity signWith does not match request fromAddress' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (intent.unsignedTransaction.toLowerCase() !== req.unsignedTransaction.toLowerCase()) {
    return new Response(
      JSON.stringify({ error: 'Activity unsignedTransaction does not match request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const whitelist = await fetchWhitelist(env);
  const validation = validateUnsignedTx(
    intent.unsignedTransaction,
    intent.signWith,
    whitelist,
  );
  if (!validation.ok) {
    return new Response(
      JSON.stringify({ error: `Tx shape rejected: ${validation.reason}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  await client.approveActivity({
    organizationId: req.subOrgId,
    fingerprint: activity.fingerprint,
  });

  return new Response(JSON.stringify({ ok: true, kind: validation.reason }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const auth = request.headers.get('x-cosigner-secret');
    if (!auth || auth !== env.COSIGNER_SHARED_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (body?.kind === 'sign-transaction') {
      try {
        return await handleCoSign(body as CoSignRequest, env);
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: err?.message ?? 'co-sign failed' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    return new Response(JSON.stringify({ error: 'Unsupported kind' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
