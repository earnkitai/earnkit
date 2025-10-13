"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";
import { toast } from "sonner";
import { useWithdraw } from "../hooks/useWithdraw";

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    agentId: string;
    availableBalance: number;
    onWithdrawSuccess?: () => void;
}

export default function WithdrawModal({
    isOpen,
    onClose,
    agentId,
    availableBalance,
    onWithdrawSuccess,
}: WithdrawModalProps) {
    const [amount, setAmount] = useState("");
    const [recipientAddress, setRecipientAddress] = useState("");
    const [loading, setLoading] = useState(false);
    const [withdrawData, setWithdrawData] = useState<{
        signature: { v: number; r: string; s: string };
        withdrawal: {
            agentId: string;
            amount: string;
            to: string;
            deadline: string;
            totalAmount: { eth: number; usd: number };
            fee: { eth: number; usd: number };
            net: { eth: number; usd: number };
            recipient: string;
        };
    } | null>(null);
    const [step, setStep] = useState<'form' | 'confirm' | 'executing'>('form');
    const { executeWithdrawal, loading: executeLoading, isReady } = useWithdraw(agentId);

    const handleWithdraw = async () => {
        if (!amount || !recipientAddress) {
            toast.error("Please fill in all fields");
            return;
        }

        const withdrawAmount = parseFloat(amount);
        if (withdrawAmount <= 0) {
            toast.error("Amount must be greater than 0");
            return;
        }

        if (withdrawAmount > availableBalance) {
            toast.error("Amount exceeds available balance");
            return;
        }

        if (!isReady) {
            toast.error("Please connect your wallet first");
            return;
        }

        setLoading(true);

        try {
            // Step 1: Get signature from backend
            const response = await fetch(`/api/agents/${agentId}/withdraw`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    amount: amount,
                    toAddress: recipientAddress,
                }),
            });

            const data = await response.json();

            if (response.ok) {
                setWithdrawData(data);
                setStep('confirm');
                toast.success("Signature generated! Review withdrawal details.");
            } else {
                toast.error(data.error || "Failed to generate signature");
            }
        } catch (error) {
            console.error("Error generating signature:", error);
            toast.error("An error occurred while generating signature");
        } finally {
            setLoading(false);
        }
    };

    const handleExecuteWithdrawal = async () => {
        if (!withdrawData) return;

        setStep('executing');

        try {

            console.log(withdrawData, 'withdrawData');
            const result = await executeWithdrawal(withdrawData);

            toast.success("Withdrawal executed successfully!");
            console.log("Withdrawal transaction:", result);

            // Show transaction hash
            if (result.transactionHash) {
                toast.success(`Transaction: ${result.transactionHash.slice(0, 10)}...`);
            }

            onWithdrawSuccess?.();
            onClose();
        } catch (error) {
            console.error("Error executing withdrawal:", error);
            toast.error("Failed to execute withdrawal transaction");
            setStep('confirm');
        }
    };

    const handleClose = () => {
        setAmount("");
        setRecipientAddress("");
        setWithdrawData(null);
        setStep('form');
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md rounded-[20px] shadow-none border border-black/10">
                <DialogHeader className="pb-4">
                    <DialogTitle className="text-xl font-semibold text-black font-funnel-display">
                        {step === 'form' && 'Withdraw Funds'}
                        {step === 'confirm' && 'Confirm Withdrawal'}
                        {step === 'executing' && 'Executing Withdrawal'}
                    </DialogTitle>
                    <DialogDescription className="text-black/40 text-sm font-funnel-sans">
                        {step === 'form' && 'Withdraw funds from your agent\'s balance. A platform fee will be deducted.'}
                        {step === 'confirm' && 'Review the withdrawal details and confirm the transaction.'}
                        {step === 'executing' && 'Please wait while we execute your withdrawal...'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-2">
                    {step === 'form' && (
                        <>
                            {/* Available Balance */}
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-sm text-black/40 font-funnel-sans mb-1">Available Balance</p>
                                <p className="text-lg font-semibold text-secondary-green font-funnel-sans">
                                    ${availableBalance.toFixed(2)}
                                </p>
                            </div>

                            {/* Amount Input */}
                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-black font-funnel-sans">
                                    Amount (USD)
                                </label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="w-full rounded-[12px] border border-black/20 focus:border-secondary-green focus:ring-0"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">
                                    Maximum: ${availableBalance.toFixed(2)}
                                </p>
                            </div>

                            {/* Recipient Address */}
                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-black font-funnel-sans">
                                    Recipient Address
                                </label>
                                <Input
                                    type="text"
                                    placeholder="0x..."
                                    value={recipientAddress}
                                    onChange={(e) => setRecipientAddress(e.target.value)}
                                    className="w-full font-mono text-sm rounded-[12px] border border-black/20 focus:border-secondary-green focus:ring-0"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">
                                    Enter the wallet address to receive the funds
                                </p>
                            </div>
                        </>
                    )}

                    {step === 'confirm' && withdrawData && (
                        <>
                            {/* Withdrawal Summary */}
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <h3 className="text-lg font-semibold text-black font-funnel-sans mb-3">Withdrawal Summary</h3>

                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Amount:</span>
                                        <span className="text-sm font-semibold text-black font-funnel-sans">
                                            ${withdrawData.withdrawal.totalAmount.usd.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Platform Fee:</span>
                                        <span className="text-sm font-semibold text-red-500 font-funnel-sans">
                                            -${withdrawData.withdrawal.fee.usd.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="border-t border-black/10 pt-2">
                                        <div className="flex justify-between">
                                            <span className="text-sm font-semibold text-black font-funnel-sans">You&apos;ll Receive:</span>
                                            <span className="text-sm font-semibold text-secondary-green font-funnel-sans">
                                                ${withdrawData.withdrawal.net.usd.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Recipient Address */}
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-sm text-black/60 font-funnel-sans mb-1">Recipient Address</p>
                                <p className="text-sm font-mono text-black font-funnel-sans">
                                    {withdrawData.withdrawal.recipient}
                                </p>
                            </div>
                        </>
                    )}

                    {step === 'executing' && (
                        <div className="flex items-center justify-center py-8">
                            <div className="text-center">
                                <div className="animate-spin h-8 w-8 border-2 border-secondary-green border-t-transparent rounded-full mx-auto mb-4"></div>
                                <p className="text-black/60 font-funnel-sans">Executing withdrawal...</p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex gap-3 pt-6">
                    {step === 'form' && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleClose}
                                className="flex-1 rounded-full border border-black/20 text-black hover:bg-gray-50 font-funnel-sans"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={handleWithdraw}
                                disabled={loading || !amount || !recipientAddress || !isReady}
                                className="flex-1 bg-secondary-green hover:bg-green-700 text-white rounded-full font-funnel-sans"
                            >
                                {loading ? "Processing..." : "Confirm"}
                            </Button>
                        </>
                    )}

                    {step === 'confirm' && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setStep('form')}
                                className="flex-1 rounded-full border border-black/20 text-black hover:bg-gray-50 font-funnel-sans"
                            >
                                Back
                            </Button>
                            <Button
                                type="button"
                                onClick={handleExecuteWithdrawal}
                                disabled={executeLoading}
                                className="flex-1 bg-secondary-green hover:bg-green-700 text-white rounded-full font-funnel-sans"
                            >
                                {executeLoading ? "Executing..." : "Withdrawal"}
                            </Button>
                        </>
                    )}

                    {step === 'executing' && (
                        <div className="flex-1 text-center">
                            <p className="text-sm text-black/60 font-funnel-sans">
                                Please wait while we process your withdrawal...
                            </p>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
