import { TokenMetadata } from "@/actions/web3";
import { Icons } from "../../sections/icons";
import Image from "next/image";
import Link from "next/link";
import { SquareArrowOutUpRight } from "lucide-react";


type SellEventArgs = {
    seller: `0x${string}`;
    recipient: `0x${string}`;
    tradeReferrer: `0x${string}`;
    coinsSold: string;
    currency: `0x${string}`;
    amountFee: bigint;
    amountPurchased: bigint;
}

type BuyEventArgs = {
    buyer: `0x${string}`;
    recipient: `0x${string}`;
    tradeReferrer: `0x${string}`;
    coinsPurchased: string;
    currency: `0x${string}`;
    amountFee: bigint;
    amountSold: bigint;
}

export type TradeEventArgs = BuyEventArgs | SellEventArgs;

interface TradeResult {
    hash: `0x${string}`;
    tradeDetails: TradeEventArgs;
    tokenOutDetails: TokenMetadata;
    tokenInDetails: TokenMetadata;
}

export interface TradeHistoryProps {
    trades: TradeResult[];
    onSubmit: () => void;
}


// sample trades
export const sampleTrades: TradeResult[] = [
    {
        hash: "0xa208f820359e326e2e11a7a7c48440a0416d04d57ce8df5dfef3bd44e464d9c1",
        tradeDetails:
        {
            amountFee: BigInt(2040000000000),
            amountSold: BigInt(201960000000000),
            coinsPurchased: "43998291201865503250358",
            currency: "0x4200000000000000000000000000000000000006",
            buyer: "0x1227B11F8D83Ea0bcb346DAac7A8727ac0020915",
            recipient: "0x1227B11F8D83Ea0bcb346DAac7A8727ac0020915",
            tradeReferrer: "0x0000000000000000000000000000000000000000"
        },
        tokenInDetails:
        {
            imageUrl: "https://coin-images.coingecko.com/coins/images/39810/large/weth.png?1724139790",
            name: "Wrapped Ether",
            symbol: "WETH",
            decimals: 18,
            priceUsd: 2474.29
        },
        tokenOutDetails: { imageUrl: "", name: "Wurld Wah Thr33", symbol: "WWIII", decimals: 18, priceUsd: 0.00001119539098 }
    },
    {
        hash: "0x42bd519ce9f401d87a53a6fc1b1bae23e39c4c002908256d862a07350a9a13fb",
        tradeDetails: {
            amountFee: BigInt(0),
            amountSold: BigInt(204000000000000),
            coinsPurchased: "0.011044243058857685",
            currency: "0x4200000000000000000000000000000000000006",
            buyer: "0x1227B11F8D83Ea0bcb346DAac7A8727ac0020915",
            recipient: "0x1227B11F8D83Ea0bcb346DAac7A8727ac0020915",
            tradeReferrer: "0x0000000000000000000000000000000000000000"
        },
        tokenInDetails:
        {
            imageUrl: "https://assets.coingecko.com/coins/images/279/large/ethereum.png?1595348880",
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
            priceUsd: 0
        },
        tokenOutDetails:
        {
            imageUrl: "https://coin-images.coingecko.com/coins/images/51440/large/CLANKER.png?1731232869",
            name: "tokenbot",
            symbol: "CLANKER",
            decimals: 18,
            priceUsd: 45.4397519404665
        }
    }
]


