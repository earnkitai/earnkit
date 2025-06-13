'use client';

import { useState, useEffect } from 'react';
import axios, { AxiosError } from 'axios';
import { parseUnits } from 'ethers';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, Info, AlertCircle, CheckCircle2, RefreshCcw } from 'lucide-react';
import { chainIdMap } from '@/lib/web3';
import { getTokenMetadataBasedOnChain, TokenMetadata } from '@/actions/web3';
import Image from 'next/image';
import { zeroAddress } from 'viem';
import { usePrivy, useSendTransaction } from '@privy-io/react-auth';
import { toast } from 'sonner';

interface QuoteResponse {
    steps: Array<{
        id: string;
        action: string;
        description: string;
        kind: string;
        items: Array<{
            status: string;
            data: {
                from: string;
                to: string;
                data: string;
                value: string;
                chainId: number;
                maxFeePerGas: string;
                maxPriorityFeePerGas: string;
            };
            check: {
                endpoint: string;
                method: string;
            };
        }>;
        requestId: string;
        depositAddress: string;
    }>;
    fees: {
        gas: {
            currency: {
                chainId: number;
                address: string;
                symbol: string;
                name: string;
                decimals: number;
                metadata: {
                    logoURI: string;
                    verified: boolean;
                };
            };
            amount: string;
            amountFormatted: string;
            amountUsd: string;
        };
        relayer: {
            currency: {
                chainId: number;
                address: string;
                symbol: string;
                name: string;
                decimals: number;
                metadata: {
                    logoURI: string;
                    verified: boolean;
                };
            };
            amount: string;
            amountFormatted: string;
            amountUsd: string;
        };
    };
    details: {
        operation: string;
        currencyIn: {
            currency: {
                chainId: number;
                address: string;
                symbol: string;
                name: string;
                decimals: number;
                metadata: {
                    logoURI: string;
                    verified: boolean;
                };
            };
            amount: string;
            amountFormatted: string;
            amountUsd: string;
        };
        currencyOut: {
            currency: {
                chainId: number;
                address: string;
                symbol: string;
                name: string;
                decimals: number;
                metadata: {
                    logoURI: string;
                    verified: boolean;
                };
            };
            amount: string;
            amountFormatted: string;
            amountUsd: string;
        };
        totalImpact: {
            usd: string;
            percent: string;
        };
        timeEstimate: number;
    };
}

export interface BridgeTokenProps {
    tokenFrom: string;
    tokenFromDecimals: number;
    tokenTo: string;
    amount: string;
    fromChain: string;
    toChain: string;
    userAddress: string;
    updateMessage: (messageId: string, content: string, metadata?: object) => Promise<{ id: string } | null>;
    messageId?: string;
}

function getChainIdByName(chainName: string): number | undefined {
    return chainIdMap[chainName.toLowerCase()];
}

interface BridgeStep {
    id: string;
    action: string;
    description: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    txHash?: string;
    items?: Array<{
        data: {
            to: string;
            data: string;
            value: string;
            chainId: number;
            maxFeePerGas: string;
            maxPriorityFeePerGas: string;
        };
    }>;
}

