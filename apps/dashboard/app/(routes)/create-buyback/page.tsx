'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import {
  Copy,
  Check,
  Search,
  Loader2,
  ArrowLeft,
  ChevronRight,
  Flame,
} from 'lucide-react';
import { toast } from 'sonner';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SHARED_STORAGE_KEY = 'earnkit_shared_buyback_configs';

type View = 'selection' | 'shared' | 'token';
type Step = 'form' | 'detecting' | 'provisioning' | 'ready';

interface DetectionResult {
  detected: boolean;
  getterName: string | null;
  setterName: string | null;
  currentRecipient: string | null;
  instruction: string;
}

interface MiniConfig {
  id: string;
  tokenSymbol: string;
  status: string;
  splitAddress: string;
  lastTriggeredAt: string | null;
}

interface MiniExecution {
  configId: string;
  tokenSymbol: string;
  id: string;
  status: string;
  triggerBalanceUsd: number;
  startedAt: string;
}

const statusConfig: Record<string, { label: string; class: string }> = {
  PROVISIONING: { label: 'Provisioning', class: 'text-black/40 border-black/30 bg-black/4' },
  PENDING_SPLIT_UPDATE: { label: 'Pending', class: 'text-secondary-orange border-secondary-orange bg-secondary-orange/10' },
  ACTIVE: { label: 'Active', class: 'text-secondary-green border-secondary-green bg-secondary-green/10' },
  PAUSED: { label: 'Paused', class: 'text-black/40 border-black/30 bg-black/4' },
  BROKEN: { label: 'Broken', class: 'text-red-600 border-red-300 bg-red-50' },
};

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function CreateBuybackPage() {
  const [view, setView] = useState<View>('selection');
  const [step, setStep] = useState<Step>('form');
  const [copied, setCopied] = useState(false);

  // --- Platform Config (fetched from backend) ---
  const [platformFeeRateBps, setPlatformFeeRateBps] = useState<number>(100);
  const [minThresholdUsd, setMinThresholdUsd] = useState<number>(10);
  const platformFeePercent = (platformFeeRateBps / 100).toFixed(1).replace(/\.0$/, '');

  useEffect(() => {
    fetch('/api/platform-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.platformFeeRateBps) setPlatformFeeRateBps(d.platformFeeRateBps);
        if (d.minThresholdUsd) setMinThresholdUsd(d.minThresholdUsd);
      })
      .catch(() => {});
  }, []);

  // --- Shared Buyback States ---
  const [sharedForm, setSharedForm] = useState({
    ownerAddress: '',
    splitAddress: '',
    targetToken: '',
    recoveryAddress: '',
    userEmail: '',
    thresholdUsd: '10',
  });

  // --- Token Buyback States ---
  const [tokenForm, setTokenForm] = useState({
    tokenContractAddress: '',
    targetToken: '',
    ownerAddress: '',
    recoveryAddress: '',
    userEmail: '',
    thresholdUsd: '10',
  });
  const [tokenErrors, setTokenErrors] = useState<Partial<typeof tokenForm>>({});
  const [detection, setDetection] = useState<DetectionResult | null>(null);

  // --- Common Result States ---
  const [result, setResult] = useState<{ walletAddress: string; instructions?: string; instruction?: string; configId?: string } | null>(null);

  // --- Bottom Preview + Stats ---
  const [previewConfigIds, setPreviewConfigIds] = useState<string[]>([]);
  const [previewConfigs, setPreviewConfigs] = useState<MiniConfig[]>([]);
  const [previewExecutions, setPreviewExecutions] = useState<MiniExecution[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHARED_STORAGE_KEY);
      if (raw) setPreviewConfigIds(JSON.parse(raw) as string[]);
    } catch {}
  }, []);

  useEffect(() => {
    if (previewConfigIds.length === 0) return;
    const ids = previewConfigIds.slice(0, 3);
    setPreviewLoading(true);

    Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/shared-buyback/${id}`);
          if (!res.ok) return null;
          const d = await res.json();
          return { id, tokenSymbol: d.tokenSymbol, status: d.status, splitAddress: d.splitAddress, lastTriggeredAt: d.lastTriggeredAt } as MiniConfig;
        } catch { return null; }
      })
    ).then(async (configs) => {
      const valid = configs.filter(Boolean) as MiniConfig[];
      setPreviewConfigs(valid);

      const execResults = await Promise.all(
        valid.map(async (cfg) => {
          try {
            const res = await fetch(`/api/shared-buyback/${cfg.id}/executions`);
            if (!res.ok) return [];
            const d = await res.json();
            return (d.executions ?? [])
              .filter((e: { status: string }) => e.status === 'COMPLETED')
              .map((e: { id: string; status: string; triggerBalanceUsd: number; startedAt: string }) => ({
                configId: cfg.id,
                tokenSymbol: cfg.tokenSymbol,
                id: e.id,
                status: e.status,
                triggerBalanceUsd: e.triggerBalanceUsd,
                startedAt: e.startedAt,
              }));
          } catch { return []; }
        })
      );

      const allCompleted = (execResults.flat() as MiniExecution[]).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );

      setPreviewExecutions(allCompleted.slice(0, 4));
    }).finally(() => setPreviewLoading(false));
  }, [previewConfigIds]);

  const isAddress = (val: string) => ADDRESS_RE.test(val.trim());

  const handleSharedField =
    (key: keyof typeof sharedForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSharedForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const handleRegisterShared = async () => {
    if (!isAddress(sharedForm.ownerAddress)) { toast.error('Owner address is not a valid 0x address'); return; }
    if (!isAddress(sharedForm.splitAddress)) { toast.error('Split address is not a valid 0x address'); return; }
    if (!isAddress(sharedForm.targetToken)) { toast.error('Target token is not a valid 0x address'); return; }
    if (!isAddress(sharedForm.recoveryAddress)) { toast.error('Recovery address is not a valid 0x address'); return; }
    if (!sharedForm.userEmail.includes('@')) { toast.error('Enter a valid email address'); return; }

    setStep('provisioning');
    try {
      const res = await fetch('/api/shared-buyback/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAddress: sharedForm.ownerAddress.trim(),
          splitAddress: sharedForm.splitAddress.trim(),
          targetToken: sharedForm.targetToken.trim(),
          recoveryAddress: sharedForm.recoveryAddress.trim(),
          userEmail: sharedForm.userEmail.trim(),
          thresholdUsd: parseFloat(sharedForm.thresholdUsd) || minThresholdUsd,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Registration failed'); setStep('form'); return; }
      if (data.configId) {
        try {
          const raw = localStorage.getItem(SHARED_STORAGE_KEY);
          const existing: string[] = raw ? JSON.parse(raw) : [];
          if (!existing.includes(data.configId)) {
            localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify([...existing, data.configId]));
          }
          setPreviewConfigIds((prev) => prev.includes(data.configId) ? prev : [...prev, data.configId]);
        } catch {}
      }
      setResult(data);
      setStep('ready');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Unexpected error');
      setStep('form');
    }
  };

  const handleTokenField =
    (key: keyof typeof tokenForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTokenForm((f) => ({ ...f, [key]: e.target.value }));
      setTokenErrors((er) => ({ ...er, [key]: undefined }));
    };

  function validateToken() {
    const errs: Partial<typeof tokenForm> = {};
    if (!isAddress(tokenForm.tokenContractAddress)) errs.tokenContractAddress = 'Invalid address';
    if (!isAddress(tokenForm.targetToken)) errs.targetToken = 'Invalid address';
    if (!isAddress(tokenForm.ownerAddress)) errs.ownerAddress = 'Invalid address';
    if (!isAddress(tokenForm.recoveryAddress)) errs.recoveryAddress = 'Invalid address';
    if (!tokenForm.userEmail.includes('@')) errs.userEmail = 'Invalid email';
    const thr = Number(tokenForm.thresholdUsd);
    if (isNaN(thr) || thr <= 0) errs.thresholdUsd = 'Must be > 0';
    setTokenErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const handleDetectToken = async () => {
    if (!isAddress(tokenForm.tokenContractAddress)) {
      setTokenErrors((e) => ({ ...e, tokenContractAddress: 'Invalid address' }));
      return;
    }
    setStep('detecting');
    try {
      const res = await fetch('/api/token-buyback/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenContractAddress: tokenForm.tokenContractAddress }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Detection failed'); setStep('form'); return; }
      setDetection(data);
    } catch {
      toast.error('Detection failed');
    } finally {
      setStep('form');
    }
  };

  const handleRegisterToken = async () => {
    if (!validateToken()) return;
    setStep('provisioning');
    try {
      const res = await fetch('/api/token-buyback/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenContractAddress: tokenForm.tokenContractAddress,
          targetToken: tokenForm.targetToken,
          ownerAddress: tokenForm.ownerAddress,
          recoveryAddress: tokenForm.recoveryAddress,
          userEmail: tokenForm.userEmail,
          thresholdUsd: Number(tokenForm.thresholdUsd),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Registration failed'); setStep('form'); return; }
      setResult(data);
      setStep('ready');
    } catch {
      toast.error('Registration failed');
      setStep('form');
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetToSelection = () => {
    setView('selection');
    setStep('form');
    setResult(null);
    setDetection(null);
  };

  const isProvisioning = step === 'provisioning' || step === 'detecting';

  return (
    <main className="max-w-2xl mx-auto py-12 px-6 min-h-screen">
      {/* Header */}
      <div className="mb-8 text-center">
        {view !== 'selection' && step !== 'ready' && (
          <button
            onClick={resetToSelection}
            className="flex items-center text-sm font-medium text-black/40 hover:text-black mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </button>
        )}

        <h1 className="text-3xl font-funnel-display font-bold">
          {step === 'ready' ? 'Buyback Wallet Ready' : 'Create Buyback'}
        </h1>

        <p className="text-black/50 font-funnel-sans mt-2">
          {view === 'selection' && 'Select the type of buyback integration you want to set up.'}
          {view === 'shared' && step === 'form' && `Connect your existing split to an automated buyback. A ${platformFeePercent}% platform fee applies per execution.`}
          {view === 'token' && step === 'form' && "Provision a buyback wallet for your token contract's fee revenue."}
          {step === 'provisioning' && 'Creating your Turnkey-managed buyback wallet. This takes a few seconds.'}
          {step === 'ready' && 'Add the wallet address below to your contract/split to activate buyback.'}
        </p>
      </div>

      {/* View 1: Selection */}
      {view === 'selection' && (
        <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">

          {/* Type Cards */}
          <div className="flex flex-col gap-4">
            <button
              onClick={() => setView('shared')}
              className="flex flex-col items-start p-8 bg-[#F8F9FA] border border-[#E5E7EB] rounded-[32px] hover:border-black/20 hover:bg-[#F3F4F6] transition-all text-left"
            >
              <div className="flex items-center gap-2 mb-2">
                <Flame className="w-5 h-5 text-secondary-orange" />
                <span className="text-lg font-funnel-sans font-semibold text-black">Splits Buyback</span>
              </div>
              <span className="text-sm text-black/40 font-funnel-sans leading-relaxed">
                Add your existing splits contract and we handle everything else for the buyback.
              </span>
            </button>

            {/* Token Buyback — temporarily hidden */}
            {/* <button
              onClick={() => setView('token')}
              className="flex flex-col items-center justify-center p-14 bg-[#F8F9FA] border border-[#E5E7EB] rounded-[32px] hover:border-black/20 hover:bg-[#F3F4F6] transition-all"
            >
              <span className="text-lg font-funnel-sans font-semibold text-black">Token Buyback</span>
            </button> */}
          </div>

          {/* Bottom Preview — only render columns that have data */}
          {previewConfigIds.length > 0 && !previewLoading && (previewConfigs.length > 0 || previewExecutions.length > 0) && (
            <div className="border-t border-black/10 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Splits Setup Column */}
              {previewConfigs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold font-funnel-sans text-black/50 uppercase tracking-wide">
                    Your Buybacks
                  </h2>
                  <Link
                    href="/shared-buyback"
                    className="flex items-center gap-0.5 text-xs text-black/40 hover:text-black font-funnel-sans transition-colors"
                  >
                    View all <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="space-y-2">
                  {previewConfigs.map((cfg) => {
                    const sc = statusConfig[cfg.status] ?? statusConfig.PAUSED;
                    return (
                      <div
                        key={cfg.id}
                        className="flex items-center justify-between gap-3 bg-black/[0.02] border border-black/[0.06] rounded-[12px] px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-black font-funnel-sans truncate">
                            {cfg.tokenSymbol || '—'}
                          </p>
                          <p className="text-[11px] text-black/30 font-mono mt-0.5">
                            {truncate(cfg.splitAddress)}
                          </p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-funnel-sans font-medium shrink-0 ${sc.class}`}>
                          {sc.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Recent Buybacks Column */}
              {previewExecutions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold font-funnel-sans text-black/50 uppercase tracking-wide">
                    Recent Buybacks
                  </h2>
                  <Link
                    href="/executions"
                    className="flex items-center gap-0.5 text-xs text-black/40 hover:text-black font-funnel-sans transition-colors"
                  >
                    View all <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="space-y-2">
                  {previewExecutions.map((exec) => (
                    <div
                      key={exec.id}
                      className="flex items-center justify-between gap-3 bg-black/[0.02] border border-black/[0.06] rounded-[12px] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-black font-funnel-sans">
                          {exec.tokenSymbol}
                        </p>
                        <p className="text-[11px] text-black/30 font-funnel-sans mt-0.5">
                          {new Date(exec.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-secondary-green font-funnel-sans shrink-0">
                        ${exec.triggerBalanceUsd.toFixed(2)}
                      </p>
                      </div>
                    ))}
                  </div>
              </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* View 2: Shared / Splits Buyback Form */}
      {view === 'shared' && step === 'form' && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Owner Wallet Address
            </Label>
            <Input
              placeholder="0x…"
              value={sharedForm.ownerAddress}
              onChange={handleSharedField('ownerAddress')}
              className="font-mono text-sm"
            />
            <p className="text-xs text-black/40 font-funnel-sans">The Safe that controls your split.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Existing split address
            </Label>
            <Input
              placeholder="0x…"
              value={sharedForm.splitAddress}
              onChange={handleSharedField('splitAddress')}
              className="font-mono text-sm"
            />
            <p className="text-xs text-black/40 font-funnel-sans">The 0xSplits V2 contract already deployed on Base.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Token to buy back & burn
            </Label>
            <Input
              placeholder="0x…"
              value={sharedForm.targetToken}
              onChange={handleSharedField('targetToken')}
              className="font-mono text-sm"
            />
            <p className="text-xs text-black/40 font-funnel-sans">
              ERC-20 on Base. Revenue is swapped into this token and burned.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">Recovery address</Label>
            <Input
              placeholder="0x…"
              value={sharedForm.recoveryAddress}
              onChange={handleSharedField('recoveryAddress')}
              className="font-mono text-sm"
            />
            <p className="text-xs text-black/40 font-funnel-sans">Emergency sweep destination — your own EOA.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">Your email</Label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={sharedForm.userEmail}
              onChange={handleSharedField('userEmail')}
              className="font-funnel-sans text-sm"
            />
            <p className="text-xs text-black/40 font-funnel-sans">
              Becomes the root authenticator on your Turnkey sub-org.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Trigger threshold (USD)
            </Label>
            <Input
              type="number"
              min="10"
              step="1"
              value={sharedForm.thresholdUsd}
              onChange={handleSharedField('thresholdUsd')}
              onWheel={(e) => e.currentTarget.blur()}
            />
            <p className="text-xs text-black/40 font-funnel-sans">
              Minimum accumulated value before a buyback executes.
            </p>
          </div>

          <div className="pt-4 flex gap-3">
            <Button
              variant="outline"
              onClick={resetToSelection}
              className="rounded-full border-black/20 w-1/3"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRegisterShared}
              className="rounded-full bg-black text-white hover:bg-black/80 w-2/3"
            >
              Set Up Buyback
            </Button>
          </div>
        </div>
      )}

      {/* View 3: Token Buyback Form */}
      {view === 'token' && step === 'form' && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Token Contract Address
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="0x…"
                value={tokenForm.tokenContractAddress}
                onChange={handleTokenField('tokenContractAddress')}
                className="font-mono text-sm flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleDetectToken}
                className="shrink-0 px-4 hover:bg-black/5"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
            {tokenErrors.tokenContractAddress && (
              <p className="text-xs text-red-500 font-funnel-sans">{tokenErrors.tokenContractAddress}</p>
            )}
            {detection && (
              <div className="bg-black/4 border border-black/10 rounded-lg px-4 py-3 text-sm font-funnel-sans mt-2 space-y-1">
                {detection.detected ? (
                  <>
                    <p className="text-black/70">
                      Detected:{' '}
                      <span className="font-mono text-black">{detection.getterName}()</span>
                    </p>
                    <p className="text-black/50">
                      Current:{' '}
                      <span className="font-mono">{detection.currentRecipient?.slice(0, 10)}…</span>
                    </p>
                    <p className="text-black/60">
                      You&apos;ll call:{' '}
                      <span className="font-mono text-black">{detection.setterName}(&lt;wallet&gt;)</span>
                    </p>
                  </>
                ) : (
                  <p className="text-black/50">
                    No standard fee recipient getter detected — you&apos;ll receive generic instructions after provisioning.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Target Token to Buy Back & Burn
            </Label>
            <Input
              placeholder="0x…"
              value={tokenForm.targetToken}
              onChange={handleTokenField('targetToken')}
              className="font-mono text-sm"
            />
            {tokenErrors.targetToken && (
              <p className="text-xs text-red-500 font-funnel-sans">{tokenErrors.targetToken}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-black font-funnel-sans">Your Wallet (Owner)</Label>
              <Input
                placeholder="0x…"
                value={tokenForm.ownerAddress}
                onChange={handleTokenField('ownerAddress')}
                className="font-mono text-sm"
              />
              {tokenErrors.ownerAddress && (
                <p className="text-xs text-red-500 font-funnel-sans">{tokenErrors.ownerAddress}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-black font-funnel-sans">Recovery Address</Label>
              <Input
                placeholder="0x…"
                value={tokenForm.recoveryAddress}
                onChange={handleTokenField('recoveryAddress')}
                className="font-mono text-sm"
              />
              {tokenErrors.recoveryAddress && (
                <p className="text-xs text-red-500 font-funnel-sans">{tokenErrors.recoveryAddress}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-black font-funnel-sans">Email (Turnkey authenticator)</Label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={tokenForm.userEmail}
              onChange={handleTokenField('userEmail')}
              className="text-sm"
            />
            {tokenErrors.userEmail && (
              <p className="text-xs text-red-500 font-funnel-sans">{tokenErrors.userEmail}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-black font-funnel-sans">Trigger Threshold (USD)</Label>
            <Input
              type="number"
              min="1"
              value={tokenForm.thresholdUsd}
              onChange={handleTokenField('thresholdUsd')}
              className="text-sm"
            />
            {tokenErrors.thresholdUsd && (
              <p className="text-xs text-red-500 font-funnel-sans">{tokenErrors.thresholdUsd}</p>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-800 font-funnel-sans">
              <span className="font-bold">Push-based only.</span> The buyback wallet must receive fees directly. Claim-based patterns are not supported.
            </p>
          </div>

          <div className="pt-4 flex gap-3">
            <Button
              variant="outline"
              onClick={resetToSelection}
              className="rounded-full border-black/20 w-1/3"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRegisterToken}
              className="rounded-full bg-black text-white hover:bg-black/80 w-2/3"
            >
              Provision Buyback Wallet
            </Button>
          </div>
        </div>
      )}

      {/* Provisioning State */}
      {isProvisioning && (
        <div className="flex flex-col items-center justify-center py-20 gap-6 animate-in fade-in duration-500">
          <Loader2 className="w-12 h-12 animate-spin text-black/40" />
          <p className="text-lg text-black/60 font-funnel-sans font-medium">
            {step === 'detecting' ? 'Detecting fee pattern…' : 'Setting up your Turnkey buyback wallet…'}
          </p>
        </div>
      )}

      {/* Ready State */}
      {step === 'ready' && result && (
        <div className="space-y-5 animate-in zoom-in-95 duration-500">
          <div className="bg-secondary-green/10 border border-secondary-green/30 rounded-[20px] p-5">
            <p className="text-base font-semibold text-secondary-green font-funnel-sans">
              Buyback wallet ready
            </p>
            <p className="text-sm text-black/60 font-funnel-sans mt-1">
              Your buyback wallet has been created. Add it to your split to start automating buybacks.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-black/40 font-funnel-sans uppercase tracking-wide">
              Buyback Wallet Address
            </p>
            <div className="flex items-center gap-3 bg-black/[0.03] rounded-[14px] px-4 py-3 border border-black/10">
              <span className="font-mono text-sm text-black flex-1 break-all">{result.walletAddress}</span>
              <button
                onClick={() => handleCopy(result.walletAddress)}
                className="shrink-0 p-2 rounded-lg hover:bg-black/10 transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-secondary-green" />
                ) : (
                  <Copy className="w-4 h-4 text-black/40" />
                )}
              </button>
            </div>
          </div>

          <div className="bg-[#FFF8F3] border border-[#FFD8B8] rounded-[20px] p-5 space-y-2">
            <p className="text-sm font-semibold text-[#CC5500] font-funnel-sans">What to do next</p>
            <p className="text-sm text-black/70 font-funnel-sans leading-relaxed">
              {result.instructions || result.instruction}
            </p>
            <p className="text-xs text-black/40 font-funnel-sans pt-1">
              {view === 'shared'
                ? 'Once the wallet is added as a recipient, buybacks start automatically on every distribution.'
                : 'Once fees reach your threshold, the buyback fires automatically — nothing else needed.'}
            </p>
          </div>

          {/* {view === 'shared' && sharedForm.ownerAddress && (
            <a
              href={`https://app.safe.global/transactions/queue?safe=base:${sharedForm.ownerAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-blue-600 font-funnel-sans hover:underline"
            >
              Open Safe App <ExternalLink className="w-4 h-4" />
            </a>
          )} */}

          <Button
            onClick={resetToSelection}
            className="w-full rounded-full bg-black text-white py-3 font-funnel-sans hover:bg-black/80"
          >
            Done
          </Button>
        </div>
      )}
    </main>
  );
}
