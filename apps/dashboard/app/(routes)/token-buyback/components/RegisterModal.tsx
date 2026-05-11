"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Copy, Check, Search, Loader2, AlertTriangle, XCircle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { usePrivy } from "@privy-io/react-auth";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface DetectionResult {
    detected: boolean;
    getterName: string | null;
    setterName: string | null;
    currentRecipient: string | null;
    instruction: string;
    ownership: {
        ownerAddress: string | null;
        ownerIsContract: boolean;
        callerIsOwner: boolean | null;
    };
}

interface RegisterResult {
    ok: boolean;
    configId: string;
    walletAddress: string;
    status: string;
    feeGetterName: string | null;
    setterName: string | null;
    instruction: string;
    onChainOwnerAddress: string | null;
    ownerIsContract: boolean;
    callerIsOwner: boolean | null;
}

interface RegisterModalProps {
    open: boolean;
    onClose: () => void;
    onRegistered: (configId: string, walletAddress: string) => void;
    defaultEmail?: string;
}

type Step = "form" | "detecting" | "provisioning" | "ready";

function truncate(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function RegisterModal({ open, onClose, onRegistered, defaultEmail = "" }: RegisterModalProps) {
    const { user: privyUser } = usePrivy();
    const connectedAddress = privyUser?.wallet?.address ?? "";

    const [step, setStep] = useState<Step>("form");
    const [detection, setDetection] = useState<DetectionResult | null>(null);
    const [result, setResult] = useState<RegisterResult | null>(null);
    const [copied, setCopied] = useState(false);

    const [form, setForm] = useState({
        tokenContractAddress: "",
        targetToken:          "",
        recoveryAddress:      "",
        userEmail:            defaultEmail,
        thresholdUsd:         "10",
    });
    const [errors, setErrors] = useState<Partial<typeof form>>({});

    const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
        setErrors((er) => ({ ...er, [key]: undefined }));
        // Clear detection when contract address changes
        if (key === "tokenContractAddress") setDetection(null);
    };

    function validate() {
        const errs: Partial<typeof form> = {};
        if (!ADDRESS_RE.test(form.tokenContractAddress)) errs.tokenContractAddress = "Invalid address";
        if (!ADDRESS_RE.test(form.targetToken))          errs.targetToken          = "Invalid address";
        if (!ADDRESS_RE.test(form.recoveryAddress))      errs.recoveryAddress      = "Invalid address";
        if (!form.userEmail.includes("@"))               errs.userEmail            = "Invalid email";
        const thr = Number(form.thresholdUsd);
        if (isNaN(thr) || thr < 10)                      errs.thresholdUsd         = "Minimum $10";
        setErrors(errs);
        return Object.keys(errs).length === 0;
    }

    async function handleDetect() {
        if (!ADDRESS_RE.test(form.tokenContractAddress)) {
            setErrors((e) => ({ ...e, tokenContractAddress: "Invalid address" }));
            return;
        }
        setDetection(null);
        setStep("detecting");
        try {
            const res = await fetch("/api/token-buyback/detect", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    tokenContractAddress: form.tokenContractAddress,
                    callerAddress:        connectedAddress || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || "Detection failed"); return; }
            setDetection(data as DetectionResult);
        } catch {
            toast.error("Detection failed");
        } finally {
            setStep("form");
        }
    }

    async function handleSubmit() {
        if (!validate()) return;
        if (!detection?.detected) {
            toast.error("Run detection first and confirm the contract is supported");
            return;
        }
        setStep("provisioning");
        try {
            const res = await fetch("/api/token-buyback/register", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    tokenContractAddress: form.tokenContractAddress,
                    targetToken:          form.targetToken,
                    ownerAddress:         connectedAddress || form.recoveryAddress,
                    recoveryAddress:      form.recoveryAddress,
                    userEmail:            form.userEmail,
                    thresholdUsd:         Number(form.thresholdUsd) || 10,
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
        if (step === "provisioning" || step === "detecting") return;
        setStep("form");
        setDetection(null);
        setResult(null);
        setErrors({});
        onClose();
    }

    // Detection state banner
    function DetectionBanner() {
        if (!detection) return null;

        if (!detection.detected) {
            return (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-[10px] px-3 py-2.5">
                    <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-semibold text-red-700 font-funnel-sans">Not supported</p>
                        <p className="text-xs text-red-600 font-funnel-sans mt-0.5">
                            This contract has no updatable fee recipient. Use <span className="font-semibold">Shared Buyback</span> instead.
                        </p>
                    </div>
                </div>
            );
        }

        const { ownerAddress, ownerIsContract, callerIsOwner } = detection.ownership;

        // Owner is a Safe/multisig
        if (ownerIsContract) {
            return (
                <div className="flex items-start gap-2 bg-secondary-blue/10 border border-secondary-blue/30 rounded-[10px] px-3 py-2.5">
                    <CheckCircle className="w-4 h-4 text-secondary-blue shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-semibold text-secondary-blue font-funnel-sans">
                            Supported — Safe/multisig owner
                        </p>
                        <p className="text-xs text-secondary-blue/80 font-funnel-sans mt-0.5">
                            Getter: <span className="font-mono">{detection.getterName}()</span>
                            {ownerAddress && <> · Owner: <span className="font-mono">{truncate(ownerAddress)}</span></>}
                        </p>
                        <p className="text-xs text-secondary-blue/70 font-funnel-sans mt-1">
                            After provisioning you&apos;ll get a Safe TX builder link to propose the fee recipient update.
                        </p>
                    </div>
                </div>
            );
        }

        // Caller is not the owner
        if (callerIsOwner === false && ownerAddress) {
            return (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-xs font-semibold text-amber-700 font-funnel-sans">
                            Supported — wrong wallet connected
                        </p>
                        <p className="text-xs text-amber-600 font-funnel-sans mt-0.5">
                            Getter: <span className="font-mono">{detection.getterName}()</span>
                            {" · "}Owner: <span className="font-mono">{truncate(ownerAddress)}</span>
                        </p>
                        <p className="text-xs text-amber-600/80 font-funnel-sans mt-1">
                            You can still provision the wallet, but you&apos;ll need to switch to the owner wallet to sign the fee recipient transaction.
                        </p>
                    </div>
                </div>
            );
        }

        // All good — caller is owner
        return (
            <div className="flex items-start gap-2 bg-secondary-green/10 border border-secondary-green/30 rounded-[10px] px-3 py-2.5">
                <CheckCircle className="w-4 h-4 text-secondary-green shrink-0 mt-0.5" />
                <div>
                    <p className="text-xs font-semibold text-secondary-green font-funnel-sans">Supported</p>
                    <p className="text-xs text-secondary-green/80 font-funnel-sans mt-0.5">
                        Getter: <span className="font-mono">{detection.getterName}()</span>
                        {" · "}Setter: <span className="font-mono">{detection.setterName}(address)</span>
                    </p>
                    <p className="text-xs text-secondary-green/70 font-funnel-sans mt-1">
                        After provisioning you&apos;ll sign the fee recipient update directly from this wallet.
                    </p>
                </div>
            </div>
        );
    }

    const canProvision = detection?.detected === true;
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

                {isProvisioning && (
                    <div className="flex flex-col items-center justify-center py-12 gap-4">
                        <Loader2 className="w-8 h-8 animate-spin text-black/40" />
                        <p className="text-sm text-black/50 font-funnel-sans">
                            {step === "detecting" ? "Checking contract…" : "Provisioning Turnkey wallet…"}
                        </p>
                    </div>
                )}

                {step === "form" && (
                    <div className="space-y-4 mt-2">
                        {/* Token contract with detect */}
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
                                    disabled={!form.tokenContractAddress}
                                    className="shrink-0 rounded-[10px] border-black/20 px-3 hover:bg-black/5"
                                >
                                    <Search className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                            {errors.tokenContractAddress && (
                                <p className="text-xs text-red-500 font-funnel-sans">{errors.tokenContractAddress}</p>
                            )}
                        </div>

                        {/* Detection result */}
                        <DetectionBanner />

                        {/* Rest of form — only shown when supported */}
                        {canProvision && (
                            <>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-funnel-sans text-black/60 font-medium">Target Token to Buy Back &amp; Burn</Label>
                                    <Input placeholder="0x…" value={form.targetToken} onChange={field("targetToken")} className="font-mono text-xs rounded-[10px] border-black/20" />
                                    {errors.targetToken && <p className="text-xs text-red-500 font-funnel-sans">{errors.targetToken}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-xs font-funnel-sans text-black/60 font-medium">Recovery Address</Label>
                                    <Input placeholder="0x…" value={form.recoveryAddress} onChange={field("recoveryAddress")} className="font-mono text-xs rounded-[10px] border-black/20" />
                                    {errors.recoveryAddress && <p className="text-xs text-red-500 font-funnel-sans">{errors.recoveryAddress}</p>}
                                    <p className="text-xs text-black/40 font-funnel-sans">Emergency sweep destination — your own EOA.</p>
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-xs font-funnel-sans text-black/60 font-medium">Email (Turnkey authenticator)</Label>
                                    <Input type="email" placeholder="you@example.com" value={form.userEmail} onChange={field("userEmail")} className="text-xs rounded-[10px] border-black/20" />
                                    {errors.userEmail && <p className="text-xs text-red-500 font-funnel-sans">{errors.userEmail}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-xs font-funnel-sans text-black/60 font-medium">Trigger Threshold (USD)</Label>
                                    <Input
                                        type="number" min="10" step="1"
                                        placeholder="10"
                                        value={form.thresholdUsd}
                                        onChange={field("thresholdUsd")}
                                        className="text-xs rounded-[10px] border-black/20"
                                    />
                                    {errors.thresholdUsd && <p className="text-xs text-red-500 font-funnel-sans">{errors.thresholdUsd}</p>}
                                    <p className="text-xs text-black/40 font-funnel-sans">Minimum $10.</p>
                                </div>

                                <Button
                                    onClick={handleSubmit}
                                    className="w-full bg-black text-white rounded-full font-funnel-sans text-sm hover:bg-black/80"
                                >
                                    Provision Buyback Wallet
                                </Button>
                            </>
                        )}

                        {/* Not supported — suggest shared buyback */}
                        {detection && !detection.detected && (
                            <p className="text-xs text-black/40 font-funnel-sans text-center">
                                Go to <span className="text-black font-medium">Buybacks</span> to set up a shared buyback for this token instead.
                            </p>
                        )}
                    </div>
                )}

                {/* Success */}
                {step === "ready" && result && (
                    <div className="space-y-5 mt-2">
                        <div className="bg-black/4 border border-black/10 rounded-[14px] p-4 space-y-3">
                            <p className="text-xs text-black/40 font-funnel-sans uppercase tracking-wide">Buyback Wallet</p>
                            <div className="flex items-center gap-2">
                                <p className="font-mono text-sm text-black flex-1 break-all">{result.walletAddress}</p>
                                <button onClick={handleCopy} className="shrink-0 p-1.5 rounded-lg hover:bg-black/10 transition-colors">
                                    {copied ? <Check className="w-4 h-4 text-secondary-green" /> : <Copy className="w-4 h-4 text-black/40" />}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <p className="text-sm font-semibold font-funnel-sans text-black">Next step</p>
                            <div className="bg-secondary-orange/10 border border-secondary-orange/30 rounded-[12px] px-4 py-3">
                                <p className="text-sm text-secondary-orange font-funnel-sans">{result.instruction}</p>
                            </div>
                            <p className="text-xs text-black/40 font-funnel-sans">
                                The card on the dashboard has a <span className="font-medium text-black/60">Set Fee Recipient</span> button — click it to sign the transaction directly from your wallet.
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
