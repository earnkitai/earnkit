'use client';

import { getBalance, getTokenBalances, TokenMetadata } from '@/actions/web3';
import { useTokenPrice } from '@/hooks/use-token-price';
import { useWallets } from '@privy-io/react-auth';
import { createContext, useContext, useEffect, useState } from 'react';
import { formatEther } from 'viem';

interface TokenBalance {
    contractAddress: string;
    rawBalance?: string;
    decimals?: number;
    balance?: string;
    name?: string;
    symbol?: string;
    logo?: string;
    error?: string;
    metadata: TokenMetadata;
}

interface BalanceContextType {
    balance: number;
    usdValue: number;
    ethUsdValue: number;
    isLoading: boolean;
    tokens: TokenBalance[];
}

const BalanceContext = createContext<BalanceContextType | undefined>(undefined);

export const BalanceProvider = ({ children }: { children: React.ReactNode }) => {
    const [balance, setBalance] = useState(0);
    const [usdValue, setUsdValue] = useState(0);
    const [ethUsdValue, setEthUsdValue] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [tokens, setTokens] = useState<TokenBalance[]>([]);
    const { ethPrice } = useTokenPrice();
    const { wallets, ready } = useWallets();

    useEffect(() => {
        const fetchBalances = async () => {
            if (ready && wallets[0]?.address && ethPrice) {
                setIsLoading(true);
                try {
                    // Fetch ETH balance
                    const fetchedBalance = await getBalance(
                        wallets[0].address as `0x${string}`,
                        "base"
                    );
                    const ethBalanceFormatted = fetchedBalance
                        ? parseFloat(Number(formatEther(fetchedBalance)).toFixed(8))
                        : 0;
                    setBalance(ethBalanceFormatted);

                    // Calculate ETH USD value
                    const ethValue = ethBalanceFormatted * ethPrice;
                    setEthUsdValue(ethValue);

                    // Fetch token balances
                    const tokenBalances = await getTokenBalances(
                        wallets[0].address as `0x${string}`,
                        "base"
                    );
                    setTokens(tokenBalances || []);

                    // Calculate total USD value
                    const tokenValue = tokenBalances?.reduce((sum, token) => {
                        const amount = Number(token.balance);
                        if (token.metadata.priceUsd && token.balance !== '0' && (amount * token.metadata.priceUsd) > 0.05) {
                            return sum + (amount * token.metadata.priceUsd);
                        }
                        return sum;
                    }, 0) || 0;

                    setUsdValue(ethValue + tokenValue);
                } catch (error) {
                    console.error("Failed to fetch balances:", error);
                } finally {
                    setIsLoading(false);
                }
            }
        };

        fetchBalances();
    }, [ethPrice, wallets, ready]);

    return (
        <BalanceContext.Provider value={{ balance, usdValue, ethUsdValue, isLoading, tokens }}>
            {children}
        </BalanceContext.Provider>
    );
};

export const useBalance = () => {
    const context = useContext(BalanceContext);
    if (context === undefined) {
        throw new Error('useBalance must be used within a BalanceProvider');
    }
    return context;
}; 