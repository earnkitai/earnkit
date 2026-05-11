'use client';

import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import {
  Copy,
  Check,
  Search,
  Loader2,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

type View = 'selection' | 'shared' | 'token';
type Step = 'form' | 'detecting' | 'provisioning' | 'ready';

interface DetectionResult {
  detected: boolean;
  getterName: string | null;
  setterName: string | null;
  currentRecipient: string | null;
  instruction: string;
}

export default function CreateBuybackPage() {
  const [view, setView] = useState<View>('selection');
  const [step, setStep] = useState<Step>('form');
  const [copied, setCopied] = useState(false);

  // --- Shared Buyback States ---
  const [sharedForm, setSharedForm] = useState({
    ownerAddress: '',
    splitAddress: '',
    targetToken: '',
    recoveryAddress: '',
    userEmail: '',
    feeRateBps: '500',
    thresholdUsd: '10',
  });

  // --- Token Buyback States ---
  const [tokenForm, setTokenForm] = useState({
    tokenContractAddress: '',
    targetToken: '',
    ownerAddress: '',
    recoveryAddress: '',
    userEmail: '',
    feeRateBps: '500',
    thresholdUsd: '10',
  });
  const [tokenErrors, setTokenErrors] = useState<Partial<typeof tokenForm>>({});
  const [detection, setDetection] = useState<DetectionResult | null>(null);

  // --- Common Result States ---
  const [result, setResult] = useState<any>(null);

  const isAddress = (val: string) => ADDRESS_RE.test(val.trim());

  // --- Shared Handlers ---
  const handleSharedField =
    (key: keyof typeof sharedForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSharedForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const handleRegisterShared = async () => {
    if (!isAddress(sharedForm.ownerAddress)) {
      toast.error('Owner address is not a valid 0x address');
      return;
    }
    if (!isAddress(sharedForm.splitAddress)) {
      toast.error('Split address is not a valid 0x address');
      return;
    }
    if (!isAddress(sharedForm.targetToken)) {
      toast.error('Target token is not a valid 0x address');
      return;
    }
    if (!isAddress(sharedForm.recoveryAddress)) {
      toast.error('Recovery address is not a valid 0x address');
      return;
    }
    if (!sharedForm.userEmail.includes('@')) {
      toast.error('Enter a valid email address');
      return;
    }

    const fee = parseInt(sharedForm.feeRateBps, 10);
    if (isNaN(fee) || fee < 0 || fee > 2000) {
      toast.error('Fee rate must be between 0 and 2000 bps');
      return;
    }

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
          feeRateBps: fee,
          thresholdUsd: parseFloat(sharedForm.thresholdUsd) || 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Registration failed');
        setStep('form');
        return;
      }
      setResult(data);
      setStep('ready');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Unexpected error');
      setStep('form');
    }
  };

  // --- Token Handlers ---
  const handleTokenField =
    (key: keyof typeof tokenForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTokenForm((f) => ({ ...f, [key]: e.target.value }));
      setTokenErrors((er) => ({ ...er, [key]: undefined }));
    };

  function validateToken() {
    const errs: Partial<typeof tokenForm> = {};
    if (!isAddress(tokenForm.tokenContractAddress))
      errs.tokenContractAddress = 'Invalid address';
    if (!isAddress(tokenForm.targetToken)) errs.targetToken = 'Invalid address';
    if (!isAddress(tokenForm.ownerAddress))
      errs.ownerAddress = 'Invalid address';
    if (!isAddress(tokenForm.recoveryAddress))
      errs.recoveryAddress = 'Invalid address';
    if (!tokenForm.userEmail.includes('@')) errs.userEmail = 'Invalid email';
    const bps = Number(tokenForm.feeRateBps);
    if (isNaN(bps) || bps < 0 || bps > 2000) errs.feeRateBps = '0–2000 bps';
    const thr = Number(tokenForm.thresholdUsd);
    if (isNaN(thr) || thr <= 0) errs.thresholdUsd = 'Must be > 0';
    setTokenErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const handleDetectToken = async () => {
    if (!isAddress(tokenForm.tokenContractAddress)) {
      setTokenErrors((e) => ({
        ...e,
        tokenContractAddress: 'Invalid address',
      }));
      return;
    }
    setStep('detecting');
    try {
      const res = await fetch('/api/token-buyback/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenContractAddress: tokenForm.tokenContractAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Detection failed');
        setStep('form');
        return;
      }
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
          feeRateBps: Number(tokenForm.feeRateBps),
          thresholdUsd: Number(tokenForm.thresholdUsd),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Registration failed');
        setStep('form');
        return;
      }
      setResult(data);
      setStep('ready');
    } catch {
      toast.error('Registration failed');
      setStep('form');
    }
  };

  // --- Global Helpers ---
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
      {/* Header Area */}
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
          {view === 'selection' &&
            'Select the type of buyback integration you want to set up.'}
          {view === 'shared' &&
            step === 'form' &&
            'Connect your existing split to an automated buyback. A 5% platform fee applies per execution.'}
          {view === 'token' &&
            step === 'form' &&
            "Provision a buyback wallet for your token contract's fee revenue."}
          {step === 'provisioning' &&
            'Creating your Turnkey-managed buyback wallet. This takes a few seconds.'}
          {step === 'ready' &&
            'Add the wallet address below to your contract/split to activate buyback.'}
        </p>
      </div>

      {/* View 1: Selection Cards */}
      {view === 'selection' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in zoom-in-95 duration-300">
          <button
            onClick={() => setView('shared')}
            className="flex flex-col items-center justify-center p-14 bg-[#F8F9FA] border border-[#E5E7EB] rounded-[32px] hover:border-black/20 hover:bg-[#F3F4F6] transition-all"
          >
            <span className="text-lg font-funnel-sans font-semibold text-black">
              Shared Buyback
            </span>
          </button>
          <button
            onClick={() => setView('token')}
            className="flex flex-col items-center justify-center p-14 bg-[#F8F9FA] border border-[#E5E7EB] rounded-[32px] hover:border-black/20 hover:bg-[#F3F4F6] transition-all"
          >
            <span className="text-lg font-funnel-sans font-semibold text-black">
              Token Buyback
            </span>
          </button>
        </div>
      )}

      {/* View 2: Shared Buyback Form */}
      {view === 'shared' && step === 'form' && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Your Safe / owner address
            </Label>
            <Input
              placeholder="0x…"
              value={sharedForm.ownerAddress}
              onChange={handleSharedField('ownerAddress')}
              className="font-mono text-sm"
            />
            <p className="text-xs text-black/40 font-funnel-sans">
              The Safe that controls your split.
            </p>
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
            <p className="text-xs text-black/40 font-funnel-sans">
              The 0xSplits V2 contract already deployed on Base.
            </p>
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
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Recovery address
            </Label>
            <Input
              placeholder="0x…"
              value={sharedForm.recoveryAddress}
              onChange={handleSharedField('recoveryAddress')}
              className="font-mono text-sm"
            />
            <p className="text-xs text-black/40 font-funnel-sans">
              Emergency sweep destination — your own EOA.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Your email
            </Label>
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

          <div className="grid grid-cols-2 gap-4">
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
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-black font-funnel-sans">
                Fee rate (bps)
              </Label>
              <Input
                type="number"
                min="0"
                max="2000"
                step="50"
                value={sharedForm.feeRateBps}
                onChange={handleSharedField('feeRateBps')}
                onWheel={(e) => e.currentTarget.blur()}
              />
              <p className="text-xs text-black/40 font-funnel-sans">500 = 5%</p>
            </div>
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
              <p className="text-xs text-red-500 font-funnel-sans">
                {tokenErrors.tokenContractAddress}
              </p>
            )}

            {detection && (
              <div className="bg-black/4 border border-black/10 rounded-lg px-4 py-3 text-sm font-funnel-sans mt-2 space-y-1">
                {detection.detected ? (
                  <>
                    <p className="text-black/70">
                      Detected:{' '}
                      <span className="font-mono text-black">
                        {detection.getterName}()
                      </span>
                    </p>
                    <p className="text-black/50">
                      Current:{' '}
                      <span className="font-mono">
                        {detection.currentRecipient?.slice(0, 10)}…
                      </span>
                    </p>
                    <p className="text-black/60">
                      You&apos;ll call:{' '}
                      <span className="font-mono text-black">
                        {detection.setterName}(&lt;wallet&gt;)
                      </span>
                    </p>
                  </>
                ) : (
                  <p className="text-black/50">
                    No standard fee recipient getter detected — you&apos;ll
                    receive generic instructions after provisioning.
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
              <p className="text-xs text-red-500 font-funnel-sans">
                {tokenErrors.targetToken}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-black font-funnel-sans">
                Your Wallet (Owner)
              </Label>
              <Input
                placeholder="0x…"
                value={tokenForm.ownerAddress}
                onChange={handleTokenField('ownerAddress')}
                className="font-mono text-sm"
              />
              {tokenErrors.ownerAddress && (
                <p className="text-xs text-red-500 font-funnel-sans">
                  {tokenErrors.ownerAddress}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-black font-funnel-sans">
                Recovery Address
              </Label>
              <Input
                placeholder="0x…"
                value={tokenForm.recoveryAddress}
                onChange={handleTokenField('recoveryAddress')}
                className="font-mono text-sm"
              />
              {tokenErrors.recoveryAddress && (
                <p className="text-xs text-red-500 font-funnel-sans">
                  {tokenErrors.recoveryAddress}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-black font-funnel-sans">
              Email (Turnkey authenticator)
            </Label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={tokenForm.userEmail}
              onChange={handleTokenField('userEmail')}
              className="text-sm"
            />
            {tokenErrors.userEmail && (
              <p className="text-xs text-red-500 font-funnel-sans">
                {tokenErrors.userEmail}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-black font-funnel-sans">
                Fee Rate (
                {((Number(tokenForm.feeRateBps) || 0) / 100).toFixed(1)}%)
              </Label>
              <Input
                type="number"
                min="0"
                max="2000"
                value={tokenForm.feeRateBps}
                onChange={handleTokenField('feeRateBps')}
                className="text-sm"
              />
              {tokenErrors.feeRateBps && (
                <p className="text-xs text-red-500 font-funnel-sans">
                  {tokenErrors.feeRateBps}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-black font-funnel-sans">
                Trigger Threshold (USD)
              </Label>
              <Input
                type="number"
                min="1"
                value={tokenForm.thresholdUsd}
                onChange={handleTokenField('thresholdUsd')}
                className="text-sm"
              />
              {tokenErrors.thresholdUsd && (
                <p className="text-xs text-red-500 font-funnel-sans">
                  {tokenErrors.thresholdUsd}
                </p>
              )}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-800 font-funnel-sans">
              <span className="font-bold">Push-based only.</span> The buyback
              wallet must receive fees directly. Claim-based patterns are not
              supported.
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

      {/* Global Provisioning State */}
      {isProvisioning && (
        <div className="flex flex-col items-center justify-center py-20 gap-6 animate-in fade-in duration-500">
          <Loader2 className="w-12 h-12 animate-spin text-black/40" />
          <p className="text-lg text-black/60 font-funnel-sans font-medium">
            {step === 'detecting'
              ? 'Detecting fee pattern…'
              : 'Setting up your Turnkey buyback wallet…'}
          </p>
        </div>
      )}

      {/* Global Ready State */}
      {step === 'ready' && result && (
        <div className="space-y-6 animate-in zoom-in-95 duration-500">
          <div className="bg-secondary-green/10 border border-secondary-green/30 rounded-xl p-5">
            <p className="text-base font-semibold text-secondary-green font-funnel-sans">
              Wallet provisioned successfully
            </p>
            <p className="text-sm text-black/70 font-funnel-sans mt-1">
              Your Turnkey sub-org is live. You are the root authenticator — you
              can revoke access at any time via email.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-black/70 font-funnel-sans uppercase tracking-wider">
              Buyback Wallet Address
            </Label>
            <div className="flex items-center gap-3 bg-black/5 rounded-xl px-4 py-3 border border-black/10">
              <span className="font-mono text-base text-black flex-1 break-all">
                {result.walletAddress}
              </span>
              <button
                onClick={() => handleCopy(result.walletAddress)}
                className="shrink-0 p-2 rounded-md hover:bg-black/10 transition-colors bg-white border border-black/5"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-secondary-green" />
                ) : (
                  <Copy className="w-5 h-5 text-black/60" />
                )}
              </button>
            </div>
          </div>

          <div className="bg-[#FFF8F3] border border-[#FFD8B8] rounded-xl p-5 space-y-3">
            <p className="text-base font-semibold text-[#CC5500] font-funnel-sans">
              Next step
            </p>
            <p className="text-sm text-black/80 font-funnel-sans">
              {result.instructions || result.instruction}
            </p>
            <p className="text-sm text-black/50 font-funnel-sans mt-2">
              {view === 'shared'
                ? 'Once added, the buyback service detects it automatically within 5 minutes and begins executing on every distribution.'
                : 'Once fees start arriving in the wallet (≥ $0.10), buyback activates automatically — no further action needed.'}
            </p>
          </div>

          {view === 'shared' && (
            <a
              href={`https://app.safe.global/transactions/queue?safe=base:${sharedForm.ownerAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-blue-600 font-funnel-sans hover:underline"
            >
              Open Safe App <ExternalLink className="w-4 h-4" />
            </a>
          )}

          <div className="pt-4">
            <Button
              onClick={resetToSelection}
              className="w-full rounded-full bg-black text-white py-6 text-lg font-funnel-sans hover:bg-black/80"
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
