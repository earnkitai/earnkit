'use client';

import { getPublicClient, getTurnkeyWalletClient } from '@/lib/web3';
import { TurnkeyBrowserClient } from '@turnkey/sdk-browser';
import { useWallets } from '@/providers/wallet-provider';
import { useTurnkey } from '@turnkey/sdk-react';
import { useState, useRef, useEffect } from 'react';
import { TransactionRequest } from 'viem';
import { ethers } from 'ethers';
import { showTransactionToast } from '@/lib/toast';
import { useTransactions } from '@/providers/transactions-provider';
import { Toaster } from 'sonner';
import { Icons } from '@/app/components/sections/icons';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRightLeft, Rocket, Coins, LineChart, ExternalLink } from 'lucide-react';

interface Message {
    responseFrom: string;
    tool_name?: string;
    response:
    | string
    | Array<{
        type: string;
        text?: string;
        name?: 'swap_token' | 'token_analysis' | 'get_balance' | string;
    }>
    | string;
}

interface TokenAnalysisResponse {
    name: string;
    symbol: string;
    contract_address: string;
    decimals: string;
    categories: string[];
    description: string;
    image: string;
    price: {
        current: {
            usd: number | string;
            eth: number | string;
        };
        ath: {
            usd: number | string;
            eth: number | string;
        };
        atl: {
            usd: number | string;
            eth: number | string;
        };
        high_24h: {
            usd: number | string;
            eth: number | string;
        };
        low_24h: {
            usd: number | string;
            eth: number | string;
        };
        price_change_percentage_24h: number | string;
    };
    market_metrics: {
        market_cap: {
            usd: number | string;
            eth: number | string;
        };
        fully_diluted_valuation: {
            usd: number | string;
            eth: number | string;
        };
        volume_24h: {
            usd: number | string;
            eth: number | string;
        };
    };
}

interface SwapTokenResponse {
    tokenIn: Token,
    tokenOut: Token,
    amountIn: string,
    feeTier: string;
    originalAmount: string,
    amountType: string,
}

interface Token {
    address: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
    image: string;
    currentPrice: number;
}

interface TokenBalanceResponse {
    symbol: string;
    balance: string;
    decimals: number;
    tokenAddress: string;
}

