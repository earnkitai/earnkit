import { Icons } from '../../sections/icons';
import { TokenInvestState } from './Token_Invest';

interface TokenInvestProgressProps {
    state: TokenInvestState[];
}

export function TokenInvestProgress({ state }: TokenInvestProgressProps) {
    const ProgressCircle = ({ step, number }: { step: string, number?: number }) => {
        const isMarketStep = step === 'market';
        const isOrderStep = step === 'order';
        const isRecordStep = step === 'record';

        const showSpinner = (isMarketStep && state.includes('researching') && !state.includes('researcherror') && !state.includes('researched')) ||
            (isOrderStep && state.includes('executing') && !state.includes('exerror') && !state.includes('executed')) ||
            (isRecordStep && state.includes('recordkeeping') && !state.includes('recorderror') && !state.includes('completed'));

        const showCheck = (isMarketStep && state.includes('researched')) ||
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

    const getMarketAnalysisSteps = () => {
        return [
            "Connecting to Zora...",
            "Researching token...",
            "Waiting for confirmation..."
        ];
    };

    const getOrderExecutionSteps = () => {
        return [
            "Approving token...",
            "Executing Transaction...",
            "Summarising trade..."
        ];
    };

    const getRecordKeepingSteps = () => {
        return [
            "Logging timestamp and record keeping...",
            "Tracking token price...",
            "Calculating profit and loss..."
        ];
    };

    const getCurrentSteps = () => {
        if (state.includes('researching')) {
            return getMarketAnalysisSteps();
        } else if (state.includes('executing')) {
            return getOrderExecutionSteps();
        } else if (state.includes('recordkeeping')) {
            return getRecordKeepingSteps();
        }
        return getMarketAnalysisSteps();
    };

    const steps = getCurrentSteps();

    return (
        <div className="max-w-[450px] mx-auto bg-white rounded-[36px] p-4 shadow-sm border border-black/10 font-funnel-sans space-y-4">
            <div className="space-y-4 bg-black/4 rounded-[24px] py-8 px-12">
                <div className="flex justify-center mb-6">
                    <Icons.earnyLogoBlack className="w-20 text-black" />
                </div>

                <div className="text-sm text-black/40 mb-4 text-md flex items-center justify-center">
                    <div className="flex items-center gap-2">
                        <span>Trading via</span>
                        <span className="font-medium bg-transparent px-2 py-0.5 rounded-full flex items-center gap-1 border border-black/20 hover:border-black/40 hover:bg-black/10 transition-all duration-300 uppercase text-uniswap-pink">zora</span>
                        <span>on</span>
                        <span className="text-black font-medium bg-transparent px-2 py-0.5 rounded-full flex items-center gap-1 border border-black/20 hover:border-black/40 hover:bg-black/10 transition-all duration-300">
                            <Icons.base className="w-4 h-4 text-black/40 rounded-full" />
                            BASE
                        </span>
                    </div>
                </div>
            </div>

            <div className="space-y-4 flex flex-col justify-center border border-black/10 rounded-[24px] px-8 py-4">
                <div className="relative py-4">
                    {/* Progress Line */}
                    <div className="absolute left-[12px] h-full top-[0%] bottom-[32px] w-[2px] bg-black/40">
                        <div
                            className={`h-full bg-[#22C55E] transition-all duration-500 ease-in-out`}
                            style={{
                                height: state.includes('completed') ? '100%' :
                                    state.includes('executed') ? '66%' :
                                        state.includes('researched') ? '33%' : '0%'
                            }}
                        />
                    </div>

                    <div className='space-y-5'>
                        {steps.map((step, index) => (
                            <div key={index} className="flex items-center gap-3 relative z-10">
                                <ProgressCircle step={state.includes('researching') ? 'market' : state.includes('executing') ? 'order' : 'record'} number={index + 1} />
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-md text-black/80">{step}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
} 