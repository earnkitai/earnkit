'use client';

import { useEffect, useRef, useState } from 'react';
import { useBalance } from '@/providers/balance-provider';
import Link from 'next/link';

export default function MagneticSlider({ onConfirm, setCurrentActivity }: { onConfirm: (amount: number) => void, setCurrentActivity: (activity: string) => void }) {
    const [percentage, setPercentage] = useState<number>(0);
    const sliderRef = useRef<HTMLInputElement>(null);
    const { ethUsdValue: maxValue } = useBalance();
    const [usdBalance, setUsdBalance] = useState<number>(0);

    useEffect(() => {
        if (maxValue > 0.1) {
            setUsdBalance(maxValue);
        }
    }, [maxValue, setCurrentActivity]);

    useEffect(() => {
        setCurrentActivity("Waiting for confirmation...");
    }, [setCurrentActivity]);


    const tickValues = [...Array(11).keys()];
    const magnetThreshold = 0.2;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const currentValue = parseFloat(e.target.value);
        if (maxValue === 0) return;
        for (const tick of tickValues) {
            const tickValue = (tick / 10) * maxValue;
            if (Math.abs(currentValue - tickValue) < magnetThreshold * (maxValue / 10)) {
                if (sliderRef.current) {
                    sliderRef.current.value = tickValue.toString();
                }
                setPercentage(tick * 10);
                return;
            }
        }
        setPercentage(Math.round((currentValue / maxValue) * 100));
    };

    return (
        <div className="bg-black text-white font-sans">
            <div className="relative w-[85%] mt-12">
                <div className="relative w-full h-2 bg-white/10 rounded">
                    <input
                        ref={sliderRef}
                        type="range"
                        min="0"
                        max={maxValue}
                        step={maxValue / 1000}
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
                        {tickValues.map((_, idx) => (
                            <div
                                key={idx}
                                className="w-1.5 h-1.5 bg-white/20 rounded-full"
                            ></div>
                        ))}
                    </div>
                </div>
                <div className="flex justify-between text-white/40 text-md mt-2 font-funnel-sans font-medium">
                    <span className="text-md">0%</span>
                    <span className="text-md cursor-pointer hover:text-white" onClick={() => {
                        if (sliderRef.current) {
                            sliderRef.current.value = maxValue.toString();
                        }
                        setPercentage(100);
                    }}>max</span>
                </div>
            </div>

            <div className="mt-8 flex w-full items-center justify-start gap-4">
                <div className="rounded-full border-[1.5px] border-white/40 px-[16px] py-1.5 text-md text-white font-funnel-sans font-medium">
                    <span>${maxValue > 0 ? ((percentage / 100) * maxValue).toFixed(2) : '0.00'}</span>
                </div>
                {usdBalance > 0.1 ?
                    <button
                        onClick={() => onConfirm(maxValue > 0 ? ((percentage / 100) * maxValue) : 0)}
                        className="max-w-max rounded-full bg-secondary-green px-[16px] py-1.5 text-md font-medium font-funnel-sans text-black">
                        Confirm
                    </button> :
                    <Link href="/wallet" className="max-w-max rounded-full bg-secondary-green px-[16px] py-1.5 text-md font-medium font-funnel-sans text-black">Fund Wallet</Link>
                }
            </div>
        </div>
    );
}
