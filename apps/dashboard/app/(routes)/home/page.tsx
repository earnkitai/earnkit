'use client';

import { useEffect, useState, useRef } from 'react';
// import { useWallets } from '@/providers/wallet-provider';
// import { useTurnkey } from '@turnkey/sdk-react';
import { useRouter } from 'next/navigation';
// import { ArrowUp } from 'lucide-react';
import { ConnectedSolanaWallet, ConnectedWallet, useActiveWallet, usePrivy, useWallets, Wallet } from '@privy-io/react-auth';
// import { Separator } from '@/app/components/ui/separator';
import { Icons } from '@/app/components/sections/icons';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
// import { Account } from 'viem';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';

// import { createLinkedAccounts } from '@/actions/linked-accounts';

export default function Dashboard() {
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [riskLevel, setRiskLevel] = useState<'Low Risk' | 'High Risk'>('Low Risk');
    // const { state } = useWallets();
    // const { selectedAccount } = state;
    const { ready: privyReady, authenticated, user: privyUser } = usePrivy();
    const { wallets: privyWallets } = useWallets();
    const [wallets, setWallets] = useState<Wallet[]>([]);
    const { wallet: activeWallet, setActiveWallet } = useActiveWallet();
    const [userId, setUserId] = useState<string | null>(null);
    const router = useRouter();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (privyReady && authenticated) {
            const wallets = privyUser?.linkedAccounts?.filter((acc) => acc.type === "wallet") as Wallet[];
            setWallets(wallets);
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

    useEffect(() => {
        // Load risk level from localStorage on component mount
        const savedRiskLevel = localStorage.getItem('riskLevel') as 'Low Risk' | 'High Risk';
        if (savedRiskLevel) {
            setRiskLevel(savedRiskLevel);
        } else {
            // Set default to Low Risk if not set
            localStorage.setItem('riskLevel', 'Low Risk');
        }
    }, []);

    const handleRiskLevelChange = (level: 'Low Risk' | 'High Risk') => {
        setRiskLevel(level);
        localStorage.setItem('riskLevel', level);
    };

    const handleSubmit = async (e: React.FormEvent, initialMessage?: string) => {
        console.log("handleSubmit")
        e.preventDefault();
        if (!initialMessage?.trim() && !inputValue.trim() || !userId) return;

        const inputValueNew = initialMessage ? initialMessage.trim() : inputValue.trim();
        console.log("inputValueNew", initialMessage)
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

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
    };

    // const handleOnClickZora = () => {
    //     // call handleSubmit
    //     const event = new Event('submit') as unknown as React.FormEvent;
    //     handleSubmit(event, "Start trading on Zora");
    // };

    const walletTypeLabel = (wallet: ConnectedWallet | ConnectedSolanaWallet) => {
        if (wallet.connectorType === 'embedded' || wallet.connectorType === 'privy') return 'Privy Wallet';
        return (wallet.walletClientType || wallet.connectorType || "").toLowerCase() || 'Wallet';
    };

    const walletIcon = (wallet: ConnectedWallet | ConnectedSolanaWallet) => {
        if (wallet.connectorType === 'embedded') return <Icons.sidebarWalletIcon className="w-4 h-4" />;
        const iconName = (wallet.walletClientType || wallet.connectorType || "").toLowerCase();
        // Only allow certain names (add more as needed)
        const knownIcons = ["metamask", "phantom", "rainbow", "coinbase", "walletconnect"];
        if (knownIcons.includes(iconName)) {
            return (
                <Image
                    src={`/images/wallet-icons/${iconName}.svg`}
                    alt={iconName + " icon"}
                    width={16}
                    height={16}
                    className="rounded-full"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            );
        }
        return <Icons.sidebarWalletIcon className="w-6 h-6" />;
    };

    const handleWalletChange = (walletAddress: string) => {
        const wallet = privyWallets.find((wallet) => wallet.address === walletAddress);
        if (wallet) {
            setActiveWallet(wallet);
        }
    };

    return (
        <section className="w-full mx-auto p-4 sm:p-6 flex flex-col min-h-screen bg-black/4 justify-center">
            <div className='mx-auto flex flex-col md:w-[calc(100%-250px)] md:max-w-[1100px] sm:w-[calc(100%-80px)]'>
                {/* Logo Section */}
                <div className="text-center mb-4">
                    <div className="mb-2 flex justify-center items-center">
                        <Icons.earnyLogoBlack className="w-24 sm:w-32" />
                    </div>
                </div>
                {/* Title Section */}
                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold mb-2 text-black/80">Your Earning Assistant +</h2>
                    <p className="text-black/40 text-lg">I identify and execute the most rewarding DeFi workflows.</p>
                </div>
                {/* Search Bar */}
                <div className="max-w-xl mx-auto w-full mb-4">
                    <form onSubmit={handleSubmit} className="relative bg-white rounded-2xl p-1 border border-black/10 mb-2">
                        {/* <input
                            type="text"
                            value={inputValue}
                            onChange={handleInputChange}
                            placeholder="Ask Earny"
                            className="w-full p-2 sm:p-3 sm:px-4 pr-10 sm:pr-10 bg-transparent text-md sm:text-xl text-black/80 font-funnel-sans font-semibold border-2 border-transparent outline outline-black/10 rounded-full focus:outline-transparent focus:border focus:border-2 focus:border-black/80"
                        />
                        <button
                            type="submit"
                            className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 bg-black disabled:bg-black/20 rounded-full disabled:opacity-50"
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
                        </button> */}
                        <textarea
                            value={inputValue}
                            onChange={handleInputChange}
                            placeholder="Ask Earny"
                            className="w-full max-w-full overflow-y-auto resize-none p-2 px-4 bg-transparent rounded-lg border-none focus:outline-none focus:border-none font-funnel-sans text-black/80 font-medium max-h-[150px] h-[60px]"
                            disabled={isLoading}
                            rows={1}
                            ref={textareaRef}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit(e);
                                }
                            }}
                        />
                        <div className="flex items-center justify-between border-none bg-transparent px-2 py-1">
                            <div className='flex items-center gap-1'>
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                        <button
                                            type="button"
                                            className="flex items-center gap-1 px-2 py-1 rounded-full border border-black/10 bg-white hover:bg-black/4 transition-all min-w-[120px]"
                                        >
                                            {activeWallet ? (
                                                <>
                                                    {walletIcon(activeWallet)}
                                                    <span className="font-funnel-sans font-medium text-xs  text-black/80">{activeWallet.address?.slice(0, 6)}...{activeWallet.address?.slice(-4)}</span>
                                                </>
                                            ) : (
                                                <span className="font-funnel-sans font-medium text-xs  text-black/80">connecting...</span>
                                            )}
                                            <svg className="w-4 h-4 ml-1 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                                        </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content sideOffset={8} align="start" className="mt-2 w-[320px] bg-white rounded-xl shadow-lg border border-black/10 z-50">
                                        <div className="p-2 text-xs text-gray-700 font-semibold border-b">Select account to use for executing transactions</div>
                                        {wallets.length > 0 && wallets.map((wallet) => (
                                            <DropdownMenu.Item
                                                key={wallet.address}
                                                className={`flex items-center w-full px-4 py-3 gap-3 hover:bg-gray-50 transition-all cursor-pointer ${activeWallet?.address === wallet.address ? 'bg-gray-100' : ''}`}
                                                onSelect={() => {

                                                    handleWalletChange(wallet.address)

                                                }}
                                            >
                                                {walletIcon(wallet as unknown as ConnectedWallet | ConnectedSolanaWallet)}
                                                <div className="flex flex-col flex-1 text-left">
                                                    <span className="font-mono text-sm text-black/90">{wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}</span>
                                                    <span className="text-xs text-gray-500">{walletTypeLabel(wallet as unknown as ConnectedWallet | ConnectedSolanaWallet)}</span>
                                                </div>
                                                {activeWallet?.address === wallet.address && (
                                                    <svg className="w-5 h-5 text-blue-500 ml-2" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                                )}
                                            </DropdownMenu.Item>
                                        ))}
                                    </DropdownMenu.Content>
                                </DropdownMenu.Root>

                                {/* create another dropdown for risk level and have options like low and high risk*/}
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                        <button type="button" className="flex items-center gap-1 px-2 py-1 rounded-full border border-black/10 bg-white hover:bg-black/4 transition-all">
                                            <span className="font-funnel-sans font-medium text-xs text-black/80">{riskLevel}</span>
                                            <svg className="w-4 h-4 ml-1 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                                        </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content sideOffset={8} align="start" className="mt-2 w-[320px] bg-white rounded-xl shadow-lg border border-black/10 z-50">
                                        <div className="p-2 text-xs text-gray-700 font-semibold border-b">Select risk level for trading</div>
                                        <DropdownMenu.Item
                                            className={`flex items-center w-full px-4 py-3 gap-3 hover:bg-gray-50 transition-all cursor-pointer ${riskLevel === 'Low Risk' ? 'bg-gray-100' : ''}`}
                                            onSelect={() => handleRiskLevelChange('Low Risk')}
                                        >
                                            <span className="font-funnel-sans font-medium text-xs text-black/80">Low Risk</span>
                                            {riskLevel === 'Low Risk' && (
                                                <svg className="w-5 h-5 text-blue-500 ml-auto" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                            )}
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item
                                            className={`flex items-center w-full px-4 py-3 gap-3 hover:bg-gray-50 transition-all cursor-pointer ${riskLevel === 'High Risk' ? 'bg-gray-100' : ''}`}
                                            onSelect={() => handleRiskLevelChange('High Risk')}
                                        >
                                            <span className="font-funnel-sans font-medium text-xs text-black/80">High Risk</span>
                                            {riskLevel === 'High Risk' && (
                                                <svg className="w-5 h-5 text-blue-500 ml-auto" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                            )}
                                        </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                </DropdownMenu.Root>
                            </div>
                            <button
                                type="submit"
                                className="p-2 bg-black/80 rounded-full disabled:opacity-20"
                                disabled={isLoading || !inputValue.trim()}
                            >
                                <svg
                                    width="12"
                                    height="12"
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

                {/* Pills Section */}
                <div className="flex flex-wrap gap-3 justify-center mb-8">
                    {[
                        { label: 'Trade on Zora' },
                        { label: 'Analyse a Token' }

                    ].map((pill) => (
                        <button
                            key={pill.label}
                            type="button"
                            onClick={() => {
                                setInputValue(pill.label);
                                textareaRef.current?.focus();
                            }}
                            className="flex items-center gap-1 px-3 py-1 rounded-full border border-black/10 bg-white hover:bg-black/4 hover:text-black transition-all text-[#666666] font-funnel-sans font-normal text-[12px] group"
                        >
                            {pill.label}
                            <ArrowUpRight className='w-3 h-3 ' />
                        </button>
                    ))}
                </div>

                {/* Features Grid */}
                {/* <div className="mx-auto w-full">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div
                            className="bg-white rounded-3xl flex flex-col justify-between cursor-pointer outline outline-2 outline-black/20 border-4 border-transparent hover:outline-transparent hover:border-black transition-all duration-300 ease-in-out"
                            onClick={handleOnClickZora}
                        >
                            <div className="flex gap-5 p-6">
                                <div className="flex items-start">
                                    <Icons.zoraIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl text-black font-funnel-sans font-semibold mb-0 ">Trader on Zora</h3>
                                    <span className="text-black/40 mb-2 text-sm font-funnel-sans font-normal">Earny finds the best token and trades on behalf of you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b border-black/20' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.zoraSmallIcon />
                                <Icons.swapIcon />
                                <Icons.dexIcon />
                            </div>
                        </div>

                        <div className="bg-white rounded-3xl flex flex-col justify-between cursor-pointer outline outline-2 outline-black/20 border-4 border-transparent hover:outline-transparent hover:border-black transition-all duration-300 ease-in-out">
                            <div className="flex gap-5 p-6">
                                <div className="flex items-start">
                                    <Icons.clankerIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl text-black font-funnel-sans font-semibold mb-0">Trader on Clanker</h3>
                                    <span className="text-black/40 mb-2 text-sm font-funnel-sans font-normal">Earny finds the best token and trades on behalf of you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b border-black/20' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.farcasterSmallIcon />
                                <Icons.swapIcon />
                                <Icons.dexIcon />
                            </div>
                        </div>

                        <div className="bg-white rounded-3xl flex flex-col justify-between cursor-pointer outline outline-2 outline-black/20 border-4 border-transparent hover:outline-transparent hover:border-black transition-all duration-300 ease-in-out">
                            <div className="flex gap-5 p-6">
                                <div className="flex items-start">
                                    <Icons.tokenCreatorIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl text-black font-funnel-sans font-semibold mb-0">Token Creator</h3>
                                    <span className="text-black/40 mb-2 text-sm font-funnel-sans font-normal">Earny creates tokens, airdrops and posts on Farcaster.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b border-black/20' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.farcasterSmallIcon />
                                <Icons.airDropSmallIcon />
                                <Icons.bridgeSmallIcon />
                            </div>
                        </div>

                        <div className="bg-white rounded-3xl flex flex-col justify-between cursor-pointer outline outline-2 outline-black/20 border-4 border-transparent hover:outline-transparent hover:border-black transition-all duration-300 ease-in-out">
                            <div className="flex gap-4 p-6">
                                <div className="flex items-start mb-4">
                                    <Icons.yieldIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl text-black font-funnel-sans font-semibold mb-0">Yield Farmer</h3>
                                    <span className="text-black/40 mb-2 text-sm font-funnel-sans font-normal">Earny finds the highest yields across protocols and stakes your assets for you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b border-black/20' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.renzoIcon />
                                <Icons.liquidIcon />
                                <Icons.aaveSmallIcon />
                            </div>
                        </div>

                        <div className="bg-white rounded-3xl flex flex-col justify-between cursor-pointer outline outline-2 outline-black/20 border-4 border-transparent hover:outline-transparent hover:border-black transition-all duration-300 ease-in-out">
                            <div className="flex gap-5 p-6">
                                <div className="flex items-start">
                                    <Icons.yieldIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl text-black font-funnel-sans font-semibold mb-0">LP Optimizer</h3>
                                    <span className="text-black/40 mb-2 text-sm font-funnel-sans font-normal">Earny provides liquidity where rewards are best, auto-rebalances positions when needed.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b border-black/20' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.renzoIcon />
                                <Icons.liquidIcon />
                                <Icons.aaveSmallIcon />
                            </div>
                        </div>

                        <div className="bg-white rounded-3xl flex flex-col justify-between cursor-pointer outline outline-2 outline-black/20 border-4 border-transparent hover:outline-transparent hover:border-black transition-all duration-300 ease-in-out">
                            <div className="flex gap-5 p-6">
                                <div className="flex items-start">
                                    <Icons.yieldIcon />
                                </div>
                                <div>
                                    <h3 className="text-xl text-black font-funnel-sans font-semibold mb-0">Airdrop Hunter</h3>
                                    <span className="text-black/40 mb-2 text-sm font-funnel-sans font-normal">Earny scouts potential airdrops and completes the tasks needed to qualify and auto-claims for you.</span>
                                </div>
                            </div>
                            <Separator className='w-full border-b border-black/20' />
                            <div className="flex gap-3 items-center justify-center p-4">
                                <Icons.renzoIcon />
                                <Icons.liquidIcon />
                                <Icons.aaveSmallIcon />
                            </div>
                        </div>
                    </div>
                </div> */}
            </div>
            {/* Powered by section */}
            <div className="absolute bottom-4 right-4 text-center flex flex-col justify-center items-end">
                <Icons.poweredByEarnkit className="w-30" />
            </div>
        </section>
    );
}
