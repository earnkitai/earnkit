import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
import { createBuybackSubOrg } from '../../services/turnkeyService';
import {
  assertHasCode,
  assertNotHoneypot,
  canReceiveDead,
  detectBurnFunction,
  getTokenMeta,
  TokenSafetyError,
} from '../../lib/tokenSafety';
import { SUPPORTED_TOKENS } from '../../services/tokenService';
import { SPLIT_NATIVE_TOKEN_ADDRESS } from '../../lib/splitsWarehouse';

/**
 * POST /api/internal/provision-buyback
 *
 * Called by the dashboard during agent creation when the user selects Auto
 * Buyback. Runs token safety pre-checks, provisions a Turnkey sub-org with the
 * user's email as root authenticator and the recovery address baked into the
 * policy, and returns the Turnkey identifiers + token metadata. The dashboard
 * then deploys the Splits contract using `walletAddress` as the buyback
 * recipient — that's the only ordering that makes Auto Buyback actually work
 * (Splits recipients are immutable once deployed).
 *
 * Authenticated via x-internal-secret (same pattern as deploy-split).
 *
 * Body:
 *   agentId          — the dashboard-generated agent UUID
 *   userEmail        — agent owner's email; root authenticator on the new sub-org
 *   tokenAddress     — ERC-20 to buy back & burn
 *   recoveryAddress  — EOA the recovery sweep is permitted to send funds to
 *                       (typically the agent owner's connected dev wallet)
 *   requestedBurnMode — optional: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN'. If unset,
 *                       auto-detected by simulating transfer(0xdEaD, 1).
 */
const router: Router = Router();

router.post('/', async (req: Request, res: Response) => {
  // Auth is enforced by the `internalAuth` middleware at mount time
  // (routes/index.ts) with a constant-time secret compare — no duplicate check here.
  try {
    const {
      agentId,
      userEmail,
      tokenAddress: rawToken,
      recoveryAddress: rawRecovery,
      requestedBurnMode,
    } = req.body ?? {};

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId is required' });
    }
    if (!userEmail || typeof userEmail !== 'string') {
      return res.status(400).json({
        error: 'userEmail is required (becomes the root authenticator on the Turnkey sub-org)',
      });
    }
    if (!rawToken || !isAddress(rawToken)) {
      return res.status(400).json({ error: 'tokenAddress must be a valid 0x address' });
    }
    if (!rawRecovery || !isAddress(rawRecovery)) {
      return res.status(400).json({ error: 'recoveryAddress must be a valid 0x address' });
    }

    const tokenAddress = getAddress(rawToken) as `0x${string}`;
    const recoveryAddress = getAddress(rawRecovery) as `0x${string}`;

    // Safety pre-checks
    await assertHasCode(tokenAddress);
    const meta = await getTokenMeta(tokenAddress);
    // Honeypot check buys via Uniswap V3. A freshly-launched token (e.g. a V4/
    // Doppler agent coin) legitimately has no V3 route yet — that's `no_liquidity`,
    // not a honeypot. Don't block provisioning on it; the buyback worker re-checks
    // a real buy route at execution time before swapping. Other honeypot reasons
    // still hard-fail.
    try {
      await assertNotHoneypot(tokenAddress);
    } catch (err) {
      if (err instanceof TokenSafetyError && err.reason === 'no_liquidity') {
        console.warn(
          `[provision-buyback] ${tokenAddress} has no V3 route yet (fresh token) — skipping honeypot check; buyback executes once liquidity exists`,
        );
      } else {
        throw err;
      }
    }

    const canDead = await canReceiveDead(tokenAddress);
    let burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
    if (canDead) {
      burnMode =
        requestedBurnMode === 'TOKEN_BURN_FN' ? 'TOKEN_BURN_FN' : 'DEAD_ADDRESS';
    } else {
      const hasBurn = await detectBurnFunction(tokenAddress);
      if (!hasBurn) {
        throw new TokenSafetyError(
          'no_burn_function',
          `Token ${tokenAddress} blocks transfers to the dead address and exposes no burn() function — cannot be auto-burned`,
        );
      }
      burnMode = 'TOKEN_BURN_FN';
    }

    // Provision Turnkey sub-org — the policy is bound to this token + recoveryAddress.
    const allowedSwapInputTokens = [
      SPLIT_NATIVE_TOKEN_ADDRESS,
      ...SUPPORTED_TOKENS.map((t) => t.address as `0x${string}`),
    ];
    const subOrg = await createBuybackSubOrg({
      agentId,
      userEmail,
      policyParams: {
        userTokenAddress: tokenAddress,
        allowedSwapInputTokens,
        recoveryAddress,
      },
    });

    return res.json({
      ok: true,
      tokenAddress,
      tokenSymbol: meta.symbol,
      tokenDecimals: meta.decimals,
      burnMode,
      subOrgId: subOrg.subOrgId,
      walletId: subOrg.walletId,
      walletAddress: subOrg.walletAddress,
      policyId: subOrg.policyId,
      recoveryAddress,
    });
  } catch (err: unknown) {
    if (err instanceof TokenSafetyError) {
      return res.status(400).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[internal/provision-buyback] error:', err);
    return res.status(500).json({ error: message });
  }
});

export default router;
