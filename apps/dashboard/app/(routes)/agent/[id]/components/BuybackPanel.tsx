"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { toast } from "sonner";

interface BuybackConfig {
    id: string;
    tokenAddress: string;
    tokenSymbol: string;
    tokenDecimals: number;
    thresholdUsd: number;
    slippageBps: number;
    burnMode: "DEAD_ADDRESS" | "TOKEN_BURN_FN";
    walletAddress: string;
    isActive: boolean;
    lastCheckedAt: string | null;
    lastTriggeredAt: string | null;
}

interface BuybackAsset {
    symbol: string;
    address: string;
    amountHuman: string;
    usdValue: number;
    source: 'warehouse' | 'wallet';
}

interface BuybackStatus {
    configured: boolean;
    isActive?: boolean;
    accumulatedUsd: number;
    thresholdUsd: number;
    progress: number;
    readyToFire?: boolean;
    assets?: BuybackAsset[];
    inFlightExecution?: { id: string; status: string } | null;
}


interface BuybackPanelProps {
    agentDbId: string;
}

export default function BuybackPanel({ agentDbId }: BuybackPanelProps) {
    const [config, setConfig] = useState<BuybackConfig | null>(null);
    const [status, setStatus] = useState<BuybackStatus | null>(null);
    const [minThresholdUsd, setMinThresholdUsd] = useState(10);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [thresholdUsd, setThresholdUsd] = useState("10");
    const [slippagePercent, setSlippagePercent] = useState("5");

    const fetchConfig = useCallback(async () => {
        try {
            const r = await fetch(`/api/agents/${agentDbId}/buyback`);
            const data = await r.json();
            const cfg: BuybackConfig | null = data.buybackConfig ?? null;
            setConfig(cfg);
            if (typeof data.minThresholdUsd === "number") {
                setMinThresholdUsd(data.minThresholdUsd);
                if (!cfg) setThresholdUsd(String(Math.max(data.minThresholdUsd, 10)));
            }
            if (cfg) {
                setThresholdUsd(String(cfg.thresholdUsd));
                setSlippagePercent(String(cfg.slippageBps / 100));
            }
        } catch (e) {
            console.error("Failed to load buyback config:", e);
        } finally {
            setLoading(false);
        }
    }, [agentDbId]);

    const fetchStatus = useCallback(async () => {
        try {
            const r = await fetch(`/api/agents/${agentDbId}/buyback/status`);
            if (!r.ok) return;
            const data: BuybackStatus = await r.json();
            setStatus(data);
        } catch (e) {
            console.error("Failed to load buyback status:", e);
        }
    }, [agentDbId]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    useEffect(() => {
        if (!config) {
            setStatus(null);
            return;
        }
        fetchStatus();
        const id = setInterval(() => {
            fetchStatus();
        }, 30_000);
        return () => clearInterval(id);
    }, [config, fetchStatus]);

    const handleUpdate = async () => {
        if (!config) return;
        const threshold = parseFloat(thresholdUsd);
        if (!Number.isFinite(threshold) || threshold < minThresholdUsd) {
            toast.error(`Threshold must be at least $${minThresholdUsd}`);
            return;
        }
        const slip = parseFloat(slippagePercent);
        if (!Number.isFinite(slip) || slip < 1 || slip > 20) {
            toast.error("Slippage must be between 1% and 20%");
            return;
        }
        setSaving(true);
        try {
            const r = await fetch(`/api/agents/${agentDbId}/buyback`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    thresholdUsd: threshold,
                    slippageBps: Math.round(slip * 100),
                }),
            });
            const data = await r.json();
            if (!r.ok) {
                toast.error(data.error || "Failed to save");
            } else {
                toast.success("Buyback settings updated");
                await fetchConfig();
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDisable = async () => {
        if (!confirm("Disable auto-buyback? Any accumulated funds will remain in the buyback wallet — you can recover them later.")) return;
        setSaving(true);
        try {
            const r = await fetch(`/api/agents/${agentDbId}/buyback`, { method: "DELETE" });
            if (r.ok) {
                toast.success("Buyback disabled");
                await fetchConfig();
            } else {
                const d = await r.json();
                toast.error(d.error || "Failed to disable");
            }
        } finally {
            setSaving(false);
        }
    };

    const handleTriggerNow = async () => {
        try {
            const r = await fetch(`/api/agents/${agentDbId}/buyback/check`, { method: "POST" });
            const d = await r.json();
            if (!r.ok) {
                toast.error(d.error || "Failed to trigger buyback");
                return;
            }
            if (d.queued) {
                toast.success(`Buyback queued — executor will run within 30s ($${d.accumulatedUsd?.toFixed?.(2) ?? "?"} of $${d.thresholdUsd ?? "?"})`);
            } else {
                toast.info(d.reason === 'below_threshold'
                    ? `Below threshold — $${d.accumulatedUsd?.toFixed?.(2) ?? "?"} of $${d.thresholdUsd ?? "?"}`
                    : d.reason === 'in_flight'
                        ? `Already in flight: ${d.execution?.status?.toLowerCase?.() ?? "running"}`
                        : `No-op: ${d.reason ?? "unknown"}`);
            }
            await fetchStatus();
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Unexpected error");
        }
    };

    const handleRecover = async () => {
        if (!confirm("Recover stranded funds? This will withdraw everything from the Splits Warehouse and transfer all token balances from the buyback wallet back to your configured recovery address (your dev wallet). ETH gas reserve stays behind to cover the sweep transactions.")) return;
        try {
            const r = await fetch(`/api/agents/${agentDbId}/buyback/recover`, { method: "POST" });
            const d = await r.json();
            if (r.ok) {
                toast.success("Recovery queued — check execution history shortly");
            } else {
                toast.error(d.error || "Failed to start recovery");
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Unexpected error");
        }
    };

    if (loading) {
        return (
            <Card className="rounded-[20px] shadow-none border border-black/10">
                <CardContent className="p-6">
                    <p className="text-black/40 font-funnel-sans text-sm">Loading buyback settings…</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="rounded-[20px] shadow-none border border-black/10">
            <CardContent className="p-8">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold font-funnel-display text-black mb-2">
                            Auto Buyback &amp; Burn
                        </h2>
                        <p className="text-black/40 text-sm font-funnel-sans">
                            Accumulate buyback funds in a Turnkey-managed wallet and automatically swap & burn when the balance crosses your threshold.
                        </p>
                    </div>
                    {config && (
                        <Badge
                            variant="default"
                            className={`${config.isActive ? 'text-secondary-green border-secondary-green' : 'text-black/30 border-black/30'} font-funnel-sans`}
                            style={{
                                background: config.isActive
                                    ? 'linear-gradient(0deg, rgba(52,199,89,0.2), rgba(52,199,89,0.2))'
                                    : 'linear-gradient(0deg, rgba(0,0,0,0.04), rgba(0,0,0,0.04))',
                            }}
                        >
                            {config.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                    )}
                </div>

                {!config ? (
                    <div className="bg-black/4 rounded-[12px] p-6 border border-black/10 space-y-2">
                        <p className="text-sm text-black font-funnel-sans">
                            Auto Buyback wasn&apos;t configured for this app.
                        </p>
                        <p className="text-xs text-black/60 font-funnel-sans">
                            Auto Buyback can only be set up at app creation, because the on-chain split contract bakes in the buyback recipient at deploy time and is immutable. To enable it, create a new app and select &quot;Auto Buyback &amp; Burn&quot; in that step.
                        </p>
                    </div>
                ) : (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-black font-funnel-sans">
                            Token (locked at creation)
                        </label>
                        <Input
                            type="text"
                            value={config.tokenAddress}
                            disabled
                            className="font-mono text-sm"
                        />
                        <p className="text-xs text-black/40 font-funnel-sans">
                            {config.tokenSymbol} · locked once provisioned. The on-chain Splits contract baked in this token&apos;s buyback wallet — to change, you must create a new app.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-black font-funnel-sans">
                                Threshold (USD)
                            </label>
                            <Input
                                type="number"
                                min={minThresholdUsd}
                                step="1"
                                value={thresholdUsd}
                                onChange={(e) => setThresholdUsd(e.target.value)}
                            />
                            <p className="text-xs text-black/40 font-funnel-sans">
                                Min ${minThresholdUsd} · recommended $10+. Funds accumulate until this; no buyback fires below it.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-black font-funnel-sans">
                                Max slippage (%)
                            </label>
                            <Input
                                type="number"
                                min="1"
                                max="20"
                                step="0.5"
                                value={slippagePercent}
                                onChange={(e) => setSlippagePercent(e.target.value)}
                            />
                            <p className="text-xs text-black/40 font-funnel-sans">
                                Higher tolerance helps thin liquidity but invites MEV.
                            </p>
                        </div>
                    </div>

                    {status?.configured && (
                        <div className="bg-black/4 rounded-[12px] p-4 border border-black/10 space-y-3">
                            <div>
                                <div className="flex items-baseline justify-between mb-2">
                                    <p className="text-xs text-black/40 font-funnel-sans">Swappable balance</p>
                                    <p className="text-xs text-black/60 font-funnel-sans">
                                        ${status.accumulatedUsd.toFixed(2)} <span className="text-black/40">/ ${status.thresholdUsd.toFixed(2)} threshold</span>
                                    </p>
                                </div>
                                <div className="h-2 w-full bg-black/10 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${status.readyToFire ? 'bg-secondary-green' : 'bg-color1'}`}
                                        style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }}
                                    />
                                </div>

                                {/* Asset breakdown */}
                                {status.assets && status.assets.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                        {status.assets.map((a, i) => (
                                            <span key={i} className="text-[11px] text-black/50 font-funnel-sans font-mono">
                                                {a.amountHuman} {a.symbol}
                                                <span className="text-black/30"> (${a.usdValue.toFixed(2)}, {a.source})</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {(!status.assets || status.assets.length === 0) && status.accumulatedUsd === 0 && (
                                    <p className="text-[11px] text-black/40 font-funnel-sans mt-1">
                                        No swappable balance yet. Gas reserve (~0.0001 ETH) is held on the wallet but not counted here.
                                    </p>
                                )}

                                {/* Inline execution status */}
                                {(() => {
                                    const lastExec = executions[0];
                                    if (status.inFlightExecution) {
                                        return (
                                            <p className="text-xs text-secondary-purple font-funnel-sans mt-2">
                                                Buyback in progress: {status.inFlightExecution.status.toLowerCase()}…
                                            </p>
                                        );
                                    }
                                    if (lastExec?.status === 'FAILED') {
                                        const shortError = lastExec.lastError
                                            ? lastExec.lastError.replace(/^swap_all_failed:\s*/, 'Swap failed — ').slice(0, 120)
                                            : 'unknown error';
                                        return (
                                            <div className="mt-2 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">
                                                <p className="text-xs text-red-700 font-funnel-sans font-semibold">Last attempt failed</p>
                                                <p className="text-[11px] text-red-600 font-mono break-all mt-0.5">{shortError}</p>
                                                {status.readyToFire && (
                                                    <p className="text-[11px] text-red-500 font-funnel-sans mt-1">
                                                        Funds are still in the wallet. Use &quot;Trigger buyback now&quot; to retry.
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    }
                                    if (lastExec?.status === 'RETRYING') {
                                        return (
                                            <p className="text-xs text-amber-600 font-funnel-sans mt-2">
                                                Retrying… next attempt at {lastExec.nextAttemptAt ? new Date(lastExec.nextAttemptAt).toLocaleString() : '—'}
                                            </p>
                                        );
                                    }
                                    if (status.readyToFire) {
                                        return (
                                            <p className="text-xs text-secondary-green font-funnel-sans mt-2">
                                                Threshold reached. Buyback fires automatically when you click &quot;Distribute Fees&quot;, or use &quot;Trigger now&quot; below.
                                            </p>
                                        );
                                    }
                                    return (
                                        <p className="text-xs text-black/40 font-funnel-sans mt-2">
                                            Funds accumulating — buyback fires once the threshold is crossed.
                                        </p>
                                    );
                                })()}
                            </div>
                            <div>
                                <p className="text-xs text-black/40 font-funnel-sans">Buyback wallet (Turnkey-managed, your email is the root authenticator)</p>
                                <p className="text-xs font-mono text-black break-all">{config.walletAddress}</p>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-black/60 font-funnel-sans">
                                <span>Burn mode: {config.burnMode === 'TOKEN_BURN_FN' ? 'token.burn()' : 'transfer to 0xdEaD'}</span>
                                {config.lastTriggeredAt && (
                                    <span>Last buyback: {new Date(config.lastTriggeredAt).toLocaleString()}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                )}

                {config && (
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Button
                            onClick={handleUpdate}
                            disabled={saving}
                            className="bg-secondary-green hover:bg-green-700 text-white px-6 py-3 rounded-full font-normal font-funnel-sans"
                        >
                            Save Changes
                        </Button>
                        {config.isActive && status?.readyToFire && !status?.inFlightExecution && (
                            <Button
                                onClick={handleTriggerNow}
                                className="bg-secondary-purple hover:bg-purple-700 text-white px-6 py-3 rounded-full font-normal font-funnel-sans"
                            >
                                Trigger buyback now
                            </Button>
                        )}
                        {config.isActive && (
                            <Button
                                onClick={handleDisable}
                                variant="outline"
                                className="px-6 py-3 rounded-full border border-black/40 text-black/60 font-funnel-sans"
                            >
                                Disable
                            </Button>
                        )}
                        <Button
                            onClick={handleRecover}
                            variant="outline"
                            className="px-6 py-3 rounded-full border border-black/40 text-black/60 font-funnel-sans"
                        >
                            Recover stranded funds
                        </Button>
                    </div>
                )}

                {config && (
                    <p className="mt-4 text-xs text-black/40 font-funnel-sans">
                        View full execution history in the <strong>Buyback</strong> tab above.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

