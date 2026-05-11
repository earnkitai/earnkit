import { Router, Request, Response } from 'express';
import { getAddress, isAddress } from 'viem';
import { prisma } from '../lib/prisma';
import { createBuybackSubOrg } from '../services/turnkeyService';
import {
  assertHasCode,
  assertNotHoneypot,
  canReceiveDead,
  detectBurnFunction,
  getTokenMeta,
  TokenSafetyError,
} from '../lib/tokenSafety';
import { detectFeeRecipient } from '../lib/tokenFeeDetector';
import { snapshotBuybackBalance } from '../lib/buybackBalance';
import { SUPPORTED_TOKENS } from '../services/tokenService';
import { SPLIT_NATIVE_TOKEN_ADDRESS } from '../lib/splitsWarehouse';

const router: Router = Router();

function getTreasuryAddress(): `0x${string}` | undefined {
  const addr = process.env.BUYBACK_TREASURY_ADDRESS;
  if (!addr || !isAddress(addr)) return undefined;
  return getAddress(addr) as `0x${string}`;
}

/**
 * POST /api/token-buyback/detect
 *
 * Read-only probe: detects which fee recipient getter the contract exposes and
 * what the current fee recipient is. No state changes. Used by the dashboard to
 * show smart instructions before the user registers.
 */
