import { getPublicClient } from '@/lib/web3';
import { Address, Hex, createWalletClient, custom, parseEther } from 'viem';

import { tradeCoin } from '@zoralabs/coins-sdk';
import { base } from 'viem/chains';
import { useState } from 'react';
import { useWallets } from '@privy-io/react-auth';

interface Token {
    name: string;
    symbol: string;
    address: string;
    marketCap: string;
    volume24h: string;
    uniqueHolders: number;
    confidenceScore: number;
    sources: string[];
}

export interface TokenInvestResponse {
    recommendations: Token[];
    metadata: {
        count: number;
        riskLevel: string;
        investmentAmount: number;
    };
}

interface TradeEventArgs {
    amountFee: bigint;
    amountSold: bigint;
    buyer: string;
    coinsPurchased: bigint;
    currency: string;
    recipient: string;
    tradeReferrer: string;
}

export interface TradeResult {
    hash: `0x${string}`;
    trade: TradeEventArgs;
}

export interface TokenInvestProps {
    data: TokenInvestResponse;
    userAddress: `0x${string}`;
    onDeny: () => void;
    onComplete: (result: `0x${string}`) => void;
}

export default function TokenInvest({ data, userAddress, onDeny, onComplete }: TokenInvestProps) {
    const [selectedToken, setSelectedToken] = useState<Address | null>(null);
    const { wallets } = useWallets();
    const wallet = wallets[0];
    // Sort tokens by confidence score and take top 2
    const topTokens = [...data.recommendations]
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 2);

    const publicClient = getPublicClient("base");

    // Define buy parameters
    const buyCoin = async (
        coinContractAddress: Address,
        orderSize: number,
    ) => {
        const provider = wallet ? await wallet.getEthereumProvider() : null;
        if (!provider) {
            console.error("No provider found");
            return;
        }
        const walletClient = createWalletClient({
            account: wallet.address as Hex,
            chain: base,
            transport: custom(provider),
        });
        try {
            // have selected token details
            const buyParams = {
                direction: "buy" as const,
                target: coinContractAddress as Address,
                args: {
                    recipient: userAddress as Address, // Where to receive the purchased coins
                    orderSize: parseEther(orderSize.toString()), // Amount of ETH to spend
                    minAmountOut: BigInt(0), // Minimum amount of coins to receive (0 = no minimum)
                }
            };
            const result = await tradeCoin(buyParams, walletClient, publicClient);
            if (result.hash) {
                onComplete(result.hash);

            }
            return result;
        } catch (error) {
            console.log("Error buying coin:", error);
            return null;
        }
    }

    // if (tradeResult) {
    //     return (
    //         <div className="space-y-4 px-2 max-w-[80%]">
    //             <div className="bg-green-50 border border-green-200 rounded-xl p-4">
    //                 <h3 className="text-green-800 font-medium mb-2">Transaction Completed</h3>
    //                 <p className="text-sm text-green-600 break-all mb-4">{tradeResult.hash}</p>


    //             </div>
    //         </div>
    //     );
    // }

    return (
        <div className="space-y-4 px-2 max-w-[80%]" >
            <p className='text-black/80 font-funnel-sans font-normal'>Select a token to invest in</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {topTokens.map((token) => (
                    <div
                        key={token.address}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedToken === token.address
                            ? 'border-blue-500 bg-blue-50 shadow-sm'
                            : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
                            }`}
                        onClick={() => setSelectedToken(token.address as Address)}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                                    <span className="text-sm font-medium text-gray-600">
                                        {token.symbol.charAt(0)}
                                    </span>
                                </div>
                                <div>
                                    <h3 className="text-sm font-medium text-gray-900">{token.name}</h3>
                                    <p className="text-xs text-gray-500">{token.symbol}</p>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-gray-50 rounded-lg p-2">
                                <p className="text-gray-500">Market Cap</p>
                                <p className="font-medium">${Number(token.marketCap).toLocaleString()}</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-2">
                                <p className="text-gray-500">24h Vol</p>
                                <p className="font-medium">${Number(token.volume24h).toLocaleString()}</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-2">
                                <p className="text-gray-500">Holders</p>
                                <p className="font-medium">{token.uniqueHolders.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {selectedToken && (
                <div className="space-y-2 mt-4">
                    <p className="font-normal mb-4">Ready to proceed?</p>
                    <div className="flex gap-4">
                        <button
                            onClick={() => buyCoin(selectedToken!, data.metadata.investmentAmount)}
                            className="px-4 py-2 bg-secondary-green text-white rounded-full hover:bg-green-600 transition-colors"
                        >
                            Confirm
                        </button>
                        <button
                            className="px-4 py-2 bg-secondary-red text-white rounded-full hover:bg-red-600 transition-colors"
                            onClick={onDeny}
                        >
                            Deny
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}