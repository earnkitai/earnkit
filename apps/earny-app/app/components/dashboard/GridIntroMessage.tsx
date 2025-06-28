import { Icons } from '@/app/components/sections/icons';
import { useEffect, useState } from 'react';

interface GridIntroMessageProps {
    options: { name: string; label: string }[];
    handleSubmit: (e?: React.FormEvent, messageOverride?: string) => void;
    setCurrentActivity: (activity: string) => void;
}

const colorClasses = [
    { bg: 'bg-intro-grid-green/10', border: 'border-intro-grid-green', selectedBg: 'bg-intro-grid-green', hoverOutline: 'hover:outline-intro-grid-green' },
    { bg: 'bg-intro-grid-orange/10', border: 'border-intro-grid-orange', selectedBg: 'bg-intro-grid-orange', hoverOutline: 'hover:outline-intro-grid-orange' },
    { bg: 'bg-intro-grid-pink/10', border: 'border-intro-grid-pink', selectedBg: 'bg-intro-grid-pink', hoverOutline: 'hover:outline-intro-grid-pink' },
    { bg: 'bg-intro-grid-purple/10', border: 'border-intro-grid-purple', selectedBg: 'bg-intro-grid-purple', hoverOutline: 'hover:outline-intro-grid-purple' },
    { bg: 'bg-intro-grid-blue/10', border: 'border-intro-grid-blue', selectedBg: 'bg-intro-grid-blue', hoverOutline: 'hover:outline-intro-grid-blue' },
];

export function GridIntroMessage({ options, handleSubmit, setCurrentActivity }: GridIntroMessageProps) {
    const [selectedOption, setSelectedOption] = useState<string | null>(null);

    const handleOptionClick = (option: { name: string; label: string }) => {
        setSelectedOption(option.name);
        handleSubmit(undefined, option.label);
    };

    useEffect(() => {
        setCurrentActivity("Waiting for selection...");
    }, [setCurrentActivity]);

    return (
        <div className="flex flex-col">
            <div className="p-2 font-funnel-sans text-white/80 font-normal">
                <span className="mr-1">👋</span> Hey there! I&apos;m Earny, an autonomous onchain agent.
                <div className="mt-3">
                    I&apos;m designed to simplify complex blockchain interactions while maintaining the security and precision required for digital asset management. How may I assist with your blockchain requirements today?
                </div>
            </div>
            <div className="flex flex-wrap gap-[16px] text-white/80 p-[20px]">
                {options.map((option, i) => {
                    const color = colorClasses[i % colorClasses.length];
                    const isSelected = selectedOption === option.name;
                    const isDisabled = option.name === 'earn_yield';

                    return (
                        <button
                            key={option.name}
                            onClick={() => !isDisabled && handleOptionClick(option)}
                            disabled={isDisabled}
                            className={`rounded-[28px] p-[24px] flex flex-col w-[216px] h-[148px] min-w-[216px] min-h-[148px] justify-between items-start text-left text-white transition-colors border ${color.border} ${isSelected
                                ? color.selectedBg
                                : `${color.bg} hover:outline hover:outline-2 ${color.hoverOutline}`
                                } ${isDisabled ? 'hover:opacity-50 cursor-not-allowed' : ''} relative group`}
                        >
                            {isDisabled && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-[28px] opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-white font-medium">Coming soon</span>
                                </div>
                            )}
                            <Icons.sparkleWhiteIcon className={`w-[28px] h-[28px] min-w-[28px] min-h-[28px] text-white ${isDisabled ? 'group-hover:hidden' : ''}`} />
                            <span className={`text-md ${isDisabled ? 'group-hover:hidden' : ''}`}>{option.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    );
} 