"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { toast } from "sonner";
import { Copy, Check, Clock, Zap, History, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { useSendTransaction } from "wagmi";
import { encodeFunctionData, parseAbi } from "viem";
import ExecutionHistoryModal from "./ExecutionHistoryModal";

interface ConfigData {
    id: string;
    tokenContractAddress: string;
    targetTokenAddress: string;
    targetTokenSymbol: string;
    targetTokenDecimals: number;
    ownerAddress: string;
    onChainOwnerAddress: string | null;
    ownerIsContract: boolean;
    walletAddress: string | null;
    feeGetterName: string | null;
    setterName: string | null;
    status: "PROVISIONING" | "PENDING_FEE_RECIPIENT_UPDATE" | "ACTIVE" | "PAUSED" | "BROKEN";
    isActive: boolean;
    feeRateBps: number;
    thresholdUsd: number;
    accumulatedUsd: number | null;
    assets: Array<{ symbol: string; amountHuman: string; usdValue: number }> | null;
    lastCheckedAt: string | null;
    lastTriggeredAt: string | null;
    inFlightExecution: { id: string; status: string } | null;
}

interface TokenBuybackCardProps {
    configId: string;
    onRemoved: (configId: string) => void;
}

function truncate(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const statusConfig = {
    PROVISIONING:                { label: "Provisioning",                  class: "text-black/40 border-black/30 bg-black/4" },
    PENDING_FEE_RECIPIENT_UPDATE:{ label: "Awaiting Fee Recipient Update",  class: "text-secondary-orange border-secondary-orange bg-secondary-orange/10" },
    ACTIVE:                      { label: "Active",                        class: "text-secondary-green border-secondary-green bg-secondary-green/10" },
    PAUSED:                      { label: "Paused",                        class: "text-black/40 border-black/30 bg-black/4" },
    BROKEN:                      { label: "Broken",                        class: "text-red-600 border-red-300 bg-red-50" },
};

export default function TokenBuybackCard({ configId, onRemoved }: TokenBuybackCardProps) {
    const [config, setConfig]               = useState<ConfigData | null>(null);
    const [loading, setLoading]             = useState(true);
    const [checking, setChecking]           = useState(false);
    const [disabling, setDisabling]         = useState(false);
    const [copiedWallet, setCopiedWallet]   = useState(false);
    const [showHistory, setShowHistory]     = useState(false);
    const [txSubmitted, setTxSubmitted]     = useState(false);

    const { sendTransaction, isPending: isSigning } = useSendTransaction();

    const fetchConfig = useCallback(async () => {
        try {
            const res  = await fetch(`/api/token-buyback/${configId}`);
            if (!res.ok) return;
            const data: ConfigData = await res.json();
            setConfig(data);
        } catch { /* silent */ }
        finally { setLoading(false); }
    }, [configId]);

    useEffect(() => {
        fetchConfig();
        const id = setInterval(fetchConfig, 30_000);
        return () => clearInterval(id);
    }, [fetchConfig]);

    const handleSetFeeRecipient = () => {
        if (!config?.walletAddress || !config?.setterName || !config?.tokenContractAddress) return;

        try {
            const data = encodeFunctionData({
                abi:          parseAbi([`function ${config.setterName}(address)`]),
                functionName: config.setterName,
                args:         [config.walletAddress as `0x${string}`],
            });

            sendTransaction(
                { to: config.tokenContractAddress as `0x${string}`, data },
                {
                    onSuccess: () => {
                        setTxSubmitted(true);
                        toast.success("Fee recipient updated! Activates within 5 minutes.");
                    },
                    onError: (e) => toast.error(e.message?.slice(0, 100) ?? "Transaction failed"),
                },
            );
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to build transaction");
        }
    };

    // Safe TX builder link — pre-fills the contract address and calldata
    const getSafeLink = () => {
        if (!config?.walletAddress || !config?.setterName || !config?.tokenContractAddress) return null;
        const owner = config.onChainOwnerAddress ?? config.ownerAddress;
        try {
            const calldata = encodeFunctionData({
                abi:          parseAbi([`function ${config.setterName}(address)`]),
                functionName: config.setterName,
                args:         [config.walletAddress as `0x${string}`],
            });
            const txBuilderData = encodeURIComponent(JSON.stringify({
                version: "1.0",
                chainId: "8453",
                createdAt: Date.now(),
                meta: { name: "Set buyback fee recipient" },
                transactions: [{
                    to:    config.tokenContractAddress,
                    value: "0",
                    data:  calldata,
                }],
            }));
            return `https://app.safe.global/apps/open?safe=base:${owner}&appUrl=https://apps.safe.global/tx-builder&importData=${txBuilderData}`;
        } catch {
            return `https://app.safe.global/apps/open?safe=base:${owner}&appUrl=https://apps.safe.global/tx-builder`;
        }
    };

    const handleCheck = async () => {
        setChecking(true);
        try {
            const res  = await fetch(`/api/token-buyback/${configId}/check`, { method: "POST" });
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
        } finally { setChecking(false); }
    };

    const handleDisable = async () => {
        if (!confirm("Disable this buyback? Funds in the wallet stay put — use the recovery address to sweep them.")) return;
        setDisabling(true);
        try {
            const res = await fetch(`/api/token-buyback/${configId}`, { method: "DELETE" });
            if (res.ok) { toast.success("Buyback disabled"); onRemoved(configId); }
            else { const d = await res.json(); toast.error(d.error || "Failed to disable"); }
        } finally { setDisabling(false); }
    };

    const handleCopyWallet = async () => {
        if (!config?.walletAddress) return;
        await navigator.clipboard.writeText(config.walletAddress);
        setCopiedWallet(true);
        setTimeout(() => setCopiedWallet(false), 2000);
    };

    if (loading) {
        return (
            <Card className="rounded-[20px] shadow-none border border-black/10">
                <CardContent className="p-6 flex items-center justify-center py-12">
                    <div className="animate-spin h-6 w-6 border-2 border-black/40 border-t-transparent rounded-full" />
                </CardContent>
            </Card>
        );
    }

    if (!config) {
        return (
            <Card className="rounded-[20px] shadow-none border border-red-200">
                <CardContent className="p-6">
                    <p className="text-sm text-red-500 font-funnel-sans">Failed to load config {configId}</p>
                </CardContent>
            </Card>
        );
    }

    const sc           = statusConfig[config.status] ?? statusConfig.PAUSED;
    const progress     = config.accumulatedUsd != null && config.thresholdUsd > 0
        ? Math.min(config.accumulatedUsd / config.thresholdUsd, 1) : 0;
    const readyToFire  = progress >= 1;
    const execStatus   = config.inFlightExecution?.status;
    const showSetFeeBtn = config.status === "PENDING_FEE_RECIPIENT_UPDATE"
        && config.setterName
        && config.walletAddress
        && !config.ownerIsContract;
    const showSafeLink  = config.status === "PENDING_FEE_RECIPIENT_UPDATE"
        && config.setterName
        && config.walletAddress
        && config.ownerIsContract;

    return (
        <>
            <Card className="rounded-[20px] shadow-none border border-black/10">
                <CardContent className="p-6 space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-base font-semibold font-funnel-display text-black">{config.targetTokenSymbol}</p>
                            <p className="text-xs text-black/40 font-funnel-sans font-mono mt-0.5">{truncate(config.targetTokenAddress)}</p>
                        </div>
                        <Badge variant="outline" className={`text-xs font-funnel-sans font-medium shrink-0 ${sc.class}`}>
                            {sc.label}
                        </Badge>
                    </div>

                    {/* Addresses */}
                    <div className="space-y-2">
                        <div className="bg-black/4 rounded-[10px] px-3 py-2 border border-black/10">
                            <p className="text-[10px] text-black/40 font-funnel-sans uppercase tracking-wide">Fee Source Contract</p>
                            <p className="font-mono text-xs text-black truncate">{config.tokenContractAddress}</p>
                        </div>

                        {config.walletAddress && (
                            <div className="flex items-center justify-between gap-2 bg-black/4 rounded-[10px] px-3 py-2 border border-black/10">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] text-black/40 font-funnel-sans uppercase tracking-wide">Buyback Wallet</p>
                                    <p className="font-mono text-xs text-black truncate">{config.walletAddress}</p>
                                </div>
                                <button onClick={handleCopyWallet} className="shrink-0 p-1 rounded hover:bg-black/10 transition-colors">
                                    {copiedWallet ? <Check className="w-3.5 h-3.5 text-secondary-green" /> : <Copy className="w-3.5 h-3.5 text-black/40" />}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Pending activation */}
                    {config.status === "PENDING_FEE_RECIPIENT_UPDATE" && config.walletAddress && (
                        <div className="bg-secondary-orange/10 border border-secondary-orange/30 rounded-[10px] px-3 py-2.5 space-y-2.5">
                            <div>
                                <p className="text-xs font-semibold text-secondary-orange font-funnel-sans">
                                    {config.setterName
                                        ? `Call ${config.setterName}(${truncate(config.walletAddress)}) on your contract`
                                        : `Set ${truncate(config.walletAddress)} as the fee recipient on your contract`
                                    }
                                </p>
                                {config.onChainOwnerAddress && (
                                    <p className="text-[11px] text-secondary-orange/70 font-funnel-sans mt-0.5">
                                        {config.ownerIsContract ? "Safe owner:" : "Owner:"} {truncate(config.onChainOwnerAddress)}
                                    </p>
                                )}
                            </div>

                            {/* Direct sign button (EOA owner) */}
                            {showSetFeeBtn && !txSubmitted && (
                                <Button
                                    onClick={handleSetFeeRecipient}
                                    disabled={isSigning}
                                    className="flex items-center gap-1.5 w-full bg-secondary-orange hover:bg-orange-600 text-white rounded-full px-4 py-2 text-xs font-funnel-sans h-auto"
                                >
                                    {isSigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                    {isSigning ? "Waiting for wallet…" : `Sign setFeeRecipient`}
                                </Button>
                            )}

                            {/* Submitted confirmation */}
                            {showSetFeeBtn && txSubmitted && (
                                <p className="text-xs text-secondary-green font-funnel-sans font-medium">
                                    ✓ Transaction submitted — activates on next worker tick (~5 min)
                                </p>
                            )}

                            {/* Safe TX builder link */}
                            {showSafeLink && (
                                <a
                                    href={getSafeLink() ?? "#"}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 w-full justify-center bg-secondary-blue hover:bg-blue-700 text-white rounded-full px-4 py-2 text-xs font-funnel-sans h-auto transition-colors"
                                >
                                    Propose via Safe <ExternalLink className="w-3 h-3" />
                                </a>
                            )}

                            <p className="text-[11px] text-secondary-orange/60 font-funnel-sans">
                                Activates automatically once fees start arriving (≥ $0.10).
                            </p>
                        </div>
                    )}

                    {/* Broken */}
                    {config.status === "BROKEN" && (
                        <div className="bg-red-50 border border-red-200 rounded-[10px] px-3 py-2">
                            <p className="text-xs text-red-600 font-funnel-sans">Buyback executions are failing. Check history for details.</p>
                        </div>
                    )}

                    {/* Balance + progress (active) */}
                    {config.status === "ACTIVE" && (
                        <div className="space-y-2">
                            <div className="flex items-baseline justify-between">
                                <p className="text-xs text-black/40 font-funnel-sans">Accumulated</p>
                                <p className="text-xs text-black/60 font-funnel-sans">
                                    ${(config.accumulatedUsd ?? 0).toFixed(2)}
                                    <span className="text-black/30"> / ${config.thresholdUsd.toFixed(2)}</span>
                                </p>
                            </div>
                            <div className="h-2 w-full bg-black/10 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${readyToFire ? "bg-secondary-green" : "bg-secondary-blue"}`}
                                    style={{ width: `${Math.round(progress * 100)}%` }}
                                />
                            </div>
                            {config.assets && config.assets.length > 0 && (
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {config.assets.map((a, i) => (
                                        <span key={i} className="text-[11px] text-black/50 font-funnel-sans font-mono">
                                            {a.amountHuman} {a.symbol}
                                            <span className="text-black/30"> (${a.usdValue.toFixed(2)})</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                            {execStatus && (
                                <p className={`text-xs font-funnel-sans ${execStatus === "FAILED" ? "text-red-600" : execStatus === "RETRYING" ? "text-amber-600" : "text-secondary-purple"}`}>
                                    {execStatus === "FAILED" ? "Last execution failed — check history." :
                                     execStatus === "RETRYING" ? "Retrying…" :
                                     `Buyback in progress: ${execStatus.toLowerCase()}…`}
                                </p>
                            )}
                            {readyToFire && !execStatus && (
                                <p className="text-xs text-secondary-green font-funnel-sans">Threshold reached — fires on next worker tick.</p>
                            )}
                        </div>
                    )}

                    {/* Meta */}
                    <div className="flex items-center gap-3 text-[11px] text-black/30 font-funnel-sans flex-wrap">
                        <span>Fee: {(config.feeRateBps / 100).toFixed(1)}%</span>
                        <span>·</span>
                        <span>Threshold: ${config.thresholdUsd}</span>
                        {config.feeGetterName && (
                            <><span>·</span><span className="font-mono">{config.feeGetterName}()</span></>
                        )}
                        {config.lastTriggeredAt && (
                            <><span>·</span>
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />{new Date(config.lastTriggeredAt).toLocaleDateString()}
                            </span></>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-1">
                        {config.status === "ACTIVE" && (
                            <Button
                                onClick={handleCheck}
                                disabled={checking}
                                className="flex items-center gap-1.5 bg-secondary-blue hover:bg-blue-700 text-white rounded-full px-4 py-2 text-xs font-funnel-sans h-auto"
                            >
                                <Zap className="w-3.5 h-3.5" />
                                {checking ? "Checking…" : "Check Now"}
                            </Button>
                        )}
                        <Button
                            onClick={() => setShowHistory(true)}
                            variant="outline"
                            className="flex items-center gap-1.5 border-black/20 text-black/60 rounded-full px-4 py-2 text-xs font-funnel-sans h-auto hover:bg-black/5"
                        >
                            <History className="w-3.5 h-3.5" />
                            History
                        </Button>
                        {config.isActive && (
                            <Button
                                onClick={handleDisable}
                                disabled={disabling}
                                variant="outline"
                                className="flex items-center gap-1.5 border-red-200 text-red-500 rounded-full px-4 py-2 text-xs font-funnel-sans h-auto hover:bg-red-50"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {disabling ? "Disabling…" : "Disable"}
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            <ExecutionHistoryModal
                configId={configId}
                tokenSymbol={config.targetTokenSymbol}
                tokenDecimals={config.targetTokenDecimals}
                open={showHistory}
                onClose={() => setShowHistory(false)}
            />
        </>
    );
}
