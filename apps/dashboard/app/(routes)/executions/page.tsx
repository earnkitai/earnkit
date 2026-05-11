'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { ExternalLink, History, RefreshCw } from 'lucide-react';

const STORAGE_KEY = 'earnkit_shared_buyback_configs';

interface ConfigMeta {
  id: string;
  tokenSymbol: string;
  tokenDecimals: number;
}

interface Execution {
  id: string;
  configId: string;
  tokenSymbol: string;
  tokenDecimals: number;
  status: 'QUEUED' | 'WITHDRAWING' | 'SWAPPING' | 'BURNING' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  triggerBalanceUsd: number;
  feeCollectedUsd: number | null;
  swapHash: string | null;
  burnHash: string | null;
  tokensOutAmount: string | null;
  startedAt: string;
  completedAt: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
}

function formatTokenAmount(raw: string, decimals: number): string {
  try {
    const v = BigInt(raw);
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = v / divisor;
    const frac = v % divisor;
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return raw;
  }
}

const statusStyle = (status: string) => {
  switch (status) {
    case 'COMPLETED': return 'text-secondary-green border-secondary-green bg-secondary-green/10';
    case 'FAILED': return 'text-red-600 border-red-300 bg-red-50';
    case 'RETRYING': return 'text-amber-600 border-amber-300 bg-amber-50';
    default: return 'text-secondary-purple border-secondary-purple bg-secondary-purple/10';
  }
};