export default function TradeHistory({ trades, onSubmit }: TradeHistoryProps) {
    return (
        <div className="space-y-2 mt-6 font-funnel-sans px-2 max-w-[80%] ">
            <div className="flex flex-col gap-4 mt-2 space-y-6">

                <p className="text-white/80 font-normal mb-3">Here&apos;s the trade summary:</p>
                {trades.map((trade, index) => (

                    <div key={index} className="space-y-3">
                        {/* Send Row */}
                        <div className="flex items-center gap-2">
                            <div className='flex items-center gap-2 min-w-[25%]'>
                                <span className="text-lg"><Icons.arrowUpRedIcon /></span>
                                <span className="text-white/80 font-normal">Send</span>
                                <span className="text-white/40 font-semibold ml-1">
                                    {(() => {
                                        if ('amountSold' in trade.tradeDetails) {
                                            return `$${((Number(trade.tradeDetails.amountSold) / 10 ** trade.tokenInDetails.decimals) * (trade.tokenInDetails.priceUsd || 0)).toFixed(2)}`;
                                        } else if ('coinsSold' in trade.tradeDetails) {
                                            return `$${((Number(trade.tradeDetails.coinsSold) / 10 ** trade.tokenInDetails.decimals) * (trade.tokenInDetails.priceUsd || 0)).toFixed(2)}`;
                                        }
                                        return '';
                                    })()}
                                </span>
                            </div>
                            <div className='flex items-center gap-2'>
                                <div className="flex items-center gap-0.5 bg-transparent rounded-full px-3 py-1.5 border border-white/20 text-[12px] text-white/80 font-medium">
                                    {trade.tokenInDetails?.symbol === 'ETH' || trade.tokenInDetails?.symbol === 'WETH' ?
                                        <><Icons.ethereum className="w-3 h-3" />
                                            ETH
                                        </> :
                                        <>
                                            {trade.tokenInDetails.imageUrl ? <Image src={trade.tokenInDetails.imageUrl} width={16} height={16} alt={trade.tokenInDetails.symbol} /> : <Icons.basetokenImage className="w-4 h-4" />}
                                            {trade.tokenInDetails.symbol}
                                        </>
                                    }
                                </div>

                                <span className="text-secondary-red font-semibold ml-1">
                                    {(() => {
                                        if ('amountSold' in trade.tradeDetails) {
                                            return `-${(Number(trade.tradeDetails.amountSold) / 10 ** trade.tokenInDetails.decimals).toFixed(5)}`;
                                        } else if ('coinsSold' in trade.tradeDetails) {
                                            return `-${(Number(trade.tradeDetails.coinsSold) / 10 ** trade.tokenInDetails.decimals).toFixed(5)}`;
                                        }
                                        return '';
                                    })()}
                                </span>
                            </div>
                        </div>
                        {/* Receive Row */}
                        <div className="flex items-center gap-2">
                            <div className='flex items-center gap-2 min-w-[25%]'>
                                <span className="text-lg"><Icons.arrowDownGreenIcon /></span>
                                <span className="text-white/80 font-normal">Receive</span>
                                <span className="text-white/40 font-semibold ml-1">
                                    {(() => {
                                        if ('coinsPurchased' in trade.tradeDetails) {
                                            return `$${((Number(trade.tradeDetails.coinsPurchased) / 10 ** trade.tokenOutDetails.decimals) * (trade.tokenOutDetails.priceUsd || 0)).toFixed(2)}`;
                                        } else if ('amountPurchased' in trade.tradeDetails) {
                                            return `$${((Number(trade.tradeDetails.amountPurchased) / 10 ** trade.tokenOutDetails.decimals) * (trade.tokenOutDetails.priceUsd || 0)).toFixed(2)}`;
                                        }
                                        return '';
                                    })()}
                                </span>
                            </div>
                            <div className='flex items-center gap-2'>
                                <div className="flex items-center gap-0.5 bg-transparent rounded-full px-3 py-1.5 border border-white/20 text-[12px] text-white/80 font-medium">

                                    {trade.tokenOutDetails.symbol === 'ETH' ?
                                        <Icons.ethereum className="w-4 h-4" /> :
                                        <>
                                            {trade.tokenOutDetails.imageUrl ? <Image src={trade.tokenOutDetails.imageUrl} width={16} height={16} alt={trade.tokenOutDetails.symbol} /> : <Icons.basetokenImage className="w-4 h-4" />}

                                        </>
                                    }{trade.tokenOutDetails.symbol}
                                </div>

                                <span className="text-secondary-green font-semibold ml-1">
                                    {(() => {
                                        if ('coinsPurchased' in trade.tradeDetails) {
                                            return `+${(Number(trade.tradeDetails.coinsPurchased) / 10 ** trade.tokenOutDetails.decimals).toFixed(5)}`;
                                        } else if ('amountPurchased' in trade.tradeDetails) {
                                            return `+${(Number(trade.tradeDetails.amountPurchased) / 10 ** trade.tokenOutDetails.decimals).toFixed(5)}`;
                                        }
                                        return '';
                                    })()}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}

                <p className="text-white/80 font-normal mb-4 font-funnel-sans">You can also check the limit orders live through the <Link href="/wallet" className="text-white underline flex items-center gap-1 nowrap">Wallet Page <SquareArrowOutUpRight className="w-4 h-4 text-white/20" /></Link></p>
                <p className="text-white/80 font-normal my-4 font-funnel-sans">
                    Earny is monitoring token prices in real time and dynamically enters or exits positions to maximise profits based on market movements.
                </p>

                <button
                    onClick={() => onSubmit()}
                    className="max-w-max rounded-full bg-secondary-green px-[16px] py-1.5 text-md font-medium font-funnel-sans text-black">
                    OK, Got it!
                </button>

            </div>
        </div>
    )
}