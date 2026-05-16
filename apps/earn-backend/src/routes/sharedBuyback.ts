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
import { snapshotBuybackBalance } from '../lib/buybackBalance';
import { isWalletInSplit } from '../lib/splitReader';
import { SUPPORTED_TOKENS } from '../services/tokenService';
import { SPLIT_NATIVE_TOKEN_ADDRESS } from '../lib/splitsWarehouse';
import { BuybackAuthError, requireBuybackAuth } from '../lib/buybackAuth';
import { detectFeeRecipient } from '../lib/tokenFeeDetector';

const router: Router = Router();

/**
 * POST /api/shared-buyback/detect
 *
 * Purely informational: probes a token contract for a standard fee-recipient
 * setter so the Token-card UI can show "Call setFeeRecipient(<split>)" once
 * we've deployed the split. No auth needed — this is read-only on-chain.
 *
 * Defined BEFORE the `/:id` routes so Express doesn't treat "detect" as an
 * id parameter.
 */
router.post('/detect', async (req: Request, res: Response) => {
  try {
    const { tokenContractAddress: raw, callerAddress: rawCaller } =
      req.body ?? {};
    if (!raw || !isAddress(raw)) {
      return res
        .status(400)
        .json({ error: 'tokenContractAddress must be a valid 0x address' });
    }
    const tokenContractAddress = getAddress(raw) as `0x${string}`;
    const callerAddress =
      rawCaller && isAddress(rawCaller)
        ? (getAddress(rawCaller) as `0x${string}`)
        : undefined;

    await assertHasCode(tokenContractAddress);
    const detection = await detectFeeRecipient(
      tokenContractAddress,
      callerAddress,
    );
    return res.json(detection);
  } catch (err: unknown) {
    if (err instanceof TokenSafetyError) {
      return res.status(400).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/detect] error:', err);
    return res.status(500).json({ error: message });
  }
});

function getPlatformFeeRateBps(): number {
  const val = parseInt(process.env.PLATFORM_FEE_BPS ?? '100', 10);
  return isNaN(val) ? 100 : Math.min(Math.max(val, 0), 2000);
}

function getPlatformThresholdUsd(): number {
  const val = parseFloat(process.env.PLATFORM_THRESHOLD_USD ?? '10');
  return isNaN(val) || val <= 0 ? 10 : val;
}

function getTreasuryAddress(): `0x${string}` | undefined {
  const addr = process.env.BUYBACK_TREASURY_ADDRESS;
  if (!addr || !isAddress(addr)) return undefined;
  return getAddress(addr) as `0x${string}`;
}

