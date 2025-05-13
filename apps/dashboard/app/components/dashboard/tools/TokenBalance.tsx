import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Icons } from '../../sections/icons';
import { Account } from 'viem';

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
    onSwap?: (symbol: string) => void;
    onAnalyze?: (symbol: string) => void;
}

export default function TokenBalance({ data }: TokenBalanceProps) {
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

    const truncateAddress = (address: string) => {
        return address.slice(0, 6) + '...' + address.slice(-4);
    };

    return (
        <div className="space-y-4 p-2">
            {/* Wallet Header */}
            <div className="flex items-center gap-2">
                <span className="font-normal">Wallet Address:</span>
                <Link
                    href={`https://basescan.org/address/${data?.wallet_address ? data?.wallet_address : ""}#assets`}
                    target="_blank"
                    className="text-blue-500 flex items-center gap-1 bg-transparent border-2 border-black/20 rounded-full px-2 py-1 hover:bg-black/4 transition-colors hover:border-black/40"
                >
                    <span className="text-xs text-gray-500 font-mono">
                        {truncateAddress(data.wallet_address)}
                    </span>
                    <Icons.arrowUpBlueIcon />
                </Link>
            </div>

            {/* Tokens List */}
            <div className="space-y-2">
                {data?.tokens?.map((token, index) => {
                    // check if token.balance is greater than 0.000001 then show the token
                    if (Number(token.balance) * Number(token.price_usd) > 0.009) {
                        return (
                            <div key={index} className="space-y-1">
                                {/* Token Info */}
                                <div className="flex items-center gap-2">
                                    <span className="font-medium">${token.price_usd ? (Number(token.balance) * Number(token.price_usd)).toFixed(5) : ""}</span>
                                    <span>-</span>
                                    <span className="font-medium">{formatBalance(token.balance)}</span>
                                    <div className="flex items-center gap-2">
                                        <Link
                                            href={`https://basescan.org/address/${token.contract_address ? token.contract_address : ""}`}
                                            target="_blank"
                                            className="text-sm text-blue-500 font-medium flex items-center gap-1 bg-transparent border-2 border-black/20 rounded-full px-1.5 py-0.5 hover:bg-black/4 transition-colors hover:border-black/40"
                                        >
                                            {token.image ? (
                                                <Image
                                                    src={token.image}
                                                    alt={token.symbol}
                                                    width={16}
                                                    height={16}
                                                    className="rounded-full"
                                                />
                                            ) : (
                                                <Icons.basetokenImage className="w-4 h-4" />
                                            )}
                                            <span className="text-gray-600">{token.symbol}</span>
                                        </Link>
                                    </div>
                                    {token.value_usd && token.price_usd && (
                                        <span className="text-gray-600">({formatUSD(token.value_usd)} <span className="text-xs text-gray-400">at {formatUSD(token.price_usd)}/{token.symbol})</span></span>
                                    )}
                                    {token.price_change_24h !== undefined && (
                                        <span className={`flex items-center gap-1 ${token.price_change_24h >= 0
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
                            </div>)
                    }
                })}

                {/* Empty State */}
                {data?.tokens?.length === 0 && (
                    <div className="text-gray-500">
                        No tokens found in this wallet
                    </div>
                )}
            </div>
        </div>
    );
} 