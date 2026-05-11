"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { Button } from "@/app/components/ui/button";
import { Plus, Flame } from "lucide-react";
import RegisterModal from "./components/RegisterModal";
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

function saveConfigId(configId: string) {
    try {
        const existing = loadStoredConfigIds();
        if (!existing.includes(configId)) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, configId]));
        }
    } catch { /* non-fatal */ }
}

function removeConfigId(configId: string) {
    try {
        const existing = loadStoredConfigIds();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.filter((id) => id !== configId)));
    } catch { /* non-fatal */ }
}

export default function SharedBuybackPage() {
    const { ready, authenticated, user: privyUser } = usePrivy();
    const router = useRouter();

    const [configIds, setConfigIds] = useState<string[]>([]);
    const [showRegister, setShowRegister] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (ready && !authenticated) {
            router.push("/");
        }
    }, [ready, authenticated, router]);

    // Load from localStorage after hydration
    useEffect(() => {
        setConfigIds(loadStoredConfigIds());
        setHydrated(true);
    }, []);

    const handleRegistered = useCallback((configId: string, _walletAddress: string) => {
        saveConfigId(configId);
        setConfigIds((prev) => prev.includes(configId) ? prev : [...prev, configId]);
    }, []);

    const handleRemoved = useCallback((configId: string) => {
        removeConfigId(configId);
        setConfigIds((prev) => prev.filter((id) => id !== configId));
    }, []);

    const userEmail = privyUser?.email?.address ?? "";

    if (!ready || !authenticated) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
            {/* Page header */}
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Flame className="w-5 h-5 text-secondary-orange" />
                        <h1 className="text-2xl font-semibold font-funnel-display text-black">Shared Buyback</h1>
                    </div>
                    <p className="text-black/40 text-sm font-funnel-sans max-w-lg">
                        Connect any existing 0xSplits contract to automated buyback &amp; burn — without giving up custody.
                        A buyback wallet is provisioned for your split; add it as a recipient and revenue automatically
                        flows into token burns. A {" "}
                        <span className="text-black/60 font-medium">5% platform fee</span>{" "}
                        is deducted per execution.
                    </p>
                </div>
                <Button
                    onClick={() => setShowRegister(true)}
                    className="flex items-center gap-2 bg-black text-white rounded-full px-5 py-2.5 font-funnel-sans text-sm hover:bg-black/80 shrink-0"
                >
                    <Plus className="w-4 h-4" />
                    Add Split
                </Button>
            </div>

            {/* Content */}
            {!hydrated ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full" />
                </div>
            ) : configIds.length === 0 ? (
                <div className="border border-dashed border-black/20 rounded-[20px] flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-12 h-12 rounded-full bg-black/4 flex items-center justify-center">
                        <Flame className="w-6 h-6 text-black/30" />
                    </div>
                    <div className="text-center space-y-1">
                        <p className="text-black/60 font-funnel-sans font-medium">No shared buybacks yet</p>
                        <p className="text-black/30 text-sm font-funnel-sans">
                            Click &quot;Add Split&quot; to connect your first existing split contract.
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowRegister(true)}
                        variant="outline"
                        className="flex items-center gap-2 border-black/20 text-black/60 rounded-full px-5 font-funnel-sans hover:bg-black/5"
                    >
                        <Plus className="w-4 h-4" />
                        Add Split
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {configIds.map((id) => (
                        <SharedBuybackCard key={id} configId={id} onRemoved={handleRemoved} />
                    ))}
                </div>
            )}

            {/* How it works — shown when configs exist */}
            {configIds.length > 0 && (
                <div className="border-t border-black/10 pt-6">
                    <h2 className="text-sm font-semibold font-funnel-sans text-black/60 mb-3">How it works</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                            {
                                n: "1",
                                title: "Register your split",
                                body: "Provide your existing 0xSplits contract. We provision a Turnkey-managed buyback wallet — you keep full custody.",
                            },
                            {
                                n: "2",
                                title: "Add wallet as recipient",
                                body: "Update your split to include the buyback wallet as a recipient. Your Safe proposal or a direct updateSplit call works.",
                            },
                            {
                                n: "3",
                                title: "Automatic buyback & burn",
                                body: "Every distribution accumulates in the wallet. Once the threshold is hit, it swaps everything to your token and burns it — minus the 5% fee.",
                            },
                        ].map((step) => (
                            <div key={step.n} className="bg-black/4 rounded-[14px] p-4 border border-black/10 space-y-1">
                                <p className="text-xs text-black/30 font-funnel-sans uppercase tracking-wide">Step {step.n}</p>
                                <p className="text-sm font-semibold text-black font-funnel-sans">{step.title}</p>
                                <p className="text-xs text-black/50 font-funnel-sans">{step.body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <RegisterModal
                open={showRegister}
                onClose={() => setShowRegister(false)}
                onRegistered={handleRegistered}
                defaultEmail={userEmail}
            />
        </div>
    );
}
