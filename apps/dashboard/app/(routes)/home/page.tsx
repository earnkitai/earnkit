'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { Plus, Flame } from 'lucide-react';

function AddAppCard() {
  return (
    <Link href="/create">
      <Card className="bg-white border-2 border-dashed rounded-[28px] cursor-pointer h-full hover:border-gray-400 transition-all group">
        <CardContent className="p-8 flex flex-col items-center justify-center h-full">
          {/* Blue Icon Square */}
          <div className="w-16 h-16 bg-blue-600 rounded-[20px] flex items-center justify-center mb-4  ">
            <Plus className="w-8 h-8 text-white" strokeWidth={3} />
          </div>

          {/* Label */}
          <p className="font-semibold text-black/60 font-funnel-sans text-base">
            Add App
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

interface Agent {
  id: string;
  name: string;
  agentId: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED';
  feeModel: 'FREE_TIER' | 'CREDIT_BASED';
  totalEarnings: number;
  transactionLogEarnings: number;
  topUpEarnings: number;
  createdAt: string;
}

interface BuybackConfig {
  id: string;
  tokenSymbol: string;
  status: string;
  splitAddress: string | null;
  walletAddress: string | null;
  totalBoughtBackUsd: number;
}

export default function HomePage() {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  // Buyback configs hydrated from localStorage IDs → backend details. Lives
  // alongside the legacy `agents` list in the same grid; doesn't block the
  // initial render (the page is still gated on the agents fetch only).
  const [buybacks, setBuybacks] = useState<BuybackConfig[]>([]);

  useEffect(() => {
    if (ready && authenticated && privyUser) {
      const id = privyUser?.id.split(':').pop() || privyUser?.id;
      setUserId(id);
    } else if (ready && !authenticated) {
      router.push('/welcome-back');
    }
  }, [ready, authenticated, privyUser, router]);

  // Hydrate full buyback configs for the grid.
  //
  // We read TWO localStorage keys for backwards compatibility:
  //   - `earnkit_shared_buyback_configs` — both the Splits-card flow and the
  //     unified Token-card flow write here (post-unification).
  //   - `earnkit_token_buyback_configs` — legacy key from pre-unification
  //     Token-card runs. Most of those IDs reference dropped DB rows now and
  //     will 404; we tolerate that silently.
  // Configs are deduped by ID. Failed fetches drop out so dead references
  // don't render empty cards.
  useEffect(() => {
    const loadBuybackCards = async () => {
      try {
        const readKey = (k: string): string[] => {
          try {
            const raw = localStorage.getItem(k);
            return raw ? (JSON.parse(raw) as string[]) : [];
          } catch {
            return [];
          }
        };
        const shared = readKey('earnkit_shared_buyback_configs');
        const legacyToken = readKey('earnkit_token_buyback_configs');
        const configIds = Array.from(new Set([...shared, ...legacyToken]));
        if (configIds.length === 0) {
          setBuybacks([]);
          return;
        }

        const cards = await Promise.all(
          configIds.map(async (id): Promise<BuybackConfig | null> => {
            try {
              const [cfgRes, execRes] = await Promise.all([
                fetch(`/api/shared-buyback/${id}`),
                fetch(`/api/shared-buyback/${id}/executions`),
              ]);
              if (!cfgRes.ok) return null;
              const cfg = await cfgRes.json();
              const execData = execRes.ok
                ? await execRes.json()
                : { executions: [] };
              const total = (
                (execData.executions ?? []) as Array<{
                  status: string;
                  triggerBalanceUsd: number;
                }>
              )
                .filter((e) => e.status === 'COMPLETED')
                .reduce((sum, e) => sum + (e.triggerBalanceUsd ?? 0), 0);

              return {
                id: cfg.id,
                tokenSymbol: cfg.tokenSymbol ?? '—',
                status: cfg.status,
                splitAddress: cfg.splitAddress,
                walletAddress: cfg.walletAddress,
                totalBoughtBackUsd: total,
              };
            } catch {
              return null;
            }
          }),
        );
        setBuybacks(cards.filter((c): c is BuybackConfig => c !== null));
      } catch {
        setBuybacks([]);
      }
    };

    loadBuybackCards();
  }, []);

  useEffect(() => {
    if (!userId) return;

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/agents/earnings?userId=${userId}`);
        if (res.ok) {
          const data = await res.json();
          setAgents(data.agents || []);
        }
      } catch (error) {
        console.error('Error fetching agents:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId]);

  if (!ready || !authenticated || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full mx-auto" />
          <p className="mt-4 text-black/40 font-funnel-sans">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-7xl mx-auto p-[24px] md:p-[35px] pt-20 md:pt-10">
      {/* Header */}
      {/* <div className="mb-8">
        <h1 className="text-3xl font-semibold font-funnel-display text-color2">
          Overview
        </h1>
        <p className="text-black/40 text-sm font-funnel-sans mt-1">
          Your EarnKit dashboard at a glance
        </p>
      </div> */}

      {/* Stats row */}
      {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <StatCard
          icon={<DollarSign className="w-4 h-4 text-black/40" />}
          label="Total Earnings"
          value={`$${(totals?.totalEarnings ?? 0).toFixed(2)}`}
          sub={
            (totals?.topUpEarnings ?? 0) > 0
              ? `$${(totals?.topUpEarnings ?? 0).toFixed(2)} from top-ups`
              : undefined
          }
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4 text-black/40" />}
          label="Total Bought Back"
          value={
            totalBuybackedUsd === null
              ? '—'
              : `$${totalBuybackedUsd.toFixed(2)}`
          }
          sub="across completed executions"
        />
        <StatCard
          icon={<Flame className="w-4 h-4 text-black/40" />}
          label="Buyback Configs"
          value={`${sharedBuybackCount}`}
          sub={sharedBuybackCount === 0 ? 'None configured' : `${sharedBuybackCount} split${sharedBuybackCount !== 1 ? 's' : ''} active`}
        />
      </div> */}

      {/* My Tokens — only shown if legacy tokens exist */}
      {/* {agents.length > 0 && ( */}
      <div className="mb-10">
        <div className="mb-8">
          <h2 className="text-2xl md:text-3xl font-semibold font-funnel-display text-color2">
            My Tokens
          </h2>
          <p className="text-black/40 text-sm md:text-base font-funnel-sans">
            Setup and manage your token buybacks
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <AddAppCard />
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
          {buybacks.map((b) => (
            <BuybackCard key={b.id} buyback={b} />
          ))}
        </div>
      </div>
      {/* )} */}

      {/* Buybacks section */}
      {/* <div className="mb-10">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold font-funnel-display text-color2">
              Buybacks
            </h2>
            <p className="text-black/40 text-sm font-funnel-sans">
              Automatic buyback & burn configurations
            </p>
          </div>
          <Link
            href="/create"
            className="flex items-center gap-2 border border-black/15 text-black/60 hover:text-black rounded-full px-4 py-2 text-sm font-funnel-sans transition-colors"
          >
            New Buyback
          </Link>
        </div>

        <Link href="/shared-buyback" className="block max-w-sm">
          <Card className="border border-black/10 rounded-[20px] shadow-none hover:shadow-[inset_0_0_0_2px_#00000020] transition-shadow cursor-pointer">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary-orange/10 rounded-xl flex items-center justify-center">
                  <Flame className="w-4 h-4 text-secondary-orange" />
                </div>
                <div>
                  <p className="font-semibold text-black font-funnel-sans text-sm">
                    Splits Buyback
                  </p>
                  <p className="text-black/40 text-xs font-funnel-sans">
                    {sharedBuybackCount > 0
                      ? `${sharedBuybackCount} configured`
                      : 'None configured'}
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-black/30 shrink-0" />
            </CardContent>
          </Card>
        </Link>
      </div> */}
      {/* FAQ section */}
      {/* <div className="mb-10">
        <div className="mb-8">
          <h2 className="text-xl font-semibold font-funnel-display text-color2">
            FAQs
          </h2>
          <p className="text-black/40 text-sm font-funnel-sans mt-1">
            Everything you need to know about Splits Buyback
          </p>
        </div>

        <div className="space-y-8">
          <div>
            <h3 className="font-semibold text-black font-funnel-sans text-base mb-2">
              How does the Splits Buyback work?
            </h3>
            <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
              You register your existing 0xSplits contract and EarnKit
              provisions a Turnkey-managed buyback wallet on your behalf. You
              then add that wallet as a recipient in your split. Every time your
              split distributes, ETH accumulates in the buyback wallet. Once the
              balance crosses your configured threshold, EarnKit automatically
              swaps it for your token and burns it — no manual intervention
              needed.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-black font-funnel-sans text-base mb-2">
              How do I activate the buyback after registering?
            </h3>
            <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
              After registration, your config will show a status of{' '}
              <span className="font-medium text-black/70">Awaiting Update</span>
              . Copy the Turnkey wallet address from your buyback card and add
              it as a recipient in your 0xSplits contract via your Safe or a
              direct{' '}
              <span className="font-mono text-xs bg-black/5 px-1 py-0.5 rounded">
                updateSplit
              </span>{' '}
              call. Once added, click{' '}
              <span className="font-medium text-black/70">Check now</span> on
              the card — EarnKit will verify the wallet is in the split and flip
              the status to Active.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-black font-funnel-sans text-base mb-2">
              What is the trigger threshold and how do I set it?
            </h3>
            <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
              The trigger threshold is the minimum USD value that must
              accumulate in the buyback wallet before a swap is executed. You
              can set and edit it directly on the buyback card. A higher
              threshold means fewer, larger buybacks; a lower threshold means
              more frequent, smaller ones. We recommend setting it above gas
              costs on your target chain to ensure each execution is
              economically worthwhile.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-black font-funnel-sans text-base mb-2">
              Who controls the buyback wallet — can I withdraw from it?
            </h3>
            <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
              The buyback wallet is a Turnkey-managed smart wallet provisioned
              specifically for your config. EarnKit orchestrates transactions
              through it but you retain custody via a recovery address set at
              registration. Funds in the wallet are solely used for the buyback
              swap and burn — they are not accessible to EarnKit for any other
              purpose.
            </p>
          </div>
        </div>
      </div> */}
    </div>
  );
}

function BuybackCard({ buyback }: { buyback: BuybackConfig }) {
  const isActive = buyback.status === 'ACTIVE';
  // Map backend SharedSplitStatus to display label + tone. Statuses other
  // than ACTIVE are intentionally muted so the user's eye lands on the
  // active configs first.
  const statusMeta: Record<string, { label: string; tone: 'green' | 'amber' | 'gray' | 'red' }> = {
    ACTIVE: { label: 'Active', tone: 'green' },
    PENDING_SPLIT_UPDATE: { label: 'Pending', tone: 'amber' },
    PROVISIONING: { label: 'Provisioning', tone: 'gray' },
    PAUSED: { label: 'Paused', tone: 'gray' },
    BROKEN: { label: 'Broken', tone: 'red' },
  };
  const meta = statusMeta[buyback.status] ?? { label: buyback.status, tone: 'gray' as const };
  const toneClass =
    meta.tone === 'green'
      ? 'bg-green-50 text-secondary-green border-secondary-green/30'
      : meta.tone === 'amber'
        ? 'bg-amber-50 text-amber-700 border-amber-300'
        : meta.tone === 'red'
          ? 'bg-red-50 text-red-700 border-red-300'
          : 'bg-black/[0.04] text-black/30 border-black/20';
  const dotClass =
    meta.tone === 'green'
      ? 'bg-secondary-green'
      : meta.tone === 'amber'
        ? 'bg-amber-500'
        : meta.tone === 'red'
          ? 'bg-red-500'
          : 'bg-black/30';

  return (
    <Link href={`/shared-buyback/${buyback.id}`}>
      <Card className="bg-white rounded-[28px] cursor-pointer h-full">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-20">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-secondary-orange/10 flex items-center justify-center shrink-0">
                <Flame className="w-3.5 h-3.5 text-secondary-orange" />
              </div>
              <h3 className="font-semibold text-black/80 font-funnel-sans text-base leading-snug truncate">
                {buyback.tokenSymbol}
              </h3>
            </div>
            <Badge
              className={`ml-2 shrink-0 ${toneClass} font-funnel-sans text-[11px] font-medium py-0.5 px-3`}
            >
              <div className={`w-1.5 h-1.5 rounded-full mr-1 ${dotClass}`} />
              {meta.label}
            </Badge>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <p
                className={`text-xl font-semibold font-funnel-sans ${isActive ? 'text-secondary-green' : 'text-black/40'}`}
              >
                ${buyback.totalBoughtBackUsd.toFixed(2)}
              </p>
              <p className="text-black/40 text-xs font-funnel-sans">
                Total Bought Back
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-black/60 font-funnel-sans">
                Splits Buyback
              </p>
              <p className="text-black/30 text-xs font-funnel-sans">Type</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const isActive = agent.status === 'ACTIVE';

  return (
    <Link href={`/agent/${agent.id}`}>
      <Card className="bg-white rounded-[28px] cursor-pointer h-full">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-20">
            <h3 className="font-semibold text-black/80 font-funnel-sans text-base leading-snug">
              {agent.name}
            </h3>
            <Badge
              className={`ml-2 shrink-0 ${
                isActive
                  ? 'bg-green-50 text-secondary-green border-secondary-green/30'
                  : 'bg-black/[0.04] text-black/30 border-black/20'
              } font-funnel-sans text-[11px] font-medium py-0.5 px-3`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full mr-1 ${isActive ? 'bg-secondary-green' : 'bg-black/30'}`}
              />
              {isActive ? 'Active' : 'Paused'}
            </Badge>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <p
                className={`text-xl font-semibold font-funnel-sans ${isActive ? 'text-secondary-green' : 'text-black/40'}`}
              >
                ${agent.totalEarnings.toFixed(2)}
              </p>
              <p className="text-black/40 text-xs font-funnel-sans">
                Total Earnings
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-black/60 font-funnel-sans">
                {agent.feeModel === 'FREE_TIER' ? 'Free Tier' : 'Credit Based'}
              </p>
              <p className="text-black/30 text-xs font-funnel-sans">
                Fee Model
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
