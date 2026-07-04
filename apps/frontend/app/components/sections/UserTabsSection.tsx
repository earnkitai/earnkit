"use client";
import { useState, JSX } from "react";
import { Icons } from "../ui/Icons";

const tabData = {
    "For Consumer & Infra Teams": [
        {
            icon: (
                <Icons.citIcon1 />
            ),
            text: "Add monetization to Farcaster agents or protocol automations",
        },
        {
            icon: (
                <Icons.protocolIcon2 />
            ),
            text: "Plug into wallet infrastructure of your choice",
        },
        {
            icon: (
                <Icons.citIcon3 />
            ),
            text: "Capture micro-fees from swaps, bridges, mints, or claims",
        },
        {
            icon: (
                <Icons.citIcon4 />
            ),
            text: "Split fees across contributors, platforms and users",
        },
    ],
    "For Agent Developers": [
        {
            icon: (
                <Icons.onchainTradeIcon1 />
            ),
            text: "Monetize your agent instantly without building from scratch",
        },
        {
            icon: (
                <Icons.adIcon1 />
            ),
            text: "Track revenue and user analytics in minutes",
        },
        {
            icon: (
                <Icons.citIcon4 />
            ),
            text: "Split fees across contributors, platforms and users",
        },
        {
            icon: (
                <Icons.onchainTradeIcon4 />
            ),
            text: "Works with Langchain, ElizaOS, AgentKit & more",
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
                        className={`text-md md:text-2xl font-semibold px-2 transition-colors duration-200 ${activeTab === tab
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
                        className="rounded-[28px] border border-[3px] border-color6 bg-transparent p-8 flex flex-col items-start justify-between gap-2 min-h-[230px] transition-all duration-300 ease-in-out"
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