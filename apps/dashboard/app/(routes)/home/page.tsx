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
        <div className="w-full mx-auto p-6 flex flex-col h-screen items-center font-funnel-sans">
            <section className="w-full p-10 relative pb-20 overflow-y-visible">
                <div className="text-center mb-12 pt-20">
                    <div className="mb-10 self-center flex justify-center items-center">
                        <Icons.earnkitLogoBlack className="w-40" />
                    </div>
                    <h1 className="text-3xl font-bold mb-1 font-funnel-display text-black/80">What would you like to swap?</h1>
                    <p className="text-black/40 font-funnel-sans text-[1rem]">
                        Ask EarnKit to buy, sell or swap tokens on Base.
                    </p>
                </div>

                {/* Chat Interface with suggestions */}
                <div className="bg-black/4 p-2 mb-4 border border-black/10 rounded-3xl max-w-2xl mx-auto">
                    <div className="flex items-center gap-2  p-3 relative ">
                        <form onSubmit={handleSubmit} className="w-full">
                            <div className="relative">
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={handleInputChange}
                                    placeholder="Swap anything..."
                                    className="w-full p-4 pr-12 bg-transparent rounded-lg text-xl text-black/80 font-funnel-sans font-semibold border-none focus:outline-none focus:border-none"
                                    disabled={isLoading}
                                />
                                <button
                                    type="submit"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/80 rounded-full disabled:opacity-50"
                                    disabled={isLoading || inputValue === ''}
                                >
                                    <svg
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
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
                {/* <div className="flex flex-col gap-2 mt-20">
                    <h2 className="text-center text-xl font-bold mb-6 font-funnel-sans">Alpha&apos;s calling. <span className="text-black/40">Discover what others are swapping.</span></h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 text-[12px] font-funnel-sans">

                        <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/10 ">
                            <div className="flex items-center gap-1 mb-4 justify-center border border-black/20 bg-black/4 rounded-full px-2 py-1 max-w-max">
                                <Icons.basetokenImage className="w-4 h-4" />
                                <span className="font-bold">KAITO</span>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Swaps</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        84%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Mkt Cap.</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        182%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                            </div>
                        </div>


                        <div className="bg-white p-4 rounded-xl shadow-sm border border-black/10">
                            <div className="flex items-center gap-1 mb-4 justify-center border border-black/20 bg-black/4 rounded-full px-2 py-1 max-w-max">
                                <Icons.basetokenImage className="w-4 h-4" />
                                <span className="font-bold">YUKI</span>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Swaps</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        76%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Mkt Cap.</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        150%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl shadow-sm border border-black/10">
                            <div className="flex items-center gap-1 mb-4 justify-center border border-black/20 bg-black/4 rounded-full px-2 py-1 max-w-max">
                                <Icons.basetokenImage className="w-4 h-4" />
                                <span className="font-bold">MIKA</span>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Swaps</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        90%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Mkt Cap.</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        200%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl shadow-sm border border-black/10">
                            <div className="flex items-center gap-1 mb-4 justify-center border border-black/20 bg-black/4 rounded-full px-2 py-1 max-w-max">
                                <Icons.basetokenImage className="w-4 h-4" />
                                <span className="font-bold">REN</span>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Swaps</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        15%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Mkt Cap.</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        120%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl shadow-sm border border-black/10">
                            <div className="flex items-center gap-1 mb-4 justify-center border border-black/20 bg-black/4 rounded-full px-2 py-1 max-w-max">
                                <Icons.basetokenImage className="w-4 h-4" />
                                <span className="font-bold">SORA</span>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Swaps</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        65%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Mkt Cap.</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        135%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl shadow-sm border border-black/10">
                            <div className="flex items-center gap-1 mb-4 justify-center border border-black/20 bg-black/4 rounded-full px-2 py-1 max-w-max">
                                <Icons.basetokenImage className="w-4 h-4" />
                                <span className="font-bold">HARU</span>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Swaps</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        92%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-black/40">Mkt Cap.</span>
                                    <span className="text-black text-[1rem] font-bold flex items-center gap-1">
                                        175%
                                        <ArrowUp className="w-4 h-4 text-green-500" />
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div> */}

                <div className="flex items-center gap-2 font-funnel-sans text-[0.85rem] justify-center mt-10">
                    <span className="text-black/40  text-[0.85rem] text-center flex flex-row wrap-wrap gap-2">
                        EarnKit&apos;s trading agent is powered by
                    </span>
                    <span className="font-medium flex text-black/60 flex-row gap-1 items-center max-w-max"> <Icons.uniswapIcon className="w-4 h-4" />Uniswap</span>
                    <span className="font-medium flex text-black/60 flex-row gap-1 items-center max-w-max"> <Icons.jupiterIcon className="w-4 h-4" />Jupiter Exchange</span>
                    <span className="font-medium flex text-black/60 flex-row gap-1 items-center max-w-max"> <Icons.relayIcon className="w-4 h-4" />Relay</span>
                    <span className="text-black/40 font-funnel-sans text-[0.85rem] text-center flex flex-row wrap-wrap gap-2">
                        and
                    </span>
                    <span className="font-medium flex text-black/60 flex-row gap-1 items-center max-w-max"> <Icons.socketIcon className="w-4 h-4" />Socket</span>
                </div>
            </section>
        </div>
    );
}
