"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Copy, Check, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface DetectionResult {
    detected: boolean;
    getterName: string | null;
    setterName: string | null;
    currentRecipient: string | null;
    instruction: string;
}

interface RegisterResult {
    ok: boolean;
    configId: string;
    walletAddress: string;
    status: string;
    feeGetterName: string | null;
    instruction: string;
}

interface RegisterModalProps {
    open: boolean;
    onClose: () => void;
    onRegistered: (configId: string, walletAddress: string) => void;
    defaultEmail?: string;
}

type Step = "form" | "detecting" | "provisioning" | "ready";

export default function RegisterModal({ open, onClose, onRegistered, defaultEmail = "" }: RegisterModalProps) {
    const [step, setStep] = useState<Step>("form");
    const [detection, setDetection] = useState<DetectionResult | null>(null);
    const [result, setResult]   = useState<RegisterResult | null>(null);
    const [copied, setCopied]   = useState(false);

    const [form, setForm] = useState({
        tokenContractAddress: "",
        targetToken:          "",
        ownerAddress:         "",
        recoveryAddress:      "",
        userEmail:            defaultEmail,
        feeRateBps:           "500",
        thresholdUsd:         "10",
    });
    const [errors, setErrors] = useState<Partial<typeof form>>({});

    const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
        setErrors((er) => ({ ...er, [key]: undefined }));
    };

    function validate() {
        const errs: Partial<typeof form> = {};
        if (!ADDRESS_RE.test(form.tokenContractAddress)) errs.tokenContractAddress = "Invalid address";
        if (!ADDRESS_RE.test(form.targetToken))          errs.targetToken          = "Invalid address";
        if (!ADDRESS_RE.test(form.ownerAddress))         errs.ownerAddress         = "Invalid address";
        if (!ADDRESS_RE.test(form.recoveryAddress))      errs.recoveryAddress      = "Invalid address";
        if (!form.userEmail.includes("@"))               errs.userEmail            = "Invalid email";
        const bps = Number(form.feeRateBps);
        if (isNaN(bps) || bps < 0 || bps > 2000)        errs.feeRateBps           = "0–2000 bps";
        const thr = Number(form.thresholdUsd);
        if (isNaN(thr) || thr <= 0)                      errs.thresholdUsd         = "Must be > 0";
        setErrors(errs);
        return Object.keys(errs).length === 0;
    }

    async function handleDetect() {
        if (!ADDRESS_RE.test(form.tokenContractAddress)) {
            setErrors((e) => ({ ...e, tokenContractAddress: "Invalid address" }));
            return;
        }
        setStep("detecting");
        try {
            const res  = await fetch("/api/token-buyback/detect", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ tokenContractAddress: form.tokenContractAddress }),
            });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || "Detection failed"); setStep("form"); return; }
            setDetection(data as DetectionResult);
        } catch {
            toast.error("Detection failed");
        } finally {
            setStep("form");
        }
    }

    async function handleSubmit() {
        if (!validate()) return;
        setStep("provisioning");
        try {
            const res  = await fetch("/api/token-buyback/register", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    tokenContractAddress: form.tokenContractAddress,
                    targetToken:          form.targetToken,
                    ownerAddress:         form.ownerAddress,
                    recoveryAddress:      form.recoveryAddress,
                    userEmail:            form.userEmail,
                    feeRateBps:           Number(form.feeRateBps),
                    thresholdUsd:         Number(form.thresholdUsd),
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "Registration failed");
                setStep("form");
                return;
            }
            setResult(data as RegisterResult);
            onRegistered(data.configId, data.walletAddress);
            setStep("ready");
        } catch {
            toast.error("Registration failed");
            setStep("form");
        }
    }

    async function handleCopy() {
        if (!result?.walletAddress) return;
        await navigator.clipboard.writeText(result.walletAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    function handleClose() {
        if (step === "provisioning") return;
        setStep("form");
        setDetection(null);
        setResult(null);
        setErrors({});
        onClose();
    }

    const isProvisioning = step === "provisioning" || step === "detecting";

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
            <DialogContent className="sm:max-w-lg rounded-[20px]">
                <DialogHeader>
                    <DialogTitle className="font-funnel-display text-xl">
                        {step === "ready" ? "Buyback Wallet Ready" : "Register Token Contract"}
                    </DialogTitle>
                    {step !== "ready" && (
                        <p className="text-sm text-black/40 font-funnel-sans mt-1">
                            Provision a buyback wallet for your token contract&apos;s fee revenue.
                        </p>
                    )}
                </DialogHeader>

                {/* Provisioning spinner */}
                {isProvisioning && (
                    <div className="flex flex-col items-center justify-center py-12 gap-4">
                        <Loader2 className="w-8 h-8 animate-spin text-black/40" />
                        <p className="text-sm text-black/50 font-funnel-sans">
                            {step === "detecting" ? "Detecting fee pattern…" : "Provisioning Turnkey wallet…"}
                        </p>
                    </div>
                )}

                {/* Form */}
                {step === "form" && (
                    <div className="space-y-4 mt-2">
                        {/* Token contract with detect button */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-funnel-sans text-black/60 font-medium">
                                Token Contract Address
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="0x…"
                                    value={form.tokenContractAddress}
                                    onChange={field("tokenContractAddress")}
                                    className="font-mono text-xs rounded-[10px] border-black/20 flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleDetect}
                                    className="shrink-0 rounded-[10px] border-black/20 px-3 text-xs font-funnel-sans hover:bg-black/5"
                                >
                                    <Search className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                            {errors.tokenContractAddress && (
                                <p className="text-xs text-red-500 font-funnel-sans">{errors.tokenContractAddress}</p>
                            )}
                            {/* Detection result inline */}
                            {detection && (
                                <div className="bg-black/4 border border-black/10 rounded-[10px] px-3 py-2 text-xs font-funnel-sans space-y-0.5">
                                    {detection.detected ? (
                                        <>
                                            <p className="text-black/60">
                                                Detected: <span className="font-mono text-black">{detection.getterName}()</span>
                                            </p>
                                            <p className="text-black/40">
                                                Current: <span className="font-mono">{detection.currentRecipient?.slice(0, 10)}…</span>
                                            </p>
                                            <p className="text-black/50">
                                                You&apos;ll call: <span className="font-mono text-black">{detection.setterName}(&lt;wallet&gt;)</span>
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-black/50">No standard fee recipient getter detected — you&apos;ll receive generic instructions after provisioning.</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-funnel-sans text-black/60 font-medium">Target Token to Buy Back &amp; Burn</Label>
                            <Input placeholder="0x…" value={form.targetToken} onChange={field("targetToken")} className="font-mono text-xs rounded-[10px] border-black/20" />
                            {errors.targetToken && <p className="text-xs text-red-500 font-funnel-sans">{errors.targetToken}</p>}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-funnel-sans text-black/60 font-medium">Your Wallet (Owner)</Label>
                                <Input placeholder="0x…" value={form.ownerAddress} onChange={field("ownerAddress")} className="font-mono text-xs rounded-[10px] border-black/20" />
                                {errors.ownerAddress && <p className="text-xs text-red-500 font-funnel-sans">{errors.ownerAddress}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-funnel-sans text-black/60 font-medium">Recovery Address</Label>
                                <Input placeholder="0x…" value={form.recoveryAddress} onChange={field("recoveryAddress")} className="font-mono text-xs rounded-[10px] border-black/20" />
                                {errors.recoveryAddress && <p className="text-xs text-red-500 font-funnel-sans">{errors.recoveryAddress}</p>}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-funnel-sans text-black/60 font-medium">Email (Turnkey authenticator)</Label>
                            <Input type="email" placeholder="you@example.com" value={form.userEmail} onChange={field("userEmail")} className="text-xs rounded-[10px] border-black/20" />
                            {errors.userEmail && <p className="text-xs text-red-500 font-funnel-sans">{errors.userEmail}</p>}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-funnel-sans text-black/60 font-medium">
                                    Fee Rate ({((Number(form.feeRateBps) || 0) / 100).toFixed(1)}%)
                                </Label>
                                <Input
                                    type="number" min="0" max="2000"
                                    placeholder="500"
                                    value={form.feeRateBps}
                                    onChange={field("feeRateBps")}
                                    className="text-xs rounded-[10px] border-black/20"
                                />
                                {errors.feeRateBps && <p className="text-xs text-red-500 font-funnel-sans">{errors.feeRateBps}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-funnel-sans text-black/60 font-medium">Trigger Threshold (USD)</Label>
                                <Input
                                    type="number" min="1"
                                    placeholder="10"
                                    value={form.thresholdUsd}
                                    onChange={field("thresholdUsd")}
                                    className="text-xs rounded-[10px] border-black/20"
                                />
                                {errors.thresholdUsd && <p className="text-xs text-red-500 font-funnel-sans">{errors.thresholdUsd}</p>}
                            </div>
                        </div>

                        {/* Limitations notice */}
                        <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-2">
                            <p className="text-xs text-amber-700 font-funnel-sans">
                                <span className="font-semibold">Push-based only.</span> The buyback wallet must receive fees directly. Claim-based patterns (where fees accumulate inside the contract and require a manual pull) are not supported.
                            </p>
                        </div>

                        <Button
                            onClick={handleSubmit}
                            className="w-full bg-black text-white rounded-full font-funnel-sans text-sm hover:bg-black/80"
                        >
                            Provision Buyback Wallet
                        </Button>
                    </div>
                )}

                {/* Success state */}
                {step === "ready" && result && (
                    <div className="space-y-5 mt-2">
                        <div className="bg-black/4 border border-black/10 rounded-[14px] p-4 space-y-3">
                            <p className="text-xs text-black/40 font-funnel-sans uppercase tracking-wide">Buyback Wallet</p>
                            <div className="flex items-center gap-2">
                                <p className="font-mono text-sm text-black flex-1 break-all">{result.walletAddress}</p>
                                <button onClick={handleCopy} className="shrink-0 p-1.5 rounded-lg hover:bg-black/10 transition-colors">
                                    {copied
                                        ? <Check className="w-4 h-4 text-secondary-green" />
                                        : <Copy className="w-4 h-4 text-black/40" />
                                    }
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <p className="text-sm font-semibold font-funnel-sans text-black">Next step</p>
                            <div className="bg-secondary-orange/10 border border-secondary-orange/30 rounded-[12px] px-4 py-3">
                                <p className="text-sm text-secondary-orange font-funnel-sans">{result.instruction}</p>
                            </div>
                            <p className="text-xs text-black/40 font-funnel-sans">
                                Once fees start arriving in the wallet (≥ $0.10), buyback activates automatically — no further action needed.
                            </p>
                        </div>

                        <Button onClick={handleClose} className="w-full bg-black text-white rounded-full font-funnel-sans text-sm hover:bg-black/80">
                            Done
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
