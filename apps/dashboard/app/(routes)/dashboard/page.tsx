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
import { ArrowRightLeft, Rocket, Coins, LineChart, MessageCircleMore, SquarePen } from 'lucide-react';
import { TokenAnalysis, TokenSwap, TokenBalance } from '@/app/components/dashboard/tools';
import { TokenAnalysisResponse } from '@/app/components/dashboard/tools/TokenAnalysis';
import { WalletBalanceResponse } from '@/app/components/dashboard/tools/TokenBalance';
import ChatHistory from './components/ChatHistory';
import * as Tooltip from '@radix-ui/react-tooltip';
import { TransactionStatus } from '@/app/components/ui/transaction-status';

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

interface MessageResponse {
    content: string;
    responseFrom: string;
    toolName?: string;
}

// interface Chat {
//     id: string;
//     title: string;
//     createdAt: string;
//     messages: Array<{
//         content: string;
//         responseFrom: string;
//         toolName?: string;
//     }>;
// }

export default function Dashboard() {
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const { addPendingTransaction } = useTransactions();
    const [showInitialContent, setShowInitialContent] = useState(true);
    const { state } = useWallets();
    const { selectedAccount } = state;
    const { passkeyClient } = useTurnkey();
    const [selectedAction, setSelectedAction] = useState<string | null>(null);
    const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
    const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const { turnkey } = useTurnkey();
    // Add ref for the messages container
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [isTransactionStatusOpen, setIsTransactionStatusOpen] = useState(false);
    const [transactionStatus, setTransactionStatus] = useState<{
        title: string;
        description: string;
        type: "loading" | "success" | "error";
        hash?: string;
    }>({
        title: "",
        description: "",
        type: "loading",
    });


    useEffect(() => {
        if (turnkey) {
            const fetchUser = async () => {
                try {
                    const currentUser = await turnkey.getCurrentUser();
                    if (currentUser?.userId) {
                        console.log(currentUser.userId, "current user")
                        setUserId(currentUser.userId);
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }
            };
            fetchUser();
        }
    }, [turnkey]);

    // Add scroll to bottom function
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const [walletClient, setWalletClient] = useState<Awaited<
        ReturnType<typeof getTurnkeyWalletClient>
    > | null>(null);


    useEffect(() => {
        if (passkeyClient) {
            console.log(passkeyClient, 'passkeyClient');
        }
    }, [passkeyClient]);

    useEffect(() => {
        const initializeWalletClient = async () => {
            if (!selectedAccount || !passkeyClient) return;
            if (passkeyClient) {
                console.log(passkeyClient, 'client found');
            }
            const walletClient = await getTurnkeyWalletClient(
                passkeyClient as TurnkeyBrowserClient,
                selectedAccount.address,
            );
            setWalletClient(walletClient);
        };

        initializeWalletClient();
    }, [selectedAccount, passkeyClient]);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    // Load messages when chat is selected
    // useEffect(() => {
    //     const loadMessages = async () => {
    //         if (!currentChatId) return;

    //         try {
    //             const response = await fetch('/api/chat');
    //             const data = await response.json();
    //             const selectedChat = data.chats.find((chat: Chat) => chat.id === currentChatId);
    //             if (selectedChat) {
    //                 setMessages(selectedChat.messages.map((msg: Chat['messages'][0]) => ({
    //                     responseFrom: msg.responseFrom,
    //                     tool_name: msg.toolName,
    //                     response: msg.content,
    //                 })));
    //             }
    //         } catch (error) {
    //             console.error('Error loading messages:', error);
    //         }
    //     };

    //     loadMessages();
    // }, [currentChatId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() || !userId) return;

        setIsLoading(true);
        setShowInitialContent(false);

        // Create new chat if this is the first message

        let newChatId = currentChatId;

        // Add user message to chat
        const userMessage = { responseFrom: 'user', response: inputValue };
        setMessages((prev) => [...prev, userMessage]);

        if (!currentChatId) {
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        userId: userId,
                        title: inputValue.slice(0, 50) + (inputValue.length > 50 ? '...' : ''),
                    }),
                });
                const data = await response.json();
                console.log(data, "chat first id")
                newChatId = data?.chat?.id;
                setCurrentChatId(data?.chat?.id);
            } catch (error) {
                console.error('Error creating new chat:', error);
                setIsLoading(false);
                return;
            }
        }
        // Store user message in database
        try {
            await fetch(`/api/chat/${newChatId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: inputValue,
                    responseFrom: 'user',
                    userId: userId,
                }),
            });
        } catch (error) {
            console.error('Error storing user message:', error);
        }

        try {
            const response = await fetch('/api/agent/prompt', {
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
            const newMessages = data.response.filter((msg: Message) => msg.response);

            if (newMessages.length > 0) {
                setMessages((prev) => [...prev, ...newMessages]);


                // Store AI messages in database
                for (const message of newMessages) {
                    try {
                        // Format the content based on the response type
                        let formattedContent: string;
                        if (Array.isArray(message.response)) {
                            // For array responses, join the text fields with newlines
                            formattedContent = message.response
                                .map((item: { text?: string }) => item.text || '')
                                .filter((text: string) => text)
                                .join('\n');
                        } else if (typeof message.response === 'string') {
                            formattedContent = message.response;
                        } else {
                            formattedContent = JSON.stringify(message.response);
                        }

                        await fetch(`/api/chat/${newChatId}/messages`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                content: formattedContent,
                                responseFrom: message.responseFrom,
                                toolName: message.tool_name || undefined,
                                userId: userId,
                            }),
                        });
                    } catch (error) {
                        console.error('Error storing AI message:', error);
                    }
                }
            }
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
        setIsTransactionStatusOpen(true);
        setTransactionStatus({
            title: 'Swapping token...',
            description: 'Please wait for transaction to complete',
            type: 'loading',
        });
        try {
            console.log(data, 'swap token data');

            if (!selectedAccount || !passkeyClient) {
                console.log('❌ Missing requirements:', {
                    selectedAccount: !!selectedAccount,
                    passkeyClient: !!passkeyClient,
                });
                return;
            }

            const walletClient = await getTurnkeyWalletClient(
                passkeyClient as TurnkeyBrowserClient,
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
                        setTransactionStatus({
                            title: 'Approving token...',
                            description: 'Please wait for approval to complete',
                            type: 'loading',
                            hash,
                        });
                        setIsTransactionStatusOpen(true);

                        await publicClient.waitForTransactionReceipt({ hash });

                        showTransactionToast({
                            id: toastId,
                            hash,
                            title: 'Token approved! 🎉',
                            description: 'Now proceeding with swap',
                            type: 'success',
                        });
                        setTransactionStatus({
                            title: 'Token approved! 🎉',
                            description: 'Now proceeding with swap',
                            type: 'success',
                            hash,
                        });
                    } catch (error) {
                        console.error('Error approving token:', error);
                        showTransactionToast({
                            title: 'Error approving token',
                            description: 'Please try again',
                            type: 'error',
                        });
                        setTransactionStatus({
                            title: 'Error approving token',
                            description: 'Please try again',
                            type: 'error',
                        });
                        setIsTransactionStatusOpen(true);
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

            console.log(encodedData, 'encoded data');

            // Prepare the transaction request
            const transaction = await walletClient.prepareTransactionRequest({
                to: ROUTER_ADDRESS,
                data: encodedData as `0x${string}`,
                // Include value if swapping ETH
                value: isETHSwap ? BigInt(data.amountIn) : BigInt(0),
            });

            console.log(transaction, 'transaction');

            await handleSendTransaction(transaction);
        } catch (err) {
            if (err instanceof Error) {
                console.log(err.message);
                if (err.message.includes('insufficient funds')) {
                    setTransactionStatus({
                        title: 'Insufficient funds',
                        description: 'Please try again',
                        type: 'error',
                    });
                } else {
                    setTransactionStatus({
                        title: 'Error sending transaction',
                        description: 'Please try again',
                        type: 'error',
                    });
                }
            }

        }
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

            // Show both toast and popup for transaction sent
            const toastId = showTransactionToast({
                hash,
                title: 'Sending transaction...',
                description: 'View your transaction on explorer',
                type: 'loading',
            });

            setTransactionStatus({
                title: 'Sending Transaction',
                description: 'Your transaction is being processed. Please wait...',
                type: 'loading',
                hash,
            });

            await publicClient.waitForTransactionReceipt({
                hash,
            });

            // Show both toast and popup for transaction success
            showTransactionToast({
                id: toastId,
                hash,
                title: 'Transaction sent! 🎉',
                description: `Transaction sent to 0x2626664c2603336E57B271c5C0b26F421741e481`,
                type: 'success',
            });

            setTransactionStatus({
                title: 'Transaction Successful! 🎉',
                description: 'Your transaction has been confirmed on the blockchain.',
                type: 'success',
                hash,
            });
        } catch (error) {
            console.error('Error sending transaction:', error);
            showTransactionToast({
                title: 'Error sending transaction',
                description: 'Please try again',
                type: 'error',
            });

            setTransactionStatus({
                title: 'Transaction Failed',
                description: 'There was an error processing your transaction. Please try again.',
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

    const handleSelectChat = async (chatId: string) => {
        if (!userId) return;

        setCurrentChatId(chatId);
        setIsChatHistoryOpen(false);
        setMessages([]);
        setShowInitialContent(false);

        try {
            const response = await fetch(`/api/chat/${chatId}/messages?userId=${userId}`);
            const data = await response.json();
            if (data.messages) {
                setMessages(data.messages.map((msg: MessageResponse) => ({
                    responseFrom: msg.responseFrom,
                    tool_name: msg.toolName,
                    response: msg.content
                })));
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    };

    return (
        <div>
            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                        <button
                            onClick={() => setIsChatHistoryOpen(true)}
                            className="fixed flex items-center gap-2 justify-center font-funnel-sans font-semibold top-4 right-4 p-2 bg-white rounded-xl shadow-md hover:bg-gray-50 transition-colors z-40 shadow-black/10 border border-black/10"
                            aria-label="Open chat history"
                        >
                            <MessageCircleMore className="w-6 h-6" />
                        </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                        <Tooltip.Content
                            className="bg-gray-900 text-white px-2 py-1 rounded text-sm"
                            sideOffset={5}
                        >
                            Chat History
                        </Tooltip.Content>
                    </Tooltip.Portal>
                </Tooltip.Root>

                {!showInitialContent && <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                        <button
                            onClick={() => {
                                setCurrentChatId(null);
                                setMessages([]);
                                setInputValue('');
                                setShowInitialContent(true);
                            }}
                            className="fixed flex items-center gap-2 justify-center font-funnel-sans font-semibold top-4 ml-[250px] left-4 p-2 bg-white rounded-xl shadow-md hover:bg-gray-50 transition-colors z-40 shadow-black/10 border border-black/10"
                            aria-label="Start new chat"
                        >
                            <SquarePen className="w-6 h-6" />
                        </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                        <Tooltip.Content
                            className="bg-gray-900 text-white px-2 py-1 rounded text-sm"
                            sideOffset={5}
                        >
                            New Chat
                        </Tooltip.Content>
                    </Tooltip.Portal>
                </Tooltip.Root>}
            </Tooltip.Provider>

            {/* Add the chat history component */}
            <ChatHistory
                isOpen={isChatHistoryOpen}
                onClose={() => setIsChatHistoryOpen(false)}
                onSelectChat={handleSelectChat}
                currentChatId={currentChatId}
                userId={userId}
            />

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
                        <div className="flex-1 h-full overflow-y-auto p-4 pt-10">
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
                                            const data: TokenAnalysisResponse = JSON.parse(message.response);
                                            console.log(data, "token analysis data")
                                            return (
                                                <div key={index} className="flex justify-start my-4">
                                                    <TokenAnalysis data={data} />
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
                                            const data: SwapTokenResponse = JSON.parse(message.response);
                                            return (
                                                <div key={index} className="flex justify-start my-4">
                                                    <TokenSwap data={data} onSwap={handleSwapToken} />
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
                                        const data: WalletBalanceResponse = JSON.parse(message.response as string);
                                        console.log(data, "balance data")
                                        return (
                                            <div key={index} className="flex justify-start my-4">
                                                <TokenBalance
                                                    data={data}
                                                    selectedAccount={selectedAccount}
                                                    onSwap={(symbol) => setInputValue(`Swap ${symbol}`)}
                                                    onAnalyze={(symbol) => setInputValue(`Analyse ${symbol} token`)}
                                                />
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

            <TransactionStatus
                isOpen={isTransactionStatusOpen}
                onClose={() => setIsTransactionStatusOpen(false)}
                title={transactionStatus.title}
                description={transactionStatus.description}
                type={transactionStatus.type}
                hash={transactionStatus.hash}
            />

            <Toaster />
        </div>
    );
}
