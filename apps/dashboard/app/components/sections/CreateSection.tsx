'use client';

import { useEffect, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { toast } from 'sonner';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Hex,
} from 'viem';
import { base } from 'viem/chains';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { FieldLabel } from '../ui/FieldBits';
import { signBuybackAction } from '@/lib/buybackAuth';
import {
  buildCreateSplitCalldata,
  buildUpdateSplitCalldata,
  getSplitParamsFromFactory,
  parseSplitCreatedFromReceipt,
  waitForSuccessReceipt,
} from '@/lib/splitsFactoryV2';
import {
  buildUpdateRecipientCalldata,
  getClankerV4Deployment,
  type ClankerV4Deployment,
} from '@/lib/clankerV4';
import {
  buildUpdateV3RecipientCalldata,
  findClankerV3PositionsForCreator,
  type ClankerV3Position,
} from '@/lib/clankerV3';
import {
  proposeSafeTransaction,
  getSafeTxExecution,
} from '@/lib/safeUtils';

type FlowType = 'token' | 'splits' | 'safe';
type Step =
  | 'form'
  | 'provisioning'
  | 'deploying_split'
  | 'setting_split'
  | 'pending_safe_exec'
  | 'ready';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SHARED_STORAGE_KEY = 'earnkit_shared_buyback_configs';

interface ReadyState {
  walletAddress: string;
  splitAddress: string;
  configId: string;
}

const FLOW_OPTIONS = [
  {
    id: 'token' as FlowType,
    title: <>Token</>,
    subtitle:
      'Add your existing token and we handle everything else for the buyback.',
    image: '/images/landing/token.png',
    imgtitle: 'Token',
  },
  {
    id: 'splits' as FlowType,
    title: (
      <img
        src="/images/landing/splits_full_logo.svg"
        className="h-[26px] brightness-0 invert-0"
      />
    ),
    subtitle:
      'Add your existing splits contract and we handle everything else for the buyback.',
    image: '/images/landing/splits.jpg',
    imgtitle: 'Splits',
  },
  {
    id: 'safe' as FlowType,
    title: (
      <img
        src="/images/landing/safe-logo-wallet.svg"
        className="h-[26px] brightness-0 invert-0"
      />
    ),
    subtitle:
      'Add your existing safe contract and we handle everything else for the buyback.',
    image: '/images/landing/safe.jpg',
    imgtitle: 'Safe',
  },
];


const INPUT_CLASS =
  'w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground transition-all';

// Reusable read-only Base public client for awaiting deploy tx receipts.
function getBasePublicClient() {
  return createPublicClient({ chain: base, transport: http() });
}

