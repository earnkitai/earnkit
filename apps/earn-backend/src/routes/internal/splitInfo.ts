import { Router, Request, Response } from 'express';
import { isAddress, getAddress, erc20Abi } from 'viem';
import { readSplitConfig } from '../../lib/splitReader';
import {
  getBasePublicClient,
  SPLIT_NATIVE_TOKEN_ADDRESS,
} from '../../lib/splitsWarehouse';
import { SUPPORTED_TOKENS } from '../../services/tokenService';

/**
 * GET /api/internal/split-info?splitAddress=0x...
 *
 * Returns a split's EXACT on-chain config (recipients, allocations,
 * totalAllocation, distributionIncentive — read from the SplitUpdated event)
 * plus the split's current distributable token balances. Consumers (tokens.fun
 * admin) feed the config straight into distribute() so it can't revert on a
 * recipient/order mismatch. Internal-only (x-internal-secret).
 */
const router: Router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const raw = (req.query.splitAddress as string) || '';
  if (!isAddress(raw)) {
    res.status(400).json({ error: 'Valid splitAddress query param required' });
    return;
  }
  const splitAddress = getAddress(raw) as `0x${string}`;

  try {
    const config = await readSplitConfig(splitAddress);
    if (!config) {
      res.status(404).json({ error: 'Split config not found on-chain' });
      return;
    }

    const client = getBasePublicClient();
    const assets: Array<{
      tokenAddress: string;
      symbol: string;
      decimals: number;
      balance: string;
    }> = [];

    // ERC-20 holdings (USDC is the x402 settlement token; MINI included too).
    for (const t of SUPPORTED_TOKENS) {
      try {
        const bal = (await client.readContract({
          address: t.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [splitAddress],
        })) as bigint;
        if (bal > BigInt(0)) {
          assets.push({
            tokenAddress: t.address,
            symbol: t.symbol,
            decimals: t.decimals,
            balance: bal.toString(),
          });
        }
      } catch {
        /* skip this token */
      }
    }

    // Native ETH holdings.
    try {
      const ethBal = await client.getBalance({ address: splitAddress });
      if (ethBal > BigInt(0)) {
        assets.push({
          tokenAddress: SPLIT_NATIVE_TOKEN_ADDRESS,
          symbol: 'ETH',
          decimals: 18,
          balance: ethBal.toString(),
        });
      }
    } catch {
      /* skip eth */
    }

    res.json({
      splitAddress,
      recipients: config.recipients,
      allocations: config.allocations.map((a) => a.toString()),
      totalAllocation: config.totalAllocation.toString(),
      distributionIncentive: config.distributionIncentive,
      assets,
    });
  } catch (err: unknown) {
    console.error('[split-info] error:', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to read split info' });
  }
});

export default router;
