import Image from 'next/image';
import { SwapDetails } from '@/app/(routes)/chat/[id]/page';
import Link from 'next/link';

interface Token {
    address: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
    image: string;
    currentPrice: number;
}

interface SwapTokenResponse {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: string;
    originalAmount: string;
    amountType: string;
    swapRoute: SwapDetails
}

interface TokenSwapProps {
    data: SwapTokenResponse;
    onSwap: (data: SwapTokenResponse) => void;
    userAddress: string;
    onDeny: () => void;
}

export default function TokenSwap({ data, onSwap, onDeny }: TokenSwapProps) {
    const formatTokenAmount = (amount: string, decimals: number) => {
        return (parseInt(amount) / Math.pow(10, decimals)).toFixed(4);
    };

    const TokenBadge = ({ token }: { token: Token }) => (
        <Link href={`https://basescan.org/token/${token.address}`} target="_blank"
            className="text-blue-500 flex items-center gap-1 font-funnel-sans text-sm bg-transparent border border-black/20 rounded-full px-1.5 py-0.5 hover:bg-black/4 transition-colors hover:border-black/40"
        >
            {token.image && (
                <Image
                    src={token.image}
                    alt={token.symbol}
                    width={12}
                    height={12}
                    className="rounded-full"
                />
            )}
            <span>{token.symbol?.toUpperCase()}</span>
        </Link>
    );


    const StepCircle = ({ number }: { number: string }) => (
        <div className="w-7 h-7 mr-2 rounded-full bg-white border-2 border-black/20 flex items-center justify-center text-sm text-gray-500 shrink-0 relative z-[20]">
            {number}
        </div>
    );

    return (
        <div className="px-2 space-y-4 max-w-[80%] font-funnel-sans text-black/80 font-normal">

            <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-normal font-funnel-sans">Swapping</span>
                    <span className="font-medium">{formatTokenAmount(data.amountIn, data.tokenIn.decimals)}</span>
                    <TokenBadge token={data.tokenIn} />
                    <span className="font-normal font-funnel-sans">for</span>
                    <span className="font-medium">{parseFloat(data.swapRoute.quote).toFixed(5)}</span>
                    <TokenBadge token={data.tokenOut} />
                    <span className="font-normal font-funnel-sans">at</span>
                    <span className="font-medium">{(data.tokenIn.currentPrice / data.tokenOut.currentPrice).toFixed(5)}</span>
                    <TokenBadge token={data.tokenOut} />
                    <span className="font-normal font-funnel-sans">per</span>
                    <TokenBadge token={data.tokenIn} />
                </div>

                <div className="flex items-center gap-2">
                    <span className="font-normal">Network fee will be:</span>
                    <span className="font-medium">${data.swapRoute.gasCostUSD}</span>
                </div>
            </div>


            <div className="font-funnel-sans text-black/80 font-normal">
                <h3 className="font-normal mb-2">Here&apos;s what will happen:</h3>
                <div className="border border-black/10 rounded-xl p-6">
                    <div className="relative">
                        <div className="absolute z-10 left-[13px] top-[28px] bottom-[4px] w-[2px] bg-gray-200"></div>
                        <div className="space-y-4">
                            <div className="flex items-start gap-2 text-black/40">
                                <div className="flex items-center gap-1 ">
                                    <StepCircle number="1" />
                                    <span className="font-funnel-sans font-medium ">Approve</span>
                                    <TokenBadge token={data.tokenIn} />
                                    <span className="font-funnel-sans font-medium ">for swapping</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-black/40">
                                <div className=" flex items-center gap-1 ">
                                    <StepCircle number="2" />
                                    <span className="font-funnel-sans font-medium">Execute the swap</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-black/40">

                                <div className="pt-1 flex items-center gap-1">
                                    <StepCircle number="3" />
                                    <span className="font-funnel-sans font-medium">Update the wallet balance</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2 mt-4">
                <p className="font-normal mb-4">Ready to proceed?</p>
                <div className="flex gap-4">
                    <button
                        onClick={() => onSwap(data)}
                        className="px-4 py-2 bg-secondary-green text-white rounded-full hover:bg-green-600 transition-colors"
                    >
                        Confirm
                    </button>
                    <button
                        className="px-4 py-2 bg-secondary-red text-white rounded-full hover:bg-red-600 transition-colors"
                        onClick={onDeny}
                    >
                        Deny
                    </button>
                </div>
            </div>
        </div>
    );
} 