export default function BridgeToken({
    tokenFrom,
    tokenFromDecimals,
    tokenTo,
    amount,
    fromChain,
    toChain,
    userAddress,
    updateMessage,
    messageId,
}: BridgeTokenProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [quoteData, setQuoteData] = useState<QuoteResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fromTokenInfo, setFromTokenInfo] = useState<TokenMetadata | null>(null);
    const [toTokenInfo, setToTokenInfo] = useState<TokenMetadata | null>(null);
    const [isLoadingTokens, setIsLoadingTokens] = useState(true);
    const [bridgeSteps, setBridgeSteps] = useState<BridgeStep[]>([]);
    const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1);
    const [bridgeSuccess, setBridgeSuccess] = useState<boolean>(false);
    const { user: privyUser } = usePrivy();
    const { sendTransaction } = useSendTransaction();

    const fromChainId = getChainIdByName(fromChain);
    const toChainId = getChainIdByName(toChain);

    const fetchBridgeQuote = async () => {
        try {
            setIsLoading(true);
            setError(null);

            const amountInWei = parseUnits(
                amount.toString(),
                tokenFromDecimals
            );

            let originCurrency = tokenFrom;
            if (tokenFrom === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
                originCurrency = zeroAddress;
            }

            let destinationCurrency = tokenTo;
            if (tokenTo === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
                destinationCurrency = zeroAddress;
            }
            const quoteParams = {
                useReceiver: true,
                user: userAddress,
                originChainId: fromChainId,
                destinationChainId: toChainId,
                originCurrency: originCurrency,
                destinationCurrency: destinationCurrency,
                amount: amountInWei.toString(),
                tradeType: "EXACT_INPUT",
                recipient: userAddress,
            };

            console.log(quoteParams, 'quoteParams');


            const response = await axios.post('https://api.relay.link/quote', quoteParams);
            console.log('Quote Response:', response.data);
            setQuoteData(response.data);
        } catch (err) {
            if (err instanceof AxiosError) {
                console.log('Bridge Error:', err.response?.data);
            } else {
                console.log('Bridge Error:', err);
            }
            setError('Failed to get bridge quote. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const fetchTokenInfo = async () => {
            try {
                setIsLoadingTokens(true);
                const [fromInfo, toInfo] = await Promise.all([
                    getTokenMetadataBasedOnChain(tokenFrom, fromChain.toLowerCase().trim()),
                    getTokenMetadataBasedOnChain(tokenTo, toChain.toLowerCase().trim())
                ]);
                setFromTokenInfo(fromInfo);
                setToTokenInfo(toInfo);
            } catch (err) {
                console.error('Error fetching token info:', err);
            } finally {
                setIsLoadingTokens(false);
            }
        };

        fetchTokenInfo();
    }, [tokenFrom, tokenTo, fromChain, toChain]);

    useEffect(() => {
        if (!isLoadingTokens && fromTokenInfo && toTokenInfo) {
            fetchBridgeQuote();
        }
    }, [isLoadingTokens, fromTokenInfo, toTokenInfo]);

    const handleBridge = async () => {
        if (!quoteData?.steps || !privyUser) {
            toast.error('Please connect your wallet first');
            return;
        }

        try {
            // Initialize steps
            const steps: BridgeStep[] = quoteData.steps.map(step => ({
                id: step.id,
                action: step.action,
                description: step.description,
                status: 'pending',
                items: step.items
            }));
            setBridgeSteps(steps);
            setCurrentStepIndex(0);

            // Process each step
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                setCurrentStepIndex(i);

                // Update step status to processing
                setBridgeSteps(prev => prev.map((s, index) =>
                    index === i ? { ...s, status: 'processing' } : s
                ));

                // Get the transaction data for this step
                const txData = step.items?.[0]?.data;
                if (!txData) {
                    throw new Error(`No transaction data found for step ${i + 1}`);
                }

                // Prepare transaction
                const tx = {
                    to: txData.to,
                    data: txData.data,
                    value: txData.value || "0",
                    maxFeePerGas: txData.maxFeePerGas || "0",
                    maxPriorityFeePerGas: txData.maxPriorityFeePerGas || "0",
                    chainId: txData.chainId,
                    gasLimit: "600000",
                };

                try {
                    // Send transaction
                    // const txResponse = await privyUser.wallet.sendTransaction(tx);
                    const txResponse = await sendTransaction(tx)

                    // Update step with transaction hash
                    setBridgeSteps(prev => prev.map((s, index) =>
                        index === i ? { ...s, status: 'completed', txHash: txResponse.hash } : s
                    ));

                    console.log(txResponse, 'txResponse');

                    toast.success(`Step ${i + 1} completed: ${step.action}`);
                } catch (txError) {
                    console.error('Transaction error:', txError);
                    setBridgeSteps(prev => prev.map((s, index) =>
                        index === i ? { ...s, status: 'failed' } : s
                    ));
                    console.error(`Failed to execute step ${i + 1}: ${step.action}`);
                }
            }
            setBridgeSuccess(true);

            // // Update message with transaction hash
            // if (messageId) {
            //     await updateMessage(messageId, JSON.stringify({
            //         ...data,
            //         transactionHash: txHash
            //     }), { transactionHash: txHash });
            // }
            toast.success('Bridge transaction completed successfully!');
        } catch (err) {
            console.error('Bridge execution error:', err);
            setError(err instanceof Error ? err.message : 'Failed to execute bridge transaction');
            toast.error('Bridge transaction failed');
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto space-y-6">
            <Card className="border-2 border-primary/20">
                <CardContent className="p-6">
                    <div className="space-y-6">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                                Bridge Token
                            </h2>
                            {isLoading && (
                                <div className="flex items-center gap-2 text-primary">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    <span className="text-sm">Getting Quote...</span>
                                </div>
                            )}
                            <div className="flex items-center gap-2 border border-primary/20 rounded-md p-2 text-primary cursor-pointer" onClick={fetchBridgeQuote}>
                                <RefreshCcw className="h-5 w-5" />
                                <span className="text-sm">Refresh Quote</span>
                            </div>

                        </div>

                        {/* Bridge Flow */}
                        <div className="relative">
                            {/* From Chain */}
                            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-4 mb-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm text-muted-foreground">From</p>
                                        <div className="flex items-center gap-2">
                                            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                                                {fromTokenInfo?.imageUrl ? (
                                                    <Image
                                                        src={fromTokenInfo.imageUrl}
                                                        alt={fromTokenInfo.symbol}
                                                        width={24}
                                                        height={24}
                                                        className="rounded-full"
                                                    />
                                                ) : (
                                                    <span className="text-primary font-semibold">{fromChain[0]}</span>
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-medium">{fromChain}</p>
                                                {fromTokenInfo && (
                                                    <p className="text-sm text-muted-foreground">
                                                        {fromTokenInfo.symbol} - {fromTokenInfo.name}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-muted-foreground">Amount</p>
                                        <p className="font-medium text-lg">{amount}</p>
                                        {fromTokenInfo?.priceUsd && (
                                            <p className="text-sm text-muted-foreground">
                                                ≈ ${(Number(amount) * fromTokenInfo.priceUsd).toFixed(2)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Arrow */}
                            <div className="flex justify-center my-2">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    <ArrowRight className="h-4 w-4 text-primary" />
                                </div>
                            </div>

                            {/* To Chain */}
                            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm text-muted-foreground">To</p>
                                        <div className="flex items-center gap-2">
                                            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                                                {toTokenInfo?.imageUrl ? (
                                                    <Image
                                                        src={toTokenInfo.imageUrl}
                                                        alt={toTokenInfo.symbol}
                                                        width={24}
                                                        height={24}
                                                        className="rounded-full"
                                                    />
                                                ) : (
                                                    <span className="text-primary font-semibold">{toChain[0]}</span>
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-medium">{toChain}</p>
                                                {toTokenInfo && (
                                                    <p className="text-sm text-muted-foreground">
                                                        {toTokenInfo.symbol} - {toTokenInfo.name}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-muted-foreground">You&apos;ll Receive</p>
                                        {quoteData ? (
                                            <>
                                                <p className="font-medium text-lg">
                                                    {quoteData.details.currencyOut.amountFormatted} {quoteData.details.currencyOut.currency.symbol}
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    ≈ ${quoteData.details.currencyOut.amountUsd}
                                                </p>
                                            </>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Calculating...</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Bridge Steps Progress */}
                        {bridgeSteps.length > 0 && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Info className="h-4 w-4" />
                                    <span>Bridge Progress</span>
                                </div>

                                <div className="space-y-3">
                                    {bridgeSteps.map((step) => (
                                        <div
                                            key={step.id}
                                            className={`p-4 rounded-lg border ${step.status === 'completed'
                                                ? 'border-green-500/20 bg-green-500/5'
                                                : step.status === 'processing'
                                                    ? 'border-primary/20 bg-primary/5'
                                                    : step.status === 'failed'
                                                        ? 'border-destructive/20 bg-destructive/5'
                                                        : 'border-muted/50 bg-muted/50'
                                                }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="mt-1">
                                                    {step.status === 'completed' ? (
                                                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                                                    ) : step.status === 'processing' ? (
                                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                                    ) : step.status === 'failed' ? (
                                                        <AlertCircle className="h-5 w-5 text-destructive" />
                                                    ) : (
                                                        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="flex-1">
                                                    <p className="font-medium">{step.action}</p>
                                                    <p className="text-sm text-muted-foreground mt-1">
                                                        {step.description}
                                                    </p>
                                                    {step.txHash && (
                                                        <p className="text-xs text-muted-foreground mt-1 break-all">
                                                            TX: {step.txHash}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Bridge Details */}
                        {quoteData && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Info className="h-4 w-4" />
                                    <span>Bridge Details</span>
                                </div>

                                <div className="grid gap-3">
                                    {/* Impact */}
                                    <div className="bg-muted/50 rounded-lg p-3">
                                        <div className="flex justify-between items-center">
                                            <p className="text-sm text-muted-foreground">Total Impact</p>
                                            <div className="text-right">
                                                <p className="font-medium text-sm">
                                                    {quoteData.details.totalImpact.percent}%
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    ${quoteData.details.totalImpact.usd}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Fees */}
                                    <div className="bg-muted/50 rounded-lg p-3">
                                        <div className="flex justify-between items-center">
                                            <p className="text-sm text-muted-foreground">Fees</p>
                                            <div className="text-right">
                                                <p className="font-medium text-sm">
                                                    {quoteData.fees.relayer.amountFormatted} {quoteData.fees.relayer.currency.symbol}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    ≈ ${quoteData.fees.relayer.amountUsd}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Gas */}
                                    <div className="bg-muted/50 rounded-lg p-3">
                                        <div className="flex justify-between items-center">
                                            <p className="text-sm text-muted-foreground">Gas Fee</p>
                                            <div className="text-right">
                                                <p className="font-medium text-sm">
                                                    {quoteData.fees.gas.amountFormatted} {quoteData.fees.gas.currency.symbol}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    ≈ ${quoteData.fees.gas.amountUsd}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Time Estimate */}
                                    <div className="bg-muted/50 rounded-lg p-3">
                                        <div className="flex justify-between items-center">
                                            <p className="text-sm text-muted-foreground">Estimated Time</p>
                                            <p className="font-medium text-sm">
                                                {quoteData.details.timeEstimate} seconds
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Error Display */}
                        {error && (
                            <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                <p>{error}</p>
                            </div>
                        )}

                        {/* Action Button */}
                        <Button
                            onClick={handleBridge}
                            disabled={isLoading || isLoadingTokens || currentStepIndex >= 0 || bridgeSuccess}
                            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Getting Quote...
                                </>
                            ) : isLoadingTokens ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Loading Token Info...
                                </>
                            ) : currentStepIndex >= 0 ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Processing Bridge...
                                </>
                            ) : bridgeSuccess ?
                                <>
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                    Bridge Completed
                                </> : (
                                    'Confirm Bridge'
                                )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
