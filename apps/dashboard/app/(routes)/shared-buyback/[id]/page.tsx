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
  encodeFunctionData,
  http,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';
import { base } from 'viem/chains';
import {
  ArrowLeft,
  ChevronRight,
  Coins,
  Loader2,
  Search,
  Wallet,
  Zap,
} from 'lucide-react';
import SharedBuybackCard from '../components/SharedBuybackCard';
import {
  buildDistributeAllCalldata,
  buildWarehouseWithdrawCalldata,
  getSplitParamsFromFactory,
  readSplitContractBalances,
  readWarehouseBalance,
  SPLITS_NATIVE_TOKEN,
  waitForSuccessReceipt,
  type SplitParams,
} from '@/lib/splitsFactoryV2';
import {
  buildUpdateRecipientCalldata,
  getClankerV4Deployment,
  type ClankerV4Deployment,
} from '@/lib/clankerV4';
import {
  buildUpdateV3RecipientCalldata,
  findClankerV3PositionsForCreator,
  probeClankerV3Position,
  type ClankerV3Position,
} from '@/lib/clankerV3';

const STORAGE_KEY = 'earnkit_shared_buyback_configs';
// Per-config persistence of the source token contract — the user's token
// whose fees we want to redirect to the split. We don't store it on the
// config row (would need a schema change), so cache it client-side so the
// user doesn't have to retype it across visits.
const SOURCE_TOKEN_KEY = (id: string) => `earnkit_source_token_${id}`;

interface DetectionResult {
  detected: boolean;
  getterName: string | null;
  setterName: string | null;
  currentRecipient: string | null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const isAddress = (val: string) => ADDRESS_RE.test(val.trim());

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

  // Source-token redirect state (panel A + B)
  const [sourceToken, setSourceToken] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [clankerDeployment, setClankerDeployment] =
    useState<ClankerV4Deployment | null>(null);
  const [clankerRewardIndex, setClankerRewardIndex] = useState('0');
  // Clanker v3 positions are creator-keyed, not token-keyed, so we surface
  // them whenever the connected wallet has any — independent of source token.
  const [v3Positions, setV3Positions] = useState<ClankerV3Position[]>([]);
  const [v3SelectedKey, setV3SelectedKey] = useState<string | null>(null);
  // Manual fallback: lets a user whose admin came from a rotation paste an
  // LP tokenId directly. The probe walks both v3 lockers and adds the
  // result to the position list if found.
  const [v3ManualInput, setV3ManualInput] = useState('');
  const [v3Probing, setV3Probing] = useState(false);
  const [redirecting, setRedirecting] = useState<
    'vanilla' | 'clanker' | 'clanker-v3' | null
  >(null);

