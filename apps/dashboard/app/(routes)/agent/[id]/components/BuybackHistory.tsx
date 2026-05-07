"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";

interface BuybackExecution {
    id: string;
    status: "QUEUED" | "WITHDRAWING" | "SWAPPING" | "BURNING" | "COMPLETED" | "FAILED" | "RETRYING";
    triggerBalanceUsd: number;
    attempts: number;
    lastError: string | null;
    warehouseWithdrawHashes: string[];
    swapHash: string | null;
    burnHash: string | null;
    tokensOutAmount: string | null;
    startedAt: string;
    completedAt: string | null;
    nextAttemptAt: string | null;
}

interface BuybackConfig {
    tokenSymbol: string;
    tokenDecimals: number;
}

interface BuybackHistoryProps {
    agentDbId: string;
}

function formatRawTokenAmount(raw: string, decimals: number): string {
    try {
        const v = BigInt(raw);
        const divisor = BigInt(10) ** BigInt(decimals);
        const whole = v / divisor;
        const frac = v % divisor;
        const fracStr = frac.toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
        return fracStr ? `${whole}.${fracStr}` : whole.toString();
    } catch {
        return raw;
    }
}

export default function BuybackHistory({ agentDbId }: BuybackHistoryProps) {
    const [executions, setExecutions] = useState<BuybackExecution[]>([]);
    const [config, setConfig] = useState<BuybackConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notConfigured, setNotConfigured] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const configRes = await fetch(`/api/agents/${agentDbId}/buyback`);
            const configData = await configRes.json();
            const cfg = configData.buybackConfig ?? null;

            if (!cfg) {
                setNotConfigured(true);
                setLoading(false);
                return;
            }

            setConfig({ tokenSymbol: cfg.tokenSymbol, tokenDecimals: cfg.tokenDecimals });

            const execRes = await fetch(`/api/agents/${agentDbId}/buyback/executions`);
            if (!execRes.ok) {
                const text = await execRes.text();
                setError(`HTTP ${execRes.status}: ${text.slice(0, 200)}`);
                return;
            }
            const execData = await execRes.json();
            setExecutions(execData.executions ?? []);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load buyback history");
        } finally {
            setLoading(false);
        }
    }, [agentDbId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const getStatusStyle = (status: string) => {
        switch (status) {
            case "COMPLETED": return "text-secondary-green border-secondary-green bg-secondary-green/10";
            case "FAILED": return "text-red-600 border-red-300 bg-red-50";
            case "RETRYING": return "text-amber-600 border-amber-300 bg-amber-50";
            default: return "text-secondary-purple border-secondary-purple bg-secondary-purple/10";
        }
    };

    if (loading) {
        return (
            <div className="flex-1">
                <Card className="rounded-[20px] shadow-none border border-black/10">
                    <CardContent className="p-8">
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full mx-auto"></div>
                                <p className="mt-4 text-black/40 font-funnel-sans">Loading buyback history...</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex-1">
            <Card className="rounded-[20px] shadow-none border border-black/10">
                <CardContent className="p-8">
                    <div className="mb-8 flex items-start justify-between">
                        <div>
                            <h1 className="text-xl font-semibold font-funnel-display text-black mb-2">Buyback History</h1>
                            <p className="text-black/40 text-sm font-funnel-sans">
                                {notConfigured
                                    ? "Auto Buyback is not configured for this app."
                                    : `Auto swap & burn executions for ${config?.tokenSymbol ?? "token"}`}
                            </p>
                        </div>
                        {!notConfigured && (
                            <Button
                                type="button"
                                onClick={fetchData}
                                variant="outline"
                                className="flex items-center gap-2 border border-black/20 text-black/60 rounded-full px-4 py-2 font-funnel-sans text-sm hover:bg-black/5"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Refresh
                            </Button>
                        )}
                    </div>

                    {notConfigured ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center">
                                <p className="text-black/40 font-funnel-sans">Auto Buyback was not configured for this app.</p>
                                <p className="text-xs text-black/20 font-funnel-sans mt-2">
                                    Create a new app and select Auto Buyback &amp; Burn to enable this feature.
                                </p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="bg-red-50 border border-red-200 rounded-[12px] p-4 text-sm font-funnel-sans">
                            <p className="text-red-700 font-semibold">Couldn&apos;t load history</p>
                            <p className="text-red-600 font-mono break-all mt-1">{error}</p>
                        </div>
                    ) : executions.length === 0 ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center">
                                <p className="text-black/40 font-funnel-sans">No buyback runs yet</p>
                                <p className="text-xs text-black/20 font-funnel-sans mt-2">
                                    Each completed buyback and any failed attempt will appear here with on-chain tx hashes.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-0">
                            {/* Column headers */}
                            <div className="grid grid-cols-6 items-center pb-3 gap-4 border-b border-black/10">
                                <div className="text-xs font-semibold text-black/40 font-funnel-sans text-center">Status</div>
                                <div className="text-xs font-semibold text-black/40 font-funnel-sans text-center">Date</div>
                                <div className="text-xs font-semibold text-black/40 font-funnel-sans text-center">Triggered</div>
                                <div className="text-xs font-semibold text-black/40 font-funnel-sans text-center">Burned</div>
                                <div className="text-xs font-semibold text-black/40 font-funnel-sans text-center">Attempts</div>
                                <div className="text-xs font-semibold text-black/40 font-funnel-sans text-center">Txns</div>
                            </div>

                            {executions.map((exec, index) => {
                                const tokensOut =
                                    exec.tokensOutAmount && config?.tokenDecimals != null
                                        ? formatRawTokenAmount(exec.tokensOutAmount, config.tokenDecimals)
                                        : null;
                                const startDate = new Date(exec.startedAt);

                                return (
                                    <div key={exec.id}>
                                        <div className="grid grid-cols-6 items-center py-4 gap-4">
                                            {/* Status */}
                                            <div className="flex justify-center">
                                                <Badge
                                                    variant="outline"
                                                    className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 font-funnel-sans ${getStatusStyle(exec.status)}`}
                                                >
                                                    {exec.status}
                                                </Badge>
                                            </div>

                                            {/* Date */}
                                            <div className="flex flex-col items-center text-center">
                                                <p className="text-sm text-black/60 font-funnel-sans">
                                                    {startDate.toLocaleDateString()}
                                                </p>
                                                <p className="text-xs text-black/30 font-funnel-sans">
                                                    {startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                </p>
                                            </div>

                                            {/* Triggered balance */}
                                            <div className="flex justify-center">
                                                <p className="text-sm font-semibold text-black font-funnel-sans">
                                                    ${exec.triggerBalanceUsd.toFixed(2)}
                                                </p>
                                            </div>

                                            {/* Tokens burned */}
                                            <div className="flex justify-center">
                                                {tokensOut && exec.status === "COMPLETED" ? (
                                                    <p className="text-sm font-semibold text-secondary-green font-funnel-sans text-center">
                                                        {tokensOut} {config?.tokenSymbol}
                                                    </p>
                                                ) : (
                                                    <p className="text-sm text-black/20 font-funnel-sans">—</p>
                                                )}
                                            </div>

                                            {/* Attempts */}
                                            <div className="flex justify-center">
                                                <p className="text-sm text-black/60 font-funnel-sans">{exec.attempts}</p>
                                            </div>

                                            {/* Tx links */}
                                            <div className="flex justify-center gap-2 flex-wrap">
                                                {exec.swapHash && (
                                                    <a
                                                        href={`https://basescan.org/tx/${exec.swapHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="flex items-center gap-1 px-3 py-0 h-7 border border-black/20 text-secondary-blue bg-transparent rounded-full text-xs font-normal font-funnel-sans hover:bg-gray-50"
                                                        >
                                                            Swap
                                                            <ExternalLink className="w-3 h-3" />
                                                        </Button>
                                                    </a>
                                                )}
                                                {exec.burnHash && (
                                                    <a
                                                        href={`https://basescan.org/tx/${exec.burnHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="flex items-center gap-1 px-3 py-0 h-7 border border-black/20 text-secondary-purple bg-transparent rounded-full text-xs font-normal font-funnel-sans hover:bg-gray-50"
                                                        >
                                                            Burn
                                                            <ExternalLink className="w-3 h-3" />
                                                        </Button>
                                                    </a>
                                                )}
                                                {!exec.swapHash && !exec.burnHash && (
                                                    <p className="text-xs text-black/20 font-funnel-sans">—</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Inline error for failed executions */}
                                        {exec.lastError && exec.status === "FAILED" && (
                                            <div className="mb-3 bg-red-50 border border-red-100 rounded-[8px] px-4 py-2">
                                                <p className="text-xs text-red-600 font-mono break-all">
                                                    {exec.lastError.replace(/^swap_all_failed:\s*/, "").slice(0, 200)}
                                                </p>
                                            </div>
                                        )}

                                        {exec.status === "RETRYING" && exec.nextAttemptAt && (
                                            <div className="mb-3 px-4">
                                                <p className="text-xs text-amber-600 font-funnel-sans">
                                                    Next retry at {new Date(exec.nextAttemptAt).toLocaleString()}
                                                </p>
                                            </div>
                                        )}

                                        {index < executions.length - 1 && (
                                            <div className="border-b border-black/5"></div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
