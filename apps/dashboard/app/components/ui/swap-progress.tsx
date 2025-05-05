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

    const ProgressCircle = ({ step, number }: { step: 'approve' | 'swap', number?: number }) => {
        const isApproveStep = step === 'approve';
        const showSpinner = (isApproveStep && state === 'approving') || (!isApproveStep && state === 'swapping');
        const showCheck = (isApproveStep && ['approved', 'swapping', 'completed'].includes(state)) ||
            (!isApproveStep && state === 'completed');

        return (
            <div
                className={`w-8 h-8 rounded-full flex items-center justify-center relative z-10 
                    ${showCheck || showSpinner ? 'bg-secondary-green' : 'bg-white border-2 border-black/20'} 
                    transition-all duration-300 ease-in-out`}
            >
                {showSpinner ? (
                    <div className="w-[50%] h-[50%] m-1 p-[2px] aspect-square rounded-full bg-white custom-mask animate-spin"></div>
                ) : showCheck ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : (
                    <div className="text-black/40 text-xs font-medium">{number}</div>
                )}
            </div>
        );
    };

    const formatTokenAmount = (amount: string, decimals: number) => {
        return (parseInt(amount) / Math.pow(10, decimals)).toFixed(5);
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
                        <span className="font-medium bg-transparent px-2 py-0.5 rounded-full flex items-center gap-1 border border-black/20 hover:border-black/40 hover:bg-black/10 transition-all duration-300 uppercase text-uniswap-pink">uniswap</span>
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
                    <div className="absolute left-[50%] top-[50%] -translate-x-[50%] -translate-y-[50%] h-[2px] w-full bg-black/10">
                        <div
                            className={`h-full bg-secondary-green transition-all duration-500 ease-in-out`}
                            style={{
                                width: state === 'initial' || state === '' ? '0%' :
                                    state === 'approving' ? '25%' :
                                        state === 'approved' ? '50%' :
                                            state === 'swapping' ? '75%' : '100%'
                            }}
                        />
                    </div>

                    {/* Progress Steps */}
                    <div className="flex items-center justify-between w-full mx-auto relative z-10">
                        <div className="flex flex-col items-center gap-2">
                            <ProgressCircle step="approve" number={1} />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <ProgressCircle step="swap" number={2} />
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center justify-between gap-2 w-full">

                        <div className="flex items-center gap-1">
                            <span className="text-black/80 font-bold text-lg">{formatTokenAmount(tokenInAmount, tokenInDecimals)}</span>
                            <div className=" bg-transparent px-2 py-1 rounded-full flex items-center gap-1 border border-black/20 ml-2">
                                {tokenInImage && <Image src={tokenInImage} alt={tokenInSymbol} width={12} height={12} className="rounded-full" />}
                                <span className="text-black/80 font-semibold text-sm uppercase">{tokenInSymbol}</span>
                            </div>
                        </div>
                        <Icons.rightArrowIcon className="w-8" />
                        <div className="flex items-center gap-1">
                            <span className="text-black/80 font-bold text-md">{parseFloat(tokenOutAmount).toFixed(5)}</span>
                            <div className=" bg-transparent px-1.5 py-1 rounded-full flex items-center gap-1 border border-black/20 ml-2">
                                {tokenOutImage && <Image src={tokenOutImage} alt={tokenOutSymbol} width={12} height={12} className="rounded-full" />}
                                <span className="text-black/80 font-semibold text-sm uppercase">{tokenOutSymbol}</span>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Gas Fees and Slippage */}
                <div className="flex items-center gap-2 text-xs justify-between pt-2">
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