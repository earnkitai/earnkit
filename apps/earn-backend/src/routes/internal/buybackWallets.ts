import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';

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
 * The operatorWallets array is read from env (OPERATOR_WALLET_ADDRESS), since
 * we typically run with one operator wallet — but the array shape leaves room
 * for per-region or per-fleet operator wallets later.
 */
const router: Router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const configs = await prisma.buybackConfig.findMany({
      where: { isActive: true },
      select: {
        walletAddress: true,
        tokenAddress: true,
      },
    });

    const operatorWalletAddress = process.env.OPERATOR_WALLET_ADDRESS;
    const operatorWallets = operatorWalletAddress
      ? [{ walletAddress: operatorWalletAddress }]
      : [];

    return res.json({
      buybackWallets: configs.map((c) => ({
        walletAddress: c.walletAddress,
        tokenAddress: c.tokenAddress,
      })),
      operatorWallets,
    });
  } catch (err: any) {
    console.error('[internal/buyback-wallets] error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
