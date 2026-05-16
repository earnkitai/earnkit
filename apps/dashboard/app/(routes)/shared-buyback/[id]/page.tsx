'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { toast } from 'sonner';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Hex,
  type PublicClient,
} from 'viem';
import { base } from 'viem/chains';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Coins,
  Loader2,
  Zap,
} from 'lucide-react';
import SharedBuybackCard from '../components/SharedBuybackCard';
import {
  buildDistributeAllCalldata,
  getSplitParamsFromFactory,
  readSplitContractBalances,
  SPLITS_NATIVE_TOKEN,
  type SplitParams,
} from '@/lib/splitsFactoryV2';

const STORAGE_KEY = 'earnkit_shared_buyback_configs';

// Known Base ERC-20s we probe for balances on the split contract. Keeping
// the list tight — the canonical buyback fee sources on Base are WETH and
// USDC. Add more here if other tokens routinely flow through a split.
const KNOWN_TOKENS: { address: `0x${string}`; symbol: string; decimals: number }[] = [
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
];

interface ConfigSummary {
  id: string;
  splitAddress: string | null;
  walletAddress: string | null;
  ownerAddress: string;
  tokenSymbol: string;
  status: string;
}

interface SplitAsset {
  token: `0x${string}` | typeof SPLITS_NATIVE_TOKEN;
  symbol: string;
  decimals: number;
  balance: bigint;
}

function formatBalance(balance: bigint, decimals: number, precision = 6): string {
  if (balance === BigInt(0)) return '0';
  const denom = BigInt(10) ** BigInt(decimals);
  const whole = balance / denom;
  const frac = balance % denom;
  if (frac === BigInt(0)) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, precision);
  return `${whole}.${fracStr.replace(/0+$/, '') || '0'}`;
}

