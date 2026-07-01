import { erc20Abi, formatUnits, parseUnits } from 'viem';
import {
  getBasePublicClient,
  readWarehouseBalance,
  SPLIT_NATIVE_TOKEN_ADDRESS,
} from './splitsWarehouse';
import { priceService } from '../services/priceService';
import { discoverWalletErc20s } from './tokenDiscovery';
import { WETH_BASE } from './uniswap';

// Must match buybackExecutorWorker — the executor never swaps this ETH, so
// we must not count it toward the accumulated balance either.
const MIN_GAS_RESERVE_WEI = parseUnits(process.env.BUYBACK_GAS_RESERVE_ETH || '0.002', 18);

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
  // The buyback TARGET token, excluded from "accumulated balance": it's the
  // OUTPUT, not revenue-in. Counting it inflates the threshold check (spurious
  // re-triggers) and the displayed accumulated USD.
  excludeToken?: string,
): Promise<BuybackBalanceSnapshot> {
  const client = getBasePublicClient();
  const assets: BuybackAssetSnapshot[] = [];

  // ETH — Warehouse + on-wallet.
  const ethWarehouse = await readWarehouseBalance({
    owner: walletAddress,
    token: SPLIT_NATIVE_TOKEN_ADDRESS,
    client,
  });
  const ethWalletRaw = await client.getBalance({ address: walletAddress });
  // Strip the gas reserve — it is never swapped, so it must not inflate the
  // displayed balance or push the threshold check over the line prematurely.
  const ethWallet =
    ethWalletRaw > MIN_GAS_RESERVE_WEI ? ethWalletRaw - MIN_GAS_RESERVE_WEI : BigInt(0);
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

  // Every ERC-20 the wallet actually holds — WETH + SUPPORTED_TOKENS + any
  // revenue token — discovered dynamically so the threshold check matches what
  // the executor will actually swap (workers use the same discoverWalletErc20s).
  // Without this, WETH-denominated fees (the common case for Uniswap/Clanker
  // fee redirects) are invisible to the scanner and buybacks never trigger even
  // though the executor can spend them.
  const walletTokens = await discoverWalletErc20s(walletAddress);
  for (const token of walletTokens) {
    try {
      const tokenAddr = token.address;
      if (excludeToken && tokenAddr.toLowerCase() === excludeToken.toLowerCase()) continue;
      const wh = await readWarehouseBalance({
        owner: walletAddress,
        token: tokenAddr,
        client,
      });
      const onWallet = (await client.readContract({
        address: tokenAddr,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress],
      })) as bigint;
      const total = wh + onWallet;
      if (total === BigInt(0)) continue;

      // Price best-effort. WETH is priced off the ETH feed; SUPPORTED_TOKENS by
      // symbol. Unknown/spam tokens have no feed and fall back to $0 so they can
      // never trip a threshold (fail-closed — see PAYMENTS.md).
      let usd = 0;
      try {
        if (tokenAddr.toLowerCase() === WETH_BASE.toLowerCase()) {
          usd = await priceService.convertEthToUsd(
            Number(formatUnits(total, token.decimals)),
          );
        } else {
          // Price by ADDRESS, not the discovered symbol — symbols are spoofable,
          // so a scam token calling itself "USDC" must not borrow USDC's price.
          // getTokenPriceUsd throws for unknown addresses → caught → $0.
          const price = await priceService.getTokenPriceUsd(tokenAddr);
          usd = Number(formatUnits(total, token.decimals)) * price;
        }
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
