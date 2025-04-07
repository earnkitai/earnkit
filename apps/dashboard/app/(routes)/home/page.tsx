'use client';

import { useEffect, useState } from 'react';
// import { useWallets } from '@/providers/wallet-provider';
import { useTurnkey } from '@turnkey/sdk-react';
import { useRouter } from 'next/navigation';
// import { ArrowUp } from 'lucide-react';
import { Icons } from '@/app/components/sections/icons';

export default function Dashboard() {
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // const { state } = useWallets();
    // const { selectedAccount } = state;
    const { turnkey } = useTurnkey();
    const [userId, setUserId] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (turnkey) {
            const fetchUser = async () => {
                try {
                    const currentUser = await turnkey.getCurrentUser();
                    if (currentUser?.userId) {
                        setUserId(currentUser.userId);
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }
            };
            fetchUser();
        }
    }, [turnkey]);

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
        <div className="w-full mx-auto p-4 sm:p-6 flex flex-col h-screen items-center justify-center font-funnel-sans">
            <section className="w-full p-4 sm:p-10 relative pb-10 sm:pb-20 overflow-y-visible">
                <div className="text-center mb-8 sm:mb-12 pt-4">
                    <div className="mb-6 sm:mb-10 self-center flex justify-center items-center">
                        <Icons.earnkitLogoBlack className="w-32 sm:w-40" />
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold mb-1 font-funnel-display text-black/80">What would you like to swap?</h1>
                    <p className="text-black/40 font-funnel-sans text-sm sm:text-base">
                        Ask EarnKit to buy, sell or swap tokens on Base.
                    </p>
                </div>

                {/* Chat Interface with suggestions */}
                <div className="bg-black/4 p-2 mb-4 border border-black/10 rounded-2xl sm:rounded-3xl max-w-2xl mx-auto">
                    <div className="flex items-center gap-2 p-2 sm:p-3 relative">
                        <form onSubmit={handleSubmit} className="w-full">
                            <div className="relative">
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={handleInputChange}
                                    placeholder="Swap anything..."
                                    className="w-full p-3 sm:p-4 pr-10 sm:pr-12 bg-transparent rounded-lg text-lg sm:text-xl text-black/80 font-funnel-sans font-semibold border-none focus:outline-none focus:border-none"
                                    disabled={isLoading}
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
                            </div>
                        </form>
                    </div>
                </div>

                {/* last section */}
                <div className="flex flex-col sm:flex-row items-center gap-2 font-funnel-sans text-xs sm:text-sm justify-center mt-6 sm:mt-10 flex-wrap">
                    <span className="text-black/40 text-center">
                        EarnKit&apos;s trading agent is powered by
                    </span>
                    <div className="flex flex-wrap justify-center gap-2 sm:gap-4">
                        <span className="font-medium flex text-black/60 items-center gap-1">
                            <Icons.uniswapIcon className="w-3 h-3 sm:w-4 sm:h-4" />Uniswap
                        </span>
                        <span className="font-medium flex text-black/60 items-center gap-1">
                            <Icons.jupiterIcon className="w-3 h-3 sm:w-4 sm:h-4" />Jupiter Exchange
                        </span>
                        <span className="font-medium flex text-black/60 items-center gap-1">
                            <Icons.relayIcon className="w-3 h-3 sm:w-4 sm:h-4" />Relay
                        </span>
                        <span className="text-black/40">and</span>
                        <span className="font-medium flex text-black/60 items-center gap-1">
                            <Icons.socketIcon className="w-3 h-3 sm:w-4 sm:h-4" />Socket
                        </span>
                    </div>
                </div>
            </section>
        </div>
    );
}
