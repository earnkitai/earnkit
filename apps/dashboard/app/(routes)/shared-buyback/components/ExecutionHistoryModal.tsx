"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { ExternalLink, RefreshCw } from "lucide-react";

interface SharedExecution {
    id: string;
    status: "QUEUED" | "WITHDRAWING" | "SWAPPING" | "BURNING" | "COMPLETED" | "FAILED" | "RETRYING";
    triggerBalanceUsd: number;
    attempts: number;
    lastError: string | null;
    feeCollectedUsd: number | null;
    feeTransferHashes: string[];
    swapHash: string | null;
    burnHash: string | null;
    tokensOutAmount: string | null;
    startedAt: string;
    completedAt: string | null;
    nextAttemptAt: string | null;
}

interface ExecutionHistoryModalProps {
    configId: string;
    tokenSymbol: string;
    tokenDecimals: number;
    open: boolean;
    onClose: () => void;
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

const statusStyle = (status: string) => {
    switch (status) {
        case "COMPLETED": return "text-secondary-green border-secondary-green bg-secondary-green/10";
        case "FAILED": return "text-red-600 border-red-300 bg-red-50";
        case "RETRYING": return "text-amber-600 border-amber-300 bg-amber-50";
        default: return "text-secondary-purple border-secondary-purple bg-secondary-purple/10";
    }
};

export default function ExecutionHistoryModal({ configId, tokenSymbol, tokenDecimals, open, onClose }: ExecutionHistoryModalProps) {
    const [executions, setExecutions] = useState<SharedExecution[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchExecutions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/shared-buyback/${configId}/executions`);
            if (!res.ok) { setError(`HTTP ${res.status}`); return; }
            const data = await res.json();
            setExecutions(data.executions ?? []);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load");
        } finally {
            setLoading(false);
        }
    }, [configId]);

    useEffect(() => {
        if (open) fetchExecutions();
    }, [open, fetchExecutions]);

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="sm:max-w-3xl rounded-[20px] flex flex-col max-h-[85vh]">
                <DialogHeader className="shrink-0 flex flex-row items-center justify-between">
                    <div>
                        <DialogTitle className="font-funnel-display text-xl">Execution History</DialogTitle>
                        <p className="text-sm text-black/40 font-funnel-sans mt-1">
                            Buyback runs for {tokenSymbol}
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={fetchExecutions}
                        className="flex items-center gap-2 border border-black/20 text-black/60 rounded-full px-4 py-2 font-funnel-sans text-sm hover:bg-black/5 shrink-0"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                    </Button>
                </DialogHeader>

                <div className="overflow-y-auto flex-1 min-h-0">
                    {loading && (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center">
                                <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full mx-auto" />
                                <p className="mt-4 text-black/40 font-funnel-sans text-sm">Loading history…</p>
                            </div>
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-red-50 border border-red-200 rounded-[12px] p-4 text-sm font-funnel-sans">
                            <p className="text-red-700 font-semibold">Failed to load</p>
                            <p className="text-red-600 font-mono break-all mt-1">{error}</p>
                        </div>
                    )}

                    {!loading && !error && executions.length === 0 && (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center">
                                <p className="text-black/40 font-funnel-sans">No buyback runs yet</p>
                                <p className="text-xs text-black/20 font-funnel-sans mt-2">
                                    Executions appear here once your split distributes to the buyback wallet.
                                </p>
                            </div>
                        </div>
                    )}

                    {!loading && !error && executions.length > 0 && (
                        <div className="space-y-0">
                            <div className="grid grid-cols-6 items-center pb-3 gap-4 border-b border-black/10">
                                {["Status", "Date", "Triggered", "Fee", "Burned", "Txns"].map((h) => (
                                    <div key={h} className="text-xs font-semibold text-black/40 font-funnel-sans text-center">{h}</div>
                                ))}
                            </div>

                            {executions.map((exec, idx) => {
                                const tokensOut = exec.tokensOutAmount
                                    ? formatRawTokenAmount(exec.tokensOutAmount, tokenDecimals)
                                    : null;
                                const startDate = new Date(exec.startedAt);

                                return (
                                    <div key={exec.id}>
                                        <div className="grid grid-cols-6 items-center py-4 gap-4">
                                            <div className="flex justify-center">
                                                <Badge variant="outline" className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 font-funnel-sans ${statusStyle(exec.status)}`}>
                                                    {exec.status}
                                                </Badge>
                                            </div>
                                            <div className="flex flex-col items-center text-center">
                                                <p className="text-sm text-black/60 font-funnel-sans">{startDate.toLocaleDateString()}</p>
                                                <p className="text-xs text-black/30 font-funnel-sans">{startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                                            </div>
                                            <div className="flex justify-center">
                                                <p className="text-sm font-semibold text-black font-funnel-sans">${exec.triggerBalanceUsd.toFixed(2)}</p>
                                            </div>
                                            <div className="flex justify-center">
                                                {exec.feeCollectedUsd != null ? (
                                                    <p className="text-sm text-secondary-orange font-funnel-sans">${exec.feeCollectedUsd.toFixed(2)}</p>
                                                ) : (
                                                    <p className="text-sm text-black/20 font-funnel-sans">—</p>
                                                )}
                                            </div>
                                            <div className="flex justify-center">
                                                {tokensOut && exec.status === "COMPLETED" ? (
                                                    <p className="text-sm font-semibold text-secondary-green font-funnel-sans text-center">{tokensOut} {tokenSymbol}</p>
                                                ) : (
                                                    <p className="text-sm text-black/20 font-funnel-sans">—</p>
                                                )}
                                            </div>
                                            <div className="flex justify-center gap-2 flex-wrap">
                                                {exec.swapHash && (
                                                    <a href={`https://basescan.org/tx/${exec.swapHash}`} target="_blank" rel="noopener noreferrer">
                                                        <Button variant="outline" className="flex items-center gap-1 px-3 py-0 h-7 border border-black/20 text-secondary-blue bg-transparent rounded-full text-xs font-funnel-sans hover:bg-gray-50">
                                                            Swap <ExternalLink className="w-3 h-3" />
                                                        </Button>
                                                    </a>
                                                )}
                                                {exec.burnHash && (
                                                    <a href={`https://basescan.org/tx/${exec.burnHash}`} target="_blank" rel="noopener noreferrer">
                                                        <Button variant="outline" className="flex items-center gap-1 px-3 py-0 h-7 border border-black/20 text-secondary-purple bg-transparent rounded-full text-xs font-funnel-sans hover:bg-gray-50">
                                                            Burn <ExternalLink className="w-3 h-3" />
                                                        </Button>
                                                    </a>
                                                )}
                                                {!exec.swapHash && !exec.burnHash && <p className="text-xs text-black/20 font-funnel-sans">—</p>}
                                            </div>
                                        </div>

                                        {exec.lastError && exec.status === "FAILED" && (
                                            <div className="mb-3 bg-red-50 border border-red-100 rounded-[8px] px-4 py-2">
                                                <p className="text-xs text-red-600 font-mono break-all">{exec.lastError.slice(0, 200)}</p>
                                            </div>
                                        )}
                                        {exec.status === "RETRYING" && exec.nextAttemptAt && (
                                            <div className="mb-3 px-4">
                                                <p className="text-xs text-amber-600 font-funnel-sans">Next retry at {new Date(exec.nextAttemptAt).toLocaleString()}</p>
                                            </div>
                                        )}
                                        {idx < executions.length - 1 && <div className="border-b border-black/5" />}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