/**
 * POST /api/shared-buyback/register
 *
 * Provision a Turnkey buyback wallet and create a buyback config row. Two
 * modes (selected by whether `splitAddress` is present in the body):
 *
 *   1. **Splits card flow** (`splitAddress` provided)
 *      User has a pre-existing 0xSplits contract. We register against it and
 *      they manually add the buyback wallet as a recipient.
 *
 *   2. **Token card flow** (`splitAddress` omitted / null)
 *      User will deploy a fresh 0xSplits contract from the client AFTER this
 *      call returns (they need the just-provisioned buyback wallet baked into
 *      the recipients). They follow up with `POST /:id/set-split` to attach
 *      the deployed split. Until then, splitAddress is NULL in the row.
 *
 * Body:
 *   ownerAddress    — user's Safe or EOA (for reference only; not enforced on-chain here)
 *   splitAddress    — optional. 0xSplits V2 contract address (mode 1) or null/omitted (mode 2)
 *   targetToken     — ERC-20 to buy back & burn
 *   recoveryAddress — EOA for emergency fund sweep
 *   userEmail       — becomes the Turnkey sub-org root authenticator
 *   thresholdUsd    — optional, default platform minimum
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const {
      ownerAddress: rawOwner,
      splitAddress: rawSplit,
      targetToken: rawToken,
      recoveryAddress: rawRecovery,
      userEmail,
      thresholdUsd,
    } = req.body ?? {};

    if (!rawOwner || !isAddress(rawOwner)) {
      return res.status(400).json({ error: 'ownerAddress must be a valid 0x address' });
    }
    // splitAddress is optional. If absent/null/empty, we enter deferred mode.
    const isDeferred = rawSplit == null || rawSplit === '';
    if (!isDeferred && !isAddress(rawSplit)) {
      return res.status(400).json({ error: 'splitAddress must be a valid 0x address' });
    }
    if (!rawToken || !isAddress(rawToken)) {
      return res.status(400).json({ error: 'targetToken must be a valid 0x address' });
    }
    if (!rawRecovery || !isAddress(rawRecovery)) {
      return res.status(400).json({ error: 'recoveryAddress must be a valid 0x address' });
    }
    if (!userEmail || typeof userEmail !== 'string') {
      return res.status(400).json({ error: 'userEmail is required' });
    }

    const ownerAddress = getAddress(rawOwner) as `0x${string}`;
    const splitAddress = isDeferred ? null : (getAddress(rawSplit) as `0x${string}`);
    const tokenAddress = getAddress(rawToken) as `0x${string}`;
    const recoveryAddress = getAddress(rawRecovery) as `0x${string}`;
    const resolvedFeeRateBps = getPlatformFeeRateBps();
    const platformThreshold = getPlatformThresholdUsd();
    // User may set threshold higher than platform default, never lower
    const resolvedThresholdUsd = typeof thresholdUsd === 'number' && thresholdUsd > platformThreshold
      ? thresholdUsd
      : platformThreshold;

    await requireBuybackAuth({
      owner: ownerAddress,
      action: splitAddress
        ? { kind: 'register', splitAddress, tokenAddress, recoveryAddress }
        : { kind: 'register-deferred', tokenAddress, recoveryAddress },
      body: req.body,
    });

    // Token safety checks — same as agent buyback
    await assertHasCode(tokenAddress);
    const meta = await getTokenMeta(tokenAddress);
    await assertNotHoneypot(tokenAddress);

    const canDead = await canReceiveDead(tokenAddress);
    let burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
    if (canDead) {
      burnMode = 'DEAD_ADDRESS';
    } else {
      const hasBurn = await detectBurnFunction(tokenAddress);
      if (!hasBurn) {
        throw new TokenSafetyError(
          'no_burn_function',
          `Token ${tokenAddress} blocks transfers to the dead address and exposes no burn() function`,
        );
      }
      burnMode = 'TOKEN_BURN_FN';
    }

    // Create a placeholder config first so we have a cuid for the sub-org name
    const config = await prisma.sharedSplitBuybackConfig.create({
      data: {
        ownerAddress,
        splitAddress,
        tokenAddress,
        tokenSymbol: meta.symbol,
        tokenDecimals: meta.decimals,
        recoveryAddress,
        feeRateBps: resolvedFeeRateBps,
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
        agentId: `shared-${config.id.slice(0, 8)}`,
        userEmail,
        policyParams: {
          userTokenAddress: tokenAddress,
          allowedSwapInputTokens,
          recoveryAddress,
          treasuryAddress: getTreasuryAddress(),
        },
      });
    } catch (provisionErr: unknown) {
      // Orphan cleanup failure must be loud — see docs §3.
      try {
        await prisma.sharedSplitBuybackConfig.delete({ where: { id: config.id } });
      } catch (cleanupErr: unknown) {
        console.error(
          '[shared-buyback/register] FAILED to delete orphan config %s after provision failure — manual cleanup required:',
          config.id,
          cleanupErr,
        );
      }
      throw provisionErr;
    }

    const updated = await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: {
        turnkeySubOrgId: subOrg.subOrgId,
        turnkeyWalletId: subOrg.walletId,
        walletAddress: subOrg.walletAddress,
        policyId: subOrg.policyId,
        status: 'PENDING_SPLIT_UPDATE',
      },
    });

    return res.status(201).json({
      ok: true,
      configId: updated.id,
      walletAddress: subOrg.walletAddress,
      status: updated.status,
      // For the splits-card flow we know which split they intend. For the
      // token-card flow (deferred), the next step is to deploy a split and
      // POST /:id/set-split — the client orchestrates that, no instruction
      // text needed here.
      instructions: splitAddress
        ? `Add ${subOrg.walletAddress} as a recipient to your split at ${splitAddress}. Once added, buyback will activate automatically.`
        : `Deploy your split with ${subOrg.walletAddress} as a recipient, then call /set-split.`,
    });
  } catch (err: unknown) {
    if (err instanceof BuybackAuthError) {
      return res.status(401).json({ error: err.message, reason: err.reason });
    }
    if (err instanceof TokenSafetyError) {
      return res.status(400).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/register] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/shared-buyback/:id
 * Returns config status + live balance snapshot.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    let balanceSnapshot = null;
    if (config.walletAddress && config.status === 'ACTIVE') {
      try {
        balanceSnapshot = await snapshotBuybackBalance(config.walletAddress as `0x${string}`);
      } catch {
        // non-fatal — balance is best-effort
      }
    }

    const inFlight = await prisma.sharedSplitExecution.findFirst({
      where: { configId: config.id, status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] } },
      select: { id: true, status: true },
    });

    return res.json({
      id: config.id,
      ownerAddress: config.ownerAddress,
      splitAddress: config.splitAddress,
      walletAddress: config.walletAddress,
      tokenAddress: config.tokenAddress,
      tokenSymbol: config.tokenSymbol,
      tokenDecimals: config.tokenDecimals,
      status: config.status,
      isActive: config.isActive,
      feeRateBps: config.feeRateBps,
      thresholdUsd: config.thresholdUsd,
      accumulatedUsd: balanceSnapshot?.totalUsd ?? null,
      assets: balanceSnapshot?.assets ?? null,
      lastCheckedAt: config.lastCheckedAt,
      lastTriggeredAt: config.lastTriggeredAt,
      inFlightExecution: inFlight ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/:id] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /api/shared-buyback/:id/check
 * Manually trigger a balance check and queue an execution if threshold is met.
 */