export default function ExecutionsPage() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const configIds: string[] = raw ? (JSON.parse(raw) as string[]) : [];

      if (configIds.length === 0) {
        setExecutions([]);
        return;
      }

      // Fetch config meta (symbol + decimals) for each id
      const metas = await Promise.all(
        configIds.map(async (id): Promise<ConfigMeta | null> => {
          try {
            const res = await fetch(`/api/shared-buyback/${id}`);
            if (!res.ok) return null;
            const d = await res.json();
            return { id, tokenSymbol: d.tokenSymbol, tokenDecimals: d.tokenDecimals };
          } catch { return null; }
        })
      );
      const validMetas = metas.filter(Boolean) as ConfigMeta[];

      // Fetch executions for each config
      const execGroups = await Promise.all(
        validMetas.map(async (meta) => {
          try {
            const res = await fetch(`/api/shared-buyback/${meta.id}/executions`);
            if (!res.ok) return [];
            const d = await res.json();
            return (d.executions ?? []).map((e: Omit<Execution, 'configId' | 'tokenSymbol' | 'tokenDecimals'>) => ({
              ...e,
              configId: meta.id,
              tokenSymbol: meta.tokenSymbol,
              tokenDecimals: meta.tokenDecimals,
            }));
          } catch { return []; }
        })
      );

      const all = (execGroups.flat() as Execution[]).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      setExecutions(all);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && authenticated) fetchAll();
  }, [ready, authenticated, fetchAll]);

  if (!ready || !authenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-black/40" />
          <h1 className="text-2xl font-semibold font-funnel-display text-black">Buyback History</h1>
        </div>
        <Button
          variant="outline"
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-2 border-black/20 text-black/60 rounded-full px-4 py-2 font-funnel-sans text-sm hover:bg-black/5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stat Cards */}
      {!loading && executions.length > 0 && (() => {
        const completed = executions.filter((e) => e.status === 'COMPLETED');
        const totalVolume = completed.reduce((sum, e) => sum + e.triggerBalanceUsd, 0);
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-black/[0.02] border border-black/[0.07] rounded-[20px] px-5 py-4">
              <p className="text-xs text-black/40 font-funnel-sans uppercase tracking-wide mb-1.5">Total Buybacks</p>
              <p className="text-2xl font-bold font-funnel-display text-black">{completed.length}</p>
            </div>
            <div className="bg-black/[0.02] border border-black/[0.07] rounded-[20px] px-5 py-4">
              <p className="text-xs text-black/40 font-funnel-sans uppercase tracking-wide mb-1.5">Total Volume</p>
              <p className="text-2xl font-bold font-funnel-display text-black">
                ${totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        );
      })()}

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-[14px] p-4 font-funnel-sans">
          <p className="text-sm text-red-700 font-semibold">Failed to load</p>
          <p className="text-xs text-red-600 font-mono mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && executions.length === 0 && (
        <div className="border border-dashed border-black/20 rounded-[20px] flex flex-col items-center justify-center py-24 gap-3">
          <History className="w-8 h-8 text-black/20" />
          <p className="text-black/40 font-funnel-sans font-medium">No buyback executions yet</p>
          <p className="text-xs text-black/30 font-funnel-sans">
            Executions appear here once your split distributes to the buyback wallet.
          </p>
        </div>
      )}

      {!loading && !error && executions.length > 0 && (
        <div className="border border-black/10 rounded-[20px] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[minmax(80px,1fr)_90px_90px_72px_72px_minmax(100px,1.5fr)_minmax(100px,1fr)] gap-2 px-5 py-3 bg-black/[0.02] border-b border-black/10">
            {['Token', 'Date', 'Status', 'Triggered', 'Fee', 'Burned', 'Txns'].map((h) => (
              <p key={h} className="text-[11px] font-semibold text-black/40 font-funnel-sans uppercase tracking-wide truncate">
                {h}
              </p>
            ))}
          </div>

          {/* Rows */}
          <div className="divide-y divide-black/[0.05]">
            {executions.map((exec) => {
              const tokensOut =
                exec.tokensOutAmount && exec.status === 'COMPLETED'
                  ? formatTokenAmount(exec.tokensOutAmount, exec.tokenDecimals)
                  : null;
              const date = new Date(exec.startedAt);

              return (
                <div key={exec.id}>
                  <div className="grid grid-cols-[minmax(80px,1fr)_90px_90px_72px_72px_minmax(100px,1.5fr)_minmax(100px,1fr)] gap-2 px-5 py-4 items-center hover:bg-black/[0.01] transition-colors">
                    {/* Token */}
                    <p className="text-sm font-semibold text-black font-funnel-sans truncate">{exec.tokenSymbol}</p>

                    {/* Date */}
                    <div className="min-w-0">
                      <p className="text-sm text-black/60 font-funnel-sans truncate">
                        {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-[11px] text-black/30 font-funnel-sans">
                        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>

                    {/* Status */}
                    <div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 font-funnel-sans w-fit ${statusStyle(exec.status)}`}
                      >
                        {exec.status}
                      </Badge>
                    </div>

                    {/* Triggered */}
                    <p className="text-sm font-semibold text-black font-funnel-sans">
                      ${exec.triggerBalanceUsd.toFixed(2)}
                    </p>

                    {/* Fee */}
                    {exec.feeCollectedUsd != null ? (
                      <p className="text-sm text-secondary-orange font-funnel-sans">
                        ${exec.feeCollectedUsd.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-sm text-black/20 font-funnel-sans">—</p>
                    )}

                    {/* Burned */}
                    <div className="min-w-0">
                      {tokensOut ? (
                        <p className="text-sm font-semibold text-secondary-green font-funnel-sans truncate">
                          {tokensOut} {exec.tokenSymbol}
                        </p>
                      ) : (
                        <p className="text-sm text-black/20 font-funnel-sans">—</p>
                      )}
                    </div>

                    {/* Txns */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {exec.swapHash && (
                        <a href={`https://basescan.org/tx/${exec.swapHash}`} target="_blank" rel="noopener noreferrer">
                          <Button
                            variant="outline"
                            className="flex items-center gap-1 px-2 py-0 h-6 border border-black/20 text-secondary-blue bg-transparent rounded-full text-[11px] font-funnel-sans hover:bg-gray-50 shrink-0"
                          >
                            Swap <ExternalLink className="w-2.5 h-2.5" />
                          </Button>
                        </a>
                      )}
                      {exec.burnHash && (
                        <a href={`https://basescan.org/tx/${exec.burnHash}`} target="_blank" rel="noopener noreferrer">
                          <Button
                            variant="outline"
                            className="flex items-center gap-1 px-2 py-0 h-6 border border-black/20 text-secondary-purple bg-transparent rounded-full text-[11px] font-funnel-sans hover:bg-gray-50 shrink-0"
                          >
                            Burn <ExternalLink className="w-2.5 h-2.5" />
                          </Button>
                        </a>
                      )}
                      {!exec.swapHash && !exec.burnHash && (
                        <p className="text-xs text-black/20 font-funnel-sans">—</p>
                      )}
                    </div>
                  </div>

                  {/* Inline error / retry info */}
                  {exec.lastError && exec.status === 'FAILED' && (
                    <div className="mx-5 mb-3 bg-red-50 border border-red-100 rounded-[8px] px-4 py-2">
                      <p className="text-xs text-red-600 font-mono break-all">{exec.lastError.slice(0, 200)}</p>
                    </div>
                  )}
                  {exec.status === 'RETRYING' && exec.nextAttemptAt && (
                    <div className="mx-5 mb-3">
                      <p className="text-xs text-amber-600 font-funnel-sans">
                        Next retry at {new Date(exec.nextAttemptAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
