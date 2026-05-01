"use client";

import { useEffect, useState } from "react";
import { parseEther } from "viem";
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
import { type SplitRecipientConfig } from "@/lib/payment-routing";
import { useWithdraw } from "../hooks/useWithdraw";

interface TokenBalance {
    symbol: string;
    address: string;
    balance: string;
    balanceUsd: number;
}

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    agentDbId: string;
    agentId: string;
    availableBalance: number;
    availableBalanceEth?: number;
    tokenBalances?: TokenBalance[];
    paymentMode: "escrow" | "splits";
    paymentAddress: string;
    splitAddress?: string | null;
    buybackPercent?: number;
    developerSplitPercent?: number;
    platformFeePercent?: number;
    splitRecipients?: SplitRecipientConfig[];
    onWithdrawSuccess?: () => void;
}

type AssetType = "ETH" | string;
type ModalStep = "form" | "confirm" | "executing" | "split-review";

export default function WithdrawModal({
    isOpen,
    onClose,
    agentDbId,
    agentId,
    availableBalance,
    availableBalanceEth = 0,
    tokenBalances = [],
    paymentMode,
    paymentAddress,
    splitAddress,
    buybackPercent = 0,
    developerSplitPercent = 95,
    platformFeePercent = 5,
    splitRecipients = [],
    onWithdrawSuccess,
}: WithdrawModalProps) {
    const [amount, setAmount] = useState("");
    const [recipientAddress, setRecipientAddress] = useState("");
    const [selectedAsset, setSelectedAsset] = useState<AssetType>("ETH");
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
    const [step, setStep] = useState<ModalStep>(
        paymentMode === "splits" ? "split-review" : "form",
    );
    const {
        executeWithdrawal,
        executeTokenWithdrawal,
        executeSplitDistribution,
        calculateFees,
        loading: executeLoading,
        isReady,
    } = useWithdraw(agentDbId, agentId);

    useEffect(() => {
        if (isOpen) {
            setStep(paymentMode === "splits" ? "split-review" : "form");
        }
    }, [isOpen, paymentMode]);

    const getCurrentBalance = () => {
        if (selectedAsset === "ETH") {
            return { balance: availableBalanceEth, balanceUsd: availableBalance, symbol: "ETH" };
        }
        const token = tokenBalances.find((candidate) => candidate.symbol === selectedAsset);
        return token
            ? { balance: parseFloat(token.balance), balanceUsd: token.balanceUsd, symbol: token.symbol }
            : { balance: 0, balanceUsd: 0, symbol: selectedAsset };
    };

    const currentBalance = getCurrentBalance();
    const tokenUsdTotal = tokenBalances.reduce((sum, token) => sum + token.balanceUsd, 0);
    const ethBalanceUsd = Math.max(availableBalance - tokenUsdTotal, 0);
    const splitAssets: Array<{
        symbol: string;
        amount: string;
        amountUsd: number;
        tokenAddress?: string;
    }> = [
        ...(availableBalanceEth > 0
            ? [{
                symbol: "ETH",
                amount: availableBalanceEth.toString(),
                amountUsd: ethBalanceUsd,
            }]
            : []),
        ...tokenBalances
            .filter((token) => parseFloat(token.balance) > 0)
            .map((token) => ({
                symbol: token.symbol,
                amount: token.balance,
                amountUsd: token.balanceUsd,
                tokenAddress: token.address,
            })),
    ];
    const hasSplitFunds = splitAssets.length > 0;

    const availableAssets = [
        { symbol: "ETH", balance: availableBalanceEth, balanceUsd: availableBalance },
        ...tokenBalances.filter((token) => parseFloat(token.balance) > 0).map((token) => ({
            symbol: token.symbol,
            balance: parseFloat(token.balance),
            balanceUsd: token.balanceUsd,
            address: token.address,
        })),
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

        const tolerance = currentBalance.balance * 0.0001;
        if (withdrawAmount > currentBalance.balance + tolerance) {
            toast.error("Amount exceeds available balance");
            return;
        }

        if (!isReady) {
            toast.error("Please connect your wallet first");
            return;
        }

        try {
            const feeBasis = selectedAsset === "ETH"
                ? withdrawAmount * (availableBalance / availableBalanceEth)
                : withdrawAmount;
            const fees = await calculateFees(feeBasis);
            setFeeCalculation({
                ...fees,
                amount: withdrawAmount,
            });

            const isToken = selectedAsset !== "ETH";
            const token = isToken ? tokenBalances.find((candidate) => candidate.symbol === selectedAsset) : null;

            setWithdrawData({
                agentId: agentId,
                amount: amount,
                to: recipientAddress,
                isToken,
                tokenAddress: token?.address,
                tokenSymbol: token?.symbol,
            });
            setStep("confirm");
        } catch (error) {
            console.error("Error calculating fees:", error);
            toast.error("Failed to calculate fees. Please try again.");
        }
    };

    const handleMaxAmount = () => {
        const decimals = selectedAsset === "ETH" ? 8 : 6;
        const multiplier = Math.pow(10, decimals);
        const flooredAmount = Math.floor(currentBalance.balance * multiplier) / multiplier;
        setAmount(flooredAmount.toString());
    };

    const handleExecuteWithdrawal = async () => {
        if (!withdrawData) return;

        setStep("executing");

        try {
            let result;
            if (withdrawData.isToken && withdrawData.tokenAddress && withdrawData.tokenSymbol) {
                result = await executeTokenWithdrawal({
                    agentId: withdrawData.agentId,
                    tokenAddress: withdrawData.tokenAddress,
                    tokenSymbol: withdrawData.tokenSymbol,
                    amount: withdrawData.amount,
                    to: withdrawData.to,
                });
            } else {
                let amountWei: string | undefined;
                try {
                    amountWei = parseEther(withdrawData.amount).toString();
                } catch {
                    amountWei = undefined;
                }
                const ethAmount = parseFloat(withdrawData.amount);
                const usdAmount = ethAmount * (availableBalance / availableBalanceEth);
                result = await executeWithdrawal({
                    agentId: withdrawData.agentId,
                    amount: usdAmount.toString(),
                    amountWei,
                    to: withdrawData.to,
                });
            }

            toast.success("Withdrawal executed successfully!");
            if (result.transactionHash) {
                toast.success(`Transaction: ${result.transactionHash.slice(0, 10)}...`);
            }

            onWithdrawSuccess?.();
            handleClose();
        } catch (error) {
            console.error("Error executing withdrawal:", error);
            toast.error("Failed to execute withdrawal transaction");
            setStep("confirm");
        }
    };

    const handleExecuteSplitDistribution = async () => {
        if (!splitAddress) {
            toast.error("Split contract address is missing");
            return;
        }

        if (!isReady) {
            toast.error("Please connect your wallet first");
            return;
        }

        setStep("executing");

        try {
            const result = await executeSplitDistribution({
                splitAddress,
                paymentAddress,
                recipients: splitRecipients,
                assets: splitAssets,
            });

            toast.success(`Distributed ${result.distributedAssets.length} funded asset(s)`);
            if (result.transactionHashes[0]) {
                toast.success(`First transaction: ${result.transactionHashes[0].slice(0, 10)}...`);
            }

            onWithdrawSuccess?.();
            handleClose();
        } catch (error) {
            console.error("Error executing split distribution:", error);
            toast.error("Failed to distribute split funds");
            setStep("split-review");
        }
    };

    const handleClose = () => {
        setAmount("");
        setRecipientAddress("");
        setSelectedAsset("ETH");
        setWithdrawData(null);
        setFeeCalculation(null);
        setStep(paymentMode === "splits" ? "split-review" : "form");
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md rounded-[20px] shadow-none border border-black/10">
                <DialogHeader className="pb-4">
                    <DialogTitle className="text-xl font-semibold text-black font-funnel-display">
                        {step === "form" && "Withdraw Funds"}
                        {step === "confirm" && "Confirm Withdrawal"}
                        {step === "executing" && (paymentMode === "splits" ? "Distributing Funds" : "Executing Withdrawal")}
                        {step === "split-review" && "Distribute Split Funds"}
                    </DialogTitle>
                    <DialogDescription className="text-black/40 text-sm font-funnel-sans">
                        {step === "form" && "Withdraw funds from your agent's balance. A platform fee will be deducted."}
                        {step === "confirm" && "Review the withdrawal details and confirm the transaction."}
                        {step === "executing" && (paymentMode === "splits"
                            ? "Please confirm each funded asset in your wallet to distribute it from the split contract."
                            : "Please wait while we execute your withdrawal...")}
                        {step === "split-review" && "This agent routes payments into its own split contract. The dashboard will distribute everything currently held there."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-2">
                    {paymentMode === "escrow" && step === "form" && (
                        <>
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
                                                    setAmount("");
                                                }}
                                                className={`px-4 py-2 rounded-[12px] border text-sm font-funnel-sans transition-colors ${
                                                    selectedAsset === asset.symbol
                                                        ? "bg-secondary-green text-white border-secondary-green"
                                                        : "bg-white text-black border-black/20 hover:border-secondary-green"
                                                }`}
                                            >
                                                <span className="font-semibold">{asset.symbol}</span>
                                                <span className="ml-2 text-xs opacity-70">
                                                    {asset.balance.toFixed(asset.symbol === "ETH" ? 5 : 2)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-sm text-black/40 font-funnel-sans mb-1">
                                    Available {selectedAsset} Balance
                                </p>
                                <p className="text-lg font-semibold text-secondary-green font-funnel-sans">
                                    {currentBalance.balance.toFixed(selectedAsset === "ETH" ? 6 : 2)} {selectedAsset}
                                </p>
                                {currentBalance.balanceUsd > 0 && (
                                    <p className="text-xs text-black/40 font-funnel-sans mt-1">
                                        Approx. ${currentBalance.balanceUsd.toFixed(2)} USD
                                    </p>
                                )}
                            </div>

                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-black font-funnel-sans">
                                    Amount ({selectedAsset})
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        step={selectedAsset === "ETH" ? "0.0001" : "1"}
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(event) => setAmount(event.target.value)}
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
                                    Maximum: {currentBalance.balance.toFixed(selectedAsset === "ETH" ? 6 : 2)} {selectedAsset}
                                </p>
                            </div>

                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-black font-funnel-sans">
                                    Recipient Address
                                </label>
                                <Input
                                    type="text"
                                    placeholder="0x..."
                                    value={recipientAddress}
                                    onChange={(event) => setRecipientAddress(event.target.value)}
                                    className="w-full font-mono text-sm rounded-[12px] border border-black/20 focus:border-secondary-green focus:ring-0"
                                />
                                <p className="text-xs text-black/40 font-funnel-sans">
                                    Enter the wallet address to receive the {selectedAsset}
                                </p>
                            </div>
                        </>
                    )}

                    {paymentMode === "escrow" && step === "confirm" && withdrawData && feeCalculation && (
                        <>
                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <h3 className="text-lg font-semibold text-black font-funnel-sans mb-3">Withdrawal Summary</h3>

                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Asset:</span>
                                        <span className="text-sm font-semibold text-black font-funnel-sans">
                                            {withdrawData.isToken ? withdrawData.tokenSymbol : "ETH"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Amount:</span>
                                        <span className="text-sm font-semibold text-black font-funnel-sans">
                                            {feeCalculation.amount.toFixed(withdrawData.isToken ? 2 : 6)} {withdrawData.isToken ? withdrawData.tokenSymbol : "ETH"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-black/60 font-funnel-sans">Platform Fee ({(feeCalculation.platformFeeBps / 100).toFixed(1)}%):</span>
                                        <span className="text-sm font-semibold text-red-500 font-funnel-sans">
                                            -{feeCalculation.fee.toFixed(withdrawData.isToken ? 2 : 6)} {withdrawData.isToken ? withdrawData.tokenSymbol : "ETH"}
                                        </span>
                                    </div>
                                    <div className="border-t border-black/10 pt-2">
                                        <div className="flex justify-between">
                                            <span className="text-sm font-semibold text-black font-funnel-sans">You&apos;ll Receive:</span>
                                            <span className="text-sm font-semibold text-secondary-green font-funnel-sans">
                                                {feeCalculation.net.toFixed(withdrawData.isToken ? 2 : 6)} {withdrawData.isToken ? withdrawData.tokenSymbol : "ETH"}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-sm text-black/60 font-funnel-sans mb-1">Recipient Address</p>
                                <p className="text-sm font-mono text-black font-funnel-sans">
                                    {withdrawData.to}
                                </p>
                            </div>
                        </>
                    )}

                    {step === "executing" && (
                        <div className="flex items-center justify-center py-8">
                            <div className="text-center">
                                <div className="animate-spin h-8 w-8 border-2 border-secondary-green border-t-transparent rounded-full mx-auto mb-4"></div>
                                <p className="text-black/60 font-funnel-sans">
                                    {paymentMode === "splits" ? "Distributing split funds..." : "Executing withdrawal..."}
                                </p>
                            </div>
                        </div>
                    )}

                    {paymentMode === "splits" && step === "split-review" && (
                        <>
                            <div className="bg-blue-50 rounded-[12px] p-4 border border-blue-100">
                                <p className="text-sm font-semibold text-blue-800 font-funnel-sans mb-2">
                                    Split-backed agent
                                </p>
                                <p className="text-sm text-blue-700 font-funnel-sans">
                                    Payments for this agent land in its split contract, and this action will distribute every funded asset currently sitting there.
                                </p>
                                <p className="text-xs text-blue-700/80 font-funnel-sans mt-2">
                                    You may see one wallet confirmation per funded asset.
                                </p>
                            </div>

                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5 space-y-3">
                                <div>
                                    <p className="text-xs text-black/40 font-funnel-sans mb-1">Split Contract</p>
                                    <p className="text-sm font-mono text-black break-all font-funnel-sans">
                                        {splitAddress || paymentAddress}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-black/40 font-funnel-sans mb-1">Gross Split Balance</p>
                                    <p className="text-lg font-semibold text-secondary-green font-funnel-sans">
                                        ${availableBalance.toFixed(2)}
                                    </p>
                                    <p className="text-xs text-black/40 font-funnel-sans mt-1">
                                        {availableBalanceEth.toFixed(6)} ETH
                                    </p>
                                </div>
                                {splitAssets.length > 0 && (
                                    <div className="border-t border-black/10 pt-3 space-y-1">
                                        {splitAssets.map((asset) => (
                                            <p key={asset.tokenAddress || asset.symbol} className="text-xs text-black/50 font-funnel-sans">
                                                {parseFloat(asset.amount).toFixed(asset.symbol === "ETH" ? 6 : 2)} {asset.symbol}
                                                {asset.amountUsd > 0 && (
                                                    <span className="ml-1">(Approx. ${asset.amountUsd.toFixed(2)})</span>
                                                )}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="bg-gray-50 rounded-[12px] p-4 border border-black/5">
                                <p className="text-sm font-semibold text-black font-funnel-sans mb-3">Split Allocation</p>
                                <div className="space-y-2">
                                    {splitRecipients.map((recipient) => (
                                        <div key={`${recipient.label}-${recipient.address}`} className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-sm text-black font-funnel-sans">{recipient.label}</p>
                                                <p className="text-xs text-black/40 font-mono break-all font-funnel-sans">
                                                    {recipient.address}
                                                </p>
                                            </div>
                                            <p className="text-sm font-semibold text-black/70 font-funnel-sans">
                                                {recipient.percentAllocation}%
                                            </p>
                                        </div>
                                    ))}
                                </div>
                                {buybackPercent > 0 && (
                                    <p className="text-xs text-black/40 font-funnel-sans mt-3">
                                        Developer {developerSplitPercent}% · Buyback {buybackPercent}% · Platform {platformFeePercent}%
                                    </p>
                                )}
                                {buybackPercent <= 0 && (
                                    <p className="text-xs text-black/40 font-funnel-sans mt-3">
                                        Developer {developerSplitPercent}% · Platform {platformFeePercent}%
                                    </p>
                                )}
                            </div>

                            {!hasSplitFunds && (
                                <div className="bg-amber-50 rounded-[12px] p-4 border border-amber-100">
                                    <p className="text-sm text-amber-800 font-funnel-sans">
                                        No ETH or supported token balances are currently sitting in this split contract.
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter className="flex gap-3 pt-6">
                    {paymentMode === "escrow" && step === "form" && (
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

                    {paymentMode === "escrow" && step === "confirm" && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setStep("form")}
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

                    {step === "executing" && (
                        <div className="flex-1 text-center">
                            <p className="text-sm text-black/60 font-funnel-sans">
                                {paymentMode === "splits"
                                    ? "Please confirm the wallet prompts to distribute each asset."
                                    : "Please wait while we process your withdrawal..."}
                            </p>
                        </div>
                    )}

                    {paymentMode === "splits" && step === "split-review" && (
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
                                onClick={handleExecuteSplitDistribution}
                                disabled={!isReady || !hasSplitFunds || !splitAddress || splitRecipients.length < 2 || executeLoading}
                                className="flex-1 bg-secondary-green hover:bg-green-700 text-white rounded-full font-funnel-sans"
                            >
                                {executeLoading ? "Distributing..." : "Distribute All Assets"}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
