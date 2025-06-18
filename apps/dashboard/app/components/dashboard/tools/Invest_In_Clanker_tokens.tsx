import { getPublicClient } from '@/lib/web3';
import { Address, parseUnits, zeroAddress } from 'viem';


import { useEffect, useState } from 'react';
import { usePrivy, useSendTransaction, useWallets } from '@privy-io/react-auth';
import { LoadingButton } from '../../ui/button.loader';
import { Icons } from '../../sections/icons';
import { toast } from 'sonner';
import Link from 'next/link';
import Image from 'next/image';
import { getTokenMetadataWithCoingecko, TokenMetadata } from '@/actions/web3';
import { createLimitOrder, createOrderHistory } from '@/actions/order';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { ethers } from 'ethers';
import { showTransactionToast } from '@/lib/toast';

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

interface Token {
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
}

export interface InvestInClankerTokenResponse {
    tokens: Token[];
    metadata: {
        count: number;
        riskLevel: string;
        investmentAmount: number;
        timestamp: string;
    };
    selectedToken?: `0x${string}`;
    tradeDetails?: TradeResult;
}

// interface TradeEventArgs {
//     amountFee: bigint;
//     amountSold: bigint;
//     buyer: `0x${string}`;
//     coinsPurchased: bigint;
//     currency: `0x${string}`;
//     recipient: `0x${string}`;
//     tradeReferrer: `0x${string}`;
// }

export type SellEventArgs = {
    seller: `0x${string}`;
    recipient: `0x${string}`;
    tradeReferrer: `0x${string}`;
    coinsSold: bigint;
    currency: `0x${string}`;
    amountFee: bigint;
    amountPurchased: bigint;
}

export type BuyEventArgs = {
    buyer: `0x${string}`;
    recipient: `0x${string}`;
    tradeReferrer: `0x${string}`;
    coinsPurchased: bigint;
    currency: `0x${string}`;
    amountFee: bigint;
    amountSold: bigint;
}

export type TradeEventArgs = BuyEventArgs | SellEventArgs;

export interface TradeResult {
    hash: `0x${string}`;
    trade?: TradeEventArgs;
    tokenOutDetails?: TokenMetadata;
    tokenInDetails?: TokenMetadata;
}

export type TokenInvestState = '' | 'researching' | 'researched' | 'executing' | 'executed' | 'recordkeeping' | 'completed' | 'exerror' | 'recorderror' | 'researcherror';

export interface InvestInClankerTokenProps {
    data: InvestInClankerTokenResponse;
    userAddress?: `0x${string}`;
    onDeny: () => void;
    updateMessage: (messageId: string, content: string) => void;
    messageId?: string;
    handleRetry: () => void;
}

