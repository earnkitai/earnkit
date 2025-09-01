"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface ToggleSliderProps<T extends string = string> {
    options: { value: T; label: string; textColor?: string }[];
    value: T;
    onChange: (value: T) => void;
    className?: string;
    containerClassName?: string;
    selectedBgColor?: string;
    unselectedBgColor?: string;
    height?: string;
    padding?: string;
    disabled?: boolean;
}

export function ToggleSlider<T extends string = string>({
    options,
    value,
    onChange,
    className,
    containerClassName,
    selectedBgColor = "bg-white",
    unselectedBgColor = "bg-transparent",
    disabled = false,
}: ToggleSliderProps<T>) {

    return (
        <div className={cn(
            "relative inline-flex rounded-full transition-all duration-300 bg-black/10 gap-4 ",
            containerClassName
        )}>
            {/* Option Buttons */}
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    disabled={disabled}
                    className={cn(
                        "relative z-10 flex-1 rounded-full transition-all duration-300 font-funnel-sans font-semibold text-nowrap whitespace-nowrap px-6 py-2",
                        option.textColor || "text-gray-700",
                        value === option.value
                            ? selectedBgColor
                            : unselectedBgColor,
                        "hover:opacity-80 focus:outline-none",
                        className,
                        disabled && "cursor-not-allowed pointer-events-none"
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

// Preset configurations for common use cases
export const ToggleSliderPresets = {
    feeModel: {
        selectedBgColor: "bg-white",
        unselectedBgColor: "bg-transparent"
    },
    status: {
        selectedBgColor: "bg-white",
        unselectedBgColor: "bg-transparent"
    },
    theme: {
        selectedBgColor: "bg-white",
        unselectedBgColor: "bg-transparent"
    }
};

// Usage example component
export function FeeModelToggle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <ToggleSlider
            options={[
                { value: "free-tier", label: "Free Tier" },
                { value: "credit-based", label: "Credit Based" }
            ]}
            value={value}
            onChange={onChange}
            {...ToggleSliderPresets.feeModel}
        />
    );
}
