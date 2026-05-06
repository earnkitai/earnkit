'use client';

import { Icons } from '@/app/components/sections/icons';
import { truncateAddress } from '@/lib/utils';
import { ConnectedWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTokenData } from '@/hooks/use-token-data';
import { TokenDisplay } from '@/components/dashboard/TokenDisplay';
import { motion, AnimatePresence } from 'framer-motion';
import { useBalance } from '@/providers/balance-provider';
import { v4 as uuidv4 } from 'uuid';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Dashboard() {
    const { wallets: privyWallets } = useWallets();
    const { ready, authenticated, user: privyUser } = usePrivy();
    const [activeWallet, setActiveWallet] = useState<ConnectedWallet | null>(null);
    const [isPortfolioHidden, setIsPortfolioHidden] = useState(false);
    const { tokens, loading, error } = useTokenData();
    const [currentTokenIndex, setCurrentTokenIndex] = useState(0);
    const { usdValue, isLoading: balanceLoading } = useBalance();
    const [userId, setUserId] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (ready && authenticated && privyUser) {
            // console.log(privyUser, 'privyUser');
            const userId = privyUser?.id.split(':').pop() || privyUser?.id;
            // console.log(userId, 'userId');
            setUserId(userId);
        }
    }, [ready, authenticated, privyUser]);

    useEffect(() => {
        if (privyWallets.length > 0) {
            const wallet = privyWallets.find((wallet) => wallet.walletClientType === "privy");
            console.log(privyWallets, "privyWallets")
            if (wallet) {
                setActiveWallet(wallet);
            }
        }
    }, [privyWallets]);

    useEffect(() => {
        if (tokens.length > 0) {
            console.log(tokens, 'tokens');
            const interval = setInterval(() => {
                setCurrentTokenIndex((prev) => (prev + 1) % tokens.length);
            }, 5000); // Switch token every 5 seconds

            return () => clearInterval(interval);
        }
    }, [tokens.length]);


    const handleNewChat = async () => {

        if (!userId) return;

        const clientGeneratedId = uuidv4();

        // // Store the initial message locally using the generated ID
        // localStorage.setItem(`initialMessage ${clientGeneratedId}`, inputValueNew);

        // Redirect immediately
        router.push(`/chat/${clientGeneratedId}`);

        try {
            // Fire and forget (background) DB creation
            await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: userId,
                    chatId: clientGeneratedId, // important: pass the UUID to backend
                    title: "New Chat",
                }),
            });
        } catch (error) {
            console.error('Error creating new chat:', error);
            // Optional: show a toast or handle background error
        }
    };

    return (
        <section className="w-full mx-auto text-white">
            <div className="grid grid-cols-1 md:grid-cols-8 md:grid-rows-8 gap-4 max-w-7xl mx-auto h-[95vh]">
                {/* Your Earning Assistant - div6 */}
                <div className="md:col-start-1 md:col-end-3 md:row-start-1 md:row-end-7 bg-color13 rounded-[56px] p-[40px] flex flex-col justify-between">
                    <div>
                        <Icons.newEarnyLogoWithWhite className="w-40 mb-4" />
                        <h2 className="text-2xl font-bold mb-2 font-funnel-display text-white/80">Your Earning</h2>
                        <h2 className="text-2xl font-bold mb-2 font-funnel-display text-white/80">Assistant <Icons.sparkleWhiteIcon className="w-6 h-6 inline-block" /></h2>
                        <p className="max-w-[95%] text-white/40 font-funnel-sans font-normal mt-[12px]">Earn with automated trading on Zora, Uniswap, Jupiter and more</p>
                    </div>
                </div>

                {/* 100 points - div1 */}
                <div className="md:col-start-3 md:col-end-5 md:row-start-1 md:row-end-3 bg-black rounded-[56px] p-6 flex flex-col justify-center items-center">
                    <div>
                        <p className="text-xl font-medium font-funnel-display text-white/80 blur-sm">100 points</p>
                    </div>
                    <button
                        className="flex items-center justify-center gap-2 max-w-max border border-white/20 rounded-full py-3 px-6 mt-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled>
                        <Icons.newLeaderboardIcon className="w-5 h-5" />
                        <span>Leaderboard</span>
                    </button>
                </div>

                {/* EarnKit Wallet - div2 */}
                <div className="md:col-start-5 md:col-end-7 md:row-start-1 md:row-end-3 bg-black rounded-[56px] p-6 flex flex-col justify-center items-center">
                    <p className="text-xl font-medium font-funnel-display text-white/80">EarnKit Wallet</p>
                    <Link href="/wallet" className="flex items-center justify-center gap-2 max-w-max border border-white/20 rounded-full py-3 px-6 mt-4 hover:bg-white/10 transition-colors">
                        <Icons.newSidebarWalletMenuIcon className="w-5 h-5 text-[#2E70EA]" />
                        <span className="font-mono">{truncateAddress(activeWallet?.address || '', { prefix: 5, suffix: 4 })}</span>
                    </Link>
                </div>

                {/* Try Earny on - div3 */}
                <div className="md:col-start-7 md:col-end-9 md:row-start-1 md:row-end-3 bg-black rounded-[56px] p-6 flex flex-col justify-center items-center">
                    <p className="text-xl font-medium font-funnel-display text-white/80 flex items-center gap-2 justify-center">Try <span className='h-full w-auto text-color1 flex items-end justify-center gap-2' ><Icons.earnyLogoBlack className='h-5 max-w-max text-white' /></span> on</p>
                    <Link
                        href="https://farcaster.xyz/earny"
                        target="_blank"
                        className="flex items-center justify-center gap-2 max-w-max border border-white/20 rounded-full py-3 px-6 mt-4 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        <Icons.farcasterFavIcon className="w-5 h-5" />
                        <span>Farcaster</span>
                    </Link>
                </div>

                {/* Portfolio Value - div4 */}
                <div className="md:col-start-3 md:col-end-7 md:row-start-3 md:row-end-7 bg-color2 rounded-[56px] px-[40px] py-[36px] flex flex-col justify-center items-start gap-6">
                    <div className="flex items-center justify-start gap-2">
                        <p className="text-[24px] font-medium font-funnel-display text-color8">Portfolio Value</p>
                        <button
                            onClick={() => setIsPortfolioHidden(!isPortfolioHidden)}
                            className="hover:opacity-80 transition-opacity"
                        >
                            {!isPortfolioHidden ? <Eye className={`w-6 h-6 text-white/70`} /> : <EyeOff className={`w-6 h-6 text-white/70`} />}
                        </button>
                    </div>
                    <div>
                        <h2 className={`text-6xl font-bold font-funnel-sans font-medium ${isPortfolioHidden ? 'blur-md' : ''}`}>
                            ${isPortfolioHidden ? '00.00' : balanceLoading ? '...' : usdValue.toFixed(2)}
                        </h2>
                        <div className={`flex items-center gap-4 text-lg mt-2 font-funnel-sans ${isPortfolioHidden ? 'blur-md' : ''}`}>
                            {/* <span className="text-secondary-green font-medium">
                                {balanceLoading ? (
                                    <div className="animate-pulse w-20 h-6 bg-secondary-green/20 rounded"></div>
                                ) : (
                                    `+$${isPortfolioHidden ? '00.00' : (usdValue * 0.1).toFixed(2)}`
                                )}
                            </span> */}
                            {/* <span className="flex items-center gap-1 text-white/40">
                                {isPortfolioHidden ? '00.00' : balanceLoading ? '...' : '10.5'}%
                                <svg width="23" height="20" viewBox="0 0 23 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M11.3558 0.564941L22.4123 19.7153H0.299316L11.3558 0.564941Z" fill="#30D158" />
                                </svg>
                            </span>
                            <span className="text-white/40 font-funnel-sans font-medium">(24h)</span> */}
                        </div>
                    </div>
                    <button
                        className="bg-white text-color3 font-semibold font-funnel-sans py-6 px-16 rounded-full max-w-max mt-6 text-lg hover:bg-gray-200 transition-colors"
                        onClick={() => handleNewChat()}
                    >
                        Start Earning
                    </button>
                </div>

                {/* Earny Terminal - div5 */}
                <div className="md:col-start-7 md:col-end-9 md:row-start-3 md:row-end-9 bg-color12 rounded-[56px] p-6 flex flex-col justify-start items-center gap-2">
                    <h3 className="text-xl font-semibold text-color16 font-funnel-display font-semibold mb-4">Earny Terminal</h3>
                    {/* <div className="space-y-8 w-full">
                        {[
                            { action: 'Deposit', amount: '$99.99', icon: 'deposit' },
                            { action: 'Sold', amount: 'TOKEN', icon: 'sold' },
                            { action: 'Send', amount: '$99.99', icon: 'send' },
                            { action: 'Deposit', amount: '$99.99', icon: 'deposit' },
                            { action: 'Sold', amount: 'TOKEN', icon: 'sold' },
                            { action: 'Send', amount: '$99.99', icon: 'send' },
                            { action: 'Bought', amount: 'TOKEN', icon: 'bought' },
                        ].map((item, index) => (
                            <div key={index} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <div className="rounded-full flex items-center justify-center">
                                        {item.action === "Deposit" && <Icons.earnyActivityUpArrowIcon className="w-4 h-4 text-green-400" />}
                                        {item.action === "Sold" && <Icons.earnyActivityDownArrowIcon className="w-4 h-4 text-green-400" />}
                                        {item.action === "Send" && <Icons.earnyActivityDownArrowIcon className="w-4 h-4 text-green-400" />}
                                        {item.action === "Bought" && <Icons.earnyActivityUpArrowIcon className="w-4 h-4 text-green-400" />}
                                    </div>
                                    <span className='text-white/40 font-funnel-sans font-medium'>{item.action}</span>
                                </div>
                                <span className={item.amount === 'TOKEN' ? 'bg-[#3C3C3C] px-2 py-1 rounded-md text-xs' : ''}>{item.amount}</span>

                                <div className="flex items-center gap-2">
                                    <ArrowUpRight className="w-4 h-4 text-white/50" />
                                </div>
                            </div>
                        ))}


                    </div> */}
                    <div className="flex-1 flex items-center justify-center text-sm text-white/40 text-center">
                        <p className='text-center font-funnel-sans'>Your activity history will appear here once you start using Earny</p>
                    </div>
                </div>

                {/* Base - div7 */}
                <div className="md:col-start-1 md:col-end-5 md:row-start-7 md:row-end-9 bg-black rounded-[56px] p-4 flex items-center justify-center gap-8">
                    <div className='w-32 h-32 rounded-full flex-col flex items-center justify-center text-black text-center text-base font-bold p-2 shrink-0 leading-tight'>
                        <AnimatePresence mode="wait">
                            {loading ? (
                                <motion.div
                                    key="loading"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex items-center justify-center"
                                >
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
                                </motion.div>
                            ) : error ? (
                                <motion.div
                                    key="error"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="text-red-500 text-sm"
                                >
                                    Failed to load token data
                                </motion.div>
                            ) : tokens.length > 0 && tokens[currentTokenIndex] ? (
                                <motion.div
                                    key={currentTokenIndex}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.5 }}
                                    className="w-full h-full flex items-center justify-center"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={tokens[currentTokenIndex].imageUrl || ''}
                                        alt={tokens[currentTokenIndex].name}
                                        className="w-full h-full object-contain"
                                    />
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </div>
                    <AnimatePresence mode="wait">
                        {loading ? (
                            <motion.div
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex items-center justify-center"
                            >
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                            </motion.div>
                        ) : error ? (
                            <motion.div
                                key="error"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="text-red-500"
                            >
                                {error}
                            </motion.div>
                        ) : tokens[currentTokenIndex] ? (
                            <TokenDisplay
                                key={currentTokenIndex}
                                marketCap={tokens[currentTokenIndex].marketCap}
                                volume24h={tokens[currentTokenIndex].volume24h}
                                holders={tokens[currentTokenIndex].holders}
                                tokenName={tokens[currentTokenIndex].name}
                                platform={tokens[currentTokenIndex].platform || 'ZORA'}
                            />
                        ) : null}
                    </AnimatePresence>
                </div>

                {/* Staking APR - div8 */}
                <div className="md:col-start-5 md:col-end-7 md:row-start-7 md:row-end-9 bg-black rounded-[56px] p-6 flex flex-col justify-center items-center gap-2">
                    <p className="text-white/40 font-funnel-sans font-semibold mb-2">Staking APR</p>
                    <p className="text-secondary-green text-4xl font-funnel-sans font-semibold mb-4 leading-none">6.60%</p>
                    <div className="flex items-center gap-2">
                        {/* Placeholder for icons */}
                        <Icons.stakingAPRIcon1 className='w-8 h-8' />
                        <Icons.stakingAPRIcon2 className='w-8 h-8' />
                        <Icons.stakingAPRIcon3 className='w-8 h-8' />
                    </div>
                </div>
            </div>
        </section >
    );
}
