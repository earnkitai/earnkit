import { erc20Abi, formatUnits } from 'viem';
import { priceService } from '../services/priceService';
import { WETH_BASE } from './uniswap';
import type { BasePublicClient } from './splitsWarehouse';

/**
 * Market-price swap guard (fail-closed) — shared by both buyback workers.
 *
 * On-chain slippage (amountOutMinimum) is measured against the SAME pool the
 * swap executes in, so it cannot catch a wrong / thin / mispriced pool (e.g. a
 * Clanker token routed through the wrong Uniswap v4 pool key). This checks the
 * swap's expected output against an INDEPENDENT market price feed and aborts if
 * the value going out is far below the value going in.
 *
 * Fails CLOSED: if an independent market price for either side is unavailable,
 * it throws and the swap is skipped (and retried later) rather than executed
 * blind. The deviation ceiling is policy config (env) — never a price literal.
 */
// Absolute ceilings the operator env can NEVER exceed. Env may only make the
// guard tighter (or loosen up to these hard caps) — it can never be widened to
// the point of nullifying protection. Tightened from 20% to 12% after a Clanker
// V4 token bought back in the wrong pool: the wrong-pool swap still landed inside
// the old 20% band. 12% is the moderate ceiling — tight enough that a wrong/thin
// pool is refused, loose enough that a genuinely volatile token still executes.
const HARD_MAX_DEVIATION_BPS = 1200; // 12%
const HARD_MAX_SLIPPAGE_BPS = 500; //  5%

// A swap can never legitimately return materially MORE market value than it puts
// in (a real pool prices fees + impact against you, never for you). An inflated
// "out" therefore means the OUTPUT token's reference price is wrong/manipulated
// (e.g. a thin DexScreener pool) — exactly the case a low-deviation floor can't
// catch. Reject it. Hard cap so env can only tighten.
const HARD_MAX_UPSIDE_BPS = 1000; // 10%

export function maxMarketDeviationBps(): number {
  const raw = parseInt(process.env.BUYBACK_MAX_MARKET_DEVIATION_BPS ?? '', 10);
  // Default 10% (moderate). A valid env override is honored, but the effective
  // value is hard-capped at HARD_MAX_DEVIATION_BPS so env can never disable the guard.
  const configured = Number.isFinite(raw) && raw > 0 && raw < 10_000 ? raw : 1000;
  return Math.min(configured, HARD_MAX_DEVIATION_BPS);
}

// Upper deviation ceiling — how far ABOVE the input value the expected output may
// sit before we treat the reference as manipulated and refuse the swap.
export function maxMarketUpsideBps(): number {
  const raw = parseInt(process.env.BUYBACK_MAX_MARKET_UPSIDE_BPS ?? '', 10);
  const configured = Number.isFinite(raw) && raw > 0 && raw < 10_000 ? raw : 800; // default 8%
  return Math.min(configured, HARD_MAX_UPSIDE_BPS);
}

/**
 * Hard ceiling on per-swap slippage tolerance (amountOutMinimum vs quote). No
 * stored config value may exceed it — we cannot bear more than this on any swap.
 * Default 150 bps (1.5%), overridable via env. A missing/invalid config value
 * falls back to the ceiling rather than to something looser.
 */
export function clampSlippageBps(configuredBps: number): number {
  const raw = parseInt(process.env.BUYBACK_MAX_SLIPPAGE_BPS ?? '', 10);
  // Env ceiling is honored but itself capped at HARD_MAX_SLIPPAGE_BPS, so env
  // can never drive minOut toward zero (which would leave only the market guard).
  const envCeiling = Number.isFinite(raw) && raw > 0 && raw <= 10_000 ? raw : 150;
  const ceiling = Math.min(envCeiling, HARD_MAX_SLIPPAGE_BPS);
  if (!Number.isFinite(configuredBps) || configuredBps <= 0) return ceiling;
  return Math.min(configuredBps, ceiling);
}

/**
 * Max age (ms) of the market price the guard will accept. A cached price is fine
 * up to this bound; beyond it the guard forces a live refetch and, if that fails,
 * fails CLOSED (never validates a swap against a stale price). Default 30s.
 */