  // Warehouse claim state (panel C). Balances keyed by token address.
  interface WarehouseBalance {
    token: `0x${string}` | typeof SPLITS_NATIVE_TOKEN;
    symbol: string;
    decimals: number;
    balance: bigint;
  }
  const [warehouseBalances, setWarehouseBalances] = useState<WarehouseBalance[]>(
    [],
  );
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);

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

  // Restore the previously-pasted source token for this config (if any).
  useEffect(() => {
    try {
      const cached = localStorage.getItem(SOURCE_TOKEN_KEY(configId));
      if (cached && isAddress(cached)) setSourceToken(cached);
    } catch {
      /* localStorage unavailable */
    }
  }, [configId]);

  // When the source token changes to a valid address, persist it and probe:
  //   - `/api/shared-buyback/detect` for a standard fee-recipient setter
  //   - Clanker v4 factory for the per-token locker
  // Both run in parallel; either, both, or neither may succeed.
  useEffect(() => {
    const addr = sourceToken.trim();
    if (!isAddress(addr)) {
      setDetection(null);
      setClankerDeployment(null);
      return;
    }
    try {
      localStorage.setItem(SOURCE_TOKEN_KEY(configId), addr);
    } catch {
      /* non-fatal */
    }

    let cancelled = false;
    setDetecting(true);
    (async () => {
      const [detResp, clanker] = await Promise.all([
        fetch('/api/shared-buyback/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenContractAddress: addr }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        getClankerV4Deployment(addr, publicClient).catch(() => null),
      ]);
      if (cancelled) return;
      setDetection(detResp);
      setClankerDeployment(clanker);
      setDetecting(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceToken, configId, publicClient]);

  // Warehouse balances for the connected wallet — the user's own claimable
  // share that landed in the warehouse after Distribute. Refreshed manually
  // and after a successful claim.
  const loadWarehouseBalances = useCallback(async () => {
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) {
      setWarehouseBalances([]);
      return;
    }
    setWarehouseLoading(true);
    try {
      const owner = wallet.address as `0x${string}`;
      const probes: WarehouseBalance[] = [
        { token: SPLITS_NATIVE_TOKEN, symbol: 'ETH', decimals: 18, balance: BigInt(0) },
        ...KNOWN_TOKENS.map((t) => ({
          token: t.address,
          symbol: t.symbol,
          decimals: t.decimals,
          balance: BigInt(0),
        })),
      ];
      const balances = await Promise.all(
        probes.map(async (p) => {
          const bal = await readWarehouseBalance({
            owner,
            token: p.token,
            publicClient,
          });
          return { ...p, balance: bal };
        }),
      );
      setWarehouseBalances(balances);
    } catch {
      setWarehouseBalances([]);
    } finally {
      setWarehouseLoading(false);
    }
  }, [wallets, publicClient]);

  useEffect(() => {
    void loadWarehouseBalances();
  }, [loadWarehouseBalances]);

  // Probe Clanker v3 lockers for any LP positions the connected wallet is
  // the creator-side admin of. Keyed by wallet (not source token) because
  // v3 doesn't expose a token→tokenId index.
  useEffect(() => {
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) {
      setV3Positions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const positions = await findClankerV3PositionsForCreator({
          creator: wallet.address,
          publicClient,
        });
        if (!cancelled) {
          setV3Positions(positions);
          // Auto-select the first position whose creator admin matches the
          // user — that's the slot they can actually update.
          const updatable = positions.find(
            (p) =>
              p.creator.admin.toLowerCase() === wallet.address.toLowerCase(),
          );
          if (updatable) {
            setV3SelectedKey(
              `${updatable.locker.address}:${updatable.lpTokenId.toString()}`,
            );
          }
        }
      } catch {
        if (!cancelled) setV3Positions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallets, publicClient]);

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

  // Build a viem walletClient from the connected injected wallet. Returns
  // null with a toast if the user isn't connected.
  const getWalletClient = async () => {
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) {
      toast.error('Connect your wallet first');
      return null;
    }
    await wallet.switchChain(base.id).catch(() => {});
    const provider = await wallet.getEthereumProvider();
    const walletClient = createWalletClient({
      account: wallet.address as Hex,
      chain: base,
      transport: custom(provider),
    });
    return { wallet, walletClient };
  };

  // ----- Panel A: vanilla setFeeRecipient on the source token -----
  const handleUpdateFeeRecipient = async () => {
    if (!config?.splitAddress || !detection?.detected || !detection.setterName)
      return;
    const ctx = await getWalletClient();
    if (!ctx) return;
    setRedirecting('vanilla');
    try {
      const setterAbi = parseAbi([
        `function ${detection.setterName}(address)`,
      ]);
      const data = encodeFunctionData({
        abi: setterAbi,
        functionName: detection.setterName,
        args: [config.splitAddress as `0x${string}`],
      });
      const hash = await ctx.walletClient.sendTransaction({
        to: sourceToken.trim() as `0x${string}`,
        data,
      });
      await waitForSuccessReceipt(publicClient, hash);
      toast.success(`Fee recipient updated → ${detection.setterName}(split)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      toast.error(
        msg.includes('execution reverted')
          ? "Reverted — your wallet may not be authorized to call this setter on the token."
          : msg,
      );
    } finally {
      setRedirecting(null);
    }
  };

  // ----- Panel A: Clanker v4 updateRewardRecipient -----
  const handleUpdateClankerRecipient = async () => {
    if (!config?.splitAddress || !clankerDeployment) return;
    const rewardIndex = Number(clankerRewardIndex);
    if (!Number.isInteger(rewardIndex) || rewardIndex < 0 || rewardIndex > 6) {
      toast.error('Reward index must be an integer 0..6');
      return;
    }
    const ctx = await getWalletClient();
    if (!ctx) return;
    setRedirecting('clanker');
    try {
      const built = buildUpdateRecipientCalldata({
        token: sourceToken.trim(),
        rewardIndex,
        newRecipient: config.splitAddress,
        locker: clankerDeployment.locker,
      });
      const hash = await ctx.walletClient.sendTransaction({
        to: built.to,
        data: built.data,
      });
      await waitForSuccessReceipt(publicClient, hash);
      toast.success('Clanker reward recipient updated to your split');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      toast.error(
        msg.includes('execution reverted')
          ? "Reverted — your wallet isn't the admin for this reward index. Try a different index."
          : msg,
      );
    } finally {
      setRedirecting(null);
    }
  };

  // ----- Manual v3 LP tokenId probe (admin-via-rotation fallback) -----
  const handleProbeV3 = async () => {
    const raw = v3ManualInput.trim();
    if (!raw) return;
    let id: bigint;
    try {
      id = BigInt(raw);
      if (id < BigInt(0)) throw new Error('negative');
    } catch {
      toast.error('Enter a valid LP tokenId (positive integer)');
      return;
    }
    setV3Probing(true);
    try {
      const position = await probeClankerV3Position({
        lpTokenId: id,
        publicClient,
      });
      if (!position) {
        toast.error(`LP #${id} not found in any v3 locker`);
        return;
      }
      // Dedupe — avoid stacking the same position if user probes twice.
      const key = `${position.locker.address}:${position.lpTokenId.toString()}`;
      setV3Positions((prev) => {
        if (prev.some(
          (p) => `${p.locker.address}:${p.lpTokenId.toString()}` === key,
        )) {
          return prev;
        }
        return [...prev, position];
      });
      setV3SelectedKey(key);
      setV3ManualInput('');
      toast.success(`LP #${id} (${position.locker.version}) loaded`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Probe failed');
    } finally {
      setV3Probing(false);
    }
  };

  // ----- Panel A (Clanker v3): updateCreatorRewardRecipient on selected LP -----
  const handleUpdateV3Recipient = async () => {
    if (!config?.splitAddress || !v3SelectedKey) return;
    const position = v3Positions.find(
      (p) => `${p.locker.address}:${p.lpTokenId.toString()}` === v3SelectedKey,
    );
    if (!position) {
      toast.error('Select an LP position first');
      return;
    }
    const ctx = await getWalletClient();
    if (!ctx) return;
    // Sanity-check: only the creator admin can update the creator slot. Bail
    // early with a clearer message than the on-chain revert.
    if (
      position.creator.admin.toLowerCase() !==
      ctx.wallet.address.toLowerCase()
    ) {
      toast.error(
        `Connected wallet isn't the creator admin for LP #${position.lpTokenId} (admin is ${position.creator.admin.slice(0, 6)}…${position.creator.admin.slice(-4)})`,
      );
      return;
    }
    setRedirecting('clanker-v3');
    try {
      const built = buildUpdateV3RecipientCalldata({
        locker: position.locker,
        lpTokenId: position.lpTokenId,
        slot: 'creator',
        newRecipient: config.splitAddress,
      });
      const hash = await ctx.walletClient.sendTransaction({
        to: built.to,
        data: built.data,
      });
      await waitForSuccessReceipt(publicClient, hash);
      toast.success(
        `Clanker ${position.locker.version} creator recipient updated to your split`,
      );
      // Re-probe so the panel shows the new recipient state.
      const refreshed = await findClankerV3PositionsForCreator({
        creator: ctx.wallet.address,
        publicClient,
      });
      setV3Positions(refreshed);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      toast.error(
        msg.includes('execution reverted')
          ? "Reverted — likely you're not the admin for this LP's creator slot."
          : msg,
      );
    } finally {
      setRedirecting(null);
    }
  };

  // ----- Panel C: claim my warehouse share -----
  const handleClaimAll = async () => {
    const nonZero = warehouseBalances.filter((b) => b.balance > BigInt(0));
    if (nonZero.length === 0) {
      toast.info('Nothing to claim yet.');
      return;
    }
    const ctx = await getWalletClient();
    if (!ctx) return;
    setClaiming(true);
    try {
      // Each non-zero balance becomes a separate withdraw — fire sequentially
      // to keep the UX simple. Multicall3 would also work but withdraw moves
      // funds *to* the owner directly (no `distributor` indirection like
      // distribute has), so msg.sender matters: must be the user. Sequential
      // wallet txs is the only correct path.
      const owner = ctx.wallet.address as `0x${string}`;
      for (const bal of nonZero) {
        const built = buildWarehouseWithdrawCalldata({ owner, token: bal.token });
        const hash = await ctx.walletClient.sendTransaction({
          to: built.to,
          data: built.data,
        });
        await waitForSuccessReceipt(publicClient, hash);
      }
      toast.success(
        `Claimed ${nonZero.length} balance${nonZero.length === 1 ? '' : 's'}`,
      );
      await loadWarehouseBalances();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Claim failed';
      toast.error(msg);
    } finally {
      setClaiming(false);
    }
  };

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

      await waitForSuccessReceipt(publicClient, hash);
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

      {/* Redirect fees panel — sets your token's fee recipient to the split.
          Shown when a split exists. Detects Clanker v4 + standard ERC-20
          setters automatically once the user pastes their source token. */}
      {config.splitAddress && (
        <div className="rounded-[20px] border border-black/10 bg-white p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold font-funnel-display text-black flex items-center gap-2">
              <Search className="w-4 h-4 text-secondary-blue" />
              Redirect fees to this split
            </h2>
            <p className="text-xs text-black/40 font-funnel-sans mt-1 leading-relaxed">
              Paste the token contract whose fees you want flowing into this
              buyback. We&apos;ll detect whether it&apos;s a Clanker v4 launch
              or a standard ERC-20 with a fee-recipient setter and surface a
              one-click update.
            </p>
          </div>

          <div className="space-y-1.5">
            <input
              type="text"
              placeholder="Source token contract (0x...)"
              value={sourceToken}
              onChange={(e) => setSourceToken(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground font-mono transition-all"
            />
            {detecting && (
              <p className="text-[11px] text-black/30 font-funnel-sans flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Probing on-chain…
              </p>
            )}
          </div>

          {/* Clanker v4 result */}
          {!detecting && clankerDeployment && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-blue-800 font-funnel-sans">
                  Clanker v4 detected
                </p>
                <p className="text-xs text-blue-900/70 font-funnel-sans mt-1">
                  Update the LP locker&apos;s reward recipient for your reward
                  slot (usually <span className="font-mono">0</span> for the
                  main creator).
                </p>
              </div>
              <div className="flex items-end gap-2">
                <div className="w-24">
                  <label className="text-xs text-blue-900/60 font-funnel-sans block mb-1">
                    Reward index
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="6"
                    step="1"
                    value={clankerRewardIndex}
                    onChange={(e) => setClankerRewardIndex(e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                    disabled={redirecting === 'clanker'}
                    className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg outline-none text-sm font-mono"
                  />
                </div>
                <button
                  onClick={handleUpdateClankerRecipient}
                  disabled={redirecting !== null}
                  className="flex-1 rounded-full bg-blue-600 text-white py-2.5 font-funnel-sans text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {redirecting === 'clanker' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating…
                    </>
                  ) : (
                    'Update Clanker recipient'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Clanker v3 — always render the panel so the manual probe is
              reachable even when the auto-discovery (via getLpTokenIds-
              ForCreator) misses positions where the wallet got admin via a
              post-launch rotation. */}
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-purple-900 font-funnel-sans">
                Clanker v3 — LP position{v3Positions.length === 1 ? '' : 's'}
                {v3Positions.length > 0 && ` (${v3Positions.length})`}
              </p>
              <p className="text-xs text-purple-900/70 font-funnel-sans mt-1">
                Pick the LP whose creator-side fees should flow to this split.
                You must be the creator admin for the position to update it.
              </p>
            </div>

            {v3Positions.length > 0 && (
              <div className="space-y-2">
                {v3Positions.map((p) => {
                  const key = `${p.locker.address}:${p.lpTokenId.toString()}`;
                  const wallet = wallets.find(
                    (w) => w.connectorType === 'injected',
                  );
                  const youAreAdmin =
                    !!wallet &&
                    p.creator.admin.toLowerCase() ===
                      wallet.address.toLowerCase();
                  const isSelected = v3SelectedKey === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setV3SelectedKey(key)}
                      disabled={!youAreAdmin}
                      className={`w-full text-left rounded-[12px] border px-3 py-2.5 transition-colors ${
                        isSelected
                          ? 'bg-purple-100 border-purple-400'
                          : youAreAdmin
                            ? 'bg-white border-purple-200 hover:border-purple-300'
                            : 'bg-purple-50/40 border-purple-100 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-purple-900 font-funnel-sans">
                          LP #{p.lpTokenId.toString()}{' '}
                          <span className="text-xs font-normal text-purple-900/60">
                            ({p.locker.version})
                          </span>
                        </p>
                        {!youAreAdmin && (
                          <span className="text-[10px] text-purple-900/60 font-funnel-sans">
                            not creator admin
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-purple-900/60 font-mono mt-0.5">
                        admin {p.creator.admin.slice(0, 6)}…{p.creator.admin.slice(-4)}
                        {' · '}recipient {p.creator.recipient.slice(0, 6)}…{p.creator.recipient.slice(-4)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Manual fallback — admin-via-rotation users won't show up in
                auto-discovery, so let them paste the LP tokenId directly. */}
            <details className="text-xs">
              <summary className="cursor-pointer text-purple-900/70 font-funnel-sans hover:text-purple-900">
                {v3Positions.length === 0
                  ? "Don't see your LP? Add by tokenId"
                  : 'Have another LP? Add by tokenId'}
              </summary>
              <div className="mt-2 flex items-stretch gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="LP tokenId (e.g. 12345)"
                  value={v3ManualInput}
                  onChange={(e) => setV3ManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleProbeV3();
                  }}
                  disabled={v3Probing}
                  className="flex-1 px-3 py-2 bg-white border border-purple-200 rounded-lg outline-none text-sm font-mono"
                />
                <button
                  onClick={handleProbeV3}
                  disabled={v3Probing || !v3ManualInput.trim()}
                  className="shrink-0 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-funnel-sans hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {v3Probing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  Probe
                </button>
              </div>
            </details>

            {v3SelectedKey && (
              <button
                onClick={handleUpdateV3Recipient}
                disabled={redirecting !== null}
                className="w-full rounded-full bg-purple-600 text-white py-2.5 font-funnel-sans text-sm hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {redirecting === 'clanker-v3' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating…
                  </>
                ) : (
                  'Update Clanker v3 creator recipient'
                )}
              </button>
            )}
          </div>

          {/* Vanilla setter result */}
          {!detecting && detection?.detected && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
              <p className="text-sm font-semibold text-emerald-800 font-funnel-sans">
                Setter detected: <span className="font-mono">{detection.setterName}()</span>
              </p>
              <p className="text-xs text-emerald-900/70 font-funnel-sans">
                Current recipient:{' '}
                <span className="font-mono">
                  {detection.currentRecipient?.slice(0, 10)}…
                </span>
              </p>
              <button
                onClick={handleUpdateFeeRecipient}
                disabled={redirecting !== null}
                className="w-full rounded-full bg-emerald-600 text-white py-2.5 font-funnel-sans text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {redirecting === 'vanilla' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating…
                  </>
                ) : (
                  <>Update fee recipient → split</>
                )}
              </button>
            </div>
          )}

          {/* Nothing detected and not currently probing */}
          {!detecting &&
            isAddress(sourceToken) &&
            !clankerDeployment &&
            !detection?.detected && (
              <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-xs text-amber-800 font-funnel-sans leading-relaxed">
                  No automatic redirector found for this token. Point fee
                  revenue at{' '}
                  <span className="font-mono break-all">
                    {config.splitAddress}
                  </span>{' '}
                  manually (e.g. on your launchpad&apos;s admin UI or via
                  BaseScan).
                </p>
              </div>
            )}
        </div>
      )}

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

      {/* Claim my share — withdraw your own balance from the SplitsWarehouse
          after a Distribute call has credited you. Only the connected wallet
          can claim its own balance — the worker handles the buyback wallet's
          share automatically. */}
      {config.splitAddress && (
        <div className="rounded-[20px] border border-black/10 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold font-funnel-display text-black flex items-center gap-2">
                <Wallet className="w-4 h-4 text-secondary-green" />
                Claim my share
              </h2>
              <p className="text-xs text-black/40 font-funnel-sans mt-1 leading-relaxed">
                Your portion of distributed fees sits in the SplitsWarehouse
                until you pull it out. This claims everything credited to
                your connected wallet across ETH + supported tokens.
              </p>
            </div>
            <button
              onClick={loadWarehouseBalances}
              disabled={warehouseLoading || claiming}
              className="shrink-0 text-xs text-black/40 hover:text-black font-funnel-sans px-2 py-1 rounded-md hover:bg-black/5 transition-colors disabled:opacity-50"
            >
              {warehouseLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {(() => {
            const nonZeroWarehouse = warehouseBalances.filter(
              (b) => b.balance > BigInt(0),
            );
            if (warehouseLoading && warehouseBalances.length === 0) {
              return (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-black/30" />
                </div>
              );
            }
            if (nonZeroWarehouse.length === 0) {
              return (
                <div className="rounded-[12px] border border-black/[0.08] bg-black/[0.02] px-3 py-5 text-center">
                  <p className="text-xs text-black/40 font-funnel-sans">
                    Nothing to claim. Once a Distribute call credits your
                    wallet, your balance shows up here.
                  </p>
                </div>
              );
            }
            return (
              <>
                <div className="space-y-2">
                  {nonZeroWarehouse.map((b) => (
                    <div
                      key={b.token}
                      className="flex items-center justify-between gap-3 rounded-[12px] border border-black/[0.08] px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-black font-funnel-sans">
                        {formatBalance(b.balance, b.decimals)} {b.symbol}
                      </p>
                      <p className="text-[11px] text-black/30 font-mono">
                        {b.token === SPLITS_NATIVE_TOKEN
                          ? 'native ETH'
                          : `${b.token.slice(0, 6)}…${b.token.slice(-4)}`}
                      </p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleClaimAll}
                  disabled={claiming}
                  className="w-full flex items-center justify-center gap-1.5 bg-secondary-green hover:bg-secondary-green/90 text-white rounded-full px-4 py-2.5 text-sm font-funnel-sans transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {claiming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Claiming…
                    </>
                  ) : (
                    <>
                      <Wallet className="w-4 h-4" />
                      Claim all ({nonZeroWarehouse.length})
                    </>
                  )}
                </button>
                <p className="text-[11px] text-black/30 font-funnel-sans">
                  Each non-zero balance is a separate tx — expect{' '}
                  {nonZeroWarehouse.length} wallet popup
                  {nonZeroWarehouse.length === 1 ? '' : 's'}.
                </p>
              </>
            );
          })()}
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
