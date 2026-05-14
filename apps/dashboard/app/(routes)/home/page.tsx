'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

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

interface Totals {
  totalEarnings: number;
  transactionLogEarnings: number;
  topUpEarnings: number;
}

export default function HomePage() {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [sharedBuybackCount, setSharedBuybackCount] = useState(0);
  const [totalBuybackedUsd, setTotalBuybackedUsd] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (ready && authenticated && privyUser) {
      const id = privyUser?.id.split(':').pop() || privyUser?.id;
      setUserId(id);
    } else if (ready && !authenticated) {
      router.push('/welcome-back');
    }
  }, [ready, authenticated, privyUser, router]);

  // Load shared buyback configs from localStorage and fetch their execution totals
  useEffect(() => {
    const loadBuybackData = async () => {
      try {
        const stored = localStorage.getItem('earnkit_shared_buyback_configs');
        const configIds: string[] = stored ? JSON.parse(stored) : [];
        setSharedBuybackCount(configIds.length);

        if (configIds.length === 0) {
          setTotalBuybackedUsd(0);
          return;
        }

        const execGroups = await Promise.all(
          configIds.map(async (id) => {
            try {
              const res = await fetch(`/api/shared-buyback/${id}/executions`);
              if (!res.ok) return [];
              const data = await res.json();
              return data.executions ?? [];
            } catch {
              return [];
            }
          }),
        );

        const allExecutions = execGroups.flat() as Array<{
          status: string;
          triggerBalanceUsd: number;
        }>;

        const total = allExecutions
          .filter((e) => e.status === 'COMPLETED')
          .reduce((sum, e) => sum + (e.triggerBalanceUsd ?? 0), 0);

        setTotalBuybackedUsd(total);
      } catch {
        setTotalBuybackedUsd(0);
      }
    };

    loadBuybackData();
  }, []);

  useEffect(() => {
    if (!userId) return;

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/agents/earnings?userId=${userId}`);
        if (res.ok) {
          const data = await res.json();
          setAgents(data.agents || []);
          setTotals(data.totals || null);
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
            href="/create-buyback"
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

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="border border-black/10 rounded-[20px] shadow-none">
      <CardContent className="p-5">
        <div className="w-9 h-9 bg-black/[0.04] rounded-xl flex items-center justify-center mb-4">
          {icon}
        </div>
        <p className="text-2xl font-semibold font-funnel-display text-black mb-0.5">
          {value}
        </p>
        <p className="text-xs text-black/40 font-funnel-sans">{label}</p>
        {sub && (
          <p className="text-xs text-black/30 font-funnel-sans mt-0.5">{sub}</p>
        )}
      </CardContent>
    </Card>
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
                Total Buyback
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
