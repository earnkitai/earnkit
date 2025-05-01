import Image from 'next/image';
import { SwapTokenConfirmationResponse } from '@/app/(routes)/chat/[id]/page';
import Link from 'next/link';
import { SwapProgressState } from '@/app/(routes)/chat/[id]/page';
import { useEffect, useState } from 'react';

interface Token {
    address: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
    image: string;
    currentPrice: number;
}

interface TokenSwapProps {
    data: SwapTokenConfirmationResponse;
    userAddress: string;
    state: SwapProgressState;
}

export default function TokenSwapConfirmation({ data, state }: TokenSwapProps) {

    const formatTokenAmount = (amount: string, decimals: number) => {
        return (parseInt(amount) / Math.pow(10, decimals)).toFixed(4);
    };

    const [stateFromData, setStateFromData] = useState<string>("");

    useEffect(() => {
        if (data && data.swapHash) {
            console.log("swapHash dataaaaa", data)
            // If we have swapHash, all three steps are completed
            setStateFromData('completed');
        } else if (data && data.approvalHash && !data.swapHash) {
            // Only approve step is completed
            setStateFromData('approve');
        }
    }, [data]);

    const TokenBadge = ({ token }: { token: Token }) => (
        <div className="flex items-center gap-1 bg-white rounded-full px-2 py-0.5 border border-black/10">
            {token.image && (
                <Image
                    src={token.image}
                    alt={token.symbol}
                    width={16}
                    height={16}
                    className="rounded-full"
                />
            )}
            <span className="text-sm font-medium">{token.symbol?.toUpperCase()}</span>
        </div>
    );

    const StateCircle = ({ step }: { step: string }) => {
        const isApproveStep = step === 'approve';
        const isSwapStep = step === 'swap';
        const isUpdateStep = step === 'update';

        const showSpinner = (isApproveStep && state === 'approving') ||
            (isSwapStep && state === 'swapping');

        // If we have swapHash in data, all steps should show check
        const showCheck = (data.swapHash) ||
            (isApproveStep && (stateFromData === 'approve' || stateFromData === 'completed' || ['approved', 'swapping', 'completed'].includes(state))) ||
            (isSwapStep && (stateFromData === 'completed' || ['completed'].includes(state))) ||
            (isUpdateStep && (stateFromData === 'completed' || ['completed'].includes(state)));

        const isActive = (isApproveStep && state === 'approving') ||
            (isSwapStep && state === 'swapping') ||
            (isUpdateStep && state === 'completed');

        return (
            <div
                className={`w-8 h-8 rounded-full flex items-center justify-center relative z-10 
                    ${showCheck ? 'bg-[#22C55E] border-[#22C55E]' : 'bg-white'} 
                    ${showSpinner ? 'border-2 border-[#22C55E]' : 'border-2 border-[#E5E7EB]'}
                    ${isActive ? 'scale-110' : 'scale-100'}
                    transition-all duration-300 ease-in-out`}
            >
                {showSpinner ? (
                    <div className="w-5 h-5 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" />
                ) : showCheck ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : (
                    <div className="w-2 h-2 bg-[#E5E7EB] rounded-full" />
                )}
            </div>
        );
    };

    return (
        <div className="w-[80%] bg-gray-50/50 rounded-xl overflow-hidden font-funnel-sans border border-black/10">
            {/* Header */}
            <div className="p-4 bg-black/4">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Swapping</span>
                    <span className="font-medium">{formatTokenAmount(data.amountIn, data.tokenIn.decimals)}</span>
                    <TokenBadge token={data.tokenIn} />
                    <span className="text-sm font-medium">for</span>
                    <span className="font-medium">{parseFloat(data.amountOut).toFixed(2)}</span>
                    <TokenBadge token={data.tokenOut} />
                </div>
            </div>

            {/* Progress Steps */}
            <div className="p-4 space-y-4 relative">
                {/* Vertical Line */}
                <div className="absolute left-[30px] top-[35px] bottom-[32px] w-[2px] bg-[#E5E7EB]">
                    <div
                        className={`h-full bg-[#22C55E] transition-all duration-500 ease-in-out`}
                        style={{
                            height: stateFromData === 'completed' ? '100%' :
                                stateFromData === 'approve' ? '33%' : '0%'
                        }}
                    />
                </div>

                {/* Approve Step */}
                <div className="flex items-center gap-3 relative z-10">
                    <StateCircle step="approve" />
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm">Approve</span>
                            <TokenBadge token={data.tokenIn} />
                            <span className="text-sm">for swapping</span>
                            {data.approvalHash && (
                                <Link
                                    href={`https://basescan.org/tx/${data.approvalHash}`}
                                    target="_blank"
                                    className="ml-auto text-blue-500 text-sm hover:underline flex items-center gap-1"
                                >
                                    View on Explorer
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>

                {/* Execute Swap Step */}
                <div className="flex items-center gap-3 relative z-10">
                    <StateCircle step="swap" />
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm">Execute the swap securely using</span>
                            <span className="text-blue-500 font-medium text-sm font-funnel-sans bg-transparent border border-blue-500 rounded-full px-2 py-0.5">UNISWAP</span>
                            {data.swapHash && (
                                <Link
                                    href={`https://basescan.org/tx/${data.swapHash}`}
                                    target="_blank"
                                    className="text-blue-500 text-sm flex items-center gap-1 font-funnel-sans bg-transparent border border-blue-500 rounded-full px-2 py-0.5"
                                >
                                    View on Explorer
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>

                {/* Update Balance Step */}
                <div className="flex items-center gap-3 relative z-10">
                    <StateCircle step="update" />
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm">Update the wallet balance</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Success Message */}
            {(state === 'completed' || stateFromData === 'completed') && (
                <div className="p-4 border-t border-black/10">
                    <div className="text-[#22C55E] font-medium">Transaction successful!</div>
                </div>
            )}
        </div>
    );
} 