router.post('/detect', async (req: Request, res: Response) => {
  try {
    const { tokenContractAddress: raw } = req.body ?? {};
    if (!raw || !isAddress(raw)) {
      return res.status(400).json({ error: 'tokenContractAddress must be a valid 0x address' });
    }

    const tokenContractAddress = getAddress(raw) as `0x${string}`;
    await assertHasCode(tokenContractAddress);

    const detection = await detectFeeRecipient(tokenContractAddress);
    return res.json(detection);
  } catch (err: unknown) {
    if (err instanceof TokenSafetyError) {
      return res.status(400).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[token-buyback/detect] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /api/token-buyback/register
 *
 * Register an existing token contract for automated buyback. Provisions a
 * Turnkey sub-org wallet that the caller then sets as fee recipient on their
 * contract. Once fees start arriving, the worker activates automatically.
 *
 * Only the push-based pattern is supported: fees must flow directly to our
 * wallet (updatable fee recipient). Claim-based patterns are not supported.
 *
 * Body:
 *   tokenContractAddress — the existing deployed token contract (fee source)
 *   targetToken          — ERC-20 to buy back and burn
 *   ownerAddress         — caller's wallet (for reference and deduplication)
 *   recoveryAddress      — EOA for emergency fund sweep
 *   userEmail            — becomes the Turnkey sub-org root authenticator
 *   feeRateBps           — optional, default 500 (5%)
 *   thresholdUsd         — optional, default 10
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const {
      tokenContractAddress: rawContract,
      targetToken: rawTarget,
      ownerAddress: rawOwner,
      recoveryAddress: rawRecovery,
      userEmail,
      feeRateBps,
      thresholdUsd,
    } = req.body ?? {};

    if (!rawContract || !isAddress(rawContract)) {
      return res.status(400).json({ error: 'tokenContractAddress must be a valid 0x address' });
    }
    if (!rawTarget || !isAddress(rawTarget)) {
      return res.status(400).json({ error: 'targetToken must be a valid 0x address' });
    }
    if (!rawOwner || !isAddress(rawOwner)) {
      return res.status(400).json({ error: 'ownerAddress must be a valid 0x address' });
    }
    if (!rawRecovery || !isAddress(rawRecovery)) {
      return res.status(400).json({ error: 'recoveryAddress must be a valid 0x address' });
    }
    if (!userEmail || typeof userEmail !== 'string') {
      return res.status(400).json({ error: 'userEmail is required' });
    }

    const tokenContractAddress = getAddress(rawContract) as `0x${string}`;
    const targetTokenAddress   = getAddress(rawTarget)   as `0x${string}`;
    const ownerAddress         = getAddress(rawOwner)    as `0x${string}`;
    const recoveryAddress      = getAddress(rawRecovery) as `0x${string}`;
    const resolvedFeeRateBps   = typeof feeRateBps  === 'number' ? Math.min(Math.max(feeRateBps, 0), 2000) : 500;
    const resolvedThresholdUsd = typeof thresholdUsd === 'number' && thresholdUsd > 0 ? thresholdUsd : 10;

    // Verify the source contract exists on-chain
    await assertHasCode(tokenContractAddress);

    // Deduplication: one active/pending config per tokenContract address is enough.
    // Having two wallets draining the same fee stream would split revenue and waste gas.
    const existing = await prisma.tokenContractBuybackConfig.findFirst({
      where: {
        tokenContractAddress: { equals: tokenContractAddress, mode: 'insensitive' },
        isActive: true,
        status: { not: 'PAUSED' },
      },
      select: { id: true, status: true, walletAddress: true },
    });
    if (existing) {
      return res.status(409).json({
        error: 'An active buyback config already exists for this token contract',
        existingConfigId: existing.id,
        existingStatus: existing.status,
        existingWallet: existing.walletAddress,
      });
    }

    // Target token safety checks
    await assertHasCode(targetTokenAddress);
    const meta = await getTokenMeta(targetTokenAddress);
    await assertNotHoneypot(targetTokenAddress);

    const canDead = await canReceiveDead(targetTokenAddress);
    let burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
    if (canDead) {
      burnMode = 'DEAD_ADDRESS';
    } else {
      const hasBurn = await detectBurnFunction(targetTokenAddress);
      if (!hasBurn) {
        throw new TokenSafetyError(
          'no_burn_function',
          `Token ${targetTokenAddress} blocks transfers to the dead address and exposes no burn() function`,
        );
      }
      burnMode = 'TOKEN_BURN_FN';
    }

    // Best-effort fee recipient detection — read-only, never blocks registration
    let feeGetterName: string | null = null;
    let instruction =
      'Set the provisioned buyback wallet as the fee recipient on your token contract.';
    try {
      const detection = await detectFeeRecipient(tokenContractAddress);
      feeGetterName = detection.getterName;
      instruction   = detection.instruction;
    } catch {
      // Non-fatal — detection is best-effort
    }

    // Create config first to get a cuid for the sub-org name
    const config = await prisma.tokenContractBuybackConfig.create({
      data: {
        tokenContractAddress: tokenContractAddress,
        targetTokenAddress,
        targetTokenSymbol:   meta.symbol,
        targetTokenDecimals: meta.decimals,
        ownerAddress,
        feeGetterName,
        recoveryAddress,
        feeRateBps:   resolvedFeeRateBps,
        thresholdUsd: resolvedThresholdUsd,
        burnMode,
        status: 'PROVISIONING',
      },
    });

    const allowedSwapInputTokens = [
      SPLIT_NATIVE_TOKEN_ADDRESS,
      ...SUPPORTED_TOKENS.map((t) => t.address as `0x${string}`),
    ];

    let subOrg;
    try {
      subOrg = await createBuybackSubOrg({
        agentId: `token-${config.id.slice(0, 8)}`,
        userEmail,
        policyParams: {
          userTokenAddress:      targetTokenAddress,
          allowedSwapInputTokens,
          recoveryAddress,
          treasuryAddress: getTreasuryAddress(),
        },
      });
    } catch (provisionErr: unknown) {
      // Delete the orphaned record so the user can retry cleanly
      await prisma.tokenContractBuybackConfig.delete({ where: { id: config.id } }).catch(() => {});
      throw provisionErr;
    }

    const updated = await prisma.tokenContractBuybackConfig.update({
      where: { id: config.id },
      data: {
        turnkeySubOrgId: subOrg.subOrgId,
        turnkeyWalletId: subOrg.walletId,
        walletAddress:   subOrg.walletAddress,
        policyId:        subOrg.policyId,
        status: 'PENDING_FEE_RECIPIENT_UPDATE',
      },
    });

    const setterHint = feeGetterName
      ? `Call \`set${feeGetterName.charAt(0).toUpperCase()}${feeGetterName.slice(1)}(${subOrg.walletAddress})\` on your token contract.`
      : `Set ${subOrg.walletAddress} as the fee recipient on your token contract.`;

    return res.status(201).json({
      ok: true,
      configId:      updated.id,
      walletAddress: subOrg.walletAddress,
      status:        updated.status,
      feeGetterName,
      instruction:   setterHint,
      note: 'Once fees start arriving in the wallet, buyback activates automatically. Only push-based fee flows are supported — the wallet must receive funds directly.',
    });
  } catch (err: unknown) {
    if (err instanceof TokenSafetyError) {
      return res.status(400).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[token-buyback/register] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/token-buyback/:id
 * Config status + live wallet balance snapshot.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.tokenContractBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    let balanceSnapshot = null;
    if (config.walletAddress && config.status === 'ACTIVE') {
      try {
        balanceSnapshot = await snapshotBuybackBalance(config.walletAddress as `0x${string}`);
      } catch {
        // best-effort
      }
    }

    const inFlight = await prisma.tokenContractExecution.findFirst({
      where: {
        configId: config.id,
        status: { in: ['QUEUED', 'SWAPPING', 'BURNING', 'RETRYING'] },
      },
      select: { id: true, status: true },
    });

    return res.json({
      id:                   config.id,
      tokenContractAddress: config.tokenContractAddress,
      targetTokenAddress:   config.targetTokenAddress,
      targetTokenSymbol:    config.targetTokenSymbol,
      targetTokenDecimals:  config.targetTokenDecimals,
      ownerAddress:         config.ownerAddress,
      walletAddress:        config.walletAddress,
      feeGetterName:        config.feeGetterName,
      status:               config.status,
      isActive:             config.isActive,
      feeRateBps:           config.feeRateBps,
      thresholdUsd:         config.thresholdUsd,
      accumulatedUsd:       balanceSnapshot?.totalUsd ?? null,
      assets:               balanceSnapshot?.assets   ?? null,
      lastCheckedAt:        config.lastCheckedAt,
      lastTriggeredAt:      config.lastTriggeredAt,
      inFlightExecution:    inFlight ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[token-buyback/:id] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /api/token-buyback/:id/check
 * Manually trigger a balance check and queue execution if threshold is met.
 */
router.post('/:id/check', async (req: Request, res: Response) => {
  try {
    const config = await prisma.tokenContractBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });
    if (!config.isActive) {
      return res.status(400).json({ error: 'Config is disabled' });
    }
    if (config.status === 'PENDING_FEE_RECIPIENT_UPDATE') {
      return res.status(400).json({
        error: 'Waiting for fee recipient update — set the buyback wallet as fee recipient on your token contract first',
        walletAddress: config.walletAddress,
      });
    }
    if (config.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Config is not active (status: ${config.status})` });
    }
    if (!config.walletAddress) {
      return res.status(400).json({ error: 'Wallet not yet provisioned' });
    }

    const snapshot = await snapshotBuybackBalance(config.walletAddress as `0x${string}`);

    await prisma.tokenContractBuybackConfig.update({
      where: { id: config.id },
      data: { lastCheckedAt: new Date() },
    });

    if (snapshot.totalUsd < config.thresholdUsd) {
      return res.json({
        queued: false,
        reason: 'below_threshold',
        accumulatedUsd: snapshot.totalUsd,
        thresholdUsd:   config.thresholdUsd,
      });
    }

    const existing = await prisma.tokenContractExecution.findFirst({
      where: {
        configId: config.id,
        status: { in: ['QUEUED', 'SWAPPING', 'BURNING', 'RETRYING'] },
      },
    });
    if (existing) {
      return res.json({ queued: false, reason: 'execution_in_flight', executionId: existing.id });
    }

    const execution = await prisma.tokenContractExecution.create({
      data: {
        configId:         config.id,
        triggerBalanceUsd: snapshot.totalUsd,
        assetsIn:         snapshot.assets as any,
      },
    });

    return res.json({ queued: true, executionId: execution.id, triggerBalanceUsd: snapshot.totalUsd });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[token-buyback/:id/check] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/token-buyback/:id
 * Disable a config. Does not destroy the Turnkey sub-org.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.tokenContractBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    await prisma.tokenContractBuybackConfig.update({
      where: { id: config.id },
      data: { isActive: false, status: 'PAUSED' },
    });

    return res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/token-buyback/:id/executions
 * Last 20 executions.
 */
router.get('/:id/executions', async (req: Request, res: Response) => {
  try {
    const executions = await prisma.tokenContractExecution.findMany({
      where:   { configId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take:    20,
    });
    return res.json({ executions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

export default router;
