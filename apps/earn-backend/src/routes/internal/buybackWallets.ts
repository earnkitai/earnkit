import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { getOperatorWalletAddress } from '../../lib/operatorGas';

/**
 * GET /api/internal/buyback-wallets
 *
 * Read-only endpoint consumed by the Cloudflare Worker co-signer to enforce
 * "destination must be a known buyback wallet" before co-signing operator-gas
 * drip txs, and to validate buyback wallet `from` addresses on signing
 * activities.
 *
 * Authenticated by the same INTERNAL_API_SECRET pattern used by /internal/deploy-split.
 *
 * Returns:
 *   {
 *     buybackWallets: [{ walletAddress, tokenAddress }],
 *     operatorWallets: [{ walletAddress }]
 *   }
 *
 * The operator wallet address is derived from OPERATOR_GAS_PRIVATE_KEY, since
 * we typically run with one operator wallet — but the array shape leaves room
 * for per-region or per-fleet operator wallets later.
 */
const router: Router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [agentConfigs, sharedConfigs, tokenConfigs] = await Promise.all([
      prisma.buybackConfig.findMany({
        where: { isActive: true },
        select: { walletAddress: true, tokenAddress: true, recoveryAddress: true },
      }),
      prisma.sharedSplitBuybackConfig.findMany({
        where: { isActive: true, walletAddress: { not: null } },
        select: { walletAddress: true, tokenAddress: true, recoveryAddress: true },
      }),
      prisma.tokenContractBuybackConfig.findMany({
        where: { isActive: true, walletAddress: { not: null } },
        select: { walletAddress: true, targetTokenAddress: true, recoveryAddress: true },
      }),
    ]);

    const buybackWallets = [
      ...agentConfigs.map((c) => ({
        walletAddress: c.walletAddress,
        tokenAddress: c.tokenAddress,
        recoveryAddress: c.recoveryAddress,
      })),
      ...sharedConfigs.map((c) => ({
        walletAddress: c.walletAddress!,
        tokenAddress: c.tokenAddress,
        recoveryAddress: c.recoveryAddress,
      })),
      ...tokenConfigs.map((c) => ({
        walletAddress: c.walletAddress!,
        tokenAddress: c.targetTokenAddress,
        recoveryAddress: c.recoveryAddress,
      })),
    ];

    const operatorWalletAddress = getOperatorWalletAddress();
    const operatorWallets = operatorWalletAddress ? [{ walletAddress: operatorWalletAddress }] : [];

    const treasuryAddress = process.env.BUYBACK_TREASURY_ADDRESS ?? null;

    return res.json({ buybackWallets, operatorWallets, treasuryAddress });
  } catch (err: any) {
    console.error('[internal/buyback-wallets] error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