export default function InvestInClankerToken({ data, onDeny, messageId, updateMessage, userAddress, handleRetry }: InvestInClankerTokenProps) {
    const [selectedToken, setSelectedToken] = useState<Address | null>(null);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [tradeDetails, setTradeDetails] = useState<TradeResult | null>(null);
    const [tokenInDetails, setTokenInDetails] = useState<TokenMetadata | null>(null);
    const [tokenOutDetails, setTokenOutDetails] = useState<TokenMetadata | null>(null);
    const [state, setState] = useState<TokenInvestState[]>(['researching']);
    const [topTokens, setTopTokens] = useState<Token[]>([]);
    const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
    const [targetPrice, setTargetPrice] = useState<number | null>(null);
    const [targetPercentage, setTargetPercentage] = useState<number>(10);
    const [userId, setUserId] = useState<string | null>(null);
    const [currentTokenOutPrice, setCurrentTokenOutPrice] = useState<number>(0);
    const [initialTokenOutPrice, setInitialTokenOutPrice] = useState<number>(0);
    const { wallets } = useWallets();
    // const { wallet: activeWallet } = useActiveWallet();
    const { ready, authenticated, user: privyUser } = usePrivy();
    const { sendTransaction } = useSendTransaction();
    // find wallet from wallets array that has the same address as activeWallet
    const wallet = wallets.find((wallet) => wallet.walletClientType === "privy") || wallets[0];

    useEffect(() => {
        if (ready && authenticated && privyUser?.id) {
            const userId = privyUser?.id.split(':').pop() || privyUser?.id;
            setUserId(userId);
        }
    }, [ready, authenticated, privyUser]);

    useEffect(() => {
        if (data) {
            // If we have recommendations, update the state and tokens immediately
            if (data.tokens && data.tokens.length > 0) {
                setTopTokens([...data.tokens]);
                // Force transition to researched state
                setState(['researching', 'researched']);
            } else {
                // If no recommendations, mark research as complete but with no results
                setTopTokens([]);
                setState(['researching', 'researched']);
            }

            // If we have a selected token and trade details, update the state accordingly
            if (data.selectedToken && data.tradeDetails) {
                setSelectedToken(data.selectedToken as Address);
                setState(['researching', 'researched', 'executing', 'executed', 'recordkeeping', 'completed']);
                setTxHash(data.tradeDetails?.hash as `0x${string}`);
                setTradeDetails(data.tradeDetails as TradeResult);
                setTokenInDetails(data.tradeDetails?.tokenInDetails as TokenMetadata);
                setTokenOutDetails(data.tradeDetails?.tokenOutDetails as TokenMetadata);
            }

            // Update the message with the current state
            if (messageId) {
                updateMessage(messageId, JSON.stringify({
                    ...data,
                    state: state
                }));
            }
        }
    }, [data, messageId, updateMessage]);

    useEffect(() => {
        if (messageId) {
            console.log("messageId", messageId)
        }
    }, [messageId]);

    // Add a separate effect to handle initial loading state
    useEffect(() => {
        if (!data) {
            setState(['researching']);
        }
    }, [data]);

    useEffect(() => {
        if (selectedToken) {
            setInitialTokenOutPrice(tokenOutDetails?.priceUsd || 0);
            const fetchCurrentTokenOut = async () => {
                if (selectedToken) {
                    const currentTokenOut = await fetchTokenDetails(selectedToken as Address);
                    setCurrentTokenOutPrice(currentTokenOut.priceUsd || 0);
                }
            };
            fetchCurrentTokenOut();

            // Set up interval to fetch price updates every 30 seconds
            const intervalId = setInterval(fetchCurrentTokenOut, 30000);

            return () => clearInterval(intervalId);
        }
    }, [selectedToken, tokenOutDetails]);

    // fetch the token details using getTokenMetadataWithCoingecko by passing the token address
    const fetchTokenDetails = async (tokenAddress: Address) => {
        const tokenDetails = await getTokenMetadataWithCoingecko(tokenAddress);
        console.log(tokenDetails, 'token details');
        return tokenDetails;
    }

    const publicClient = getPublicClient("base");

    // Define buy parameters
    const buyCoin = async (
        coinContractAddress: Address,
        orderSize: number,
    ) => {

        if (!userId) {
            console.error("No user ID found");
            toast.error("Please connect your wallet first");
            return;
        }

        setState([...state, 'executing']);
        console.log("buyCoin", coinContractAddress, orderSize);
        setLoadingAction("buy");
        // const provider = wallet ? await wallet.getEthereumProvider() : null;
        // console.log(provider, 'provider inside the buy coin')
        // console.log(wallet, 'wallet inside the buy coin')
        // if (!provider) {
        //     console.log("No provider found");
        //     toast.error("Please connect your wallet first");
        //     return;
        // }
        // const walletClient = createWalletClient({
        //     account: wallet.address as Hex,
        //     chain: base,
        //     transport: custom(provider),
        // });
        // console.log(walletClient, 'walletClient inside the buy coin')
        try {
            // have selected token details
            const decimalsOut = data.tokens.find((token) => token.attributes.address === coinContractAddress)?.attributes.decimals || 18;

            const amountSold = parseUnits(orderSize.toString(), 18).toString();
            const swapRouteResponse = await fetch(
                "https://swap-data-api-psi.vercel.app/swap-route",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        userAddress: userAddress,
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
                    args: [userAddress as `0x${string}`, swapRouteData.methodParameters.to as `0x${string}`],
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
                        console.log('Error approving token:', error);
                        showTransactionToast({
                            title: 'Error approving token',
                            description: 'Please try again',
                            type: 'error',
                        });
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
                    setState([...state, 'executing', 'executed', 'recordkeeping']);
                    data.selectedToken = selectedToken as `0x${string}`;

                    const tokenIn = await fetchTokenDetails("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
                    const tokenOutDetails = data.tokens.find((token) => token.attributes.address === coinContractAddress);
                    console.log(tokenOutDetails, 'tokenOutDetails')
                    const tokenOut = {
                        imageUrl: tokenOutDetails?.attributes.image_url || "",
                        name: tokenOutDetails?.attributes.name || "",
                        symbol: tokenOutDetails?.attributes.symbol || "",
                        decimals: tokenOutDetails?.attributes.decimals || 18,
                        priceUsd: Number(tokenOutDetails?.price_usd) || 0,
                    };
                    setTokenInDetails(tokenIn);
                    setTokenOutDetails(tokenOut);

                    const serializedTrade = {
                        amountFee: "0",
                        amountSold: amountSold,
                        coinsPurchased: swapRouteData.quote,
                        currency: "0x4200000000000000000000000000000000000006",
                        buyer: userAddress,
                        recipient: userAddress,
                        tradeReferrer: zeroAddress,
                    }
                    const coinPurchase = parseUnits(swapRouteData.quote, decimalsOut).toString();

                    const tradeData = {
                        amountFee: BigInt(0),
                        amountSold: BigInt(amountSold || 0),
                        coinsPurchased: BigInt(coinPurchase || 0),
                        currency: "0x4200000000000000000000000000000000000006" as `0x${string}`,
                        buyer: userAddress as `0x${string}`,
                        recipient: userAddress as `0x${string}`,
                        tradeReferrer: zeroAddress,
                    };

                    const serializedTradeDetails = {
                        hash: hash,
                        trade: serializedTrade,
                        tokenInDetails: tokenIn,
                        tokenOutDetails: tokenOut
                    };

                    console.log({
                        ...data,
                        tradeDetails: serializedTradeDetails
                    }, 'updating the message content')

                    updateMessage(messageId!, JSON.stringify({
                        ...data,
                        tradeDetails: serializedTradeDetails
                    }));
                    setTxHash(hash);
                    setTradeDetails({
                        hash: hash,
                        trade: tradeData,
                        tokenInDetails: tokenIn,
                        tokenOutDetails: tokenOut
                    });
                    if (targetPrice && targetPrice > 0) {
                        try {
                            // Store order details in database
                            // need to add token decimals
                            await createLimitOrder({
                                userId: userId,
                                userAddress: wallet.address as `0x${string}`,
                                tokenAddress: selectedToken as string,
                                tokenSymbol: tokenOut.symbol,
                                tokenDecimal: tokenOut.decimals || 18,
                                amount: tradeData.coinsPurchased.toString(),
                                priceAtCreation: tokenOut.priceUsd.toString() || "0",
                                targetPrice: targetPrice.toString() || "0",
                                targetChange: targetPercentage || 0,
                                direction: 'SELL',
                                orderType: 'LIMIT',
                                aiInitiated: true,
                                notes: `${messageId}`,
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
                            tokenAddress: selectedToken as string,
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
                            notes: `${messageId}`,
                        });

                    } catch (error) {
                        console.log("Error creating order history:", error);
                        toast.error("Failed to save order details");
                    }
                }

                setState([...state, 'executing', 'executed']);
                return "0x097bsgsh";
            }
        } catch (error) {
            console.log("Error buying coin:", error);
            toast.error("Error buying coin");
            return null;
        } finally {
            setLoadingAction(null);
            setState([...state, 'executing', 'executed', 'recordkeeping', 'completed']);
        }
    }



    // if (tradeResult) {
    //     return (
    //         <div className="space-y-4 px-2 max-w-[80%]">
    //             <div className="bg-green-50 border border-green-200 rounded-xl p-4">
    //                 <h3 className="text-green-800 font-medium mb-2">Transaction Completed</h3>
    //                 <p className="text-sm text-green-600 break-all mb-4">{tradeResult.hash}</p>


    //             </div>
    //         </div>
    //     );
    // }


    const StateCircle = ({ step, number }: { step: string, number?: number }) => {
        const isMarketStep = step === 'market';
        const isOrderStep = step === 'order';
        const isRecordStep = step === 'record';

        const showSpinner = (isMarketStep && state.includes('researching') && !state.includes('researcherror') && !state.includes('researched')) ||
            (isOrderStep && state.includes('executing') && !state.includes('exerror') && !state.includes('executed')) ||
            (isRecordStep && state.includes('recordkeeping') && !state.includes('recorderror') && !state.includes('completed'));

        // If we have swapHash in data, all steps should show check
        const showCheck =
            (isMarketStep && state.includes('researched')) ||
            (isOrderStep && state.includes('executed')) ||
            (isRecordStep && state.includes('completed'));

        const showError = isMarketStep && state.includes('researcherror') ||
            isOrderStep && state.includes('exerror') ||
            isRecordStep && state.includes('recorderror');

        return (
            <div
                className={`w-[26px] h-[26px] rounded-full flex items-center justify-center relative z-10 
                    ${showCheck || showSpinner ? 'bg-secondary-green' : 'bg-white border border-2 border-black/40'}
                    transition-all duration-300 ease-in-out`}
            >
                {showSpinner ? (
                    <div className="w-[50%] h-[50%] m-1 p-[2px] aspect-square rounded-full bg-white custom-mask animate-spin"></div>
                ) : showCheck ? (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : showError ? (
                    <div className="bg-secondary-red text-xs font-medium ">!</div>
                ) : (
                    <div className="text-black/40 text-sm font-bold ">{number}</div>
                )}
            </div>
        );
    };

    const handleTargetPriceChange = (value: number) => {
        const targetPrice = value / 100 * currentTokenOutPrice;
        console.log(targetPrice + currentTokenOutPrice, 'targetPrice');
        setTargetPrice(targetPrice + currentTokenOutPrice);
    };



    return (
        <div className="space-y-4 px-2 max-w-[80%]" >

            <div className="max-w-[80%] rounded-xl overflow-hidden font-funnel-sans border border-black/10">
                {/* Header */}
                <div className="px-6 py-3 bg-black/4 font-funnel-sans text-black/80 text-lg border-b border-black/10">
                    <div className="flex items-center gap-2">
                        <Icons.clankerIcon className='w-6 h-6 mr-0.5' />
                        <span className="font-semibold font-funnel-sans text-lg">Trader on Clanker</span>
                    </div>
                </div>

                {/* Progress Steps */}
                <div className="relative m-6" >
                    {/* Vertical Line */}
                    <div className="absolute left-[12px] h-full top-[0%] bottom-[32px] w-[2px] bg-black/40">
                        <div
                            className={`h-full bg-[#22C55E] transition-all duration-500 ease-in-out`}
                            style={{
                                height: state.includes('completed') || state.includes('recordkeeping') ? '100%' : state.includes('researched') ? '50%' : '0%'
                            }}
                        />
                    </div>

                    <div className='space-y-5'>
                        {/* Approve Step */}
                        <div className="flex items-center gap-3 relative z-10">
                            <StateCircle step="market" number={1} />
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <Icons.blueSearchIcon className='w-6 h-6' />
                                    <span className="text-md text-black/80 font-funnel-sans">Market Analysis</span>

                                </div>
                            </div>
                        </div>

                        {/* Execute Swap Step */}
                        <div className="flex items-center gap-3 relative z-10">
                            <StateCircle step="order" number={2} />
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <Icons.orangeTickIcon className='w-6 h-6' />
                                    <span className="text-md text-black/80">Order Execution</span>
                                </div>
                            </div>
                        </div>

                        {/* Update Balance Step */}
                        <div className="flex items-center gap-3 relative z-10">
                            <StateCircle step="record" number={3} />
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <Icons.purpleStackIcon className='w-6 h-6' />
                                    <span className="text-md text-black/80">Record Keeping</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
            {!txHash && state.length > 0 && state.includes('researched') && topTokens.length > 0 ? <>
                <p className='text-black/80 font-funnel-sans font-normal'>Select a token to invest in</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {topTokens.map((token) => (
                        <div
                            key={token.id}
                            className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedToken === token.attributes.address
                                ? 'border-blue-500 bg-blue-50 shadow-sm'
                                : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
                                }`}
                            onClick={() => setSelectedToken(token.attributes.address as Address)}
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center space-x-3">
                                    <div className="w-6 h-6 rounded-full flex items-center justify-center">
                                        {token.attributes?.image_url ? <Image src={token.attributes.image_url} className='rounded-full object-fit border border-black/10 min-w-[32px] min-h-[32px]' width={32} height={32} alt={token.attributes.name} /> : <Icons.basetokenImage className="" />}
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-900">{token.attributes.name}</h3>
                                        <p className="text-xs text-gray-500">{token.attributes.symbol}</p>
                                    </div>
                                </div>

                                {token.attributes.address && (
                                    <div className="flex items-center justify-center">
                                        <a
                                            href={`https://basescan.org/token/${token.attributes.address}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            type="button"
                                            onClick={e => e.stopPropagation()}
                                            className="inline-flex items-center gap-2 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                                        >
                                            View on Explorer
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                )}

                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-gray-50 rounded-lg p-2">
                                    <p className="text-gray-500">24h</p>
                                    <p className={`font-medium ${Number(token.price_change_percentage?.changes?.h24) > 0 ? 'text-green-500' : 'text-red-500'}`}>{Number(token.price_change_percentage?.changes?.h24).toFixed(2)}%</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                    <p className="text-gray-500">6h</p>
                                    <p className={`font-medium ${Number(token.price_change_percentage?.changes?.h6) > 0 ? 'text-green-500' : 'text-red-500'}`}>{Number(token.price_change_percentage?.changes?.h6).toFixed(2)}%</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                    <p className="text-gray-500">Market Cap</p>
                                    <p className="font-medium">${Number(token.market_cap).toLocaleString()}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                    <p className="text-gray-500">24h Volume</p>
                                    <p className="font-medium">${Number(token.volume).toLocaleString()}</p>
                                </div>

                            </div>
                        </div>
                    ))}
                </div>
            </> : <></>
            }

            {
                !txHash && state.length > 0 && state.includes('researched') && topTokens.length === 0 && (
                    <div className="space-y-4 mt-4">
                        <p className="font-normal text-gray-500">No tokens found, please try again</p>
                        <button
                            className="px-2 py-1 text-sm flex items-center gap-1 border border-black/40 text-black/40 hover:text-black/80 hover:border-black/80 rounded-full transition-colors"
                            onClick={handleRetry}
                        >
                            <RotateCcw className="w-4 h-4" />
                            Retry
                        </button>
                    </div>
                )
            }

            {
                selectedToken && !txHash && (
                    <div className="space-y-4 mt-4">
                        <div className="space-y-2">
                            <p className="font-normal text-gray-500">Token Price</p>
                            <div className="flex items-center gap-2">
                                <span className="text-md">${currentTokenOutPrice ? currentTokenOutPrice.toFixed(5) : '0.00'}</span>
                            </div>
                            {/* {targetPercentage !== 0 && (
                            <p className={`text-sm ${targetPercentage > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                Target: {targetPercentage > 0 ? '+' : ''}{targetPercentage.toFixed(2)}%
                            </p>
                        )} */}
                        </div>
                        <div className="space-y-2">
                            <p className="font-normal text-gray-500">Set your target</p>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        handleTargetPriceChange(5);
                                        setTargetPercentage(5);
                                    }}
                                    className={`flex items-center gap-2 px-2 py-1 rounded-full border transition-all ${targetPercentage === 5
                                        ? "border-blue-500 bg-blue-50 shadow-sm"
                                        : "border-gray-200 hover:border-blue-500 text-gray-700"
                                        }`}
                                >
                                    <Icons.arrowDownGreenIcon className='w-3 h-3 rotate-180' />5%
                                </button>
                                <button
                                    onClick={() => {
                                        handleTargetPriceChange(10);
                                        setTargetPercentage(10);
                                    }}
                                    className={`flex items-center gap-2 px-2 py-1 rounded-full border transition-all ${targetPercentage === 10
                                        ? "border-blue-500 bg-blue-50 shadow-sm"
                                        : "border-gray-200 hover:border-blue-500 text-gray-700"
                                        }`}
                                >
                                    <Icons.arrowDownGreenIcon className='w-3 h-3 rotate-180' />10%
                                </button>
                                <button
                                    onClick={() => {
                                        handleTargetPriceChange(20);
                                        setTargetPercentage(20);
                                    }}
                                    className={`flex items-center gap-2 px-2 py-1 rounded-full border transition-all ${targetPercentage === 20
                                        ? "border-blue-500 bg-blue-50 shadow-sm"
                                        : "border-gray-200 hover:border-blue-500 text-gray-700"
                                        }`}
                                >
                                    <Icons.arrowDownGreenIcon className='w-3 h-3 rotate-180' />20%
                                </button>
                                <button
                                    onClick={() => {
                                        handleTargetPriceChange(50);
                                        setTargetPercentage(50);
                                    }}
                                    className={`flex items-center gap-2 px-2 py-1 rounded-full border transition-all ${targetPercentage === 50
                                        ? "border-blue-500 bg-blue-50 shadow-sm"
                                        : "border-gray-200 hover:border-blue-500 text-gray-700"
                                        }`}
                                >
                                    <Icons.arrowDownGreenIcon className='w-3 h-3 rotate-180' />50%
                                </button>
                            </div>
                            {/* {targetPercentage !== 0 && (
                            <p className={`text-sm ${targetPercentage > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                Target: {targetPercentage > 0 ? '+' : ''}{targetPercentage.toFixed(2)}%
                            </p>
                        )} */}
                        </div>
                        <p className="font-normal">Ready to proceed?</p>
                        <div className="flex gap-4">
                            <LoadingButton
                                onClick={() => buyCoin(selectedToken!, data.metadata.investmentAmount)}
                                className="flex items-center justify-center gap-2 px-4 py-2 bg-secondary-green hover:bg-green-600 font-funnel-sans text-white rounded-full transition-colors"
                                loading={loadingAction === "buy"}
                            >
                                Confirm
                            </LoadingButton>

                            <button
                                className="px-4 py-2 bg-secondary-red text-white rounded-full hover:bg-red-600 transition-colors"
                                onClick={onDeny}
                            >
                                Deny
                            </button>
                        </div>
                    </div>
                )
            }
            {
                txHash && (
                    <div className="space-y-2 mt-4 flex items-center">
                        <span className="font-normal mr-2">Here&apos;s the txs summary</span>
                        <Link
                            href={`https://basescan.org/tx/${txHash}`}
                            target="_blank"
                            className="text-secondary-blue text-sm font-semibold flex items-center gap-1 font-funnel-sans bg-transparent border border-black/20 rounded-full px-3 py-0.5"
                        >
                            View on Explorer
                            <Icons.arrowUpBlueIcon />
                        </Link>

                    </div>
                )
            }

            {
                txHash && tradeDetails?.trade && tokenInDetails && tokenOutDetails && (
                    <div className="space-y-2 mt-6">
                        <div className="flex flex-col gap-4 mt-2">

                            {/* Send Row */}
                            <div className="flex items-center gap-2">
                                <div className='flex items-center gap-2 min-w-[30%]'>
                                    <span className="text-lg"><Icons.arrowUpRedIcon /></span>
                                    <span className="text-black/80 font-normal">Send</span>
                                    <span className="text-black/40 font-semibold ml-1">
                                        {(() => {
                                            if ('amountSold' in tradeDetails.trade) {
                                                return `$${((Number(tradeDetails.trade.amountSold) / 10 ** tokenInDetails.decimals) * (tokenInDetails.priceUsd || 0)).toFixed(2)}`;
                                            } else if ('coinsSold' in tradeDetails.trade) {
                                                return `$${((Number(tradeDetails.trade.coinsSold) / 10 ** tokenInDetails.decimals) * (tokenInDetails.priceUsd || 0)).toFixed(2)}`;
                                            }
                                            return '';
                                        })()}
                                    </span>
                                </div>
                                <div className='flex items-center gap-2'>
                                    <div className="flex items-center gap-0.5 bg-transparent rounded-full px-2 py-0.5 border border-black/20 text-sm font-medium">
                                        {tokenInDetails.symbol === 'ETH' || tokenInDetails.symbol === 'WETH' ?
                                            <><Icons.ethereum className="w-3 h-3" />
                                                ETH
                                            </> :
                                            <>
                                                {tokenInDetails.imageUrl ? <Image src={tokenInDetails.imageUrl} width={16} height={16} alt={tokenInDetails.symbol} /> : <Icons.basetokenImage className="w-4 h-4" />}
                                                {tokenInDetails.symbol}
                                            </>
                                        }
                                    </div>

                                    <span className="text-secondary-red font-semibold ml-1">
                                        {(() => {
                                            if ('amountSold' in tradeDetails.trade) {
                                                return `-${(Number(tradeDetails.trade.amountSold) / 10 ** tokenInDetails.decimals).toFixed(5)}`;
                                            } else if ('coinsSold' in tradeDetails.trade) {
                                                return `-${(Number(tradeDetails.trade.coinsSold) / 10 ** tokenInDetails.decimals).toFixed(5)}`;
                                            }
                                            return '';
                                        })()}
                                    </span>
                                </div>
                            </div>
                            {/* Receive Row */}
                            <div className="flex items-center gap-2">
                                <div className='flex items-center gap-2 min-w-[30%]'>
                                    <span className="text-lg"><Icons.arrowDownGreenIcon /></span>
                                    <span className="text-black/80 font-normal">Receive</span>
                                    <span className="text-black/40 font-semibold ml-1">
                                        {(() => {
                                            if ('coinsPurchased' in tradeDetails.trade) {
                                                return `$${((Number(tradeDetails.trade.coinsPurchased) / 10 ** tokenOutDetails.decimals) * (tokenOutDetails.priceUsd || 0)).toFixed(2)}`;
                                            } else if ('amountPurchased' in tradeDetails.trade) {
                                                return `$${((Number(tradeDetails.trade.amountPurchased) / 10 ** tokenOutDetails.decimals) * (tokenOutDetails.priceUsd || 0)).toFixed(2)}`;
                                            }
                                            return '';
                                        })()}
                                    </span>
                                </div>
                                <div className='flex items-center gap-2'>
                                    <div className="flex items-center gap-0.5 bg-transparent rounded-full px-2 py-0.5 border border-black/20 text-sm font-medium">

                                        {tokenOutDetails.symbol === 'ETH' ?
                                            <Icons.ethereum className="w-4 h-4" /> :
                                            <>
                                                {tokenOutDetails.imageUrl ? <Image src={tokenOutDetails.imageUrl} width={16} height={16} alt={tokenOutDetails.symbol} /> : <Icons.basetokenImage className="w-4 h-4" />}

                                            </>
                                        }{tokenOutDetails.symbol}
                                    </div>

                                    <span className="text-secondary-green font-semibold ml-1">
                                        {(() => {
                                            if ('coinsPurchased' in tradeDetails.trade) {
                                                return `+${(Number(tradeDetails.trade.coinsPurchased) / 10 ** tokenOutDetails.decimals).toFixed(5)}`;
                                            } else if ('amountPurchased' in tradeDetails.trade) {
                                                return `+${(Number(tradeDetails.trade.amountPurchased) / 10 ** tokenOutDetails.decimals).toFixed(5)}`;
                                            }
                                            return '';
                                        })()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* P&L Status */}
                        <div className="rounded-lg px-0 py-4 mt-6">
                            <p className="font-normal mb-2">Current P&L Status</p>
                            <div className="flex items-center justify-start">
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-0.5 bg-transparent rounded-full px-2 py-0.5 border border-black/20 text-sm font-medium">
                                        {tokenOutDetails.symbol === 'ETH' ?
                                            <Icons.ethereum className="w-4 h-4" /> :
                                            <>
                                                {tokenOutDetails.imageUrl ? <Image src={tokenOutDetails.imageUrl} width={16} height={16} alt={tokenOutDetails.symbol} /> : <Icons.basetokenImage className="w-4 h-4" />}
                                            </>
                                        }{tokenOutDetails.symbol}
                                    </div>
                                    <span className="text-black/80 font-medium">
                                        ${(() => {
                                            const tokenAmount = 'coinsPurchased' in tradeDetails.trade
                                                ? Number(tradeDetails.trade.coinsPurchased) / (10 ** tokenOutDetails.decimals)
                                                : Number(tradeDetails.trade.amountPurchased) / (10 ** tokenOutDetails.decimals);
                                            const currentValue = tokenAmount * currentTokenOutPrice;
                                            return currentValue.toFixed(2);
                                        })()}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 ml-3">
                                    {(() => {
                                        const percentageChange = initialTokenOutPrice > 0 ? ((currentTokenOutPrice - initialTokenOutPrice) / initialTokenOutPrice) * 100 : 0;
                                        const isPositive = percentageChange >= 0;

                                        return (
                                            <>
                                                {/* {isPositive ? (
                                                    <Icons.arrowUpRedIcon className="w-4 h-4" />
                                                ) : (
                                                    <Icons.arrowDownGreenIcon className="w-4 h-4" />
                                                )} */}
                                                <span className={`font-medium ${isPositive ? 'text-secondary-green' : 'text-secondary-red'}`}>
                                                    {isPositive ? '+' : ''}{percentageChange.toFixed(2)}%
                                                </span>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>

                    </div>
                )
            }


        </div >
    );
}