import Image from 'next/image';
import { Icons } from '../sections/icons';
import { SwapProgressState } from '@/app/(routes)/chat/[id]/page';


export interface SwapProgressProps {
    tokenInSymbol: string;
    tokenInAmount: string;
    tokenInImage: string;
    tokenOutSymbol: string;
    tokenOutAmount: string;
    tokenInDecimals: number;
    tokenOutImage: string;
    gasFee: string;
    state: SwapProgressState;
}

export function SwapProgress({
    tokenInSymbol = "ETH",
    tokenInImage = "",
    tokenInAmount = "1.25",
    tokenOutSymbol = "KAITO",
    tokenOutImage = "",
    tokenOutAmount = "500",
    tokenInDecimals = 18,
    gasFee = "3.02",
    state = 'initial',
}: SwapProgressProps) {

    // const [isTestRunning, setIsTestRunning] = useState(false);

    // const runTestSequence = async () => {
    //     if (isTestRunning) return;
    //     setIsTestRunning(true);
    //     setState('initial');

    //     // Simulate the approval process
    //     await new Promise(resolve => setTimeout(resolve, 1000));
    //     setState('approving');

    //     // Simulate approval completion
    //     await new Promise(resolve => setTimeout(resolve, 2000));
    //     setState('approved');

    //     // Simulate the swap process
    //     await new Promise(resolve => setTimeout(resolve, 1000));
    //     setState('swapping');

    //     // Simulate swap completion
    //     await new Promise(resolve => setTimeout(resolve, 2000));
    //     setState('completed');

    //     setIsTestRunning(false);
    //     if (onComplete) onComplete();
    // };

    const ProgressCircle = ({ step }: { step: 'approve' | 'swap' }) => {
        const isApproveStep = step === 'approve';
        const showSpinner = (isApproveStep && state === 'approving') || (!isApproveStep && state === 'swapping');
        const showCheck = (isApproveStep && ['approved', 'swapping', 'completed'].includes(state)) ||
            (!isApproveStep && state === 'completed');
        const isActive = (isApproveStep && state === 'approving') || (!isApproveStep && state === 'swapping');

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

    const formatTokenAmount = (amount: string, decimals: number) => {
        return (parseInt(amount) / Math.pow(10, decimals)).toFixed(4);
    };

    return (
        <div className="max-w-[450px] mx-auto bg-white rounded-[36px] p-4 shadow-sm border border-black/10 font-funnel-sans space-y-4">
            <div className="space-y-4 bg-black/4 rounded-[24px] py-8 px-12">
                <div className="flex justify-center mb-6">
                    <Icons.earnyLogoBlack className="w-20 text-black" />
                </div>

                <div className="text-sm text-black/40 mb-4 text-md flex items-center justify-center" >
                    <div className="flex items-center gap-2">
                        <span>Swapping via</span>
                        <span className="font-medium bg-transparent px-2 py-0.5 rounded-full flex items-center gap-1 border border-black/20 hover:border-black/40 hover:bg-black/10 transition-all duration-300 uppercase text-blue-500">uniswap</span>
                        <span>on</span>
                        <span className="text-black font-medium bg-transparent px-2 py-0.5 rounded-full flex items-center gap-1 border border-black/20 hover:border-black/40 hover:bg-black/10 transition-all duration-300">
                            <Icons.base className="w-4 h-4 text-black/40 rounded-full " />
                            BASE
                        </span>
                    </div>
                </div>
            </div>

            <div className="space-y-4 flex flex-col justify-center border border-black/10 rounded-[24px] px-8 py-4">
                <div className="text-sm text-black/40 text-center">
                    Swapping {tokenInSymbol} on BASE to receive {tokenOutSymbol}
                </div>


                {/* Progress Bar */}
                <div className="relative py-4">
                    {/* Progress Line */}
                    <div className="absolute left-[50%] top-[50%] -translate-x-[50%] -translate-y-[50%] h-[2px] w-full bg-[#E5E7EB]">
                        <div
                            className={`h-full bg-[#22C55E] transition-all duration-500 ease-in-out`}
                            style={{
                                width: state === 'initial' ? '0%' :
                                    state === 'approving' ? '25%' :
                                        state === 'approved' ? '50%' :
                                            state === 'swapping' ? '75%' : '100%'
                            }}
                        />
                    </div>

                    {/* Progress Steps */}
                    <div className="flex items-center justify-between w-full mx-auto relative z-10">
                        <div className="flex flex-col items-center gap-2">
                            <ProgressCircle step="approve" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <ProgressCircle step="swap" />
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center justify-between gap-2 w-full">

                        <div className="flex items-center gap-1">
                            <span className="text-black/80 font-bold text-lg">{formatTokenAmount(tokenInAmount, tokenInDecimals)}</span>
                            <div className=" bg-black/4 px-2 py-1 rounded-full flex items-center gap-1">
                                {tokenInImage && <Image src={tokenInImage} alt={tokenInSymbol} width={16} height={16} />}
                                <span className="text-black/80 font-medium text-sm">{tokenInSymbol}</span>
                            </div>
                        </div>
                        <Icons.rightArrowIcon className="w-8" />
                        <div className="flex items-center gap-1">
                            <span className="text-black/80 font-bold text-lg">{parseFloat(tokenOutAmount).toFixed(2)}</span>
                            <div className=" bg-black/4 px-2 py-1 rounded-full flex items-center gap-1">
                                {tokenOutImage && <Image src={tokenOutImage} alt={tokenOutSymbol} width={16} height={16} />}
                                <span className="text-black/80 font-medium text-sm">{tokenOutSymbol}</span>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Gas Fees and Slippage */}
                <div className="flex items-center gap-2 text-xs justify-between">
                    <div className="flex items-center gap-1">
                        <span className="text-black/40">Gas Fees</span>
                        <span>${gasFee}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-black/40">Slippage</span>
                        <span>0.01%</span>
                    </div>
                </div>

            </div>
            {/* Test Controls */}
            {/* <div className="mt-6 flex justify-center">
                <button
                    onClick={runTestSequence}
                    disabled={isTestRunning}
                    className="px-4 py-2 bg-black text-white rounded-full disabled:opacity-50"
                >
                    {isTestRunning ? 'Processing...' : 'Test Swap Flow'}
                </button>
            </div> */}
        </div>
    );
} 