const ROUTER_ABI = [
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

const ERC20_ABI = [
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
] as const;

const suggestions = {
    Swap: [
        'Swap ETH for Kaito',
        'Swap ETH for USDC',
        'Swap ETH for USDT',
        'Swap ETH for WBTC',
    ],
    Launch: [
        'Launch new token',
        'Launch NFT collection',
        'Launch DAO',
        'Launch DeFi protocol',
    ],
    Earn: [
        'Earn yield on ETH',
        'Earn yield on USDC',
        'Earn yield on WBTC',
        'Earn yield on LP tokens',
    ],
    Analyse: [
        'Analyse ETH token',
        'Analyse token price',
        'Analyse token volume',
        'Analyse token holders',
    ],
};

export default function Dashboard() {
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const { addPendingTransaction } = useTransactions();
    const [showInitialContent, setShowInitialContent] = useState(true);
    const { state } = useWallets();
    const { selectedAccount } = state;
    // const { walletClient } = useTurnkey()
    const { client, authIframeClient } = useTurnkey();
    const [selectedAction, setSelectedAction] = useState<string | null>(null);
    const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);

    // Add ref for the messages container
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Add scroll to bottom function
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const [walletClient, setWalletClient] = useState<Awaited<
        ReturnType<typeof getTurnkeyWalletClient>
    > | null>(null);


    useEffect(() => {
        if (authIframeClient) {
            console.log(authIframeClient, 'authIframeClient');
        }
    }, [authIframeClient]);

    useEffect(() => {
        const initializeWalletClient = async () => {
            if (!selectedAccount || !client) return;
            if (client) {
                console.log(client, 'client found');
            }
            const walletClient = await getTurnkeyWalletClient(
                client as TurnkeyBrowserClient,
                selectedAccount.address,
            );
            setWalletClient(walletClient);
        };

        initializeWalletClient();
    }, [selectedAccount, client]);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim()) return;

        setIsLoading(true);
        setShowInitialContent(false);

        // Add user message to chat
        setMessages((prev) => [
            ...prev,
            { responseFrom: 'user', response: inputValue },
        ]);

        try {
            const response = await fetch('/api/agents/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: inputValue,
                    userWalletAddress: selectedAccount?.address,
                }),
            });

            const data = await response.json();
            console.log(data, 'ai response');

            // Add API responses to chat
            setMessages((prev) => [
                ...prev,
                ...data.response.filter((msg: Message) => msg.response),
            ]);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setIsLoading(false);
            setInputValue('');
        }
    };

    const handleActionClick = (action: string) => {
        setSelectedAction(action);
        setInputValue(action);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setInputValue(value);

        if (!value) {
            setSelectedAction(null);
            setFilteredSuggestions([]);
            return;
        }

        // Convert input to lowercase for case-insensitive search
        const searchTerm = value.toLowerCase();

        // Flatten all suggestions into a single array with their categories
        const allSuggestions = Object.entries(suggestions).flatMap(([category, items]) =>
            items.map(item => ({ category, item }))
        );

        // Filter suggestions based on search term
        const filtered = allSuggestions
            .filter(({ item }) => item.toLowerCase().includes(searchTerm))
            .map(({ item }) => item);

        setFilteredSuggestions(filtered);

        // If input matches a main action, set it as selected
        const mainActions = ['Swap', 'Launch', 'Earn', 'Analyse'];
        const matchedAction = mainActions.find(action =>
            action.toLowerCase().startsWith(searchTerm)
        );

        if (matchedAction) {
            setSelectedAction(matchedAction);
        } else {
            setSelectedAction(null);
        }
    };

    const handleSuggestionClick = (suggestion: string) => {
        setInputValue(suggestion);
        setSelectedAction(null);
        setFilteredSuggestions([]);
    };

    const handleSwapToken = async (data: SwapTokenResponse) => {
        console.log(data, 'swap token data');

        if (!selectedAccount || !client) {
            console.log('❌ Missing requirements:', {
                selectedAccount: !!selectedAccount,
                client: !!client,
            });
            return;
        }

        const walletClient = await getTurnkeyWalletClient(
            client as TurnkeyBrowserClient,
            selectedAccount?.address as `0x${string}`,
        );

        const ROUTER_ADDRESS = '0x2626664c2603336E57B271c5C0b26F421741e481';
        const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

        // Check if we're swapping with ETH
        const isETHSwap = data.tokenIn.address.toLowerCase() === WETH_ADDRESS.toLowerCase();

        if (!isETHSwap) {
            console.log('ERC20 token swap');
            // Check allowance first
            const publicClient = getPublicClient('base');
            const erc20Contract = new ethers.Interface(ERC20_ABI);

            const allowanceData = (await publicClient.readContract({
                address: data.tokenIn.address,
                abi: ERC20_ABI,
                functionName: 'allowance',
                args: [selectedAccount.address, ROUTER_ADDRESS],
            })) as bigint;

            console.log(allowanceData, 'allowance data');

            // If allowance is insufficient, send approve transaction first
            if (allowanceData < BigInt(data.amountIn)) {
                const approveData = erc20Contract.encodeFunctionData('approve', [
                    ROUTER_ADDRESS,
                    ethers.MaxUint256,
                ]);

                console.log(approveData, 'approve data');

                const approveTx = await walletClient.prepareTransactionRequest({
                    to: data.tokenIn.address,
                    data: approveData as `0x${string}`,
                });

                console.log(approveTx, 'approve tx');

                try {
                    const hash = await walletClient.sendTransaction(approveTx);
                    const toastId = showTransactionToast({
                        hash,
                        title: 'Approving token...',
                        description: 'Please wait for approval to complete',
                        type: 'loading',
                    });

                    await publicClient.waitForTransactionReceipt({ hash });

                    showTransactionToast({
                        id: toastId,
                        hash,
                        title: 'Token approved! 🎉',
                        description: 'Now proceeding with swap',
                        type: 'success',
                    });
                } catch (error) {
                    console.error('Error approving token:', error);
                    showTransactionToast({
                        title: 'Error approving token',
                        description: 'Please try again',
                        type: 'error',
                    });
                    return;
                }
            }
        }

        console.log('swapping token with ETH');
        const router = new ethers.Interface(ROUTER_ABI);

        // Encode the swap parameters
        const swapParams = {
            tokenIn: data.tokenIn.address,
            tokenOut: data.tokenOut.address,
            fee: parseInt(data.feeTier),
            recipient: selectedAccount?.address as `0x${string}`,
            amountIn: data.amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
        };

        // Encode the function call
        const encodedData = router.encodeFunctionData('exactInputSingle', [
            swapParams,
        ]);

        // Prepare the transaction request
        const transaction = await walletClient.prepareTransactionRequest({
            to: ROUTER_ADDRESS,
            data: encodedData as `0x${string}`,
            // Include value if swapping ETH
            value: isETHSwap ? BigInt(data.amountIn) : BigInt(0),
        });

        await handleSendTransaction(transaction);
    };

    const handleSendTransaction = async (
        transactionRequest: TransactionRequest,
    ) => {
        if (!selectedAccount || !walletClient) return;
        try {
            const publicClient = getPublicClient('base');
            const hash = await walletClient.sendTransaction(transactionRequest);
            addPendingTransaction({
                hash,
                ...transactionRequest,
            });
            const toastId = showTransactionToast({
                hash,
                title: 'Sending transaction...',
                description: 'View your transaction on explorer',
                type: 'loading',
            });
            await publicClient.waitForTransactionReceipt({
                hash,
            });
            showTransactionToast({
                id: toastId,
                hash,
                title: 'Transaction sent! 🎉',
                description: `Transaction sent to 0x2626664c2603336E57B271c5C0b26F421741e481`,
                type: 'success',
            });
        } catch (error) {
            console.error('Error sending transaction:', error);
            showTransactionToast({
                title: 'Error sending transaction',
                description: 'Please try again',
                type: 'error',
            });
        }
    };

    // Add this helper function to check if a response is an error
    const isErrorResponse = (response: string) => {
        return (
            response.includes('status code') ||
            response.includes('error') ||
            response.includes('failed')
        );
    };

    return (
        <>
            {showInitialContent ? (
                // Initial content section
                <div className="max-w-4xl w-full mx-auto p-6 flex flex-col h-screen justify-center items-center font-funnel-sans">
                    <section className="w-full p-10 relative pb-20 overflow-y-visible">
                        <div className="text-center mb-12">
                            <h1 className="text-4xl font-bold mb-2">Do Anything Onchain</h1>
                            <p className="text-gray-600">
                                Use EarnKit&apos;s AI agent to trade, launch or earn onchain.
                            </p>
                        </div>

                        {/* Chat Interface with suggestions */}
                        <div className="bg-black/4 p-4 mb-8 border border-black/10 rounded-xl ">
                            <div className="flex items-center gap-2  p-3 relative ">
                                <form onSubmit={handleSubmit} className="w-full">
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={inputValue}
                                            onChange={handleInputChange}
                                            placeholder="Ask EarnKit"
                                            className="w-full p-4 pr-12 bg-transparent rounded-lg text-xl text-black/80 font-semibold border-none focus:outline-none focus:border-none"
                                            disabled={isLoading}
                                        />
                                        <button
                                            type="submit"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/80 rounded-full"
                                            disabled={isLoading}
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
                        <div className="flex items-start justify-center absolute top-[80%] bottom-0 left-0 right-0 mx-12 h-[200px] overflow-y-auto">
                            {!selectedAction && !inputValue && (
                                <div className="flex gap-2 mt-0 p-3">
                                    {['Swap', 'Launch', 'Earn', 'Analyse'].map((action) => (
                                        <button
                                            key={action}
                                            onClick={() => handleActionClick(action)}
                                            className="px-4 py-1 rounded-full bg-white text-gray-600 hover:bg-gray-100 flex items-center gap-2 border border-black/20"
                                        >
                                            {action === 'Swap' && <ArrowRightLeft className="w-4 h-4" />}
                                            {action === 'Launch' && <Rocket className="w-4 h-4" />}
                                            {action === 'Earn' && <Coins className="w-4 h-4" />}
                                            {action === 'Analyse' && <LineChart className="w-4 h-4" />}
                                            {action}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {filteredSuggestions.length > 0 && (
                                <div className="mt-0 space-y-2 w-full rounded-lg">
                                    {filteredSuggestions.map((suggestion, index) => (
                                        <button
                                            key={index}
                                            onClick={() => handleSuggestionClick(suggestion)}
                                            className="w-full text-left p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            {suggestion}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* Show category-specific suggestions */}
                            {selectedAction && !filteredSuggestions.length && suggestions[selectedAction as keyof typeof suggestions] && (
                                <div className="mt-4 space-y-2 w-full rounded-lg">
                                    {suggestions[selectedAction as keyof typeof suggestions].map((suggestion, index) => (
                                        <button
                                            key={index}
                                            onClick={() => handleSuggestionClick(suggestion)}
                                            className="w-full text-left p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            {suggestion}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {/* Show filtered suggestions */}

                        {/* What's Possible Section */}
                        {/* <div className="mb-8">
                            <h2 className="text-xl font-semibold mb-1">
                                What&apos;s Possible
                            </h2>
                            <p className="text-gray-600 mb-4">
                                Discover what EarnKit can do for you.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-white p-4 rounded-lg shadow-sm border border-black/10 rounded-lg flex items-center gap-3 ">
                                    <div className="w-12 h-12 bg-black/10 rounded-full mb-3"></div>
                                    <div className="flex items-start flex-col gap-2 ">
                                        <span>300+ Users bought</span>
                                        <span className="bg-gray-100 px-2 py-1 rounded-full text-sm">
                                            KAITO
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow-sm border border-black/10 rounded-lg flex items-center gap-3">
                                    <div className="w-12 h-12 bg-black/10 rounded-full mb-3"></div>
                                    <div className="flex items-start flex-col gap-2">
                                        <span>600+ Users claimed</span>
                                        <span className="bg-gray-100 px-2 py-1 rounded-full text-sm">
                                            ROLL
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow-sm border border-black/10 rounded-lg flex items-center gap-3">
                                    <div className="w-12 h-12 bg-black/10 rounded-full mb-3"></div>
                                    <div className="flex items-start flex-col gap-2">
                                        <span>1k+ User</span>
                                        <span className="bg-gray-100 px-2 py-1 rounded-full text-sm">
                                            ETH
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div> */}
                    </section>
                </div>
            ) : (
                // Chat messages section
                <section className="relative max-w-3xl mx-auto rounded-lg">
                    <div className="flex flex-col gap-4 justify-between h-screen pt-4">
                        <div className="flex-1 h-full overflow-y-auto p-4">
                            {messages.map((message, index) => {
                                if (
                                    message.responseFrom === 'tools' &&
                                    typeof message.response === 'string'
                                ) {
                                    // First check if it's an error response
                                    if (isErrorResponse(message.response)) {
                                        return (
                                            <div key={index} className="flex justify-start my-4">
                                                <div className="max-w-[80%] bg-red-50 rounded-lg shadow-sm border border-red-100 p-4 font-funnel-sans">
                                                    <div className="flex items-center gap-2 text-red-600">
                                                        <svg
                                                            width="20"
                                                            height="20"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                        >
                                                            <circle cx="12" cy="12" r="10" />
                                                            <line x1="12" y1="8" x2="12" y2="12" />
                                                            <line x1="12" y1="16" x2="12" y2="16" />
                                                        </svg>
                                                        <span className="font-semibold">
                                                            Operation Failed
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-sm text-red-600">
                                                        {message.tool_name === 'swap_token' &&
                                                            'Failed to execute swap. Please try again later.'}
                                                        {message.tool_name === 'token_analysis' &&
                                                            'Failed to fetch token information. Please try again later.'}
                                                        {!message.tool_name &&
                                                            'Operation failed. Please try again later.'}
                                                    </p>
                                                    <div className="mt-3 flex gap-2">
                                                        <button
                                                            onClick={() => {
                                                                // Remove the last two messages (user input and error) and retry
                                                                // setMessages(prev => prev.slice(0, -2));
                                                                // setInputValue(messages[messages.length - 2].response as string);
                                                                // handleSubmit(new Event('submit') as any);
                                                            }}
                                                            className="px-4 py-2 bg-red-100 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-200"
                                                        >
                                                            Retry
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    // Then proceed with existing tool-specific rendering...
                                    if (message.tool_name === 'token_analysis') {
                                        try {
                                            const data: TokenAnalysisResponse = JSON.parse(
                                                message.response,
                                            );
                                            return (
                                                <div key={index} className="flex justify-start my-4">
                                                    <div className="max-w-[80%] w-full bg-white rounded-lg shadow-sm border border-black/10 p-4 font-funnel-sans">
                                                        <div className="flex items-center gap-3 mb-3">
                                                            {data.image ? (
                                                                <Image
                                                                    src={data.image}
                                                                    alt={data.name}
                                                                    className="w-8 h-8 rounded-full"
                                                                    width={32}
                                                                    height={32}
                                                                />
                                                            ) : (
                                                                <Icons.ethereum className="w-8 h-8 rounded-full" />
                                                            )}
                                                            <div>
                                                                <h3 className="font-semibold">{data.name}</h3>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-sm text-gray-600">
                                                                        {data.symbol?.toUpperCase()}
                                                                    </span>
                                                                    {data.contract_address !== 'empty' && (
                                                                        <span className="text-xs text-gray-500 font-mono truncate">
                                                                            {data.contract_address}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-6">
                                                            <div className="space-y-2">
                                                                <div className="flex justify-between items-center py-2 border-b border-black/10">
                                                                    <span className="text-gray-600 text-sm">
                                                                        Current Price
                                                                    </span>
                                                                    <span className="font-semibold">
                                                                        $
                                                                        {typeof data.price.current.usd === 'number'
                                                                            ? data.price.current.usd.toFixed(2)
                                                                            : 'N/A'}
                                                                    </span>
                                                                </div>
                                                                <div className="flex justify-between items-center py-2 border-b border-black/10">
                                                                    <span className="text-gray-600 text-sm">
                                                                        24h High
                                                                    </span>
                                                                    <span className="font-semibold">
                                                                        $
                                                                        {typeof data.price.high_24h.usd === 'number'
                                                                            ? data.price.high_24h.usd.toFixed(2)
                                                                            : 'N/A'}
                                                                    </span>
                                                                </div>
                                                                <div className="flex justify-between items-center py-2 border-b border-black/10">
                                                                    <span className="text-gray-600 text-sm">
                                                                        24h Low
                                                                    </span>
                                                                    <span className="font-semibold">
                                                                        $
                                                                        {typeof data.price.low_24h.usd === 'number'
                                                                            ? data.price.low_24h.usd.toFixed(2)
                                                                            : 'N/A'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="flex justify-between items-center py-2 border-b border-black/10">
                                                                    <span className="text-gray-600 text-sm">
                                                                        24h Change
                                                                    </span>
                                                                    <span
                                                                        className={`font-semibold ${typeof data.price
                                                                            .price_change_percentage_24h ===
                                                                            'number'
                                                                            ? data.price
                                                                                .price_change_percentage_24h > 0
                                                                                ? 'text-green-500'
                                                                                : 'text-red-500'
                                                                            : ''
                                                                            }`}
                                                                    >
                                                                        {typeof data.price
                                                                            .price_change_percentage_24h === 'number'
                                                                            ? `${data.price.price_change_percentage_24h.toFixed(2)}%`
                                                                            : 'N/A'}
                                                                    </span>
                                                                </div>
                                                                <div className="flex justify-between items-center py-2 border-b border-black/10">
                                                                    <span className="text-gray-600 text-sm">
                                                                        Market Cap
                                                                    </span>
                                                                    <span className="font-semibold">
                                                                        $
                                                                        {typeof data.market_metrics.market_cap
                                                                            .usd === 'number'
                                                                            ? data.market_metrics.market_cap.usd.toLocaleString()
                                                                            : 'N/A'}
                                                                    </span>
                                                                </div>
                                                                <div className="flex justify-between items-center py-2 border-b border-black/10">
                                                                    <span className="text-gray-600 text-sm">
                                                                        24h Volume
                                                                    </span>
                                                                    <span className="font-semibold">
                                                                        $
                                                                        {typeof data.market_metrics.volume_24h
                                                                            .usd === 'number'
                                                                            ? data.market_metrics.volume_24h.usd.toLocaleString()
                                                                            : 'N/A'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {data.categories.length > 0 && (
                                                            <div className="flex flex-wrap gap-2 mt-4">
                                                                {data.categories.map((category, i) => (
                                                                    <span
                                                                        key={i}
                                                                        className="px-2 py-1 bg-black/4 rounded-full text-xs"
                                                                    >
                                                                        {category}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        <p className="text-sm text-gray-600 mt-4 line-clamp-2">
                                                            {data.description}
                                                        </p>

                                                        <div className="mt-4 flex gap-2">
                                                            <button
                                                                className="px-4 py-2 bg-black text-white rounded-lg text-sm font-semibold"
                                                                disabled
                                                            >
                                                                Trade Now
                                                            </button>
                                                            <Link
                                                                href={`https://basescan.org/token/${data.contract_address}`}
                                                                className="px-4 py-2 bg-black/4 text-black/80 rounded-lg text-sm font-semibold"
                                                                target="_blank"
                                                            >
                                                                View Details
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        } catch (error) {
                                            console.log(error, 'error');
                                            return (
                                                <div key={index} className="flex justify-start my-4">
                                                    <div className="max-w-[80%] bg-red-50 rounded-lg shadow-sm border border-red-100 p-4 font-funnel-sans">
                                                        <div className="flex items-center gap-2 text-red-600">
                                                            <svg
                                                                width="20"
                                                                height="20"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                strokeWidth="2"
                                                            >
                                                                <circle cx="12" cy="12" r="10" />
                                                                <line x1="12" y1="8" x2="12" y2="12" />
                                                                <line x1="12" y1="16" x2="12" y2="16" />
                                                            </svg>
                                                            <span className="font-semibold">
                                                                Invalid Response Format
                                                            </span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-red-600">
                                                            Failed to process token information. Please try
                                                            again.
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    }

                                    if (message.tool_name === 'swap_token') {
                                        try {
                                            const data: SwapTokenResponse = JSON.parse(
                                                message.response,
                                            );
                                            return (
                                                <div key={index} className="flex justify-start my-4">
                                                    <div className="max-w-[80%] w-full bg-white rounded-lg shadow-sm border border-black/10 p-4 font-funnel-sans">
                                                        <h3 className="font-semibold mb-4">Swap Details</h3>

                                                        <div className="space-y-4">
                                                            {/* From Token Card */}
                                                            <div className="bg-black/4 p-4 rounded-lg">
                                                                <span className="text-sm text-gray-600">From</span>
                                                                <div className="flex items-center justify-between mt-2">
                                                                    <div className="flex items-center gap-3">
                                                                        {data.tokenIn.image ? (
                                                                            <Image
                                                                                src={data.tokenIn.image}
                                                                                alt={data.tokenIn.symbol}
                                                                                className="w-8 h-8 rounded-full"
                                                                                width={32}
                                                                                height={32}
                                                                            />
                                                                        ) : (
                                                                            <div className="w-8 h-8 bg-black/10 rounded-full" />
                                                                        )}
                                                                        <div>
                                                                            <div className="font-semibold">{data.tokenIn.name}</div>
                                                                            <div className="text-sm text-gray-600">{data.tokenIn.symbol}</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <div className="font-semibold">
                                                                            {(parseInt(data.amountIn) / Math.pow(10, data.tokenIn.decimals)).toFixed(6)}
                                                                        </div>
                                                                        <div className="text-sm text-gray-600">
                                                                            ≈ ${((parseInt(data.amountIn) / Math.pow(10, data.tokenIn.decimals)) * data.tokenIn.currentPrice).toFixed(2)}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Arrow Icon */}
                                                            <div className="flex justify-center">
                                                                <div className="bg-black/4 p-2 rounded-full">
                                                                    <svg
                                                                        width="24"
                                                                        height="24"
                                                                        viewBox="0 0 24 24"
                                                                        fill="none"
                                                                        stroke="currentColor"
                                                                        strokeWidth="2"
                                                                    >
                                                                        <path d="M7 10l5 5 5-5" />
                                                                    </svg>
                                                                </div>
                                                            </div>

                                                            {/* To Token Card */}
                                                            <div className="bg-black/4 p-4 rounded-lg">
                                                                <span className="text-sm text-gray-600">To</span>
                                                                <div className="flex items-center justify-between mt-2">
                                                                    <div className="flex items-center gap-3">
                                                                        {data.tokenOut.image ? (
                                                                            <Image
                                                                                src={data.tokenOut.image}
                                                                                alt={data.tokenOut.symbol}
                                                                                className="w-8 h-8 rounded-full"
                                                                                width={32}
                                                                                height={32}
                                                                            />
                                                                        ) : (
                                                                            <div className="w-8 h-8 bg-black/10 rounded-full" />
                                                                        )}
                                                                        <div>
                                                                            <div className="font-semibold">{data.tokenOut.name}</div>
                                                                            <div className="text-sm text-gray-600">{data.tokenOut.symbol}</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <div className="text-sm text-gray-600 font-mono">
                                                                            {data.tokenOut.address.slice(0, 6)}...{data.tokenOut.address.slice(-4)}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Swap Details */}
                                                        <div className="mt-6 space-y-2 text-sm text-gray-600 bg-black/2 p-4 rounded-lg">
                                                            <div className="flex justify-between">
                                                                <span>Fee Tier</span>
                                                                <span className="font-semibold">{(parseInt(data.feeTier) / 10000).toFixed(2)}%</span>
                                                            </div>
                                                            {/* <div className="flex justify-between">
                                                                <span>Amount Type</span>
                                                                <span className="font-semibold capitalize">{data.amountType}</span>
                                                            </div> */}
                                                            <div className="flex justify-between">
                                                                <span>Original Amount</span>
                                                                <span className="font-semibold">{data.originalAmount}</span>
                                                            </div>
                                                        </div>

                                                        {/* Action Buttons */}
                                                        <div className="mt-6 flex gap-2">
                                                            <button
                                                                className="flex-1 px-4 py-3 bg-black text-white rounded-lg font-semibold hover:bg-black/90 transition-colors"
                                                                onClick={() => handleSwapToken(data)}
                                                            >
                                                                Confirm Swap
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        } catch (error) {
                                            console.log(error, 'error');
                                            return (
                                                <div key={index} className="flex justify-start my-4">
                                                    <div className="max-w-[80%] bg-red-50 rounded-lg shadow-sm border border-red-100 p-4 font-funnel-sans">
                                                        <div className="flex items-center gap-2 text-red-600">
                                                            <svg
                                                                width="20"
                                                                height="20"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                strokeWidth="2"
                                                            >
                                                                <circle cx="12" cy="12" r="10" />
                                                                <line x1="12" y1="8" x2="12" y2="12" />
                                                                <line x1="12" y1="16" x2="12" y2="16" />
                                                            </svg>
                                                            <span className="font-semibold">
                                                                Invalid Swap Data
                                                            </span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-red-600">
                                                            Failed to process swap information. Please try
                                                            again.
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    }
                                }

                                if (message.tool_name === 'get_balance') {
                                    try {
                                        const data: TokenBalanceResponse = JSON.parse(message.response as string);
                                        return (
                                            <div key={index} className="flex justify-start my-4">
                                                <div className="max-w-[70%] w-full bg-white rounded-lg shadow-sm border border-black/10 p-4 font-funnel-sans">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h3 className="font-semibold">Token Balance</h3>
                                                        <Link
                                                            href={`https://basescan.org/address/${selectedAccount?.address}/#asset-tokens`}
                                                            target="_blank"
                                                            className="text-xs text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
                                                        >
                                                            View on Explorer <ExternalLink className="w-4 h-4" />
                                                        </Link>
                                                    </div>

                                                    <div className="bg-black/4 p-4 rounded-lg">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-10 h-10 bg-black/10 rounded-full flex items-center justify-center">
                                                                    <span className="text-lg font-semibold">
                                                                        {data.symbol.slice(0, 1)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <div className="font-semibold">{data.symbol}</div>
                                                                    <div className="text-sm text-gray-600 font-mono">
                                                                        {data.tokenAddress.slice(0, 6)}...{data.tokenAddress.slice(-4)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <div className="text-2xl font-bold">
                                                                    {Number(data.balance).toLocaleString(undefined, {
                                                                        minimumFractionDigits: 2,
                                                                        maximumFractionDigits: 6
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 flex gap-2">
                                                        <button
                                                            className="flex-1 px-4 py-2 bg-black/4 text-black/80 rounded-lg text-sm font-semibold hover:bg-black/8 transition-colors"
                                                            onClick={() => {
                                                                setInputValue(`Swap ${data.symbol}`);
                                                            }}
                                                        >
                                                            Swap {data.symbol}
                                                        </button>
                                                        <button
                                                            className="flex-1 px-4 py-2 bg-black/4 text-black/80 rounded-lg text-sm font-semibold hover:bg-black/8 transition-colors"
                                                            onClick={() => {
                                                                // Set input value to create an analysis command
                                                                setInputValue(`Analyse ${data.symbol} token`);
                                                            }}
                                                        >
                                                            View Analytics
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    } catch (error) {
                                        console.log(error, 'error');
                                        return (
                                            <div key={index} className="flex justify-start my-4">
                                                <div className="max-w-[80%] bg-red-50 rounded-lg shadow-sm border border-red-100 p-4 font-funnel-sans">
                                                    <div className="flex items-center gap-2 text-red-600">
                                                        <svg
                                                            width="20"
                                                            height="20"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                        >
                                                            <circle cx="12" cy="12" r="10" />
                                                            <line x1="12" y1="8" x2="12" y2="12" />
                                                            <line x1="12" y1="16" x2="12" y2="16" />
                                                        </svg>
                                                        <span className="font-semibold">
                                                            Invalid Balance Data
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-sm text-red-600">
                                                        Failed to process balance information. Please try again.
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    }
                                }

                                // Regular message rendering
                                return (
                                    <div
                                        key={index}
                                        className={`flex my-2 ${message.responseFrom === 'user' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`max-w-[80%] p-4 rounded-lg font-funnel-sans ${message.responseFrom === 'user'
                                                ? 'bg-black/4 text-black/80 ml-auto font-semibold'
                                                : 'bg-transparent text-gray-800'
                                                }`}
                                        >
                                            {Array.isArray(message.response)
                                                ? message.response.map((item, i) => (
                                                    <div key={i}>{item.text}</div>
                                                ))
                                                : message.response}
                                        </div>
                                    </div>
                                );
                            })}
                            {isLoading && (
                                <div className="flex items-center gap-2 text-gray-600 p-4">
                                    <div className="animate-spin h-4 w-4 border-2 border-gray-600 border-t-transparent rounded-full"></div>
                                    <span>Thinking...</span>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="w-full mx-auto self-end">
                            <form
                                onSubmit={handleSubmit}
                                className="bg-black/4 rounded-xl p-4 border border-black/10"
                            >
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={inputValue}
                                        onChange={handleInputChange}
                                        placeholder="Ask EarnKit"
                                        className="w-full p-4 pr-12 bg-transparent rounded-lg border-none focus:outline-none focus:border-none font-funnel-sans text-black/80 font-semibold"
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="submit"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/80 rounded-full disabled:opacity-50"
                                        disabled={isLoading || !inputValue.trim()}
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
                </section>
            )}

            <Toaster />
        </>
    );
}
