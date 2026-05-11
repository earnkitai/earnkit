'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/components/ui/button';
import { Plus, Coins } from 'lucide-react';
import RegisterModal from './components/RegisterModal';
import TokenBuybackCard from './components/TokenBuybackCard';

const STORAGE_KEY = 'earnkit_token_buyback_configs';

function loadStoredConfigIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function saveConfigId(configId: string) {
  try {
    const existing = loadStoredConfigIds();
    if (!existing.includes(configId)) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...existing, configId]),
      );
    }
  } catch {
    /* non-fatal */
  }
}

function removeConfigId(configId: string) {
  try {
    const existing = loadStoredConfigIds();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(existing.filter((id) => id !== configId)),
    );
  } catch {
    /* non-fatal */
  }
}

export default function TokenBuybackPage() {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const router = useRouter();

  const [configIds, setConfigIds] = useState<string[]>([]);
  const [showRegister, setShowRegister] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  useEffect(() => {
    setConfigIds(loadStoredConfigIds());
    setHydrated(true);
  }, []);

  const handleRegistered = useCallback(
    (configId: string) => {
      saveConfigId(configId);
      setConfigIds((prev) =>
        prev.includes(configId) ? prev : [...prev, configId],
      );
    },
    [],
  );

  const handleRemoved = useCallback((configId: string) => {
    removeConfigId(configId);
    setConfigIds((prev) => prev.filter((id) => id !== configId));
  }, []);

  const userEmail = privyUser?.email?.address ?? '';

  if (!ready || !authenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-secondary-blue" />
            <h1 className="text-2xl font-semibold font-funnel-display text-black">
              Token Buyback
            </h1>
          </div>
          <p className="text-black/40 text-sm font-funnel-sans max-w-lg">
            Connect any existing token contract (Clanker, Doppler, or custom) to
            automated buyback &amp; burn — without giving up custody. Provision
            a buyback wallet, set it as the fee recipient on your contract, and
            revenue automatically flows into token burns. A{' '}
            <span className="text-black/60 font-medium">5% platform fee</span>{' '}
            is deducted per execution.
          </p>
        </div>
        <Button
          onClick={() => setShowRegister(true)}
          className="flex items-center gap-2 bg-black text-white rounded-full px-5 py-2.5 font-funnel-sans text-sm hover:bg-black/80 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Contract
        </Button>
      </div>

      {/* Content */}
      {!hydrated ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
        </div>
      ) : configIds.length === 0 ? (
        <div className="border border-dashed border-black/20 rounded-[20px] flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 rounded-full bg-black/4 flex items-center justify-center">
            <Coins className="w-6 h-6 text-black/30" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-black/60 font-funnel-sans font-medium">
              No token buybacks yet
            </p>
            <p className="text-black/30 text-sm font-funnel-sans">
              Click &quot;Add Contract&quot; to connect your first token
              contract.
            </p>
          </div>
          <Button
            onClick={() => setShowRegister(true)}
            variant="outline"
            className="flex items-center gap-2 border-black/20 text-black/60 rounded-full px-5 font-funnel-sans hover:bg-black/5"
          >
            <Plus className="w-4 h-4" />
            Add Contract
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {configIds.map((id) => (
            <TokenBuybackCard
              key={id}
              configId={id}
              onRemoved={handleRemoved}
            />
          ))}
        </div>
      )}

      {/* How it works — shown when configs exist */}
      {configIds.length > 0 && (
        <div className="border-t border-black/10 pt-6">
          <h2 className="text-sm font-semibold font-funnel-sans text-black/60 mb-3">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                n: '1',
                title: 'Register your contract',
                body: 'Provide your token contract address. We detect the fee recipient pattern and provision a Turnkey-managed wallet — you keep full custody.',
              },
              {
                n: '2',
                title: 'Set fee recipient',
                body: 'Call the fee recipient setter on your contract (e.g. setFeeRecipient) with the provisioned wallet address. Fees now flow directly to it.',
              },
              {
                n: '3',
                title: 'Automatic buyback & burn',
                body: 'Once the wallet accumulates enough (your threshold), it swaps all fees to your target token and burns them — minus the 5% platform fee.',
              },
            ].map((step) => (
              <div
                key={step.n}
                className="bg-black/4 rounded-[14px] p-4 border border-black/10 space-y-1"
              >
                <p className="text-xs text-black/30 font-funnel-sans uppercase tracking-wide">
                  Step {step.n}
                </p>
                <p className="text-sm font-semibold text-black font-funnel-sans">
                  {step.title}
                </p>
                <p className="text-xs text-black/50 font-funnel-sans">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <RegisterModal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        onRegistered={handleRegistered}
        defaultEmail={userEmail}
      />
    </div>
  );
}