router.post('/:id/check', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    await requireBuybackAuth({
      owner: config.ownerAddress as `0x${string}`,
      action: { kind: 'check', configId: config.id },
      body: req.body,
    });

    if (!config.isActive) {
      return res.status(400).json({ error: 'Config is disabled' });
    }
    if (config.status === 'PENDING_SPLIT_UPDATE') {
      return res.status(400).json({
        error: 'Waiting for split update — add the buyback wallet as a recipient to your split first',
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

    await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: { lastCheckedAt: new Date() },
    });

    if (snapshot.totalUsd < config.thresholdUsd) {
      return res.json({
        queued: false,
        reason: 'below_threshold',
        accumulatedUsd: snapshot.totalUsd,
        thresholdUsd: config.thresholdUsd,
      });
    }

    const existing = await prisma.sharedSplitExecution.findFirst({
      where: { configId: config.id, status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] } },
    });
    if (existing) {
      return res.json({ queued: false, reason: 'execution_in_flight', executionId: existing.id });
    }

    const execution = await prisma.sharedSplitExecution.create({
      data: {
        configId: config.id,
        triggerBalanceUsd: snapshot.totalUsd,
        assetsIn: snapshot.assets as any,
      },
    });

    return res.json({ queued: true, executionId: execution.id, triggerBalanceUsd: snapshot.totalUsd });
  } catch (err: unknown) {
    if (err instanceof BuybackAuthError) {
      return res.status(401).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/:id/check] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * PATCH /api/shared-buyback/:id — update mutable fields (currently thresholdUsd).
 * Threshold may be set to any value at or above the platform minimum
 * (`PLATFORM_THRESHOLD_USD` env) — raise or lower freely.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    const { thresholdUsd } = req.body ?? {};
    if (typeof thresholdUsd !== 'number' || thresholdUsd <= 0) {
      return res.status(400).json({ error: 'thresholdUsd must be a positive number' });
    }

    await requireBuybackAuth({
      owner: config.ownerAddress as `0x${string}`,
      action: { kind: 'patch', configId: config.id, thresholdUsd },
      body: req.body,
    });

    const platformThreshold = getPlatformThresholdUsd();
    if (thresholdUsd < platformThreshold) {
      return res.status(400).json({
        error: `thresholdUsd must be at least the platform minimum ($${platformThreshold})`,
      });
    }

    const updated = await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: { thresholdUsd },
    });

    return res.json({ ok: true, thresholdUsd: updated.thresholdUsd });
  } catch (err: unknown) {
    if (err instanceof BuybackAuthError) {
      return res.status(401).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/:id PATCH] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /api/shared-buyback/:id/check-activation
 * Manually triggers the on-chain check: activates the config if the buyback
 * wallet is now a recipient in the split.
 */
router.post('/:id/check-activation', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    await requireBuybackAuth({
      owner: config.ownerAddress as `0x${string}`,
      action: { kind: 'check-activation', configId: config.id },
      body: req.body,
    });

    if (config.status !== 'PENDING_SPLIT_UPDATE') {
      return res.json({ activated: false, reason: 'not_pending' });
    }
    if (!config.walletAddress) {
      return res.status(400).json({ error: 'Wallet not provisioned' });
    }
    if (!config.splitAddress) {
      return res.json({ activated: false, reason: 'split_not_set' });
    }

    const inSplit = await isWalletInSplit(
      config.splitAddress as `0x${string}`,
      config.walletAddress as `0x${string}`,
    );

    if (inSplit === true) {
      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: { status: 'ACTIVE' },
      });
      return res.json({ activated: true });
    }

    // null = membership unknown vs false = definitively absent — see docs §4.
    return res.json({
      activated: false,
      reason: inSplit === null ? 'membership_unknown' : 'not_in_split',
    });
  } catch (err: unknown) {
    if (err instanceof BuybackAuthError) {
      return res.status(401).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/:id/check-activation] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /api/shared-buyback/:id/set-split
 *
 * Token-card flow only. Attach a freshly-deployed 0xSplits contract to a
 * config that was registered in deferred mode. We verify the split actually
 * contains the buyback wallet as a recipient before accepting it, and
 * activate the config in the same call so the worker can start polling.
 *
 * Body: { splitAddress, signature, signedAt }
 */
router.post('/:id/set-split', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    const { splitAddress: rawSplit } = req.body ?? {};
    if (!rawSplit || !isAddress(rawSplit)) {
      return res.status(400).json({ error: 'splitAddress must be a valid 0x address' });
    }
    const splitAddress = getAddress(rawSplit) as `0x${string}`;

    await requireBuybackAuth({
      owner: config.ownerAddress as `0x${string}`,
      action: { kind: 'set-split', configId: config.id, splitAddress },
      body: req.body,
    });

    if (config.splitAddress) {
      return res.status(400).json({ error: 'Split is already set for this config' });
    }
    if (!config.walletAddress) {
      return res.status(400).json({ error: 'Wallet not provisioned' });
    }
    if (config.status !== 'PENDING_SPLIT_UPDATE') {
      return res.status(400).json({ error: `Config is not awaiting split (status: ${config.status})` });
    }

    // Verify the split includes the buyback wallet. Tri-state:
    //   true  → confirmed in split → activate
    //   false → definitively absent → reject (caller passed a bad split)
    //   null  → membership unknown (event log not yet indexed by public RPC,
    //           or V2.2 PullSplits don't emit SplitUpdated on init). In that
    //           case we still activate, because this endpoint is only called
    //           from the Token-card flow where the client built the
    //           createSplit calldata with the buyback wallet baked in — the
    //           user signed our exact calldata, so the wallet is provably a
    //           recipient. If it somehow isn't, the config sits ACTIVE but
    //           the worker will see zero balance and just never fire — no
    //           safety risk, only a wasted config slot.
    const inSplit = await isWalletInSplit(splitAddress, config.walletAddress as `0x${string}`);
    if (inSplit === false) {
      return res.status(400).json({
        error: 'The provided split does not contain the buyback wallet as a recipient',
        reason: 'wallet_not_in_split',
        walletAddress: config.walletAddress,
      });
    }

    const updated = await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: { splitAddress, status: 'ACTIVE' },
    });

    return res.json({
      ok: true,
      configId: updated.id,
      splitAddress: updated.splitAddress,
      status: updated.status,
      activated: true,
      membershipConfirmed: inSplit === true,
    });
  } catch (err: unknown) {
    if (err instanceof BuybackAuthError) {
      return res.status(401).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/:id/set-split] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/shared-buyback/:id
 * Disable a config. Does not destroy the Turnkey sub-org.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    await requireBuybackAuth({
      owner: config.ownerAddress as `0x${string}`,
      action: { kind: 'delete', configId: config.id },
      body: req.body,
    });

    await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: { isActive: false, status: 'PAUSED' },
    });

    return res.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof BuybackAuthError) {
      return res.status(401).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/shared-buyback/:id/executions
 * Last 20 executions.
 */
router.get('/:id/executions', async (req: Request, res: Response) => {
  try {
    const executions = await prisma.sharedSplitExecution.findMany({
      where: { configId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return res.json({ executions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

export default router;
