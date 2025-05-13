import Image from 'next/image';
import { SwapTokenConfirmationResponse } from '@/app/(routes)/chat/[id]/page';
import Link from 'next/link';
import { SwapProgressState } from '@/app/(routes)/chat/[id]/page';
import { useEffect, useState } from 'react';
import { Icons } from '../../sections/icons';

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
        <div className="flex items-center gap-0.5 bg-transparent rounded-full px-2 py-0.5 border border-black/20">
            {token.image && (
                <Image
                    src={token.image}
                    alt={token.symbol}
                    width={16}
                    height={16}
                    className="rounded-full"
                />
            )}
            <span className="text-sm font-semibold">{token.symbol?.toUpperCase()}</span>
        </div>
    );

    const StateCircle = ({ step, number }: { step: string, number?: number }) => {
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

        return (
            <div
                className={`w-[26px] h-[26px] rounded-full flex items-center justify-center relative z-10 
                    ${showCheck || showSpinner ? 'bg-secondary-green' : 'bg-white border border-secondary-green'}
                    transition-all duration-300 ease-in-out`}
            >
                {showSpinner ? (
                    <div className="w-[50%] h-[50%] m-1 p-[2px] aspect-square rounded-full bg-white custom-mask animate-spin"></div>
                ) : showCheck ? (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : (
                    <div className="text-black/40 text-xs font-medium ">{number}</div>
                )}
            </div>
        );
    };

    return (
        <>
            <div className="mx-4 w-[80%] rounded-xl overflow-hidden font-funnel-sans border border-black/10">
                {/* Header */}
                <div className="p-6 bg-black/4 font-funnel-sans text-black/80 text-lg border-b border-black/10">
                    <div className="flex items-center gap-2">
                        <span className="">Swapping</span>
                        <span className="font-medium">{formatTokenAmount(data.amountIn, data.tokenIn.decimals)}</span>
                        <TokenBadge token={data.tokenIn} />
                        <span className="">for</span>
                        <span className="font-medium">{parseFloat(data.amountOut).toFixed(5)}</span>
                        <TokenBadge token={data.tokenOut} />
                    </div>
                </div>

                {/* Progress Steps */}
                <div className="relative m-4">
                    {/* Vertical Line */}
                    <div className="absolute left-[12px] h-full top-[0%] bottom-[32px] w-[2px] bg-black/10">
                        <div
                            className={`h-full bg-[#22C55E] transition-all duration-500 ease-in-out`}
                            style={{
                                height: stateFromData === 'completed' ? '100%' :
                                    stateFromData === 'approve' ? '33%' : '0%'
                            }}
                        />
                    </div>

                    <div className='space-y-5'>
                        {/* Approve Step */}
                        <div className="flex items-center gap-3 relative z-10">
                            <StateCircle step="approve" number={1} />
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-md text-black/40">Approve</span>
                                    <TokenBadge token={data.tokenIn} />
                                    <span className="text-md text-black/40">for swapping</span>
                                    {data.approvalHash && (
                                        <Link
                                            href={`https://basescan.org/tx/${data.approvalHash}`}
                                            target="_blank"
                                            className="text-secondary-blue text-sm font-semibold flex items-center gap-1 font-funnel-sans bg-transparent border border-black/20 rounded-full px-3 py-0.5"
                                        >
                                            View on Explorer
                                            <Icons.arrowUpBlueIcon />
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Execute Swap Step */}
                        <div className="flex items-center gap-3 relative z-10">
                            <StateCircle step="swap" number={2} />
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-md text-black/40">Execute the swap securely using</span>
                                    <span className="text-uniswap-pink font-medium text-sm font-funnel-sans bg-transparent border border-black/20 rounded-full px-2 py-0.5">UNISWAP</span>
                                    {data.swapHash && (
                                        <Link
                                            href={`https://basescan.org/tx/${data.swapHash}`}
                                            target="_blank"
                                            className="text-secondary-blue text-sm font-semibold flex items-center gap-1 font-funnel-sans bg-transparent border border-black/20 rounded-full px-3 py-0.5"

                                        >
                                            View on Explorer
                                            <Icons.arrowUpBlueIcon />
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Update Balance Step */}
                        <div className="flex items-center gap-3 relative z-10">
                            <StateCircle step="update" number={3} />
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-md text-black/40">Update the wallet balance</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
            {
                (state === 'completed' || stateFromData === 'completed') && (
                    <div className="p-4 text-black/80">
                        <div className="font-funnel-sans">Transaction successful!</div>
                    </div>
                )
            }
        </>
    );
} 