function guardPriceMaxAgeMs(): number {
  const raw = parseInt(process.env.BUYBACK_PRICE_MAX_AGE_MS ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

// Trade-PROPORTIONAL reference-depth requirement. When the guard's reference for
// a side comes from a specific DEX pool (DexScreener — i.e. no broad-market
// CoinGecko price), that pool must be deep enough that it can't be cheaply
// manipulated in lockstep with the swap to fool the guard. We size the
// requirement to the trade rather than a flat wall: a $50 buyback needs far less
// depth than a $50k one. required = max(absolute floor, multiple × tradeUsd).
function minReferenceLiquidityUsd(): number {
  const raw = parseInt(process.env.BUYBACK_MIN_REFERENCE_LIQUIDITY_USD ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1_000; // small absolute floor
}
function referenceDepthMultiple(): number {
  const raw = parseFloat(process.env.BUYBACK_REFERENCE_DEPTH_MULTIPLE ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 10; // pool ≥ 10× the trade
}

export async function assertSwapValueVsMarket(args: {
  client: BasePublicClient;
  inputToken: `0x${string}`;
  amountIn: bigint;
  outputToken: `0x${string}`;
  expectedOut: bigint;
}): Promise<void> {
  const maxAgeMs = guardPriceMaxAgeMs();
  // WETH is priced off the ETH feed (broad-market, pool-independent → treated as
  // adequately deep). Every other token — INCLUDING arbitrary revenue tokens and
  // non-registry buyback targets (Doppler/Clanker) — is priced via
  // getReferencePrice, which prefers CoinGecko and falls back to the deepest Base
  // DEX pool, returning that pool's depth so we can size the depth check below.
  // A token we cannot price independently throws → fail closed (leg skipped).
  const refOf = async (
    token: `0x${string}`,
  ): Promise<{ priceUsd: number; liquidityUsd: number | null }> => {
    if (token.toLowerCase() === WETH_BASE.toLowerCase()) {
      return { priceUsd: await priceService.getEthPriceUsd(maxAgeMs), liquidityUsd: null };
    }
    const r = await priceService.getReferencePrice(token);
    // Only DEX-sourced references carry a manipulability concern; a CoinGecko
    // (broad-market) price is treated as adequately deep (liquidityUsd = null).
    return { priceUsd: r.priceUsd, liquidityUsd: r.source === 'dexscreener' ? r.liquidityUsd : null };
  };

  // Read decimals on-chain for both sides — never assume 18.
  const decimalsOf = async (token: `0x${string}`): Promise<number> =>
    Number(
      await args.client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    );

  const [inputRef, outputRef, inputDecimals, outputDecimals] = await Promise.all([
    refOf(args.inputToken),
    refOf(args.outputToken),
    decimalsOf(args.inputToken),
    decimalsOf(args.outputToken),
  ]);

  const inUsd = Number(formatUnits(args.amountIn, inputDecimals)) * inputRef.priceUsd;
  const outUsd = Number(formatUnits(args.expectedOut, outputDecimals)) * outputRef.priceUsd;

  if (!(inUsd > 0) || !(outUsd > 0)) {
    throw new Error(
      'swap_value_guard: market price unavailable for one side — aborting (fail-closed)',
    );
  }

  // Proportional depth gate: any side referenced off a specific DEX pool must be
  // deep enough relative to THIS trade. Below the requirement the reference is
  // cheaply manipulable, so we fail closed (leg skipped, funds stay in the wallet
  // and are recoverable) rather than validate against a price an attacker controls.
  const requiredDepthUsd = Math.max(minReferenceLiquidityUsd(), inUsd * referenceDepthMultiple());
  for (const [label, ref] of [
    ['input', inputRef],
    ['output', outputRef],
  ] as const) {
    if (ref.liquidityUsd != null && ref.liquidityUsd < requiredDepthUsd) {
      throw new Error(
        `swap_value_guard: ${label} reference pool depth $${ref.liquidityUsd.toFixed(0)} < required ` +
          `$${requiredDepthUsd.toFixed(0)} (max($${minReferenceLiquidityUsd()}, ${referenceDepthMultiple()}× trade ` +
          `$${inUsd.toFixed(2)})) — reference too thin/manipulable, refusing swap`,
      );
    }
  }

  const bps = maxMarketDeviationBps();
  const minOutUsd = (inUsd * (10_000 - bps)) / 10_000;
  if (outUsd < minOutUsd) {
    throw new Error(
      `swap_value_guard: expected out ~$${outUsd.toFixed(4)} for in ~$${inUsd.toFixed(2)} ` +
        `(floor $${minOutUsd.toFixed(2)} at ${bps}bps) — refusing swap into a wrong/mispriced pool`,
    );
  }

  // Upper band: a swap returning far MORE value than it puts in means the output
  // token's reference price is inflated/manipulated (a thin pool the guard would
  // otherwise trust), so the "out" is not real. Fail closed rather than swap into
  // a pool whose favourable print we can't trust.
  const upBps = maxMarketUpsideBps();
  const maxOutUsd = (inUsd * (10_000 + upBps)) / 10_000;
  if (outUsd > maxOutUsd) {
    throw new Error(
      `swap_value_guard: expected out ~$${outUsd.toFixed(4)} for in ~$${inUsd.toFixed(2)} ` +
        `(ceiling $${maxOutUsd.toFixed(2)} at +${upBps}bps) — output reference looks manipulated, refusing swap`,
    );
  }
}
