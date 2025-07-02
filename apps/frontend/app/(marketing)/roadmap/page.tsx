import Footer from '@/app/components/common/Footer';
import { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Roadmap | EarnKit',
    description: 'Explore EarnKit\'s roadmap and upcoming milestones. Track our progress as we build the future of AI agent framework.',
};

interface RoadmapQuarter {
    id: string;
    title: string;
    date: string;
    description: string;
    items: string[];
    status: 'ACTIVE' | 'TBD';
    bgColor: string;
}

const roadmapData: RoadmapQuarter[] = [
    {
        id: 'q3',
        title: 'Q3 2025 · Alpha & Design-Partner Rollout',
        date: 'July - September 2025',
        description: 'Our focus this quarter is to ship the first usable version of the monetization stack and integrate it with a handful of design-partner agents.',
        items: [
            'Earn SDK α — usage, tx-fee & credit primitives',
            'Smart-wallet billing (Privy, Turnkey, EOA)',
            'Developer Dashboard v0 — API keys, real-time logs',
            'EarnKit Docs',
            'Design-partner integrations'
        ],
        status: 'ACTIVE',
        bgColor: 'bg-[#2563E4]'
    },
    {
        id: 'q4',
        title: 'Q4 2025 · Public Beta',
        date: 'October - December 2025',
        description: 'Open EarnKit to all developers.',
        items: [
            'Multichain support (Base, Monad, Solana & more)',
            'Credit top-up flow with ETH/stablecoin checkout',
            'Templates Library — trading agent, token-launcher, miniapp agent',
            'Dashboard v1 — earnings graphs, usage throttles, free-tier controls',
            'Launch-week campaign + leaderboard of top-earning agents'
        ],
        status: 'TBD',
        bgColor: 'bg-[#183E81]'
    },
    {
        id: 'q1-2026',
        title: 'Q1 2026 · Integrations',
        date: 'January - March 2026',
        description: '',
        items: [
            'Framework Plugins — AgentKit, ElizaOS adapters',
            'Protocol Plug-ins — Uniswap v4 hooks, Zora Drops, Farcaster Mini-apps',
            'On/Off-Ramps — Circle & Stripe Crypto stablecoin flow'
        ],
        status: 'TBD',
        bgColor: 'bg-[#192548]'
    },
    {
        id: 'q2-2026',
        title: 'Q2 2026 · Ecosystem Expansion & Growth',
        date: 'April - June 2026',
        description: 'Grow distribution through deeper infra partnerships and a open-source framework.',
        items: [
            'Additional wallets (Coinbase Wallet SDK)',
            'EarnKit Framework — create and manage monetized agent workflows',
            'Analytics v2 — cohort reports, ARPU, churn alerts'
        ],
        status: 'TBD',
        bgColor: 'bg-[#151837]'
    }
];

export default function Roadmap() {
    return (
        <>
            <main
                className="min-h-screen bg-[#F8F9FB] rounded-[56px]"
                style={{
                    backgroundImage: `url('/images/roadmap/grid.png')`,
                    backgroundRepeat: 'repeat',
                    backgroundSize: '12.5rem 12.5rem', // Adjust this value based on your grid size
                }}
            >
                <div className="container mx-auto px-8 md:px-4 py-10 md:py-24 max-w-3xl">

                    {/* Header Section */}
                    <div className="bg-white rounded-[56px] p-12 md:p-[100px]">
                        <h1 className="text-4xl text-black font-funnel-display font-bold mb-[40px]">Roadmap</h1>
                        <p className="text-black/[80%] font-funnel-sans font-[1rem] leading-[1.5rem]">
                            This roadmap highlights key milestones our team aims to achieve every
                            quarter this year. One of EarnKit&apos;s core values is transparency and
                            consistently shipping updates so you&apos;re a part of this journey with us.
                        </p>
                    </div>

                    {/* Roadmap Quarters */}
                    <div className="font-funnel-sans">
                        {roadmapData.map((quarter) => (
                            <div
                                key={quarter.id}
                                className={`${quarter.bgColor} rounded-[56px] p-12 md:p-[100px] text-white flex flex-col gap-[28px]`}
                            >
                                <div className="flex flex-col md:flex-row justify-between items-start mb-8">
                                    <div>
                                        <h2 className="text-3xl font-semibold mb-[10px]">{quarter.title}</h2>
                                        <p className="text-white/[80%] italic font-funnel-sans text-[14px] leading-[1.5rem]">{quarter.date}</p>
                                    </div>
                                    {quarter.status === 'ACTIVE' ? (
                                        <span className="bg-transparent border border-[#B8CCE0] text-[#B8CCE0] px-[12px] py-[2px] mt-2 rounded-full text-[12px] leading-[1rem]">
                                            ACTIVE
                                        </span>
                                    ) : (
                                        <span className="bg-transparent border border-[#B8CCE0] text-[#B8CCE0] px-[12px] py-[2px] mt-2 rounded-full text-[12px] leading-[1rem]">
                                            TBD
                                        </span>
                                    )}
                                </div>
                                <p className="text-white/[80%] font-funnel-sans text-[1rem] leading-[1.5rem]">{quarter.description}</p>
                                {quarter.items.length > 0 && (
                                    <ul className="text-white/[80%] list-disc list-disc-white/[80%] list-inside px-[25px] space-y-[8px] font-funnel-sans font-[1rem] leading-[1.5rem]">
                                        {quarter.items.map((item, index) => (
                                            <li key={index}>{item}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

            </main>
            <Footer /></>
    );
}
