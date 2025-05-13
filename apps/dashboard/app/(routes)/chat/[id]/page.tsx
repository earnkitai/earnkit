'use client';

import { useState, useRef, useEffect, use } from 'react';
import { Account } from 'viem';
import { ethers } from 'ethers';
import { showTransactionToast } from '@/lib/toast';
import { Toaster } from '@/app/components/ui/sonner';
import { TokenAnalysis, TokenSwap, TokenBalance, TokenInvest } from '@/app/components/dashboard/tools';
import { TokenAnalysisResponse } from '@/app/components/dashboard/tools/TokenAnalysis';
import { WalletBalanceResponse } from '@/app/components/dashboard/tools/TokenBalance';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// import { Components } from 'react-markdown';
// import * as Tooltip from '@radix-ui/react-tooltip';
// import { TransactionStatus } from '@/app/components/ui/transaction-status';
// import { useRouter } from 'next/navigation';
import { getPublicClient } from '@/lib/web3';
import { io, Socket } from 'socket.io-client';
import { useUser } from '@/hooks/use-user';
import { useChat } from '@/providers/chat-provider';
import { usePrivy } from '@privy-io/react-auth';
import { Icons } from '@/app/components/sections/icons';
import { SwapProgress, SwapProgressProps } from '@/app/components/ui/swap-progress';
import TokenSwapConfirmation from '@/app/components/dashboard/tools/TokenSwapConfirmation';
import { TokenInvestResponse } from '@/app/components/dashboard/tools/Token_Invest';

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
    messageId?: string;
}

interface SwapTokenResponse {
    tokenIn: Token,
    tokenOut: Token,
    amountIn: string,
    // feeTier: string;
    originalAmount: string,
    amountType: string,
    swapRoute: SwapDetails

}

interface Token {
    address: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
    image: string;
    currentPrice: number;
}

interface MessageResponse {
    content: string;
    responseFrom: string;
    toolName?: string;
}



export interface SwapDetails {
    quote: string;
    methodParameters: {
        calldata: string;
        value: string;
        to: string;
    };
    path: string[];
    gasEstimate: string;
    gasCostUSD: string;
}

export type SwapProgressState = 'initial' | 'approving' | 'approved' | 'swapping' | 'completed' | 'error' | '';


