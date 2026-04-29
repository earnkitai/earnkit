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

// Token balance interface
interface TokenBalance {
    symbol: string;
    address: string;
    balance: string;
    balanceUsd: number;
}

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    agentDbId: string; // Database UUID for API calls
    agentId: string; // String identifier for contract calls
    availableBalance: number; // ETH balance in USD
    availableBalanceEth?: number; // ETH balance in ETH
    tokenBalances?: TokenBalance[]; // Token balances
    onWithdrawSuccess?: () => void;
}

type AssetType = 'ETH' | string; // 'ETH' or token symbol

export default function WithdrawModal({
    isOpen,
    onClose,
    agentDbId,
    agentId,
    availableBalance,
    availableBalanceEth = 0,
    tokenBalances = [],
    onWithdrawSuccess,
}: WithdrawModalProps) {
    const [amount, setAmount] = useState("");
    const [recipientAddress, setRecipientAddress] = useState("");
    const [selectedAsset, setSelectedAsset] = useState<AssetType>('ETH');
    const [withdrawData, setWithdrawData] = useState<{
        agentId: string;
        amount: string;
        to: string;
        isToken: boolean;
        tokenAddress?: string;
        tokenSymbol?: string;
    } | null>(null);
    const [feeCalculation, setFeeCalculation] = useState<{
        amount: number;
        fee: number;
        net: number;
        platformFeeBps: number;
    } | null>(null);
    const [step, setStep] = useState<'form' | 'confirm' | 'executing' | 'splits-info'>('form');
    const [splitAddress, setSplitAddress] = useState<string>('');
    // Use agentDbId for API calls (database UUID)
    const { executeWithdrawal, executeTokenWithdrawal, calculateFees, loading: executeLoading, isReady } = useWithdraw(agentDbId, agentId);

    // Get current balance based on selected asset
    const getCurrentBalance = () => {
        if (selectedAsset === 'ETH') {
            return { balance: availableBalanceEth, balanceUsd: availableBalance, symbol: 'ETH' };
        }
        const token = tokenBalances.find(t => t.symbol === selectedAsset);
        return token 
            ? { balance: parseFloat(token.balance), balanceUsd: token.balanceUsd, symbol: token.symbol }
            : { balance: 0, balanceUsd: 0, symbol: selectedAsset };
    };

    const currentBalance = getCurrentBalance();

    // Get all available assets (ETH + tokens with balance)
    const availableAssets = [
        { symbol: 'ETH', balance: availableBalanceEth, balanceUsd: availableBalance },
        ...tokenBalances.filter(t => parseFloat(t.balance) > 0).map(t => ({
            symbol: t.symbol,
            balance: parseFloat(t.balance),
            balanceUsd: t.balanceUsd,
            address: t.address
        }))
    ];

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

        // Add small tolerance for floating point comparison (0.01% of balance)
        const tolerance = currentBalance.balance * 0.0001;
        if (withdrawAmount > currentBalance.balance + tolerance) {
            console.log(withdrawAmount, currentBalance.balance, 'withdrawAmount, currentBalance');
            toast.error("Amount exceeds available balance");
            return;
        }

        if (!isReady) {
            toast.error("Please connect your wallet first");
            return;
        }

        try {
            // Calculate fees (use balance amount for tokens, USD for ETH)
            const feeBasis = selectedAsset === 'ETH' 
                ? withdrawAmount * (availableBalance / availableBalanceEth) // Convert ETH to USD for fee calc
                : withdrawAmount; // Token amount
            const fees = await calculateFees(feeBasis);
            setFeeCalculation({
                ...fees,
                amount: withdrawAmount, // Store actual amount being withdrawn
            });

            // Set withdraw data
            const isToken = selectedAsset !== 'ETH';
            const token = isToken ? tokenBalances.find(t => t.symbol === selectedAsset) : null;
            
            setWithdrawData({
                agentId: agentId,
                amount: amount,
                to: recipientAddress,
                isToken,
                tokenAddress: token?.address,
                tokenSymbol: token?.symbol,
            });
            setStep('confirm');
        } catch (error) {
            console.error("Error calculating fees:", error);
            toast.error("Failed to calculate fees. Please try again.");
        }
    };

    const handleMaxAmount = () => {
        // Use floor to avoid rounding up beyond available balance
        const decimals = selectedAsset === 'ETH' ? 8 : 6;
        const multiplier = Math.pow(10, decimals);
        const flooredAmount = Math.floor(currentBalance.balance * multiplier) / multiplier;
        setAmount(flooredAmount.toString());
    };

    const handleExecuteWithdrawal = async () => {
        if (!withdrawData) return;

        setStep('executing');

        try {
            console.log(withdrawData, 'withdrawData');
            
            let result;
            if (withdrawData.isToken && withdrawData.tokenAddress && withdrawData.tokenSymbol) {
                // Token withdrawal
                result = await executeTokenWithdrawal({
                    agentId: withdrawData.agentId,
                    tokenAddress: withdrawData.tokenAddress,
                    tokenSymbol: withdrawData.tokenSymbol,
                    amount: withdrawData.amount,
                    to: withdrawData.to,
                });
            } else {
                // ETH withdrawal (need to convert ETH amount to USD for the existing API)
                const ethAmount = parseFloat(withdrawData.amount);
                const usdAmount = ethAmount * (availableBalance / availableBalanceEth);
                result = await executeWithdrawal({
                    agentId: withdrawData.agentId,
                    amount: usdAmount.toString(),
                    to: withdrawData.to,
                });
            }

            console.log("Withdrawal result:", result);

            // Splits agents: funds are already in the split contract; user must call distribute()
            if ((result as any).withdrawalMode === 'splits') {
                setSplitAddress((result as any).splitAddress ?? '');
                setStep('splits-info');
                return;
            }

            toast.success("Withdrawal executed successfully!");
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
        setSelectedAsset('ETH');
        setWithdrawData(null);
        setFeeCalculation(null);
        setStep('form');
        setSplitAddress('');
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
                        {step === 'splits-info' && 'Distribute Your Funds'}
                    </DialogTitle>
                    <DialogDescription className="text-black/40 text-sm font-funnel-sans">
                        {step === 'form' && 'Withdraw funds from your agent\'s balance. A platform fee will be deducted.'}
                        {step === 'confirm' && 'Review the withdrawal details and confirm the transaction.'}
                        {step === 'executing' && 'Please wait while we execute your withdrawal...'}
                        {step === 'splits-info' && 'Your agent uses Splits Protocol. Call distribute() to push funds to your wallet.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-2">
                    {step === 'form' && (
                        <>
                            {/* Asset Selector */}
                            {availableAssets.length > 1 && (
                                <div className="space-y-3">
                                    <label className="block text-sm font-semibold text-black font-funnel-sans">
                                        Select Asset
                                    </label>
                                    <div className="flex gap-2 flex-wrap">
                                        {availableAssets.map((asset) => (
                                            <button
                                                key={asset.symbol}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedAsset(asset.symbol);
                                                    setAmount(""); // Reset amount when switching assets
                                                }}
                                                className={`px-4 py-2 rounded-[12px] border text-sm font-funnel-sans transition-colors ${
                                                    selectedAsset === asset.symbol
                                                        ? 'bg-secondary-green text-white border-secondary-green'
                                                        : 'bg-white text-black border-black/20 hover:border-secondary-green'
                                                }`}
                                            >
                                                <span className="font-semibold">{asset.symbol}</span>
                                                <span className="ml-2 text-xs opacity-70">
                                                    {asset.balance.toFixed(asset.symbol === 'ETH' ? 5 : 2)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Available Balance */}
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-sm text-black/40 font-funnel-sans mb-1">
                                    Available {selectedAsset} Balance
                                </p>
                                <p className="text-lg font-semibold text-secondary-green font-funnel-sans">
                                    {currentBalance.balance.toFixed(selectedAsset === 'ETH' ? 6 : 2)} {selectedAsset}
                                </p>
                                {currentBalance.balanceUsd > 0 && (
                                    <p className="text-xs text-black/40 font-funnel-sans mt-1">
                                        ≈ ${currentBalance.balanceUsd.toFixed(2)} USD
                                    </p>
                                )}
                            </div>

                            {/* Amount Input */}
                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-black font-funnel-sans">
                                    Amount ({selectedAsset})
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        step={selectedAsset === 'ETH' ? '0.0001' : '1'}
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="flex-1 rounded-[12px] border border-black/20 focus:border-secondary-green focus:ring-0"
                                    />
                                    <Button
                                        type="button"
                                        onClick={handleMaxAmount}
                                        variant="outline"
                                        className="px-4 py-2 rounded-[12px] border border-secondary-green text-secondary-green hover:bg-secondary-green hover:text-white font-funnel-sans"
                                    >
                                        Max
                                    </Button>
                                </div>
                                <p className="text-xs text-black/40 font-funnel-sans">
                                    Maximum: {currentBalance.balance.toFixed(selectedAsset === 'ETH' ? 6 : 2)} {selectedAsset}
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
                                    Enter the wallet address to receive the {selectedAsset}
                                </p>
                            </div>
                        </>
                    )}

                    {step === 'confirm' && withdrawData && feeCalculation && (
                        <>
                            {/* Withdrawal Summary */}
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <h3 className="text-lg font-semibold text-black font-funnel-sans mb-3">Withdrawal Summary</h3>

                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Asset:</span>
                                        <span className="text-sm font-semibold text-black font-funnel-sans">
                                            {withdrawData.isToken ? withdrawData.tokenSymbol : 'ETH'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Amount:</span>
                                        <span className="text-sm font-semibold text-black font-funnel-sans">
                                            {feeCalculation.amount.toFixed(withdrawData.isToken ? 2 : 6)} {withdrawData.isToken ? withdrawData.tokenSymbol : 'ETH'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Platform Fee ({(feeCalculation.platformFeeBps / 100).toFixed(1)}%):</span>
                                        <span className="text-sm font-semibold text-red-500 font-funnel-sans">
                                            -{feeCalculation.fee.toFixed(withdrawData.isToken ? 2 : 6)} {withdrawData.isToken ? withdrawData.tokenSymbol : 'ETH'}
                                        </span>
                                    </div>
                                    <div className="border-t border-black/10 pt-2">
                                        <div className="flex justify-between">
                                            <span className="text-sm font-semibold text-black font-funnel-sans">You&apos;ll Receive:</span>
                                            <span className="text-sm font-semibold text-secondary-green font-funnel-sans">
                                                {feeCalculation.net.toFixed(withdrawData.isToken ? 2 : 6)} {withdrawData.isToken ? withdrawData.tokenSymbol : 'ETH'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Recipient Address */}
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-sm text-black/60 font-funnel-sans mb-1">Recipient Address</p>
                                <p className="text-sm font-mono text-black font-funnel-sans">
                                    {withdrawData.to}
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

                    {step === 'splits-info' && (
                        <div className="space-y-4">
                            <div className="bg-blue-50 rounded-[12px] p-4 border border-blue-100">
                                <p className="text-sm font-semibold text-blue-800 font-funnel-sans mb-2">
                                    How to receive your funds
                                </p>
                                <ol className="text-sm text-blue-700 font-funnel-sans space-y-1 list-decimal list-inside">
                                    <li>Go to app.splits.org</li>
                                    <li>Connect the wallet you used when creating this agent</li>
                                    <li>Find your split at the address below</li>
                                    <li>Click &quot;Distribute&quot; to push funds to all recipients</li>
                                </ol>
                            </div>
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-xs text-black/40 font-funnel-sans mb-1">Split Contract Address</p>
                                <p className="text-sm font-mono text-black break-all font-funnel-sans">{splitAddress}</p>
                            </div>
                            <p className="text-xs text-black/40 font-funnel-sans">
                                The 5% platform fee and any buyback percentage are distributed automatically when you call distribute().
                            </p>
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
                                disabled={!amount || !recipientAddress || !isReady}
                                className="flex-1 bg-secondary-green hover:bg-green-700 text-white rounded-full font-funnel-sans"
                            >
                                Confirm
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
                                {executeLoading ? "Executing..." : "Withdraw"}
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

                    {step === 'splits-info' && (
                        <Button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 bg-secondary-green hover:bg-green-700 text-white rounded-full font-funnel-sans"
                        >
                            Done
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
