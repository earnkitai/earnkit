'use client';

import { useState, useRef, useEffect, use, useReducer } from 'react';
import { Account, Address, createWalletClient, custom, Hex, parseEther, parseUnits, zeroAddress } from 'viem';
import { ethers } from 'ethers';
import { showTransactionToast } from '@/lib/toast';
import { Toaster } from '@/app/components/ui/sonner';
import { TokenAnalysis, TokenSwap, TokenBalance, TokenInvest, SendToken } from '@/app/components/dashboard/tools';
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
// import { useUser } from '@/hooks/use-user';
// import { useChat } from '@/providers/chat-provider';
import { usePrivy, useWallets, Wallet } from '@privy-io/react-auth';
import { Icons } from '@/app/components/sections/icons';
// import { SwapProgress, SwapProgressProps } from '@/app/components/ui/swap-progress';
import TokenSwapConfirmation from '@/app/components/dashboard/tools/TokenSwapConfirmation';
import { BuyEventArgs, TokenInvestResponse, TokenInvestState } from '@/app/components/dashboard/tools/Token_Invest';
// import { TokenInvestProgress } from '@/app/components/dashboard/tools/TokenInvestProgress';
// import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
// import Image from 'next/image';
import BridgeToken, { BridgeTokenProps } from '@/app/components/dashboard/tools/Bridge_token';
import InvestInClankerToken, { InvestInClankerTokenResponse } from '@/app/components/dashboard/tools/Invest_In_Clanker_tokens';
import { GridIntroMessage } from '@/app/components/dashboard/GridIntroMessage';
import MagneticSlider from '@/app/components/dashboard/MagneticSlider';
import RiskAndReturnOnInvestment from '@/app/components/dashboard/RiskAndReturnOnInvestment';
import AgentActivity from '@/app/components/dashboard/AgentActivity';
import { toast } from 'sonner';
import { createLimitOrder, createOrderHistory } from '@/actions/order';
import { base } from 'viem/chains';
import { tradeCoin } from '@zoralabs/coins-sdk';
import { fetchEthValueByUsd, getTokenMetadataWithCoingecko } from '@/actions/web3';
import TradeHistory, { TradeHistoryProps } from '@/app/components/dashboard/tools/TradeHistory';

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
    state?: TokenInvestState[];
    metadata?: string;
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

interface InvestMemeCoinResponse {
    amount: string;
    returnPercentage: string;
    targetReturn: string;
    riskLevel: string;
}

interface Token {
    address: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
    image: string;
    currentPrice: number;
}
interface ZoraToken {
    address: `0x${string}`;
    confidenceScore: number;
    marketCap: string;
    name: string;
    previewImage: {
        small: string;
        medium: string;
        blurhash: string;
    };
    sources: string[];
    symbol: string;
    uniqueHolders: number;
    volume24h: string;
}

interface ZoraTokenRecommendationResponse {
    metadata: {
        count: number;
        riskLevel: string;
        investmentAmount: number;
    }
    recommendations: ZoraToken[];
}

interface ClankerToken {
    id: string;
    type: string;
    attributes: {
        address: string;
        name: string;
        symbol: string;
        decimals: number;
        image_url: string;
        coingecko_coin_id: string;
    };
    market_cap: number;
    volume: number;
    price_usd: string;
    price_change_percentage: {
        current: string;
        changes: {
            m5: string;
            m15: string;
            m30: string;
            h1: string;
            h6: string;
            h24: string;
        };
    };
    risk_metrics: {
        score: number;
        risk_level: number;
        gt_score: number;
        holder_count: number;
        pool_age_days: number;
        volatility: number;
        appearances: number;
    };
}



interface ClankerTokenMetadata {
    tokens: ClankerToken[];
    metadata: {
        count: number;
        riskLevel: string;
        investmentAmount: number;
        timestamp: string;
    }
}
// interface MessageResponse {
//     content: string;
//     responseFrom: string;
//     toolName?: string;
//     id?: string;
// }



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

interface SendTokenResponse {
    token: {
        address: `0x${string}`;
        decimals: number;
        name: string;
        symbol: string;
        image: string;
        currentPrice: number;
    };
    amount: string;
    originalAmount: string;
    amountType: string;
    recipient: `0x${string}`;
    sender: `0x${string}`;
    isNativeToken: boolean;
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

export type StepStatus = 'stable' | 'inprogress' | 'confirmed' | 'error';

export interface ActivityStep {
    label: string;
    status: StepStatus;
}

const initialSteps: ActivityStep[] = [
    { label: "Searching matching tokens on Zora", status: "stable" },
    { label: "Searching matching tokens on Clanker", status: "stable" },
    { label: "Shortlisting for trades", status: "stable" },
    { label: "Executing trades", status: "stable" },
];

type ActivityAction =
    | { type: 'reset' }
    | { type: 'set_step'; stepIndex: number; status: StepStatus };

function activityReducer(state: ActivityStep[], action: ActivityAction): ActivityStep[] {
    switch (action.type) {
    case 'reset':
        return initialSteps.map(s => ({ ...s }));
    case 'set_step':
        return state.map((step, idx) =>
            idx === action.stepIndex ? { ...step, status: action.status } : step
        );
    default:
        return state;
    }
}

async function fetchTokenRecommendations(amount: string, percentage: string) {
    try {
        const response = await fetch(
            `/api/investments/zora?amount=${amount}&percentage=${percentage}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.ok) {
            throw new Error('Failed to fetch recommendations');
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching recommendations:', error);
        throw error;
    }
}

async function fetchClankerTokens(amount: string, percentage: string) {
    try {
        const response = await fetch(
            `/api/investments/clanker?amount=${amount}&percentage=${percentage}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.ok) {
            throw new Error('Failed to fetch Clanker tokens');
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching Clanker tokens:', error);
        throw error;
    }
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const [inputValue, setInputValue] = useState('');
    // const [initialMessage, setInitialMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    // const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    // const { addPendingTransaction } = useTransactions();
    const [showSwapConfirmation, setShowSwapConfirmation] = useState<boolean>(false);
    const [showSwapConfirmationData, setShowSwapConfirmationData] = useState<SwapTokenConfirmationResponse | null>(null);
    const [swapProgressState, setSwapProgressState] = useState<SwapProgressState>('');
    // const [swapProgressData, setSwapProgressData] = useState<SwapProgressProps>({
    //     tokenInSymbol: '',
    //     tokenInAmount: '',
    //     tokenInImage: '',
    //     tokenOutSymbol: '',
    //     tokenOutAmount: '',
    //     tokenOutImage: '',
    //     tokenInDecimals: 18,
    //     gasFee: '',
    //     state: swapProgressState,
    // });

    // const { state } = useWallets();
    // const { selectedAccount } = state;
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    // const [wallets, setWallets] = useState<Wallet[]>([]);
    // const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
    // const { wallet: activeWallet } = useActiveWallet();
    // const { user } = useUser()
    // const { passkeyClient, getActiveClient } = useTurnkey();
    const [userId, setUserId] = useState<string | null>(null);
    const { ready, authenticated, user: privyUser, sendTransaction } = usePrivy();
    const { wallets } = useWallets();
    const wallet = wallets.find((wallet) => wallet.walletClientType === "privy") || wallets[0];
    // const { wallets: privyWallets } = useWallets();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const leftSectionRef = useRef<HTMLElement>(null);
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
    // const { setNeedToFetchChats } = useChat();
    const [showActivity, setShowActivity] = useState(true);

    // Socket.IO implementation
    const socketRef = useRef<Socket | null>(null);
    const [socketConnected, setSocketConnected] = useState(false);
    // const [socketError, setSocketError] = useState<string | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustTextareaHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
        }
    };