export interface SwapTokenConfirmationResponse {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: string;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    amountOut: string;
    approvalHash: string;
    swapHash: string;
}

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

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const [inputValue, setInputValue] = useState('');
    const [initialMessage, setInitialMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    // const { addPendingTransaction } = useTransactions();
    const [showSwapConfirmation, setShowSwapConfirmation] = useState<boolean>(false);
    const [showSwapConfirmationData, setShowSwapConfirmationData] = useState<SwapTokenConfirmationResponse | null>(null);
    const [swapProgressState, setSwapProgressState] = useState<SwapProgressState>('');
    const [swapProgressData, setSwapProgressData] = useState<SwapProgressProps>({
        tokenInSymbol: '',
        tokenInAmount: '',
        tokenInImage: '',
        tokenOutSymbol: '',
        tokenOutAmount: '',
        tokenOutImage: '',
        tokenInDecimals: 18,
        gasFee: '',
        state: swapProgressState,
    });

    // const { state } = useWallets();
    // const { selectedAccount } = state;
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    const { user } = useUser()
    // const { passkeyClient, getActiveClient } = useTurnkey();
    const [userId, setUserId] = useState<string | null>(null);
    const { ready, authenticated, user: privyUser, sendTransaction } = usePrivy();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    // const [isTransactionStatusOpen, setIsTransactionStatusOpen] = useState(false);
    // const [transactionStatus, setTransactionStatus] = useState<{
    //     title: string;
    //     description: string;
    //     type: "loading" | "success" | "error";
    //     hash?: string;
    // }>({
    //     title: "",
    //     description: "",
    //     type: "loading",
    // });
    // const [walletClient, setWalletClient] = useState<Awaited<ReturnType<typeof getTurnkeyWalletClient>> | null>(null);
    const { setNeedToFetchChats } = useChat();
    const [showActivity, setShowActivity] = useState(false);

    // Socket.IO implementation
    const socketRef = useRef<Socket | null>(null);
    const [socketConnected, setSocketConnected] = useState(false);
    // const [socketError, setSocketError] = useState<string | null>(null);



    useEffect(() => {
        const initialMessage = localStorage.getItem(`initialMessage ${resolvedParams.id}`);
        if (initialMessage) {
            setInitialMessage(initialMessage);
            setInputValue(initialMessage);
            // Clear the message from localStorage immediately
            localStorage.removeItem(`initialMessage ${resolvedParams.id}`);
        }
    }, [resolvedParams.id]);

    // Separate useEffect for handling the initial message submission
    useEffect(() => {
        if (initialMessage && userId && messages.length === 0 && socketConnected) {
            handleSubmit();
            setNeedToFetchChats(true);
            // Fetch chats
        }
    }, [userId, messages.length, initialMessage, socketConnected, setNeedToFetchChats]);

    useEffect(() => {
        if (user) {
            console.log(user, "user")
        }
    }, [user])

    useEffect(() => {
        if (ready && authenticated && privyUser?.id) {
            const userId = privyUser?.id.split(':').pop() || privyUser?.id;
            setUserId(userId);
            setSelectedAccount(privyUser.wallet as unknown as Account);
        }
    }, [ready, authenticated, privyUser]);

    useEffect(() => {
        const loadMessages = async () => {
            // Skip loading messages if we have an initialMessage (coming from dashboard)
            if (initialMessage || !userId) return;

            setIsLoadingMessages(true);
            try {
                const response = await fetch(`/api/chat/${resolvedParams.id}/messages?userId=${userId}`);
                const data = await response.json();
                if (data.messages) {
                    setMessages(data.messages.map((msg: MessageResponse) => ({
                        responseFrom: msg.responseFrom,
                        tool_name: msg.toolName,
                        response: msg.content
                    })));
                }
            } catch (error) {
                console.log('Error loading messages:', error);
            } finally {
                setIsLoadingMessages(false);
            }
        };
        loadMessages();
    }, [resolvedParams.id, userId, initialMessage]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    useEffect(() => {
        // Only initialize socket connection if userId is available
        if (!userId) {
            console.log('Waiting for userId before initializing socket connection');
            return;
        }

        // Initialize socket connection
        const agentBackendUrl = process.env.NEXT_PUBLIC_AGENT_BACKEND_URL || 'http://localhost:3100';
        console.log('Attempting to connect to agent backend at:', agentBackendUrl);

        // Clean up any existing socket connection
        if (socketRef.current) {
            console.log('Cleaning up existing socket connection');
            socketRef.current.disconnect();
            socketRef.current = null;
        }

        // Create new socket connection with more detailed options
        socketRef.current = io(agentBackendUrl, {
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            timeout: 10000,
            transports: ['websocket', 'polling'],
            path: '/socket.io/',
            withCredentials: true,
            autoConnect: true,
            forceNew: true
        });

        // Connection events
        socketRef.current.on('connect', () => {
            console.log('Socket connected successfully:', socketRef.current?.id);
            setSocketConnected(true);
            // setSocketError(null);

            // Send a test message to verify connection
            // socketRef.current?.emit('ping', { timestamp: Date.now() });
        });

        socketRef.current.on('pong', (data) => {
            console.log('Received pong from server:', data);
        });

        socketRef.current.on('disconnect', (reason) => {
            console.log('Socket disconnected. Reason:', reason);
            setSocketConnected(false);
        });

        socketRef.current.on('connect_error', (error) => {
            console.log('Socket connection error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
            console.log(`Connection error: ${error.message}. Retrying...`);
            setIsLoading(false);
            setSocketConnected(false);
        });

        socketRef.current.on('error', (error) => {
            console.log('Socket general error:', error);
            console.log(`Socket error: ${error}`);
            setIsLoading(false);
            setSocketConnected(false);
        });

        // Message events
        socketRef.current.on('response', (data) => {
            console.log('Received response:', data);

            // Handle the new response format
            if (data.type === 'system' && data.done) {
                // This is the final message indicating the stream is complete
                setIsLoading(false);
                return;
            }

            // Format the response to match the expected format
            let formattedContent: string;
            if (Array.isArray(data.response)) {
                formattedContent = data.response
                    .map((item: { text?: string }) => item.text || '')
                    .filter((text: string) => text)
                    .join('\n');
            } else if (typeof data.response === 'string') {
                formattedContent = data.response;
            } else {
                formattedContent = JSON.stringify(data.response);
            }
            const responseMessage = {
                responseFrom: data.responseFrom,
                response: formattedContent,
                tool_name: data.tool_name,
            };

            // Save AI response to database only if userId is available
            if (userId) {
                saveAIMessage(responseMessage).then((savedMessage) => {
                    if (savedMessage) {
                        // Store the message ID in the message object for all messages
                        const messageWithId = { ...data, messageId: savedMessage.id };
                        setMessages((prev) => [...prev, messageWithId]);
                    } else {
                        // Fallback to adding message without ID if save failed
                        setMessages((prev) => [...prev, data]);
                    }
                });
            } else {
                console.warn('Received AI response but userId is not available yet');
                setMessages((prev) => [...prev, data]);
            }
        });

        // Cleanup on unmount
        return () => {
            if (socketRef.current) {
                console.log('Disconnecting socket');
                socketRef.current.disconnect();
            }
        };
    }, [userId]);

    const saveAIMessage = async (message: { response: string; responseFrom: string; tool_name?: string }) => {
        try {
            if (!userId) {
                console.warn('Cannot save AI message: userId is null');
                return null;
            }
            console.log("save message called")

            // Skip empty or whitespace-only content
            if (!message.response || (typeof message.response === 'string' && message.response.trim().length === 0) || (Array.isArray(message.response) && message.response.length === 0)) {
                console.warn('Skipping empty AI message');
                return null;
            }

            const content = typeof message.response === 'string'
                ? message.response
                : JSON.stringify(message.response);

            const response = await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content,
                    responseFrom: message.responseFrom,
                    toolName: message.tool_name || undefined,
                    userId
                }),
            });

            const data = await response.json();
            console.log("save message ended", data.message)
            return data.message;
        } catch (err) {
            console.log('Error storing AI message:', err);
            return null;
        }
    };

    const updateMessage = async (messageId: string, content: string, metadata?: object) => {
        try {
            if (!userId) {
                console.warn('Cannot update message: userId is null');
                return null;
            }

            const response = await fetch(`/api/chat/${resolvedParams.id}/messages/${messageId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content,
                    userId,
                    metadata,
                }),
            });

            const data = await response.json();
            return data.message;
        } catch (err) {
            console.log('Error updating message:', err);
            return null;
        }
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) {
            e.preventDefault();
        }

        // Validate input before proceeding
        if (!inputValue || !inputValue.trim() || !userId || !socketConnected) {
            console.warn('Cannot submit: invalid input or missing requirements');
            return;
        }

        const inputValueNew = inputValue.trim();
        setInputValue('');
        setIsLoading(true);

        // Add user message to chat
        const userMessage = { responseFrom: 'user', response: inputValueNew };
        setMessages((prev) => [...prev, userMessage]);

        // Store user message in database
        try {
            await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: inputValueNew,
                    responseFrom: 'user',
                    userId,
                }),
            });
        } catch (error) {
            console.log('Error storing user message:', error);
        }

        // Send message via Socket.IO
        try {
            const payload = {
                message: inputValueNew,
                userWalletAddress: selectedAccount?.address,
                chatId: resolvedParams.id,
            };

            if (socketRef.current?.connected) {
                console.log('Sending message via socket:', payload);
                socketRef.current.emit('message', payload);
            } else {
                console.log('Socket is not connected');
                console.log('Not connected to server. Please refresh the page.');
                setIsLoading(false);
            }
        } catch (error) {
            console.log('Socket send error:', error);
            console.log('Failed to send message. Please try again.');
            setIsLoading(false);
        }
    };



    // const handleInvestmentCompleteDataStore = async (result: `0x${string}`) => {
    //     console.log("Transaction hash:", result);
    //     const inputValueNew = result;

    //     // Find the invest_token message in the messages array
    //     const investMessage = messages.find(msg => msg.tool_name === 'invest_token');
    //     if (investMessage && 'messageId' in investMessage) {
    //         // Update the message with the transaction hash
    //         const updatedMessage = await updateMessage(
    //             investMessage.messageId as string,
    //             JSON.stringify(inputValueNew),
    //             { transactionHash: result }
    //         );

    //         if (updatedMessage) {
    //             // Update the message in the UI
    //             setMessages((prev) => prev.map((msg) =>
    //                 msg === investMessage ? { ...msg, response: inputValueNew } : msg
    //             ));
    //         }
    //     } else {
    //         // Fallback to creating a new message if we can't find the original
    //         const userMessage = { responseFrom: 'tools', tool_name: 'after_invest_token', response: JSON.stringify(inputValueNew) };
    //         setMessages((prev) => [...prev, userMessage]);

    //         try {
    //             await fetch(`/api/chat/${resolvedParams.id}/messages`, {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     content: inputValueNew,
    //                     responseFrom: 'tools',
    //                     toolName: 'after_invest_token',
    //                     userId,
    //                 }),
    //             });
    //         } catch (error) {
    //             console.log('Error storing user message:', error);
    //         }
    //     }
    // };


    const handleSwapConfirmationMsgStore = async (inputValueNew: string) => {
        // Add user message to chat
        const userMessage = { responseFrom: 'user', response: inputValueNew };
        setMessages((prev) => [...prev, userMessage]);

        // Store user message in database
        try {
            await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: inputValueNew,
                    responseFrom: 'user',
                    userId,
                }),
            });
            // Set needToFetchChats to true to trigger a refresh of the chat list
        } catch (error) {
            console.log('Error storing user message:', error);
        }
    }


    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    };

    const handleSwapToken = async (data: SwapTokenResponse) => {
        // Show confirmation UI immediately

        setShowSwapConfirmationData({
            tokenIn: data.tokenIn,
            tokenOut: data.tokenOut,
            amountIn: data.amountIn,
            amountOut: data.swapRoute.quote,
            tokenInDecimals: data.tokenIn.decimals,
            tokenOutDecimals: data.tokenOut.decimals,
            approvalHash: '',
            swapHash: '',
        });
        // to show the swap confirmation UI
        setShowSwapConfirmation(true);
        setShowActivity(true);
        await handleSwapConfirmationMsgStore("confirm");
        setSwapProgressData({
            tokenInSymbol: data.tokenIn.symbol,
            tokenInAmount: data.amountIn,
            tokenInImage: data.tokenIn.image,
            tokenOutSymbol: data.tokenOut.symbol,
            tokenOutAmount: data.swapRoute.quote,
            tokenOutImage: data.tokenOut.image,
            tokenInDecimals: data.tokenIn.decimals,
            gasFee: data.swapRoute.gasCostUSD,
            state: swapProgressState,
        });

        setSwapProgressState('initial');
        try {
            if (!selectedAccount) {
                console.log('❌ Missing requirements:', {
                    selectedAccount: !!selectedAccount,
                });
                return;
            }

            const ETH_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
            const isETHSwap = data.tokenIn.address.toLowerCase() === ETH_ADDRESS.toLowerCase();
            let approvalHash = '';

            if (!isETHSwap) {
                const publicClient = getPublicClient('base');
                const erc20Contract = new ethers.Interface(ERC20_ABI);

                const allowanceData = (await publicClient.readContract({
                    address: data.tokenIn.address,
                    abi: ERC20_ABI,
                    functionName: 'allowance',
                    args: [selectedAccount?.address as `0x${string}`, data.swapRoute.methodParameters.to as `0x${string}`],
                })) as bigint;

                if (allowanceData < BigInt(data.amountIn)) {
                    setSwapProgressState('approving');
                    const approveData = erc20Contract.encodeFunctionData('approve', [
                        data.swapRoute.methodParameters.to as `0x${string}`,
                        BigInt(data.amountIn), // we can also use ethers.MaxUint256
                    ]);

                    const transactionRequest = {
                        to: data.tokenIn.address,
                        data: approveData as `0x${string}`,
                    };

                    try {
                        const { hash } = await sendTransaction(transactionRequest);
                        approvalHash = hash;

                        const toastId = showTransactionToast({
                            hash,
                            title: 'Approving token...',
                            description: 'Please wait for approval to complete',
                            type: 'loading',
                        });

                        await publicClient.waitForTransactionReceipt({ hash });
                        setSwapProgressState('approved');

                        showTransactionToast({
                            id: toastId,
                            hash,
                            title: 'Token approved! 🎉',
                            description: 'Now proceeding with swap',
                            type: 'success',
                        });
                    } catch (error) {
                        console.log('Error approving token:', error);
                        showTransactionToast({
                            title: 'Error approving token',
                            description: 'Please try again',
                            type: 'error',
                        });
                        setSwapProgressState('error');
                        return;
                    }
                }
            }

            setSwapProgressState('swapping');
            const encodedData = data.swapRoute.methodParameters.calldata;
            const transactionRequest2 = {
                to: data.swapRoute.methodParameters.to as `0x${string}`,
                data: encodedData as `0x${string}`,
                value: isETHSwap ? BigInt(data.swapRoute.methodParameters.value) : BigInt(0),
            };

            try {
                const { hash } = await sendTransaction(transactionRequest2);
                setShowSwapConfirmationData({
                    tokenIn: data.tokenIn,
                    tokenOut: data.tokenOut,
                    amountIn: data.amountIn,
                    amountOut: data.swapRoute.quote,
                    tokenInDecimals: data.tokenIn.decimals,
                    tokenOutDecimals: data.tokenOut.decimals,
                    approvalHash,
                    swapHash: hash,
                });

                const finalConfirmationData = {
                    tokenIn: data.tokenIn,
                    tokenOut: data.tokenOut,
                    amountIn: data.amountIn,
                    amountOut: data.swapRoute.quote,
                    tokenInDecimals: data.tokenIn.decimals,
                    tokenOutDecimals: data.tokenOut.decimals,
                    approvalHash,
                    swapHash: hash,
                };
                const finalConfirmationDataString = JSON.stringify(finalConfirmationData);
                // Store final confirmation in database
                await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: finalConfirmationDataString,
                        responseFrom: 'tools',
                        toolName: 'swap_token_confirmation',
                        userId,
                    }),
                });

                setShowSwapConfirmation(false);
                const userMessage = { responseFrom: 'tools', response: finalConfirmationDataString, tool_name: 'swap_token_confirmation' };
                setMessages((prev) => [...prev, userMessage]);


                const publicClient = getPublicClient('base');
                const toastId = showTransactionToast({
                    hash,
                    title: 'Swapping tokens...',
                    description: 'Please wait for the swap to complete',
                    type: 'loading',
                });

                await publicClient.waitForTransactionReceipt({ hash });
                setSwapProgressState('completed');

                showTransactionToast({
                    id: toastId,
                    hash,
                    title: 'Swap successful! 🎉',
                    description: 'Your tokens have been swapped',
                    type: 'success',
                });
                setShowSwapConfirmation(false);
                // setShowActivity(false);

            } catch (error) {
                console.log('Error executing swap:', error);
                showTransactionToast({
                    title: 'Error executing swap',
                    description: 'Please try again',
                    type: 'error',
                });
                setSwapProgressState('error');
            }
        } catch (err) {
            setSwapProgressState('error');
            if (err instanceof Error) {
                console.log(err.message);
                if (err.message.includes('insufficient funds')) {
                    showTransactionToast({
                        title: 'Insufficient funds',
                        description: 'Please try again',
                        type: 'error',
                    });
                } else {
                    showTransactionToast({
                        title: 'Error sending transaction',
                        description: 'Please try again',
                        type: 'error',
                    });
                }
            }
        }
    };

    // Add this helper function to check if a response is an error
    // const isErrorResponse = (response: string) => {
    //     return (
    //         response.includes('status code') ||
    //         response.includes('error') ||
    //         response.includes('failed')
    //     );
    // };

    // Add this near the top of your render function, before the return statement
    // const renderConnectionStatus = () => {
    //     if (socketError) {
    //         return (
    //             <div className="text-red-500 text-sm mb-2">
    //                 {socketError}
    //             </div>
    //         );
    //     }

    //     if (!socketConnected) {
    //         return (
    //             <div className="text-yellow-500 text-sm mb-2">
    //                 Connecting to server...
    //             </div>
    //         );
    //     }

    //     return (
    //         <div className="text-green-500 text-sm mb-2">
    //             Connected to server
    //         </div>
    //     );
    // };

    return (
        <div className="flex h-screen font-funnel-sans md:ml-[80px] relative mt-10 md:mt-0">
            {/* Activity Toggle Button */}
            <button
                onClick={() => setShowActivity(!showActivity)}
                className="hidden md:block absolute top-4 right-4 p-2 rounded-lg transition-colors z-50 group"
            >
                <div className="flex items-center gap-1">
                    {!showActivity && <span className="text-sm font-normal font-funnel-sans text-black/40 group-hover:text-black">Activity</span>}
                    {showActivity ? <Icons.splitCloseIcon className="w-4 h-4 text-black/60 opacity-40 group-hover:opacity-100" /> : <Icons.splitOpenIcon className="w-4 h-4 text-black/60 opacity-40 group-hover:opacity-100" />}
                </div>
            </button>

            {/* Left side - Chat Interface */}
            <section className={`${showActivity ? 'w-1/2 border-r border-black/10' : 'w-full max-w-4xl mx-auto'} relative ease-in-out transition-all duration-500`}>
                <div className="flex flex-col gap-4 justify-between h-screen">
                    <div className="flex-1 h-full overflow-y-auto p-4 mt-10 md:mt-6">
                        {isLoadingMessages ? (
                            <div className="flex items-center gap-2 text-gray-600 p-4">
                                <div className="animate-spin h-4 w-4 border-2 border-gray-600 border-t-transparent rounded-full"></div>
                                <span>Loading messages...</span>
                            </div>
                        ) : (
                            <>
                                {messages.length > 0 && messages.map((message, index) => {
                                    if (message.responseFrom === 'user') {
                                        // Render user messages in chat only
                                        return (
                                            <div
                                                key={index}
                                                className="flex justify-end my-2"
                                            >
                                                <div className="max-w-[80%] p-4 rounded-full font-funnel-sans bg-black/4 text-black/80 ml-auto font-semibold">
                                                    {Array.isArray(message.response)
                                                        ? message.response.map((item, i) => (
                                                            <div key={i}>{item.text}</div>
                                                        ))
                                                        : typeof message.response === 'string' && message.responseFrom !== 'user' ? (
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm]}
                                                                components={{
                                                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                                    div: ({ children }) => <div className="prose prose-sm max-w-none">{children}</div>,
                                                                    pre: ({ children }) => <pre className="bg-black/4 p-4 rounded-lg">{children}</pre>,
                                                                    code: ({ children }) => <code className="text-pink-600 bg-black/4 rounded px-1">{children}</code>
                                                                }}
                                                            >
                                                                {message.response}
                                                            </ReactMarkdown>
                                                        ) : message.response}
                                                </div>
                                            </div>
                                        );
                                    }

                                    if (message.responseFrom === 'agent' || (message.responseFrom !== 'tools' && !message.tool_name)) {
                                        // Render agent messages in chat only
                                        return (
                                            <div
                                                key={index}
                                                className="flex justify-start my-2"
                                            >
                                                <div className="max-w-[80%] p-2 font-funnel-sans text-black/80 font-normal">
                                                    {Array.isArray(message.response)
                                                        ? message.response.map((item, i) => (
                                                            <div key={i}>{item.text}</div>
                                                        ))
                                                        : typeof message.response === 'string' && message.responseFrom !== 'user' ? (
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm]}
                                                                components={{
                                                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                                    div: ({ children }) => <div className="prose prose-sm max-w-none">{children}</div>,
                                                                    pre: ({ children }) => <pre className="bg-black/4 p-4 rounded-lg">{children}</pre>,
                                                                    code: ({ children }) => <code className="text-pink-600 bg-black/4 rounded px-1">{children}</code>
                                                                }}
                                                            >
                                                                {message.response}
                                                            </ReactMarkdown>
                                                        ) : message.response}
                                                </div>
                                            </div>
                                        );
                                    }

                                    // Render tool responses
                                    if (message.tool_name === 'token_analysis') {
                                        try {
                                            const data: TokenAnalysisResponse = JSON.parse(message.response as string);
                                            return (
                                                <div key={index} className="mb-6">
                                                    <TokenAnalysis data={data} />
                                                </div>
                                            );
                                        } catch (error) {
                                            console.log(error, 'error');
                                            return (
                                                <div key={index} className="mb-6">
                                                    <div className="bg-red-50 rounded-lg shadow-sm border border-red-100 p-4">
                                                        <div className="flex items-center gap-2 text-red-600">
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <circle cx="12" cy="12" r="10" />
                                                                <line x1="12" y1="8" x2="12" y2="12" />
                                                                <line x1="12" y1="16" x2="12" y2="16" />
                                                            </svg>
                                                            <span className="font-semibold">Invalid Response Format</span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-red-600">Failed to process token information. Please try again.</p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    }

                                    if (message.tool_name === 'get_balance') {
                                        try {
                                            const data: WalletBalanceResponse = JSON.parse(message.response as string);
                                            return (
                                                <div key={index} className="mb-6">
                                                    <TokenBalance
                                                        data={data}
                                                        selectedAccount={selectedAccount}
                                                        onSwap={(symbol) => setInputValue(`Swap ${symbol}`)}
                                                        onAnalyze={(symbol) => setInputValue(`Analyse ${symbol} token`)}
                                                    />
                                                </div>
                                            );
                                        } catch {
                                            return (
                                                <div key={index} className="mb-6">
                                                    <div className="bg-red-50 rounded-lg shadow-sm border border-red-100 p-4">
                                                        <div className="flex items-center gap-2 text-red-600">
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <circle cx="12" cy="12" r="10" />
                                                                <line x1="12" y1="8" x2="12" y2="12" />
                                                                <line x1="12" y1="16" x2="12" y2="16" />
                                                            </svg>
                                                            <span className="font-semibold">Invalid Balance Data</span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-red-600">Failed to process balance information. Please try again.</p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    }

                                    if (message.tool_name === 'swap_token') {
                                        try {
                                            const data: SwapTokenResponse = JSON.parse(message.response as string);
                                            console.log(data, 'data');
                                            return (
                                                <div key={index} className="mb-2">
                                                    <TokenSwap data={data} onSwap={handleSwapToken} onDeny={() => handleSwapConfirmationMsgStore('Deny')} userAddress={selectedAccount?.address as `0x${string}`} />
                                                </div>
                                            );
                                        } catch (error) {
                                            console.log(error, 'error');
                                            return (
                                                <div key={index} className="mb-2">
                                                    <div className="bg-red-50 rounded-lg shadow-sm border border-red-100 p-4 max-w-max">
                                                        <div className="flex items-center gap-2 text-red-600">
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <circle cx="12" cy="12" r="10" />
                                                                <line x1="12" y1="8" x2="12" y2="12" />
                                                                <line x1="12" y1="16" x2="12" y2="16" />
                                                            </svg>
                                                            <span className="font-semibold">Invalid Swap Data</span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-red-600">Failed to process swap information. Please try again.</p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    }

                                    if (message.tool_name === 'swap_token_confirmation') {
                                        try {
                                            const data: SwapTokenConfirmationResponse = JSON.parse(message.response as string);
                                            console.log(data, 'data');
                                            return (
                                                <div key={index} className="mb-2">
                                                    <TokenSwapConfirmation
                                                        data={data}
                                                        userAddress={selectedAccount?.address as `0x${string}`}
                                                        state={swapProgressState}
                                                    />
                                                </div>
                                            );
                                        } catch (error) {
                                            console.log(error, 'error');
                                        }
                                    }

                                    if (message.tool_name === 'invest_token') {
                                        try {
                                            console.log(message, 'message.response');
                                            const data: TokenInvestResponse = JSON.parse(message.response as string);
                                            return (
                                                <div key={index} className="mb-6">
                                                    <TokenInvest data={data} updateMessage={updateMessage} messageId={message.messageId} userAddress={selectedAccount?.address as `0x${string}`} onDeny={() => handleSwapConfirmationMsgStore('Deny')} />
                                                </div>
                                            );
                                        } catch (error) {
                                            console.log(error, 'error');
                                            return (
                                                <div key={index} className="mb-6">
                                                    <div className="bg-red-50 rounded-lg shadow-sm border border-red-100 p-4">
                                                        <div className="flex items-center gap-2 text-red-600">
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <circle cx="12" cy="12" r="10" />
                                                                <line x1="12" y1="8" x2="12" y2="12" />
                                                                <line x1="12" y1="16" x2="12" y2="16" />
                                                            </svg>
                                                            <span className="font-semibold">Invalid Response Format</span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-red-600">Failed to process token information. Please try again.</p>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    }

                                    // if (message.tool_name === 'after_invest_token') {
                                    //     const hash: `0x${string}` = JSON.parse(message.response as `0x${string}`);
                                    //     return (
                                    //         <div key={index} className="mb-6 max-w-[80%] w-max">
                                    //             <div className="bg-green-50 rounded-lg shadow-sm border border-green-100 p-4 flex flex-col gap-2 items-center ">
                                    //                 <p className="text-green-600">Investment successful! 🎉</p>
                                    //                 {hash && (
                                    //                     <Link
                                    //                         href={`https://basescan.org/tx/${hash}`}
                                    //                         target="_blank"
                                    //                         className="text-secondary-blue text-sm font-semibold flex items-center gap-1 font-funnel-sans bg-transparent border border-black/20 rounded-full px-3 py-0.5"
                                    //                     >
                                    //                         View on Explorer
                                    //                         <Icons.arrowUpBlueIcon />
                                    //                     </Link>
                                    //                 )}
                                    //             </div>
                                    //         </div>
                                    //     )
                                    // }




                                })}

                                {showSwapConfirmation &&
                                    <div className="mb-2">
                                        <TokenSwapConfirmation data={showSwapConfirmationData as SwapTokenConfirmationResponse} state={swapProgressState} userAddress={selectedAccount?.address as `0x${string}`} />
                                    </div>
                                }
                                {isLoading && (
                                    <div className="flex items-center gap-2 text-gray-600 p-4">
                                        <div className="animate-spin h-4 w-4 border-2 border-gray-600 border-t-transparent rounded-full"></div>
                                        <span>Thinking...</span>
                                    </div>
                                )}
                            </>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="w-[80%] mx-auto self-end">
                        <form
                            onSubmit={handleSubmit}
                            className="bg-transparent rounded-full p-1 border-2 border-black/10 mb-2"
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
                        <div className="w-full text-center text-xs text-black/40 font-funnel-sans my-1">
                            <span>Earny can make mistakes. Check important info.</span>
                        </div>
                    </div>
                </div>
            </section >

            {/* Right side - Tool UI */}

            <section className={`${showActivity ? 'hidden md:flex w-1/2 h-screen overflow-y-auto bg-gray-50 p-6 translate-x-0' : 'translate-x-full w-0 opacity-0 overflow-hidden'} transition-all duration-500 flex justify-center items-center flex-col relative`
            }>
                <div className="flex items-center gap-2 mb-6 absolute top-4 left-4">
                    <Icons.earnyLogoBlack className="w-10 h-10 text-black/40" />
                    <span className="text-sm font-semibold font-funnel-sans text-black/40">Activity</span>
                </div>

                <div className="w-full flex justify-center items-center">
                    {showActivity ?
                        <SwapProgress
                            tokenInSymbol={swapProgressData.tokenInSymbol}
                            tokenInImage={swapProgressData.tokenInImage}
                            tokenInAmount={swapProgressData.tokenInAmount}
                            tokenInDecimals={swapProgressData.tokenInDecimals}
                            tokenOutSymbol={swapProgressData.tokenOutSymbol}
                            tokenOutImage={swapProgressData.tokenOutImage}
                            tokenOutAmount={swapProgressData.tokenOutAmount}
                            gasFee={swapProgressData.gasFee}
                            state={swapProgressState}
                        /> :
                        <div className="w-[80%] text-center font-funnel-sans text-black/40">
                            <p>No Activity yet</p>
                        </div>
                    }

                </div>
            </section>


            {/* <TransactionStatus
                isOpen={isTransactionStatusOpen}
                onClose={() => setIsTransactionStatusOpen(false)}
                title={transactionStatus.title}
                description={transactionStatus.description}
                type={transactionStatus.type}
                hash={transactionStatus.hash}
            /> */}

            < Toaster />
        </div >
    );
} 