import { getPublicClient } from '@/lib/web3';
import { Address, Hex, createWalletClient, custom, parseEther } from 'viem';

import { tradeCoin } from '@zoralabs/coins-sdk';
import { base } from 'viem/chains';
import { useEffect, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { LoadingButton } from '../../ui/button.loader';
import { Icons } from '../../sections/icons';
import { toast } from 'sonner';
import Link from 'next/link';
import Image from 'next/image';
import { getTokenMetadataWithCoingecko, TokenMetadata } from '@/actions/web3';

interface Token {
    name: string;
    symbol: string;
    address: string;
    marketCap: string;
    volume24h: string;
    uniqueHolders: number;
    confidenceScore: number;
    sources: string[];
}

export interface TokenInvestResponse {
    recommendations: Token[];
    metadata: {
        count: number;
        riskLevel: string;
        investmentAmount: number;
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

export interface TokenInvestProps {
    data: TokenInvestResponse;
    userAddress: `0x${string}`;
    onDeny: () => void;
    updateMessage: (messageId: string, content: string) => void;
    messageId?: string;
}

type TokenInvestState = '' | 'researching' | 'researched' | 'executing' | 'executed' | 'recordkeeping' | 'completed' | 'exerror' | 'recorderror' | 'researcherror';


export default function TokenInvest({ data, userAddress, onDeny, messageId, updateMessage }: TokenInvestProps) {
    const [selectedToken, setSelectedToken] = useState<Address | null>(null);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [tradeDetails, setTradeDetails] = useState<TradeResult | null>(null);
    const [tokenInDetails, setTokenInDetails] = useState<TokenMetadata | null>(null);
    const [tokenOutDetails, setTokenOutDetails] = useState<TokenMetadata | null>(null);
    const [state, setState] = useState<TokenInvestState[]>(['researching']);
    const [topTokens, setTopTokens] = useState<Token[]>([]);
    const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
    const { wallets } = useWallets();
    const wallet = wallets[0];
    // Sort tokens by confidence score and take top 2


    useEffect(() => {
        if (data && data.recommendations.length > 0) {

            if (data.selectedToken) {
                setSelectedToken(data.selectedToken as Address);
                setState(['researching', 'researched', 'executing', 'executed', 'recordkeeping', 'completed']);
                setTxHash(data.tradeDetails?.hash as `0x${string}`);
                setTradeDetails(data.tradeDetails as TradeResult);
                setTokenInDetails(data.tradeDetails?.tokenInDetails as TokenMetadata);
                setTokenOutDetails(data.tradeDetails?.tokenOutDetails as TokenMetadata);
            } else {
                setState(['researching', 'researched']);
            }
            console.log(data, 'dataaaaaa');
            const topTokens = [...data.recommendations]
                .sort((a, b) => b.confidenceScore - a.confidenceScore)
                .slice(0, 2);
            setTopTokens([...topTokens]);

        }
        return () => {
            setState(['researching']);
        }
    }, [data]);


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
        setState([...state, 'executing']);
        console.log("buyCoin", coinContractAddress, orderSize);
        setLoadingAction("buy");
        const provider = wallet ? await wallet.getEthereumProvider() : null;
        if (!provider) {
            console.error("No provider found");
            return;
        }
        const walletClient = createWalletClient({
            account: wallet.address as Hex,
            chain: base,
            transport: custom(provider),
        });
        try {
            // have selected token details
            const buyParams = {
                direction: "buy" as const,
                target: coinContractAddress as Address,
                args: {
                    recipient: userAddress as Address, // Where to receive the purchased coins
                    orderSize: parseEther(orderSize.toString()), // Amount of ETH to spend
                    minAmountOut: BigInt(0), // Minimum amount of coins to receive (0 = no minimum)
                }
            };
            const result = await tradeCoin(buyParams, walletClient, publicClient);

            if (await result.receipt) {
                setState([...state, 'executing', 'executed', 'recordkeeping']);
                data.selectedToken = selectedToken as `0x${string}`;
                console.log(result.trade, 'result.trade')

                const tradeData = result.trade as BuyEventArgs;

                const tokenIn = await fetchTokenDetails(result.trade?.currency as Address);
                const tokenOut = await fetchTokenDetails(selectedToken as Address);
                setTokenInDetails(tokenIn);
                setTokenOutDetails(tokenOut);

                const serializedTrade = {
                    amountFee: tradeData.amountFee.toString(),
                    amountSold: tradeData.amountSold.toString(),
                    coinsPurchased: tradeData.coinsPurchased.toString(),
                    currency: tradeData.currency,
                    buyer: tradeData.buyer,
                    recipient: tradeData.recipient,
                    tradeReferrer: tradeData.tradeReferrer,
                }
                // Create a serialized version of the trade details
                const serializedTradeDetails = {
                    hash: result.hash,
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
                setTxHash(result.hash);
            }


            setState([...state, 'executing', 'executed']);
            return result;
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

    return (
        <div className="space-y-4 px-2 max-w-[80%]" >

            <div className="max-w-[80%] rounded-xl overflow-hidden font-funnel-sans border border-black/10">
                {/* Header */}
                <div className="px-6 py-3 bg-black/4 font-funnel-sans text-black/80 text-lg border-b border-black/10">
                    <div className="flex items-center gap-2">
                        <Icons.zoraIcon className='w-6 h-6 mr-0.5' />
                        <span className="font-semibold font-funnel-sans text-lg">Trader on Zora</span>
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
                {/* <p className='text-black/80 font-funnel-sans font-normal'>Select a token to invest in</p> */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {topTokens.map((token) => (
                        <div
                            key={token.address}
                            className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedToken === token.address
                                ? 'border-blue-500 bg-blue-50 shadow-sm'
                                : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
                                }`}
                            onClick={() => setSelectedToken(token.address as Address)}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                                        <span className="text-sm font-medium text-gray-600">
                                            {token.symbol.charAt(0)}
                                        </span>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-900">{token.name}</h3>
                                        <p className="text-xs text-gray-500">{token.symbol}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-gray-50 rounded-lg p-2">
                                    <p className="text-gray-500">Market Cap</p>
                                    <p className="font-medium">${Number(token.marketCap).toLocaleString()}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                    <p className="text-gray-500">24h Vol</p>
                                    <p className="font-medium">${Number(token.volume24h).toLocaleString()}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2">
                                    <p className="text-gray-500">Holders</p>
                                    <p className="font-medium">{token.uniqueHolders.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </> : <></>}

            {selectedToken && !txHash && (
                <div className="space-y-2 mt-4">
                    <p className="font-normal mb-4">Ready to proceed?</p>
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
            )}
            {txHash && (
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
            )}

            {txHash && tradeDetails?.trade && tokenInDetails && tokenOutDetails && (
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
                                            <Image src={tokenInDetails.imageUrl} width={16} height={16} alt={tokenInDetails.symbol} />
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
                                            <Image src={tokenOutDetails.imageUrl} width={16} height={16} alt={tokenOutDetails.symbol} />

                                        </>
                                    }{tokenOutDetails.symbol}
                                </div>

                                <span className="text-secondary-green font-semibold ml-1">
                                    {(() => {
                                        if ('coinsPurchased' in tradeDetails.trade) {
                                            return `+${Number(tradeDetails.trade.coinsPurchased).toLocaleString()}`;
                                        } else if ('amountPurchased' in tradeDetails.trade) {
                                            return `+${Number(tradeDetails.trade.amountPurchased).toLocaleString()}`;
                                        }
                                        return '';
                                    })()}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
}