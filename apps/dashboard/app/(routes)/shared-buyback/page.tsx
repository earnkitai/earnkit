"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Flame, ChevronRight } from "lucide-react";
import SharedBuybackCard from "./components/SharedBuybackCard";

const STORAGE_KEY = "earnkit_shared_buyback_configs";

function loadStoredConfigIds(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as string[];
    } catch {
        return [];
    }
}

function removeConfigId(configId: string) {
    try {
        const existing = loadStoredConfigIds();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.filter((id) => id !== configId)));
    } catch { /* non-fatal */ }
}

const HOW_IT_WORKS = [
    {
        n: "1",
        title: "Register your split",
        body: "Provide your existing 0xSplits contract. We provision a Turnkey-managed buyback wallet — you keep full custody.",
    },
    {
        n: "2",
        title: "Add wallet as recipient",
        body: "Update your split to include the buyback wallet as a recipient via your Safe or a direct updateSplit call.",
    },
    {
        n: "3",
        title: "Automatic buyback & burn",
        body: "Every distribution accumulates in the wallet. Once the threshold is hit, it swaps to your token and burns it.",
    },
];

export default function SharedBuybackPage() {
    const { ready, authenticated } = usePrivy();
    const router = useRouter();

    const [configIds, setConfigIds] = useState<string[]>([]);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (ready && !authenticated) router.push("/");
    }, [ready, authenticated, router]);

    useEffect(() => {
        setConfigIds(loadStoredConfigIds());
        setHydrated(true);
    }, []);

    const handleRemoved = useCallback((configId: string) => {
        removeConfigId(configId);
        setConfigIds((prev) => prev.filter((id) => id !== configId));
    }, []);

    if (!ready || !authenticated) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-secondary-orange" />
                    <h1 className="text-2xl font-semibold font-funnel-display text-black">Token Buyback</h1>
                </div>
                <Link
                    href="/create"
                    className="flex items-center gap-2 bg-black text-white rounded-full px-4 py-2 font-funnel-sans text-sm hover:bg-black/80 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add Split
                </Link>
            </div>

            {/* Loading */}
            {!hydrated && (
                <div className="flex items-center justify-center py-24">
                    <div className="animate-spin h-7 w-7 border-2 border-black/30 border-t-transparent rounded-full" />
                </div>
            )}

            {/* Empty state */}
            {hydrated && configIds.length === 0 && (
                <div className="space-y-8 pt-4">
                    <div className="border border-dashed border-black/15 rounded-[24px] flex flex-col items-center justify-center py-16 gap-5 text-center px-6">
                        <div className="w-12 h-12 rounded-full bg-secondary-orange/10 flex items-center justify-center">
                            <Flame className="w-5 h-5 text-secondary-orange" />
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-base font-semibold text-black font-funnel-sans">No splits connected yet</p>
                            <p className="text-sm text-black/40 font-funnel-sans max-w-sm">
                                Connect your existing 0xSplits contract and we handle the buyback automatically.
                            </p>
                        </div>
                        <Link
                            href="/create"
                            className="flex items-center gap-2 bg-black text-white rounded-full px-5 py-2.5 font-funnel-sans text-sm hover:bg-black/80 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Add Split
                        </Link>
                    </div>

                    {/* How it works — only in empty state */}
                    <div>
                        <p className="text-xs font-semibold text-black/40 font-funnel-sans uppercase tracking-wide mb-4">How it works</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {HOW_IT_WORKS.map((step) => (
                                <div key={step.n} className="bg-black/[0.02] rounded-[16px] p-4 border border-black/[0.06] space-y-1.5">
                                    <div className="w-6 h-6 rounded-full bg-black/8 flex items-center justify-center mb-2">
                                        <span className="text-xs font-bold text-black/40 font-funnel-sans">{step.n}</span>
                                    </div>
                                    <p className="text-sm font-semibold text-black font-funnel-sans">{step.title}</p>
                                    <p className="text-xs text-black/40 font-funnel-sans leading-relaxed">{step.body}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Configs */}
            {hydrated && configIds.length > 0 && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {configIds.map((id) => (
                            <div key={id} className="space-y-1.5">
                                <SharedBuybackCard configId={id} onRemoved={handleRemoved} />
                                <Link
                                    href={`/shared-buyback/${id}`}
                                    className="flex items-center justify-end gap-1 text-xs text-black/40 hover:text-black font-funnel-sans transition-colors px-1"
                                >
                                    Open details &amp; distribute <ChevronRight className="w-3.5 h-3.5" />
                                </Link>
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-end">
                        <Link
                            href="/executions"
                            className="flex items-center gap-1 text-xs text-black/40 hover:text-black font-funnel-sans transition-colors"
                        >
                            View execution history <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
}