export default function SharedBuybackDetailPage() {
  const params = useParams<{ id: string }>();
  const configId = params.id;
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();

  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [splitParams, setSplitParams] = useState<SplitParams | null>(null);
  const [paramsLoading, setParamsLoading] = useState(false);
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [assets, setAssets] = useState<SplitAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [distributing, setDistributing] = useState(false);

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: base,
        transport: http(),
      }) as unknown as PublicClient,
    [],
  );

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/shared-buyback/${configId}`);
      if (!res.ok) {
        setConfig(null);
        return;
      }
      const data = await res.json();
      setConfig({
        id: data.id,
        splitAddress: data.splitAddress,
        walletAddress: data.walletAddress,
        ownerAddress: data.ownerAddress,
        tokenSymbol: data.tokenSymbol,
        status: data.status,
      });
    } catch {
      setConfig(null);
    } finally {
      setConfigLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Once we have a split address, fetch the original deploy params (needed
  // to call `distribute` — the contract verifies the hash) and the current
  // asset balances sitting on the split contract.
  const loadSplitState = useCallback(async () => {
    if (!config?.splitAddress) return;
    setParamsLoading(true);
    setAssetsLoading(true);
    try {
      const [params, balances] = await Promise.all([
        getSplitParamsFromFactory(config.splitAddress, publicClient),
        readSplitContractBalances({
          splitAddress: config.splitAddress,
          tokens: KNOWN_TOKENS,
          publicClient,
        }),
      ]);
      if (!params) {
        setParamsError(
          'Could not locate this split in the V2.2 factory log range. The split may have been deployed by a different factory — distribution from EarnKit is only available for V2.2 PullSplits.',
        );
      } else {
        setParamsError(null);
      }
      setSplitParams(params);
      setAssets(balances);
    } catch (e: unknown) {
      setParamsError(e instanceof Error ? e.message : 'Failed to load split state');
    } finally {
      setParamsLoading(false);
      setAssetsLoading(false);
    }
  }, [config?.splitAddress, publicClient]);

  useEffect(() => {
    void loadSplitState();
  }, [loadSplitState]);

  const handleDistributeAll = async () => {
    if (!config?.splitAddress || !splitParams) return;
    const nonZero = assets.filter((a) => a.balance > BigInt(0));
    if (nonZero.length === 0) {
      toast.info('Nothing to distribute.');
      return;
    }
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) {
      toast.error('Connect your wallet first');
      return;
    }

    setDistributing(true);
    try {
      // One Multicall3.aggregate3 wraps every per-token distribute call —
      // single signature, single on-chain tx, atomic (revert all on any one
      // failure).
      const built = buildDistributeAllCalldata({
        splitParams,
        splitAddress: config.splitAddress,
        tokens: nonZero.map((a) => a.token),
        distributor: wallet.address,
      });

      await wallet.switchChain(base.id).catch(() => {});
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as Hex,
        chain: base,
        transport: custom(provider),
      });
      const hash = await walletClient.sendTransaction({
        to: built.to,
        data: built.data,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(
        `Distributed ${nonZero.length} asset${nonZero.length === 1 ? '' : 's'} to split recipients`,
      );
      await loadSplitState();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Distribute failed';
      toast.error(
        msg.includes('execution reverted')
          ? "Reverted — the on-chain split params didn't match. Refresh and try again."
          : msg,
      );
    } finally {
      setDistributing(false);
    }
  };

  if (!ready || !authenticated || configLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <Link
          href="/shared-buyback"
          className="text-sm text-black/40 hover:text-black flex items-center gap-1 mb-6 font-funnel-sans"
        >
          <ArrowLeft className="w-4 h-4" /> Back to buybacks
        </Link>
        <div className="rounded-[20px] border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700 font-funnel-sans">
            Couldn&apos;t load this buyback config. It may have been deleted or
            the ID is invalid.
          </p>
        </div>
      </div>
    );
  }

  const handleRemoved = (id: string) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const existing: string[] = raw ? JSON.parse(raw) : [];
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(existing.filter((x) => x !== id)),
      );
    } catch {
      /* non-fatal */
    }
    router.push('/shared-buyback');
  };

  const nonZeroAssets = assets.filter((a) => a.balance > BigInt(0));
  const splitDeployed = !!config.splitAddress;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <Link
        href="/shared-buyback"
        className="text-sm text-black/40 hover:text-black flex items-center gap-1 font-funnel-sans"
      >
        <ArrowLeft className="w-4 h-4" /> Back to buybacks
      </Link>

      <div>
        <h1 className="text-2xl font-semibold font-funnel-display text-black">
          {config.tokenSymbol}
        </h1>
        <p className="text-black/40 text-sm font-funnel-sans">
          Buyback config &amp; split management
        </p>
      </div>

      {/* Reuse the existing card for the bulk of the per-config UI (status,
          threshold, check-now, disable). */}
      <SharedBuybackCard configId={configId} onRemoved={handleRemoved} />

      {/* Distribute panel — only relevant once a split is attached. */}
      {splitDeployed && (
        <div className="rounded-[20px] border border-black/10 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold font-funnel-display text-black flex items-center gap-2">
                <Coins className="w-4 h-4 text-secondary-blue" />
                Distribute fees
              </h2>
              <p className="text-xs text-black/40 font-funnel-sans mt-1 leading-relaxed">
                Fees sitting on the split contract show up here once they
                arrive (from Clanker locker claims, Doppler airlock, or any
                fee source pointed at the split). Anyone can press
                Distribute — it moves the balance into the SplitsWarehouse
                credited to each recipient by their split percentage.
              </p>
            </div>
            <button
              onClick={loadSplitState}
              disabled={assetsLoading || paramsLoading}
              className="shrink-0 text-xs text-black/40 hover:text-black font-funnel-sans px-2 py-1 rounded-md hover:bg-black/5 transition-colors disabled:opacity-50"
            >
              {assetsLoading || paramsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {paramsError && (
            <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs text-amber-800 font-funnel-sans">
                {paramsError}
              </p>
            </div>
          )}

          {!paramsError && assetsLoading && assets.length === 0 && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-black/30" />
            </div>
          )}

          {!paramsError && !assetsLoading && nonZeroAssets.length === 0 && (
            <div className="rounded-[12px] border border-black/[0.08] bg-black/[0.02] px-3 py-6 text-center">
              <p className="text-xs text-black/40 font-funnel-sans">
                Nothing to distribute yet. When fees flow to{' '}
                <span className="font-mono">
                  {config.splitAddress?.slice(0, 6)}…
                  {config.splitAddress?.slice(-4)}
                </span>
                , the balances will appear here.
              </p>
            </div>
          )}

          {!paramsError && nonZeroAssets.length > 0 && (
            <>
              <div className="space-y-2">
                {nonZeroAssets.map((asset) => (
                  <div
                    key={asset.token}
                    className="flex items-center justify-between gap-3 rounded-[12px] border border-black/[0.08] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-black font-funnel-sans">
                        {formatBalance(asset.balance, asset.decimals)}{' '}
                        {asset.symbol}
                      </p>
                      <p className="text-[11px] text-black/30 font-mono mt-0.5">
                        {asset.token === SPLITS_NATIVE_TOKEN
                          ? 'native ETH'
                          : asset.token}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={handleDistributeAll}
                disabled={!splitParams || distributing}
                className="w-full flex items-center justify-center gap-1.5 bg-black hover:bg-black/80 text-white rounded-full px-4 py-2.5 text-sm font-funnel-sans transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {distributing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Distributing…
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Distribute all ({nonZeroAssets.length})
                  </>
                )}
              </button>
            </>
          )}

          {splitParams && nonZeroAssets.length === 0 && (
            <p className="text-[11px] text-black/30 font-funnel-sans">
              {splitParams.recipients.length} recipient
              {splitParams.recipients.length === 1 ? '' : 's'} ready to receive
              when funds arrive.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href="/executions"
          className="flex items-center gap-1 text-xs text-black/40 hover:text-black font-funnel-sans transition-colors"
        >
          View execution history <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
