import { erc20Abi, formatUnits } from 'viem';
import { prisma } from '../lib/prisma';
import {
  getBasePublicClient,
  readWarehouseBalance,
  SPLIT_NATIVE_TOKEN_ADDRESS,
} from '../lib/splitsWarehouse';
import { priceService } from '../services/priceService';
import { SUPPORTED_TOKENS, tokenService } from '../services/tokenService';

const POLL_INTERVAL_MS = 5 * 60_000; // 5 min
let intervalHandle: ReturnType<typeof setInterval> | null = null;

interface AssetSnapshot {
  symbol: string;
  address: string; // 0xEee... for ETH
  amount: string; // raw atomic units
  amountHuman: string;
  usdValue: number;
  source: 'warehouse' | 'wallet';
}

async function snapshotAssets(walletAddress: `0x${string}`): Promise<{
  assets: AssetSnapshot[];
  totalUsd: number;
}> {
  const client = getBasePublicClient();
  const assets: AssetSnapshot[] = [];

  // ETH — both Warehouse balance and on-wallet balance.
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
      console.error('[BuybackScanner] ETH price unavailable, treating as $0:', err);
    }
    if (ethWarehouse > BigInt(0)) {
      assets.push({
        symbol: 'ETH',
        address: SPLIT_NATIVE_TOKEN_ADDRESS,
        amount: ethWarehouse.toString(),
        amountHuman: formatUnits(ethWarehouse, 18),
        usdValue: ethWarehouse === ethTotalAtomic ? usd : usd * Number(ethWarehouse) / Number(ethTotalAtomic),
        source: 'warehouse',
      });
    }
    if (ethWallet > BigInt(0)) {
      assets.push({
        symbol: 'ETH',
        address: SPLIT_NATIVE_TOKEN_ADDRESS,
        amount: ethWallet.toString(),
        amountHuman: formatUnits(ethWallet, 18),
        usdValue: ethWallet === ethTotalAtomic ? usd : usd * Number(ethWallet) / Number(ethTotalAtomic),
        source: 'wallet',
      });
    }
  }

  // Each supported ERC-20.
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
          `[BuybackScanner] ${token.symbol} price unavailable, treating as $0:`,
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
          usdValue: total === onWallet ? usd : (usd * Number(onWallet)) / Number(total),
          source: 'wallet',
        });
      }
    } catch (err) {
      console.error(
        `[BuybackScanner] balance fetch failed for ${token.symbol} on ${walletAddress}:`,
        err,
      );
    }
  }

  const totalUsd = assets.reduce((sum, a) => sum + a.usdValue, 0);
  return { assets, totalUsd };
}

async function scan(): Promise<void> {
  const configs = await prisma.buybackConfig.findMany({
    where: { isActive: true },
  });

  if (configs.length === 0) return;

  console.log(`[BuybackScanner] Scanning ${configs.length} active config(s)`);

  for (const config of configs) {
    try {
      // Skip if a non-terminal execution already exists — let the executor finish first.
      const inFlight = await prisma.buybackExecution.findFirst({
        where: {
          buybackConfigId: config.id,
          status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] },
        },
        select: { id: true },
      });
      if (inFlight) {
        await prisma.buybackConfig.update({
          where: { id: config.id },
          data: { lastCheckedAt: new Date() },
        });
        continue;
      }

      const snapshot = await snapshotAssets(
        config.walletAddress as `0x${string}`,
      );

      await prisma.buybackConfig.update({
        where: { id: config.id },
        data: { lastCheckedAt: new Date() },
      });

      if (snapshot.totalUsd < config.thresholdUsd) {
        continue;
      }

      await prisma.buybackExecution.create({
        data: {
          buybackConfigId: config.id,
          status: 'QUEUED',
          triggerBalanceUsd: snapshot.totalUsd,
          assetsIn: snapshot.assets as any,
        },
      });

      console.log(
        `[BuybackScanner] Queued buyback for config ${config.id} ($${snapshot.totalUsd.toFixed(2)} >= $${config.thresholdUsd})`,
      );
    } catch (err) {
      console.error(
        `[BuybackScanner] Error processing config ${config.id}:`,
        err,
      );
    }
  }
}

export function startBuybackScannerWorker(): void {
  if (intervalHandle) return;
  console.log(
    `[BuybackScanner] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`,
  );
  scan().catch((e) => console.error('[BuybackScanner] Initial run error:', e));
  intervalHandle = setInterval(() => {
    scan().catch((e) => console.error('[BuybackScanner] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopBuybackScannerWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
