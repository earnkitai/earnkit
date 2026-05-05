import { erc20Abi, formatUnits } from 'viem';
import {
  getBasePublicClient,
  readWarehouseBalance,
  SPLIT_NATIVE_TOKEN_ADDRESS,
} from './splitsWarehouse';
import { priceService } from '../services/priceService';
import { SUPPORTED_TOKENS } from '../services/tokenService';

/**
 * Reads the accumulated balance of a buyback wallet — both the Splits Warehouse
 * pending balance and the on-wallet balance, for ETH and every supported ERC-20.
 *
 * Used by the scanner worker (to decide if threshold is crossed) and by the
 * GET /buyback/status endpoint (to show the user "$X.XX of $Y.YY accumulated").
 *
 * Pricing is best-effort: if a price feed is unavailable the asset's USD value
 * falls back to 0 so we never trip a threshold on a stale price spike.
 */

export interface BuybackAssetSnapshot {
  symbol: string;
  address: string; // 0xEee... for ETH
  amount: string; // raw atomic units
  amountHuman: string;
  usdValue: number;
  source: 'warehouse' | 'wallet';
}

export interface BuybackBalanceSnapshot {
  assets: BuybackAssetSnapshot[];
  totalUsd: number;
}

export async function snapshotBuybackBalance(
  walletAddress: `0x${string}`,
): Promise<BuybackBalanceSnapshot> {
  const client = getBasePublicClient();
  const assets: BuybackAssetSnapshot[] = [];

  // ETH — Warehouse + on-wallet.
  const ethWarehouse = await readWarehouseBalance({
    owner: walletAddress,
    token: SPLIT_NATIVE_TOKEN_ADDRESS,
    client,
  });
  const ethWallet = await client.getBalance({ address: walletAddress });
  const ethTotalAtomic = ethWarehouse + ethWallet;
  if (ethTotalAtomic > BigInt(0)) {
    const eth = Number(formatUnits(ethTotalAtomic, 18));
    let usd = 0;
    try {
      usd = await priceService.convertEthToUsd(eth);
    } catch (err) {
      console.error('[buybackBalance] ETH price unavailable, treating as $0:', err);
    }
    if (ethWarehouse > BigInt(0)) {
      assets.push({
        symbol: 'ETH',
        address: SPLIT_NATIVE_TOKEN_ADDRESS,
        amount: ethWarehouse.toString(),
        amountHuman: formatUnits(ethWarehouse, 18),
        usdValue:
          ethWarehouse === ethTotalAtomic
            ? usd
            : (usd * Number(ethWarehouse)) / Number(ethTotalAtomic),
        source: 'warehouse',
      });
    }
    if (ethWallet > BigInt(0)) {
      assets.push({
        symbol: 'ETH',
        address: SPLIT_NATIVE_TOKEN_ADDRESS,
        amount: ethWallet.toString(),
        amountHuman: formatUnits(ethWallet, 18),
        usdValue:
          ethWallet === ethTotalAtomic
            ? usd
            : (usd * Number(ethWallet)) / Number(ethTotalAtomic),
        source: 'wallet',
      });
    }
  }

  for (const token of SUPPORTED_TOKENS) {
    try {
      const wh = await readWarehouseBalance({
        owner: walletAddress,
        token: token.address as `0x${string}`,
        client,
      });
      const onWallet = (await client.readContract({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress],
      })) as bigint;
      const total = wh + onWallet;
      if (total === BigInt(0)) continue;

      let usd = 0;
      try {
        usd = await priceService.convertTokenToUsd(total.toString(), token.symbol);
      } catch (err) {
        console.error(
          `[buybackBalance] ${token.symbol} price unavailable, treating as $0:`,
          err,
        );
      }

      if (wh > BigInt(0)) {
        assets.push({
          symbol: token.symbol,
          address: token.address,
          amount: wh.toString(),
          amountHuman: formatUnits(wh, token.decimals),
          usdValue: total === wh ? usd : (usd * Number(wh)) / Number(total),
          source: 'warehouse',
        });
      }
      if (onWallet > BigInt(0)) {
        assets.push({
          symbol: token.symbol,
          address: token.address,
          amount: onWallet.toString(),
          amountHuman: formatUnits(onWallet, token.decimals),
          usdValue:
            total === onWallet ? usd : (usd * Number(onWallet)) / Number(total),
          source: 'wallet',
        });
      }
    } catch (err) {
      console.error(
        `[buybackBalance] balance fetch failed for ${token.symbol} on ${walletAddress}:`,
        err,
      );
    }
  }

  const totalUsd = assets.reduce((sum, a) => sum + a.usdValue, 0);
  return { assets, totalUsd };
}
