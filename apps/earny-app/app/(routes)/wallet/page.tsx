"use client";

import { useActiveWallet, useFundWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
// import TransferDialog from "@/app/components/sections/transfer-dialog";
import Assets from "@/app/components/sections/assets";
import Activity from "@/app/components/sections/activity";
import { Toaster } from "@/app/components/ui/sonner";
import { Button } from "@/app/components/ui/button";
import { SendTransactionModal } from '@/components/modals/send-transaction-modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Card } from "@/app/components/ui/card";
import Image from "next/image";
import { getBalance, getTokenBalances } from "@/actions/web3";
import { useTokenPrice } from "@/hooks/use-token-price";
import { formatEther } from "viem";
import { truncateAddress } from "@/lib/utils";
import { Copy } from "lucide-react";
import { toast } from "sonner";

// Add TokenBalance type from assets.tsx
interface TokenBalance {
    contractAddress: string;
    rawBalance: string;
    decimals: number;
    balance: string;
    logo?: string | undefined;
    name?: string | undefined;
    symbol?: string | undefined;
    metadata: {
        imageUrl: string;
        name: string;
        symbol: string;
        decimals: number;
        priceUsd: number;
    };
}

export default function WalletPage() {
    // const { user } = useUser();
    const { ready: privyReady, authenticated, user: privyUser } = usePrivy();
    const [totalValue, setTotalValue] = useState<number>(0);
    const [walletAddress, setWalletAddress] = useState<`0x${string}` | null>(null);
    const { wallet: activeWallet } = useActiveWallet()
    // const { state } = useWallets();  
    const { fundWallet } = useFundWallet();

    const { ready: privyWalletReady, wallets } = useWallets();
    const [isSendModalOpen, setIsSendModalOpen] = useState(false);
    const { ethPrice } = useTokenPrice();
    const [tokens, setTokens] = useState<TokenBalance[]>([]);
    const [ethBalance, setEthBalance] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);


    useEffect(() => {
        if (privyReady && authenticated) {
            // console.log(privyUser, "privy user details")
        }
    }, [privyReady, privyUser, authenticated]);

    useEffect(() => {
        if (privyWalletReady && wallets.length > 0) {
            // console.log("Wallets ready");
            // console.log(wallets)
            if (activeWallet) {
                setWalletAddress(activeWallet.address as `0x${string}`)
            } else {
                setWalletAddress(wallets[0].address as `0x${string}`)
            }
        }
    }, [privyWalletReady, wallets, activeWallet]);

    useEffect(() => {
        if (!walletAddress) {
            setTokens([]);
            setEthBalance(null);
            return;
        }
        setIsLoading(true);
        setError(null);
        Promise.all([
            getBalance(walletAddress, "base"),
            getTokenBalances(walletAddress, "base")
        ]).then(([ethBalance, tokenData]) => {
            const ethBalanceFormatted = ethBalance
                ? parseFloat(Number(formatEther(ethBalance)).toFixed(8))
                : 0;
            setEthBalance(ethBalanceFormatted);
            const validTokens = (tokenData?.filter(token =>
                token.balance !== null &&
                !token.error &&
                (Number(token.balance) * (token.metadata?.priceUsd || 0)) > 0.009
            ) || []).map(token => ({
                ...token,
                rawBalance: token.rawBalance ?? token.balance ?? '0',
                balance: token.balance ?? '0',
                decimals: token.decimals ?? token.metadata?.decimals ?? 18,
            }));
            setTokens(validTokens);
        }).catch(() => {
            setError("Failed to load token balances. Please try again later.");
        }).finally(() => {
            setIsLoading(false);
        });
    }, [walletAddress]);

    const handleAddFunds = async () => {
        await fundWallet(walletAddress!);
    }

    const handleCopyAddress = (address: string) => {
        navigator.clipboard.writeText(address);
        toast.success("Address copied to clipboard");
    }

    return (
        <section className="mx-auto">
            {/* Blue Header Card */}
            <div className="max-h-[360px] h-[360px] rounded-[56px] bg-color2 text-white px-[40px] mb-8 shadow-lg relative overflow-hidden flex items-start justify-between">
                <div className="flex flex-col items-start justify-between gap-6">
                    <div className="flex flex-col gap-[50px] mt-[35px] justify-center">
                        <div className="text-[32px] font-medium font-funnel-display text-color8 mb-2">Wallet Balance <span className="flex items-center gap-2 text-white/40 text-sm font-funnel-sans">{truncateAddress(walletAddress ?? "")} <Copy className="w-4 h-4" onClick={() => handleCopyAddress(walletAddress ?? "")} /></span></div>
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex flex-col items-start gap-4">
                                <span className="text-4xl md:text-[72px] font-bold font-funnel-display text-white">${totalValue.toFixed(2)}</span>
                                <div className="flex items-center gap-3 mt-2">
                                    {/* <span className="text-base font-medium text-secondary-green text-[20px]">+${(totalValue * 0.2).toFixed(2)}</span> */}
                                    {/* <span className="text-[19px] font-medium text-white/40 font-funnel-sans flex items-center gap-3">
                                        00.00%
                                        <svg width="11" height="8" viewBox="0 0 11 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M5.57022 0L10.189 8H0.951416L5.57022 0Z" fill="#30D158" />
                                        </svg>
                                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M4.80777 8L9.42657 1.90735e-06H0.188965L4.80777 8Z" fill="#FF453A" />
                                        </svg>
                                        (24h)
                                    </span> */}
                                </div>
                            </div>
                            <Button
                                onClick={() => handleAddFunds()}
                                variant="secondary"
                                className="bg-color8 h-[100%] min-h-[88px] min-w-[280px] ml-8 text-color4 font-semibold px-8 py-3 rounded-full text-[28px] border-none leading-[120%] flex items-center gap-[12px]"
                            >
                                <svg width="36" height="35" viewBox="0 0 36 35" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="1.95142" y="1.5" width="32" height="32" rx="16" stroke="#112969" strokeWidth="2.85714" />
                                    <path d="M24.2517 19.5449L22.2312 17.5244L19.3806 20.375V9.15527H16.5232V20.376L13.6716 17.5244L11.6511 19.5449L17.9519 25.8447L24.2517 19.5449Z" fill="#112969" />
                                </svg>
                                Deposit
                            </Button>
                        </div>

                    </div>
                    <div className="flex gap-[36px] my-[20px]">
                        <button
                            className="text-white/40 font-funnel-sans border border-white/40 rounded-full px-4 py-2 uppercase hover:text-white/80"
                            onClick={() => setIsSendModalOpen(true)}
                        >
                            Withdraw
                        </button>
                        {/* <span className="text-white/40 font-funnel-sans">GAIN/LOSS <span className="text-white/80 font-semibold pl-1">${(totalValue * 0.12).toFixed(2)}</span></span> */}
                        {/* <span className="text-white/40 font-funnel-sans">INFLOWS <span className="text-white/80 font-semibold pl-1">${(totalValue * 0.5).toFixed(2)}</span></span> */}
                        {/* <span className="text-white/40 font-funnel-sans">OUTFLOWS <span className="text-white/80 font-semibold pl-1">${(totalValue * 0.05).toFixed(2)}</span></span> */}
                    </div>
                </div>
                {/* Decorative dots/graphics can be added here if desired */}
                <div className="mt-auto h-[80%]">
                    <Image
                        src="/images/wallet-icons/wallet_graphic.png"
                        alt="Wallet Header Background"
                        width={500}
                        height={500}
                        quality={100}
                        className="h-full w-full object-fit"
                    /></div>
            </div>

            {/* Black Card with Tabs */}
            <Card className="bg-black rounded-[56px] shadow-xl p-[40px] min-h-screen border-none">
                <Tabs defaultValue="assets" className="w-full">
                    <TabsList className="flex gap-[80px] pt-8 pb-16 items-center justify-start font-funnel-display font-medium">
                        <TabsTrigger value="assets" className="text-2xl font-semibold text-white/40 bg-transparent data-[state=active]:text-white data-[state=active]:bg-transparent">Assets</TabsTrigger>
                        <TabsTrigger value="activity" className="text-2xl font-semibold text-white/40 bg-transparent data-[state=active]:text-white data-[state=active]:bg-transparent">Activity</TabsTrigger>
                        <TabsTrigger value="limit-orders" className="text-2xl font-semibold text-white/40 bg-transparent data-[state=active]:text-white data-[state=active]:bg-transparent">Limit Orders</TabsTrigger>
                    </TabsList>
                    <div className="pb-8 pt-4">
                        <TabsContent value="assets">
                            {walletAddress && (
                                <Assets
                                    onTotalValueChange={setTotalValue}
                                    tokens={tokens}
                                    ethBalance={ethBalance}
                                    isLoading={isLoading}
                                    error={error}
                                    ethPrice={ethPrice ?? 0}
                                />
                            )}
                        </TabsContent>
                        <TabsContent value="activity">
                            <Activity />
                        </TabsContent>
                        <TabsContent value="limit-orders">
                            <div className="text-center text-white/40 py-12">Limit Orders coming soon...</div>
                        </TabsContent>
                    </div>
                </Tabs>
            </Card>

            {isSendModalOpen && <SendTransactionModal
                isOpen={isSendModalOpen}
                onClose={() => setIsSendModalOpen(false)}
            />}
            <Toaster />
        </section>
    );
} 