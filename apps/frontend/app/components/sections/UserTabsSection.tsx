"use client";
import { useState, JSX } from "react";
import { Icons } from "../ui/Icons";

const tabData = {
    "Protocol Operators": [
        {
            icon: (
                <Icons.protocolIcon1 />
            ),
            text: "Automate staking, rebalancing, treasury ops",
        },
        {
            icon: (
                <Icons.protocolIcon2 />
            ),
            text: "Execute multi-chain strategies without dashboards",
        },
        {
            icon: (
                <Icons.protocolIcon3 />
            ),
            text: "Gain full visibility through public Agent Logs",
        },
        {
            icon: (
                <Icons.protocolIcon4 />
            ),
            text: "Remove manual approvals from governance flows",
        },
    ],
    "Onchain Traders": [
        {
            icon: (
                <Icons.onchainTradeIcon1 />
            ),
            text: "One-click alpha execution via Earny",
        },
        {
            icon: (
                <Icons.onchainTradeIcon2 />
            ),
            text: "Remixable templates (Q3) to customize and scale",
        },
        {
            icon: (
                <Icons.onchainTradeIcon3 />
            ),
            text: "Tokenized incentives for top-performing agents",
        },
        {
            icon: (
                <Icons.onchainTradeIcon4 />
            ),
            text: "Run pre-built flows without writing a single line of code",
        },
    ],
} as const;

type TabKey = keyof typeof tabData;

type TabItem = {
    icon: JSX.Element;
    text: string;
};

const tabs = Object.keys(tabData) as TabKey[];

export default function UserTabsSection() {
    const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]);

    return (
        <div className="w-full flex flex-col gap-8 py-6 ">
            {/* Tabs */}
            <div className="flex gap-8 mb-2">
                {tabs.map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`text-xl md:text-2xl font-semibold px-2 transition-colors duration-200 ${activeTab === tab
                            ? "text-color8"
                            : "text-color1 hover:text-color6"
                            }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>
            {/* Boxes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 w-full transition-all duration-300 ease-in-out">
                {tabData[activeTab].map((item: TabItem, idx: number) => (
                    <div
                        key={idx}
                        className="rounded-[28px] border border-[3px] border-color6 bg-transparent p-8 flex flex-col items-start gap-6 min-h-[180px] transition-all duration-300 ease-in-out"
                    >
                        <div className="mb-2">{item.icon}</div>
                        <p className="max-w-[90%] text-white text-lg md:text-xl font-funnel-sans font-normal leading-snug transition-all duration-300 ease-in-out">
                            {item.text}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
} 