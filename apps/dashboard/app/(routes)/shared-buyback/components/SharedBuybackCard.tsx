"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { toast } from "sonner";
import { Copy, Check, Clock, Zap, History, Trash2, ArrowRight, Pencil, X } from "lucide-react";

interface ConfigData {
    id: string;
    ownerAddress: string;
    splitAddress: string;
    walletAddress: string | null;
    tokenAddress: string;
    tokenSymbol: string;
    tokenDecimals: number;
    status: "PROVISIONING" | "PENDING_SPLIT_UPDATE" | "ACTIVE" | "PAUSED" | "BROKEN";
    isActive: boolean;
    feeRateBps: number;
    thresholdUsd: number;
    accumulatedUsd: number | null;
    assets: Array<{ symbol: string; amountHuman: string; usdValue: number; source: string }> | null;
    lastCheckedAt: string | null;
    lastTriggeredAt: string | null;
    inFlightExecution: { id: string; status: string } | null;
}

interface SharedBuybackCardProps {
    configId: string;
    onRemoved: (configId: string) => void;
}

function truncate(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const statusConfig = {
    PROVISIONING:       { label: "Provisioning",        dot: "bg-black/30" },
    PENDING_SPLIT_UPDATE: { label: "Awaiting Update",   dot: "bg-secondary-orange" },
    ACTIVE:             { label: "Active",               dot: "bg-secondary-green" },
    PAUSED:             { label: "Paused",               dot: "bg-black/30" },
    BROKEN:             { label: "Broken",               dot: "bg-red-500" },
};

export default function SharedBuybackCard({ configId, onRemoved }: SharedBuybackCardProps) {
    const [config, setConfig] = useState<ConfigData | null>(null);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [disabling, setDisabling] = useState(false);
    const [copiedWallet, setCopiedWallet] = useState(false);
    const [editingThreshold, setEditingThreshold] = useState(false);
    const [thresholdInput, setThresholdInput] = useState('');
    const [savingThreshold, setSavingThreshold] = useState(false);

    const fetchConfig = useCallback(async () => {
        try {
            const res = await fetch(`/api/shared-buyback/${configId}`);
            if (!res.ok) return;
            const data: ConfigData = await res.json();
            setConfig(data);
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }, [configId]);

    useEffect(() => {
        fetchConfig();
        const id = setInterval(fetchConfig, 30_000);
        return () => clearInterval(id);
    }, [fetchConfig]);

    const handleCheck = async () => {
        setChecking(true);
        try {
            const res = await fetch(`/api/shared-buyback/${configId}/check`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || "Check failed"); return; }
            if (data.queued) {
                toast.success(`Buyback queued — $${data.triggerBalanceUsd?.toFixed(2)} accumulated`);
            } else {
                const reason = data.reason === "below_threshold"
                    ? `Below threshold — $${data.accumulatedUsd?.toFixed(2) ?? "?"} of $${data.thresholdUsd ?? "?"}`
                    : data.reason === "execution_in_flight"
                        ? "Execution already running"
                        : data.reason ?? "Nothing to do";
                toast.info(reason);
            }
            await fetchConfig();
        } finally {
            setChecking(false);
        }
    };

    const handleDisable = async () => {
        if (!confirm("Disable this buyback? Accumulated funds stay in the wallet.")) return;
        setDisabling(true);
        try {
            const res = await fetch(`/api/shared-buyback/${configId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Buyback disabled");
                onRemoved(configId);
            } else {
                const d = await res.json();
                toast.error(d.error || "Failed to disable");
            }
        } finally {
            setDisabling(false);
        }
    };

    const handleCopyWallet = async () => {
        if (!config?.walletAddress) return;
        await navigator.clipboard.writeText(config.walletAddress);
        setCopiedWallet(true);
        setTimeout(() => setCopiedWallet(false), 2000);
    };

    const startEditThreshold = () => {
        setThresholdInput(config?.thresholdUsd.toString() ?? '');
        setEditingThreshold(true);
    };

    const handleSaveThreshold = async () => {
        const val = parseFloat(thresholdInput);
        if (isNaN(val) || val <= 0) { toast.error('Enter a valid threshold above 0'); return; }
        setSavingThreshold(true);
        try {
            const res = await fetch(`/api/shared-buyback/${configId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thresholdUsd: val }),
            });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || 'Update failed'); return; }
            toast.success('Threshold updated');
            setEditingThreshold(false);
            await fetchConfig();
        } finally {
            setSavingThreshold(false);
        }
    };

    if (loading) {
        return (
            <div className="rounded-[20px] border border-black/10 p-6 flex items-center justify-center h-40">
                <div className="animate-spin h-5 w-5 border-2 border-black/30 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!config) {
        return (
            <div className="rounded-[20px] border border-red-200 bg-red-50 p-5">
                <p className="text-sm text-red-500 font-funnel-sans">Failed to load config</p>
            </div>
        );
    }

    const sc = statusConfig[config.status] ?? statusConfig.PAUSED;
    const progress = config.accumulatedUsd != null && config.thresholdUsd > 0
        ? Math.min(config.accumulatedUsd / config.thresholdUsd, 1)
        : 0;
    const readyToFire = progress >= 1;
    const execStatus = config.inFlightExecution?.status;

    return (
        <>
            <div className="rounded-[20px] border border-black/10 bg-white overflow-hidden">
                {/* Header */}
                <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-lg font-semibold font-funnel-display text-black leading-tight">
                            {config.tokenSymbol}
                        </p>
                        <p className="text-xs text-black/30 font-mono mt-0.5">{truncate(config.tokenAddress)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${sc.dot}`} />
                        <span className="text-xs font-medium text-black/50 font-funnel-sans">{sc.label}</span>
                    </div>
                </div>

                {/* Address strip */}
                <div className="mx-5 mb-4 bg-black/[0.03] rounded-[12px] px-3 py-2.5 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-black/30 font-funnel-sans uppercase tracking-wide mb-0.5">Split</p>
                        <p className="font-mono text-xs text-black/60 truncate">{truncate(config.splitAddress)}</p>
                    </div>
                    {config.walletAddress && (
                        <>
                            <ArrowRight className="w-3.5 h-3.5 text-black/20 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] text-black/30 font-funnel-sans uppercase tracking-wide mb-0.5">Buyback Wallet</p>
                                <p className="font-mono text-xs text-black/60 truncate">{truncate(config.walletAddress)}</p>
                            </div>
                            <button
                                onClick={handleCopyWallet}
                                className="shrink-0 p-1.5 rounded-lg hover:bg-black/10 transition-colors"
                            >
                                {copiedWallet
                                    ? <Check className="w-3.5 h-3.5 text-secondary-green" />
                                    : <Copy className="w-3.5 h-3.5 text-black/30" />}
                            </button>
                        </>
                    )}
                </div>

                {/* Status banners */}
                {config.status === "PENDING_SPLIT_UPDATE" && config.walletAddress && (
                    <div className="mx-5 mb-4 bg-secondary-orange/8 border border-secondary-orange/20 rounded-[12px] px-3 py-2.5">
                        <p className="text-xs text-secondary-orange font-funnel-sans leading-relaxed">
                            Add <span className="font-mono font-semibold">{truncate(config.walletAddress)}</span> as a recipient in your split to activate buyback.
                        </p>
                    </div>
                )}

                {config.status === "BROKEN" && (
                    <div className="mx-5 mb-4 bg-red-50 border border-red-200 rounded-[12px] px-3 py-2.5">
                        <p className="text-xs text-red-600 font-funnel-sans">
                            Wallet is no longer a recipient in the split. Re-add it to resume.
                        </p>
                    </div>
                )}

                {/* Progress (ACTIVE) */}
                {config.status === "ACTIVE" && (
                    <div className="mx-5 mb-4 space-y-2">
                        <div className="flex items-baseline justify-between">
                            <span className="text-xs text-black/40 font-funnel-sans">Accumulated</span>
                            <span className="text-xs font-semibold text-black font-funnel-sans">
                                ${(config.accumulatedUsd ?? 0).toFixed(2)}
                                <span className="text-black/30 font-normal"> / ${config.thresholdUsd.toFixed(2)}</span>
                            </span>
                        </div>
                        <div className="h-1.5 w-full bg-black/8 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${readyToFire ? "bg-secondary-green" : "bg-secondary-blue"}`}
                                style={{ width: `${Math.round(progress * 100)}%` }}
                            />
                        </div>

                        {config.assets && config.assets.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                                {config.assets.map((a, i) => (
                                    <span key={i} className="text-[11px] text-black/40 font-funnel-sans font-mono">
                                        {a.amountHuman} {a.symbol}
                                        <span className="text-black/25"> (${a.usdValue.toFixed(2)})</span>
                                    </span>
                                ))}
                            </div>
                        )}

                        {execStatus && (
                            <p className={`text-xs font-funnel-sans ${execStatus === "FAILED" ? "text-red-500" : execStatus === "RETRYING" ? "text-amber-500" : "text-secondary-purple"}`}>
                                {execStatus === "FAILED" ? "Last execution failed — check history." :
                                    execStatus === "RETRYING" ? "Retrying…" :
                                        `Buyback in progress: ${execStatus.toLowerCase()}…`}
                            </p>
                        )}

                        {readyToFire && !execStatus && (
                            <p className="text-xs text-secondary-green font-funnel-sans">
                                Ready to fire — triggers on next distribution.
                            </p>
                        )}
                    </div>
                )}

                {/* Threshold row */}
                <div className="mx-5 mb-4">
                    {editingThreshold ? (
                        <div className="bg-black/[0.03] border border-black/10 rounded-[12px] px-3 py-3 space-y-2.5">
                            <p className="text-[10px] font-semibold text-black/40 font-funnel-sans uppercase tracking-wide">
                                Trigger threshold (USD)
                            </p>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5 flex-1 bg-white border border-black/15 rounded-[8px] px-2.5 py-1.5 focus-within:border-black/30 transition-colors">
                                    <span className="text-sm text-black/40 font-funnel-sans">$</span>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={thresholdInput}
                                        onChange={(e) => setThresholdInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveThreshold(); if (e.key === 'Escape') setEditingThreshold(false); }}
                                        autoFocus
                                        className="flex-1 text-sm font-funnel-sans text-black bg-transparent outline-none min-w-0"
                                    />
                                </div>
                                <button
                                    onClick={handleSaveThreshold}
                                    disabled={savingThreshold}
                                    className="shrink-0 bg-black text-white text-xs font-funnel-sans font-medium px-3 py-1.5 rounded-[8px] hover:bg-black/80 transition-colors disabled:opacity-50"
                                >
                                    {savingThreshold ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                    onClick={() => setEditingThreshold(false)}
                                    className="shrink-0 text-black/40 hover:text-black transition-colors p-1.5"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between bg-black/[0.02] border border-black/[0.06] rounded-[12px] px-3 py-2.5">
                            <div>
                                <p className="text-[10px] text-black/30 font-funnel-sans uppercase tracking-wide mb-0.5">Trigger threshold</p>
                                <p className="text-sm font-semibold text-black font-funnel-sans">${config.thresholdUsd.toFixed(2)}</p>
                            </div>
                            <button
                                onClick={startEditThreshold}
                                className="flex items-center gap-1.5 text-xs text-black/40 font-funnel-sans hover:text-black transition-colors px-2.5 py-1.5 rounded-[8px] hover:bg-black/5"
                            >
                                <Pencil className="w-3 h-3" />
                                Edit
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-[11px] text-black/30 font-funnel-sans">
                        {config.lastTriggeredAt && (
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Last run {new Date(config.lastTriggeredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5">
                        {config.status === "ACTIVE" && (
                            <Button
                                onClick={handleCheck}
                                disabled={checking}
                                className="flex items-center gap-1 bg-black hover:bg-black/80 text-white rounded-full px-3 py-1.5 text-xs font-funnel-sans h-auto"
                            >
                                <Zap className="w-3 h-3" />
                                {checking ? "Checking…" : "Check"}
                            </Button>
                        )}
                        <Link
                            href="/executions"
                            className="flex items-center gap-1 border border-black/15 text-black/50 rounded-full px-3 py-1.5 text-xs font-funnel-sans hover:bg-black/5 transition-colors"
                        >
                            <History className="w-3 h-3" />
                            History
                        </Link>
                        {config.isActive && (
                            <Button
                                onClick={handleDisable}
                                disabled={disabling}
                                variant="outline"
                                className="flex items-center gap-1 border-red-100 text-red-400 rounded-full px-3 py-1.5 text-xs font-funnel-sans h-auto hover:bg-red-50"
                            >
                                <Trash2 className="w-3 h-3" />
                                {disabling ? "…" : "Disable"}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

        </>
    );
}
