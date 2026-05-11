"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { toast } from "sonner";
import { Copy, Check, ExternalLink } from "lucide-react";

type Step = "form" | "provisioning" | "ready";

interface RegisterModalProps {
    open: boolean;
    onClose: () => void;
    onRegistered: (configId: string, walletAddress: string) => void;
    defaultEmail?: string;
}

export default function RegisterModal({ open, onClose, onRegistered, defaultEmail = "" }: RegisterModalProps) {
    const [step, setStep] = useState<Step>("form");
    const [copied, setCopied] = useState(false);

    const [ownerAddress, setOwnerAddress] = useState("");
    const [splitAddress, setSplitAddress] = useState("");
    const [targetToken, setTargetToken] = useState("");
    const [recoveryAddress, setRecoveryAddress] = useState("");
    const [userEmail, setUserEmail] = useState(defaultEmail);
    const [feeRateBps, setFeeRateBps] = useState("500");
    const [thresholdUsd, setThresholdUsd] = useState("10");

    const [resultWallet, setResultWallet] = useState("");
    const [resultConfigId, setResultConfigId] = useState("");
    const [resultInstructions, setResultInstructions] = useState("");

    const isAddress = (val: string) => /^0x[0-9a-fA-F]{40}$/.test(val.trim());

    const handleRegister = async () => {
        if (!isAddress(ownerAddress)) { toast.error("Owner address is not a valid 0x address"); return; }
        if (!isAddress(splitAddress)) { toast.error("Split address is not a valid 0x address"); return; }
        if (!isAddress(targetToken)) { toast.error("Target token is not a valid 0x address"); return; }
        if (!isAddress(recoveryAddress)) { toast.error("Recovery address is not a valid 0x address"); return; }
        if (!userEmail.includes("@")) { toast.error("Enter a valid email address"); return; }

        const fee = parseInt(feeRateBps, 10);
        if (isNaN(fee) || fee < 0 || fee > 2000) { toast.error("Fee rate must be between 0 and 2000 bps"); return; }

        setStep("provisioning");

        try {
            const res = await fetch("/api/shared-buyback/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerAddress: ownerAddress.trim(),
                    splitAddress: splitAddress.trim(),
                    targetToken: targetToken.trim(),
                    recoveryAddress: recoveryAddress.trim(),
                    userEmail: userEmail.trim(),
                    feeRateBps: fee,
                    thresholdUsd: parseFloat(thresholdUsd) || 10,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "Registration failed");
                setStep("form");
                return;
            }
            setResultWallet(data.walletAddress);
            setResultConfigId(data.configId);
            setResultInstructions(data.instructions);
            setStep("ready");
            onRegistered(data.configId, data.walletAddress);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Unexpected error");
            setStep("form");
        }
    };

    const handleCopy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleClose = () => {
        setStep("form");
        setOwnerAddress("");
        setSplitAddress("");
        setTargetToken("");
        setRecoveryAddress("");
        setFeeRateBps("500");
        setThresholdUsd("10");
        setResultWallet("");
        setResultConfigId("");
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
            <DialogContent className="sm:max-w-lg rounded-[20px] flex flex-col max-h-[90vh]">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="font-funnel-display text-xl">
                        {step === "form" && "Set Up Shared Buyback"}
                        {step === "provisioning" && "Provisioning Wallet…"}
                        {step === "ready" && "Buyback Wallet Ready"}
                    </DialogTitle>
                    <DialogDescription className="font-funnel-sans text-sm text-black/40">
                        {step === "form" && "Connect your existing split to an automated buyback. A 5% platform fee applies per execution."}
                        {step === "provisioning" && "Creating your Turnkey-managed buyback wallet. This takes a few seconds."}
                        {step === "ready" && "Add the wallet address below to your split as a recipient to activate buyback."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 overflow-y-auto flex-1 min-h-0 py-2">
                    {step === "form" && (
                        <>
                            <div className="space-y-1">
                                <label className="text-sm font-semibold text-black font-funnel-sans">Your Safe / owner address</label>
                                <Input
                                    placeholder="0x…"
                                    value={ownerAddress}
                                    onChange={(e) => setOwnerAddress(e.target.value)}
                                    className="font-mono text-sm"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">The Safe that controls your split.</p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-sm font-semibold text-black font-funnel-sans">Existing split address</label>
                                <Input
                                    placeholder="0x…"
                                    value={splitAddress}
                                    onChange={(e) => setSplitAddress(e.target.value)}
                                    className="font-mono text-sm"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">The 0xSplits V2 contract already deployed on Base.</p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-sm font-semibold text-black font-funnel-sans">Token to buy back &amp; burn</label>
                                <Input
                                    placeholder="0x…"
                                    value={targetToken}
                                    onChange={(e) => setTargetToken(e.target.value)}
                                    className="font-mono text-sm"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">ERC-20 on Base. Revenue is swapped into this token and burned.</p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-sm font-semibold text-black font-funnel-sans">Recovery address</label>
                                <Input
                                    placeholder="0x…"
                                    value={recoveryAddress}
                                    onChange={(e) => setRecoveryAddress(e.target.value)}
                                    className="font-mono text-sm"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">Emergency sweep destination — your own EOA.</p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-sm font-semibold text-black font-funnel-sans">Your email</label>
                                <Input
                                    type="email"
                                    placeholder="you@example.com"
                                    value={userEmail}
                                    onChange={(e) => setUserEmail(e.target.value)}
                                    className="font-funnel-sans text-sm"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">Becomes the root authenticator on your Turnkey sub-org — you can revoke at any time.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-sm font-semibold text-black font-funnel-sans">Trigger threshold (USD)</label>
                                    <Input
                                        type="number"
                                        min="10"
                                        step="1"
                                        value={thresholdUsd}
                                        onChange={(e) => setThresholdUsd(e.target.value)}
                                        onWheel={(e) => e.currentTarget.blur()}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-semibold text-black font-funnel-sans">Fee rate (bps)</label>
                                    <Input
                                        type="number"
                                        min="0"
                                        max="2000"
                                        step="50"
                                        value={feeRateBps}
                                        onChange={(e) => setFeeRateBps(e.target.value)}
                                        onWheel={(e) => e.currentTarget.blur()}
                                    />
                                    <p className="text-xs text-black/40 font-funnel-sans">500 = 5%</p>
                                </div>
                            </div>
                        </>
                    )}

                    {step === "provisioning" && (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="animate-spin h-10 w-10 border-2 border-black/40 border-t-transparent rounded-full" />
                            <p className="text-sm text-black/60 font-funnel-sans text-center">
                                Setting up your Turnkey buyback wallet<br />
                                <span className="text-black/30 text-xs">Running token safety checks and provisioning the sub-org…</span>
                            </p>
                        </div>
                    )}

                    {step === "ready" && (
                        <div className="space-y-4">
                            <div className="bg-secondary-green/10 border border-secondary-green/30 rounded-[12px] p-4">
                                <p className="text-sm font-semibold text-secondary-green font-funnel-sans">Wallet provisioned successfully</p>
                                <p className="text-xs text-black/60 font-funnel-sans mt-1">
                                    Your Turnkey sub-org is live. You are the root authenticator — you can revoke access at any time via email.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-black/60 font-funnel-sans uppercase tracking-wide">Buyback wallet address</label>
                                <div className="flex items-center gap-2 bg-black/4 rounded-[10px] px-3 py-2 border border-black/10">
                                    <span className="font-mono text-sm text-black flex-1 break-all">{resultWallet}</span>
                                    <button
                                        onClick={() => handleCopy(resultWallet)}
                                        className="shrink-0 p-1 rounded hover:bg-black/10 transition-colors"
                                    >
                                        {copied ? <Check className="w-4 h-4 text-secondary-green" /> : <Copy className="w-4 h-4 text-black/40" />}
                                    </button>
                                </div>
                            </div>

                            <div className="bg-black/4 rounded-[12px] p-4 border border-black/10 space-y-2">
                                <p className="text-sm font-semibold text-black font-funnel-sans">Next step</p>
                                <p className="text-sm text-black/60 font-funnel-sans">{resultInstructions}</p>
                                <p className="text-xs text-black/40 font-funnel-sans">
                                    Once added, the buyback service detects it automatically within 5 minutes and begins executing on every distribution.
                                </p>
                            </div>

                            <a
                                href={`https://app.safe.global/transactions/queue?safe=base:${ownerAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-secondary-blue font-funnel-sans hover:underline"
                            >
                                Open Safe app <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex gap-3 pt-4 shrink-0">
                    {step === "form" && (
                        <>
                            <Button
                                variant="outline"
                                onClick={handleClose}
                                className="rounded-full border-black/20 text-black/60 font-funnel-sans"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleRegister}
                                className="rounded-full bg-black text-white font-funnel-sans hover:bg-black/80"
                            >
                                Set Up Buyback
                            </Button>
                        </>
                    )}
                    {step === "ready" && (
                        <Button
                            onClick={handleClose}
                            className="rounded-full bg-black text-white font-funnel-sans hover:bg-black/80 w-full"
                        >
                            Done
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
