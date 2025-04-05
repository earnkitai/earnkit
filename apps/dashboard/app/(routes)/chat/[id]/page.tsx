'use client';

import { useState, useRef, useEffect, use } from 'react';
import { useWallets } from '@/providers/wallet-provider';
import { useTurnkey } from '@turnkey/sdk-react';
import { TransactionRequest } from 'viem';
import { ethers } from 'ethers';
import { showTransactionToast } from '@/lib/toast';
import { useTransactions } from '@/providers/transactions-provider';
import { Toaster } from 'sonner';
import { TokenAnalysis, TokenSwap, TokenBalance } from '@/app/components/dashboard/tools';
import { TokenAnalysisResponse } from '@/app/components/dashboard/tools/TokenAnalysis';
import { WalletBalanceResponse } from '@/app/components/dashboard/tools/TokenBalance';
// import * as Tooltip from '@radix-ui/react-tooltip';
import { TransactionStatus } from '@/app/components/ui/transaction-status';
// import { useRouter } from 'next/navigation';
import { getPublicClient, getTurnkeyWalletClient } from '@/lib/web3';
import { TurnkeyBrowserClient } from '@turnkey/sdk-browser';
import { io, Socket } from 'socket.io-client';
import { useUser } from '@/hooks/use-user';

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
    const { addPendingTransaction } = useTransactions();
    const { state } = useWallets();
    const { selectedAccount } = state;
    const { user } = useUser()
    const { passkeyClient } = useTurnkey();
    const [userId, setUserId] = useState<string | null>(null);
    const { turnkey } = useTurnkey();
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
    const [walletClient, setWalletClient] = useState<Awaited<ReturnType<typeof getTurnkeyWalletClient>> | null>(null);

    // Socket.IO implementation
    const socketRef = useRef<Socket | null>(null);
    const [socketConnected, setSocketConnected] = useState(false);
    const [socketError, setSocketError] = useState<string | null>(null);



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
        }
    }, [userId, messages.length, initialMessage, socketConnected]);

    useEffect(() => {
        if (user) {
            console.log(user, "user")
        }
    }, [user])

    useEffect(() => {
        if (turnkey) {
            const fetchUser = async () => {
                try {
                    const currentUser = await turnkey.getCurrentUser();
                    if (currentUser?.userId) {
                        setUserId(currentUser.userId);
                    }
                } catch (error) {
                    console.log("Error fetching user profile:", error);
                }
            };
            fetchUser();
        }
    }, [turnkey]);

    useEffect(() => {
        const initializeWalletClient = async () => {
            if (!selectedAccount || !passkeyClient) return;
            const walletClient = await getTurnkeyWalletClient(
                passkeyClient as TurnkeyBrowserClient,
                selectedAccount.address,
            );
            setWalletClient(walletClient);
        };

        initializeWalletClient();
    }, [selectedAccount, passkeyClient]);

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
            setSocketError(null);

            // Send a test message to verify connection
            socketRef.current?.emit('ping', { timestamp: Date.now() });
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
            setSocketError(`Connection error: ${error.message}. Retrying...`);
            setIsLoading(false);
        });

        socketRef.current.on('error', (error) => {
            console.log('Socket general error:', error);
            setSocketError(`Socket error: ${error}`);
            setIsLoading(false);
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

            setMessages((prev) => [...prev, data]);
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
                saveAIMessage(responseMessage);
            } else {
                console.warn('Received AI response but userId is not available yet');
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
                return;
            }

            const content = typeof message.response === 'string'
                ? message.response
                : JSON.stringify(message.response);

            await fetch(`/api/chat/${resolvedParams.id}/messages`, {
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
        } catch (err) {
            console.log('Error storing AI message:', err);
        }
    };


    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) {
            e.preventDefault();
        }
        if (!inputValue.trim() || !userId || !socketConnected) return;

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
                setSocketError('Not connected to server. Please refresh the page.');
                setIsLoading(false);
            }
        } catch (error) {
            console.log('Socket send error:', error);
            setSocketError('Failed to send message. Please try again.');
            setIsLoading(false);
        }
    };


    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
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

            // const ROUTER_ADDRESS = '0x2626664c2603336E57B271c5C0b26F421741e481';
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
                    args: [selectedAccount.address, data.swapRoute.methodParameters.to as `0x${string}`],
                })) as bigint;

                console.log(allowanceData, 'allowance data');

                // If allowance is insufficient, send approve transaction first
                if (allowanceData < BigInt(data.amountIn)) {
                    const approveData = erc20Contract.encodeFunctionData('approve', [
                        data.swapRoute.methodParameters.to as `0x${string}`,
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
                        console.log('Error approving token:', error);
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
            // const router = new ethers.Interface(ROUTER_ABI);

            // // Encode the swap parameters
            // const swapParams = {
            //     tokenIn: data.tokenIn.address,
            //     tokenOut: data.tokenOut.address,
            //     recipient: selectedAccount?.address as `0x${string}`,
            //     amountIn: data.amountIn,
            //     amountOutMinimum: 0,
            //     sqrtPriceLimitX96: 0,
            // };

            // // Encode the function call
            // const encodedData = router.encodeFunctionData('exactInputSingle', [
            //     swapParams,
            // ]);

            const encodedData = data.swapRoute.methodParameters.calldata;

            console.log(encodedData, 'encoded data');

            // Prepare the transaction request
            const transaction = await walletClient.prepareTransactionRequest({
                to: data.swapRoute.methodParameters.to as `0x${string}`,
                data: encodedData as `0x${string}`,
                // Include value if swapping ETH
                value: isETHSwap ? BigInt(data.swapRoute.methodParameters.value) : BigInt(0),
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
            console.log('Error sending transaction:', error);
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

    // Add this near the top of your render function, before the return statement
    const renderConnectionStatus = () => {
        if (socketError) {
            return (
                <div className="text-red-500 text-sm mb-2">
                    {socketError}
                </div>
            );
        }

        if (!socketConnected) {
            return (
                <div className="text-yellow-500 text-sm mb-2">
                    Connecting to server...
                </div>
            );
        }

        return (
            <div className="text-green-500 text-sm mb-2">
                Connected to server
            </div>
        );
    };

    return (
        <div>
            {/* <div className="fixed top-4 right-4 flex items-center gap-3 justify-center">
                <Tooltip.Provider>
                    <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                            <button
                                onClick={() => router.push('/dashboard')}
                                className="flex items-center gap-2 justify-center font-funnel-sans font-semibold rounded-xl hover:bg-gray-50 transition-colors z-40"
                                aria-label="Back to dashboard"
                            >
                                <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="w-6 h-6 text-black opacity-40 hover:opacity-100 transition-opacity"
                                >
                                    <path
                                        d="M19 12H5M5 12L12 19M5 12L12 5"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </button>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                            <Tooltip.Content
                                className="bg-gray-900 text-white px-2 py-1 rounded text-sm"
                                sideOffset={5}
                            >
                                Back to Dashboard
                            </Tooltip.Content>
                        </Tooltip.Portal>
                    </Tooltip.Root>
                </Tooltip.Provider>
            </div> */}

            <section className="relative max-w-3xl mx-auto rounded-lg">
                <div className="flex flex-col gap-4 justify-between h-screen pt-4">
                    <div className="flex-1 h-full overflow-y-auto p-4 pt-10">
                        {isLoadingMessages ? (
                            <div className="flex items-center gap-2 text-gray-600 p-4">
                                <div className="animate-spin h-4 w-4 border-2 border-gray-600 border-t-transparent rounded-full"></div>
                                <span>Loading messages...</span>
                            </div>
                        ) : (
                            <>
                                {messages.length > 0 && messages.map((message, index) => {
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
                                                const data: SwapTokenResponse = JSON.parse(message.response as string);
                                                return (
                                                    <div key={index} className="flex justify-start my-4">
                                                        <TokenSwap
                                                            data={data}
                                                            onSwap={handleSwapToken}
                                                            userAddress={selectedAccount?.address as string}
                                                        />
                                                    </div>
                                                );
                                            } catch {

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
                                        } catch {
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
                            </>
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

            <TransactionStatus
                isOpen={isTransactionStatusOpen}
                onClose={() => setIsTransactionStatusOpen(false)}
                title={transactionStatus.title}
                description={transactionStatus.description}
                type={transactionStatus.type}
                hash={transactionStatus.hash}
            />

            <Toaster />

            {/* Add this where appropriate in your UI */}
            {renderConnectionStatus()}
        </div>
    );
} 