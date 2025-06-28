import React from "react";
import { Icons } from "../sections/icons";

export type StepStatus = "stable" | "inprogress" | "confirmed" | "error";

export interface ActivityStep {
    label: string;
    status: StepStatus;
}

interface AgentActivityProps {
    steps: ActivityStep[];
}

const statusColor = {
    stable: "border-white/40 bg-black text-white/40",
    inprogress: "border-secondary-green bg-secondary-green",
    confirmed: "border-secondary-green bg-secondary-green",
    error: "border-red-500 bg-red-500",
};

const AgentActivity: React.FC<AgentActivityProps> = ({ steps }) => (
    <div className="flex flex-col gap-6 py-8 relative">
        <div className="relative flex flex-col gap-4">
            <div className="absolute left-[11px] h-full top-[0%] bottom-[32px] w-[2px] bg-white/40">
            </div>
            {steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3">
                    <div
                        className={`w-6 h-6 min-w-6 min-h-6 rounded-full flex items-center justify-center relative z-10 border-2 transition-all duration-300 ease-in-out ${statusColor[step.status]}`}
                    >
                        {step.status === "inprogress" ? (
                            <div className="w-[60%] h-[60%] m-1 p-[2px] aspect-square rounded-full bg-white custom-mask animate-spin"></div>
                        ) : step.status === "confirmed" ? (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8.5 1.56078L3.61449 6.43918L1.5 4.34757" stroke="black" strokeWidth="2" strokeLinecap="round" />
                            </svg>

                        ) : step.status === "error" ? (
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3">
                                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        ) : (
                            <div className="text-xs font-bold">{idx + 1}</div>
                        )}
                    </div>
                    <span
                        className={`font-funnel-sans text-sm flex items-center gap-2 ${step.status === "error" ? "text-red-500" :
                            "text-white/40"
                            }`}
                    >
                        {step.label}
                        {step.label.includes("Zora") && <span className="inline-block"> <Icons.zoraIcon className="w-4 h-4" /></span>}
                        {step.label.includes("Clanker") && <span className="inline-block"> <Icons.clankerIcon className="w-4 h-4" /></span>}

                    </span>
                </div>
            ))}
        </div>
    </div>
);

export default AgentActivity; 