export default function CreateSection() {
  const [activeSection, setActiveSection] = useState<'none' | 'form'>('none');
  const [flowType, setFlowType] = useState<FlowType>('token');
  const [step, setStep] = useState<Step>('form');
  const [copied, setCopied] = useState<'wallet' | 'split' | null>(null);
  const { wallets } = useWallets();

  const [platformFeeRateBps, setPlatformFeeRateBps] = useState<number>(100);
  const [minThresholdUsd, setMinThresholdUsd] = useState<number>(10);
  const platformFeePercent = (platformFeeRateBps / 100)
    .toFixed(1)
    .replace(/\.0$/, '');

  useEffect(() => {
    fetch('/api/platform-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.platformFeeRateBps) setPlatformFeeRateBps(d.platformFeeRateBps);
        if (d.minThresholdUsd) setMinThresholdUsd(d.minThresholdUsd);
      })
      .catch(() => {});
  }, []);

  const connectedWalletAddress =
    wallets.find((w) => w.connectorType === 'injected')?.address ?? '';

  const [sharedForm, setSharedForm] = useState({
    ownerAddress: '',
    splitAddress: '',
    targetToken: '',
    recoveryAddress: '',
    userEmail: '',
    thresholdUsd: '10',
  });

  const [safeForm, setSafeForm] = useState({
    safeAddress: '',
    splitAddress: '',
    targetToken: '',
    recoveryAddress: '',
    userEmail: '',
    thresholdUsd: '10',
    ownerPct: '90',
    buybackPct: '10',
  });

  interface PendingSafeTx {
    safeTxHash: string;
    safeUiUrl: string;
    subflow: 'existing-split' | 'new-split';
    configId: string;
    buybackWallet: string;
    splitAddress: string;
    safeAddress: string;
  }
  const [pendingSafeTx, setPendingSafeTx] = useState<PendingSafeTx | null>(null);
  const [checkingActivation, setCheckingActivation] = useState(false);

  const [tokenForm, setTokenForm] = useState({
    tokenContractAddress: '',
    targetToken: '',
    ownerAddress: '',
    recoveryAddress: '',
    userEmail: '',
    thresholdUsd: '10',
    // Recipient percentages — owner + buyback only. The platform fee is
    // already collected on the buyback wallet side by the worker's
    // `deductFees` step, so the split itself doesn't need a treasury slot.
    ownerPct: '90',
    buybackPct: '10',
  });

  const [result, setResult] = useState<ReadyState | null>(null);

  // Clanker v4 detection. Populated on entering the ready state if the user's
  // source token was deployed by Clanker. Lets us offer a one-tx "update
  // reward recipient from EarnKit" action so they don't leave the page.
  const [clankerDeployment, setClankerDeployment] =
    useState<ClankerV4Deployment | null>(null);
  const [clankerRewardIndex, setClankerRewardIndex] = useState('0');
  const [clankerUpdating, setClankerUpdating] = useState(false);
  const [clankerUpdateTx, setClankerUpdateTx] = useState<string | null>(null);

  // Clanker v3 — independent of v4 detection. We probe both v3 lockers for
  // any LP NFTs the connected wallet is creator-admin of, and let them
  // redirect any one of them to the just-deployed split.
  const [v3Positions, setV3Positions] = useState<ClankerV3Position[]>([]);
  const [v3SelectedKey, setV3SelectedKey] = useState<string | null>(null);
  const [v3Updating, setV3Updating] = useState(false);
  const [v3UpdateTx, setV3UpdateTx] = useState<string | null>(null);

  useEffect(() => {
    if (!connectedWalletAddress) return;
    setSharedForm((f) =>
      f.ownerAddress ? f : { ...f, ownerAddress: connectedWalletAddress },
    );
    setTokenForm((f) =>
      f.ownerAddress ? f : { ...f, ownerAddress: connectedWalletAddress },
    );
  }, [connectedWalletAddress]);

  const currentFlow =
    FLOW_OPTIONS.find((opt) => opt.id === flowType) || FLOW_OPTIONS[0];
  const isAddress = (val: string) => ADDRESS_RE.test(val.trim());

  const goBack = () => {
    setActiveSection('none');
    setStep('form');
    setResult(null);
    setClankerDeployment(null);
    setClankerRewardIndex('0');
    setClankerUpdateTx(null);
    setV3Positions([]);
    setV3SelectedKey(null);
    setV3UpdateTx(null);
    setPendingSafeTx(null);
    setCheckingActivation(false);
  };

  // Probe the Clanker v4 factory for this token. If it returns a locker, the
  // ready screen can offer an in-app "update reward recipient" action.
  // Best-effort — failures fall back to generic instructions.
  const probeClanker = async (token: string) => {
    try {
      const info = await getClankerV4Deployment(token);
      setClankerDeployment(info);
    } catch {
      setClankerDeployment(null);
    }
  };

  // After the split is deployed, also probe Clanker v3 lockers for any LP
  // positions the connected wallet admins. v3 positions are creator-keyed
  // (not token-keyed), so they may surface even for tokens we wouldn't
  // otherwise associate with the user's launch.
  const probeClankerV3 = async () => {
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) {
      setV3Positions([]);
      return;
    }
    try {
      const publicClient = createPublicClient({
        chain: base,
        transport: http(),
      });
      const positions = await findClankerV3PositionsForCreator({
        creator: wallet.address,
        publicClient: publicClient as Parameters<
          typeof findClankerV3PositionsForCreator
        >[0]['publicClient'],
      });
      setV3Positions(positions);
      const updatable = positions.find(
        (p) => p.creator.admin.toLowerCase() === wallet.address.toLowerCase(),
      );
      if (updatable) {
        setV3SelectedKey(
          `${updatable.locker.address}:${updatable.lpTokenId.toString()}`,
        );
      }
    } catch {
      setV3Positions([]);
    }
  };

  const handleUpdateV3Recipient = async () => {
    if (!result || !v3SelectedKey) return;
    const position = v3Positions.find(
      (p) => `${p.locker.address}:${p.lpTokenId.toString()}` === v3SelectedKey,
    );
    if (!position) return;
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) {
      toast.error('Connect a wallet first');
      return;
    }
    if (
      position.creator.admin.toLowerCase() !== wallet.address.toLowerCase()
    ) {
      toast.error(
        `You're not the creator admin for LP #${position.lpTokenId} on ${position.locker.version}`,
      );
      return;
    }

    setV3Updating(true);
    try {
      const built = buildUpdateV3RecipientCalldata({
        locker: position.locker,
        lpTokenId: position.lpTokenId,
        slot: 'creator',
        newRecipient: result.splitAddress,
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
      const publicClient = getBasePublicClient();
      await waitForSuccessReceipt(publicClient, hash);
      setV3UpdateTx(hash);
      toast.success(
        `Clanker ${position.locker.version} creator recipient updated`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      toast.error(
        msg.includes('execution reverted')
          ? "Reverted — likely the wrong admin for this LP."
          : msg,
      );
    } finally {
      setV3Updating(false);
    }
  };

  const handleUpdateClankerRecipient = async () => {
    if (!result || !clankerDeployment) return;
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) {
      toast.error('Connect a wallet first');
      return;
    }
    const rewardIndex = Number(clankerRewardIndex);
    if (!Number.isInteger(rewardIndex) || rewardIndex < 0 || rewardIndex > 6) {
      toast.error('Reward index must be an integer 0..6');
      return;
    }

    setClankerUpdating(true);
    try {
      const built = buildUpdateRecipientCalldata({
        token: tokenForm.tokenContractAddress.trim(),
        rewardIndex,
        newRecipient: result.splitAddress,
        locker: clankerDeployment.locker,
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
      const publicClient = getBasePublicClient();
      // Wait for inclusion AND check status — `waitForTransactionReceipt`
      // doesn't throw on revert by default; it returns `status: 'reverted'`.
      // Without `waitForSuccessReceipt`, a reverted tx would falsely fire
      // the success toast.
      await waitForSuccessReceipt(publicClient, hash);
      setClankerUpdateTx(hash);
      toast.success('Reward recipient updated on your Clanker locker');
    } catch (e: unknown) {
      // The locker reverts if the caller isn't the admin for this reward
      // index — that's the most common failure here. Surface a clear msg.
      const msg = e instanceof Error ? e.message : 'Update failed';
      toast.error(
        msg.includes('execution reverted')
          ? "Reverted — your wallet isn't the admin for this reward index. Try a different index."
          : msg,
      );
    } finally {
      setClankerUpdating(false);
    }
  };

  const handleSharedField =
    (key: keyof typeof sharedForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setSharedForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSafeField =
    (key: keyof typeof safeForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setSafeForm((f) => ({ ...f, [key]: e.target.value }));

  const handleTokenField =
    (key: keyof typeof tokenForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTokenForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const handleRegisterShared = async () => {
    if (!isAddress(sharedForm.ownerAddress))
      return toast.error('Owner address is not a valid 0x address');
    if (!isAddress(sharedForm.splitAddress))
      return toast.error('Split address is not a valid 0x address');
    if (!isAddress(sharedForm.targetToken))
      return toast.error('Target token is not a valid 0x address');
    if (!isAddress(sharedForm.recoveryAddress))
      return toast.error('Recovery address is not a valid 0x address');
    if (!sharedForm.userEmail.includes('@'))
      return toast.error('Enter a valid email address');

    const owner = sharedForm.ownerAddress.trim();
    const split = sharedForm.splitAddress.trim();
    const target = sharedForm.targetToken.trim();
    const recovery = sharedForm.recoveryAddress.trim();

    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet)
      return toast.error(
        'Connect a wallet first — we need a signature to prove you control the owner address',
      );

    let signed: { signature: string; signedAt: string };
    try {
      signed = await signBuybackAction({
        wallet,
        owner,
        action: {
          kind: 'register',
          splitAddress: split,
          tokenAddress: target,
          recoveryAddress: recovery,
        },
      });
    } catch (e: unknown) {
      return toast.error(
        e instanceof Error ? e.message : 'Signature rejected',
      );
    }

    setStep('provisioning');
    try {
      const res = await fetch('/api/shared-buyback/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAddress: owner,
          splitAddress: split,
          targetToken: target,
          recoveryAddress: recovery,
          userEmail: sharedForm.userEmail.trim(),
          thresholdUsd:
            parseFloat(sharedForm.thresholdUsd) || minThresholdUsd,
          signature: signed.signature,
          signedAt: signed.signedAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Registration failed');
        setStep('form');
        return;
      }
      if (data.configId) {
        try {
          const raw = localStorage.getItem(SHARED_STORAGE_KEY);
          const existing: string[] = raw ? JSON.parse(raw) : [];
          if (!existing.includes(data.configId)) {
            localStorage.setItem(
              SHARED_STORAGE_KEY,
              JSON.stringify([...existing, data.configId]),
            );
          }
        } catch {}
      }
      // For the splits-card flow, the split already exists and the worker
      // activates it once the wallet is added. There's nothing to deploy.
      setResult({
        walletAddress: data.walletAddress,
        splitAddress: split,
        configId: data.configId,
      });
      setStep('ready');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Unexpected error');
      setStep('form');
    }
  };


  const handleRegisterSafe = async () => {
    if (!isAddress(safeForm.safeAddress))
      return toast.error('Safe address is not a valid 0x address');
    if (!isAddress(safeForm.targetToken))
      return toast.error('Target token is not a valid 0x address');
    if (!isAddress(safeForm.recoveryAddress))
      return toast.error('Recovery address is not a valid 0x address');
    if (!safeForm.userEmail.includes('@'))
      return toast.error('Enter a valid email address');

    const hasExistingSplit = isAddress(safeForm.splitAddress.trim());

    if (hasExistingSplit) {
      const bpct = Number(safeForm.buybackPct);
      if (isNaN(bpct) || bpct <= 0 || bpct >= 100)
        return toast.error('Buyback carve-out must be between 1 and 99%');
    } else {
      const ownerPct = Number(safeForm.ownerPct);
      const buybackPct = Number(safeForm.buybackPct);
      if ([ownerPct, buybackPct].some((v) => isNaN(v) || v < 0))
        return toast.error('Percentages must be non-negative numbers');
      if (Math.abs(ownerPct + buybackPct - 100) > 0.001)
        return toast.error(`Percentages must sum to 100 (got ${(ownerPct + buybackPct).toFixed(2)})`);
      if (buybackPct < 5)
        return toast.error('Buyback share must be at least 5%');
    }

    const safeAddr = safeForm.safeAddress.trim();
    const target = safeForm.targetToken.trim();
    const recovery = safeForm.recoveryAddress.trim();

    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet)
      return toast.error('Connect a wallet first — your EOA must sign to prove Safe ownership');

    // ---- 1. Sign + register (or register-deferred) ----
    let signed: { signature: string; signedAt: string };
    try {
      signed = await signBuybackAction({
        wallet,
        owner: safeAddr,
        action: hasExistingSplit
          ? {
              kind: 'register',
              splitAddress: safeForm.splitAddress.trim(),
              tokenAddress: target,
              recoveryAddress: recovery,
            }
          : {
              kind: 'register-deferred',
              tokenAddress: target,
              recoveryAddress: recovery,
            },
      });
    } catch (e: unknown) {
      return toast.error(e instanceof Error ? e.message : 'Signature rejected');
    }

    setStep('provisioning');

    let configId: string;
    let buybackWallet: string;
    try {
      const res = await fetch('/api/shared-buyback/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAddress: safeAddr,
          splitAddress: hasExistingSplit ? safeForm.splitAddress.trim() : null,
          targetToken: target,
          recoveryAddress: recovery,
          userEmail: safeForm.userEmail.trim(),
          thresholdUsd: parseFloat(safeForm.thresholdUsd) || minThresholdUsd,
          signature: signed.signature,
          signedAt: signed.signedAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Registration failed');
        setStep('form');
        return;
      }
      configId = data.configId;
      buybackWallet = data.walletAddress;
    } catch {
      toast.error('Registration failed');
      setStep('form');
      return;
    }

    try {
      const raw = localStorage.getItem(SHARED_STORAGE_KEY);
      const existing: string[] = raw ? JSON.parse(raw) : [];
      if (!existing.includes(configId)) {
        localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify([...existing, configId]));
      }
    } catch {}

    // ---- 2. Build Safe tx calldata ----
    setStep('deploying_split');

    const publicClient = getBasePublicClient();
    let txTo: string;
    let txData: `0x${string}`;

    if (hasExistingSplit) {
      const splitAddr = safeForm.splitAddress.trim();
      const buybackPct = Number(safeForm.buybackPct);
      const currentParams = await getSplitParamsFromFactory(
        splitAddr,
        publicClient as Parameters<typeof getSplitParamsFromFactory>[1],
      );

      if (!currentParams) {
        // Split params not found (may be older than scan range) — show manual mode.
        toast('Split params not found in factory logs — add the buyback wallet to your split manually, then click "Check Activation".', { duration: 9000 });
        setPendingSafeTx({
          safeTxHash: '',
          safeUiUrl: `https://app.safe.global/transactions/queue?safe=base:${safeAddr}`,
          subflow: 'existing-split',
          configId,
          buybackWallet,
          splitAddress: splitAddr,
          safeAddress: safeAddr,
        });
        setStep('pending_safe_exec');
        return;
      }

      const built = buildUpdateSplitCalldata({
        splitAddress: splitAddr,
        currentParams,
        newRecipient: buybackWallet,
        newRecipientPercent: buybackPct,
      });
      txTo = built.to;
      txData = built.data;
    } else {
      const ownerPct = Number(safeForm.ownerPct);
      const buybackPct = Number(safeForm.buybackPct);
      const built = buildCreateSplitCalldata({
        recipients: [
          { address: safeAddr, percent: ownerPct },
          { address: buybackWallet, percent: buybackPct },
        ],
        owner: safeAddr,
      });
      txTo = built.to;
      txData = built.data;
    }

    // ---- 3. Propose via Safe Transaction Service ----
    try {
      const { contractTransactionHash } = await proposeSafeTransaction({
        safeAddress: safeAddr,
        to: txTo,
        data: txData,
        wallet,
      });
      setPendingSafeTx({
        safeTxHash: contractTransactionHash,
        safeUiUrl: `https://app.safe.global/transactions/queue?safe=base:${safeAddr}`,
        subflow: hasExistingSplit ? 'existing-split' : 'new-split',
        configId,
        buybackWallet,
        splitAddress: hasExistingSplit ? safeForm.splitAddress.trim() : '',
        safeAddress: safeAddr,
      });
      setStep('pending_safe_exec');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Safe proposal failed');
      setStep('form');
    }
  };

  const handleCheckSafeExecution = async () => {
    if (!pendingSafeTx) return;
    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet) return toast.error('Connect wallet first');

    setCheckingActivation(true);
    try {
      if (pendingSafeTx.subflow === 'existing-split') {
        const signed = await signBuybackAction({
          wallet,
          owner: pendingSafeTx.safeAddress,
          action: { kind: 'check-activation', configId: pendingSafeTx.configId },
        });
        const res = await fetch(
          `/api/shared-buyback/${pendingSafeTx.configId}/check-activation`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signature: signed.signature, signedAt: signed.signedAt }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.activated) {
          toast.error(
            data.reason === 'not_in_split'
              ? 'Buyback wallet not yet in the split — execute the Safe tx first, then try again.'
              : data.reason === 'membership_unknown'
                ? 'Membership unknown (RPC lag) — try again in a moment.'
                : data.error || 'Not yet activated',
          );
          return;
        }
        setResult({
          walletAddress: pendingSafeTx.buybackWallet,
          splitAddress: pendingSafeTx.splitAddress,
          configId: pendingSafeTx.configId,
        });
        setStep('ready');
      } else {
        // New-split subflow: poll for execution, then parse split address.
        const execStatus = await getSafeTxExecution(pendingSafeTx.safeTxHash);
        if (!execStatus.isExecuted || !execStatus.transactionHash) {
          toast.error('Safe tx not yet executed — approve and execute it in Safe, then try again.');
          return;
        }

        const publicClient = getBasePublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: execStatus.transactionHash as `0x${string}`,
        });
        if (receipt.status !== 'success') {
          toast.error('Safe tx reverted on-chain — the split was not created.');
          return;
        }

        let splitAddress: `0x${string}`;
        try {
          splitAddress = parseSplitCreatedFromReceipt(receipt);
        } catch {
          toast.error('Could not find the deployed split address — was the factory called?');
          return;
        }

        setStep('setting_split');

        const setSplitSig = await signBuybackAction({
          wallet,
          owner: pendingSafeTx.safeAddress,
          action: { kind: 'set-split', configId: pendingSafeTx.configId, splitAddress },
        });
        const res = await fetch(
          `/api/shared-buyback/${pendingSafeTx.configId}/set-split`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              splitAddress,
              signature: setSplitSig.signature,
              signedAt: setSplitSig.signedAt,
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || 'Failed to attach split');
          setStep('pending_safe_exec');
          return;
        }
        setResult({
          walletAddress: pendingSafeTx.buybackWallet,
          splitAddress,
          configId: pendingSafeTx.configId,
        });
        setStep('ready');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Check failed');
      setStep('pending_safe_exec');
    } finally {
      setCheckingActivation(false);
    }
  };

  const validateTokenForm = (): {
    ok: boolean;
    ownerPct: number;
    buybackPct: number;
  } => {
    const fail = { ok: false, ownerPct: 0, buybackPct: 0 } as const;
    if (!isAddress(tokenForm.targetToken)) {
      toast.error('Target token is invalid');
      return fail;
    }
    if (!isAddress(tokenForm.ownerAddress)) {
      toast.error('Owner address is invalid');
      return fail;
    }
    if (!isAddress(tokenForm.recoveryAddress)) {
      toast.error('Recovery address is invalid');
      return fail;
    }
    if (!tokenForm.userEmail.includes('@')) {
      toast.error('Enter a valid email address');
      return fail;
    }
    const thr = Number(tokenForm.thresholdUsd);
    if (isNaN(thr) || thr <= 0) {
      toast.error('Threshold must be greater than 0');
      return fail;
    }
    const ownerPct = Number(tokenForm.ownerPct);
    const buybackPct = Number(tokenForm.buybackPct);
    if ([ownerPct, buybackPct].some((v) => isNaN(v) || v < 0)) {
      toast.error('Percentages must be non-negative numbers');
      return fail;
    }
    const sum = ownerPct + buybackPct;
    if (Math.abs(sum - 100) > 0.001) {
      toast.error(`Percentages must sum to 100 (got ${sum.toFixed(2)})`);
      return fail;
    }
    if (buybackPct < 5) {
      toast.error('Buyback share must be at least 5%');
      return fail;
    }
    return { ok: true, ownerPct, buybackPct };
  };

  const handleRegisterToken = async () => {
    const v = validateTokenForm();
    if (!v.ok) return;

    const target = tokenForm.targetToken.trim();
    const owner = tokenForm.ownerAddress.trim();
    const recovery = tokenForm.recoveryAddress.trim();

    const wallet = wallets.find((w) => w.connectorType === 'injected');
    if (!wallet)
      return toast.error(
        'Connect a wallet first — we need a signature to prove you control the owner address',
      );

    // ---- 1. Sign deferred-register and provision the buyback wallet ----
    let registerSig: { signature: string; signedAt: string };
    try {
      registerSig = await signBuybackAction({
        wallet,
        owner,
        action: {
          kind: 'register-deferred',
          tokenAddress: target,
          recoveryAddress: recovery,
        },
      });
    } catch (e: unknown) {
      return toast.error(
        e instanceof Error ? e.message : 'Signature rejected',
      );
    }

    setStep('provisioning');

    let configId: string;
    let buybackWalletAddress: string;
    try {
      const res = await fetch('/api/shared-buyback/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAddress: owner,
          // null = deferred mode — backend skips split validation, returns
          // the provisioned buyback wallet, and waits for /set-split.
          splitAddress: null,
          targetToken: target,
          recoveryAddress: recovery,
          userEmail: tokenForm.userEmail.trim(),
          thresholdUsd: Number(tokenForm.thresholdUsd),
          signature: registerSig.signature,
          signedAt: registerSig.signedAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Registration failed');
        setStep('form');
        return;
      }
      configId = data.configId;
      buybackWalletAddress = data.walletAddress;
    } catch {
      toast.error('Registration failed');
      setStep('form');
      return;
    }

    // ---- 2. Deploy the 0xSplits PullSplit V2 from the user's wallet ----
    setStep('deploying_split');

    const recipients: { address: string; percent: number }[] = [
      { address: owner, percent: v.ownerPct },
      { address: buybackWalletAddress, percent: v.buybackPct },
    ];

    let splitAddress: `0x${string}`;
    try {
      const built = buildCreateSplitCalldata({ recipients, owner });

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

      const publicClient = getBasePublicClient();
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // Don't trust the receipt without verifying the tx didn't revert.
      // A reverted createSplit produces no SplitCreated event — parsing
      // would throw with a confusing "event not found" message; surfacing
      // the actual on-chain revert is clearer.
      if (receipt.status !== 'success') {
        throw new Error('Split deploy reverted on-chain');
      }
      splitAddress = parseSplitCreatedFromReceipt(receipt);
    } catch (e: unknown) {
      // The buyback config is now an orphan (registered, no split). User can
      // retry by going back; we keep it simple and don't auto-cleanup here.
      toast.error(
        e instanceof Error
          ? `Split deploy failed: ${e.message}`
          : 'Split deploy failed',
      );
      setStep('form');
      return;
    }

    // ---- 3. Sign + POST /set-split ----
    setStep('setting_split');

    let setSplitSig: { signature: string; signedAt: string };
    try {
      setSplitSig = await signBuybackAction({
        wallet,
        owner,
        action: { kind: 'set-split', configId, splitAddress },
      });
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : 'Signature rejected',
      );
      setStep('form');
      return;
    }

    try {
      const res = await fetch(
        `/api/shared-buyback/${configId}/set-split`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            splitAddress,
            signature: setSplitSig.signature,
            signedAt: setSplitSig.signedAt,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to attach split');
        setStep('form');
        return;
      }

      try {
        const raw = localStorage.getItem(SHARED_STORAGE_KEY);
        const existing: string[] = raw ? JSON.parse(raw) : [];
        if (!existing.includes(configId)) {
          localStorage.setItem(
            SHARED_STORAGE_KEY,
            JSON.stringify([...existing, configId]),
          );
        }
      } catch {}

      setResult({
        walletAddress: buybackWalletAddress,
        splitAddress,
        configId,
      });
      setStep('ready');
      // Kick off Clanker v4 probe in the background. If the token isn't a
      // Clanker launch, the ready screen just shows the generic instruction
      // and the panel never renders.
      void probeClanker(tokenForm.tokenContractAddress.trim());
      void probeClankerV3();
    } catch {
      toast.error('Failed to attach split');
      setStep('form');
    }
  };

  const handleCopy = async (text: string, which: 'wallet' | 'split') => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const isProvisioning =
    step === 'provisioning' ||
    step === 'deploying_split' ||
    step === 'setting_split';

  const loaderMessage =
    step === 'provisioning'
      ? 'Setting up your Turnkey buyback wallet…'
      : step === 'deploying_split'
        ? flowType === 'safe'
          ? 'Building and proposing Safe transaction…'
          : 'Waiting for split deploy tx — confirm in your wallet…'
        : step === 'setting_split'
          ? 'Attaching the split to your buyback config…'
          : '';

  return (
    <header className="flex-1 flex flex-col font-funnel-display items-center bg-background overflow-y-auto relative">
      <div className="w-full justify-center">
        {activeSection === 'none' ? (
          <div className="w-full flex flex-col items-center pb-20">
            {/* Hero Section */}
            <div className="relative overflow-hidden backdrop-blur-lg h-[40vh] w-full flex justify-center items-center">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `
                linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 1) 90%),
                radial-gradient(circle, #d1d5db 1px, transparent 1px)
                `,
                  backgroundSize: '100% 100%, 15px 15px',
                }}
              />
              <div className="relative z-10 mt-28 w-full text-center">
                <h1 className="text-4xl sm:text-5xl md:text-6xl text-foreground">
                  Create Token Buyback
                </h1>
                <p className="my-5 md:my-6 px-1 text-sm md:text-lg text-muted-foreground">
                  Select the type of buyback integration.
                </p>
              </div>
            </div>

            {/* Selection Cards */}
            <div className="w-full max-w-6xl mx-auto px-4 md:px-8 mt-4 relative md:z-20">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {FLOW_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setFlowType(option.id);
                      setActiveSection('form');
                    }}
                    className="group relative flex flex-col items-center text-center gap-4 pt-10 pb-8 rounded-[3rem] select-none border border-border transition-all duration-300 bg-gray-50 hover:border-gray-400 cursor-pointer"
                  >
                    <div className="w-16 h-16 flex items-center justify-center rounded-3xl bg-background border overflow-hidden">
                      <img
                        src={option.image}
                        alt={option.imgtitle}
                        className="w-8 h-8 object-contain"
                      />
                    </div>
                    <div className="max-w-[280px]">
                      <h4 className="font-bold text-xl text-foreground transition-colors flex items-center justify-center gap-2">
                        {option.title}
                      </h4>
                      <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                        {option.subtitle}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-6xl mx-auto flex flex-col items-center px-4 sm:px-8 py-20">
            <main className="flex-1 max-w-2xl bg-background md:bg-background md:border md:border-border rounded-[4rem] p-6 md:p-10 w-full md:shadow-sm">
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                {/* Dynamic Header */}
                <div className="mb-8 flex items-center gap-4 pb-4">
                  <div>
                    <h2 className="text-3xl font-bold mb-2 text-foreground">
                      {step === 'ready'
                        ? 'Buyback Ready'
                        : currentFlow.title}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {step === 'ready'
                        ? 'Your buyback is configured and ready.'
                        : flowType === 'splits'
                          ? `Connect your existing split to an automated buyback. A ${platformFeePercent}% platform fee applies per execution.`
                          : flowType === 'token'
                            ? `Provision a buyback wallet, deploy a fee-splitting contract, and route your token's revenue through it.`
                            : flowType === 'safe'
                              ? `Connect your Safe wallet to an automated buyback. A ${platformFeePercent}% platform fee applies per execution.`
                              : currentFlow.subtitle}
                    </p>
                  </div>
                </div>

                {/* Provisioning / Detecting / Deploying state */}
                {isProvisioning && (
                  <div className="flex flex-col items-center justify-center py-20 gap-6 animate-in fade-in duration-500">
                    <Loader2 className="w-12 h-12 animate-spin text-black/40" />
                    <p className="text-lg text-black/60 font-funnel-sans font-medium text-center px-4">
                      {loaderMessage}
                    </p>
                  </div>
                )}

                {/* Ready state */}
                {step === 'ready' && result && (
                  <div className="space-y-5 animate-in zoom-in-95 duration-500">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                      <p className="text-base font-semibold text-emerald-700 font-funnel-sans">
                        Buyback wallet provisioned & split deployed
                      </p>
                      <p className="text-sm text-black/60 font-funnel-sans mt-1">
                        Final step: point your token&apos;s fee revenue at the split address below.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-foreground uppercase">
                        Split Address
                      </p>
                      <div className="flex items-center gap-3 bg-gray-50 rounded-2xl px-4 py-3 border border-border">
                        <span className="font-mono text-sm text-black flex-1 break-all">
                          {result.splitAddress}
                        </span>
                        <button
                          onClick={() => handleCopy(result.splitAddress, 'split')}
                          className="shrink-0 p-2 rounded-lg hover:bg-black/10 transition-colors"
                        >
                          {copied === 'split' ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-black/40" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-foreground uppercase">
                        Buyback Wallet (a recipient on the split)
                      </p>
                      <div className="flex items-center gap-3 bg-gray-50 rounded-2xl px-4 py-3 border border-border">
                        <span className="font-mono text-sm text-black flex-1 break-all">
                          {result.walletAddress}
                        </span>
                        <button
                          onClick={() => handleCopy(result.walletAddress, 'wallet')}
                          className="shrink-0 p-2 rounded-lg hover:bg-black/10 transition-colors"
                        >
                          {copied === 'wallet' ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-black/40" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="bg-[#FFF8F3] border border-[#FFD8B8] rounded-2xl p-5 space-y-2">
                      <p className="text-sm font-semibold text-[#CC5500] font-funnel-sans">
                        What to do next
                      </p>
                      <p className="text-sm text-black/70 font-funnel-sans leading-relaxed">
                        {flowType === 'token' ? (
                          <>
                            Point your token&apos;s fee revenue at{' '}
                            <span className="font-mono break-all">
                              {result.splitAddress}
                            </span>
                            . For Clanker launches, use the Update button
                            below if shown — otherwise set the fee recipient
                            on your token (or LP locker / airlock) manually.
                            Once the split receives its first fees, the
                            buyback activates automatically.
                          </>
                        ) : flowType === 'safe' ? (
                          <>
                            Direct any revenue stream at{' '}
                            <span className="font-mono break-all">
                              {result.splitAddress}
                            </span>
                            {' '}- LP fees, protocol rewards, direct deposits,
                            or anything else. Once funds accumulate past the
                            threshold, the buyback executes automatically.
                          </>
                        ) : (
                          <>
                            Add{' '}
                            <span className="font-mono break-all">
                              {result.walletAddress}
                            </span>{' '}
                            as a recipient to your split. Once added, buyback
                            activates on the next distribution.
                          </>
                        )}
                      </p>
                    </div>

                    {/* Clanker v4 in-app updater. Renders only when the
                        factory acknowledged this token. The setter reverts
                        if the connected wallet isn't the admin for the
                        chosen reward index — we surface that as a toast. */}
                    {flowType === 'token' && clankerDeployment && (
                      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-blue-800 font-funnel-sans">
                            Clanker v4 detected
                          </p>
                          <p className="text-xs text-blue-900/70 font-funnel-sans mt-1">
                            We can update your LP locker&apos;s reward
                            recipient from here — no need to leave EarnKit.
                            Pick the reward index your wallet administers
                            (usually <span className="font-mono">0</span> for
                            the main creator).
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
                              onChange={(e) =>
                                setClankerRewardIndex(e.target.value)
                              }
                              onWheel={(e) => e.currentTarget.blur()}
                              className={INPUT_CLASS}
                              disabled={clankerUpdating}
                            />
                          </div>
                          <button
                            onClick={handleUpdateClankerRecipient}
                            disabled={clankerUpdating || !!clankerUpdateTx}
                            className="flex-1 rounded-full bg-blue-600 text-white py-3 font-funnel-sans hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {clankerUpdating ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Updating…
                              </>
                            ) : clankerUpdateTx ? (
                              <>
                                <Check className="w-4 h-4" />
                                Updated
                              </>
                            ) : (
                              'Update Clanker Recipient'
                            )}
                          </button>
                        </div>
                        {clankerUpdateTx && (
                          <a
                            href={`https://basescan.org/tx/${clankerUpdateTx}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-700 hover:text-blue-900 font-funnel-sans underline flex items-center gap-1"
                          >
                            View tx on BaseScan{' '}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}

                    {/* Clanker v3 panel — only shown when the connected
                        wallet has at least one v3 LP position. Independent
                        of the v4 detection above; both can render at once
                        if a creator has both v3 and v4 launches. */}
                    {flowType === 'token' && v3Positions.length > 0 && (
                      <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-purple-900 font-funnel-sans">
                            Clanker v3 LP position{v3Positions.length === 1 ? '' : 's'} found
                          </p>
                          <p className="text-xs text-purple-900/70 font-funnel-sans mt-1">
                            Pick the LP whose creator-side fees should flow
                            into this split.
                          </p>
                        </div>
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
                                      not admin
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-purple-900/60 font-mono mt-0.5">
                                  recipient {p.creator.recipient.slice(0, 6)}…{p.creator.recipient.slice(-4)}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={handleUpdateV3Recipient}
                          disabled={
                            v3Updating || !!v3UpdateTx || !v3SelectedKey
                          }
                          className="w-full rounded-full bg-purple-600 text-white py-3 font-funnel-sans hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {v3Updating ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Updating…
                            </>
                          ) : v3UpdateTx ? (
                            <>
                              <Check className="w-4 h-4" />
                              Updated
                            </>
                          ) : (
                            'Update Clanker v3 creator recipient'
                          )}
                        </button>
                        {v3UpdateTx && (
                          <a
                            href={`https://basescan.org/tx/${v3UpdateTx}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-purple-700 hover:text-purple-900 font-funnel-sans underline flex items-center gap-1"
                          >
                            View tx on BaseScan{' '}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}

                  </div>
                )}

                {/* Token form */}
                {!isProvisioning && step !== 'ready' && flowType === 'token' && (
                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <FieldLabel label="Token Contract Address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={tokenForm.tokenContractAddress}
                        onChange={handleTokenField('tokenContractAddress')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        The token whose fees you want flowing into the split.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel
                        label="Target Token to Buy Back & Burn"
                        required
                      />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={tokenForm.targetToken}
                        onChange={handleTokenField('targetToken')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        ERC-20 on Base. Revenue is swapped into this token and
                        burned.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <FieldLabel label="Your Wallet (Owner)" required />
                        <input
                          type="text"
                          placeholder="0x..."
                          value={tokenForm.ownerAddress}
                          onChange={handleTokenField('ownerAddress')}
                          className={`${INPUT_CLASS} font-mono`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel label="Recovery Address" required />
                        <input
                          type="text"
                          placeholder="0x..."
                          value={tokenForm.recoveryAddress}
                          onChange={handleTokenField('recoveryAddress')}
                          className={`${INPUT_CLASS} font-mono`}
                        />
                      </div>
                    </div>

                    {/* Percentages */}
                    <div className="space-y-2">
                      <FieldLabel label="Revenue Split (%)" required />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={tokenForm.ownerPct}
                            onChange={handleTokenField('ownerPct')}
                            onWheel={(e) => e.currentTarget.blur()}
                            className={INPUT_CLASS}
                          />
                          <p className="text-xs text-gray-400 mt-1 text-center">
                            Owner
                          </p>
                        </div>
                        <div>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={tokenForm.buybackPct}
                            onChange={handleTokenField('buybackPct')}
                            onWheel={(e) => e.currentTarget.blur()}
                            className={INPUT_CLASS}
                          />
                          <p className="text-xs text-gray-400 mt-1 text-center">
                            Buyback
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">
                        Must sum to 100. Buyback share must be at least 5%.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Email (Turnkey authenticator)" required />
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={tokenForm.userEmail}
                        onChange={handleTokenField('userEmail')}
                        className={INPUT_CLASS}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Becomes the root authenticator on your Turnkey sub-org.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Trigger Threshold (USD)" required />
                      <input
                        type="number"
                        min="1"
                        value={tokenForm.thresholdUsd}
                        onChange={handleTokenField('thresholdUsd')}
                        onWheel={(e) => e.currentTarget.blur()}
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                      <p className="text-sm text-amber-800 font-funnel-sans">
                        <span className="font-bold">Two signatures + one tx.</span>{' '}
                        You&apos;ll be asked to sign twice (register + attach) and
                        submit one on-chain tx (deploy the split). Gas is paid
                        by your wallet.
                      </p>
                    </div>
                  </div>
                )}

                {/* Pending Safe execution — shown after a Safe tx is proposed */}
                {step === 'pending_safe_exec' && pendingSafeTx && (
                  <div className="space-y-5 animate-in zoom-in-95 duration-500">
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                      <p className="text-base font-semibold text-blue-800 font-funnel-sans">
                        {pendingSafeTx.safeTxHash
                          ? 'Safe transaction proposed'
                          : 'Buyback wallet provisioned'}
                      </p>
                      <p className="text-sm text-blue-900/70 font-funnel-sans mt-1">
                        {pendingSafeTx.subflow === 'existing-split'
                          ? pendingSafeTx.safeTxHash
                            ? 'Execute the pending transaction in your Safe to add the buyback wallet as a recipient, then click "Check Activation".'
                            : 'Manually add the buyback wallet below to your split, then click "Check Activation".'
                          : 'Execute the pending transaction in your Safe to deploy the split, then click "Check & Complete Setup".'}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-foreground uppercase">
                        Buyback Wallet
                      </p>
                      <div className="flex items-center gap-3 bg-gray-50 rounded-2xl px-4 py-3 border border-border">
                        <span className="font-mono text-sm text-black flex-1 break-all">
                          {pendingSafeTx.buybackWallet}
                        </span>
                        <button
                          onClick={() => handleCopy(pendingSafeTx.buybackWallet, 'wallet')}
                          className="shrink-0 p-2 rounded-lg hover:bg-black/10 transition-colors"
                        >
                          {copied === 'wallet' ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-black/40" />
                          )}
                        </button>
                      </div>
                    </div>

                    {pendingSafeTx.safeTxHash && (
                      <a
                        href={pendingSafeTx.safeUiUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-border bg-gray-50 text-sm font-medium hover:bg-gray-100 transition-colors"
                      >
                        Open Safe Queue <ExternalLink className="w-4 h-4" />
                      </a>
                    )}

                    <button
                      onClick={handleCheckSafeExecution}
                      disabled={checkingActivation}
                      className="w-full py-4 text-xl bg-primary text-background rounded-full font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all flex items-center justify-center gap-2"
                    >
                      {checkingActivation ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Checking…
                        </>
                      ) : pendingSafeTx.subflow === 'existing-split' ? (
                        'Check Activation'
                      ) : (
                        'Check & Complete Setup'
                      )}
                    </button>
                  </div>
                )}

                {/* Safe form */}
                {!isProvisioning && step !== 'ready' && step !== 'pending_safe_exec' && flowType === 'safe' && (
                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <FieldLabel label="Safe Wallet Address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={safeForm.safeAddress}
                        onChange={handleSafeField('safeAddress')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Your Gnosis Safe multisig on Base.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Existing Split Address (optional)" />
                      <input
                        type="text"
                        placeholder="0x... — leave blank to create a new split via Safe"
                        value={safeForm.splitAddress}
                        onChange={handleSafeField('splitAddress')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        {isAddress(safeForm.splitAddress.trim())
                          ? 'Existing split detected — the buyback wallet will be added as a recipient via Safe tx.'
                          : 'No split provided — a new split will be created via Safe transaction.'}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Token to buy back & burn" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={safeForm.targetToken}
                        onChange={handleSafeField('targetToken')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        ERC-20 on Base. Revenue is swapped into this token and burned.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Recovery address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={safeForm.recoveryAddress}
                        onChange={handleSafeField('recoveryAddress')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Emergency sweep destination — an EOA you control.
                      </p>
                    </div>

                    {isAddress(safeForm.splitAddress.trim()) ? (
                      <div className="space-y-1.5">
                        <FieldLabel label="Buyback carve-out (%)" required />
                        <input
                          type="number"
                          min="1"
                          max="99"
                          step="1"
                          value={safeForm.buybackPct}
                          onChange={handleSafeField('buybackPct')}
                          onWheel={(e) => e.currentTarget.blur()}
                          className={INPUT_CLASS}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          Existing recipients are scaled down proportionally to make room.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <FieldLabel label="Revenue split (%)" required />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={safeForm.ownerPct}
                              onChange={handleSafeField('ownerPct')}
                              onWheel={(e) => e.currentTarget.blur()}
                              className={INPUT_CLASS}
                            />
                            <p className="text-xs text-gray-400 mt-1 text-center">
                              Safe (owner)
                            </p>
                          </div>
                          <div>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={safeForm.buybackPct}
                              onChange={handleSafeField('buybackPct')}
                              onWheel={(e) => e.currentTarget.blur()}
                              className={INPUT_CLASS}
                            />
                            <p className="text-xs text-gray-400 mt-1 text-center">
                              Buyback
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400">
                          Must sum to 100. Buyback share must be at least 5%.
                        </p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <FieldLabel label="Your email" required />
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={safeForm.userEmail}
                        onChange={handleSafeField('userEmail')}
                        className={INPUT_CLASS}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Becomes the root authenticator on your Turnkey sub-org.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Trigger threshold (USD)" required />
                      <input
                        type="number"
                        min="10"
                        step="1"
                        value={safeForm.thresholdUsd}
                        onChange={handleSafeField('thresholdUsd')}
                        onWheel={(e) => e.currentTarget.blur()}
                        className={INPUT_CLASS}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Minimum accumulated value before a buyback executes.
                      </p>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                      <p className="text-sm text-amber-800 font-funnel-sans">
                        <span className="font-bold">One signature + one Safe tx.</span>{' '}
                        Your connected EOA signs once to prove Safe ownership. We
                        then propose the split transaction to your Safe — execute
                        it in the Safe UI to complete setup.
                      </p>
                    </div>
                  </div>
                )}

                {/* Splits form */}
                {!isProvisioning && step !== 'ready' && flowType === 'splits' && (
                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <FieldLabel label="Owner Wallet Address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={sharedForm.ownerAddress}
                        onChange={handleSharedField('ownerAddress')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        The Safe that controls your split.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Existing split address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={sharedForm.splitAddress}
                        onChange={handleSharedField('splitAddress')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        The 0xSplits V2 contract already deployed on Base.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Token to buy back & burn" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={sharedForm.targetToken}
                        onChange={handleSharedField('targetToken')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        ERC-20 on Base. Revenue is swapped into this token and
                        burned.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Recovery address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={sharedForm.recoveryAddress}
                        onChange={handleSharedField('recoveryAddress')}
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Emergency sweep destination — your own EOA.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Your email" required />
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={sharedForm.userEmail}
                        onChange={handleSharedField('userEmail')}
                        className={INPUT_CLASS}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Becomes the root authenticator on your Turnkey sub-org.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Trigger threshold (USD)" required />
                      <input
                        type="number"
                        min="10"
                        step="1"
                        value={sharedForm.thresholdUsd}
                        onChange={handleSharedField('thresholdUsd')}
                        onWheel={(e) => e.currentTarget.blur()}
                        className={INPUT_CLASS}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Minimum accumulated value before a buyback executes.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action button */}
              {!isProvisioning && step !== 'ready' && step !== 'pending_safe_exec' && (
                <button
                  onClick={
                    flowType === 'token'
                      ? handleRegisterToken
                      : flowType === 'safe'
                        ? handleRegisterSafe
                        : handleRegisterShared
                  }
                  className="w-full mt-10 py-4 text-xl bg-primary text-background rounded-full font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
                >
                  {flowType === 'token'
                    ? 'Provision & Deploy Split'
                    : flowType === 'safe'
                      ? 'Provision & Propose Safe Tx'
                      : 'Setup Buyback'}
                </button>
              )}

              {step === 'ready' && (
                <button
                  onClick={goBack}
                  className="w-full mt-10 py-4 text-xl bg-primary text-background rounded-full font-bold cursor-pointer transition-all"
                >
                  Done
                </button>
              )}

              {/* Back nav */}
              {!isProvisioning && (
                <div className="flex justify-between items-center mt-6 pt-6 border-t border-border">
                  <button
                    onClick={goBack}
                    className="flex items-center gap-2 text-foreground hover:text-primary transition-colors text-sm font-medium px-4 py-2 -ml-4 cursor-pointer"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    Back
                  </button>
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </header>
  );
}
