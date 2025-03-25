import Image from 'next/image';

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
    feeTier: string;
    originalAmount: string;
    amountType: string;
}

interface TokenSwapProps {
    data: SwapTokenResponse;
    onSwap: (data: SwapTokenResponse) => void;
}

export default function TokenSwap({ data, onSwap }: TokenSwapProps) {
    return (
        <div className="flex justify-start my-4 w-full">
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
                        onClick={() => onSwap(data)}
                    >
                        Confirm Swap
                    </button>
                </div>
            </div>
        </div>
    );
} 