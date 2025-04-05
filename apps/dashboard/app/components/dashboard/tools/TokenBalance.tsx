import Link from 'next/link';
import Image from 'next/image';
import { ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';
import { Account } from '@/types/turnkey';
import { Icons } from '../../sections/icons';

export interface Token {
    token: string;
    symbol: string;
    balance: string;
    value_usd?: string;
    price_usd?: string;
    price_change_24h?: number;
    image?: string;
    contract_address?: string;
}

export interface WalletBalanceResponse {
    wallet_address: string;
    tokens: Token[];
}

interface TokenBalanceProps {
    data: WalletBalanceResponse;
    selectedAccount: Account | null;
    onSwap: (symbol: string) => void;
    onAnalyze: (symbol: string) => void;
}

export default function TokenBalance({ data, onSwap, onAnalyze }: TokenBalanceProps) {
    const formatBalance = (balance: string) => {
        return Number(balance).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
        });
    };

    const formatUSD = (value: string | undefined) => {
        if (!value) return '$0.00';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(Number(value));
    };

    return (
        <div className="max-w-[600px] w-full bg-white rounded-xl shadow-sm border border-black/10 p-6 font-funnel-sans">
            {/* Wallet Header */}
            {data && <>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold">Wallet Balance</h2>
                        <p className="text-sm text-gray-500 font-mono">
                            {data.wallet_address?.slice(0, 6)}...{data.wallet_address?.slice(-4)}
                        </p>
                    </div>
                    <Link
                        href={`https://basescan.org/address/${data?.wallet_address ? data?.wallet_address : ""}#assets`}
                        target="_blank"
                        className="text-sm text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-1"
                    >
                        View on Explorer <ExternalLink className="w-4 h-4" />
                    </Link>
                </div>

                {/* Tokens List */}
                <div className="space-y-4">
                    {data?.tokens?.map((token, index) => (
                        <div
                            key={index}
                            className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <div className="flex items-center justify-between">
                                {/* Token Info */}
                                <div className="flex items-center gap-3">
                                    {token.image ? (
                                        <Image
                                            src={token.image}
                                            alt={token.symbol}
                                            width={40}
                                            height={40}
                                            className="rounded-full"
                                        />
                                    ) : (
                                        <Icons.ethereum className="w-10 h-10" />
                                        // <div className="w-10 h-10 bg-black/10 rounded-full flex items-center justify-center">
                                        //     <span className="text-lg font-semibold">
                                        //         {token.symbol.slice(0, 1)}
                                        //     </span>
                                        // </div>
                                    )}
                                    <div>
                                        <div className="font-semibold flex items-center gap-2">
                                            {token.symbol}
                                            {token.price_change_24h !== undefined && (
                                                <span className={`text-xs flex items-center gap-1 ${token.price_change_24h >= 0
                                                    ? 'text-green-500'
                                                    : 'text-red-500'
                                                    }`}>
                                                    {token.price_change_24h >= 0
                                                        ? <TrendingUp className="w-3 h-3" />
                                                        : <TrendingDown className="w-3 h-3" />}
                                                    {Math.abs(token.price_change_24h).toFixed(2)}%
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-sm text-gray-600">
                                            {token.contract_address ? (
                                                <span className="font-mono">
                                                    {token.contract_address.slice(0, 6)}...{token.contract_address.slice(-4)}
                                                </span>
                                            ) : (
                                                ""
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Balance Info */}
                                <div className="text-right">
                                    <div className="font-bold">
                                        {formatBalance(token.balance)} {token.symbol}
                                    </div>
                                    {token.value_usd && (
                                        <div className="text-sm text-gray-600">
                                            {formatUSD(token.value_usd)}
                                            {token.price_usd && (
                                                <span className="text-xs ml-1">
                                                    @ {formatUSD(token.price_usd)}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="mt-3 flex gap-2">
                                <button
                                    className="flex-1 px-3 py-1.5 bg-black/4 text-black/80 rounded-lg text-sm font-medium hover:bg-black/8 transition-colors"
                                    onClick={() => onSwap(token.symbol)}
                                >
                                    Swap
                                </button>
                                <button
                                    className="flex-1 px-3 py-1.5 bg-black/4 text-black/80 rounded-lg text-sm font-medium hover:bg-black/8 transition-colors"
                                    onClick={() => onAnalyze(token.symbol)}
                                >
                                    Analytics
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Empty State */}
                {
                    data?.tokens?.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                            <p>No tokens found in this wallet</p>
                        </div>
                    )
                }
            </>}
        </div >
    );
} 