"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Copy, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface GiftCode {
    id: string;
    code: string;
    creditsPerRedemption: number;
    maxRedemptions: number | null;
    redemptionCount: number;
    isActive: boolean;
    expiresAt: string | null;
    createdAt: string;
    status: "active" | "inactive" | "exhausted" | "expired";
}

interface GiftCodesProps {
    agentDbId: string;
}

export default function GiftCodes({ agentDbId }: GiftCodesProps) {
    const [codes, setCodes] = useState<GiftCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [credits, setCredits] = useState("");
    const [maxRedemptions, setMaxRedemptions] = useState("");

    const fetchCodes = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/agents/${agentDbId}/gift-codes`);
            if (!res.ok) {
                toast.error("Failed to load gift codes");
                return;
            }
            const data = await res.json();
            setCodes(data.codes ?? []);
        } catch {
            toast.error("Failed to load gift codes");
        } finally {
            setLoading(false);
        }
    }, [agentDbId]);

    useEffect(() => {
        fetchCodes();
    }, [fetchCodes]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        const creditsNum = parseInt(credits, 10);
        if (!Number.isInteger(creditsNum) || creditsNum <= 0) {
            toast.error("Enter a positive integer for credits");
            return;
        }
        let maxNum: number | null = null;
        if (maxRedemptions.trim() !== "") {
            const n = parseInt(maxRedemptions, 10);
            if (!Number.isInteger(n) || n <= 0) {
                toast.error("Max redemptions must be a positive integer (or leave blank for unlimited)");
                return;
            }
            maxNum = n;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`/api/agents/${agentDbId}/gift-codes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    creditsPerRedemption: creditsNum,
                    maxRedemptions: maxNum,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err.error || "Failed to create code");
                return;
            }
            toast.success("Gift code created");
            setCredits("");
            setMaxRedemptions("");
            await fetchCodes();
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggle = async (code: GiftCode) => {
        const res = await fetch(`/api/agents/${agentDbId}/gift-codes/${code.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: !code.isActive }),
        });
        if (!res.ok) {
            toast.error("Failed to update code");
            return;
        }
        await fetchCodes();
    };

    const handleDelete = async (code: GiftCode) => {
        if (!confirm(`Delete code ${code.code}? This cannot be undone.`)) return;
        const res = await fetch(`/api/agents/${agentDbId}/gift-codes/${code.id}`, {
            method: "DELETE",
        });
        if (!res.ok) {
            toast.error("Failed to delete code");
            return;
        }
        toast.success("Code deleted");
        await fetchCodes();
    };

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        toast.success("Code copied to clipboard");
    };

    const statusBadge = (status: GiftCode["status"]) => {
        const map: Record<GiftCode["status"], { bg: string; text: string; label: string }> = {
            active: { bg: "rgba(52, 199, 89, 0.2)", text: "text-secondary-green", label: "Active" },
            inactive: { bg: "rgba(0, 0, 0, 0.06)", text: "text-black/50", label: "Inactive" },
            exhausted: { bg: "rgba(0, 0, 0, 0.06)", text: "text-black/50", label: "Exhausted" },
            expired: { bg: "rgba(255, 59, 48, 0.15)", text: "text-secondary-red", label: "Expired" },
        };
        const s = map[status];
        return (
            <Badge
                variant="default"
                className={`${s.text} bg-white/80 font-funnel-sans text-[12px] font-medium py-0.5 px-3`}
                style={{ background: s.bg }}
            >
                {s.label}
            </Badge>
        );
    };

    return (
        <div className="space-y-6">
            <Card className="rounded-[20px] shadow-none border border-black/10">
                <CardContent className="p-8">
                    <div className="mb-6">
                        <h1 className="text-xl font-semibold font-funnel-display text-black mb-2">Create Gift Code</h1>
                        <p className="text-black/40 text-sm font-funnel-sans">
                            Generate a reusable invite code. Each wallet can redeem a given code once; the credits are added to that wallet&apos;s balance on this app.
                        </p>
                    </div>

                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="flex gap-4 items-end">
                            <div className="flex-1">
                                <label className="block text-sm font-semibold text-black font-funnel-sans px-4 mb-2">
                                    Credits per redemption
                                </label>
                                <Input
                                    type="number"
                                    placeholder="e.g. 50"
                                    value={credits}
                                    onChange={(e) => setCredits(e.target.value)}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="w-full p-4 border border-gray-200 rounded-lg"
                                    min={1}
                                    required
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-semibold text-black font-funnel-sans px-4 mb-2">
                                    Max redemptions (optional)
                                </label>
                                <Input
                                    type="number"
                                    placeholder="Blank = unlimited"
                                    value={maxRedemptions}
                                    onChange={(e) => setMaxRedemptions(e.target.value)}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="w-full p-4 border border-gray-200 rounded-lg"
                                    min={1}
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={submitting}
                                className="bg-secondary-green hover:bg-green-700 text-white px-8 py-6 rounded-full font-normal font-funnel-sans"
                            >
                                {submitting ? "Creating..." : "Generate Code"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Card className="rounded-[20px] shadow-none border border-black/10">
                <CardContent className="p-8">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h2 className="text-xl font-semibold font-funnel-display text-black mb-1">Codes</h2>
                            <p className="text-black/40 text-sm font-funnel-sans">{codes.length} total</p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={fetchCodes}
                            disabled={loading}
                            className="rounded-full border border-black/15 text-black/60 px-4 py-2 h-9"
                        >
                            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>

                    {loading ? (
                        <p className="text-black/40 text-sm font-funnel-sans py-8 text-center">Loading...</p>
                    ) : codes.length === 0 ? (
                        <p className="text-black/40 text-sm font-funnel-sans py-8 text-center">
                            No gift codes yet. Create one above.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {codes.map((c) => (
                                <div
                                    key={c.id}
                                    className="flex items-center justify-between p-4 rounded-xl border border-black/10 bg-white"
                                >
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <code className="font-mono text-sm font-semibold text-black truncate">{c.code}</code>
                                        <button
                                            type="button"
                                            onClick={() => copyCode(c.code)}
                                            className="text-black/40 hover:text-black/70 shrink-0"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                        {statusBadge(c.status)}
                                    </div>
                                    <div className="flex items-center gap-6 text-sm font-funnel-sans">
                                        <div className="text-right">
                                            <p className="text-black font-semibold">{c.creditsPerRedemption}</p>
                                            <p className="text-black/40 text-xs">credits each</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-black font-semibold">
                                                {c.redemptionCount}
                                                {c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ""}
                                            </p>
                                            <p className="text-black/40 text-xs">redeemed</p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => handleToggle(c)}
                                            className="rounded-full text-xs px-3 py-1 h-8 border border-black/15 text-black/60"
                                        >
                                            {c.isActive ? "Deactivate" : "Activate"}
                                        </Button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(c)}
                                            className="text-black/40 hover:text-secondary-red"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
