'use client';

import { useEffect, useState } from 'react';
// import { useWallets } from '@/providers/wallet-provider';
// import { useTurnkey } from '@turnkey/sdk-react';
import { useRouter } from 'next/navigation';
// import { ArrowUp } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { Separator } from '@/app/components/ui/separator';
import { Icons } from '@/app/components/sections/icons';
// import { createLinkedAccounts } from '@/actions/linked-accounts';

export default function Dashboard() {
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // const { state } = useWallets();
    // const { selectedAccount } = state;
    const { ready: privyReady, authenticated, user: privyUser } = usePrivy();
    const [userId, setUserId] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (privyReady && authenticated) {
            const fetchUser = async () => {
                try {
                    const currentUser = privyUser;
                    if (currentUser?.id) {
                        const userId = currentUser.id.split(':').pop() || currentUser.id;
                        setUserId(userId);

                        // if (currentUser.linkedAccounts && currentUser.linkedAccounts.length > 0) {
                        //     try {
                        //         await createLinkedAccounts(userId, currentUser.linkedAccounts);
                        //     } catch (error) {
                        //         console.log("Error creating linked accounts:", error);
                        //     }
                        // }
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }
            };
            fetchUser();
        }
    }, [privyReady, authenticated, privyUser]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() || !userId) return;
        const inputValueNew = inputValue.trim();
        setInputValue('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: userId,
                    title: inputValueNew.slice(0, 50) + (inputValueNew.length > 50 ? '...' : ''),
                }),
            });
            const data = await response.json();
            console.log(data, "chat first id")
            if (data?.chat?.id) {
                // send the inputValueNew to the chat page using localStorage
                localStorage.setItem(`initialMessage ${data.chat.id}`, inputValueNew);
                router.push(`/chat/${data.chat.id}`);
            }
        } catch (error) {
            console.error('Error creating new chat:', error);
            setIsLoading(false);
            return;
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    };

    return (
        <section className="w-full mx-auto p-4 sm:p-6 flex flex-col min-h-screen bg-black/4">
            <div className='mx-auto flex flex-col w-[calc(100%-400px)]'>
                {/* Logo Section */}
                <div className="text-center mb-8">
                    <div className="mb-6 flex justify-center items-center">
                        <Icons.earnyLogoBlack className="w-28 sm:w-32" />
                    </div>
                </div>

                {/* Search Bar */}
                <div className="max-w-2xl mx-auto w-full mb-16">
                    <form onSubmit={handleSubmit} className="relative">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={handleInputChange}
                            placeholder="Ask Earny"
                            className="w-full p-3 sm:p-4 pr-10 sm:pr-12 bg-transparent text-lg sm:text-xl text-black/80 font-funnel-sans font-semibold border border-transparent outline outline-black/40 rounded-full focus:outline-none focus:border focus:border-2 focus:border-black/80"
                        />
                        <button
                            type="submit"
                            className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 bg-black/80 rounded-full disabled:opacity-50"
                            disabled={isLoading || inputValue === ''}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="w-5 h-5 sm:w-6 sm:h-6"
                            >
                                <path
                                    d="M4.2503 11.5713L12 3.82156L19.7498 11.5713"
                                    stroke="white"
                                    strokeWidth="2.78195"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M12 3.82185L12 20.1777"
                                    stroke="white"
                                    strokeWidth="2.78195"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </button>
                    </form>
                </div>

                {/* Title Section */}
                <div className="text-center mb-12">
                    <h2 className="text-3xl font-bold mb-4">Your Earning Assistant +</h2>
                    <p className="text-gray-600">I identify and execute the most rewarding DeFi workflows.</p>
                </div>

                {/* Features Grid */}
                <div className="mx-auto w-full">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Trader on Zora */}
                        <div className="bg-white rounded-3xl cursor-pointer border border-black/20 outline outline-transparent outline-4 hover:outline-black hover:border-transparent transition-all duration-300 ease-in-out">
                            <div className="flex gap-4 p-6">
                                <div className="flex items-start mb-4">
                                    <Icons.zoraIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl font-funnel-sans font-semibold mb-2 ">Trader on Zora</h3>
                                    <span className="text-gray-600 mb-4 text-sm font-funnel-sans font-normal">Earny finds the best token and trades on behalf of you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.zoraSmallIcon />
                                <Icons.swapIcon />
                                <Icons.dexIcon />
                            </div>
                        </div>

                        {/* Trader on Clanker */}
                        <div className="bg-white rounded-3xl cursor-pointer border border-black/20 outline outline-transparent outline-4 hover:outline-black hover:border-transparent transition-all duration-300 ease-in-out">
                            <div className="flex gap-4 p-6">
                                <div className="flex items-start mb-4">
                                    <Icons.clankerIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl font-funnel-sans font-semibold mb-2">Trader on Clanker</h3>
                                    <span className="text-gray-600 mb-4 text-sm font-funnel-sans font-normal">Earny finds the best token and trades on behalf of you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.farcasterSmallIcon />
                                <Icons.swapIcon />
                                <Icons.dexIcon />
                            </div>
                        </div>

                        {/* Token Creator */}
                        <div className="bg-white rounded-3xl cursor-pointer border border-black/20 outline outline-transparent outline-4 hover:outline-black hover:border-transparent transition-all duration-300 ease-in-out">
                            <div className="flex gap-4 p-6">
                                <div className="flex items-start mb-4">
                                    <Icons.tokenCreatorIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl font-funnel-sans font-semibold mb-2">Token Creator</h3>
                                    <span className="text-gray-600 mb-4 text-sm font-funnel-sans font-normal">Earny creates tokens, airdrops and posts on Farcaster.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.farcasterSmallIcon />
                                <Icons.airDropSmallIcon />
                                <Icons.bridgeSmallIcon />
                            </div>
                        </div>

                        {/* Yield Farmer */}
                        <div className="bg-white rounded-3xl cursor-pointer border border-black/20 outline outline-transparent outline-4 hover:outline-black hover:border-transparent transition-all duration-300 ease-in-out">
                            <div className="flex gap-4 p-6">
                                <div className="flex items-start mb-4">
                                    <Icons.yieldIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl font-funnel-sans font-semibold mb-2">Yield Farmer</h3>
                                    <span className="text-gray-600 mb-4 text-sm font-funnel-sans font-normal">Earny finds the highest yields across protocols and stakes your assets for you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.renzoIcon />
                                <Icons.liquidIcon />
                                <Icons.aaveSmallIcon />
                            </div>
                        </div>

                        {/* LP Optimizer */}
                        <div className="bg-white rounded-3xl cursor-pointer border border-black/20 outline outline-transparent outline-4 hover:outline-black hover:border-transparent transition-all duration-300 ease-in-out">
                            <div className="flex gap-4 p-6">
                                <div className="flex items-start mb-4">
                                    <Icons.yieldIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl font-funnel-sans font-semibold mb-2">LP Optimizer</h3>
                                    <span className="text-gray-600 mb-4 text-sm font-funnel-sans font-normal">Earny provides liquidity where rewards are best, auto-rebalances positions when needed.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.renzoIcon />
                                <Icons.liquidIcon />
                                <Icons.aaveSmallIcon />
                            </div>
                        </div>

                        {/* Airdrop Hunter */}
                        <div className="bg-white rounded-3xl cursor-pointer border border-black/20 outline outline-transparent outline-4 hover:outline-black hover:border-transparent transition-all duration-300 ease-in-out">
                            <div className="flex gap-4 p-6">
                                <div className="flex items-start mb-4">
                                    <Icons.yieldIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl font-funnel-sans font-semibold mb-2">Airdrop Hunter</h3>
                                    <span className="text-gray-600 mb-4 text-sm font-funnel-sans font-normal">Earny scouts potential airdrops and completes the tasks needed to qualify and auto-claims for you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.renzoIcon />
                                <Icons.liquidIcon />
                                <Icons.aaveSmallIcon />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Powered by section */}
            <div className="mt-12 text-center flex flex-col justify-center items-end">
                <Icons.poweredByEarnkit className="w-30" />
            </div>
        </section>
    );
}