    const [activitySteps, dispatchActivity] = useReducer(activityReducer, initialSteps);
    const [currentActivity, setCurrentActivity] = useState<string>("");

    const resetActivity = () => {
        dispatchActivity({ type: 'reset' });
        setCurrentActivity("");
    };


    const handleMessageSend = () => {
        const userMessageToSave = "Confirm"
        const userMessage = { responseFrom: 'user', response: userMessageToSave };
        const agentMessage = { responseFrom: 'agent', response: "Setting up the trades..." };
        setMessages([...messages, userMessage, agentMessage]);
    }
    const handleInvestConfirm = async (confirm: boolean, orderSize?: string, messageId?: string, targetPrice?: string, targetPercentage?: number) => {
        if (!confirm) {
            const userMessageToSave = "Deny"
            const userMessage = { responseFrom: 'user', response: userMessageToSave };
            try {
                await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: userMessageToSave,
                        responseFrom: 'user',
                        userId,
                    }),
                });
            } catch (error) {
                console.log('Error storing user message:', error);
            }

            setCurrentActivity("Waiting for selection...");
            const newMessage = createEarnyGridMessage();
            setMessages([...messages, userMessage, newMessage]);
            return;
        }

        const userMessageToSave = "Confirm"
        const agentMessage = { responseFrom: 'agent', response: "Setting up the trades..." };
        try {
            await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: userMessageToSave,
                    responseFrom: 'user',
                    userId,
                }),
            });
            await saveAIMessage(agentMessage)
        } catch (error) {
            console.log('Error storing user message:', error);
        }

        resetActivity();
        setCurrentActivity("investing");

        try {
            // Get investment data from last message
            const lastMessage = messages[messages.length - 1];
            const data = JSON.parse(lastMessage.response as string) as InvestMemeCoinResponse;

            // 1. Fetch Zora tokens
            dispatchActivity({ type: 'set_step', stepIndex: 0, status: 'inprogress' });
            const zoraTokens: ZoraTokenRecommendationResponse = await fetchTokenRecommendations(data.amount, data.returnPercentage);
            console.log("Zora tokens:", zoraTokens);
            dispatchActivity({ type: 'set_step', stepIndex: 0, status: 'confirmed' });

            // 2. Fetch Clanker tokens
            dispatchActivity({ type: 'set_step', stepIndex: 1, status: 'inprogress' });
            const clankerTokens: ClankerTokenMetadata = await fetchClankerTokens(data.amount, data.returnPercentage);
            console.log("Clanker tokens:", clankerTokens);
            dispatchActivity({ type: 'set_step', stepIndex: 1, status: 'confirmed' });

            // orderSize is in the usd so fetch the eth value in wei
            const ethValue = await fetchEthValueByUsd(orderSize || "0");
            console.log(ethValue, 'ethValue')
            console.log(messageId, 'messageId')
            console.log(targetPrice, 'targetPrice')
            console.log(targetPercentage, 'targetPercentage')
            // 3. Shortlist tokens
            dispatchActivity({ type: 'set_step', stepIndex: 2, status: 'inprogress' });

            // buying the zora token

            // take the token with higher marketcap
            const zoraTokenWithHigherMarketCap = zoraTokens.recommendations.sort((a, b) => parseFloat(b.marketCap) - parseFloat(a.marketCap))[0];
            const trade1 = await buyZoraCoin(zoraTokenWithHigherMarketCap.address, Number(parseFloat(ethValue) / 2), targetPrice, targetPercentage);
            console.log(trade1, 'trade1')
            // buying the clanker token
            const trade2 = await buyClankerCoin(clankerTokens.tokens[0].attributes.address as Address, Number(parseFloat(ethValue) / 2), clankerTokens.tokens[0], targetPrice, targetPercentage);
            console.log(trade2, 'trade2')
            await new Promise(resolve => setTimeout(resolve, 2000));
            dispatchActivity({ type: 'set_step', stepIndex: 2, status: 'confirmed' });

            console.log(orderSize, 'orderSize')


            // 4. Execute trades
            dispatchActivity({ type: 'set_step', stepIndex: 3, status: 'inprogress' });
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (trade1 && trade2) {
                const tradeDetails = JSON.stringify({ trades: [trade1, trade2] });
                console.log(tradeDetails, 'tradeDetails')

                const responseMessage = {
                    responseFrom: 'tool',
                    response: tradeDetails,
                    tool_name: 'trade_history',
                }
                await saveAIMessage(responseMessage).then((savedMessage) => {
                    if (savedMessage) {
                        // Store the message ID in the message object for all messages
                        const messageWithId = { ...responseMessage, messageId: savedMessage.id };
                        setMessages((prev) => [...prev, messageWithId]);
                    } else {
                        // Fallback to adding message without ID if save failed
                        setMessages((prev) => [...prev, responseMessage]);
                    }
                });
                dispatchActivity({ type: 'set_step', stepIndex: 3, status: 'confirmed' });
            } else {
                dispatchActivity({ type: 'set_step', stepIndex: 3, status: 'error' });
            }

        } catch (error) {
            console.error('Error in investment process:', error);
            const currentStep = activitySteps.findIndex(step => step.status === 'inprogress');
            if (currentStep !== -1) {
                dispatchActivity({ type: 'set_step', stepIndex: currentStep, status: 'error' });
            }
        }
    };

    const publicClient = getPublicClient("base");

    // fetch the token details using getTokenMetadataWithCoingecko by passing the token address
    const fetchTokenDetails = async (tokenAddress: Address) => {
        const tokenDetails = await getTokenMetadataWithCoingecko(tokenAddress);
        console.log(tokenDetails, 'token details');
        return tokenDetails;
    }
    // Define buy parameters
    const buyZoraCoin = async (
        coinContractAddress: Address,
        orderSize: number,
        targetPrice?: string,
        targetPercentage?: number,
    ) => {
        if (!userId) {
            console.error("No user ID found");
            toast.error("Please connect your wallet first");
            return;
        }

        console.log("buyCoin", coinContractAddress, orderSize);

        const provider = wallet ? await wallet?.getEthereumProvider() : null;

        console.log(provider, 'provider inside the buy coin')
        console.log(wallet, 'wallet inside the buy coin')

        if (!provider) {
            console.log("No provider found");
            toast.error("Please connect your wallet first");
            return;
        }
        const walletClient = createWalletClient({
            account: wallet.address as Hex,
            chain: base,
            transport: custom(provider),
        });
        console.log(walletClient, 'walletClient inside the buy coin')
        let serializedTradeDetails = null;
        try {
            // have selected token details
            const buyParams = {
                direction: "buy" as const,
                target: coinContractAddress as Address,
                args: {
                    recipient: wallet.address as Address,
                    orderSize: parseEther(orderSize.toString()),
                    minAmountOut: BigInt(0),
                }
            };
            const result = await tradeCoin(buyParams, walletClient, publicClient);

            if (await result.receipt && userId) {
                console.log(result.trade, 'result.trade')

                const tradeData = result.trade as BuyEventArgs;

                const tokenIn = await fetchTokenDetails(result.trade?.currency as Address);
                const tokenOut = await fetchTokenDetails(coinContractAddress as Address);
                // setTokenInDetails(tokenIn);
                // setTokenOutDetails(tokenOut);

                const serializedTrade = {
                    amountFee: tradeData.amountFee.toString(),
                    amountSold: tradeData.amountSold.toString(),
                    coinsPurchased: tradeData.coinsPurchased.toString(),
                    currency: tradeData.currency,
                    buyer: tradeData.buyer,
                    recipient: tradeData.recipient,
                    tradeReferrer: tradeData.tradeReferrer,
                }

                serializedTradeDetails = {
                    hash: result.hash,
                    tradeDetails: serializedTrade,
                    tokenInDetails: tokenIn,
                    tokenOutDetails: tokenOut
                };
                console.log(serializedTradeDetails, 'serializedTradeDetails')
                // updateMessage(messageId!, JSON.stringify({
                //     ...data,
                //     tradeDetails: serializedTradeDetails
                // }));
                // setTxHash(result.hash);
                // setTradeDetails({
                //     hash: result.hash,
                //     trade: tradeData,
                //     tokenInDetails: tokenIn,
                //     tokenOutDetails: tokenOut
                // });
                if (targetPrice && Number(targetPrice) > 0) {
                    try {
                        // Store order details in database
                        // need to add token decimals
                        await createLimitOrder({
                            userId: userId,
                            userAddress: wallet.address as `0x${string}`,
                            tokenAddress: coinContractAddress as string,
                            tokenSymbol: tokenOut.symbol,
                            tokenDecimal: tokenOut.decimals || 18,
                            amount: tradeData.coinsPurchased.toString(),
                            priceAtCreation: tokenOut.priceUsd.toString() || "0",
                            targetPrice: targetPrice || "0",
                            targetChange: targetPercentage || 0,
                            direction: 'SELL',
                            orderType: 'LIMIT',
                            aiInitiated: true,
                            notes: "",
                        });
                    } catch (error) {
                        console.log("Error creating limit order:", error);
                        toast.error("Failed to save order details");
                    }
                }

                try {
                    await createOrderHistory({
                        userId: userId,
                        userAddress: wallet.address as `0x${string}`,
                        tokenAddress: coinContractAddress as string,
                        tokenSymbol: tokenOut.symbol,
                        tokenDecimal: tokenOut.decimals || 18,
                        amount: tradeData.coinsPurchased.toString(),
                        priceAtCreation: tokenOut.priceUsd.toString() || "0",
                        targetPrice: targetPrice?.toString() || "0",
                        targetChange: targetPercentage || 0,
                        direction: 'BUY',
                        orderType: 'DIRECT',
                        executedAt: new Date(),
                        executedPrice: tokenOut.priceUsd.toString() || "0",
                        aiInitiated: true,
                        notes: "",
                    });

                } catch (error) {
                    console.log("Error creating order history:", error);
                    toast.error("Failed to save order details");
                }
            }
            return serializedTradeDetails;
        } catch (error) {
            console.log("Error buying coin:", error);
            toast.error("Error buying coin");
            return null;
        }
    }

    // Clanker token buy
    // Define buy parameters
    const buyClankerCoin = async (
        coinContractAddress: Address,
        orderSize: number,
        token: ClankerToken,
        targetPrice?: string,
        targetPercentage?: number,
    ) => {
        if (!userId) {
            console.error("No user ID found");
            toast.error("Please connect your wallet first");
            return;
        }
        console.log("buyCoin", coinContractAddress, orderSize);
        let serializedTradeDetails = null;
        try {
            // have selected token details
            const decimalsOut = token?.attributes.decimals || 18;

            const amountSold = parseUnits(orderSize.toString(), 18).toString();

            const swapRouteResponse = await fetch(
                "https://swap-data-api-psi.vercel.app/swap-route",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        userAddress: wallet.address as `0x${string}`,
                        tokenInAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                        tokenOutAddress: coinContractAddress as `0x${string}`,
                        amountIn: amountSold,
                        decimalsIn: 18,
                        decimalsOut: decimalsOut,
                    }),
                },
            );

            const swapRouteData = await swapRouteResponse.json();
            console.log(swapRouteData, 'swapRouteData');

            if (swapRouteData) {

                const erc20Contract = new ethers.Interface(ERC20_ABI);

                const allowanceData = (await publicClient.readContract({
                    address: "0x4200000000000000000000000000000000000006",
                    abi: ERC20_ABI,
                    functionName: 'allowance',
                    args: [wallet.address as `0x${string}`, swapRouteData.methodParameters.to as `0x${string}`],
                })) as bigint;


                if (allowanceData < BigInt(amountSold)) {
                    const approveData = erc20Contract.encodeFunctionData('approve', [
                        swapRouteData.methodParameters.to as `0x${string}`,
                        BigInt(amountSold), // we can also use ethers.MaxUint256
                    ]);

                    const transactionRequest = {
                        to: "0x4200000000000000000000000000000000000006",
                        data: approveData as `0x${string}`,
                    };

                    try {
                        const { hash } = await sendTransaction(transactionRequest);

                        await publicClient.waitForTransactionReceipt({ hash });

                    } catch (error) {
                        console.log('Error approving token:', error);
                        return;
                    }
                }

                const encodedData = swapRouteData.methodParameters.calldata;
                console.log(encodedData, 'encodedData')
                const transactionRequest2 = {
                    to: swapRouteData.methodParameters.to as `0x${string}`,
                    data: encodedData as `0x${string}`,
                    value: BigInt(swapRouteData.methodParameters.value),
                };

                const { hash } = await sendTransaction(transactionRequest2);
                await publicClient.waitForTransactionReceipt({ hash: hash });

                if (hash && userId) {


                    const tokenIn = await fetchTokenDetails("0x4200000000000000000000000000000000000006");
                    const tokenOutDetails = token;
                    console.log(tokenOutDetails, 'tokenOutDetails')
                    const tokenOut = {
                        imageUrl: tokenOutDetails?.attributes.image_url || "",
                        name: tokenOutDetails?.attributes.name || "",
                        symbol: tokenOutDetails?.attributes.symbol || "",
                        decimals: tokenOutDetails?.attributes.decimals || 18,
                        priceUsd: Number(tokenOutDetails?.price_usd) || 0,
                    };

                    const serializedTrade = {
                        amountFee: "0",
                        amountSold: amountSold,
                        coinsPurchased: parseUnits(swapRouteData.quote, decimalsOut).toString(),
                        currency: "0x4200000000000000000000000000000000000006",
                        buyer: wallet.address as `0x${string}`,
                        recipient: wallet.address as `0x${string}`,
                        tradeReferrer: zeroAddress,
                    }
                    const coinPurchase = parseUnits(swapRouteData.quote, decimalsOut).toString();

                    const tradeData = {
                        amountFee: BigInt(0),
                        amountSold: BigInt(amountSold || 0),
                        coinsPurchased: BigInt(coinPurchase || 0),
                        currency: "0x4200000000000000000000000000000000000006" as `0x${string}`,
                        buyer: wallet.address as `0x${string}`,
                        recipient: wallet.address as `0x${string}`,
                        tradeReferrer: zeroAddress,
                    };

                    serializedTradeDetails = {
                        hash: hash,
                        tradeDetails: serializedTrade,
                        tokenInDetails: tokenIn,
                        tokenOutDetails: tokenOut
                    };
                    console.log(serializedTradeDetails, 'serializedTradeDetails')

                    if (targetPrice && Number(targetPrice) > 0) {
                        try {
                            // Store order details in database
                            // need to add token decimals
                            await createLimitOrder({
                                userId: userId,
                                userAddress: wallet.address as `0x${string}`,
                                tokenAddress: coinContractAddress as string,
                                tokenSymbol: tokenOut.symbol,
                                tokenDecimal: tokenOut.decimals || 18,
                                amount: tradeData.coinsPurchased.toString(),
                                priceAtCreation: tokenOut.priceUsd.toString() || "0",
                                targetPrice: targetPrice.toString() || "0",
                                targetChange: targetPercentage || 0,
                                direction: 'SELL',
                                orderType: 'LIMIT',
                                aiInitiated: true,
                                notes: "",
                            });
                        } catch (error) {
                            console.log("Error creating limit order:", error);
                            toast.error("Failed to save order details");
                        }
                    }

                    try {
                        await createOrderHistory({
                            userId: userId,
                            userAddress: wallet.address as `0x${string}`,
                            tokenAddress: coinContractAddress as string,
                            tokenSymbol: tokenOut.symbol,
                            tokenDecimal: tokenOut.decimals || 18,
                            amount: tradeData.coinsPurchased.toString(),
                            priceAtCreation: tokenOut.priceUsd.toString() || "0",
                            targetPrice: targetPrice?.toString() || "0",
                            targetChange: targetPercentage || 0,
                            direction: 'BUY',
                            orderType: 'DIRECT',
                            executedAt: new Date(),
                            executedPrice: tokenOut.priceUsd.toString() || "0",
                            aiInitiated: true,
                            notes: "",
                        });

                    } catch (error) {
                        console.log("Error creating order history:", error);
                        toast.error("Failed to save order details");
                    }
                }

                return serializedTradeDetails;
            }
        } catch (error) {
            console.log("Error buying coin:", error);
            toast.error("Error buying coin");
            return null;
        }
    }

    const createEarnyGridMessage = (): Message => {
        return {
            responseFrom: 'agent',
            response: [
                {
                    type: 'grid-options',
                    name: undefined, // selected option
                    text: JSON.stringify([
                        { name: 'get_balance', label: 'Check your token balances' },
                        // { name: 'token_analysis', label: 'Analyze crypto tokens for market details' },
                        // { name: 'swap_token', label: 'Swap between different tokens' },
                        // { name: 'send_token', label: 'Send ETH or tokens to other wallets' },
                        { name: 'reward_yaps', label: 'Reward Yaps' },
                        { name: 'auto_invest', label: 'Trade Memecoins' },
                    ]),
                },
            ],
        };
    };

    useEffect(() => {
        if (socketConnected) {
            const earnyMessage = createEarnyGridMessage();
            setMessages([earnyMessage]);
        }
    }, [socketConnected]);

    useEffect(() => {
        adjustTextareaHeight();
    }, [inputValue]);

    // useEffect(() => {
    //     const initialMessage = localStorage.getItem(`initialMessage ${resolvedParams.id}`);
    //     if (initialMessage) {
    //         setInitialMessage(initialMessage);
    //         setInputValue(initialMessage);
    //         // Clear the message from localStorage immediately
    //         localStorage.removeItem(`initialMessage ${resolvedParams.id}`);
    //     }
    // }, [resolvedParams.id]);

    // Separate useEffect for handling the initial message submission
    // useEffect(() => {
    //     if (initialMessage && userId && messages.length === 0 && socketConnected) {
    //         handleSubmit();
    //         setNeedToFetchChats(true);
    //         // Fetch chats
    //     }
    // }, [userId, messages.length, initialMessage, socketConnected, setNeedToFetchChats]);


    useEffect(() => {
        if (ready && authenticated && privyUser?.id) {
            const newUserId = privyUser?.id.split(':').pop() || privyUser?.id;
            // Only update if the userId has actually changed
            if (newUserId !== userId) {
                setUserId(newUserId);
            }

            setSelectedAccount(privyUser.wallet as unknown as Account);
            const wallets = privyUser?.linkedAccounts?.filter((acc) => acc.type === "wallet") as Wallet[];

            const wallet = wallets.find((wallet) => wallet.walletClientType === "privy");
            if (wallet) {
                setSelectedAccount(wallet as unknown as Account);
            }
        }
    }, [ready, authenticated, privyUser, userId]); // Remove setUserId from dependencies

    // useEffect(() => {
    //     const loadMessages = async () => {
    //         // Skip loading messages if we have an initialMessage (coming from dashboard)
    //         // if (initialMessage || !userId) return;
    //         if (!userId) return;

    //         setIsLoadingMessages(true);
    //         try {
    //             const response = await fetch(`/api/chat/${resolvedParams.id}/messages?userId=${userId}`);
    //             const data = await response.json();
    //             if (data.messages) {
    //                 console.log(data.messages, "data.messages")
    //                 setMessages(data.messages.map((msg: MessageResponse) => ({
    //                     responseFrom: msg.responseFrom,
    //                     tool_name: msg.toolName,
    //                     response: msg.content,
    //                     messageId: msg.id
    //                 })));
    //             }
    //         } catch (error) {
    //             console.log('Error loading messages:', error);
    //         } finally {
    //             setIsLoadingMessages(false);
    //         }
    //     };
    //     loadMessages();
    // }, [resolvedParams.id, userId]);

    const scrollToBottom = () => {
        if (leftSectionRef.current) {
            leftSectionRef.current.scrollTo({
                top: leftSectionRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
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
                if (data.response.includes("Follow the steps to invest.")) {
                    return;
                }
                formattedContent = data.response;
            } else {
                formattedContent = JSON.stringify(data.response);
            }
            console.log(formattedContent, "formattedContenttttttt")



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
    }, [userId, selectedAccount]);

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

    const handleSubmit = async (e?: React.FormEvent, messageOverride?: string) => {
        if (e) {
            e.preventDefault();
        }

        const inputValueNew = messageOverride || inputValue.trim();

        // Validate input before proceeding
        if (!inputValueNew || !userId || !socketConnected) {
            console.warn('Cannot submit: invalid input or missing requirements');
            return;
        }

        if (!messageOverride) {
            setInputValue('');
        }
        setIsLoading(true);

        // Add user message to chat
        const userMessage = { responseFrom: 'user', response: inputValueNew };
        setMessages((prev) => [...prev, userMessage]);

        try {
            // Send message via Socket.IO
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
    };


    const handleRetry = async (messageId: string) => {
        console.log("handleRetry called", messageId)

        // fetch the index of this messageId from the messages array
        const messageIndex = messages.findIndex(msg => msg.messageId === messageId)
        console.log("messageIndex", messageIndex)

        // trim the messages array to the messageIndex
        const trimmedMessages = messages.slice(0, messageIndex)
        console.log("trimmedMessages", trimmedMessages)

        // find the last user message in the trimmedMessages array
        const lastUserMessage = trimmedMessages.findLast(msg => msg.responseFrom === 'user')
        console.log("lastUserMessage", lastUserMessage)

        const inputValueNew = lastUserMessage?.response as string;

        // Add user message to chat
        const userMessage = { responseFrom: 'user', response: inputValueNew };
        setMessages((prev) => [...prev, userMessage]);

        // send the previous user message to the server
        const payload = {
            message: inputValueNew,
            userWalletAddress: selectedAccount?.address,
            chatId: resolvedParams.id,
        };
        console.log('Sending message via socket:', payload);
        socketRef.current?.emit('message', payload);

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

    const handleSwapConfirmationMsgStore = async (inputValueNew: string) => {
        // Add user message to chat
        const userMessage = { responseFrom: 'user', response: inputValueNew };
        if (inputValueNew === "OK, Got it!") {
            const newMessage = await createEarnyGridMessage();
            setMessages((prev) => [...prev, userMessage, newMessage]);
        } else {
            setMessages((prev) => [...prev, userMessage]);
        }

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

    const handleInvestmentConfirm = async (amount: number) => {
        setIsLoading(true);
        const amountFixed = amount.toFixed(2);
        const userMessageToSave = "Confirm";
        const aiMessageToSend = `Yes, $${amountFixed}`;

        // Add user message to chat UI
        const userMessage = { responseFrom: 'user', response: userMessageToSave };
        setMessages((prev) => [...prev, userMessage]);

        // Store user message in database
        try {
            await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: userMessageToSave,
                    responseFrom: 'user',
                    userId,
                }),
            });
        } catch (error) {
            console.log('Error storing user message:', error);
        }

        // Send message to AI
        try {
            const payload = {
                message: aiMessageToSend,
                userWalletAddress: selectedAccount?.address,
                chatId: resolvedParams.id,
            };

            if (socketRef.current?.connected) {
                console.log('Sending message to AI via socket:', payload);
                socketRef.current.emit('message', payload);
            } else {
                console.log('Socket is not connected');
            }
        } catch (error) {
            console.log('Socket send error:', error);
            setIsLoading(false);
        }
    }

    const handleInvestmentReturnConfirm = async (percentage: number) => {
        setIsLoading(true);
        const userMessageToSave = "Confirm";
        const aiMessageToSend = `${percentage}%`;

        // Add user message to chat UI
        const userMessage = { responseFrom: 'user', response: userMessageToSave };
        setMessages((prev) => [...prev, userMessage]);

        // Store user message in database
        try {
            await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: userMessageToSave,
                    responseFrom: 'user',
                    userId,
                }),
            });
        } catch (error) {
            console.log('Error storing user message:', error);
        }

        // Send message to AI
        try {
            const payload = {
                message: aiMessageToSend,
                userWalletAddress: selectedAccount?.address,
                chatId: resolvedParams.id,
            };

            if (socketRef.current?.connected) {
                console.log('Sending message to AI via socket:', payload);
                socketRef.current.emit('message', payload);
            } else {
                console.log('Socket is not connected');
            }
        } catch (error) {
            console.log('Socket send error:', error);
            setIsLoading(false);

        }

    }

    const handleInvestAmountSelection = async (option: string) => {
        setIsLoading(true);
        // update the message with the option
        // if (messageId) {
        //     await updateMessage(messageId, JSON.stringify({ data, metadata: option }));
        // }

        const userMessage = { responseFrom: 'user', response: option };
        setMessages((prev) => [...prev, userMessage]);

        // send this message to the server
        const payload = {
            message: option,
            userWalletAddress: selectedAccount?.address,
            chatId: resolvedParams.id,
        };
        socketRef.current?.emit('message', payload);
        // Store user message in database
        try {
            await fetch(`/api/chat/${resolvedParams.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: option,
                    responseFrom: 'user',
                    userId,
                }),
            });
            // Set needToFetchChats to true to trigger a refresh of the chat list
        } catch (error) {
            console.log('Error storing user message:', error);
        }
    }

    // const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    //     setInputValue(e.target.value);
    // };

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
        // setSwapProgressData({
        //     tokenInSymbol: data.tokenIn.symbol,
        //     tokenInAmount: data.amountIn,
        //     tokenInImage: data.tokenIn.image,
        //     tokenOutSymbol: data.tokenOut.symbol,
        //     tokenOutAmount: data.swapRoute.quote,
        //     tokenOutImage: data.tokenOut.image,
        //     tokenInDecimals: data.tokenIn.decimals,
        //     gasFee: data.swapRoute.gasCostUSD,
        //     state: swapProgressState,
        // });

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
                // Send message via Socket.IO
                try {
                    const payload = {
                        message: "check my updated wallet balance",
                        userWalletAddress: selectedAccount?.address,
                        chatId: resolvedParams.id,
                    };

                    if (socketRef.current?.connected) {
                        console.log('Sending message via socket:', payload);
                        socketRef.current.emit('message', payload);
                    } else {
                        console.log('Socket is not connected');
                        console.log('Not connected to server. Please refresh the page.');
                    }
                } catch (error) {
                    console.log('Socket send error:', error);
                    console.log('Failed to send message. Please try again.');
                    setIsLoading(false);
                }

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
            setShowActivity(false);
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
        } finally {
            setShowActivity(false);
            // setSwapProgressData({
            //     tokenInSymbol: '',
            //     tokenInAmount: '',
            //     tokenInImage: '',
            //     tokenOutSymbol: '',
            //     tokenOutAmount: '',
            //     tokenOutImage: '',
            //     tokenInDecimals: 18,
            //     gasFee: '',
            //     state: '',
            // });
            setSwapProgressState('');
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


    // const walletTypeLabel = (wallet: Wallet) => {
    //     if (wallet.connectorType === 'embedded' || wallet.connectorType === 'privy') return 'Earny Wallet';
    //     return (wallet.walletClientType || wallet.connectorType || "").toLowerCase() || 'Wallet';
    // };

    // const walletIcon = (wallet: Wallet) => {
    //     if (wallet.connectorType === 'embedded') return <Icons.sidebarWalletIcon className="w-4 h-4" />;
    //     const iconName = (wallet.walletClientType || wallet.connectorType || "").toLowerCase();
    //     // Only allow certain names (add more as needed)
    //     const knownIcons = ["metamask", "phantom", "rainbow", "coinbase", "walletconnect"];
    //     if (knownIcons.includes(iconName)) {
    //         return (
    //             <Image
    //                 src={`/images/wallet-icons/${iconName}.svg`}
    //                 alt={iconName + " icon"}
    //                 width={24}
    //                 height={24}
    //                 className="rounded-full"
    //                 onError={(e) => { e.currentTarget.style.display = 'none'; }}
    //             />
    //         );
    //     }
    //     return <Icons.sidebarWalletIcon className="w-6 h-6" />;
    // };

    // const handleWalletChange = (walletAddress: string) => {
    //     const wallet = privyWallets.find((wallet) => wallet.address === walletAddress);
    //     if (wallet) {
    //         setSelectedAccount(wallet as unknown as Account);
    //         setActiveWallet(wallet);
    //         setSelectedWallet(wallet as unknown as Wallet);
    //     }
    // };

    return (
        <div className="flex min-h-[calc(100vh-40px)] h-[calc(100vh-40px)] font-funnel-sans relative bg-black rounded-[56px] overflow-hidden">
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
            <section ref={leftSectionRef} className={`${showActivity ? 'w-2/3 border-r border-black/10' : 'w-full max-w-4xl mx-auto'} px-[40px] my-[20px] pb-[100px] overflow-y-auto relative ease-in-out transition-all duration-500 text-white`}>
                <div className="flex flex-col gap-4 justify-between">

                    <div className="flex-1 h-full text-white relative">
                        <div className="sticky top-0 left-0 flex items-center gap-2 justify-center bg-black pb-2">
                            <Icons.earnySmallGrayIcon className="w-6 h-6 text-white/40" />
                            <span className="text-[24px] font-funnel-display text-white font-medium">Agent</span>
                        </div>
                        {/* {isLoadingMessages ? (
                            <div className="flex items-center gap-2 text-gray-600 p-4">
                                <div className="animate-spin h-4 w-4 border-2 border-gray-600 border-t-transparent rounded-full"></div>
                                <span>Loading messages...</span>
                            </div>
                        ) : ( */}
                        <div className="pt-10 md:pt-6 space-y-6">
                            {messages.length > 0 && messages.map((message, index) => {
                                if (message.responseFrom === 'user') {
                                    return (
                                        <div key={index} className="flex justify-end my-2">
                                            <div className="bg-user-message-bg text-white rounded-full px-4 py-2 max-w-[80%]">
                                                {message.response as string}
                                            </div>
                                        </div>
                                    );
                                }


                                if (message.responseFrom === 'agent' && Array.isArray(message.response) && message.response[0]?.type === 'grid-options') {
                                    const options = JSON.parse(message.response[0].text || '[]');
                                    return (
                                        <GridIntroMessage key={index} options={options} handleSubmit={handleSubmit} setCurrentActivity={setCurrentActivity} />
                                    )
                                }
                                if (message.responseFrom === 'agent' && typeof message.response === 'string' && (message.response).includes("I can help you with:")) {

                                    return (
                                        <div
                                            key={index}
                                            className="flex justify-start my-2"
                                        >
                                            <div className="max-w-[80%] p-2 font-funnel-sans text-white/80 font-normal">
                                                {message.response}
                                            </div>
                                        </div>
                                    );
                                }


                                if (message.responseFrom === 'agent' && typeof message.response === 'string' && (message.response).includes("Sure! I need to know how much you'd like to invest. Could you please select an amount?")) {

                                    return (
                                        <div
                                            key={index}
                                            className="flex justify-start my-2 flex-col gap-2"
                                        >
                                            <div className="max-w-[80%] p-2 font-funnel-sans text-white/80 font-normal">
                                                {message.response}
                                            </div>
                                            <div className="max-w-[80%] px-2">
                                                <MagneticSlider onConfirm={handleInvestmentConfirm} setCurrentActivity={setCurrentActivity} />
                                            </div>
                                        </div>
                                    );
                                }

                                if (message.responseFrom === 'agent' && typeof message.response === 'string' && (message.response).includes("Please select how much you'd like to earn as your return on investment?")) {
                                    return (
                                        <div
                                            key={index}
                                            className="flex justify-start my-2 flex-col gap-2"
                                        >
                                            <div className="max-w-[80%] p-2 font-funnel-sans text-white/80 font-normal">
                                                {message.response}
                                            </div>
                                            <div className="max-w-[80%] px-2">
                                                <RiskAndReturnOnInvestment onConfirm={handleInvestmentReturnConfirm} />
                                            </div>
                                        </div>
                                    );
                                }
                                if (message.responseFrom === 'agent' && typeof message.response === 'string' && message.response.includes("returnPercentage")) {

                                    const data = JSON.parse(message.response) as InvestMemeCoinResponse;
                                    return (
                                        <div
                                            key={index}
                                            className="flex justify-start my-2 flex-col gap-2"
                                        >
                                            <div className="max-w-[80%] p-2 font-funnel-sans text-white/80 font-normal space-y-3">
                                                <p className='text-md text-white/80'>{data.returnPercentage}% of ${data.amount} is ${data.targetReturn}</p>
                                                <p className='text-md text-white/80'>Target Return: <span className='text-white font-bold'>${data.targetReturn}</span></p>
                                                <p className='text-md text-white/80'>Risk Level: <span className='text-white font-bold'>{data.riskLevel}%</span></p>
                                            </div>
                                            <div className="max-w-[80%] px-2 flex items-center gap-6 mt-4">
                                                {/* <RiskAndReturnOnInvestment onConfirm={handleReturnConfirm} /> */}
                                                <button
                                                    onClick={() => handleInvestConfirm(false)}
                                                    className="max-w-max rounded-full bg-secondary-red px-[16px] py-1.5 text-md font-medium font-funnel-sans text-black">
                                                    Deny
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        handleMessageSend()
                                                        handleInvestConfirm(true, data.amount.toString(), message.messageId, data.returnPercentage.toString(), Number(data.returnPercentage))
                                                    }}
                                                    className="max-w-max rounded-full bg-secondary-green px-[16px] py-1.5 text-md font-medium font-funnel-sans text-black">
                                                    Confirm
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }
                                if (message.responseFrom === 'agent' && typeof message.response === 'string' && (message.response).includes("How much amount would you like to invest?")) {
                                    // Render agent messages in chat only
                                    return (
                                        <div
                                            key={index}
                                            className="flex justify-start my-2"
                                        >
                                            <div className="max-w-[80%] p-2 font-funnel-sans text-white/80 font-normal">
                                                {message.response}
                                                <div className="flex items-center gap-3 mt-4">
                                                    <button
                                                        onClick={() => {
                                                            handleInvestAmountSelection("$0.50 worth of ETH")
                                                        }}
                                                        className={`flex items-center text-sm gap-2 px-2 py-1 rounded-full border transition-all ${message.metadata === "$0.50 worth of ETH"
                                                            ? "border-blue-500 bg-blue-50 shadow-sm"
                                                            : "border-gray-200 hover:border-blue-500 text-gray-700"
                                                            }`}
                                                        disabled={message.metadata === "$0.50 worth of ETH"}
                                                    >
                                                        $0.50 worth of ETH
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            handleInvestAmountSelection("$1 worth of ETH")
                                                        }}
                                                        className={`flex items-center text-sm gap-2 px-2 py-1 rounded-full border transition-all ${message.metadata === "$1 worth of ETH"
                                                            ? "border-blue-500 bg-blue-50 shadow-sm"
                                                            : "border-gray-200 hover:border-blue-500 text-gray-700"
                                                            }`}
                                                    >
                                                        $1 worth of ETH
                                                    </button>
                                                </div>

                                            </div>
                                        </div>
                                    );
                                }
                                if (message.responseFrom === 'agent' && typeof message.response === 'string' && (message.response).includes("Which memecoin would you like to trade?")) {
                                    // Render agent messages in chat only
                                    return (
                                        <div
                                            key={index}
                                            className="flex justify-start my-2"
                                        >
                                            <div className="max-w-[80%] p-2 font-funnel-sans text-white/80 font-normal">
                                                {message.response}
                                                <div className="flex items-center gap-3 mt-4">
                                                    <button
                                                        onClick={() => {
                                                            handleInvestAmountSelection("Zora")
                                                        }}
                                                        className={`flex items-center text-sm gap-2 px-2 py-1 rounded-full border transition-all ${message.metadata === "Zora"
                                                            ? "border-blue-500 bg-blue-50 shadow-sm"
                                                            : "border-gray-200 hover:border-blue-500 text-gray-700"
                                                            }`}
                                                        disabled={message.metadata === "Zora"}
                                                    >
                                                        Zora
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            handleInvestAmountSelection("Clanker")
                                                        }}
                                                        className={`flex items-center text-sm gap-2 px-2 py-1 rounded-full border transition-all ${message.metadata === "Clanker"
                                                            ? "border-blue-500 bg-blue-50 shadow-sm"
                                                            : "border-gray-200 hover:border-blue-500 text-gray-700"
                                                            }`}
                                                    >
                                                        Clanker
                                                    </button>
                                                </div>

                                            </div>
                                        </div>
                                    );
                                }
                                if (message.responseFrom === 'agent' || (message.responseFrom !== 'tools' && !message.tool_name)) {
                                    return (
                                        <div
                                            key={index}
                                            className="flex justify-start my-2"
                                        >
                                            <div className="max-w-[80%] p-2 font-funnel-sans text-white/80 font-normal">
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
                                    )
                                }


                                // Render tool responses

                                if (message.tool_name === 'trade_history') {
                                    try {
                                        const data: TradeHistoryProps = JSON.parse(message.response as string);
                                        return (
                                            <div key={index} className="mb-6">
                                                <TradeHistory trades={data.trades} onSubmit={() => handleSwapConfirmationMsgStore("OK, Got it!")} />
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
                                                <TokenInvest
                                                    data={data}
                                                    updateMessage={updateMessage}
                                                    messageId={message.messageId}
                                                    userAddress={selectedAccount?.address as `0x${string}`}
                                                    onDeny={() => handleSwapConfirmationMsgStore('Deny')}
                                                    handleRetry={() => handleRetry(message.messageId || "")}
                                                />
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

                                if (message.tool_name === 'invest_in_clanker_token') {
                                    try {
                                        console.log(message, 'message.response');
                                        const data: InvestInClankerTokenResponse = JSON.parse(message.response as string);
                                        return (
                                            <div key={index} className="mb-6">
                                                <InvestInClankerToken
                                                    data={data}
                                                    updateMessage={updateMessage}
                                                    messageId={message.messageId}
                                                    userAddress={selectedAccount?.address as `0x${string}`}
                                                    onDeny={() => handleSwapConfirmationMsgStore('Deny')}
                                                    handleRetry={() => handleRetry(message.messageId || "")}
                                                />
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

                                if (message.tool_name === 'bridge_token') {
                                    try {
                                        console.log(message, 'message.response');
                                        const data: BridgeTokenProps = JSON.parse(message.response as string);
                                        return (
                                            <div key={index} className="mb-6">
                                                <BridgeToken
                                                    tokenFrom={data.tokenFrom}
                                                    tokenFromDecimals={data.tokenFromDecimals}
                                                    tokenTo={data.tokenTo}
                                                    amount={data.amount}
                                                    fromChain={data.fromChain}
                                                    toChain={data.toChain}
                                                    userAddress={selectedAccount?.address as `0x${string}`}
                                                />
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

                                if (message.tool_name === 'send_token') {
                                    try {
                                        const data: SendTokenResponse = JSON.parse(message.response as string);
                                        return (
                                            <div key={index} className="mb-6">
                                                <SendToken
                                                    data={data}
                                                    userAddress={selectedAccount?.address as `0x${string}`}
                                                    onDeny={() => handleSwapConfirmationMsgStore('Deny')}
                                                    updateMessage={updateMessage}
                                                    messageId={message.messageId}
                                                />
                                            </div>
                                        );
                                    } catch (error) {
                                        console.log(error, 'error');
                                        return (
                                            <div key={index} className="mb-6">
                                                <div className="bg-red-50 rounded-lg shadow-sm border border-red-100 p-4 max-w-max">
                                                    <div className="flex items-center gap-2 text-red-600">
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <circle cx="12" cy="12" r="10" />
                                                            <line x1="12" y1="8" x2="12" y2="12" />
                                                            <line x1="12" y1="16" x2="12" y2="16" />
                                                        </svg>
                                                        <span className="font-semibold">Invalid Send Token Data</span>
                                                    </div>
                                                    <p className="mt-2 text-sm text-red-600">Failed to process send token information. Please try again.</p>
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

                        </div>
                        {/* )
                        } */}

                    </div>

                    {/* <div className="w-[80%] mx-auto self-end">
                        <form
                            onSubmit={handleSubmit}
                            className="bg-transparent rounded-3xl p-1 border-2 border-black/10 mb-2"
                        >
                            <textarea
                                ref={textareaRef}
                                value={inputValue}
                                onChange={handleInputChange}
                                placeholder="Ask Earny"
                                className="w-full max-w-full max-h-[100px] overflow-y-auto resize-none p-2 px-4 bg-transparent rounded-lg border-none focus:outline-none focus:border-none font-funnel-sans text-white/80 font-semibold max-h-[100px]"
                                disabled={isLoading}
                                rows={1}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                            />
                            <div className="flex items-center justify-between border-none bg-transparent px-2 py-1">
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                        <button
                                            type="button"
                                            className="flex items-center gap-1 px-2 py-1 rounded-full border border-black/10 bg-white shadow-sm hover:shadow-md transition-all min-w-[120px]"
                                        >
                                            {selectedWallet ? (
                                                <>
                                                    {walletIcon(selectedWallet)}
                                                    <span className="font-funnel-sans font-medium text-xs  text-white/80">{selectedWallet.address?.slice(0, 6)}...{selectedWallet.address?.slice(-4)}</span>
                                                </>
                                            ) : (
                                                <span className="font-funnel-sans font-medium text-xs  text-white/80">connecting...</span>
                                            )}
                                            <svg className="w-4 h-4 ml-1 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                                        </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content sideOffset={8} align="start" className="mt-2 w-[320px] bg-white rounded-xl shadow-lg border border-black/10 z-50">
                                        <div className="p-2 text-xs text-gray-700 font-semibold border-b">Select account to use for executing transactions</div>
                                        {wallets.length > 0 && wallets.map((wallet) => (
                                            <DropdownMenu.Item
                                                key={wallet.address}
                                                className={`flex items-center w-full px-4 py-3 gap-3 hover:bg-gray-50 transition-all cursor-pointer ${selectedWallet?.address === wallet.address ? 'bg-gray-100' : ''}`}
                                                onSelect={() => {

                                                    handleWalletChange(wallet.address)

                                                }}
                                            >
                                                {walletIcon(wallet)}
                                                <div className="flex flex-col flex-1 text-left">
                                                    <span className="font-mono text-sm text-black/90">{wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}</span>
                                                    <span className="text-xs text-gray-500">{walletTypeLabel(wallet)}</span>
                                                </div>
                                                {selectedWallet?.address === wallet.address && (
                                                    <svg className="w-5 h-5 text-blue-500 ml-2" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                                )}
                                            </DropdownMenu.Item>
                                        ))}
                                    </DropdownMenu.Content>
                                </DropdownMenu.Root>
                                <button
                                    type="submit"
                                    className="p-2 bg-black/80 rounded-full disabled:opacity-50"
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
                        <div className="w-full text-center text-xs text-black/40 font-funnel-sans my-1">
                            <span>Earny can make mistakes. Check important info.</span>
                        </div>
                    </div> */}
                </div>
                <div ref={messagesEndRef} />
            </section >

            {/* Right side - Tool Activity states */}

            <section className={`${showActivity ? 'hidden md:flex w-1/3 overflow-y-auto translate-x-0' : 'translate-x-full w-0 opacity-0 overflow-hidden'} px-[40px] py-[20px] border-l border-white/10 transition-all duration-500 flex justify-start items-center flex-col relative activity-bg`
            }>
                <div className="flex items-center gap-2 justify-center mb-8">
                    <Icons.earnySmallGrayIcon className="w-6 h-6 text-white/40" />
                    <span className="text-[24px] font-funnel-display text-white font-medium">Activity</span>
                </div>

                <div className="w-full flex justify-start items-start">
                    {/* {showActivity && swapProgressData && swapProgressState ?
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
                        messages.find(msg => msg.tool_name === 'invest_token') ? (
                            <TokenInvestProgress state={messages.find((msg: Message) => msg.tool_name === 'invest_token')?.state || ['researching']} />
                        ) : (
                            <div className="w-[80%] text-center font-funnel-sans text-white/40">
                                <p>No Activity yet</p>
                            </div>
                        )
                    } */}
                    {currentActivity && currentActivity !== "investing" && <span className='text-white/40 text-sm italic font-funnel-sans'>{currentActivity}</span>}
                    {currentActivity && currentActivity === "investing" && <AgentActivity steps={activitySteps} />}

                </div>
            </section >


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