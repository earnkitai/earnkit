'use client';

import { useRef, useState } from 'react';

export default function RiskAndReturnOnInvestment({ onConfirm }: { onConfirm: (amount: number) => void }) {
    const [percentage, setPercentage] = useState<number>(0);
    const sliderRef = useRef<HTMLInputElement>(null);

    const tickValues = [0, 20, 40, 60, 80, 100];
    const magnetThreshold = 1;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const currentValue = parseFloat(e.target.value);
        for (const tick of tickValues) {
            if (Math.abs(currentValue - tick) < magnetThreshold) {
                if (sliderRef.current) {
                    sliderRef.current.value = tick.toString();
                }
                setPercentage(tick);
                return;
            }

        }
        setPercentage(Math.round(currentValue));
    };

    return (
        <div className="bg-black text-white font-sans">
            <div className="relative w-[85%] mt-12">
                <div className="relative w-full h-2 rounded return-on-investment-slider">
                    <input
                        ref={sliderRef}
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        defaultValue="0"
                        onInput={handleInputChange}
                        className="appearance-none absolute top-[-6px] left-[-6px] bottom-[-6px] right-[-6px] w-[calc(100%+12px)] h-7 z-10 bg-transparent cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-5
              [&::-webkit-slider-thumb]:h-5
              [&::-webkit-slider-thumb]:bg-green-500
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:mt-[-6px]
              [&::-moz-range-thumb]:w-5
              [&::-moz-range-thumb]:h-5
              [&::-moz-range-thumb]:bg-green-500
              [&::-moz-range-thumb]:rounded-full"
                    />
                    <div className="absolute top-1/2 left-0 w-full flex justify-between transform -translate-y-1/2 pointer-events-none z-0">
                        {tickValues.map((value, idx) => {
                            let dotColor = 'rgba(255, 255, 255, 0.2)'; // default white/20
                            if (value === 25 || value === 50) {
                                dotColor = 'rgba(255, 149, 0, 1)'; // secondary-orange
                            } else if (value === 75 || value === 100) {
                                dotColor = 'rgba(255, 59, 48, 1)'; // secondary-red
                            }

                            return (
                                <div
                                    key={idx}
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{
                                        backgroundColor: dotColor
                                    }}
                                ></div>
                            )
                        })}
                    </div>
                </div>
                <div className="flex justify-between text-white/40 text-md mt-2 font-funnel-sans font-medium">
                    <span className="text-md">0%</span>
                    <span className="text-md">Low Risk</span>
                    <span className="text-md">High Risk</span>
                </div>
            </div>

            <div className="mt-8 flex w-full items-center justify-start gap-4">
                <div className="rounded-full border-[1.5px] border-white/40 px-[16px] py-1.5 text-md text-white font-funnel-sans font-medium">
                    <span>{percentage}%</span>
                </div>
                <button
                    onClick={() => onConfirm(percentage)}
                    className="max-w-max rounded-full bg-secondary-green px-[16px] py-1.5 text-md font-medium font-funnel-sans text-black">
                    Confirm
                </button>
            </div>
        </div>
    );
} 